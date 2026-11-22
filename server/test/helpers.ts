// Test harness. Every server gets a temporary data dir and a random port, and is closed even when
// the test fails.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { WebSocket } from "ws";
import type { Project, ServerMessage, Thread, ThreadEvent, ThreadEventEnvelope } from "../../shared/protocol.ts";
import { startApp, type App, type AppOptions } from "../src/app.ts";
import { MemoryKeyring, type Keyring } from "../src/keyring.ts";

// True while a process still has this folder on its command line.
function processUsing(dir: string): boolean {
  const lines = execFileSync("ps", ["-eo", "stat=,args="], { encoding: "utf8" }).split("\n");
  return lines.some((line) => line.includes(dir) && !line.startsWith("Z"));
}

// 1.2.0: a GitHub client against the real API looks for a signed-in gh by itself. Tests never do,
// so the machine's own gh account is never used; github-autodetect tests pass it explicitly.
process.env.AD_GITHUB_AUTODETECT ??= "0";

export function tempDir(t: TestContext, prefix = "ad-test-"): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

export interface Harness {
  app: App;
  keyring: Keyring; // round 14: a keyring in memory unless the test passes its own, never the real one
  cookie: string;
  origin: string;
  api: <T = any>(method: string, url: string, body?: unknown) => Promise<T>;
  raw: (method: string, url: string, options?: RawOptions) => Promise<RawResponse>;
  socket: () => Promise<TestSocket>;
  project: (dir?: string, patch?: Partial<Project>) => Promise<Project>;
  thread: (projectId: string | null, mode?: "chat" | "code", modelId?: string) => Promise<Thread>;
  events: (threadId: string) => Promise<ThreadEventEnvelope[]>;
  finished: (threadId: string, count?: number) => Promise<ThreadEvent[]>;
  approveAll: (threadId: string, decision?: string) => () => void;
}

export interface RawOptions {
  headers?: Record<string, string>;
  body?: string;
}

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function rawRequest(port: number, method: string, url: string, options: RawOptions = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: { host: `127.0.0.1:${port}`, ...options.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

export class TestSocket {
  ws: WebSocket;
  received: ServerMessage[] = [];
  private waiters: Array<{ test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      this.received.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.test(message)) return true;
        w.resolve(message);
        return false;
      });
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  waitFor<T extends ServerMessage = ServerMessage>(test: (m: ServerMessage) => boolean, timeoutMs = 15_000): Promise<T> {
    const found = this.received.find(test);
    if (found) return Promise.resolve(found as T);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out. Last messages: ${JSON.stringify(this.received.slice(-3)).slice(0, 500)}`)), timeoutMs);
      this.waiters.push({ test, resolve: (m) => (clearTimeout(timer), resolve(m as T)) });
    });
  }

  close(): void {
    this.ws.terminate();
  }
}

export async function login(port: number, token: string): Promise<string> {
  const res = await rawRequest(port, "POST", "/api/auth/exchange", {
    headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  assert.equal(res.status, 200);
  return String(res.headers["set-cookie"]).split(";")[0];
}

export async function startHarness(t: TestContext, options: AppOptions = {}): Promise<Harness> {
  // Removed below, after the server has stopped: Chrome writes to its profile on the way out.
  const dataDir = options.dataDir ?? realpathSync(mkdtempSync(path.join(tmpdir(), "ad-data-")));
  const keyring = options.keyring ?? new MemoryKeyring();
  const app = await startApp({
    port: 0,
    mockDelayMs: 0,
    retryBaseMs: 1,
    webDist: path.join(dataDir, "no-dist"),
    userSkillsDir: path.join(dataDir, "no-user-skills"),
    appSkillsDir: path.join(dataDir, "no-app-skills"), // runtime assets are opt-in in isolated tests
    configDir: path.join(dataDir, "no-config"), // never the user's ~/.config/agentic-desktop
    seedDefaults: false, // round 9b: no default global AGENTS.md unless a test asks for it
    localWorkspace: false, // the agent never works in the real home folder: a test opts in with a temporary homeDir
    ...options,
    keyring,
    dataDir,
  });
  const sockets: TestSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.close();
    await app.close();
    if (options.dataDir) return;
    await until(() => !processUsing(dataDir), "Chrome to let go of its profile");
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const origin = `http://127.0.0.1:${app.port}`;
  const cookie = await login(app.port, app.security.token);

  const raw: Harness["raw"] = (method, url, opts = {}) =>
    rawRequest(app.port, method, url, { ...opts, headers: { cookie, origin, ...opts.headers } });

  const api: Harness["api"] = async (method, url, body) => {
    const res = await raw(method, url, {
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = res.body ? JSON.parse(res.body) : undefined;
    if (res.status >= 400) throw Object.assign(new Error(`${method} ${url}: ${res.status} ${res.body}`), { status: res.status, body: parsed });
    return parsed;
  };

  const socket = async () => {
    const { ticket } = await api("POST", "/api/ws-ticket");
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws?ticket=${ticket}`, { headers: { origin } });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const test = new TestSocket(ws);
    sockets.push(test);
    return test;
  };

  const project: Harness["project"] = async (dir, patch) => {
    const folder = dir ?? tempDir(t, "ad-project-");
    const created = await api<Project>("POST", "/api/projects", { name: path.basename(folder), path: folder });
    return patch ? api<Project>("PATCH", `/api/projects/${created.id}`, patch) : created;
  };

  const thread: Harness["thread"] = (projectId, mode = "code", modelId) => api("POST", "/api/threads", { projectId, mode, modelId });
  const events: Harness["events"] = (threadId) => api("GET", `/api/threads/${threadId}/events?limit=20000`);

  const finished: Harness["finished"] = async (threadId, count = 1) => {
    await until(async () => (await events(threadId)).filter((e) => e.event.type === "run.finished").length >= count, `run ${count} in ${threadId}`);
    return (await events(threadId)).map((e) => e.event);
  };

  // Answers approvals as they appear in a thread, until the returned function is called.
  const approveAll: Harness["approveAll"] = (threadId, decision = "allow") => {
    let stopped = false;
    const seen = new Set<string>();
    void (async () => {
      while (!stopped) {
        for (const { event } of await events(threadId).catch(() => [])) {
          if (event.type !== "approval.requested" || seen.has(event.approvalId)) continue;
          seen.add(event.approvalId);
          await api("POST", `/api/approvals/${event.approvalId}`, { decision }).catch(() => undefined);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })();
    return () => (stopped = true);
  };

  return { app, keyring, cookie, origin, api, raw, socket, project, thread, events, finished, approveAll };
}

export async function until(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export function textOf(events: ThreadEvent[]): string {
  return events.flatMap((e) => (e.type === "text.delta" ? [e.text] : [])).join("");
}

export function ofType<K extends ThreadEvent["type"]>(events: ThreadEvent[], type: K): Array<Extract<ThreadEvent, { type: K }>> {
  return events.filter((e) => e.type === type) as Array<Extract<ThreadEvent, { type: K }>>;
}
