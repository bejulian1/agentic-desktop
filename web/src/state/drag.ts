// Dragging threads and panes. Pointer events, because a captured pointer keeps reporting after it
// leaves the window, which is how a pane is dropped outside to detach it. Rectangles are read once
// at the start and nothing else reads layout during the drag, and the ghost only moves by transform.
// The drop target only changes when the pointer crosses into another zone, so the preview, which
// shows where the pane will land, is worked out a few times per drag and not per pointermove.
import { t } from "../lib/i18n";
import { createSignal } from "solid-js";
import { onNextFrame } from "../lib/frame";
import { app, scopeOf } from "./app";
import { collect, insertAtEdge, insertBeside, layoutNode, MAX_PANES, newPane, remove, type Grid, type GridNode, type Handle, type Rect, type Side } from "./grid";

export type DragSource =
  | { kind: "thread"; threadId: string; label: string }
  | { kind: "pane"; paneId: string; label: string };

export type Zone = "center" | Side;

export interface DropTarget {
  paneId: string; // Empty along a whole edge of the grid.
  zone: Zone;
  edge: boolean;
}

const THRESHOLD = 5;

const [dragging, setDragging] = createSignal<DragSource | null>(null);
const [dropTarget, setDropTarget] = createSignal<DropTarget | null>(null);
// Round 11 (SPEC 24.6): a thread dragged onto a section in the sidebar ([data-drop-section]).
const [sectionTarget, setSectionTarget] = createSignal<string | null>(null);
export { dragging, dropTarget, sectionTarget };

interface PaneBox {
  id: string;
  rect: DOMRect;
}

// The outermost strip of the grid puts a pane along the whole edge.
const EDGE_PX = 28;

function zoneIn(box: PaneBox, x: number, y: number): DropTarget {
  const { rect, id } = box;
  const rx = (x - rect.left) / rect.width;
  const ry = (y - rect.top) / rect.height;
  const edge = Math.min(rx, 1 - rx, ry, 1 - ry);
  let zone: Zone = "center";
  if (edge < 0.25) {
    if (edge === rx) zone = "left";
    else if (edge === 1 - rx) zone = "right";
    else if (edge === ry) zone = "top";
    else zone = "bottom";
  }
  return { paneId: id, zone, edge: false };
}

function edgeIn(surface: DOMRect, x: number, y: number): DropTarget | null {
  if (x < surface.left || x >= surface.right || y < surface.top || y >= surface.bottom) return null;
  const band = (extent: number) => Math.min(EDGE_PX, extent * 0.08);
  const distances: [Side, number, number][] = [
    ["left", x - surface.left, band(surface.width)],
    ["right", surface.right - x, band(surface.width)],
    ["top", y - surface.top, band(surface.height)],
    ["bottom", surface.bottom - y, band(surface.height)],
  ];
  const near = distances.filter(([, d, b]) => d < b).sort((a, b) => a[1] - b[1])[0];
  return near ? { paneId: "", zone: near[0], edge: true } : null;
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null) =>
  a === b || (!!a && !!b && a.paneId === b.paneId && a.zone === b.zone && a.edge === b.edge);

export interface DragOptions {
  source: DragSource;
  onClick?: () => void;
  onDetach?: (paneId: string) => void;
  onDrop: (source: DragSource, target: DropTarget) => void;
  onSection?: (sectionId: string) => void; // threads only: dropped on a section in the sidebar
}

export function beginDrag(event: PointerEvent, options: DragOptions): void {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  let active = false;
  let boxes: PaneBox[] = [];
  let sections: PaneBox[] = [];
  let surface: DOMRect | null = null;
  let ghost: HTMLElement | null = null;
  let ghostW = 0; // measured once when it appears, so it can be kept 8 px inside the window
  let ghostH = 0;
  let lastX = startX;
  let lastY = startY;

  const update = () => {
    if (!active) return;
    if (ghost) {
      const x = Math.max(8, Math.min(lastX + 12, innerWidth - ghostW - 8));
      const y = Math.max(8, Math.min(lastY + 12, innerHeight - ghostH - 8));
      ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    const section = sections.find((b) => lastX >= b.rect.left && lastX < b.rect.right && lastY >= b.rect.top && lastY < b.rect.bottom);
    if (section?.id !== sectionTarget()) setSectionTarget(section?.id ?? null);
    if (section) {
      if (dropTarget()) setDropTarget(null);
      return;
    }
    const box = boxes.find((b) => lastX >= b.rect.left && lastX < b.rect.right && lastY >= b.rect.top && lastY < b.rect.bottom);
    const edge = surface && edgeIn(surface, lastX, lastY);
    const inside = !!surface && lastX >= surface.left && lastX < surface.right && lastY >= surface.top && lastY < surface.bottom;
    // The thin gaps between panes keep the last target, so the preview does not blink on the way.
    if (!edge && !box && inside && dropTarget()) return;
    const own = box && options.source.kind === "pane" && box.id === options.source.paneId;
    const next = edge ?? (box && !own ? zoneIn(box, lastX, lastY) : null);
    if (!sameTarget(next, dropTarget())) setDropTarget(next);
  };

  const move = (e: PointerEvent) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (!active) {
      if (Math.hypot(lastX - startX, lastY - startY) < THRESHOLD) return;
      active = true;
      boxes = [...document.querySelectorAll<HTMLElement>("[data-pane-id]")]
        .map((el) => ({ id: el.dataset.paneId!, rect: el.getBoundingClientRect() }));
      if (options.onSection) {
        sections = [...document.querySelectorAll<HTMLElement>("[data-drop-section]")]
          .map((el) => ({ id: el.dataset.dropSection!, rect: el.getBoundingClientRect() }))
          .filter((b) => b.rect.height > 0);
      }
      surface = [...document.querySelectorAll<HTMLElement>(".grid-surface")].map((el) => el.getBoundingClientRect()).find((r) => r.width > 0) ?? null;
      setDragging(options.source);
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = options.source.label;
      document.body.appendChild(ghost);
      ghostW = ghost.offsetWidth;
      ghostH = ghost.offsetHeight;
    }
    onNextFrame(update);
  };

  const finish = (e: PointerEvent) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", cancel);
    if (!active) {
      if (e.type === "pointerup") options.onClick?.();
      return;
    }
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    ghost?.remove();
    const x = e.clientX;
    const y = e.clientY;
    const outside = x < 0 || y < 0 || x >= innerWidth || y >= innerHeight;
    lastX = x;
    lastY = y;
    update();
    const target = dropTarget();
    const section = sectionTarget();
    const source = options.source;
    active = false;
    setDragging(null);
    setDropTarget(null);
    setSectionTarget(null);
    if (outside && source.kind === "pane") options.onDetach?.(source.paneId);
    else if (section) options.onSection?.(section);
    else if (target) options.onDrop(source, target);
  };

  const cancel = (e: PointerEvent) => {
    active = false;
    ghost?.remove();
    setDragging(null);
    setDropTarget(null);
    setSectionTarget(null);
    finish(e);
  };

  handle.setPointerCapture(event.pointerId);
  handle.addEventListener("pointermove", move, { passive: true });
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", cancel);
}

export function applyDrop(grid: Grid, source: DragSource, target: DropTarget): void {
  if (source.kind === "thread") {
    const existing = grid.paneWith(source.threadId);
    if (existing) {
      if (target.edge) return grid.moveToEdge(existing.id, target.zone as Side);
      if (target.zone === "center") return grid.focus(existing.id);
      return grid.move(existing.id, target.paneId, target.zone);
    }
    if (target.edge) {
      grid.splitEdge(target.zone as Side, source.threadId);
    } else if (target.zone === "center") {
      grid.setThread(target.paneId, source.threadId);
      grid.focus(target.paneId);
    } else {
      grid.split(target.paneId, target.zone, source.threadId);
    }
    return;
  }
  if (target.edge) grid.moveToEdge(source.paneId, target.zone as Side);
  else if (target.zone === "center") grid.swap(source.paneId, target.paneId);
  else grid.move(source.paneId, target.paneId, target.zone);
}

export interface DropPreview {
  rect: Rect; // Percent of the grid, where the pane will be after the drop.
  label: string;
  full: boolean; // The drop would make a seventh pane, so it does nothing.
}

const PANE_LABELS: Record<Zone, string> = { center: "", get left() { return t("Til venstre"); }, get right() { return t("Til høyre"); }, get top() { return t("Over"); }, get bottom() { return t("Under"); } };
const EDGE_LABELS: Record<Side, string> = { get left() { return t("Venstre kant"); }, get right() { return t("Høyre kant"); }, get top() { return t("Øverste kant"); }, get bottom() { return t("Nederste kant"); } };

function rectIn(root: GridNode, paneId: string): Rect | undefined {
  const rects = new Map<string, Rect>();
  layoutNode(root, { x: 0, y: 0, w: 100, h: 100 }, [], rects, [] as Handle[]);
  return rects.get(paneId);
}

// Where a drop would put the pane, worked out on the tree the drop would make. Null when the drop
// would do nothing here.
export function dropPreview(grid: Grid, source: DragSource, target: DropTarget): DropPreview | null {
  const root = grid.root();
  const whole = { x: 0, y: 0, w: 100, h: 100 };
  // With one pane, its edge and the grid's edge are the same place.
  const sideLabel = target.edge && root.t === "split" ? EDGE_LABELS[target.zone as Side] : PANE_LABELS[target.zone];
  let movingId: string | null = null;
  if (source.kind === "thread") {
    if ((app.threads[source.threadId] ? scopeOf(app.threads[source.threadId]!) : "chat") !== grid.scope) return null;
    const existing = grid.paneWith(source.threadId);
    if (existing) {
      if (target.zone === "center" && !target.edge) {
        const rect = grid.geometry().rects.get(existing.id);
        return rect ? { rect, label: t("Allerede åpen"), full: false } : null;
      }
      movingId = existing.id;
    } else if (target.zone === "center" && !target.edge) {
      const rect = grid.geometry().rects.get(target.paneId);
      return rect ? { rect, label: t("Åpne her"), full: false } : null;
    } else if (collect(root).length >= MAX_PANES) {
      const rect = target.edge ? whole : grid.geometry().rects.get(target.paneId);
      return rect ? { rect, label: t("Maks {count} ruter", { count: MAX_PANES }), full: true } : null;
    } else {
      const added = newPane();
      const next = target.edge ? insertAtEdge(root, added, target.zone as Side) : insertBeside(root, target.paneId, added, target.zone as Side);
      const rect = rectIn(next, added.id);
      return rect ? { rect, label: sideLabel, full: false } : null;
    }
  } else {
    movingId = source.paneId;
  }
  if (target.zone === "center" && !target.edge) {
    const rect = grid.geometry().rects.get(target.paneId);
    return rect ? { rect, label: t("Bytt plass"), full: false } : null;
  }
  if (movingId === target.paneId) return null;
  const node = collect(root).find((p) => p.id === movingId);
  const without = node && remove(root, node.id);
  if (!node || !without) return null;
  const next = target.edge ? insertAtEdge(without, node, target.zone as Side) : insertBeside(without, target.paneId, node, target.zone as Side);
  const rect = rectIn(next, node.id);
  return rect ? { rect, label: sideLabel, full: false } : null;
}
