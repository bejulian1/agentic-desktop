// An editable CodeMirror for artifacts, with HTML highlighting (CSS and JavaScript inside it
// too), or JSX and TSX for a React artifact (round 15). @codemirror/commands is not installed, and no new packages are added for this round, so
// the few commands it needs are here: undo and redo, Tab, and Mod-s to save.
import { ChangeSet, EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";

const GROUP_MS = 600;

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--code-font-size, 12.5px)", backgroundColor: "transparent", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55", overflow: "auto" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-3)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection)" },
});

interface Step {
  changes: ChangeSet; // takes the document back to before the step
  selection: EditorSelection;
}

export interface HtmlEditor {
  view: EditorView;
  text(): string;
  set(text: string): void; // replaces everything and forgets the history
  focus(): void;
  destroy(): void;
}

export function createHtmlEditor(parent: HTMLElement, text: string, events: { onChange: (text: string) => void; onSave: () => void }, lang: "html" | "jsx" | "tsx" = "html"): HtmlEditor {
  let undo: Step[] = [];
  let redo: Step[] = [];
  let lastAt = 0;
  let replaying = false;

  const record = (tr: Transaction) => {
    if (!tr.docChanged || replaying) return;
    const inverse = tr.changes.invert(tr.startState.doc);
    const now = Date.now();
    const last = undo.at(-1);
    // Typing in one go is one step back.
    if (last && now - lastAt < GROUP_MS) last.changes = inverse.compose(last.changes);
    else undo.push({ changes: inverse, selection: tr.startState.selection });
    if (undo.length > 500) undo = undo.slice(-500);
    lastAt = now;
    redo = [];
  };

  const replay = (from: Step[], to: Step[]) => (target: EditorView) => {
    const step = from.pop();
    if (!step) return true;
    const state = target.state;
    to.push({ changes: step.changes.invert(state.doc), selection: state.selection });
    replaying = true;
    target.dispatch({ changes: step.changes, selection: step.selection, scrollIntoView: true });
    replaying = false;
    lastAt = 0;
    return true;
  };

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(classHighlighter),
        lang === "html" ? html() : javascript({ jsx: true, typescript: lang === "tsx" }),
        EditorState.tabSize.of(2),
        keymap.of([
          { key: "Mod-z", run: (v) => replay(undo, redo)(v), preventDefault: true },
          { key: "Mod-y", run: (v) => replay(redo, undo)(v), preventDefault: true },
          { key: "Mod-Shift-z", run: (v) => replay(redo, undo)(v), preventDefault: true },
          { key: "Mod-s", run: () => (events.onSave(), true), preventDefault: true },
          { key: "Mod-a", run: (v) => (v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }), true) },
          { key: "Tab", run: (v) => (v.dispatch(v.state.replaceSelection("  ")), true) },
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          for (const tr of update.transactions) record(tr);
          events.onChange(update.state.doc.toString());
        }),
        theme,
      ],
    }),
  });

  return {
    view,
    text: () => view.state.doc.toString(),
    set(next) {
      replaying = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      replaying = false;
      undo = [];
      redo = [];
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
