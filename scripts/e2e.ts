// End to end without a UI: a real server process, the demo model, real tools and real Chrome.
// Run with `npm run e2e`. Everything it starts is stopped by PID, also on failure.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import type { Project, ServerMessage, Thread, ThreadEvent, ThreadEventEnvelope } from "../shared/protocol.ts";
import { login, rawRequest, TestSocket } from "../server/test/helpers.ts";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-e2e-data-")));
const projectDir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-e2e-project-")));

let server: ChildProcess | undefined;
const started = new Set<number>();

function step(text: string): void {
  console.log(`ok - ${text}`);
}

async function startServer(): Promise<{ port: number; token: string }> {
  const child = spawn(process.execPath, ["server/src/index.ts", "--no-open"], {
    cwd: root,
    env: { ...process.env, AD_DATA_DIR: dataDir, AD_PORT: "0", AD_MOCK_DELAY_MS: "0", AD_KEYRING: "memory", AD_WEB_DIST: path.join(dataDir, "no-dist"), XDG_CONFIG_HOME: path.join(dataDir, "config") },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server = child;
  started.add(child.pid!);
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)\/#token=(\S+)/.exec(output);
      if (match) resolve({ port: Number(match[1]), token: match[2] });
    });
    child.once("exit", (code) => reject(new Error(`The server stopped with code ${code}`)));
  });
}

// Descendants of a process, by parent PID.
function descendants(pid: number): number[] {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,stat="], { encoding: "utf8" }).trim().split("\n").map((line) => line.trim().split(/\s+/));
  const found = new Set([pid]);
  for (let grown = true; grown;) {
    grown = false;
    for (const [child, parent, stat] of rows) {
      if (found.has(Number(parent)) && !found.has(Number(child)) && !stat.startsWith("Z")) {
        found.add(Number(child));
        grown = true;
      }
    }
  }
  found.delete(pid);
  return [...found];
}

function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

async function until(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${what}`);
}

function client(port: number, cookie: string) {
  const origin = `http://127.0.0.1:${port}`;
  const api = async <T = any>(method: string, url: string, body?: unknown): Promise<T> => {
    const res = await rawRequest(port, method, url, {
      headers: { cookie, origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status >= 400) throw new Error(`${method} ${url}: ${res.status} ${res.body}`);
    return res.body ? JSON.parse(res.body) : (undefined as T);
  };
  const socket = async () => {
    const { ticket } = await api("POST", "/api/ws-ticket");
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`, { headers: { origin } });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new TestSocket(ws);
  };
  return { api, socket };
}

type Client = ReturnType<typeof client>;

const eventsOf = (http: Client, threadId: string) => http.api<ThreadEventEnvelope[]>("GET", `/api/threads/${threadId}/events?limit=20000`);
const only = <K extends ThreadEvent["type"]>(events: ThreadEvent[], type: K) => events.filter((e) => e.type === type) as Array<Extract<ThreadEvent, { type: K }>>;
const text = (events: ThreadEvent[]) => only(events, "text.delta").map((e) => e.text).join("");

// Approves everything until the thread has finished `runs` runs, and returns what was asked.
async function runToEnd(http: Client, threadId: string, runs = 1): Promise<string[]> {
  const asked = new Map<string, string>();
  await until(async () => {
    const events = (await eventsOf(http, threadId)).map((e) => e.event);
    const resolved = new Set(only(events, "approval.resolved").map((e) => e.approvalId));
    for (const event of only(events, "approval.requested")) {
      if (asked.has(event.approvalId) || resolved.has(event.approvalId)) continue;
      asked.set(event.approvalId, event.title);
      await http.api("POST", `/api/approvals/${event.approvalId}`, { decision: "allow" });
    }
    return only(events, "run.finished").length >= runs;
  }, `run ${runs} in ${threadId}`);
  return [...asked.values()];
}

async function main(): Promise<void> {
  const first = await startServer();
  assert.equal((await rawRequest(first.port, "GET", "/api/bootstrap")).status, 401);
  const http = client(first.port, await login(first.port, first.token));
  step(`server is up on port ${first.port}, and the token works once exchanged`);

  const project = await http.api<Project>("POST", "/api/projects", { name: "E2E", path: projectDir });
  const thread = await http.api<Thread>("POST", "/api/threads", { projectId: project.id, mode: "code" });
  const socket = await http.socket();
  socket.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 0 });
  step("project and thread created");

  await http.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  const asked = await runToEnd(http, thread.id);
  assert.ok(asked.some((title) => title.startsWith("write_file")), "the write asked first");
  assert.ok(asked.some((title) => title.startsWith("run_command")), "the command was approved");
  const events = (await eventsOf(http, thread.id)).map((e) => e.event);
  assert.equal(only(events, "run.finished")[0].status, "done");
  assert.ok(only(events, "tool.finished").every((e) => e.status === "done"));
  assert.match(readFileSync(path.join(projectDir, "index.html"), "utf8"), /Hei fra demo-modellen/);
  step(`index.html written after ${asked.length} approvals, including the command`);

  const shot = only(events, "tool.finished").find((e) => e.screenshotId)!;
  assert.match(only(events, "tool.finished").find((e) => e.result?.startsWith("Side:"))!.result!, /Klikket 0 ganger/);
  assert.equal((await rawRequest(first.port, "GET", `/api/screenshots/${shot.screenshotId}`)).status, 401, "screenshots need the cookie");
  assert.ok(existsSync(path.join(dataDir, "screenshots", `${shot.screenshotId}.png`)));
  assert.equal(readFileSync(path.join(dataDir, "screenshots", `${shot.screenshotId}.png`)).subarray(1, 4).toString(), "PNG");
  step("the page opened in headless Chrome, with a snapshot and a PNG screenshot");

  socket.send({ type: "browser.open", projectId: project.id, width: 900, height: 600 });
  const frame = await socket.waitFor<Extract<ServerMessage, { type: "browser.frame" }>>((m) => m.type === "browser.frame");
  const state = await socket.waitFor<Extract<ServerMessage, { type: "browser.state" }>>((m) => m.type === "browser.state");
  assert.equal(state.state.title, "Demo fra Agentic Desktop");
  assert.equal(frame.width, 900);
  socket.send({ type: "browser.frame-ack", projectId: project.id, sessionId: frame.sessionId });
  socket.send({ type: "browser.close", projectId: project.id });
  step("the panel's screencast shows the same page the agent opened");

  const lead = await http.api<Thread>("POST", "/api/threads", { projectId: project.id, mode: "code" });
  await http.api("POST", `/api/threads/${lead.id}/messages`, { text: "samarbeid om dette" });
  await runToEnd(http, lead.id);
  const leadEvents = (await eventsOf(http, lead.id)).map((e) => e.event);
  const [spawned] = only(leadEvents, "thread.spawned");
  assert.ok(spawned, "a thread created another thread");
  const childEvents = (await eventsOf(http, spawned.childThreadId)).map((e) => e.event);
  assert.equal(only(childEvents, "user.message")[0].from!.threadId, lead.id, "the message carries its sender");
  const answer = text(childEvents);
  assert.match(answer, /Oversikt fra hjelpetråden/);
  assert.ok(text(leadEvents).includes(answer), "the first thread got the second thread's answer");
  const boot = await http.api("GET", "/api/bootstrap");
  const child = boot.threads.find((t: Thread) => t.id === spawned.childThreadId);
  assert.equal(child.origin, "agent");
  assert.equal(child.parentThreadId, lead.id);
  assert.equal(child.permissionCap, "ask");
  step("one thread created another, waited for it and got its answer");

  // Round 15 (SPEC 31): a React artifact from the demo model in Chat, saved as React, and its page
  // on the preview origin with a CSP that allows no connections. (No web build here, so the page
  // says the runtime is missing; the UI and desktop tests run it.)
  const chat = await http.api<Thread>("POST", "/api/threads", { mode: "chat" });
  await http.api("POST", `/api/threads/${chat.id}/messages`, { text: "lag en react-artifact" });
  await runToEnd(http, chat.id);
  const jsx = /```jsx oppgaver\.jsx\n([\s\S]*?)```/.exec(text((await eventsOf(http, chat.id)).map((e) => e.event)))?.[1];
  assert.ok(jsx && /export default function Oppgaver/.test(jsx), "a React component in a jsx block");
  const saved = await http.api("POST", "/api/artifacts", { html: jsx, lang: "jsx", threadId: chat.id });
  assert.deepEqual([saved.lang, saved.title], ["jsx", "Oppgaver"]);
  const page = await fetch(saved.previewUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
  assert.match(page.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts allow-modals allow-forms;/);
  assert.equal((await rawRequest(first.port, "POST", "/api/artifacts", { headers: { origin: "null", "content-type": "application/json" }, body: JSON.stringify({ html: jsx, lang: "jsx" }) })).status >= 400, true, "Origin null is refused");
  step("a React artifact from the demo model is saved as React, and its preview page allows no network");

  // A run left waiting, to be interrupted by the restart.
  const interrupted = await http.api<Thread>("POST", "/api/threads", { projectId: project.id, mode: "code" });
  await http.api("POST", `/api/threads/${interrupted.id}/messages`, { text: "lang kommando" });
  await until(async () => only((await eventsOf(http, interrupted.id)).map((e) => e.event), "approval.requested").length === 1, "pending approval");

  const before = await eventsOf(http, thread.id);
  const children = descendants(server!.pid!);
  assert.ok(children.length > 0, "Chrome is a child of the server");
  for (const pid of children) started.add(pid);
  socket.close();
  const exited = new Promise((resolve) => server!.once("exit", resolve));
  server!.kill("SIGTERM");
  await exited;
  await until(() => children.every((pid) => !alive(pid)), "Chrome to stop with the server", 10_000);
  step(`server stopped, and its ${children.length} child processes went with it`);

  const second = await startServer();
  assert.notEqual(second.token, first.token, "a new token per run");
  const again = client(second.port, await login(second.port, second.token));
  const after = await eventsOf(again, thread.id);
  assert.deepEqual(after, before, "the event log is unchanged in SQLite");
  const resumed = (await eventsOf(again, interrupted.id)).map((e) => e.event);
  assert.equal(only(resumed, "run.finished").at(-1)!.status, "interrupted");
  assert.equal(only(resumed, "tool.finished").at(-1)!.status, "cancelled");
  step(`${after.length} events read back from SQLite after the restart, and the waiting run is marked interrupted`);

  await again.api("POST", `/api/threads/${interrupted.id}/messages`, { text: "hjelp" });
  await runToEnd(again, interrupted.id, 2);
  const continued = (await eventsOf(again, interrupted.id)).map((e) => e.event);
  assert.equal(only(continued, "run.finished").at(-1)!.status, "done");
  step("the interrupted thread can go on");
}

async function cleanUp(): Promise<void> {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server!.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  for (const pid of started) {
    if (alive(pid)) {
      console.error(`Stopping leftover process ${pid}`);
      process.kill(pid, "SIGKILL");
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`FEIL: ${(err as Error).stack}`);
}
const lingering = [...started].filter((pid) => pid !== server?.pid);
await cleanUp();
assert.ok(lingering.every((pid) => !alive(pid)), "no processes left");
assert.equal(readdirSync(tmpdir()).includes(path.basename(dataDir)), false);
console.log(failed ? "e2e FEILET" : "e2e OK");
process.exit(failed ? 1 : 0);
