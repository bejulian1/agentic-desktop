// The Streamable HTTP transport (MCP 2025-03-26 and later): every message from the client is its
// own POST to one endpoint. The answer to a request comes back either as JSON or as an event
// stream (text/event-stream) that may carry notifications and server requests before the answer.
// A notification or a response gets 202 Accepted with no body.
//
// Session: the server may give an Mcp-Session-Id on the initialize answer; it is sent on every
// request after that, and a 404 on a POST then means the session is gone (SessionExpiredError, and
// the manager connects again). After initialize the client sends MCP-Protocol-Version.
//
// Streams:
// - A POST's event stream may end before the answer. If its events had ids, the client resumes
//   with GET and Last-Event-ID, waiting what the server's retry: field says, a few times; if not,
//   the request fails at once with a clear message instead of waiting for its timeout.
// - Once notifications/initialized is sent, the client opens the optional GET stream that carries
//   server notifications such as tools/list_changed. 405 or 404 there means the server has none.
//   When the server or a proxy closes it, it is opened again after a growing pause, a few times.
// - Every request's fetch has its own AbortController. It is aborted when the answer has come
//   (client.ts), when the client gives up, and when the transport closes, so no stream is left open.
// On close the session is ended with DELETE.
//
// Headers can hold secrets (Authorization). They are only ever put on these requests, never in an
// error message, and redirects are refused so they are never sent to another address.
import type { JsonRpcId, JsonRpcMessage, Transport } from "./client.ts";

const MAX_BODY = 32 * 1024 * 1024;
const DELETE_TIMEOUT_MS = 2000;
const RESUME_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRY_MS = 10_000;
const LISTEN_DELAYS_MS = [1000, 5000, 15_000, 30_000, 60_000]; // reopening the GET stream, in a row
const LISTEN_STABLE_MS = 60_000; // open this long: the next close starts the count again

export class SessionExpiredError extends Error {
  constructor() {
    super("MCP-økten er utløpt.");
  }
}

// What reading one event stream found.
interface StreamResult {
  answered: boolean; // the answer to the request it belongs to came
  lastEventId?: string;
  retryMs?: number;
}

export class HttpTransport implements Transport {
  private url: string;
  private headers: Record<string, string>;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private onMessage: (message: JsonRpcMessage) => void = () => undefined;
  private inflight = new Set<AbortController>();
  private closed = false;
  // The GET stream for server notifications.
  private listening = false;
  private listenOff = false; // the server does not offer one
  private listenFailures = 0;
  private listenTimer?: NodeJS.Timeout;
  private listenEventId?: string;

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }

  async start(handlers: { onMessage: (message: JsonRpcMessage) => void; onClose: (error?: Error) => void }): Promise<void> {
    this.onMessage = handlers.onMessage;
    // Nothing on HTTP closes the connection by itself: an expired session is seen on the next POST.
  }

  initialized(protocolVersion: string): void {
    this.protocolVersion = protocolVersion;
  }

  ready(): void {
    void this.listen();
  }

  async send(message: JsonRpcMessage, signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error("Tilkoblingen til MCP-serveren er stengt.");
    const { controller, done } = this.track(signal);
    try {
      let res: Response;
      try {
        res = await fetch(this.url, {
          method: "POST",
          headers: { ...this.requestHeaders(), "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify(message),
          signal: controller.signal,
          redirect: "error",
        });
      } catch (err) {
        if (controller.signal.aborted) throw new Error("Avbrutt.");
        throw new Error(`Fikk ikke kontakt med ${this.origin()}: ${causeOf(err)}`);
      }
      const session = res.headers.get("mcp-session-id");
      if (session && /^[\x21-\x7e]{1,512}$/.test(session)) this.sessionId = session;
      if (res.status === 202) return void (await res.body?.cancel());
      if (res.status === 404 && this.sessionId && message.method !== "initialize") {
        await res.body?.cancel();
        throw new SessionExpiredError();
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(httpError(res.status, this.origin()));
      }
      const type = res.headers.get("content-type") ?? "";
      const awaited = message.method !== undefined && message.id !== undefined && message.id !== null ? message.id : undefined;
      if (type.includes("text/event-stream")) {
        const stream = await this.readEvents(res, controller.signal, awaited);
        if (awaited === undefined || stream.answered || controller.signal.aborted) return;
        return await this.resume(stream, awaited, controller.signal);
      }
      if (!res.body) return;
      const text = await readText(res);
      if (!text.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`${this.origin()} svarte ikke med JSON (${type.slice(0, 60) || "ingen innholdstype"}).`);
      }
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) this.onMessage(item as JsonRpcMessage);
    } finally {
      done();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.listenTimer);
    for (const controller of this.inflight) controller.abort();
    this.inflight.clear();
    if (!this.sessionId) return;
    // Ends the session on the server. 405 is allowed; nothing to do about other answers either.
    try {
      const res = await fetch(this.url, { method: "DELETE", headers: this.requestHeaders(), signal: AbortSignal.timeout(DELETE_TIMEOUT_MS), redirect: "error" });
      await res.body?.cancel();
    } catch {
      // gone already
    }
  }

  // How many fetches are open now (requests and the GET stream). For tests.
  get openRequests(): number {
    return this.inflight.size;
  }

  // An AbortController for one fetch, aborted with the caller's signal and on close.
  private track(signal?: AbortSignal): { controller: AbortController; done: () => void } {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    this.inflight.add(controller);
    return {
      controller,
      done: () => {
        signal?.removeEventListener("abort", onAbort);
        this.inflight.delete(controller);
      },
    };
  }

  private requestHeaders(): Record<string, string> {
    return {
      ...this.headers,
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      // Defined from 2025-06-18; older servers did not have it.
      ...(this.protocolVersion && this.protocolVersion >= "2025-06-18" ? { "MCP-Protocol-Version": this.protocolVersion } : {}),
    };
  }

  // The POST stream ended before the answer. With event ids the server can replay what is left
  // on a GET with Last-Event-ID (spec: resumability); without them there is nothing to wait for.
  private async resume(first: StreamResult, awaited: JsonRpcId, signal: AbortSignal): Promise<void> {
    let state = first;
    let attempts = 0;
    for (; state.lastEventId !== undefined && attempts < RESUME_ATTEMPTS; attempts++) {
      await pause(Math.min(state.retryMs ?? DEFAULT_RETRY_MS, MAX_RETRY_MS), signal);
      if (signal.aborted || this.closed) return;
      let res: Response;
      try {
        res = await fetch(this.url, { method: "GET", headers: { ...this.requestHeaders(), accept: "text/event-stream", "Last-Event-ID": state.lastEventId }, signal, redirect: "error" });
      } catch {
        if (signal.aborted) return;
        continue;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        await res.body?.cancel();
        break;
      }
      const next = await this.readEvents(res, signal, awaited);
      if (next.answered || signal.aborted) return;
      state = { lastEventId: next.lastEventId ?? state.lastEventId, retryMs: next.retryMs ?? state.retryMs, answered: false };
    }
    throw new Error(
      first.lastEventId === undefined
        ? `${this.origin()} avsluttet svaret før svaret på kallet kom.`
        : `${this.origin()} avsluttet svaret før svaret på kallet kom, og det kunne ikke hentes igjen (${Math.max(attempts, 1)} forsøk).`,
    );
  }

  // The optional stream the server can send notifications on without a request.
  private async listen(): Promise<void> {
    if (this.closed || this.listening || this.listenOff) return;
    this.listening = true;
    const { controller, done } = this.track();
    const started = Date.now();
    let retryMs: number | undefined;
    try {
      const res = await fetch(this.url, {
        method: "GET",
        headers: { ...this.requestHeaders(), accept: "text/event-stream", ...(this.listenEventId ? { "Last-Event-ID": this.listenEventId } : {}) },
        signal: controller.signal,
        redirect: "error",
      });
      // 405: no stream on this server. 404: the same here, never an expired session; only a POST
      // says that, so a fresh session is not thrown away because the server has no GET stream.
      if (res.status === 405 || res.status === 404) {
        this.listenOff = true;
        await res.body?.cancel();
        return;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        await res.body?.cancel();
      } else {
        const stream = await this.readEvents(res, controller.signal);
        if (stream.lastEventId !== undefined) this.listenEventId = stream.lastEventId;
        retryMs = stream.retryMs;
      }
    } catch {
      // Network trouble or closed: tried again below unless the transport is closing.
    } finally {
      done();
      this.listening = false;
    }
    if (this.closed || this.listenOff) return;
    if (Date.now() - started > LISTEN_STABLE_MS) this.listenFailures = 0;
    const delay = LISTEN_DELAYS_MS[this.listenFailures++];
    if (delay === undefined) return; // given up; list changes are still seen on the next connect
    this.listenTimer = setTimeout(() => void this.listen(), Math.max(delay, Math.min(retryMs ?? 0, MAX_RETRY_MS)));
    this.listenTimer.unref();
  }

  // Server-sent events: blocks separated by a blank line, data: lines joined with "\n". Events
  // without data (the priming event the spec recommends) are skipped. id: and retry: are kept for
  // resuming. Ends quietly when the stream is aborted (the answer came, or the transport closed).
  private async readEvents(res: Response, signal: AbortSignal, awaited?: JsonRpcId): Promise<StreamResult> {
    const result: StreamResult = { answered: false };
    if (!res.body) return result;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let data: string[] = [];
    let size = 0;
    const dispatch = () => {
      if (!data.length) return;
      const payload = data.join("\n");
      data = [];
      size = 0;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return; // not a JSON-RPC message; ignored
      }
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        const message = item as JsonRpcMessage;
        if (awaited !== undefined && message && message.method === undefined && message.id === awaited) result.answered = true;
        this.onMessage(message);
      }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line === "") dispatch();
          else if (line.startsWith("data:")) {
            const part = line.slice(5).replace(/^ /, "");
            size += part.length;
            if (size > MAX_BODY) throw new Error("For stor hendelse fra MCP-serveren.");
            data.push(part);
          } else if (line.startsWith("id:")) {
            const id = line.slice(3).replace(/^ /, "");
            if (!id.includes("\0") && id.length <= 1024) result.lastEventId = id;
          } else if (line.startsWith("retry:")) {
            const ms = Number(line.slice(6).trim());
            if (Number.isInteger(ms) && ms >= 0) result.retryMs = ms;
          }
          // event: and comments are not needed.
        }
        if (buffer.length > MAX_BODY) throw new Error("For stor hendelse fra MCP-serveren.");
        if (result.answered && awaited !== undefined) break; // nothing more to wait for on this stream
      }
      dispatch();
    } catch (err) {
      if (!signal.aborted) {
        await reader.cancel().catch(() => undefined);
        if (!result.answered) throw err;
      }
      return result;
    }
    await reader.cancel().catch(() => undefined);
    return result;
  }

  private origin(): string {
    try {
      return new URL(this.url).host;
    } catch {
      return "serveren";
    }
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function readText(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error("For stort svar fra MCP-serveren.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function httpError(status: number, host: string): string {
  if (status === 401 || status === 403) return `${host} avviste tilgangen (HTTP ${status}). Sjekk tokenet eller hodene.`;
  if (status === 404) return `${host} fant ikke MCP-adressen (HTTP 404). Sjekk adressen.`;
  if (status === 405) return `${host} tar ikke imot MCP over Streamable HTTP på denne adressen (HTTP 405).`;
  return `${host} svarte med HTTP ${status}.`;
}

function causeOf(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  return String(cause?.code ?? cause?.message ?? (err as Error)?.message ?? err).slice(0, 120);
}
