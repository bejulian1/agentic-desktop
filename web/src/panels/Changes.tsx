// Diff per turn, with Angre tur. Only rendered lines are the changed ones with some context, and
// long diffs stop at a limit with a button for the rest.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { get, post } from "../lib/api";
import { diffLines, hunks } from "../lib/diff";
import type { ChangedFile, TurnDiff } from "../../../shared/protocol";
import { app, report } from "../state/app";
import { openMiniEditor, preloadMiniEditor } from "../ui/MiniEditorHooks";
import { IconPencil } from "../ui/icons";
import { selectedTurn, setSelectedTurn } from "../state/panel";
import { revertTurn } from "../state/project-actions";
import { peekModel, type ChangesRow } from "../state/thread-model";

const LINE_LIMIT = 1500;

function FileDiff(props: { file: TurnDiff["files"][number]; turnId: string; threadId: string | null }) {
  const [limit, setLimit] = createSignal(LINE_LIMIT);
  const lines = createMemo(() => hunks(diffLines(props.file.before, props.file.after)));
  return (
    <div class="diff-file" data-testid="diff-file" data-path={props.file.path}>
      <div class="diff-file-head">
        <span class="diff-path">{props.file.path}</span>
        <span class="diff-kind">{props.file.change === "added" ? "ny" : props.file.change === "deleted" ? "slettet" : "endret"}</span>
        <span class="diff-add">+{props.file.additions}</span>
        <span class="diff-del">-{props.file.deletions}</span>
        <Show when={props.file.change !== "deleted"}>
          <button type="button" class="icon-button diff-open" title="Åpne filen i mini-editoren, med endringene" aria-label={`Åpne ${props.file.path} i mini-editoren`} onPointerEnter={preloadMiniEditor} onClick={(e) => {
            const projectId = props.threadId ? app.threads[props.threadId]?.projectId : null;
            if (projectId) openMiniEditor({ kind: "file", projectId, path: props.file.path, threadId: props.threadId, turnId: props.turnId, source: e.currentTarget });
          }}><IconPencil size={13} /></button>
        </Show>
      </div>
      <div class="diff-lines">
        <For each={lines().slice(0, limit())}>
          {(line) =>
            line.kind === "skip" ? (
              <div class="diff-skip">{line.count} uendrede linjer</div>
            ) : (
              <div class={`diff-line ${line.kind}`}>
                <span class="diff-no">{line.oldLine ?? ""}</span>
                <span class="diff-no">{line.newLine ?? ""}</span>
                <span class="diff-text">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}{line.text}</span>
              </div>
            )
          }
        </For>
      </div>
      <Show when={lines().length > limit()}>
        <button type="button" class="btn btn-small" onClick={() => setLimit(limit() + LINE_LIMIT)}>Vis flere linjer</button>
      </Show>
    </div>
  );
}

function fileSummary(files: ChangedFile[]): string {
  return files.length === 1 ? files[0].path : `${files.length} filer`;
}

export default function ChangesPanel(props: { threadId: () => string | null }) {
  const model = createMemo(() => {
    const id = props.threadId();
    return id ? peekModel(id) : undefined;
  });
  const turns = createMemo<ChangesRow[]>(() => [...(model()?.changes() ?? [])].reverse());
  const current = createMemo(() => {
    const wanted = selectedTurn();
    return turns().find((t) => t.turnId === wanted) ?? turns()[0];
  });
  const [diff, setDiff] = createSignal<TurnDiff | null>(null);
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    const turn = current();
    if (!turn) return setDiff(null);
    const { turnId } = turn;
    get<TurnDiff>(`/api/turns/${turnId}/diff`).then((loaded) => {
      if (current()?.turnId === turnId) setDiff(loaded);
    }).catch(report);
  });

  const [reviewing, setReviewing] = createSignal(false);
  const review = async () => {
    const id = props.threadId();
    if (!id) return;
    setReviewing(true);
    try {
      await post(`/api/threads/${id}/messages`, { text: "", review: true });
    } catch (err) {
      report(err);
    } finally {
      setReviewing(false);
    }
  };

  const revert = async () => {
    const turn = current();
    if (!turn) return;
    setBusy(true);
    await revertTurn(turn.turnId);
    setBusy(false);
  };

  return (
    <div class="changes-panel" data-testid="changes-panel">
      <p class="changes-note">Endringer fra kommandoer fanges ikke. Her vises bare det filverktøyene gjorde.</p>
      <Show when={turns().length} fallback={<div class="panel-empty">Ingen filendringer i denne tråden ennå.</div>}>
        <div class="turn-list">
          <For each={turns()}>
            {(turn, i) => (
              <button type="button" class="turn-item" classList={{ selected: current() === turn }} onClick={() => setSelectedTurn(turn.turnId)}>
                <span>Tur {turns().length - i()}</span>
                <span class="turn-files">{fileSummary(turn.files)}</span>
                <Show when={(turn.rev(), turn.reverted)}><span class="changes-reverted">Angret</span></Show>
              </button>
            )}
          </For>
        </div>
        <div class="turn-actions">
          <button type="button" class="btn btn-small" title="Be modellen om en kodegjennomgang av alle endringene i tråden" disabled={reviewing()} onClick={review}>Gjennomgå</button>
          <button type="button" class="btn btn-small" disabled={busy() || (current()?.rev(), current()?.reverted)} onClick={revert}>Angre tur</button>
        </div>
        <div class="diff-view">
          <For each={diff()?.files ?? []}>{(file) => <FileDiff file={file} turnId={diff()!.turnId} threadId={props.threadId()} />}</For>
        </div>
      </Show>
    </div>
  );
}
