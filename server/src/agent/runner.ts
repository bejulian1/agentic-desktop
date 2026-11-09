// The agent loop and everything around a run: queue, approvals, stop, recovery. All run state is
// keyed by thread, so threads run side by side.
import { cleanName } from "../names.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ApprovalDecision,
  Attachment,
  AttachmentRef,
  ModelConfig,
  Project,
  RunStatus,
  Thread,
  ThreadRef,
  ToolStatus,
  Usage,
} from "../../../shared/protocol.ts";
import type { Store } from "../db.ts";
import { HttpError } from "../errors.ts";
import { PathError } from "../paths.ts";
import { ProviderError, type Block, type ImageData, type Message, type Provider, type StopReason, type ToolDef } from "../providers/types.ts";
import { MAX_ATTACHMENTS } from "../../../shared/protocol.ts";
import { discoverSkills, renderSkill, SkillStore, type Skill } from "../skills.ts";
import { captureMemories, Memories } from "../memory.ts";
import { HarnessStore, type UpgradeOp, type UpgradeProposal } from "./harness.ts";
import { parseModelOps, proposeByRules, UPGRADE_SYSTEM, upgradeRequest, type UpgradeItem } from "./memory-upgrade.ts";
import { coerceArgs, describeParams, resolveToolName } from "./args.ts";
import { verifyCommands } from "./prompt.ts";
import type { ConfigDirs } from "../config-dirs.ts";
import type { TaskBoard } from "./tasks.ts";
import { Collab } from "./collab.ts";
import {
  blocksText,
  systemLayers,
  type InstructionLayers,
  type PromptLayer,
  READ_ONLY_TOOLS,
  PARALLEL_TOOLS,
  COMPACT_AT,
  compactToolResults,
  estimateTokens,
  overTarget,
  renderTranscript,
  resolveAttachments,
  stripThinking,
  SUMMARY_SYSTEM,
  summaryCut,
} from "./context.ts";
import type { EventLog } from "./events.ts";
import { FileState } from "./filestate.ts";
import { decide } from "./permissions.ts";
import { CODE_TOOLS, clip, MAX_RESULT_CHARS, TOOL_ALIASES, TOOLS_BY_NAME, type BrowserTools, type Tool, type ToolContext, type ToolResult } from "./tools.ts";
import { browserWeb, demoWeb, sourcesText, webFetchTool, webSearchTool, type WebAccess, type WebReader } from "./web.ts";
import { chatToolsOf, webSearchRoute, type ChatTools, type WebSearchRoute } from "../../../shared/protocol.ts";
import type { Turns } from "./turns.ts";

export const MAX_STEPS = 50;
const AUTO_UPGRADE_EVERY_MS = 24 * 60 * 60 * 1000; // at most once a day
const AUTO_UPGRADE_MIN = 8; // memories in a file before a proposal is worth making
const MAX_RETRIES = 3;
// Waiting on the provider (Retry-After or backoff), in all per step. Asked to wait longer, the run
// ends with an error instead of working quietly for minutes.
export const MAX_RETRY_WAIT_MS = 60_000;
const MAX_OUTPUT_EVENT_CHARS = 1024 * 1024;
const DOOM_LIMIT = 3;
const MISTAKE_HINT_AT = 3; // invalid calls in a row before the error says to step back
const MAX_CUT_CALLS = 2; // tool calls cut off by the output limit before the run stops
const EDIT_TOOLS = new Set(["write_file", "edit_file"]);
// Files where a change is not worth a test run.
const PROSE = /\.(md|markdown|mdx|txt|rst|adoc|csv|log|svg|png|jpe?g|gif|webp|ico)$/i;

export interface SendInput {
  text: string;
  attachments?: AttachmentRef[];
  skill?: string;
  shell?: string;
  review?: boolean;
  from?: ThreadRef;
  chainId?: string;
  steer?: boolean; // while a run is active: into the running turn (true) or the queue (false); unset follows Settings.busyMessages
}

const MAX_REVIEW_CHARS = 48 * 1024;

// A short line diff: what is between the common start and end of the file. Good enough for a
// reviewer to see what changed, and cheap.
function reviewDiff(before: string | null, after: string | null): string {
  const a = before === null ? [] : before.split("\n");
  const b = after === null ? [] : after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [`@@ linje ${start + 1} @@`, ...a.slice(start, endA).map((l) => `-${l}`), ...b.slice(start, endB).map((l) => `+${l}`)].join("\n");
}

interface Job {
  id: string;
  kind: "message" | "shell" | "compact";
  text: string; // what the conversation shows
  modelText: string; // what the model gets
  shell?: string;
  from?: ThreadRef;
  attachments?: Attachment[];
  images?: Array<{ image: ImageData; name: string }>; // attached images, for the model
  chainId: string;
  steer?: boolean; // taken into the running turn at the next step, not after it
}

interface ActiveRun {
  runId: string;
  threadId: string;
  projectId: string | null;
  turnId: string;
  job: Job;
  abort: AbortController;
  shuttingDown: boolean;
  lastCall: { key: string; count: number };
  mistakes: number; // invalid tool calls in a row
}

interface PendingApproval {
  threadId: string;
  settle: (decision: ApprovalDecision | "cancelled") => void;
}

interface ToolCall {
  id: string;
  name: string;
  input: any;
  parseError?: string;
}

export interface RunnerDeps {
  store: Store;
  log: EventLog;
  turns: Turns;
  dataDir: string;
  browser: BrowserTools;
  userSkillsDir: string;
  config: ConfigDirs;
  tasks: TaskBoard;
  commandTimeoutMs: number;
  retryBaseMs: number;
  provider: (model: ModelConfig) => Provider;
  env: () => Record<string, string>;
  threadChanged: (threadId: string) => void;
  filesChanged: (projectId: string, paths: string[]) => void;
  usageChanged: (projectId: string) => void;
  web?: WebReader; // round 13: the app's browser, for web search and reading pages
  // The project was just used (a run started in it): its new lastUsedAt goes out to the windows,
  // so «sist brukt» on the Kode start page and in the project picker is right without a reload.
  projectTouched?: (projectId: string) => void;
}

function deriveTitle(text: string): string {
  const line = cleanName(text).split("\n")[0].trim() || "Ny tråd";
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

function addUsage(total: Usage, part: { inputTokens: number; outputTokens: number; cachedInputTokens: number }, model: ModelConfig): Usage {
  const priced = model.inputPricePerMTok !== undefined || model.outputPricePerMTok !== undefined;
  const cost = ((model.inputPricePerMTok ?? 0) * part.inputTokens + (model.outputPricePerMTok ?? 0) * part.outputTokens) / 1_000_000;
  return {
    inputTokens: total.inputTokens + part.inputTokens,
    outputTokens: total.outputTokens + part.outputTokens,
    cachedInputTokens: total.cachedInputTokens + part.cachedInputTokens,
    contextTokens: part.inputTokens + part.outputTokens,
    costUsd: priced ? (total.costUsd ?? 0) + cost : total.costUsd,
  };
}

function abortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export class Runner {
  private deps: RunnerDeps;
  private store: Store;
  private log: EventLog;
  private active = new Map<string, ActiveRun>();
  private approvals = new Map<string, PendingApproval>();
  private idleWaiters = new Map<string, Set<() => void>>();
  private closing = false;
  readonly files = new FileState();
  readonly collab: Collab;
  readonly memories: Memories;
  readonly chatMemories: Memories; // Chat's own (SPEC 22.4), in chat/MEMORY.md in the global folder
  readonly harness: HarnessStore;
  readonly skillStore: SkillStore;
  // Memories are read once per thread, when its first run starts, like Hermes' frozen snapshot:
  // the system prompt stays the same for the rest of the thread, and so does the prompt cache.
  private memorySnapshots = new Map<string, string>();

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.store = deps.store;
    this.log = deps.log;
    this.store.isRunning = (id) => this.active.has(id);
    this.store.pendingApprovals = (id) => [...this.approvals.values()].filter((a) => a.threadId === id).length;
    this.memories = new Memories(deps.config.globalDir, deps.dataDir);
    this.chatMemories = new Memories(path.join(deps.config.globalDir, "chat"), deps.dataDir);
    this.harness = new HarnessStore(deps.dataDir);
    this.skillStore = new SkillStore({
      userDir: () => deps.userSkillsDir,
      projects: () => this.store.projects(),
      project: (id) => this.store.project(id),
      disabled: () => this.store.settings().disabledSkills ?? [],
      setDisabled: (dirs) => void this.store.updateSettings({ disabledSkills: dirs }),
      dataDir: deps.dataDir,
    });
    this.collab = new Collab(this.store, this.log, {
      sendFromThread: (threadId, text, from, chainId) => void this.send(threadId, { text, from, chainId }),
      chainOf: (threadId) => this.active.get(threadId)?.job.chainId ?? randomUUID(),
      runningAgentThreads: (projectId) => [...this.active.values()].filter((run) => run.projectId === projectId && run.job.from).length,
      isBusy: (threadId) => this.active.has(threadId),
      waitIdle: (threadId, ms, signal) => this.waitIdle(threadId, ms, signal),
      threadChanged: deps.threadChanged,
    });
  }

  get userSkillsDir(): string {
    return this.deps.userSkillsDir;
  }

  isRunning(threadId: string): boolean {
    return this.active.has(threadId);
  }

  // Sending

  send(threadId: string, input: SendInput): { messageId: string; queued: boolean; steer: boolean } {
    const thread = this.store.thread(threadId);
    if (!thread) throw new HttpError(404, "Fant ikke tråden");
    if (this.closing) throw new HttpError(503, "Serveren stopper");
    const job = this.buildJob(thread, input);
    if (this.active.has(threadId)) {
      // Messages from other threads always wait their turn; the user chooses for their own.
      const steer = job.kind === "message" && !input.from && (input.steer ?? this.store.settings().busyMessages === "steer");
      if (steer) job.steer = true;
      this.store.enqueue(threadId, job.id, job);
      this.log.append(threadId, { type: "user.queued", messageId: job.id, text: job.text, ...optional(job), ...(steer ? { steer: true } : {}) });
      return { messageId: job.id, queued: true, steer };
    }
    this.start(thread, job);
    return { messageId: job.id, queued: false, steer: false };
  }

  // The toggle on a queued message: into the running turn, or back to waiting for it to end.
  setSteer(threadId: string, messageId: string, steer: boolean): { messageId: string; steer: boolean } {
    if (!this.store.thread(threadId)) throw new HttpError(404, "Fant ikke tråden");
    const found = this.store.updateQueued<Job>(threadId, messageId, (job) => {
      if (job.kind !== "message" || job.from) throw new HttpError(400, "Bare dine egne meldinger kan sendes inn i turen");
      return { ...job, steer };
    });
    if (!found) throw new HttpError(404, "Meldingen er ikke i køen lenger");
    return { messageId, steer };
  }

  // Steered messages join the running turn here, at a step: after the tool results, or when the
  // model has stopped writing. They show in the conversation where they came in.
  private takeSteered(active: ActiveRun): number {
    const jobs = this.store.takeQueued<Job>(active.threadId, (job) => job.steer === true);
    for (const job of jobs) {
      this.log.append(active.threadId, { type: "user.message", messageId: job.id, text: job.text, ...optional(job) });
      if (job.modelText) this.store.appendMessage(active.threadId, { role: "user", content: userContent(job.modelText, job) });
    }
    return jobs.length;
  }

  compact(threadId: string): void {
    const thread = this.store.thread(threadId);
    if (!thread) throw new HttpError(404, "Fant ikke tråden");
    if (this.active.has(threadId)) throw new HttpError(409, "Tråden kjører");
    this.start(thread, { id: randomUUID(), kind: "compact", text: "", modelText: "", chainId: randomUUID() });
  }

  private buildJob(thread: Thread, input: SendInput): Job {
    const project = thread.projectId ? this.store.project(thread.projectId) : undefined;
    const base = { id: randomUUID(), from: input.from, chainId: input.chainId ?? randomUUID() };
    const text = String(input.text ?? "").trim();

    if (input.shell !== undefined) {
      const command = String(input.shell).trim();
      if (!command) throw new HttpError(400, "Kommandoen er tom");
      if (!project || thread.mode !== "code") throw new HttpError(400, "! krever Kode-modus og et prosjekt");
      return { ...base, kind: "shell", text: `!${command}`, modelText: "", shell: command };
    }

    if (input.review) {
      const turnIds = this.store.reviewTurns(thread.id);
      if (!turnIds.length) throw new HttpError(400, "Det er ingen filendringer å gjennomgå i tråden");
      const latest = new Map<string, { before: string | null; after: string | null; change: string }>();
      for (const turnId of turnIds) {
        for (const file of this.deps.turns.diff(turnId).files) {
          const seen = latest.get(file.path);
          latest.set(file.path, { before: seen ? seen.before : file.before, after: file.after, change: file.change });
        }
      }
      let body = "";
      for (const [file, d] of latest) {
        const part = `--- ${file} (${d.change})\n${reviewDiff(d.before, d.after)}\n`;
        if (body.length + part.length > MAX_REVIEW_CHARS) {
          body += `--- [${latest.size} filer totalt, resten er utelatt]\n`;
          break;
        }
        body += part;
      }
      const modelText = [
        "[Kodegjennomgang]",
        "Review the changes this thread made, file by file. Point out bugs, risks and unclear code, most important first, and say what is good. Do not change any files.",
        text ? `The user adds: ${text}` : "",
        "",
        body,
      ].filter((line, i) => i !== 2 || line).join("\n");
      return { ...base, kind: "message", text: text ? `/review ${text}` : "/review", modelText };
    }

    const parts: string[] = [];
    let shown = text;
    if (input.skill) {
      const skill = this.skillsFor(project).find((s) => s.name === input.skill);
      if (!skill) throw new HttpError(404, `Fant ikke skillen ${input.skill}`);
      shown = `/${skill.name}${text ? ` ${text}` : ""}`;
      parts.push(renderSkill(skill));
    } else if (!text) {
      throw new HttpError(400, "Meldingen er tom");
    }
    if (text) parts.unshift(input.from ? `[Melding fra tråden ${JSON.stringify(input.from.title)}]\n\n${text}` : text);

    let attachments: Attachment[] | undefined;
    let images: Job["images"];
    if (input.attachments?.length) {
      if (input.attachments.length > MAX_ATTACHMENTS) throw new HttpError(400, `Du kan legge ved maks ${MAX_ATTACHMENTS} bilder og filer per melding`);
      try {
        const resolved = resolveAttachments(input.attachments, project, this.store, this.deps.dataDir);
        attachments = resolved.attachments;
        if (resolved.text) parts.push(resolved.text);
        if (resolved.images.length) images = resolved.images;
      } catch (err) {
        if (err instanceof PathError) throw new HttpError(403, err.message);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Fant ikke vedlegget");
        throw err;
      }
    }
    return { ...base, kind: "message", text: shown, modelText: parts.join("\n\n"), attachments, images };
  }

  layers(project: Project | undefined): InstructionLayers {
    return {
      global: this.deps.config.global().agentsMd,
      agentic: project ? this.deps.config.project(project).agentsMd : null,
      globalFile: path.join(this.deps.config.globalDir, "AGENTS.md"),
    };
  }

  skillsFor(project: Project | undefined): Skill[] {
    return discoverSkills(project?.path ?? null, this.deps.userSkillsDir, this.store.settings().disabledSkills);
  }

  private memoriesOn(): boolean {
    return this.store.settings().memories !== false;
  }

  private autoSkills(): "ask" | "auto" | "off" {
    return this.store.settings().autoSkills ?? "ask";
  }

  // What the model is offered in this thread. The context ring counts the same list.
  toolDefs(thread: Thread, project: Project | undefined, skills: Skill[]): ToolDef[] {
    if (this.isChat(thread, project)) return this.chatToolDefs(thread).map((t) => t.def);
    if (thread.mode !== "code" || !project) return [];
    const hidden = new Set<string>();
    if (!this.codeWeb(thread)) hidden.add("web_search");
    if (!skills.length) hidden.add("use_skill");
    if (!this.memoriesOn()) hidden.add("remember").add("forget");
    if (this.autoSkills() === "off") hidden.add("propose_skill");
    if (thread.planMode) hidden.add("update_plan"); // plan mode answers with its plan as text
    return CODE_TOOLS.filter((t) => !hidden.has(t.def.name) && (!thread.planMode || READ_ONLY_TOOLS.has(t.def.name))).map((t) => t.def);
  }

  // keep: taken when a run starts. Others, like the context ring, look without keeping.
  // Chat gets its own memories and never the Kode ones (SPEC 22.4); Kode gets this project's and
  // the global ones.
  private isChat(thread: Thread, project: Project | undefined): boolean {
    return thread.mode === "chat" || !project;
  }

  // Round 13 (SPEC 27.2): the tools of a chat, as switched in its tool menu. Kode without a project
  // (Denne datamaskinen) has none, as before.
  chatTools(thread: Thread): ChatTools | null {
    if (thread.mode !== "chat" || thread.projectId) return null;
    return chatToolsOf(thread, this.store.settings());
  }

  // How this thread's model searches the web: its provider's own search, the app's browser on the
  // search page from Innstillinger, or demo sources. null when it cannot.
  webRoute(thread: Thread): WebSearchRoute | null {
    const model = this.resolveModelSafe(thread);
    const kind = model ? this.store.provider(model.providerId)?.kind : undefined;
    return webSearchRoute(model, kind, this.store.settings());
  }

  private webAccess(route: WebSearchRoute | null): WebAccess | undefined {
    if (route === "demo") return demoWeb(this.deps.web);
    if (!this.deps.web) return undefined;
    return browserWeb(this.deps.web, this.store.settings().webSearchUrl);
  }

  // Kode searches with the browser or as a demo; the provider's own search is for Chat.
  private codeWeb(thread: Thread): WebAccess | undefined {
    const route = this.webRoute(thread);
    return route === "browser" || route === "demo" ? this.webAccess(route) : undefined;
  }

  private chatToolDefs(thread: Thread): Tool[] {
    const tools = this.chatTools(thread);
    if (!tools) return [];
    const out: Tool[] = [];
    const route = tools.web ? this.webRoute(thread) : null;
    if (route === "browser" || route === "demo") out.push(webSearchTool);
    if (tools.fetch && this.deps.web) out.push(webFetchTool);
    return out;
  }

  private memoryText(thread: Thread, project: Project | undefined, keep: boolean): string {
    const chat = this.isChat(thread, project);
    if (chat ? !this.harness.state().chat.memories || this.chatTools(thread)?.memory === false : !this.memoriesOn()) return "";
    let text = this.memorySnapshots.get(thread.id);
    if (text === undefined) {
      text = chat ? this.chatMemories.forPrompt(undefined).replace(/^About the user, for every project:\n/, "") : this.memories.forPrompt(project);
      if (keep) this.memorySnapshots.set(thread.id, text);
    }
    return text;
  }

  // The system prompt as layers, for the preview in Innstillinger (SPEC 22.2) and for the run.
  systemLayers(thread: Thread, project: Project | undefined, skills: Skill[], forRun = false): PromptLayer[] {
    const tools = this.toolDefs(thread, project, skills).map((t) => t.name);
    const memories = this.memoryText(thread, project, forRun);
    const state = this.harness.state();
    return systemLayers(
      thread,
      project,
      skills,
      this.deps.dataDir,
      this.layers(project),
      { memories, memoryTools: tools.includes("remember"), skillTools: tools.includes("propose_skill"), parts: state.parts, tools },
      { personal: state.chat, memories, tools: this.chatPromptTools(thread, project) },
    );
  }

  private chatPromptTools(thread: Thread, project: Project | undefined): { web: WebSearchRoute | null; fetch: boolean; artifacts: boolean; memory: boolean } | undefined {
    if (!this.isChat(thread, project)) return undefined;
    const tools = this.chatTools(thread);
    if (!tools) return undefined;
    const offered = this.chatToolDefs(thread).map((t) => t.def.name);
    const route = tools.web ? this.webRoute(thread) : null;
    return { web: route === "provider" || offered.includes("web_search") ? route : null, fetch: offered.includes("web_fetch"), artifacts: tools.artifacts, memory: tools.memory };
  }

  systemPrompt(thread: Thread, project: Project | undefined, skills: Skill[], forRun = false): string {
    return this.systemLayers(thread, project, skills, forRun).map((l) => l.text).join("\n\n");
  }

  // A new thread as it would start now, without making one: the preview in Innstillinger.
  previewLayers(mode: "code" | "chat", project: Project | undefined): PromptLayer[] {
    const now = Date.now();
    const thread: Thread = {
      id: `preview-${now}`, projectId: mode === "code" ? (project?.id ?? null) : null, mode, title: "Forhåndsvisning", modelId: null, archived: false,
      createdAt: now, updatedAt: now, running: false, parentThreadId: null, origin: "user", permissionCap: null, pendingApprovals: 0,
      goal: null, goalSetAt: null, goalResumedAt: null, goalPausedAt: null, goalElapsedMs: 0, chapters: [], planMode: false, plan: null,
      reasoning: null, personality: null, lastStatus: null,
    };
    const scoped = mode === "code" ? project : undefined;
    return this.systemLayers(thread, scoped, mode === "code" ? this.skillsFor(scoped) : []);
  }

  toolNames(mode: "code" | "chat", project: Project | undefined): string[] {
    if (mode !== "code" || !project) return [];
    const thread = { mode, projectId: project.id, planMode: false } as Thread;
    return this.toolDefs(thread, project, this.skillsFor(project)).map((t) => t.name);
  }

  private start(thread: Thread, job: Job): void {
    if (job.kind !== "compact") {
      this.log.append(thread.id, { type: "user.message", messageId: job.id, text: job.text, ...optional(job) });
      if (job.modelText) this.store.appendMessage(thread.id, { role: "user", content: userContent(job.modelText, job) });
      // Round 10 (SPEC 23.8): an empty thread has no title in the UI, so the first message always
      // gives it one, also when it is only an attachment.
      if (thread.title === "Ny tråd") {
        const title = job.text ? deriveTitle(job.text) : job.attachments?.[0]?.label ? deriveTitle(job.attachments[0].label) : job.images?.[0]?.name ? deriveTitle(job.images[0].name) : "";
        if (title && title !== "Ny tråd") this.store.updateThread(thread.id, { title });
      }
    }
    if (thread.projectId) {
      this.store.touchProject(thread.projectId);
      this.deps.projectTouched?.(thread.projectId);
    }
    this.store.touchThread(thread.id);

    const model = this.resolveModel(thread);
    const active: ActiveRun = {
      runId: randomUUID(),
      threadId: thread.id,
      projectId: thread.projectId,
      turnId: randomUUID(),
      job,
      abort: new AbortController(),
      shuttingDown: false,
      lastCall: { key: "", count: 0 },
      mistakes: 0,
    };
    this.active.set(thread.id, active);
    this.store.createRun({ id: active.runId, threadId: thread.id, modelId: model.id, turnId: active.turnId, startSeq: this.store.lastSeq(thread.id) + 1 });
    this.log.append(thread.id, { type: "run.started", runId: active.runId, modelId: model.id });
    this.deps.threadChanged(thread.id);
    void this.execute(active, model);
  }

  private resolveModelSafe(thread: Thread): ModelConfig | undefined {
    try {
      return this.resolveModel(thread);
    } catch {
      return undefined;
    }
  }

  private resolveModel(thread: Thread): ModelConfig {
    const model = (thread.modelId ? this.store.model(thread.modelId) : undefined) ?? this.store.model(this.store.settings().defaultModelId!);
    if (!model) throw new HttpError(400, "Ingen modell er valgt");
    return thread.reasoning ? { ...model, effort: thread.reasoning } : model;
  }

  private async execute(active: ActiveRun, model: ModelConfig): Promise<void> {
    const { threadId, runId } = active;
    let status: RunStatus = "done";
    let error: string | undefined;
    try {
      if (active.job.kind === "message") await this.loop(active, model);
      else if (active.job.kind === "shell") await this.runShell(active);
      else await this.compactNow(active, model);
    } catch (err) {
      if (active.abort.signal.aborted) {
        status = active.shuttingDown ? "interrupted" : "stopped";
      } else {
        status = "error";
        error = (err as Error).message || "Ukjent feil";
      }
    }
    this.log.flush(threadId);
    const thread = this.store.thread(threadId);
    if (thread) {
      this.finishTurn(thread, runId, active.turnId);
      this.store.finishRun(runId, status, error);
      this.log.append(threadId, { type: "run.finished", runId, status, ...(error ? { error } : {}) });
      this.store.touchThread(threadId);
    }
    this.active.delete(threadId);
    if (!thread) return this.wake(threadId);
    if (status === "done" && active.job.kind === "message") this.afterTurn(thread, active.job.text);
    this.deps.threadChanged(threadId);
    if (this.closing) return;
    if (status === "stopped") this.drainQueue(thread);
    const next = this.store.dequeue<Job>(threadId);
    if (next) this.start(this.store.thread(threadId)!, next);
    else this.wake(threadId);
  }

  // After a finished turn (SPEC 22.3 and 22.4): Chat remembers what the user plainly asked it to,
  // when «Oppdater minnet av seg selv» is on, and now and then a memory upgrade is proposed. Both
  // are cheap rules, and neither may stop anything.
  private afterTurn(thread: Thread, text: string): void {
    try {
      const project = thread.projectId ? this.store.project(thread.projectId) : undefined;
      const state = this.harness.state();
      if (this.isChat(thread, project) && state.chat.autoMemory && !thread.temporary && text && this.chatTools(thread)?.memory !== false) {
        for (const memory of captureMemories(text)) this.chatMemories.add("global", undefined, memory);
      }
      if (state.autoUpgrade && (state.lastUpgradeAt === null || Date.now() - state.lastUpgradeAt > AUTO_UPGRADE_EVERY_MS)) {
        this.autoUpgrade(this.isChat(thread, project) ? undefined : project);
      }
    } catch (err) {
      console.error("Etter turen:", (err as Error).message);
    }
  }

  // Proposals only, from the rules, for files with enough memories to be worth a look. They wait
  // in Innstillinger until the user has seen them.
  private autoUpgrade(project: Project | undefined): void {
    const now = Date.now();
    const targets: Array<{ scope: UpgradeProposal["scope"]; project?: Project }> = project ? [{ scope: "project", project }, { scope: "global" }] : [{ scope: "chat" }];
    let made = false;
    for (const target of targets) {
      const items = this.upgradeItems(target.scope, target.project);
      if (items.length < AUTO_UPGRADE_MIN) continue;
      const ops = proposeByRules(items, { projectPath: target.project?.path });
      if (!ops.length) continue;
      this.harness.addPending({ scope: target.scope, ...(target.project ? { projectId: target.project.id } : {}), source: "regler", createdAt: now, ops });
      made = true;
    }
    if (!made) this.harness.touchUpgrade(now);
  }

  private memoryStore(scope: UpgradeProposal["scope"]): Memories {
    return scope === "chat" ? this.chatMemories : this.memories;
  }

  upgradeItems(scope: UpgradeProposal["scope"], project: Project | undefined): UpgradeItem[] {
    return this.memoryStore(scope)
      .list(scope === "project" ? "project" : "global", project)
      .filter((i) => !i.flagged)
      .map((i) => ({ id: i.id, text: i.text }));
  }

  // A proposal for one memory file. With useModel and a real model chosen, the model makes it;
  // if it cannot, or gives something that does not pass the checks, the rules do.
  async proposeUpgrade(scope: UpgradeProposal["scope"], project: Project | undefined, useModel: boolean): Promise<UpgradeProposal> {
    const items = this.upgradeItems(scope, project);
    const base = { scope, ...(project && scope === "project" ? { projectId: project.id } : {}), createdAt: Date.now() };
    const rules = () => proposeByRules(items, { projectPath: scope === "project" ? project?.path : undefined });
    if (!useModel || items.length < 2) return { ...base, source: "regler", ops: rules() };
    const model = this.store.model(this.store.settings().defaultModelId!);
    if (!model || this.store.provider(model.providerId)?.kind === "mock") {
      return { ...base, source: "regler", ops: rules(), note: "Demo-modellen er valgt, så forslaget er laget av faste regler." };
    }
    try {
      const provider = this.deps.provider(model);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new Error("Modellen brukte for lang tid")), 60_000);
      let answer = "";
      try {
        for await (const part of provider.stream({ model, system: UPGRADE_SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: upgradeRequest(items) }] }], tools: [], signal: abort.signal, purpose: "summary" })) {
          if (part.type === "text") answer += part.text;
          if (answer.length > 64 * 1024) break;
        }
      } finally {
        clearTimeout(timer);
      }
      return { ...base, source: "modell", ops: parseModelOps(answer, items) };
    } catch (err) {
      return { ...base, source: "regler", ops: rules(), note: `${model.name} ga ikke et gyldig forslag (${(err as Error).message}), så forslaget er laget av faste regler.` };
    }
  }

  // The chosen operations, written in one go. Ids are checked against the file as it is now.
  applyUpgrade(scope: UpgradeProposal["scope"], project: Project | undefined, ops: UpgradeOp[]): number {
    const changes: Array<{ id: string; text: string | null }> = [];
    for (const op of ops) {
      if (op.kind === "remove") changes.push(...op.ids.map((id) => ({ id, text: null })));
      else {
        changes.push({ id: op.ids[0], text: op.result });
        changes.push(...op.ids.slice(1).map((id) => ({ id, text: null })));
      }
    }
    const count = this.memoryStore(scope).rewrite(scope === "project" ? "project" : "global", project, changes);
    this.harness.dropPending(scope, scope === "project" ? project?.id : undefined);
    this.harness.touchUpgrade();
    return count;
  }

  // The folder can be gone by now. That must not keep a run from ending.
  private finishTurn(thread: Thread, runId: string, turnId: string): void {
    const project = thread.projectId ? this.store.project(thread.projectId) : undefined;
    if (!project) return;
    try {
      const files = this.deps.turns.finish(turnId, project.path);
      if (files.length) this.log.append(thread.id, { type: "turn.changes", runId, turnId, files });
    } catch (err) {
      console.error("Kunne ikke lese filendringene:", (err as Error).message);
    }
  }

  // After a stop, queued messages stay in the conversation but do not start anything.
  private drainQueue(thread: Thread): void {
    for (let job = this.store.dequeue<Job>(thread.id); job; job = this.store.dequeue<Job>(thread.id)) {
      this.log.append(thread.id, { type: "user.message", messageId: job.id, text: job.text, ...optional(job) });
      // A !command in the queue never ran, so the model must not read it as if it had.
      const text = job.kind === "shell" ? `${job.text}\n\n(Kommandoen ble ikke kjørt: turen ble stoppet før den kom fram i køen.)` : job.modelText || job.text;
      if (text) this.store.appendMessage(thread.id, { role: "user", content: userContent(text, job) });
    }
  }

  private wake(threadId: string): void {
    const waiters = this.idleWaiters.get(threadId);
    if (!waiters) return;
    this.idleWaiters.delete(threadId);
    for (const notify of waiters) notify();
  }

  waitIdle(threadId: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (!this.active.has(threadId)) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      };
      const onAbort = () => {
        clearTimeout(timer);
        this.idleWaiters.get(threadId)?.delete(done);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        this.idleWaiters.get(threadId)?.delete(done);
        resolve(false);
      }, timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      let waiters = this.idleWaiters.get(threadId);
      if (!waiters) this.idleWaiters.set(threadId, (waiters = new Set()));
      waiters.add(done);
    });
  }

  // The loop

  private async loop(active: ActiveRun, model: ModelConfig): Promise<void> {
    const { threadId, abort } = active;
    const thread = this.store.thread(threadId)!;
    const project = thread.projectId ? this.store.project(thread.projectId) : undefined;
    const skills = thread.mode === "code" ? this.skillsFor(project) : [];
    const system = this.systemPrompt(thread, project, skills, true);
    const tools = this.toolDefs(thread, project, skills);
    const offered = new Set(tools.map((t) => t.name));
    const provider = this.deps.provider(model);
    const checks = project && tools.length ? verifyCommands(project.path) : [];
    // Round 13 (SPEC 27.2): a chat with Nettsøk on, on a model with its own web search.
    const chat = this.isChat(thread, project);
    const webSearch = chat && this.chatTools(thread)?.web === true && this.webRoute(thread) === "provider";
    const edited = new Set<string>(); // code files changed since the last command
    let nudged = false;
    let cutCalls = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      abort.signal.throwIfAborted();
      if (step > 0) this.takeSteered(active);
      await this.maybeCompact(active, model, provider, system, false);
      const { blocks, stop, detail } = await this.streamStep(active, model, provider, system, tools, webSearch);
      if (blocks.length) this.store.appendMessage(threadId, { role: "assistant", content: blocks });

      if (stop === "refusal") throw new Error(`Modellen avslo forespørselen${detail ? `: ${detail}` : ""}`);
      const calls = blocks.filter((b) => b.type === "tool_use");
      if (thread.planMode && !calls.length) {
        const plan = blocksText(blocks).trim();
        if (plan) {
          this.store.updateThread(threadId, { plan: plan.slice(0, 8000) });
          this.deps.threadChanged(threadId);
        }
      }
      if (stop === "max_tokens") {
        // A cut-off tool call must not run. Its result still has to be in the history. The model
        // gets one more go with smaller pieces, since that is usually a write that was too big.
        const message = "Svaret ble kuttet fordi det nådde grensen for utdata, så verktøyet ble ikke kjørt. Del arbeidet i mindre biter: flere edit_file-kall i stedet for én stor write_file.";
        for (const call of calls) this.addToolResult(threadId, call.id, message, true);
        if (!calls.length || ++cutCalls > MAX_CUT_CALLS) throw new Error("Svaret ble kuttet fordi modellen nådde grensen for utdata");
        continue;
      }
      // The provider paused a long turn of its own tools (web search): it goes on from here.
      if (stop === "pause" && !calls.length) continue;
      if (!calls.length) {
        // A message the user sent into the turn arrived while the model was writing.
        if (this.takeSteered(active)) continue;
        // Code changed and nothing run since: ask once for a check, when the project has one.
        const changed = [...edited].filter((file) => !PROSE.test(file));
        if (!nudged && checks.length && changed.length && offered.has("run_command") && this.harness.state().parts.verify !== false) {
          nudged = true;
          this.store.appendMessage(threadId, {
            role: "user",
            content: [{
              type: "text",
              text: `[Automatic reminder from Agentic Desktop, not from the user] You changed ${changed.slice(0, 5).join(", ")}${changed.length > 5 ? " and more" : ""} but ran nothing after. ` +
                `Run the relevant check now (${checks.map((c) => `\`${c}\``).join(", ")}) and fix what fails, then give your summary again. If no check applies to this change, say so in one sentence.`,
            }],
          });
          continue;
        }
        return;
      }

      // Read-only calls next to each other run at the same time; everything else one by one.
      for (let i = 0; i < calls.length; ) {
        let j = i + 1;
        if (PARALLEL_TOOLS.has(this.toolName(calls[i].name) ?? "")) {
          while (j < calls.length && PARALLEL_TOOLS.has(this.toolName(calls[j].name) ?? "")) j++;
        }
        const group = calls.slice(i, j);
        const results = await Promise.all(group.map(async (call) => {
          if (abort.signal.aborted) return { result: { text: "Avbrutt av brukeren.", isError: true }, status: "cancelled" as ToolStatus };
          return chat ? this.runChatTool(active, thread, call, offered) : this.runTool(active, thread, project!, skills, call, offered);
        }));
        group.forEach((call, k) => {
          const { result, status } = results[k];
          this.store.appendMessage(threadId, {
            role: "user",
            content: [{ type: "tool_result", toolUseId: call.id, content: result.text, isError: result.isError, image: result.image }],
          });
          const name = this.toolName(call.name);
          if (status === "done" && name && EDIT_TOOLS.has(name) && typeof (call.input as any)?.path === "string") edited.add((call.input as any).path);
          if (name === "run_command" && (status === "done" || status === "error")) edited.clear();
        });
        i = j;
      }
    }
    throw new Error(`Grensen på ${MAX_STEPS} steg er nådd`);
  }

  private toolName(name: string): string | undefined {
    return resolveToolName(name, TOOLS_BY_NAME.keys()) ?? (TOOL_ALIASES[name.toLowerCase()] && !TOOLS_BY_NAME.has(name) ? TOOL_ALIASES[name.toLowerCase()] : undefined);
  }

  private addToolResult(threadId: string, toolUseId: string, content: string, isError: boolean): void {
    this.store.appendMessage(threadId, { role: "user", content: [{ type: "tool_result", toolUseId, content, isError }] });
  }

  private async streamStep(
    active: ActiveRun,
    model: ModelConfig,
    provider: Provider,
    system: string,
    tools: ToolDef[],
    webSearch = false,
  ): Promise<{ blocks: Block[]; stop: StopReason; detail?: string }> {
    const { threadId, runId, abort } = active;
    let strippedThinking = false;
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const blocks: Block[] = [];
      const messageId = randomUUID();
      let stop: StopReason = "end";
      let detail: string | undefined;
      let emitted = false;
      let thinking: { blockId: string; startedAt: number } | undefined;
      let usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | undefined;
      const searches = new Map<string, number>(); // the provider's own web searches in this step, by id
      const searchStarted = (id: string, query: string) => {
        if (searches.has(id)) return;
        searches.set(id, Date.now());
        this.log.append(threadId, { type: "tool.started", runId, callId: id, tool: "web_search", summary: query, input: { query }, status: "running" });
      };

      const endThinking = () => {
        if (!thinking) return;
        this.log.append(threadId, { type: "thinking.done", runId, blockId: thinking.blockId, durationMs: Date.now() - thinking.startedAt });
        thinking = undefined;
      };

      try {
        const messages = this.store.messages(threadId);
        for await (const part of provider.stream({ model, system, messages, tools, signal: abort.signal, ...(webSearch ? { webSearch } : {}) })) {
          abort.signal.throwIfAborted();
          switch (part.type) {
            case "thinking": {
              emitted = true;
              let block = blocks.at(-1);
              if (block?.type !== "thinking" || block.signature) {
                block = { type: "thinking", text: "", ...(part.field ? { field: part.field } : {}) };
                blocks.push(block);
                endThinking();
              }
              block.text += part.text;
              thinking ??= { blockId: randomUUID(), startedAt: Date.now() };
              this.log.delta(threadId, { type: "thinking.delta", runId, blockId: thinking.blockId, text: part.text });
              break;
            }
            case "thinking_signature": {
              const block = blocks.at(-1);
              if (block?.type === "thinking") block.signature = part.signature;
              break;
            }
            case "redacted_thinking":
              blocks.push({ type: "redacted_thinking", data: part.data });
              break;
            case "text": {
              emitted = true;
              endThinking();
              let block = blocks.at(-1);
              if (block?.type !== "text") blocks.push((block = { type: "text", text: "" }));
              block.text += part.text;
              this.log.delta(threadId, { type: "text.delta", runId, messageId, text: part.text });
              break;
            }
            case "tool_call":
              emitted = true;
              endThinking();
              blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.input, ...(part.parseError ? { parseError: part.parseError } : {}) });
              break;
            case "usage":
              usage = part;
              break;
            case "web_search":
              emitted = true;
              endThinking();
              searchStarted(part.id, part.query);
              break;
            case "web_results": {
              emitted = true;
              searchStarted(part.id, part.query ?? "");
              this.log.append(threadId, {
                type: "tool.finished",
                runId,
                callId: part.id,
                status: part.error ? "error" : "done",
                result: part.error ?? sourcesText(part.query ?? "", part.sources),
                durationMs: Date.now() - searches.get(part.id)!,
                sources: part.sources,
              });
              break;
            }
            case "provider_block":
              blocks.push({ type: "provider", provider: part.provider, data: part.data });
              break;
            case "stop":
              stop = part.reason;
              detail = part.detail;
              break;
          }
        }
        endThinking();
        if (usage) this.recordUsage(active, model, usage);
        return { blocks, stop, detail };
      } catch (err) {
        endThinking();
        this.log.flush(threadId);
        if (abort.signal.aborted) {
          // Keep what was said, without calls that never completed.
          const partial = blocks.filter((b) => b.type === "text" && b.text);
          if (partial.length) this.store.appendMessage(threadId, { role: "assistant", content: partial });
          throw err;
        }
        if (err instanceof ProviderError) {
          // Signed thinking no longer matches, for example after AGENTS.md changed.
          if (err.status === 400 && /signature|thinking/i.test(err.message) && !strippedThinking && !emitted) {
            strippedThinking = true;
            this.store.replaceMessages(threadId, stripThinking(this.store.messages(threadId)));
            continue;
          }
          if (err.retryable && !emitted && attempt < MAX_RETRIES) {
            const waitMs = Math.max(0, err.retryAfterMs ?? this.deps.retryBaseMs * 2 ** attempt);
            if (waited + waitMs > MAX_RETRY_WAIT_MS) {
              throw new ProviderError(
                `${err.message}. Leverandøren ber om ${Math.ceil(waitMs / 1000)} s venting før neste forsøk, og appen venter høyst ${MAX_RETRY_WAIT_MS / 1000} s. Prøv igjen senere.`,
                { status: err.status, retryable: false },
              );
            }
            waited += waitMs;
            // The thread says what it waits for, so a long wait is not silent.
            this.log.append(threadId, { type: "run.retrying", runId, attempt: attempt + 1, maxAttempts: MAX_RETRIES, waitMs, reason: err.message });
            await abortable(waitMs, abort.signal);
            continue;
          }
        }
        // Keep partial text here too, so a later message has the context.
        const partial = blocks.filter((b) => b.type === "text" && b.text);
        if (partial.length) this.store.appendMessage(threadId, { role: "assistant", content: partial });
        throw err;
      }
    }
  }

  private recordUsage(active: ActiveRun, model: ModelConfig, part: { inputTokens: number; outputTokens: number; cachedInputTokens: number }): void {
    const { threadId, runId, projectId } = active;
    const usage = addUsage(this.store.usage(threadId), part, model);
    this.store.setUsage(threadId, usage);
    this.log.append(threadId, { type: "usage", runId, usage });
    if (projectId) this.deps.usageChanged(projectId);
  }

  // Tools

  private async runTool(
    active: ActiveRun,
    thread: Thread,
    project: Project,
    skills: Skill[],
    original: ToolCall,
    offered?: Set<string>,
  ): Promise<{ result: ToolResult; status: ToolStatus }> {
    const { threadId, runId, abort } = active;
    const startedAt = Date.now();
    // Forgiving about the name and the types, strict about the rest: see args.ts.
    const resolved = this.toolName(original.name);
    const call: ToolCall = { ...original, name: resolved ?? original.name };
    const tool = resolved ? TOOLS_BY_NAME.get(resolved) : undefined;
    if (tool && !call.parseError && call.input && typeof call.input === "object" && !Array.isArray(call.input)) {
      call.input = coerceArgs(call.input, tool.def.parameters);
    }
    const finish = (status: ToolStatus, result: ToolResult) => {
      this.log.append(threadId, {
        type: "tool.finished",
        runId,
        callId: call.id,
        status,
        result: result.text,
        durationMs: Date.now() - startedAt,
        ...(result.screenshotId ? { screenshotId: result.screenshotId } : {}),
        ...(result.sources ? { sources: result.sources } : {}),
      });
      return { result, status };
    };

    const available = offered ?? new Set(TOOLS_BY_NAME.keys());
    const missing = tool ? (tool.def.parameters.required as string[]).filter((field) => call.input?.[field] === undefined || call.input?.[field] === null) : [];
    const problem = !tool || (offered && !available.has(tool.def.name) && !(thread.planMode && !READ_ONLY_TOOLS.has(tool.def.name)))
      ? `Ukjent verktøy: ${original.name}. Verktøyene du har: ${[...available].join(", ")}.`
      : thread.planMode && !READ_ONLY_TOOLS.has(call.name)
      ? `Planmodus er på, så ${call.name} er ikke tilgjengelig. Svar med en plan.`
      : call.parseError
      ? `${call.parseError}\nForventet for ${call.name}: ${describeParams(tool.def.parameters)}`
      : missing.length
      ? `Mangler påkrevde felt: ${missing.join(", ")}. Forventet for ${call.name}: ${describeParams(tool.def.parameters)}`
      : undefined;
    if (!tool || problem) {
      active.mistakes++;
      const hint = active.mistakes >= MISTAKE_HINT_AT
        ? `\n\nDette er ${active.mistakes}. ugyldige verktøykall på rad. Stopp og tenk: bruk bare verktøyene over, send argumentene som ett gyldig JSON-objekt, eller svar brukeren med tekst.`
        : "";
      this.log.append(threadId, { type: "tool.started", runId, callId: call.id, tool: call.name, summary: "", input: call.input, status: "running" });
      return finish("error", { text: problem! + hint, isError: true });
    }
    active.mistakes = 0;

    const ctx: ToolContext = {
      thread,
      project,
      runId,
      turnId: active.turnId,
      signal: abort.signal,
      dataDir: this.deps.dataDir,
      turns: this.deps.turns,
      files: this.files,
      browser: this.deps.browser,
      collab: this.collab,
      tasks: this.deps.tasks,
      env: this.deps.env,
      commandTimeoutMs: this.deps.commandTimeoutMs,
      skills: () => skills,
      output: this.outputWriter(active, call.id),
      filesChanged: (paths) => this.deps.filesChanged(project.id, paths),
      saveScreenshot: (png) => this.saveScreenshot(png),
      web: call.name === "web_search" ? this.codeWeb(thread) : undefined,
      memories: this.memoriesOn() ? this.memories : undefined,
      maxResultChars: resultBudget(this.resolveModelSafe(thread)),
      skillStore: this.skillStore,
      autoSkills: this.autoSkills(),
      setPlan: (text) => {
        this.store.updateThread(threadId, { plan: text });
        this.deps.threadChanged(threadId);
      },
    };

    const summary = tool.summary(call.input, ctx);
    const decision = decide(tool, call.input, project, thread, this.store, this.deps.dataDir);
    // A tool that must always ask (a new skill from the agent), in every mode and never "always".
    const confirm = tool.confirm?.(call.input, ctx);
    if (confirm) Object.assign(decision, { ask: true, canAllowAlways: false, rule: undefined, reason: confirm.detail });
    const key = `${call.name}:${JSON.stringify(call.input)}`;
    active.lastCall = active.lastCall.key === key ? { key, count: active.lastCall.count + 1 } : { key, count: 1 };
    const looping = active.lastCall.count >= DOOM_LIMIT;
    const overBudget = (call.name === "thread_create" || call.name === "thread_send") && this.collab.overBudget(active.job.chainId);
    const asks = decision.ask || looping || overBudget;

    this.log.append(threadId, {
      type: "tool.started",
      runId,
      callId: call.id,
      tool: call.name,
      summary,
      input: call.input,
      status: asks ? "awaiting-approval" : "running",
    });

    if (asks) {
      const title = overBudget
        ? "Trådene har sendt 20 meldinger til hverandre. Fortsette?"
        : looping
          ? "Samme verktøykall er gjentatt tre ganger. Fortsette?"
          : confirm
            ? confirm.title
            : `${call.name}: ${summary}`;
      const detail = decision.reason ?? (call.name === "run_command" ? String(call.input.command) : JSON.stringify(call.input, null, 2));
      const canAllowAlways = decision.canAllowAlways && !looping && !overBudget;
      const answer = await this.askApproval(active, call.id, title, clip(detail, 4000), canAllowAlways);
      if (answer === "cancelled") return finish("cancelled", { text: "Avbrutt av brukeren.", isError: true });
      if (answer === "deny") return finish("denied", { text: "Brukeren avslo dette verktøykallet.", isError: true });
      if (answer === "allow-always" && canAllowAlways && decision.rule) {
        this.store.allow(project.id, decision.rule.kind, decision.rule.value);
      }
      if (looping) active.lastCall.count = 0;
      if (overBudget) this.collab.grant(active.job.chainId);
    }

    try {
      // run_command stops itself and kills its group. Other tools, such as a page that never
      // loads, must not hold up Stop.
      const running = tool.run(call.input, ctx);
      const raw = call.name === "run_command" ? await running : await Promise.race([running, rejectOnAbort(abort.signal)]);
      // No single result may crowd out the conversation in a small context window.
      const result = { ...raw, text: clip(raw.text, ctx.maxResultChars) };
      if (abort.signal.aborted) return finish("cancelled", result);
      return finish(result.isError ? "error" : "done", result);
    } catch (err) {
      if (abort.signal.aborted) return finish("cancelled", { text: "Avbrutt av brukeren.", isError: true });
      return finish("error", { text: (err as Error).message || "Verktøyet feilet", isError: true });
    }
  }

  // Round 13 (SPEC 27.2): a chat's tools. They only read the web, so nothing asks first; the
  // switches in the chat's tool menu are the permission.
  private async runChatTool(active: ActiveRun, thread: Thread, call: ToolCall, offered: Set<string>): Promise<{ result: ToolResult; status: ToolStatus }> {
    const { threadId, runId, abort } = active;
    const startedAt = Date.now();
    const tool = [webSearchTool, webFetchTool].find((t) => t.def.name === call.name && offered.has(t.def.name));
    const input = tool && call.input && typeof call.input === "object" && !Array.isArray(call.input) ? coerceArgs(call.input, tool.def.parameters) : call.input;
    const web = call.name === "web_search" ? this.webAccess(this.webRoute(thread)) : this.deps.web ? browserWeb(this.deps.web, undefined) : undefined;
    const ctx = { thread, runId, signal: abort.signal, web, maxResultChars: resultBudget(this.resolveModelSafe(thread)) } as unknown as ToolContext;
    const finish = (status: ToolStatus, result: ToolResult) => {
      this.log.append(threadId, {
        type: "tool.finished", runId, callId: call.id, status, result: result.text, durationMs: Date.now() - startedAt,
        ...(result.sources ? { sources: result.sources } : {}),
      });
      return { result, status };
    };
    const problem = !tool
      ? `Ukjent verktøy: ${call.name}. Verktøyene du har: ${[...offered].join(", ") || "ingen"}.`
      : call.parseError ?? (!input || typeof input !== "object" ? `Forventet for ${call.name}: ${describeParams(tool.def.parameters)}` : undefined);
    this.log.append(threadId, { type: "tool.started", runId, callId: call.id, tool: call.name, summary: tool && !problem ? tool.summary(input, ctx) : "", input, status: "running" });
    if (!tool || problem) return finish("error", { text: problem!, isError: true });
    try {
      const raw = await Promise.race([tool.run(input, ctx), rejectOnAbort(abort.signal)]);
      return finish(raw.isError ? "error" : "done", raw);
    } catch (err) {
      if (abort.signal.aborted) return finish("cancelled", { text: "Avbrutt av brukeren.", isError: true });
      return finish("error", { text: (err as Error).message || "Verktøyet feilet", isError: true });
    }
  }

  private outputWriter(active: ActiveRun, callId: string): (text: string) => void {
    let written = 0;
    let capped = false;
    return (text) => {
      if (capped) return;
      written += text.length;
      if (written > MAX_OUTPUT_EVENT_CHARS) {
        capped = true;
        text = "\n[Utdata avkortet i visningen]\n";
      }
      this.log.delta(active.threadId, { type: "tool.output", runId: active.runId, callId, text });
    };
  }

  private saveScreenshot(png: Buffer): string {
    const id = randomUUID();
    const dir = path.join(this.deps.dataDir, "screenshots");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dir, `${id}.png`), png, { mode: 0o600, flag: "wx" }); // a new file, never through a link
    return id;
  }

  private askApproval(active: ActiveRun, callId: string, title: string, detail: string, canAllowAlways: boolean): Promise<ApprovalDecision | "cancelled"> {
    const { threadId, runId, abort } = active;
    const approvalId = randomUUID();
    this.log.append(threadId, { type: "approval.requested", runId, approvalId, callId, title, detail, canAllowAlways });
    return new Promise((resolve) => {
      const settle = (decision: ApprovalDecision | "cancelled") => {
        abort.signal.removeEventListener("abort", onAbort);
        this.approvals.delete(approvalId);
        this.log.append(threadId, { type: "approval.resolved", runId, approvalId, decision: decision === "cancelled" ? "deny" : decision });
        this.deps.threadChanged(threadId);
        resolve(decision);
      };
      const onAbort = () => settle("cancelled");
      abort.signal.addEventListener("abort", onAbort, { once: true });
      this.approvals.set(approvalId, { threadId, settle });
      this.deps.threadChanged(threadId);
    });
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new HttpError(404, "Godkjenningen finnes ikke lenger");
    pending.settle(decision);
  }

  private async runShell(active: ActiveRun): Promise<void> {
    const thread = this.store.thread(active.threadId)!;
    const project = this.store.project(thread.projectId!)!;
    const command = active.job.shell!;
    const callId = randomUUID();
    const { result, status } = await this.runTool(active, thread, project, [], { id: callId, name: "run_command", input: { command } });
    const text = status === "denied"
      ? `Brukeren prøvde å kjøre \`${command}\`, men avslo det.`
      : `Brukeren kjørte \`${command}\` i prosjektmappen:\n\n\`\`\`\n${result.text}\n\`\`\``;
    this.store.appendMessage(thread.id, { role: "user", content: [{ type: "text", text }] });
    active.abort.signal.throwIfAborted();
  }

  // Compaction

  private async compactNow(active: ActiveRun, model: ModelConfig): Promise<void> {
    const thread = this.store.thread(active.threadId)!;
    const project = thread.projectId ? this.store.project(thread.projectId) : undefined;
    const system = this.systemPrompt(thread, project, this.skillsFor(project), true);
    await this.maybeCompact(active, model, this.deps.provider(model), system, true);
  }

  private async maybeCompact(active: ActiveRun, model: ModelConfig, provider: Provider, system: string, force: boolean): Promise<void> {
    const { threadId, runId, abort } = active;
    let messages = this.store.messages(threadId);
    const usage = this.store.usage(threadId);
    const before = Math.max(estimateTokens(system, messages), usage.contextTokens);
    if (!force && before <= model.contextWindow * COMPACT_AT) return;

    // First the cheap step: old tool results go. Then a summary, if that was not enough.
    const startTokens = estimateTokens(system, messages);
    let next = compactToolResults(messages, model.contextWindow);
    if (force || overTarget(system, next, model.contextWindow)) {
      const cut = force ? next.length : summaryCut(next, model.contextWindow);
      if (cut > 0 && (force || cut < next.length)) {
        const summary = await this.summarize(active, model, provider, next.slice(0, cut));
        if (summary) {
          next = [{ role: "user", content: [{ type: "text", text: `[Sammendrag av tidligere samtale]\n\n${summary}` }] }, ...next.slice(cut)];
        }
      }
    }
    // Nothing gained means nothing rewritten: a rewrite costs the signed thinking and the cache.
    const after = estimateTokens(system, next);
    if (!force && after >= startTokens) return;
    messages = stripThinking(next);
    this.store.replaceMessages(threadId, messages);
    this.store.setUsage(threadId, { ...this.store.usage(threadId), contextTokens: after });
    this.log.append(threadId, { type: "context.compacted", runId, beforeTokens: before, afterTokens: after });
    abort.signal.throwIfAborted();
  }

  private async summarize(active: ActiveRun, model: ModelConfig, provider: Provider, messages: Message[]): Promise<string | null> {
    const transcript = renderTranscript(messages).slice(-model.contextWindow * 3);
    let text = "";
    try {
      for await (const part of provider.stream({
        model,
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: transcript }] }],
        tools: [],
        signal: active.abort.signal,
        purpose: "summary",
      })) {
        if (part.type === "text") text += part.text;
        if (part.type === "usage") this.recordUsage(active, model, part);
      }
    } catch (err) {
      if (active.abort.signal.aborted) throw err;
      return null; // The cheap step already helped, and the run can go on without a summary.
    }
    return text.trim() || null;
  }

  // Stop and undo

  stop(threadId: string): boolean {
    const active = this.active.get(threadId);
    if (!active) return false;
    active.abort.abort(new DOMException("Stoppet", "AbortError"));
    return true;
  }

  stopProject(projectId: string): number {
    const runs = [...this.active.values()].filter((run) => run.projectId === projectId);
    for (const run of runs) run.abort.abort(new DOMException("Stoppet", "AbortError"));
    return runs.length;
  }

  revertTurn(turnId: string, force: boolean): void {
    const turn = this.store.turnThread(turnId);
    if (!turn) throw new HttpError(404, "Fant ikke turen");
    if (turn.revertedAt) throw new HttpError(409, "Turen er allerede angret");
    const thread = this.store.thread(turn.threadId);
    const project = thread?.projectId ? this.store.project(thread.projectId) : undefined;
    if (!thread || !project) throw new HttpError(404, "Fant ikke prosjektet");
    if (this.active.has(thread.id)) throw new HttpError(409, "Tråden kjører");
    const paths = this.deps.turns.revert(turnId, project.path, force);
    this.store.markTurnReverted(turnId);
    this.store.appendMessage(thread.id, { role: "user", content: [{ type: "text", text: `[Brukeren angret filendringene fra en tidligere tur: ${paths.join(", ")}]` }] });
    this.log.append(thread.id, { type: "turn.reverted", turnId });
    this.deps.filesChanged(project.id, paths);
  }

  // Lifecycle

  // Marks what was running when the server last stopped. Interrupted tool calls are not run again.
  recover(): void {
    for (const run of this.store.activeRuns()) {
      const thread = this.store.thread(run.threadId);
      if (!thread) continue;
      const started = new Map<string, boolean>();
      const asked = new Set<string>();
      for (const { event } of this.store.events(run.threadId, run.startSeq - 1, 1_000_000)) {
        if (!("runId" in event) || event.runId !== run.id) continue;
        if (event.type === "tool.started") started.set(event.callId, true);
        if (event.type === "tool.finished") started.delete(event.callId);
        if (event.type === "approval.requested") asked.add(event.approvalId);
        if (event.type === "approval.resolved") asked.delete(event.approvalId);
      }
      for (const approvalId of asked) this.log.append(run.threadId, { type: "approval.resolved", runId: run.id, approvalId, decision: "deny" });
      for (const callId of started.keys()) {
        this.log.append(run.threadId, { type: "tool.finished", runId: run.id, callId, status: "cancelled", result: "Avbrutt av omstart. Kjøres ikke på nytt.", durationMs: 0 });
      }
      this.repairHistory(run.threadId);
      this.finishTurn(thread, run.id, run.turnId);
      this.store.finishRun(run.id, "interrupted");
      this.log.append(run.threadId, { type: "run.finished", runId: run.id, status: "interrupted" });
    }
    for (const threadId of this.store.queuedThreads()) {
      const thread = this.store.thread(threadId);
      if (thread) this.drainQueue(thread);
    }
  }

  // Every tool call needs a result before the conversation can continue.
  private repairHistory(threadId: string): void {
    const messages = this.store.messages(threadId);
    const answered = new Set<string>();
    for (const message of messages) {
      for (const block of message.content) if (block.type === "tool_result") answered.add(block.toolUseId);
    }
    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === "tool_use" && !answered.has(block.id)) {
          this.addToolResult(threadId, block.id, "Avbrutt av omstart. Ble ikke fullført.", true);
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    const runs = [...this.active.values()];
    for (const run of runs) {
      run.shuttingDown = true;
      run.abort.abort(new DOMException("Serveren stopper", "AbortError"));
    }
    while (this.active.size) await new Promise((resolve) => setTimeout(resolve, 10));
    this.log.flushAll();
  }
}

// A fifth of the context window, at about four characters a token, and never more than the tools' own cap.
function resultBudget(model: ModelConfig | undefined): number {
  return Math.max(2000, Math.min(MAX_RESULT_CHARS, Math.floor((model?.contextWindow ?? 128_000) * 4 * 0.2)));
}

function userContent(text: string, job: Job): Block[] {
  return [{ type: "text", text }, ...(job.images ?? []).map((i): Block => ({ type: "image", image: i.image, name: i.name }))];
}

function optional(job: Job): { from?: ThreadRef; attachments?: Attachment[] } {
  return {
    ...(job.from ? { from: job.from } : {}),
    ...(job.attachments?.length ? { attachments: job.attachments } : {}),
  };
}
