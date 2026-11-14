// One shared row for tools the user opened, with + leading to the chooser in both start modes.
// Tool-specific sessions stay inside the tool. Stacked tools keep their mounts behind the chooser.
import { createEffect, createMemo, For, on, Show } from "solid-js";
import { onNextFrame } from "../lib/frame";
import { app, LOCAL_SCOPE, panelWidth, setPanelOpen, setPanelWidth } from "../state/app";
import { closePanelTool, onPanelHome, openedPanelTools, panelTab, rememberPanelTool, showPanel, activeStartPage, closeStartPage, newPanelPage, panelStartPages, selectStartPage, type PanelTab } from "../state/panel";
import { addToStack, focusedTool, maxPanelWidth, stackLayout, stacking, stackTools } from "../state/stack";
import { panelSessions, unifiedPanelTabs } from "../state/panel-sessions";
import { IconClose, IconPanel, IconPlus } from "./icons";
import { PanelHome, ToolView } from "./panel-content";
import { PanelStack } from "./PanelStack";
import { toolById } from "./panel-tools";
import "../styles/panel-workspace.css";

export function RightPanel(props: { projectId: string | null; threadId: () => string | null }) {
  const tool = createMemo<PanelTab | null>(() => onPanelHome() ? null : panelTab());
  const openTools = createMemo(() => stacking() ? stackTools() : openedPanelTools());
  const activeTool = () => {
    if (onPanelHome()) return null;
    if (!stacking()) return tool();
    const list = stackTools();
    return list.includes(focusedTool()!) ? focusedTool() : list.includes(panelTab()) ? panelTab() : list[0] ?? null;
  };
  let tabs!: HTMLDivElement;
  let addButton!: HTMLButtonElement;
  createEffect(() => { if (!stacking() && tool()) rememberPanelTool(tool()!); });
  const entries = createMemo(() => [...openTools().flatMap((id) => {
    const item = toolById(id);
    const controls = unifiedPanelTabs() && (id === "browser" || id === "terminal") ? panelSessions(props.projectId ?? LOCAL_SCOPE, id) : undefined;
    if (controls?.tabs.length) return controls.tabs.map((session) => ({
      key: `${id}:${session.id}`, tool: id, label: session.title, selected: activeTool() === id && session.active,
      select: session.select, close: session.close, sessionId: session.id,
    }));
    return [{ key: id, tool: id, label: item.label, selected: activeTool() === id,
      select: () => showPanel(id), close: () => closePanelTool(id), sessionId: "" }];
  }), ...panelStartPages().map((id, index) => ({ key: `start:${id}`, tool: null, label: `Ny fane${index ? ` ${index + 1}` : ""}`, selected: activeStartPage() === id, select: () => selectStartPage(id), close: () => closeStartPage(id), sessionId: id }))]);
  const focusTab = (key?: string) => {
    const button = [...tabs.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]")].find((el) => el.dataset.workspaceTab === key);
    (button ?? addButton).focus({ preventScroll: true });
  };
  const closeEntry = (entry: ReturnType<typeof entries>[number]) => {
    const at = entries().findIndex((row) => row.key === entry.key);
    entry.close();
    queueMicrotask(() => focusTab(entries()[Math.max(0, at - 1)]?.key));
  };
  const tabKey = (event: KeyboardEvent, entry: ReturnType<typeof entries>[number]) => {
    const list = entries();
    const at = list.findIndex((row) => row.key === entry.key);
    let next: typeof entry | undefined;
    if (event.key === "ArrowRight") next = list[(at + 1) % list.length];
    else if (event.key === "ArrowLeft") next = list[(at - 1 + list.length) % list.length];
    else if (event.key === "Home") next = list[0];
    else if (event.key === "End") next = list.at(-1);
    else if (event.key === "Delete") { event.preventDefault(); closeEntry(entry); return; }
    if (!next) return;
    event.preventDefault();
    next.select();
    focusTab(next.key);
  };

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

  return (
    <aside class="right-panel panel-with-tabs panel-workspace" classList={{ "panel-stacked": stacking() }} aria-label="Panel">
      <div class="panel-resize" title="Dra for å endre bredden. Dobbeltklikk for standard." onPointerDown={startResize} onDblClick={() => setPanelWidth(stacking() && stackLayout().columns.length > 1 ? Math.min(maxPanelWidth(), 420 * stackLayout().columns.length) : 420)} />
      <div class="panel-tabs-bar panel-workspace-bar">
        <div class="panel-tabs" ref={tabs} role="tablist" aria-label="Åpne verktøy">
          <Show when={!openTools().length && !panelStartPages().length}><span class="panel-workspace-label"><IconPanel size={14} />Verktøy</span></Show>
          <For each={entries().map((row) => row.key)}>{(key) => {
            const entry = () => entries().find((row) => row.key === key)!;
            const item = { icon: entry().tool ? toolById(entry().tool!).icon : IconPlus };
            return <div class="panel-tool-tab" classList={{ selected: entry().selected }}>
              <button type="button" role="tab" class="panel-tab" id={`panel-tab-${entry().key}`} data-panel-tab={entry().tool} data-workspace-tab={entry().key} aria-label={entry().label} title={entry().label} aria-selected={entry().selected} tabindex={entry().selected || (!activeTool() && entries()[0]?.key === entry().key) ? 0 : -1} onKeyDown={(event) => tabKey(event, entry())} onClick={(event) => { entry().select(); event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" }); }}><item.icon size={14} /><span>{entry().label}</span></button>
              <button type="button" class="icon-button panel-tool-close" aria-label={entry().sessionId ? `Lukk ${entry().label}` : `Lukk verktøyet ${entry().label}`} title={`Lukk ${entry().label}`} onClick={() => closeEntry(entry())}><IconClose size={11} /></button>
            </div>;
          }}</For>
        </div>
        <button ref={addButton} type="button" class="icon-button panel-add-tool" aria-label="Åpne verktøy" title="Åpne verktøy" aria-pressed={undefined} data-testid="panel-add-tool" onClick={newPanelPage}><IconPlus size={16} /></button>
        <span class="panel-workspace-divider" />
        <button type="button" class="icon-button panel-close" title="Skjul panelet" data-keys="view.panel" aria-label="Skjul panelet" onClick={() => setPanelOpen(false)}><IconClose size={14} /></button>
      </div>
      <Show when={stacking()} fallback={<div class="panel-body" id="panel-tool-content" role={tool() ? "tabpanel" : undefined} aria-labelledby={entries().find((entry) => entry.selected) ? `panel-tab-${entries().find((entry) => entry.selected)!.key}` : undefined} data-tool={tool() ?? "home"}>
        <Show when={unifiedPanelTabs()} fallback={<Show when={tool()} keyed fallback={<PanelHome projectId={props.projectId} />}>{(current) => <ToolView tool={current} projectId={props.projectId} threadId={props.threadId} />}</Show>}>
          <For each={openTools().filter((id) => id === "browser" || id === "terminal")}>{(id) => <div class="panel-retained-tool" hidden={tool() !== id}><ToolView tool={id} projectId={props.projectId} threadId={props.threadId} sharedTabs visible={tool() === id} /></div>}</For>
          <Show when={tool() && tool() !== "browser" && tool() !== "terminal" ? tool() : null} keyed>{(current) => <ToolView tool={current} projectId={props.projectId} threadId={props.threadId} />}</Show>
          <Show when={!tool()}><PanelHome projectId={props.projectId} /></Show>
        </Show>
      </div>}>
        <div class="panel-stack-surface" hidden={onPanelHome()}><Show when={stackTools().length > 0}><PanelStack projectId={props.projectId} threadId={props.threadId} /></Show></div>
        <Show when={onPanelHome()}><div class="panel-body" data-tool="home"><PanelHome projectId={props.projectId} /></div></Show>
      </Show>
    </aside>
  );
}
