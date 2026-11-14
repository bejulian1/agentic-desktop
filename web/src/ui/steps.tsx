// Round 13 (SPEC 27.1): how a Kode turn reads. Each step is one line with an icon for its kind, a
// short verb, what it was about and the result in a word or two. Steps of the same kind in a row
// are one line («Leste 6 filer») that folds out. While the turn runs, one line at the bottom says
// what the agent does now, and that line is the only one that shimmers. When the turn is done, a
// short summary opens Endringer. The words are in step-words.ts and docs/research/kode-steg.md.
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch, type Accessor, type JSX } from "solid-js";
import { cancelFrameTask, onNextFrame } from "../lib/frame";
import { observeWhile } from "../lib/visible";
import { app } from "../state/app";
import { formatElapsed, useClock } from "../state/clock";
import { peekPanelActions, showPanel } from "../state/panel";
import type { Activity, ActivityTask, StepsRow, SummaryRow, ThinkingRow, ToolRow } from "../state/thread-model";
import type { WebSource } from "../../../shared/protocol";
import {
  IconAgent, IconBookmark, IconThought, IconCheck, IconChevron, IconEye, IconFilePlus, IconGlobe, IconHand, IconList, IconPencil, IconSearch, IconSpark,
  IconTerminal, IconTrash, IconWrench,
} from "./icons";
import { PathLink, toolPath, ToolOpenButton } from "./MiniEditorHooks";
import { showImage } from "./image-viewer";
import { describeStep, errorLine, isRunning, runLabel, runResult, stepKind, stepSentence, type StepFacts, type StepKind } from "./step-words";

type IconFn = (p: { size?: number }) => JSX.Element;
type Item = ToolRow | ThinkingRow;

export const KIND_ICON: Record<StepKind, IconFn> = {
  read: IconEye,
  search: IconSearch,
  web: IconGlobe,
  command: IconTerminal,
  create: IconFilePlus,
  edit: IconPencil,
  delete: IconTrash,
  team: IconAgent,
  memory: IconBookmark,
  plan: IconList,
  skill: IconSpark,
  other: IconWrench,
};

// A row that arrived a moment ago rises in quietly (styles/motion.css). History is just there.
const FRESH_MS = 1500;
export const enter = (at: number | undefined) => (at !== undefined && Date.now() - at < FRESH_MS ? "" : undefined);

// A duration worth showing: a second or more. Under that, the step was just quick. Written the way
// the turn's own time is («Jobbet i 1m 2s»), so «Tenkte i 4s» and a step's «2s» read the same (SPEC 28).
export function seconds(ms: number | null | undefined): string {
  return ms != null && ms >= 1000 ? formatElapsed(ms) : "";
}

const HH_MM = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const clockTime = (at: number) => HH_MM.format(new Date(at));

export const facts = (row: ToolRow): StepFacts => ({ tool: row.tool, summary: row.summary, input: row.input, status: row.status, result: row.result, sources: row.sources });

// The target of a step: a path that opens in the mini editor, a command or pattern in the code font,
// or a search and a name in «».
function StepTarget(props: { row: ToolRow; target: string; mono: boolean; quoted: boolean }) {
  const path = () => (props.mono ? toolPath(props.row) : null);
  return (
    <Show when={path()} fallback={<span class="step-target" classList={{ mono: props.mono }}>{props.quoted ? `«${props.target}»` : props.target}</span>}>
      <PathLink path={path()!} />
    </Show>
  );
}

// A small letter in a square, for a source without an icon.
function Monogram(props: { url: string }) {
  const letter = () => {
    try {
      return new URL(props.url).hostname.replace(/^www\./, "").charAt(0).toUpperCase() || "?";
    } catch {
      return "?";
    }
  };
  return <span class="source-mono" aria-hidden="true">{letter()}</span>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The sources a web search found, as small cards with the site's icon and the page's title. Demo
// sources say so, and are not links: they point nowhere.
export function SourceCards(props: { sources: WebSource[] }) {
  return (
    <div class="sources" role="list" aria-label="Kilder" data-testid="sources">
      <For each={props.sources}>
        {(source) => {
          const inner = (
            <>
              <Show when={source.favicon} fallback={<Monogram url={source.url} />}>
                <img class="source-icon" src={source.favicon} alt="" width="16" height="16" />
              </Show>
              <span class="source-text">
                <span class="source-title">{source.title}</span>
                <span class="source-host">{hostOf(source.url)}</span>
              </span>
              <Show when={source.demo}><span class="source-demo" title="Laget av demo-modellen. Ikke en ekte nettside.">Demo</span></Show>
            </>
          );
          return (
            <Show when={!source.demo} fallback={<div class="source-card demo" role="listitem" title={`${source.title}\n${source.snippet ?? ""}`.trim()}>{inner}</div>}>
              <a class="source-card" role="listitem" href={source.url} target="_blank" rel="noopener noreferrer" title={`${source.title}\n${source.url}`}>{inner}</a>
            </Show>
          );
        }}
      </For>
    </div>
  );
}

const TAG_WAITING = "Venter på deg";

// One step: the icon of its kind, the verb and what it was about, and the short result. The arrow
// folds out the details: output, the result as the model got it, or the input.
export function ToolView(props: { row: ToolRow; last?: boolean; chat?: boolean }) {
  const { row } = props;
  const [open, setOpen] = createSignal((!props.chat && app.settings.codeTranscriptView === "detailed") || (row.tool === "run_command" && app.settings.expandShell === true));
  const [lastLine, setLastLine] = createSignal("");
  const [hasOutput, setHasOutput] = createSignal(!!row.output);
  const [outputCut, setOutputCut] = createSignal(row.outputCut);
  const status = createMemo(() => (row.rev(), row.status));
  const info = createMemo(() => (row.rev(), facts(row)));
  const words = createMemo(() => describeStep(info()));
  const kind = createMemo(() => stepKind(info()));
  const error = createMemo(() => errorLine(info()));
  const shot = createMemo(() => (row.rev(), row.screenshotId));
  const sources = createMemo(() => (row.rev(), row.sources?.length ? row.sources : undefined));
  const outputText = document.createTextNode(row.output);
  const waiting = () => status() === "awaiting-approval";
  const busy = () => status() === "running" || status() === "pending";
  const icon = () => (waiting() ? IconHand : KIND_ICON[kind()]);

  const flush = () => {
    if (row.pendingOutput) {
      outputText.data = row.output; // Keep the rendered node within the model's output cap too.
      setHasOutput(true);
      setOutputCut(row.outputCut);
      const lines = row.pendingOutput.trimEnd().split("\n");
      setLastLine(lines.at(-1) ?? "");
      row.pendingOutput = "";
    }
  };
  row.onOutput = () => onNextFrame(flush);
  onCleanup(() => {
    row.onOutput = undefined;
    row.pendingOutput = "";
    cancelFrameTask(flush);
  });

  return (
    <div class="row row-tool step" data-row="tool" data-tool={row.tool} data-kind={kind()} data-status={status()} data-enter={enter(row.at)}>
      <button type="button" class="fold tool-head step-head" aria-expanded={open()} title={stepSentence(info())} onClick={() => setOpen(!open())}>
        <span class="step-icon" data-kind={kind()}>{icon()({ size: 14 })}</span>
        {/* Chat has no now-line, so a step that runs there shimmers itself (SPEC 23.10, 27.2). */}
        <span class="step-text" classList={{ "status-text": !!props.chat, shimmer: !!props.chat && busy() }} ref={observeWhile(() => !!props.chat && busy())}>
          <span class="step-verb">{words().verb}</span>
          <Show when={words().target}>{" "}<StepTarget row={row} target={words().target} mono={words().mono} quoted={words().quoted} /></Show>
          <Show when={props.chat && busy()}>…</Show>
        </span>
        <Show when={busy() && lastLine()}><span class="tool-tail">{lastLine()}</span></Show>
        <span class="tool-status" data-status={status()}>
          <Switch>
            <Match when={waiting()}><span class="step-tag step-waiting">{TAG_WAITING}</span></Match>
            <Match when={busy()}><span class="spinner" aria-label="Kjører" /></Match>
            <Match when={status() === "denied"}><span class="step-tag">Avslått</span></Match>
            <Match when={status() === "cancelled"}><span class="step-tag">Avbrutt</span></Match>
            <Match when={status() === "error"}>
              <Show when={words().result}><span class="step-result">{words().result}</span></Show>
              <span class="step-tag step-failed">Feilet</span>
            </Match>
            <Match when={true}>
              <Show when={words().result}><span class="step-result">{words().result}</span></Show>
              <Show when={seconds(row.durationMs)}><span class="step-duration">{seconds(row.durationMs)}</span></Show>
            </Match>
          </Switch>
        </span>
        <Show when={props.last}><span class="step-time">{clockTime(row.at)}</span></Show>
        <span class="step-chevron" classList={{ open: open() }}><IconChevron size={12} /></span>
      </button>
      <Show when={error() && !open()}><div class="step-note">{error()}</div></Show>
      <Show when={(props.chat || open()) && sources()}>{(list) => <SourceCards sources={list()} />}</Show>
      <Show when={open()}>
        <div class="tool-body">
          <ToolOpenButton row={row} />
          <Show when={hasOutput()}>
            <pre class="tool-output">{outputCut() ? "… (eldre utdata er kuttet)\n" : ""}{outputText}</pre>
          </Show>
          <Show when={(row.rev(), row.result) && !hasOutput()}>
            <pre class="tool-output">{row.result}</pre>
          </Show>
          <Show when={!hasOutput() && (row.rev(), !row.result)}>
            <pre class="tool-output muted">{JSON.stringify(row.input, null, 2)}</pre>
          </Show>
        </div>
      </Show>
      <Show when={shot()}>
        <button type="button" class="step-thumb" title="Vis skjermbildet i full størrelse" aria-label="Vis skjermbildet" onClick={() => showImage(`/api/screenshots/${shot()}`, "Skjermbilde fra nettleseren")}>
          <img class="tool-shot" loading="lazy" decoding="async" alt="Skjermbilde fra nettleseren" src={`/api/screenshots/${shot()}`} />
        </button>
      </Show>
    </div>
  );
}

// Thinking as a step: its first line, folded out to the whole summary. It does not shimmer: the
// now-line under the turn says «Tenker…».
export function ThinkingStep(props: { row: ThinkingRow; last?: boolean }) {
  const { row } = props;
  const [open, setOpen] = createSignal(app.settings.codeTranscriptView === "thinking" || app.settings.codeTranscriptView === "detailed");
  const summary = () => app.settings.thinkingSummary !== false;
  const label = createMemo(() => {
    row.rev();
    const text = row.text.trimStart();
    const cut = text.indexOf("\n");
    const first = (cut === -1 ? text : text.slice(0, cut)).trim();
    if (summary() && first) return first;
    if (row.durationMs === null) return "Tenker…";
    return seconds(row.durationMs) ? `Tenkte i ${seconds(row.durationMs)}` : "Tenkte et øyeblikk";
  });
  const meta = createMemo(() => {
    row.rev();
    return row.durationMs === null ? "" : seconds(row.durationMs);
  });
  return (
    <div class="row row-thinking step" data-row="thinking" data-enter={enter(row.at)}>
      <button type="button" class="fold step-head" aria-expanded={open()} disabled={!summary()} onClick={() => setOpen(!open())}>
        <span class="step-icon" data-kind="think"><IconThought size={14} /></span>
        <span class="step-text">{label()}</span>
        <span class="tool-status"><Show when={meta()}><span class="step-duration">{meta()}</span></Show></span>
        <Show when={props.last}><span class="step-time">{clockTime(row.at)}</span></Show>
        <Show when={summary()}><span class="step-chevron" classList={{ open: open() }}><IconChevron size={12} /></span></Show>
      </button>
      <Show when={open() && summary()}>
        <div class="thinking-text">{(row.rev(), row.text)}</div>
      </Show>
    </div>
  );
}

// Steps in a row of the same kind. Thinking between them does not break the run; it folds into it.
interface Run {
  key: string;
  kind: StepKind | "think";
  items: Accessor<Item[]>;
  setItems: (items: Item[]) => void;
  tools: Accessor<number>; // the steps that are not thinking: two or more make a run line
}

export function groupRuns(items: Item[], kindOf: (row: ToolRow) => StepKind): Array<{ kind: StepKind | "think"; items: Item[] }> {
  const runs: Array<{ kind: StepKind | "think"; items: Item[] }> = [];
  let current: { kind: StepKind | "think"; items: Item[] } | null = null;
  let thinking: ThinkingRow[] = [];
  for (const item of items) {
    if (item.kind === "thinking") {
      thinking.push(item);
      continue;
    }
    const kind = kindOf(item);
    if (current && current.kind === kind) current.items.push(...thinking, item);
    else {
      for (const t of thinking) runs.push({ kind: "think", items: [t] });
      current = { kind, items: [item] };
      runs.push(current);
    }
    thinking = [];
  }
  for (const t of thinking) runs.push({ kind: "think", items: [t] });
  return runs;
}

function RunView(props: { run: Run; last: boolean }) {
  const { run } = props;
  const [open, setOpen] = createSignal(app.settings.codeTranscriptView === "detailed");
  const tools = createMemo(() => run.items().filter((i): i is ToolRow => i.kind === "tool").map((t) => (t.rev(), facts(t))));
  const running = createMemo(() => tools().some((t) => isRunning(t.status)));
  const waiting = createMemo(() => tools().some((t) => t.status === "awaiting-approval"));
  const label = () => runLabel(run.kind as StepKind, tools(), running());
  const result = () => (running() ? "" : runResult(run.kind as StepKind, tools()));
  const duration = createMemo(() => {
    let ms = 0;
    for (const item of run.items()) if (item.kind === "tool") ms += (item.rev(), item.durationMs ?? 0);
    return seconds(ms);
  });
  const failed = () => tools().some((t) => t.status === "error");
  const Icon = KIND_ICON[run.kind as StepKind];
  return (
    <div class="row row-run step" data-row="run" data-kind={run.kind} data-status={waiting() ? "awaiting-approval" : running() ? "running" : failed() ? "error" : "done"}>
      <button type="button" class="fold step-head run-head" aria-expanded={open() || waiting()} disabled={waiting()} onClick={() => setOpen(!open())}>
        <span class="step-icon" data-kind={run.kind}>{waiting() ? <IconHand size={14} /> : <Icon size={14} />}</span>
        <span class="step-text steps-summary">{label()}</span>
        <span class="tool-status">
          <Switch>
            <Match when={waiting()}><span class="step-tag step-waiting">{TAG_WAITING}</span></Match>
            <Match when={running()}><span class="spinner" aria-label="Kjører" /></Match>
            <Match when={true}>
              <Show when={result()}><span class="step-result" classList={{ "step-failed-text": failed() }}>{result()}</span></Show>
              <Show when={duration()}><span class="step-duration">{duration()}</span></Show>
            </Match>
          </Switch>
        </span>
        <span class="step-chevron" classList={{ open: open() || waiting() }}><IconChevron size={12} /></span>
      </button>
      <Show when={open() || waiting()}>
        <div class="steps-list run-list">
          <For each={run.items()}>
            {(item, index) => {
              const last = () => props.last && index() === run.items().length - 1;
              return item.kind === "tool" ? <ToolView row={item} last={last()} /> : <ThinkingStep row={item} last={last()} />;
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

// A group of steps between two texts. Runs keep their identity while the group grows, so a run
// that is open stays open when a step joins it.
export function StepsView(props: { row: StepsRow }) {
  const { row } = props;
  const cache = new Map<string, Run>();
  const runs = createMemo(() => {
    row.rev();
    const grouped = groupRuns(row.items(), (tool) => (tool.rev(), stepKind(facts(tool))));
    const next = new Map<string, Run>();
    const out = grouped.map((g) => {
      const key = `${g.kind}:${g.items.find((i) => i.kind === "tool")?.key ?? g.items[0].key}`;
      let run = cache.get(key);
      if (!run) {
        const [items, setItems] = createSignal<Item[]>(g.items);
        run = { key, kind: g.kind, items, setItems, tools: () => items().filter((i) => i.kind === "tool").length };
      } else if (run.items().length !== g.items.length || run.items().some((item, i) => item !== g.items[i])) run.setItems(g.items);
      next.set(key, run);
      return run;
    });
    cache.clear();
    for (const [k, v] of next) cache.set(k, v);
    return out;
  });
  const lastKey = () => row.items().at(-1)?.key;
  return (
    <div class="row row-steps" data-row="steps" data-enter={enter(row.items()[0]?.at)}>
      <div class="steps-list">
        <For each={runs()}>
          {(run, index) => {
            const isLast = () => index() === runs().length - 1;
            return (
              <Show when={run.tools() >= 2} fallback={
                <For each={run.items()}>
                  {(item) => (item.kind === "tool" ? <ToolView row={item} last={item.key === lastKey()} /> : <ThinkingStep row={item} last={item.key === lastKey()} />)}
                </For>
              }>
                <RunView run={run} last={isLast()} />
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function LiveElapsed(props: { since: number }) {
  const now = useClock();
  return <>{formatElapsed(now() - props.since)}</>;
}

const BUSY = new Set(["running", "pending"]);

function agentRunning(task: ActivityTask): boolean {
  return app.threads[task.threadId!]?.running ?? task.status === "running";
}

// What the agent does now, in one sentence: the step that runs, several steps at once, the
// subagents, or what the model does between steps.
export function nowText(activity: Activity): { text: string; waiting: string | null } {
  const tasks = activity.tasks;
  const asking = tasks.find((t) => t.status === "awaiting-approval");
  if (asking) return { text: "Venter på deg", waiting: stepSentence({ tool: asking.tool!, summary: asking.summary, status: "running" }) };
  const tools = tasks.filter((t) => t.kind === "tool" && BUSY.has(t.status));
  if (tools.length === 1) return { text: `${stepSentence({ tool: tools[0].tool!, summary: tools[0].summary, status: "running" })}…`, waiting: null };
  if (tools.length > 1) {
    const list: StepFacts[] = tools.map((t) => ({ tool: t.tool!, summary: t.summary, status: "running" }));
    const kinds = new Set(list.map(stepKind));
    return { text: kinds.size === 1 ? `${runLabel([...kinds][0], list, true)}…` : `Gjør ${tools.length} ting samtidig…`, waiting: null };
  }
  const agents = tasks.filter((t) => t.kind === "agent" && agentRunning(t)).length;
  if (agents) return { text: agents === 1 ? "1 underagent jobber…" : `${agents} underagenter jobber…`, waiting: null };
  if (activity.phase === "thinking") return { text: "Tenker…", waiting: null };
  if (activity.phase === "writing") return { text: "Skriver…", waiting: null };
  return { text: "Jobber…", waiting: null };
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Venter",
  "awaiting-approval": TAG_WAITING,
  running: "Kjører",
  done: "Ferdig",
  error: "Feilet",
  denied: "Avslått",
  cancelled: "Avbrutt",
};

function agentStatus(status: string | null): string {
  if (status === "done") return "Ferdig";
  if (status === "error") return "Feilet";
  if (status === "stopped") return "Stoppet";
  if (status === "interrupted") return "Avbrutt";
  return "Venter";
}

// Kode: one line under the turn while it runs. It says what the agent does now and how long the
// turn has gone, and it is the one text that shimmers. Waiting for you, it stands still in the
// accent colour. The arrow lists what the turn has going, with the subagents to open.
export function NowLine(props: { activity: Activity; onThread: (id: string) => void }) {
  const [open, setOpen] = createSignal(app.settings.codeTranscriptView === "detailed");
  const now = createMemo(() => nowText(props.activity));
  const waiting = () => now().waiting !== null;
  const tasks = () => props.activity.tasks;
  const statusText = (task: ActivityTask) => {
    if (task.kind === "agent") return agentRunning(task) ? "Jobber" : agentStatus(app.threads[task.threadId!]?.lastStatus ?? "done");
    return STATUS_LABELS[task.status] ?? task.status;
  };
  return (
    <div class="now-line" data-testid="now-line" data-state={waiting() ? "waiting" : "working"}>
      <button type="button" class="now-head" aria-expanded={open()} disabled={!tasks().length} title={tasks().length ? "Vis hva turen har gjort og gjør" : undefined} onClick={() => setOpen(!open())}>
        <span class="now-icon" aria-hidden="true">
          <Show when={waiting()} fallback={<span class="now-dot" />}><IconHand size={14} /></Show>
        </span>
        <span class="now-text" role="status">
          <span class="now-label work-label status-text" classList={{ shimmer: !waiting() }} ref={observeWhile(() => !waiting())}>{now().text}</span>
          <Show when={now().waiting}><span class="now-detail">{now().waiting}</span></Show>
        </span>
        <span class="now-time"><LiveElapsed since={props.activity.startedAt} /></span>
        <Show when={tasks().length}><span class="step-chevron" classList={{ open: open() }}><IconChevron size={12} /></span></Show>
      </button>
      <Show when={open()}>
        <ul class="bg-list" data-testid="now-list">
          <For each={tasks()}>
            {(task) => (
              <li class="bg-task" data-status={task.kind === "agent" ? (agentRunning(task) ? "running" : "done") : task.status}>
                <Show
                  when={task.kind === "agent"}
                  fallback={<><span class="step-icon">{KIND_ICON[stepKind({ tool: task.tool!, summary: task.summary })]({ size: 13 })}</span><span class="bg-label">{stepSentence({ tool: task.tool!, summary: task.summary, status: task.status })}</span></>}
                >
                  <button type="button" class="bg-agent" title="Åpne tråden" onClick={() => props.onThread(task.threadId!)}>
                    <IconAgent size={13} /><span class="bg-label">{app.threads[task.threadId!]?.title ?? task.summary}</span>
                  </button>
                </Show>
                <span class="bg-status">{statusText(task)}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// After a turn that did something: «Ferdig på 1m 2s · 3 filer endret · 2 kommandoer». A click
// opens Endringer, on this turn's changes when it made any.
export function SummaryView(props: { row: SummaryRow }) {
  const { row } = props;
  const time = row.durationMs < 1000 ? "under ett sekund" : formatElapsed(row.durationMs);
  const parts = [
    row.status === "stopped" ? `Stoppet etter ${time}` : `Ferdig på ${time}`,
    row.files ? `${plural(row.files, "fil", "filer")} endret` : "",
    row.commands ? `${plural(row.commands, "kommando", "kommandoer")} kjørt` : "",
  ].filter(Boolean);
  const open = () => {
    if (row.turnId) peekPanelActions()?.showTurn(row.turnId);
    else showPanel("changes");
  };
  return (
    <div class="row row-summary" data-row="summary" data-testid="turn-summary" data-enter={enter(row.at)}>
      <button type="button" class="summary-line" data-status={row.status} title="Åpne Endringer" onClick={open}>
        <span class="summary-icon"><IconCheck size={13} /></span>
        <span class="summary-text">{parts.join(" · ")}</span>
        <Show when={row.additions || row.deletions}>
          <span class="summary-diff">
            <Show when={row.additions}><span class="diff-add">+{row.additions}</span></Show>
            <Show when={row.additions && row.deletions}>{" "}</Show>
            <Show when={row.deletions}><span class="diff-del">−{row.deletions}</span></Show>
          </span>
        </Show>
        <span class="summary-open"><span class="summary-open-text">Endringer</span><IconChevron size={12} /></span>
      </button>
    </div>
  );
}
