// The pane grid. Panes are flat and absolutely positioned, see state/grid.ts. A change of layout
// (a pane added, closed, moved, split or swapped) animates with FLIP: the panes are laid out at their
// new place at once, and a transform from the old place back to none runs on the compositor. Nothing
// animates width, height, top or left, and a splitter that is being dragged does not animate at all.
import { t } from "../lib/i18n";
import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show, type Accessor } from "solid-js";
import { app, emptyThreadName, untitled } from "../state/app";
import { dragging, dropPreview, dropTarget } from "../state/drag";
import type { Grid, Handle, Rect } from "../state/grid";
import { cancelFrameTask, onNextFrame } from "../lib/frame";
import { observeResize } from "../lib/resize";
import { closeDetachedWindow, openDetachedWindow, openWindows } from "../state/windows";
import { IconCompose, IconDetach } from "./icons";
import { Pane } from "./Pane";

const narrowQuery = matchMedia("(max-width: 720px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MOVE_MS = 220;
const PREVIEW_MS = 150;
const MIN_W = 240; // Smallest pane a splitter leaves, in pixels.
const MIN_H = 160;
const SNAP_PX = 18; // A splitter let go this close to 1/3, 1/2 or 2/3 lands on it.
const SNAPS = [1 / 3, 1 / 2, 2 / 3];
const KEY_STEP_PX = 16;
const KEY_STEP_BIG_PX = 80;

interface Size {
  w: number;
  h: number;
}

const percent = (r: Rect) => `left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%`;
const sameRect = (a: Rect, b: Rect) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h) < 0.01;
// Reduser bevegelse in Innstillinger counts as much as the system setting.
const moving = () => !reducedMotion.matches && document.documentElement.dataset.motion !== "reduce";

// The transform that shows a box laid out at `to` where `from` was. Origin top left.
function invert(from: Rect, to: Rect, size: Size): string {
  const dx = ((from.x - to.x) / 100) * size.w;
  const dy = ((from.y - to.y) / 100) * size.h;
  return `translate(${dx}px, ${dy}px) scale(${from.w / to.w}, ${from.h / to.h})`;
}

function DetachedBar(props: { grid: Grid }) {
  return (
    <Show when={props.grid.detached().length}>
      <div class="detached-bar" data-testid="detached-bar">
        <For each={props.grid.detached()}>
          {(entry) => {
            const open = () => openWindows().has(entry.threadId);
            return (
              <div class="detached-item">
                <IconDetach size={13} />
                <span class="detached-title">{app.threads[entry.threadId]?.title ?? t("Tråd")}</span>
                <span class="muted">{open() ? t("i eget vindu") : t("vinduet er lukket")}</span>
                <Show when={!open()}>
                  <button type="button" class="btn btn-small" onClick={() => openDetachedWindow(entry)}>{t("Åpne")}</button>
                </Show>
                <button
                  type="button"
                  class="btn btn-small"
                  onClick={() => {
                    closeDetachedWindow(entry.threadId);
                    props.grid.reattach(entry.id);
                  }}
                >{t("Hent tilbake")}</button>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

// The line between two panes. Drag it, use the arrow keys when it has focus, or double-click it to
// make the two panes the same size. Sizes are worked out as the share of the two panes on either
// side, so the rest of the split never moves.
function Splitter(props: { grid: Grid; handle: Accessor<Handle>; size: () => Size; quiet: (on: boolean) => void }) {
  const row = () => props.handle().dir === "row";
  const [active, setActive] = createSignal(false);
  const [snapping, setSnapping] = createSignal(false);
  const [hover, setHover] = createSignal(false);

  const pairPx = (h: Handle) => Math.max(1, ((h.before + h.after) / 100) * (h.dir === "row" ? props.size().w : props.size().h));
  const minShare = (h: Handle) => Math.min(0.5, (h.dir === "row" ? MIN_W : MIN_H) / pairPx(h));
  const clamp = (h: Handle, share: number, fallback: number) => {
    const min = minShare(h);
    return min >= 0.5 ? fallback : Math.min(1 - min, Math.max(min, share));
  };

  // The nearest of 1/3, 1/2 and 2/3 of the whole split, or the two panes equal, within reach.
  const snapFor = (h: Handle, share: number): number | null => {
    const pairStart = h.at - h.before;
    const pairLen = h.before + h.after;
    const spanStart = h.dir === "row" ? h.span.x : h.span.y;
    const spanLen = h.dir === "row" ? h.span.w : h.span.h;
    const min = minShare(h);
    let best: number | null = null;
    let bestPx = SNAP_PX;
    for (const candidate of [...SNAPS.map((f) => (spanStart + spanLen * f - pairStart) / pairLen), 0.5]) {
      if (candidate < min || candidate > 1 - min) continue;
      const px = Math.abs(candidate - share) * pairPx(h);
      if (px <= bestPx) {
        best = candidate;
        bestPx = px;
      }
    }
    return best;
  };

  const start = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const h = props.handle();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const along = (e: PointerEvent) => (h.dir === "row" ? e.clientX : e.clientY);
    const from = along(event);
    const share0 = props.grid.pairShare(h);
    const px = pairPx(h);
    let pos = from;
    let moved = false;
    const shareNow = () => clamp(h, share0 + (pos - from) / px, share0);
    const apply = () => {
      const share = shareNow();
      setSnapping(snapFor(h, share) !== null);
      props.grid.setPairShare(h, share);
    };
    const move = (e: PointerEvent) => {
      pos = along(e);
      if (!moved && Math.abs(pos - from) < 2) return;
      if (!moved) {
        moved = true;
        setActive(true);
        props.quiet(true);
      }
      onNextFrame(apply);
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      cancelFrameTask(apply);
      if (!moved) return;
      setActive(false);
      setSnapping(false);
      props.quiet(false);
      const share = shareNow();
      props.grid.setPairShare(h, snapFor(h, share) ?? share, true);
    };
    target.addEventListener("pointermove", move, { passive: true });
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const h = props.handle();
    if (event.key === "Enter") {
      event.preventDefault();
      props.grid.setPairShare(h, 0.5, true);
      return;
    }
    const [less, more] = row() ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const sign = event.key === less ? -1 : event.key === more ? 1 : 0;
    if (!sign || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    const now = props.grid.pairShare(h);
    const step = (event.shiftKey ? KEY_STEP_BIG_PX : KEY_STEP_PX) / pairPx(h);
    props.quiet(true);
    props.grid.setPairShare(h, clamp(h, now + sign * step, now), true);
    props.quiet(false);
  };

  // Small marks at 1/3, 1/2 and 2/3 of the split while the pointer is on the line or drags it, so
  // the places it snaps to show before you let go.
  const ticks = createMemo(() => {
    if (!hover() && !active()) return [];
    const h = props.handle();
    const start = h.dir === "row" ? h.span.x : h.span.y;
    const len = h.dir === "row" ? h.span.w : h.span.h;
    const pairStart = h.at - h.before;
    const pairLen = h.before + h.after;
    const min = minShare(h);
    return SNAPS.map((f) => start + len * f).filter((at) => {
      const share = (at - pairStart) / pairLen;
      return share >= min && share <= 1 - min;
    });
  });

  return (
    <>
    <For each={ticks()}>
      {(at) => (
        <span
          class="splitter-tick"
          classList={{ col: !row() }}
          aria-hidden="true"
          style={row()
            ? `left:${at}%;top:${props.handle().from + props.handle().length / 2}%`
            : `top:${at}%;left:${props.handle().from + props.handle().length / 2}%`}
        />
      )}
    </For>
    <div
      class="splitter"
      classList={{ col: !row(), active: active(), snap: snapping() }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      role="separator"
      tabIndex={0}
      aria-label={t("Endre størrelsen på rutene")}
      aria-orientation={row() ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.grid.pairShare(props.handle()) * 100)}
      data-handle={props.handle().key}
      style={row()
        ? `left:${props.handle().at}%;top:${props.handle().from}%;height:${props.handle().length}%`
        : `top:${props.handle().at}%;left:${props.handle().from}%;width:${props.handle().length}%`}
      onPointerDown={start}
      onDblClick={() => props.grid.setPairShare(props.handle(), 0.5, true)}
      onKeyDown={onKeyDown}
    />
    </>
  );
}

export function GridView(props: { grid: Grid; projectId: string | null; code?: boolean }) {
  const { grid } = props;
  const [narrow, setNarrow] = createSignal(narrowQuery.matches);
  const onChange = () => setNarrow(narrowQuery.matches);
  narrowQuery.addEventListener("change", onChange);
  onCleanup(() => narrowQuery.removeEventListener("change", onChange));
  let surface!: HTMLDivElement;

  // The surface size comes from the shared ResizeObserver, so animating never has to read layout.
  let size: Size = { w: 0, h: 0 };
  const watchSurface = (el: HTMLDivElement) => {
    surface = el;
    onCleanup(observeResize(el, (entry) => (size = { w: entry.contentRect.width, h: entry.contentRect.height })));
  };

  const handles = createMemo(() => (narrow() ? [] : grid.geometry().handles));

  // FLIP for the panes. A dragged splitter or an arrow key says quiet, so a resize only lays out.
  const elements = new Map<string, HTMLElement>();
  let quiet = false;
  let ready = false;
  void grid.loaded.then(() => (ready = true)); // The stored layout arriving is not a change to show.
  let last: Map<string, Rect> | null = null;

  const leave = (from: Rect) => {
    const ghost = document.createElement("div");
    ghost.className = "pane-leaving";
    ghost.style.cssText = percent(from);
    surface.appendChild(ghost);
    ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translate(${(from.w / 100) * size.w * 0.02}px, ${(from.h / 100) * size.h * 0.02}px) scale(0.96)` }], { duration: MOVE_MS * 0.8, easing: EASE }).finished.then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
  };

  createEffect(() => {
    const { rects } = grid.geometry();
    const flat = narrow();
    const before = last;
    last = rects;
    if (!before || !ready || quiet || flat || !moving() || !size.w) return;
    for (const [id, to] of rects) {
      const el = elements.get(id);
      if (!el) continue;
      const from = before.get(id);
      if (!from) {
        const nudge = `translate(${(to.w / 100) * size.w * 0.02}px, ${(to.h / 100) * size.h * 0.02}px) scale(0.96)`;
        el.animate([{ opacity: 0, transform: nudge }, { opacity: 1, transform: "none" }], { duration: MOVE_MS, easing: EASE });
      } else if (!sameRect(from, to)) {
        el.animate([{ transform: invert(from, to, size) }, { transform: "none" }], { duration: MOVE_MS, easing: EASE });
      }
    }
    for (const [id, from] of before) if (!rects.has(id)) leave(from);
  });

  // The drop preview: a soft box where the pane will be, worked out only when the target changes.
  const preview = createMemo(() => {
    const source = dragging();
    const target = dropTarget();
    if (!source || !target) return null;
    const result = dropPreview(grid, source, target);
    if (!result || !narrow()) return result;
    // One pane at a time on a narrow screen: show the side of the screen.
    const zone = target.zone;
    const rect = { x: zone === "right" ? 50 : 0, y: zone === "bottom" ? 50 : 0, w: zone === "left" || zone === "right" ? 50 : 100, h: zone === "top" || zone === "bottom" ? 50 : 100 };
    return { ...result, rect: result.full || zone === "center" ? { x: 0, y: 0, w: 100, h: 100 } : rect };
  });
  let zoneEl: HTMLDivElement | undefined;
  let labelEl: HTMLDivElement | undefined;
  let lastPreview: Rect | null = null;
  createEffect(() => {
    const current = preview();
    const before = lastPreview;
    lastPreview = current?.rect ?? null;
    if (!current || !zoneEl || !labelEl || !moving()) return;
    const timing = { duration: PREVIEW_MS, easing: EASE };
    if (!before) {
      zoneEl.animate([{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }], timing);
      labelEl.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    } else if (!sameRect(before, current.rect)) {
      const to = current.rect;
      zoneEl.animate([{ transform: invert(before, to, size) }, { transform: "none" }], timing);
      const dx = ((before.x + before.w / 2 - to.x - to.w / 2) / 100) * size.w;
      const dy = ((before.y + before.h / 2 - to.y - to.h / 2) / 100) * size.h;
      labelEl.animate([{ transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)` }, { transform: "translate(-50%, -50%)" }], timing);
    }
  });

  const lifted = (paneId: string) => {
    const source = dragging();
    return source?.kind === "pane" && source.paneId === paneId;
  };

  return (
    <div class="grid-area">
      <DetachedBar grid={grid} />
      <Show when={narrow() && grid.panes().length > 1}>
        <div class="pane-tabs" role="tablist">
          <For each={grid.panes()}>
            {(pane) => (
              <button
                type="button"
                role="tab"
                class="pane-tab"
                aria-selected={grid.focused() === pane.id}
                aria-label={untitled(app.threads[pane.threadId() ?? ""]) ? emptyThreadName() : undefined}
                classList={{ on: grid.focused() === pane.id, empty: untitled(app.threads[pane.threadId() ?? ""]) }}
                onClick={() => grid.focus(pane.id)}
              >
                <Show when={!untitled(app.threads[pane.threadId() ?? ""])} fallback={<IconCompose size={13} />}>{app.threads[pane.threadId() ?? ""]!.title}</Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="grid-surface" classList={{ multi: !narrow() && grid.panes().length > 1, dragging: !!dragging() }} ref={watchSurface} data-testid="grid">
        <For each={grid.panes()}>
          {(pane) => {
            const rect = () => grid.geometry().rects.get(pane.id);
            const hidden = () => narrow() && grid.focused() !== pane.id;
            onCleanup(() => elements.delete(pane.id));
            return (
              <div
                class="pane"
                classList={{ lifted: lifted(pane.id) }}
                ref={(el) => elements.set(pane.id, el)}
                style={narrow()
                  ? `left:0;top:0;width:100%;height:100%${hidden() ? ";display:none" : ""}`
                  : `left:${rect()?.x ?? 0}%;top:${rect()?.y ?? 0}%;width:${rect()?.w ?? 100}%;height:${rect()?.h ?? 100}%`}
              >
                <Pane pane={pane} grid={grid} projectId={props.projectId} code={props.code} focused={grid.focused() === pane.id} />
              </div>
            );
          }}
        </For>
        <Index each={handles()}>
          {(handle) => <Splitter grid={grid} handle={handle} size={() => size} quiet={(on) => (quiet = on)} />}
        </Index>
        <Show when={preview()}>
          {(current) => (
            <>
              <div
                class="drop-zone"
                classList={{ full: current().full }}
                ref={zoneEl}
                data-zone={dropTarget()?.zone}
                data-edge={dropTarget()?.edge ? "" : undefined}
                style={percent(current().rect)}
              />
              <div
                class="drop-label"
                classList={{ full: current().full }}
                ref={labelEl}
                style={`left:${current().rect.x + current().rect.w / 2}%;top:${current().rect.y + current().rect.h / 2}%`}
              >
                {current().label}
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
