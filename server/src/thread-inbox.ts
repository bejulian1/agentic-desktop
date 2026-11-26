import { pullKey, pullUrl } from "../../shared/linked-pr.ts";
import type { LinkedPr, PullWatchStatus, Thread, ThreadEventEnvelope } from "../../shared/protocol.ts";
import type { Store } from "./db.ts";
import { GitHubError } from "./github.ts";
import { HttpError } from "./errors.ts";

const HOUR = 3_600_000;
const SWEEP_EVERY = 5 * 60_000;
const WAKE_EVENTS = new Set(["user.message", "user.queued", "run.finished", "approval.requested", "question.requested"]);
const PARENT_WAKE_EVENTS = new Set(["run.finished", "approval.requested", "question.requested"]);

export function validateSnoozedUntil(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= Date.now() || value > 8.64e15) {
    throw new HttpError(400, "Velg et gyldig tidspunkt i fremtiden");
  }
  return value;
}

export function parseSnoozedUntil(value: unknown): number | null {
  if (typeof value !== "string") return validateSnoozedUntil(value);
  const iso = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  const day = iso && new Date(`${iso[1]}T00:00:00Z`);
  return validateSnoozedUntil(day && Number.isFinite(+day) && day.toISOString().startsWith(iso[1]) ? Date.parse(value) : NaN);
}

function canSettle(thread: Thread, now: number): boolean {
  return !thread.archived && !thread.temporary && !thread.pinned && !thread.running &&
    !thread.pendingApprovals && !thread.pendingQuestions && (thread.snoozedUntil ?? 0) <= now;
}

export class ThreadInbox {
  private store: Store;
  private changed: (id: string) => void;
  private readPull: (pull: LinkedPr) => Promise<PullWatchStatus>;
  private timer?: NodeJS.Timeout;
  private checkingPulls = false;
  private closed = false;
  private retryPullsAt = 0;
  private deadPulls = new Set<string>();

  constructor(
    store: Store,
    changed: (id: string) => void,
    readPull: (pull: LinkedPr) => Promise<PullWatchStatus>,
  ) {
    this.store = store;
    this.changed = changed;
    this.readPull = readPull;
  }

  start(): void {
    this.sweep();
    this.timer = setInterval(() => this.sweep(), SWEEP_EVERY).unref();
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
  }

  sweep(): void {
    if (this.closed) return;
    const settings = this.store.settings();
    if (settings.autoSettleAfterHours != null) this.settleInactive(settings.autoSettleAfterHours);
    if (settings.autoSettleOnPrClose) void this.checkPulls();
  }

  inactiveCandidates(hours: number, now = Date.now()): Thread[] {
    return this.store.inboxCandidates(now, { inactiveSince: now - hours * HOUR }).filter((thread) => canSettle(thread, now));
  }

  private settleInactive(hours: number, now = Date.now()): void {
    for (const thread of this.inactiveCandidates(hours, now)) {
      this.archive(thread.id);
    }
  }

  onEvent({ threadId, event }: ThreadEventEnvelope): void {
    if (this.closed || !WAKE_EVENTS.has(event.type) || this.store.settings().snoozeWakeOnActivity === false) return;
    this.clearSnooze(threadId);
    if (PARENT_WAKE_EVENTS.has(event.type)) {
      const seen = new Set<string>([threadId]);
      let parent = this.store.thread(threadId)?.parentThreadId;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        this.clearSnooze(parent);
        parent = this.store.thread(parent)?.parentThreadId;
      }
    }
  }

  onWatchedPull(id: string, pull: PullWatchStatus, link: boolean, activity: boolean): void {
    if (this.closed) return;
    const thread = this.store.thread(id);
    if (!thread || thread.temporary) return;
    const key = pullKey(pull);
    this.deadPulls.delete(key);
    const samePull = thread.linkedPr && pullKey(thread.linkedPr) === key;
    if (!link && !samePull) return;
    const settings = this.store.settings();
    if (link && !samePull) {
      this.store.updateThread(id, { linkedPr: { repo: pull.repo, number: pull.number, url: pullUrl(pull) } });
      this.changed(id);
    }
    if (settings.autoSettleOnPrClose) this.settlePull(id, pull);
    if (activity && settings.snoozeWakeOnActivity !== false) this.clearSnooze(id);
  }

  async checkThreadPull(id: string, now = Date.now()): Promise<void> {
    if (this.closed || now < this.retryPullsAt || !this.store.settings().autoSettleOnPrClose) return;
    const thread = this.store.thread(id);
    if (!thread?.linkedPr || !canSettle(thread, now)) return;
    const pull = thread.linkedPr;
    const key = pullKey(pull);
    this.deadPulls.delete(key);
    try {
      const result = await this.readPull(pull);
      if (this.closed || !this.store.settings().autoSettleOnPrClose) return;
      if (pullKey(result) === key) this.settlePull(id, result);
    } catch (error) {
      if (error instanceof GitHubError) {
        if (error.code === "not-found") this.deadPulls.add(key);
        if (error.code === "rate-limit") this.retryPullsAt = error.resetAt ?? Date.now() + SWEEP_EVERY;
      }
    }
  }

  async checkPulls(now = Date.now()): Promise<void> {
    if (this.closed || this.checkingPulls || now < this.retryPullsAt) return;
    const groups = new Map<string, { pull: LinkedPr; ids: string[] }>();
    for (const thread of this.store.inboxCandidates(now, { linkedPr: true })) {
      if (!thread.linkedPr || !canSettle(thread, now)) continue;
      const key = pullKey(thread.linkedPr);
      if (this.deadPulls.has(key)) continue;
      const group = groups.get(key);
      if (group) group.ids.push(thread.id);
      else groups.set(key, { pull: thread.linkedPr, ids: [thread.id] });
    }
    this.checkingPulls = true;
    try {
      for (const [key, { pull, ids }] of groups.entries()) {
        if (this.closed || !this.store.settings().autoSettleOnPrClose) return;
        try {
          const result = await this.readPull(pull);
          if (this.closed || !this.store.settings().autoSettleOnPrClose) return;
          if (pullKey(result) === key) for (const id of ids) this.settlePull(id, result);
        } catch (error) {
          if (error instanceof GitHubError) {
            if (error.code === "not-found") {
              this.deadPulls.add(key);
              continue;
            }
            if (error.code === "rate-limit") this.retryPullsAt = error.resetAt ?? Date.now() + SWEEP_EVERY;
            if (["rate-limit", "not-connected", "bad-token", "offline"].includes(error.code)) return;
          }
        }
      }
    } finally {
      this.checkingPulls = false;
    }
  }

  private settlePull(id: string, pull: PullWatchStatus): void {
    if (pull.state !== "CLOSED" && pull.state !== "MERGED") return;
    // The thread can move, be pinned or get new work while the GitHub request is in flight.
    const thread = this.store.thread(id);
    if (thread?.linkedPr && pullKey(thread.linkedPr) === pullKey(pull) && canSettle(thread, Date.now())) this.archive(id);
  }

  private clearSnooze(id: string): void {
    if (this.store.wakeSnoozedThread(id, Date.now())) this.changed(id);
  }

  private archive(id: string): void {
    this.store.updateThread(id, { archived: true });
    this.changed(id);
  }
}
