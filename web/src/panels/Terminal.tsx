// xterm.js on a real PTY. The PTY lives on the server, so leaving this tab disposes the terminal
// here and frees its memory, and coming back replays the output.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { get } from "../lib/api";
import { isDark } from "../lib/theme";
import { terminalColors } from "../state/themes";
import { observeResize } from "../lib/resize";
import { on, onOpen, send } from "../lib/socket";
import { app, report } from "../state/app";
import { IconClose, IconPlus } from "../ui/icons";

interface Tab {
  terminalId: string;
  title: string;
  exited: boolean;
}

// Colours from the theme's tokens, the program colours too (state/themes.ts, round 8).
function terminalTheme() {
  return terminalColors(isDark());
}

// The code font and size from Innstillinger (state/look.ts puts them on <html>).
function terminalFont(): { fontFamily: string; fontSize: number } {
  const css = getComputedStyle(document.documentElement);
  const size = parseFloat(css.getPropertyValue("--code-font-size"));
  return { fontFamily: css.getPropertyValue("--font-mono").trim() || "monospace", fontSize: size > 0 ? size : 13 };
}

const tabMemory = new Map<string, string>();

function View(props: { projectId: string; tab: Tab }) {
  let host!: HTMLDivElement;
  const terminal = new Terminal({
    ...terminalFont(),
    cursorBlink: false,
    scrollback: 5000,
    theme: terminalTheme(),
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const { terminalId } = props.tab;

  const attach = () => {
    const size = fit.proposeDimensions() ?? { cols: 80, rows: 24 };
    send({ type: "terminal.open", projectId: props.projectId, terminalId, cols: size.cols, rows: size.rows });
  };

  onMount(() => {
    terminal.open(host);
    void import("@xterm/addon-webgl").then(({ WebglAddon }) => {
      if (!terminal.element) return;
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose()); // xterm falls back to its DOM renderer.
        terminal.loadAddon(webgl);
      } catch {
        // No WebGL here: the DOM renderer stays.
      }
    });
    fit.fit();
    terminal.focus();

    const stops = [
      // Also after a reconnect: the replay holds what was missed meanwhile.
      on("terminal.opened", (message) => {
        if (message.terminalId !== terminalId) return;
        terminal.reset();
        terminal.write(message.replay);
      }),
      on("terminal.output", (message) => {
        if (message.terminalId === terminalId) terminal.write(message.data);
      }),
      on("terminal.exit", (message) => {
        if (message.terminalId === terminalId) terminal.write("\r\n[Prosessen er ferdig]\r\n");
      }),
      onOpen(attach),
      observeResize(host, () => {
        if (!host.clientWidth || !host.clientHeight) return;
        fit.fit();
        send({ type: "terminal.resize", terminalId, cols: terminal.cols, rows: terminal.rows });
      }),
    ];
    const data = terminal.onData((input) => send({ type: "terminal.input", terminalId, data: input }));
    onCleanup(() => {
      for (const stop of stops) stop();
      data.dispose();
    });
  });

  createEffect(() => {
    app.settings.theme;
    app.settings.themePreset;
    app.settings.accent;
    // After lib/theme.ts and state/look.ts have put the new attributes on <html>.
    queueMicrotask(() => (terminal.options.theme = terminalTheme()));
  });
  // A new code font or size in Innstillinger reaches an open terminal too.
  const look = new MutationObserver(() => {
    const font = terminalFont();
    if (font.fontFamily === terminal.options.fontFamily && font.fontSize === terminal.options.fontSize) return;
    Object.assign(terminal.options, font);
    if (host?.clientWidth) fit.fit();
  });
  look.observe(document.documentElement, { attributes: true, attributeFilter: ["data-code-font", "data-code-size", "style"] });
  onCleanup(() => look.disconnect());
  // The colours follow <html> itself, not only the settings: with System chosen, the operating
  // system switching between light and dark changes data-theme without any setting changing.
  const colours = new MutationObserver(() => (terminal.options.theme = terminalTheme()));
  colours.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "data-accent"] });
  onCleanup(() => colours.disconnect());

  onCleanup(() => terminal.dispose());
  // The WebGL renderer leaves no text in the DOM, so the tests read the buffer through this.
  const readBuffer = () => {
    const lines: string[] = [];
    const buffer = terminal.buffer.active;
    for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n");
  };
  return <div class="terminal-host" ref={(el) => { host = el; (el as any).readBuffer = readBuffer; }} data-testid="terminal" data-terminal-id={terminalId} />;
}

// head: round 12 (SPEC 26.3), a stacked panel's slim top line, where the tabs and + go instead.
export default function TerminalPanel(props: { projectId: string; place?: string; head?: () => HTMLElement | undefined }) {
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [active, setActive] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);

  const select = (id: string) => {
    tabMemory.set(props.projectId, id);
    setActive(id);
  };

  const create = () => send({ type: "terminal.open", projectId: props.projectId, cols: 80, rows: 24 });

  const load = async () => {
    try {
      const list = await get<Tab[]>(`/api/projects/${props.projectId}/terminals`);
      setTabs(list);
      setReady(true);
      const remembered = tabMemory.get(props.projectId);
      if (list.some((t) => t.terminalId === remembered)) setActive(remembered!);
      else if (list.length) setActive(list.at(-1)!.terminalId);
      else create();
    } catch (err) {
      report(err);
    }
  };

  onMount(() => {
    const stops = [
      on("terminal.opened", (message) => {
        if (message.projectId !== props.projectId) return;
        if (!tabs().some((t) => t.terminalId === message.terminalId)) {
          setTabs([...tabs(), { terminalId: message.terminalId, title: message.title, exited: false }]);
          select(message.terminalId);
        }
      }),
      on("terminal.exit", (message) => setTabs(tabs().map((t) => (t.terminalId === message.terminalId ? { ...t, exited: true } : t)))),
      // A playtest with a dev server runs in its own terminal tab.
      on("playtest.state", ({ state }) => {
        if (state.projectId !== props.projectId || !state.terminalId) return;
        const id = state.terminalId;
        get<Tab[]>(`/api/projects/${props.projectId}/terminals`).then((list) => {
          setTabs(list);
          if (list.some((t) => t.terminalId === id)) select(id);
        }).catch(report);
      }),
    ];
    onCleanup(() => stops.forEach((stop) => stop()));
    void load();
  });

  const close = (id: string) => {
    send({ type: "terminal.close", terminalId: id });
    const rest = tabs().filter((t) => t.terminalId !== id);
    setTabs(rest);
    if (active() === id) setActive(rest.at(-1)?.terminalId ?? null);
  };

  const tabRow = () => (
      <div class="terminal-tabs" classList={{ "in-head": !!props.head?.() }}>
        <For each={tabs()}>
          {(tab, i) => (
            <div class="terminal-tab" classList={{ on: active() === tab.terminalId, exited: tab.exited }}>
              <button type="button" class="terminal-tab-name" onClick={() => select(tab.terminalId)}>{tab.title === "Terminal" ? `Terminal ${i() + 1}` : tab.title}</button>
              <button type="button" class="icon-button" aria-label="Lukk terminalen" onClick={() => close(tab.terminalId)}><IconClose size={12} /></button>
            </div>
          )}
        </For>
        <button type="button" class="icon-button" title="Ny terminal" aria-label="Ny terminal" onClick={create}><IconPlus size={14} /></button>
        {/* Round 9: without a project the shell starts in the home folder, and says where it is. */}
        <Show when={props.place}><span class="terminal-place" data-testid="terminal-place" title="Uten prosjekt starter terminalen i hjemmemappen">{props.place}</span></Show>
      </div>
  );

  return (
    <div class="terminal-panel" data-testid="terminal-panel">
      <Show when={props.head?.()} fallback={tabRow()}>{(head) => <Portal mount={head()}>{tabRow()}</Portal>}</Show>
      <Show when={active()} keyed>
        {(id) => {
          const tab = tabs().find((t) => t.terminalId === id);
          return tab ? <View projectId={props.projectId} tab={tab} /> : null;
        }}
      </Show>
      <Show when={ready() && !tabs().length}><div class="panel-empty">Ingen terminaler. Trykk + for en ny.</div></Show>
    </div>
  );
}
