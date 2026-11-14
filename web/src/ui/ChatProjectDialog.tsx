import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { CHAT_PROJECT_ICONS, MAX_CHAT_FIELD, MAX_CHAT_WORDS, PROJECT_COLORS, type ChatProject, type ChatProjectMemoryMode } from "../../../shared/protocol";
import { patch, post } from "../lib/api";
import { app, setApp } from "../state/app";
import { chatProjectDialog, setChatProjectDialog, type ChatProjectDialogRequest } from "./dialog-state";
import { ChatProjectGlyph } from "./ChatProjectGlyph";
import { ChatProjectMemories } from "./ChatProjectMemories";
import { IconCheck, IconClose } from "./icons";
import { iconFor } from "./ProjectGlyph";
import { removeChatProject } from "./chat-projects";
import "../styles/chat-projects.css";

const ICON_LABELS: Record<string, string> = {
  folder: "Mappe", book: "Bok", school: "Utdanning", pencil: "Skriving", brain: "Tanker",
  spark: "Ideer", globe: "Verden", plane: "Reise", chart: "Diagram", palette: "Kunst",
  music: "Musikk", health: "Helse", leaf: "Natur", flask: "Forskning", team: "Samarbeid",
};

function ChatProjectDialog(props: { request: ChatProjectDialogRequest }) {
  let dialog!: HTMLDialogElement;
  let nameInput!: HTMLInputElement;
  // Solid store objects can change through WebSocket updates. Editing compares against the
  // immutable snapshot the user opened, so a second window cannot be overwritten silently.
  const initial = props.request.project ? { ...props.request.project } : null;
  const savedProject = () => initial ? app.chatProjects[initial.id] ?? initial : null;
  const [name, setName] = createSignal(initial?.name ?? "");
  const [icon, setIcon] = createSignal(initial?.icon ?? "folder");
  const [color, setColor] = createSignal<string | null>(initial?.color ?? "blue");
  const [instructions, setInstructions] = createSignal(initial?.instructions ?? "");
  const [memoryMode, setMemoryMode] = createSignal<ChatProjectMemoryMode>(initial?.memoryMode ?? "project");
  const [autoMemory, setAutoMemory] = createSignal(initial?.autoMemory ?? false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const words = createMemo(() => instructions().match(/\S+/g)?.length ?? 0);
  const tooLong = () => words() > MAX_CHAT_WORDS || instructions().length > MAX_CHAT_FIELD;
  const valid = () => !!name().trim() && !tooLong();
  const close = (project: ChatProject | null = null) => {
    if (chatProjectDialog() !== props.request) return;
    props.request.resolve(project);
    setChatProjectDialog(null);
  };
  onMount(() => {
    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  });

  const save = async () => {
    if (busy() || !valid()) return;
    setBusy(true);
    setError("");
    try {
      const body = { name: name().trim(), icon: icon(), color: color(), instructions: instructions(), memoryMode: memoryMode(), autoMemory: autoMemory(), ...(initial ? { expected: { name: initial.name, icon: initial.icon, color: initial.color, instructions: initial.instructions, memoryMode: initial.memoryMode, autoMemory: initial.autoMemory } } : {}) };
      const project = initial
        ? await patch<ChatProject>(`/api/chat-projects/${encodeURIComponent(initial.id)}`, body)
        : await post<ChatProject>("/api/chat-projects", body);
      setApp("chatProjects", project.id, project);
      close(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre prosjektet. Prøv igjen.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial || busy()) return;
    setBusy(true);
    try { if (await removeChatProject(initial)) close(); }
    finally { setBusy(false); }
  };
  const memoryModeChanged = () => !!initial && memoryMode() !== (savedProject()?.memoryMode ?? "project");

  return <dialog ref={dialog} class="dialog chat-project-dialog" aria-label={initial ? "Rediger Chat-prosjekt" : "Nytt prosjekt i Chat"} data-testid="chat-project-dialog" onCancel={event => { event.preventDefault(); if (!busy()) close(); }}>
    <form class="chat-project-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div class="dialog-head">
        <div class="chat-project-dialog-title"><ChatProjectGlyph project={{ icon: icon(), color: color() }} size={24} /><h2>{initial ? "Rediger Chat-prosjekt" : "Nytt prosjekt i Chat"}</h2></div>
        <button type="button" class="icon-button" aria-label="Lukk prosjektinnstillinger" disabled={busy()} onClick={() => close()}><IconClose size={17} /></button>
      </div>
      <div class="chat-project-dialog-body">
        <label class="field"><span>Prosjektnavn</span><input ref={nameInput} class="input" name="chat-project-name" data-testid="chat-project-name" value={name()} maxLength={200} required disabled={busy()} placeholder="Hva vil du samle her?" onInput={event => setName(event.currentTarget.value)} /></label>
        <fieldset class="chat-project-fieldset" disabled={busy()}><legend>Prosjektikon</legend>
          <div class="chat-project-icon-grid" aria-label="15 prosjektikoner">
            <For each={CHAT_PROJECT_ICONS}>{id => {
              const Icon = iconFor(id);
              return <button type="button" class="chat-project-icon-option" aria-pressed={icon() === id} aria-label={ICON_LABELS[id] ?? id} title={ICON_LABELS[id] ?? id} data-project-icon={id} style={{ color: PROJECT_COLORS.find(c => c.id === color())?.value }} onClick={() => setIcon(id)}>{Icon?.({ size: 21 })}</button>;
            }}</For>
          </div>
        </fieldset>
        <fieldset class="chat-project-fieldset" disabled={busy()}><legend>Ikonfarge</legend>
          <div class="chat-project-color-grid">
            <button type="button" class="chat-project-color-option chat-project-color-default" aria-label="Standardfarge" aria-pressed={!color()} title="Standardfarge" onClick={() => setColor(null)}><Show when={!color()}><IconCheck size={15} /></Show></button>
            <For each={PROJECT_COLORS}>{entry => <button type="button" class="chat-project-color-option" aria-label={entry.label} title={entry.label} aria-pressed={color() === entry.id} style={{ "--project-color": entry.value }} onClick={() => setColor(entry.id)}><Show when={color() === entry.id}><IconCheck size={15} /></Show></button>}</For>
          </div>
        </fieldset>
        <label class="field"><span>Instruksjoner for prosjektet</span>
          <span class="muted small" id="chat-project-instructions-help">Fortell hvordan modellen skal svare og arbeide i disse chattene. Prosjektet bruker sine egne instruksjoner. Global systeminstruks, profil, tone og personlighet brukes ikke.</span>
          <textarea class="input chat-project-instructions" name="chat-project-instructions" data-testid="chat-project-instructions" aria-describedby="chat-project-instructions-help chat-project-word-count" aria-invalid={tooLong()} rows={7} value={instructions()} disabled={busy()} placeholder="For eksempel: Svar på norsk. Bruk kildene og begrepene vi har avtalt i prosjektet." onInput={event => setInstructions(event.currentTarget.value)} />
          <span class="chat-project-word-count" id="chat-project-word-count" classList={{ "chat-project-error": tooLong() }}>{words().toLocaleString("nb-NO")} / {MAX_CHAT_WORDS.toLocaleString("nb-NO")} ord<Show when={instructions().length > MAX_CHAT_FIELD}> · Maks {MAX_CHAT_FIELD.toLocaleString("nb-NO")} tegn</Show></span>
        </label>
        <fieldset class="chat-project-fieldset" disabled={busy()}><legend>Minner</legend>
          <div class="chat-project-memory-options">
            <label class="chat-project-memory-option" classList={{ selected: memoryMode() === "project" }}><input type="radio" name="chat-project-memory-mode" value="project" checked={memoryMode() === "project"} onChange={() => setMemoryMode("project")} /><span><strong>Egne prosjektminner</strong><span>Brukes bare i dette prosjektet. Andre Chat-prosjekter og globale Chat-minner holdes utenfor.</span></span><span class="pill">Standard</span></label>
            <label class="chat-project-memory-option" classList={{ selected: memoryMode() === "shared" }}><input type="radio" name="chat-project-memory-mode" value="shared" checked={memoryMode() === "shared"} onChange={() => setMemoryMode("shared")} /><span><strong>Del globale Chat-minner</strong><span>Les og oppdater de samme minnene som vanlig Chat og andre prosjekter som har valgt dette. Prosjektinstruksjonene forblir egne.</span></span></label>
          </div>
          <p class="muted small">Kode-minner deles aldri. Ved bytte beholdes prosjektets egne minner, klare når du velger dem igjen.</p>
          <label class="chat-project-auto-memory"><input type="checkbox" name="chat-project-auto-memory" checked={autoMemory()} onChange={event => setAutoMemory(event.currentTarget.checked)} /><span><strong>La modellen lagre nye minner</strong><span class="muted small">Gjelder bare dette prosjektet og den valgte minnetypen. Du kan alltid legge til og endre minner selv.</span></span></label>
        </fieldset>
        <Show when={initial}>
          <Show when={!memoryModeChanged()} fallback={<p class="chat-project-memory-notice" role="status">Lagre den nye minnetypen før du administrerer minnene. Ingen minner er flyttet eller slettet.</p>}>
            <ChatProjectMemories projectId={initial!.id} memoryMode={savedProject()?.memoryMode ?? "project"} />
          </Show>
        </Show>
        <Show when={error()}><p class="chat-project-error" role="alert">{error()}</p></Show>
      </div>
      <div class="dialog-actions chat-project-dialog-actions">
        <Show when={initial}><button type="button" class="btn btn-danger chat-project-delete" disabled={busy()} onClick={() => void remove()}>Fjern prosjektet…</button></Show>
        <button type="button" class="btn" disabled={busy()} onClick={() => close()}>Avbryt</button>
        <button type="submit" class="btn btn-primary" data-testid="chat-project-save" disabled={busy() || !valid()}>{busy() ? "Lagrer…" : initial ? "Lagre" : "Lag prosjektet"}</button>
      </div>
    </form>
  </dialog>;
}

export function ChatProjectDialogHost() {
  return <Show when={chatProjectDialog()} keyed>{request => <ChatProjectDialog request={request} />}</Show>;
}
