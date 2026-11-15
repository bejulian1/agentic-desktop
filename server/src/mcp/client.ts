// A small MCP client (Model Context Protocol): JSON-RPC 2.0 over a transport (stdio.ts or http.ts).
// It does what the app needs and no more: the initialize handshake, tools/list with pagination,
// tools/call with a timeout and cancellation, answering ping, and telling the owner when the
// server says its tool list changed. Everything else a server asks for (sampling, roots,
// elicitation) is refused with "method not found", since the client declares no capabilities.
//
// Protocol: the "Legacy" lifecycle of revision 2025-11-25 (initialize, then
// notifications/initialized), which older revisions share. The client asks for 2025-11-25 and
// accepts the older versions a server may answer with. The 2026-07-28 revision without initialize
// is not implemented; a server that only speaks that gets a clear error (see initialize below).

export const PROTOCOL_VERSION = "2025-11-25";
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const MAX_TOOL_PAGES = 20;
const MAX_TOOLS = 1000;

export type JsonRpcId = number | string;

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

// What a transport does: start, send one message, and close. Messages from the server arrive
// through onMessage; onClose is called once, with an error unless the client closed it.
export interface Transport {
  start(handlers: { onMessage: (message: JsonRpcMessage) => void; onClose: (error?: Error) => void }): Promise<void>;
  send(message: JsonRpcMessage, signal?: AbortSignal): Promise<void>;
  // Called with the negotiated version after initialize, before notifications/initialized, so
  // HTTP sends MCP-Protocol-Version on that and every later request.
  initialized?(protocolVersion: string): void;
  // Called once notifications/initialized has been sent: HTTP may open its event stream now.
  ready?(): void;
  close(): Promise<void>;
}

// An error the server answered with (a JSON-RPC error object), or one the client made itself.
export class McpError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>; // hints only; never trusted for approvals
}

export interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  resource?: { uri?: string; mimeType?: string; text?: string; blob?: string };
}

export interface McpCallResult {
  content: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: Record<string, any>;
  serverInfo?: { name?: string; version?: string };
  instructions?: string;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export interface ClientOptions {
  clientVersion: string;
  onNotification?: (method: string, params: any) => void;
  onClose?: (error?: Error) => void;
}

export class McpClient {
  private transport: Transport;
  private options: ClientOptions;
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private closed = false;
  info: InitializeResult | null = null;

  constructor(transport: Transport, options: ClientOptions) {
    this.transport = transport;
    this.options = options;
  }

  // Starts the transport and does the handshake. Throws with a message for the status view.
  async connect(timeoutMs: number): Promise<InitializeResult> {
    await this.transport.start({
      onMessage: (message) => this.receive(message),
      onClose: (error) => this.lost(error),
    });
    let result: InitializeResult;
    try {
      result = await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "agentic-desktop", title: "Agentic Desktop", version: this.options.clientVersion },
      }, { timeoutMs, cancellable: false }); // initialize must never be cancelled (spec)
    } catch (err) {
      throw initializeError(err);
    }
    if (!result || typeof result !== "object" || typeof result.protocolVersion !== "string") {
      throw new McpError(-32603, "Serveren svarte på initialize uten protocolVersion.");
    }
    if (!SUPPORTED_VERSIONS.includes(result.protocolVersion)) {
      throw new McpError(-32602, `Serveren bruker MCP-versjon ${result.protocolVersion.slice(0, 40)}, som appen ikke støtter. Appen støtter ${SUPPORTED_VERSIONS.join(", ")}.`);
    }
    this.info = { ...result, capabilities: result.capabilities ?? {} };
    this.transport.initialized?.(result.protocolVersion);
    await this.notify("notifications/initialized");
    this.transport.ready?.();
    return this.info;
  }

  // Every page of tools/list, up to a sane limit.
  async listTools(timeoutMs: number): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const result = await this.request("tools/list", cursor === undefined ? {} : { cursor }, { timeoutMs });
      for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
        if (tool && typeof tool.name === "string" && tool.name) tools.push(tool);
        if (tools.length >= MAX_TOOLS) return tools;
      }
      cursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (cursor === undefined) return tools;
    }
    return tools;
  }

  callTool(name: string, args: unknown, timeoutMs: number, signal?: AbortSignal): Promise<McpCallResult> {
    return this.request("tools/call", { name, arguments: args ?? {} }, { timeoutMs, signal });
  }

  // One request. On timeout or abort the server is told with notifications/cancelled, and the
  // promise rejects at once; a late answer is ignored.
  request(method: string, params: unknown, options: { timeoutMs: number; signal?: AbortSignal; cancellable?: boolean }): Promise<any> {
    if (this.closed) return Promise.reject(new McpError(-32000, "Tilkoblingen til MCP-serveren er stengt."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const stop = (error: Error, tellServer: boolean) => {
        if (!this.pending.has(id)) return;
        this.pending.get(id)!.cleanup();
        this.pending.delete(id);
        if (tellServer && options.cancellable !== false && !this.closed) {
          void this.notify("notifications/cancelled", { requestId: id, reason: error.message }).catch(() => undefined);
        }
        controller.abort();
        reject(error);
      };
      const timer = setTimeout(() => stop(new McpError(-32001, `MCP-serveren svarte ikke innen ${Math.round(options.timeoutMs / 1000)} sekunder.`), true), options.timeoutMs);
      const onAbort = () => stop(new McpError(-32800, "Avbrutt."), true);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        // Also ends the transport's work for this request: over HTTP, the response stream that
        // carried the answer (or would have) is closed instead of left open.
        cleanup: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          controller.abort();
        },
      });
      if (options.signal?.aborted) return onAbort();
      // An HTTP error on the POST itself (401, 404 …) ends the request at once.
      this.transport.send({ jsonrpc: "2.0", id, method, params }, controller.signal).catch((err) => stop(err instanceof Error ? err : new Error(String(err)), false));
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) return Promise.resolve();
    return this.transport.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new McpError(-32000, "Tilkoblingen til MCP-serveren ble stengt."));
    await this.transport.close();
  }

  // Resolves when no request is waiting for an answer any more, or after timeoutMs.
  async idle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size && !this.closed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private receive(message: JsonRpcMessage): void {
    if (!message || typeof message !== "object") return;
    // A response to one of ours.
    if (message.method === undefined && message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (!pending) return; // cancelled, timed out, or never ours
      pending.cleanup();
      this.pending.delete(message.id);
      if (message.error) pending.reject(new McpError(Number(message.error.code) || -32603, String(message.error.message ?? "Ukjent feil fra MCP-serveren").slice(0, 2000), message.error.data));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method !== "string") return;
    // A request from the server: ping is answered, everything else is refused.
    if (message.id !== undefined && message.id !== null) {
      const reply: JsonRpcMessage = message.method === "ping"
        ? { jsonrpc: "2.0", id: message.id, result: {} }
        : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Agentic Desktop støtter ikke ${message.method.slice(0, 80)}` } };
      void this.transport.send(reply).catch(() => undefined);
      return;
    }
    this.options.onNotification?.(message.method, message.params);
  }

  private lost(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(error ?? new McpError(-32000, "MCP-serveren stengte tilkoblingen."));
    this.options.onClose?.(error);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

// A server that only speaks the 2026-07-28 revision answers initialize with an error that lists
// the versions it supports. Said plainly, since there is nothing the user can change here.
function initializeError(err: unknown): Error {
  if (!(err instanceof McpError)) return err instanceof Error ? err : new Error(String(err));
  const supported = (err.data as { supported?: unknown } | undefined)?.supported;
  if (Array.isArray(supported) && supported.length && !supported.some((v) => SUPPORTED_VERSIONS.includes(String(v)))) {
    return new McpError(err.code, `Serveren støtter bare MCP-versjon ${supported.map(String).join(", ").slice(0, 80)}. Appen støtter ${SUPPORTED_VERSIONS.join(", ")}.`);
  }
  return err;
}
