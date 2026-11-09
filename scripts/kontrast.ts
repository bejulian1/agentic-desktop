// Checks every colour theme against WCAG 2.2 AA for text: 4.5:1 for body text, and 3:1 for the
// few pairs that are only large text or controls. Reads the tokens straight from the stylesheets,
// so what is checked is what the app uses:
//   web/src/styles.css        :root (Lys) and :root[data-theme="dark"] (Mørk)
//   web/src/styles/extra.css  :root[data-palette="…"], with [data-theme="dark"] and :not([data-accent])
//   web/src/styles/settings.css :root[data-accent="…"] (Aksentfarge), light and dark, on the standard theme
//
//   node scripts/kontrast.ts            a table per theme, and exit code 1 on a failure
//   node scripts/kontrast.ts --quiet    only the failures
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

export type Tokens = Record<string, string>;
export interface Theme {
  id: string;
  dark: boolean;
  tokens: Tokens;
}
export interface Check {
  theme: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  ok: boolean;
}

function declarations(body: string): Tokens {
  const out: Tokens = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim();
  return out;
}

function block(css: string, selector: RegExp): Tokens {
  const out: Tokens = {};
  const pattern = new RegExp(`(?:^|\\})\\s*${selector.source}\\s*\\{([^}]*)\\}`, "gm");
  for (const match of css.matchAll(pattern)) Object.assign(out, declarations(match[1]));
  return out;
}

// All themes as they resolve in the browser: the base light or dark tokens, then the palette's.
export function loadThemes(root = ROOT): Theme[] {
  const base = readFileSync(path.join(root, "web/src/styles.css"), "utf8");
  const extra = readFileSync(path.join(root, "web/src/styles/extra.css"), "utf8");
  const light = block(base, /:root/);
  const dark = { ...light, ...block(base, /:root\[data-theme="dark"\]/) };
  const themes: Theme[] = [
    { id: "standard-lys", dark: false, tokens: light },
    { id: "standard-mørk", dark: true, tokens: dark },
  ];
  // The accent colours from Innstillinger → Utseende, on the standard theme. A palette other than
  // Standard keeps its own accent unless one is chosen, and then these same tokens apply.
  const settings = readFileSync(path.join(root, "web/src/styles/settings.css"), "utf8");
  for (const accent of new Set([...settings.matchAll(/:root\[data-accent="([a-z]+)"\]/g)].map((m) => m[1]))) {
    const a = `:root\\[data-accent="${accent}"\\]`;
    themes.push({ id: `aksent-${accent}-lys`, dark: false, tokens: { ...light, ...block(settings, new RegExp(a)) } });
    themes.push({ id: `aksent-${accent}-mørk`, dark: true, tokens: { ...dark, ...block(settings, new RegExp(a)), ...block(settings, new RegExp(`:root\\[data-theme="dark"\\]\\[data-accent="${accent}"\\]`)) } });
  }
  const ids = new Set([...extra.matchAll(/:root\[data-palette="([a-z]+)"\]/g)].map((m) => m[1]));
  for (const id of ids) {
    const p = `:root\\[data-palette="${id}"\\]`;
    themes.push({ id: `${id}-lys`, dark: false, tokens: { ...light, ...block(extra, new RegExp(p)), ...block(extra, new RegExp(`${p}:not\\(\\[data-accent\\]\\)`)) } });
    themes.push({
      id: `${id}-mørk`,
      dark: true,
      tokens: {
        ...dark,
        ...block(extra, new RegExp(p)),
        ...block(extra, new RegExp(`${p}:not\\(\\[data-accent\\]\\)`)),
        ...block(extra, new RegExp(`${p}\\[data-theme="dark"\\]`)),
        ...block(extra, new RegExp(`${p}\\[data-theme="dark"\\]:not\\(\\[data-accent\\]\\)`)),
      },
    });
  }
  return themes;
}

type Rgba = [number, number, number, number];

function parse(value: string, tokens: Tokens, depth = 0): Rgba {
  const v = value.trim();
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (ref && depth < 5) return parse(tokens[ref[1]] ?? "#000", tokens, depth + 1);
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1].split("").map((c) => parseInt(c + c, 16)), 1] as Rgba;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`Kan ikke lese fargen ${value}`);
}

// A colour with alpha over the one under it.
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Text and the surfaces it stands on in the app. A transparent background is laid over --bg.
const SURFACES = ["--bg", "--bg-sidebar", "--bg-panel", "--surface", "--surface-2"];
const PAIRS: Array<[fg: string, bgs: string[], min: number]> = [
  ["--text", [...SURFACES, "--surface-3", "--selection", "--hover", "--active", "--selected"], 4.5],
  ["--text-2", [...SURFACES, "--surface-3", "--hover", "--active", "--selected"], 4.5],
  ["--text-3", [...SURFACES, "--hover"], 4.5],
  ["--accent-text", [...SURFACES, "--accent-soft"], 4.5],
  ["--on-accent", ["--accent", "--accent-hover"], 4.5],
  ["--on-primary", ["--primary", "--primary-hover"], 4.5],
  ["--danger", ["--bg", "--surface", "--bg-panel", "--danger-soft"], 4.5],
  ["--warn", ["--bg", "--surface", "--warn-soft"], 4.5],
  ["--ok", ["--bg", "--surface", "--bg-panel"], 4.5],
  ["--add-text", ["--add-bg"], 4.5],
  ["--del-text", ["--del-bg"], 4.5],
  // Search hits: the text keeps its colour on a hit, and turns --on-highlight on the current one.
  ["--text", ["--highlight"], 4.5],
  ["--on-highlight", ["--highlight-current"], 4.5],
  ...["--tok-keyword", "--tok-string", "--tok-comment", "--tok-number", "--tok-type", "--tok-function", "--tok-prop", "--tok-meta"].map(
    (tok) => [tok, ["--bg-panel", "--surface-2", "--bg"], 4.5] as [string, string[], number],
  ),
  // Controls and focus: 3:1 against what is around them (WCAG 1.4.11).
  ["--accent", ["--bg", "--surface"], 3],
  ["--focus-ring", ["--bg", "--surface", "--bg-sidebar"], 3],
];

export function checkTheme(theme: Theme): Check[] {
  const t = theme.tokens;
  const ground = parse(t["--bg"], t);
  const checks: Check[] = [];
  for (const [fg, bgs, min] of PAIRS) {
    for (const bg of bgs) {
      if (!t[fg] || !t[bg]) continue;
      // Hover and the like sit on the surface they belong to; --bg is the worst case for most.
      const back = over(parse(t[bg], t), ground);
      const front = over(parse(t[fg], t), back);
      const r = ratio(front, back);
      // Høy kontrast holds AAA (7:1) for text, which is what it is for.
      const need = theme.id.startsWith("kontrast") && min === 4.5 ? 7 : min;
      checks.push({ theme: theme.id, fg, bg, ratio: r, min: need, ok: r >= need - 0.005 });
    }
  }
  return checks;
}

// Every palette sets the same tokens in its light and its dark rule, so nothing from the light one
// is left over in the dark variant. Returns the names that differ, per palette.
export function mismatchedTokens(root = ROOT): Record<string, string[]> {
  const extra = readFileSync(path.join(root, "web/src/styles/extra.css"), "utf8");
  const out: Record<string, string[]> = {};
  for (const id of new Set([...extra.matchAll(/:root\[data-palette="([a-z]+)"\]/g)].map((m) => m[1]))) {
    const p = `:root\\[data-palette="${id}"\\]`;
    for (const suffix of ["", ":not\\(\\[data-accent\\]\\)"]) {
      const light = Object.keys(block(extra, new RegExp(p + suffix)));
      const dark = Object.keys(block(extra, new RegExp(`${p}\\[data-theme="dark"\\]${suffix}`)));
      const diff = [...light.filter((k) => !dark.includes(k)), ...dark.filter((k) => !light.includes(k))];
      if (diff.length) out[id] = [...(out[id] ?? []), ...diff];
    }
  }
  return out;
}

// The accents Innstillinger → Utseende offers (besides Blå, the default in styles.css). Each must
// have its light and its dark rule in settings.css, or it would not be checked above at all.
export const ACCENTS = ["violet", "green", "orange", "pink", "red", "graphite"];
export function missingAccents(root = ROOT): string[] {
  const settings = readFileSync(path.join(root, "web/src/styles/settings.css"), "utf8");
  return ACCENTS.flatMap((accent) => {
    const light = Object.keys(block(settings, new RegExp(`:root\\[data-accent="${accent}"\\]`)));
    const dark = Object.keys(block(settings, new RegExp(`:root\\[data-theme="dark"\\]\\[data-accent="${accent}"\\]`)));
    const out: string[] = [];
    if (!light.includes("--accent") || !light.includes("--accent-text")) out.push(`${accent} (lys)`);
    if (!dark.includes("--accent") || !dark.includes("--accent-text")) out.push(`${accent} (mørk)`);
    return out;
  });
}

export function checkAll(root = ROOT): Check[] {
  return loadThemes(root).flatMap(checkTheme);
}

if (import.meta.main) {
  const quiet = process.argv.includes("--quiet");
  const themes = loadThemes();
  let failures = 0;
  for (const theme of themes) {
    const checks = checkTheme(theme);
    const bad = checks.filter((c) => !c.ok);
    failures += bad.length;
    const worst = checks.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a));
    if (!quiet || bad.length) console.log(`${bad.length ? "✖" : "✔"} ${theme.id.padEnd(18)} ${checks.length} par, lavest ${worst.ratio.toFixed(2)}:1 (${worst.fg} på ${worst.bg})`);
    for (const c of bad) console.log(`    ${c.fg} på ${c.bg}: ${c.ratio.toFixed(2)}:1, krever ${c.min}:1`);
  }
  for (const accent of missingAccents()) {
    failures++;
    console.log(`✖ aksentfargen ${accent} mangler i web/src/styles/settings.css`);
  }
  for (const [id, names] of Object.entries(mismatchedTokens())) {
    failures += names.length;
    console.log(`✖ ${id}: lys og mørk setter ikke de samme tokenene: ${names.join(", ")}`);
  }
  console.log(failures ? `\n${failures} feil.` : `\nAlle ${themes.length} temaer holder WCAG AA for tekst (Høy kontrast holder AAA).`);
  process.exitCode = failures ? 1 : 0;
}
