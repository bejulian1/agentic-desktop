// Rediger prosjekt: one dialog for everything about a project, in three tabs. Generelt: the name,
// the icon and colour, the folder, and removing the project from the app (nothing on disk is ever
// deleted). Agent: the default model, the permission mode and the project's own instructions in
// .agentic/AGENTS.md. Kilder: where each setting comes from, in words. Lagre saves it all at once.
import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import { del, get, patch, put } from "../lib/api";
import type { PermissionMode, Project, ProjectConfig } from "../../../shared/protocol";
import { PROJECT_COLORS, PROJECT_ICONS } from "../../../shared/protocol";
import { app, report, toast } from "../state/app";
import { confirmDialog, pickFolder } from "./dialogs";
import { IconClose, IconFolder, IconSearch } from "./icons";
import { EMOJIS, ICON_NAMES } from "./nav-icons";
import { iconFor, ProjectGlyph } from "./ProjectGlyph";
import { AgentTab, SourcesTab } from "./ProjectSettings";
import { editing, setEditing, type ProjectTab } from "./dialog-state";

// The state is in dialog-state.ts, so this file loads only when the dialog opens.
export { openEditProject, type ProjectTab } from "./dialog-state";

const TABS: Array<{ id: ProjectTab; label: string }> = [
  { id: "general", label: "Generelt" },
  { id: "agent", label: "Agent" },
  { id: "sources", label: "Kilder" },
];

function basename(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() || p;
}

// Emoji and icons, a search, and the colours. Picking only changes the draft.
export function IconPicker(props: { icon: string | null; color: string | null; onIcon: (icon: string | null) => void; onColor: (color: string | null) => void }) {
  const [tab, setTab] = createSignal<"emoji" | "icons">(props.icon?.startsWith("emoji:") ? "emoji" : "icons");
  const [query, setQuery] = createSignal("");
  const icons = createMemo(() => {
    const q = query().trim().toLowerCase();
    return PROJECT_ICONS.filter((id) => !q || id.includes(q) || (ICON_NAMES[id] ?? "").includes(q));
  });
  const emojis = createMemo(() => {
    const q = query().trim().toLowerCase();
    return EMOJIS.filter(([e, words]) => !q || words.includes(q) || e === q);
  });
  return (
    <div class="icon-picker" data-testid="icon-picker">
      <div class="icon-picker-tabs" role="tablist" aria-label="Type ikon">
        <button type="button" role="tab" class="stats-tab" aria-selected={tab() === "emoji"} onClick={() => setTab("emoji")}>Emoji</button>
        <button type="button" role="tab" class="stats-tab" aria-selected={tab() === "icons"} onClick={() => setTab("icons")}>Ikoner</button>
        <span class="sidebar-spacer" />
        <button type="button" class="btn btn-small" disabled={!props.icon} title="Bruk prosjektets favicon hvis det har et, ellers en mappe" onClick={() => props.onIcon(null)}>Standard</button>
      </div>
      <label class="icon-picker-search">
        <IconSearch size={14} />
        <input class="search-input" type="search" placeholder={tab() === "emoji" ? "Søk etter emoji" : "Søk etter ikoner"} aria-label="Søk etter ikoner" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      <div class="icon-picker-colors" role="radiogroup" aria-label="Farge">
        <button type="button" role="radio" class="swatch swatch-none" aria-checked={!props.color} aria-label="Ingen farge" title="Ingen farge" onClick={() => props.onColor(null)} />
        <For each={PROJECT_COLORS}>
          {(c) => <button type="button" role="radio" class="swatch" aria-checked={props.color === c.id} aria-label={c.label} title={c.label} style={`--swatch:${c.value}`} onClick={() => props.onColor(c.id)} />}
        </For>
      </div>
      <div class="icon-picker-grid" role="radiogroup" aria-label={tab() === "emoji" ? "Emoji" : "Ikoner"}>
        <Show
          when={tab() === "icons"}
          fallback={
            <For each={emojis()} fallback={<p class="muted small">Ingen treff</p>}>
              {([emoji, words]) => (
                <button type="button" role="radio" class="icon-picker-cell emoji" aria-checked={props.icon === `emoji:${emoji}`} aria-label={words} title={words} onClick={() => props.onIcon(`emoji:${emoji}`)}>{emoji}</button>
              )}
            </For>
          }
        >
          <For each={icons()} fallback={<p class="muted small">Ingen treff</p>}>
            {(id) => {
              const Icon = iconFor(id);
              const color = () => PROJECT_COLORS.find((c) => c.id === props.color)?.value;
              return (
                <button type="button" role="radio" class="icon-picker-cell" aria-checked={(props.icon ?? "folder") === id} aria-label={ICON_NAMES[id]?.split(" ")[0] ?? id} title={ICON_NAMES[id] ?? id} style={color() ? `color:${color()}` : undefined} onClick={() => props.onIcon(id)}>
                  {Icon ? Icon({ size: 18 }) : null}
                </button>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}

function Dialog(props: { project: Project; tab: ProjectTab }) {
  let dialog!: HTMLDialogElement;
  const project = () => app.projects[props.project.id] ?? props.project;
  const [tab, setTab] = createSignal<ProjectTab>(props.tab);
  const [name, setName] = createSignal(props.project.name);
  const [icon, setIcon] = createSignal<string | null>(props.project.icon);
  const [color, setColor] = createSignal<string | null>(props.project.color);
  const [model, setModel] = createSignal<string | null>(props.project.defaultModelId ?? null);
  const [permission, setPermission] = createSignal<PermissionMode>(props.project.permissionMode);
  const [instructions, setInstructions] = createSignal<string | null>(null); // null: unchanged
  const [config, { refetch }] = createResource(() => get<ProjectConfig>(`/api/projects/${props.project.id}/config`));
  const [picking, setPicking] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const close = () => setEditing(null);
  onMount(() => dialog.showModal());

  const save = async () => {
    if (!name().trim()) {
      setTab("general");
      return toast("Navnet kan ikke være tomt.");
    }
    setBusy(true);
    try {
      const body: Partial<Project> = { name: name().trim(), icon: icon(), color: color() };
      if (model() !== (project().defaultModelId ?? null)) body.defaultModelId = model();
      if (permission() !== project().permissionMode) body.permissionMode = permission();
      await patch(`/api/projects/${props.project.id}`, body);
      if (instructions() !== null && instructions() !== (config()?.project.agentsMd ?? "")) {
        await put(`/api/projects/${props.project.id}/instructions`, { text: instructions() ?? "" });
        toast("Lagret .agentic/AGENTS.md.", "info");
      }
      close();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };
  const move = async () => {
    const folder = await pickFolder(project().path);
    if (!folder || folder === project().path) return;
    try {
      await patch(`/api/projects/${props.project.id}`, { path: folder });
      void refetch();
      toast("Prosjektmappen er byttet.", "info");
    } catch (err) {
      report(err);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: "Fjerne prosjektet?", text: `«${project().name}» og trådene fjernes fra appen. Mappen og filene på disken røres aldri.`, confirm: "Fjern", danger: true });
    if (!ok) return;
    try {
      await del(`/api/projects/${props.project.id}`);
      close();
    } catch (err) {
      report(err);
    }
  };
  const onTabKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const at = TABS.findIndex((t) => t.id === tab());
    const next = TABS[(at + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next.id);
    dialog.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <dialog ref={dialog} class="dialog edit-project" aria-label="Rediger prosjekt" onCancel={(e) => { if (picking()) { e.preventDefault(); setPicking(false); } else close(); }}>
      <div class="dialog-head">
        <h2>Rediger prosjekt</h2>
        <button type="button" class="icon-button" aria-label="Lukk" onClick={close}><IconClose size={15} /></button>
      </div>
      <div class="edit-project-tabs" role="tablist" aria-label="Del av prosjektet" onKeyDown={onTabKey}>
        <For each={TABS}>
          {(t) => (
            <button type="button" role="tab" class="edit-project-tab" data-tab={t.id} aria-selected={tab() === t.id} tabindex={tab() === t.id ? 0 : -1} onClick={() => setTab(t.id)}>{t.label}</button>
          )}
        </For>
      </div>
      <div class="edit-project-body" role="tabpanel" aria-label={TABS.find((t) => t.id === tab())!.label}>
        <Show when={tab() === "general"}>
          <div class="edit-project-name">
            <button type="button" class="edit-project-glyph" aria-label="Velg ikon" title="Velg ikon og farge" aria-expanded={picking()} onClick={() => setPicking(!picking())}>
              <ProjectGlyph project={{ id: props.project.id, icon: icon(), color: color() }} size={18} />
            </button>
            <input class="edit-project-input" aria-label="Navn" value={name()} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
          </div>
          <Show when={picking()}>
            <IconPicker icon={icon()} color={color()} onIcon={setIcon} onColor={setColor} />
          </Show>
          <div class="edit-project-label">Kildemappe</div>
          <div class="edit-project-folders">
            <div class="edit-project-folder" title={project().path}>
              <IconFolder size={15} />
              <span class="edit-project-folder-name">{basename(project().path)}</span>
              <span class="edit-project-folder-path"><bdo dir="ltr">{project().path}</bdo></span>
              <button type="button" class="btn btn-small" onClick={move}>Bytt mappe…</button>
            </div>
          </div>
        </Show>
        <Show when={tab() === "agent"}>
          <AgentTab
            model={model()}
            onModel={setModel}
            permission={permission()}
            onPermission={setPermission}
            instructions={instructions() ?? config()?.project.agentsMd ?? ""}
            onInstructions={setInstructions}
          />
        </Show>
        <Show when={tab() === "sources"}>
          <SourcesTab config={config()} />
        </Show>
      </div>
      <div class="edit-project-actions">
        <button type="button" class="btn btn-quiet-danger edit-project-remove" onClick={remove}>Fjern prosjektet…</button>
        <span class="sidebar-spacer" />
        <button type="button" class="btn" onClick={close}>Avbryt</button>
        <button type="button" class="btn btn-primary" disabled={busy()} onClick={save}>Lagre</button>
      </div>
    </dialog>
  );
}

export function EditProjectHost() {
  const target = createMemo(() => {
    const e = editing();
    const project = e ? app.projects[e.id] : undefined;
    return project && e ? { project, tab: e.tab } : undefined;
  }, undefined, { equals: (a, b) => a?.project.id === b?.project.id && a?.tab === b?.tab });
  return (
    <Show when={target()} keyed>
      {(t) => <Dialog project={t.project} tab={t.tab} />}
    </Show>
  );
}
