// Keyboard shortcuts in one table, so the menus, the help and Settings → Hurtigtaster show the
// same keys the handler listens for. Rebinds are stored in the server settings.
import { t } from "../lib/i18n";
import { app } from "./app";

export interface ShortcutDef {
  id: string;
  label: string;
  group: "Tråder" | "Vindu" | "Visning" | "Panel";
  keys: string; // "Mod+B": Mod is Ctrl, or Cmd on a Mac.
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: "thread.new", get label() { return t("Ny tråd"); }, group: "Tråder", keys: "Mod+Alt+N" },
  { id: "thread.back", get label() { return t("Forrige tråd"); }, group: "Tråder", keys: "Alt+ArrowLeft" },
  { id: "thread.forward", get label() { return t("Neste tråd"); }, group: "Tråder", keys: "Alt+ArrowRight" },
  { id: "thread.search", get label() { return t("Søk i tråder"); }, group: "Tråder", keys: "Mod+Shift+K" },
  { id: "pane.new", get label() { return t("Ny rute"); }, group: "Vindu", keys: "Mod+\\" },
  { id: "folder.open", get label() { return t("Åpne mappe"); }, group: "Vindu", keys: "Mod+O" },
  { id: "settings.open", get label() { return t("Innstillinger"); }, group: "Vindu", keys: "Mod+," },
  { id: "view.sidebar", get label() { return t("Vis eller skjul sidefanen"); }, group: "Visning", keys: "Mod+B" },
  { id: "view.panel", get label() { return t("Vis eller skjul panelet"); }, group: "Visning", keys: "Mod+Shift+B" },
  { id: "view.terminalDrawer", get label() { return t("Vis eller skjul terminalfeltet"); }, group: "Visning", keys: "Mod+J" },
  { id: "view.summary", get label() { return t("Festet sammendrag"); }, group: "Visning", keys: "Mod+Shift+S" },
  { id: "view.details", get label() { return t("Vis eller skjul tråddetaljer"); }, group: "Visning", keys: "Mod+Shift+D" },
  { id: "view.mode", get label() { return t("Bytt mellom Chat, Kode og Kode Studio"); }, group: "Visning", keys: "Mod+Shift+M" },
  { id: "help.shortcuts", get label() { return t("Hurtigtaster"); }, group: "Vindu", keys: "Mod+/" },
  // v0.5: the command palette, and the thread menu on the focused thread.
  { id: "palette.open", get label() { return t("Kommandopalett"); }, group: "Vindu", keys: "Mod+K" },
  { id: "thread.rename", get label() { return t("Gi tråden nytt navn"); }, group: "Tråder", keys: "Mod+Alt+R" },
  { id: "thread.pin", get label() { return t("Fest eller løsne tråden"); }, group: "Tråder", keys: "Mod+Alt+P" },
  { id: "thread.side", get label() { return t("Ny sidechat"); }, group: "Tråder", keys: "Mod+Alt+S" },
  { id: "thread.unread", get label() { return t("Merk som lest eller ulest"); }, group: "Tråder", keys: "Mod+Shift+U" },
  { id: "thread.archive", get label() { return t("Arkiver tråden"); }, group: "Tråder", keys: "Mod+Shift+A" },
  { id: "thread.snooze", get label() { return t("Utsett tråden"); }, group: "Tråder", keys: "Mod+Alt+Z" },
  // v0.5, Innstillinger: each tab of the right panel. Ctrl+Alt and a digit is free in Chrome and GNOME.
  { id: "panel.files", get label() { return t("Vis Filer i panelet"); }, group: "Panel", keys: "Mod+Alt+1" },
  { id: "panel.changes", get label() { return t("Vis Endringer i panelet"); }, group: "Panel", keys: "Mod+Alt+2" },
  { id: "panel.terminal", get label() { return t("Vis Terminal i panelet"); }, group: "Panel", keys: "Mod+Alt+3" },
  { id: "panel.browser", get label() { return t("Vis Nettleser i panelet"); }, group: "Panel", keys: "Mod+Alt+4" },
  { id: "panel.team", get label() { return t("Vis Team i panelet"); }, group: "Panel", keys: "Mod+Alt+5" },
  { id: "panel.overview", get label() { return t("Vis Oversikt i panelet"); }, group: "Panel", keys: "Mod+Alt+6" },
  { id: "panel.session", get label() { return t("Vis Økt i panelet"); }, group: "Panel", keys: "Mod+Alt+7" }, // round 12 (SPEC 26.2)
  // Round 10 (SPEC 23.1): the + in the Browser panel's tab row. Ctrl+Shift+B already shows and hides
  // the panel, so Ny fane has Ctrl+Alt+B; both can be changed in Innstillinger → Hurtigtaster.
  { id: "browser.newTab", get label() { return t("Ny fane i nettleseren"); }, group: "Panel", keys: "Mod+Alt+B" },
  { id: "browser.newTabFull", get label() { return t("Ny fane i fullvisning"); }, group: "Panel", keys: "Mod+Shift+F" },
  // Round 11b (SPEC 25.1): Annoter in the Browser panel. Ctrl+Shift+A archives, so A goes with Alt.
  { id: "browser.annotate", get label() { return t("Annoter siden i nettleseren"); }, group: "Panel", keys: "Mod+Alt+A" },
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
