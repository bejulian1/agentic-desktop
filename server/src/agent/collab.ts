// Threads working together: the thread_* tools and their brakes. These are visible threads the
// user can open and take over. The brakes are not optional, since collaboration can otherwise
// run away and get expensive.
import { DEFAULT_LOCAL_CONTEXT_WINDOW, type ListedModel, type ModelConfig, type Thread, type ThreadRef } from "../../../shared/protocol.ts";
import { DEFAULT_CONTEXT_WINDOW, localKindFor, tableContext } from "../providers/presets.ts";
import type { Store, ThreadPatch } from "../db.ts";
import type { GitWorkspace } from "../git-workspace.ts";
import { looksSecret } from "../memory.ts";
import { cleanName } from "../names.ts";
import { parseSnoozedUntil } from "../thread-inbox.ts";
import type { EventLog } from "./events.ts";
import { effectiveMode } from "./permissions.ts";
import { blocksText } from "./context.ts";
import { historyFrom } from "./fork.ts";
import { clip, MAX_RESULT_CHARS, type CollabTools, type ToolResult } from "./tools.ts";

export const MAX_DEPTH = 2;
export const MAX_AGENT_THREADS = 4;
export const MAX_THREAD_MESSAGES = 20;
const DEFAULT_WAIT_S = 120;
const MAX_WAIT_S = 600;
// The running provider's own model list (thread_models with available: true): asked at most every
// five minutes, and given up after five seconds so a slow /models never holds up the turn.
const LIST_CACHE_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 5_000;
const MAX_LISTED = 40;

// A model ID the agent may name on its own provider: a plain line of at most 200 characters.
export function validModelId(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.trim().length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

// A model on the running provider that is not configured yet: what thread_create starts the helper
// with. It is saved as an ordinary model (Innstillinger → Modeller) only when the helper starts.
export interface DraftModel extends ModelConfig { draft: true }

export interface CreateThreadInput {
  title: string;
  task: string;
  model: string;
  role?: "research" | "review" | "implementation";
  readOnly?: boolean;
  isolation?: "shared" | "worktree";
}

export interface SearchThreadsInput {
  query?: string;
  projectId?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface OrganizeThreadInput {
  threadId?: string;
  action: "settle" | "archive" | "unsettle" | "unarchive" | "snooze" | "unsnooze" | "pin" | "unpin" | "rename";
  snoozedUntil?: string | number;
  title?: string;
}

export interface CollabHost {
  sendFromThread(threadId: string, text: string, from: ThreadRef, chainId: string): void;
  chainOf(threadId: string): string;
  runningAgentThreads(projectId: string): number;
  hasAgentSlot(threadId: string): boolean;
  isBusy(threadId: string): boolean;
  waitIdle(threadId: string, timeoutMs: number, signal: AbortSignal, requestingThreadId?: string): Promise<boolean>;
  hasIncomingMessage?(threadId: string): boolean;
  hasUserSteering?(threadId: string): boolean;
  threadChanged(threadId: string): void;
  gitWorkspace?: () => GitWorkspace;
  stop?(threadId: string): boolean;
  cancel?(threadId: string, reason?: string): boolean;
  deferInboxPatch?(threadId: string, patch: Pick<ThreadPatch, "archived" | "snoozedUntil">, defer: boolean): boolean;
  knownSecrets?(): string[];
  // The provider's own model list (its /models endpoint). Absent in tests that do not need it.
  listProviderModels?(providerId: string, signal: AbortSignal): Promise<ListedModel[]>;
  modelsChanged?(): void;
}

function fail(text: string): ToolResult {
  return { text, isError: true };
}

export class Collab implements CollabTools {
  private store: Store;
  private log: EventLog;
  private host: CollabHost;
  private sent = new Map<string, number>(); // messages between threads, per user message
  private listed = new Map<string, { key: string; at: number; models: ListedModel[] }>();

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

  release(chainId: string): void {
    this.sent.delete(chainId);
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

  search(input: SearchThreadsInput, discovered?: Set<string>, maxChars = MAX_RESULT_CHARS): ToolResult {
    const { query = "", projectId, includeArchived = false, limit = 20 } = input;
    if (typeof query !== "string" || (projectId !== undefined && (typeof projectId !== "string" || !projectId.trim())) ||
        typeof includeArchived !== "boolean" || !Number.isSafeInteger(limit) || limit < 1) {
      return fail("Use a text query, a project ID, a boolean includeArchived and a positive integer limit.");
    }
    const search = query.trim().toLowerCase();
    const projects = new Map(this.store.projects().map(project => [project.id, project.name]));
    const chatProjects = new Map(this.store.chatProjects().map(project => [project.id, project.name]));
    const redact = this.redactor();
    const matches: string[] = [];
    let chars = 2; // JSON array brackets.
    for (const t of this.store.threads()) {
      if (t.temporary || (!includeArchived && t.archived) || (projectId !== undefined && (t.projectId ?? t.chatProjectId) !== projectId)) continue;
      const title = redact(t.title).slice(0, 160);
      const name = projects.get(t.projectId ?? "") ?? chatProjects.get(t.chatProjectId ?? "");
      const projectName = name ? redact(name).slice(0, 160) : null;
      if (search && ![t.id, title, projectName].some(value => value?.toLowerCase().includes(search))) continue;
      const result = JSON.stringify({
        id: t.id, title, mode: t.mode, projectName,
        status: t.pendingApprovals ? "awaiting-approval" : t.pendingQuestions ? "awaiting-input" : t.running ? "running" : t.lastStatus ?? "idle",
        pinned: !!t.pinned, archived: t.archived, snoozedUntil: t.snoozedUntil ?? null, updatedAt: t.updatedAt,
      });
      chars += result.length + Number(matches.length > 0);
      if (chars > maxChars) break;
      matches.push(result);
      discovered?.add(t.id);
      if (matches.length === Math.min(limit, 50)) break;
    }
    return { text: `[${matches.join(",")}]` };
  }

  organize(thread: Thread, input: OrganizeThreadInput): ToolResult {
    const target = input.threadId === undefined ? this.store.thread(thread.id)
      : typeof input.threadId === "string" ? this.store.thread(input.threadId) : undefined;
    if (!target || target.temporary) return fail("Fant ikke tråden");
    let patch: ThreadPatch;
    switch (input.action) {
      case "settle": case "archive": patch = { archived: true }; break;
      case "unsettle": case "unarchive": patch = { archived: false }; break;
      case "pin": case "unpin": patch = { pinned: input.action === "pin" }; break;
      case "unsnooze": patch = { snoozedUntil: null }; break;
      case "snooze": {
        const until = parseSnoozedUntil(input.snoozedUntil);
        if (until === null) return fail("Velg et gyldig tidspunkt i fremtiden");
        patch = { snoozedUntil: until };
        break;
      }
      case "rename": {
        const title = typeof input.title === "string" ? cleanName(input.title) : "";
        if (!title) return fail("Tittelen er tom");
        patch = { title };
        break;
      }
      default: return fail("Choose a valid thread action.");
    }
    const result = { threadId: target.id, ...patch, ...(patch.title ? { title: this.redactor()(patch.title) } : {}) };
    if (this.host.deferInboxPatch?.(target.id, patch, target.id === thread.id)) {
      return { text: JSON.stringify({ ...result, onCompletion: true }) };
    }
    if (patch.archived && (!target.running || target.pendingQuestions)) this.host.stop?.(target.id);
    this.store.updateThread(target.id, patch);
    this.host.threadChanged(target.id);
    return { text: JSON.stringify(result) };
  }

  cancel(thread: Thread, input: { threadId: string; reason?: string }): ToolResult {
    const other = this.peer(thread, input.threadId);
    if ("text" in other) return other;
    if (other.origin !== "agent" || !this.hasAncestor(other, thread.id)) return fail("Only descendant helper threads can be cancelled.");
    if (input.reason !== undefined && typeof input.reason !== "string") return fail("Use text for the cancellation reason.");
    const cancelled = this.host.cancel?.(other.id, input.reason?.trim().slice(0, 200)) ?? false;
    return { text: JSON.stringify({ threadId: other.id, cancelled }) };
  }

  private redactor(): (value: string) => string {
    const known = this.host.knownSecrets?.().filter(Boolean) ?? [];
    return (value) => {
      if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value)) return "[redacted]";
      const containsSecret = (line: string) => known.some(secret => secret.length >= 4
        ? line.includes(secret) : line.split(/[\s"'=:,;]+/).includes(secret));
      return value.split("\n").map(line => containsSecret(line) || looksSecret(line) ? "[redacted]" : line).join("\n");
    };
  }

  // Configured models across providers, and with available: true also what the running provider
  // offers on its own /models list, marked as configured or not. A model from that list can be
  // passed to thread_create by its API name; it then runs on the same provider.
  async models(query: unknown = "", offset: unknown = 0, maxChars = MAX_RESULT_CHARS, options: { modelId?: string; available?: unknown; signal?: AbortSignal } = {}): Promise<ToolResult> {
    if (typeof query !== "string" || typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
      return fail("Bruk tekst som søk og et heltall fra 0 og oppover som offset.");
    }
    const search = query.trim().toLowerCase();
    const providers = new Map(this.store.providers().map(p => [p.id, p.name]));
    const running = options.modelId ? this.store.model(options.modelId) : undefined;
    const matches = this.store.models().map(m => ({
      id: m.id, name: m.name, model: m.model, provider: providers.get(m.providerId), providerId: m.providerId,
    })).filter(m => m.provider !== undefined && [m.name, m.model, m.provider].some(value => value?.toLowerCase().includes(search)));
    const label = (value: string) => value.replace(/[\u0000-\u001f]/g, " ").slice(0, 160);
    const models = matches.slice(offset, offset + 12).map(m => ({
      id: m.id, name: label(m.name), model: label(m.model), provider: label(m.provider!),
      ...(running ? { sameProvider: m.providerId === running.providerId } : {}),
    }));
    // The provider's list comes with the first page only.
    const listing = options.available === true && offset === 0 && running ? await this.providerList(running.providerId, options.signal) : undefined;
    const configured = new Set(running ? this.store.models().filter((m) => m.providerId === running.providerId).map((m) => m.model) : []);
    const available = listing && "models" in listing
      ? listing.models.filter((m) => [m.id, m.name ?? ""].some((value) => value.toLowerCase().includes(search))).slice(0, MAX_LISTED)
        .map((m) => ({ model: label(m.id), ...(m.name && m.name !== m.id ? { name: label(m.name) } : {}), configured: configured.has(m.id) }))
      : undefined;
    const currentProvider = running && options.available === true && offset === 0 ? {
      name: label(providers.get(running.providerId) ?? ""),
      ...(available ? { available } : { note: listing && "error" in listing ? listing.error : "Leverandøren har ingen modelliste. Du kan likevel oppgi en modell-ID til thread_create." }),
    } : undefined;
    const encode = () => JSON.stringify({ models, nextOffset: offset + models.length < matches.length ? offset + models.length : null, ...(currentProvider ? { currentProvider } : {}) });
    while (available && available.length && encode().length > maxChars) available.pop();
    while (models.length > 1 && encode().length > maxChars) models.pop();
    if (encode().length > maxChars) return fail("Modellen har for lite plass i konteksten til å vise dette treffet.");
    return { text: encode() };
  }

  private async providerList(providerId: string, signal?: AbortSignal): Promise<{ models: ListedModel[] } | { error: string }> {
    const provider = this.store.provider(providerId);
    if (!provider || provider.kind === "mock" || !this.host.listProviderModels) return { error: "Leverandøren har ingen modelliste. Du kan likevel oppgi en modell-ID til thread_create." };
    // A new address or key is another list.
    const key = JSON.stringify([provider.baseUrl ?? "", provider.credentialId ?? provider.id, provider.apiKeyEnv ?? ""]);
    const cached = this.listed.get(providerId);
    if (cached && cached.key === key && Date.now() - cached.at < LIST_CACHE_MS) return { models: cached.models };
    try {
      const timeout = AbortSignal.timeout(LIST_TIMEOUT_MS);
      const models = await this.host.listProviderModels(providerId, signal ? AbortSignal.any([signal, timeout]) : timeout);
      this.listed.set(providerId, { key, at: Date.now(), models });
      return { models };
    } catch {
      return { error: "Modellisten hos leverandøren svarte ikke nå. Du kan likevel oppgi en modell-ID til thread_create." };
    }
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
    if (!model && requested !== undefined) return this.draftModel(requested, parentModelId);
    if (!model || !this.store.provider(model.providerId)) return fail("Fant ingen modell for dette valget. Bruk thread_models for å se de konfigurerte modellene.");
    return model;
  }

  // A model ID that is not configured, on the provider the running thread uses: the helper runs
  // there with it. Another provider is never reached this way; that takes a configured model and
  // the user's approval.
  private draftModel(requested: unknown, parentModelId: string): DraftModel | ToolResult {
    const parent = this.store.model(parentModelId);
    const provider = parent && this.store.provider(parent.providerId);
    // A configured id that no longer exists is not a model name at the provider.
    const staleId = typeof requested === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requested.trim());
    if (!parent || !provider || provider.kind === "mock" || !validModelId(requested) || staleId) {
      return fail("Fant ingen modell for dette valget. Bruk thread_models for å se de konfigurerte modellene, eller oppgi en modell-ID hos leverandøren du kjører på.");
    }
    const model = requested.trim();
    const local = !!localKindFor(provider);
    return {
      id: crypto.randomUUID(), providerId: provider.id, name: model, model,
      contextWindow: local ? DEFAULT_LOCAL_CONTEXT_WINDOW : tableContext(model) ?? DEFAULT_CONTEXT_WINDOW,
      supportsTools: true, ...(provider.kind === "openai-compatible" && !local ? { supportsImages: true } : {}), draft: true,
    };
  }

  // Saves a draft model when its helper starts, or the one that was configured meanwhile.
  saveDraft(draft: DraftModel): ModelConfig {
    const existing = this.store.models().find((m) => m.providerId === draft.providerId && m.model === draft.model);
    if (existing) return existing;
    const { draft: _draft, ...model } = draft;
    this.store.saveModel(model);
    this.host.modelsChanged?.();
    return this.store.model(model.id)!;
  }

  create(thread: Thread, runId: string, parentModelId: string, input: CreateThreadInput, signal: AbortSignal): ToolResult | Promise<ToolResult> {
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
    if (input.role !== undefined && !["research", "review", "implementation"].includes(input.role)) return fail("Choose research, review or implementation for role.");
    if (input.readOnly !== undefined && typeof input.readOnly !== "boolean") return fail("Use a boolean for readOnly.");
    if (input.isolation !== undefined && !["shared", "worktree"].includes(input.isolation)) return fail("Choose shared or worktree for isolation.");
    const planMode = input.readOnly === true || input.role === "research" || input.role === "review";
    const model = this.store.model(input.model);
    if (!model) return fail("Den valgte modellen er ikke lenger tilgjengelig.");
    const assigned = this.store.answerModel(model);
    const start = (worktreePath?: string | null, worktreeBranch?: string | null): ToolResult => {
      signal.throwIfAborted();
      const parent = this.store.thread(thread.id);
      const latest = this.store.project(project.id);
      if (!parent || parent.archived || parent.planMode || parent.projectId !== project.id || !latest || latest.path !== project.path ||
          latest.folderMissing || this.host.hasUserSteering?.(thread.id)) throw new Error("The parent thread or its project changed before the helper could start.");
      if (this.host.runningAgentThreads(project.id) >= MAX_AGENT_THREADS) throw new Error("No helper slot is available in this project.");
      const child = this.store.createThread(project.id, "code", model.id, {
        title, parentThreadId: thread.id, planMode, worktreePath, worktreeBranch,
        permissionCap: effectiveMode(latest, parent),
      });
      // Keep the parent's per-thread effort when the helper uses the same model.
      if (model.id === parentModelId && parent.reasoning) this.store.updateThread(child.id, { reasoning: parent.reasoning });
      const chainId = this.host.chainOf(thread.id);
      try {
        this.host.sendFromThread(child.id, task, { threadId: thread.id, title: parent.title }, chainId);
      } catch (error) {
        this.store.deleteThread(child.id);
        throw error;
      }
      this.count(chainId);
      this.log.append(thread.id, { type: "thread.spawned", runId, childThreadId: child.id, title, model: assigned });
      this.host.threadChanged(child.id);
      return { text: JSON.stringify({
        threadId: child.id, planMode, readOnly: planMode, isolation: worktreePath ? "worktree" : "shared",
        worktreePath: worktreePath ?? null, branch: worktreeBranch ?? null,
        message: `Tråden ${JSON.stringify(title)} er startet med ${JSON.stringify(assigned.modelName)} (${JSON.stringify(assigned.providerName)}). tråd-id: ${child.id}`,
      }) };
    };
    if (input.isolation !== "worktree") return start(currentThread.worktreePath, currentThread.worktreeBranch);
    const git = this.host.gitWorkspace?.();
    if (!git) return fail("Git worktree support is unavailable.");
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "helper";
    const branch = `agent/${slug}-${crypto.randomUUID().slice(0, 8)}`;
    const workspace = currentThread.worktreePath ? { ...project, path: currentThread.worktreePath } : project;
    return git.createAgentWorktree(workspace, branch, folder => start(folder, branch), signal);
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

  read(thread: Thread, input: { threadId: string; limit?: number }, discovered?: Set<string>): ToolResult {
    const other = typeof input.threadId === "string" ? this.store.thread(input.threadId) : undefined;
    if (!other || other.temporary || other.id === thread.id) return fail("Fant ikke tråden");
    const sameProject = thread.projectId !== null && other.projectId === thread.projectId;
    if (!sameProject && !discovered?.has(other.id)) return fail("Find the thread with thread_search before reading it.");
    const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 50);
    const redact = this.redactor();
    this.log.flush(other.id);
    // The visible transcript excludes hidden context, expanded attachments and tool results.
    const kinds = new Set(["user.message", "user.checked", "text.delta", "history.answer"]);
    const events = this.store.eventsTail(other.id, 2000).filter(({ event }) => kinds.has(event.type))
      .map(envelope => envelope.event.type === "user.message"
        ? { ...envelope, event: { ...envelope.event, attachments: undefined } } : envelope);
    const lines = historyFrom(events)
      .map((m) => ({ role: m.role, text: blocksText(m.content) }))
      .filter((m) => m.text)
      .slice(-limit)
      .map((m) => `${m.role === "user" ? "Bruker" : "Assistent"}: ${redact(m.text)}`);
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
