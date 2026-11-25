import type { Thread } from "../../../shared/protocol";
import { waitingCount } from "./thread-status";

export const snoozedAt = (thread: Thread, now: number): boolean => (thread.snoozedUntil ?? 0) > now;

export function nextWake(threads: readonly Thread[], now: number): number {
  return threads.reduce((next, thread) => snoozedAt(thread, now) ? Math.min(next, thread.snoozedUntil!) : next, Infinity);
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

export function splitInbox(
  threads: readonly Thread[],
  now: number,
  hideWorking: boolean,
  unread: ReadonlySet<string>,
  activeIds: ReadonlySet<string> = EMPTY_IDS,
  separateSnoozed = true,
) {
  const active: Thread[] = [];
  const working: Thread[] = [];
  const snoozed: Thread[] = [];
  for (const thread of threads) {
    if (separateSnoozed && snoozedAt(thread, now)) snoozed.push(thread);
    else if (
      hideWorking &&
      thread.running &&
      !thread.pinned &&
      !activeIds.has(thread.id) &&
      !waitingCount(thread) &&
      thread.lastStatus !== "error" &&
      !unread.has(thread.id)
    ) working.push(thread);
    else active.push(thread);
  }
  snoozed.sort((a, b) => a.snoozedUntil! - b.snoozedUntil!);
  return { active, working, snoozed };
}

export function inboxOrder(unread: ReadonlySet<string>, order = (a: Thread, b: Thread) => b.updatedAt - a.updatedAt) {
  const rank = (thread: Thread) => waitingCount(thread) ? 0 : thread.lastStatus === "error" || unread.has(thread.id) ? 1 : 2;
  return (a: Thread, b: Thread) => Number(b.pinned) - Number(a.pinned) || rank(a) - rank(b) || order(a, b);
}
