// What the right panel shows, so rows and commands can point at it.
import { createSignal } from "solid-js";
import { app, panelOpen, setPanelOpen } from "./app";
import { addToStack, stacking } from "./stack";
import { artifactPanel, closeArtifactPanel } from "./artifact-panel";

// Round 12 (SPEC 26.2): "session" is Økt.
export type PanelTab = "files" | "changes" | "terminal" | "browser" | "team" | "overview" | "github" | "session";

// Oversikt first: environment, context and what the thread changed, never an empty file tree.
const [panelTab, setPanelTab] = createSignal<PanelTab>("overview");
const [selectedTurn, setSelectedTurn] = createSignal<string | null>(null);
export { panelTab, selectedTurn, setSelectedTurn };

export function showPanel(tab: PanelTab): void {
  // Round 15: an open artifact has the right side; a tool asked for takes it back.
  closeArtifactPanel();
  setPanelTab(tab);
  setPanelHome(false);
  // Round 12 (SPEC 26.3): with Hver for seg the tool joins the panels that are open.
  if (stacking()) addToStack(tab);
  setPanelOpen(true);
}

// Round 11 (SPEC 24.3): the side panel opens on a start page with the tools, until one is chosen;
// the tool's name with ⌄ at the top leads back. With «Faner øverst» in Innstillinger → Utseende it is
// the row of tabs as before, and there is no start page. Where it was is not kept between visits.
const [panelHome, setPanelHome] = createSignal(true);
export { panelHome };
export const panelTabsOnTop = () => app.settings.panelStart === "tabs";
export const onPanelHome = () => !panelTabsOnTop() && panelHome();
export function showPanelHome(): void {
  closeArtifactPanel();
  setPanelHome(true);
  setPanelOpen(true);
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
