// Agent Teams: the project's shared task list, live. A lead thread fills it with task_add and
// hands the tasks to the threads it makes; the user can add and tick off tasks here too.
import { t } from "../lib/i18n";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { del, get, patch, post } from "../lib/api";
import { on } from "../lib/socket";
import type { TeamTask, TeamTaskStatus } from "../../../shared/protocol";
import { app, report } from "../state/app";
import { openThread } from "../state/navigate";
import { IconBranch, IconClose } from "../ui/icons";

const GROUPS: Array<{ status: TeamTaskStatus; label: string }> = [
  { status: "doing", get label() { return t("Pågår"); } },
  { status: "todo", get label() { return t("Å gjøre"); } },
  { status: "done", get label() { return t("Ferdig"); } },
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
  const intro = () => t("En teamleder-tråd deler arbeidet i oppgaver og gir dem til tråder den lager. Skriv {command} til demo-modellen for å se flyten.");
  return (
    <div class="team-panel" data-testid="team-panel">
      <div class="team-head">
        <strong>{t("Agent Teams")}</strong>
        <p>{intro().split(/(\{command\})/).map(part => part === "{command}" ? <code>team</code> : part)}</p>
      </div>
      <form class="team-add" onSubmit={add}>
        <input class="input" placeholder={t("Ny oppgave")} aria-label={t("Ny oppgave")} value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
        <button type="submit" class="btn btn-small" disabled={!title().trim()}>{t("Legg til")}</button>
      </form>
      <div class="team-list">
        <Show when={tasks().length} fallback={<div class="panel-empty">{t("Ingen oppgaver ennå.")}</div>}>
          <For each={GROUPS}>
            {(group) => (
              <Show when={tasks().some((t) => t.status === group.status)}>
                <div class="team-group-label">{group.label}</div>
                <For each={tasks().filter((t) => t.status === group.status)}>
                  {(task) => (
                    <div class="team-task" classList={{ done: task.status === "done" }} data-task-status={task.status}>
                      <input type="checkbox" aria-label={t("Ferdig: {title}", { title: task.title })} checked={task.status === "done"} onChange={() => toggle(task)} />
                      <span class="team-title">{task.title}</span>
                      <Show when={task.ownerThreadId && app.threads[task.ownerThreadId]}>
                        <button type="button" class="team-owner" title={t("Åpne tråden")} onClick={() => void openThread(app.threads[task.ownerThreadId!])}>
                          <IconBranch size={11} /><span>{app.threads[task.ownerThreadId!].title}</span>
                        </button>
                      </Show>
                      <button type="button" class="icon-button" aria-label={t("Slett oppgaven {title}", { title: task.title })} onClick={() => del(`/api/tasks/${task.id}`).catch(report)}><IconClose size={12} /></button>
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
