// Detached panes are ordinary browser windows of the same app. BroadcastChannel tells the main
// window which ones are open, without polling window.closed.
import { createSignal } from "solid-js";
import { toast } from "./app";
import type { Detached, Grid } from "./grid";
import { gridFor } from "./grid";

type WindowMessage =
  | { type: "hello"; threadId: string }
  | { type: "bye"; threadId: string }
  | { type: "who" }
  | { type: "reattach"; threadId: string; scope: string }
  | { type: "focus"; threadId: string }
  | { type: "close"; threadId: string };

const channel = new BroadcastChannel("agentic-desktop-windows");
const [openWindows, setOpenWindows] = createSignal<ReadonlySet<string>>(new Set<string>());
export { openWindows };

let soloThreadId: string | null = null;

function post(message: WindowMessage): void {
  channel.postMessage(message);
}

function mark(threadId: string, open: boolean): void {
  const next = new Set(openWindows());
  if (open) next.add(threadId);
  else next.delete(threadId);
  setOpenWindows(next);
}

channel.onmessage = (event: MessageEvent<WindowMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "hello":
      return mark(message.threadId, true);
    case "bye":
      return mark(message.threadId, false);
    case "who":
      if (soloThreadId) post({ type: "hello", threadId: soloThreadId });
      return;
    case "reattach": {
      if (soloThreadId) return;
      mark(message.threadId, false);
      const grid = gridFor(message.scope);
      const entry = grid.detached().find((d) => d.threadId === message.threadId);
      if (entry) grid.reattach(entry.id);
      return;
    }
    case "focus":
      if (soloThreadId === message.threadId) window.focus();
      return;
    case "close":
      if (soloThreadId === message.threadId) window.close();
      return;
  }
};

// In the main window: ask which detached windows exist right now.
export function askWhoIsOpen(): void {
  post({ type: "who" });
}

export function openDetachedWindow(entry: Detached): void {
  const url = `/?rute=${encodeURIComponent(entry.threadId)}`;
  const win = window.open(url, `ad-pane-${entry.threadId}`, "popup,width=760,height=860");
  if (!win) toast("Nettleseren blokkerte vinduet. Tillat oppsprett og trykk Åpne.", "info");
}

// In a detached window.
export function registerSoloWindow(threadId: string): void {
  soloThreadId = threadId;
  post({ type: "hello", threadId });
  window.addEventListener("pagehide", () => post({ type: "bye", threadId }));
}

export function sendReattach(threadId: string, scope: string): void {
  post({ type: "reattach", threadId, scope });
}

export function closeDetachedWindow(threadId: string): void {
  post({ type: "close", threadId });
}

export function focusDetachedWindow(grid: Grid, threadId: string): boolean {
  if (!grid.detached().some((d) => d.threadId === threadId)) return false;
  if (!openWindows().has(threadId)) return false;
  post({ type: "focus", threadId });
  return true;
}
