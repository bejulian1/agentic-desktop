// Threads working together: the thread_* tools and their brakes. These are visible threads the
// user can open and take over. The brakes are not optional, since collaboration can otherwise
// run away and get expensive.
import type { ModelConfig, Thread, ThreadRef } from "../../../shared/protocol.ts";
import type { Store } from "../db.ts";
import type { EventLog } from "./events.ts";
import { effectiveMode } from "./permissions.ts";
import { blocksText } from "./context.ts";
import { clip, MAX_RESULT_CHARS, type CollabTools, type ToolResult } from "./tools.ts";

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

  models(query: unknown = "", offset: unknown = 0, maxChars = MAX_RESULT_CHARS): ToolResult {
    if (typeof query !== "string" || typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
      return fail("Bruk tekst som søk og et heltall fra 0 og oppover som offset.");
    }
    const search = query.trim().toLowerCase();
    const providers = new Map(this.store.providers().map(p => [p.id, p.name]));
    const matches = this.store.models().map(m => ({
      id: m.id, name: m.name, model: m.model, provider: providers.get(m.providerId),
    })).filter(m => m.provider !== undefined && [m.name, m.model, m.provider].some(value => value?.toLowerCase().includes(search)));
    const label = (value: string) => value.replace(/[\u0000-\u001f]/g, " ").slice(0, 160);
    const models = matches.slice(offset, offset + 12).map(m => ({ id: m.id, name: label(m.name), model: label(m.model), provider: label(m.provider!) }));
    const encode = () => JSON.stringify({ models, nextOffset: offset + models.length < matches.length ? offset + models.length : null });
    while (models.length > 1 && encode().length > maxChars) models.pop();
    if (encode().length > maxChars) return fail("Modellen har for lite plass i konteksten til å vise dette treffet.");
    return { text: encode() };
  }

  modelChoice(requested: unknown, parentModelId: string): ModelConfig | ToolResult {
    let model = this.store.model(parentModelId);
    if (requested !== undefined) {
      if (typeof requested !== "string" || !requested.trim()) return fail("Velg en modell fra thread_models.");
      const wanted = requested.trim();
      model = this.store.model(wanted);
      if (!model) {
        const key = wanted.toLowerCase();
        const matches = this.store.models().filter(m => m.name.toLowerCase() === key || m.model.toLowerCase() === key);
        if (matches.length > 1) return fail("Flere modeller passer. Bruk thread_models og velg nøyaktig id for riktig leverandør.");
        model = matches[0];
      }
    }
    if (!model || !this.store.provider(model.providerId)) return fail("Fant ingen modell for dette valget. Bruk thread_models for å se de konfigurerte modellene.");
    return model;
  }

  create(thread: Thread, runId: string, parentModelId: string, input: { title: string; task: string; model: string }): ToolResult {
    const currentThread = this.store.thread(thread.id);
    const project = currentThread?.projectId ? this.store.project(currentThread.projectId) : undefined;
    if (!currentThread || currentThread.archived || currentThread.planMode || !project || project.folderMissing) return fail("Hjelpetråder krever en aktiv Kode-tråd i et tilgjengelig prosjekt, uten planmodus.");
    if (this.depth(currentThread) >= MAX_DEPTH) return fail(`Grensen er nådd: tråder kan ikke lages dypere enn ${MAX_DEPTH} nivåer`);
    if (this.host.runningAgentThreads(project.id) >= MAX_AGENT_THREADS) {
      return fail(`Grensen er nådd: ${MAX_AGENT_THREADS} tråder har agentarbeid som kjører eller venter i kø i prosjektet. Vent på en av dem.`);
    }
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
    const task = typeof input.task === "string" ? input.task.trim() : "";
    if (!title || !task || task.length > 200_000) return fail("title og task må fylles ut, og task kan ikke være over 200 000 tegn.");
    const model = this.store.model(input.model);
    if (!model) return fail("Den valgte modellen er ikke lenger tilgjengelig.");
    const assigned = this.store.answerModel(model);
    const child = this.store.createThread(project.id, "code", model.id, {
      title,
      parentThreadId: thread.id,
      permissionCap: effectiveMode(project, currentThread), // Never above the thread that made it.
    });
    // The parent's per-thread effort overrides its model default. A helper on the same model
    // should keep that choice; an explicitly different model keeps its own effort setting.
    if (model.id === parentModelId && thread.reasoning) this.store.updateThread(child.id, { reasoning: thread.reasoning });
    const chainId = this.host.chainOf(thread.id);
    this.count(chainId);
    this.log.append(thread.id, { type: "thread.spawned", runId, childThreadId: child.id, title, model: assigned });
    this.host.threadChanged(child.id);
    this.host.sendFromThread(child.id, task, { threadId: thread.id, title: thread.title }, chainId);
    return { text: `Tråden ${JSON.stringify(title)} er startet med ${JSON.stringify(assigned.modelName)} (${JSON.stringify(assigned.providerName)}). tråd-id: ${child.id}` };
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
