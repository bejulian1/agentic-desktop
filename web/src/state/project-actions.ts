import { plural, t } from "../lib/i18n";
import type { PlaytestState } from "../../../shared/protocol";
import { ApiError, post } from "../lib/api";
import { app, report, setApp, toast } from "./app";
import { showPanel } from "./panel";
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
