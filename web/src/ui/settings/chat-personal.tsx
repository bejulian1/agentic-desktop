// Innstillinger → Chat-personalisering (SPEC 22.4): Chat's own place, apart from Kode. A system
// instruction, a few lines about you, a tone, and Chat memories with «Oppdater minnet av seg selv».
// Chat never gets the Kode harness, the global AGENTS.md or the Kode memories, and Kode never gets
// any of this.
import { createResource, createSignal, For, Show } from "solid-js";
import type { ChatPersonal, ChatTone, HarnessInfo, MemoryItem, UpgradeProposal } from "../../../../shared/protocol";
import { del, get, post, put } from "../../lib/api";
import { report, setSettingsOpen, toast } from "../../state/app";
import { confirmDialog } from "../dialogs";
import { IconPencil, IconPlus, IconReset, IconTrash } from "../icons";
import { Group, Page, Row, SkeletonRows, Toggle } from "./parts";
import { Select } from "../Select";
import { UpgradeView } from "./memory-upgrade";

interface ChatState {
  personal: ChatPersonal;
  memories: MemoryItem[];
  file: string;
}

const MAX = 1500;
const MAX_MEMORY = 300;

const TONES: Array<{ value: ChatTone; label: string; text: string }> = [
  { value: "standard", label: "Standard", text: "Som modellen svarer selv" },
  { value: "kort", label: "Kort", text: "Noen setninger eller en kort liste" },
  { value: "vennlig", label: "Vennlig", text: "Varm, uten fyllord" },
  { value: "grundig", label: "Grundig", text: "Forklarer og tar med kanttilfeller" },
  { value: "uformell", label: "Uformell", text: "Som en kunnskapsrik venn" },
  { value: "formell", label: "Formell", text: "Presis og saklig" },
];

export function ChatPersonalPage() {
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

  const saveTexts = async () => {
    const ok = await setPersonal({ instructions: value("instructions"), about: value("about") }, "Lagret. Nye svar i Chat bruker det.");
    if (ok) {
      setInstructions(null);
      setAbout(null);
    }
  };

  const reset = async () => {
    const ok = await confirmDialog({
      title: "Tilbakestille Chat-personaliseringen?",
      text: "Systeminstruksen og «Om deg» tømmes, og tonen blir Standard. Chat-minnene blir stående.",
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

  const counter = (field: "instructions" | "about") => <span class="muted small chat-count" classList={{ over: value(field).length > MAX }}>{value(field).length} / {MAX}</span>;

  return (
    <Page title="Chat-personalisering" intro="Gjelder bare Chat. Kode har sin egen harness, med AGENTS.md og egne minner, og ingenting herfra går dit.">
      <Show when={state()} fallback={<SkeletonRows label="Henter personaliseringen…" />}>
        <Group
          title="Om deg og svarene"
          action={
            <div class="memory-actions">
              <button type="button" class="btn btn-small" disabled={busy()} onClick={() => void reset()}><IconReset size={13} />Tilbakestill</button>
              <button type="button" class="btn btn-small btn-primary" disabled={!dirty() || busy()} onClick={() => void saveTexts()}>Lagre</button>
            </div>
          }
        >
          <div class="setting setting-block">
            <label class="field">
              <span class="chat-field-head"><strong>Systeminstruks</strong>{counter("instructions")}</span>
              <span class="muted small">Hvordan Chat skal svare. Gjelder alle nye svar i Chat.</span>
              <textarea class="input chat-area" rows={4} maxLength={MAX} value={value("instructions")} onInput={(e) => setInstructions(e.currentTarget.value)} placeholder="For eksempel: Forklar som til en nybegynner. Bruk norske eksempler." />
            </label>
          </div>
          <div class="setting setting-block">
            <label class="field">
              <span class="chat-field-head"><strong>Om deg</strong>{counter("about")}</span>
              <span class="muted small">Det Chat bør vite om deg: hva du jobber med, hva du kan, hva du liker.</span>
              <textarea class="input chat-area" rows={3} maxLength={MAX} value={value("about")} onInput={(e) => setAbout(e.currentTarget.value)} placeholder="For eksempel: Jeg er lærer i Bergen og lærer meg Python." />
            </label>
          </div>
          <Row label="Tone" text={TONES.find((t) => t.value === state()!.personal.tone)?.text ?? ""}>
            <Select<ChatTone> label="Tone" value={state()!.personal.tone} options={TONES.map((t) => ({ value: t.value, label: t.label }))} onChange={(tone) => void setPersonal({ tone })} />
          </Row>
        </Group>

        <Group title="Chat-minner">
          <Toggle
            label="Bruk Chat-minner"
            text="Chat får minnene under i nye samtaler. Av betyr at de blir liggende, men ikke brukes."
            checked={state()!.personal.memories}
            onChange={(memories) => void setPersonal({ memories })}
          />
          <Toggle
            label="Oppdater minnet av seg selv"
            text="Når du ber Chat huske noe, eller forteller hva du heter eller foretrekker, lagres det her. Nøkler, tokens og passord lagres aldri, og midlertidige chatter huskes ikke."
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
          Chat-minnene er vanlige linjer i <code>{state()!.file}</code>. Kode-minnene ligger under{" "}
          <button type="button" class="link-button" onClick={() => setSettingsOpen("personalization")}>Personalisering og minner</button>.
        </p>
      </Show>
    </Page>
  );
}
