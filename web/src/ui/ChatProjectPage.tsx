import { language } from "../lib/i18n.ts";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { ChatProject, Thread } from "../../../shared/protocol";
import { app, deleteThread, mode, renameThread, report, setApp } from "../state/app";
import { chatProjectPageId } from "../state/nav";
import { openThread } from "../state/navigate";
import { Composer } from "./Composer";
import { ChatProjectGlyph } from "./ChatProjectGlyph";
import { editChatProject, removeChatProject } from "./chat-projects";
import { confirmDialog, promptDialog } from "./dialogs";
import { IconBook, IconChat, IconPencil, IconSearch, IconSettings, IconTrash } from "./icons";
import "../styles/chat-projects.css";

export default function ChatProjectPage(props: { project: ChatProject }) {
  const id = props.project.id;
  const project = () => app.chatProjects[id] ?? props.project;
  const [created, setCreated] = createSignal<Thread | null>(null);
  const [query, setQuery] = createSignal("");
  const [archived, setArchived] = createSignal(false);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");
  let mounted = true;
  onCleanup(() => { mounted = false; });
  const all = createMemo(() => Object.values(app.threads).filter((thread): thread is Thread => !!thread && thread.mode === "chat" && !thread.projectId && thread.chatProjectId === id).sort((a, b) => b.updatedAt - a.updatedAt));
  const shown = createMemo(() => {
    const words = query().trim().toLocaleLowerCase(language()).split(/\s+/).filter(Boolean);
    return all().filter(thread => thread.archived === archived() && words.every(word => thread.title.toLocaleLowerCase(language()).includes(word)));
  });
  const archivedCount = () => all().filter(thread => thread.archived).length;
  const run = async (threadId: string, work: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(threadId);
    setError("");
    try { await work(); }
    catch (err) { setError(err instanceof Error ? err.message : "Kunne ikke oppdatere chatten."); }
    finally { setBusy(null); }
  };
  const rename = async (thread: Thread) => {
    const title = await promptDialog({ title: "Gi chatten nytt navn", value: thread.title, confirm: "Lagre" });
    if (!title?.trim() || title.trim() === thread.title) return;
    await run(thread.id, async () => {
      await renameThread(thread.id, title.trim());
      if (app.threads[thread.id]) setApp("threads", thread.id, "title", title.trim());
    });
  };
  const remove = async (thread: Thread) => {
    if (!await confirmDialog({ title: "Slette chatten?", text: `«${thread.title}» slettes for godt fra prosjektet. Dette kan ikke angres.`, confirm: "Slett chatten", danger: true })) return;
    await run(thread.id, async () => {
      await deleteThread(thread.id);
      if (app.threads[thread.id]) setApp("threads", thread.id, undefined!);
    });
  };
  const accepted = (threadId: string) => {
    const thread = created();
    if (!mounted || mode() !== "chat" || chatProjectPageId() !== id || !thread || thread.id !== threadId) return;
    void openThread(thread).catch(report);
  };

  return <section class="chat-project-page" aria-label={`Chat-prosjekt: ${project().name}`} data-testid="chat-project-page" data-chat-project-id={id}>
    <div class="chat-project-page-content">
      <header class="chat-project-page-header">
        <span class="chat-project-large-glyph"><ChatProjectGlyph project={project()} size={30} /></span>
        <div class="chat-project-page-title"><span class="muted small">Prosjekt i Chat</span><h1>{project().name}</h1></div>
        <button type="button" class="btn btn-small" aria-label={`Rediger prosjektet ${project().name}`} onClick={() => void editChatProject(project())}><IconSettings size={15} /><span>Rediger prosjekt</span></button>
      </header>
      <div class="chat-project-boundary"><IconBook size={14} /><span>{project().memoryMode === "shared" ? "Egne instruksjoner · delte globale Chat-minner" : "Egne instruksjoner og prosjektminner"}</span></div>
      <div class="chat-project-composer" aria-label="Start en chat i prosjektet">
        <Composer paneKey={`chat-project:${id}`} projectId={null} chatProjectId={id} threadId={() => created()?.id ?? null} onThreadCreated={setCreated} onSent={() => {}} onAccepted={accepted} autofocus />
        <p class="chat-project-composer-note muted small">Nye chatter bruker prosjektets instruksjoner og valgte minner. Meldinger og vedlegg gir også kontekst.</p>
      </div>
      <section class="chat-project-chat-list" aria-label="Chatter i prosjektet">
        <div class="chat-project-section-head"><h2>Chatter <span class="muted small">{shown().length}</span></h2><Show when={archivedCount() || archived()}><button type="button" class="btn btn-small" aria-pressed={archived()} onClick={() => setArchived(!archived())}>{archived() ? "Vis aktive" : `Vis arkiverte (${archivedCount()})`}</button></Show></div>
        <Show when={all().length}><label class="chat-project-chat-search"><IconSearch size={15} /><input type="search" class="input" aria-label="Søk i prosjektets chatter" value={query()} placeholder="Søk i prosjektets chatter" onInput={event => setQuery(event.currentTarget.value)} /></label></Show>
        <Show when={error()}><p class="chat-project-error" role="alert">{error()}</p></Show>
        <ul class="chat-project-thread-list">
          <For each={shown()} fallback={<li class="chat-project-empty"><IconChat size={24} /><strong>{query().trim() ? "Ingen chatter passer søket" : archived() ? "Ingen arkiverte chatter" : "Start den første chatten"}</strong><span class="muted">{query().trim() ? "Prøv et annet søkeord." : "Skriv en melding i feltet over. Chattene dine samles her."}</span></li>}>{thread => <li class="chat-project-thread" data-project-thread={thread.id}>
            <button type="button" class="chat-project-thread-open" onClick={() => void openThread(thread)}><IconChat size={17} /><span><strong>{thread.title}</strong><time dateTime={new Date(thread.updatedAt).toISOString()}>{new Date(thread.updatedAt).toLocaleDateString(language(), { day: "numeric", month: "short", year: "numeric" })}<Show when={thread.running}> · Arbeider</Show></time></span></button>
            <div class="chat-project-thread-actions"><button type="button" class="icon-button" title="Gi nytt navn" aria-label={`Gi chatten «${thread.title}» nytt navn`} disabled={!!busy()} onClick={() => void rename(thread)}><IconPencil size={15} /></button><button type="button" class="icon-button" title="Slett chatten" aria-label={`Slett chatten «${thread.title}»`} disabled={!!busy()} onClick={() => void remove(thread)}><IconTrash size={15} /></button></div>
          </li>}</For>
        </ul>
      </section>
      <footer class="chat-project-page-footer"><button type="button" class="link-button" onClick={() => void removeChatProject(project())}>Fjern prosjektet…</button></footer>
    </div>
  </section>;
}
