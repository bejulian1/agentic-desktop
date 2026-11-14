import {setUiMods} from "./ui-mods";
// Global state that only changes on real events: never per token, so nothing here re-renders
// because a model is streaming.
import { batch, createMemo, createSignal } from "solid-js";
import { closeSkills } from "./skills-workspace";
import { createStore, reconcile } from "solid-js/store";
import { applyAppIcon } from "../lib/app-icon";
import type {
  Bootstrap,
  BuildInfo,
  ChatProject,
  ModelConfig,
  Mode,
  PlaytestState,
  Project,
  ProviderConfig,
  Settings,
  SidebarSection,
  Thread,
  Usage,
  KeyringStatus,
} from "../../../shared/protocol";
import { ApiError, del, get, patch, post } from "../lib/api";
import { connection, on, startSocket } from "../lib/socket";
import { setTheme } from "../lib/theme";
import { closeArtifacts, setArtifacts, wireArtifactEvents } from "./artifacts";
import { beginNavigation, closeChatProjectPage, closeProfile } from "./nav";
import { applyLook, applyStartMode } from "./look";

interface AppState {
  build: BuildInfo | null;
  settings: Settings;
  projects: Record<string, Project>;
  chatProjects: Record<string, ChatProject>; // round 9: Chat projects, no folder
  sections: Record<string, SidebarSection>; // round 11: named sections in the sidebar
  threads: Record<string, Thread>;
  providers: ProviderConfig[];
  models: ModelConfig[];
  projectUsage: Record<string, Usage>;
  playtest: Record<string, PlaytestState>;
  keyring: KeyringStatus | null; // round 14 (SPEC 30.1): where API keys are kept
}

export const [app, setApp] = createStore<AppState>({
  build: null,
  settings: { theme: "system", defaultModelId: null, defaultPermissionMode: "ask", autoOpenAgentThreads: true },
  projects: {},
  chatProjects: {},
  sections: {},
  threads: {},
  providers: [],
  models: [],
  projectUsage: {},
  playtest: {},
  keyring: null,
});

interface UiPrefs {
  mode: Mode;
  projectId: string | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  panelOpen: boolean;
  panelWidth: number;
  collapsed: string[];
  pinnedSummary: boolean;
  projectSort: ProjectSort; // round 9: the Prosjekter menu in the sidebar
  projectGroup: ProjectGroup;
  // Round 11 (SPEC 24.6): ⋯ → Vis in the sidebar.
  showPinned: boolean;
  showProjects: boolean; // Chat: the Prosjekter section
}

export type ProjectSort = "recent" | "name" | "created";
export type ProjectGroup = "project" | "list";

const PREFS_KEY = "ad-ui";

function loadPrefs(): UiPrefs {
  const defaults: UiPrefs = { mode: "chat", projectId: null, sidebarOpen: true, sidebarWidth: 280, panelOpen: matchMedia("(min-width: 1181px)").matches, panelWidth: 420, collapsed: [], pinnedSummary: true, projectSort: "recent", projectGroup: "project", showPinned: true, showProjects: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

const initial = loadPrefs();
export const [mode, setModeSignal] = createSignal<Mode>(initial.mode);
export const [projectId, setProjectIdSignal] = createSignal<string | null>(initial.projectId);
// Below 860 px the sidebar is an overlay and the panel docks above the conversation, so both
// start closed there and close when the window gets that narrow. The choices for wide windows are
// kept, and come back when the window is wide again (snapped to half a screen and back).
const narrow = matchMedia("(max-width: 860px)");
export const [sidebarOpen, setSidebarOpenSignal] = createSignal(initial.sidebarOpen && !narrow.matches);
let wideSidebar = initial.sidebarOpen;
let widePanel = initial.panelOpen;
narrow.addEventListener("change", () => {
  setSidebarOpenSignal(narrow.matches ? false : wideSidebar);
  setPanelOpenSignal(narrow.matches ? false : widePanel);
});
export const [sidebarWidth, setSidebarWidthSignal] = createSignal(initial.sidebarWidth);
export const [panelOpen, setPanelOpenSignal] = createSignal(initial.panelOpen && !narrow.matches);
export const [panelWidth, setPanelWidthSignal] = createSignal(initial.panelWidth);
export const [collapsed, setCollapsedSignal] = createSignal<string[]>(initial.collapsed);
export const [pinnedSummary, setPinnedSummarySignal] = createSignal(initial.pinnedSummary);
export const [projectSort, setProjectSortSignal] = createSignal<ProjectSort>(initial.projectSort);
export const [projectGroup, setProjectGroupSignal] = createSignal<ProjectGroup>(initial.projectGroup);
export const [showPinned, setShowPinnedSignal] = createSignal(initial.showPinned);
export const [showProjects, setShowProjectsSignal] = createSignal(initial.showProjects);
export const [settingsOpen, setSettingsOpen] = createSignal<string | null>(null);
export const [folderPickerOpen, setFolderPickerOpen] = createSignal(false);

function savePrefs(): void {
  const prefs: UiPrefs = {
    mode: mode(),
    projectId: projectId(),
    sidebarOpen: narrow.matches ? wideSidebar : sidebarOpen(),
    sidebarWidth: sidebarWidth(),
    panelOpen: narrow.matches ? widePanel : panelOpen(),
    panelWidth: panelWidth(),
    collapsed: collapsed(),
    pinnedSummary: pinnedSummary(),
    projectSort: projectSort(),
    projectGroup: projectGroup(),
    showPinned: showPinned(),
    showProjects: showProjects(),
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not stored this time.
  }
}

// Going to Chat or Kode, a thread or a project leaves the Artifacts room.
export function setMode(next: Mode): void {
  beginNavigation();
  batch(() => {
    closeChatProjectPage();
    closeSkills();
    closeArtifacts();
    closeProfile();
    setModeSignal(next);
  });
  savePrefs();
}

export function setProjectId(next: string | null): void {
  setProjectIdSignal(next);
  savePrefs();
}

// Round 10 (SPEC 23.9): in a wide window a hidden sidebar becomes a thin row of icons (unless
// Innstillinger → Utseende says gone). Closing, the text fades out first (styles/motion.css reads
// data-sidebar-closing), then the column narrows and the row fades in. Opening needs no wait.
let closingTimer: ReturnType<typeof setTimeout> | undefined;
export const railEnabled = () => (app.settings.sidebarCollapsed ?? "rail") === "rail";
export function setSidebarOpen(next: boolean): void {
  clearTimeout(closingTimer);
  const root = document.documentElement;
  // Whether this is a wide window's choice is read now, not after the fade: the window may be
  // narrowed meanwhile.
  const wide = !narrow.matches;
  const fadeFirst = !next && sidebarOpen() && wide && railEnabled() && !motionReduced();
  const apply = () => {
    root.removeAttribute("data-sidebar-closing");
    if (wide) wideSidebar = next;
    setSidebarOpenSignal(next);
    savePrefs();
  };
  if (!fadeFirst) return apply();
  root.setAttribute("data-sidebar-closing", "");
  closingTimer = setTimeout(apply, 110);
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const motionReduced = () => reducedMotion.matches || document.documentElement.dataset.motion === "reduce";

export function setSidebarWidth(next: number): void {
  setSidebarWidthSignal(next);
  savePrefs();
}

export function setPanelOpen(next: boolean): void {
  setPanelOpenSignal(next);
  if (!narrow.matches) widePanel = next;
  savePrefs();
}

export function setPanelWidth(next: number): void {
  setPanelWidthSignal(next);
  savePrefs();
}

export function setPinnedSummary(next: boolean): void {
  setPinnedSummarySignal(next);
  savePrefs();
}

export function toggleCollapsed(id: string): void {
  setCollapsedSignal(collapsed().includes(id) ? collapsed().filter((c) => c !== id) : [...collapsed(), id]);
  savePrefs();
}

// Fold sammen alle / Fold ut alle in the sidebar: the given ids all folded, or none of them.
export function setAllCollapsed(ids: string[], fold: boolean): void {
  const rest = collapsed().filter((c) => !ids.includes(c));
  setCollapsedSignal(fold ? [...rest, ...ids] : rest);
  savePrefs();
}

export function setProjectSort(next: ProjectSort): void {
  setProjectSortSignal(next);
  savePrefs();
}

export function setProjectGroup(next: ProjectGroup): void {
  setProjectGroupSignal(next);
  savePrefs();
}

export function setShowPinned(next: boolean): void {
  setShowPinnedSignal(next);
  savePrefs();
}

export function setShowProjects(next: boolean): void {
  setShowProjectsSignal(next);
  savePrefs();
}

// Kode without a project: Denne datamaskinen (round 9). Its threads have no folder and no tools.
export const LOCAL_SCOPE = "local";

// The grid a thread lives in: its project, Denne datamaskinen for Kode without one, or Chat.
export function scopeOf(thread: Pick<Thread, "projectId" | "mode">): string {
  return thread.projectId ?? (thread.mode === "code" ? LOCAL_SCOPE : "chat");
}

// The project id behind a scope, null for Chat and Denne datamaskinen.
export function projectOfScope(key: string): string | null {
  return key === "chat" || key === LOCAL_SCOPE ? null : key;
}

// The scope is what the grid shows: "chat", "local" (Kode without a project) or a project id.
export const scope = createMemo(() => (mode() === "code" ? (projectId() ?? LOCAL_SCOPE) : "chat"));
export const currentProject = createMemo(() => {
  const id = projectId();
  return id ? app.projects[id] : undefined;
});

// Threads for lists: the sidebars, the palette and the notifications. A temporary chat is not in
// the history, so it is never listed; it is only seen in the pane that shows it.
// Round 10 (SPEC 23.8): a thread without its first message has no title anywhere: it is not listed,
// and the top bar and the pane show none. The server's placeholder title is UNTITLED; screen
// readers get «Tom tråd» where a name is needed.
export const UNTITLED = "Ny tråd";
export const EMPTY_THREAD_NAME = "Tom tråd";
export const untitled = (t: Thread | undefined | null): boolean => !t || t.title === UNTITLED;
export const listed = (t: Thread | undefined): t is Thread => !!t && !t.temporary && !untitled(t);

export const sortedProjects = createMemo(() => Object.values(app.projects).filter(Boolean).sort((a, b) => b.lastUsedAt - a.lastUsedAt));
// Sections of the mode shown, in their order (round 11).
export const sectionsFor = (m: Mode) => Object.values(app.sections).filter((s): s is SidebarSection => !!s && s.mode === m).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
export const sortedChatProjects = createMemo(() => Object.values(app.chatProjects).filter(Boolean).sort((a, b) => b.lastUsedAt - a.lastUsedAt));

export function modelName(id: string | null | undefined): string {
  const model = app.models.find((m) => m.id === (id ?? app.settings.defaultModelId));
  return model?.name ?? "Ingen modell";
}

export function modelFor(id: string | null | undefined): ModelConfig | undefined {
  return app.models.find((m) => m.id === (id ?? app.settings.defaultModelId));
}

// Toasts

export interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
  action?: { label: string; run: () => void }; // a button in the toast, e.g. Åpne
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
const OFFLINE_TEXT = "Får ikke kontakt med serveren"; // lib/api.ts
export { toasts };
let nextToast = 1;

export function dismissToast(id: number): void {
  setToasts(toasts().filter((t) => t.id !== id));
}

export function toast(text: string, kind: Toast["kind"] = "error", action?: Toast["action"]): void {
  // Some callers toast the error text themselves; while the banner shows, it says this already.
  if (text === OFFLINE_TEXT && connection() === "offline") return;
  const id = nextToast++;
  setToasts([...toasts().slice(-3), { id, text, kind, action }]);
  setTimeout(() => dismissToast(id), kind === "error" || action ? 8000 : 4000);
}

// No contact with the server: the banner at the top already says so while the connection is down,
// so no toast repeats it (it would also cover the panel's tabs). A request that fails while the
// socket still looks fine waits a moment: if the socket goes down too, the banner says it.
export function report(err: unknown): void {
  const message = (err as Error)?.message || "Noe gikk galt";
  if (err instanceof ApiError && err.status === 0) {
    if (connection() !== "online") return;
    setTimeout(() => {
      if (connection() === "online" && !toasts().some((t) => t.text === message)) toast(message);
    }, 1500);
    return;
  }
  toast(message);
}

// Boot

export function applyBootstrap(boot: Bootstrap): void {
  if(boot.uiMods)setUiMods(boot.uiMods);
  setApp({
    build: boot.build,
    settings: boot.settings,
    projects: Object.fromEntries(boot.projects.map((p) => [p.id, p])),
    chatProjects: Object.fromEntries((boot.chatProjects ?? []).map((p) => [p.id, p])),
    sections: Object.fromEntries((boot.sections ?? []).map((s) => [s.id, s])),
    threads: Object.fromEntries(boot.threads.map((t) => [t.id, t])),
    providers: boot.providers,
    models: boot.models,
    keyring: boot.keyring ?? null,
  });
  setArtifacts(boot.artifacts ?? []);
  setTheme(boot.settings.theme);
  applyLook(boot.settings);
  applyAppIcon(boot.settings.appIcon);
  applyStartMode(boot.settings);
  if (projectId() && !app.projects[projectId()!]) setProjectId(boot.projects[0]?.id ?? null);
}

export function wireServerEvents(): void {
  on("thread.changed", ({ thread }) => {
    if (app.threads[thread.id]) setApp("threads", thread.id, reconcile(thread));
    else setApp("threads", thread.id, thread);
  });
  on("thread.deleted", ({ threadId }) => setApp("threads", threadId, undefined!));
  // reconcile, so folderMissing that goes away is gone here too.
  on("project.changed", ({ project }) => setApp("projects", project.id, reconcile(project)));
  on("chat-project.changed", ({ project }) => setApp("chatProjects", project.id, project));
  on("chat-project.deleted", ({ projectId: id }) => setApp("chatProjects", id, undefined!));
  on("section.changed", ({ section }) => setApp("sections", section.id, section));
  on("section.deleted", ({ sectionId }) => setApp("sections", sectionId, undefined!));
  on("project.deleted", ({ projectId: id }) => {
    setApp("projects", id, undefined!);
    if (projectId() === id) setProjectId(Object.keys(app.projects)[0] ?? null);
  });
  on("project.usage", ({ projectId: id, usage }) => setApp("projectUsage", id, usage));
  on("playtest.state", ({ state }) => setApp("playtest", state.projectId, state));
  on("settings.changed", ({ settings, providers, models }) => {
    setApp("settings", settings);
    setApp("providers", reconcile(providers, { key: "id" }));
    setApp("models", reconcile(models, { key: "id" }));
    setTheme(settings.theme);
    applyLook(settings);
    applyAppIcon(settings.appIcon);
  });
  on("keyring.changed", ({ keyring }) => setApp("keyring", keyring));
  on("error", ({ message }) => toast(message));
  wireArtifactEvents();
  startSocket();
}

// Actions shared by several components.

export async function createProject(folder: string, name?: string): Promise<Project> {
  const project = await post<Project>("/api/projects", { name: name ?? "", path: folder });
  setApp("projects", project.id, project);
  return project;
}

// Round 9: a project read again, so a folder that was moved or deleted since is seen now.
export async function refreshProject(id: string): Promise<void> {
  try {
    const fresh = await get<Project>(`/api/projects/${id}`);
    if (app.projects[id]) setApp("projects", id, reconcile(fresh));
  } catch {
    // Gone or offline: the events say what happened.
  }
}

export async function relinkProject(id: string, folder: string): Promise<Project> {
  const project = await post<Project>(`/api/projects/${id}/relink`, { path: folder });
  setApp("projects", project.id, reconcile(project));
  return project;
}

export async function createChatProject(name: string): Promise<ChatProject> {
  const project = await post<ChatProject>("/api/chat-projects", { name });
  setApp("chatProjects", project.id, project);
  return project;
}

// Sections in the sidebar (round 11). Deleting one leaves its threads where they were before.
export async function createSection(name: string, m: Mode): Promise<SidebarSection> {
  const section = await post<SidebarSection>("/api/sections", { name, mode: m });
  setApp("sections", section.id, section);
  return section;
}

export async function moveToSection(threadId: string, sectionId: string | null): Promise<void> {
  await patch(`/api/threads/${threadId}`, { sectionId });
}

export async function renameThread(id: string, title: string): Promise<void> {
  await patch(`/api/threads/${id}`, { title });
}

export async function archiveThread(id: string, archived: boolean): Promise<void> {
  await patch(`/api/threads/${id}`, { archived });
}

export async function deleteThread(id: string): Promise<void> {
  await del(`/api/threads/${id}`);
}

export async function loadProjectUsage(id: string): Promise<void> {
  if (app.projectUsage[id]) return;
  setApp("projectUsage", id, await get<Usage>(`/api/projects/${id}/usage`));
}

export async function loadPlaytest(id: string): Promise<void> {
  if (app.playtest[id]) return;
  setApp("playtest", id, await get<PlaytestState>(`/api/projects/${id}/playtest`));
}

export async function saveSettings(patchValue: Partial<Settings>): Promise<void> {
  setApp("settings", patchValue);
  if (patchValue.theme) setTheme(patchValue.theme);
  applyLook({ ...app.settings });
  await patch("/api/settings", patchValue);
}
