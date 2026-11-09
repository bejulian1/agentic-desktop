// Chat and Kode, the most important choice in the app, as icon and word. They sit at the top of
// the sidebar, and in the top bar when the sidebar is closed or the window is narrow; in a very
// narrow window only the icons are left (styles.css).
import { mode, setMode } from "../state/app";
import type { Mode } from "../../../shared/protocol";
import { IconChat, IconCode } from "./icons";

// Kode opens the project that was open last. Before any project is chosen, Kode shows the latest
// project folders as cards to pick from (SPEC 20), so nothing is picked here.
export function enterMode(next: Mode): void {
  setMode(next);
}

export function ModeSwitch(props: { class?: string }) {
  return (
    <div class={`mode-switch ${props.class ?? ""}`} role="group" aria-label="Modus">
      <button type="button" class="mode-button" aria-label="Chat" title="Chat: samtale uten prosjekt" data-keys="view.mode" aria-pressed={mode() === "chat"} onClick={() => enterMode("chat")}>
        <IconChat size={15} /><span class="mode-label">Chat</span>
      </button>
      <button type="button" class="mode-button" aria-label="Kode" title="Kode: jobb i en prosjektmappe" data-keys="view.mode" aria-pressed={mode() === "code"} onClick={() => enterMode("code")}>
        <IconCode size={15} /><span class="mode-label">Kode</span>
      </button>
    </div>
  );
}
