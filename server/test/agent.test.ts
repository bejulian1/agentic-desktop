// The real loop with real tools, driven by the demo model or by scripted streams.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { PermissionMode, ThreadEvent } from "../../shared/protocol.ts";
import { MAX_STEPS } from "../src/agent/runner.ts";
import { REPO_ROOT } from "../src/config.ts";
import type { Message } from "../src/providers/types.ts";
import { hang, httpError, OPENAI_DONE, openaiChunk, openaiText, openaiToolCall, openaiUsage, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, textOf, until, type Harness } from "./helpers.ts";

async function addFakeModel(h: Harness, llm: FakeLlm, options: Record<string, unknown> = {}): Promise<string> {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000, ...options });
  return model.id;
}

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });

async function nextApproval(h: Harness, threadId: string, index = 0) {
  let found: Extract<ThreadEvent, { type: "approval.requested" }> | undefined;
  await until(async () => {
    found = ofType((await h.events(threadId)).map((e) => e.event), "approval.requested")[index];
    return found !== undefined;
  }, "approval");
  return found!;
}

test("chat mode streams Markdown with code blocks and offers no tools", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  assert.equal(thread.projectId, null);
  await send(h, thread.id, "Vis meg et eksempel");
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.match(textOf(events), /```ts/);
  assert.match(textOf(events), /```python/);
  assert.equal(ofType(events, "tool.started").length, 0);
  assert.ok(ofType(events, "thinking.done").length > 0);
  assert.equal((await h.api("GET", "/api/bootstrap")).threads[0].title, "Vis meg et eksempel");
});

test("deltas are merged before storage", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  await send(h, thread.id, "lang strøm 20000");
  const events = await h.finished(thread.id);
  const deltas = ofType(events, "text.delta");
  assert.equal(textOf(events).length, 20000);
  assert.ok(deltas.length < 20000 / 64 / 2, `${deltas.length} rows for ${Math.ceil(20000 / 64)} chunks`);
});

test("lang strøm rolig streams at the speed of a real model", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  const started = performance.now();
  await send(h, thread.id, "lang strøm 640 rolig");
  const events = await h.finished(thread.id);
  assert.equal(textOf(events).length, 640);
  assert.ok(performance.now() - started >= 240, "ten pieces, 25 ms apart");
});

test("the demo model is preselected and marked", async (t) => {
  const h = await startHarness(t);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.equal(boot.settings.defaultModelId, "mock-demo");
  assert.equal(boot.models.find((m: any) => m.id === "mock-demo").name, "Demo-modell (uten API)");
  assert.equal(boot.settings.autoOpenAgentThreads, true);
  assert.equal(boot.build.signature, "Code Pro");
  assert.equal(boot.build.name, "Agentic Desktop");
});

const TABLE: Array<[PermissionMode, string, Record<string, unknown>, boolean]> = [
  ["ask", "read_file", { path: "a.txt" }, false],
  ["ask", "search", { pattern: "hei" }, false],
  ["ask", "list_dir", { path: "." }, false],
  ["ask", "write_file", { path: "b.txt", content: "x" }, true],
  ["ask", "edit_file", { path: "a.txt", old_string: "hei", new_string: "hå" }, true],
  ["ask", "run_command", { command: "true" }, true],
  ["ask", "browser_console", {}, true],
  ["ask", "thread_create", { title: "x", task: "y" }, true],
  ["accept-edits", "read_file", { path: "a.txt" }, false],
  ["accept-edits", "write_file", { path: "b.txt", content: "x" }, false],
  ["accept-edits", "edit_file", { path: "a.txt", old_string: "hei", new_string: "hå" }, false],
  ["accept-edits", "run_command", { command: "true" }, true],
  ["accept-edits", "browser_console", {}, true],
  ["accept-edits", "thread_send", { threadId: "x", text: "y" }, true],
  ["full", "read_file", { path: "a.txt" }, false],
  ["full", "write_file", { path: "b.txt", content: "x" }, false],
  ["full", "run_command", { command: "true" }, false],
  ["full", "thread_send", { threadId: "x", text: "y" }, false],
];

test("the permission table holds for every mode", async (t) => {
  const { decide } = await import("../src/agent/permissions.ts");
  const { TOOLS_BY_NAME } = await import("../src/agent/tools.ts");
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "a.txt"), "hei");
  const thread = await h.thread(project.id);
  for (const [mode, tool, input, asks] of TABLE) {
    const decision = decide(TOOLS_BY_NAME.get(tool)!, input, { ...project, permissionMode: mode }, thread, h.app.store, h.app.config.dataDir);
    assert.equal(decision.ask, asks, `${mode} ${tool}`);
  }
});

test("the demo model's page flow asks, and a denied write stops short of the file", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const thread = await h.thread(project.id);
  await send(h, thread.id, "lag en side");
  const approval = await nextApproval(h, thread.id);
  assert.match(approval.title, /write_file/);
  assert.equal(approval.canAllowAlways, true);
  assert.equal(h.app.store.thread(thread.id)!.pendingApprovals, 1, "badge for the sidebar");
  assert.equal(existsSync(path.join(project.path, "index.html")), false, "nothing written before the answer");
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "deny" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "tool.finished").at(-1)!.status, "denied");
  assert.equal(h.app.store.thread(thread.id)!.pendingApprovals, 0);
  assert.equal(existsSync(path.join(project.path, "index.html")), false);
  assert.match(textOf(events), /avslo/);
});

test("allow always is stored per project as the exact command or tool", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project();
  const other = await h.project();
  const thread = await h.thread(project.id, "code", modelId);

  llm.reply(sse(openaiToolCall("run_command", { command: "echo en" })));
  llm.reply(sse(openaiToolCall("run_command", { command: "echo en" }, "c2")));
  llm.reply(sse(openaiToolCall("run_command", { command: "echo to" }, "c3")));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "kjør");
  const first = await nextApproval(h, thread.id);
  await h.api("POST", `/api/approvals/${first.approvalId}`, { decision: "allow-always" });
  const second = await nextApproval(h, thread.id, 1);
  assert.match(second.detail, /echo to/, "the same command ran again without asking");
  await h.api("POST", `/api/approvals/${second.approvalId}`, { decision: "deny" });
  await h.finished(thread.id);

  const decide = (await import("../src/agent/permissions.ts")).decide;
  const tool = (await import("../src/agent/tools.ts")).TOOLS_BY_NAME.get("run_command")!;
  assert.equal(decide(tool, { command: "echo en" }, other, thread, h.app.store, h.app.config.dataDir).ask, true, "rules do not cross projects");
});

test(".env and .git/hooks ask even in full access, and search skips them", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, ".env.local"), "HEMMELIG=finnes\n");
  mkdirSync(path.join(project.path, ".git/hooks"), { recursive: true });
  symlinkSync(".env.local", path.join(project.path, "lenke.txt"));
  const thread = await h.thread(project.id, "code", modelId);

  const calls: Array<[string, Record<string, unknown>]> = [
    ["read_file", { path: ".env.local" }],
    ["read_file", { path: "lenke.txt" }],
    ["write_file", { path: ".git/hooks/pre-commit", content: "x" }],
    ["run_command", { command: "cat .env.local" }],
  ];
  calls.forEach(([name, input], i) => llm.reply(sse(openaiToolCall(name, input, `c${i}`))));
  llm.reply(sse(openaiToolCall("search", { pattern: "HEMMELIG" }, "s")));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "prøv");
  for (let i = 0; i < calls.length; i++) {
    const approval = await nextApproval(h, thread.id, i);
    assert.equal(approval.canAllowAlways, false, calls[i][0]);
    await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "deny" });
  }
  const events = await h.finished(thread.id);
  const finished = ofType(events, "tool.finished");
  assert.deepEqual(finished.slice(0, 4).map((e) => e.status), ["denied", "denied", "denied", "denied"]);
  assert.equal(finished[4].result, "Ingen treff", "search must not leak .env");
  assert.equal(existsSync(path.join(project.path, ".git/hooks/pre-commit")), false);
});

test("commands that name the app's data dir ask even in full access", async (t) => {
  const { decide } = await import("../src/agent/permissions.ts");
  const { TOOLS_BY_NAME } = await import("../src/agent/tools.ts");
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id);
  const ask = (command: string) => decide(TOOLS_BY_NAME.get("run_command")!, { command }, project, thread, h.app.store, h.app.config.dataDir);
  assert.equal(ask(`cat ${h.app.config.dataDir}/keys.json`).ask, true);
  assert.equal(ask(`cat ${h.app.config.dataDir}/keys.json`).canAllowAlways, false);
  assert.equal(ask("npm test").ask, false);
});

test("the same call three times in a row asks, also in full access", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id);
  await send(h, thread.id, "løkke");
  const approval = await nextApproval(h, thread.id);
  assert.match(approval.title, /gjentatt tre ganger/);
  assert.equal(approval.canAllowAlways, false);
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "deny" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "tool.finished").length, 3);
  assert.match(textOf(events), /bremsen/);
});

test("stop ends a run at any time and takes the whole process group with it", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id);
  const script = 'echo $$ > pid.txt; (sleep 300; touch overlevde.txt) & echo child $! > child.txt; echo klar; wait';
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", shell: script });
  await until(() => existsSync(path.join(project.path, "child.txt")), "command started");
  const childPid = Number(readFileSync(path.join(project.path, "child.txt"), "utf8").split(" ")[1]);
  assert.equal(h.app.store.thread(thread.id)!.running, true);
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "stopped");
  assert.equal(ofType(events, "tool.finished")[0].status, "cancelled");
  await until(() => !alive(childPid), "child gone");
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("stop during streaming keeps what was said and the thread can go on", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const thread = await h.thread(null, "chat", modelId);
  llm.reply(hang(openaiChunk({ content: "Halvt svar" })));
  await send(h, thread.id, "Hei");
  await until(async () => textOf((await h.events(thread.id)).map((e) => e.event)) === "Halvt svar", "partial text");
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "stopped");

  llm.reply(sse(openaiText("Fortsetter")));
  await send(h, thread.id, "Fortsett");
  await h.finished(thread.id, 2);
  const history = llm.requests.at(-1)!.body.messages;
  assert.deepEqual(history.slice(1).map((m: any) => [m.role, m.content]), [["user", "Hei"], ["assistant", "Halvt svar"], ["user", "Fortsett"]]);
});

test("stop during an approval cancels it", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const thread = await h.thread(project.id);
  await send(h, thread.id, "godkjenning");
  const approval = await nextApproval(h, thread.id);
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "approval.resolved")[0].decision, "deny");
  assert.equal(ofType(events, "tool.finished")[0].status, "cancelled");
  const late = await h.raw("POST", `/api/approvals/${approval.approvalId}`, { headers: { "content-type": "application/json" }, body: '{"decision":"allow"}' });
  assert.equal(late.status, 404);
});

test("messages sent during a run wait in the queue, in order", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const thread = await h.thread(null, "chat", modelId);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  llm.reply(async (req, res) => {
    await gate;
    await sse(openaiText("Svar en"))(req, res);
  });
  llm.reply(sse(openaiText("Svar to")));
  llm.reply(sse(openaiText("Svar tre")));
  assert.equal((await send(h, thread.id, "En")).queued, false);
  const second = await send(h, thread.id, "To");
  const third = await send(h, thread.id, "Tre");
  assert.equal(second.queued, true);
  assert.equal(third.queued, true);
  const queuedEvents = ofType((await h.events(thread.id)).map((e) => e.event), "user.queued");
  assert.deepEqual(queuedEvents.map((e) => e.messageId), [second.messageId, third.messageId]);
  release();
  const events = await h.finished(thread.id, 3);
  assert.deepEqual(ofType(events, "user.message").map((e) => e.text), ["En", "To", "Tre"]);
  assert.equal(ofType(events, "user.message")[1].messageId, second.messageId);
  assert.deepEqual(llm.requests[2].body.messages.at(-1), { role: "user", content: "Tre" });
});

test("stop keeps queued messages in the conversation without starting them", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const thread = await h.thread(null, "chat", modelId);
  llm.reply(hang());
  await send(h, thread.id, "En");
  await send(h, thread.id, "To");
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  await h.finished(thread.id);
  await until(async () => ofType((await h.events(thread.id)).map((e) => e.event), "user.message").length === 2, "drained");
  assert.equal(h.app.store.thread(thread.id)!.running, false);
  assert.equal(llm.requests.length, 1);
});

test("parallel threads run side by side without touching each other", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const threads = await Promise.all([h.thread(null, "chat", modelId), h.thread(null, "chat", modelId), h.thread(null, "chat", modelId)]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  llm.always(async (req, res) => {
    await gate;
    await sse(openaiText(`Svar på ${req.body.messages.at(-1).content}`), 5)(req, res);
  });
  for (const [i, thread] of threads.entries()) await send(h, thread.id, `tråd ${i}`);
  await until(() => llm.requests.length === 3, "all three started");
  assert.ok(threads.every((thread) => h.app.store.thread(thread.id)!.running));
  await h.api("POST", `/api/threads/${threads[1].id}/stop`);
  release();
  const results = await Promise.all(threads.map((thread) => h.finished(thread.id)));
  assert.equal(textOf(results[0]), "Svar på tråd 0");
  assert.equal(ofType(results[1], "run.finished")[0].status, "stopped");
  assert.equal(textOf(results[2]), "Svar på tråd 2");
});

test("the loop stops at 50 steps", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", modelId);
  let n = 0;
  llm.always((req, res) => sse(openaiToolCall("list_dir", { path: `.`, n: n++ } as any, `c${n}`))(req, res));
  await send(h, thread.id, "fortsett for alltid");
  const events = await h.finished(thread.id);
  const end = ofType(events, "run.finished")[0];
  assert.equal(end.status, "error");
  assert.match(end.error!, /50 steg/);
  assert.equal(llm.requests.length, MAX_STEPS);
});

test("rate limits and server errors are retried, but not after output has started", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const thread = await h.thread(null, "chat", modelId);
  llm.reply(httpError(429, { error: { message: "Vent" } }));
  llm.reply(httpError(503, { error: { message: "Nede" } }));
  llm.reply(sse(openaiText("Endelig")));
  await send(h, thread.id, "Hei");
  assert.equal(textOf(await h.finished(thread.id)), "Endelig");
  assert.equal(llm.requests.length, 3);

  llm.reply((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(openaiChunk({ content: "Halvt" }));
    setTimeout(() => res.destroy(), 5);
  });
  await send(h, thread.id, "Igjen");
  const events = await h.finished(thread.id, 2);
  assert.equal(ofType(events, "run.finished")[1].status, "error");
  assert.equal(llm.requests.length, 4, "no double text from a retry");

  llm.reply(httpError(401, { error: { message: "Feil nøkkel" } }));
  await send(h, thread.id, "En gang til");
  const after = await h.finished(thread.id, 3);
  assert.match(ofType(after, "run.finished")[2].error!, /Feil nøkkel/);
  assert.equal(llm.requests.length, 5, "a 401 is not retried");
  const stored = JSON.stringify(after);
  assert.ok(!stored.includes("sk-test"), "the key is never in the event log");
});

test("bad tool calls come back to the model as errors", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("finnes_ikke", {}, "a")));
  llm.reply(sse(openaiChunk({ tool_calls: [{ index: 0, id: "b", function: { name: "read_file", arguments: '{"pa' } }] }) + openaiChunk({}, "tool_calls") + OPENAI_DONE));
  llm.reply(sse(openaiToolCall("read_file", {}, "c")));
  llm.reply(sse(openaiToolCall("read_file", { path: "../ute" }, "d")));
  llm.reply(sse(openaiToolCall("run_command", { command: "exit 3", timeoutSeconds: 5 }, "e")));
  llm.always(sse(openaiText("ok")));
  await send(h, thread.id, "prøv");
  const events = await h.finished(thread.id);
  const results = ofType(events, "tool.finished");
  assert.deepEqual(results.map((r) => r.status), ["error", "error", "error", "error", "error"]);
  assert.match(results[0].result!, /Ukjent verktøy/);
  assert.match(results[1].result!, /JSON/);
  assert.match(results[2].result!, /påkrevde/);
  assert.match(results[3].result!, /utenfor/);
  assert.match(results[4].result!, /Avslutningskode 3/);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
});

test("run_command: cwd, live output, timeout and output cap", async (t) => {
  const h = await startHarness(t, { commandTimeoutMs: 200 });
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", shell: "pwd; echo feil >&2" });
  const events = await h.finished(thread.id);
  const output = ofType(events, "tool.output").map((e) => e.text).join("");
  assert.match(output, new RegExp(project.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(output, /feil/);

  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", shell: "sleep 30" });
  const timed = await h.finished(thread.id, 2);
  assert.match(ofType(timed, "tool.finished")[1].result!, /Tidsavbrudd/);

  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", shell: "head -c 3000000 /dev/zero | tr '\\0' x" });
  const big = await h.finished(thread.id, 3);
  assert.ok(ofType(big, "tool.finished")[2].result!.length < 40_000);
  const shown = ofType(big, "tool.output").map((e) => e.text).join("");
  assert.ok(shown.length < 1.1 * 1024 * 1024, `${shown.length}`);
  assert.match(shown, /avkortet/);
});

test("AGENTS.md goes into the system prompt, ahead of CLAUDE.md, and is read again each run", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project();
  writeFileSync(path.join(project.path, "CLAUDE.md"), "Bruk tabulatorer.");
  const thread = await h.thread(project.id, "code", modelId);
  llm.always(sse(openaiText("ok")));
  await send(h, thread.id, "En");
  await h.finished(thread.id);
  assert.match(llm.requests[0].body.messages[0].content, /Bruk tabulatorer/);

  writeFileSync(path.join(project.path, "AGENTS.md"), "Skriv tester først.");
  await send(h, thread.id, "To");
  await h.finished(thread.id, 2);
  const system = llm.requests[1].body.messages[0].content;
  assert.match(system, /Skriv tester først/);
  assert.ok(!system.includes("Bruk tabulatorer"));
  assert.equal(llm.requests[0].body.tools.length > 10, true);
});

test("old tool results are compacted first, then older messages are summarized", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm, { contextWindow: 4000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "stor.txt"), "ord\n".repeat(3000));
  const thread = await h.thread(project.id, "code", modelId);
  let call = 0;
  llm.always((req, res) => {
    if (req.body.tools === undefined) return sse(openaiText("Kort sammendrag av samtalen."))(req, res);
    call++;
    if (call <= 9) return sse(openaiToolCall("read_file", { path: "stor.txt", offset: call }, `c${call}`))(req, res);
    return sse(openaiText("ferdig"))(req, res);
  });
  await send(h, thread.id, "Les filen mange ganger");
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  const compacted = ofType(events, "context.compacted");
  assert.ok(compacted.length > 0);
  assert.ok(compacted[0].afterTokens < compacted[0].beforeTokens);
  const sent = JSON.stringify(llm.requests.at(-1)!.body.messages);
  assert.ok(sent.includes("Sammendrag av tidligere samtale") || sent.includes("Utdata komprimert"), sent.slice(0, 300));
  // Every call still has its result, or a real API would refuse the history.
  const last = llm.requests.at(-1)!.body.messages as any[];
  const called = last.flatMap((m) => (m.tool_calls ?? []).map((c: any) => c.id));
  const answered = last.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  assert.deepEqual([...called].sort(), [...answered].sort());
  assert.ok(sent.length < 4000 * 4 * 1.5, `${sent.length} chars after compaction`);
});

test("compaction on demand summarizes through the model and shows as a row", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  await send(h, thread.id, "Hei der");
  await h.finished(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/compact`);
  const events = await h.finished(thread.id, 2);
  assert.equal(ofType(events, "context.compacted").length, 1);
  const messages = h.app.store.messages(thread.id);
  assert.equal(messages.length, 1);
  assert.match(JSON.stringify(messages[0]), /Sammendrag av tidligere samtale/);
  await send(h, thread.id, "Lever samtalen?");
  await h.finished(thread.id, 3);
});

test("compaction drops signed thinking, and a refused signature recovers once", async (t) => {
  const { stripThinking } = await import("../src/agent/context.ts");
  const out = stripThinking([{ role: "assistant", content: [{ type: "thinking", text: "x", signature: "s" }, { type: "redacted_thinking", data: "r" }, { type: "text", text: "y" }] }]);
  assert.deepEqual(out, [{ role: "assistant", content: [{ type: "text", text: "y" }] }]);

  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const thread = await h.thread(null, "chat", modelId);
  h.app.store.appendMessage(thread.id, { role: "user", content: [{ type: "text", text: "før" }] });
  h.app.store.appendMessage(thread.id, { role: "assistant", content: [{ type: "thinking", text: "t", signature: "s" }, { type: "text", text: "svar" }] });
  llm.reply(httpError(400, { error: { message: "messages.1.content.0: Invalid `signature` in `thinking` block." } }));
  llm.reply(sse(openaiText("ok")));
  await send(h, thread.id, "Nå");
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.ok(!JSON.stringify(h.app.store.messages(thread.id)).includes("signature"));
});

test("usage adds up, and cost only shows when a price is set", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const priced = await addFakeModel(h, llm, { inputPricePerMTok: 2, outputPricePerMTok: 10 });
  const free = await addFakeModel(h, llm);
  const project = await h.project();
  const a = await h.thread(project.id, "chat", priced);
  const b = await h.thread(project.id, "chat", free);
  llm.always(sse(openaiChunk({ content: "ok" }, "stop") + openaiUsage(1000, 100, 400) + OPENAI_DONE));
  await send(h, a.id, "En");
  await send(h, b.id, "To");
  const usage = ofType(await h.finished(a.id), "usage")[0].usage;
  assert.deepEqual(usage, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 400, contextTokens: 1100, costUsd: 0.003 });
  assert.equal(ofType(await h.finished(b.id), "usage")[0].usage.costUsd, null);
  const total = await h.api("GET", `/api/projects/${project.id}/usage`);
  assert.equal(total.inputTokens, 2000);
  assert.equal(total.outputTokens, 200);
  assert.equal(total.costUsd, 0.003);
});

test("each turn records before and after, and undo restores the files", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const file = path.join(project.path, "a.txt");
  writeFileSync(file, "en\nto\n");
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("edit_file", { path: "a.txt", old_string: "to", new_string: "tre\nfire" }, "a")));
  llm.reply(sse(openaiToolCall("write_file", { path: "ny/b.txt", content: "ny\n" }, "b")));
  llm.reply(sse(openaiToolCall("run_command", { command: "echo kommando > c.txt" }, "c")));
  llm.reply(sse(openaiText("ferdig")));
  await send(h, thread.id, "endre");
  const events = await h.finished(thread.id);
  const [turn] = ofType(events, "turn.changes");
  assert.deepEqual(turn.files, [
    { path: "a.txt", change: "modified", additions: 2, deletions: 1, countsExact: true, binary: false },
    { path: path.join("ny", "b.txt"), change: "added", additions: 1, deletions: 0, countsExact: true, binary: false },
  ]);
  const diff = await h.api("GET", `/api/turns/${turn.turnId}/diff`);
  assert.equal(diff.files[0].before, "en\nto\n");
  assert.equal(diff.files[0].after, "en\ntre\nfire\n");
  assert.equal(diff.files[1].before, null);

  // A file changed afterwards is not silently overwritten.
  writeFileSync(file, "brukerens endring\n");
  const conflict = await h.raw("POST", `/api/turns/${turn.turnId}/revert`);
  assert.equal(conflict.status, 409);
  assert.deepEqual(JSON.parse(conflict.body).conflicts, ["a.txt"]);
  assert.equal(readFileSync(file, "utf8"), "brukerens endring\n");

  await h.api("POST", `/api/turns/${turn.turnId}/revert`, { force: true });
  assert.equal(readFileSync(file, "utf8"), "en\nto\n");
  assert.equal(existsSync(path.join(project.path, "ny/b.txt")), false);
  assert.equal(existsSync(path.join(project.path, "c.txt")), true, "command changes are not captured");
  const after = (await h.events(thread.id)).map((e) => e.event);
  assert.equal(ofType(after, "turn.reverted")[0].turnId, turn.turnId);
  assert.equal((await h.raw("POST", `/api/turns/${turn.turnId}/revert`)).status, 409);
  assert.match(JSON.stringify(h.app.store.messages(thread.id).at(-1)), /angret/);
});

test("undo waits for every running thread in the project, even with force", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const file = path.join(project.path, "undo.txt");
  writeFileSync(file, "original\n");
  const a = await h.thread(project.id, "code", modelId);
  const b = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("read_file", { path: "undo.txt" })));
  llm.reply(sse(openaiToolCall("write_file", { path: "undo.txt", content: "changed\n" })));
  llm.reply(sse(openaiText("done")));
  await send(h, a.id, "change");
  const turn = ofType(await h.finished(a.id), "turn.changes")[0];
  llm.reply(hang(openaiChunk({ content: "still working" })));
  await send(h, b.id, "work");
  await until(() => h.app.runner.isRunning(b.id), "second thread running");
  for (const force of [false, true]) {
    const response = await h.raw("POST", `/api/turns/${turn.turnId}/revert`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ force }) });
    assert.equal(response.status, 409);
    assert.match(response.body, /Vent til trådene i prosjektet/);
    assert.equal(JSON.parse(response.body).conflicts, undefined);
    assert.equal(readFileSync(file, "utf8"), "changed\n");
  }
  await h.api("POST", `/api/threads/${b.id}/stop`);
  await h.finished(b.id);
  await h.api("POST", `/api/turns/${turn.turnId}/revert`, {});
  assert.equal(readFileSync(file, "utf8"), "original\n");
});

test("a restart marks active runs as interrupted, does not rerun tools, and the thread goes on", async (t) => {
  const { startApp } = await import("../src/app.ts");
  const { login } = await import("./helpers.ts");
  const h = await startHarness(t);
  const dataDir = h.app.config.dataDir;
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id);
  writeFileSync(path.join(project.path, "teller.sh"), 'echo x >> kjort.txt; sleep 60\n');
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", shell: "bash teller.sh" });
  await until(() => existsSync(path.join(project.path, "kjort.txt")), "command ran");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "I kø" });
  await h.app.close();

  const again = await startApp({ dataDir, port: 0, mockDelayMs: 0 });
  t.after(() => again.close());
  await login(again.port, again.security.token);
  const events = again.store.events(thread.id, 0, 1000).map((e) => e.event);
  assert.equal(ofType(events, "run.finished").at(-1)!.status, "interrupted");
  assert.equal(ofType(events, "tool.finished").at(-1)!.status, "cancelled");
  assert.equal(readFileSync(path.join(project.path, "kjort.txt"), "utf8"), "x\n", "not run again");
  assert.deepEqual(ofType(events, "user.message").map((e) => e.text).at(-1), "I kø");
  const thread2 = again.store.thread(thread.id)!;
  assert.equal(thread2.running, false);
  again.runner.send(thread.id, { text: "hei" });
  await until(() => !again.store.thread(thread.id)!.running, "run after restart");
  const end = ofType(again.store.events(thread.id, 0, 1000).map((e) => e.event), "run.finished").at(-1)!;
  assert.equal(end.status, "done");
});

test("a hard crash: runs, approvals and tool calls are closed on the next start, and nothing runs again", async (t) => {
  const { startApp } = await import("../src/app.ts");
  const { login, rawRequest } = await import("./helpers.ts");
  const dataDir = tempDir(t);
  const projectDir = tempDir(t, "ad-project-");
  const child = spawn(process.execPath, ["server/src/index.ts", "--no-open"], {
    cwd: REPO_ROOT,
    env: { ...process.env, AD_DATA_DIR: dataDir, AD_PORT: "0", AD_MOCK_DELAY_MS: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => child.kill("SIGKILL"));
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  await until(() => /#token=/.test(output), "link");
  const [, portText, token] = /:(\d+)\/#token=(\S+)/.exec(output)!;
  const port = Number(portText);
  const cookie = await login(port, token);
  const api = async (method: string, url: string, body?: unknown) => {
    const res = await rawRequest(port, method, url, {
      headers: { cookie, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return JSON.parse(res.body);
  };
  const project = await api("POST", "/api/projects", { name: "k", path: projectDir });
  await api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });

  // One thread mid-command, one waiting for an approval, one with a queued message, one mid-turn.
  const running = await api("POST", "/api/threads", { projectId: project.id, mode: "code" });
  await api("POST", `/api/threads/${running.id}/messages`, { text: "", shell: "echo $$ > pid.txt; echo x >> kjort.txt; sleep 300" });
  await until(() => existsSync(path.join(projectDir, "pid.txt")) && readFileSync(path.join(projectDir, "pid.txt"), "utf8").trim() !== "", "command started");
  const orphan = Number(readFileSync(path.join(projectDir, "pid.txt"), "utf8"));
  t.after(() => {
    try {
      process.kill(-orphan, "SIGKILL"); // A crash leaves the command behind. This test started it.
    } catch {
      // Already gone.
    }
  });
  await api("POST", `/api/threads/${running.id}/messages`, { text: "I kø under krasj" });

  const waiting = await api("POST", "/api/threads", { projectId: project.id, mode: "code" });
  await api("POST", `/api/threads/${waiting.id}/messages`, { text: "godkjenning" });
  await until(async () => ofType((await api("GET", `/api/threads/${waiting.id}/events`)).map((e: any) => e.event), "approval.requested").length === 1, "approval");

  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;

  const app = await startApp({ dataDir, port: 0, mockDelayMs: 0, webDist: path.join(dataDir, "x") });
  t.after(() => app.close());
  const log = (id: string) => app.store.events(id, 0, 1000).map((e) => e.event);
  for (const id of [running.id, waiting.id]) {
    assert.equal(ofType(log(id), "run.finished").at(-1)!.status, "interrupted");
    assert.equal(app.store.thread(id)!.running, false);
    assert.equal(ofType(log(id), "tool.finished").at(-1)!.status, "cancelled");
    assert.match(ofType(log(id), "tool.finished").at(-1)!.result!, /Kjøres ikke på nytt/);
  }
  assert.equal(ofType(log(waiting.id), "approval.resolved").at(-1)!.decision, "deny");
  assert.equal(app.store.thread(waiting.id)!.pendingApprovals, 0);
  assert.equal(ofType(log(running.id), "user.message").at(-1)!.text, "I kø under krasj", "the queue is not lost");
  assert.equal(readFileSync(path.join(projectDir, "kjort.txt"), "utf8"), "x\n", "not run again");

  // The history is valid again: every call has a result, so the model can be asked.
  const called = app.store.messages(waiting.id).flatMap((m) => m.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : [])));
  const answered = app.store.messages(waiting.id).flatMap((m) => m.content.flatMap((b) => (b.type === "tool_result" ? [b.toolUseId] : [])));
  assert.deepEqual(called, answered);
  assert.ok(called.length > 0);
  app.runner.send(waiting.id, { text: "hjelp" });
  await until(() => !app.store.thread(waiting.id)!.running, "new run");
  assert.equal(ofType(log(waiting.id), "run.finished").at(-1)!.status, "done");
});

test("a project folder that vanishes during a run ends the run cleanly", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const base = tempDir(t);
  const project = await h.project(path.join(base, "forsvinner"), { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("write_file", { path: "a.txt", content: "x" }, "a")));
  llm.reply(async (req, res) => {
    rmSync(project.path, { recursive: true, force: true });
    await sse(openaiText("ferdig"))(req, res);
  });
  await send(h, thread.id, "skriv");
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.equal(h.app.store.thread(thread.id)!.running, false);
  assert.equal((await h.raw("GET", "/api/bootstrap")).status, 200, "the server survived");
});

test("old screenshots leave the context too", async () => {
  const { compactToolResults } = await import("../src/agent/context.ts");
  const image = { mime: "image/png", base64: "QQ==".repeat(1000) };
  const messages: Message[] = [
    { role: "user", content: [{ type: "tool_result", toolUseId: "a", content: "Skjermbilde", image }] },
    { role: "user", content: [{ type: "text", text: "x".repeat(10_000) }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "b", content: "Skjermbilde", image }] },
  ];
  const out = compactToolResults(messages, 1000);
  assert.equal((out[0].content[0] as any).image, undefined);
  assert.deepEqual(out[2], messages[2], "the newest result stays");
});

test("the store is SQLite in WAL mode with 0600 files", async (t) => {
  const h = await startHarness(t);
  const file = path.join(h.app.config.dataDir, "agentic-desktop.db");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(existsSync(`${file}-wal`), "WAL file");
});
