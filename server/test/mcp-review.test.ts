// MCP fixes after review: stable slugs and the permissions that follow them, stored entries that
// no longer validate, a shared reconnect after an expired session, plan mode, name forgiveness and
// hooks on MCP calls. Fake servers only (mcp-fake-*.ts).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { McpServerView, McpState } from "../../shared/mcp.ts";
import { Store } from "../src/db.ts";
import type { ToolContext } from "../src/agent/tools.ts";
import { startFakeHttp } from "./mcp-fake-http.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-fake-stdio.ts");
const quote = (file: string) => `'${file.replace(/'/g, `'\\''`)}'`;

const stdio = (name: string, extra: Record<string, unknown> = {}) => ({ name, transport: "stdio", command: process.execPath, args: [FAKE], ...extra });

async function state(h: Harness): Promise<McpState> {
  return h.api<McpState>("GET", "/api/mcp");
}

async function connected(h: Harness, id: string): Promise<McpServerView> {
  let view: McpServerView | undefined;
  await until(async () => (view = (await state(h)).servers.find((s) => s.id === id))?.status === "connected", `MCP server ${id} connected`, 15_000);
  return view!;
}

async function approvals(h: Harness, threadId: string) {
  return ofType((await h.events(threadId)).map((e) => e.event), "approval.requested");
}

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });

test("MCP-slug: fast per server, og «tillat alltid» og Chat-tillatelser følger serveren, ikke navnet", async (t) => {
  const h = await startHarness(t);
  const first = await h.api<McpServerView>("POST", "/api/mcp/servers", stdio("Fake"));
  const second = await h.api<McpServerView>("POST", "/api/mcp/servers", stdio("Fake", { chat: true }));
  assert.equal(first.slug, "fake");
  assert.equal(second.slug, "fake2");
  await connected(h, first.id);
  await connected(h, second.id);

  // "Allow always" for the second server's echo, in Kode and in a Chat.
  const project = await h.project(undefined, { permissionMode: "ask" });
  h.app.store.allow(project.id, "tool", "mcp__fake2__echo");
  h.app.store.allow(project.id, "tool", "mcp__fake__echo");
  const chat = await h.thread(null, "chat");
  h.app.mcp.allowInChat(chat.id, "mcp__fake2__echo");
  assert.equal(h.app.mcp.chatNeedsApproval(chat.id, "mcp__fake2__echo"), false);

  // Removing the first server does not renumber the second: it keeps fake2 and its permissions.
  await h.api("DELETE", `/api/mcp/servers/${first.id}`);
  assert.equal((await state(h)).servers[0].slug, "fake2");
  assert.ok(h.app.runner.toolNames("code", project).includes("mcp__fake2__echo"));
  assert.ok(h.app.store.isAllowed(project.id, "tool", "mcp__fake2__echo"));
  assert.ok(!h.app.store.isAllowed(project.id, "tool", "mcp__fake__echo"), "the removed server's rule went with it");

  // A new server named Fake gets the free slug fake, with no permissions from before.
  const third = await h.api<McpServerView>("POST", "/api/mcp/servers", stdio("Fake", { chat: true }));
  assert.equal(third.slug, "fake");
  await connected(h, third.id);
  assert.equal(h.app.mcp.chatNeedsApproval(chat.id, "mcp__fake__echo"), true);

  // Renaming gives a new slug and drops the old slug's permissions.
  const renamed = await h.api<McpServerView>("PATCH", `/api/mcp/servers/${second.id}`, { name: "Annen" });
  assert.equal(renamed.slug, "annen");
  assert.ok(!h.app.store.isAllowed(project.id, "tool", "mcp__fake2__echo"));
  await connected(h, second.id);
  assert.ok(h.app.runner.toolNames("code", project).includes("mcp__annen__echo"));
  assert.ok(!h.app.runner.toolNames("code", project).some((n) => n.startsWith("mcp__fake2__")));
  // A later server called Fake again cannot inherit the old Chat permission either.
  const fourth = await h.api<McpServerView>("POST", "/api/mcp/servers", stdio("Fake", { chat: true }));
  assert.equal(fourth.slug, "fake2");
  await connected(h, fourth.id);
  assert.equal(h.app.mcp.chatNeedsApproval(chat.id, "mcp__fake2__echo"), true);
});

test("MCP-lagring: en lagret server som ikke valideres beholdes, vises som feil, og kan rettes eller slettes", async (t) => {
  const dataDir = tempDir(t, "ad-data-");
  const before = new Store(dataDir);
  before.setMetaValue("mcp-servers", [
    { id: "ok-1", name: "Fin", slug: "fin", transport: "stdio", command: process.execPath, args: [FAKE], env: [], url: "", headers: [], enabled: false, code: true, chat: false, approval: "ask", timeoutSeconds: 120, disabledTools: [] },
    { id: "bad-1", name: "Ødelagt", slug: "odelagt", transport: "ftp", command: "x" },
  ]);
  before.close();
  const h = await startHarness(t, { dataDir });
  const servers = (await state(h)).servers;
  assert.deepEqual(servers.map((s) => s.id), ["ok-1", "bad-1"]);
  const bad = servers[1];
  assert.equal(bad.status, "error");
  assert.match(bad.message, /kunne ikke leses.*stdio eller HTTP/s);
  await assert.rejects(h.api("POST", "/api/mcp/servers/bad-1/reconnect"), /409/);

  // Another save keeps it in the database, as it was.
  await h.api("PATCH", "/api/mcp/servers/ok-1", { disabledTools: ["echo"] });
  const stored = h.app.store.metaValue("mcp-servers") as any[];
  assert.equal(stored.find((s) => s.id === "bad-1").transport, "ftp");

  // Saved again from the form: a normal server, with its old slug.
  const fixed = await h.api<McpServerView>("PATCH", "/api/mcp/servers/bad-1", stdio("Ødelagt"));
  assert.equal(fixed.slug, "odelagt");
  await connected(h, "bad-1");
  await h.api("DELETE", "/api/mcp/servers/bad-1");
  assert.deepEqual((await state(h)).servers.map((s) => s.id), ["ok-1"]);
});

test("MCP over HTTP: to kall som får 404 samtidig deler én ny tilkobling og lykkes begge", async (t) => {
  const fake = await startFakeHttp();
  t.after(() => fake.close());
  const h = await startHarness(t);
  const server = await h.api<McpServerView>("POST", "/api/mcp/servers", { name: "Nett", transport: "http", url: fake.url });
  await connected(h, server.id);
  const tool = h.app.mcp.tool("mcp__nett__echo", "code")!;
  const ctx = { signal: new AbortController().signal } as ToolContext;
  fake.expireSession();
  const inits = () => fake.requests.filter((r) => r.body?.method === "initialize").length;
  const before = inits();
  const results = await Promise.all([tool.run({ text: "en" }, ctx), tool.run({ text: "to" }, ctx), tool.run({ text: "tre" }, ctx)]);
  for (const [i, text] of ["en", "to", "tre"].entries()) {
    assert.equal(results[i].isError, undefined, results[i].text);
    assert.deepEqual(JSON.parse(results[i].text), { text });
  }
  assert.equal(inits() - before, 1, "one reconnect for all three");
});

test("MCP i planmodus: et direkte kall avvises i runTool; navn tilgis bare blant MCP-verktøy", async (t) => {
  const h = await startHarness(t);
  const server = await h.api<McpServerView>("POST", "/api/mcp/servers", stdio("Fake", { chat: true, approval: "auto" }));
  await connected(h, server.id);
  const project = await h.project(undefined, { permissionMode: "full" });

  const plan = await h.thread(project.id);
  await h.api("PATCH", `/api/threads/${plan.id}`, { planMode: true });
  await send(h, plan.id, 'mcp-kall mcp__fake__echo {"text":"plan"}');
  let events = await h.finished(plan.id);
  let finished = ofType(events, "tool.finished")[0];
  assert.equal(finished.status, "error");
  assert.match(finished.result ?? "", /Planmodus er på/);

  // Other case and a functions. prefix: still the MCP tool, under its real name.
  const code = await h.thread(project.id);
  await send(h, code.id, 'mcp-kall functions.MCP__Fake__Echo {"text":"tilgitt"}');
  events = await h.finished(code.id);
  finished = ofType(events, "tool.finished")[0];
  assert.equal(finished.status, "done", finished.result ?? "");
  assert.match(finished.result ?? "", /tilgitt/);
  assert.equal(ofType(events, "tool.started")[0].tool, "mcp__fake__echo");
  // An MCP-looking name never reaches a built-in tool.
  await send(h, code.id, 'mcp-kall mcp__fake__read_file {"path":"x"}');
  events = await h.finished(code.id, 2);
  assert.match(ofType(events, "tool.finished").at(-1)!.result ?? "", /Ukjent verktøy/);

  const chat = await h.thread(null, "chat");
  await send(h, chat.id, 'mcp-kall MCP__FAKE__ECHO {"text":"chat"}');
  events = await h.finished(chat.id);
  finished = ofType(events, "tool.finished")[0];
  assert.equal(finished.status, "done", finished.result ?? "");
  assert.equal((await approvals(h, chat.id)).length, 0); // the server is set to auto
});

test("Hooks kjører på mcp__-kall: PreToolUse og PostToolUse i både Kode og Chat", async (t) => {
  const home = tempDir(t, "ad-home-");
  const out = tempDir(t, "ad-hooks-out-");
  const h = await startHarness(t, { homeDir: home });
  const server = await h.api<McpServerView>("POST", "/api/mcp/servers", stdio("Fake", { chat: true, approval: "auto" }));
  const view = await connected(h, server.id);
  const pre = path.join(out, "pre.jsonl");
  const post = path.join(out, "post.jsonl");
  await h.api("POST", "/api/hooks", { name: "Før MCP", event: "PreToolUse", matcher: `mcp__${view.slug}__*`, modes: ["code", "chat"], command: `cat >> ${quote(pre)}; echo >> ${quote(pre)}` });
  await h.api("POST", "/api/hooks", { name: "Etter MCP", event: "PostToolUse", matcher: `mcp__${view.slug}__*`, modes: ["code", "chat"], command: `cat >> ${quote(post)}; echo >> ${quote(post)}` });

  const project = await h.project(undefined, { permissionMode: "full" });
  const code = await h.thread(project.id);
  await send(h, code.id, 'mcp-kall mcp__fake__echo {"text":"kode"}');
  await h.finished(code.id);
  const chat = await h.thread(null, "chat");
  await send(h, chat.id, 'mcp-kall mcp__fake__echo {"text":"chat"}');
  await h.finished(chat.id);

  await until(() => existsSync(pre) && existsSync(post) && readFileSync(post, "utf8").includes('"chat"'), "both hooks ran twice", 10_000);
  for (const file of [pre, post]) {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    assert.equal(lines.length, 2, file);
    assert.ok(lines.every((l) => l.tool_name === "mcp__fake__echo"));
    assert.deepEqual(lines.map((l) => l.tool_input.text), ["kode", "chat"]);
  }
});
