// The MCP client on its own: stdio and Streamable HTTP against fake servers, plus naming and
// result conversion. No app, no network beyond 127.0.0.1.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpClient } from "../src/mcp/client.ts";
import { HttpTransport, SessionExpiredError } from "../src/mcp/http.ts";
import { StdioTransport } from "../src/mcp/stdio.ts";
import { exposedName, MAX_NAME, redactor, toolSchema, toToolResult, uniqueSlug, validSlug } from "../src/mcp/tools.ts";
import { startFakeHttp } from "./mcp-fake-http.ts";
import { tempDir, until } from "./helpers.ts";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-fake-stdio.ts");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stdioClient(t: test.TestContext, env: Record<string, string> = {}) {
  const dir = tempDir(t, "ad-mcp-");
  const logFile = path.join(dir, "log.jsonl");
  const pidFile = path.join(dir, "pids");
  const notes: string[] = [];
  const transport = new StdioTransport({ command: process.execPath, args: [FAKE], env: { PATH: process.env.PATH ?? "", FAKE_LOG: logFile, FAKE_PIDFILE: pidFile, ...env }, cwd: dir });
  const client = new McpClient(transport, { clientVersion: "test", onNotification: (method) => notes.push(method) });
  t.after(() => client.close());
  const received = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const pids = () => readFileSync(pidFile, "utf8").split("\n").map(Number);
  return { client, transport, received, pids, notes };
}

test("MCP stdio: initialize, tools/list over two pages, call, isError and protocol errors", async (t) => {
  const { client, received, transport } = stdioClient(t);
  const info = await client.connect(10_000);
  assert.equal(info.protocolVersion, "2025-11-25");
  assert.equal(info.serverInfo?.name, "fake-stdio");
  const init = received().find((m) => m.method === "initialize");
  assert.equal(init.params.protocolVersion, "2025-11-25");
  assert.equal(init.params.clientInfo.name, "agentic-desktop");
  assert.deepEqual(init.params.capabilities, {});
  await until(() => received().some((m) => m.method === "notifications/initialized"), "initialized notification");

  const tools = await client.listTools(5000);
  assert.deepEqual(tools.map((t) => t.name), ["echo", "fail", "slow", "image", "env", "change", "crash", "dotted.name"]);
  assert.equal(received().filter((m) => m.method === "tools/list").at(-1).params.cursor, "p2");

  const echo = await client.callTool("echo", { text: "hei" }, 5000);
  assert.deepEqual(JSON.parse(echo.content[0].text!), { text: "hei" });
  const fail = await client.callTool("fail", {}, 5000);
  assert.equal(fail.isError, true);
  await assert.rejects(client.callTool("nope", {}, 5000), /Unknown tool: nope/);
  assert.match(transport.tail(), /fake server started/);
});

test("MCP stdio: timeout and abort send notifications/cancelled; list_changed reaches the owner", async (t) => {
  const { client, received, notes } = stdioClient(t);
  await client.connect(10_000);
  await assert.rejects(client.callTool("slow", {}, 300), /svarte ikke innen/);
  await until(() => received().some((m) => m.method === "notifications/cancelled"), "cancel after timeout");
  const first = received().find((m) => m.method === "notifications/cancelled");
  const slowCall = received().find((m) => m.method === "tools/call" && m.params.name === "slow");
  assert.equal(first.params.requestId, slowCall.id);

  const controller = new AbortController();
  const pending = client.callTool("slow", {}, 60_000, controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /Avbrutt/);
  await until(() => received().filter((m) => m.method === "notifications/cancelled").length === 2, "cancel after abort");

  await client.callTool("change", {}, 5000);
  await until(() => notes.includes("notifications/tools/list_changed"), "list_changed");
  assert.ok((await client.listTools(5000)).some((t) => t.name === "added"));
});

test("MCP stdio: close stops the server and the processes it started; unsupported versions are refused", async (t) => {
  const { client, pids } = stdioClient(t, { FAKE_GRANDCHILD: "1" });
  await client.connect(10_000);
  await until(() => existsSync(path.dirname(FAKE)) && pids().length === 2 && pids().every(Boolean), "pids");
  const [server, grandchild] = pids();
  assert.ok(alive(server) && alive(grandchild));
  await client.close();
  await until(() => !alive(server) && !alive(grandchild), "server and grandchild gone", 10_000);

  const old = stdioClient(t, { FAKE_VERSION: "2099-01-01" });
  await assert.rejects(old.client.connect(10_000), /MCP-versjon 2099-01-01/);
  await old.client.close();

  const missing = new McpClient(new StdioTransport({ command: "definitely-not-a-command-xyz", args: [], env: { PATH: "/nonexistent" }, cwd: tempDir(t) }), { clientVersion: "test" });
  await assert.rejects(missing.connect(5000), /Fant ikke kommandoen/);
});

test("MCP stdio: the stderr tail holds whole lines only, so a secret is never shown in part", async (t) => {
  const secret = "SECRET_abcdefghijklmnopqrstuvwxyz_0123456789";
  // About 20 kB of lines that each hold the whole secret, then a line that is not finished.
  const script = `for (let i = 0; i < 400; i++) process.stderr.write("line " + i + " ${secret}\\n"); process.stderr.write("unfinished ${secret.slice(0, 20)}"); setTimeout(() => {}, 30000);`;
  const transport = new StdioTransport({ command: process.execPath, args: ["-e", script], env: { PATH: process.env.PATH ?? "" }, cwd: tempDir(t) });
  t.after(() => transport.close());
  await transport.start({ onMessage: () => undefined, onClose: () => undefined });
  await until(() => transport.tail().includes("line 399 "), "stderr");
  const tail = transport.tail();
  assert.ok(tail.length <= 8 * 1024);
  const lines = tail.split("\n").filter(Boolean);
  for (const line of lines) assert.match(line, new RegExp(`^line \\d+ ${secret}$`));
  assert.ok(!tail.includes("unfinished"));
  assert.equal(redactor([secret])(tail).includes(secret.slice(-10)), false);
});

test("MCP Streamable HTTP: session id, protocol header, JSON and event-stream answers, 202, DELETE", async (t) => {
  const fake = await startFakeHttp({ token: "tok_secret_123" });
  t.after(() => fake.close());
  const client = new McpClient(new HttpTransport(fake.url, { Authorization: "Bearer tok_secret_123" }), { clientVersion: "test" });
  const info = await client.connect(5000);
  assert.equal(info.serverInfo?.name, "fake-http");
  const tools = await client.listTools(5000);
  assert.deepEqual(tools.map((t) => t.name), ["whoami", "echo"]);
  const result = await client.callTool("echo", { text: "via sse" }, 5000);
  assert.deepEqual(JSON.parse(result.content[0].text!), { text: "via sse" });

  const posts = fake.requests.filter((r) => r.method === "POST");
  assert.equal(posts[0].headers["mcp-session-id"], undefined); // none before initialize
  assert.equal(posts[0].headers["mcp-protocol-version"], undefined);
  for (const r of posts.slice(1)) {
    assert.match(String(r.headers["mcp-session-id"]), /^s-/);
    assert.equal(r.headers["mcp-protocol-version"], "2025-11-25");
    assert.match(String(r.headers.accept), /application\/json/);
    assert.match(String(r.headers.accept), /text\/event-stream/);
  }
  assert.ok(posts.some((r) => r.body.method === "notifications/initialized"));
  assert.ok(fake.requests.some((r) => r.method === "GET")); // the optional stream was tried (405 here)

  fake.expireSession();
  await assert.rejects(client.callTool("echo", {}, 5000), (err) => err instanceof SessionExpiredError);
  await client.close();
  assert.ok(fake.requests.some((r) => r.method === "DELETE"));
});

test("MCP Streamable HTTP: a wrong token gives a plain message without the header; the GET stream carries notifications", async (t) => {
  const fake = await startFakeHttp({ token: "right", getStream: true });
  t.after(() => fake.close());
  const bad = new McpClient(new HttpTransport(fake.url, { Authorization: "Bearer wrong-token-value" }), { clientVersion: "test" });
  await assert.rejects(bad.connect(5000), (err: Error) => /avviste tilgangen \(HTTP 401\)/.test(err.message) && !err.message.includes("wrong-token-value"));
  await bad.close();

  const notes: string[] = [];
  const good = new McpClient(new HttpTransport(fake.url, { Authorization: "Bearer right" }), { clientVersion: "test", onNotification: (m) => notes.push(m) });
  t.after(() => good.close());
  await good.connect(5000);
  await until(() => fake.streams() === 1, "GET stream open");
  fake.push({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  await until(() => notes.includes("notifications/tools/list_changed"), "notification over GET stream");
});

test("MCP Streamable HTTP: a stream that ends before the answer fails at once, or is resumed with Last-Event-ID", async (t) => {
  const early = await startFakeHttp({ call: "close-no-id" });
  t.after(() => early.close());
  const a = new McpClient(new HttpTransport(early.url, {}), { clientVersion: "test" });
  t.after(() => a.close());
  await a.connect(5000);
  const started = Date.now();
  await assert.rejects(a.callTool("echo", {}, 30_000), /avsluttet svaret før svaret på kallet kom/);
  assert.ok(Date.now() - started < 5000, "not the whole timeout");

  const resumable = await startFakeHttp({ call: "close-resume" });
  t.after(() => resumable.close());
  const b = new McpClient(new HttpTransport(resumable.url, {}), { clientVersion: "test" });
  t.after(() => b.close());
  await b.connect(5000);
  const result = await b.callTool("echo", { text: "gjenopptatt" }, 10_000);
  assert.deepEqual(JSON.parse(result.content[0].text!), { text: "gjenopptatt" });
  const resume = resumable.requests.find((r) => r.method === "GET" && r.headers["last-event-id"]);
  assert.match(String(resume?.headers["last-event-id"]), /^call-/);
  assert.match(String(resume?.headers["mcp-session-id"]), /^s-/);
});

test("MCP Streamable HTTP: streams are closed when the answer has come and when the client closes", async (t) => {
  const fake = await startFakeHttp({ call: "keep-open", getStream: true });
  t.after(() => fake.close());
  const transport = new HttpTransport(fake.url, {});
  const client = new McpClient(transport, { clientVersion: "test" });
  await client.connect(5000);
  await until(() => fake.streams() === 1, "GET stream open");
  for (let i = 0; i < 3; i++) await client.callTool("echo", { i }, 5000);
  await until(() => fake.posts() === 0, "POST streams closed after their answers");
  assert.equal(transport.openRequests, 1); // just the GET stream
  await client.close();
  assert.equal(transport.openRequests, 0);
  await until(() => fake.streams() === 0, "GET stream closed with the client");
});

test("MCP Streamable HTTP: GET 404 is no stream, not an expired session; a closed GET stream is opened again", async (t) => {
  const no = await startFakeHttp({ get404: true });
  t.after(() => no.close());
  const a = new McpClient(new HttpTransport(no.url, {}), { clientVersion: "test" });
  t.after(() => a.close());
  await a.connect(5000);
  await until(() => no.requests.some((r) => r.method === "GET"), "GET tried");
  assert.ok(!a.isClosed);
  assert.deepEqual(JSON.parse((await a.callTool("echo", { ok: 1 }, 5000)).content[0].text!), { ok: 1 });
  // The GET came after notifications/initialized.
  const order = no.requests.map((r) => r.method === "GET" ? "GET" : r.body?.method);
  assert.ok(order.indexOf("GET") > order.indexOf("notifications/initialized"), order.join(", "));

  const fake = await startFakeHttp({ getStream: true });
  t.after(() => fake.close());
  const notes: string[] = [];
  const b = new McpClient(new HttpTransport(fake.url, {}), { clientVersion: "test", onNotification: (m) => notes.push(m) });
  t.after(() => b.close());
  await b.connect(5000);
  await until(() => fake.streams() === 1, "GET stream open");
  fake.dropStreams();
  await until(() => fake.streams() === 0, "dropped");
  await until(() => fake.streams() === 1, "GET stream open again", 5000);
  fake.push({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  await until(() => notes.includes("notifications/tools/list_changed"), "notification after reopening");
  assert.equal(fake.requests.filter((r) => r.method === "GET").at(-1)!.headers["last-event-id"], "0"); // resumes from the last id
});

test("MCP naming: sanitised, at most 64 characters, collision-safe and stable", () => {
  const taken = new Set<string>();
  const a = exposedName("github", "get_me", taken);
  assert.equal(a, "mcp__github__get_me");
  assert.equal(exposedName("fake", "dotted.name", taken), "mcp__fake__dotted_name");
  assert.equal(exposedName("fake", "dotted_name", taken), "mcp__fake__dotted_name_2");
  const long = "x".repeat(100);
  const l1 = exposedName("server", long, taken);
  const l2 = exposedName("server", `${long}y`, taken);
  assert.ok(l1.length <= MAX_NAME && l2.length <= MAX_NAME);
  assert.notEqual(l1, l2);
  for (const name of taken) assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.equal(exposedName("server", long, new Set()), l1); // the same input gives the same name

  assert.equal(uniqueSlug("GitHub", []), "github");
  assert.equal(uniqueSlug("github", ["github"]), "github2");
  assert.equal(uniqueSlug("github", ["github", "github2"]), "github3");
  assert.equal(uniqueSlug("Åpen server!", []), "apen_server");
  assert.equal(uniqueSlug("???", []), "server");
  for (const slug of ["github", "github2", "apen_server", "a"]) assert.ok(validSlug(slug), slug);
  for (const slug of ["", "_a", "a__b", "A", "x".repeat(21), 3]) assert.ok(!validSlug(slug), String(slug));

  const schema = toolSchema({ $schema: "x", type: "object" });
  assert.deepEqual(schema, { type: "object", properties: {}, required: [] });
  assert.deepEqual(toolSchema(null), { type: "object", properties: {}, required: [] });
});

test("MCP results: text, isError, one image, notes for the rest, secrets hidden", () => {
  const redact = redactor(["Bearer ghp_abcdefghijklmnop"]);
  const result = toToolResult({
    content: [
      { type: "text", text: "token ghp_abcdefghijklmnop here" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "image", data: "BBBB", mimeType: "image/png" },
      { type: "audio", data: "AAAA", mimeType: "audio/wav" },
      { type: "resource", resource: { uri: "file:///a.txt", text: "inside" } },
      { type: "mystery" },
    ],
    isError: true,
  }, redact);
  assert.equal(result.isError, true);
  assert.equal(result.image?.mime, "image/png");
  assert.equal(result.image?.base64, "AAAA");
  assert.ok(!result.text.includes("ghp_abcdefghijklmnop"));
  assert.match(result.text, /\[skjult\]/);
  assert.match(result.text, /Lyd/);
  assert.match(result.text, /inside/);
  assert.match(result.text, /mystery/);
  assert.match(result.text, /bare det første bildet/);
  const structured = toToolResult({ content: [], structuredContent: { a: 1 } }, (t) => t);
  assert.deepEqual(JSON.parse(structured.text), { a: 1 });
  const big = toToolResult({ content: [{ type: "text", text: "x\n".repeat(40_000) }] }, (t) => t);
  assert.ok(big.text.length <= 30_100 && big.text.includes("utelatt"));
});
