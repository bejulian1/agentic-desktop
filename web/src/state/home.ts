// Small pieces of state for the v0.4 shell: the start page statistics, the branch chip, the
// sidebar search and the notifications. All of them change on real events or when something is
// opened, never on a timer, so the app does no work while it is idle.
import { createMemo, createSignal, untrack } from "solid-js";
import type { GitInfo, HomeStats, StatsRange, Thread } from "../../../shared/protocol";
import { get, post } from "../lib/api";
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
const [branches, setBranches] = createSignal<Record<string, { path: string; info: GitInfo }>>({});
const branchFetched = new Map<string, { path: string; at: number; revision: number }>();
let branchRevision = 0;

export function gitInfo(projectId: string): GitInfo | undefined {
  const cached = branches()[projectId];
  return cached?.path === app.projects[projectId]?.path ? cached?.info : undefined;
}

export function loadGitInfo(projectId: string, force = false): void {
  const path = app.projects[projectId]?.path;
  if (!path) return;
  const previous = branchFetched.get(projectId);
  if (!force && previous?.path === path && Date.now() - previous.at < 5000) return;
  const revision = ++branchRevision;
  branchFetched.set(projectId, { path, at: Date.now(), revision });
  get<GitInfo>(`/api/projects/${projectId}/git`)
    .then((info) => {
      if (branchFetched.get(projectId)?.revision !== revision || app.projects[projectId]?.path !== path) return;
      setBranches({ ...branches(), [projectId]: { path, info } });
    })
    .catch(() => { if (branchFetched.get(projectId)?.revision === revision) branchFetched.delete(projectId); });
}

// The search field in the sidebar opens from the magnifier, the menu or the shortcut.
export const [searchOpen, setSearchOpen] = createSignal(false);

// Notifications: approvals that wait come from the threads themselves. Threads that finished
// while nobody looked at them are noted here, and drop off when they are opened.
const UNREAD_KEY = "ad-unread-threads";
function loadUnread(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(UNREAD_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string").slice(0, 2000) : [];
  } catch { return []; }
}
const [manualUnread, setManualUnread] = createSignal<string[]>(loadUnread());
const [completed, setCompleted] = createSignal<string[]>([]);
const [notificationsReady, setNotificationsReady] = createSignal(false);
const scheduled = createMemo(() => notificationsReady() ? Object.values(app.threads).filter(thread => thread?.scheduleNotice && !thread.running && thread.lastStatus).map(thread => thread!.id) : []);
export const finished = createMemo(() => [...new Set([...manualUnread(), ...completed(), ...scheduled()])]);
function saveUnread(ids: string[]): void {
  setManualUnread(ids);
  try { localStorage.setItem(UNREAD_KEY, JSON.stringify(ids)); } catch { /* The current window still works if browser storage is unavailable. */ }
}
export function markUnread(threadId: string): void {
  const current = untrack(manualUnread);
  if (!current.includes(threadId)) saveUnread([threadId, ...current].slice(0, 2000));
}
const wasRunning = new Map<string, boolean>();
let visible: (id: string) => boolean = () => false;

export function setVisibleCheck(check: (id: string) => boolean): void {
  visible = check;
}

export function markSeen(threadId: string | null, explicit = false): void {
  if (!threadId) return;
  if (untrack(scheduled).includes(threadId)) void post(`/api/threads/${threadId}/schedule-seen`).catch(() => undefined);
  const automatic = untrack(completed);
  if (automatic.includes(threadId)) setCompleted(automatic.filter((id) => id !== threadId));
  // App's automatic visibility effect must not erase a deliberate mark on the active thread.
  const manual = untrack(manualUnread);
  if (explicit && manual.includes(threadId)) saveUnread(manual.filter((id) => id !== threadId));
}

export function clearFinished(): void {
  for (const id of scheduled()) markSeen(id);
  setCompleted([]);
  saveUnread([]);
}

export function wireNotifications(): void {
  setNotificationsReady(true);
  on("git.changed", ({ projectId }) => loadGitInfo(projectId, true));
  for (const thread of Object.values(app.threads)) if (thread) wasRunning.set(thread.id, thread.running);
  on("thread.changed", ({ thread }: { thread: Thread }) => {
    const before = wasRunning.get(thread.id) ?? false;
    wasRunning.set(thread.id, thread.running);
    if (!before || thread.running) return;
    setRunsFinished(runsFinished() + 1);
    if (thread.lastStatus === "done" && !(visible(thread.id) && document.visibilityState === "visible") && !finished().includes(thread.id)) {
      setCompleted([thread.id, ...untrack(completed)].slice(0, 20));
    }
  });
  on("thread.deleted", ({ threadId }) => markSeen(threadId, true));
  window.addEventListener("storage", (event) => { if (event.key === UNREAD_KEY) setManualUnread(loadUnread()); });
}
