import { createSignal } from "solid-js";
import { plural, t } from "../lib/i18n";
import type { PlaytestState, ProjectAction } from "../../../shared/protocol";
import { ApiError, post } from "../lib/api";
import { app, LOCAL_SCOPE, mode, report, scope, setApp, setSettingsOpen, settingsOpen, toast } from "./app";
import { showPanel } from "./panel";
import { comboOf } from "./shortcuts";
import { peekModel } from "./thread-model";
import { confirmDialog } from "../ui/dialogs";

export async function startPlaytest(projectId: string): Promise<void> {
  try {
    const state = await post<PlaytestState>(`/api/projects/${projectId}/playtest/start`);
    setApp("playtest", projectId, state);
    showPanel("browser");
  } catch (err) {
    report(err);
  }
}

export async function stopPlaytest(projectId: string): Promise<void> {
  try {
    setApp("playtest", projectId, await post<PlaytestState>(`/api/projects/${projectId}/playtest/stop`));
  } catch (err) {
    report(err);
  }
}

export async function openVscode(projectId: string): Promise<void> {
  try {
    await post(`/api/projects/${projectId}/open-vscode`);
    toast(t("Åpnet i VS Code."), "info");
  } catch (err) {
    report(err);
  }
}

export async function stopAll(projectId: string): Promise<void> {
  try {
    const { stopped } = await post<{ stopped: number }>(`/api/projects/${projectId}/stop-all`);
    toast(plural(stopped, "Stoppet {count} tråd.", "Stoppet {count} tråder."), "info");
  } catch (err) {
    report(err);
  }
}

export async function revertTurn(turnId: string): Promise<boolean> {
  try {
    await post(`/api/turns/${turnId}/revert`, {});
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const conflicts: string[] = err.body?.conflicts ?? [];
      if (!conflicts.length) { report(err); return false; }
      const overwrite = await confirmDialog({
        title: t("Angre kan overskrive annet arbeid"),
        text: t("{files} har endringer fra under eller etter denne turen. Vil du likevel overskrive dem?", { files: conflicts.join(", ") }),
        confirm: t("Overskriv"),
        danger: true,
      });
      if (!overwrite) return false;
      try {
        await post(`/api/turns/${turnId}/revert`, { force: true });
        return true;
      } catch (again) {
        report(again);
        return false;
      }
    }
    report(err);
    return false;
  }
}

export async function revertLastTurn(threadId: string | null): Promise<void> {
  const last = threadId ? peekModel(threadId)?.changes().filter((c) => !c.reverted).at(-1) : undefined;
  if (!last) return toast(t("Det er ingen tur å angre."), "info");
  await revertTurn(last.turnId);
}

export function runningInProject(projectId: string): number {
  return Object.values(app.threads).filter((t) => t.projectId === projectId && t.running).length;
}

// v1.3.0: project actions (T3 Code's project scripts). A scope is a project id, or LOCAL_SCOPE for
// Denne datamaskinen, whose actions are in the settings.
export function actionsFor(scopeId: string | null | undefined): ProjectAction[] {
  if (!scopeId) return [];
  return (scopeId === LOCAL_SCOPE ? app.settings.localActions : app.projects[scopeId]?.actions) ?? [];
}

// Runs a saved action in a new terminal tab; the server only runs what is stored.
export async function runProjectAction(scopeId: string, action: Pick<ProjectAction, "id" | "name">): Promise<boolean> {
  try {
    await post(`/api/projects/${encodeURIComponent(scopeId)}/actions/${encodeURIComponent(action.id)}/run`);
    if (mode() === "code" && scope() === scopeId && !settingsOpen()) showPanel("terminal");
    toast(t("Kjører «{name}» i terminalen.", { name: action.name }), "info");
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}

// A keyboard shortcut set on an action of the project on show in Kode. The app's own shortcuts
// come first (actions.ts); this is asked only when none of them matched. Non-Mod combos never fire
// inside editable fields or the terminal, so typing accented/AltGr characters is never hijacked.
export function runActionShortcut(event: KeyboardEvent): boolean {
  if (mode() !== "code" || settingsOpen()) return false;
  const combo = comboOf(event);
  if (!combo) return false;
  if (!combo.startsWith("Mod+")) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], .xterm")) return false;
  }
  const current = scope();
  const action = actionsFor(current).find((a) => a.shortcut === combo);
  if (!action) return false;
  void runProjectAction(current, action);
  return true;
}

// Tråddetaljer → «Legg til prosjektskript»: Innstillinger → Prosjekter for that scope, with the
// form for a new action open.
const [actionsEditorRequest, setActionsEditorRequest] = createSignal<string | null>(null);
export { actionsEditorRequest };
export function openActionsEditor(scopeId: string): void {
  setActionsEditorRequest(scopeId);
  setSettingsOpen("projects");
}
export function takeActionsEditorRequest(scopeId: string): boolean {
  if (actionsEditorRequest() !== scopeId) return false;
  setActionsEditorRequest(null);
  return true;
}
