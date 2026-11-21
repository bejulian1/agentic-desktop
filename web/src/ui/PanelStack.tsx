// Round 12 (SPEC 26.3): panels stacked side by side and over and under each other, with «Hver for
// seg» chosen for the panel buttons, in a window wider than 860 px (state/stack.ts).
//
// Every panel has a slim top line of its own: its tabs where that makes sense (Terminal and
// Nettleser put their tabs and + there), ⋯, Maksimer or Gjenopprett, and Lukk. The dividers between
// them can be dragged, and a double click shares the room equally. A panel is dragged by its top
// line to another place, right of, left of, over or under another panel, and a clear field shows
// where it lands.
//
// The panels are one flat list keyed by tool and placed with percentages, so moving one, resizing
// or maximizing never mounts a tool again: a terminal keeps its shell, the browser its page. While a
// divider is dragged the sizes change directly, without animation; only opacity and transform move.
import { t } from "../lib/i18n";
import { unifiedPanelTabs } from "../state/panel-sessions";
import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show, type JSX } from "solid-js";
import { cancelFrameTask, onNextFrame } from "../lib/frame";
import { setPanelOpen, settingsOpen } from "../state/app";
import { closePanelTool, onPanelHome, type PanelTab } from "../state/panel";
import {
  equalizeColumns, equalizePanels, focusedTool, moveInStack, setColumnSizes, setFocusedTool, setPanelSizes, stackLayout, toggleMaximized,
  type Edge, type StackLayout,
} from "../state/stack";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "./ContextMenu";
import { IconClose, IconDots, IconPanel } from "./icons";
import { IconExpand } from "./nav-icons";
import { PanelHome, ToolView } from "./panel-content";
import { toolById } from "./panel-tools";
import "../styles/stack.css";

interface Rect {
  x: number; // fractions of the stack, 0 to 1
  y: number;
  w: number;
  h: number;
  col: number;
  row: number;
  rows: number;
}

const MIN_W = 180; // px, a column can not get narrower by dragging
const MIN_H = 96; // px, nor a panel lower
const TABBED = new Set<PanelTab>(["terminal", "browser"]);

const IconRestore = (p: { size?: number }) => (
  <svg class="icon" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M13.5 2.5 9.5 6.5M9.5 3.25V6.5h3.25M2.5 13.5l4-4M3.25 9.5H6.5v3.25" />
  </svg>
);

function rects(layout: StackLayout): Map<PanelTab, Rect> {
  const out = new Map<PanelTab, Rect>();
  const total = layout.columns.reduce((a, c) => a + c.size, 0) || 1;
  let x = 0;
  layout.columns.forEach((column, col) => {
    const w = column.size / total;
    const sum = column.panels.reduce((a, p) => a + p.size, 0) || 1;
    let y = 0;
    column.panels.forEach((panel, row) => {
      const h = panel.size / sum;
      out.set(panel.tool, { x, y, w, h, col, row, rows: column.panels.length });
      y += h;
    });
    x += w;
  });
  return out;
}

const pct = (value: number) => `${(value * 100).toFixed(4)}%`;

const edgeLabel = (edge: Edge, tool: string) => {
  switch (edge) {
    case "left": return t("Til venstre for {tool}", { tool });
    case "right": return t("Til høyre for {tool}", { tool });
    case "top": return t("Over {tool}", { tool });
    case "bottom": return t("Under {tool}", { tool });
  }
};

export function PanelStack(props: { projectId: string | null; threadId: () => string | null }) {
  let root!: HTMLDivElement;
  // While a divider is dragged: the sizes on screen, not yet kept.
  const [live, setLive] = createSignal<StackLayout | null>(null);
  const layout = () => live() ?? stackLayout();
  const placed = createMemo(() => rects(layout()));
  const tools = createMemo(() => layout().columns.flatMap((c) => c.panels.map((p) => p.tool)));
  const maximized = () => layout().maximized;

  // Moving a panel: where it would land, shown as a field over the target.
  const [moving, setMoving] = createSignal<PanelTab | null>(null);
  const [drop, setDrop] = createSignal<{ target: PanelTab; edge: Edge } | null>(null);

  const dropRect = createMemo(() => {
    const d = drop();
    const r = d ? placed().get(d.target) : undefined;
    if (!d || !r) return null;
    if (d.edge === "left") return { ...r, w: r.w / 2 };
    if (d.edge === "right") return { ...r, x: r.x + r.w / 2, w: r.w / 2 };
    if (d.edge === "top") return { ...r, h: r.h / 2 };
    return { ...r, y: r.y + r.h / 2, h: r.h / 2 };
  });

  const startMove = (tool: PanelTab, event: PointerEvent) => {
    if (event.button !== 0 || maximized()) return;
    if ((event.target as HTMLElement).closest("button, [role=tab], input, a, .stack-tabs")) return;
    const head = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    head.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
        started = true;
        setMoving(tool);
      }
      const box = root.getBoundingClientRect();
      const fx = (e.clientX - box.left) / box.width;
      const fy = (e.clientY - box.top) / box.height;
      let found: { target: PanelTab; edge: Edge } | null = null;
      for (const [other, r] of placed()) {
        if (other === tool || fx < r.x || fx > r.x + r.w || fy < r.y || fy > r.y + r.h) continue;
        const dx = (fx - r.x) / r.w;
        const dy = (fy - r.y) / r.h;
        const edges: Array<[Edge, number]> = [["left", dx], ["right", 1 - dx], ["top", dy], ["bottom", 1 - dy]];
        found = { target: other, edge: edges.sort((a, b) => a[1] - b[1])[0][0] };
      }
      const current = drop();
      if (found?.target !== current?.target || found?.edge !== current?.edge) setDrop(found);
    };
    const end = (e: PointerEvent) => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", end);
      head.removeEventListener("pointercancel", end);
      removeEventListener("keydown", escape, true);
      const target = drop();
      if (started && target && e.type === "pointerup") moveInStack(tool, target.target, target.edge);
      setMoving(null);
      setDrop(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !started) return;
      e.preventDefault();
      e.stopPropagation();
      setDrop(null);
      try {
        head.releasePointerCapture(event.pointerId);
      } catch {
        // Already let go.
      }
      end(new PointerEvent("pointercancel"));
    };
    head.addEventListener("pointermove", move, { passive: true });
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
    addEventListener("keydown", escape, true);
  };

  // A divider: between two columns (index is the column to its left), or between two panels in a
  // column (index is the panel above it). The new sizes are drawn at once and kept on release.
  const startResize = (kind: "col" | "row", column: number, index: number, event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const box = root.getBoundingClientRect();
    const base = stackLayout();
    const items = kind === "col" ? base.columns : base.columns[column].panels;
    const total = items.reduce((a, i) => a + i.size, 0);
    const span = kind === "col" ? box.width : box.height;
    const a0 = (items[index].size / total) * span;
    const b0 = (items[index + 1].size / total) * span;
    const min = kind === "col" ? MIN_W : MIN_H;
    const start = kind === "col" ? event.clientX : event.clientY;
    let sizes: [number, number] = [items[index].size, items[index + 1].size];
    let pending: number | null = null;
    const apply = () => {
      if (pending === null) return;
      const a = Math.min(Math.max(a0 + pending, Math.min(min, a0)), a0 + b0 - Math.min(min, b0));
      const weight = items[index].size + items[index + 1].size;
      sizes = [(weight * a) / (a0 + b0), (weight * (a0 + b0 - a)) / (a0 + b0)];
      const next: StackLayout = { maximized: base.maximized, columns: base.columns.map((c, ci) => ({ size: c.size, panels: c.panels.map((p) => ({ ...p })) })) };
      if (kind === "col") {
        next.columns[index].size = sizes[0];
        next.columns[index + 1].size = sizes[1];
      } else {
        next.columns[column].panels[index].size = sizes[0];
        next.columns[column].panels[index + 1].size = sizes[1];
      }
      setLive(next);
    };
    const move = (e: PointerEvent) => {
      pending = (kind === "col" ? e.clientX : e.clientY) - start;
      onNextFrame(apply);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      // The last move may not have been drawn yet: it counts all the same.
      cancelFrameTask(apply);
      apply();
      if (pending !== null) {
        if (kind === "col") setColumnSizes(index, sizes[0], sizes[1]);
        else setPanelSizes(column, index, sizes[0], sizes[1]);
      }
      setLive(null);
    };
    handle.addEventListener("pointermove", move, { passive: true });
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  // From the keyboard: the arrows move a focused divider by 5 %.
  const nudge = (kind: "col" | "row", column: number, index: number, event: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key as "ArrowLeft"];
    if (!step) return;
    event.preventDefault();
    const base = stackLayout();
    const items = kind === "col" ? base.columns : base.columns[column].panels;
    const total = items.reduce((a, i) => a + i.size, 0);
    const delta = total * 0.05 * step;
    const a = items[index].size + delta;
    const b = items[index + 1].size - delta;
    if (a <= total * 0.08 || b <= total * 0.08) return;
    if (kind === "col") setColumnSizes(index, a, b);
    else setPanelSizes(column, index, a, b);
  };

  // The dividers, from the layout: one between each pair of columns, and between panels in a column.
  const dividers = createMemo(() => {
    const out: Array<{ key: string; kind: "col" | "row"; column: number; index: number; x: number; y: number; w: number; h: number }> = [];
    const l = layout();
    const r = placed();
    l.columns.forEach((column, ci) => {
      const first = r.get(column.panels[0].tool)!;
      if (ci > 0) out.push({ key: `c${ci - 1}`, kind: "col", column: ci - 1, index: ci - 1, x: first.x, y: 0, w: 0, h: 1 });
      column.panels.forEach((panel, pi) => {
        if (pi === 0) return;
        const p = r.get(panel.tool)!;
        out.push({ key: `r${ci}:${pi - 1}`, kind: "row", column: ci, index: pi - 1, x: p.x, y: p.y, w: p.w, h: 0 });
      });
    });
    return out;
  });

  onCleanup(() => setLive(null));

  return (
    <div
      class="stack-root"
      ref={root}
      data-testid="panel-stack"
      classList={{ "has-max": !!maximized(), moving: !!moving(), resizing: !!live() }}
    >
      <Show when={tools().length} fallback={<EmptyStack projectId={props.projectId} />}>
        <For each={tools()}>
          {(tool) => {
            const r = () => placed().get(tool);
            const style = (): JSX.CSSProperties => {
              const rect = r();
              if (!rect || maximized() === tool) return { left: "0", top: "0", width: "100%", height: "100%" };
              return { left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) };
            };
            return (
              <StackPanelView
                tool={tool}
                style={style()}
                rect={r()}
                hidden={!!maximized() && maximized() !== tool}
                maximized={maximized() === tool}
                moving={moving() === tool}
                focused={focusedTool() === tool}
                projectId={props.projectId}
                threadId={props.threadId}
                onMoveStart={(e) => startMove(tool, e)}
              />
            );
          }}
        </For>
        <Show when={!maximized()}>
          {/* By position, so a divider keeps its element (and the pointer) while the sizes change. */}
          <Index each={dividers()}>
            {(divider) => (
              <div
                class={`stack-divider ${divider().kind}`}
                role="separator"
                tabindex="0"
                aria-orientation={divider().kind === "col" ? "vertical" : "horizontal"}
                aria-label={divider().kind === "col" ? t("Skille mellom kolonner") : t("Skille mellom paneler")}
                title={t("Dra for å endre størrelsen. Dobbeltklikk deler plassen likt.")}
                data-testid={`stack-divider-${divider().key}`}
                style={divider().kind === "col"
                  ? { left: pct(divider().x), top: "0", height: "100%" }
                  : { left: pct(divider().x), top: pct(divider().y), width: pct(divider().w) }}
                onPointerDown={(e) => startResize(divider().kind, divider().column, divider().index, e)}
                onDblClick={() => (divider().kind === "col" ? equalizeColumns(divider().index) : equalizePanels(divider().column, divider().index))}
                onKeyDown={(e) => nudge(divider().kind, divider().column, divider().index, e)}
              />
            )}
          </Index>
        </Show>
        <Show when={moving()}>
          <div
            class="stack-drop"
            classList={{ on: !!dropRect() }}
            data-testid="stack-drop"
            aria-hidden="true"
            style={dropRect() ? { left: pct(dropRect()!.x), top: pct(dropRect()!.y), width: pct(dropRect()!.w), height: pct(dropRect()!.h) } : undefined}
          >
            <Show when={drop()}>{(d) => <span class="stack-drop-label">{edgeLabel(d().edge, toolById(d().target).label)}</span>}</Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// No panel open yet: the start page, with a slim top line and Lukk.
function EmptyStack(props: { projectId: string | null }) {
  return (
    <section class="stack-panel stack-empty" aria-label={t("Sidepanel")} style={{ left: "0", top: "0", width: "100%", height: "100%" }}>
      <header class="stack-head">
        <span class="stack-title"><IconPanel size={14} /><span class="stack-name">{t("Verktøy")}</span></span>
        <span class="stack-spacer" />
        <button type="button" class="icon-button stack-button" title={t("Skjul panelet")} aria-label={t("Skjul panelet")} onClick={() => setPanelOpen(false)}><IconClose size={13} /></button>
      </header>
      <div class="stack-body" data-tool="home"><PanelHome projectId={props.projectId} /></div>
    </section>
  );
}

function StackPanelView(props: {
  tool: PanelTab;
  style: JSX.CSSProperties;
  rect: Rect | undefined;
  hidden: boolean;
  maximized: boolean;
  moving: boolean;
  focused: boolean;
  projectId: string | null;
  threadId: () => string | null;
  onMoveStart: (event: PointerEvent) => void;
}) {
  const tool = toolById(props.tool);
  const tabbed = TABBED.has(props.tool);
  const [head, setHead] = createSignal<HTMLElement>();
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  createEffect(() => { if (props.hidden || onPanelHome() || settingsOpen()) setMenu(null); });

  // Moves from ⋯: within the column, to the neighbouring column, or a column of its own.
  const menuEntries = (): MenuEntry[] => {
    const layout = stackLayout();
    const r = props.rect;
    const column = r ? layout.columns[r.col] : undefined;
    const above = r && column ? column.panels[r.row - 1]?.tool : undefined;
    const below = r && column ? column.panels[r.row + 1]?.tool : undefined;
    const leftColumn = r ? layout.columns[r.col - 1] : undefined;
    const rightColumn = r ? layout.columns[r.col + 1] : undefined;
    const alone = !column || column.panels.length === 1;
    const own = column?.panels.find((p) => p.tool !== props.tool)?.tool;
    const toLeft = leftColumn ? () => moveInStack(props.tool, leftColumn.panels.at(-1)!.tool, "bottom") : !alone && own ? () => moveInStack(props.tool, own, "left") : undefined;
    const toRight = rightColumn ? () => moveInStack(props.tool, rightColumn.panels.at(-1)!.tool, "bottom") : !alone && own ? () => moveInStack(props.tool, own, "right") : undefined;
    return [
      { label: t("Flytt opp"), disabled: !above, run: () => above && moveInStack(props.tool, above, "top") },
      { label: t("Flytt ned"), disabled: !below, run: () => below && moveInStack(props.tool, below, "bottom") },
      { label: leftColumn ? t("Flytt til kolonnen til venstre") : t("Egen kolonne til venstre"), disabled: !toLeft, run: () => toLeft?.() },
      { label: rightColumn ? t("Flytt til kolonnen til høyre") : t("Egen kolonne til høyre"), disabled: !toRight, run: () => toRight?.() },
      "sep",
      { label: props.maximized ? t("Gjenopprett") : t("Maksimer"), icon: props.maximized ? IconRestore : IconExpand, run: () => toggleMaximized(props.tool) },
      { label: t("Lukk {tool}", { tool: tool.label }), icon: IconClose, run: () => closePanelTool(props.tool) },
    ];
  };

  return (
    <section
      class="stack-panel"
      classList={{ maximized: props.maximized, moving: props.moving, focused: props.focused, "edge-left": (props.rect?.x ?? 0) > 0.0001 && !props.maximized, "edge-top": (props.rect?.row ?? 0) > 0 && !props.maximized }}
      hidden={props.hidden}
      data-tool={props.tool}
      data-testid={`stack-panel-${props.tool}`}
      aria-label={tool.label}
      style={props.style}
      onPointerDown={() => setFocusedTool(props.tool)}
    >
      <header class="stack-head" onPointerDown={(e) => props.onMoveStart(e)} onDblClick={(e) => !(e.target as HTMLElement).closest("button, [role=tab], .stack-tabs") && toggleMaximized(props.tool)} title={tabbed ? undefined : t("Dra for å flytte panelet. Dobbeltklikk for å maksimere.")}>
        <span class="stack-title" title={tabbed ? t("{tool}: dra for å flytte", { tool: tool.label }) : undefined}>
          <tool.icon size={14} />
          <Show when={!tabbed}><span class="stack-name">{tool.label}</span></Show>
        </span>
        <Show when={tabbed}><div class="stack-tabs" ref={setHead} /></Show>
        <span class="stack-spacer" />
        <button
          type="button"
          class="icon-button stack-button"
          aria-label={t("Mer for {tool}", { tool: tool.label })}
          title={t("Flytt og ordne")}
          aria-haspopup="menu"
          aria-expanded={!!menu()}
          onClick={(e) => setMenu(menu() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}
        >
          <IconDots size={14} />
        </button>
        <button
          type="button"
          class="icon-button stack-button"
          aria-label={props.maximized ? t("Gjenopprett {tool}", { tool: tool.label }) : t("Maksimer {tool}", { tool: tool.label })}
          title={props.maximized ? t("Gjenopprett") : t("Maksimer")}
          aria-pressed={props.maximized}
          onClick={() => toggleMaximized(props.tool)}
        >
          <Show when={props.maximized} fallback={<IconExpand size={13} />}><IconRestore size={13} /></Show>
        </button>
        <button type="button" class="icon-button stack-button" aria-label={t("Lukk {tool}", { tool: tool.label })} title={t("Lukk")} onClick={() => closePanelTool(props.tool)}>
          <IconClose size={13} />
        </button>
      </header>
      <Show when={menu()}>{(a) => <ContextMenu anchor={a()} label={t("Mer for {tool}", { tool: tool.label })} entries={menuEntries()} onClose={() => setMenu(null)} class="stack-menu" />}</Show>
      <div class="stack-body" data-tool={props.tool}>
        {/* Tabbed tools wait for the top line, so their tabs go there from the start. */}
        <Show when={!tabbed || head()}>
          <ToolView tool={props.tool} projectId={props.projectId} threadId={props.threadId} head={tabbed ? head : undefined} sharedTabs={unifiedPanelTabs()} visible={!props.hidden} />
        </Show>
      </div>
    </section>
  );
}
