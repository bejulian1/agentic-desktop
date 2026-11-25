import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { createEffect, onCleanup, onMount } from "solid-js";
import { t } from "../lib/i18n";
import { observeResize } from "../lib/resize";
import { on, onOpen, send } from "../lib/socket";
import { terminalFont } from "../lib/terminal-font";
import { isDark } from "../lib/theme";
import { matchShortcut } from "../state/shortcuts";
import { terminalColors } from "../state/themes";

export interface DrawerTerminalControls {
  focus: () => void;
  clear: () => void;
}

export default function TerminalDrawerView(props: {
  projectId: string;
  terminalId: string;
  resizing: boolean;
  onFocus: () => void;
  register: (controls?: DrawerTerminalControls) => void;
}) {
  const { projectId, terminalId } = props;
  let host!: HTMLDivElement;
  const terminal = new Terminal({ ...terminalFont(), scrollback: 5000, theme: terminalColors(isDark()) });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  // Ctrl+J is also line feed in xterm. Let the document's shortcut handler receive it.
  terminal.attachCustomKeyEventHandler((event) => matchShortcut(event) !== "view.terminalDrawer");

  let frame = 0;
  let attached = false;
  let sentSize = "";
  function scheduleFit() {
    cancelAnimationFrame(frame);
    if (props.resizing) return;
    frame = requestAnimationFrame(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      fit.fit();
      const { cols, rows } = terminal;
      const size = `${cols}:${rows}`;
      if (attached && size !== sentSize) {
        sentSize = size;
        send({ type: "terminal.resize", terminalId, cols, rows });
      }
    });
  }

  onMount(() => {
    terminal.open(host);
    fit.fit();
    const subscriptions = [
      on("terminal.opened", (message) => {
        if (message.terminalId !== terminalId || message.surface !== "drawer") return;
        attached = true;
        terminal.reset();
        terminal.write(message.replay);
        scheduleFit();
      }),
      on("terminal.output", (message) => {
        if (message.terminalId === terminalId) terminal.write(message.data);
      }),
      on("terminal.exit", (message) => {
        if (message.terminalId === terminalId) terminal.write(t("\r\n[Prosessen er ferdig]\r\n"));
      }),
      onOpen(() => {
        attached = false;
        const { cols, rows } = terminal;
        sentSize = `${cols}:${rows}`;
        send({ type: "terminal.attach", projectId, terminalId, cols, rows });
      }),
      observeResize(host, scheduleFit),
    ];
    const input = terminal.onData((data) => send({ type: "terminal.input", terminalId, data }));
    const look = new MutationObserver(() => {
      terminal.options.theme = terminalColors(isDark());
      const font = terminalFont();
      if (font.fontFamily === terminal.options.fontFamily && font.fontSize === terminal.options.fontSize) return;
      Object.assign(terminal.options, font);
      scheduleFit();
    });
    look.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-palette", "data-accent", "data-code-light", "data-code-dark", "data-ui-mod", "data-code-font", "data-code-size", "style"],
    });
    props.register({ focus: () => terminal.focus(), clear: () => terminal.clear() });

    onCleanup(() => {
      props.register();
      cancelAnimationFrame(frame);
      look.disconnect();
      for (const unsubscribe of subscriptions) unsubscribe();
      input.dispose();
      send({ type: "terminal.detach", terminalId });
      terminal.dispose();
    });
  });

  createEffect(() => {
    if (host) scheduleFit();
  });

  return <div ref={host} class="terminal-host drawer-terminal-host" data-testid="drawer-terminal" data-terminal-id={terminalId} onFocusIn={props.onFocus} />;
}
