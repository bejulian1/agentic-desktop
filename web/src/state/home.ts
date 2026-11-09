// Small pieces of state for the v0.4 shell: the start page statistics, the branch chip, the
// sidebar search and the notifications. All of them change on real events or when something is
// opened, never on a timer, so the app does no work while it is idle.
import { createSignal, untrack } from "solid-js";
import type { GitInfo, HomeStats, StatsRange, Thread } from "../../../shared/protocol";
import { get } from "../lib/api";
import { on } from "../lib/socket";
import { app } from "./app";

// Statistics. One request per range, shared by every pane, and fetched again when a run has
// finished since the last time.
const STALE_MS = 15_000;
const [stats, setStats] = createSignal<Partial<Record<StatsRange, HomeStats>>>({});
const fetchedAt: Partial<Record<StatsRange, number>> = {};
const [runsFinished, setRunsFinished] = createSignal(0);
const seenRuns: Partial<Record<StatsRange, number>> = {};
// Read by the card, so it fetches again when a run ends while it is on screen.
export { runsFinished };

export function homeStats(range: StatsRange): HomeStats | undefined {
  return stats()[range];
}

// force: fetch now, whatever the cache says (the profile menu, each time it opens).
export function loadHomeStats(range: StatsRange, force = false): void {
  const runs = untrack(runsFinished);
  const fresh = Date.now() - (fetchedAt[range] ?? 0) < STALE_MS && seenRuns[range] === runs;
  if (!force && fresh && untrack(stats)[range]) return;
  fetchedAt[range] = Date.now();
  seenRuns[range] = runs;
  get<HomeStats>(`/api/stats?range=${range}`)
    .then((value) => setStats({ ...untrack(stats), [range]: value }))
    .catch(() => undefined);
}

// The branch chip. Read again when the composer for the project mounts, at most every few seconds.
const [branches, setBranches] = createSignal<Record<string, GitInfo>>({});
const branchFetched = new Map<string, number>();

export function gitInfo(projectId: string): GitInfo | undefined {
  return branches()[projectId];
}

export function loadGitInfo(projectId: string): void {
  if (Date.now() - (branchFetched.get(projectId) ?? 0) < 5000) return;
  branchFetched.set(projectId, Date.now());
  get<GitInfo>(`/api/projects/${projectId}/git`)
    .then((info) => setBranches({ ...branches(), [projectId]: info }))
    .catch(() => undefined);
}

// The search field in the sidebar opens from the magnifier, the menu or the shortcut.
export const [searchOpen, setSearchOpen] = createSignal(false);

// Notifications: approvals that wait come from the threads themselves. Threads that finished
// while nobody looked at them are noted here, and drop off when they are opened.
const [finished, setFinished] = createSignal<string[]>([]);
export { finished };
const wasRunning = new Map<string, boolean>();
let visible: (id: string) => boolean = () => false;

export function setVisibleCheck(check: (id: string) => boolean): void {
  visible = check;
}

export function markSeen(threadId: string | null): void {
  if (threadId && finished().includes(threadId)) setFinished(finished().filter((id) => id !== threadId));
}

export function clearFinished(): void {
  setFinished([]);
}

export function wireNotifications(): void {
  for (const thread of Object.values(app.threads)) if (thread) wasRunning.set(thread.id, thread.running);
  on("thread.changed", ({ thread }: { thread: Thread }) => {
    const before = wasRunning.get(thread.id) ?? false;
    wasRunning.set(thread.id, thread.running);
    if (!before || thread.running) return;
    setRunsFinished(runsFinished() + 1);
    if (thread.lastStatus === "done" && !(visible(thread.id) && document.visibilityState === "visible") && !finished().includes(thread.id)) {
      setFinished([thread.id, ...finished()].slice(0, 20));
    }
  });
  on("thread.deleted", ({ threadId }) => markSeen(threadId));
}
