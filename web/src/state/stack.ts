// Round 12 (SPEC 26.3): panels that stack, with «Hver for seg» chosen for the panel buttons. Several
// panels are open at once, in columns side by side, and over and under each other in a column, the
// way the reference shows Økt beside Terminal over Nettleser.
//
// The layout is per project (Denne datamaskinen has its own) and kept in localStorage: which tools
// stand where, and how big each column and panel is, as weights. With «Samlet», or below 860 px,
// none of this is used and the panel shows one tool as before; the layout is kept for later.
import { createSignal } from "solid-js";
import type { PanelTab } from "./panel";
import { app, currentProject, LOCAL_SCOPE, mode, panelWidth, setPanelOpen, setPanelWidth } from "./app";

export interface StackPanel {
  tool: PanelTab;
  size: number; // weight in its column
}
export interface StackColumn {
  size: number; // weight in the row of columns
  panels: StackPanel[];
}
export interface StackLayout {
  columns: StackColumn[];
  maximized: PanelTab | null;
}
export type Edge = "left" | "right" | "top" | "bottom";
export type Placement = "right" | "below";

const narrowQuery = matchMedia("(max-width: 860px)");
const [narrow, setNarrow] = createSignal(narrowQuery.matches);
narrowQuery.addEventListener("change", () => setNarrow(narrowQuery.matches));

// Stacking is on with Hver for seg, in Kode, in a window wide enough for it.
export const stacking = () => app.settings.panelButtons === "separate" && !narrow() && mode() === "code";

const KEY = "ad-panel-stack:";
const EMPTY: StackLayout = { columns: [], maximized: null };
const KNOWN = new Set<PanelTab>(["session", "overview", "files", "changes", "terminal", "browser", "team", "github"]);
const COLUMN_PX = 340; // what a new column adds to the panel's width, as far as the window allows

const scopeKey = () => currentProject()?.id ?? LOCAL_SCOPE;

function read(scope: string): StackLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY + scope) ?? "null");
    if (!raw || !Array.isArray(raw.columns)) return EMPTY;
    const seen = new Set<PanelTab>();
    const columns: StackColumn[] = [];
    for (const c of raw.columns) {
      const panels = (Array.isArray(c?.panels) ? c.panels : [])
        .filter((p: any) => KNOWN.has(p?.tool) && !seen.has(p.tool) && seen.add(p.tool))
        .map((p: any) => ({ tool: p.tool as PanelTab, size: weight(p.size) }));
      if (panels.length) columns.push({ size: weight(c.size), panels });
    }
    return { columns, maximized: seen.has(raw.maximized) ? raw.maximized : null };
  } catch {
    return EMPTY;
  }
}

const weight = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0.01 ? Math.min(value, 100) : 1);

const [layouts, setLayouts] = createSignal<Record<string, StackLayout>>({});

export function stackLayout(scope = scopeKey()): StackLayout {
  return layouts()[scope] ?? read(scope);
}

function save(next: StackLayout, scope = scopeKey()): void {
  setLayouts({ ...layouts(), [scope]: next });
  try {
    localStorage.setItem(KEY + scope, JSON.stringify(next));
  } catch {
    // Not kept this time; the layout still holds until the page reloads.
  }
}

const clone = (l: StackLayout): StackLayout => ({ maximized: l.maximized, columns: l.columns.map((c) => ({ size: c.size, panels: c.panels.map((p) => ({ ...p })) })) });
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 1);

export const stackTools = () => stackLayout().columns.flatMap((c) => c.panels.map((p) => p.tool));
export const inStack = (tool: PanelTab) => stackTools().includes(tool);

// Where a panel goes when it is added from the + menu or a button: under the panel used last, or in
// a new column to its right. Chosen in + → Plassering.
const [placement, setPlacement] = createSignal<Placement>("below");
export { placement, setPlacement };

// The panel used last: a new one goes beside or under it.
const [focusedTool, setFocusedTool] = createSignal<PanelTab | null>(null);
export { focusedTool, setFocusedTool };

function locate(layout: StackLayout, tool: PanelTab): { col: number; row: number } | null {
  for (let col = 0; col < layout.columns.length; col++) {
    const row = layout.columns[col].panels.findIndex((p) => p.tool === tool);
    if (row >= 0) return { col, row };
  }
  return null;
}

// The widest the panel may get beside the conversation, and a new column's share of it.
export const maxPanelWidth = () => Math.max(320, innerWidth - 420);
function growFor(columnsBefore: number): void {
  if (columnsBefore < 1) return;
  setPanelWidth(Math.min(maxPanelWidth(), panelWidth() + COLUMN_PX));
}
function shrinkBy(fraction: number): void {
  setPanelWidth(Math.max(320, Math.round(panelWidth() * (1 - fraction))));
}

// Puts a tool next to another one, or at the end when there is none to go by.
function insert(layout: StackLayout, tool: PanelTab, target: PanelTab | null, edge: Edge): StackLayout {
  const next = clone(layout);
  const at = target ? locate(next, target) : null;
  if (!next.columns.length) {
    next.columns.push({ size: 1, panels: [{ tool, size: 1 }] });
    return next;
  }
  if (!at) {
    if (edge === "right" || edge === "left") {
      const column = { size: average(next.columns.map((c) => c.size)), panels: [{ tool, size: 1 }] };
      if (edge === "right") next.columns.push(column);
      else next.columns.unshift(column);
    } else {
      const column = next.columns.at(-1)!;
      column.panels.push({ tool, size: average(column.panels.map((p) => p.size)) });
    }
    return next;
  }
  if (edge === "left" || edge === "right") {
    const column = { size: next.columns[at.col].size, panels: [{ tool, size: 1 }] };
    next.columns.splice(edge === "right" ? at.col + 1 : at.col, 0, column);
  } else {
    const column = next.columns[at.col];
    // Half of the panel it goes by, so the rest of the column keeps its sizes.
    const half = column.panels[at.row].size / 2;
    column.panels[at.row].size = half;
    column.panels.splice(edge === "bottom" ? at.row + 1 : at.row, 0, { tool, size: half });
  }
  return next;
}

function without(layout: StackLayout, tool: PanelTab): { layout: StackLayout; columnGone: number | null } {
  const next = clone(layout);
  const at = locate(next, tool);
  if (!at) return { layout: next, columnGone: null };
  const column = next.columns[at.col];
  const [gone] = column.panels.splice(at.row, 1);
  // The neighbour takes the room, so the others keep their sizes.
  const heir = column.panels[at.row - 1] ?? column.panels[at.row];
  if (heir) heir.size += gone.size;
  let columnGone: number | null = null;
  if (!column.panels.length) {
    const total = next.columns.reduce((a, c) => a + c.size, 0);
    columnGone = next.columns.length > 1 ? column.size / total : null;
    next.columns.splice(at.col, 1);
  }
  if (next.maximized === tool) next.maximized = null;
  return { layout: next, columnGone };
}

// Opens a tool in the stack, where Plassering says, or shows it if it is there already.
export function addToStack(tool: PanelTab, where?: { target: PanelTab | null; edge: Edge }): void {
  const layout = stackLayout();
  if (locate(layout, tool)) {
    if (layout.maximized && layout.maximized !== tool) save({ ...clone(layout), maximized: null });
    setFocusedTool(tool);
    return;
  }
  const target = where?.target ?? (focusedTool() && locate(layout, focusedTool()!) ? focusedTool() : (layout.columns.at(-1)?.panels.at(-1)?.tool ?? null));
  const edge = where?.edge ?? (placement() === "right" ? "right" : "bottom");
  const before = layout.columns.length;
  const next = insert({ ...layout, maximized: null }, tool, target, edge);
  save(next);
  if (next.columns.length > before) growFor(before);
  setFocusedTool(tool);
}

// Closes one panel. The last one closes the side panel, and the layout is empty until next time.
export function removeFromStack(tool: PanelTab): void {
  const { layout, columnGone } = without(stackLayout(), tool);
  save(layout);
  if (columnGone) shrinkBy(columnGone);
  if (focusedTool() === tool) setFocusedTool(layout.columns.at(-1)?.panels.at(-1)?.tool ?? null);
  if (!layout.columns.length) setPanelOpen(false);
}

// Dragged to another place: beside or under (or over) another panel.
export function moveInStack(tool: PanelTab, target: PanelTab, edge: Edge): void {
  if (tool === target) return;
  const start = stackLayout();
  const { layout } = without(start, tool);
  const next = insert(layout, tool, target, edge);
  save(next);
  // Width follows the number of columns, as when a panel is opened or closed.
  if (next.columns.length > start.columns.length) growFor(start.columns.length);
  else if (next.columns.length < start.columns.length) shrinkBy(1 / start.columns.length);
  setFocusedTool(tool);
}

export function toggleMaximized(tool: PanelTab): void {
  const layout = stackLayout();
  save({ ...clone(layout), maximized: layout.maximized === tool ? null : tool });
}

// Sizes from a drag on a divider: the weights of the two on either side.
export function setColumnSizes(index: number, a: number, b: number): void {
  const next = clone(stackLayout());
  if (!next.columns[index] || !next.columns[index + 1]) return;
  next.columns[index].size = a;
  next.columns[index + 1].size = b;
  save(next);
}

export function setPanelSizes(column: number, index: number, a: number, b: number): void {
  const next = clone(stackLayout());
  const panels = next.columns[column]?.panels;
  if (!panels?.[index] || !panels[index + 1]) return;
  panels[index].size = a;
  panels[index + 1].size = b;
  save(next);
}

// A double click on a divider: the two on either side share the room equally.
export function equalizeColumns(index: number): void {
  const l = stackLayout().columns;
  if (l[index] && l[index + 1]) {
    const half = (l[index].size + l[index + 1].size) / 2;
    setColumnSizes(index, half, half);
  }
}
export function equalizePanels(column: number, index: number): void {
  const panels = stackLayout().columns[column]?.panels;
  if (panels?.[index] && panels[index + 1]) {
    const half = (panels[index].size + panels[index + 1].size) / 2;
    setPanelSizes(column, index, half, half);
  }
}

// For the tests and for a fresh start: the layout of the current project.
export function clearStack(): void {
  save(EMPTY);
}
