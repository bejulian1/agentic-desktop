// v1.4.0: what a link in an answer points at (file, thread, web), the coloured marks, and that the
// chip colours hold WCAG AA on every theme. Pure functions and the CSS files; no browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadThemes, ratio } from "../../scripts/kontrast.ts";
import { baseName, codeFileTarget, fileBadge, fileTarget, projectRelative, SKILL_MENTION, threadTarget } from "../src/markdown/link-targets.ts";
import { ICONS, KNOWN_SITES, MONOGRAM_COLORS, monogramFor, SITE_COLORS, siteOfHost } from "../src/markdown/site-icons.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("filkoblinger: relative, absolutte, file:// og linjenummer", () => {
  assert.deepEqual(fileTarget("README.md"), { path: "README.md", line: undefined, ext: "md", absolute: false });
  assert.deepEqual(fileTarget("server/src/http/api.ts:12"), { path: "server/src/http/api.ts", line: 12, ext: "ts", absolute: false });
  assert.deepEqual(fileTarget("./src/app.tsx:42:7"), { path: "src/app.tsx", line: 42, ext: "tsx", absolute: false });
  assert.deepEqual(fileTarget("README.md#L10-L20"), { path: "README.md", line: 10, ext: "md", absolute: false });
  assert.deepEqual(fileTarget("docs/guide.md#installering"), { path: "docs/guide.md", line: undefined, ext: "md", absolute: false });
  assert.deepEqual(fileTarget("/srv/app/notes.md#L10-L20"), { path: "/srv/app/notes.md", line: 10, ext: "md", absolute: true });
  assert.deepEqual(fileTarget("file:///srv/app/http.ts:42"), { path: "/srv/app/http.ts", line: 42, ext: "ts", absolute: true });
  assert.deepEqual(fileTarget("file://localhost/srv/app/a.py"), { path: "/srv/app/a.py", line: undefined, ext: "py", absolute: true });
  assert.equal(fileTarget("docs/My%20Notes.md")?.path, "docs/My Notes.md");
  assert.equal(fileTarget("Makefile")?.ext, "");
  assert.equal(fileTarget(".gitignore")?.ext, "gitignore");
});

test("filkoblinger: farlige og uklare mål avvises", () => {
  for (const href of [
    "javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)",
    "../secret.md", "docs/../../etc/passwd.md", "/srv/app/../../etc/passwd.txt", "%2e%2e/secret.md", "file://evil.example/x.md",
    "file:relative.md", "//example.com/a.js", "#heading", "?q=1", "docs/", "docs", "intro", "a\u0000b.md", "a\nb.md",
    "C:/Windows/win.ini", "~/notes.md", "src/app.ts?x=1", "a\\b.md", "%6Aavascript:alert(1)", "x.md#<script>", "v1.2.3",
  ]) assert.equal(fileTarget(href), null, href);
});

test("tråd-lenker, chip-stier og prosjektroten", () => {
  assert.equal(threadTarget("thread:abc-123"), "abc-123");
  assert.equal(threadTarget("agentic-thread://Abc_9"), "Abc_9");
  assert.equal(threadTarget("#thread:t1"), "t1");
  for (const bad of ["thread:", "thread:a b", "thread:<x>", "agentic-thread://a/b", "thread:../x", "javascript:thread:x"]) assert.equal(threadTarget(bad), null, bad);
  assert.deepEqual(codeFileTarget("README.md:12"), { path: "README.md", line: 12 });
  assert.deepEqual(codeFileTarget("./src/ui/Sidebar.tsx"), { path: "src/ui/Sidebar.tsx" });
  assert.equal(projectRelative("src/a.ts", "/srv/app"), "src/a.ts");
  assert.equal(projectRelative("/srv/app/src/a.ts", "/srv/app/"), "src/a.ts");
  assert.equal(projectRelative("/srv/application/a.ts", "/srv/app"), null, "en annen mappe med samme begynnelse");
  assert.equal(projectRelative("/etc/hosts.txt", "/srv/app"), null);
  assert.equal(baseName("server/src/http/api.ts"), "api.ts");
  assert.equal(fileBadge("tsx"), "TSX");
  assert.equal(fileBadge("docx"), "DOC");
  assert.equal(fileBadge("yml"), "YAML");
  assert.equal(fileBadge("", "Makefile"), "MAKE");
  assert.equal(fileBadge("gitignore", ".gitignore"), "CFG");
});

test("$skill i tekst: navn, men ikke penger eller miljøvariabler", () => {
  const skills = (text: string) => [...text.matchAll(SKILL_MENTION)].map((m) => m[2]);
  assert.deepEqual(skills("Bruk $frontend-design og $verify før du sender."), ["frontend-design", "verify"]);
  assert.deepEqual(skills("($anthropic-skills:docx)"), ["anthropic-skills:docx"]);
  assert.deepEqual(skills("Det koster $5 og $HOME er satt, a$b og $x."), ["x"]);
});

test("nettsteder: kjente merker, monogram for resten, og alle merker finnes", () => {
  const hosts: Record<string, string> = {
    "news.ycombinator.com": "hackernews", "vite.dev": "vite", "vitejs.dev": "vite", "www.solidjs.com": "solid", "www.typescriptlang.org": "typescript",
    "tailwindcss.com": "tailwind", "www.notion.so": "notion", "acme.notion.site": "notion", "acme.slack.com": "slack", "no.linkedin.com": "linkedin",
    "arxiv.org": "arxiv", "ubuntu.com": "ubuntu", "wiki.archlinux.org": "arch", "developers.cloudflare.com": "cloudflare", "aws.amazon.com": "aws",
    "azure.microsoft.com": "azure", "stripe.com": "stripe", "supabase.com": "supabase", "playwright.dev": "playwright", "www.electronjs.org": "electron",
    "gitlab.com": "gitlab", "docs.anthropic.com": "anthropic", "localhost": "localhost", "crates.io": "rust",
  };
  for (const [host, site] of Object.entries(hosts)) assert.equal(siteOfHost(host), site, host);
  assert.equal(siteOfHost("example.com"), null);
  assert.equal(siteOfHost("notgithub-vite.dev.example.com"), null);
  for (const [, kind] of KNOWN_SITES) assert.ok(ICONS[kind], kind);
  const a = monogramFor("www.example.com");
  assert.deepEqual(a, monogramFor("example.com"), "samme farge for samme nettsted");
  assert.equal(a.letter, "E");
  assert.ok(MONOGRAM_COLORS.includes(a.color));
  assert.equal(monogramFor("ølfabrikken.no").letter, "Ø");
  const white: [number, number, number, number] = [255, 255, 255, 1];
  for (const color of MONOGRAM_COLORS) assert.ok(ratio(white, hex(color)) >= 4.5, `hvit bokstav på ${color}`);
});

type Rgba = [number, number, number, number];
function hex(value: string): Rgba {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!m) throw new Error(`ikke en hex-farge: ${value}`);
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
}
function color(value: string, tokens: Record<string, string>, depth = 0): Rgba {
  const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (ref && depth < 5) return color(tokens[ref[1]] ?? "#000000", tokens, depth + 1);
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value.trim());
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  if (/^#[0-9a-f]{3}$/i.test(value.trim())) return hex(`#${value.trim().slice(1).split("").map((c) => c + c).join("")}`);
  return hex(value);
}
const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as Rgba;
const mix = (a: Rgba, b: Rgba, share: number): Rgba => [0, 1, 2].map((i) => a[i] * share + b[i] * (1 - share)).concat(1) as Rgba;

test("lenkechips og filchips holder 4,5:1 på alle temaer, også ved hover", () => {
  const css = readFileSync(path.join(ROOT, "web/src/styles/t3-look.css"), "utf8");
  // The shares are read from the CSS, so the test follows what is shipped.
  const share = (pattern: RegExp) => {
    const m = pattern.exec(css);
    assert.ok(m, String(pattern));
    return Number(m[1]) / 100;
  };
  const tokenShare = share(/\.md-link-chip, \.md-thread-chip \{[^}]*--chip-ink: color-mix\(in srgb, var\(--chip\) (\d+)%, var\(--text\)\)/);
  const siteShare = share(/\.md-link-chip\[data-site\] \{[^}]*--chip-ink: color-mix\(in srgb, var\(--chip\) (\d+)%, var\(--text\)\)/);
  const hoverTint = share(/\.md-link-chip:hover, \.md-thread-chip:hover \{ background: color-mix\(in srgb, var\(--chip\) (\d+)%, transparent\)/);
  const codeShare = share(/code\.md-file-chip \{\n  color: color-mix\(in srgb, var\(--ext\) (\d+)%, var\(--text\)\)/);
  const codeHover = share(/code\.md-file-chip\[data-file-path\]:hover \{ background: color-mix\(in srgb, var\(--ext\) (\d+)%, var\(--active\)\)/);
  const exts = [...css.matchAll(/\.md-file-chip[^{]*\{ --ext: (#[0-9a-f]{6});(?: --ext-fg: (#[0-9a-f]{6});)? \}/g)].map((m) => [m[1], m[2] ?? "#ffffff"] as const);
  assert.ok(exts.length >= 15, "fargene for filtypene er lest");
  const themes = loadThemes();
  assert.equal(themes.length, 34);
  const failures: string[] = [];
  for (const theme of themes) {
    const t = theme.tokens;
    const ground = color(t["--bg"], t);
    const text = over(color(t["--text"], t), ground);
    for (const surface of ["--bg", "--surface", "--bg-panel", "--surface-2"]) {
      if (!t[surface]) continue;
      const back = over(color(t[surface], t), ground);
      // Known sites: the label leans 65 % towards the site colour, on the hover tint (12 %).
      for (const [site, pair] of Object.entries(SITE_COLORS)) {
        const chip = hex(pair![theme.dark ? 1 : 0]);
        const r = ratio(mix(chip, text, siteShare), mix(chip, back, hoverTint));
        if (r < 4.5) failures.push(`${theme.id} ${site} på ${surface}: ${r.toFixed(2)}`);
      }
      // GitHub, threads and other sites lean towards theme tokens, on the same tint.
      for (const token of ["--accent-text", "--ok", "--tok-keyword", "--text"]) {
        if (surface === "--surface" && token === "--tok-keyword") continue; // answers stand on --bg and the panels
        const chip = over(color(t[token], t), back);
        const r = ratio(mix(chip, text, tokenShare), mix(chip, back, hoverTint));
        if (r < 4.5) failures.push(`${theme.id} ${token} på ${surface}: ${r.toFixed(2)}`);
      }
    }
    // `code` file names: a share of the type colour in the text colour, on the code background
    // and on its hover tint. The text colour wins in the code-on-hover state (var(--text)).
    const codeBack = over(color(t["--active"], t), ground);
    for (const [ext] of exts) {
      const r = ratio(mix(hex(ext), text, codeShare), codeBack);
      const hover = ratio(text, mix(hex(ext), codeBack, codeHover));
      if (r < 4.5) failures.push(`${theme.id} fil ${ext}: ${r.toFixed(2)}`);
      if (hover < 4.5) failures.push(`${theme.id} fil ${ext} ved hover: ${hover.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
  // The badge letters on their badge.
  for (const [bg, fg] of exts) assert.ok(ratio(hex(fg), hex(bg)) >= 4.5, `merkelapp ${fg} på ${bg}: ${ratio(hex(fg), hex(bg)).toFixed(2)}`);
});
