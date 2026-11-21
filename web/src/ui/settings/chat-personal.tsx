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
  { value: -1, label: "Mindre" },
  { value: 0, label: "Standard" },
  { value: 1, label: "Mer" },
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
    const ok = await setPersonal({ instructions: value("instructions"), about: value("about") }, "Lagret. Nye svar i Chat bruker det.");
    if (ok) {
      setInstructions(null);
      setAbout(null);
    }
  };

  const reset = async () => {
    const ok = await confirmDialog({
      title: "Tilbakestille Chat-personaliseringen?",
      text: "Systeminstruksen gjenopprettes til appens standard, «Om deg» tømmes, personligheten blir Standard og stilvalgene settes tilbake. Minnevalgene tilbakestilles også. Lagrede Chat-minner blir stående.",
      confirm: "Tilbakestill",
    });
    if (!ok) return;
    await run(async () => {
      const personal = await post<ChatPersonal>("/api/chat-personal/reset");
      mutate({ ...state()!, personal });
      setInstructions(null);
      setAbout(null);
    }, "Chat-personaliseringen er tilbake til standard.");
  };

  const resetInstructions = async () => {
    if (value("instructions") !== (state()?.defaults?.instructions ?? "")) {
      const ok = await confirmDialog({ title: "Gjenopprette standard systeminstruks?", text: "Systeminstruksen erstattes med appens standard. «Om deg», tone, minnevalg og lagrede minner beholdes.", confirm: "Gjenopprett standard" });
      if (!ok) return;
    }
    await run(async () => {
      const personal = await post<ChatPersonal>("/api/chat-personal/instructions/reset");
      mutate({ ...state()!, personal, instructionsAreDefault: true });
      setInstructions(null);
    }, "Standard systeminstruks er gjenopprettet.");
  };

  const addMemory = async () => {
    const text = draft().trim();
    if (!text) return;
    if (await run(() => post("/api/chat-personal/memories", { text }).then(() => refetch()), "Minnet er lagret.")) {
      setDraft("");
      setAdding(false);
    }
  };
  const saveEdit = async (item: MemoryItem) => {
    const text = editText().trim();
    if (!text || text === item.text) return setEditing(null);
    if (await run(() => put(`/api/chat-personal/memories/${item.id}`, { text }).then(() => refetch()))) setEditing(null);
  };
  const removeMemory = (item: MemoryItem) => run(() => del(`/api/chat-personal/memories/${item.id}`).then(() => refetch()), "Minnet er slettet.");
  const clearMemories = async () => {
    const count = state()?.memories.length ?? 0;
    if (!count) return;
    const ok = await confirmDialog({ title: "Slette alle Chat-minner?", text: `${count === 1 ? "Ett minne" : `Alle ${count} minnene`} slettes. Kode-minnene røres ikke.`, confirm: "Slett alle", danger: true });
    if (ok) await run(() => post("/api/chat-personal/memories/clear", {}).then(() => refetch()), "Chat-minnene er slettet.");
  };
  const tidy = () => run(async () => setProposal(await post<UpgradeProposal>("/api/memories/upgrade", { scope: "chat" })));

  const counter = (field: "instructions" | "about") => <span class="muted small chat-count" classList={{ over: overLimit(field) }}>{countChatWords(value(field)).toLocaleString("nb-NO")} / {MAX_CHAT_WORDS.toLocaleString("nb-NO")} ord</span>;

  return (
    <section aria-label="Chat-personalisering">
      <Show when={state()} fallback={<SkeletonRows label="Henter personaliseringen…" />}>
        <Group
          title="Om deg og svarene"
          action={
            <div class="memory-actions">
              <button type="button" class="btn btn-small" disabled={busy()} onClick={() => void reset()}><IconReset size={13} />Tilbakestill</button>
              <button type="button" class="btn btn-small btn-primary" disabled={!dirty() || !textsValid() || busy()} onClick={() => void saveTexts()}>Lagre</button>
            </div>
          }
        >
          <div class="setting setting-block">
            <label class="field">
              <span class="chat-field-head"><strong>Systeminstruks</strong>{counter("instructions")}</span>
              <span class="muted small">Hvordan Chat skal svare. Standardteksten kan redigeres fritt og gjelder alle nye svar i Chat. Opptil 10 000 ord.</span>
              <textarea class="input chat-area" aria-label="Systeminstruks" aria-invalid={overLimit("instructions") || undefined} rows={8} maxLength={MAX_CHAT_FIELD} value={value("instructions")} onInput={(e) => setInstructions(e.currentTarget.value)} placeholder="Skriv dine egne instruksjoner, eller gjenopprett standarden." />
            </label>
            <button type="button" class="btn btn-small" disabled={busy() || value("instructions") === state()?.defaults?.instructions} onClick={() => void resetInstructions()}><IconReset size={13} />Gjenopprett standard</button>
          </div>
          <div class="setting setting-block">
            <label class="field">
              <span class="chat-field-head"><strong>Om deg</strong>{counter("about")}</span>
              <span class="muted small">Det Chat bør vite om deg: hva du jobber med, hva du kan, hva du liker. Opptil 10 000 ord.</span>
              <textarea class="input chat-area" aria-label="Om deg" aria-invalid={overLimit("about") || undefined} rows={6} maxLength={MAX_CHAT_FIELD} value={value("about")} onInput={(e) => setAbout(e.currentTarget.value)} placeholder="For eksempel: Jeg er lærer i Bergen og lærer meg Python." />
            </label>
          </div>
        </Group>

        <Group title="Personlighet og stil">
          <Row label="Personlighet" text={`${CHAT_PERSONALITIES.find((p) => p.id === state()!.personal.tone)?.text ?? ""} Gjelder nye og eksisterende chatter som ikke har valgt sin egen med /personality.`}>
            <Select<ChatTone> label="Personlighet" value={state()!.personal.tone} options={CHAT_PERSONALITIES.map((p) => ({ value: p.id, label: p.label }))} onChange={(tone) => void setPersonal({ tone })} />
          </Row>
          <For each={CHAT_TRAITS}>
            {(trait) => (
              <Row label={trait.label} text={trait.text}>
                <Segmented<ChatTraitLevel>
                  label={trait.label}
                  value={state()!.personal.traits?.[trait.id] ?? 0}
                  options={TRAIT_LEVELS}
                  onChange={(level) => void setPersonal({ traits: { [trait.id]: level } as Record<ChatTraitId, ChatTraitLevel> })}
                />
              </Row>
            )}
          </For>
          <p class="muted small chat-style-note">Personlighet og stil endrer hvordan Chat skriver, ikke hva som er riktig. De gjelder bare Chat, ikke Kode eller Chat-prosjekter med egne instruksjoner.</p>
        </Group>

        <Show when={!textsValid()}><p class="form-error" role="alert">Hvert felt kan ha opptil 10 000 ord. Kort ned feltet som er over grensen før du lagrer.</p></Show>

        <ModelContextSettings mode="chat" />

        <Group title="Chat-minner">
          <Toggle
            label="Bruk Chat-minner"
            text="Chat får minnene under i nye samtaler. Av betyr at de blir liggende, men ikke brukes."
            checked={state()!.personal.memories}
            onChange={(memories) => void setPersonal({ memories })}
          />
          <Toggle
            label="Oppdater minnet av seg selv"
            text="Chat kan lagre navn og uttalte preferanser. Varige rettelser vises i samtalen for gjennomgang. Midlertidige chatter er unntatt."
            checked={state()!.personal.autoMemory}
            onChange={(autoMemory) => void setPersonal({ autoMemory })}
          />
        </Group>

        <Group
          title="Lagrede Chat-minner"
          action={
            <div class="memory-actions">
              <button type="button" class="btn btn-small" disabled={busy() || (state()!.memories.length < 2)} onClick={() => void tidy()} title="Slå sammen like minner og fjern utdaterte">Rydd</button>
              <button type="button" class="btn btn-small" onClick={() => setAdding(!adding())}><IconPlus size={13} />Legg til</button>
              <button type="button" class="btn btn-small btn-danger" disabled={!state()!.memories.length || busy()} onClick={() => void clearMemories()}>Slett alle</button>
            </div>
          }
        >
          <Show when={shown()} keyed>{(p) => <UpgradeView proposal={p} where="Chat" onDone={(changed) => { setProposal(null); void refetchPending(); if (changed) void refetch(); }} />}</Show>
          <Show when={adding()}>
            <form class="setting setting-block memory-form" onSubmit={(e) => { e.preventDefault(); void addMemory(); }}>
              <label class="field"><span>Nytt Chat-minne</span>
                <textarea class="input memory-input" rows={2} maxLength={MAX_MEMORY} placeholder="For eksempel: Jeg har en hund som heter Luna." value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
              </label>
              <div class="memory-form-row">
                <span class="muted small memory-count">{draft().trim().length} / {MAX_MEMORY}</span>
                <span class="spacer" />
                <button type="button" class="btn btn-small" onClick={() => setAdding(false)}>Avbryt</button>
                <button type="submit" class="btn btn-small btn-primary" disabled={!draft().trim() || busy()}>Lagre</button>
              </div>
            </form>
          </Show>
          <Show
            when={state()!.memories.length}
            fallback={<div class="setting memory-empty"><span class="muted">Ingen Chat-minner ennå. Legg til selv, eller slå på «Oppdater minnet av seg selv».</span></div>}
          >
            <ul class="memory-list" aria-label="Chat-minner">
              <For each={state()!.memories}>
                {(item) => (
                  <li class="setting memory-row">
                    <Show
                      when={editing() === item.id}
                      fallback={
                        <>
                          <div class="setting-text"><strong class="memory-text">{item.text}</strong></div>
                          <div class="setting-control">
                            <button type="button" class="icon-button" aria-label={`Endre «${item.text}»`} title="Endre" onClick={() => { setEditText(item.text); setEditing(item.id); }}><IconPencil size={14} /></button>
                            <button type="button" class="icon-button" aria-label={`Slett «${item.text}»`} title="Slett" disabled={busy()} onClick={() => void removeMemory(item)}><IconTrash size={14} /></button>
                          </div>
                        </>
                      }
                    >
                      <form class="memory-edit" onSubmit={(e) => { e.preventDefault(); void saveEdit(item); }}>
                        <textarea
                          class="input memory-input"
                          rows={2}
                          maxLength={MAX_MEMORY}
                          aria-label="Endre Chat-minnet"
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
                          <button type="button" class="btn btn-small" onClick={() => setEditing(null)}>Avbryt</button>
                          <button type="submit" class="btn btn-small btn-primary" disabled={!editText().trim() || busy()}>Lagre</button>
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
          Chat-minnene er vanlige linjer i <code>{state()!.file}</code>. Velg Kode over for å administrere Kode-minnene separat.
        </p>
      </Show>
    </section>
  );
}
