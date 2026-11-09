// Round 12 (SPEC 26.2): Økt, the panel about the thread in focus. Everything here is read from
// what the app already has: the thread's project, the harness that builds the system prompt, the
// model and its provider, GitHub, the Browser panel, team agents, terminals and servers. What is
// not there is left out, never shown as a placeholder.
import { hostname } from "node:os";
import type { Project, SessionConnection, SessionContextPart, SessionInfo, SessionTask, Thread } from "../../shared/protocol.ts";
import { estimateTokens } from "./agent/context.ts";
import type { Runner } from "./agent/runner.ts";
import type { ImportedCookies } from "./browser-cookies.ts";
import type { Store } from "./db.ts";
import { HttpError } from "./errors.ts";
import { GitHub } from "./github.ts";
import { DEFAULT_CONTEXT_WINDOW } from "./providers/presets.ts";
import { apiKeyFor } from "./providers/index.ts";
import type { Secrets } from "./secrets.ts";
import type { Servers } from "./servers.ts";
import type { Terminals } from "./terminal.ts";

export interface SessionDeps {
  store: Store;
  runner: Runner;
  secrets: Secrets;
  terminals: Terminals;
  servers?: Servers;
  browser?: { running: boolean };
  importedCookies?: ImportedCookies;
  ended?: EndedServers;
}

// Servers leave the list when they stop (servers.ts). Økt remembers the ones it has shown, so they
// can be counted under «Avsluttet» for as long as the app runs.
export class EndedServers {
  private seen = new Map<string, { projectId: string; threadId: string | null; task: SessionTask }>();
  private ended = new Map<string, { projectId: string; threadId: string | null; task: SessionTask }>();

  update(live: Array<{ key: string; projectId: string; threadId: string | null; task: SessionTask }>): void {
    const now = Date.now();
    const keys = new Set(live.map((l) => l.key));
    for (const [key, entry] of this.seen) {
      if (keys.has(key)) continue;
      this.seen.delete(key);
      this.ended.set(key, { ...entry, task: { ...entry.task, running: false, finishedAt: now } });
      if (this.ended.size > 200) this.ended.delete(this.ended.keys().next().value!);
    }
    for (const l of live) this.seen.set(l.key, { projectId: l.projectId, threadId: l.threadId, task: l.task });
  }

  for(projectId: string, threadId: string): SessionTask[] {
    return [...this.ended.values()].filter((e) => e.projectId === projectId && (e.threadId === null || e.threadId === threadId)).map((e) => e.task);
  }
}

// About four characters a token, the same rule compaction and the context ring use.
const tokensOf = (text: string) => Math.ceil(text.length / 4);

// Which part of the context each layer of the system prompt belongs to (agent/context.ts).
const LAYER_PART: Record<string, SessionContextPart["id"]> = {
  base: "system", env: "system", thread: "system", "chat-base": "system", "chat-personal": "system",
  global: "agents", project: "agents", agentic: "agents",
  memories: "memories", "chat-memories": "memories",
  skills: "skills",
};

const PART_LABELS: Record<SessionContextPart["id"], string> = {
  system: "Systemprompt og harness",
  agents: "AGENTS.md",
  memories: "Minner",
  skills: "Skills",
  tools: "Verktøy",
  messages: "Meldinger",
};

const ORDER: SessionContextPart["id"][] = ["system", "agents", "memories", "skills", "tools", "messages"];

export function sessionContext(deps: SessionDeps, thread: Thread, project: Project | undefined): SessionInfo["context"] {
  const { store, runner } = deps;
  const skills = thread.mode === "code" ? runner.skillsFor(project) : [];
  const layers = runner.systemLayers(thread, project, skills);
  const tools = runner.toolDefs(thread, project, skills);
  const sums = new Map<SessionContextPart["id"], number>();
  for (const layer of layers) {
    const part = LAYER_PART[layer.id] ?? "system";
    sums.set(part, (sums.get(part) ?? 0) + tokensOf(layer.text));
  }
  if (tools.length) sums.set("tools", tokensOf(JSON.stringify(tools)));
  const fixed = [...sums.values()].reduce((a, b) => a + b, 0);
  const estimatedMessages = estimateTokens("", store.messages(thread.id));
  const model = store.model(thread.modelId ?? store.settings().defaultModelId ?? "");
  const contextWindow = model?.contextWindow || DEFAULT_CONTEXT_WINDOW;
  // When the provider has counted the context, that count is the total and the messages are what
  // is left after the rest, as in the context ring.
  const measuredTokens = store.usage(thread.id).contextTokens;
  const usedTokens = Math.max(measuredTokens, fixed + estimatedMessages);
  sums.set("messages", Math.max(0, usedTokens - fixed));
  return {
    contextWindow,
    usedTokens,
    percent: Math.min(100, Math.max(0, Math.round((usedTokens / contextWindow) * 100))),
    measured: measuredTokens > 0 && measuredTokens >= fixed + estimatedMessages,
    parts: ORDER.filter((id) => (sums.get(id) ?? 0) > 0).map((id) => ({ id, label: PART_LABELS[id], tokens: sums.get(id)! })),
  };
}

function connections(deps: SessionDeps, thread: Thread, project: Project | undefined): SessionConnection[] {
  const { store, secrets } = deps;
  const out: SessionConnection[] = [];
  const model = store.model(thread.modelId ?? store.settings().defaultModelId ?? "");
  const provider = model ? store.provider(model.providerId) : undefined;
  if (model && provider) {
    const local = provider.kind === "mock" || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(provider.baseUrl ?? "");
    const keyed = apiKeyFor(provider, secrets) !== undefined;
    out.push({
      id: "model",
      kind: "model",
      label: provider.kind === "mock" ? "Demo-modellen" : provider.name,
      detail: provider.kind === "mock" ? "Lokalt, uten nettverk" : keyed || local ? model.name : `${model.name} · ingen nøkkel`,
      status: keyed || local ? "ok" : "warn",
    });
  }
  // Only the stored token is looked at; GitHub itself is not asked from here.
  const github = new GitHub(secrets).status();
  if (github.connected) out.push({ id: "github", kind: "github", label: "GitHub", detail: github.login ? `Tilkoblet som ${github.login}` : "Tilkoblet", status: "ok" });
  // The Browser panel is a tool in Kode threads with a project.
  if (thread.mode === "code" && project && deps.browser) {
    const signedIn = deps.importedCookies?.list().length ?? 0;
    const running = deps.browser.running;
    const parts = [running ? "Kjører" : "Starter ved første bruk"];
    if (signedIn) parts.push(`innlogget på ${signedIn === 1 ? "1 nettsted" : `${signedIn} nettsteder`}`);
    out.push({ id: "browser", kind: "browser", label: "Nettleserpanelet", detail: parts.join(", "), status: running ? "ok" : "off" });
  }
  return out;
}

function tasks(deps: SessionDeps, thread: Thread, project: Project | undefined): SessionTask[] {
  const { store, runner, terminals, servers } = deps;
  const out: SessionTask[] = [];
  // Team agents this thread started. A side chat is the user's own, not a background task.
  for (const child of store.threads()) {
    if (child.parentThreadId !== thread.id || child.origin !== "agent" || child.archived) continue;
    const running = runner.isRunning(child.id);
    const times = store.lastRunTimes(child.id);
    const model = child.modelId ? store.model(child.modelId) : undefined;
    out.push({
      id: `agent:${child.id}`,
      kind: "agent",
      title: child.title,
      detail: model ? `Team-agent · ${model.name}` : "Team-agent",
      startedAt: times?.startedAt ?? child.createdAt,
      finishedAt: running ? null : (times?.finishedAt ?? child.updatedAt),
      running,
      threadId: child.id,
    });
  }
  if (project) {
    for (const terminal of terminals.timed(project.id)) {
      out.push({
        id: `terminal:${terminal.terminalId}`,
        kind: "terminal",
        title: terminal.title,
        detail: terminal.title === "Terminal" ? "i prosjektmappen" : "Terminal",
        startedAt: terminal.startedAt,
        finishedAt: terminal.exited ? (terminal.exitedAt ?? terminal.startedAt) : null,
        running: !terminal.exited,
      });
    }
    // Servers the thread's commands started, and those from the project's terminals and Playtest.
    const live = (servers?.list() ?? []).map((server) => ({
      key: `${server.id}:${server.startedAt}`,
      projectId: server.projectId,
      threadId: server.threadId,
      task: {
        id: `server:${server.id}`,
        kind: "server" as const,
        title: server.url.replace(/^https?:\/\//, ""),
        detail: server.source === "playtest" ? "Playtest" : server.command,
        startedAt: server.startedAt,
        finishedAt: null,
        running: true,
      },
    }));
    deps.ended?.update(live);
    for (const l of live) if (l.projectId === project.id && (l.threadId === null || l.threadId === thread.id)) out.push(l.task);
    for (const task of deps.ended?.for(project.id, thread.id) ?? []) out.push({ ...task, id: `ended-${task.id}-${task.finishedAt}` });
  }
  return out;
}

export function sessionInfo(deps: SessionDeps, thread: Thread): SessionInfo {
  const project = thread.projectId ? deps.store.project(thread.projectId) : undefined;
  const all = tasks(deps, thread, project);
  const newest = (a: SessionTask, b: SessionTask) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt);
  return {
    threadId: thread.id,
    environment: {
      kind: "local",
      host: hostname(),
      project: project ? { id: project.id, name: project.name, path: project.path, folderMissing: project.folderMissing === true } : null,
    },
    context: sessionContext(deps, thread, project),
    connections: connections(deps, thread, project),
    tasks: all.filter((t) => t.running).sort((a, b) => b.startedAt - a.startedAt),
    finished: all.filter((t) => !t.running).sort(newest),
  };
}

// Stopp: only a task that belongs to the thread, and only one that runs.
export async function stopSessionTask(deps: SessionDeps, thread: Thread, taskId: unknown): Promise<void> {
  if (typeof taskId !== "string") throw new HttpError(400, "Oppgaven mangler");
  const project = thread.projectId ? deps.store.project(thread.projectId) : undefined;
  const task = tasks(deps, thread, project).find((t) => t.id === taskId);
  if (!task) throw new HttpError(404, "Fant ikke oppgaven");
  if (!task.running) return;
  const id = taskId.slice(taskId.indexOf(":") + 1);
  if (task.kind === "agent") deps.runner.stop(id);
  else if (task.kind === "terminal") await deps.terminals.stop(id);
  else await deps.servers?.stop(id);
}
