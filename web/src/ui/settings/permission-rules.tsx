import { t, plural } from "../../lib/i18n";
// Innstillinger → Tillatelser: the projects that still use another mode than the default, with one
// button to give them all the default, and every saved "Tillat alltid" with a way to take it back.
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { reconcile } from "solid-js/store";
import type { AllowRule, PermissionMode, Project } from "../../../../shared/protocol";
import { get, post } from "../../lib/api";
import { app, report, setApp, sortedProjects, toast } from "../../state/app";
import { confirmDialog } from "../dialogs";
import { Group, Row } from "./parts";
import "../../styles/permissions.css";

const MODE_LABELS = (): Record<PermissionMode, string> => ({
  ask: t("Be om godkjenning"),
  "accept-edits": t("Godkjenn for meg"),
  full: t("Full tilgang"),
});

// Changing the default only affects new projects. This line says so when existing projects
// differ, and offers to bring them all to the default at once.
export function ApplyPermissionToProjects() {
  const [busy, setBusy] = createSignal(false);
  const target = () => app.settings.defaultPermissionMode;
  const differing = createMemo(() => sortedProjects().filter((project) => project.permissionMode !== target()));
  const apply = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const result = await post<{ changed: number; projects: Project[] }>("/api/projects/apply-permission-mode", { permissionMode: target() });
      for (const project of result.projects) if (app.projects[project.id]) setApp("projects", project.id, reconcile(project));
      toast(plural(result.changed, "{count} prosjekt bruker nå {mode}.", "{count} prosjekter bruker nå {mode}.", { mode: MODE_LABELS()[target()] }), "info");
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show when={differing().length}>
      <div class="setting permission-apply" data-testid="permission-apply-all">
        <div class="setting-text">
          <strong>{plural(differing().length, "{count} prosjekt bruker en annen modus", "{count} prosjekter bruker en annen modus")}</strong>
          <span class="muted">{t("Standarden gjelder nye prosjekter og Kode uten prosjekt. Eksisterende prosjekter beholder sin egen modus til du endrer den.")}</span>
        </div>
        <button type="button" class="btn btn-small" disabled={busy()} onClick={() => void apply()}>
          {busy() ? t("Lagrer…") : t("Bruk på alle prosjekter")}
        </button>
      </div>
    </Show>
  );
}

const ruleKindLabel = (rule: AllowRule) => rule.kind === "prefix" ? t("Kommandoer som starter med") : rule.kind === "command" ? t("Nøyaktig kommando") : rule.value === "browser_*" ? t("Alle handlinger i nettleseren") : t("Verktøy");
const ruleText = (rule: AllowRule) => rule.kind === "prefix" ? rule.value : rule.value === "browser_*" ? "browser_*" : rule.value;

// Every saved "Tillat alltid", by project, with Fjern for one and Fjern alle.
export function SavedAllowRules() {
  const [rules, { mutate, refetch }] = createResource(() => get<AllowRule[]>("/api/permissions/rules"));
  const [busy, setBusy] = createSignal(false);
  const placeName = (projectId: string) => projectId === "local" ? t("Denne datamaskinen") : app.projects[projectId]?.name ?? t("Ukjent prosjekt");
  const groups = createMemo(() => {
    const byProject = new Map<string, AllowRule[]>();
    for (const rule of rules() ?? []) byProject.set(rule.projectId, [...(byProject.get(rule.projectId) ?? []), rule]);
    return [...byProject.entries()].map(([projectId, items]) => ({ projectId, items }));
  });
  const run = async (action: () => Promise<AllowRule[]>) => {
    if (busy()) return;
    setBusy(true);
    try { mutate(await action()); }
    catch (err) { report(err); void refetch(); }
    finally { setBusy(false); }
  };
  const remove = (rule: AllowRule) => run(() => post<AllowRule[]>("/api/permissions/rules/remove", { projectId: rule.projectId, kind: rule.kind, value: rule.value }));
  const clearAll = async () => {
    const ok = await confirmDialog({ title: t("Fjerne alle lagrede godkjenninger?"), text: t("Handlingene spør igjen neste gang, etter tillatelsesmodusen til prosjektet."), confirm: t("Fjern alle"), danger: true });
    if (ok) await run(() => post<AllowRule[]>("/api/permissions/rules/clear", {}));
  };
  return (
    <Group
      title={t("Lagrede godkjenninger")}
      action={<Show when={(rules() ?? []).length}><button type="button" class="btn btn-small" disabled={busy()} onClick={() => void clearAll()}>{t("Fjern alle")}</button></Show>}
    >
      <Show when={!rules.loading} fallback={<p class="muted permission-rules-empty" role="status">{t("Henter lagrede godkjenninger…")}</p>}>
        <Show when={groups().length} fallback={<p class="muted permission-rules-empty">{t("Ingen lagrede godkjenninger. Når du velger Tillat alltid, vises regelen her.")}</p>}>
          <ul class="permission-rules" data-testid="permission-rules" aria-label={t("Lagrede godkjenninger")}>
            <For each={groups()}>{(group) => (
              <li class="permission-rules-group">
                <span class="permission-rules-project">{placeName(group.projectId)}</span>
                <ul>
                  <For each={group.items}>{(rule) => (
                    <li>
                      <Row label={<code class="permission-rule-value">{ruleText(rule)}</code>} text={ruleKindLabel(rule)}>
                        <button type="button" class="btn btn-small" disabled={busy()} aria-label={t("Fjern {rule}", { rule: rule.label })} onClick={() => void remove(rule)}>{t("Fjern")}</button>
                      </Row>
                    </li>
                  )}</For>
                </ul>
              </li>
            )}</For>
          </ul>
        </Show>
      </Show>
    </Group>
  );
}
