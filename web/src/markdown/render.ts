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
// Smart links and file chips (v1.2.0). Everything is built as DOM nodes, never as HTML text, so a
// link or a file name from the model cannot add markup. SVG needs its own namespace.
const SVG_NS = "http://www.w3.org/2000/svg";

interface IconPart { tag: "path" | "circle"; attrs: Record<string, string> }
const ICONS: Record<"github" | "pull" | "issue" | "link", { fill: boolean; parts: IconPart[] }> = {
  // The GitHub mark, filled.
  github: { fill: true, parts: [{ tag: "path", attrs: { d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" } }] },
  // A pull request: two ends joined by a line, and the arrow into the branch.
  pull: { fill: false, parts: [
    { tag: "circle", attrs: { cx: "4", cy: "3.5", r: "1.75" } },
    { tag: "circle", attrs: { cx: "4", cy: "12.5", r: "1.75" } },
    { tag: "circle", attrs: { cx: "12", cy: "12.5", r: "1.75" } },
    { tag: "path", attrs: { d: "M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H8.5M10 2.5 8.5 4.5 10 6.5" } },
  ] },
  // An issue: a ring with a dot.
  issue: { fill: false, parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.25" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.25", fill: "currentColor", stroke: "none" } },
  ] },
  // A globe, for other web addresses.
  link: { fill: false, parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.25" } },
    { tag: "path", attrs: { d: "M1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.3 8 14.25C6.2 12.3 5.3 10.2 5.3 8S6.2 3.45 8 1.75z" } },
  ] },
};

function svgIcon(kind: keyof typeof ICONS): SVGSVGElement {
  const icon = ICONS[kind];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "md-link-icon");
  if (icon.fill) svg.setAttribute("fill", "currentColor");
  else {
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
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

// Gives a link the look of a chip when it is one of the ones worth it, and returns true when it
// also wrote the label. Others stay plain links.
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
  if (bare && /^https?:/i.test(href)) {
    anchor.className = "md-link-chip";
    anchor.title = where;
    anchor.append(svgIcon("link"));
    const label = el("span", "md-link-label");
    label.textContent = shortUrl(href);
    anchor.append(label);
    return true;
  }
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
