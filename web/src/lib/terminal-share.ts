// Bound explicit terminal deliveries before they reach a draft. Read text from xterm's
// parsed buffer/selection, never from raw PTY escape sequences.
export const TERMINAL_SHARE_LINES = 200;
export const TERMINAL_SHARE_CHARS = 12_000;

export function formatTerminalShare(raw: string, selected: boolean): { text: string; truncated: boolean } | null {
  const clean = raw.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!clean.trim()) return null;
  const lines = clean.split("\n");
  const truncated = lines.length > TERMINAL_SHARE_LINES || clean.length > TERMINAL_SHARE_CHARS;
  let excerpt = selected ? lines.slice(0, TERMINAL_SHARE_LINES).join("\n") : lines.slice(-TERMINAL_SHARE_LINES).join("\n");
  excerpt = selected ? excerpt.slice(0, TERMINAL_SHARE_CHARS) : excerpt.slice(-TERMINAL_SHARE_CHARS);
  // Terminal output can itself contain Markdown fences. Keep it inside one literal block.
  const fence = "`".repeat(Math.max(3, ...[...excerpt.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const label = selected ? "Utvalg fra terminalen" : "Siste utdata fra terminalen";
  const note = truncated ? `\n[Avkortet: viser ${selected ? "starten av utvalget" : "slutten av terminalutdataene"}, maks ${TERMINAL_SHARE_LINES} linjer / ${TERMINAL_SHARE_CHARS.toLocaleString("nb-NO")} tegn.]` : "";
  return { text: `${label}${note}\n${fence}text\n${excerpt}\n${fence}`, truncated };
}
