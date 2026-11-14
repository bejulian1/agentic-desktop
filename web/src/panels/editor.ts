// Read-only CodeMirror. Languages load on demand too.
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightSpecialChars, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";

async function languageFor(path: string): Promise<Extension> {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "js": case "mjs": case "cjs": case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "ts": case "mts": case "cts":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true });
    case "html": case "htm": case "svg": case "xml":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "md": case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    default:
      return [];
  }
}

export interface ReadonlyEditor {
  show(path: string, text: string): Promise<void>;
  destroy(): void;
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--code-font-size, 12.5px)", backgroundColor: "var(--code-bg, transparent)", color: "var(--code-fg, var(--text))" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55", overflow: "auto" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-3)", border: "none" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--selection)" },
});

export function createReadonlyEditor(parent: HTMLElement): ReadonlyEditor {
  const language = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        highlightSpecialChars(),
        syntaxHighlighting(classHighlighter),
        language.of([]),
        theme,
      ],
    }),
  });
  let shownPath = "";
  let destroyed = false;
  return {
    async show(path, text) {
      if (destroyed) return;
      const sameFile = path === shownPath;
      shownPath = path;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      if (!sameFile) {
        const extension = await languageFor(path);
        if (!destroyed && shownPath === path) view.dispatch({ effects: language.reconfigure(extension) });
      }
    },
    destroy: () => { destroyed = true; shownPath = ""; view.destroy(); },
  };
}
