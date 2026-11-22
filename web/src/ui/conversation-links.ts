// Clicks on the file and thread chips in an answer (markdown/render.ts builds them). One delegated
// listener per conversation, like the copy and run buttons: a file opens in the mini editor of
// the thread's project, or read-only in Filer on Denne datamaskinen; a thread chip opens the thread.
import { t } from "../lib/i18n";
import { app, toast } from "../state/app";
import { requestLocalFile } from "../state/nav";
import { showPanel } from "../state/panel";
import { projectRelative } from "../markdown/link-targets";
import { openMiniEditor, preloadMiniEditor } from "./MiniEditorHooks";

const FILE_CHIP = ".md-file-chip[data-file-path]";
const THREAD_CHIP = ".md-thread-chip[data-thread-id]";

export interface LinkContext {
  threadId: () => string;
  openThread: (id: string) => void;
}

function openFileChip(chip: HTMLElement, context: LinkContext): void {
  const path = chip.dataset.filePath ?? "";
  const line = Number(chip.dataset.fileLine) || undefined;
  const thread = app.threads[context.threadId()];
  const project = thread?.projectId ? app.projects[thread.projectId] : undefined;
  if (project) {
    const relative = projectRelative(path, project.path);
    if (relative === null) {
      toast(t("{path} ligger utenfor prosjektmappen, så den åpnes ikke her.", { path }), "info");
      return;
    }
    openMiniEditor({ kind: "file", projectId: project.id, path: relative, line, threadId: thread!.id, source: chip.closest(".row") ?? chip });
    return;
  }
  if (thread?.mode === "code" && path.startsWith("/")) {
    requestLocalFile(path);
    showPanel("files");
    return;
  }
  toast(thread?.mode === "code"
    ? t("Uten prosjekt kan bare filer med full sti åpnes.")
    : t("Filer åpnes fra Kode eller en chat i et prosjekt."), "info");
}

function openThreadChip(chip: HTMLElement, context: LinkContext): void {
  const id = chip.dataset.threadId ?? "";
  if (!app.threads[id]) {
    toast(t("Fant ikke tråden. Den kan være slettet."), "info");
    return;
  }
  context.openThread(id);
}

// True when the event was on a chip and is handled.
function activate(target: EventTarget | null, context: LinkContext): boolean {
  const element = target instanceof Element ? target : null;
  const thread = element?.closest<HTMLElement>(THREAD_CHIP);
  if (thread) {
    openThreadChip(thread, context);
    return true;
  }
  const file = element?.closest<HTMLElement>(FILE_CHIP);
  if (file) {
    openFileChip(file, context);
    return true;
  }
  return false;
}

export function attachRichLinks(scroller: HTMLElement, context: LinkContext): () => void {
  const onClick = (event: MouseEvent) => {
    // Shift+click selects messages (Conversation.tsx), so only a plain click opens.
    if (event.button !== 0 || event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    // Selecting the name with the mouse is not a click on it.
    const selection = getSelection();
    if (selection && !selection.isCollapsed && (event.target as Element | null)?.closest?.("code.md-file-chip")) return;
    if (activate(event.target, context)) event.preventDefault();
  };
  // `code` chips are not buttons, so Enter and Space are handled here; the link chips are buttons.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement;
    if (!target.matches?.(`code${FILE_CHIP}`)) return;
    event.preventDefault();
    activate(target, context);
  };
  const onHover = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest?.(FILE_CHIP)) preloadMiniEditor();
  };
  scroller.addEventListener("click", onClick);
  scroller.addEventListener("keydown", onKey);
  scroller.addEventListener("pointerover", onHover, { passive: true });
  return () => {
    scroller.removeEventListener("click", onClick);
    scroller.removeEventListener("keydown", onKey);
    scroller.removeEventListener("pointerover", onHover);
  };
}
