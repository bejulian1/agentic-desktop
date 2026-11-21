// The mini editor (round 8, agent G): a small editor in the style of a code editor's peek window,
// not an IDE. It opens over the app from a code block, a file path in a tool row, or a file in
// Endringer. Syntax colours and line numbers, search, go to line, an outline of functions and
// classes, what the thread changed in the file, and Kopier, Åpne i Filer and Spør om dette.
//
// Only project files can be edited. Saving goes through PUT /api/projects/:id/file, which uses the
// same path checks as the agent, refuses protected files, waits for the agent's own writes to the
// file, and refuses when the file changed on disk since it was opened (409).
//
// This module is a chunk of its own with CodeMirror in it. ./MiniEditorHooks is the light half.
import { lookupMessage, plural, t } from "../lib/i18n";
import { Annotation, ChangeSet, Compartment, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, Text, type Extension, type RangeSet, type Transaction } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, gutter, GutterMarker, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import type { EditableFile, TurnDiff } from "../../../shared/protocol";
import { ApiError, get, put } from "../lib/api";
import { diffLines, hunks, type DiffLine } from "../lib/diff";
import { outline, symbolAt, type OutlineItem, type SymbolKind } from "../lib/outline";
import { on } from "../lib/socket";
import { app, report, toast } from "../state/app";
import { requestFile } from "../state/nav";
import { showPanel } from "../state/panel";
import { peekModel } from "../state/thread-model";
import { confirmDialog } from "./dialogs";
import { IconCheck, IconClose, IconCopy, IconDiff, IconFile, IconFolderOpen, IconList, IconSearch, IconChat, IconChevronDown } from "./icons";
import type { EditorRequest } from "./MiniEditorHooks";

const MAX_MATCHES = 5000;
const GROUP_MS = 600;
const SNIPPET_ASK_LIMIT = 8000;

// 1. Languages, loaded on demand like in the Files panel.

interface Language {
  name: string;
  load: () => Promise<Extension>;
  outline: string;
}

function languageOf(nameOrPath: string): Language {
  const key = (nameOrPath.includes(".") ? nameOrPath.slice(nameOrPath.lastIndexOf(".") + 1) : nameOrPath).toLowerCase();
  const js = (o: { typescript?: boolean; jsx?: boolean }, name: string): Language => ({ name, outline: "js", load: async () => (await import("@codemirror/lang-javascript")).javascript(o) });
  switch (key) {
    case "js": case "mjs": case "cjs": case "javascript": return js({ jsx: true }, "JavaScript");
    case "jsx": return js({ jsx: true }, "JavaScript JSX");
    case "ts": case "mts": case "cts": case "typescript": return js({ typescript: true }, "TypeScript");
    case "tsx": return js({ typescript: true, jsx: true }, "TypeScript JSX");
    case "html": case "htm": case "svg": case "xml": case "vue": return { name: key === "svg" ? "SVG" : key === "xml" ? "XML" : "HTML", outline: "html", load: async () => (await import("@codemirror/lang-html")).html() };
    case "css": case "scss": case "less": return { name: key.toUpperCase(), outline: "css", load: async () => (await import("@codemirror/lang-css")).css() };
    case "json": case "jsonc": case "json5": return { name: "JSON", outline: "json", load: async () => (await import("@codemirror/lang-json")).json() };
    case "md": case "markdown": case "mdx": return { name: "Markdown", outline: "md", load: async () => (await import("@codemirror/lang-markdown")).markdown() };
    case "py": case "python": return { name: "Python", outline: "py", load: async () => (await import("@codemirror/lang-python")).python() };
    case "rs": case "rust": return { name: "Rust", outline: "rs", load: async () => (await import("@codemirror/lang-rust")).rust() };
    case "sh": case "bash": case "zsh": case "shell": return { name: "Shell", outline: "sh", load: async () => [] };
    case "go": return { name: "Go", outline: "go", load: async () => [] };
    default: return { get name() { return nameOrPath.includes(".") || !nameOrPath ? t("Ren tekst") : nameOrPath; }, outline: key, load: async () => [] };
  }
}

// 2. CodeMirror pieces: marks for search hits and flashes, and a gutter for changed lines.

const setMarks = StateEffect.define<DecorationSet>();
const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setMarks)) value = effect.value;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const setFlash = StateEffect.define<number | null>();
const flash = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setFlash)) continue;
      value = effect.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: "mini-flash" }).range(effect.value)]);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class ChangeMarker extends GutterMarker {
  kind: "add" | "mod" | "del";
  constructor(kind: "add" | "mod" | "del") {
    super();
    this.kind = kind;
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `mini-change ${this.kind}`;
    span.title = this.kind === "add" ? t("Ny linje") : this.kind === "mod" ? t("Endret linje") : t("Linjer fjernet her");
    return span;
  }
}
const MARKERS = { add: new ChangeMarker("add"), mod: new ChangeMarker("mod"), del: new ChangeMarker("del") };

const setChanges = StateEffect.define<RangeSet<GutterMarker>>();
const changes = StateField.define<RangeSet<GutterMarker>>({
  create: () => new RangeSetBuilder<GutterMarker>().finish(),
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setChanges)) value = effect.value;
    return value;
  },
});

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--code-font-size, 13px)", backgroundColor: "transparent", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { caretColor: "var(--text)", padding: "6px 0 24px" },
  ".cm-gutters": { backgroundColor: "var(--bg-panel)", color: "var(--text-3)", border: "none", borderRight: "1px solid var(--border)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "40px" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection)" },
  ".cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)" },
  ".cm-specialChar": { color: "var(--danger)" },
});

// Typing in one go is one step back, as in the artifact editor (@codemirror/commands is not installed).
// A reload from disk is marked with `external` and is not a step.
const external = Annotation.define<boolean>();

function createHistory() {
  type Step = { changes: ChangeSet; selection: EditorSelection };
  let undo: Step[] = [];
  let redo: Step[] = [];
  let lastAt = 0;
  let replaying = false;
  const record = (tr: Transaction) => {
    if (!tr.docChanged || replaying || tr.annotation(external)) return;
    const inverse = tr.changes.invert(tr.startState.doc);
    const now = Date.now();
    const last = undo.at(-1);
    if (last && now - lastAt < GROUP_MS) last.changes = inverse.compose(last.changes);
    else undo.push({ changes: inverse, selection: tr.startState.selection });
    if (undo.length > 500) undo = undo.slice(-500);
    lastAt = now;
    redo = [];
  };
  const replay = (back: boolean, view: EditorView) => {
    const from = back ? undo : redo;
    const to = back ? redo : undo;
    const step = from.pop();
    if (!step || view.state.readOnly) return true;
    to.push({ changes: step.changes.invert(view.state.doc), selection: view.state.selection });
    replaying = true;
    view.dispatch({ changes: step.changes, selection: step.selection, scrollIntoView: true });
    replaying = false;
    lastAt = 0;
    return true;
  };
  return {
    record,
    undo: (view: EditorView) => replay(true, view),
    redo: (view: EditorView) => replay(false, view),
    reset: () => {
      undo = [];
      redo = [];
    },
  };
}

function detectIndent(text: string, tabSize: number): string {
  const sample = text.slice(0, 200_000).split("\n", 2000);
  let tabs = 0;
  let two = 0;
  let four = 0;
  for (const line of sample) {
    if (line.startsWith("\t")) tabs++;
    else if (/^ {2}\S/.test(line)) two++;
    else if (/^ {4}\S/.test(line)) four++;
  }
  if (tabs > two + four) return "\t";
  if (two && two >= four / 2) return "  ";
  if (four) return "    ";
  return " ".repeat(tabSize);
}

// The changed lines of the current text against the text before the thread's turn.
function changeMarkers(doc: Text, lines: DiffLine[]): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  let lastLine = 0;
  let pendingDel = false;
  const add = (line: number, marker: GutterMarker) => {
    if (line <= lastLine || line > doc.lines) return;
    builder.add(doc.line(line).from, doc.line(line).from, marker);
    lastLine = line;
  };
  let nextNew = 1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "del") {
      pendingDel = true;
      continue;
    }
    if (l.kind === "add") {
      add(l.newLine!, pendingDel || lines[i + 1]?.kind === "del" ? MARKERS.mod : MARKERS.add);
      nextNew = l.newLine! + 1;
      if (lines[i + 1]?.kind !== "add") pendingDel = false;
      continue;
    }
    if (pendingDel) add(Math.max(1, l.newLine! - 1) === lastLine ? l.newLine! : Math.max(1, l.newLine! - 1), MARKERS.del);
    pendingDel = false;
    nextNew = l.newLine! + 1;
  }
  if (pendingDel) add(Math.min(doc.lines, Math.max(1, nextNew - 1)), MARKERS.del);
  return builder.finish();
}

// 3. Spør om dette: the selection as a quote in the message field of the pane it came from.

function fenceFor(text: string, lang: string): [string, string] {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return [`${fence}${lang}`, fence];
}

function composerFor(source: Element | null | undefined): HTMLTextAreaElement | null {
  const inPane = source?.closest(".pane-inner")?.querySelector<HTMLTextAreaElement>(".composer textarea");
  return inPane ?? document.querySelector<HTMLTextAreaElement>(".pane-inner.focused .composer textarea") ?? document.querySelector<HTMLTextAreaElement>(".composer textarea");
}

function putInComposer(textarea: HTMLTextAreaElement, text: string): void {
  const value = textarea.value;
  const glue = !value ? "" : value.endsWith("\n\n") ? "" : value.endsWith("\n") ? "\n" : "\n\n";
  textarea.setRangeText(glue + text, value.length, value.length, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

const KIND_LABEL: Record<SymbolKind, { glyph: string; label: string }> = {
  function: { glyph: "ƒ", get label() { return t("Funksjon"); } },
  method: { glyph: "m", get label() { return t("Metode"); } },
  class: { glyph: "C", get label() { return t("Klasse"); } },
  interface: { glyph: "I", get label() { return t("Grensesnitt"); } },
  type: { glyph: "T", get label() { return t("Type"); } },
  const: { glyph: "K", get label() { return t("Konstant"); } },
  heading: { glyph: "#", get label() { return t("Overskrift"); } },
  rule: { glyph: "{}", get label() { return t("Regel"); } },
};

const IconGoto = (p: { size?: number }) => (
  <svg class="icon" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10.5h11" />
  </svg>
);

// 4. The editor.

let active: { close: () => Promise<boolean> } | null = null;

export async function showMiniEditor(request: EditorRequest): Promise<void> {
  if (active && !(await active.close())) return;
  const host = document.createElement("div");
  document.body.append(host);
  let dispose = () => {};
  const done = () => {
    dispose();
    host.remove();
  };
  dispose = render(() => <MiniEditor request={request} onDone={done} register={(handle) => (active = handle)} />, host);
}

function MiniEditor(props: { request: EditorRequest; onDone: () => void; register: (handle: { close: () => Promise<boolean> }) => void }) {
  const req = props.request;
  const isFile = req.kind === "file";
  const path = (req.path ?? "").replace(/^(\.\/)+/, "");
  const name = () => isFile ? path.slice(path.lastIndexOf("/") + 1) : t("Kodeblokk");
  const dir = isFile && path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const language = languageOf(isFile ? path : req.lang ?? "");
  const narrow = matchMedia("(max-width: 720px)");
  const fenceLang = (isFile ? (path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : "") : req.lang ?? "").replace(/[^\w+-]/g, "");

  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading");
  const [error, setError] = createSignal("");
  const [retryable, setRetryable] = createSignal(true); // a lost connection, not a file that cannot be shown
  const [file, setFile] = createSignal<EditableFile | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedNote, setSavedNote] = createSignal<"saved" | "inserted" | null>(null);
  const [conflict, setConflict] = createSignal<null | "changed" | "deleted">(null);
  const [before, setBefore] = createSignal<string | null | undefined>(undefined);
  const [mode, setMode] = createSignal<"file" | "diff">("file");
  // Shown by itself when the file has something to show and the window has room; a click decides after that.
  const [outlinePref, setOutlinePref] = createSignal<boolean | null>(null);
  const [narrowNow, setNarrowNow] = createSignal(narrow.matches);
  const [symbols, setSymbols] = createSignal<OutlineItem[]>([]);
  const showOutline = () => outlinePref() ?? (!narrowNow() && symbols().length > 0);
  const setShowOutline = (value: boolean) => setOutlinePref(value);
  const [cursor, setCursor] = createSignal({ line: 1, col: 1, chars: 0, lines: 0 });
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [matches, setMatches] = createSignal<Array<{ from: number; to: number }>>([]);
  const [current, setCurrent] = createSignal(-1);
  const [gotoOpen, setGotoOpen] = createSignal(false);
  const [gotoText, setGotoText] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [diffStats, setDiffStats] = createSignal<{ add: number; del: number } | null>(null);

  const editable = () => isFile && !!file()?.editable && conflict() !== "deleted";
  let dialog!: HTMLDialogElement;
  let host!: HTMLDivElement;
  let diffHost!: HTMLDivElement;
  let searchInput: HTMLInputElement | undefined;
  let gotoInput: HTMLInputElement | undefined;
  let view: EditorView | undefined;
  let diffView: EditorView | undefined;
  let saved = Text.empty;
  const readOnly = new Compartment();
  const languageSlot = new Compartment();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hist = createHistory();

  // Outline, diff markers and search hits follow the text a moment after typing stops.
  const refresh = () => {
    if (!view) return;
    const text = view.state.doc.toString();
    setSymbols(outline(text, language.outline));
    const b = before();
    if (b !== undefined) {
      const lines = diffLines(b, text);
      view.dispatch({ effects: setChanges.of(changeMarkers(view.state.doc, lines)) });
      setDiffStats({ add: lines.filter((l) => l.kind === "add").length, del: lines.filter((l) => l.kind === "del").length });
    }
    if (searchOpen() && query()) runSearch(false);
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  };

  const updateCursor = () => {
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    const chars = Math.abs(sel.to - sel.from);
    const lines = chars ? view.state.doc.lineAt(sel.to).number - view.state.doc.lineAt(sel.from).number + 1 : 0;
    setCursor({ line: line.number, col: sel.head - line.from + 1, chars, lines });
  };

  function jumpTo(line: number, col = 1, focus = true): void {
    if (!view) return;
    const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
    const pos = Math.min(target.from + Math.max(0, col - 1), target.to);
    view.dispatch({ selection: { anchor: pos }, effects: [EditorView.scrollIntoView(pos, { y: "center" }), setFlash.of(target.from)] });
    setTimeout(() => {
      if (!finished) view?.dispatch({ effects: setFlash.of(null) });
    }, 900);
    if (focus) view.focus();
  }

  // Search: every hit is marked, the current one stronger, and the count says where you are.
  function runSearch(move: boolean, step = 0): void {
    if (!view) return;
    const q = query();
    if (!q) {
      setMatches([]);
      setCurrent(-1);
      view.dispatch({ effects: setMarks.of(Decoration.none) });
      return;
    }
    const text = caseSensitive() ? view.state.doc.toString() : view.state.doc.toString().toLowerCase();
    const needle = caseSensitive() ? q : q.toLowerCase();
    const found: Array<{ from: number; to: number }> = [];
    for (let at = text.indexOf(needle); at !== -1 && found.length < MAX_MATCHES; at = text.indexOf(needle, at + Math.max(1, needle.length))) found.push({ from: at, to: at + needle.length });
    setMatches(found);
    let index = current();
    const head = view.state.selection.main.from;
    if (!found.length) index = -1;
    else if (step) index = (Math.max(0, index) + step + found.length) % found.length;
    else if (move || index < 0 || index >= found.length) index = Math.max(0, found.findIndex((m) => m.from >= head));
    setCurrent(index);
    view.dispatch({
      effects: setMarks.of(Decoration.set(found.map((m, i) => Decoration.mark({ class: i === index ? "mini-match current" : "mini-match" }).range(m.from, m.to)))),
      ...(found.length && (move || step) ? { selection: { anchor: found[index].from, head: found[index].to }, scrollIntoView: false } : {}),
    });
    if (found.length && (move || step)) view.dispatch({ effects: EditorView.scrollIntoView(found[index].from, { y: "center" }) });
  }

  const openSearch = () => {
    setGotoOpen(false);
    const sel = view?.state.selection.main;
    const picked = sel && !sel.empty ? view!.state.sliceDoc(sel.from, sel.to) : "";
    if (picked && !picked.includes("\n") && picked.length < 200) setQuery(picked);
    setSearchOpen(true);
    queueMicrotask(() => {
      searchInput?.focus();
      searchInput?.select();
      runSearch(true);
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    view?.dispatch({ effects: setMarks.of(Decoration.none) });
    view?.focus();
  };
  const openGoto = () => {
    setSearchOpen(false);
    view?.dispatch({ effects: setMarks.of(Decoration.none) });
    setGotoText("");
    setGotoOpen(true);
    queueMicrotask(() => gotoInput?.focus());
  };
  const submitGoto = () => {
    const m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(gotoText());
    if (!m || !view) return;
    setGotoOpen(false);
    jumpTo(Number(m[1]), m[2] ? Number(m[2]) : 1);
  };

  const selectionText = () => {
    if (!view) return "";
    const sel = view.state.selection.main;
    return view.state.sliceDoc(sel.from, sel.to);
  };

  const copy = async () => {
    const text = selectionText() || view?.state.doc.toString() || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast(t("Nettleseren tillot ikke å kopiere."), "info");
    }
  };

  const ask = async () => {
    if (!view) return;
    const sel = view.state.selection.main;
    let quote: string;
    if (!sel.empty) {
      const from = view.state.doc.lineAt(sel.from).number;
      // A selection that ends at the start of a line does not take that line with it.
      const last = view.state.doc.lineAt(sel.to);
      const to = sel.to === last.from && sel.to > sel.from ? last.number - 1 : last.number;
      const lines = from === to ? `linje ${from}` : `linje ${from}–${to}`;
      const text = view.state.sliceDoc(sel.from, sel.to).replace(/\s+$/, "");
      const [start, end] = fenceFor(text, fenceLang);
      quote = isFile ? `Om \`${path}\`, ${lines}:\n\n${start}\n${text}\n${end}\n\n` : `Om denne koden (${lines}):\n\n${start}\n${text}\n${end}\n\n`;
    } else if (isFile) {
      quote = `Om \`${path}\`: `;
    } else {
      const text = view.state.doc.toString().replace(/\s+$/, "").slice(0, SNIPPET_ASK_LIMIT);
      const [start, end] = fenceFor(text, fenceLang);
      quote = `Om denne koden:\n\n${start}\n${text}\n${end}\n\n`;
    }
    const textarea = composerFor(req.source);
    if (!textarea) return toast(t("Fant ikke meldingsfeltet. Åpne en tråd først."), "info");
    if (dirty()) {
      putInComposer(textarea, quote);
      setSavedNote("inserted");
      return;
    }
    finish();
    putInComposer(textarea, quote);
    textarea.focus();
  };

  const openInFiles = () => {
    if (!isFile || !req.projectId) return;
    void close().then((closed) => {
      if (!closed) return;
      showPanel("files");
      requestFile(req.projectId!, path);
    });
  };

  // 4a. Loading

  const load = async (): Promise<EditableFile | null> => {
    try {
      const loaded = await get<EditableFile>(`/api/projects/${req.projectId}/file/edit?path=${encodeURIComponent(path)}`);
      if (loaded.binary || loaded.text === null) {
        setRetryable(false);
        throw new Error(loaded.binary ? t("Binærfilen kan ikke vises her.") : (lookupMessage(loaded.reason) || t("Filen kan ikke vises her.")));
      }
      return loaded;
    } catch (err) {
      if (err instanceof ApiError) setRetryable(err.status === 0 || err.status >= 500);
      setError(err instanceof ApiError && err.status === 404 ? t("Fant ikke filen. Den kan være flyttet eller slettet.") : (err as Error).message);
      setStatus("error");
      return null;
    }
  };

  // What the thread changed in the file: the turn from Endringer, or the last turn that touched it.
  const loadBefore = async () => {
    if (!isFile) return;
    let turnId = req.turnId;
    if (!turnId && req.threadId) {
      const rows = peekModel(req.threadId)?.changes() ?? [];
      // Everything the thread did to the file: compare with the file before the first turn that touched it.
      turnId = rows.find((r) => !r.reverted && r.files.some((f) => f.path === path))?.turnId;
    }
    if (!turnId) return;
    try {
      const diff = await get<TurnDiff>(`/api/turns/${turnId}/diff`);
      const entry = diff.files.find((f) => f.path === path);
      if (entry) setBefore(entry.before ?? "");
    } catch {
      // No diff, no markers. The file itself still shows.
    }
  };

  const build = async (text: string, eol: "lf" | "crlf") => {
    const tabSize = app.settings.tabSize ?? 4;
    const separator = eol === "crlf" && !/(^|[^\r])\n/.test(text) ? "\r\n" : undefined;
    const state = EditorState.create({
      doc: text,
      selection: req.line ? undefined : { anchor: 0 },
      extensions: [
        lineNumbers(),
        gutter({ class: "mini-change-gutter", markers: (v) => v.state.field(changes) }),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(classHighlighter),
        languageSlot.of([]),
        readOnly.of([EditorState.readOnly.of(!editable()), EditorView.editable.of(true)]),
        EditorState.tabSize.of(tabSize),
        indentUnit.of(detectIndent(text, tabSize)),
        ...(separator ? [EditorState.lineSeparator.of(separator)] : []),
        ...(app.settings.wrapCode ? [EditorView.lineWrapping] : []),
        EditorView.contentAttributes.of({ "aria-label": isFile ? t("Innholdet i {path}", { path }) : t("Kodeblokken"), spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        marks,
        flash,
        changes,
        keymap.of([
          { key: "Mod-z", run: (v) => hist.undo(v), preventDefault: true },
          { key: "Mod-y", run: (v) => hist.redo(v), preventDefault: true },
          { key: "Mod-Shift-z", run: (v) => hist.redo(v), preventDefault: true },
          { key: "Mod-s", run: () => (void save(false), true), preventDefault: true },
          { key: "Mod-f", run: () => (openSearch(), true), preventDefault: true },
          { key: "Mod-g", run: () => (openGoto(), true), preventDefault: true },
          { key: "Ctrl-g", run: () => (openGoto(), true), preventDefault: true },
          { key: "Mod-a", run: (v) => (v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }), true) },
          {
            key: "Enter",
            run: (v) => {
              if (v.state.readOnly) return false;
              const line = v.state.doc.lineAt(v.state.selection.main.head);
              const indent = /^[ \t]*/.exec(line.text)![0];
              v.dispatch(v.state.replaceSelection(v.state.lineBreak + indent), { scrollIntoView: true, userEvent: "input" });
              return true;
            },
          },
          {
            key: "Tab",
            run: (v) => {
              if (v.state.readOnly) return false;
              v.dispatch(v.state.replaceSelection(v.state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" });
              return true;
            },
          },
          {
            key: "Shift-Tab",
            run: (v) => {
              if (v.state.readOnly) return false;
              const unit = v.state.facet(indentUnit);
              const line = v.state.doc.lineAt(v.state.selection.main.head);
              const cut = line.text.startsWith(unit) ? unit.length : /^[ \t]*/.exec(line.text)![0].length > 0 ? 1 : 0;
              if (cut) v.dispatch({ changes: { from: line.from, to: line.from + cut }, userEvent: "delete" });
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            for (const tr of update.transactions) hist.record(tr);
            setDirty(!update.state.doc.eq(saved));
            if (savedNote()) setSavedNote(null);
            later();
          }
          if (update.selectionSet || update.docChanged) updateCursor();
        }),
        theme,
      ],
    });
    saved = state.doc;
    view = new EditorView({ state, parent: host });
    setStatus("ready");
    updateCursor();
    refresh();
    if (req.line) jumpTo(req.line, 1, false);
    view.focus();
    const ext = await language.load().catch(() => [] as Extension);
    view?.dispatch({ effects: languageSlot.reconfigure(ext) });
  };

  // A newer copy from disk, when the file changed and nothing here is unsaved.
  const reloadFrom = (fresh: EditableFile) => {
    if (!view || fresh.text === null) return;
    const head = Math.min(view.state.selection.main.head, fresh.text.length);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: fresh.text }, selection: { anchor: Math.min(head, fresh.text.length) }, annotations: external.of(true) });
    saved = view.state.doc;
    hist.reset();
    setFile(fresh);
    setDirty(false);
    setConflict(null);
    view.dispatch({ effects: readOnly.reconfigure([EditorState.readOnly.of(!editable()), EditorView.editable.of(true)]) });
    refresh();
  };

  const reload = async () => {
    const fresh = await load();
    if (fresh) {
      if (status() === "error") setStatus("ready");
      reloadFrom(fresh);
      view?.focus(); // the banner with the button that was focused is gone
    }
  };

  const save = async (force: boolean) => {
    if (!view || !editable() || saving() || (!dirty() && !force)) return;
    setSaving(true);
    const text = view.state.doc.toString();
    try {
      const result = await put<EditableFile>(`/api/projects/${req.projectId}/file`, { path: file()?.path ?? path, text, hash: file()?.hash, force });
      saved = view.state.doc;
      setFile(result);
      setDirty(!view.state.doc.eq(saved));
      setConflict(null);
      setSavedNote("saved");
      setTimeout(() => setSavedNote((note) => (note === "saved" ? null : note)), 1600);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict("changed");
      else if (err instanceof ApiError && err.status === 404) setConflict("deleted");
      else report(err);
    } finally {
      setSaving(false);
    }
  };

  // 4b. Closing

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (active?.close === close) active = null;
    if (dialog.open) dialog.close();
    const back = req.source instanceof HTMLElement && req.source.isConnected ? req.source : null;
    props.onDone();
    back?.focus({ preventScroll: true });
  };
  async function close(): Promise<boolean> {
    if (dirty()) {
      const ok = await confirmDialog({ title: t("Forkaste endringene i {name}?", { name: name() }), text: t("Endringene er ikke lagret. Filen på disken er som før."), confirm: t("Forkast"), danger: true });
      if (!ok) return false;
    }
    finish();
    return true;
  }
  props.register({ close });

  const onCancel = (event: Event) => {
    event.preventDefault();
    if (searchOpen()) return closeSearch();
    if (gotoOpen()) {
      setGotoOpen(false);
      return view?.focus();
    }
    void close();
  };

  onMount(async () => {
    dialog.showModal();
    const stopNarrow = () => {
      setNarrowNow(narrow.matches);
      if (narrow.matches) setOutlinePref(null);
    };
    narrow.addEventListener("change", stopNarrow);
    onCleanup(() => narrow.removeEventListener("change", stopNarrow));
    if (isFile) {
      const stop = on("project.files-changed", ({ projectId, paths }) => {
        const rel = file()?.path ?? path;
        if (projectId !== req.projectId || saving() || !(paths.includes(rel) || paths.includes("."))) return;
        void get<EditableFile>(`/api/projects/${req.projectId}/file/edit?path=${encodeURIComponent(path)}`).then((fresh) => {
          if (fresh.hash === file()?.hash) return;
          if (dirty()) setConflict("changed");
          else reloadFrom(fresh);
        }).catch((err) => {
          if (err instanceof ApiError && err.status === 404) setConflict("deleted");
        });
      });
      onCleanup(stop);
      const [loaded] = await Promise.all([load(), loadBefore()]);
      if (!loaded || finished) return;
      setFile(loaded);
      await build(loaded.text ?? "", loaded.eol);
    } else {
      await build(req.text ?? "", "lf");
    }
  });

  onCleanup(() => {
    clearTimeout(timer);
    view?.destroy();
    diffView?.destroy();
    if (active?.close === close) active = null;
  });

  // 4c. The changes view: the file's hunks with their context, read only.
  const showDiff = async () => {
    if (!view || before() === undefined) return;
    setMode("diff");
    const lines = hunks(diffLines(before()!, view.state.doc.toString()));
    const numbers: string[] = [];
    const kinds: string[] = [];
    const text = lines.map((l) => {
      if (l.kind === "skip") {
        numbers.push("");
        kinds.push("skip");
        return plural(l.count, "⋯ {count} uendrede linje", "⋯ {count} uendrede linjer");
      }
      numbers.push(String(l.kind === "del" ? l.oldLine : l.newLine));
      kinds.push(l.kind);
      return l.text;
    }).join("\n");
    diffView?.destroy();
    const doc = Text.of(text.split("\n"));
    const builder = new RangeSetBuilder<Decoration>();
    kinds.forEach((kind, i) => {
      if (kind !== "same") builder.add(doc.line(i + 1).from, doc.line(i + 1).from, Decoration.line({ class: `mini-diff-${kind}` }));
    });
    const lineDecos = builder.finish();
    class Sign extends GutterMarker {
      sign: string;
      constructor(sign: string) {
        super();
        this.sign = sign;
      }
      toDOM() {
        return document.createTextNode(this.sign);
      }
    }
    const plus = new Sign("+");
    const minus = new Sign("−");
    diffView = new EditorView({
      parent: diffHost,
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers({ formatNumber: (n) => numbers[n - 1] ?? "" }),
          gutter({ class: "mini-sign-gutter", lineMarker: (v, line) => {
            const kind = kinds[v.state.doc.lineAt(line.from).number - 1];
            return kind === "add" ? plus : kind === "del" ? minus : null;
          } }),
          EditorState.readOnly.of(true),
          syntaxHighlighting(classHighlighter),
          await language.load().catch(() => [] as Extension),
          EditorView.decorations.of(lineDecos),
          EditorView.contentAttributes.of({ "aria-label": "Endringene i filen" }),
          theme,
        ],
      }),
    });
  };
  const showFile = () => {
    setMode("file");
    diffView?.destroy();
    diffView = undefined;
    queueMicrotask(() => view?.focus());
  };

  const activeSymbol = createMemo(() => symbolAt(symbols(), cursor().line));
  const shortcut = (keys: string) => (navigator.platform.startsWith("Mac") ? keys.replace("Ctrl", "⌘") : keys);

  return (
    <dialog
      ref={dialog}
      class="mini-editor"
      classList={{ narrow: narrowNow() }}
      aria-labelledby="mini-editor-title"
      data-testid="mini-editor"
      onCancel={onCancel}
      onClose={() => {
        // Chrome closes a dialog without asking when Esc is pressed again and again. Ask anyway.
        if (finished) return;
        if (!dirty()) return finish();
        dialog.showModal();
        void close();
      }}
      onClick={(e) => {
        if (e.target === dialog) void close(); // the backdrop
      }}
    >
      <header class="mini-head">
        <div class="mini-title" id="mini-editor-title" title={isFile ? path : undefined}>
          <span class="mini-file-icon"><IconFile size={15} /></span>
          <span class="mini-path"><Show when={dir}><span class="mini-dir">{dir}</span></Show><span class="mini-name">{name()}</span></span>
          <Show when={dirty()}><span class="mini-dirty" title={t("Ikke lagret")} aria-label={t("Ikke lagret")} /></Show>
          <Show when={!isFile || (file() && !file()!.editable)}>
            <span class="pill mini-pill" title={lookupMessage(file()?.reason) || t("Kodeblokker fra samtalen kan ikke lagres.")}>{t("Bare lesing")}</span>
          </Show>
        </div>
        <div class="mini-tools" role="toolbar" aria-label={t("Editorverktøy")}>
          <Show when={before() !== undefined}>
            <div class="segmented mini-modes" role="group" aria-label={t("Visning")}>
              <button type="button" class="segment" aria-pressed={mode() === "file"} onClick={showFile}>{t("Fil")}</button>
              <button type="button" class="segment" aria-pressed={mode() === "diff"} onClick={() => void showDiff()} title={t("Det tråden endret i filen")}>
                <IconDiff size={13} />{t("Endringer")}
              </button>
            </div>
          </Show>
          <button type="button" class="icon-button" classList={{ on: searchOpen() }} title={t("Søk ({shortcut})", { shortcut: shortcut("Ctrl+F") })} aria-label={t("Søk i filen")} disabled={mode() !== "file" || status() !== "ready"} onClick={() => (searchOpen() ? closeSearch() : openSearch())}><IconSearch size={15} /></button>
          <button type="button" class="icon-button" classList={{ on: gotoOpen() }} title={t("Gå til linje ({shortcut})", { shortcut: shortcut("Ctrl+G") })} aria-label={t("Gå til linje")} disabled={mode() !== "file" || status() !== "ready"} onClick={() => (gotoOpen() ? setGotoOpen(false) : openGoto())}><IconGoto size={15} /></button>
          <button type="button" class="icon-button" classList={{ on: showOutline() }} title={t("Oversikt over funksjoner og klasser")} aria-label={t("Oversikt")} aria-pressed={showOutline()} disabled={mode() !== "file"} onClick={() => setShowOutline(!showOutline())}><IconList size={15} /></button>
          <span class="mini-sep" aria-hidden="true" />
          <button type="button" class="btn btn-small btn-ghost mini-action" data-done={copied() ? "" : undefined} title={cursor().chars ? t("Kopier det som er valgt") : t("Kopier hele filen")} onClick={() => void copy()} disabled={status() !== "ready"}>
            <Show when={copied()} fallback={<IconCopy size={14} />}><IconCheck size={14} /></Show><span>{copied() ? t("Kopiert") : t("Kopier")}</span>
          </button>
          <Show when={isFile && req.projectId}>
            <button type="button" class="btn btn-small btn-ghost mini-action" title={t("Vis filen i Filer-panelet")} onClick={openInFiles}><IconFolderOpen size={14} /><span>{t("Åpne i Filer")}</span></button>
          </Show>
          <button type="button" class="btn btn-small btn-ghost mini-action" title={cursor().chars ? t("Legg det som er valgt i meldingsfeltet, som sitat") : isFile ? t("Nevn filen i meldingsfeltet") : t("Legg koden i meldingsfeltet, som sitat")} onClick={() => void ask()} disabled={status() !== "ready"}>
            <IconChat size={14} /><span>{t("Spør om dette")}</span>
          </button>
          <Show when={isFile && file()?.editable}>
            <button type="button" class="btn btn-small btn-primary mini-save" disabled={!dirty() || saving() || conflict() === "deleted"} title={t("Lagre ({shortcut})", { shortcut: shortcut("Ctrl+S") })} onClick={() => void save(false)}>
              {saving() ? t("Lagrer…") : t("Lagre")}
            </button>
          </Show>
          <button type="button" class="icon-button mini-close" title={t("Lukk (Esc)")} aria-label={t("Lukk editoren")} onClick={() => void close()}><IconClose size={15} /></button>
        </div>
      </header>

      <Show when={conflict()}>
        <div class="mini-banner" role="alert">
          <span>{conflict() === "deleted" ? t("Filen finnes ikke lenger på disken.") : t("Filen er endret på disken siden du åpnet den.")}</span>
          <Show when={conflict() === "changed"}>
            <button type="button" class="btn btn-small" onClick={() => void reload()}>{t("Last inn på nytt")}</button>
            <button type="button" class="btn btn-small btn-danger" onClick={() => void save(true)}>{t("Overskriv")}</button>
          </Show>
        </div>
      </Show>

      <div class="mini-body" classList={{ "with-outline": showOutline() && mode() === "file" }}>
        <Show when={showOutline() && mode() === "file"}>
          <nav class="mini-outline" aria-label={t("Oversikt")}>
            <div class="mini-outline-head">{t("Oversikt")}<Show when={symbols().length}><span class="count">{symbols().length}</span></Show></div>
            <Show when={status() === "ready"} fallback={<div class="skeleton-lines" aria-hidden="true"><span class="skeleton skeleton-line" /><span class="skeleton skeleton-line" /><span class="skeleton skeleton-line" /></div>}>
              <Show when={symbols().length} fallback={<p class="mini-outline-empty">{t("Fant ingen funksjoner, klasser eller overskrifter.")}</p>}>
                <ul class="mini-outline-list">
                  <For each={symbols()}>
                    {(item) => (
                      <li>
                        <button type="button" class="mini-symbol" classList={{ active: activeSymbol() === item }} style={`--depth:${Math.min(item.depth, 6)}`} title={t("{kind} på linje {line}", { kind: KIND_LABEL[item.kind].label, line: item.line })} onClick={() => jumpTo(item.line)}>
                          <span class="mini-kind" data-kind={item.kind} aria-hidden="true">{KIND_LABEL[item.kind].glyph}</span>
                          <span class="mini-symbol-name">{item.name}</span>
                          <span class="mini-symbol-line">{item.line}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </nav>
        </Show>

        <div class="mini-main">
          <Show when={searchOpen()}>
            <div class="mini-find" role="search">
              <IconSearch size={13} />
              <input
                ref={searchInput}
                class="mini-find-input"
                type="text"
                placeholder={t("Søk")}
                aria-label={t("Søk i filen")}
                spellcheck={false}
                value={query()}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setCurrent(-1);
                  runSearch(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runSearch(false, e.shiftKey ? -1 : 1);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    closeSearch();
                  }
                }}
              />
              <span class="mini-find-count" aria-live="polite">{query() ? (matches().length ? t("{index} av {total}", { index: current() + 1, total: matches().length >= MAX_MATCHES ? `${MAX_MATCHES}+` : matches().length }) : t("Ingen treff")) : ""}</span>
              <button type="button" class="icon-button mini-case" aria-pressed={caseSensitive()} title={t("Skill mellom store og små bokstaver")} aria-label={t("Skill mellom store og små bokstaver")} onClick={() => { setCaseSensitive(!caseSensitive()); runSearch(true); searchInput?.focus(); }}>Aa</button>
              <button type="button" class="icon-button" title={t("Forrige treff (Shift+Enter)")} aria-label={t("Forrige treff")} disabled={!matches().length} onClick={() => runSearch(false, -1)}><span class="mini-up"><IconChevronDown size={13} /></span></button>
              <button type="button" class="icon-button" title={t("Neste treff (Enter)")} aria-label={t("Neste treff")} disabled={!matches().length} onClick={() => runSearch(false, 1)}><IconChevronDown size={13} /></button>
              <button type="button" class="icon-button" title={t("Lukk søket (Esc)")} aria-label={t("Lukk søket")} onClick={closeSearch}><IconClose size={12} /></button>
            </div>
          </Show>
          <Show when={gotoOpen()}>
            <form class="mini-find mini-goto" onSubmit={(e) => { e.preventDefault(); submitGoto(); }}>
              <IconGoto size={13} />
              <input
                ref={gotoInput}
                class="mini-find-input"
                type="text"
                inputmode="numeric"
                placeholder={t("Linje (1–{max}), eller linje:kolonne", { max: view?.state.doc.lines ?? 1 })}
                aria-label={t("Gå til linje")}
                value={gotoText()}
                onInput={(e) => setGotoText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setGotoOpen(false);
                    view?.focus();
                  }
                }}
              />
              <button type="submit" class="btn btn-small" disabled={!/^\s*\d+\s*([:,]\s*\d+\s*)?$/.test(gotoText())}>{t("Gå")}</button>
            </form>
          </Show>
          <Show when={status() === "loading"}>
            <div class="mini-loading skeleton-lines" role="status"><span class="sr-only">{t("Laster filen")}</span>
              <For each={[1, 2, 3, 4, 5, 6]}>{() => <span class="skeleton skeleton-line" />}</For>
            </div>
          </Show>
          <Show when={status() === "error"}>
            <div class="mini-error" role="alert">
              <p>{error()}</p>
              <Show when={retryable()} fallback={<Show when={isFile && req.projectId}><button type="button" class="btn btn-small" onClick={openInFiles}>{t("Vis i Filer")}</button></Show>}>
                <button type="button" class="btn btn-small" onClick={() => void reload()}>{t("Prøv igjen")}</button>
              </Show>
            </div>
          </Show>
          <div class="mini-cm" ref={host} hidden={mode() !== "file" || status() !== "ready"} />
          <div class="mini-cm" ref={diffHost} hidden={mode() !== "diff"} />
        </div>
      </div>

      <footer class="mini-status">
        <Show when={status() === "ready"}>
          <span class="tabular">{t("Linje {line}, kolonne {column}", { line: cursor().line, column: cursor().col })}</span>
          <Show when={cursor().chars}><span class="tabular">{cursor().lines > 1 ? t("{count} linjer valgt", { count: cursor().lines }) : t("{count} tegn valgt", { count: cursor().chars })}</span></Show>
        </Show>
        <Show when={activeSymbol() && mode() === "file"}><span class="mini-status-symbol">{activeSymbol()!.name}</span></Show>
        <span class="spacer" />
        <Show when={savedNote()}><span class="mini-saved" role="status">{savedNote() === "saved" ? <><IconCheck size={12} />{t("Lagret")}</> : t("Lagt i meldingsfeltet. Lagre eller lukk editoren for å skrive videre.")}</span></Show>
        <Show when={diffStats() && (diffStats()!.add || diffStats()!.del)}>
          <span class="tabular" title={t("Endret av tråden, mot filen før endringene")}><span class="diff-add">+{diffStats()!.add}</span> <span class="diff-del">−{diffStats()!.del}</span></span>
        </Show>
        <span>{language.name}</span>
        <Show when={isFile && file()}><span>{file()!.eol === "crlf" ? "CRLF" : "LF"}</span></Show>
        <Show when={isFile && file() && !file()!.editable}><span>{lookupMessage(file()!.reason)}</span></Show>
      </footer>
    </dialog>
  );
}
