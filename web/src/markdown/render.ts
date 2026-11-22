// Markdown tokens to DOM nodes. Agent output is untrusted, so this never builds an HTML string:
// everything becomes an element made here or a text node, and raw HTML in the source stays text.
import { t } from "../lib/i18n";
import { Marked, type Token, type Tokens } from "marked";
import { highlightWhenVisible } from "./highlight";
import { renderMath } from "./math";
import { mathRendering } from "./options";
import { renderChart } from "./chart";
import { openCodeBlock } from "../ui/MiniEditorHooks";

const SAFE_LINK = /^(https?|mailto):/i;

// Math: $…$ and \(…\) in a line, $$…$$ and \[…\] as a block. "$5 og $10" stays text: the inner
// side of each $ must touch the formula, and a closing $ is never followed by a digit.
interface MathToken {
  type: "math";
  raw: string;
  text: string;
  display: boolean;
}
const INLINE_MATH = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/;
const INLINE_PAREN = /^\\\(([\s\S]+?)\\\)/;
const INLINE_DOUBLE = /^\$\$([^$]+?)\$\$/;
const BLOCK_MATH = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/;

const markdown = new Marked({ gfm: true, breaks: false });
markdown.use({
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start: (src: string) => {
        const at = src.search(/(?:^|\n) {0,3}(?:\$\$|\\\[)/);
        return at < 0 ? undefined : at;
      },
      tokenizer: (src: string): MathToken | undefined => {
        const match = BLOCK_MATH.exec(src);
        return match ? { type: "math", raw: match[0], text: (match[1] ?? match[2]).trim(), display: true } : undefined;
      },
    },
    {
      name: "math",
      level: "inline",
      start: (src: string) => {
        const at = src.search(/\$|\\\(/);
        return at < 0 ? undefined : at;
      },
      tokenizer: (src: string): MathToken | undefined => {
        const match = INLINE_DOUBLE.exec(src) ?? INLINE_MATH.exec(src) ?? INLINE_PAREN.exec(src);
        return match ? { type: "math", raw: match[0], text: match[1].trim(), display: false } : undefined;
      },
    },
  ],
});

export function lex(source: string): Token[] {
  return markdown.lexer(source);
}

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return SAFE_LINK.test(trimmed) ? trimmed : null;
}

function append(parent: Node, child: Node | string): void {
  parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

// ---------------------------------------------------------------------------------------------
// Smart links and file chips (v1.2.0, expanded with coloured site favicons in v1.2.1). Everything
// is built as DOM nodes, never as HTML text, and never loads remote images from untrusted output.
const SVG_NS = "http://www.w3.org/2000/svg";

type SiteKind =
  | "github" | "pull" | "issue" | "gitlab" | "youtube" | "npm" | "stackoverflow" | "mdn"
  | "docker" | "huggingface" | "anthropic" | "openai" | "google" | "reddit" | "wikipedia"
  | "figma" | "linear" | "vercel" | "x" | "discord" | "python" | "rust" | "node" | "localhost" | "link";

interface IconPart { tag: "path" | "circle" | "rect" | "polygon"; attrs: Record<string, string> }
interface IconSpec { fill?: string; stroke?: string; strokeWidth?: string; parts: IconPart[] }

const ICONS: Record<SiteKind, IconSpec> = {
  // GitHub Octocat
  github: { fill: "currentColor", parts: [{ tag: "path", attrs: { d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" } }] },
  // GitHub Pull Request
  pull: { stroke: "#3FB950", strokeWidth: "1.6", parts: [
    { tag: "circle", attrs: { cx: "4", cy: "3.5", r: "1.75" } },
    { tag: "circle", attrs: { cx: "4", cy: "12.5", r: "1.75" } },
    { tag: "circle", attrs: { cx: "12", cy: "12.5", r: "1.75" } },
    { tag: "path", attrs: { d: "M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H8.5M10 2.5 8.5 4.5 10 6.5" } },
  ] },
  // GitHub Issue
  issue: { stroke: "#A371F7", strokeWidth: "1.6", parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.5", fill: "#A371F7", stroke: "none" } },
  ] },
  // GitLab fox
  gitlab: { parts: [
    { tag: "path", attrs: { d: "M8 14.5 10.7 6.3H5.3L8 14.5Z", fill: "#E24329" } },
    { tag: "path", attrs: { d: "M8 14.5 5.3 6.3H1.5L8 14.5Z", fill: "#FC6D26" } },
    { tag: "path", attrs: { d: "M1.5 6.3.7 8.9c-.1.3 0 .7.3.9L8 14.5 1.5 6.3Z", fill: "#FCA326" } },
    { tag: "path", attrs: { d: "M1.5 6.3h3.8L3.7 1.3c-.1-.3-.5-.3-.6 0L1.5 6.3Z", fill: "#E24329" } },
    { tag: "path", attrs: { d: "M8 14.5 10.7 6.3h3.8L8 14.5Z", fill: "#FC6D26" } },
    { tag: "path", attrs: { d: "M14.5 6.3l.8 2.6c.1.3 0 .7-.3.9L8 14.5l6.5-8.2Z", fill: "#FCA326" } },
    { tag: "path", attrs: { d: "M14.5 6.3h-3.8l1.6-5c.1-.3.5-.3.6 0l1.6 5Z", fill: "#E24329" } },
  ] },
  // YouTube red play badge
  youtube: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "2.5", width: "14.5", height: "11", rx: "3", fill: "#FF0000" } },
    { tag: "polygon", attrs: { points: "6.4,5.4 11.4,8 6.4,10.6", fill: "#FFFFFF" } },
  ] },
  // npm red square
  npm: { parts: [
    { tag: "rect", attrs: { x: "1", y: "1", width: "14", height: "14", rx: "2.2", fill: "#CB3837" } },
    { tag: "path", attrs: { d: "M3.5 12.2V3.8h9v8.4h-2.3V6.1H8v6.1H3.5Z", fill: "#FFFFFF" } },
  ] },
  // Stack Overflow orange stack
  stackoverflow: { parts: [
    { tag: "path", attrs: { d: "M3 10.2v3.3h9.5v-3.3", stroke: "#94A3B8", "stroke-width": "1.5", fill: "none" } },
    { tag: "path", attrs: { d: "M4.8 11.6h6M5.1 9.1l5.8 1.2M5.9 6.5l5.4 2.5M7.5 4.1l4.6 3.8M9.8 2l3.4 4.8", stroke: "#F48024", "stroke-width": "1.35", "stroke-linecap": "round" } },
  ] },
  // MDN Web Docs blue badge
  mdn: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3", fill: "#0284C7" } },
    { tag: "path", attrs: { d: "M3 11.5V4.5l2.5 3.8L8 4.5v7M10.4 4.5h1.5a2 2 0 0 1 0 7h-1.5V4.5Z", stroke: "#FFFFFF", "stroke-width": "1.35", fill: "none", "stroke-linejoin": "round" } },
  ] },
  // Docker blue containers
  docker: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3", fill: "#2496ED" } },
    { tag: "rect", attrs: { x: "3", y: "6.4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "rect", attrs: { x: "5.6", y: "6.4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "rect", attrs: { x: "8.2", y: "6.4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "rect", attrs: { x: "5.6", y: "4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "path", attrs: { d: "M2.3 9c.2 2.4 2 3.8 5.2 3.8 3 0 5.3-1.4 6.1-3.8-.8-.4-1.7-.3-2.3 0H2.3Z", fill: "#FFFFFF" } },
  ] },
  // Hugging Face warm gold badge
  huggingface: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#FFD21E" } },
    { tag: "circle", attrs: { cx: "5.8", cy: "6.6", r: "1", fill: "#1F2937" } },
    { tag: "circle", attrs: { cx: "10.2", cy: "6.6", r: "1", fill: "#1F2937" } },
    { tag: "path", attrs: { d: "M5.3 9.7c.7 1.3 1.7 1.8 2.7 1.8s2-.5 2.7-1.8", stroke: "#1F2937", "stroke-width": "1.3", "stroke-linecap": "round", fill: "none" } },
  ] },
  // Anthropic / Claude coral starburst
  anthropic: { stroke: "#D97757", strokeWidth: "1.7", parts: [
    { tag: "path", attrs: { d: "M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.7", fill: "#D97757", stroke: "none" } },
  ] },
  // OpenAI emerald badge
  openai: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.5", fill: "#10A37F" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "4", stroke: "#FFFFFF", "stroke-width": "1.5", fill: "none" } },
    { tag: "path", attrs: { d: "M8 4v8M4.5 6l7 4M11.5 6l-7 4", stroke: "#FFFFFF", "stroke-width": "1.1" } },
  ] },
  // Google 4-colour G badge
  google: { parts: [
    { tag: "path", attrs: { d: "M14.4 8.2c0-.5 0-.9-.1-1.3H8v2.6h3.6a3.1 3.1 0 0 1-1.3 2v1.7h2.2c1.3-1.2 1.9-2.9 1.9-5Z", fill: "#4285F4" } },
    { tag: "path", attrs: { d: "M8 14.8c1.8 0 3.3-.6 4.5-1.6l-2.2-1.7c-.6.4-1.4.7-2.3.7-1.8 0-3.3-1.2-3.8-2.8H2v1.8A6.7 6.7 0 0 0 8 14.8Z", fill: "#34A853" } },
    { tag: "path", attrs: { d: "M4.2 9.4a4 4 0 0 1 0-2.8V4.8H2a6.7 6.7 0 0 0 0 6.4l2.2-1.8Z", fill: "#FBBC05" } },
    { tag: "path", attrs: { d: "M8 3.8c1 0 1.9.3 2.6 1l1.9-1.9A6.6 6.6 0 0 0 8 1.2 6.7 6.7 0 0 0 2 4.8l2.2 1.8C4.7 5 6.2 3.8 8 3.8Z", fill: "#EA4335" } },
  ] },
  // Reddit orange-red circle
  reddit: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "7", fill: "#FF4500" } },
    { tag: "circle", attrs: { cx: "8", cy: "9.2", r: "3.7", fill: "#FFFFFF" } },
    { tag: "circle", attrs: { cx: "6.5", cy: "8.8", r: "0.8", fill: "#FF4500" } },
    { tag: "circle", attrs: { cx: "9.5", cy: "8.8", r: "0.8", fill: "#FF4500" } },
    { tag: "path", attrs: { d: "M8 5.5 9.2 3.3 11.4 3.8", stroke: "#FFFFFF", "stroke-width": "1.1", fill: "none", "stroke-linecap": "round" } },
  ] },
  // Wikipedia badge
  wikipedia: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#E2E8F0" } },
    { tag: "path", attrs: { d: "M3.4 4.8 5.6 11.4 8 6.4l2.4 5 2.2-6.6", stroke: "#1E293B", "stroke-width": "1.4", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Figma multi-colour
  figma: { parts: [
    { tag: "circle", attrs: { cx: "5.8", cy: "3.5", r: "2.3", fill: "#F24E1E" } },
    { tag: "circle", attrs: { cx: "10.2", cy: "3.5", r: "2.3", fill: "#FF7262" } },
    { tag: "circle", attrs: { cx: "5.8", cy: "8", r: "2.3", fill: "#A259FF" } },
    { tag: "circle", attrs: { cx: "10.2", cy: "8", r: "2.3", fill: "#1ABCFE" } },
    { tag: "circle", attrs: { cx: "5.8", cy: "12.5", r: "2.3", fill: "#0ACF83" } },
  ] },
  // Linear indigo
  linear: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#5E6AD2" } },
    { tag: "path", attrs: { d: "M3.6 9.5 6.5 12.4M3.3 6.8 9.2 12.7M4.8 4.8l6.4 6.4", stroke: "#FFFFFF", "stroke-width": "1.35", "stroke-linecap": "round" } },
  ] },
  // Vercel triangle
  vercel: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#18181B" } },
    { tag: "polygon", attrs: { points: "8,3.6 12.6,11.4 3.4,11.4", fill: "#FFFFFF" } },
  ] },
  // X / Twitter
  x: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.2", fill: "#18181B" } },
    { tag: "path", attrs: { d: "M4 3.8 12 12.2M12 3.8 4 12.2", stroke: "#FFFFFF", "stroke-width": "1.6", "stroke-linecap": "round" } },
  ] },
  // Discord blurple
  discord: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.5", fill: "#5865F2" } },
    { tag: "path", attrs: { d: "M4.5 10.6c1 .8 2.2 1.1 3.5 1.1s2.5-.3 3.5-1.1l.6-4.5c-.8-.6-1.7-1-2.6-1.1l-.4.8a6 6 0 0 0-2.2 0l-.4-.8c-.9.1-1.8.5-2.6 1.1l.6 4.5Z", fill: "#FFFFFF" } },
    { tag: "circle", attrs: { cx: "6.4", cy: "8.4", r: "0.85", fill: "#5865F2" } },
    { tag: "circle", attrs: { cx: "9.6", cy: "8.4", r: "0.85", fill: "#5865F2" } },
  ] },
  // Python blue & yellow
  python: { parts: [
    { tag: "path", attrs: { d: "M8 1.5c-2.6 0-2.8 1.1-2.8 2.4v1.6h3v.7H4.1C2.6 6.2 1.5 7.2 1.5 9c0 1.9 1.1 2.8 2.6 2.8h1.1V10c0-1.4 1.1-2.5 2.5-2.5h3c1.2 0 2.1-.9 2.1-2.1V3.9c0-1.3-1.1-2.4-2.8-2.4H8Z", fill: "#3776AB" } },
    { tag: "path", attrs: { d: "M11.9 6.2h-1.1V8c0 1.4-1.1 2.5-2.5 2.5h-3c-1.2 0-2.1.9-2.1 2.1v1.5c0 1.3 1.1 2.4 2.8 2.4h2c2.6 0 2.8-1.1 2.8-2.4v-1.6h-3v-.7h4.1c1.5 0 2.6-1 2.6-2.8 0-1.9-1.1-2.8-2.6-2.8Z", fill: "#FFD43B" } },
  ] },
  // Rust orange gear
  rust: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.2", fill: "#EA580C" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "2.8", fill: "#FFFFFF" } },
  ] },
  // Node.js green hex
  node: { parts: [
    { tag: "polygon", attrs: { points: "8,1.2 14,4.6 14,11.4 8,14.8 2,11.4 2,4.6", fill: "#5FA04E" } },
    { tag: "path", attrs: { d: "M5.8 10.6V5.4l4.4 5.2V5.4", stroke: "#FFFFFF", "stroke-width": "1.5", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Local dev server emerald badge
  localhost: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.2", fill: "#16A34A" } },
    { tag: "path", attrs: { d: "m4.3 5.5 2.6 2.5-2.6 2.5M8.2 10.5h3.5", stroke: "#FFFFFF", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Generic web globe (accent coloured)
  link: { stroke: "currentColor", strokeWidth: "1.5", parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.25" } },
    { tag: "path", attrs: { d: "M1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.3 8 14.25C6.2 12.3 5.3 10.2 5.3 8S6.2 3.45 8 1.75z" } },
  ] },
};

function svgIcon(kind: SiteKind): SVGSVGElement {
  const icon = ICONS[kind];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "md-link-icon");
  if (icon.fill) svg.setAttribute("fill", icon.fill);
  else svg.setAttribute("fill", "none");
  if (icon.stroke) {
    svg.setAttribute("stroke", icon.stroke);
    svg.setAttribute("stroke-width", icon.strokeWidth ?? "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  }
  for (const part of icon.parts) {
    const node = document.createElementNS(SVG_NS, part.tag);
    for (const [name, value] of Object.entries(part.attrs)) node.setAttribute(name, value);
    svg.appendChild(node);
  }
  return svg;
}

// Recognised hosts get their authentic coloured favicon mark on both bare and named links.
const KNOWN_SITES: Array<[RegExp, SiteKind]> = [
  [/^(?:www\.)?gitlab\.com$/i, "gitlab"],
  [/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/i, "youtube"],
  [/^(?:www\.)?npmjs\.(?:com|org)$/i, "npm"],
  [/^(?:www\.)?(?:stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com)$/i, "stackoverflow"],
  [/^developer\.mozilla\.org$/i, "mdn"],
  [/^(?:www\.|hub\.|docs\.)?docker\.com$/i, "docker"],
  [/^(?:www\.)?huggingface\.co$/i, "huggingface"],
  [/^(?:www\.|docs\.|console\.)?(?:anthropic\.com|claude\.ai)$/i, "anthropic"],
  [/^(?:www\.|platform\.|chat\.|community\.)?(?:openai\.com|chatgpt\.com)$/i, "openai"],
  [/^(?:www\.|docs\.|ai\.|cloud\.|developers\.)?(?:google\.com|gemini\.google\.com|web\.dev)$/i, "google"],
  [/^(?:www\.|old\.)?reddit\.com$/i, "reddit"],
  [/^(?:[a-z]{2,3}\.)?wikipedia\.org$/i, "wikipedia"],
  [/^(?:www\.)?figma\.com$/i, "figma"],
  [/^(?:www\.)?linear\.app$/i, "linear"],
  [/^(?:www\.)?(?:vercel\.com|nextjs\.org)$/i, "vercel"],
  [/^(?:www\.)?(?:x\.com|twitter\.com)$/i, "x"],
  [/^(?:www\.)?(?:discord\.com|discord\.gg)$/i, "discord"],
  [/^(?:www\.|docs\.|pypi\.)?(?:python\.org|pypi\.org)$/i, "python"],
  [/^(?:www\.|doc\.|docs\.)?(?:rust-lang\.org|crates\.io|docs\.rs)$/i, "rust"],
  [/^(?:www\.)?nodejs\.org$/i, "node"],
  [/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i, "localhost"],
];

function knownSite(href: string): SiteKind | null {
  try {
    const host = new URL(href).hostname.toLowerCase();
    for (const [pattern, site] of KNOWN_SITES) if (pattern.test(host)) return site;
  } catch {
    return null;
  }
  return null;
}

// https://github.com/<owner>/<repo>/pull/<n> or /issues/<n>, with an optional tail (files, #fragment).
const GITHUB_ITEM = /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d{1,9})(?:[/?#].*)?$/i;
const GITHUB_ANY = /^https:\/\/(?:www\.)?github\.com(?:[/?#]|$)/i;
const MAX_CHIP_LABEL = 36;

// The text a bare link shows as: host and the first folders that fit, with … for the rest.
export function shortUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href.length > MAX_CHIP_LABEL ? `${href.slice(0, MAX_CHIP_LABEL - 1)}…` : href;
  }
  const host = url.host.replace(/^www\./i, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const tail = url.search || url.hash ? "/…" : "";
  const full = [host, ...segments].join("/") + tail;
  if (full.length <= MAX_CHIP_LABEL) return full;
  if (host.length >= MAX_CHIP_LABEL) return `${host.slice(0, MAX_CHIP_LABEL - 1)}…`;
  let shown = host;
  for (const segment of segments) {
    if (`${shown}/${segment}`.length + 2 > MAX_CHIP_LABEL) break;
    shown += `/${segment}`;
  }
  return `${shown}/…`;
}

// A link whose text is just the address, in any of the ways a model writes it.
function textIsAddress(text: string, href: string): boolean {
  const strip = (value: string) => value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  return strip(text) === strip(href);
}

// Gives a link the look of a chip with a coloured favicon when it is GitHub, a known site, or a
// bare URL, and returns true when it also wrote the label. Other named links stay plain links
// (with their full address in title on hover).
function decorateLink(anchor: HTMLAnchorElement, href: string, link: Tokens.Link): boolean {
  const bare = textIsAddress(link.text, href);
  // Hovering a chip always says where it leads: the address, after the link's own title if it has one.
  const where = link.title ? `${link.title} (${href})` : href;
  const item = GITHUB_ITEM.exec(href);
  if (item) {
    const kind = item[3].toLowerCase() === "pull" ? "pull" : "issue";
    const repo = `${item[1]}/${item[2]}`;
    anchor.className = "md-link-chip md-link-github";
    anchor.dataset.kind = kind;
    anchor.title = `${repo}#${item[4]} · ${where}`;
    anchor.append(svgIcon(kind));
    const label = el("span", "md-link-label");
    if (bare) label.textContent = `#${item[4]}`;
    else renderInline(link.tokens, label);
    anchor.append(label);
    return true;
  }
  if (GITHUB_ANY.test(href)) {
    anchor.className = "md-link-chip md-link-github";
    anchor.dataset.kind = "repo";
    anchor.title = where;
    anchor.append(svgIcon("github"));
    const label = el("span", "md-link-label");
    if (bare) label.textContent = shortUrl(href);
    else renderInline(link.tokens, label);
    anchor.append(label);
    return true;
  }
  const site = /^https?:/i.test(href) ? knownSite(href) : null;
  if (site) {
    anchor.className = "md-link-chip";
    anchor.dataset.site = site;
    anchor.title = where;
    anchor.append(svgIcon(site));
    const label = el("span", "md-link-label");
    if (bare) label.textContent = shortUrl(href);
    else renderInline(link.tokens, label);
    anchor.append(label);
    return true;
  }
  if (bare && /^https?:/i.test(href)) {
    anchor.className = "md-link-chip";
    anchor.title = where;
    anchor.append(svgIcon("link"));
    const label = el("span", "md-link-label");
    label.textContent = shortUrl(href);
    anchor.append(label);
    return true;
  }
  if (!anchor.title && /^https?:/i.test(href)) anchor.title = href;
  return false;
}

// File names and relative paths in `code`, with a line number after them when there is one. The
// list is the kinds of file an agent talks about most; anything else stays plain code.
const FILE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "json", "md", "mdx", "py", "rs", "go", "html", "sh", "yml", "yaml", "toml", "sql", "vue", "svelte", "java", "kt", "rb", "php", "c", "h", "cpp", "txt"]);
const FILE_NAME = /^(?:\.{0,2}\/)?(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.([A-Za-z0-9]{1,6})(?::\d{1,6}(?::\d{1,4})?)?$/;

export function fileExtension(text: string): string | null {
  if (text.length > 80 || /\s/.test(text) || text.includes("://") || text.includes("..") && !text.startsWith("../")) return null;
  const match = FILE_NAME.exec(text);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return FILE_EXTENSIONS.has(ext) ? ext : null;
}

export function renderInline(tokens: Token[] | undefined, parent: Node): void {
  if (!tokens) return;
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const text = token as Tokens.Text;
        if (text.tokens?.length) renderInline(text.tokens, parent);
        else append(parent, text.text);
        break;
      }
      case "escape":
        append(parent, (token as Tokens.Escape).text);
        break;
      case "strong":
      case "em":
      case "del": {
        const wrapper = el(token.type === "strong" ? "strong" : token.type === "em" ? "em" : "del");
        renderInline((token as Tokens.Strong).tokens, wrapper);
        parent.appendChild(wrapper);
        break;
      }
      case "codespan": {
        const code = el("code");
        const text = (token as Tokens.Codespan).text;
        code.textContent = text;
        const ext = fileExtension(text);
        if (ext) {
          // A file in the answer: a small coloured dot for its kind (styles/t3-look.css).
          code.className = "md-file-chip";
          code.dataset.fileExt = ext;
        }
        parent.appendChild(code);
        break;
      }
      case "br":
        parent.appendChild(el("br"));
        break;
      case "link": {
        const link = token as Tokens.Link;
        const href = safeHref(link.href);
        if (!href) {
          renderInline(link.tokens, parent);
          break;
        }
        const anchor = el("a");
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        if (link.title) anchor.title = link.title;
        if (!decorateLink(anchor, href, link)) renderInline(link.tokens, anchor);
        parent.appendChild(anchor);
        break;
      }
      case "image": {
        // Remote images would leak requests from an untrusted message, so only the text is shown.
        const image = token as Tokens.Image;
        append(parent, image.text ? `[bilde: ${image.text}]` : "[bilde]");
        break;
      }
      case "math":
        // Off in Innstillinger: the formula stays as it was written.
        if (mathRendering()) parent.appendChild(renderMath((token as unknown as MathToken).text, false));
        else append(parent, token.raw);
        break;
      default:
        // html and anything unknown: shown as the literal source.
        append(parent, token.raw);
    }
  }
}

// Called for every finished code block, right after it is in place. The artifact boxes hang off
// this. Never for a block that is still streaming or for the live tail, which is rebuilt per frame.
// info: the whole line after the fence, where a file name can follow the language. live: the block
// was just finished in an answer that is streaming, not read back from history.
type CodeBlockHook = (parent: Node, lang: string, text: string, info: string, live: boolean) => void;
let codeBlockHook: CodeBlockHook | null = null;
let live = false;

export function setCodeBlockHook(hook: CodeBlockHook): void {
  codeBlockHook = hook;
}

export function finishedCodeBlock(parent: Node, lang: string, text: string, info = lang): void {
  codeBlockHook?.(parent, lang, text, info, live);
}

// What MarkdownStream renders while an answer streams counts as live.
export function renderingLive<T>(run: () => T): T {
  const before = live;
  live = true;
  try {
    return run();
  } finally {
    live = before;
  }
}

const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh", "console", "shellsession", "terminal"]);
const PROMPT = /^\s*\$ /;

// A block of shell commands: one of the shell languages, or a block without a language that is
// one line starting with a $ prompt.
export function isShellBlock(lang: string, text: string): boolean {
  if (SHELL_LANGS.has(lang.toLowerCase())) return true;
  if (lang && lang.toLowerCase() !== "text") return false;
  const lines = text.trim().split("\n");
  return lines.length === 1 && /^\s*\$ +\S/.test(lines[0]);
}

// The commands in a shell block, as they would be typed. When some lines have a $ prompt, those
// are the commands and the rest is output; the prompts go.
export function shellCommand(text: string): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  const prompted = lines.filter((line) => PROMPT.test(line));
  return (prompted.length ? prompted.map((line) => line.replace(PROMPT, "")) : lines).join("\n").trim();
}

// Kjør (▶) beside Kopier on a shell block. CSS shows it only in Kode with a project; the
// conversation's one click listener does the rest.
export function addRunButton(root: HTMLElement, lang: string, text: string): void {
  if (root.dataset.shell || !isShellBlock(lang, text)) return;
  root.dataset.shell = "1";
  // A command, not text: no «Tekst» mark on it.
  if (root.dataset.text) {
    delete root.dataset.text;
    const label = root.querySelector(".md-lang")!;
    label.classList.remove("md-lang-text");
    label.textContent = t("skall");
  }
  const run = el("button", "md-run");
  run.type = "button";
  run.title = t("Kjør i prosjektmappen, med vanlige tillatelser");
  run.setAttribute("aria-label", t("Kjør kommandoen"));
  run.textContent = t("Kjør");
  root.querySelector(".md-copy")?.before(run);
}

// Round 15 (SPEC 31.3): a block marked text, or without a language, is text to copy, not code. It
// gets a small «Tekst» mark instead of a language, keeps Kopier, and wraps its lines.
const TEXT_LANGS = new Set(["", "text", "txt", "plaintext", "plain", "tekst"]);
export const isTextBlock = (lang: string) => TEXT_LANGS.has(lang.toLowerCase());

export function createCodeBlock(lang: string, text: string): { root: HTMLElement; code: HTMLElement } {
  const root = el("div", "md-code");
  const head = el("div", "md-code-head");
  const label = el("span", "md-lang");
  if (isTextBlock(lang)) {
    root.dataset.text = lang ? "declared" : "bare";
    label.classList.add("md-lang-text");
    label.textContent = t("Tekst");
  } else label.textContent = lang;
  const actions = el("span", "md-code-actions");
  const copy = el("button", "md-copy");
  copy.type = "button";
  copy.title = t("Kopier koden");
  copy.textContent = t("Kopier");
  // Round 8: the block in the mini editor (ui/MiniEditorHooks.tsx), from the click listener below.
  const open = el("button", "md-open");
  open.type = "button";
  open.title = t("Åpne i mini-editoren, med søk og oversikt");
  open.textContent = t("Åpne");
  actions.append(open, copy);
  head.append(label, actions);
  const pre = el("pre");
  const code = el("code");
  code.textContent = text;
  pre.appendChild(code);
  root.append(head, pre);
  if (lang || text) addRunButton(root, lang, text);
  return { root, code };
}

function renderList(list: Tokens.List, highlight: Element | null): HTMLElement {
  const element = el(list.ordered ? "ol" : "ul");
  if (list.ordered && typeof list.start === "number" && list.start !== 1) (element as HTMLOListElement).start = list.start;
  for (const item of list.items) {
    const li = el("li");
    if (item.task) {
      li.className = "md-task";
      const box = el("input");
      box.type = "checkbox";
      box.disabled = true;
      box.checked = item.checked === true;
      li.appendChild(box);
    }
    renderBlocks(item.tokens, li, true, highlight);
    element.appendChild(li);
  }
  return element;
}

function renderTable(table: Tokens.Table): HTMLElement {
  const wrap = el("div", "md-table");
  const element = el("table");
  const head = el("thead");
  const headRow = el("tr");
  table.header.forEach((cell, i) => {
    const th = el("th");
    if (table.align[i]) th.style.textAlign = table.align[i]!;
    renderInline(cell.tokens, th);
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  const body = el("tbody");
  for (const row of table.rows) {
    const tr = el("tr");
    row.forEach((cell, i) => {
      const td = el("td");
      if (table.align[i]) td.style.textAlign = table.align[i]!;
      renderInline(cell.tokens, td);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  element.append(head, body);
  wrap.appendChild(element);
  return wrap;
}

// tight: inside a list item, where marked gives bare text tokens instead of paragraphs.
// highlight: the element whose visibility decides when code gets highlighted, or null for never.
export function renderBlocks(tokens: Token[], parent: Node, tight = false, highlight: Element | null = null): void {
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "paragraph": {
        const p = el("p");
        renderInline((token as Tokens.Paragraph).tokens, p);
        parent.appendChild(p);
        break;
      }
      case "text": {
        const text = token as Tokens.Text;
        if (tight) renderInline(text.tokens ?? [text], parent);
        else {
          const p = el("p");
          renderInline(text.tokens ?? [text], p);
          parent.appendChild(p);
        }
        break;
      }
      case "heading": {
        const heading = token as Tokens.Heading;
        const h = el(`h${Math.min(heading.depth + 1, 6)}` as "h2");
        renderInline(heading.tokens, h);
        parent.appendChild(h);
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        const info = (code.lang ?? "").trim();
        const lang = info.split(/\s+/)[0] ?? "";
        const chart = lang === "chart" ? renderChart(code.text) : null;
        if (chart) {
          parent.appendChild(chart);
          break;
        }
        const block = createCodeBlock(lang, code.text);
        parent.appendChild(block.root);
        if (highlight) {
          highlightWhenVisible(highlight, block.code, lang, code.text);
          finishedCodeBlock(parent, lang, code.text, info);
        }
        break;
      }
      case "blockquote": {
        const quote = el("blockquote");
        renderBlocks((token as Tokens.Blockquote).tokens, quote, false, highlight);
        parent.appendChild(quote);
        break;
      }
      case "list":
        parent.appendChild(renderList(token as Tokens.List, highlight));
        break;
      case "table":
        parent.appendChild(renderTable(token as Tokens.Table));
        break;
      case "hr":
        parent.appendChild(el("hr"));
        break;
      case "math":
        if (mathRendering()) parent.appendChild(renderMath((token as unknown as MathToken).text, true));
        else {
          const p = el("p");
          p.textContent = token.raw.trim();
          parent.appendChild(p);
        }
        break;
      default: {
        // Block HTML and anything unknown: literal source, in a code-styled block.
        const pre = el("pre", "md-raw");
        pre.textContent = token.raw;
        parent.appendChild(pre);
      }
    }
  }
}

// Delegated, so a thousand code blocks are not a thousand listeners.
export function handleCopyClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (target.classList.contains("md-open")) {
    const block = target.closest<HTMLElement>(".md-code");
    if (block) openCodeBlock(block);
    return;
  }
  if (!target.classList.contains("md-copy")) return;
  const block = target.closest<HTMLElement>(".md-code");
  const code = block?.querySelector("code");
  if (!code) return;
  const text = block!.dataset.shell ? shellCommand(code.textContent ?? "") : (code.textContent ?? "");
  void navigator.clipboard?.writeText(text).then(() => {
    target.textContent = t("Kopiert");
    target.dataset.done = ""; // the check in styles/motion.css
    setTimeout(() => {
      target.textContent = t("Kopier");
      delete target.dataset.done;
    }, 1200);
  }).catch(() => undefined);
}
