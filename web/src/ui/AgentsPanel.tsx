import { createMemo, createResource, For, Index, Show } from "solid-js";
import type { Thread } from "../../../shared/protocol";
import { get } from "../lib/api";
import { relativeTime } from "../lib/format";
import { t } from "../lib/i18n";
import { app, modelName, untitled } from "../state/app";
import { openThread } from "../state/navigate";
import { STATE_LABEL, threadState } from "../state/thread-status";
import { IconUsers } from "./icons";
import "../styles/thread-panels.css";

export default function AgentsPanel(props: { projectId: string | null; threadId: () => string | null }) {
  const groups = createMemo(() => {
    const threadId = props.threadId();
    const projectId = props.projectId;
    const agents = Object.values(app.threads).filter((thread) => thread?.origin === "agent" && !thread.archived && !untitled(thread)
      && thread.id !== threadId && ((threadId && thread.parentThreadId === threadId) || (projectId && thread.projectId === projectId)));
    agents.sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt - a.updatedAt);
    const children = agents.filter((agent) => agent.parentThreadId === threadId);
    const others = agents.filter((agent) => agent.parentThreadId !== threadId);
    return [
      { title: t("Fra denne tråden"), agents: children.slice(0, 24) },
      { title: t("Andre agenter i prosjektet"), agents: others.slice(0, 24) },
    ];
  });
  const request = createMemo(() => groups().flatMap((group) => group.agents.map((agent) => `${agent.id}:${agent.updatedAt}:${agent.running}`)).join(","));
  const [previews] = createResource(
    () => request() || false,
    (key) => {
      const ids = key.split(",").map((entry) => entry.split(":")[0]).join(",");
      return get<Record<string, string>>(`/api/threads/agent-previews?ids=${encodeURIComponent(ids)}`).catch((): Record<string, string> => ({}));
    },
  );
  const state = (agent: Thread) => STATE_LABEL[threadState(agent)] || (agent.lastStatus === "done" ? t("Ferdig") : t("Venter"));

  return <div class="thread-panel" data-testid="agents-panel">
    <Show when={groups().some((group) => group.agents.length)} fallback={
      <div class="panel-empty">{t("Ingen agenter har jobbet i denne tråden eller prosjektet ennå.")}</div>
    }>
      <Index each={groups()}>{(group) => <Show when={group().agents.length}>
        <section class="thread-panel-section" aria-label={group().title}>
          <h3>{group().title}</h3>
          <ul class="thread-panel-list">
            <For each={group().agents}>{(agent) => (
              <li>
                <button type="button" class="thread-panel-card agent-panel-row" onClick={() => void openThread(agent)}>
                  <IconUsers size={16} />
                  <span class="thread-panel-content">
                    <span class="thread-panel-title">{agent.title}</span>
                    <span class="thread-panel-meta">{t("Team-agent · {name}", { name: modelName(agent.modelId) })} · {relativeTime(agent.updatedAt)}</span>
                    <Show when={previews.latest?.[agent.id]}>{(preview) => <span class="thread-panel-preview">{preview()}</span>}</Show>
                  </span>
                  <span class="thread-panel-status" data-state={threadState(agent)}>{state(agent)}</span>
                </button>
              </li>
            )}</For>
          </ul>
        </section>
      </Show>}</Index>
    </Show>
  </div>;
}
