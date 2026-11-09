// Round 15 (SPEC 31.2): runs inside the React preview, a sandboxed iframe with an opaque origin on
// the preview server. It never runs in the app. It reads the file from the page, makes JavaScript
// of the JSX and TypeScript with Sucrase, checks that the file imports nothing but React, and
// renders its default export. Whatever goes wrong is shown as a calm message in the frame instead
// of a white page: code that cannot be read, a package that is not here, a file that exports no
// component, and errors while the app runs.
//
// Built by web/vite-preview-runtime.ts into preview-runtime/boot.js. "react" and "react-dom/client"
// here are the same modules the import map gives the app's own code, so there is one React.
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { transform } from "sucrase";

interface Source {
  lang: "jsx" | "tsx";
  code: string;
}

const ALLOWED = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];

// ---------------------------------------------------------------------------------------------
// Messages. In a shadow root of their own, so the app's CSS can neither hide nor restyle them.

const dark = /(?:^|[#&])tema=mork(?:&|$)/.test(location.hash);

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  --bg: #ffffff; --card: #ffffff; --line: rgba(20,20,18,.1); --text: #1b1b1a; --text-2: #4f4f49; --text-3: #6b6b64;
  --code: #f4f4f3; --mark: #c43a2f; --mark-soft: #fdecea; --info: #2160d4; --info-soft: rgba(47,111,228,.1);
  font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif;
  color: var(--text); -webkit-font-smoothing: antialiased;
}
.wrap.dark {
  --bg: #1b1b1b; --card: #242425; --line: rgba(255,255,255,.1); --text: #ececec; --text-2: #b4b4b2; --text-3: #9d9d9a;
  --code: #2b2b2c; --mark: #f0857a; --mark-soft: #3d2624; --info: #78acff; --info-soft: rgba(61,139,253,.16);
}
.full { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 24px; background: var(--bg); overflow: auto; }
.card { width: min(100%, 560px); background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px 20px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.head { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; }
.badge { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 999px; background: var(--mark-soft); color: var(--mark); }
.wrap[data-kind="import"] .badge, .wrap[data-kind="export"] .badge { background: var(--info-soft); color: var(--info); }
h1 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.005em; }
p { margin: 0 0 12px 34px; color: var(--text-2); text-wrap: pretty; }
.where { margin: 0 0 6px 34px; font-size: 12px; color: var(--text-3); }
pre { margin: 0 0 0 34px; padding: 10px 12px; border-radius: 8px; background: var(--code); color: var(--text); font: 12px/1.5 ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow: auto; }
pre.lines { padding: 8px 0; white-space: pre; overflow-wrap: normal; }
pre .row { display: flex; gap: 14px; padding: 0 12px; min-width: max-content; }
pre .no { flex: none; color: var(--text-3); user-select: none; }
pre .hit { background: var(--mark-soft); box-shadow: inset 2px 0 var(--mark); }
pre .hit .no { color: var(--mark); }
code { font: 12px ui-monospace, "SF Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace; padding: 1px 5px; border-radius: 4px; background: var(--code); color: var(--text); }
.bar { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 2147483647; display: flex; align-items: flex-start; gap: 10px; padding: 10px 10px 10px 14px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.12); }
.bar .text { flex: 1; min-width: 0; }
.bar strong { font-weight: 600; margin-right: 6px; }
.bar span { color: var(--text-2); overflow-wrap: anywhere; }
.bar button { flex: none; border: 0; background: transparent; color: var(--text-3); width: 24px; height: 24px; border-radius: 6px; cursor: pointer; display: grid; place-items: center; }
.bar button:hover { background: var(--code); color: var(--text); }
.bar button:focus-visible { outline: 2px solid var(--info); outline-offset: 1px; }
`;

type Kind = "syntax" | "import" | "export" | "runtime";

interface Message {
  kind: Kind;
  title: string;
  text: string;
  line?: number; // 1-based, in the file as written
  detail?: string; // the error's own words
}

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;

function surface(): ShadowRoot {
  if (!host || !host.isConnected) {
    host = document.createElement("ad-forhandsvisning");
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
  }
  return shadow!;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A small mark in the badge: ! for errors, i for what is not here.
function badge(kind: Kind): HTMLElement {
  const node = el("span", "badge");
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = kind === "import" || kind === "export"
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 7.2v4"/><circle cx="8" cy="4.6" r=".4" fill="currentColor"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 4.2v4.6"/><circle cx="8" cy="11.4" r=".4" fill="currentColor"/></svg>';
  return node;
}

// The lines around the one that failed, numbered, with that one marked by a soft band.
function excerpt(code: string, line: number): HTMLElement {
  const lines = code.split("\n");
  const pre = el("pre", "lines");
  const from = Math.max(1, line - 2);
  const to = Math.min(lines.length, line + 2);
  const width = String(to).length;
  for (let n = from; n <= to; n++) {
    const row = el("div", n === line ? "row hit" : "row");
    row.append(el("span", "no", String(n).padStart(width)), el("span", "src", lines[n - 1] || " "));
    pre.appendChild(row);
  }
  return pre;
}

let source: Source = { lang: "jsx", code: "" };

function showFull(message: Message): void {
  const root = surface();
  const wrap = el("div", `wrap full${dark ? " dark" : ""}`);
  wrap.dataset.kind = message.kind;
  wrap.setAttribute("role", "alert");
  const card = el("div", "card");
  const head = el("div", "head");
  head.append(badge(message.kind), el("h1", undefined, message.title));
  card.append(head, el("p", undefined, message.text));
  if (message.line && message.line <= source.code.split("\n").length) {
    card.append(el("div", "where", `Linje ${message.line}${message.detail ? `: ${message.detail}` : ""}`), excerpt(source.code, message.line));
  } else if (message.detail) {
    card.append(el("pre", undefined, message.detail));
  }
  wrap.appendChild(card);
  const style = el("style", undefined, STYLE);
  root.replaceChildren(style, wrap);
  document.documentElement.dataset.adMelding = message.kind; // for the tests
}

// An error that did not stop the app, such as one in a click handler: a bar at the bottom that
// can be closed. A new one replaces it.
function showBar(detail: string): void {
  if (document.documentElement.dataset.adMelding && document.documentElement.dataset.adMelding !== "bar") return;
  const root = surface();
  const wrap = el("div", `wrap${dark ? " dark" : ""}`);
  const bar = el("div", "bar");
  bar.setAttribute("role", "status");
  const text = el("div", "text");
  text.append(el("strong", undefined, "Feil i appen"), el("span", undefined, detail));
  const close = el("button");
  close.type = "button";
  close.title = "Lukk";
  close.setAttribute("aria-label", "Lukk meldingen");
  close.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  close.addEventListener("click", () => {
    root.replaceChildren();
    delete document.documentElement.dataset.adMelding;
  });
  bar.append(text, close);
  wrap.appendChild(bar);
  root.replaceChildren(el("style", undefined, STYLE), wrap);
  document.documentElement.dataset.adMelding = "bar";
}

// ---------------------------------------------------------------------------------------------
// The code

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name && error.name !== "Error" ? `${error.name}: ` : ""}${error.message}`.slice(0, 400);
  return String(error).slice(0, 400);
}

// The line in the file, from a stack that runs through the module's blob URL. Sucrase keeps the
// line breaks where they were, so the line is the same in what was written.
let moduleUrl = "";
function lineOf(error: unknown): number | undefined {
  const stack = error instanceof Error ? error.stack ?? "" : "";
  if (!moduleUrl) return undefined;
  const at = stack.indexOf(moduleUrl);
  if (at < 0) return undefined;
  const match = /^:(\d+):\d+/.exec(stack.slice(at + moduleUrl.length));
  return match ? Number(match[1]) : undefined;
}

// Every module the file asks for: import … from, bare import, export … from, and import().
export function importsOf(code: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:^|[;\n}])\s*import\s+(?:[\w$*{},\s]+?\s+from\s*)?["']([^"'\n]+)["']/g,
    /(?:^|[;\n}])\s*export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of code.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function checkImports(code: string): Message | null {
  for (const specifier of importsOf(code)) {
    if (ALLOWED.includes(specifier)) continue;
    if (/^(\.|\/|https?:)/.test(specifier)) {
      return {
        kind: "import",
        title: "Appen må være én fil",
        text: `Fila importerer «${specifier}», som ligger utenfor den. Forhåndsvisningen kjører én fil og henter ingenting annet, så koden derfra må stå i denne fila.`,
      };
    }
    const name = packageName(specifier);
    return {
      kind: "import",
      title: `Pakken «${name}» finnes ikke her`,
      text: name === "react" || name === "react-dom"
        ? `Forhåndsvisningen har react, react-dom og react-dom/client, men ikke «${specifier}».`
        : `Forhåndsvisningen har bare react og react-dom, og den henter ingenting fra nettet. Be om en versjon av appen uten «${name}», eller skriv den delen selv.`,
    };
  }
  return null;
}

// The component: the default export, or else the one exported function whose name starts with a
// capital letter.
function componentOf(module: Record<string, unknown>): ComponentType | null {
  const pick = module.default;
  if (typeof pick === "function" || (pick && typeof pick === "object" && "$$typeof" in pick)) return pick as ComponentType;
  const named = Object.entries(module).filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function");
  return named.length === 1 ? (named[0][1] as ComponentType) : null;
}

async function run(): Promise<void> {
  const data = document.getElementById("ad-kilde");
  try {
    source = JSON.parse(data?.textContent ?? "") as Source;
  } catch {
    return showFull({ kind: "runtime", title: "Fant ingen kode", text: "Forhåndsvisningen fikk ingen fil å vise. Last inn på nytt." });
  }

  let js: string;
  try {
    js = transform(source.code, {
      transforms: source.lang === "tsx" ? ["typescript", "jsx"] : ["jsx"],
      jsxRuntime: "automatic",
      production: true,
      disableESTransforms: true,
    }).code;
  } catch (error) {
    const loc = (error as { loc?: { line: number } }).loc;
    const detail = (error as Error).message?.replace(/\s*\(\d+:\d+\)\s*$/, "");
    return showFull({
      kind: "syntax",
      title: "Koden kan ikke leses",
      text: source.lang === "tsx" ? "Det er en feil i JSX- eller TypeScript-koden, så appen kan ikke starte." : "Det er en feil i JSX-koden, så appen kan ikke starte.",
      line: loc?.line,
      detail: detail || describe(error),
    });
  }

  const blocked = checkImports(js);
  if (blocked) return showFull(blocked);

  addEventListener("error", (event) => {
    if (event.error === undefined && !event.message) return; // a resource that did not load
    showBar(describe(event.error ?? event.message));
  });
  addEventListener("unhandledrejection", (event) => showBar(describe(event.reason)));

  moduleUrl = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  let module: Record<string, unknown>;
  try {
    module = await import(/* @vite-ignore */ moduleUrl);
  } catch (error) {
    const missing = /Failed to resolve module specifier ["']([^"']+)["']/.exec(String((error as Error)?.message));
    if (missing) {
      const blockedLate = checkImports(`import "${missing[1]}"`);
      if (blockedLate) return showFull(blockedLate);
    }
    return showFull({ kind: "runtime", title: "Appen stoppet før den startet", text: "Koden kastet en feil da fila ble lastet.", line: lineOf(error), detail: describe(error) });
  }

  const component = componentOf(module);
  const mount = document.getElementById("root")!;
  if (!component) {
    // Some files render themselves with createRoot. Then there is nothing to do.
    if (/\bcreateRoot\s*\(|\bhydrateRoot\s*\(/.test(js)) return;
    return showFull({
      kind: "export",
      title: "Fant ingen komponent å vise",
      text: "Fila må ha en React-komponent som default export, for eksempel export default function App() { … }.",
    });
  }
  const root = createRoot(mount, {
    onUncaughtError(error) {
      showFull({ kind: "runtime", title: "Appen stoppet med en feil", text: "En komponent kastet en feil mens den ble vist, så React tok den ned.", line: lineOf(error), detail: describe(error) });
    },
  });
  root.render(createElement(component));
}

void run();
