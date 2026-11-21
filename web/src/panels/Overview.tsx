// Oversikt in the right panel: where the thread runs, how full its context window is and what fills
// it, and the files the thread has changed. The context split is fetched when the thread changes and
// when a new usage count arrives, never on a timer.
import { t } from "../lib/i18n";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { ChangedFile, ContextUsage, RunningServer, Thread } from "../../../shared/protocol";
import { copyServerUrl, openServer, servers, stopServer } from "../state/servers";
import { confirmDialog } from "../ui/dialogs";
import { get } from "../lib/api";
import { formatTokens } from "../lib/format";
import { openThread } from "../state/navigate";
import type { ToolRow } from "../state/thread-model";
import { app } from "../state/app";
import { gitInfo, loadGitInfo } from "../state/home";
import { requestFile } from "../state/nav";
import { showPanel } from "../state/panel";
import { peekModel } from "../state/thread-model";
import { IconBranch, IconCode, IconFile, IconFolder, IconLaptop, IconPlay, IconTerminal } from "../ui/icons";
import { IconImage } from "../ui/nav-icons";
import { FileChangeCounts } from "../ui/FileChangeCounts";

const PARTS: Array<{ id: keyof ContextUsage["parts"]; label: string; title: string }> = [
  { id: "messages", get label() { return t("Meldinger"); }, get title() { return t("Samtalen så langt, med verktøyresultater og vedlegg"); } },
  { id: "system", get label() { return t("Systemprompt"); }, get title() { return t("Instruksjonene modellen får: appens, AGENTS.md og listen over skills"); } },
  { id: "tools", get label() { return t("Verktøy"); }, get title() { return t("Beskrivelsene av verktøyene modellen kan bruke"); } },
  { id: "compactBuffer", get label() { return t("Buffer før komprimering"); }, get title() { return t("Når konteksten når 80 %, komprimeres den. Resten holdes av."); } },
  { id: "free", get label() { return t("Ledig"); }, get title() { return t("Plass som er igjen før komprimering"); } },
];

const percent = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const pct = (value: number) => `${value < 10 && value > 0 ? value.toFixed(1).replace(".", ",") : Math.round(value)} %`;

function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(path);
}

// Background work: agent threads in the project, commands in this thread and Playtest. Each gets
// its own colour from its id, so the same agent looks the same everywhere.
type TaskState = "running" | "done" | "error" | "stopped";
interface Task {
  key: string;
  kind: "agent" | "command" | "playtest";
  name: string;
  detail: string;
  state: TaskState;
  startedAt: number | null;
  ms: number | null; // how long it took, when it is over
  open: () => void;
}

const STATE_LABEL: Record<TaskState, string> = { get running() { return t("Kjører"); }, get done() { return t("Ferdig"); }, get error() { return t("Feilet"); }, get stopped() { return t("Stoppet"); } };

function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("{seconds} s", { seconds: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("{minutes} min {seconds} s", { minutes: m, seconds: s % 60 });
  return t("{hours} t {minutes} min", { hours: Math.floor(m / 60), minutes: m % 60 });
}

function threadState(t: Thread): TaskState {
  if (t.running) return "running";
  if (t.lastStatus === "error") return "error";
  if (t.lastStatus === "stopped" || t.lastStatus === "interrupted") return "stopped";
  return "done";
}

function BackgroundTasks(props: { projectId: string; threadId: string | null; tools: ToolRow[] }) {
  const tasks = createMemo<Task[]>(() => {
    const out: Task[] = [];
    const agents = Object.values(app.threads).filter((t): t is Thread => !!t && t.projectId === props.projectId && t.origin === "agent" && !t.archived);
    // The current thread's own helpers first, then the rest of the project's.
    agents.sort((a, b) => Number(b.parentThreadId === props.threadId) - Number(a.parentThreadId === props.threadId) || b.updatedAt - a.updatedAt);
    for (const agent of agents) {
      const state = threadState(agent);
      const parent = agent.parentThreadId ? app.threads[agent.parentThreadId] : undefined;
      out.push({
        key: `t:${agent.id}`,
        kind: "agent",
        name: agent.title,
        detail: parent ? t("fra {title}", { title: parent.title }) : t("agent"),
        state,
        startedAt: agent.createdAt,
        ms: state === "running" ? null : Math.max(0, agent.updatedAt - agent.createdAt),
        open: () => openThread(agent),
      });
    }
    for (const row of props.tools) {
      row.rev();
      const state: TaskState = row.status === "running" || row.status === "pending" || row.status === "awaiting-approval" ? "running" : row.status === "error" ? "error" : row.status === "done" ? "done" : "stopped";
      out.push({
        key: `c:${row.key}`,
        kind: "command",
        name: row.summary || t("Kommando"),
        detail: "kommando",
        state,
        startedAt: row.at,
        ms: row.durationMs ?? null,
        open: () => {
          const thread = props.threadId ? app.threads[props.threadId] : undefined;
          if (thread) void openThread(thread);
        },
      });
    }
    const playtest = app.playtest[props.projectId];
    if (playtest && playtest.status !== "stopped") {
      out.push({
        key: "playtest",
        kind: "playtest",
        name: t("Playtest"),
        detail: playtest.url ?? "starter",
        state: playtest.status === "error" ? "error" : "running",
        startedAt: null,
        ms: null,
        open: () => showPanel(playtest.terminalId ? "terminal" : "browser"),
      });
    }
    return out;
  });
  const active = () => tasks().filter((t) => t.state === "running");
  const over = () => tasks().filter((t) => t.state !== "running");

  // The running time ticks once a second, and only while something runs.
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!active().some((t) => t.startedAt)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  const Row = (p: { task: Task }) => (
    <button type="button" class="overview-row overview-link task-row" data-task={p.task.kind} data-state={p.task.state} title={`${p.task.name} · ${STATE_LABEL[p.task.state]}`} onClick={p.task.open}>
      <span class="task-mark" style={`--task-hue:${hue(p.task.key)}`}>
        {p.task.kind === "command" ? <IconTerminal size={11} /> : p.task.kind === "playtest" ? <IconPlay size={11} /> : p.task.name.trim().charAt(0).toUpperCase() || "A"}
      </span>
      <span class="overview-name">{p.task.name}</span>
      <span class="overview-muted">{p.task.detail}</span>
      <span class="task-state" data-state={p.task.state}>
        {STATE_LABEL[p.task.state]}
        <Show when={p.task.state === "running" && p.task.startedAt}>{" "}{elapsed(now() - p.task.startedAt!)}</Show>
        <Show when={p.task.state !== "running" && p.task.ms !== null}>{" · "}{elapsed(p.task.ms!)}</Show>
      </span>
    </button>
  );

  return (
    <section class="overview-section" aria-label={t("Bakgrunnsoppgaver")} data-testid="background-tasks">
      <h3 class="overview-title">{t("Bakgrunnsoppgaver")}</h3>
      <Show when={tasks().length} fallback={<p class="overview-empty">{t("Ingen agenter, kommandoer eller Playtest kjører i prosjektet.")}</p>}>
        <For each={active()}>{(task) => <Row task={task} />}</For>
        <Show when={over().length}>
          <div class="task-group">{t("Avsluttet")}</div>
          <For each={over().slice(0, 12)}>{(task) => <Row task={task} />}</For>
        </Show>
      </Show>
    </section>
  );
}

// Servers this project's commands, terminals and Playtest started. The current thread's first.
function Servers(props: { projectId: string; threadId: string | null }) {
  const list = createMemo(() =>
    servers()
      .filter((s) => s.projectId === props.projectId)
      .sort((a, b) => Number(b.threadId === props.threadId) - Number(a.threadId === props.threadId) || b.startedAt - a.startedAt),
  );
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!list().length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  const from = (s: RunningServer) => {
    if (s.source === "playtest") return t("Playtest");
    if (s.source === "terminal") return t("Terminal · {command}", { command: s.command });
    const thread = s.threadId ? app.threads[s.threadId] : undefined;
    return thread ? `${thread.title} · ${s.command}` : s.command;
  };
  const stop = async (s: RunningServer) => {
    const ok = await confirmDialog({
      title: t("Stoppe serveren på :{port}?", { port: s.port }),
      text: s.source === "playtest" ? t("Playtest stoppes.") : s.pid
        ? t("Prosessen som lytter (PID {pid}) får beskjed om å avslutte. Den ble startet av appen: {command}", { pid: s.pid, command: s.command })
        : t("Prosessen som lytter får beskjed om å avslutte. Den ble startet av appen: {command}", { command: s.command }),
      confirm: t("Stopp"),
      danger: true,
    });
    if (ok) await stopServer(s);
  };
  return (
    <section class="overview-section" aria-label={t("Servere")} data-testid="servers">
      <h3 class="overview-title">{t("Servere")}</h3>
      <For each={list()} fallback={<p class="overview-empty">{t("Ingen servere kjører. Starter en kommando eller Playtest en server, vises den her.")}</p>}>
        {(s) => (
          <div class="server-row" data-port={s.port}>
            <span class="server-dot" aria-hidden="true" />
            <div class="server-main">
              <div class="server-line">
                <button type="button" class="server-port" title={t("Åpne {url} i nettleserpanelet", { url: s.url })} onClick={() => openServer(s)}>:{s.port}</button>
                <span class="overview-muted" title={from(s)}>{from(s)}</span>
                <span class="task-state">{elapsed(now() - s.startedAt)}</span>
              </div>
              <div class="server-actions">
                <button type="button" class="btn btn-small" onClick={() => openServer(s)}>{t("Åpne i nettleserpanelet")}</button>
                <button type="button" class="btn btn-small" onClick={() => copyServerUrl(s)}>{t("Kopier adresse")}</button>
                <button type="button" class="btn btn-small btn-quiet-danger" aria-label={t("Stopp serveren på :{port}", { port: s.port })} title={t("Stopper prosessen appen startet, etter at du har bekreftet")} onClick={() => stop(s)}>{t("Stopp")}</button>
              </div>
            </div>
          </div>
        )}
      </For>
    </section>
  );
}

export default function OverviewPanel(props: { projectId: string; threadId: () => string | null }) {
  const project = () => app.projects[props.projectId];
  const [context, setContext] = createSignal<ContextUsage | null>(null);
  const [contextFailed, setContextFailed] = createSignal(false);
  const [contextReload, setContextReload] = createSignal(0);
  let contextThread: string | null = null;
  const model = createMemo(() => {
    const id = props.threadId();
    return id ? peekModel(id) : undefined;
  });

  createEffect(() => loadGitInfo(props.projectId));

  // Again when the thread changes, when it gets a new usage count, and when a run ends.
  let seq = 0;
  createEffect(
    on(
      () => [props.threadId(), model()?.usage(), props.threadId() ? app.threads[props.threadId()!]?.running : false, contextReload()] as const,
      ([id]) => {
        const mine = ++seq;
        if (contextThread !== id) setContext(null);
        contextThread = id;
        setContextFailed(false);
        if (!id) return setContext(null);
        get<ContextUsage>(`/api/threads/${id}/context`)
          .then((usage) => mine === seq && setContext(usage))
          .catch(() => {
            if (mine !== seq) return;
            setContext(null);
            setContextFailed(true);
          });
      },
    ),
  );
  onCleanup(() => { seq += 1; });

  // Every file the thread changed, the last change first. Reverted turns are left out.
  const outputs = createMemo(() => {
    const rows = model()?.changes() ?? [];
    const seen = new Map<string, ChangedFile>();
    for (let i = rows.length - 1; i >= 0; i--) {
      rows[i].rev();
      if (rows[i].reverted) continue;
      for (const file of rows[i].files) if (!seen.has(file.path)) seen.set(file.path, file);
    }
    return [...seen.values()];
  });

  // Commands in this thread: those that run, and the last few that ended.
  const commands = createMemo(() => {
    const found: ToolRow[] = [];
    for (const chunk of model()?.chunks() ?? []) {
      for (const row of chunk.rows()) {
        if (row.kind === "tool" && row.tool === "run_command") found.push(row);
        else if (row.kind === "steps") for (const item of row.items()) if (item.kind === "tool" && item.tool === "run_command") found.push(item);
      }
    }
    return found.slice(-6);
  });

  const open = (path: string) => {
    showPanel("files");
    requestFile(props.projectId, path);
  };

  return (
    <div class="overview-panel" data-testid="overview-panel">
      <section class="overview-section" aria-label={t("Miljø")}>
        <h3 class="overview-title">{t("Miljø")}</h3>
        <div class="overview-row" title={t("Agenten kjører på denne maskinen, med tilgang bare til prosjektmappen")}>
          <IconLaptop size={15} /><span class="overview-name">{t("Denne datamaskinen")}</span><span class="overview-tag">{t("Lokal")}</span>
        </div>
        <button type="button" class="overview-row overview-link" title={project()?.path} onClick={() => showPanel("files")}>
          <IconFolder size={15} /><span class="overview-name">{project()?.name}</span>
          <span class="overview-muted"><bdo dir="ltr">{project()?.path}</bdo></span>
        </button>
        <Show when={gitInfo(props.projectId)?.branch}>
          {(branch) => (
            <div class="overview-row" title={t("Lest fra .git/HEAD")}>
              <IconBranch size={15} /><span class="overview-name"><bdo dir="ltr">{branch()}</bdo></span>
              <span class="overview-muted">{gitInfo(props.projectId)?.detached ? t("frakoblet HEAD") : t("gren")}</span>
            </div>
          )}
        </Show>
      </section>

      <section class="overview-section" aria-label={t("Kontekst")}>
        <h3 class="overview-title">{t("Kontekst")}</h3>
        <Show when={props.threadId()} fallback={<p class="overview-empty">{t("Ingen tråd er valgt. Send en melding, så vises kontekstbruken her.")}</p>}>
          <Show when={context()} fallback={
            <Show when={contextFailed()} fallback={<p class="overview-empty" role="status">{t("Regner…")}</p>}>
              <p class="overview-empty" role="status">{t("Kunne ikke hente kontekstbruken.")}</p>
              <button type="button" class="btn btn-small" onClick={() => setContextReload((value) => value + 1)}>{t("Prøv igjen")}</button>
            </Show>
          }>
            {(c) => {
              const used = () => percent(c().usedTokens, c().contextWindow);
              return (
                <>
                  <div class="context-summary">
                    <strong data-testid="context-used">{t("{percent} brukt", { percent: pct(used()) })}</strong>
                    <span class="overview-muted">{formatTokens(c().usedTokens)} / {formatTokens(c().contextWindow)}</span>
                  </div>
                  <div class="context-bar" role="img" aria-label={t("{percent} av kontekstvinduet er brukt", { percent: pct(used()) })}>
                    <For each={PARTS}>
                      {(part) => <span class={`context-seg seg-${part.id}`} style={`width:${percent(c().parts[part.id], c().contextWindow)}%`} />}
                    </For>
                  </div>
                  <div class="context-legend">
                    <For each={PARTS}>
                      {(part) => (
                        <div class="context-legend-row" title={part.title} data-part={part.id}>
                          <span class={`context-swatch seg-${part.id}`} />
                          <span class="overview-name">{part.label}</span>
                          <span class="overview-muted">{formatTokens(c().parts[part.id])}</span>
                          <span class="context-pct">{pct(percent(c().parts[part.id], c().contextWindow))}</span>
                        </div>
                      )}
                    </For>
                  </div>
                  <p class="overview-note">
                    {c().measured
                      ? t("{tools} verktøy og {skills} skills sendes med. Totalen er leverandørens egen telling; delene er anslått.", { tools: c().tools, skills: c().skills })
                      : t("{tools} verktøy og {skills} skills sendes med. Anslått, omtrent fire tegn per token.", { tools: c().tools, skills: c().skills })}
                  </p>
                </>
              );
            }}
          </Show>
        </Show>
      </section>

      <Servers projectId={props.projectId} threadId={props.threadId()} />

      <BackgroundTasks projectId={props.projectId} threadId={props.threadId()} tools={commands()} />

      <section class="overview-section" aria-label={t("Utdata")}>
        <h3 class="overview-title">{t("Utdata")}</h3>
        <For each={outputs()} fallback={<p class="overview-empty">{t("Ingen filer er endret i denne tråden ennå.")}</p>}>
          {(file) => (
            <button type="button" class="overview-row overview-link" disabled={file.change === "deleted"} title={file.change === "deleted" ? t("{path} (slettet)", { path: file.path }) : t("Åpne {path}", { path: file.path })} onClick={() => open(file.path)}>
              {isImage(file.path) ? <IconImage size={15} /> : /\.(tsx?|jsx?|css|html?|json|rs|py|go|java|c|cpp|h|sh)$/i.test(file.path) ? <IconCode size={15} /> : <IconFile size={15} />}
              <span class="overview-name" classList={{ deleted: file.change === "deleted" }}>{file.path.split("/").pop()}</span>
              <span class="overview-muted"><bdo dir="ltr">{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}</bdo></span>
              <FileChangeCounts file={file} />
            </button>
          )}
        </For>
      </section>
    </div>
  );
}
