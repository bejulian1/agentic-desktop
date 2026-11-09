// Two letters and a fixed colour per provider, so OpenRouter and OpenAI, or abliteration and
// Anthropic, never look alike. No logos. Others get letters from their name and a hue from it.
// Used in Innstillinger → Leverandører and, since round 10 (SPEC 23.3), on the model button and in
// the model list.
const GLYPHS: Record<string, { text: string; hue: number }> = {
  openrouter: { text: "OR", hue: 262 },
  openai: { text: "OA", hue: 160 },
  anthropic: { text: "AN", hue: 22 },
  "abliteration.ai": { text: "AB", hue: 205 },
  demo: { text: "DM", hue: 220 },
};

export function glyphFor(name: string): { text: string; hue: number } {
  const known = GLYPHS[name.trim().toLowerCase()];
  if (known) return known;
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const text = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  return { text, hue: hash };
}

export function ProviderGlyph(props: { name: string; small?: boolean }) {
  const glyph = () => glyphFor(props.name);
  return <span class="provider-glyph" classList={{ small: props.small }} aria-hidden="true" style={`--glyph-hue:${glyph().hue}`}>{glyph().text}</span>;
}
