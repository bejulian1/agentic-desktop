// Agent Teams: the project's shared task list, live. A lead thread fills it with task_add and
// hands the tasks to the threads it makes; the user can add and tick off tasks here too.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { del, get, patch, post } from "../lib/api";
import { on } from "../lib/socket";
import type { TeamTask, TeamTaskStatus } from "../../../shared/protocol";
import { app, report } from "../state/app";
import { openThread } from "../state/navigate";
import { IconBranch, IconClose } from "../ui/icons";

const GROUPS: Array<{ status: TeamTaskStatus; label: string }> = [
  { status: "doing", label: "Pågår" },
  { status: "todo", label: "Å gjøre" },
  { status: "done", label: "Ferdig" },
];

export default function TeamPanel(props: { projectId: string }) {
  const [tasks, setTasks] = createSignal<TeamTask[]>([]);
  const [title, setTitle] = createSignal("");
  onMount(() => {
    get<TeamTask[]>(`/api/projects/${props.projectId}/tasks`).then(setTasks).catch(report);
    onCleanup(on("project.tasks", (message) => {
      if (message.projectId === props.projectId) setTasks(message.tasks);
    }));
  });
  const add = async (event: Event) => {
    event.preventDefault();
    if (!title().trim()) return;
    try {
      await post(`/api/projects/${props.projectId}/tasks`, { title: title().trim() });
      setTitle("");
    } catch (err) {
      report(err);
    }
  };
  const toggle = (task: TeamTask) => patch(`/api/tasks/${task.id}`, { status: task.status === "done" ? "todo" : "done" }).catch(report);
  return (
    <div class="team-panel" data-testid="team-panel">
      <div class="team-head">
        <strong>Agent Teams</strong>
        <p>En teamleder-tråd deler arbeidet i oppgaver og gir dem til tråder den lager. Skriv <code>team</code> til demo-modellen for å se flyten.</p>
      </div>
      <form class="team-add" onSubmit={add}>
        <input class="input" placeholder="Ny oppgave" aria-label="Ny oppgave" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
        <button type="submit" class="btn btn-small" disabled={!title().trim()}>Legg til</button>
      </form>
      <div class="team-list">
        <Show when={tasks().length} fallback={<div class="panel-empty">Ingen oppgaver ennå.</div>}>
          <For each={GROUPS}>
            {(group) => (
              <Show when={tasks().some((t) => t.status === group.status)}>
                <div class="team-group-label">{group.label}</div>
                <For each={tasks().filter((t) => t.status === group.status)}>
                  {(task) => (
                    <div class="team-task" classList={{ done: task.status === "done" }} data-task-status={task.status}>
                      <input type="checkbox" aria-label={`Ferdig: ${task.title}`} checked={task.status === "done"} onChange={() => toggle(task)} />
                      <span class="team-title">{task.title}</span>
                      <Show when={task.ownerThreadId && app.threads[task.ownerThreadId]}>
                        <button type="button" class="team-owner" title="Åpne tråden" onClick={() => void openThread(app.threads[task.ownerThreadId!])}>
                          <IconBranch size={11} /><span>{app.threads[task.ownerThreadId!].title}</span>
                        </button>
                      </Show>
                      <button type="button" class="icon-button" aria-label={`Slett oppgaven ${task.title}`} onClick={() => del(`/api/tasks/${task.id}`).catch(report)}><IconClose size={12} /></button>
                    </div>
                  )}
                </For>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
