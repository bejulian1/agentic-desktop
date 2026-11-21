// What the right panel shows, so rows and commands can point at it.
import { batch, createSignal } from "solid-js";
import { app, currentProject, LOCAL_SCOPE, panelOpen, setPanelOpen } from "./app";
import { addToStack, removeFromStack, stacking, stackTools } from "./stack";
import { artifactPanel, closeArtifactPanel } from "./artifact-panel";
import { studioOpen, setStudioOpen, setStudioTool } from "./studio";

// Round 12 (SPEC 26.2): "session" is Økt.
export type PanelTab = "files" | "changes" | "terminal" | "browser" | "team" | "overview" | "github" | "session";

// Each code scope remembers its own tabs and chooser. Tool contents still use the selected
// scope's projectId, so reopening a tab can never reattach another project's terminal/browser.
interface PanelWorkspace { tab: PanelTab; home: boolean; homeRequested: boolean; tools: PanelTab[]; pages: string[]; page: string | null }
const EMPTY_WORKSPACE: PanelWorkspace = { tab: "overview", home: true, homeRequested: false, tools: [], pages: [], page: null };
const [workspaces, setWorkspaces] = createSignal<Record<string, PanelWorkspace>>({});
const workspaceKey = () => currentProject()?.id ?? LOCAL_SCOPE;
const workspace = () => workspaces()[workspaceKey()] ?? EMPTY_WORKSPACE;
const updateWorkspace = (change: Partial<PanelWorkspace>) => setWorkspaces((all) => ({ ...all, [workspaceKey()]: { ...workspace(), ...change } }));
const panelTab = () => workspace().tab;
const setPanelTab = (tab: PanelTab) => updateWorkspace({ tab });
const [selectedTurn, setSelectedTurn] = createSignal<string | null>(null);
export { panelTab, selectedTurn, setSelectedTurn };

// Only tools the user has opened belong in the shared tab row. Closing a tool removes its tab;
// its server-side terminal/browser resources keep their existing lifetime.
const openedPanelTools = () => workspace().tools;
const setOpenedPanelTools = (tools: PanelTab[]) => updateWorkspace({ tools });
export { openedPanelTools };
export function rememberPanelTool(tab: PanelTab): void {
  if (!openedPanelTools().includes(tab)) setOpenedPanelTools([...openedPanelTools(), tab]);
}

export function showPanel(tab: PanelTab): void {
  if (studioOpen()) {
    if (tab === "terminal" || tab === "browser" || tab === "changes") {
      setStudioTool(tab);
      return;
    }
    if (tab === "files") {
      setStudioTool(null);
      return;
    }
    setStudioOpen(false);
  }
  batch(() => {
  // Round 15: an open artifact has the right side; a tool asked for takes it back.
  closeArtifactPanel();
  setPanelTab(tab);
  rememberPanelTool(tab);
  setPanelHome(false);
  updateWorkspace({ page: null });
  setHomeRequested(false);
  // Round 12 (SPEC 26.3): with Hver for seg the tool joins the panels that are open.
  if (stacking()) addToStack(tab);
  setPanelOpen(true);
  });
}

// The start preference applies on first opening. The explicit + chooser works with both values.
const panelHome = () => workspace().home;
const setPanelHome = (home: boolean) => updateWorkspace({ home });
const homeRequested = () => workspace().homeRequested;
const setHomeRequested = (value: boolean) => updateWorkspace({ homeRequested: value });
export { panelHome };
export const panelTabsOnTop = () => app.settings.panelStart === "tabs";
export const onPanelHome = () => {
  if (!panelHome()) return false;
  if (homeRequested()) return true;
  // A restored stack is already an open workspace. Only an explicit + choice should cover it
  // with the chooser; a fresh in-memory default must not hide persisted panels after reload.
  if (stacking() && stackTools().length) return false;
  return !panelTabsOnTop();
};
export const panelStartPages = () => workspace().pages;
export const activeStartPage = () => onPanelHome() ? workspace().page : null;
export function selectStartPage(id: string): void {
  if (!panelStartPages().includes(id)) return;
  updateWorkspace({ page: id, home: true, homeRequested: true });
  closeArtifactPanel();
  setPanelOpen(true);
}
export function closeStartPage(id: string): void {
  const next = panelStartPages().filter((page) => page !== id);
  const selected = activeStartPage() === id;
  updateWorkspace({ pages: next, ...(selected ? { page: next.at(-1) ?? null } : {}) });
  if (selected && !next.length) {
    const tool = (stacking() ? stackTools() : openedPanelTools()).at(-1);
    if (tool) showPanel(tool);
  }
}
// A tile navigates the selected start page into its destination. Merely switching to an already
// open resource tab keeps the start page available.
export function consumeStartPage(): void {
  const id = activeStartPage();
  if (id) updateWorkspace({ pages: panelStartPages().filter((page) => page !== id), page: null });
}
export function newPanelPage(): void {
  if (app.settings.panelNewTab === "browser") {
    requestBrowserTab(false);
    showPanel("browser");
    return;
  }
  showPanelHome(true);
}
export function showPanelHome(fresh = false): void {
  batch(() => {
  closeArtifactPanel();
  if (fresh) {
    const id = crypto.randomUUID();
    updateWorkspace({ pages: [...panelStartPages(), id], page: id });
  } else if (!workspace().page && panelStartPages().length) updateWorkspace({ page: panelStartPages().at(-1)! });
  setPanelHome(true);
  setHomeRequested(true);
  setPanelOpen(true);
  });
}

export function closePanelTool(tab: PanelTab): void {
  batch(() => {
  const before = openedPanelTools();
  const rest = before.filter((tool) => tool !== tab);
  setOpenedPanelTools(rest);
  if (stacking()) {
    removeFromStack(tab);
    const remaining = stackTools();
    if (!remaining.length) showPanelHome();
    else if (panelTab() === tab) setPanelTab(remaining.at(-1)!);
  } else if (panelTab() === tab) {
    const next = rest[Math.max(0, before.indexOf(tab) - 1)] ?? rest[0];
    if (next) setPanelTab(next);
    else showPanelHome();
  }
  });
}

// Round 11 (SPEC 24.5): Chat has no side panel; the Browser panel it had in round 9 is gone.

// Round 10 (SPEC 23.1): the panel in full view, over the whole width beside the sidebar. Not kept:
// it ends when the panel closes.
const [panelFull, setPanelFull] = createSignal(false);
export { panelFull, setPanelFull };

// A new tab asked for from outside the Browser panel (a shortcut, the palette), which the panel
// takes when it shows, also when it mounts because of the request.
const [browserTabRequest, setBrowserTabRequest] = createSignal<{ seq: number; full: boolean } | null>(null);
let tabRequests = 0;
export { browserTabRequest };
export function requestBrowserTab(full: boolean): void {
  setBrowserTabRequest({ seq: ++tabRequests, full });
  if (full) setPanelFull(true);
}
export function takeBrowserTabRequest(): void {
  setBrowserTabRequest(null);
}

const actions = {
  showTurn(turnId: string): void {
    setSelectedTurn(turnId);
    showPanel("changes");
  },
};

// Vis eller skjul panelet. With an artifact open in its place, the tool panel comes back.
export function togglePanel(): void {
  if (artifactPanel()) {
    closeArtifactPanel();
    setPanelOpen(true);
  } else setPanelOpen(!panelOpen());
}

export function peekPanelActions(): typeof actions {
  return actions;
}
