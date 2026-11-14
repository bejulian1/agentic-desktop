// What the menu bar, the shortcuts and the commands do. One place, so they cannot drift apart.
import type { Thread } from "../../../shared/protocol";
import { post } from "../lib/api";
import { app, scopeOf, currentProject, mode, pinnedSummary, report, saveSettings, scope, setFolderPickerOpen, setMode, setPinnedSummary, settingsOpen, setSettingsOpen, setSidebarOpen, sidebarOpen, toast, renameThread } from "./app";
import { gridFor } from "./grid";
import { canGoBack, canGoForward, goHistory } from "./history";
import { newThreadIn, openThread } from "./navigate";
import { requestBrowserTab, showPanel, togglePanel, type PanelTab } from "./panel";
import { requestAnnotate } from "./annotate";
import { revertLastTurn } from "./project-actions";
import { matchShortcut } from "./shortcuts";
import { promptDialog, setInfoDialog } from "../ui/dialogs";
import { finished, markSeen, markUnread, setSearchOpen } from "./home";
import { openPalette } from "./nav";
import { setPinned, sideChat, toggleArchived } from "./thread-actions";
import { openSkills, skillsOpen } from "./skills-workspace";

export function focusedThreadId(): string | null {
  const key = scope();
  return key ? gridFor(key).focusedThreadId() : null;
}

export function focusedThread(): Thread | undefined {
  const id = focusedThreadId();
  return id ? app.threads[id] : undefined;
}

const codeProject = () => (mode() === "code" ? currentProject()?.id ?? null : null);

export const actions = {
  // In Kode without a project the new thread is on Denne datamaskinen, not in Chat.
  newThread: () => void newThreadIn(codeProject(), mode() === "code"),
  newChat: () => void newThreadIn(null),
  newPane: () => {
    const key = scope();
    if (key) gridFor(key).addPane();
  },
  openFolder: () => setFolderPickerOpen(true),
  settings: (section = "general") => setSettingsOpen(section),
  searchThreads: () => {
    if (!sidebarOpen()) setSidebarOpen(true);
    setSearchOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".sidebar .search-input")?.focus());
  },
  back: () => void goHistory(-1, openById),
  forward: () => void goHistory(1, openById),
  canGoBack,
  canGoForward,
  toggleSidebar: () => setSidebarOpen(!sidebarOpen()),
  // Kode: the panel, with or without a project. Chat has none (SPEC 24.5).
  togglePanel: () => {
    if (mode() !== "code") return toast("Sidepanelet med verktøy finnes i Kode.", "info");
    togglePanel();
  },
  toggleSummary: () => setPinnedSummary(!pinnedSummary()),
  toggleMode: () => setMode(mode() === "code" ? "chat" : "code"),
  showTab: (tab: PanelTab) => {
    if (mode() !== "code") return toast("Sidepanelet med verktøy finnes i Kode.", "info");
    showPanel(tab);
  },
  theme: (theme: "light" | "dark" | "system") => saveSettings({ theme }).catch(report),
  shortcuts: () => setInfoDialog("shortcuts"),
  commands: () => setInfoDialog("commands"),
  skills: openSkills,
  scheduled: () => setInfoDialog("scheduled"),
  about: () => setSettingsOpen("about"),
  rename: async () => {
    const thread = focusedThread();
    if (!thread) return toast("Ingen tråd er valgt.", "info");
    const title = await promptDialog({ title: "Gi tråden nytt navn", value: thread.title, confirm: "Lagre" });
    if (title?.trim() && title.trim() !== thread.title) await renameThread(thread.id, title.trim()).catch(report);
  },
  compact: async () => {
    const id = focusedThreadId();
    if (!id) return toast("Tråden er tom.", "info");
    await post(`/api/threads/${id}/compact`).catch(report);
  },
  undo: () => revertLastTurn(focusedThreadId()),
  stop: () => {
    const id = focusedThreadId();
    if (id) post(`/api/threads/${id}/stop`).catch(report);
  },
  fork: () => {
    const id = focusedThreadId();
    if (id) void forkThread(id);
    else toast("Tråden er tom.", "info");
  },
  init: async () => {
    const project = currentProject();
    if (!project || mode() !== "code") return toast("/init krever Kode-modus og et prosjekt.", "info");
    try {
      await post(`/api/projects/${project.id}/init`);
      toast("Laget AGENTS.md i prosjektet.", "info");
    } catch (err) {
      report(err);
    }
  },
};

async function openById(id: string): Promise<void> {
  const thread = app.threads[id];
  if (thread) await openThread(thread);
}

// The copy opens beside the original, so both stay in view.
export async function forkThread(id: string): Promise<void> {
  try {
    const copy = await post<Thread>(`/api/threads/${id}/fork`);
    const grid = gridFor(scopeOf(copy));
    await grid.loaded;
    const pane = grid.paneWith(id);
    if (!pane || !grid.split(pane.id, "right", copy.id)) await openThread(copy);
    toast(`Laget «${copy.title}».`, "info");
  } catch (err) {
    report(err);
  }
}

const HANDLERS: Record<string, () => unknown> = {
  "thread.new": actions.newThread,
  "thread.back": actions.back,
  "thread.forward": actions.forward,
  "thread.search": actions.searchThreads,
  "pane.new": actions.newPane,
  "folder.open": actions.openFolder,
  "settings.open": () => actions.settings(),
  "view.sidebar": actions.toggleSidebar,
  "view.panel": actions.togglePanel,
  "view.summary": actions.toggleSummary,
  "view.mode": actions.toggleMode,
  "help.shortcuts": actions.shortcuts,
  "palette.open": () => openPalette(),
  "thread.rename": () => actions.rename(),
  "thread.pin": () => {
    const thread = focusedThread();
    if (thread) void setPinned(thread, !thread.pinned);
  },
  "thread.side": () => {
    const thread = focusedThread();
    if (thread) void sideChat(thread);
    else toast("Ingen tråd er valgt.", "info");
  },
  "thread.unread": () => {
    const thread = focusedThread();
    if (thread && !thread.temporary) finished().includes(thread.id) ? markSeen(thread.id, true) : markUnread(thread.id);
  },
  "thread.archive": () => {
    const thread = focusedThread();
    if (thread) void toggleArchived(thread);
  },
  "panel.files": () => actions.showTab("files"),
  "panel.changes": () => actions.showTab("changes"),
  "panel.terminal": () => actions.showTab("terminal"),
  "panel.browser": () => actions.showTab("browser"),
  "panel.team": () => actions.showTab("team"),
  "panel.overview": () => actions.showTab("overview"),
  "panel.session": () => actions.showTab("session"),
  "browser.newTab": () => {
    actions.showTab("browser");
    if (mode() === "code") requestBrowserTab(false);
  },
  "browser.newTabFull": () => {
    actions.showTab("browser");
    if (mode() === "code") requestBrowserTab(true);
  },
  // Round 11b (SPEC 25.1): Annoter in the Browser panel that is open, or the panel and a hint.
  "browser.annotate": () => {
    if (mode() !== "code") return toast("Annoter hører til nettleseren i Kode.", "info");
    if (requestAnnotate()) return;
    actions.showTab("browser");
    toast("Åpne en side i nettleseren, så kan du annotere den.", "info");
  },
};

export function handleShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const id = matchShortcut(event);
  if (!id) return;
  event.preventDefault();
  // The conversation stays mounted behind Settings; its shortcuts must stay inactive there.
  if (settingsOpen()) {
    if (id === "settings.open") setSettingsOpen(null);
    return;
  }
  if (skillsOpen() && !["settings.open", "view.sidebar", "view.mode", "thread.new", "thread.back", "thread.forward", "thread.search", "palette.open", "help.shortcuts"].includes(id)) return;
  HANDLERS[id]?.();
}

// A background instance: a thread that starts on a task without taking a pane. Its dot in the
// sidebar shows how it is doing.
export async function startBackground(projectId: string): Promise<void> {
  const task = await promptDialog({ title: "Ny bakgrunnstråd", value: "", confirm: "Start" });
  if (!task?.trim()) return;
  try {
    const thread = await post<Thread>("/api/threads", { projectId, mode: "code" });
    await post(`/api/threads/${thread.id}/messages`, { text: task.trim() });
    toast("Startet i bakgrunnen. Følg den i sidefanen.", "info");
  } catch (err) {
    report(err);
  }
}
