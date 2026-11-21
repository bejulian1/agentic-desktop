import { t } from "../lib/i18n";
import { createResource, createSignal, For, Show } from "solid-js";
import type { ChatProjectMemory, ChatProjectMemoryList, ChatProjectMemoryMode } from "../../../shared/protocol";
import { del, get, post, put } from "../lib/api";
import { confirmDialog } from "./dialogs";
import { IconPencil, IconPlus, IconTrash } from "./icons";

const MAX_MEMORY_CHARS = 300;

export function ChatProjectMemories(props: { projectId: string; memoryMode: ChatProjectMemoryMode }) {
  const base = () => `/api/chat-projects/${encodeURIComponent(props.projectId)}/memories`;
  const [list, { refetch }] = createResource(() => `${props.projectId}:${props.memoryMode}`, async () => {
    const expected = props.memoryMode;
    const result = await get<ChatProjectMemoryList>(base());
    if (result.memoryMode !== expected) throw new Error(t("Minnetypen er endret. Lukk og åpne prosjektinnstillingene igjen før du redigerer minner."));
    return result;
  });
  const [adding, setAdding] = createSignal(false);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const shared = () => props.memoryMode === "shared";
  const label = () => shared() ? t("Globale Chat-minner") : t("Prosjektets egne minner");
  const run = async (work: () => Promise<unknown>, done?: () => void) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try { await work(); done?.(); await refetch(); }
    catch (err) { setError(err instanceof Error ? err.message : t("Kunne ikke oppdatere minnene.")); }
    finally { setBusy(false); }
  };
  const save = () => {
    const draft = text().trim();
    if (!draft || draft.length > MAX_MEMORY_CHARS) return;
    const expected = props.memoryMode;
    const id = editing();
    void run(() => id
      ? put(`${base()}/${encodeURIComponent(id)}`, { text: draft, memoryMode: expected })
      : post(base(), { text: draft, memoryMode: expected }), () => { setEditing(null); setAdding(false); setText(""); });
  };
  const remove = async (item: ChatProjectMemory) => {
    const expected = props.memoryMode;
    const path = `${base()}/${encodeURIComponent(item.id)}?memoryMode=${expected}`;
    if (!await confirmDialog({ title: shared() ? t("Slette et globalt Chat-minne?") : t("Slette prosjektminnet?"), text: shared() ? t("«{memory}» slettes for vanlig Chat og alle prosjekter som deler globale Chat-minner. Dette kan ikke angres.", { memory: item.text }) : t("«{memory}» slettes fra dette prosjektet. Dette kan ikke angres.", { memory: item.text }), confirm: t("Slett minnet"), danger: true })) return;
    void run(() => del(path));
  };
  const clear = async () => {
    const expected = props.memoryMode;
    const path = `${base()}/clear`;
    const count = list()?.items.length ?? 0;
    if (!count || !await confirmDialog({ title: shared() ? t("Slette alle globale Chat-minner?") : t("Slette alle prosjektminner?"), text: shared() ? t("Alle {count} globale Chat-minner slettes også for vanlig Chat og andre prosjekter som deler dem. Prosjektets egne minner og Kode-minner beholdes. Dette kan ikke angres.", { count }) : t("Alle {count} minner i dette prosjektet slettes. Globale Chat-minner og Kode-minner beholdes. Dette kan ikke angres.", { count }), confirm: t("Slett alle minnene"), danger: true })) return;
    void run(() => post(path, { memoryMode: expected }));
  };
  const editingForm = () => <div class="chat-project-memory-editor">
    <label class="field"><span>{editing() ? t("Endre minnet") : t("Nytt minne")}</span><textarea class="input" rows={3} value={text()} maxLength={MAX_MEMORY_CHARS} disabled={busy()} aria-label={editing() ? t("Endre minnet") : t("Nytt minne")} onInput={event => setText(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAdding(false); setEditing(null); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); } }} /></label>
    <div class="chat-project-memory-editor-actions"><span class="muted small">{text().length} / {MAX_MEMORY_CHARS}</span><button type="button" class="btn btn-small" disabled={busy()} onClick={() => { setAdding(false); setEditing(null); }}>{t("Avbryt")}</button><button type="button" class="btn btn-primary btn-small" disabled={busy() || !text().trim()} onClick={save}>{t("Lagre minnet")}</button></div>
  </div>;

  return <section class="chat-project-memories" aria-label={label()} data-testid="chat-project-memories" data-memory-mode={props.memoryMode}>
    <div class="chat-project-section-head"><h3>{label()}</h3><div><button type="button" class="btn btn-small" disabled={busy() || !!list.error || list.loading} onClick={() => { setEditing(null); setAdding(true); setText(""); }}><IconPlus size={13} />{t("Legg til")}</button><button type="button" class="btn btn-small btn-danger" disabled={busy() || !!list.error || !list()?.items.length} onClick={() => void clear()}>{t("Slett alle…")}</button></div></div>
    <Show when={shared()}><p class="chat-project-memory-notice">{t("Endringer her gjelder også vanlig Chat og alle prosjekter som deler globale Chat-minner.")}</p></Show>
    <Show when={list.loading}><p class="muted" role="status">{t("Henter minner…")}</p></Show>
    <Show when={list.error}><p class="chat-project-error" role="alert">{list.error instanceof Error ? list.error.message : t("Kunne ikke hente minnene.")}</p><button type="button" class="btn btn-small" onClick={() => void Promise.resolve(refetch()).catch(() => undefined)}>{t("Prøv igjen")}</button></Show>
    <Show when={adding()}>{editingForm()}</Show>
    <Show when={!list.error && list()}><ul class="chat-project-memory-list">
      <For each={list()?.items} fallback={<li class="muted small">{t("Ingen minner ennå. Legg til et minne, eller la modellen lagre nye minner når du har slått det på over.")}</li>}>{item => <li>
        <Show when={editing() === item.id} fallback={<><span>{item.text}</span><div><button type="button" class="icon-button" aria-label={t("Endre minnet «{memory}»", { memory: item.text })} title={t("Endre minnet")} disabled={busy()} onClick={() => { setAdding(false); setEditing(item.id); setText(item.text); }}><IconPencil size={14} /></button><button type="button" class="icon-button" aria-label={t("Slett minnet «{memory}»", { memory: item.text })} title={t("Slett minnet")} disabled={busy()} onClick={() => void remove(item)}><IconTrash size={14} /></button></div></>}>{editingForm()}</Show>
      </li>}</For>
    </ul></Show>
    <Show when={error()}><p class="chat-project-error" role="alert">{error()}</p></Show>
  </section>;
}
