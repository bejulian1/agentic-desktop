import { Annotation, Compartment, EditorSelection, EditorState, Prec, type ChangeSet, type Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { languageFor } from "../panels/editor";

const external = Annotation.define<boolean>();
const MAX_MATCHES = 5000;

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--code-font-size, 13px)", color: "var(--code-fg, var(--text))", backgroundColor: "var(--code-bg, transparent)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto", lineHeight: "1.65" },
  ".cm-content": { padding: "12px 0 48px", caretColor: "var(--text)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-4)", border: "none", paddingRight: "10px" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { color: "var(--text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selection)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-matchingBracket": { backgroundColor: "var(--accent-soft)" },
});

type Step = { changes: ChangeSet; selection: EditorSelection };
export interface StudioEditorSession { state: EditorState; undo: Step[]; redo: Step[]; lastAt: number }
export interface StudioFindResult { count: number; index: number }
export interface StudioEditor {
  session: StudioEditorSession;
  replace(text: string): void;
  find(text: string, backwards?: boolean): StudioFindResult;
  focus(): void;
  destroy(): void;
}

export function createStudioEditor(parent: HTMLElement, options: {
  path: string;
  text: string;
  readOnly: boolean;
  tabSize: number;
  wrapCode?: boolean;
  session?: StudioEditorSession;
  onChange: (text: string) => void;
  onCursor: (line: number, column: number) => void;
  onSave: () => void;
  onSearch: () => void;
}): StudioEditor {
  const language = new Compartment();
  let alive = true;
  let replaying = false;
  let session: StudioEditorSession;

  const record = (tr: Transaction) => {
    if (!tr.docChanged || tr.annotation(external) || replaying) return;
    const inverse = tr.changes.invert(tr.startState.doc);
    const last = session.undo.at(-1);
    const now = Date.now();
    if (last && now - session.lastAt < 600 && tr.isUserEvent("input.type")) last.changes = inverse.compose(last.changes);
    else session.undo.push({ changes: inverse, selection: tr.startState.selection });
    if (session.undo.length > 200) session.undo.shift();
    session.redo = [];
    session.lastAt = now;
  };

  const replay = (back: boolean, view: EditorView) => {
    if (view.state.readOnly) return true;
    const from = back ? session.undo : session.redo;
    const to = back ? session.redo : session.undo;
    const step = from.pop();
    if (!step) return true;
    to.push({ changes: step.changes.invert(view.state.doc), selection: view.state.selection });
    replaying = true;
    try {
      view.dispatch({ changes: step.changes, selection: step.selection, scrollIntoView: true });
    } finally {
      replaying = false;
      session.lastAt = 0;
    }
    return true;
  };

  const unit = " ".repeat(options.tabSize);
  // Each mount installs fresh callbacks. Only the document/selection/history survive in its session.
  const previous = options.session;
  session = {
    state: EditorState.create({
      doc: previous?.state.doc.toString() ?? options.text,
      selection: previous?.state.selection,
      extensions: [
        EditorState.readOnly.of(options.readOnly),
        EditorView.editable.of(!options.readOnly),
        EditorState.tabSize.of(options.tabSize),
        indentUnit.of(unit),
        ...(options.wrapCode ? [EditorView.lineWrapping] : []),
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(classHighlighter),
        language.of([]),
        theme,
        EditorView.contentAttributes.of({
          "aria-label": `Rediger ${options.path}`,
          spellcheck: "false",
          autocorrect: "off",
          autocapitalize: "off",
        }),
        // Shift+Z can arrive with either case (keyboard layout or synthetic events). Handle the
        // history shortcut before CodeMirror's character keymap can match plain Mod-z.
        Prec.highest(EditorView.domEventHandlers({
          keydown: (event, view) => {
            const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
            if (!mod || event.altKey) return false;
            const logical = event.key.toLowerCase();
            const key = !logical || logical === "unidentified" ? event.code === "KeyZ" ? "z" : event.code === "KeyY" ? "y" : logical : logical;
            if (key === "z") {
              event.preventDefault();
              return replay(!event.shiftKey, view);
            }
            if (key === "y") {
              event.preventDefault();
              return replay(false, view);
            }
            return false;
          },
        })),
        keymap.of([
          { key: "Mod-s", run: () => (options.onSave(), true), preventDefault: true },
          { key: "Mod-f", run: () => (options.onSearch(), true), preventDefault: true },
          { key: "Mod-z", run: (v) => replay(true, v), preventDefault: true },
          { key: "Mod-y", run: (v) => replay(false, v), preventDefault: true },
          { key: "Mod-Shift-z", run: (v) => replay(false, v), preventDefault: true },
          { key: "Mod-a", run: (v) => (v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }), true) },
          {
            key: "Tab",
            run: (v) => {
              if (v.state.readOnly) return false;
              v.dispatch(v.state.replaceSelection(unit), { scrollIntoView: true, userEvent: "input" });
              return true;
            },
          },
          {
            key: "Shift-Tab",
            run: (v) => {
              if (v.state.readOnly) return false;
              const line = v.state.doc.lineAt(v.state.selection.main.head);
              const cut = line.text.startsWith(unit) ? unit.length : /^[ \t]+/.exec(line.text)?.[0] ? 1 : 0;
              if (cut) v.dispatch({ changes: { from: line.from, to: line.from + cut }, userEvent: "delete" });
              return true;
            },
          },
          {
            key: "Enter",
            run: (v) => {
              if (v.state.readOnly) return false;
              const head = v.state.selection.main.head;
              const line = v.state.doc.lineAt(head);
              const prefix = /^\s*/.exec(line.text)?.[0] ?? "";
              v.dispatch(v.state.replaceSelection("\n" + prefix), { scrollIntoView: true, userEvent: "input" });
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) record(tr);
          session.state = update.state;
          if (update.docChanged) options.onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            options.onCursor(line.number, head - line.from + 1);
          }
        }),
      ],
    }),
    undo: previous?.undo ?? [],
    redo: previous?.redo ?? [],
    lastAt: 0,
  };

  const view = new EditorView({ parent, state: session.state });
  void languageFor(options.path).then((extension) => {
    if (alive) view.dispatch({ effects: language.reconfigure(extension) });
  }).catch(() => undefined);

  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  options.onCursor(line.number, head - line.from + 1);

  return {
    session,
    replace(text) {
      session.undo = [];
      session.redo = [];
      session.lastAt = 0;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(view.state.selection.main.head, text.length) },
        annotations: external.of(true),
      });
    },
    find(text, backwards = false) {
      if (!text) return { count: 0, index: 0 };
      const source = view.state.doc.toString().toLocaleLowerCase();
      const query = text.toLocaleLowerCase();
      const matches: number[] = [];
      for (let at = source.indexOf(query); at !== -1 && matches.length < MAX_MATCHES; at = source.indexOf(query, at + Math.max(1, query.length))) {
        matches.push(at);
      }
      if (!matches.length) return { count: 0, index: 0 };
      const selection = view.state.selection.main;
      let matchIdx = -1;
      if (backwards) {
        for (let i = matches.length - 1; i >= 0; i--) {
          if (matches[i] < selection.from) { matchIdx = i; break; }
        }
        if (matchIdx < 0) matchIdx = matches.length - 1;
      } else {
        matchIdx = matches.findIndex((pos) => pos >= selection.to);
        if (matchIdx < 0) matchIdx = 0;
      }
      const start = matches[matchIdx];
      // Select and scroll without stealing focus from the search bar so repeated Enter cycles hits.
      view.dispatch({
        selection: { anchor: start, head: start + text.length },
        effects: EditorView.scrollIntoView(start, { y: "center" }),
      });
      return { count: matches.length, index: matchIdx + 1 };
    },
    focus: () => view.focus(),
    destroy() {
      alive = false;
      session.state = EditorState.create({ doc: view.state.doc, selection: view.state.selection });
      view.destroy();
    },
  };
}
