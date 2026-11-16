// MCP servers the user has added in Innstillinger → MCP-servere: their configuration, their
// connections, and their tools as app tools for the runner.
//
// Storage: the configuration is one JSON value in the app's database (the data folder is a
// protected path, so the model cannot change it with its file tools). Values the user marks as
// secret (a token in an environment variable, an Authorization header) are kept in the keyring
// through Secrets, never in the database; every view of a server (API, snapshot, ws) has them
// masked, and they are hidden again in everything the server sends back (results, errors, stderr).
//
// Lifecycle: enabled servers connect in the background when the app starts, and again when they
// are changed or the user asks (Koble til på nytt). A stdio server that dies after it was
// connected is started again a few times with growing pauses. Disabling, removing or closing the
// app stops the connection and the server's whole process group.
//
// Approvals: an MCP tool is an "exec" tool, so it asks in the "ask" and "accept-edits" modes (with
// "allow always" per tool) and runs in "full"; a server set to "auto" never asks. Annotations such
// as readOnlyHint come from the server and are never trusted for this. Chat has no permission
// mode, so it asks before each call unless the server is "auto" or the user allowed the tool for
// the rest of that conversation.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MCP_TOOL_LIMIT,
  type McpPairInput,
  type McpPairView,
  type McpServerInput,
  type McpServerView,
  type McpState,
  type McpStatus,
  type McpToolView,
} from "../../../shared/mcp.ts";
import { resolveToolName } from "../agent/args.ts";
import type { Tool, ToolResult } from "../agent/tools.ts";
import { REPO_ROOT } from "../config.ts";
import type { Store } from "../db.ts";
import { HttpError } from "../errors.ts";
import type { Secrets } from "../secrets.ts";
import { McpClient, type McpToolInfo, type Transport } from "./client.ts";
import { HttpTransport, SessionExpiredError } from "./http.ts";
import { StdioTransport } from "./stdio.ts";
import { describe, exposedName, redactor, toolSchema, toToolResult, uniqueSlug, validSlug } from "./tools.ts";

const META_KEY = "mcp-servers";
const MAX_SERVERS = 30;
const MAX_PAIRS = 50;
const CONNECT_TIMEOUT_STDIO_MS = 120_000; // npx downloads the package the first time
const CONNECT_TIMEOUT_HTTP_MS = 30_000;
const LIST_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_S = 120;
const RESTART_DELAYS_MS = [1000, 5000, 20_000];
const STABLE_MS = 60_000; // connected this long: a later crash starts the restart count again
const PUBLISH_DELAY_MS = 100;

type Mode = "code" | "chat";

interface StoredPair {
  name: string;
  secret: boolean;
  value?: string; // only for values that are not secret
}

interface StoredServer {
  id: string;
  name: string;
  slug: string; // the <server> in mcp__<server>__<tool>; set on create and rename, never renumbered
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: StoredPair[];
  url: string;
  headers: StoredPair[];
  enabled: boolean;
  code: boolean;
  chat: boolean;
  approval: "ask" | "auto";
  timeoutSeconds: number;
  disabledTools: string[];
}

interface Live {
  status: McpStatus;
  message: string;
  stderr: string;
  client: McpClient | null;
  tools: McpToolInfo[];
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  generation: number; // bumped on every (re)connect and stop; late events from an old one are ignored
  restarts: number;
  restartTimer?: NodeJS.Timeout;
  refreshTimer?: NodeJS.Timeout;
  connectedAt: number;
  closing?: Promise<void>;
  reconnecting?: Promise<void>; // one reconnect after an expired HTTP session, shared by the calls that hit it
}

// A stored entry that no longer passes validation (an older or hand-edited database). It is kept
// as it was, shown as a server in error, and can be fixed or removed; it is never silently dropped,
// which would also orphan its secrets in the keyring.
interface Broken {
  id: string;
  raw: Record<string, unknown>;
  error: string;
}

// An offered tool: what the model sees, and how to reach the real one.
interface Offered {
  serverId: string;
  tool: McpToolInfo;
  exposed: string;
}

export interface McpDeps {
  store: Store;
  secrets: Secrets;
  env: () => Record<string, string>; // the app's normal child environment, without API keys
  cwd: string; // where stdio servers start
  publish: (state: McpState) => void;
}

// Secret names that are always kept as secrets, whatever the form said.
const SECRET_ENV = /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH/i;
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key)$|token|secret|key/i;
// Headers the transport sets itself.
const RESERVED_HEADERS = new Set(["content-type", "accept", "content-length", "host", "mcp-session-id", "mcp-protocol-version", "connection", "transfer-encoding"]);

function appVersion(): string {
  try {
    return String(JSON.parse(readFileSync(path.join(REPO_ROOT, "version.json"), "utf8")).version ?? "0");
  } catch {
    return "0";
  }
}

export class McpServers {
  private deps: McpDeps;
  private servers: StoredServer[] = [];
  private broken: Broken[] = [];
  private live = new Map<string, Live>();
  private chatAllowed = new Map<string, Set<string>>(); // threadId → exposed names allowed for the rest of the chat
  private publishTimer?: NodeJS.Timeout;
  private closed = false;
  private version = appVersion();

  constructor(deps: McpDeps) {
    this.deps = deps;
    this.load();
    for (const server of this.servers) this.live.set(server.id, this.freshLive(server));
  }

  // Connects the enabled servers in the background. Never waits for them.
  start(): void {
    for (const server of this.servers) if (server.enabled) void this.connect(server.id);
  }

  // The keyring answered after the start, or was unlocked: servers that waited for a secret try again.
  keyringChanged(): void {
    for (const server of this.servers) {
      const live = this.live.get(server.id)!;
      if (server.enabled && live.status === "error" && !live.client && live.message.startsWith("Mangler") && !this.missingSecret(server)) void this.connect(server.id);
    }
  }

  // ── Configuration ───────────────────────────────────────────────────────────

  snapshot(): McpState {
    const offered = { code: this.offered("code"), chat: this.offered("chat") };
    const inMode = { code: new Set(offered.code.list.map((o) => o.exposed)), chat: new Set(offered.chat.list.map((o) => o.exposed)) };
    const names = this.names();
    return {
      servers: [...this.servers.map((server) => this.view(server, names, inMode)), ...this.broken.map((b) => brokenView(b))],
      limit: MCP_TOOL_LIMIT,
      offered: { code: offered.code.list.length, chat: offered.chat.list.length },
      capped: { code: offered.code.capped, chat: offered.chat.capped },
    };
  }

  async create(input: unknown): Promise<McpServerView> {
    if (this.servers.length + this.broken.length >= MAX_SERVERS) throw new HttpError(409, `Du kan ha opptil ${MAX_SERVERS} MCP-servere.`);
    const id = randomUUID();
    const { server, secrets } = this.validate(input, undefined, id);
    server.slug = uniqueSlug(server.name, this.slugs());
    await this.writeSecrets(server, secrets, undefined);
    this.servers.push(server);
    this.live.set(id, this.freshLive(server));
    this.save();
    void this.connect(id);
    return this.viewOf(id);
  }

  // A partial change: fields that are left out keep their value.
  async update(id: string, input: unknown): Promise<McpServerView> {
    const broken = this.broken.find((b) => b.id === id);
    if (broken) return this.repair(broken, input);
    const current = this.server(id);
    const { server, secrets } = this.validate(input, current, id);
    // A new name gives a new slug, and the old one's permissions go with it.
    server.slug = server.name === current.name ? current.slug : uniqueSlug(server.name, this.slugs(id));
    await this.writeSecrets(server, secrets, current);
    this.servers = this.servers.map((s) => (s.id === id ? server : s));
    this.save();
    if (server.slug !== current.slug) this.forgetSlug(current.slug);
    // Only a change to how it connects needs a new connection; tool switches and modes do not.
    if (connectionKey(current) !== connectionKey(server) || Object.keys(secrets).length || current.enabled !== server.enabled || server.slug !== current.slug) void this.connect(id);
    else this.changed();
    return this.viewOf(id);
  }

  async remove(id: string): Promise<void> {
    const broken = this.broken.find((b) => b.id === id);
    const server = broken ? undefined : this.server(id);
    this.servers = this.servers.filter((s) => s.id !== id);
    this.broken = this.broken.filter((b) => b.id !== id);
    this.save();
    await this.stop(id);
    this.live.delete(id);
    // Everything the keyring holds for this server, whatever names the entry had.
    for (const key of this.deps.secrets.ids()) if (key.startsWith(`mcp:${id}:`)) await this.deps.secrets.set(key, null);
    const slug = server?.slug ?? (validSlug(broken?.raw.slug) ? broken!.raw.slug : undefined);
    if (slug) this.forgetSlug(slug);
    this.changed();
  }

  async reconnect(id: string): Promise<McpServerView> {
    const broken = this.broken.find((b) => b.id === id);
    if (broken) throw new HttpError(409, `Innstillingene for serveren kunne ikke leses: ${broken.error} Rediger eller slett den.`);
    const server = this.server(id);
    const live = this.live.get(id)!;
    live.restarts = 0;
    if (server.enabled) await this.connect(id);
    return this.viewOf(id);
  }

  // ── Tools for the runner ────────────────────────────────────────────────────

  // The MCP tools a turn in this mode is offered, at most MCP_TOOL_LIMIT.
  tools(mode: Mode): Tool[] {
    return this.offered(mode).list.map((o) => this.asTool(o));
  }

  // One offered tool by its exposed name, or undefined. Forgiving the way built-in names are
  // (resolveToolName: case, a "functions." prefix, - for _), but only among MCP names, so an MCP
  // call never resolves to a built-in tool and a built-in never to an MCP tool.
  tool(name: string, mode: Mode): Tool | undefined {
    const list = this.offered(mode).list;
    const resolved = resolveToolName(name, list.map((o) => o.exposed));
    const found = resolved ? list.find((o) => o.exposed === resolved) : undefined;
    return found ? this.asTool(found) : undefined;
  }

  // Chat asks before each MCP call unless the server is "auto" or the user allowed it here.
  chatNeedsApproval(threadId: string, name: string): boolean {
    const found = this.offered("chat").list.find((o) => o.exposed === name);
    if (!found) return false;
    if (this.server(found.serverId).approval === "auto") return false;
    return !this.chatAllowed.get(threadId)?.has(name);
  }

  allowInChat(threadId: string, name: string): void {
    const set = this.chatAllowed.get(threadId) ?? new Set<string>();
    set.add(name);
    this.chatAllowed.set(threadId, set);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.publishTimer);
    await Promise.all(this.servers.map((s) => this.stop(s.id)));
  }

  // ── Connections ─────────────────────────────────────────────────────────────

  private async connect(id: string): Promise<void> {
    if (this.closed) return;
    const server = this.server(id);
    const live = this.live.get(id)!;
    // At once, so the answer to the change already says it, and the tools are gone from new turns.
    this.setStatus(live, server.enabled ? "connecting" : "disabled", server.enabled ? "Kobler til …" : "Slått av.");
    await this.stop(id);
    if (this.closed || !this.servers.some((s) => s.id === id)) return;
    if (!server.enabled) return this.setStatus(live, "disabled", "Slått av.");
    const generation = ++live.generation;
    // Two connects at once (saved twice quickly): the later one wins, and the earlier one's
    // client, if it got that far, is closed here so its process does not linger.
    if (live.client) void live.client.close().catch(() => undefined);
    live.client = null;
    live.tools = [];
    live.stderr = "";
    Object.assign(live, { serverName: undefined, serverVersion: undefined, protocolVersion: undefined });
    this.setStatus(live, "connecting", "Kobler til …");

    const missing = this.missingSecret(server);
    if (missing) {
      const waiting = this.deps.secrets.status().store === "pending";
      return this.setStatus(live, "error", waiting ? "Mangler hemmeligheten fordi nøkkelringen ikke har svart ennå. Prøver igjen når den svarer." : `Mangler verdien for ${missing}. Skriv den inn på nytt og lagre.`);
    }
    const redact = this.redact(server);
    let transport: Transport;
    if (server.transport === "stdio") {
      transport = new StdioTransport({
        command: server.command,
        args: server.args,
        env: { ...this.deps.env(), ...this.resolvePairs(server, "env") },
        cwd: this.deps.cwd,
        onStderr: (tail) => {
          if (live.generation !== generation) return;
          live.stderr = redact(tail);
          this.changed();
        },
      });
    } else {
      transport = new HttpTransport(server.url, this.resolvePairs(server, "header"));
    }
    const client = new McpClient(transport, {
      clientVersion: this.version,
      onNotification: (method) => {
        if (method === "notifications/tools/list_changed" && live.generation === generation) this.refreshSoon(id, generation);
      },
      onClose: (error) => this.lost(id, generation, error),
    });
    live.client = client;
    try {
      const info = await client.connect(server.transport === "stdio" ? CONNECT_TIMEOUT_STDIO_MS : CONNECT_TIMEOUT_HTTP_MS);
      // A server should declare the tools capability; one that forgets is asked anyway.
      const tools = info.capabilities?.tools ? await client.listTools(LIST_TIMEOUT_MS) : await client.listTools(LIST_TIMEOUT_MS).catch(() => []);
      if (live.generation !== generation) return void (await client.close());
      Object.assign(live, {
        tools,
        serverName: typeof info.serverInfo?.name === "string" ? info.serverInfo.name.slice(0, 100) : undefined,
        serverVersion: typeof info.serverInfo?.version === "string" ? info.serverInfo.version.slice(0, 40) : undefined,
        protocolVersion: info.protocolVersion,
        connectedAt: Date.now(),
      });
      this.setStatus(live, "connected", tools.length === 1 ? "Tilkoblet. 1 verktøy." : `Tilkoblet. ${tools.length} verktøy.`);
    } catch (err) {
      if (live.generation !== generation) return;
      live.client = null;
      await client.close().catch(() => undefined);
      this.setStatus(live, "error", redact(messageOf(err)));
    }
  }

  // The connection went away by itself (the process died, or the HTTP session expired).
  private lost(id: string, generation: number, error?: Error): void {
    const live = this.live.get(id);
    if (!live || live.generation !== generation || this.closed) return;
    const server = this.servers.find((s) => s.id === id);
    if (!server) return;
    const wasConnected = live.status === "connected";
    live.client = null;
    live.tools = [];
    if (Date.now() - live.connectedAt > STABLE_MS) live.restarts = 0;
    const why = this.redact(server)(error ? messageOf(error) : "MCP-serveren stengte tilkoblingen.");
    // Only a server that was working is started again by itself; one that fails to start would
    // just fail again.
    const delay = wasConnected ? RESTART_DELAYS_MS[live.restarts] : undefined;
    if (delay === undefined) return this.setStatus(live, "error", wasConnected ? `${why} Startet på nytt ${live.restarts} ganger; trykk Koble til på nytt.` : why);
    live.restarts++;
    this.setStatus(live, "error", `${why} Prøver igjen om ${Math.round(delay / 1000)} s.`);
    live.restartTimer = setTimeout(() => {
      if (live.generation === generation && !this.closed) void this.connect(id);
    }, delay);
    live.restartTimer.unref();
  }

  private refreshSoon(id: string, generation: number): void {
    const live = this.live.get(id)!;
    clearTimeout(live.refreshTimer);
    live.refreshTimer = setTimeout(async () => {
      const client = live.client;
      if (!client || live.generation !== generation) return;
      try {
        const tools = await client.listTools(LIST_TIMEOUT_MS);
        if (live.generation !== generation) return;
        live.tools = tools;
        this.setStatus(live, "connected", tools.length === 1 ? "Tilkoblet. 1 verktøy." : `Tilkoblet. ${tools.length} verktøy.`);
      } catch {
        // The old list stays; the next connect gets a new one.
      }
    }, 200);
    live.refreshTimer.unref();
  }

  // Stops the connection and the process, and waits until it is gone.
  private async stop(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live) return;
    live.generation++;
    clearTimeout(live.restartTimer);
    clearTimeout(live.refreshTimer);
    const client = live.client;
    live.client = null;
    live.tools = [];
    if (client) live.closing = client.close().catch(() => undefined);
    await live.closing;
    const server = this.servers.find((s) => s.id === id);
    if (server && !server.enabled) this.setStatus(live, "disabled", "Slått av.");
  }

  private async call(offered: Offered, input: unknown, signal: AbortSignal, retried = false): Promise<ToolResult> {
    const server = this.server(offered.serverId);
    const live = this.live.get(server.id)!;
    const redact = this.redact(server);
    // A call that comes while the session is being renewed waits for it.
    if (live.reconnecting) await live.reconnecting;
    const client = live.client;
    if (!client || live.status !== "connected") return { text: `MCP-serveren ${server.name} er ikke tilkoblet nå: ${live.message}`, isError: true };
    try {
      const result = await client.callTool(offered.tool.name, input, server.timeoutSeconds * 1000, signal);
      return toToolResult(result, redact);
    } catch (err) {
      if (signal.aborted) throw err;
      // The POST got 404: the server did not run the call, so it is safe to try once more after
      // one shared reconnect. Calls that hit it together wait for the same reconnect.
      if (err instanceof SessionExpiredError && !retried) {
        if (live.client === client && !live.reconnecting) {
          // The old client is left to finish: its other calls on the dead session get their own
          // 404 and wait for this same reconnect, instead of being cut off as "closed".
          live.client = null;
          live.reconnecting = this.connect(server.id).finally(() => (live.reconnecting = undefined));
          void client.idle(server.timeoutSeconds * 1000).then(() => client.close());
        }
        await live.reconnecting;
        return this.call(offered, input, signal, true);
      }
      return { text: `Feil fra MCP-serveren ${server.name}: ${redact(messageOf(err))}`, isError: true };
    }
  }

  // ── Offered tools ───────────────────────────────────────────────────────────

  // Exposed names for every connected server's tools. They do not depend on the mode, so a tool
  // keeps its name (and its "allow always" rule) in Kode and Chat.
  private names(): Map<string, Map<string, string>> {
    const taken = new Set<string>();
    const names = new Map<string, Map<string, string>>();
    for (const server of this.servers) {
      const tools = new Map<string, string>();
      for (const tool of this.live.get(server.id)?.tools ?? []) if (!tools.has(tool.name)) tools.set(tool.name, exposedName(server.slug, tool.name, taken));
      names.set(server.id, tools);
    }
    return names;
  }

  private offered(mode: Mode): { list: Offered[]; capped: boolean } {
    const names = this.names();
    const list: Offered[] = [];
    let capped = false;
    for (const server of this.servers) {
      const live = this.live.get(server.id);
      if (!server.enabled || !server[mode] || live?.status !== "connected") continue;
      const off = new Set(server.disabledTools);
      for (const tool of live.tools) {
        if (off.has(tool.name)) continue;
        if (list.length >= MCP_TOOL_LIMIT) {
          capped = true;
          break;
        }
        list.push({ serverId: server.id, tool, exposed: names.get(server.id)!.get(tool.name)! });
      }
    }
    return { list, capped };
  }

  private asTool(offered: Offered): Tool {
    const server = this.server(offered.serverId);
    const tool = offered.tool;
    return {
      def: { name: offered.exposed, description: describe(server.name, tool.title, tool.description), parameters: toolSchema(tool.inputSchema) },
      can: `use tools from the MCP server ${cleanServerName(server.name)}`,
      // "read" is what makes decide() never ask; only the user's own "auto" choice gives that.
      kind: server.approval === "auto" ? "read" : "exec",
      summary: () => `${server.name}: ${String(tool.title ?? tool.name).slice(0, 80)}`,
      run: (input, ctx) => this.call(offered, input, ctx.signal),
    };
  }

  // ── Views, storage and secrets ──────────────────────────────────────────────

  private view(server: StoredServer, names: Map<string, Map<string, string>>, inMode: { code: Set<string>; chat: Set<string> }): McpServerView {
    const live = this.live.get(server.id)!;
    const off = new Set(server.disabledTools);
    const tools: McpToolView[] = live.tools.map((tool) => {
      const exposed = names.get(server.id)?.get(tool.name) ?? "";
      return {
        name: tool.name,
        exposed,
        ...(tool.title ? { title: String(tool.title).slice(0, 120) } : {}),
        description: String(tool.description ?? "").slice(0, 300),
        enabled: !off.has(tool.name),
        offered: { code: inMode.code.has(exposed), chat: inMode.chat.has(exposed) },
      };
    });
    return {
      id: server.id,
      name: server.name,
      slug: server.slug,
      transport: server.transport,
      command: server.command,
      args: [...server.args],
      env: server.env.map((p) => this.pairView(server.id, "env", p)),
      url: server.url,
      headers: server.headers.map((p) => this.pairView(server.id, "header", p)),
      enabled: server.enabled,
      code: server.code,
      chat: server.chat,
      approval: server.approval,
      timeoutSeconds: server.timeoutSeconds,
      disabledTools: [...server.disabledTools],
      status: live.status,
      message: live.message,
      stderr: live.stderr,
      tools,
      ...(live.serverName ? { serverName: live.serverName } : {}),
      ...(live.serverVersion ? { serverVersion: live.serverVersion } : {}),
      ...(live.protocolVersion ? { protocolVersion: live.protocolVersion } : {}),
    };
  }

  private pairView(id: string, kind: "env" | "header", pair: StoredPair): McpPairView {
    return pair.secret
      ? { name: pair.name, secret: true, value: "", set: Boolean(this.deps.secrets.get(secretId(id, kind, pair.name))) }
      : { name: pair.name, secret: false, value: pair.value ?? "", set: true };
  }

  private viewOf(id: string): McpServerView {
    return this.snapshot().servers.find((s) => s.id === id)!;
  }

  private server(id: string): StoredServer {
    const server = this.servers.find((s) => s.id === id);
    if (!server) throw new HttpError(404, "Fant ikke MCP-serveren.");
    return server;
  }

  private freshLive(server: StoredServer): Live {
    return { status: server.enabled ? "connecting" : "disabled", message: server.enabled ? "Venter på oppstart …" : "Slått av.", stderr: "", client: null, tools: [], generation: 0, restarts: 0, connectedAt: 0 };
  }

  private setStatus(live: Live, status: McpStatus, message: string): void {
    live.status = status;
    live.message = message.slice(0, 500);
    this.changed();
  }

  // Many changes in a row (stderr lines) go out as one message.
  private changed(): void {
    if (this.closed || this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      if (!this.closed) this.deps.publish(this.snapshot());
    }, PUBLISH_DELAY_MS);
    this.publishTimer.unref();
  }

  private load(): void {
    const value = this.deps.store.metaValue(META_KEY);
    if (!Array.isArray(value)) return;
    let assigned = false;
    for (const item of value) {
      const raw: Record<string, unknown> = item && typeof item === "object" && !Array.isArray(item) ? { ...item } : { value: item };
      let id = typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : randomUUID();
      if (this.servers.some((s) => s.id === id) || this.broken.some((b) => b.id === id)) id = randomUUID();
      raw.id = id;
      try {
        const { server } = this.validate(raw, undefined, id, true);
        const kept = validSlug(raw.slug) && !this.slugs().includes(raw.slug);
        server.slug = kept ? (raw.slug as string) : uniqueSlug(server.name, this.slugs());
        assigned ||= !kept;
        this.servers.push(server);
      } catch (err) {
        console.error("En MCP-server i databasen kunne ikke leses:", messageOf(err));
        this.broken.push({ id, raw, error: messageOf(err) });
      }
    }
    // Slugs given now are written at once, so they stay the same from the next start on.
    if (assigned) this.save();
  }

  private save(): void {
    this.deps.store.setMetaValue(META_KEY, [...this.servers, ...this.broken.map((b) => b.raw)]);
  }

  // Slugs in use, by every server but `except` (broken entries keep theirs reserved).
  private slugs(except?: string): string[] {
    return [
      ...this.servers.filter((s) => s.id !== except).map((s) => s.slug),
      ...this.broken.filter((b) => b.id !== except && validSlug(b.raw.slug)).map((b) => b.raw.slug as string),
    ].filter(Boolean);
  }

  // A slug that no longer names this server: its "allow always" rules in every project and the
  // Chat permissions for it go, so a server that later gets the same slug starts with none.
  private forgetSlug(slug: string): void {
    const prefix = `mcp__${slug}__`;
    this.deps.store.removeToolRulesWithPrefix(prefix);
    for (const names of this.chatAllowed.values()) for (const name of [...names]) if (name.startsWith(prefix)) names.delete(name);
  }

  // A broken entry saved again from the form: a normal server from now on. Secrets stored under
  // the same names are kept, since the keyring ids only depend on the server id and the name.
  private async repair(broken: Broken, input: unknown): Promise<McpServerView> {
    const { server, secrets } = this.validate(input, undefined, broken.id);
    const old = validSlug(broken.raw.slug) ? (broken.raw.slug as string) : undefined;
    server.slug = old && !this.slugs(broken.id).includes(old) ? old : uniqueSlug(server.name, this.slugs(broken.id));
    await this.writeSecrets(server, secrets, undefined);
    this.broken = this.broken.filter((b) => b !== broken);
    this.servers.push(server);
    this.live.set(server.id, this.freshLive(server));
    this.save();
    if (old && old !== server.slug) this.forgetSlug(old);
    void this.connect(server.id);
    return this.viewOf(server.id);
  }

  private resolvePairs(server: StoredServer, kind: "env" | "header"): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of kind === "env" ? server.env : server.headers) {
      out[pair.name] = pair.secret ? (this.deps.secrets.get(secretId(server.id, kind, pair.name)) ?? "") : (pair.value ?? "");
    }
    return out;
  }

  private missingSecret(server: StoredServer): string | undefined {
    for (const [kind, pairs] of [["env", server.env], ["header", server.headers]] as const) {
      for (const pair of pairs) if (pair.secret && !this.deps.secrets.get(secretId(server.id, kind, pair.name))) return pair.name;
    }
    return undefined;
  }

  private redact(server: StoredServer): (text: string) => string {
    const values: string[] = [];
    for (const [kind, pairs] of [["env", server.env], ["header", server.headers]] as const) {
      for (const pair of pairs) if (pair.secret) values.push(this.deps.secrets.get(secretId(server.id, kind, pair.name)) ?? "");
    }
    return redactor(values);
  }

  // New secret values go to the keyring; secrets that were renamed, made plain or removed go away.
  private async writeSecrets(server: StoredServer, secrets: Record<string, string>, previous: StoredServer | undefined): Promise<void> {
    for (const [id, value] of Object.entries(secrets)) await this.deps.secrets.set(id, value);
    if (!previous) return;
    const keep = new Set([...server.env.filter((p) => p.secret).map((p) => secretId(server.id, "env", p.name)), ...server.headers.filter((p) => p.secret).map((p) => secretId(server.id, "header", p.name))]);
    for (const [kind, pairs] of [["env", previous.env], ["header", previous.headers]] as const) {
      for (const pair of pairs) {
        const id = secretId(server.id, kind, pair.name);
        if (pair.secret && !keep.has(id)) await this.deps.secrets.set(id, null);
      }
    }
  }

  // Checks and cleans what the UI sent. `stored` is for what is read back from the database,
  // which has no secret values in it.
  private validate(raw: unknown, current: StoredServer | undefined, id: string, stored = false): { server: StoredServer; secrets: Record<string, string> } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Forventer en MCP-server.");
    const input = raw as Partial<McpServerInput>;
    const pick = <K extends keyof McpServerInput>(key: K, fallback: NonNullable<McpServerInput[K]>): NonNullable<McpServerInput[K]> =>
      (input[key] ?? (current as unknown as McpServerInput | undefined)?.[key] ?? fallback) as NonNullable<McpServerInput[K]>;

    const name = String(pick("name", "")).trim();
    if (!name || name.length > 60) throw new HttpError(400, "Gi serveren et navn på opptil 60 tegn.");
    const transport = pick("transport", "stdio");
    if (transport !== "stdio" && transport !== "http") throw new HttpError(400, "Velg stdio eller HTTP.");
    const approval = pick("approval", "ask");
    if (approval !== "ask" && approval !== "auto") throw new HttpError(400, "Godkjenning må være «spør» eller «automatisk».");
    const timeoutSeconds = Number(pick("timeoutSeconds", DEFAULT_TIMEOUT_S));
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 600) throw new HttpError(400, "Tidsgrensen må være mellom 5 og 600 sekunder.");
    const bool = (key: "enabled" | "code" | "chat", fallback: boolean) => {
      const value = pick(key, fallback);
      if (typeof value !== "boolean") throw new HttpError(400, `${key} må være sann eller usann.`);
      return value;
    };
    const disabledTools = pick("disabledTools", []);
    if (!Array.isArray(disabledTools) || disabledTools.length > 2000 || disabledTools.some((t) => typeof t !== "string" || t.length > 200)) throw new HttpError(400, "Ugyldig liste over verktøy som er av.");

    const secrets: Record<string, string> = {};
    let command = "";
    let args: string[] = [];
    let url = "";
    let env: StoredPair[] = [];
    let headers: StoredPair[] = [];
    if (transport === "stdio") {
      command = String(pick("command", "")).trim();
      if (!command || command.length > 500 || /[\r\n\0]/.test(command)) throw new HttpError(400, "Skriv inn kommandoen som starter serveren, for eksempel npx.");
      args = pick("args", []);
      if (!Array.isArray(args) || args.length > 50 || args.some((a) => typeof a !== "string" || a.length > 2000 || a.includes("\0"))) throw new HttpError(400, "Ugyldige argumenter.");
      env = this.pairs(input.env, current?.env, current && current.transport === transport ? current : undefined, id, "env", secrets, stored);
    } else {
      url = String(pick("url", "")).trim();
      checkUrl(url);
      headers = this.pairs(input.headers, current?.headers, current && current.transport === transport ? current : undefined, id, "header", secrets, stored);
    }
    return {
      server: { id, name, slug: current?.slug ?? "", transport, command, args: [...args], env, url, headers, enabled: bool("enabled", true), code: bool("code", true), chat: bool("chat", false), approval, timeoutSeconds, disabledTools: [...new Set(disabledTools)] },
      secrets,
    };
  }

  private pairs(raw: McpPairInput[] | undefined, previous: StoredPair[] | undefined, current: StoredServer | undefined, id: string, kind: "env" | "header", secrets: Record<string, string>, stored: boolean): StoredPair[] {
    if (raw === undefined) return previous ? previous.map((p) => ({ ...p })) : [];
    if (!Array.isArray(raw) || raw.length > MAX_PAIRS) throw new HttpError(400, kind === "env" ? "Ugyldige miljøvariabler." : "Ugyldige HTTP-hoder.");
    const seen = new Set<string>();
    const out: StoredPair[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") throw new HttpError(400, "Ugyldig verdi.");
      const name = String(item.name ?? "").trim();
      if (!name) continue;
      if (kind === "env" && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new HttpError(400, `Ugyldig navn på miljøvariabel: ${name.slice(0, 40)}`);
      if (kind === "header" && !/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(name)) throw new HttpError(400, `Ugyldig navn på hode: ${name.slice(0, 40)}`);
      if (kind === "header" && RESERVED_HEADERS.has(name.toLowerCase())) throw new HttpError(400, `Hodet ${name} settes av appen selv.`);
      const key = kind === "header" ? name.toLowerCase() : name;
      if (seen.has(key)) throw new HttpError(400, `${name} står to ganger.`);
      seen.add(key);
      const secret = Boolean(item.secret) || (kind === "env" ? SECRET_ENV.test(name) : SECRET_HEADER.test(name));
      let value = typeof item.value === "string" ? item.value : "";
      if (value.length > 8000 || /[\r\n\0]/.test(value)) throw new HttpError(400, `Verdien for ${name} er for lang eller har linjeskift.`);
      if (stored) {
        out.push(secret ? { name, secret: true } : { name, secret: false, value });
        continue;
      }
      if (!secret) {
        out.push({ name, secret: false, value });
        continue;
      }
      // A token pasted on its own in Authorization gets the usual "Bearer " in front.
      if (kind === "header" && key === "authorization" && value && !/\s/.test(value.trim())) value = `Bearer ${value.trim()}`;
      if (value) secrets[secretId(id, kind, name)] = value;
      else {
        // Empty: keep the value stored under this name, if there is one; a plain value that is
        // made secret moves to the keyring.
        const before = current ? (kind === "env" ? current.env : current.headers).find((p) => (kind === "header" ? p.name.toLowerCase() === key : p.name === name)) : undefined;
        if (before && !before.secret && before.value) secrets[secretId(id, kind, name)] = before.value;
        else if (before?.secret && before.name !== name) {
          const old = this.deps.secrets.get(secretId(id, kind, before.name));
          if (old) secrets[secretId(id, kind, name)] = old;
        }
      }
      out.push({ name, secret: true });
    }
    return out;
  }
}

// The keyring entry for one secret of one server. Header names are case-insensitive.
export function secretId(serverId: string, kind: "env" | "header", name: string): string {
  return `mcp:${serverId}:${kind}:${kind === "header" ? name.toLowerCase() : name}`;
}

function connectionKey(server: StoredServer): string {
  return JSON.stringify([server.transport, server.command, server.args, server.env, server.url, server.headers]);
}

// https, or plain http only to this machine: a token must never cross the network in clear text.
function checkUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "Skriv inn en gyldig adresse, for eksempel https://api.githubcopilot.com/mcp/.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) throw new HttpError(400, "Adressen må bruke https (http er bare lov til denne maskinen).");
  if (parsed.username || parsed.password) throw new HttpError(400, "Legg brukernavn og passord i et hode, ikke i adressen.");
  if (url.length > 2000) throw new HttpError(400, "Adressen er for lang.");
}

function messageOf(err: unknown): string {
  return String((err as Error)?.message ?? err ?? "Ukjent feil").slice(0, 500);
}

// How a broken entry is shown: a server in error, off, with nothing from its raw values.
function brokenView(broken: Broken): McpServerView {
  const raw = broken.raw;
  return {
    id: broken.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : "Ukjent server",
    slug: validSlug(raw.slug) ? raw.slug : "",
    transport: raw.transport === "http" ? "http" : "stdio",
    command: typeof raw.command === "string" ? raw.command.slice(0, 500) : "",
    args: [],
    env: [],
    url: typeof raw.url === "string" ? raw.url.slice(0, 2000) : "",
    headers: [],
    enabled: false,
    code: false,
    chat: false,
    approval: "ask",
    timeoutSeconds: DEFAULT_TIMEOUT_S,
    disabledTools: [],
    status: "error",
    message: `Innstillingene kunne ikke leses: ${broken.error} Rediger serveren og lagre, eller slett den.`.slice(0, 500),
    stderr: "",
    tools: [],
  };
}

// A server name is written by the user, but it ends up in the model's instructions: keep it to a
// short single line.
function cleanServerName(name: string): string {
  return name.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 40) || "MCP";
}
