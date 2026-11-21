// xterm.js on a real PTY. The PTY lives on the server, so leaving this tab disposes the terminal
// here and frees its memory, and coming back replays the output.
import { t } from "../lib/i18n";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "../styles/terminal-share.css";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { get } from "../lib/api";
import { isDark } from "../lib/theme";
import { terminalColors } from "../state/themes";
import { observeResize } from "../lib/resize";
import { on, onOpen, send } from "../lib/socket";
import { app, LOCAL_SCOPE, mode, report, scope, scopeOf, toast, untitled } from "../state/app";
import { gridFor } from "../state/grid";
import { deliverToComposer } from "../state/composer-delivery";
import { formatTerminalShare } from "../lib/terminal-share";
import { openLink } from "../lib/links";
import { IconClose } from "../ui/icons";
import { closePanelTool, showPanel } from "../state/panel";
import { publishPanelSessions, releasePanelSessions, takeTerminalRequest, terminalRequest } from "../state/panel-sessions";

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
  const [hasSelection, setHasSelection] = createSignal(false);
  const [hasOutput, setHasOutput] = createSignal(false);
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
    // Activating this tool from the shared tab row must leave its keyboard navigation intact.
    // The terminal can mount later, after lazy imports or the server's initial replay.
    if (!document.activeElement?.closest(".panel-workspace-bar")) terminal.focus();

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
        if (message.terminalId === terminalId) terminal.write(t("\r\n[Prosessen er ferdig]\r\n"));
      }),
      onOpen(attach),
      observeResize(host, () => {
        if (!host.clientWidth || !host.clientHeight) return;
        fit.fit();
        send({ type: "terminal.resize", terminalId, cols: terminal.cols, rows: terminal.rows });
      }),
    ];
    const data = terminal.onData((input) => send({ type: "terminal.input", terminalId, data: input }));
    const selection = terminal.onSelectionChange(() => setHasSelection(!!terminal.getSelection().trim()));
    const linkProvider = terminal.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        const line = terminal.buffer.active.getLine(lineNumber - 1);
        if (!line) return callback(undefined);
        const text = line.translateToString(true);
        const matches = [...text.matchAll(/https?:\/\/[^\s<>"'`\])]+/g)];
        if (!matches.length) return callback(undefined);
        callback(matches.map((match) => {
          const uri = match[0].replace(/[.,;:!?]+$/, "");
          const startX = (match.index ?? 0) + 1;
          return {
            range: { start: { x: startX, y: lineNumber }, end: { x: startX + uri.length - 1, y: lineNumber } },
            text: uri,
            activate(event: MouseEvent, linkText: string) {
              openLink(linkText, event, false);
            },
          };
        }));
      },
    });
    const parsed = terminal.onWriteParsed(() => {
      const buffer = terminal.buffer.active;
      // A prompt near the end normally answers this immediately, without copying scrollback
      // on every streamed chunk. The full excerpt is read only when the user shares it.
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer.getLine(i)?.translateToString(true).trim()) { setHasOutput(true); return; }
      }
      setHasOutput(false);
    });
    onCleanup(() => {
      for (const stop of stops) stop();
      data.dispose();
      selection.dispose();
      linkProvider.dispose();
      parsed.dispose();
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
  colours.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "data-accent", "data-code-light", "data-code-dark", "data-ui-mod"] });
  onCleanup(() => colours.disconnect());

  onCleanup(() => terminal.dispose());
  // The WebGL renderer leaves no text in the DOM, so the tests read the buffer through this.
  const readBuffer = () => {
    const lines: string[] = [];
    const buffer = terminal.buffer.active;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      const text = line?.translateToString(!buffer.getLine(i + 1)?.isWrapped) ?? "";
      if (line?.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    return lines.join("\n");
  };
  // Resolve the target at click time too: project switches and pane focus must never send a
  // terminal excerpt to the thread that happened to be focused when the terminal mounted.
  const target = () => {
    if (mode() !== "code" || scope() !== props.projectId) return undefined;
    const id = gridFor(props.projectId).focusedThreadId();
    const thread = id ? app.threads[id] : undefined;
    return thread?.mode === "code" && scopeOf(thread) === props.projectId ? thread : undefined;
  };
  const hint = () => {
    const thread = target();
    if (!thread) return props.projectId === LOCAL_SCOPE
      ? t("Åpne en kodetråd i Denne datamaskinen for å dele til utkastet.")
      : t("Åpne en kodetråd i dette prosjektet for å dele til utkastet.");
    return untitled(thread)
      ? t("Til utkastet i aktiv kodetråd. Gjennomgå før sending.")
      : t("Til utkastet i «{title}». Gjennomgå før sending.", { title: thread.title });
  };
  const share = (selected: boolean) => {
    const thread = target();
    if (!thread) return;
    const excerpt = formatTerminalShare(selected ? terminal.getSelection() : readBuffer(), selected);
    if (!excerpt) return;
    deliverToComposer(thread.id, { text: excerpt.text, images: [] });
    toast(excerpt.truncated ? t("Avkortede terminalutdata er lagt i utkastet. Gjennomgå før sending.") : t("Terminalutdata er lagt i utkastet. Gjennomgå før sending."), "info");
  };
  return <>
    <div class="terminal-share" data-testid="terminal-share">
      <div class="terminal-share-actions">
        <button type="button" disabled={!target() || !hasSelection()} title={target() ? t("Marker tekst i terminalen og legg utvalget i utkastet (maks 200 linjer / 12 000 tegn)") : hint()} onMouseDown={(event) => event.preventDefault()} onClick={() => share(true)}>{t("Del utvalg")}</button>
        <button type="button" disabled={!target() || !hasOutput()} title={target() ? t("Legg siste terminalutdata, inkludert kommandoer, i utkastet (maks 200 linjer / 12 000 tegn)") : hint()} onMouseDown={(event) => event.preventDefault()} onClick={() => share(false)}>{t("Del siste utdata")}</button>
      </div>
      <div class="terminal-share-hint">{hint()}</div>
    </div>
    <div class="terminal-host" ref={(el) => { host = el; (el as any).readBuffer = readBuffer; }} data-testid="terminal" data-terminal-id={terminalId} />
  </>;
}

// head: a stacked panel's slim top line, where the terminal's sessions and action go instead.
export default function TerminalPanel(props: { projectId: string; place?: string; head?: () => HTMLElement | undefined; sharedTabs?: boolean; visible?: boolean }) {
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [active, setActive] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);
  const owner = {};
  let alive = true;
  onCleanup(() => { alive = false; });

  const select = (id: string) => {
    tabMemory.set(props.projectId, id);
    setActive(id);
  };

  const create = () => send({ type: "terminal.open", projectId: props.projectId, cols: 80, rows: 24 });

  const load = async () => {
    try {
      const list = await get<Tab[]>(`/api/projects/${props.projectId}/terminals`);
      if (!alive) return;
      setTabs(list);
      const remembered = tabMemory.get(props.projectId);
      if (list.some((t) => t.terminalId === remembered)) setActive(remembered!);
      else if (list.length) setActive(list.at(-1)!.terminalId);
      if (takeTerminalRequest(props.projectId) || !list.length) create();
      setReady(true);
    } catch (err) {
      if (alive) report(err);
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
          if (!alive) return;
          setTabs(list);
          if (list.some((t) => t.terminalId === id)) select(id);
        }).catch((err) => { if (alive) report(err); });
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
    if (props.sharedTabs && !rest.length) closePanelTool("terminal");
  };

  createEffect(() => {
    if (ready() && terminalRequest() === props.projectId && takeTerminalRequest(props.projectId)) create();
  });
  createEffect(() => {
    publishPanelSessions(props.projectId, "terminal", { owner, create, tabs: tabs().map((tab, i) => ({
      id: tab.terminalId, title: tab.title === "Terminal" ? t("Terminal {number}", { number: i + 1 }) : tab.title,
      active: tab.terminalId === active(), select: () => { showPanel("terminal"); select(tab.terminalId); }, close: () => close(tab.terminalId),
    })) });
  });
  onCleanup(() => releasePanelSessions(props.projectId, "terminal", owner));

  const tabRow = () => (
      <div class="terminal-tabs" classList={{ "in-head": !!props.head?.() }}>
        <For each={tabs()}>
          {(tab, i) => (
            <div class="terminal-tab" classList={{ on: active() === tab.terminalId, exited: tab.exited }}>
              <button type="button" class="terminal-tab-name" onClick={() => select(tab.terminalId)}>{tab.title === "Terminal" ? t("Terminal {number}", { number: i() + 1 }) : tab.title}</button>
              <button type="button" class="icon-button" aria-label={t("Lukk terminalen")} onClick={() => close(tab.terminalId)}><IconClose size={12} /></button>
            </div>
          )}
        </For>
        <button type="button" class="terminal-new" title={t("Start en ny terminal i dette miljøet")} aria-label={t("Ny terminal")} onClick={create}>{t("Ny terminal")}</button>
        {/* Round 9: without a project the shell starts in the home folder, and says where it is. */}
        <Show when={props.place}><span class="terminal-place" data-testid="terminal-place" title={t("Uten prosjekt starter terminalen i hjemmemappen")}>{props.place}</span></Show>
      </div>
  );

  return (
    <div class="terminal-panel" data-testid="terminal-panel">
      <Show when={!props.sharedTabs}><Show when={props.head?.()} fallback={tabRow()}>{(head) => <Portal mount={head()}>{tabRow()}</Portal>}</Show></Show>
      <Show when={active()} keyed>
        {(id) => {
          const tab = tabs().find((t) => t.terminalId === id);
          return tab ? <View projectId={props.projectId} tab={tab} /> : null;
        }}
      </Show>
      <Show when={ready() && !tabs().length}><div class="panel-empty">{t("Ingen terminaler. Velg «Ny terminal» for å starte en.")}</div></Show>
    </div>
  );
}
