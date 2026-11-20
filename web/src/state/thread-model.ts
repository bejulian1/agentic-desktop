// A thread in memory: its event log folded into rows. Rows are grouped in chunks, which is the
// unit the conversation view renders. A delta touches its own row and nothing else, so streaming
// costs the same at message 5 and at message 5 000.
import { batch, createSignal, type Accessor, type Setter } from "solid-js";
import type {
  ApprovalDecision,
  AnswerModel,
  Attachment,
  ChangedFile,
  ChatFile,
  QueueSnapshot,
  RunStatus,
  ThreadEvent,
  ThreadEventEnvelope,
  ThreadRef,
  ToolStatus,
  Usage,
  WebSource,
} from "../../../shared/protocol";
import type { HookEvent, HookOutcome } from "../../../shared/hooks";
import { ApiError, getWithHeaders } from "../lib/api";
import { on, onOpen, send } from "../lib/socket";
import { app } from "./app";

const CHUNK_ROWS = 12;
const TAIL_EVENTS = 500;
const PAGE_EVENTS = 1500;
const CACHED_MODELS = 12;
const MAX_TOOL_OUTPUT = 64 * 1024;

function historyRevisionOf(headers: Headers): number {
  const revision = Number(headers.get("x-thread-history-revision"));
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

interface RowBase {
  key: string;
  rev: Accessor<number>; // Bumped when the row itself changes.
  touch: () => void;
  work?: WorkRow; // Kode: the run this row belongs to, whose header can fold it away.
}

export interface UserRow extends RowBase {
  kind: "user";
  receipt?: "pending" | "received" | "blocked" | "unsent";
  receivedAt?: number;
  at: number; // when it was sent
  text: string;
  from?: ThreadRef;
  attachments?: Attachment[];
}

export interface TextRow extends RowBase {
  kind: "text";
  at: number; // when the first part arrived
  text: string; // Grows, and only flattened when a view mounts.
  pending: string; // Text the mounted view has not seen.
  done: boolean;
  model?: AnswerModel; // Snapshot of the run that wrote this text, never the current selector.
  onDelta?: () => void; // Set by the mounted view.
}

export interface ModelChangeRow extends RowBase {
  kind: "model-change";
  from: AnswerModel;
  to: AnswerModel;
}

export interface ThinkingRow extends RowBase {
  kind: "thinking";
  text: string;
  durationMs: number | null;
  at: number;
  model?: AnswerModel;
}

// Kode: the header over a run, "Jobber…" while it runs and "Jobbet i 14m 34s" after. Folding it
// hides the steps and the texts in between, and leaves the last answer.
export interface WorkRow extends RowBase {
  kind: "work";
  startedAt: number;
  endedAt: number | null;
  steps: Accessor<number>; // Shown only when the run did something.
  setSteps: Setter<number>;
  collapsed: Accessor<boolean>;
  setCollapsed: Setter<boolean>;
  lastText: Accessor<TextRow | null>;
  setLastText: Setter<TextRow | null>;
}

// Kode: tools and thinking in a row, as one line like "Kjørte 3 kommandoer og leste 2 filer".
export interface StepsRow extends RowBase {
  kind: "steps";
  items: Accessor<Array<ToolRow | ThinkingRow>>;
  setItems: Setter<Array<ToolRow | ThinkingRow>>;
  open: Accessor<boolean>;
  setOpen: Setter<boolean>;
}

// The threads one run made, as one card.
export interface AgentsRow extends RowBase {
  kind: "agents";
  items: Accessor<SpawnedRow[]>;
  setItems: Setter<SpawnedRow[]>;
}

export interface ToolRow extends RowBase {
  kind: "tool";
  at: number;
  tool: string;
  summary: string;
  input: unknown;
  status: ToolStatus;
  output: string;
  outputCut: boolean;
  pendingOutput: string;
  result?: string;
  durationMs?: number;
  screenshotId?: string;
  files?: ChatFile[];
  sources?: WebSource[]; // round 13: what a web search found, or the page that was read
  onOutput?: () => void;
}

export interface ApprovalRow extends RowBase {
  kind: "approval";
  approvalId: string;
  title: string;
  detail: string;
  canAllowAlways: boolean;
  callId: string;
  tool?: string; // the tool that asks, and what it was given, for a card in plain words
  input?: unknown;
  decision: ApprovalDecision | null;
  closed: boolean; // The run ended without an answer.
}

export interface ChangesRow extends RowBase {
  kind: "changes";
  turnId: string;
  files: ChangedFile[];
  reverted: boolean;
}

export interface CompactedRow extends RowBase {
  kind: "compacted";
  beforeTokens: number;
  afterTokens: number;
}

// A hook from Innstillinger → Hooks that stopped something, added feedback or context, or failed.
export interface HookRow extends RowBase {
  kind: "hook";
  name: string;
  event: HookEvent;
  effect: "blocked" | "feedback" | "context" | "error";
  outcome: HookOutcome;
  exitCode: number | null;
  message?: string;
}

// A message that waited for UserPromptSubmit hooks and never reached the model (user.unsent).
export interface UnsentRow extends RowBase {
  kind: "unsent";
  reason: "interrupted" | "restart";
}

export interface SpawnedRow extends RowBase {
  kind: "spawned";
  childThreadId: string;
  model?: AnswerModel;
  title: string;
}

export interface NoticeRow extends RowBase {
  kind: "notice";
  status: RunStatus;
  error?: string;
}

// Round 13 (SPEC 27.1): the short line after a Kode turn that did something: how long it took,
// the files it changed and the commands it ran. A click opens Endringer.
export interface SummaryRow extends RowBase {
  kind: "summary";
  at: number; // when the turn ended
  status: RunStatus;
  durationMs: number;
  steps: number;
  files: number;
  additions: number;
  deletions: number;
  commands: number;
  turnId: string | null; // the turn with file changes, for Endringer
}

export interface QuestionRow extends RowBase {
  kind: "question";
  requestId: string;
  threadId: string;
  runId: string;
  callId: string;
  questions: import("../../../shared/user-input").UserQuestion[];
  result: import("../../../shared/user-input").UserInputResult | null;
  closed: boolean;
}

export type Row = QuestionRow | UserRow | TextRow | ThinkingRow | ToolRow | ApprovalRow | ChangesRow | CompactedRow | SpawnedRow | NoticeRow | WorkRow | StepsRow | AgentsRow | SummaryRow | ModelChangeRow | HookRow | UnsentRow;

// Kode: what the current run has going, for the small box under the conversation. Changed only
// by events that start or end something, never by tokens.
export interface ActivityTask {
  id: string;
  kind: "tool" | "agent";
  tool?: string;
  summary: string;
  status: ToolStatus;
  threadId?: string;
  path?: string; // Only an explicit file tool's input, never inferred from its prose or a command.
}

export interface Activity {
  startedAt: number;
  running: boolean;
  tasks: ActivityTask[];
  // Round 13: what the model does between tools, for the now-line. Changes at most once per block.
  phase: "starting" | "thinking" | "writing" | "tools";
}

export function currentFileActivity(activity: Activity | null): ActivityTask | undefined {
  if (!activity) return;
  const files = activity.tasks.filter((task) => task.kind === "tool" && task.path);
  return files.findLast((task) => activity.running && (task.status === "running" || task.status === "pending" || task.status === "awaiting-approval")) ?? files.at(-1);
}

function inputFilePath(tool: string, input: unknown): string | undefined {
  if (!["read_file", "write_file", "edit_file", "delete_file"].includes(tool) || !input || typeof input !== "object") return;
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" && path.trim() && !/[\r\n\0]/.test(path) ? path : undefined;
}

// The provider asked the run to wait (429, 5xx). Shown as a calm line that counts down, and gone as
// soon as anything else happens in the run.
export interface RetryState {
  attempt: number;
  maxAttempts: number;
  until: number; // when the next try starts, by the client's clock
  reason: string;
}

export interface Chunk {
  id: number;
  rows: Accessor<Row[]>;
  setRows: Setter<Row[]>;
  near: Accessor<boolean>;
  setNear: Setter<boolean>;
  height: number; // Last measured, or estimated from the text.
}

export interface QueuedMessage {
  messageId: string;
  text: string;
  from?: ThreadRef;
  attachments?: Attachment[];
  editable?: boolean;
  steerable?: boolean;
  steer?: boolean; // goes into the running turn at its next step, not after it
}

let chunkIds = 1;

function newChunk(rows: Row[]): Chunk {
  const [getRows, setRows] = createSignal(rows);
  const [near, setNear] = createSignal(false);
  return { id: chunkIds++, rows: getRows, setRows, near, setNear, height: estimateHeight(rows) };
}

function rowHeight(row: Row): number {
  switch (row.kind) {
    case "user":
      return 64 + Math.floor(row.text.length / 70) * 22;
    case "text": {
      const breaks = row.text.length > 4000 ? row.text.length / 40 : row.text.split("\n").length;
      return 40 + breaks * 23 + (row.text.length / 90) * 8;
    }
    case "approval":
      return 130;
    case "changes":
      return 76 + Math.min(row.files.length, 3) * 30;
    case "summary":
      return 34;
    case "work":
      return 32;
    case "steps":
      return 30 + (row.open() ? row.items().length * 30 : 0);
    case "agents":
      return 64 + row.items().length * 48;
    default:
      return 36;
  }
}

function estimateHeight(rows: Row[]): number {
  let total = 0;
  for (const row of rows) total += rowHeight(row);
  return Math.ceil(total);
}

function base(key: string): RowBase {
  const [rev, setRev] = createSignal(0);
  return { key, rev, touch: () => setRev((n) => n + 1) };
}

class Folder {
  rows: Row[] = [];
  queued: QueuedMessage[] = [];
  usage: Usage | null = null;
  private users = new Map<string, UserRow>();
  private texts = new Map<string, TextRow>();
  private thinking = new Map<string, ThinkingRow>();
  private tools = new Map<string, ToolRow>();
  private approvals = new Map<string, ApprovalRow>();
  questions = new Map<string, QuestionRow>();
  private changes = new Map<string, ChangesRow>();
  private work: WorkRow | null = null; // Kode: the run being folded
  private activeModel: { runId: string; model: AnswerModel } | null = null;
  private selectedModel: AnswerModel | null = null;
  private pendingModelChange: ModelChangeRow | null = null;
  private modelChanges = 0;
  private hookRows = 0;
  private steps: StepsRow | null = null; // the open group of steps
  private agents: AgentsRow | null = null; // threads made in this run
  private runStats = { commands: 0, files: 0, additions: 0, deletions: 0, turnId: null as string | null };
  live = true; // false while a page of history is folded: what is old starts folded
  activity: Activity | null = null;
  retry: RetryState | null = null;
  onRow: (row: Row) => void = () => {};

  private task(id: string, change: Partial<ActivityTask>): void {
    const task = this.activity?.tasks.find((t) => t.id === id);
    if (task) Object.assign(task, change);
  }

  constructor(private code: boolean) {}

  private add(row: Row): void {
    this.finishText(); // Whatever comes next, earlier text in this run is complete.
    this.steps = null;
    this.rows.push(row);
    this.onRow(row);
  }

  // A tool or thinking block in Kode joins the open group, or starts one.
  private step(row: ToolRow | ThinkingRow): void {
    this.finishText();
    if (this.work) this.work.setSteps((n) => n + 1);
    if (this.steps) {
      this.steps.setItems([...this.steps.items(), row]);
      this.steps.touch();
      return;
    }
    const [items, setItems] = createSignal<Array<ToolRow | ThinkingRow>>([row]);
    const [open, setOpen] = createSignal(this.live);
    const group: StepsRow = { ...base(`steps-${row.key}`), kind: "steps", items, setItems, open, setOpen, work: this.work ?? undefined };
    this.add(group);
    this.steps = group;
  }

  apply(event: ThreadEvent, at = Date.now()): void {
    if (this.retry && event.type !== "usage" && event.type !== "user.queued") this.retry = null;
    switch (event.type) {
      case "model.changed": {
        const row: ModelChangeRow = { ...base(`model-change-${++this.modelChanges}-${at}`), kind: "model-change", from: event.from, to: event.to };
        if (this.activity?.running) {
          // A selector change affects the next run. Keep the current answer uninterrupted and
          // place the change below it when it finishes, including while replaying old events.
          if (this.pendingModelChange) row.from = this.pendingModelChange.from;
          this.pendingModelChange = row.from.modelId === row.to.modelId ? null : row;
        } else this.add(row);
        this.selectedModel = event.to;
        return;
      }
      case "run.retrying":
        this.retry = { attempt: event.attempt, maxAttempts: event.maxAttempts, until: at + event.waitMs, reason: event.reason };
        return;
      case "user.message": {
        this.queued = this.queued.filter((q) => q.messageId !== event.messageId);
        const row: UserRow = { ...base(event.messageId), kind: "user", at, text: event.text, from: event.from, attachments: event.attachments, ...(event.receiptTracked ? { receipt: "pending" as const } : {}) };
        this.users.set(event.messageId, row);
        this.add(row);
        return;
      }
      case "user.received": {
        const row = this.users.get(event.messageId);
        if (row) { row.receipt = "received"; row.receivedAt = at; row.touch(); }
        return;
      }
      case "user.queue-removed":
        this.queued = this.queued.filter((q) => q.messageId !== event.messageId);
        return;
      case "user.queued": {
        // The same messageId again: the message switched between the queue and going in at once.
        const item: QueuedMessage = { messageId: event.messageId, text: event.text, from: event.from, attachments: event.attachments, editable: event.editable, steerable: event.steerable, steer: event.steer === true };
        const at = this.queued.findIndex((q) => q.messageId === event.messageId);
        this.queued = at === -1 ? [...this.queued, item] : this.queued.map((q, i) => (i === at ? item : q));
        return;
      }
      case "text.delta": {
        if (this.activity) this.activity.phase = "writing";
        let row = this.texts.get(event.messageId);
        if (!row) {
          row = { ...base(event.messageId), kind: "text", at, text: "", pending: "", done: false, work: this.work ?? undefined, model: this.activeModel?.runId === event.runId ? this.activeModel.model : undefined };
          this.add(row);
          this.texts.set(event.messageId, row);
          this.work?.setLastText(row);
        }
        row.text += event.text;
        if (row.onDelta) {
          row.pending += event.text;
          row.onDelta();
        }
        return;
      }
      case "thinking.delta": {
        if (this.activity) this.activity.phase = "thinking";
        let row = this.thinking.get(event.blockId);
        if (!row) {
          row = { ...base(event.blockId), kind: "thinking", text: "", durationMs: null, at, model: this.activeModel?.runId === event.runId ? this.activeModel.model : undefined };
          this.thinking.set(event.blockId, row);
          if (this.code) this.step(row);
          else this.add(row);
        }
        row.text += event.text;
        row.touch();
        return;
      }
      case "thinking.done": {
        const row = this.thinking.get(event.blockId);
        if (row) {
          row.durationMs = event.durationMs;
          row.touch();
        }
        return;
      }
      case "tool.started": {
        const row: ToolRow = {
          ...base(event.callId),
          kind: "tool",
          at,
          tool: event.tool,
          summary: event.summary,
          input: event.input,
          status: event.status,
          output: "",
          outputCut: false,
          pendingOutput: "",
        };
        this.tools.set(event.callId, row);
        if (event.tool === "run_command") this.runStats.commands += 1;
        if (this.activity) this.activity.phase = "tools";
        this.activity?.tasks.push({ id: event.callId, kind: "tool", tool: event.tool, summary: event.summary, status: event.status, path: inputFilePath(event.tool, event.input) });
        if (this.code) this.step(row);
        else this.add(row);
        return;
      }
      case "tool.output": {
        const row = this.tools.get(event.callId);
        if (!row) return;
        row.output += event.text;
        if (row.output.length > MAX_TOOL_OUTPUT * 2) {
          row.output = row.output.slice(-MAX_TOOL_OUTPUT);
          row.outputCut = true;
        }
        if (row.onOutput) {
          row.pendingOutput += event.text;
          row.onOutput();
        }
        return;
      }
      case "tool.finished": {
        const row = this.tools.get(event.callId);
        if (!row) return;
        row.status = event.status;
        row.result = event.result;
        row.durationMs = event.durationMs;
        row.screenshotId = event.screenshotId;
        if (event.sources) row.sources = event.sources;
        if (event.files) row.files = event.files;
        row.touch();
        this.task(event.callId, { status: event.status });
        return;
      }
      case "question.requested": {
        const row: QuestionRow = { ...base(event.requestId), kind: "question", requestId: event.requestId, threadId: event.threadId, runId: event.runId, callId: event.callId, questions: event.questions, result: null, closed: false };
        this.questions.set(event.requestId, row);
        this.rows.push(row);
        this.onRow(row);
        return;
      }
      case "question.resolved": {
        const row = this.questions.get(event.requestId);
        if (row && row.runId === event.runId) { row.result = { cancelled: event.cancelled, answers: event.answers }; row.closed = true; row.touch(); }
        return;
      }
      case "approval.requested": {
        const asking = this.tools.get(event.callId);
        const row: ApprovalRow = {
          ...base(event.approvalId),
          kind: "approval",
          approvalId: event.approvalId,
          title: event.title,
          detail: event.detail,
          canAllowAlways: event.canAllowAlways,
          callId: event.callId,
          tool: asking?.tool,
          input: asking?.input,
          decision: null,
          closed: false,
        };
        this.approvals.set(event.approvalId, row);
        const tool = asking;
        if (tool && tool.status !== "running") {
          tool.status = "awaiting-approval";
          tool.touch();
        }
        if (tool?.status === "awaiting-approval") this.task(event.callId, { status: "awaiting-approval" });
        // Not through add: the steps around an approval stay one group.
        this.rows.push(row);
        this.onRow(row);
        return;
      }
      case "approval.resolved": {
        const row = this.approvals.get(event.approvalId);
        if (row) {
          row.decision = event.decision;
          row.touch();
          const tool = this.tools.get(row.callId);
          if (tool && event.decision !== "deny" && tool.status === "awaiting-approval") {
            tool.status = "running";
            tool.touch();
            this.task(tool.key, { status: "running" });
          }
        }
        return;
      }
      case "thread.spawned": {
        const child: SpawnedRow = { ...base(`spawn-${event.childThreadId}`), kind: "spawned", childThreadId: event.childThreadId, title: event.title, model: event.model };
        this.activity?.tasks.push({ id: child.key, kind: "agent", summary: event.title, status: "running", threadId: event.childThreadId });
        if (this.agents) {
          this.agents.setItems([...this.agents.items(), child]);
          this.agents.touch();
          return;
        }
        const [items, setItems] = createSignal<SpawnedRow[]>([child]);
        this.agents = { ...base(`agents-${event.runId}`), kind: "agents", items, setItems };
        this.add(this.agents);
        return;
      }
      case "turn.changes": {
        if (!event.files.length) return;
        const existing = this.changes.get(event.turnId);
        if (existing) {
          this.runStats.files += event.files.length - existing.files.length;
          this.runStats.additions += event.files.reduce((n, f) => n + f.additions, 0) - existing.files.reduce((n, f) => n + f.additions, 0);
          this.runStats.deletions += event.files.reduce((n, f) => n + f.deletions, 0) - existing.files.reduce((n, f) => n + f.deletions, 0);
          existing.files = event.files;
          existing.touch();
          return;
        }
        const row: ChangesRow = { ...base(`turn-${event.turnId}`), kind: "changes", turnId: event.turnId, files: event.files, reverted: false };
        this.runStats.files += event.files.length;
        this.runStats.additions += event.files.reduce((n, f) => n + f.additions, 0);
        this.runStats.deletions += event.files.reduce((n, f) => n + f.deletions, 0);
        this.runStats.turnId = event.turnId;
        this.changes.set(event.turnId, row);
        this.add(row);
        return;
      }
      case "turn.reverted": {
        const row = this.changes.get(event.turnId);
        if (row) {
          row.reverted = true;
          row.touch();
        }
        return;
      }
      case "user.unsent": {
        const row = this.users.get(event.messageId);
        if (row?.receipt) { row.receipt = "unsent"; row.touch(); }
        this.add({ ...base(`unsent-${event.messageId}`), kind: "unsent", reason: event.reason });
        return;
      }
      case "hook.ran":
        if (event.effect === "blocked" && event.messageId) {
          const row = this.users.get(event.messageId);
          if (row?.receipt) { row.receipt = "blocked"; row.touch(); }
        }
        this.add({
          ...base(`hook-${++this.hookRows}-${event.hookId}`), kind: "hook", name: event.name, event: event.event, effect: event.effect,
          outcome: event.outcome, exitCode: event.exitCode, message: event.message, work: this.work ?? undefined,
        });
        return;
      case "context.compacted":
        this.add({ ...base(`compact-${event.runId}`), kind: "compacted", beforeTokens: event.beforeTokens, afterTokens: event.afterTokens });
        return;
      case "usage":
        this.usage = event.usage;
        return;
      case "run.finished":
        this.finishText();
        // Tools the run left behind can no longer change.
        for (const row of this.tools.values()) {
          if (row.status === "running" || row.status === "pending" || row.status === "awaiting-approval") {
            row.status = "cancelled";
            row.touch();
          }
        }
        for (const row of this.questions.values()) {
          if (!row.closed) { row.closed = true; row.touch(); }
        }
        for (const row of this.approvals.values()) {
          if (row.decision === null) {
            row.closed = true;
            row.touch();
          }
        }
        this.thinkingDone();
        if (this.activity) {
          this.activity.running = false;
          for (const task of this.activity.tasks) if (task.kind === "tool" && (task.status === "running" || task.status === "pending" || task.status === "awaiting-approval")) task.status = "cancelled";
        }
        const work = this.work;
        if (work) {
          work.endedAt = at;
          if (!this.live) work.setCollapsed(true);
          work.touch();
        }
        this.work = null;
        this.agents = null;
        if (event.status !== "done") this.add({ ...base(`end-${event.runId}`), kind: "notice", status: event.status, error: event.error });
        // A turn that did something ends with one short line about it (done or stopped; an error
        // has its own card).
        if (work && this.runStats.files > 0 && (event.status === "done" || event.status === "stopped")) {
          const stats = this.runStats;
          this.add({
            ...base(`summary-${event.runId}`), kind: "summary", at, status: event.status, durationMs: Math.max(0, at - work.startedAt), steps: work.steps(),
            files: stats.files, additions: stats.additions, deletions: stats.deletions, commands: stats.commands, turnId: stats.turnId,
          });
        }
        this.steps = null;
        this.activeModel = null;
        if (this.pendingModelChange) {
          this.add(this.pendingModelChange);
          this.pendingModelChange = null;
        }
        return;
      case "run.started": {
        const model = event.model ?? { modelId: event.modelId };
        if (this.selectedModel && this.selectedModel.modelId !== model.modelId) {
          this.add({ ...base(`model-change-run-${event.runId}`), kind: "model-change", from: this.selectedModel, to: model });
        }
        this.selectedModel = model;
        this.activeModel = { runId: event.runId, model };
        this.agents = null;
        this.runStats = { commands: 0, files: 0, additions: 0, deletions: 0, turnId: null };
        this.activity = { startedAt: at, running: true, tasks: [], phase: "starting" };
        if (!this.code) return;
        const [steps, setSteps] = createSignal(0);
        const [collapsed, setCollapsed] = createSignal(false);
        const [lastText, setLastText] = createSignal<TextRow | null>(null);
        const work: WorkRow = { ...base(`work-${event.runId}`), kind: "work", startedAt: at, endedAt: null, steps, setSteps, collapsed, setCollapsed, lastText, setLastText };
        this.add(work);
        this.work = work;
        return;
      }
      default:
        return;
    }
  }

  private finishText(): void {
    for (const row of this.texts.values()) {
      if (!row.done) {
        row.done = true;
        row.touch();
      }
    }
    this.texts.clear();
  }

  private thinkingDone(): void {
    for (const row of this.thinking.values()) {
      if (row.durationMs === null) {
        row.durationMs = 0;
        row.touch();
      }
    }
    this.thinking.clear();
  }
}

const ACTIVITY_EVENTS = new Set<ThreadEvent["type"]>(["run.started", "run.finished", "tool.started", "tool.finished", "approval.requested", "approval.resolved", "thread.spawned"]);

function startsRun(event: ThreadEvent): boolean {
  return event.type === "user.message" || event.type === "run.started";
}

export class ThreadModel {
  readonly id: string;
  readonly chunks: Accessor<Chunk[]>;
  private setChunks: Setter<Chunk[]>;
  readonly queued: Accessor<QueuedMessage[]>;
  private setQueued: Setter<QueuedMessage[]>;
  readonly usage: Accessor<Usage | null>;
  private setUsage: Setter<Usage | null>;
  readonly changes: Accessor<ChangesRow[]>;
  private setChanges: Setter<ChangesRow[]>;
  readonly hasOlder: Accessor<boolean>;
  private setHasOlder: Setter<boolean>;
  readonly activity: Accessor<Activity | null>;
  private setActivity: Setter<Activity | null>;
  readonly retry: Accessor<RetryState | null>;
  private setRetry: Setter<RetryState | null>;
  private folder: Folder;
  readonly code: boolean;
  private loadingOlder: Promise<void> | null = null;
  private reloading: Promise<void> | null = null;
  private reloadAgain = false;
  private held: Array<{ envelope: ThreadEventEnvelope; historyRevision?: number }> | null = null;
  private revertedTurns = new Set<string>();
  private queueSeq = 0; // snapshot boundary; older log entries still render but cannot rebuild the queue
  private lastQueueEvent = 0;
  firstSeq = 1;
  lastSeq = 0;
  historyRevision = 0;
  refs = 0;
  usedAt = 0;

  readonly questions: Accessor<QuestionRow[]>;
  private setQuestions: Setter<QuestionRow[]>;

  constructor(id: string, code: boolean) {
    this.id = id;
    this.code = code;
    this.folder = new Folder(code);
    [this.questions, this.setQuestions] = createSignal<QuestionRow[]>([]);
    [this.chunks, this.setChunks] = createSignal<Chunk[]>([]);
    [this.queued, this.setQueued] = createSignal<QueuedMessage[]>([]);
    [this.usage, this.setUsage] = createSignal<Usage | null>(null);
    [this.changes, this.setChanges] = createSignal<ChangesRow[]>([]);
    [this.hasOlder, this.setHasOlder] = createSignal(false);
    [this.activity, this.setActivity] = createSignal<Activity | null>(null);
    [this.retry, this.setRetry] = createSignal<RetryState | null>(null);
    this.folder.onRow = (row) => this.place(row);
  }

  private place(row: Row): void {
    const chunks = this.chunks();
    const last = chunks.at(-1);
    if (last && last.rows().length < CHUNK_ROWS) last.setRows([...last.rows(), row]);
    else {
      const chunk = newChunk([row]);
      chunk.setNear(true);
      this.setChunks([...chunks, chunk]);
    }
    if (row.kind === "changes") this.setChanges([...this.changes(), row]);
  }

  // The first load: rows are built in one go, and only the last chunks render.
  ingest(events: ThreadEventEnvelope[]): void {
    const rows: Row[] = [];
    this.folder.onRow = (row) => rows.push(row);
    this.folder.live = false;
    for (const envelope of events) {
      if (envelope.seq <= this.lastSeq) continue;
      this.fold(envelope);
      if (envelope.event.type === "turn.reverted") this.revertedTurns.add(envelope.event.turnId);
      this.lastSeq = envelope.seq;
    }
    this.folder.live = true;
    this.folder.onRow = (row) => this.place(row);
    const chunks: Chunk[] = [];
    for (let i = 0; i < rows.length; i += CHUNK_ROWS) chunks.push(newChunk(rows.slice(i, i + CHUNK_ROWS)));
    for (const chunk of chunks.slice(-3)) chunk.setNear(true);
    this.setChunks([...this.chunks(), ...chunks]);
    this.setChanges([...this.changes(), ...rows.filter((r): r is ChangesRow => r.kind === "changes")]);
    this.syncReverted();
    this.syncFolder();
  }

  private syncActivity(): void {
    const current = this.folder.activity;
    this.setActivity(current ? { ...current, tasks: current.tasks.map((t) => ({ ...t })) } : null);
  }

  private fold(envelope: ThreadEventEnvelope): void {
    const before = this.folder.queued;
    this.folder.apply(envelope.event, envelope.at);
    if (envelope.seq <= this.queueSeq) this.folder.queued = before;
    else if (["user.message", "user.queued", "user.queue-removed"].includes(envelope.event.type)) this.lastQueueEvent = envelope.seq;
  }

  async refreshQueue(): Promise<void> {
    const { data: snapshot, headers } = await getWithHeaders<QueueSnapshot>(`/api/threads/${encodeURIComponent(this.id)}/queue`);
    if (historyRevisionOf(headers) !== this.historyRevision) return;
    // A queue event that arrived after this snapshot already describes newer state.
    // Ignore the old response instead of bringing a removed/consumed message back.
    if (snapshot.seq < this.queueSeq || snapshot.seq < this.lastQueueEvent) return;
    this.queueSeq = snapshot.seq;
    this.folder.queued = snapshot.items;
    this.setQueued(this.folder.queued);
  }

  private syncFolder(): void {
    this.syncActivity();
    this.setQuestions([...this.folder.questions.values()]);
    this.setRetry(this.folder.retry);
    this.setQueued(this.folder.queued);
    if (this.folder.usage) this.setUsage(this.folder.usage);
  }

  apply(envelope: ThreadEventEnvelope, historyRevision?: number): void {
    if (this.held) {
      this.held.push({ envelope, historyRevision });
      return;
    }
    if (historyRevision !== undefined && historyRevision !== this.historyRevision) return;
    if (envelope.seq <= this.lastSeq) return;
    this.lastSeq = envelope.seq;
    const { event } = envelope;
    const phase = this.folder.activity?.phase;
    this.fold(envelope);
    if (event.type === "turn.reverted") {
      this.revertedTurns.add(event.turnId);
      this.syncReverted();
    }
    if (event.type === "user.message" || event.type === "user.queued" || event.type === "user.queue-removed") this.setQueued(this.folder.queued);
    if (event.type === "usage") this.setUsage(event.usage);
    if (event.type === "question.requested" || event.type === "question.resolved" || event.type === "run.finished") this.setQuestions([...this.folder.questions.values()]);
    if (ACTIVITY_EVENTS.has(event.type) || this.folder.activity?.phase !== phase) this.syncActivity();
    if (this.retry() !== this.folder.retry) this.setRetry(this.folder.retry);
  }

  // The log was cut back on the server (Chat: an edited message or a new answer). The thread is
  // read again into a model of its own, and taken over in one step, so the view never shows it
  // empty. This one stays registered and subscribed meanwhile: what arrives live is held and
  // applied after, so nothing falls between the fetch and the subscription.
  reload(): Promise<void> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = this.runReload().finally(() => {
      this.reloading = null;
    });
    return this.reloading;
  }

  private async runReload(): Promise<void> {
    let retryMs = 250;
    while (true) {
      this.reloadAgain = false;
      this.held = [];
      const fresh = new ThreadModel(this.id, this.code);
      try {
        await fresh.load();
      } catch (err) {
        this.held = null;
        if (this.reloadAgain) continue;
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) return;
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        if (this.refs === 0 && !this.reloadAgain) return;
        retryMs = Math.min(retryMs * 2, 5000);
        continue;
      }
      if (this.reloadAgain) continue;
      this.folder = fresh.folder;
      this.revertedTurns = fresh.revertedTurns;
      this.queueSeq = fresh.queueSeq;
      this.lastQueueEvent = fresh.lastQueueEvent;
      this.folder.onRow = (row) => this.place(row);
      this.firstSeq = fresh.firstSeq;
      this.lastSeq = fresh.lastSeq;
      this.historyRevision = fresh.historyRevision;
      batch(() => {
        this.setChunks(fresh.chunks());
        this.setQuestions(fresh.questions());
        this.setChanges(fresh.changes());
        this.setHasOlder(fresh.hasOlder());
        this.setQueued(fresh.queued());
        this.setUsage(fresh.usage());
        this.setActivity(fresh.activity());
        this.setRetry(fresh.retry());
      });
      const held = this.held;
      this.held = null;
      for (const { envelope, historyRevision } of held) this.apply(envelope, historyRevision);
      if (!this.reloadAgain) return;
    }
  }

  // Immediate feedback after a confirmed queue update; the durable event also reaches other windows.
  setQueuedSteer(messageId: string, steer: boolean): void {
    this.folder.queued = this.folder.queued.map((q) => (q.messageId === messageId ? { ...q, steer } : q));
    this.setQueued(this.folder.queued);
  }

  // Loads the page before what is in memory. It starts on a run boundary, so it folds on its own.
  loadOlder(): Promise<void> {
    if (!this.hasOlder() || this.reloading) return Promise.resolve();
    this.loadingOlder ??= this.fetchOlder().finally(() => (this.loadingOlder = null));
    return this.loadingOlder;
  }

  private async fetchOlder(): Promise<void> {
    const folderAtStart = this.folder;
    let span = PAGE_EVENTS;
    while (true) {
      const after = Math.max(0, this.firstSeq - 1 - span);
      const { data: events, headers } = await getWithHeaders<ThreadEventEnvelope[]>(`/api/threads/${encodeURIComponent(this.id)}/events?after=${after}&limit=${this.firstSeq - 1 - after}`);
      if (this.folder !== folderAtStart || this.reloading) return;
      if (historyRevisionOf(headers) !== this.historyRevision) return this.reload();
      const start = after === 0 ? 0 : events.findIndex((e) => startsRun(e.event));
      if (start === -1) {
        span *= 2;
        continue;
      }
      const kept = events.slice(start);
      const folder = new Folder(this.code);
      folder.live = false;
      const rows: Row[] = [];
      folder.onRow = (row) => rows.push(row);
      for (const envelope of kept) folder.apply(envelope.event, envelope.at);
      const chunks: Chunk[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_ROWS) chunks.push(newChunk(rows.slice(i, i + CHUNK_ROWS)));
      this.firstSeq = after === 0 ? 1 : (kept[0]?.seq ?? this.firstSeq);
      this.setChunks([...chunks, ...this.chunks()]);
      this.setChanges([...rows.filter((r): r is ChangesRow => r.kind === "changes"), ...this.changes()]);
      this.syncReverted();
      this.setHasOlder(this.firstSeq > 1);
      return;
    }
  }

  async load(): Promise<void> {
    let tail = TAIL_EVENTS;
    while (true) {
      const { data: events, headers } = await getWithHeaders<ThreadEventEnvelope[]>(`/api/threads/${encodeURIComponent(this.id)}/events?tail=${tail}`);
      this.historyRevision = historyRevisionOf(headers);
      const first = events[0]?.seq ?? 1;
      if (first <= 1) {
        this.firstSeq = 1;
        this.ingest(events);
        await this.refreshQueue();
        return;
      }
      const start = events.findIndex((e) => startsRun(e.event));
      if (start === -1 && tail < 20_000) {
        tail *= 4;
        continue;
      }
      const kept = start === -1 ? events : events.slice(start);
      this.firstSeq = kept[0]?.seq ?? first;
      this.ingest(kept);
      this.setHasOlder(true);
      // Fetch after the tail so a consumed job outside that page cannot survive in the queue.
      // Live replay still starts at lastSeq; queueSeq only suppresses older queue effects.
      await this.refreshQueue();
      return;
    }
  }

  private syncReverted(): void {
    for (const row of this.changes()) {
      if (this.revertedTurns.has(row.turnId) && !row.reverted) {
        row.reverted = true;
        row.touch();
      }
    }
  }
}

// The registry of models. A model subscribes while a view uses it, and stays in memory for a
// while afterwards so going back to a thread needs no network.

const models = new Map<string, ThreadModel>();
const loading = new Map<string, Promise<ThreadModel>>();
const [loadedCount, setLoadedCount] = createSignal(0);

// Reactive: a memo that peeks before the model has loaded runs again when it has.
export function peekModel(id: string): ThreadModel | undefined {
  loadedCount();
  return models.get(id);
}

// code: the thread's mode when the caller knows it before app.threads does.
export function loadModel(id: string, code?: boolean): Promise<ThreadModel> {
  const existing = models.get(id);
  if (existing) return Promise.resolve(existing);
  let pending = loading.get(id);
  if (!pending) {
    const model = new ThreadModel(id, code ?? app.threads[id]?.mode === "code");
    pending = model.load().then(() => {
      models.set(id, model);
      setLoadedCount((n) => n + 1);
      return model;
    }).finally(() => loading.delete(id));
    loading.set(id, pending);
  }
  return pending;
}

function evict(): void {
  const idle = [...models.values()].filter((m) => m.refs === 0).sort((a, b) => a.usedAt - b.usedAt);
  for (const model of idle.slice(0, Math.max(0, idle.length - CACHED_MODELS))) models.delete(model.id);
}

export function retainModel(model: ThreadModel): () => void {
  model.refs += 1;
  if (model.refs === 1) send({ type: "thread.subscribe", threadId: model.id, afterSeq: model.lastSeq, historyRevision: model.historyRevision });
  return () => {
    model.refs -= 1;
    model.usedAt = performance.now();
    if (model.refs === 0) {
      send({ type: "thread.unsubscribe", threadId: model.id });
      evict();
    }
  };
}

export function forgetModel(id: string): void {
  models.delete(id);
}

// The log was cut back (Chat: an edited message or a new answer), so what is in memory no longer
// matches it. A model in view reads it again in place. A cached one is just dropped.
function resetModel(id: string, revision?: number): void {
  const model = models.get(id);
  if (!model || model.historyRevision === revision) return;
  if (model.refs > 0) void model.reload();
  else models.delete(id);
}

export function wireThreadEvents(): void {
  on("thread.event", ({ envelope, historyRevision }) => models.get(envelope.threadId)?.apply(envelope, historyRevision));
  on("thread.deleted", ({ threadId }) => forgetModel(threadId));
  on("thread.reset", ({ threadId, historyRevision }) => resetModel(threadId, historyRevision));
  onOpen(() => {
    // Also the very first time: anything retained before the socket opened is not subscribed yet.
    for (const model of models.values()) {
      if (model.refs > 0) {
        send({ type: "thread.subscribe", threadId: model.id, afterSeq: model.lastSeq, historyRevision: model.historyRevision });
        void model.refreshQueue().catch(() => undefined); // durable replay remains the fallback on network errors
      }
    }
  });
}
