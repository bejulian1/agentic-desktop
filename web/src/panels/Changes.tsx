// Diff per turn, with Angre tur. Only rendered lines are the changed ones with some context, and
// long diffs stop at a limit with a button for the rest.
import { t } from "../lib/i18n";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { get, post } from "../lib/api";
import { diffLines, hunks } from "../lib/diff";
import type { ChangedFile, SummaryTurnChanges, TurnDiff } from "../../../shared/protocol";
import { app, report } from "../state/app";
import { openMiniEditor, preloadMiniEditor } from "../ui/MiniEditorHooks";
import { IconPencil } from "../ui/icons";
import { selectedTurn, setSelectedTurn } from "../state/panel";
import { revertTurn } from "../state/project-actions";
import { on as onMessage } from "../lib/socket";
import { FileChangeCounts } from "../ui/FileChangeCounts";

const LINE_LIMIT = 1500;

function FileDiff(props: { file: TurnDiff["files"][number]; turnId: string; threadId: string | null }) {
  const [limit, setLimit] = createSignal(LINE_LIMIT);
  const lines = createMemo(() => props.file.binary ? [] : hunks(diffLines(props.file.before, props.file.after)));
  return (
    <div class="diff-file" data-testid="diff-file" data-path={props.file.path}>
      <div class="diff-file-head">
        <span class="diff-path">{props.file.path}</span>
        <span class="diff-kind">{props.file.change === "added" ? "ny" : props.file.change === "deleted" ? "slettet" : "endret"}</span>
        <FileChangeCounts file={props.file} />
        <Show when={props.file.change !== "deleted"}>
          <button type="button" class="icon-button diff-open" title={t("Åpne filen i mini-editoren, med endringene")} aria-label={t("Åpne {path} i mini-editoren", { path: props.file.path })} onPointerEnter={preloadMiniEditor} onClick={(e) => {
            const projectId = props.threadId ? app.threads[props.threadId]?.projectId : null;
            if (projectId) openMiniEditor({ kind: "file", projectId, path: props.file.path, threadId: props.threadId, turnId: props.turnId, source: e.currentTarget });
          }}><IconPencil size={13} /></button>
        </Show>
      </div>
      <Show when={props.file.binary}><div class="file-note">{t("Binærfilen er registrert. Innhold og linjetall vises ikke.")}</div></Show>
      <Show when={props.file.overlapping}><div class="file-note">{t("Denne turen overlapper annet arbeid i filen. Angre krever bekreftelse før noe overskrives.")}</div></Show>
      <Show when={!props.file.binary && props.file.countsExact !== true}><div class="file-note">{t("Linjetallene er anslått. Store endringsområder kan vises som erstattet.")}</div></Show>
      <div class="diff-lines">
        <For each={lines().slice(0, limit())}>
          {(line) =>
            line.kind === "skip" ? (
              <div class="diff-skip">{t("{count} uendrede linjer", { count: line.count })}</div>
            ) : (
              <>
              <div class={`diff-line ${line.kind}`}>
                <span class="diff-no">{line.oldLine ?? ""}</span>
                <span class="diff-no">{line.newLine ?? ""}</span>
                <span class="diff-text">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}{line.text}</span>
              </div>
              <Show when={line.noNewline}><div class="diff-eof">{t("Ingen linjeskift ved filslutt")}</div></Show>
              </>
            )
          }
        </For>
      </div>
      <Show when={lines().length > limit()}>
        <button type="button" class="btn btn-small" onClick={() => setLimit(limit() + LINE_LIMIT)}>{t("Vis flere linjer")}</button>
      </Show>
    </div>
  );
}

function fileSummary(files: ChangedFile[]): string {
  return files.length === 1 ? files[0].path : t("{count} filer", { count: files.length });
}

export default function ChangesPanel(props: { threadId: () => string | null }) {
  const [turns, setTurns] = createSignal<SummaryTurnChanges[]>([]);
  const [turnState, setTurnState] = createSignal<"loading" | "ready" | "error">("loading");
  let reloadTurns: (() => void) | undefined;
  // Metadata covers the complete thread, including turns outside the loaded conversation page.
  // Only the selected turn's diff is fetched below.
  createEffect(() => {
    const id = props.threadId();
    setTurns([]);
    setTurnState(id ? "loading" : "ready");
    if (!id) return;
    let current = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const value = await get<SummaryTurnChanges[]>(`/api/threads/${id}/summary-changes`);
        if (!current || sequence !== request) return;
        setTurns(value.reverse());
        setTurnState("ready");
      } catch {
        if (current && sequence === request) setTurnState("error");
      }
    };
    reloadTurns = () => void refresh();
    void refresh();
    const off = onMessage("thread.event", ({ envelope }) => {
      if (envelope.threadId === id && ["turn.changes", "turn.reverted"].includes(envelope.event.type)) void refresh();
    });
    onCleanup(() => { current = false; off(); reloadTurns = undefined; });
  });
  const current = createMemo(() => {
    const wanted = selectedTurn();
    return turns().find((t) => t.turnId === wanted) ?? turns()[0];
  });
  const [diff, setDiff] = createSignal<TurnDiff | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [diffError, setDiffError] = createSignal("");
  let requestId = 0;
  onCleanup(() => { requestId++; });

  createEffect(() => {
    const turn = current();
    const mine = ++requestId;
    setDiff(null);
    setDiffError("");
    if (!turn) return setDiff(null);
    const { turnId } = turn;
    get<TurnDiff>(`/api/turns/${turnId}/diff`).then((loaded) => {
      if (mine === requestId) setDiff(loaded);
    }).catch((err) => { if (mine === requestId) { setDiffError((err as Error).message); report(err); } });
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
      <p class="changes-note">{t("Endringer fra kommandoer fanges ikke. Her vises bare det filverktøyene gjorde.")}</p>
      <Show when={turns().length} fallback={<div class="panel-empty" role="status">
        {turnState() === "loading" ? t("Henter turene…") : turnState() === "error" ? t("Kunne ikke hente filendringene.") : t("Ingen filendringer i denne tråden ennå.")}
        <Show when={turnState() === "error"}><button type="button" class="btn btn-small" onClick={() => reloadTurns?.()}>{t("Prøv igjen")}</button></Show>
      </div>}>
        <div class="turn-list">
          <For each={turns()}>
            {(turn, i) => (
              <button type="button" class="turn-item" classList={{ selected: current() === turn }} onClick={() => setSelectedTurn(turn.turnId)}>
                <span>{t("Tur {number}", { number: turns().length - i() })}</span>
                <span class="turn-files">{fileSummary(turn.files)}</span>
                <Show when={turn.reverted}><span class="changes-reverted">{t("Angret")}</span></Show>
              </button>
            )}
          </For>
        </div>
        <div class="turn-actions">
          <button type="button" class="btn btn-small" title={t("Be modellen om en kodegjennomgang av alle endringene i tråden")} disabled={reviewing()} onClick={review}>{t("Gjennomgå")}</button>
          <button type="button" class="btn btn-small" disabled={busy() || current()?.reverted} onClick={revert}>{t("Angre tur")}</button>
        </div>
        <div class="diff-view">
          <Show when={!diff() && !diffError()}><div class="panel-empty" role="status">{t("Henter endringene…")}</div></Show>
          <Show when={diffError()}><div class="panel-empty" role="status">{diffError()}</div></Show>
          <Show when={current()?.reverted}><div class="file-note">{t("Turen er angret. Diffen viser de opprinnelige endringene.")}</div></Show>
          <For each={diff()?.files ?? []}>{(file) => <FileDiff file={file} turnId={diff()!.turnId} threadId={props.threadId()} />}</For>
        </div>
      </Show>
    </div>
  );
}
