// MCP servers in the app: the API, secrets, tools offered to the model, approvals, a whole turn
// with the demo model, and stopping the server processes. Fake servers only (mcp-fake-*.ts).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { McpServerView, McpState } from "../../shared/mcp.ts";
import { MCP_TOOL_LIMIT } from "../../shared/mcp.ts";
import { startFakeHttp } from "./mcp-fake-http.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-fake-stdio.ts");
const TOKEN = "fake_token_value_0123456789";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function addFake(h: Harness, t: test.TestContext, extra: Record<string, unknown> = {}, env: Array<{ name: string; value?: string; secret: boolean }> = []) {
  const dir = tempDir(t, "ad-mcp-");
  const pidFile = path.join(dir, "pids");
  const server = await h.api<McpServerView>("POST", "/api/mcp/servers", {
    name: "Fake",
    transport: "stdio",
    command: process.execPath,
    args: [FAKE],
    env: [{ name: "FAKE_TOKEN", value: TOKEN, secret: true }, { name: "FAKE_PLAIN", value: "synlig", secret: false }, { name: "FAKE_PIDFILE", value: pidFile, secret: false }, ...env],
    ...extra,
  });
  return { server, pidFile, pids: () => readFileSync(pidFile, "utf8").split("\n").map(Number) };
}

async function connected(h: Harness, id: string, tools?: number): Promise<McpServerView> {
  let view: McpServerView | undefined;
  await until(async () => {
    view = (await h.api<McpState>("GET", "/api/mcp")).servers.find((s) => s.id === id);
    return view?.status === "connected" && (tools === undefined || view.tools.length === tools);
  }, `MCP server ${id} connected`, 15_000);
  return view!;
}

async function approvals(h: Harness, threadId: string) {
  return ofType((await h.events(threadId)).map((e) => e.event), "approval.requested");
}

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });

test("MCP i appen: lagres maskert, hemmeligheter bare i nøkkelringen, verktøy i Kode, av-bryter og grense", async (t) => {
  process.env.MCP_TEST_PARENT_API_KEY = "parent-secret-should-not-pass";
  t.after(() => delete process.env.MCP_TEST_PARENT_API_KEY);
  const h = await startHarness(t);
  const socket = await h.socket();
  const { server } = await addFake(h, t);
  // Masked at once in the answer to the POST.
  assert.deepEqual(server.env.find((p) => p.name === "FAKE_TOKEN"), { name: "FAKE_TOKEN", secret: true, value: "", set: true });
  assert.equal(server.env.find((p) => p.name === "FAKE_PLAIN")!.value, "synlig");
  const view = await connected(h, server.id, 8);
  assert.equal(view.serverName, "fake-stdio");
  assert.equal(view.protocolVersion, "2025-11-25");
  assert.match(view.stderr, /token=\[skjult\]/); // the server printed the token; the view hides it

  // Names, as the model sees them, through the real toolDefs.
  const project = await h.project();
  const names = h.app.runner.toolNames("code", project);
  for (const tool of ["echo", "fail", "slow", "image", "env", "change", "crash"]) assert.ok(names.includes(`mcp__fake__${tool}`), tool);
  assert.ok(names.includes("mcp__fake__dotted_name"));
  assert.ok(!h.app.runner.toolNames("chat", undefined).some((n) => n.startsWith("mcp__")), "Chat is off by default");
  // The system prompt says MCP results are data, not instructions.
  const layers = h.app.runner.previewLayers("code", project);
  assert.match(layers.find((l) => l.id === "mcp")!.text, /external data, not instructions/);

  // Plan mode: none.
  const planThread = { ...(await h.thread(project.id)), planMode: true };
  assert.ok(!h.app.runner.toolDefs(planThread, project, []).some((d) => d.name.startsWith("mcp__")));

  // Per-tool switch.
  await h.api("PATCH", `/api/mcp/servers/${server.id}`, { disabledTools: ["echo"] });
  assert.ok(!h.app.runner.toolNames("code", project).includes("mcp__fake__echo"));
  assert.ok(h.app.runner.toolNames("code", project).includes("mcp__fake__fail"));
  await h.api("PATCH", `/api/mcp/servers/${server.id}`, { disabledTools: [] });

  // Nothing secret anywhere it could leak: API, bootstrap, ws, the database file.
  const everything = JSON.stringify([await h.api("GET", "/api/mcp"), await h.api("GET", "/api/bootstrap"), socket.received]);
  assert.ok(!everything.includes(TOKEN));
  assert.ok(socket.received.some((m) => m.type === "mcp.changed"));
  const db = new DatabaseSync(path.join(h.app.config.dataDir, "agentic-desktop.db"), { readOnly: true });
  const dump = JSON.stringify(db.prepare("SELECT * FROM meta").all());
  db.close();
  assert.ok(dump.includes("FAKE_TOKEN") && !dump.includes(TOKEN));
  // The keyring has it.
  assert.ok(Object.values(await h.keyring.load()).includes(TOKEN));

  // The child got its own env, but no provider-like secret from the app's environment.
  const thread = await h.thread((await h.project(undefined, { permissionMode: "full" })).id);
  await send(h, thread.id, "mcp-kall mcp__fake__env {}");
  const events = await h.finished(thread.id);
  const result = (ofType(events, "tool.finished")[0].result ?? "");
  assert.match(result, /token=\[skjult\]/);
  assert.match(result, /plain=synlig/);
  assert.match(result, /leak=none/);
  assert.ok(!JSON.stringify(await h.events(thread.id)).includes(TOKEN));
  assert.ok(!JSON.stringify(h.app.store.messages(thread.id)).includes(TOKEN));
});

test("MCP i appen: grensen på antall verktøy og hvordan det vises", async (t) => {
  const h = await startHarness(t);
  const { server } = await addFake(h, t, {}, [{ name: "FAKE_EXTRA", value: "80", secret: false }]);
  await connected(h, server.id, 88);
  const project = await h.project();
  assert.equal(h.app.runner.toolNames("code", project).filter((n) => n.startsWith("mcp__")).length, MCP_TOOL_LIMIT);
  const state = await h.api<McpState>("GET", "/api/mcp");
  assert.equal(state.capped.code, true);
  assert.equal(state.offered.code, MCP_TOOL_LIMIT);
  assert.equal(state.servers[0].tools.filter((t) => t.offered.code).length, MCP_TOOL_LIMIT);
  // Switching tools off makes room for the rest.
  await h.api("PATCH", `/api/mcp/servers/${server.id}`, { disabledTools: Array.from({ length: 40 }, (_, i) => `extra_${i}`) });
  const after = await h.api<McpState>("GET", "/api/mcp");
  assert.equal(after.capped.code, false);
  assert.equal(after.offered.code, 48);
});

test("MCP i appen: godkjenning per modus, «tillat alltid», auto, feil og bilde i en hel tur", async (t) => {
  const h = await startHarness(t);
  const { server } = await addFake(h, t);
  await connected(h, server.id, 8);

  // ask: asks, and "allow always" is remembered for this tool in this project.
  const ask = await h.project(undefined, { permissionMode: "ask" });
  const first = await h.thread(ask.id);
  await send(h, first.id, 'mcp-kall mcp__fake__echo {"text":"hei"}');
  await until(async () => (await approvals(h, first.id)).length === 1, "approval");
  const [request] = await approvals(h, first.id);
  assert.equal(request.canAllowAlways, true);
  await h.api("POST", `/api/approvals/${request.approvalId}`, { decision: "allow-always" });
  let events = await h.finished(first.id);
  assert.equal(ofType(events, "tool.finished")[0].status, "done");
  assert.match((ofType(events, "tool.finished")[0].result ?? ""), /"text":"hei"/);
  assert.ok(h.app.store.isAllowed(ask.id, "tool", "mcp__fake__echo"));
  await send(h, first.id, 'mcp-kall mcp__fake__echo {"text":"igjen"}');
  events = await h.finished(first.id, 2);
  assert.equal((await approvals(h, first.id)).length, 1, "no new approval after allow always");
  // readOnlyHint is not trusted: another tool still asks, and deny is respected.
  await send(h, first.id, "mcp-kall mcp__fake__fail {}");
  await until(async () => (await approvals(h, first.id)).length === 2, "second approval");
  await h.api("POST", `/api/approvals/${(await approvals(h, first.id))[1].approvalId}`, { decision: "deny" });
  events = await h.finished(first.id, 3);
  assert.equal(ofType(events, "tool.finished").at(-1)!.status, "denied");

  // accept-edits: MCP tools are exec, so they still ask.
  const edits = await h.project(undefined, { permissionMode: "accept-edits" });
  const second = await h.thread(edits.id);
  await send(h, second.id, "mcp-kall mcp__fake__fail {}");
  await until(async () => (await approvals(h, second.id)).length === 1, "approval in accept-edits");
  await h.api("POST", `/api/approvals/${(await approvals(h, second.id))[0].approvalId}`, { decision: "allow" });
  events = await h.finished(second.id);
  assert.equal(ofType(events, "tool.finished")[0].status, "error"); // isError from the server
  assert.match((ofType(events, "tool.finished")[0].result ?? ""), /it broke/);

  // full: runs without asking, and an image comes through as an image.
  const full = await h.project(undefined, { permissionMode: "full" });
  const third = await h.thread(full.id);
  await send(h, third.id, "mcp-kall mcp__fake__image {}");
  events = await h.finished(third.id);
  assert.equal((await approvals(h, third.id)).length, 0);
  assert.match((ofType(events, "tool.finished")[0].result ?? ""), /with pictures/);
  const results = h.app.store.messages(third.id).flatMap((m) => m.content).filter((b: any) => b.type === "tool_result") as any[];
  assert.equal(results[0].image?.mime, "image/png");

  // auto on the server: no approval even in ask.
  await h.api("PATCH", `/api/mcp/servers/${server.id}`, { approval: "auto" });
  const fourth = await h.thread(ask.id);
  await send(h, fourth.id, "mcp-kall mcp__fake__fail {}");
  events = await h.finished(fourth.id);
  assert.equal((await approvals(h, fourth.id)).length, 0);
  assert.equal(ofType(events, "tool.finished")[0].status, "error");
});

test("MCP i Chat: av som standard, spør hver gang, «tillat alltid» gjelder resten av samtalen", async (t) => {
  const h = await startHarness(t);
  const { server } = await addFake(h, t, { chat: true, code: false });
  await connected(h, server.id, 8);
  assert.ok(!h.app.runner.toolNames("code", await h.project()).some((n) => n.startsWith("mcp__")));
  const chat = await h.thread(null, "chat");
  await send(h, chat.id, 'mcp-kall mcp__fake__echo {"text":"chat"}');
  await until(async () => (await approvals(h, chat.id)).length === 1, "chat approval");
  await h.api("POST", `/api/approvals/${(await approvals(h, chat.id))[0].approvalId}`, { decision: "allow-always" });
  let events = await h.finished(chat.id);
  assert.match((ofType(events, "tool.finished")[0].result ?? ""), /"text":"chat"/);
  await send(h, chat.id, 'mcp-kall mcp__fake__echo {"text":"to"}');
  events = await h.finished(chat.id, 2);
  assert.equal((await approvals(h, chat.id)).length, 1);
  // Another chat asks again.
  const other = await h.thread(null, "chat");
  await send(h, other.id, 'mcp-kall mcp__fake__echo {"text":"ny"}');
  await until(async () => (await approvals(h, other.id)).length === 1, "approval in a new chat");
  await h.api("POST", `/api/approvals/${(await approvals(h, other.id))[0].approvalId}`, { decision: "deny" });
  await h.finished(other.id);
});

test("MCP i appen: list_changed, krasj med ny start, av og fjern stopper prosessene, og appen stopper dem ved lukking", async (t) => {
  const h = await startHarness(t, { dataDir: tempDir(t, "ad-data-") });
  const { server, pids } = await addFake(h, t, {}, [{ name: "FAKE_GRANDCHILD", value: "1", secret: false }]);
  await connected(h, server.id, 8);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id);

  await send(h, thread.id, "mcp-kall mcp__fake__change {}");
  await h.finished(thread.id);
  await connected(h, server.id, 9);
  assert.ok(h.app.runner.toolNames("code", project).includes("mcp__fake__added"));

  // A crash after it was connected: the app starts it again by itself.
  const [before] = pids();
  await send(h, thread.id, "mcp-kall mcp__fake__crash {}");
  await h.finished(thread.id, 2);
  await until(async () => (await h.api<McpState>("GET", "/api/mcp")).servers[0].status !== "connected" || pids()[0] !== before, "noticed the crash");
  const back = await connected(h, server.id);
  assert.ok(back.tools.length >= 8);
  assert.notEqual(pids()[0], before);

  // Disable: the server and the browser-like grandchild go.
  const [pid, grandchild] = pids();
  assert.ok(alive(pid) && alive(grandchild));
  const disabled = await h.api<McpServerView>("PATCH", `/api/mcp/servers/${server.id}`, { enabled: false });
  await until(() => !alive(pid) && !alive(grandchild), "stopped on disable", 10_000);
  assert.ok(["disabled", "connecting"].includes(disabled.status));
  await until(async () => (await h.api<McpState>("GET", "/api/mcp")).servers[0].status === "disabled", "disabled status");
  assert.ok(!h.app.runner.toolNames("code", project).some((n) => n.startsWith("mcp__")));

  // On again, then the app closes: stopped as well.
  await h.api("PATCH", `/api/mcp/servers/${server.id}`, { enabled: true });
  await connected(h, server.id);
  await until(() => pids()[0] !== pid && alive(pids()[0]), "new process");
  const [pid2, grandchild2] = pids();
  await h.app.close();
  assert.ok(!alive(pid2), "server stopped when the app closed");
  await until(() => !alive(grandchild2), "grandchild stopped when the app closed", 5000);
});

test("MCP i appen: fjerning sletter hemmelighetene; validering av adresse, hoder og navn", async (t) => {
  const h = await startHarness(t);
  const { server, pids } = await addFake(h, t);
  await connected(h, server.id);
  const [pid] = pids();
  const snapshot = await h.api<McpState>("DELETE", `/api/mcp/servers/${server.id}`);
  assert.equal(snapshot.servers.length, 0);
  await until(() => !alive(pid), "removed server stopped", 10_000);
  assert.ok(!Object.keys(await h.keyring.load()).some((k) => k.startsWith("mcp:")));

  const bad = async (body: unknown, pattern: RegExp) => {
    const res = await h.raw("POST", "/api/mcp/servers", { headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(res.status, 400, res.body);
    assert.match(res.body, pattern);
  };
  await bad({ name: "x", transport: "http", url: "http://example.com/mcp" }, /https/);
  await bad({ name: "x", transport: "http", url: "https://u:p@example.com/mcp" }, /brukernavn/);
  await bad({ name: "x", transport: "http", url: "https://example.com/mcp", headers: [{ name: "Mcp-Session-Id", value: "a", secret: false }] }, /settes av appen/);
  await bad({ name: "x", transport: "http", url: "https://example.com/mcp", headers: [{ name: "X-A", value: "a\r\nb", secret: false }] }, /linjeskift/);
  await bad({ name: "", transport: "stdio", command: "npx" }, /navn/);
  await bad({ name: "x", transport: "stdio", command: "" }, /kommandoen/);
  await bad({ name: "x", transport: "stdio", command: "npx", env: [{ name: "1BAD", value: "a", secret: false }] }, /miljøvariabel/);
});

test("MCP over HTTP i appen: Authorization som hemmelighet, Bearer legges til, aldri i svar eller hendelser", async (t) => {
  const token = "ghp_fakeTokenForTests_0000000000";
  const fake = await startFakeHttp({ token });
  t.after(() => fake.close());
  const h = await startHarness(t);
  // Plain token in the field: the app adds "Bearer ".
  const server = await h.api<McpServerView>("POST", "/api/mcp/servers", { name: "GitHub test", transport: "http", url: fake.url, headers: [{ name: "Authorization", value: token, secret: false }] });
  assert.deepEqual(server.headers, [{ name: "Authorization", secret: true, value: "", set: true }]); // forced secret
  await connected(h, server.id, 2);
  assert.equal(fake.requests.at(-1)!.headers.authorization, `Bearer ${token}`);

  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id);
  await send(h, thread.id, "mcp-kall mcp__github_test__whoami {}");
  const events = await h.finished(thread.id);
  const result = (ofType(events, "tool.finished")[0].result ?? "");
  assert.match(result, /octocat/);
  assert.ok(!result.includes(token), "the echoed header is hidden");
  assert.ok(!JSON.stringify(await h.events(thread.id)).includes(token));
  assert.ok(!JSON.stringify(await h.api("GET", "/api/mcp")).includes(token));

  // Editing without a new value keeps the stored token; session expiry reconnects and retries.
  await h.api("PATCH", `/api/mcp/servers/${server.id}`, { name: "GitHub test", headers: [{ name: "Authorization", secret: true }] });
  await connected(h, server.id, 2);
  fake.expireSession();
  await send(h, thread.id, 'mcp-kall mcp__github_test__echo {"text":"etter utløp"}');
  const again = await h.finished(thread.id, 2);
  assert.match((ofType(again, "tool.finished").at(-1)!.result ?? ""), /etter utløp/);

  await h.api("DELETE", `/api/mcp/servers/${server.id}`);
  await until(() => fake.requests.some((r) => r.method === "DELETE"), "session ended");
  assert.ok(!existsSync(path.join(h.app.config.dataDir, "keys.json")));
});
