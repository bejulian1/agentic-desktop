import { lookupMessage, language, plural, t } from "../../lib/i18n";
// Innstillinger → Chat-personalisering (SPEC 22.4): Chat's own place, apart from Kode. A system
// instruction, a few lines about you, a personality with characteristics that can be turned down
// or up, and Chat memories with «Oppdater minnet av seg selv».
// Chat never gets the Kode harness, the global AGENTS.md or the Kode memories, and Kode never gets
// any of this.
import { createResource, createSignal, For, Show } from "solid-js";
import type { ChatPersonal, ChatTone, ChatTraitId, ChatTraitLevel, HarnessInfo, MemoryItem, UpgradeProposal } from "../../../../shared/protocol";
import { CHAT_PERSONALITIES, CHAT_TRAITS, countChatWords, MAX_CHAT_FIELD, MAX_CHAT_WORDS } from "../../../../shared/protocol";
import { ModelContextSettings } from "./model-context";
import { del, get, post, put } from "../../lib/api";
import { report, toast } from "../../state/app";
import { confirmDialog } from "../dialogs";
import { IconPencil, IconPlus, IconReset, IconTrash } from "../icons";
import { Group, Row, Segmented, SkeletonRows, Toggle } from "./parts";
import { Select } from "../Select";
import { UpgradeView } from "./memory-upgrade";

interface ChatState {
  personal: ChatPersonal;
  memories: MemoryItem[];
  file: string;
  defaults?: { instructions: string; maxLength: number; maxWords: number };
  instructionsAreDefault?: boolean;
}

const MAX_MEMORY = 300;

const TRAIT_LEVELS: Array<{ value: ChatTraitLevel; label: string }> = [
  { value: -1, get label() { return t("Mindre"); } },
  { value: 0, get label() { return t("Standard"); } },
  { value: 1, get label() { return t("Mer"); } },
];

export function ChatPersonalSettings() {
  const [state, { refetch, mutate }] = createResource(() => get<ChatState>("/api/chat-personal"));
  const [instructions, setInstructions] = createSignal<string | null>(null);
  const [about, setAbout] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [editing, setEditing] = createSignal<string | null>(null);
  const [editText, setEditText] = createSignal("");
  const [proposal, setProposal] = createSignal<UpgradeProposal | null>(null);
  // A proposal the app made by itself after a chat (SPEC 22.3), waiting to be seen.
  const [pending, { refetch: refetchPending }] = createResource(() => get<HarnessInfo>("/api/harness").then((h) => h.pending.find((p) => p.scope === "chat" && p.ops.length) ?? null));
  const shown = () => proposal() ?? pending() ?? null;

  const value = (field: "instructions" | "about") => (field === "instructions" ? instructions() : about()) ?? state()?.personal[field] ?? "";
  const dirty = () => (instructions() !== null && instructions() !== state()?.personal.instructions) || (about() !== null && about() !== state()?.personal.about);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) toast(done, "info");
      return true;
    } catch (err) {
      report(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setPersonal = (patch: Partial<ChatPersonal>, done?: string) =>
    run(async () => {
      const personal = await put<ChatPersonal>("/api/chat-personal", patch);
      mutate({ ...state()!, personal });
    }, done);

  const overLimit = (field: "instructions" | "about") => countChatWords(value(field)) > MAX_CHAT_WORDS || value(field).length > MAX_CHAT_FIELD;
  const textsValid = () => !overLimit("instructions") && !overLimit("about");

  const saveTexts = async () => {
    if (!textsValid()) return;
    const ok = await setPersonal({ instructions: value("instructions"), about: value("about") }, t("Lagret. Nye svar i Chat bruker det."));
    if (ok) {
      setInstructions(null);
      setAbout(null);
    }
  };

  const reset = async () => {
    const ok = await confirmDialog({
      title: t("Tilbakestille Chat-personaliseringen?"),
      text: t("Systeminstruksen gjenopprettes til appens standard, «Om deg» tømmes, personligheten blir Standard og stilvalgene settes tilbake. Minnevalgene tilbakestilles også. Lagrede Chat-minner blir stående."),
      confirm: t("Tilbakestill"),
    });
    if (!ok) return;
    await run(async () => {
      const personal = await post<ChatPersonal>("/api/chat-personal/reset");
      mutate({ ...state()!, personal });
      setInstructions(null);
      setAbout(null);
    }, t("Chat-personaliseringen er tilbake til standard."));
  };

  const resetInstructions = async () => {
    if (value("instructions") !== (state()?.defaults?.instructions ?? "")) {
      const ok = await confirmDialog({ title: t("Gjenopprette standard systeminstruks?"), text: t("Systeminstruksen erstattes med appens standard. «Om deg», tone, minnevalg og lagrede minner beholdes."), confirm: t("Gjenopprett standard") });
      if (!ok) return;
    }
    await run(async () => {
      const personal = await post<ChatPersonal>("/api/chat-personal/instructions/reset");
      mutate({ ...state()!, personal, instructionsAreDefault: true });
      setInstructions(null);
    }, t("Standard systeminstruks er gjenopprettet."));
  };

  const addMemory = async () => {
    const text = draft().trim();
    if (!text) return;
    if (await run(() => post("/api/chat-personal/memories", { text }).then(() => refetch()), t("Minnet er lagret."))) {
      setDraft("");
      setAdding(false);
    }
  };
  const saveEdit = async (item: MemoryItem) => {
    const text = editText().trim();
    if (!text || text === item.text) return setEditing(null);
    if (await run(() => put(`/api/chat-personal/memories/${item.id}`, { text }).then(() => refetch()))) setEditing(null);
  };
  const removeMemory = (item: MemoryItem) => run(() => del(`/api/chat-personal/memories/${item.id}`).then(() => refetch()), t("Minnet er slettet."));
  const clearMemories = async () => {
    const count = state()?.memories.length ?? 0;
    if (!count) return;
    const ok = await confirmDialog({ title: t("Slette alle Chat-minner?"), text: plural(count, "Ett minne slettes. Kode-minnene røres ikke.", "Alle {count} minnene slettes. Kode-minnene røres ikke."), confirm: t("Slett alle"), danger: true });
    if (ok) await run(() => post("/api/chat-personal/memories/clear", {}).then(() => refetch()), t("Chat-minnene er slettet."));
  };
  const tidy = () => run(async () => setProposal(await post<UpgradeProposal>("/api/memories/upgrade", { scope: "chat" })));

  const counter = (field: "instructions" | "about") => <span class="muted small chat-count" classList={{ over: overLimit(field) }}>{t("{used} / {max} ord", { used: countChatWords(value(field)).toLocaleString(language()), max: MAX_CHAT_WORDS.toLocaleString(language()) })}</span>;

  return (
    <section aria-label={t("Chat-personalisering")}>
      <Show when={state()} fallback={<SkeletonRows label={t("Henter personaliseringen…")} />}>
        <Group
          title={t("Om deg og svarene")}
          action={
            <div class="memory-actions">
              <button type="button" class="btn btn-small" disabled={busy()} onClick={() => void reset()}><IconReset size={13} />{t("Tilbakestill")}</button>
              <button type="button" class="btn btn-small btn-primary" disabled={!dirty() || !textsValid() || busy()} onClick={() => void saveTexts()}>{t("Lagre")}</button>
            </div>
          }
        >
          <div class="setting setting-block">
            <label class="field">
              <span class="chat-field-head"><strong>{t("Systeminstruks")}</strong>{counter("instructions")}</span>
              <span class="muted small">{t("Hvordan Chat skal svare. Standardteksten kan redigeres fritt og gjelder alle nye svar i Chat. Opptil 10 000 ord.")}</span>
              <textarea class="input chat-area" aria-label={t("Systeminstruks")} aria-invalid={overLimit("instructions") || undefined} rows={8} maxLength={MAX_CHAT_FIELD} value={value("instructions")} onInput={(e) => setInstructions(e.currentTarget.value)} placeholder={t("Skriv dine egne instruksjoner, eller gjenopprett standarden.")} />
            </label>
            <button type="button" class="btn btn-small" disabled={busy() || value("instructions") === state()?.defaults?.instructions} onClick={() => void resetInstructions()}><IconReset size={13} />{t("Gjenopprett standard")}</button>
          </div>
          <div class="setting setting-block">
            <label class="field">
              <span class="chat-field-head"><strong>{t("Om deg")}</strong>{counter("about")}</span>
              <span class="muted small">{t("Det Chat bør vite om deg: hva du jobber med, hva du kan, hva du liker. Opptil 10 000 ord.")}</span>
              <textarea class="input chat-area" aria-label={t("Om deg")} aria-invalid={overLimit("about") || undefined} rows={6} maxLength={MAX_CHAT_FIELD} value={value("about")} onInput={(e) => setAbout(e.currentTarget.value)} placeholder={t("For eksempel: Jeg er lærer i Bergen og lærer meg Python.")} />
            </label>
          </div>
        </Group>

        <Group title={t("Personlighet og stil")}>
          <Row label={t("Personlighet")} text={t("{description} Gjelder nye og eksisterende chatter som ikke har valgt sin egen med /personality.", { description: lookupMessage(CHAT_PERSONALITIES.find((p) => p.id === state()!.personal.tone)?.text) })}>
            <Select<ChatTone> label={t("Personlighet")} value={state()!.personal.tone} options={CHAT_PERSONALITIES.map((p) => ({ value: p.id, label: lookupMessage(p.label) }))} onChange={(tone) => void setPersonal({ tone })} />
          </Row>
          <For each={CHAT_TRAITS}>
            {(trait) => (
              <Row label={lookupMessage(trait.label)} text={lookupMessage(trait.text)}>
                <Segmented<ChatTraitLevel>
                  label={lookupMessage(trait.label)}
                  value={state()!.personal.traits?.[trait.id] ?? 0}
                  options={TRAIT_LEVELS}
                  onChange={(level) => void setPersonal({ traits: { [trait.id]: level } as Record<ChatTraitId, ChatTraitLevel> })}
                />
              </Row>
            )}
          </For>
          <p class="muted small chat-style-note">{t("Personlighet og stil endrer hvordan Chat skriver, ikke hva som er riktig. De gjelder bare Chat, ikke Kode eller Chat-prosjekter med egne instruksjoner.")}</p>
        </Group>

        <Show when={!textsValid()}><p class="form-error" role="alert">{t("Hvert felt kan ha opptil 10 000 ord. Kort ned feltet som er over grensen før du lagrer.")}</p></Show>

        <ModelContextSettings mode="chat" />

        <Group title={t("Chat-minner")}>
          <Toggle
            label={t("Bruk Chat-minner")}
            text={t("Chat får minnene under i nye samtaler. Av betyr at de blir liggende, men ikke brukes.")}
            checked={state()!.personal.memories}
            onChange={(memories) => void setPersonal({ memories })}
          />
          <Toggle
            label={t("Oppdater minnet av seg selv")}
            text={t("Chat kan lagre navn og uttalte preferanser. Varige rettelser vises i samtalen for gjennomgang. Midlertidige chatter er unntatt.")}
            checked={state()!.personal.autoMemory}
            onChange={(autoMemory) => void setPersonal({ autoMemory })}
          />
        </Group>

        <Group
          title={t("Lagrede Chat-minner")}
          action={
            <div class="memory-actions">
              <button type="button" class="btn btn-small" disabled={busy() || (state()!.memories.length < 2)} onClick={() => void tidy()} title={t("Slå sammen like minner og fjern utdaterte")}>{t("Rydd")}</button>
              <button type="button" class="btn btn-small" onClick={() => setAdding(!adding())}><IconPlus size={13} />{t("Legg til")}</button>
              <button type="button" class="btn btn-small btn-danger" disabled={!state()!.memories.length || busy()} onClick={() => void clearMemories()}>{t("Slett alle")}</button>
            </div>
          }
        >
          <Show when={shown()} keyed>{(p) => <UpgradeView proposal={p} where="Chat" onDone={(changed) => { setProposal(null); void refetchPending(); if (changed) void refetch(); }} />}</Show>
          <Show when={adding()}>
            <form class="setting setting-block memory-form" onSubmit={(e) => { e.preventDefault(); void addMemory(); }}>
              <label class="field"><span>{t("Nytt Chat-minne")}</span>
                <textarea class="input memory-input" rows={2} maxLength={MAX_MEMORY} placeholder={t("For eksempel: Jeg har en hund som heter Luna.")} value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
              </label>
              <div class="memory-form-row">
                <span class="muted small memory-count">{draft().trim().length} / {MAX_MEMORY}</span>
                <span class="spacer" />
                <button type="button" class="btn btn-small" onClick={() => setAdding(false)}>{t("Avbryt")}</button>
                <button type="submit" class="btn btn-small btn-primary" disabled={!draft().trim() || busy()}>{t("Lagre")}</button>
              </div>
            </form>
          </Show>
          <Show
            when={state()!.memories.length}
            fallback={<div class="setting memory-empty"><span class="muted">{t("Ingen Chat-minner ennå. Legg til selv, eller slå på «Oppdater minnet av seg selv».")}</span></div>}
          >
            <ul class="memory-list" aria-label={t("Chat-minner")}>
              <For each={state()!.memories}>
                {(item) => (
                  <li class="setting memory-row">
                    <Show
                      when={editing() === item.id}
                      fallback={
                        <>
                          <div class="setting-text"><strong class="memory-text">{item.text}</strong></div>
                          <div class="setting-control">
                            <button type="button" class="icon-button" aria-label={t("Endre «{memory}»", { memory: item.text })} title={t("Endre")} onClick={() => { setEditText(item.text); setEditing(item.id); }}><IconPencil size={14} /></button>
                            <button type="button" class="icon-button" aria-label={t("Slett «{memory}»", { memory: item.text })} title={t("Slett")} disabled={busy()} onClick={() => void removeMemory(item)}><IconTrash size={14} /></button>
                          </div>
                        </>
                      }
                    >
                      <form class="memory-edit" onSubmit={(e) => { e.preventDefault(); void saveEdit(item); }}>
                        <textarea
                          class="input memory-input"
                          rows={2}
                          maxLength={MAX_MEMORY}
                          aria-label={t("Endre Chat-minnet")}
                          value={editText()}
                          onInput={(e) => setEditText(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(item); }
                          }}
                          ref={(el) => requestAnimationFrame(() => el.focus())}
                        />
                        <div class="memory-form-row">
                          <span class="spacer" />
                          <button type="button" class="btn btn-small" onClick={() => setEditing(null)}>{t("Avbryt")}</button>
                          <button type="submit" class="btn btn-small btn-primary" disabled={!editText().trim() || busy()}>{t("Lagre")}</button>
                        </div>
                      </form>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Group>
        <p class="muted small memory-files">
          {t("Chat-minnene er vanlige linjer i")}{" "}<code>{state()!.file}</code>{t(". Velg Kode over for å administrere Kode-minnene separat.")}
        </p>
      </Show>
    </section>
  );
}
