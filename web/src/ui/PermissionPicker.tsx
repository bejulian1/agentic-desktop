import { t } from "../lib/i18n";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { reconcile } from "solid-js/store";
import type { PermissionMode, Project } from "../../../shared/protocol";
import { patch } from "../lib/api";
import { app, report, setApp } from "../state/app";
import { permissionScope } from "./permission-copy";
import { IconAlert, IconCheck, IconHand, IconList, IconShieldCheck } from "./icons";

const MODES: PermissionMode[] = ["ask", "accept-edits", "full"];
const LABELS: Record<PermissionMode, string> = {
  get ask() { return t("Be om godkjenning"); },
  get "accept-edits"() { return t("Godkjenn for meg"); },
  get full() { return t("Full tilgang"); },
};
const DESCRIPTIONS: Record<PermissionMode, string> = {
  get ask() { return t("Spør før filendringer, kommandoer og bruk av nettleseren. Lesing er tillatt."); },
  get "accept-edits"() { return t("Endrer prosjektfiler automatisk. Spør før kommandoer og bruk av nettleseren."); },
  get full() { return t("Godkjenner vanlige verktøyhandlinger i prosjektet automatisk. Beskyttede filer spør fortsatt."); },
};
const LOCAL_DESCRIPTIONS: Record<PermissionMode, string> = {
  get ask() { return t("Spør før filendringer og kommandoer i hjemmemappen. Lesing er normalt tillatt."); },
  get "accept-edits"() { return t("Endrer filer i hjemmemappen automatisk. Spør før kommandoer."); },
  get full() { return t("Lar agenten endre filer og kjøre kommandoer i hjemmemappen uten å spørre. Beskyttede filer krever fortsatt godkjenning."); },
};
const ICONS = { ask: IconHand, "accept-edits": IconShieldCheck, full: IconAlert };

// Save the permission mode for the project, or the default for local threads.
export function PermissionChoices(props: { project?: Project; cap?: PermissionMode | null; plan: boolean; planDisabled: boolean; onPlan: (value: boolean) => void }) {
  const id = createUniqueId();
  const [saving, setSaving] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [error, setError] = createSignal("");
  const selected = () => props.project?.permissionMode ?? app.settings.defaultPermissionMode;
  const aboveCap = (value: PermissionMode) => !!props.cap && MODES.indexOf(value) > MODES.indexOf(props.cap);
  const effective = () => aboveCap(selected()) ? props.cap! : selected();
  const choose = async (value: PermissionMode) => {
    const project = props.project;
    if (saving() || aboveCap(value)) return;
    if (value === selected()) return;
    setSaving(true);
    setError("");
    try {
      if (!project) {
        await patch("/api/settings", { defaultPermissionMode: value });
        setApp("settings", "defaultPermissionMode", value);
        return;
      }
      const saved = await patch<Project>(`/api/projects/${project.id}`, { permissionMode: value });
      // The socket also delivers this update. Reconcile the response so the chip stays accurate
      // when the HTTP response arrives first or the connection is temporarily unavailable.
      if (saved?.id === project.id && app.projects[project.id]) setApp("projects", saved.id, reconcile(saved));
    } catch (err) {
      setError(t("Kunne ikke lagre tillatelsene. Prøv igjen."));
      report(err);
    } finally {
      setSaving(false);
    }
  };
  const navigate = (event: KeyboardEvent) => {
    const rows = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % rows.length;
    else if (event.key === "ArrowUp") next = (index - 1 + rows.length) % rows.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else return;
    event.preventDefault();
    rows[next]?.focus();
  };

  return <div class="model-section permission-choices" data-testid="model-permissions">
    <div class="model-section-head" id={id}>{t("Tillatelser")}</div>
    <div class="permission-rows" role="radiogroup" aria-labelledby={id} aria-busy={saving()} onKeyDown={navigate}>
      <For each={MODES}>{(value) => {
        const Icon = ICONS[value];
        return <button
          type="button"
          role="radio"
          class="permission-row"
          data-mode={value}
          aria-checked={effective() === value}
          disabled={saving() || aboveCap(value)}
          aria-description={aboveCapText(aboveCap(value)) ?? (props.project ? DESCRIPTIONS : LOCAL_DESCRIPTIONS)[value]}
          title={aboveCapText(aboveCap(value)) ?? (props.project ? DESCRIPTIONS : LOCAL_DESCRIPTIONS)[value]}
          onClick={() => void choose(value)}
        >
          <Icon size={14} /><span class="permission-row-name">{LABELS[value]}</span>
          <span class="permission-row-check"><Show when={effective() === value}><IconCheck size={13} /></Show></span>
        </button>;
      }}</For>
    </div>
    <button type="button" class="permission-row model-plan" aria-pressed={props.plan} disabled={props.planDisabled} onClick={() => props.onPlan(!props.plan)}>
      <IconList size={14} /><span class="permission-row-name">{t("Planmodus")}</span>
      <span class="permission-row-check"><Show when={props.plan}><IconCheck size={13} /></Show></span>
    </button>
    <Show when={props.cap}>{(cap) => <p class="permission-note">{t("Denne tråden er begrenset til {label}.", { label: LABELS[cap()] })}</p>}</Show>
    <button type="button" class="permission-more" aria-expanded={expanded()} aria-controls={`${id}-help`} onClick={() => setExpanded(!expanded())}>{t("Les mer")}</button>
    <Show when={expanded()}>
      <p class="permission-note" id={`${id}-help`}>
        {props.project ? t("Valget gjelder hele prosjektet.") : permissionScope()}{" "}
        {t("Tråder med en egen grense får aldri høyere tilgang. Lesing er normalt tillatt. Lagrede godkjenninger kan også tillate handlinger. Beskyttede filer som .env, .git/hooks og filer i .ssh krever fortsatt godkjenning.")}
      </p>
    </Show>
    <Show when={error()}><p class="permission-error" role="alert">{error()}</p></Show>
  </div>;
}

const aboveCapText = (above: boolean) => above ? t("Høyere enn denne trådens tillatelsesgrense") : undefined;
