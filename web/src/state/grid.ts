// The pane grid of one scope (a project, or "chat"). The tree is plain JSON so it can be stored
// on the server. Panes render flat and absolutely positioned from it: moving or splitting a pane
// changes its rectangle, never its place in the DOM, so scroll position and drafts survive.
import { t } from "../lib/i18n";
import { createMemo, createRoot, createSignal, type Accessor, type Setter } from "solid-js";
import { ApiError, get, put } from "../lib/api";
import { on, onOpen } from "../lib/socket";
import { app, report, scopeOf, toast } from "./app";

export const MAX_PANES = 6;

// This window, in what it saves. The server sends a saved layout to every window, also back to
// this one; that echo is old news here and is skipped.
export const CLIENT_ID = crypto.randomUUID();

export interface PaneNode {
  t: "pane";
  id: string;
  threadId: string | null;
}

export interface SplitNode {
  t: "split";
  dir: "row" | "col";
  sizes: number[];
  kids: GridNode[];
}

export type GridNode = PaneNode | SplitNode;
export type Side = "left" | "right" | "top" | "bottom";

export interface Detached {
  id: string;
  threadId: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Handle {
  key: string;
  dir: "row" | "col";
  path: number[];
  index: number;
  at: number; // Percent along the split direction, of the whole grid.
  from: number; // Percent across.
  length: number;
  span: Rect; // The split's own rectangle, to turn mouse movement into sizes.
  before: number; // Percent of the grid the kid before the handle takes along the split.
  after: number; // And the kid after it.
}

export interface PaneState {
  id: string;
  threadId: Accessor<string | null>;
  setThreadId: Setter<string | null>;
}

export function newPane(threadId: string | null = null): PaneNode {
  return { t: "pane", id: crypto.randomUUID(), threadId };
}

export function collect(node: GridNode, out: PaneNode[] = []): PaneNode[] {
  if (node.t === "pane") out.push(node);
  else for (const kid of node.kids) collect(kid, out);
  return out;
}

export function remove(node: GridNode, id: string): GridNode | null {
  if (node.t === "pane") return node.id === id ? null : node;
  const kids: GridNode[] = [];
  const sizes: number[] = [];
  node.kids.forEach((kid, i) => {
    const next = remove(kid, id);
    if (next) {
      kids.push(next);
      sizes.push(node.sizes[i]);
    }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  return { ...node, kids, sizes };
}

function mapPane(node: GridNode, id: string, fn: (pane: PaneNode) => GridNode): GridNode {
  if (node.t === "pane") return node.id === id ? fn(node) : node;
  return { ...node, kids: node.kids.map((kid) => mapPane(kid, id, fn)) };
}

// A pane added to a split that runs the same way gets an equal share, taken evenly from the others,
// so six side by side are six equal columns and not halves of halves.
function addToSplit(node: SplitNode, at: number, added: GridNode): SplitNode {
  const n = node.kids.length;
  const total = node.sizes.reduce((a, b) => a + b, 0);
  const kids = [...node.kids];
  const sizes = node.sizes.map((size) => (size * n) / (n + 1));
  kids.splice(at, 0, added);
  sizes.splice(at, 0, total / (n + 1));
  return { ...node, kids, sizes };
}

export function insertBeside(node: GridNode, targetId: string, added: PaneNode, side: Side): GridNode {
  const dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "top";
  if (node.t === "pane") {
    if (node.id !== targetId) return node;
    return { t: "split", dir, sizes: [1, 1], kids: before ? [added, node] : [node, added] };
  }
  const direct = node.kids.findIndex((kid) => kid.t === "pane" && kid.id === targetId);
  if (direct !== -1 && node.dir === dir) return addToSplit(node, before ? direct : direct + 1, added);
  return { ...node, kids: node.kids.map((kid) => insertBeside(kid, targetId, added, side)) };
}

// Along a whole edge of the grid, the way a third app slides in on an iPad.
export function insertAtEdge(root: GridNode, added: PaneNode, side: Side): GridNode {
  const dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "top";
  if (root.t === "split" && root.dir === dir) return addToSplit(root, before ? 0 : root.kids.length, added);
  const sizes = root.t === "pane" ? [1, 1] : before ? [1, 2] : [2, 1];
  return { t: "split", dir, sizes, kids: before ? [added, root] : [root, added] };
}

export function layoutNode(node: GridNode, rect: Rect, path: number[], rects: Map<string, Rect>, handles: Handle[]): void {
  if (node.t === "pane") {
    rects.set(node.id, rect);
    return;
  }
  const total = node.sizes.reduce((a, b) => a + b, 0);
  let offset = 0;
  node.kids.forEach((kid, i) => {
    const share = node.sizes[i] / total;
    const kidRect: Rect = node.dir === "row"
      ? { x: rect.x + offset * rect.w, y: rect.y, w: share * rect.w, h: rect.h }
      : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: share * rect.h };
    layoutNode(kid, kidRect, [...path, i], rects, handles);
    offset += share;
    if (i < node.kids.length - 1) {
      handles.push({
        key: `${path.join(".")}:${i}`,
        dir: node.dir,
        path,
        index: i,
        at: node.dir === "row" ? rect.x + offset * rect.w : rect.y + offset * rect.h,
        from: node.dir === "row" ? rect.y : rect.x,
        length: node.dir === "row" ? rect.h : rect.w,
        span: rect,
        before: node.dir === "row" ? kidRect.w : kidRect.h,
        after: (node.sizes[i + 1] / total) * (node.dir === "row" ? rect.w : rect.h),
      });
    }
  });
}

function setSizes(node: GridNode, path: number[], sizes: number[]): GridNode {
  if (node.t !== "split") return node;
  if (!path.length) return { ...node, sizes };
  const [head, ...rest] = path;
  return { ...node, kids: node.kids.map((kid, i) => (i === head ? setSizes(kid, rest, sizes) : kid)) };
}

function nodeAt(node: GridNode, path: number[]): GridNode | undefined {
  return path.reduce<GridNode | undefined>((current, i) => (current?.t === "split" ? current.kids[i] : undefined), node);
}

interface Saved {
  root: GridNode;
  detached?: Detached[];
}

// Startup is local to this window: do not overwrite another window's saved grid merely by opening
// the app. Explicit thread links and reload still restore their requested layout.
let freshStartupScope: string | null = null;
export function prepareFreshGrid(scope: string): void { freshStartupScope = scope; }

function validNode(node: any): node is GridNode {
  if (node?.t === "pane") return typeof node.id === "string";
  return node?.t === "split" && Array.isArray(node.kids) && node.kids.length > 0 && node.kids.every(validNode);
}

export class Grid {
  readonly scope: string;
  readonly root: Accessor<GridNode>;
  private setRoot: Setter<GridNode>;
  readonly focused: Accessor<string>;
  private setFocused: Setter<string>;
  readonly detached: Accessor<Detached[]>;
  private setDetached: Setter<Detached[]>;
  panes!: Accessor<PaneState[]>;
  geometry!: Accessor<{ rects: Map<string, Rect>; handles: Handle[] }>;
  focusedThreadId!: Accessor<string | null>;
  private states = new Map<string, PaneState>();
  private lastJson = "";
  private saveTimer?: ReturnType<typeof setTimeout>;
  private retryArmed = false;
  private pending = false; // a change waits for scheduleSave's timer
  private loadGeneration = 0;
  loaded: Promise<void>;

  constructor(scope: string) {
    this.scope = scope;
    const first = newPane();
    [this.root, this.setRoot] = createSignal<GridNode>(first);
    [this.focused, this.setFocused] = createSignal(first.id);
    [this.detached, this.setDetached] = createSignal<Detached[]>([]);
    createRoot(() => {
      this.panes = createMemo(() => collect(this.root()).map((node) => this.stateFor(node)));
      this.geometry = createMemo(() => {
        const rects = new Map<string, Rect>();
        const handles: Handle[] = [];
        layoutNode(this.root(), { x: 0, y: 0, w: 100, h: 100 }, [], rects, handles);
        return { rects, handles };
      });
      this.focusedThreadId = createMemo(() => {
        const id = this.focused();
        return this.panes().find((p) => p.id === id)?.threadId() ?? null;
      });
    });
    this.loaded = this.load();
  }

  private stateFor(node: PaneNode): PaneState {
    let state = this.states.get(node.id);
    if (!state) {
      const [threadId, setThreadId] = createSignal(node.threadId);
      state = { id: node.id, threadId, setThreadId };
      this.states.set(node.id, state);
    } else if (state.threadId() !== node.threadId) {
      state.setThreadId(node.threadId);
    }
    return state;
  }

  private async load(): Promise<void> {
    if (freshStartupScope === this.scope) { freshStartupScope = null; return; }
    const generation = this.loadGeneration;
    try {
      const { layout } = await get<{ layout: Saved | null }>(`/api/projects/${this.scope}/layout`);
      if (generation !== this.loadGeneration) return;
      if (layout && validNode(layout.root)) this.applySaved(layout);
      else this.openLatest();
    } catch (err) {
      report(err);
    }
  }

  freshView(): void {
    this.loadGeneration++;
    clearTimeout(this.saveTimer);
    this.pending = false;
    const pane = newPane();
    this.states.clear();
    this.setRoot(pane);
    this.setFocused(pane.id);
    this.setDetached([]);
    this.lastJson = "";
  }

  // A project without a stored layout opens on its most recent thread.
  private openLatest(): void {
    const latest = Object.values(app.threads)
      .filter((t) => scopeOf(t) === this.scope && !t.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const [pane] = collect(this.root());
    if (latest && pane && !pane.threadId) this.setThread(pane.id, latest.id);
  }

  applySaved(saved: Saved): void {
    const json = JSON.stringify({ root: saved.root, detached: saved.detached ?? [] });
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.setRoot(saved.root);
    this.setDetached(saved.detached ?? []);
    const ids = collect(saved.root).map((p) => p.id);
    if (!ids.includes(this.focused())) this.setFocused(ids[0]);
  }

  private commit(root: GridNode): void {
    this.setRoot(root);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.pending = true;
    this.saveTimer = setTimeout(() => {
      this.pending = false;
      const layout = { root: this.root(), detached: this.detached() };
      const json = JSON.stringify(layout);
      if (json === this.lastJson) return;
      this.lastJson = json;
      void put(`/api/projects/${this.scope}/layout`, { layout, clientId: CLIENT_ID }).catch((err) => this.saveFailed(err));
    }, 200);
  }

  // A layout saved by another window. While a change of this window waits to be saved, this
  // window's is newer and wins: it is saved in a moment and goes out to the others.
  applyRemote(saved: Saved): void {
    if (this.pending) return;
    this.applySaved(saved);
  }

  // Without contact the offline banner already says so; the layout is stored when the server is back.
  private saveFailed(err: unknown): void {
    if (!(err instanceof ApiError) || err.status !== 0) return report(err);
    this.lastJson = "";
    if (this.retryArmed) return;
    this.retryArmed = true;
    let now = true; // onOpen calls at once while the old socket has not noticed yet.
    const stop = onOpen(() => {
      if (now) return;
      stop();
      this.retryArmed = false;
      this.scheduleSave();
    });
    now = false;
  }

  count(): number {
    return collect(this.root()).length;
  }

  focus(paneId: string): void {
    if (this.focused() !== paneId) this.setFocused(paneId);
  }

  paneWith(threadId: string): PaneNode | undefined {
    return collect(this.root()).find((p) => p.threadId === threadId);
  }

  setThread(paneId: string, threadId: string | null): void {
    this.commit(mapPane(this.root(), paneId, (pane) => ({ ...pane, threadId })));
  }

  // Shows a thread: where it already is, or else in the focused pane.
  open(threadId: string): void {
    const existing = this.paneWith(threadId);
    if (existing) return this.focus(existing.id);
    this.setThread(this.focused(), threadId);
  }

  split(paneId: string, side: Side, threadId: string | null = null, takeFocus = true): string | null {
    if (this.count() >= MAX_PANES) {
      toast(t("Det er plass til {count} ruter i et vindu.", { count: MAX_PANES }), "info");
      return null;
    }
    const added = newPane(threadId);
    // Focus first, so the new pane mounts knowing whether it should take the keyboard.
    if (takeFocus) this.setFocused(added.id);
    this.commit(insertBeside(this.root(), paneId, added, side));
    return added.id;
  }

  // New pane to the right of the focused one, or under it if that pane is the narrower way.
  addPane(threadId: string | null = null, takeFocus = true): string | null {
    const rect = this.geometry().rects.get(this.focused());
    return this.split(this.focused(), rect && rect.w < 34 ? "bottom" : "right", threadId, takeFocus);
  }

  close(paneId: string): void {
    const next = remove(this.root(), paneId);
    this.states.delete(paneId);
    if (!next) {
      const empty = newPane();
      this.commit(empty);
      this.setFocused(empty.id);
      return;
    }
    this.commit(next);
    if (this.focused() === paneId) this.setFocused(collect(next)[0].id);
  }

  swap(aId: string, bId: string): void {
    const nodes = collect(this.root());
    const a = nodes.find((p) => p.id === aId);
    const b = nodes.find((p) => p.id === bId);
    if (!a || !b) return;
    let root = this.root();
    root = mapPane(root, aId, () => ({ ...b, id: `${b.id}#swap` }));
    root = mapPane(root, bId, () => a);
    root = mapPane(root, `${b.id}#swap`, (pane) => ({ ...pane, id: b.id }));
    this.commit(root);
  }

  // A new pane along a whole edge of the grid.
  splitEdge(side: Side, threadId: string | null = null): string | null {
    if (this.count() >= MAX_PANES) {
      toast(t("Det er plass til {count} ruter i et vindu.", { count: MAX_PANES }), "info");
      return null;
    }
    const added = newPane(threadId);
    this.setFocused(added.id);
    this.commit(insertAtEdge(this.root(), added, side));
    return added.id;
  }

  moveToEdge(paneId: string, side: Side): void {
    const node = collect(this.root()).find((p) => p.id === paneId);
    const without = node && remove(this.root(), paneId);
    if (!node || !without) return;
    this.commit(insertAtEdge(without, node, side));
  }

  move(paneId: string, targetId: string, side: Side): void {
    const node = collect(this.root()).find((p) => p.id === paneId);
    if (!node || paneId === targetId) return;
    const without = remove(this.root(), paneId);
    if (!without) return;
    this.commit(insertBeside(without, targetId, node, side));
  }

  // The share of the kid before a handle, of the two on either side of it.
  pairShare(handle: Handle): number {
    const split = nodeAt(this.root(), handle.path);
    if (split?.t !== "split" || !split.sizes[handle.index + 1]) return 0.5;
    return split.sizes[handle.index] / (split.sizes[handle.index] + split.sizes[handle.index + 1]);
  }

  // Sets the two kids on either side of a handle, the rest of the split keeps its size. Live while
  // dragging; the layout is stored on release, or at once with save.
  setPairShare(handle: Handle, share: number, save = false): void {
    const split = nodeAt(this.root(), handle.path);
    if (split?.t !== "split" || split.kids.length < handle.index + 2) return;
    const sizes = [...split.sizes];
    const pair = sizes[handle.index] + sizes[handle.index + 1];
    sizes[handle.index] = pair * share;
    sizes[handle.index + 1] = pair * (1 - share);
    this.setRoot(setSizes(this.root(), handle.path, sizes));
    if (save) this.scheduleSave();
  }

  resizeDone(): void {
    this.scheduleSave();
  }

  detach(paneId: string): Detached | null {
    const pane = collect(this.root()).find((p) => p.id === paneId);
    if (!pane?.threadId) return null;
    const entry = { id: pane.id, threadId: pane.threadId };
    this.setDetached([...this.detached().filter((d) => d.threadId !== entry.threadId), entry]);
    this.close(paneId);
    this.scheduleSave();
    return entry;
  }

  reattach(id: string): boolean {
    const entry = this.detached().find((d) => d.id === id);
    if (!entry) return false;
    if (!this.paneWith(entry.threadId)) {
      const focused = collect(this.root()).find((p) => p.id === this.focused());
      if (focused && !focused.threadId) this.setThread(focused.id, entry.threadId);
      else if (this.split(this.focused(), "right", entry.threadId) === null) return false;
    }
    this.setDetached(this.detached().filter((d) => d.id !== id));
    this.scheduleSave();
    return true;
  }

  // A thread that no longer exists leaves an empty pane behind.
  clearThread(threadId: string): void {
    const pane = this.paneWith(threadId);
    if (pane) this.setThread(pane.id, null);
    if (this.detached().some((d) => d.threadId === threadId)) {
      this.setDetached(this.detached().filter((d) => d.threadId !== threadId));
      this.scheduleSave();
    }
  }
}

const grids = new Map<string, Grid>();

export function gridFor(scope: string): Grid {
  let grid = grids.get(scope);
  if (!grid) grids.set(scope, (grid = new Grid(scope)));
  return grid;
}

export function peekGrid(scope: string): Grid | undefined {
  return grids.get(scope);
}

export function wireGridEvents(): void {
  // Threads an agent makes open beside the thread that made them, in the window showing it.
  const known = new Set(Object.keys(app.threads));
  on("thread.changed", ({ thread }) => {
    if (known.has(thread.id)) return;
    known.add(thread.id);
    if (thread.origin !== "agent" || !thread.parentThreadId || !app.settings.autoOpenAgentThreads) return;
    const grid = grids.get(scopeOf(thread));
    if (!grid?.paneWith(thread.parentThreadId) || grid.count() >= MAX_PANES) return;
    grid.addPane(thread.id, false); // Whoever is typing keeps the keyboard.
  });
  on("project.layout", ({ projectId, layout, clientId }) => {
    if (clientId === CLIENT_ID) return;
    const saved = layout as Saved | null;
    if (saved && validNode(saved.root)) grids.get(projectId)?.applyRemote(saved);
  });
  on("thread.deleted", ({ threadId }) => {
    for (const grid of grids.values()) grid.clearThread(threadId);
  });
}
