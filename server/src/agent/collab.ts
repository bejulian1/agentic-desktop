// Threads working together: the thread_* tools and their brakes. These are visible threads the
// user can open and take over. The brakes are not optional, since collaboration can otherwise
// run away and get expensive.
import type { Project, Thread, ThreadRef } from "../../../shared/protocol.ts";
import type { Store } from "../db.ts";
import type { EventLog } from "./events.ts";
import { effectiveMode } from "./permissions.ts";
import { blocksText } from "./context.ts";
import { clip, type CollabTools, type ToolResult } from "./tools.ts";

export const MAX_DEPTH = 2;
export const MAX_AGENT_THREADS = 4;
export const MAX_THREAD_MESSAGES = 20;
const DEFAULT_WAIT_S = 120;
const MAX_WAIT_S = 600;

export interface CollabHost {
  sendFromThread(threadId: string, text: string, from: ThreadRef, chainId: string): void;
  chainOf(threadId: string): string;
  runningAgentThreads(projectId: string): number;
  hasAgentSlot(threadId: string): boolean;
  isBusy(threadId: string): boolean;
  waitIdle(threadId: string, timeoutMs: number, signal: AbortSignal, requestingThreadId?: string): Promise<boolean>;
  hasIncomingMessage?(threadId: string): boolean;
  threadChanged(threadId: string): void;
}

function fail(text: string): ToolResult {
  return { text, isError: true };
}

export class Collab implements CollabTools {
  private store: Store;
  private log: EventLog;
  private host: CollabHost;
  private sent = new Map<string, number>(); // messages between threads, per user message

  constructor(store: Store, log: EventLog, host: CollabHost) {
    this.store = store;
    this.log = log;
    this.host = host;
  }

  overBudget(chainId: string): boolean {
    return (this.sent.get(chainId) ?? 0) >= MAX_THREAD_MESSAGES;
  }

  grant(chainId: string): void {
    this.sent.set(chainId, 0);
  }

  private count(chainId: string): void {
    this.sent.set(chainId, (this.sent.get(chainId) ?? 0) + 1);
  }

  depth(thread: Thread): number {
    let depth = 0;
    let current: Thread | undefined = thread;
    while (current?.origin === "agent" && current.parentThreadId) {
      depth++;
      current = this.store.thread(current.parentThreadId);
    }
    return depth;
  }

  private peer(thread: Thread, id: unknown): Thread | ToolResult {
    const other = typeof id === "string" ? this.store.thread(id) : undefined;
    if (!other || other.projectId !== thread.projectId) return fail(`Fant ingen tråd med id ${String(id)} i dette prosjektet`);
    if (other.id === thread.id) return fail("Det er denne tråden");
    return other;
  }

  private hasAncestor(thread: Thread, ancestorId: string): boolean {
    const visited = new Set<string>([thread.id]);
    let parentId = thread.parentThreadId;
    while (parentId && !visited.has(parentId)) {
      const parent = this.store.thread(parentId);
      if (!parent || parent.projectId !== thread.projectId) return false;
      if (parent.id === ancestorId) return true;
      visited.add(parent.id);
      parentId = parent.parentThreadId;
    }
    return false;
  }

  list(thread: Thread): string {
    const threads = this.store.projectThreads(thread.projectId!).filter((t) => !t.archived);
    return threads
      .map((t) => {
        const status = t.pendingApprovals ? "venter på godkjenning" : t.running ? "kjører" : "ledig";
        const marks = [t.id === thread.id ? "denne tråden" : "", t.origin === "agent" ? "laget av agent" : "",
          t.parentThreadId ? `overordnet: ${t.parentThreadId}` : "ingen overordnet"].filter(Boolean).join(", ");
        return `${t.id}  ${status}  ${JSON.stringify(t.title)}${marks ? `  (${marks})` : ""}`;
      })
      .join("\n");
  }

  create(thread: Thread, runId: string, input: { title: string; task: string; model?: string }): ToolResult {
    const project = this.store.project(thread.projectId!) as Project;
    if (this.depth(thread) >= MAX_DEPTH) return fail(`Grensen er nådd: tråder kan ikke lages dypere enn ${MAX_DEPTH} nivåer`);
    if (this.host.runningAgentThreads(project.id) >= MAX_AGENT_THREADS) {
      return fail(`Grensen er nådd: ${MAX_AGENT_THREADS} tråder har agentarbeid som kjører eller venter i kø i prosjektet. Vent på en av dem.`);
    }
    const title = String(input.title ?? "").trim().slice(0, 120);
    const task = String(input.task ?? "").trim();
    if (!title || !task) return fail("title og task må fylles ut");
    const parentModelId = thread.modelId ?? this.store.settings().defaultModelId;
    const modelId = input.model ?? parentModelId ?? null;
    if (input.model && !this.store.model(input.model)) return fail(`Fant ingen modell med id ${input.model}`);

    const child = this.store.createThread(project.id, "code", modelId, {
      title,
      parentThreadId: thread.id,
      permissionCap: effectiveMode(project, thread), // Never above the thread that made it.
    });
    // The parent's per-thread effort overrides its model default. A helper on the same model
    // should keep that choice; an explicitly different model keeps its own effort setting.
    if (modelId === parentModelId && thread.reasoning) this.store.updateThread(child.id, { reasoning: thread.reasoning });
    const chainId = this.host.chainOf(thread.id);
    this.count(chainId);
    this.log.append(thread.id, { type: "thread.spawned", runId, childThreadId: child.id, title });
    this.host.threadChanged(child.id);
    this.host.sendFromThread(child.id, task, { threadId: thread.id, title: thread.title }, chainId);
    return { text: `Tråden ${JSON.stringify(title)} er startet. tråd-id: ${child.id}` };
  }

  send(thread: Thread, _runId: string, input: { threadId: string; text: string }): ToolResult {
    const other = this.peer(thread, input.threadId);
    if ("text" in other) return other;
    if (other.archived) return fail("Tråden er arkivert");
    const text = String(input.text ?? "").trim();
    if (!text) return fail("text må fylles ut");
    const busy = this.host.isBusy(other.id);
    // A reply to a running ancestor joins that ancestor's current run. It does not launch
    // another helper or reserve a queued run, even when all helper slots are occupied.
    const ancestorReply = busy && this.hasAncestor(thread, other.id);
    // A busy user-started thread also needs a slot: this message will start an agent run
    // when its current work ends. An already reserved recipient may keep receiving messages.
    if (!ancestorReply && !this.host.hasAgentSlot(other.id) && this.host.runningAgentThreads(thread.projectId!) >= MAX_AGENT_THREADS) {
      return fail(`Grensen er nådd: ${MAX_AGENT_THREADS} tråder har agentarbeid som kjører eller venter i kø i prosjektet. Vent på en av dem.`);
    }
    const chainId = this.host.chainOf(thread.id);
    this.count(chainId);
    this.host.sendFromThread(other.id, text, { threadId: thread.id, title: thread.title }, chainId);
    return { text: ancestorReply ? "Meldingen er sendt inn i den overordnede trådens pågående arbeid." : busy ? "Tråden jobber, så meldingen ligger i kø." : "Meldingen er sendt." };
  }

  read(thread: Thread, input: { threadId: string; limit?: number }): ToolResult {
    const other = this.peer(thread, input.threadId);
    if ("text" in other) return other;
    const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 50);
    const lines = this.store.messages(other.id)
      .map((m) => ({ role: m.role, text: blocksText(m.content) }))
      .filter((m) => m.text)
      .slice(-limit)
      .map((m) => `${m.role === "user" ? "Bruker" : "Assistent"}: ${m.text}`);
    return { text: clip(lines.join("\n\n")) || "(ingen meldinger)" };
  }

  finalAnswer(threadId: string): string {
    const last = this.store.messages(threadId).findLast((m) => m.role === "assistant" && blocksText(m.content));
    return last ? blocksText(last.content) : "";
  }

  async wait(thread: Thread, input: { threadId: string; timeoutSeconds?: number }, signal: AbortSignal): Promise<ToolResult> {
    const other = this.peer(thread, input.threadId);
    if ("text" in other) return other;
    const seconds = Math.min(Math.max(Number(input.timeoutSeconds ?? DEFAULT_WAIT_S), 1), MAX_WAIT_S);
    const idle = await this.host.waitIdle(other.id, seconds * 1000, signal, thread.id);
    if (!idle && this.host.hasIncomingMessage?.(thread.id)) {
      return { text: "Ventingen ble avbrutt fordi denne tråden har fått en ny melding. Den andre tråden er ikke ferdig; behandle meldingen før du eventuelt venter igjen." };
    }
    if (!idle) return fail(`Tidsavbrudd: tråden var ikke ferdig etter ${seconds} s`);
    const run = this.store.lastRun(other.id);
    const answer = clip(this.finalAnswer(other.id)) || "(tråden svarte ikke med tekst)";
    if (run && run.status !== "done") return { text: `Tråden stoppet med status ${run.status}. ${run.error ?? ""}\n\n${answer}`.trim(), isError: true };
    return { text: answer };
  }
}
