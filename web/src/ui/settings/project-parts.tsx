// v1.3.0: the parts Innstillinger → Prosjekter is built from, as in T3 Code's project settings: the
// model and effort chips for new threads, the Handlinger card (project scripts), the dialogs that
// choose an icon, and an instructions editor with Lagre.
import { createEffect, createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import {
  ACTION_SHORTCUT, CHAT_PROJECT_ICONS, effortSteps, MAX_ACTION_COMMAND, MAX_ACTION_NAME, PROJECT_COLORS,
  type ProjectAction, type ReasoningEffort,
} from "../../../../shared/protocol";
import { lookupMessage, t } from "../../lib/i18n";
import { app, modelDisplayName, toast } from "../../state/app";
import { comboOf, displayKeys, keysFor, SHORTCUTS } from "../../state/shortcuts";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "../ContextMenu";
import { ChatProjectGlyph } from "../ChatProjectGlyph";
import { IconPicker } from "../EditProject";
import { IconChevronDown, IconClose, IconGauge, IconPencil, IconPlay, IconPlus, IconTrash, IconWorktree } from "../icons";
import { iconFor, ProjectGlyph } from "../ProjectGlyph";
import { modelProvider, ProviderGlyph } from "../ProviderGlyph";

// Effort labels, the same words as the composer's effort button.
export const effortLabel = (value: ReasoningEffort): string => ({
  none: t("Ingen"), low: t("Lav"), medium: t("Middels"), high: t("Høy"), xhigh: t("Ekstra høy"), max: t("Maks"),
})[value];

// The steps the model takes. Empty: the model has no effort setting, and the chip is left out.
function stepsFor(modelId: string | null | undefined): ReasoningEffort[] {
  const model = app.models.find((m) => m.id === (modelId ?? app.settings.defaultModelId));
  const provider = app.providers.find((p) => p.id === model?.providerId);
  return effortSteps(provider?.kind, model, provider?.baseUrl);
}

// A chip with a menu, like T3 Code's model and effort chips. label is the accessible name.
function Chip(props: { label: string; testid?: string; icon: JSX.Element; text: string; entries: () => MenuEntry[] }) {
  const [anchor, setAnchor] = createSignal<MenuAnchor | null>(null);
  return (
    <>
      <button
        type="button"
        class="btn btn-small select-button project-chip"
        data-testid={props.testid}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={!!anchor()}
        onClick={(e) => setAnchor(anchor() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}
      >
        <span class="project-chip-icon" aria-hidden="true">{props.icon}</span>
        <span class="select-value">{props.text}</span>
        <IconChevronDown size={13} />
      </button>
      <Show when={anchor()}>{(a) => <ContextMenu anchor={a()} label={props.label} class="select-menu" onClose={() => setAnchor(null)} entries={props.entries()} />}</Show>
    </>
  );
}

// Model and effort for new threads. inherit: the empty choice («Appens standard»); without it the
// model is always one of the models (the app's own default).
export function ModelEffortPicker(props: {
  model: string | null;
  effort: ReasoningEffort | null;
  inheritLabel?: string; // set: null is a choice, with this name
  onModel: (id: string | null) => void;
  onEffort: (effort: ReasoningEffort | null) => void;
}) {
  const shown = () => props.model ?? app.settings.defaultModelId;
  const steps = createMemo(() => stepsFor(props.model));
  const modelText = () => {
    const model = app.models.find((m) => m.id === props.model);
    if (model) return modelDisplayName(model);
    return props.inheritLabel ?? t("Ingen modell");
  };
  const glyph = (id: string | null | undefined, size = 15) => <ProviderGlyph family={modelProvider(id).family} size={size} />;
  const modelEntries = (): MenuEntry[] => [
    ...(props.inheritLabel ? [{ label: props.inheritLabel, icon: (p: { size?: number }) => glyph(app.settings.defaultModelId, p.size), chosen: props.model === null, run: () => props.model !== null && props.onModel(null) } as MenuEntry] : []),
    ...app.models.map((m): MenuEntry => ({ label: modelDisplayName(m), icon: (p) => glyph(m.id, p.size), chosen: props.model === m.id, run: () => props.model !== m.id && props.onModel(m.id) })),
  ];
  const effortEntries = (): MenuEntry[] => [
    { label: props.inheritLabel ?? t("Modellens standard"), chosen: props.effort === null, run: () => props.effort !== null && props.onEffort(null) },
    ...steps().map((step): MenuEntry => ({ label: effortLabel(step), chosen: props.effort === step, run: () => props.effort !== step && props.onEffort(step) })),
  ];
  return (
    <div class="project-chips">
      <Chip label={t("Standardmodell")} testid="project-model" icon={glyph(shown())} text={modelText()} entries={modelEntries} />
      <Show when={steps().length}>
        <Chip
          label={t("Tenkeinnsats")}
          testid="project-effort"
          icon={<IconGauge size={14} />}
          text={props.effort ? effortLabel(props.effort) : props.inheritLabel ?? t("Modellens standard")}
          entries={effortEntries}
        />
      </Show>
    </div>
  );
}

// A small dialog for choosing an icon. The choice is saved only with the dialog's save button.
function IconDialog(props: { title: string; intro: string; testid: string; preview: JSX.Element; onClose: () => void; onSave: () => void; saving?: boolean; children: JSX.Element }) {
  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());
  return (
    <dialog ref={dialog} class="dialog project-icon-dialog" aria-label={props.title} data-testid={props.testid} onCancel={(e) => { e.preventDefault(); props.onClose(); }}>
      <div class="project-icon-dialog-body">
        <div class="dialog-head">
          <h2><span class="project-icon-dialog-preview" aria-hidden="true">{props.preview}</span>{props.title}</h2>
          <button type="button" class="icon-button" aria-label={t("Lukk")} onClick={props.onClose}><IconClose size={15} /></button>
        </div>
        <p class="muted project-icon-dialog-intro">{props.intro}</p>
        {props.children}
      </div>
      <div class="dialog-actions project-icon-dialog-foot">
        <button type="button" class="btn" onClick={props.onClose}>{t("Avbryt")}</button>
        <button type="button" class="btn btn-primary" disabled={props.saving} onClick={props.onSave}>{t("Lagre ikon")}</button>
      </div>
    </dialog>
  );
}

// Kode: icons, emoji or a monogram, in one of the eighteen colours (EditProject's IconPicker).
export function ProjectIconDialog(props: { icon: string | null; color: string | null; name: string; onClose: () => void; onSave: (icon: string | null, color: string | null) => Promise<void> }) {
  const [icon, setIcon] = createSignal(props.icon);
  const [color, setColor] = createSignal(props.color);
  const [saving, setSaving] = createSignal(false);
  const save = async () => {
    setSaving(true);
    try { await props.onSave(icon(), color()); } finally { setSaving(false); }
  };
  return (
    <IconDialog title={t("Velg prosjektikon")} intro={t("Velg et ikon, en emoji eller et monogram.")} testid="project-icon-dialog" preview={<ProjectGlyph project={{ icon: icon(), color: color() }} size={20} />} onClose={props.onClose} onSave={() => void save()} saving={saving()}>
      <IconPicker icon={icon()} color={color()} name={props.name} onIcon={setIcon} onColor={setColor} />
    </IconDialog>
  );
}

const CHAT_ICON_LABELS = (): Record<string, string> => ({
  folder: t("Mappe"), book: t("Bok"), school: t("Utdanning"), pencil: t("Skriving"), brain: t("Tanker"), spark: t("Ideer"), globe: t("Verden"), plane: t("Reise"),
  chart: t("Diagram"), palette: t("Kunst"), music: t("Musikk"), health: t("Helse"), leaf: t("Natur"), flask: t("Forskning"), team: t("Samarbeid"),
});

// Chat: the fifteen Chat icons, in one of the colours.
export function ChatIconDialog(props: { icon: string | null; color: string | null; onClose: () => void; onSave: (icon: string, color: string | null) => Promise<void> }) {
  const [icon, setIcon] = createSignal(props.icon && CHAT_PROJECT_ICONS.includes(props.icon) ? props.icon : "folder");
  const [color, setColor] = createSignal(props.color);
  const [saving, setSaving] = createSignal(false);
  const labels = CHAT_ICON_LABELS();
  const save = async () => {
    setSaving(true);
    try { await props.onSave(icon(), color()); } finally { setSaving(false); }
  };
  return (
    <IconDialog title={t("Velg prosjektikon")} intro={t("Velg et av ikonene for Chat-prosjekter og en farge.")} testid="chat-icon-dialog" preview={<ChatProjectGlyph project={{ icon: icon(), color: color() }} size={20} />} onClose={props.onClose} onSave={() => void save()} saving={saving()}>
      <div class="icon-picker-colors" role="radiogroup" aria-label={t("Farge")}>
        <button type="button" role="radio" class="swatch swatch-none" aria-checked={!color()} aria-label={t("Automatisk farge")} title={t("Automatisk farge: valgt ut fra prosjektet")} onClick={() => setColor(null)} />
        <For each={PROJECT_COLORS}>
          {(c) => <button type="button" role="radio" class="swatch" aria-checked={color() === c.id} aria-label={lookupMessage(c.label)} title={lookupMessage(c.label)} style={`--swatch:${c.value}`} onClick={() => setColor(c.id)} />}
        </For>
      </div>
      <div class="icon-picker-grid" role="radiogroup" aria-label={t("Ikoner")}>
        <For each={CHAT_PROJECT_ICONS}>
          {(id) => {
            const Icon = iconFor(id);
            const tint = () => PROJECT_COLORS.find((c) => c.id === color())?.value;
            return <button type="button" role="radio" class="icon-picker-cell" aria-checked={icon() === id} aria-label={labels[id] ?? id} title={labels[id] ?? id} style={tint() ? `color:${tint()}` : undefined} onClick={() => setIcon(id)}>{Icon ? Icon({ size: 18 }) : null}</button>;
          }}
        </For>
      </div>
    </IconDialog>
  );
}

// The form for one action, in the Handlinger card.
function ActionForm(props: { action: ProjectAction | null; others: ProjectAction[]; worktrees: boolean; onCancel: () => void; onSave: (action: ProjectAction) => Promise<boolean> }) {
  const [name, setName] = createSignal(props.action?.name ?? "");
  const [command, setCommand] = createSignal(props.action?.command ?? "");
  const [shortcut, setShortcut] = createSignal(props.action?.shortcut ?? "");
  const [onWorktree, setOnWorktree] = createSignal(props.action?.runOnWorktreeCreate ?? false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let nameInput!: HTMLInputElement;
  onMount(() => nameInput.focus());
  // A shortcut is recorded from the keys pressed, with at least one modifier.
  const record = (event: KeyboardEvent) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey) return setShortcut("");
    const combo = comboOf(event);
    if (combo && ACTION_SHORTCUT.test(combo)) setShortcut(combo);
  };
  const check = (): string => {
    if (!name().trim()) return t("Gi handlingen et navn.");
    if (!command().trim()) return t("Skriv kommandoen som skal kjøres.");
    const keys = shortcut();
    if (keys) {
      const taken = SHORTCUTS.find((s) => keysFor(s.id) === keys);
      if (taken) return t("{keys} brukes allerede av appen: {name}.", { keys: displayKeys(keys), name: taken.label });
      const other = props.others.find((a) => a.shortcut === keys);
      if (other) return t("{keys} brukes allerede av «{name}».", { keys: displayKeys(keys), name: other.name });
    }
    return "";
  };
  const submit = async (event: Event) => {
    event.preventDefault();
    const problem = check();
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const ok = await props.onSave({
        id: props.action?.id ?? crypto.randomUUID(),
        name: name().trim(),
        command: command().trim(),
        ...(shortcut() ? { shortcut: shortcut() } : {}),
        ...(props.worktrees && onWorktree() ? { runOnWorktreeCreate: true } : {}),
      });
      if (!ok) setError(t("Kunne ikke lagre handlingen."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="action-form" data-testid="action-form" aria-label={props.action ? t("Rediger handling") : t("Ny handling")} onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); props.onCancel(); } }}>
      <div class="action-form-grid">
        <label class="field">
          <span>{t("Navn")}</span>
          <input ref={nameInput} class="input" aria-label={t("Navn på handlingen")} maxlength={MAX_ACTION_NAME} placeholder={t("For eksempel Test")} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>{t("Hurtigtast")}</span>
          <input
            class="input action-shortcut-input"
            aria-label={t("Hurtigtast for handlingen")}
            readonly
            placeholder={t("Trykk en tastekombinasjon")}
            value={shortcut() ? displayKeys(shortcut()) : ""}
            onKeyDown={record}
          />
        </label>
      </div>
      <label class="field">
        <span>{t("Kommando")}</span>
        <textarea class="input code-area action-command" aria-label={t("Kommando")} rows={3} spellcheck={false} maxlength={MAX_ACTION_COMMAND} placeholder="npm test" value={command()} onInput={(e) => setCommand(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(e); }} />
        <span class="muted small">{t("Kjøres i et skall i prosjektmappen, i en egen terminalfane. Modellen kjører aldri handlinger.")}</span>
      </label>
      <Show when={props.worktrees}>
        <label class="action-check">
          <input type="checkbox" checked={onWorktree()} onChange={(e) => setOnWorktree(e.currentTarget.checked)} />
          <span>{t("Kjør når et nytt arbeidstre opprettes fra prosjektet")}</span>
        </label>
      </Show>
      <Show when={error()}><p class="field-error" role="alert">{error()}</p></Show>
      <div class="action-form-buttons">
        <Show when={shortcut()}><button type="button" class="btn btn-small btn-quiet" onClick={() => setShortcut("")}>{t("Fjern hurtigtasten")}</button></Show>
        <span class="sidebar-spacer" />
        <button type="button" class="btn btn-small" onClick={props.onCancel}>{t("Avbryt")}</button>
        <button type="submit" class="btn btn-small btn-primary" disabled={busy()}>{t("Lagre handling")}</button>
      </div>
    </form>
  );
}

// The Handlinger card: the list, its empty state, and the form for a new or changed action.
export function ActionsCard(props: {
  actions: ProjectAction[];
  text: string;
  worktrees: boolean; // the project is a folder that can have worktrees
  openNew?: boolean; // open the form for a new action (Tråddetaljer → Legg til prosjektskript)
  onOpened?: () => void;
  onChange: (next: ProjectAction[]) => Promise<boolean>;
  onRun: (action: ProjectAction) => unknown;
}) {
  const [editing, setEditing] = createSignal<string | "new" | null>(null);
  const [runningId, setRunningId] = createSignal<string | null>(null);
  let card!: HTMLDivElement;
  // Asked for from Tråddetaljer: the form for a new action, in view.
  createEffect(() => {
    if (!props.openNew) return;
    setEditing("new");
    props.onOpened?.();
    requestAnimationFrame(() => card?.scrollIntoView({ block: "center" }));
  });
  const save = async (action: ProjectAction): Promise<boolean> => {
    const exists = props.actions.some((a) => a.id === action.id);
    const next = exists ? props.actions.map((a) => (a.id === action.id ? action : a)) : [...props.actions, action];
    const ok = await props.onChange(next);
    if (ok) setEditing(null);
    return ok;
  };
  const remove = async (action: ProjectAction) => {
    const previous = [...props.actions];
    const ok = await props.onChange(previous.filter((a) => a.id !== action.id));
    if (ok) toast(t("Slettet «{name}».", { name: action.name }), "info", { label: t("Angre"), run: () => void props.onChange(previous) });
  };
  const run = async (action: ProjectAction) => {
    if (runningId() === action.id) return;
    setRunningId(action.id);
    try {
      await props.onRun(action);
    } finally {
      if (runningId() === action.id) setRunningId(null);
    }
  };
  return (
    <div class="settings-card actions-card" ref={card} data-testid="actions-card">
      <div class="setting">
        <div class="setting-text">
          <strong>{t("Handlinger")}</strong>
          <span class="muted">{props.text}</span>
        </div>
        <div class="setting-control">
          <button type="button" class="btn btn-small" data-testid="add-action" disabled={editing() === "new"} onClick={() => setEditing("new")}><IconPlus size={13} />{t("Legg til handling")}</button>
        </div>
      </div>
      <Show when={editing() === "new"}>
        <div class="setting setting-block"><ActionForm action={null} others={props.actions} worktrees={props.worktrees} onCancel={() => setEditing(null)} onSave={save} /></div>
      </Show>
      <For each={props.actions} fallback={<Show when={editing() !== "new"}><p class="actions-empty muted" data-testid="actions-empty">{t("Ingen handlinger konfigurert ennå.")}</p></Show>}>
        {(action) => (
          <Show
            when={editing() !== action.id}
            fallback={<div class="setting setting-block"><ActionForm action={action} others={props.actions.filter((a) => a.id !== action.id)} worktrees={props.worktrees} onCancel={() => setEditing(null)} onSave={save} /></div>}
          >
            <div class="setting action-row" data-testid="action-row">
              <div class="setting-text">
                <strong>
                  {action.name}
                  <Show when={action.shortcut}><kbd class="action-kbd">{displayKeys(action.shortcut!)}</kbd></Show>
                  <Show when={action.runOnWorktreeCreate}><span class="action-badge" title={t("Kjøres når et nytt arbeidstre opprettes")}><IconWorktree size={12} />{t("Nytt arbeidstre")}</span></Show>
                </strong>
                <code class="action-command-text" dir="ltr">{action.command}</code>
              </div>
              <div class="setting-control action-buttons">
                <button type="button" class="btn btn-small" disabled={runningId() === action.id} title={t("Kjør i en ny terminalfane")} onClick={() => void run(action)}>
                  <Show when={runningId() === action.id} fallback={<><IconPlay size={12} />{t("Kjør")}</>}><span class="spinner" />{t("Kjører…")}</Show>
                </button>
                <button type="button" class="icon-button" aria-label={t("Rediger {name}", { name: action.name })} title={t("Rediger")} onClick={() => setEditing(action.id)}><IconPencil size={14} /></button>
                <button type="button" class="icon-button icon-button-danger" aria-label={t("Slett {name}", { name: action.name })} title={t("Slett")} onClick={() => void remove(action)}><IconTrash size={14} /></button>
              </div>
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}

// An instructions file with Lagre. text: what is saved now; null while it loads.
export function InstructionsEditor(props: { label: string; text: string; saved: string | null; placeholder: string; onSave: (text: string) => Promise<void>; testid?: string }) {
  const [draft, setDraft] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const value = () => draft() ?? props.saved ?? "";
  const changed = () => draft() !== null && draft() !== (props.saved ?? "");
  const save = async () => {
    if (!changed()) return;
    setBusy(true);
    try {
      await props.onSave(draft()!);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="setting setting-block" data-testid={props.testid}>
      <div class="setting-text">
        <strong>{props.label}</strong>
        <span class="muted">{props.text}</span>
      </div>
      <textarea class="input code-area projects-instructions" rows={9} spellcheck={false} aria-label={props.label} placeholder={props.placeholder} value={value()} disabled={props.saved === null} onInput={(e) => setDraft(e.currentTarget.value)} />
      <div class="projects-instructions-actions">
        <Show when={changed()}><button type="button" class="btn btn-small btn-quiet" onClick={() => setDraft(null)}>{t("Forkast")}</button></Show>
        <button type="button" class="btn btn-small" disabled={!changed() || busy()} onClick={() => void save()}>{t("Lagre instruksjoner")}</button>
      </div>
    </div>
  );
}
