// Going to a thread. The model loads first, so the old content stays up until the new content can
// be shown in one go: no spinner and no blank frame for local data.
import { batch, createSignal } from "solid-js";
import type { Thread } from "../../../shared/protocol";
import { post } from "../lib/api";
import { app, LOCAL_SCOPE, projectOfScope, refreshProject, report, scopeOf, setMode, setProjectId } from "./app";
import { gridFor } from "./grid";
import { openGitWorkspace } from "../ui/dialog-state";
import { loadModel, peekModel } from "./thread-model";
import { markSeen } from "./home";
import { beginNavigation, currentNavigationGeneration, showChatProjectPage } from "./nav";
import { focusDetachedWindow } from "./windows";

export function preloadThread(id: string): void {
  if (!peekModel(id)) void loadModel(id).catch(() => undefined);
}

// Each open is numbered. Loading takes a moment, so two quick clicks can come back in the wrong
// order: only the newest may change the view, or a pane jumps back to the thread clicked first.
export function cancelPendingThreadOpen(): void { beginNavigation(); }

export async function openThread(thread: Thread): Promise<void> {
  const seq = beginNavigation();
  try {
    await loadModel(thread.id);
  } catch (err) {
    if (seq === currentNavigationGeneration()) report(err);
    return;
  }
  const target = scopeOf(thread);
  const grid = gridFor(target);
  await grid.loaded;
  if (seq !== currentNavigationGeneration()) return;
  markSeen(thread.id, true);
  if (focusDetachedWindow(grid, thread.id)) return;
  batch(() => {
    showScope(target);
    grid.open(thread.id);
  });
  // Was the folder moved or deleted since the app started? The bar above the field says so.
  if (thread.projectId) void refreshProject(thread.projectId);
}

// Opening a project is navigation, without selecting an empty pane or making a blank thread.
export function openChatProject(id: string): void {
  if (!app.chatProjects[id]) return;
  cancelPendingThreadOpen();
  batch(() => {
    setMode("chat");
    showChatProjectPage(id);
  });
}

// Chat, Kode in a project, or Kode on Denne datamaskinen.
function showScope(key: string): void {
  if (key === "chat") return setMode("chat");
  setProjectId(projectOfScope(key));
  setMode("code");
}

// projectId null is Chat, or Kode without a project (Denne datamaskinen) with code.
export async function newThreadIn(projectId: string | null, code = false, chatProjectId: string | null = null): Promise<void> {
  // v1.3.0: a project set to start new threads in a new worktree asks for the branch first; the
  // worktree opens as its own project, where the new thread then starts.
  if (projectId && app.projects[projectId]?.defaultWorkspaceMode === "worktree" && !app.projects[projectId]?.folderMissing) {
    openGitWorkspace(projectId, true);
    return;
  }
  const seq = beginNavigation(); // A thread still loading must not take the pane back afterwards.
  const key = projectId ?? (code ? LOCAL_SCOPE : "chat");
  const grid = gridFor(key);
  await grid.loaded;
  if (seq !== currentNavigationGeneration()) return;
  // An empty pane is a thread waiting for its first message. It is created when that is sent.
  batch(() => {
    const empty = grid.panes().find((p) => !p.threadId());
    if (empty) grid.focus(empty.id);
    else grid.setThread(grid.focused(), null);
    if (key === "chat") bindChatProject(grid.focused(), chatProjectId);
    showScope(key);
  });
}

export async function createThreadFor(projectId: string | null, modelId: string | null, options: { code?: boolean; chatProjectId?: string | null; sideOf?: string; chatTools?: Thread["chatTools"]; title?: string } = {}): Promise<Thread> {
  const thread = await post<Thread>("/api/threads", {
    projectId,
    mode: projectId || options.code ? "code" : "chat",
    modelId: modelId ?? undefined,
    title: options.title,
    sideOf: options.sideOf,
    chatTools: options.chatTools,
    ...(options.chatProjectId ? { chatProjectId: options.chatProjectId } : {}),
  });
  await loadModel(thread.id, thread.mode === "code");
  return thread;
}

// Round 9: a new chat in a Chat project. The empty pane remembers the project until its first
// message makes the thread there.
const [paneChatProjects, setPaneChatProjects] = createSignal<Record<string, string>>({});
export const chatProjectFor = (paneId: string): string | null => {
  const id = paneChatProjects()[paneId];
  return id && app.chatProjects[id] ? id : null;
};

export async function newChatIn(chatProjectId: string | null): Promise<void> {
  if (!chatProjectId) return newThreadIn(null);
  openChatProject(chatProjectId);
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="chat-project-page"] textarea')?.focus({ preventScroll: true }));
}

function bindChatProject(paneId: string, chatProjectId: string | null): void {
  const current = paneChatProjects();
  if ((current[paneId] ?? null) === chatProjectId) return;
  const next = { ...current };
  if (chatProjectId) next[paneId] = chatProjectId;
  else delete next[paneId];
  setPaneChatProjects(next);
}
