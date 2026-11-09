// The side panel, in Kode only (round 11, SPEC 24.5: Chat has none). It opens without a project too:
// the terminal starts in the home folder as Denne datamaskinen and the Browser panel works as usual.
//
// Round 11 (SPEC 24.3): by default the panel opens on a start page with the tools as tiles, in the
// style of Ny fane in the Browser panel, with Foreslått under when there is something to suggest. A
// tool that needs a project is dimmed with a short tip, and there is no empty page of its own. With
// a tool open, its name with ⌄ at the top leads back to the start page or to another tool. With
// «Faner øverst» in Innstillinger → Utseende it is a row of tabs as before, tidied.
//
// Round 12 (SPEC 26.3): with «Hver for seg» in a wide window, several tools stand open at once,
// stacked side by side and over and under each other (PanelStack.tsx). The tools themselves are in
// panel-content.tsx, for both.
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { onNextFrame } from "../lib/frame";
import { app, panelWidth, setPanelOpen, setPanelWidth } from "../state/app";
import { onPanelHome, panelTab, panelTabsOnTop, showPanel, showPanelHome, type PanelTab } from "../state/panel";
import { addToStack, maxPanelWidth, stackLayout, stacking, stackTools } from "../state/stack";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "./ContextMenu";
import { IconChevronDown, IconClose, IconPanel } from "./icons";
import { PanelHome, ToolView } from "./panel-content";
import { PanelStack } from "./PanelStack";
import { NEEDS_PROJECT_TIP, PANEL_TOOLS, toolBlocked, toolById, toolTitle } from "./panel-tools";

// The tool's name with ⌄: a calm way back to the start page, and to the other tools.
function ToolSwitch(props: { tool: PanelTab | null }) {
  const [anchor, setAnchor] = createSignal<MenuAnchor | null>(null);
  const current = () => (props.tool ? toolById(props.tool) : null);
  const entries = (): MenuEntry[] => [
    { label: "Startside", icon: IconPanel, chosen: !props.tool, run: showPanelHome },
    "sep",
    ...PANEL_TOOLS.map((tool) => ({
      label: tool.label,
      icon: tool.icon,
      keys: tool.keys,
      chosen: props.tool === tool.id,
      disabled: toolBlocked(tool),
      title: toolBlocked(tool) ? NEEDS_PROJECT_TIP : tool.tip,
      run: () => showPanel(tool.id),
    })),
  ];
  return (
    <>
      <button
        type="button"
        class="panel-switch"
        data-testid="panel-switch"
        aria-haspopup="menu"
        aria-expanded={!!anchor()}
        aria-label={current() ? `${current()!.label}: bytt verktøy` : "Sidepanel: velg verktøy"}
        title="Bytt verktøy, eller gå til startsiden"
        onClick={(e) => setAnchor(anchor() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}
      >
        <Show when={current()} keyed fallback={<IconPanel size={14} />}>{(tool) => tool.icon({ size: 14 })}</Show>
        <span class="panel-switch-name">{current()?.label ?? "Sidepanel"}</span>
        <span class="panel-switch-chevron"><IconChevronDown size={12} /></span>
      </button>
      <Show when={anchor()}>{(a) => <ContextMenu anchor={a()} label="Verktøy i sidepanelet" entries={entries()} onClose={() => setAnchor(null)} class="panel-switch-menu" />}</Show>
    </>
  );
}

export function RightPanel(props: { projectId: string | null; threadId: () => string | null }) {
  // What is on screen: the start page, or a tool. A tool that needs a project shows the start page
  // when there is none (or Terminal, with tabs on top), never an empty page.
  const blockedNow = (tab: PanelTab) => !!toolById(tab).needsProject && !props.projectId;
  const tool = createMemo<PanelTab | null>(() => {
    if (panelTabsOnTop()) return blockedNow(panelTab()) ? "terminal" : panelTab();
    if (onPanelHome() || blockedNow(panelTab())) return null;
    return panelTab();
  });

  let target = panelWidth();
  const apply = () => setPanelWidth(target);
  const startResize = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      // Stacked in more than one column, the panel may take more of the window.
      const max = stacking() && stackLayout().columns.length > 1 ? maxPanelWidth() : Math.min(900, innerWidth - 360);
      target = Math.min(Math.max(innerWidth - e.clientX, 280), max);
      onNextFrame(apply);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
    };
    handle.addEventListener("pointermove", move, { passive: true });
    handle.addEventListener("pointerup", end);
  };

  // Round 12: switching to Hver for seg with a tool open keeps that tool, as the first panel.
  createEffect(on(stacking, (stacked) => {
    if (stacked && !stackTools().length && tool()) addToStack(tool()!);
  }));

  // A playtest with its own dev server has a terminal tab, but the page is what the user wants.
  createEffect(() => {
    const state = props.projectId ? app.playtest[props.projectId] : undefined;
    if (state?.status === "error") showPanel("terminal");
  });

  const Close = () => (
    <button type="button" class="icon-button panel-close" title="Skjul panelet" data-keys="view.panel" aria-label="Skjul panelet" onClick={() => setPanelOpen(false)}><IconClose size={14} /></button>
  );

  return (
    <aside class="right-panel" classList={{ "panel-with-tabs": panelTabsOnTop() && !stacking(), "panel-stacked": stacking() }} aria-label="Panel">
      <div class="panel-resize" title="Dra for å endre bredden. Dobbeltklikk for standard." onPointerDown={startResize} onDblClick={() => setPanelWidth(stacking() && stackLayout().columns.length > 1 ? Math.min(maxPanelWidth(), 420 * stackLayout().columns.length) : 420)} />
      <Show when={!stacking()} fallback={<PanelStack projectId={props.projectId} threadId={props.threadId} />}>
        <Show
          when={panelTabsOnTop()}
          fallback={
            <div class="panel-toolbar">
              <ToolSwitch tool={tool()} />
              <Close />
            </div>
          }
        >
          {/* The tabs scroll sideways when they do not fit; the close button is outside that row, so it is never cut. */}
          <div class="panel-tabs-bar">
            <div class="panel-tabs" role="tablist" aria-label="Verktøy">
              <For each={PANEL_TOOLS}>
                {(item) => (
                  <button
                    type="button"
                    role="tab"
                    class="panel-tab"
                    aria-label={item.label}
                    title={blockedNow(item.id) ? `${item.label}: ${NEEDS_PROJECT_TIP}` : toolTitle(item, item.tip)}
                    aria-selected={tool() === item.id}
                    aria-disabled={blockedNow(item.id) ? "true" : undefined}
                    onClick={(e) => {
                      if (blockedNow(item.id)) return;
                      showPanel(item.id);
                      e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                    }}
                  >
                    <item.icon size={14} /><span>{item.label}</span>
                  </button>
                )}
              </For>
            </div>
            <Close />
          </div>
        </Show>
        <div class="panel-body" data-tool={tool() ?? "home"}>
          <Show when={tool()} keyed fallback={<PanelHome projectId={props.projectId} />}>
            {(current) => <ToolView tool={current} projectId={props.projectId} threadId={props.threadId} />}
          </Show>
        </div>
      </Show>
    </aside>
  );
}
