// Agent Teams: one shared task list per project. A lead thread adds tasks and hands them to
// threads it makes with thread_create; the list is shown in the Team panel and the user can
// tick things off too. Tasks are app state only, so the tools need no approval.
import type { ServerMessage, TeamTask, TeamTaskStatus } from "../../../shared/protocol.ts";
import type { Store } from "../db.ts";
import { HttpError } from "../errors.ts";

export const TASK_STATUSES: TeamTaskStatus[] = ["todo", "doing", "done"];
const MAX_TASKS = 200;
const MAX_TITLE = 300;

export class TaskBoard {
  private store: Store;
  private publish: (message: ServerMessage) => void;

  constructor(store: Store, publish: (message: ServerMessage) => void) {
    this.store = store;
    this.publish = publish;
  }

  list(projectId: string): TeamTask[] {
    return this.store.tasks(projectId);
  }

  private changed(projectId: string): void {
    this.publish({ type: "project.tasks", projectId, tasks: this.list(projectId) });
  }

  add(projectId: string, title: string, createdBy: string | null, owner: string | null = null): TeamTask {
    const clean = String(title ?? "").trim().slice(0, MAX_TITLE);
    if (!clean) throw new HttpError(400, "Oppgaven trenger en tittel");
    if (this.list(projectId).length >= MAX_TASKS) throw new HttpError(409, `Listen har allerede ${MAX_TASKS} oppgaver`);
    if (owner) this.checkOwner(projectId, owner);
    const task = this.store.addTask(projectId, clean, createdBy, owner);
    this.changed(projectId);
    return task;
  }

  update(taskId: string, patch: { status?: unknown; title?: unknown; ownerThreadId?: unknown }, projectId?: string): TeamTask {
    const task = this.store.task(taskId);
    if (!task || (projectId && task.projectId !== projectId)) throw new HttpError(404, "Fant ikke oppgaven");
    if (patch.status !== undefined && !TASK_STATUSES.includes(patch.status as TeamTaskStatus)) throw new HttpError(400, "Status må være todo, doing eller done");
    if (patch.title !== undefined && (typeof patch.title !== "string" || !patch.title.trim())) throw new HttpError(400, "Tittelen er tom");
    if (patch.ownerThreadId) this.checkOwner(task.projectId, String(patch.ownerThreadId));
    this.store.updateTask(taskId, {
      status: patch.status as TeamTaskStatus | undefined,
      title: typeof patch.title === "string" ? patch.title.trim().slice(0, MAX_TITLE) : undefined,
      ownerThreadId: patch.ownerThreadId === undefined ? undefined : (patch.ownerThreadId as string | null) || null,
    });
    this.changed(task.projectId);
    return this.store.task(taskId)!;
  }

  remove(taskId: string): void {
    const task = this.store.task(taskId);
    if (!task) throw new HttpError(404, "Fant ikke oppgaven");
    this.store.deleteTask(taskId);
    this.changed(task.projectId);
  }

  private checkOwner(projectId: string, threadId: string): void {
    const thread = this.store.thread(threadId);
    if (!thread || thread.projectId !== projectId) throw new HttpError(400, "Eieren må være en tråd i prosjektet");
  }

  // What the task tools show the model.
  render(projectId: string): string {
    const tasks = this.list(projectId);
    if (!tasks.length) return "Oppgavelisten er tom.";
    const label: Record<TeamTaskStatus, string> = { todo: "å gjøre", doing: "pågår", done: "ferdig" };
    return tasks
      .map((t) => `- [${label[t.status]}] ${t.title} (oppgave-id: ${t.id}${t.ownerThreadId ? `, eier: ${this.store.thread(t.ownerThreadId)?.title ?? t.ownerThreadId}` : ""})`)
      .join("\n");
  }
}
