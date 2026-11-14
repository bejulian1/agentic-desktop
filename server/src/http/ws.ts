// One multiplexed WebSocket per window. Any number of sockets can follow the same thread,
// terminal or browser page, which is what keeps several windows in sync.
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { cleanTabId, type BrowserManager } from "../browser.ts";

// A tab named by the panel, or the one it showed last when the message names none.
const tabOf = (message: { tabId?: unknown }): string | undefined => (message.tabId === undefined ? undefined : cleanTabId(message.tabId));
const requestIdOf = (message: { requestId?: unknown }): string | undefined => typeof message.requestId === "string" && message.requestId.length > 0 && message.requestId.length <= 100 && !/[\u0000-\u001f\u007f]/.test(message.requestId) ? message.requestId : undefined;
import type { Store } from "../db.ts";
import type { Terminals } from "../terminal.ts";
import type { ClientMessage, Project, ServerMessage, ThreadEventEnvelope } from "../../../shared/protocol.ts";
import { LOCAL_PANEL } from "../paths.ts";
import type { Security } from "./security.ts";

const MAX_BUFFERED = 32 * 1024 * 1024;
const MAX_BACKLOG = 20_000;
const HEARTBEAT_MS = 30_000;

export class Client {
  ws: WebSocket;
  threads = new Set<string>();
  alive = true;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  send(message: ServerMessage): void {
    this.sendText(JSON.stringify(message));
  }

  // A message already serialized, so one sent to many windows is serialized once.
  sendText(text: string): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    // A client this far behind reconnects and catches up from its last seq.
    if (this.ws.bufferedAmount > MAX_BUFFERED) return this.ws.terminate();
    this.ws.send(text);
  }

  buffered(): number {
    return this.ws.bufferedAmount;
  }
}

export interface HubDeps {
  store: Store;
  security: Security;
  terminals: Terminals;
  browser: BrowserManager;
  flushThread: (threadId: string) => void;
  localFolder?: () => string; // round 9: the terminal's folder on Denne datamaskinen
}

export class Hub {
  private deps: HubDeps;
  private wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  private clients = new Set<Client>();
  private threadClients = new Map<string, Set<Client>>();
  private lastViewed = new Map<string, number>(); // when the last window let go of a thread
  private heartbeat?: NodeJS.Timeout;

  constructor(deps: HubDeps) {
    this.deps = deps;
  }

  // Host, Origin and the one-time ticket are all checked before the upgrade is handled.
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const { security } = this.deps;
    const url = URL.parse(req.url ?? "/", "http://localhost");
    const allowed = url !== null
      && security.hostAllowed(req)
      && security.originAllowed(req, true)
      && url.pathname === "/ws"
      && security.redeemTicket(url.searchParams.get("ticket"));
    if (!allowed) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
  }

  private accept(ws: WebSocket): void {
    const client = new Client(ws);
    this.clients.add(client);
    this.heartbeat ??= setInterval(() => this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
    ws.on("pong", () => (client.alive = true));
    ws.on("message", (data) => void this.onMessage(client, data.toString()));
    ws.on("error", () => ws.terminate());
    ws.on("close", () => this.remove(client));
  }

  private beat(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }

  // When a window last showed the thread: now while one does, else when the last one let go.
  // The sweep of temporary chats leaves alone what someone has open (chat-routes.ts).
  viewedAt(threadId: string): number | undefined {
    if (this.threadClients.get(threadId)?.size) return Date.now();
    return this.lastViewed.get(threadId);
  }

  private remove(client: Client): void {
    this.clients.delete(client);
    for (const threadId of client.threads) {
      this.threadClients.get(threadId)?.delete(client);
      this.lastViewed.set(threadId, Date.now());
    }
    this.deps.terminals.detach(client);
    void this.deps.browser.detach(client);
    if (!this.clients.size) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    let message: ClientMessage;
    try {
      const value: unknown = JSON.parse(raw);
      if (value === null || typeof value !== "object" || Array.isArray(value) || !("type" in value) || typeof value.type !== "string" || !value.type) {
        return client.send({ type: "error", message: "Ugyldig melding" });
      }
      message = value as ClientMessage;
    } catch {
      return client.send({ type: "error", message: "Ugyldig melding" });
    }
    try {
      await this.handle(client, message);
    } catch (err) {
      if (typeof message.type === "string" && message.type.startsWith("browser.") && "projectId" in message) {
        const requestId = "requestId" in message ? requestIdOf(message) : undefined;
        client.send({ type: "browser.error", projectId: message.projectId, tabId: "tabId" in message ? tabOf(message) : undefined, message: (err as Error).message || "Nettleserhandlingen mislyktes", command: message.type, ...(requestId === undefined ? {} : { requestId }) });
        return;
      }
      client.send({ type: "error", message: (err as Error).message || "Noe gikk galt" });
    }
  }

  // Not a project in the store: only the id and the folder the terminal needs.
  private localProject(): Project {
    const folder = this.deps.localFolder?.();
    if (!folder) throw new Error("Terminalen uten prosjekt er ikke tilgjengelig");
    return { id: LOCAL_PANEL, name: "Denne datamaskinen", path: folder, permissionMode: "ask", createdAt: 0, lastUsedAt: 0, color: null, icon: null, defaultModelId: null, pinned: false };
  }

  private project(projectId: string) {
    const project = this.deps.store.project(projectId);
    if (!project) throw new Error("Fant ikke prosjektet");
    return project;
  }

  private async handle(client: Client, message: ClientMessage): Promise<void> {
    const { store, terminals, browser } = this.deps;
    // Round 9: the terminal and the Browser panel also open without a project, on Denne datamaskinen.
    const local = "projectId" in message && message.projectId === LOCAL_PANEL && (message.type.startsWith("terminal.") || message.type.startsWith("browser."));
    if ("projectId" in message && !local) this.project(message.projectId);
    switch (message.type) {
      case "thread.subscribe": {
        if (!store.thread(message.threadId)) throw new Error("Fant ikke tråden");
        this.deps.flushThread(message.threadId);
        // SQLite reads are sync, so nothing can fall between the backlog and the subscription.
        // The stored JSON goes out as it is, the same text as client.send({ type: "thread.event", envelope }).
        for (const envelope of store.eventsJson(message.threadId, Number(message.afterSeq) || 0, MAX_BACKLOG)) {
          client.sendText(`{"type":"thread.event","envelope":${envelope}}`);
        }
        client.threads.add(message.threadId);
        let subscribers = this.threadClients.get(message.threadId);
        if (!subscribers) this.threadClients.set(message.threadId, (subscribers = new Set()));
        subscribers.add(client);
        return;
      }
      case "thread.unsubscribe":
        client.threads.delete(message.threadId);
        this.threadClients.get(message.threadId)?.delete(client);
        this.lastViewed.set(message.threadId, Date.now());
        return;
      case "terminal.open":
        return terminals.open(client, local ? this.localProject() : store.project(message.projectId)!, message);
      case "terminal.input":
        return terminals.input(message.terminalId, String(message.data));
      case "terminal.resize":
        return terminals.resize(message.terminalId, message.cols, message.rows);
      case "terminal.close":
        return terminals.close(message.terminalId);
      case "browser.open":
        return browser.attach(client, message.projectId, message.width, message.height, tabOf(message), message.native === true);
      case "browser.close":
        return browser.detach(client, message.projectId);
      case "browser.close-tab":
        return browser.closeTab(message.projectId, cleanTabId(message.tabId));
      case "browser.navigate":
        await browser.navigate(message.projectId, message.url, tabOf(message));
        return;
      case "browser.history":
        return browser.history(message.projectId, message.action, tabOf(message));
      case "browser.resize":
        return browser.resize(message.projectId, message.width, message.height, tabOf(message));
      case "browser.input":
        return browser.input(message.projectId, message.event, tabOf(message));
      case "browser.frame-ack":
        return browser.frameAck(message.projectId, message.sessionId, cleanTabId(message.tabId));
      case "browser.find": {
        const text = String(message.text ?? "").slice(0, 200);
        const found = await browser.find(message.projectId, text, message.backwards === true, tabOf(message));
        return client.send({ type: "browser.found", projectId: message.projectId, tabId: cleanTabId(message.tabId), text, found });
      }
      case "browser.clear-data":
        await browser.clearData(message.projectId);
        return client.send({ type: "browser.cleared", projectId: message.projectId });
      default:
        throw new Error("Ukjent meldingstype");
    }
  }

  publishEvent(envelope: ThreadEventEnvelope): void {
    const subscribers = this.threadClients.get(envelope.threadId);
    if (!subscribers?.size) return;
    const text = JSON.stringify({ type: "thread.event", envelope } satisfies ServerMessage);
    for (const client of subscribers) client.sendText(text);
  }

  broadcast(message: ServerMessage): void {
    if (!this.clients.size) return;
    const text = JSON.stringify(message);
    for (const client of this.clients) client.sendText(text);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.ws.terminate();
    this.wss.close();
  }
}
