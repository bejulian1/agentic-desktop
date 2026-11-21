import { t } from "../lib/i18n";
import { createEffect, createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { reconcile } from "solid-js/store";
import type { PermissionMode, Project } from "../../../shared/protocol";
import { patch } from "../lib/api";
import { app, report, setApp } from "../state/app";
import { IconAlert, IconCheck, IconHand, IconShieldCheck } from "./icons";
import { permissionScope } from "./permission-copy";

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

// Without a project, choose the shared mode for local Code threads and the default for new projects.
export function PermissionPicker(props: { project?: Project; cap?: PermissionMode | null }) {
  const [open, setOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [error, setError] = createSignal("");
  const [position, setPosition] = createSignal({ left: "8px", bottom: "8px", "max-height": "calc(100dvh - 16px)" });
  const id = `permissions-${createUniqueId()}`;
  let trigger!: HTMLButtonElement;
  let popup: HTMLDivElement | undefined;
  let initialFocus: "selected" | "last" = "selected";
  const selected = () => props.project?.permissionMode ?? app.settings.defaultPermissionMode;
  const aboveCap = (value: PermissionMode) => !!props.cap && MODES.indexOf(value) > MODES.indexOf(props.cap);
  const effective = () => aboveCap(selected()) ? props.cap! : selected();
  const label = () => LABELS[effective()];
  const capDescription = () => props.cap ? t("Denne tråden er begrenset til {label}.", { label: LABELS[props.cap] }) : "";
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(416, innerWidth - 16);
    const top = Math.max(8, Math.min(rect.top - 6, innerHeight - 8));
    setPosition({
      left: `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`,
      bottom: `${innerHeight - top}px`,
      "max-height": `${Math.max(0, top - 8)}px`,
    });
  };
  const rows = () => Array.from(popup?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? []);
  const focusInitial = () => {
    const choices = rows();
    const checked = choices.find((row) => row.getAttribute("aria-checked") === "true");
    (initialFocus === "last" ? choices.at(-1) : checked ?? choices[0])?.focus({ preventScroll: true });
  };
  const show = (focus: "selected" | "last" = "selected") => {
    if (saving()) return;
    initialFocus = focus;
    setExpanded(false);
    setError("");
    place();
    setOpen(true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const choices = rows();
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % choices.length;
    else if (event.key === "ArrowUp") next = (index - 1 + choices.length) % choices.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = choices.length - 1;
    else return;
    event.preventDefault();
    choices[next]?.focus();
  };
  const choose = async (value: PermissionMode) => {
    const project = props.project;
    if (saving() || aboveCap(value)) return;
    if (value === selected()) return close(true);
    setSaving(true);
    setError("");
    try {
      if (!project) {
        await patch("/api/settings", { defaultPermissionMode: value });
        setApp("settings", "defaultPermissionMode", value);
        if (!props.project && open()) close(true);
        return;
      }
      const saved = await patch<Project>(`/api/projects/${project.id}`, { permissionMode: value });
      // The socket also delivers this update. Reconcile the response so the chip stays accurate
      // when the HTTP response arrives first or the connection is temporarily unavailable.
      if (saved?.id === project.id && app.projects[project.id]) setApp("projects", saved.id, reconcile(saved));
      if (props.project?.id === project.id && open()) close(true);
    } catch (err) {
      setError(t("Kunne ikke lagre tillatelsene. Prøv igjen."));
      report(err);
    } finally {
      setSaving(false);
      if (open()) queueMicrotask(focusInitial);
    }
  };
  createEffect(() => {
    // Moving to another project must close the old menu and clear its error.
    props.project?.id;
    close();
  });
  createEffect(() => {
    if (!open()) return;
    const pointer = (event: PointerEvent) => {
      if (!popup?.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };
    const focus = (event: FocusEvent) => {
      if (!popup?.contains(event.target as Node) && event.target !== trigger) close();
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const frame = requestAnimationFrame(focusInitial);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    });
  });
  return <div class="permission-anchor">
    <button
      ref={trigger}
      type="button"
      class="foot-chip permission-chip"
      data-testid="permission-button"
      data-mode={effective()}
      title={t("Tillatelser: {label}. {limit} {scope}", { label: label(), limit: capDescription(), scope: props.project ? t("Velg hvordan handlinger godkjennes i prosjektet.") : permissionScope() })}
      aria-label={props.cap ? t("Tillatelser: {label}. {limit}", { label: label(), limit: capDescription() }) : t("Tillatelser: {label}", { label: label() })}
      aria-haspopup="menu"
      aria-expanded={open()}
      aria-controls={open() ? id : undefined}
      aria-busy={saving()}
      onClick={() => open() ? close() : show()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          show(event.key === "ArrowUp" ? "last" : "selected");
        }
      }}
    >
      <Show when={effective() === "full"} fallback={<IconShieldCheck size={14} />}><IconAlert size={14} /></Show>
      <span>{label()}</span>
    </button>
    <Show when={open()}>
      <Portal>
        <div ref={popup} id={id} class="permission-popover permission-menu" role="menu" aria-label={t("Tillatelser")} aria-busy={saving()} style={position()} onKeyDown={onKeyDown}>
          <div class="permission-heading">
            <span>{t("Hvordan skal handlinger godkjennes?")}</span>
            <button type="button" class="permission-more" aria-expanded={expanded()} aria-controls={`${id}-more`} onClick={() => setExpanded(!expanded())}>{t("Les mer")}</button>
          </div>
          <Show when={!props.project}><p class="permission-cap">{permissionScope()}</p></Show>
          <Show when={expanded()}>
            <p class="permission-explanation" id={`${id}-more`}><Show when={props.project}>{t("Valget gjelder hele prosjektet.")}{" "}</Show>{t("Tråder med en egen grense får aldri høyere tilgang. Lesing er normalt tillatt. Lagrede godkjenninger kan også tillate handlinger. Beskyttede filer som .env, .git/hooks og filer i .ssh krever fortsatt godkjenning.")}</p>
          </Show>
          <Show when={props.cap}>
            <p class="permission-cap">{t("Denne tråden er begrenset til {label}. Du kan ikke velge høyere tilgang her.", { label: LABELS[props.cap!] })}<Show when={effective() !== selected()}> {props.project ? t("Prosjektets innstilling er {label}.", { label: LABELS[selected()] }) : t("Standarden er {label}.", { label: LABELS[selected()] })}</Show></p>
          </Show>
          <For each={MODES}>{(value) => {
            const Icon = ICONS[value];
            return <button
              type="button"
              role="menuitemradio"
              aria-checked={selected() === value}
              class="permission-choice"
              data-mode={value}
              disabled={saving() || aboveCap(value)}
              tabindex={effective() === value ? 0 : -1}
              title={aboveCap(value) ? t("Høyere enn denne trådens tillatelsesgrense") : undefined}
              onClick={() => void choose(value)}
            >
              <span class="permission-choice-icon"><Icon size={16} /></span>
              <span class="permission-choice-text"><span class="permission-choice-name menu-name">{LABELS[value]}</span><span class="permission-choice-description menu-desc">{(props.project ? DESCRIPTIONS : LOCAL_DESCRIPTIONS)[value]}</span></span>
              <span class="permission-choice-check"><Show when={selected() === value}><IconCheck size={15} /></Show></span>
            </button>;
          }}</For>
          <Show when={saving()}><p class="permission-status" role="status">{t("Lagrer tillatelser …")}</p></Show>
          <Show when={error()}><p class="permission-error" role="alert">{error()}</p></Show>
        </div>
      </Portal>
    </Show>
  </div>;
}
