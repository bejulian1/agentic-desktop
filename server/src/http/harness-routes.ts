// Routes for round 6, agent E: memories, skills and steered messages. Kept apart from api.ts so
// the round's agents do not edit the same lines. Same checks as every other route: cookie, Origin
// and JSON, from Api.handle().
// Round 9b (SPEC 22): the standard harness, its preview and «Gjenopprett standard», Chat's own
// personalisation and memories, the memory upgrade, and import of many skills.
import { rmSync } from "node:fs";
import { EDITABLE_LAYERS, overrideKey, overridePrefix } from "../agent/prompt-overrides.ts";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HarnessInfo, MemoryList, MemoryScope, Project, PromptLayerInfo, Thread, UpgradeOp, UpgradeProposal } from "../../../shared/protocol.ts";
import { HttpError } from "../errors.ts";
import { backupGlobalAgents, DEFAULT_AGENTS_MD, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, MAX_CHAT_FIELD, MAX_CHAT_WORDS, HARNESS_PARTS, HARNESS_VERSION, hashText, lineDiff, listBackups, pruneBackups, TONES } from "../agent/harness.ts";
import { previewImport, runImport, type ImportTarget } from "../skill-import.ts";
import type { ApiDeps } from "./api.ts";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;

function scopeOf(value: unknown): MemoryScope {
  if (value === "global" || value === "project") return value;
  throw new HttpError(400, "scope må være global eller project");
}

export function harnessRoutes(route: Route, deps: ApiDeps, h: { project: (id: string) => Project; thread: (id: string) => Thread }): void {
  const { store, runner } = deps;
  const memories = runner.memories;
  const skills = runner.skillStore;
  const projectFor = (scope: MemoryScope, id: unknown) => (scope === "project" ? h.project(String(id ?? "")) : undefined);

  // Steering: a queued message goes into the running turn, or back to waiting.
  route("PATCH", "/api/threads/:id/queue/:messageId", ({ params, body }) => {
    const id = h.thread(params.id).id;
    if (body.text !== undefined) {
      if (typeof body.text !== "string" || body.steer !== undefined) throw new HttpError(400, "Send enten text eller steer");
      return runner.editQueued(id, params.messageId, body.text);
    }
    if (typeof body.steer !== "boolean") throw new HttpError(400, "steer må være true eller false");
    return runner.setSteer(id, params.messageId, body.steer);
  });

  route("DELETE", "/api/threads/:id/queue/:messageId", ({ params }) => runner.removeQueued(h.thread(params.id).id, params.messageId));

  route("POST", "/api/threads/:id/queue/:messageId/side-draft", ({ params }) => runner.queuedSideDraft(h.thread(params.id).id, params.messageId));

  route("GET", "/api/threads/:id/queued-draft", ({ params }) => ({ draft: store.queuedDraft(h.thread(params.id).id) }));

  // Memories

  route("GET", "/api/memories", (): MemoryList => {
    const projects: MemoryList["projects"] = [];
    for (const project of store.projects()) {
      try {
        projects.push({ projectId: project.id, name: project.name, file: memories.file("project", project), items: memories.list("project", project) });
      } catch (err) {
        projects.push({ projectId: project.id, name: project.name, file: "", items: [], error: (err as Error).message });
      }
    }
    return {
      enabled: store.settings().memories !== false,
      global: { file: memories.file("global"), items: memories.list("global") },
      projects,
    };
  });

  route("POST", "/api/memories", ({ body }) => {
    const scope = scopeOf(body.scope);
    return memories.add(scope, projectFor(scope, body.projectId), body.text).item;
  });

  route("PUT", "/api/memories/:id", ({ params, body }) => {
    const scope = scopeOf(body.scope);
    return memories.update(scope, projectFor(scope, body.projectId), params.id, body.text);
  });

  route("DELETE", "/api/memories/:id", ({ params, query }) => {
    const scope = scopeOf(query.get("scope"));
    memories.remove(scope, projectFor(scope, query.get("projectId")), params.id);
  });

  // Without a scope: every memory, global and in every project.
  route("POST", "/api/memories/clear", ({ body }) => {
    if (body.scope !== undefined) {
      const scope = scopeOf(body.scope);
      return { removed: memories.clear(scope, projectFor(scope, body.projectId)) };
    }
    let removed = memories.clear("global");
    for (const project of store.projects()) {
      try {
        removed += memories.clear("project", project);
      } catch {
        // A project folder that is gone has nothing to clear.
      }
    }
    return { removed };
  });

  // Skills

  route("GET", "/api/skills", () => ({ userDir: runner.userSkillsDir, skills: skills.list() }));
  route("GET", "/api/skills/:id", ({ params }) => skills.detail(params.id));
  route("POST", "/api/skills", ({ body }) => skills.create(body));
  route("PUT", "/api/skills/:id", ({ params, body }) => skills.update(params.id, body));
  route("PATCH", "/api/skills/:id", ({ params, body }) => {
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled må være true eller false");
    return skills.setEnabled(params.id, body.enabled);
  });
  route("DELETE", "/api/skills/:id", ({ params }) => skills.remove(params.id));

  // Round 9b: the harness (SPEC 22.2)

  const config = deps.config;
  const harness = runner.harness;
  const tokens = (text: string) => Math.ceil(text.length / 4);

  const info = (): HarnessInfo => {
    const state = harness.state();
    const text = config.global().agentsMd;
    return {
      version: HARNESS_VERSION,
      parts: HARNESS_PARTS.map((p) => ({ id: p.id, title: p.title, text: p.text, locked: p.locked === true, default: p.default, on: p.locked ? true : state.parts[p.id] !== false })),
      partsAreDefault: HARNESS_PARTS.every((p) => p.locked || (state.parts[p.id] !== false) === p.default),
      agents: { file: path.join(config.globalDir, "AGENTS.md"), text, hash: hashText(text), isDefault: text === DEFAULT_AGENTS_MD, backups: listBackups(config.globalDir).slice(0, 5) },
      autoUpgrade: state.autoUpgrade,
      lastUpgradeAt: state.lastUpgradeAt,
      pending: state.pending,
    };
  };

  route("GET", "/api/harness", info);

  route("PATCH", "/api/harness", ({ body }) => {
    if (body.parts !== undefined) harness.setParts(body.parts);
    if (body.autoUpgrade !== undefined) {
      if (typeof body.autoUpgrade !== "boolean") throw new HttpError(400, "autoUpgrade må være true eller false");
      harness.setAutoUpgrade(body.autoUpgrade);
    }
    return info();
  });

  // The system prompt a new thread would get now, layer by layer.
  route("GET", "/api/harness/preview", ({ query }) => {
    const mode = query.get("mode") === "chat" ? "chat" : "code";
    const projectId = query.get("projectId");
    const project = mode === "code" && projectId ? h.project(projectId) : undefined;
    const layers: PromptLayerInfo[] = runner.previewLayers(mode, project).map((l) => ({ ...l, tokens: tokens(l.text) }));
    const tools = runner.toolNames(mode, project);
    return { mode, projectId: project?.id ?? null, layers, tokens: tokens(layers.map((l) => l.text).join("\n\n")), tools };
  });

  // The user's own text for one built-in layer, for the mode and variant that is previewed (Kode
  // with a project, Kode without one, or Chat). The model gets it from the next turn.
  const overrideTarget = (source: { mode?: unknown; projectId?: unknown; layer?: unknown }) => {
    const mode = source.mode === "chat" ? "chat" : "code";
    const project = mode === "code" && typeof source.projectId === "string" && source.projectId ? h.project(source.projectId) : undefined;
    const layer = typeof source.layer === "string" ? source.layer : "";
    return { mode, project, layer } as const;
  };
  route("PUT", "/api/harness/overrides", ({ body }) => {
    const { mode, project, layer } = overrideTarget(body);
    if (!EDITABLE_LAYERS.includes(layer)) throw new HttpError(400, "Dette laget kan ikke redigeres her.");
    if (!runner.previewLayers(mode, project).some((l) => l.id === layer)) throw new HttpError(404, "Laget finnes ikke i denne forhåndsvisningen.");
    if (typeof body.text !== "string") throw new HttpError(400, "Teksten mangler.");
    harness.setOverride(overrideKey(mode, !!project, layer), body.text);
    return { ok: true };
  });
  route("DELETE", "/api/harness/overrides", ({ query }) => {
    const { mode, project, layer } = overrideTarget({ mode: query.get("mode"), projectId: query.get("projectId"), layer: query.get("layer") });
    if (layer) harness.setOverride(overrideKey(mode, !!project, layer), null);
    else harness.clearOverrides(overridePrefix(mode, !!project));
    return { ok: true };
  });

  // What «Gjenopprett standard» would do to the global AGENTS.md, before anything is written.
  route("GET", "/api/harness/agents-md/default", () => {
    const current = config.global().agentsMd;
    return { text: DEFAULT_AGENTS_MD, diff: lineDiff(current ?? "", DEFAULT_AGENTS_MD), hash: hashText(current), exists: current !== null };
  });

  // agents: the hash of the file the diff was made from; if the file changed since, nothing is
  // written. The old file is kept in backups/ first. parts: the switches back to their defaults.
  route("POST", "/api/harness/restore", ({ body }) => {
    let backup: string | undefined;
    if (body.agents !== undefined) {
      const current = config.global().agentsMd;
      if (body.agents !== hashText(current)) throw new HttpError(409, "AGENTS.md er endret siden du så forskjellen. Se på den på nytt før du gjenoppretter.");
      if (current !== null && current !== DEFAULT_AGENTS_MD) {
        backup = backupGlobalAgents(config.globalDir, current);
        pruneBackups(config.globalDir, (file) => rmSync(file, { force: true }));
      }
      config.writeGlobalAgents(DEFAULT_AGENTS_MD);
    }
    if (body.parts === true) harness.resetParts();
    return { harness: info(), ...(backup ? { backup } : {}) };
  });

  // Chat: its own place (SPEC 22.4)

  const chatMemories = runner.chatMemories;
  const chatState = () => ({ personal: harness.state().chat, memories: chatMemories.list("global"), file: chatMemories.file("global"), tones: TONES, defaults: { instructions: DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, maxLength: MAX_CHAT_FIELD, maxWords: MAX_CHAT_WORDS }, instructionsAreDefault: harness.state().chat.instructions === DEFAULT_CHAT_SYSTEM_INSTRUCTIONS });
  route("GET", "/api/chat-personal", chatState);
  route("PUT", "/api/chat-personal", ({ body }) => harness.setChat(body ?? {}));
  route("POST", "/api/chat-personal/reset", () => harness.resetChat());
  route("POST", "/api/chat-personal/instructions/reset", () => harness.resetChatInstructions());
  route("POST", "/api/chat-personal/memories", ({ body }) => chatMemories.add("global", undefined, body.text).item);
  route("PUT", "/api/chat-personal/memories/:id", ({ params, body }) => chatMemories.update("global", undefined, params.id, body.text));
  route("DELETE", "/api/chat-personal/memories/:id", ({ params }) => void chatMemories.remove("global", undefined, params.id));
  route("POST", "/api/chat-personal/memories/clear", () => ({ removed: chatMemories.clear("global") }));

  // The memory upgrade (SPEC 22.3): a proposal first, then only the operations the user chose.

  const upgradeScope = (value: unknown): UpgradeProposal["scope"] => {
    if (value === "global" || value === "project" || value === "chat") return value;
    throw new HttpError(400, "scope må være global, project eller chat");
  };

  route("POST", "/api/memories/upgrade", async ({ body }) => {
    const scope = upgradeScope(body.scope);
    const project = scope === "project" ? h.project(String(body.projectId ?? "")) : undefined;
    return runner.proposeUpgrade(scope, project, body.useModel === true);
  });

  route("POST", "/api/memories/upgrade/apply", ({ body }) => {
    const proposal = body.proposal as UpgradeProposal | undefined;
    if (!proposal || !Array.isArray(proposal.ops)) throw new HttpError(400, "proposal mangler");
    const scope = upgradeScope(proposal.scope);
    const project = scope === "project" ? h.project(String(proposal.projectId ?? "")) : undefined;
    const selected: number[] = Array.isArray(body.selected) ? body.selected.filter((n: unknown) => Number.isInteger(n)) : proposal.ops.map((_, i) => i);
    const ops: UpgradeOp[] = [];
    for (const index of new Set(selected)) {
      const op = proposal.ops[index];
      if (!op) throw new HttpError(400, "Ukjent forslag");
      if (!["merge", "remove", "shorten"].includes(op.kind) || !Array.isArray(op.ids) || !op.ids.length) throw new HttpError(400, "Ugyldig forslag");
      if (op.kind !== "remove" && typeof op.result !== "string") throw new HttpError(400, "Forslaget mangler tekst");
      ops.push({ kind: op.kind, ids: op.ids.map(String), texts: [], result: op.kind === "remove" ? null : op.result, reason: "" });
    }
    return { changed: ops.length ? runner.applyUpgrade(scope, project, ops) : 0 };
  });

  route("POST", "/api/memories/upgrade/dismiss", ({ body }) => {
    const scope = upgradeScope(body.scope);
    harness.dropPending(scope, scope === "project" ? String(body.projectId ?? "") : undefined);
    harness.touchUpgrade();
    return info();
  });

  // Many skills at once (SPEC 22.5)

  const importTarget = (body: any): ImportTarget => (body.scope === "project" ? { scope: "project", project: h.project(String(body.projectId ?? "")) } : { scope: "user" });
  route("POST", "/api/skills/import/preview", ({ body }) => ({ rows: previewImport(body.files, importTarget(body), skills) }));
  route("POST", "/api/skills/import", ({ body }) => ({ results: runImport(body.files, importTarget(body), skills, body.decisions ?? {}, body.enabled ?? {}) }));
}
