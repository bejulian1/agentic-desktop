// The light half of the mini editor (round 8, agent G): what the conversation, the tool rows and
// Endringer call to open it. CodeMirror and the editor itself are in ./MiniEditor, a chunk of its
// own that loads the first time an editor opens (or a moment before, when the pointer rests on
// something that opens one).
import { t } from "../lib/i18n";
import { Show } from "solid-js";
import { app } from "../state/app";
import type { ToolRow } from "../state/thread-model";

export interface EditorRequest {
  kind: "file" | "snippet";
  projectId?: string | null;
  path?: string; // a project file, relative to the project root
  text?: string; // a snippet's text
  lang?: string; // a snippet's language, as the code block names it
  line?: number;
  threadId?: string | null; // to find what the thread changed in the file
  turnId?: string; // or the turn to compare with
  source?: Element | null; // what it was opened from: its pane gets "Spør om dette", and focus goes back to it
}

let chunk: Promise<typeof import("./MiniEditor")> | undefined;
export function preloadMiniEditor(): void {
  chunk ??= import("./MiniEditor");
}

export function openMiniEditor(request: EditorRequest): void {
  preloadMiniEditor();
  void chunk!.then((m) => m.showMiniEditor(request)).catch(() => {
    chunk = undefined; // A failed load (the server went away) can be tried again.
  });
}

// The thread and project of the pane an element is in.
export function paneContext(el: Element | null): { threadId: string | null; projectId: string | null } {
  const threadId = el?.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId || null;
  const thread = threadId ? app.threads[threadId] : undefined;
  return { threadId, projectId: thread?.projectId ?? null };
}

// write_file's summary ends with " +<lines>".
export function toolPath(row: ToolRow): string | null {
  if (row.tool !== "read_file" && row.tool !== "write_file" && row.tool !== "edit_file") return null;
  const path = row.summary.replace(/\s\(ny\)$/, "").replace(/ \+\d+$/, "").trim();
  return path && !path.includes("\n") ? path : null;
}

const VERBS: Record<string, string> = {
  get read_file() { return t("Leste"); },
  get write_file() { return t("Skrev"); },
  get edit_file() { return t("Redigerte"); },
};

// "Leste src/app.ts" in a tool row, where the path opens the mini editor. The row's own button
// still folds the details out everywhere else; this is a span, so there is no button in a button,
// and the keyboard has "Åpne i editor" in the folded-out details (ToolOpenButton).
export function ToolLabel(props: { row: ToolRow; fallback: string }) {
  const path = toolPath(props.row);
  if (!path) return <>{props.fallback}</>;
  const open = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const { threadId, projectId } = paneContext(target);
    if (!projectId) return;
    openMiniEditor({ kind: "file", projectId, path, threadId, source: target.closest(".row") });
  };
  return (
    <>
      {VERBS[props.row.tool]}{" "}
      <span class="tool-file" title={t("Åpne {path} i mini-editoren", { path })} onClick={open} onPointerEnter={preloadMiniEditor}>{path}</span>
    </>
  );
}

// Round 13 (SPEC 27.1): the path alone, for a step that writes its own verb.
export function PathLink(props: { path: string }) {
  const open = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const { threadId, projectId } = paneContext(target);
    if (!projectId) return;
    openMiniEditor({ kind: "file", projectId, path: props.path, threadId, source: target.closest(".row") });
  };
  return <span class="tool-file step-target mono" title={t("Åpne {path} i mini-editoren", { path: props.path })} onClick={open} onPointerEnter={preloadMiniEditor}>{props.path}</span>;
}

export function ToolOpenButton(props: { row: ToolRow }) {
  const path = toolPath(props.row);
  return (
    <Show when={path}>
      <button
        type="button"
        class="btn btn-small btn-ghost tool-open"
        onPointerEnter={preloadMiniEditor}
        onClick={(event) => {
          const { threadId, projectId } = paneContext(event.currentTarget);
          if (projectId) openMiniEditor({ kind: "file", projectId, path: path!, threadId, source: event.currentTarget });
        }}
      >
        {t("Åpne i editor")}
      </button>
    </Show>
  );
}

// A code block in the conversation (markdown/render.ts calls this from its one click listener).
export function openCodeBlock(block: HTMLElement): void {
  const code = block.querySelector("pre code");
  if (!code) return;
  const lang = block.querySelector(".md-lang")?.textContent ?? "";
  const { threadId, projectId } = paneContext(block);
  openMiniEditor({ kind: "snippet", text: code.textContent ?? "", lang: lang === "tekst" ? "" : lang, threadId, projectId, source: block });
}
