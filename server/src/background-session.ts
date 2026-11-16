// An explicit /background request makes its own persistent conversation; the source run is
// never steered, queued, stopped or given the background question/answer.
import type { ThreadEvent, ThreadEventEnvelope } from "../../shared/protocol.ts";
import type { Store } from "./db.ts";
import type { Runner } from "./agent/runner.ts";
import { historyFrom } from "./agent/fork.ts";
import { effectiveMode } from "./agent/permissions.ts";
import { HttpError } from "./errors.ts";

export function startBackgroundSession(store: Store, runner: Runner, threadId: string, input: any, changed: (id: string) => void) {
  if (typeof input?.text !== "string" || !input.text.trim()) throw new HttpError(400, "Skriv oppgaven etter /background");
  if (input.text.length > 200000) throw new HttpError(413, "Oppgaven er for lang");
  const source = store.thread(threadId);
  if (!source || source.archived) throw new HttpError(404, "Fant ikke en åpen samtale");
  if (store.threads().filter((thread) => thread.running && thread.forkedFrom?.background).length >= 4) throw new HttpError(429, "Fire bakgrunnsøkter jobber allerede. Vent på en av dem.");
  const project = source.projectId ? store.project(source.projectId) : undefined;
  if (project?.folderMissing) throw new HttpError(409, "Prosjektmappen mangler. Velg mappen på nytt.");
  const fallback = store.settings().defaultModelId;
  const model = (source.modelId ? store.model(source.modelId) : undefined) ?? (fallback ? store.model(fallback) : undefined);
  if (!model) throw new HttpError(400, "Ingen modell er valgt");
  const events = store.eventsTailJson(source.id, 20000).map((row) => JSON.parse(row) as ThreadEventEnvelope);
  let openRun: string | null = null;
  for (const { event } of events) {
    if (event.type === "run.started") openRun = event.runId;
    else if (event.type === "run.finished") openRun = null;
  }
  const close: ThreadEvent | null = openRun ? { type: "run.finished", runId: openRun, status: "done" } : null;
  const child = store.forkUpTo(source.id, `Bakgrunn: ${input.text.trim()}`.slice(0, 80), events.at(-1)?.seq ?? 0, historyFrom(events), close, {
    parentThreadId: source.id, origin: "user",
    permissionCap: project ? effectiveMode(project, source) : source.permissionCap ?? undefined,
  });
  try {
    store.setForkedFrom(child.id, { threadId: source.id, title: source.title, messageId: null, from: "whole", background: true });
    store.updateThread(child.id, { modelId: model.id, planMode: source.planMode });
    runner.send(child.id, { text: input.text.trim() });
    changed(child.id);
    return { thread: store.thread(child.id)! };
  } catch (err) {
    store.deleteThread(child.id);
    throw err;
  }
}
