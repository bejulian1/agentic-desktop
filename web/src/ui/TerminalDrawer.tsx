import { batch, createMemo, createSignal, For, lazy, onCleanup, Show, Suspense } from "solid-js";
import { t } from "../lib/i18n";
import { scope } from "../state/app";
import { displayKeys, keysFor } from "../state/shortcuts";
import {
  clampDrawerHeight, closeTerminalDrawer, createTerminalDrawerTabs, DEFAULT_DRAWER_HEIGHT,
  saveTerminalDrawerHeight, terminalDrawerAvailable, terminalDrawerHeight, terminalDrawerOpen,
  toggleTerminalDrawer,
} from "../state/terminal-drawer";
import { IconChevronDown, IconClose, IconPlus, IconSplitRight, IconTerminal, IconTrash } from "./icons";
import type { DrawerTerminalControls } from "./TerminalDrawerView";
import "../styles/terminal-drawer.css";

const TerminalView = lazy(() => import("./TerminalDrawerView"));

export function IconTerminalDrawer(props: { size?: number }) {
  return <svg class="icon" width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 16 16"
    fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.75" />
    <path d="M2.5 9.5h11" />
    <path d="M3 10h10v1.5H3z" fill="currentColor" opacity=".25" stroke="none" />
  </svg>;
}

export function TerminalDrawerButton() {
  const label = () => t("Vis eller skjul terminalfeltet");
  const keys = () => displayKeys(keysFor("view.terminalDrawer"));
  return <Show when={terminalDrawerAvailable()}>
    <button type="button" class="icon-button terminal-drawer-toggle" data-testid="terminal-drawer-toggle"
      title={keys() ? `${label()} (${keys()})` : label()} aria-label={label()}
      aria-controls={terminalDrawerOpen() ? "terminal-drawer" : undefined}
      aria-pressed={terminalDrawerOpen()} onClick={toggleTerminalDrawer}>
      <IconTerminalDrawer />
    </button>
  </Show>;
}

function Drawer(props: { projectId: string }) {
  const { projectId } = props;
  const sessions = createTerminalDrawerTabs(projectId);
  const [secondary, setSecondary] = createSignal<string>();
  const [maximized, setMaximized] = createSignal(false);
  const [previewHeight, setPreviewHeight] = createSignal<number>();
  const [resizing, setResizing] = createSignal(false);
  const controls = new Map<string, DrawerTerminalControls>();
  const visibleTabs = createMemo(() => sessions.tabs()
    .map((tab) => tab.terminalId)
    .filter((id) => id === sessions.active() || id === secondary()));
  const split = () => visibleTabs().length > 1;
  let drawer!: HTMLElement;
  let handle!: HTMLDivElement;
  let drag: { pointerId: number; y: number; height: number; next: number } | undefined;
  let frame = 0;

  const select = (id: string, focus: boolean) => {
    batch(() => {
      if (split() && secondary() === id) setSecondary(sessions.active());
      sessions.select(id);
    });
    if (focus) controls.get(id)?.focus();
  };
  const add = async () => {
    const id = await sessions.create();
    if (id) select(id, true);
  };
  const closeTab = async (id: string) => {
    await sessions.close(id);
    if (id === secondary() && !sessions.tabs().some((tab) => tab.terminalId === id)) setSecondary(undefined);
    const active = sessions.active();
    if (active) controls.get(active)?.focus();
  };
  const toggleSplit = async () => {
    if (split()) {
      setSecondary(undefined);
      controls.get(sessions.active()!)?.focus();
      return;
    }
    const active = sessions.active();
    const other = sessions.tabs().find((tab) => tab.terminalId !== active)?.terminalId ?? await sessions.create();
    if (other) {
      setSecondary(active);
      select(other, true);
    }
  };
  const clear = () => {
    const view = controls.get(sessions.active() ?? "");
    view?.clear();
    view?.focus();
  };

  const startResize = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const height = drawer.getBoundingClientRect().height;
    drag = { pointerId: event.pointerId, y: event.clientY, height, next: height };
    handle.setPointerCapture(event.pointerId);
    setResizing(true);
  };
  const moveResize = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag.next = clampDrawerHeight(drag.height + drag.y - event.clientY);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      setPreviewHeight(drag?.next);
    });
  };
  const stopResize = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    const next = event.type === "pointerup" ? drag.height + drag.y - event.clientY : drag.next;
    drag = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    saveTerminalDrawerHeight(next);
    setPreviewHeight(undefined);
    setResizing(false);
  };
  const resizeByKey = (event: KeyboardEvent) => {
    const height = drawer.getBoundingClientRect().height;
    const next = { ArrowUp: height + 24, ArrowDown: height - 24, Home: DEFAULT_DRAWER_HEIGHT }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    saveTerminalDrawerHeight(next);
  };
  onCleanup(() => {
    cancelAnimationFrame(frame);
    if (drag && handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
  });

  return <section ref={drawer} id="terminal-drawer" class="terminal-drawer" data-testid="terminal-drawer"
    aria-label={t("Terminalfelt")} classList={{ maximized: maximized(), resizing: resizing() }}
    style={{ "--drawer-height": `${previewHeight() ?? terminalDrawerHeight()}px` }}>
    <Show when={!maximized()}>
      <div ref={handle} class="terminal-drawer-resize" data-testid="terminal-drawer-resize" role="separator"
        tabIndex={0} aria-orientation="horizontal" aria-label={t("Endre høyden på terminalfeltet")}
        onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={stopResize}
        onPointerCancel={stopResize} onLostPointerCapture={stopResize}
        onDblClick={() => saveTerminalDrawerHeight(DEFAULT_DRAWER_HEIGHT)} onKeyDown={resizeByKey} />
    </Show>
    <header class="terminal-drawer-header">
      <div class="terminal-drawer-tabs" role="group" aria-label={t("Terminaler")}>
        <For each={sessions.tabs()}>
          {(tab, index) => {
            const shell = () => sessions.tabs().length > 1 ? `${tab.shell} ${index() + 1}` : tab.shell;
            const folder = tab.cwd.split("/").filter(Boolean).at(-1) ?? tab.cwd;
            return <div class="terminal-drawer-tab" classList={{ active: sessions.active() === tab.terminalId, exited: tab.exited }}>
              <button type="button" class="terminal-drawer-tab-name" data-testid="terminal-drawer-tab"
                title={`${shell()} · ${tab.cwd}`} aria-pressed={sessions.active() === tab.terminalId}
                onClick={() => select(tab.terminalId, true)}>
                <IconTerminal size={14} /><span>{shell()} · {folder}</span>
              </button>
              <button type="button" class="icon-button" aria-label={t("Lukk terminalen")} title={t("Lukk terminalen")}
                disabled={sessions.busy()} onClick={() => void closeTab(tab.terminalId)}><IconClose size={12} /></button>
            </div>;
          }}
        </For>
      </div>
      <div class="terminal-drawer-actions">
        <button type="button" class="icon-button" title={t("Ny terminal")} aria-label={t("Ny terminal")}
          disabled={sessions.busy()} onClick={() => void add()}><IconPlus size={16} /></button>
        <button type="button" class="icon-button" title={t("Del terminalfeltet")} aria-label={t("Del terminalfeltet")}
          aria-pressed={split()} disabled={sessions.busy() || !sessions.active()}
          onClick={() => void toggleSplit()}><IconSplitRight size={15} /></button>
        <button type="button" class="icon-button" title={t("Tøm terminalen")} aria-label={t("Tøm terminalen")}
          disabled={!sessions.active()} onClick={clear}><IconTrash size={15} /></button>
        <button type="button" class="icon-button" aria-label={maximized() ? t("Gjenopprett") : t("Maksimer")}
          title={maximized() ? t("Gjenopprett") : t("Maksimer")} onClick={() => setMaximized(!maximized())}>
          <span class="terminal-drawer-maximize"><IconChevronDown size={16} /></span>
        </button>
        <button type="button" class="icon-button" title={t("Skjul terminalfeltet")} aria-label={t("Skjul terminalfeltet")}
          onClick={closeTerminalDrawer}><IconClose size={16} /></button>
      </div>
    </header>
    <div class="terminal-drawer-body">
      <Suspense>
        <For each={visibleTabs()}>
          {(id) => <TerminalView
            projectId={projectId} terminalId={id} resizing={resizing()} onFocus={() => select(id, false)}
            register={(view) => {
              if (!view) controls.delete(id);
              else {
                controls.set(id, view);
                if (sessions.active() === id) view.focus();
              }
            }}
          />}
        </For>
      </Suspense>
      <Show when={!sessions.busy() && !sessions.tabs().length}>
        <div class="panel-empty">{t("Ingen terminaler. Velg «Ny terminal» for å starte en.")}</div>
      </Show>
    </div>
  </section>;
}

export function TerminalDrawer() {
  return <Show when={terminalDrawerAvailable() && terminalDrawerOpen() ? scope() : null} keyed>
    {(projectId) => <Drawer projectId={projectId} />}
  </Show>;
}
