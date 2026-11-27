import { createMemo, createSignal, createUniqueId, For, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import type { ChatProject, Project } from "../../../shared/protocol";
import { t } from "../lib/i18n";
import { app, listed, mode, report, setFolderPickerOpen, sortedChatProjects, sortedProjects } from "../state/app";
import { newThreadIn, openChatProject, openNewProjectThread, openThread, switchProject } from "../state/navigate";
import { displayKeys, keysFor } from "../state/shortcuts";
import { ChatProjectGlyph } from "./ChatProjectGlyph";
import { IconChat, IconClose, IconCompose, IconFolder, IconMonitor, IconSearch } from "./icons";
import { IconFolderPlus } from "./nav-icons";
import { Popover } from "./Popover";
import { ProjectGlyph } from "./ProjectGlyph";
import "../styles/sidebar-project-picker.css";

type Entry = { id: string; label: string; detail?: string; icon: () => JSX.Element; run: () => void | Promise<void>; disabled?: boolean };

async function openProject(project: Project, create: boolean): Promise<void> {
  if (create) return openNewProjectThread(project.id);
  const latest = Object.values(app.threads)
    .filter((thread) => listed(thread) && !thread.archived && thread.projectId === project.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) await openThread(latest);
  else switchProject(project.id);
}

async function openChat(project: ChatProject, create: boolean): Promise<void> {
  if (create) await openNewProjectThread(null, project.id);
  else openChatProject(project.id);
}

function ProjectChoices(props: { create: boolean; title: string; onPick: () => void }) {
  const listId = `sidebar-projects-${createUniqueId()}`;
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal<string | null>(null);
  let search!: HTMLInputElement;
  let list!: HTMLDivElement;
  const entries = createMemo<Entry[]>(() => {
    const code = mode() === "code";
    const folders = sortedProjects().map((project): Entry => ({
      id: `code:${project.id}`, label: project.name, detail: project.path,
      disabled: props.create && project.folderMissing,
      icon: () => <ProjectGlyph project={project} size={19} />,
      run: () => openProject(project, props.create),
    }));
    const chats = sortedChatProjects().map((project): Entry => ({
      id: `chat:${project.id}`, label: project.name, detail: t("Chat-prosjekt"),
      icon: () => <ChatProjectGlyph project={project} size={19} />,
      run: () => openChat(project, props.create),
    }));
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const projects = (code ? [...folders, ...chats] : [...chats, ...folders]).filter(
      (entry) => words.every((word) => `${entry.label} ${entry.detail}`.toLowerCase().includes(word)),
    );
    if (props.create && !words.length) {
      if (code) projects.unshift({ id: "local", label: t("Denne datamaskinen"), icon: () => <IconMonitor size={19} />, run: () => newThreadIn(null, true) });
      projects.unshift({ id: "chat", label: t("Ny chat uten prosjekt"), icon: () => <IconChat size={19} />, run: () => newThreadIn(null) });
    }
    return projects;
  });
  const optionId = (id: string) => `${listId}-${encodeURIComponent(id)}`;
  const selected = () => entries().find((entry) => entry.id === active() && !entry.disabled);
  const choose = (entry: Entry) => {
    if (entry.disabled) return;
    props.onPick();
    Promise.resolve(entry.run()).catch(report);
  };
  const onSearchKey = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const rows = entries().filter((entry) => !entry.disabled);
    if (!rows.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      choose(selected() ?? rows[0]);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = rows.indexOf(selected()!);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = rows[index < 0 ? (step > 0 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length];
    setActive(next.id);
    const row = document.getElementById(optionId(next.id));
    if (!row) return;
    const viewport = list.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    if (bounds.top < viewport.top) list.scrollTop -= viewport.top - bounds.top;
    else if (bounds.bottom > viewport.bottom) list.scrollTop += bounds.bottom - viewport.bottom;
  };
  onMount(() => search.focus({ preventScroll: true }));

  return <div class="sidebar-project-choices">
    <label class="model-search">
      <IconSearch size={15} />
      <input ref={search} role="combobox" aria-label={t("Søk etter prosjekter")} aria-expanded="true" aria-autocomplete="list"
        aria-controls={listId} aria-activedescendant={selected() ? optionId(selected()!.id) : undefined}
        placeholder={t("Søk etter prosjekter")} autocomplete="off" spellcheck={false}
        value={query()} onInput={(event) => { setQuery(event.currentTarget.value); setActive(null); list.scrollTop = 0; }} onKeyDown={onSearchKey} />
    </label>
    <div class="sidebar-project-list" ref={list} role="listbox" id={listId} aria-label={props.title}>
      <For each={entries()}>{(entry) => (
        <button type="button" class="menu-item picker-project" role="option" tabindex="-1" id={optionId(entry.id)}
          aria-selected={entry.id === selected()?.id} disabled={entry.disabled} title={entry.disabled ? t("Prosjektmappen mangler.") : entry.detail}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(entry)}>
          {entry.icon()}
          <span class="menu-stack">
            <span class="menu-name">{entry.label}</span>
            <Show when={entry.detail}><span class="picker-path">{entry.detail}</span></Show>
          </span>
        </button>
      )}</For>
    </div>
    <Show when={!entries().length}><p class="model-none" role="status">{query() ? t("Ingen prosjekter funnet.") : t("Ingen prosjekter ennå.")}</p></Show>
    <footer class="sidebar-project-foot">
      <button type="button" class="menu-item" onClick={() => { props.onPick(); setFolderPickerOpen(true); }}>
        <IconFolderPlus size={16} /><span class="menu-name">{t("Legg til nytt prosjekt…")}</span>
      </button>
    </footer>
  </div>;
}

export function NewThreadProjectButton(props: { class: string; size?: number; showLabel?: boolean; onPick?: () => void }) {
  const [open, setOpen] = createSignal(false);
  const close = () => setOpen(false);
  function PickerDialog() {
    let dialog!: HTMLDialogElement;
    onMount(() => {
      dialog.showModal();
      dialog.querySelector("input")?.focus({ preventScroll: true });
    });
    const closeDialog = () => { dialog.close(); close(); };
    return <dialog class="dialog sidebar-project-dialog" ref={dialog} aria-label={t("Ny tråd")} data-testid="new-thread-project-picker"
      onCancel={(event) => { event.preventDefault(); closeDialog(); }} onClick={(event) => { if (event.target === dialog) closeDialog(); }}>
      <div class="sidebar-project-header">
        <h2>{t("Ny tråd")}</h2>
        <button type="button" class="icon-button" aria-label={t("Lukk")} onClick={closeDialog}><IconClose size={16} /></button>
      </div>
      <ProjectChoices create title={t("Prosjekter")} onPick={() => { closeDialog(); props.onPick?.(); }} />
    </dialog>;
  }

  return <>
    <button type="button" class={props.class} aria-label={t("Ny tråd")} aria-haspopup="dialog" aria-expanded={open()}
      title={t("Ny tråd ({keys})", { keys: displayKeys(keysFor("thread.new")) })} onClick={() => setOpen(true)}>
      <IconCompose size={props.size ?? 16} /><Show when={props.showLabel}><span>{t("Ny tråd")}</span></Show>
    </button>
    <Show when={open()}><Portal><PickerDialog /></Portal></Show>
  </>;
}

export function SidebarProjectsButton(props: { class: string; size?: number; onPick?: () => void }) {
  const [open, setOpen] = createSignal(false);
  return <Popover class="sidebar-project-anchor" panelClass="sidebar-project-popover" open={open()} onClose={() => setOpen(false)} fixed portal below stable returnFocus
    trigger={<button type="button" class={props.class} title={t("Prosjekter")} aria-label={t("Prosjekter")} aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}>
      <IconFolder size={props.size ?? 16} />
    </button>}>
    <div class="sidebar-project-panel" role="dialog" aria-label={t("Prosjekter")} data-testid="sidebar-project-list">
      <ProjectChoices create={false} title={t("Prosjekter")} onPick={() => { setOpen(false); props.onPick?.(); }} />
    </div>
  </Popover>;
}
