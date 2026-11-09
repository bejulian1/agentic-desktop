// Round 12 (SPEC 26.2): Økt, a panel about the thread in focus. Four sections that fold: Miljø,
// Kontekst (how full the context window is, and what fills it), Tilkoblinger, and Oppgaver i
// bakgrunnen with Stopp and «Avsluttet: N». Everything comes from GET /api/threads/:id/session
// (server/src/session-info.ts); what is not there is not shown.
//
// It is the tool «Økt» in the side panel (ui/panel-tools.tsx), on the start page, in + and as
// Øktpanel among the separate panel buttons.
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import type { SessionInfo, SessionTask } from "../../../shared/protocol";
import { Dynamic } from "solid-js/web";
import { get, post } from "../lib/api";
import { formatTokens } from "../lib/format";
import { on as onMessage } from "../lib/socket";
import { report } from "../state/app";
import { shortPath } from "./Composer";
import { IconChevron, IconFolder, IconGlobe, IconLaptop, IconPlug, IconServer, IconSpark, IconTerminal, IconUsers } from "./icons";
import "../styles/session-panel.css";

type Section = "env" | "context" | "connections" | "tasks" | "finished";
const OPEN_KEY = "ad-okt-open";
const DEFAULT_OPEN: Record<Section, boolean> = { env: true, context: false, connections: false, tasks: true, finished: false };

function loadOpen(): Record<Section, boolean> {
  try {
    return { ...DEFAULT_OPEN, ...JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_OPEN };
  }
}

// «45s», «19m», «2t 5m», «3d»: short, like the reference.
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}t ${m % 60}m` : `${h}t`;
  return `${Math.floor(h / 24)}d`;
}

const percentText = (value: number) => `${value.toLocaleString("nb-NO")} %`;

export function SessionPanel(props: { threadId: string; onOpenFiles?: () => void; onOpenThread?: (threadId: string) => void }) {
  const [open, setOpen] = createSignal(loadOpen());
  const toggle = (section: Section) => {
    const next = { ...open(), [section]: !open()[section] };
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // A private window: it folds the same, it is only not remembered.
    }
  };

  const [info, { refetch, mutate }] = createResource(() => props.threadId, (id) => get<SessionInfo>(`/api/threads/${id}/session`));
  // The last good answer stays while a new one loads, so nothing blinks.
  const data = createMemo<SessionInfo | undefined>((last) => (info.state === "ready" ? info() : info.state === "refreshing" || info.state === "errored" ? last : undefined));

  // Fresh data when something it shows changes, and now and then for terminals and the clock.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refetch(), 150);
  };
  const offs = [
    onMessage("servers.changed", soon),
    onMessage("thread.changed", ({ thread }) => {
      if (thread.id === props.threadId || thread.parentThreadId === props.threadId) soon();
    }),
    onMessage("project.changed", ({ project }) => {
      if (project.id === data()?.environment.project?.id) soon();
    }),
  ];
  const [now, setNow] = createSignal(Date.now());
  const clock = setInterval(() => {
    setNow(Date.now());
    if (document.visibilityState === "visible") void refetch();
  }, 15_000);
  onCleanup(() => {
    offs.forEach((off) => off());
    clearInterval(clock);
    clearTimeout(timer);
  });
  createEffect(on(() => props.threadId, () => setNow(Date.now()), { defer: true }));

  const [stopping, setStopping] = createSignal<ReadonlySet<string>>(new Set());
  const stop = async (task: SessionTask) => {
    setStopping(new Set([...stopping(), task.id]));
    try {
      await post(`/api/threads/${props.threadId}/session/stop`, { taskId: task.id });
      const current = data();
      if (current) {
        // At once in the list; the next answer from the server confirms it.
        const ended = { ...task, running: false, finishedAt: Date.now() };
        mutate({ ...current, tasks: current.tasks.filter((t) => t.id !== task.id), finished: [ended, ...current.finished] });
      }
      soon();
    } catch (err) {
      report(err);
    } finally {
      const next = new Set(stopping());
      next.delete(task.id);
      setStopping(next);
    }
  };

  const connectedCount = () => data()?.connections.filter((c) => c.status === "ok").length ?? 0;

  return (
    <div class="okt" data-testid="session-panel" aria-busy={!data()}>
      <Show when={data()} fallback={<SessionSkeleton failed={info.state === "errored"} />}>
        {(d) => (
          <>
            <Fold id="env" title="Miljø" open={open().env} onToggle={toggle}>
              <div class="okt-row" data-testid="okt-local">
                <IconLaptop size={15} />
                <span class="okt-label">Denne datamaskinen</span>
                <span class="okt-meta" title="Tråden kjører lokalt">{d().environment.host}</span>
              </div>
              <Show when={d().environment.project}>
                {(p) => (
                  <Dynamic
                    component={props.onOpenFiles ? "button" : "div"}
                    type={props.onOpenFiles ? "button" : undefined}
                    class="okt-row"
                    classList={{ "okt-action": !!props.onOpenFiles, missing: p().folderMissing }}
                    title={p().folderMissing ? `Fant ikke ${p().path}` : props.onOpenFiles ? `Åpne Filer · ${p().path}` : p().path}
                    onClick={props.onOpenFiles}
                    data-testid="okt-project"
                  >
                    <IconFolder size={15} />
                    <span class="okt-label">{p().name}</span>
                    <span class="okt-meta okt-path">{p().folderMissing ? "Mappen mangler" : shortPath(p().path, 30)}</span>
                  </Dynamic>
                )}
              </Show>
            </Fold>

            <Fold
              id="context"
              title="Kontekst"
              open={open().context}
              onToggle={toggle}
              summary={
                <span class="okt-context-summary" data-testid="okt-context-percent">
                  {percentText(d().context.percent)}
                  <span class="okt-minibar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.02, d().context.percent / 100)})` }} /></span>
                </span>
              }
            >
              <ContextBreakdown context={d().context} />
            </Fold>

            <Show when={d().connections.length}>
              <Fold
                id="connections"
                title="Tilkoblinger"
                open={open().connections}
                onToggle={toggle}
                summary={<span class="okt-count" data-testid="okt-connected">{connectedCount()} tilkoblet</span>}
              >
                <For each={d().connections}>
                  {(c) => (
                    <div class="okt-row" data-testid={`okt-connection-${c.id}`}>
                      {c.kind === "model" ? <IconSpark size={15} /> : c.kind === "browser" ? <IconGlobe size={15} /> : <IconPlug size={15} />}
                      <span class="okt-label">{c.label}</span>
                      <span class="okt-meta">{c.detail}</span>
                      <span class={`okt-status ${c.status}`} role="img" aria-label={c.status === "ok" ? "Tilkoblet" : c.status === "warn" ? "Trenger oppsett" : "Ikke i bruk nå"} />
                    </div>
                  )}
                </For>
              </Fold>
            </Show>

            <Fold id="tasks" title="Oppgaver i bakgrunnen" open={open().tasks} onToggle={toggle} summary={<Show when={d().tasks.length}><span class="okt-count">{d().tasks.length}</span></Show>}>
              <Show when={d().tasks.length || d().finished.length} fallback={<p class="okt-empty">Ingenting kjører i bakgrunnen.</p>}>
                <ul class="okt-tasks" aria-label="Kjører nå">
                  <For each={d().tasks}>
                    {(task) => (
                      <li class="okt-row okt-task" data-testid="okt-task">
                        <TaskIcon task={task} />
                        <TaskTitle task={task} onOpenThread={props.onOpenThread} />
                        <span class="okt-meta okt-detail">{task.detail}</span>
                        <span class="okt-meta okt-time" title={`Startet ${new Date(task.startedAt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}`}>{elapsed(now() - task.startedAt)}</span>
                        <button type="button" class="okt-stop" title="Stopp" aria-label={`Stopp ${task.title}`} disabled={stopping().has(task.id)} onClick={() => void stop(task)}>
                          <span aria-hidden="true" />
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={d().finished.length}>
                  <button type="button" class="okt-row okt-action okt-finished-toggle" aria-expanded={open().finished} onClick={() => toggle("finished")} data-testid="okt-finished">
                    <IconChevron size={13} />
                    <span class="okt-label">Avsluttet: {d().finished.length}</span>
                  </button>
                  <Show when={open().finished}>
                    <ul class="okt-tasks okt-finished" aria-label="Avsluttet">
                      <For each={d().finished}>
                        {(task) => (
                          <li class="okt-row okt-task ended">
                            <TaskIcon task={task} />
                            <TaskTitle task={task} onOpenThread={props.onOpenThread} />
                            <span class="okt-meta okt-detail">{task.detail}</span>
                            <span class="okt-meta okt-time">{task.finishedAt ? elapsed(task.finishedAt - task.startedAt) : ""}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Show>
              </Show>
            </Fold>
          </>
        )}
      </Show>
    </div>
  );
}

// A section heading that folds. The chevron turns with transform only.
function Fold(props: { id: Section; title: string; open: boolean; onToggle: (id: Section) => void; summary?: JSX.Element; children: JSX.Element }) {
  const body = `okt-${props.id}-body`;
  return (
    <section class="okt-section" classList={{ open: props.open }} data-section={props.id}>
      <button type="button" class="okt-head" aria-expanded={props.open} aria-controls={body} onClick={() => props.onToggle(props.id)}>
        <span class="okt-title">{props.title}</span>
        <IconChevron size={12} />
        <span class="okt-head-end">{props.summary}</span>
      </button>
      <Show when={props.open}>
        <div class="okt-body" id={body}>{props.children}</div>
      </Show>
    </section>
  );
}

function ContextBreakdown(props: { context: SessionInfo["context"] }) {
  const total = () => props.context.contextWindow;
  return (
    <div class="okt-context" data-testid="okt-context">
      {/* What the used part is made of; the heading has how much of the window it is. */}
      <div class="okt-stack" role="img" aria-label={`Fordelingen av ${formatTokens(props.context.usedTokens)} tokens i bruk`}>
        <For each={props.context.parts}>
          {(part) => <span class={`okt-part-${part.id}`} style={{ "flex-grow": part.tokens }} title={`${part.label}: ${formatTokens(part.tokens)}`} />}
        </For>
      </div>
      <ul class="okt-parts">
        <For each={props.context.parts}>
          {(part) => (
            <li>
              <span class={`okt-swatch okt-part-${part.id}`} aria-hidden="true" />
              <span class="okt-label">{part.label}</span>
              <span class="okt-meta">{formatTokens(part.tokens)}</span>
            </li>
          )}
        </For>
      </ul>
      <p class="okt-note">
        {formatTokens(props.context.usedTokens)} av {formatTokens(total())} tokens.{" "}
        {props.context.measured ? "Totalen er målt av leverandøren; fordelingen er estimert." : "Estimert, omtrent fire tegn per token."}
      </p>
    </div>
  );
}

function TaskIcon(props: { task: SessionTask }) {
  return (
    <span class="okt-task-icon" classList={{ running: props.task.running }}>
      {props.task.kind === "agent" ? <IconUsers size={15} /> : props.task.kind === "terminal" ? <IconTerminal size={15} /> : <IconServer size={15} />}
    </span>
  );
}

function TaskTitle(props: { task: SessionTask; onOpenThread?: (id: string) => void }) {
  const label = () => `${props.task.title} · ${props.task.detail}`;
  return (
    <Show when={props.task.threadId && props.onOpenThread} fallback={<span class="okt-label" title={label()}>{props.task.title}</span>}>
      <button type="button" class="okt-label okt-link" title={`Åpne ${props.task.title}`} onClick={() => props.onOpenThread!(props.task.threadId!)}>{props.task.title}</button>
    </Show>
  );
}

// Rows of the same height as the real ones, so nothing jumps when the data comes.
function SessionSkeleton(props: { failed: boolean }) {
  return (
    <Show when={!props.failed} fallback={<p class="okt-empty">Kunne ikke hente økten.</p>}>
      <div class="okt-skeleton" role="status">
        <span class="sr-only">Henter økten…</span>
        <For each={[0, 1, 2, 3]}>{() => <span class="skeleton skeleton-line" aria-hidden="true" />}</For>
      </div>
    </Show>
  );
}
