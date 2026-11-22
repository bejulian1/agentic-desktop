// Small pieces of state for the v0.5 navigation round: the profile page, the command palette,
// recently opened files, project favicons and line counts for the smart sidebar. Nothing here
// imports state/app.ts, so app.ts can close the profile page when the mode changes.
import { createSignal } from "solid-js";
import { get } from "../lib/api";
import type { GitHubKind, GitHubReference } from "../../../shared/protocol";

export const [githubRoom, setGitHubRoom] = createSignal<{ kind: GitHubKind; projectId?: string; detail: GitHubReference | null } | null>(null);
export const closeGitHubRoom = () => setGitHubRoom(null);

// Any explicit mode/page/thread navigation supersedes a thread still loading. Keeping this
// generation here lets app.ts cancel it without importing the thread/grid navigation module.
let navigationGeneration = 0;
export const currentNavigationGeneration = (): number => navigationGeneration;
export function beginNavigation(): number { return ++navigationGeneration; }

// A Chat project has a landing page of its own. It never changes the Chat grid or creates a
// thread. Session storage restores this window's page on reload without affecting other windows.
const CHAT_PROJECT_PAGE_KEY = "ad-chat-project-page";
function restoredChatProjectPage(): string | null {
  try { return sessionStorage.getItem(CHAT_PROJECT_PAGE_KEY); } catch { return null; }
}
const [chatProjectPageId, setChatProjectPageId] = createSignal<string | null>(restoredChatProjectPage());
export { chatProjectPageId };
export function showChatProjectPage(id: string): void {
  setChatProjectPageId(id);
  try { sessionStorage.setItem(CHAT_PROJECT_PAGE_KEY, id); } catch { /* Local state still works. */ }
}
export function closeChatProjectPage(): void {
  setChatProjectPageId(null);
  try { sessionStorage.removeItem(CHAT_PROJECT_PAGE_KEY); } catch { /* Local state still works. */ }
}

// The profile page in the middle of the window, like the Artifacts room.
const [profileOpen, setProfileOpen] = createSignal(false);
export { profileOpen };
export function openProfile(): void {
  closeGitHubRoom();
  setProfileOpen(true);
}
export function closeProfile(): void {
  if (profileOpen()) setProfileOpen(false);
}

// The command palette, and which tab it opens on.
export type PaletteTab = "all" | "actions" | "chats" | "files" | "text";
const [palette, setPalette] = createSignal<{ tab: PaletteTab; query: string } | null>(null);
export { palette };
export function openPalette(tab: PaletteTab = "all", query = ""): void {
  setPalette({ tab, query });
}
export function closePalette(): void {
  setPalette(null);
}

// Files opened in the Files panel, newest first, kept in this browser.
export interface RecentFile {
  projectId: string;
  path: string;
  at: number;
}
const RECENT_KEY = "ad-recent-files";
function loadRecent(): RecentFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((f) => typeof f?.projectId === "string" && typeof f?.path === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}
const [recentFiles, setRecentFiles] = createSignal<RecentFile[]>(loadRecent());
export { recentFiles };
export function noteRecentFile(projectId: string, path: string): void {
  const next = [{ projectId, path, at: Date.now() }, ...recentFiles().filter((f) => f.projectId !== projectId || f.path !== path)].slice(0, 20);
  setRecentFiles(next);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Not kept this time.
  }
}

// Only a file actually loaded by a mounted panel belongs in prompt-completion context.
// Recent files and another chat's preview must never silently become current context.
type OpenedFileContext = { projectId: string; threadId: string | null; path: string; owner: symbol };
const [openedFiles, setOpenedFiles] = createSignal<OpenedFileContext[]>([]);
export function openedFileContext(projectId: string, threadId: string | null): string | undefined {
  return openedFiles().find((file) => file.projectId === projectId && file.threadId === threadId)?.path;
}
export function registerOpenedFile(projectId: string, threadId: string | null, filePath: string): () => void {
  const owner = Symbol();
  setOpenedFiles((files) => [...files.filter((file) => file.projectId !== projectId || file.threadId !== threadId), { projectId, threadId, path: filePath, owner }]);
  return () => setOpenedFiles((files) => files.filter((file) => file.owner !== owner));
}

// A file that should open in the Files panel: from the palette or the Utdata list.
const [fileRequest, setFileRequest] = createSignal<{ projectId: string; path: string; n: number } | null>(null);
let requests = 0;
export { fileRequest };
export function requestFile(projectId: string, path: string): void {
  setFileRequest({ projectId, path, n: ++requests });
}

// A file on Denne datamaskinen that should open in the local Files panel (a file link in a Kode
// thread without a project). An absolute path; the panel opens its folder and shows it read-only.
const [localFileRequest, setLocalFileRequest] = createSignal<{ path: string; n: number } | null>(null);
export { localFileRequest };
export function requestLocalFile(path: string): void {
  setLocalFileRequest({ path, n: ++requests });
}

// Projects with a favicon of their own, with its version. Fetched at start and when a project
// changes, never on a timer.
const [favicons, setFavicons] = createSignal<Record<string, number>>({});
export { favicons };
let faviconTimer: ReturnType<typeof setTimeout> | undefined;
export function loadFavicons(delayMs = 0): void {
  clearTimeout(faviconTimer);
  faviconTimer = setTimeout(() => {
    get<Record<string, number>>("/api/favicons").then(setFavicons).catch(() => undefined);
  }, delayMs);
}

// Lines added and removed per thread, for the cards in the smart sidebar.
const [diffStats, setDiffStats] = createSignal<Record<string, { additions: number; deletions: number }>>({});
export { diffStats };
let statsTimer: ReturnType<typeof setTimeout> | undefined;
export function loadDiffStats(delayMs = 0): void {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    get<Record<string, { additions: number; deletions: number }>>("/api/thread-stats").then(setDiffStats).catch(() => undefined);
  }, delayMs);
}
