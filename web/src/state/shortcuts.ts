// Keyboard shortcuts in one table, so the menus, the help and Settings → Hurtigtaster show the
// same keys the handler listens for. Rebinds are stored in the server settings.
import { app } from "./app";

export interface ShortcutDef {
  id: string;
  label: string;
  group: "Tråder" | "Vindu" | "Visning" | "Panel";
  keys: string; // "Mod+B": Mod is Ctrl, or Cmd on a Mac.
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: "thread.new", label: "Ny tråd", group: "Tråder", keys: "Mod+J" },
  { id: "thread.back", label: "Forrige tråd", group: "Tråder", keys: "Alt+ArrowLeft" },
  { id: "thread.forward", label: "Neste tråd", group: "Tråder", keys: "Alt+ArrowRight" },
  { id: "thread.search", label: "Søk i tråder", group: "Tråder", keys: "Mod+Shift+K" },
  { id: "pane.new", label: "Ny rute", group: "Vindu", keys: "Mod+\\" },
  { id: "folder.open", label: "Åpne mappe", group: "Vindu", keys: "Mod+O" },
  { id: "settings.open", label: "Innstillinger", group: "Vindu", keys: "Mod+," },
  { id: "view.sidebar", label: "Vis eller skjul sidefanen", group: "Visning", keys: "Mod+B" },
  { id: "view.panel", label: "Vis eller skjul panelet", group: "Visning", keys: "Mod+Shift+B" },
  { id: "view.summary", label: "Festet sammendrag", group: "Visning", keys: "Mod+Shift+S" },
  { id: "view.mode", label: "Bytt mellom Chat og Kode", group: "Visning", keys: "Mod+Shift+M" },
  { id: "help.shortcuts", label: "Hurtigtaster", group: "Vindu", keys: "Mod+/" },
  // v0.5: the command palette, and the thread menu on the focused thread.
  { id: "palette.open", label: "Kommandopalett", group: "Vindu", keys: "Mod+K" },
  { id: "thread.rename", label: "Gi tråden nytt navn", group: "Tråder", keys: "Mod+Alt+R" },
  { id: "thread.pin", label: "Fest eller løsne tråden", group: "Tråder", keys: "Mod+Alt+P" },
  { id: "thread.side", label: "Ny sidechat", group: "Tråder", keys: "Mod+Alt+S" },
  { id: "thread.unread", label: "Merk som lest eller ulest", group: "Tråder", keys: "Mod+Shift+U" },
  { id: "thread.archive", label: "Arkiver tråden", group: "Tråder", keys: "Mod+Shift+A" },
  // v0.5, Innstillinger: each tab of the right panel. Ctrl+Alt and a digit is free in Chrome and GNOME.
  { id: "panel.files", label: "Vis Filer i panelet", group: "Panel", keys: "Mod+Alt+1" },
  { id: "panel.changes", label: "Vis Endringer i panelet", group: "Panel", keys: "Mod+Alt+2" },
  { id: "panel.terminal", label: "Vis Terminal i panelet", group: "Panel", keys: "Mod+Alt+3" },
  { id: "panel.browser", label: "Vis Nettleser i panelet", group: "Panel", keys: "Mod+Alt+4" },
  { id: "panel.team", label: "Vis Team i panelet", group: "Panel", keys: "Mod+Alt+5" },
  { id: "panel.overview", label: "Vis Oversikt i panelet", group: "Panel", keys: "Mod+Alt+6" },
  { id: "panel.session", label: "Vis Økt i panelet", group: "Panel", keys: "Mod+Alt+7" }, // round 12 (SPEC 26.2)
  // Round 10 (SPEC 23.1): the + in the Browser panel's tab row. Ctrl+Shift+B already shows and hides
  // the panel, so Ny fane has Ctrl+Alt+B; both can be changed in Innstillinger → Hurtigtaster.
  { id: "browser.newTab", label: "Ny fane i nettleseren", group: "Panel", keys: "Mod+Alt+B" },
  { id: "browser.newTabFull", label: "Ny fane i fullvisning", group: "Panel", keys: "Mod+Shift+F" },
  // Round 11b (SPEC 25.1): Annoter in the Browser panel. Ctrl+Shift+A archives, so A goes with Alt.
  { id: "browser.annotate", label: "Annoter siden i nettleseren", group: "Panel", keys: "Mod+Alt+A" },
];

export function keysFor(id: string): string {
  return app.settings.shortcuts?.[id] ?? SHORTCUTS.find((s) => s.id === id)?.keys ?? "";
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const KEY_NAMES: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", " ": "Mellomrom" };

export function displayKeys(keys: string): string {
  if (!keys) return "";
  return keys.split("+").map((part) => (part === "Mod" ? (isMac ? "⌘" : "Ctrl") : KEY_NAMES[part] ?? part)).join(isMac ? "" : "+");
}

// The combination an event stands for, in the same form as the table. null for a lone modifier.
export function comboOf(event: KeyboardEvent): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  // With Shift, event.key is the shifted character, so the physical key is more stable.
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join("+");
}

export function matchShortcut(event: KeyboardEvent): string | null {
  const combo = comboOf(event);
  if (!combo) return null;
  for (const def of SHORTCUTS) if (keysFor(def.id) === combo) return def.id;
  return null;
}
