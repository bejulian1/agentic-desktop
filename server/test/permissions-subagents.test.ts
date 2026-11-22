// 1.2.0: "Tillat alltid" by command prefix, one mode for every project, saved rules in
// Innstillinger, and helpers on another model from the provider the thread runs on.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { PermissionMode, ThreadEvent } from "../../shared/protocol.ts";
import { allowRule, commandPrefix, decide } from "../src/agent/permissions.ts";
import { TOOLS_BY_NAME } from "../src/agent/tools.ts";
import { localPanelProject } from "../src/http/ws.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, until, type Harness } from "./helpers.ts";

async function addProvider(h: Harness, llm: FakeLlm, name = "Egen") {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name, baseUrl: `${llm.url}/v1`, apiKey: "test-only" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Hovedmodell", model: "main-model", contextWindow: 100_000 });
  return { provider, model };
}

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });
const results = async (h: Harness, threadId: string) => ofType((await h.events(threadId)).map((e) => e.event), "tool.finished");

test("command prefixes: simple commands by their words, compound and risky ones never", () => {
  const table: Array<[string, string | undefined]> = [
    ["git status", "git status"],
    ["git status --short", "git status"],
    ["git diff HEAD~1", "git diff"],
    ["git -c core.sshCommand=x status", undefined],
    ["git config core.hooksPath x", undefined],
    ["npm test", "npm test"],
    ["npm test -- --grep x", "npm test"],
    ["npm run typecheck", "npm run typecheck"],
    ["npm run", undefined],
    ["pnpm install", undefined],
    ["npx tsc --noEmit", "npx tsc"],
    ["cargo test --all", "cargo test"],
    ["go test ./...", "go test"],
    ["python -m pytest -q", "python -m pytest"],
    ["python -c 'import os'", undefined],
    ["python manage.py check", "python manage.py"],
    ["node --test server/test/a.test.ts", "node --test"],
    ["node -e 1", undefined],
    ["node --test --import=./x.js", undefined],
    ["ls -la", "ls"],
    ["pytest -q", "pytest"],
    ["rm -rf build", undefined],
    ["sudo ls", undefined],
    ["find . -delete", undefined],
    ["echo hi > f", undefined],
    ["git status && rm -rf x", undefined],
    ["cat a | sh", undefined],
    ["ls; id", undefined],
    ["echo $(id)", undefined],
    ["echo `id`", undefined],
    ["FOO=1 npm test", undefined],
    ["./run.sh", undefined],
    ["unknown-tool run", undefined],
  ];
  for (const [command, prefix] of table) assert.equal(commandPrefix(command), prefix, command);
  assert.deepEqual(allowRule("run_command", { command: "git status -s" }), { kind: "prefix", value: "git status" });
  assert.deepEqual(allowRule("run_command", { command: "git status | head" }), { kind: "command", value: "git status | head" });
  assert.deepEqual(allowRule("browser_click", {}), { kind: "tool", value: "browser_*" });
  assert.deepEqual(allowRule("thread_create", {}), { kind: "tool", value: "thread_create" });
});

test("saved rules: prefix, exact (as before), every browser tool, and protected commands still ask", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "a.txt"), "hei");
  const thread = await h.thread(project.id);
  const ask = (tool: string, input: Record<string, unknown>) => decide(TOOLS_BY_NAME.get(tool)!, input, project, thread, h.app.store, h.app.config.dataDir);
  assert.equal(ask("run_command", { command: "git status" }).ask, true);
  h.app.store.allow(project.id, "prefix", "git status");
  assert.equal(ask("run_command", { command: "git status --porcelain" }).ask, false);
  assert.equal(ask("run_command", { command: "git push" }).ask, true, "another subcommand asks");
  assert.equal(ask("run_command", { command: "git status && git push" }).ask, true, "a chain is never covered by a prefix");
  // An exact rule from an earlier version still counts.
  h.app.store.allow(project.id, "command", "make release && echo ok");
  assert.equal(ask("run_command", { command: "make release && echo ok" }).ask, false);
  // A protected path asks even with a matching prefix, and never offers "always".
  h.app.store.allow(project.id, "prefix", "cat");
  assert.equal(ask("run_command", { command: "cat notes.txt" }).ask, false);
  const env = ask("run_command", { command: "cat .env" });
  assert.equal(env.ask, true);
  assert.equal(env.canAllowAlways, false);
  // One answer for the browser covers every browser tool.
  assert.equal(ask("browser_console", {}).ask, true);
  h.app.store.allow(project.id, "tool", "browser_*");
  assert.equal(ask("browser_console", {}).ask, false);
});

test("full and accept-edits: what never asks", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "a.txt"), "hei");
  const thread = await h.thread(project.id);
  const table: Array<[PermissionMode, string, Record<string, unknown>, boolean]> = [
    ["full", "edit_file", { path: "a.txt", old_string: "hei", new_string: "hå" }, false],
    ["full", "write_file", { path: "b.txt", content: "x" }, false],
    ["full", "delete_file", { path: "a.txt" }, false],
    ["full", "run_command", { command: "npm test" }, false],
    ["full", "browser_console", {}, false],
    ["full", "thread_create", { title: "x", task: "y" }, false],
    ["full", "thread_send", { threadId: "x", text: "y" }, false],
    ["full", "write_file", { path: ".env", content: "x" }, true],
    ["accept-edits", "edit_file", { path: "a.txt", old_string: "hei", new_string: "hå" }, false],
    ["accept-edits", "write_file", { path: "b.txt", content: "x" }, false],
    ["accept-edits", "delete_file", { path: "a.txt" }, false],
    ["accept-edits", "run_command", { command: "npm test" }, true],
    ["accept-edits", "thread_create", { title: "x", task: "y" }, true],
  ];
  for (const [mode, tool, input, asks] of table) {
    const decision = decide(TOOLS_BY_NAME.get(tool)!, input, { ...project, permissionMode: mode }, thread, h.app.store, h.app.config.dataDir);
    assert.equal(decision.ask, asks, `${mode} ${tool}`);
  }
  h.app.store.allow(project.id, "tool", "thread_create");
  assert.equal(decide(TOOLS_BY_NAME.get("thread_create")!, { title: "x", task: "y" }, { ...project, permissionMode: "accept-edits" }, thread, h.app.store, h.app.config.dataDir).ask, false);
});

test("accept-edits: Tillat alltid on a command covers the next call in the same turn", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const { model } = await addProvider(h, llm);
  const project = await h.project(undefined, { permissionMode: "accept-edits" });
  const thread = await h.thread(project.id, "code", model.id);
  llm.reply(sse(openaiToolCall("run_command", { command: "echo en" }, "a")));
  llm.reply(sse(openaiToolCall("write_file", { path: "b.txt", content: "x" }, "b")));
  llm.reply(sse(openaiToolCall("run_command", { command: "echo to" }, "c")));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "kjør");
  let approval: Extract<ThreadEvent, { type: "approval.requested" }> | undefined;
  await until(async () => (approval = ofType((await h.events(thread.id)).map((e) => e.event), "approval.requested")[0]) !== undefined, "approval");
  assert.equal(approval!.allowAlways, "echo …");
  await h.api("POST", `/api/approvals/${approval!.approvalId}`, { decision: "allow-always" });
  await h.finished(thread.id);
  const events = (await h.events(thread.id)).map((e) => e.event);
  assert.equal(ofType(events, "approval.requested").length, 1, "the write and the second command did not ask");
  assert.deepEqual((await results(h, thread.id)).map((r) => r.status), ["done", "done", "done"]);
});

test("Bruk på alle prosjekter, and saved rules can be listed and taken back", async (t) => {
  const h = await startHarness(t);
  const one = await h.project(undefined, { permissionMode: "ask" });
  const two = await h.project(undefined, { permissionMode: "accept-edits" });
  await assert.rejects(h.api("POST", "/api/projects/apply-permission-mode", { permissionMode: "everything" }), /400|Ugyldig/);
  const socket = await h.socket();
  const applied = await h.api("POST", "/api/projects/apply-permission-mode", { permissionMode: "full" });
  assert.equal(applied.changed, 2);
  assert.equal(h.app.store.project(one.id)!.permissionMode, "full");
  assert.equal(h.app.store.project(two.id)!.permissionMode, "full");
  await socket.waitFor((message) => message.type === "project.changed" && message.project.id === two.id && message.project.permissionMode === "full");
  assert.equal((await h.api("POST", "/api/projects/apply-permission-mode", { permissionMode: "full" })).changed, 0);

  h.app.store.allow(one.id, "prefix", "git status");
  h.app.store.allow(one.id, "tool", "browser_*");
  h.app.store.allow(two.id, "command", "make && echo ok");
  h.app.store.setMetaValue("app:local-allow-rules", ["prefix:ls", "junk"]);
  let rules = await h.api("GET", "/api/permissions/rules");
  assert.deepEqual(rules.map((r: any) => `${r.projectId === one.id ? "one" : r.projectId === two.id ? "two" : r.projectId}|${r.kind}|${r.label}`).sort(),
    ["local|prefix|ls …", "one|prefix|git status …", "one|tool|browser_*", "two|command|make && echo ok"]);
  rules = await h.api("POST", "/api/permissions/rules/remove", { projectId: one.id, kind: "prefix", value: "git status" });
  assert.equal(h.app.store.isAllowed(one.id, "prefix", "git status"), false);
  assert.equal(rules.length, 3);
  await assert.rejects(h.api("POST", "/api/permissions/rules/remove", { projectId: one.id, kind: "prefix", value: "git status" }), /404|Fant ikke/);
  rules = await h.api("POST", "/api/permissions/rules/remove", { projectId: "local", kind: "prefix", value: "ls" });
  assert.equal(rules.some((r: any) => r.projectId === "local"), false);
  rules = await h.api("POST", "/api/permissions/rules/clear", { projectId: two.id });
  assert.deepEqual(rules.map((r: any) => r.value), ["browser_*"]);
  rules = await h.api("POST", "/api/permissions/rules/clear", {});
  assert.deepEqual(rules, []);
});

test("the terminal on Denne datamaskinen follows the default permission mode", async (t) => {
  const h = await startHarness(t);
  assert.equal(localPanelProject("/tmp", h.app.store).permissionMode, "ask");
  await h.api("PATCH", "/api/settings", { defaultPermissionMode: "full" });
  assert.equal(localPanelProject("/tmp", h.app.store).permissionMode, "full");
});

test("a helper on another model ID from the running provider starts without approval in full access", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const { provider, model } = await addProvider(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", model.id);
  llm.always((req, res) => {
    const body = req.body;
    if (body.model === "helper-model") return sse(openaiText("Hjelper ferdig"))(req, res);
    if (body.messages.at(-1).role === "tool") return sse(openaiText("Koordinator ferdig"))(req, res);
    return sse(openaiToolCall("thread_create", { title: "Hjelper", task: "Se på testene", model: "helper-model" }, "create"))(req, res);
  });
  await send(h, thread.id, "Start en hjelper på helper-model");
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "approval.requested").length, 0);
  const [spawned] = ofType(events, "thread.spawned");
  assert.ok(spawned, ofType(events, "tool.finished").map((e) => e.result).join("\n"));
  const child = h.app.store.thread(spawned.childThreadId)!;
  const saved = h.app.store.model(child.modelId!)!;
  assert.equal(saved.providerId, provider.id);
  assert.equal(saved.model, "helper-model");
  assert.equal(saved.supportsTools, true);
  await h.finished(child.id);
  assert.ok(llm.requests.some((r) => r.body?.model === "helper-model"));
  // A second helper on the same ID reuses the saved model.
  assert.equal(h.app.store.models().filter((m) => m.model === "helper-model").length, 1);
});

test("a model ID that is not configured never reaches another provider, and must be a plain ID", async (t) => {
  const h = await startHarness(t);
  const collab = h.app.runner.collab;
  const llm = await startFakeLlm(t);
  const { model } = await addProvider(h, llm);
  const draft = collab.modelChoice("deepseek-chat", model.id);
  assert.ok(!("text" in draft) && "draft" in draft);
  assert.equal((draft as any).providerId, model.providerId);
  for (const bad of ["", "   ", "a\u0000b", "x".repeat(201), 42, crypto.randomUUID()]) assert.ok("text" in collab.modelChoice(bad, model.id), String(bad));
  assert.ok("text" in collab.modelChoice("deepseek-chat", "mock-demo"), "the demo provider has no other models");
  assert.equal(h.app.store.models().some((m) => m.model === "deepseek-chat"), false, "nothing is saved before the helper starts");
});

test("thread_models with available lists the running provider's models, cached, and never fails on a broken list", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const { model } = await addProvider(h, llm);
  let lists = 0;
  let broken = false;
  llm.always((req, res) => {
    if (req.method === "GET" && req.url.endsWith("/models")) {
      lists++;
      if (broken) return void res.writeHead(500).end("nei");
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ data: [{ id: "main-model" }, { id: "gpt-5.4" }, { id: "deepseek-chat" }] }));
    }
    res.writeHead(500).end();
  });
  const collab = h.app.runner.collab;
  const first = JSON.parse((await collab.models("", 0, 20_000, { modelId: model.id, available: true })).text);
  assert.equal(first.models.find((m: any) => m.id === model.id).sameProvider, true);
  assert.equal(first.models.find((m: any) => m.id === "mock-demo")?.sameProvider, false);
  assert.deepEqual(first.currentProvider.available.map((m: any) => `${m.model}:${m.configured}`).sort(), ["deepseek-chat:false", "gpt-5.4:false", "main-model:true"]);
  const search = JSON.parse((await collab.models("deep", 0, 20_000, { modelId: model.id, available: true })).text);
  assert.deepEqual(search.currentProvider.available.map((m: any) => m.model), ["deepseek-chat"]);
  assert.equal(lists, 1, "the list is cached");
  const plain = JSON.parse((await collab.models("", 0, 20_000, { modelId: model.id })).text);
  assert.equal(plain.currentProvider, undefined, "without available, no network");

  // Another address is another list; a broken one gives a note instead of an error.
  broken = true;
  const other = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Brutt", baseUrl: `${llm.url}/v2`, apiKey: "test-only" });
  const otherModel = await h.api("POST", "/api/models", { providerId: other.id, name: "B", model: "b", contextWindow: 100_000 });
  const failed = await collab.models("", 0, 20_000, { modelId: otherModel.id, available: true });
  assert.equal(failed.isError, undefined);
  assert.match(JSON.parse(failed.text).currentProvider.note, /svarte ikke/);
});

test("a custom OpenAI-compatible provider takes its first model ID right after it is saved", async (t) => {
  const h = await startHarness(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Egendefinert", baseUrl: "http://127.0.0.1:9/v1" });
  const added = await h.api("POST", `/api/providers/${provider.id}/models`, { models: [{ model: "gpt-5.4" }] });
  assert.equal(added.length, 1);
  assert.equal(added[0].model, "gpt-5.4");
  assert.equal(added[0].providerId, provider.id);
  assert.ok(added[0].contextWindow > 0);
});
