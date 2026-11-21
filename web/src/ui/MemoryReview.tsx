import { t } from "../lib/i18n";
import { createResource, createSignal, For, Show } from "solid-js";
import type { ChatMemoryProposal, ChatMemoryReview } from "../../../shared/protocol";
import { get, post } from "../lib/api";
import { toast } from "../state/app";

export function MemoryReview(props: { threadId: string; updated: number; running: boolean }) {
  const base = (id: string) => `/api/threads/${encodeURIComponent(id)}/memory-proposals`;
  const [review, { refetch, mutate }] = createResource(
    () => props.running ? false : { id: props.threadId, revision: props.updated },
    async ({ id }) => ({ id, result: await get<ChatMemoryReview>(base(id)) }),
  );
  const current = () => {
    if (props.running || review.error) return;
    const latest = review.latest;
    if (latest?.id === props.threadId) return latest.result;
  };
  const first = () => current()?.proposals[0];
  return <>
    <Show when={!props.running && review.error}><div class="memory-review" role="status">{t("Kunne ikke hente minneforslag.")}{" "}<button type="button" class="btn btn-small" onClick={() => void refetch()}>{t("Prøv igjen")}</button></div></Show>
    <Show when={first()?.id} keyed>{id => {
      const threadId = props.threadId;
      return <MemoryCard proposal={first()!} review={current()!} submit={async (action, text, previousId, previousText) => {
        const result = await post<ChatMemoryReview>(`${base(threadId)}/${id}`, { action, text, previousId, previousText });
        if (props.threadId === threadId) mutate({ id: threadId, result });
        toast(action === "apply" ? t("Minnet er lagret.") : t("Forslaget er avvist."), "info");
      }} refresh={refetch} />;
    }}</Show>
  </>;
}

function MemoryCard(props: {
  proposal: ChatMemoryProposal; review: ChatMemoryReview;
  submit: (action: "apply" | "dismiss", text: string, previousId: string | null, previousText: string | null) => Promise<void>;
  refresh: () => unknown;
}) {
  const [text, setText] = createSignal(props.proposal.text);
  const [previous, setPrevious] = createSignal(props.proposal.previousId ?? "");
  const [before, setBefore] = createSignal(props.proposal.previousText);
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const selected = () => props.review.memories.find(item => item.id === previous());
  const stale = () => !!previous() && selected()?.text !== before();
  const choose = (id: string) => {
    setPrevious(id);
    setBefore(props.review.memories.find(item => item.id === id)?.text ?? null);
    setError("");
  };
  const submit = async (action: "apply" | "dismiss") => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try { await props.submit(action, text(), previous() || null, before()); }
    catch (err) { setError(err instanceof Error ? err.message : t("Kunne ikke behandle forslaget.")); void props.refresh(); }
    finally { setBusy(false); }
  };
  return <section class="memory-review" aria-label={t("Minneforslag")}>
    <strong>{t("Minneforslag")}</strong><span class="muted small">{props.review.scope}</span>
    <Show when={previous()}><div><small>{t("Før")}</small><p>{before()}</p></div></Show>
    <Show when={stale()}><div role="status">{t("Minnet er endret eller fjernet. Velg på nytt før du lagrer.")}</div></Show>
    <Show when={editing()} fallback={<div><small>{previous() ? t("Etter") : t("Nytt minne")}</small><p>{text()}</p></div>}>
      <label class="field"><span>{t("Erstatter")}</span><select value={previous()} disabled={busy()} onChange={e => choose(e.currentTarget.value)}>
        <option value="">{t("Lagre som nytt minne")}</option>
        <Show when={previous() && !selected()}><option value={previous()} disabled>{t("Forrige minne er fjernet")}</option></Show>
        <For each={props.review.memories}>{item => <option value={item.id}>{item.text}</option>}</For>
      </select></label>
      <Show when={stale() && selected()}><button type="button" class="btn btn-small" disabled={busy()} onClick={() => choose(previous())}>{t("Bruk gjeldende minne")}</button></Show>
      <label class="field"><span>{t("Forslag")}</span><textarea class="input" rows={2} maxlength={300} value={text()} disabled={busy()} onInput={e => setText(e.currentTarget.value)} /></label>
    </Show>
    <Show when={error()}><span class="form-error" role="alert">{error()}</span></Show>
    <div class="memory-review-actions">
      <button type="button" class="btn btn-primary btn-small" disabled={busy() || stale() || !text().trim()} onClick={() => void submit("apply")}>{t("Godkjenn")}</button>
      <Show when={!editing()}><button type="button" class="btn btn-small" disabled={busy()} onClick={() => setEditing(true)}>{t("Rediger")}</button></Show>
      <button type="button" class="btn btn-small" disabled={busy()} onClick={() => void submit("dismiss")}>{t("Avvis")}</button>
    </div>
  </section>;
}
