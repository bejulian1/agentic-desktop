// Round 11 (SPEC 24.2 and 24.3): the side panel's tools in one list, so the start page in the panel,
// the + menu at the top right, the separate buttons and the tabs show the same names, icons and keys.
import type { JSX } from "solid-js";
import { mode, panelOpen, setPanelOpen } from "../state/app";
import { closePanelTool, onPanelHome, panelTab, showPanel, type PanelTab } from "../state/panel";
import { inStack, stacking } from "../state/stack";
import { displayKeys, keysFor } from "../state/shortcuts";
import { IconPullRequest } from "./GitHubShared";
import { IconDiff, IconFile, IconGauge, IconGlobe, IconList, IconTerminal, IconUsers } from "./icons";

export interface PanelTool {
  id: PanelTab;
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  keys?: string; // a shortcut id
  tip: string;
  needsProject?: boolean;
  beta?: boolean;
}

// Round 12 (SPEC 26.2): Økt first, the thread in focus: environment, context, connections and what
// runs in the background. It needs a thread, not a project.
export const PANEL_TOOLS: PanelTool[] = [
  { id: "session", label: "Økt", icon: IconGauge, keys: "panel.session", tip: "Økt: miljø, kontekst, tilkoblinger og oppgaver i bakgrunnen" },
  { id: "overview", label: "Oversikt", icon: IconList, keys: "panel.overview", tip: "Oversikt: miljø, kontekst og filer tråden har endret" },
  { id: "files", label: "Filer", icon: IconFile, keys: "panel.files", tip: "Åpne filer i prosjektet eller på denne datamaskinen" },
  { id: "changes", label: "Endringer", icon: IconDiff, keys: "panel.changes", tip: "Endringer: diff per tur, med Angre og Gjennomgå" },
  { id: "terminal", label: "Terminal", icon: IconTerminal, keys: "panel.terminal", tip: "Terminal i prosjektmappen, eller i hjemmemappen uten prosjekt" },
  { id: "browser", label: "Nettleser", icon: IconGlobe, keys: "panel.browser", tip: "Nettleser: siden agenten og Playtest bruker" },
  { id: "team", label: "Team", icon: IconUsers, keys: "panel.team", tip: "Team: den delte oppgavelisten" },
  { id: "github", label: "GitHub", icon: IconPullRequest, tip: "GitHub (Beta): pull requests og issues for prosjektets repo", beta: true },
];

export const toolById = (id: PanelTab) => PANEL_TOOLS.find((t) => t.id === id)!;

// The tip on a tool that needs a project while none is chosen.
export const NEEDS_PROJECT_TIP = "Verktøyene finnes i Kode-modus.";

export const toolBlocked = (tool: PanelTool) => mode() !== "code";

export const toolKeys = (tool: PanelTool) => (tool.keys && keysFor(tool.keys) ? displayKeys(keysFor(tool.keys)) : "");

// "Filer (Ctrl+Alt+1)": the app's tooltip shows the part in brackets as keys.
export const toolTitle = (tool: PanelTool, name = tool.label) => (toolKeys(tool) ? `${name} (${toolKeys(tool)})` : name);

// The tool on screen in the panel right now, if any. With panels stacked (SPEC 26.3), several are.
export const shownTool = (): PanelTab | null => (panelOpen() && !onPanelHome() ? panelTab() : null);
export const toolOpen = (id: PanelTab): boolean => (stacking() ? panelOpen() && inStack(id) : shownTool() === id);

// A separate button: on shows the tool, off closes it. Stacked, it closes only that panel.
export function toggleTool(id: PanelTab): void {
  if (stacking()) {
    if (toolOpen(id)) closePanelTool(id);
    else showPanel(id);
    return;
  }
  if (shownTool() === id) setPanelOpen(false);
  else showPanel(id);
}
