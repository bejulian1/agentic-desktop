// Letters typed while no field has focus, matched against one word. Nothing is stored or sent, and
// nothing happens on a key that belongs to a field, a terminal, the Browser panel or a shortcut.
const WORD = "nordlys";
let typed = "";
let last = 0;

export function onQuietWord(event: KeyboardEvent, open: () => void): void {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || target.closest("input, textarea, select, canvas, [role='textbox'], .xterm, dialog"))) {
    typed = "";
    return;
  }
  const now = Date.now();
  if (now - last > 1500) typed = ""; // typed in one go, not over minutes
  last = now;
  typed = (typed + event.key.toLowerCase()).slice(-WORD.length);
  if (typed === WORD) {
    typed = "";
    open();
  }
}
