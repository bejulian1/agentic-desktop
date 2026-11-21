// Round 15 (SPEC 31.1): the artifact box. A whole one-file app in an answer, in HTML or React (JSX
// or TSX), is not a long block of code in the conversation but a calm box with an icon, its name,
// its kind and its number of lines. A click opens it in the artifact panel (ui/ArtifactPanel.tsx)
// with Forhåndsvisning and Kode. While the answer streams, the box shows that the app is being
// written. When the model writes the same app again later in the thread, the boxes say which
// version they are. It replaces the HTML card of SPEC 14.3, so there is one pattern, not two.
//
// Plain DOM, like the Markdown it sits in. The app's code never runs here: only in the panel's
// iframe on the preview server's origin.
import { plural, t } from "../lib/i18n";
import { app } from "../state/app";
import { focusedThreadId } from "../state/actions";
import { onArtifactsChanged, savedArtifactFor } from "../state/artifacts";
import { artifactPanel, noteArtifactWritten, onShownVersion, openArtifactPanel, shownVersion } from "../state/artifact-panel";
import { artifactDisplayTitle, artifactDoc, artifactLangOf, defaultArtifactTitle, fileFromInfo, lineCount, versionsIn, type ArtifactDoc } from "./artifact-detect";
import { setCodeBlockHook } from "./render";

const NS = "http://www.w3.org/2000/svg";

interface Box {
  root: HTMLElement;
  button: HTMLButtonElement;
  meta: HTMLElement;
  version: HTMLElement;
  saved: HTMLElement;
  doc: ArtifactDoc;
}

const boxes = new Map<Element, Box>();
let observer: IntersectionObserver | null = null;

export const kindLabel = (lang: string) => (artifactLangOf(lang) === "html" ? "HTML" : "React");
export const artifactLineLabel = (lang: string, count: number) =>
  plural(count, "{kind} · {count} linje", "{kind} · {count} linjer", { kind: kindLabel(lang) });

function svg(paths: string[], extra?: (svg: SVGSVGElement) => void): SVGSVGElement {
  const node = document.createElementNS(NS, "svg");
  for (const [name, value] of Object.entries({ class: "icon", width: "18", height: "18", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.4", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
    node.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    node.appendChild(path);
  }
  extra?.(node);
  return node;
}

// HTML: a page in a window. React: a component, brackets around a slash. Our own, no logos.
export function kindIcon(lang: string): SVGSVGElement {
  if (artifactLangOf(lang) === "html") {
    return svg(["M2.5 4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z", "M2.5 6h11", "M4.6 4.5h.01M6.1 4.5h.01", "M5.5 8.5h5M5.5 10.5h3"]);
  }
  return svg(["M5.5 5 2.75 8 5.5 11", "M10.5 5l2.75 3-2.75 3", "M9 4.25 7 11.75"]);
}

function chevron(): SVGSVGElement {
  const node = svg(["m6 4 4 4-4 4"]);
  node.setAttribute("width", "14");
  node.setAttribute("height", "14");
  return node;
}

function span(className: string, text?: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The parts every box has, also the one that is still being written.
function frame(lang: string, title: string): { root: HTMLElement; button: HTMLButtonElement; titleEl: HTMLElement; meta: HTMLElement; version: HTMLElement; saved: HTMLElement } {
  const root = document.createElement("div");
  root.className = "artifact-box";
  root.dataset.artifactBox = "";
  root.dataset.lang = artifactLangOf(lang) ?? lang;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "artifact-box-main";
  const icon = span("artifact-box-icon");
  icon.appendChild(kindIcon(lang));
  const text = span("artifact-box-text");
  const titleEl = span("artifact-box-title", title);
  const meta = span("artifact-box-meta");
  text.append(titleEl, meta);
  const version = span("artifact-box-version");
  version.hidden = true;
  const saved = span("artifact-box-saved", t("Lagret"));
  saved.hidden = true;
  const go = span("artifact-box-go");
  go.append(span("artifact-box-go-label", t("Åpne")), chevron());
  button.append(icon, text, version, saved, go);
  root.appendChild(button);
  return { root, button, titleEl, meta, version, saved };
}

// The box while the block is still streaming: no click, the lines counting up.
export interface WritingBox {
  root: HTMLElement;
  update(text: string): void;
}

export function createWritingBox(lang: string, info: string): WritingBox {
  const file = fileFromInfo(info);
  const parts = frame(lang, file?.replace(/\.(html?|jsx|tsx)$/i, "") || defaultArtifactTitle(artifactLangOf(lang) ?? "jsx"));
  parts.root.classList.add("writing");
  parts.root.setAttribute("aria-busy", "true");
  parts.button.disabled = true;
  parts.button.setAttribute("aria-label", t("Skriver en {kind}-app", { kind: kindLabel(lang) }));
  parts.root.querySelector(".artifact-box-go")!.replaceChildren(span("artifact-box-spinner"));
  let lines = -1;
  let titled = false;
  return {
    root: parts.root,
    update(text: string) {
      const count = lineCount(text);
      if (count !== lines) {
        lines = count;
        parts.meta.textContent = plural(count, "Skriver {kind} · {count} linje", "Skriver {kind} · {count} linjer", { kind: kindLabel(lang) });
      }
      // The name, as soon as the <title> or the component is there.
      if (!titled) {
        const name = lang === "html"
          ? /<title[^>]*>([^<]+)<\/title>/i.exec(text)?.[1]?.trim()
          : /\bexport\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(text)?.[1];
        if (name && name !== "App") {
          parts.titleEl.textContent = name.slice(0, 80);
          titled = true;
        }
      }
    },
  };
}

// Where the block lives: the message row and the pane's thread.
function context(box: Box): { messageId: string | null; threadId: string | null } {
  const row = box.root.closest<HTMLElement>("[data-message-id]");
  const pane = box.root.closest<HTMLElement>("[data-thread-id]");
  return { messageId: row?.dataset.messageId ?? null, threadId: pane?.dataset.threadId ?? null };
}

function refresh(box: Box): void {
  const { messageId, threadId } = context(box);
  box.doc.messageId = messageId;
  // Which version this is, among the apps with the same name in the thread.
  const versions = threadId ? versionsIn(threadId, box.doc.key) : [];
  const at = versions.findIndex((v) => v.messageId === messageId && v.sourceKey === box.doc.sourceKey);
  const many = versions.length > 1 && at >= 0;
  box.version.hidden = !many;
  if (many) {
    box.version.textContent = `v${at + 1}`;
    box.version.title = t("Versjon {current} av {total}", { current: at + 1, total: versions.length });
  }
  const saved = savedArtifactFor(messageId, box.doc.sourceKey);
  box.saved.hidden = !saved;
  box.saved.title = saved ? t("Lagret i Artifacts som «{title}»", { title: saved.title }) : "";
  const shown = shownVersion();
  const active = !!shown && shown.sourceKey === box.doc.sourceKey && shown.messageId === messageId;
  box.root.classList.toggle("active", active);
  box.button.setAttribute("aria-expanded", String(active));
  const description = { title: artifactDisplayTitle(box.doc), kind: kindLabel(box.doc.lang), lines: lineCount(box.doc.code) };
  box.button.setAttribute("aria-label", many
    ? t("Åpne {title}, {kind}-app med {lines} linjer, versjon {current} av {total}", { ...description, current: at + 1, total: versions.length })
    : t("Åpne {title}, {kind}-app med {lines} linjer", description));
}

function open(box: Box): void {
  const { threadId } = context(box);
  refresh(box);
  openArtifactPanel(threadId, { ...box.doc }, { opener: box.root, focus: true });
}

// Opens by itself once, when the model has just written it in a chat in front of you, the setting
// is on and the window is wide enough to have the panel beside the conversation. Never in Kode,
// where the right side is the tool panel's, and a box waits for a click.
const autoOpened = new Set<string>();
const wide = matchMedia("(min-width: 861px)");

function maybeOpen(box: Box): void {
  const { messageId, threadId } = context(box);
  const id = `${messageId}:${box.doc.sourceKey}`;
  if (!messageId || !threadId || autoOpened.has(id)) return;
  autoOpened.add(id);
  if (app.settings.artifactPreview === false || !wide.matches || threadId !== focusedThreadId()) return;
  if (app.threads[threadId]?.mode !== "chat") return;
  // Not over an app the user opened in another thread.
  const current = artifactPanel();
  if (current && current.threadId !== threadId) return;
  openArtifactPanel(threadId, { ...box.doc, messageId }, { focus: false, opener: box.root });
}

function createBox(parent: Node, lang: string, info: string, text: string, live: boolean): void {
  const doc = artifactDoc(lang, info, text, null);
  if (!doc) return;
  const parts = frame(lang, artifactDisplayTitle(doc));
  parts.meta.textContent = artifactLineLabel(lang, lineCount(text));
  const box: Box = { root: parts.root, button: parts.button, meta: parts.meta, version: parts.version, saved: parts.saved, doc };
  if (doc.file) parts.root.title = doc.file;

  // The code is in the panel, not in the conversation: the block goes, the box takes its place.
  const source = (parent as Element).lastElementChild;
  if (source?.classList.contains("md-code")) source.replaceWith(parts.root);
  else parent.appendChild(parts.root);

  boxes.set(parts.root, box);
  parts.button.addEventListener("click", () => open(box));
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const found = boxes.get(entry.target);
      if (found && entry.isIntersecting) refresh(found);
    }
  }, { rootMargin: "200px 0px" });
  observer.observe(parts.root);

  if (live && parts.root.isConnected) {
    // A new version: the boxes before it in the thread now say which they are.
    noteArtifactWritten();
    for (const other of boxes.values()) if (other.doc.key === doc.key && other !== box) refresh(other);
    refresh(box);
    maybeOpen(box);
  }
}

// Called when a message row goes away: its boxes go too.
export function disposeArtifactBoxes(container: Element): void {
  for (const element of container.querySelectorAll(".artifact-box")) {
    if (!boxes.delete(element)) continue;
    observer?.unobserve(element);
  }
}

let installed = false;

export function installArtifactBoxes(): void {
  if (installed) return;
  installed = true;
  setCodeBlockHook((parent, lang, text, info, live) => createBox(parent, lang, info, text, live));
  const refreshAll = () => {
    for (const box of boxes.values()) if (box.root.isConnected) refresh(box);
  };
  onArtifactsChanged(refreshAll);
  onShownVersion(refreshAll);
}
