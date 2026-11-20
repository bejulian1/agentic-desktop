import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir, until, type Harness } from "./helpers.ts";
import type { BtwMessage } from "../../shared/protocol.ts";

const parse = (body: string): BtwMessage[] => body.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const question = (h: Harness, id: string, text: string, clientId = "test") => h.raw("POST", `/api/threads/${id}/btw`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text, clientId }) });
async function setup(t: Parameters<typeof startHarness>[0]) {
  const h = await startHarness(t), llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Sidespørsmål", model: "fake", contextWindow: 64000 });
  return { h, llm, model };
}
async function snapshot(h: Harness, id: string) {
  return { thread: h.app.store.thread(id), messages: h.app.store.messages(id), events: await h.events(id), queue: await h.api("GET", `/api/threads/${id}/queue`), memories: await h.api("GET", "/api/chat-personal") };
}

test("btw streams an answer using the visible conversation without any main-thread persistence or tools", async (t) => {
  const { h, llm, model } = await setup(t), thread = await h.thread(null, "chat", model.id);
  llm.reply(sse(openaiText("Tidligere svar om CONTEXT_MARKER.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Forklar CONTEXT_MARKER" });
  await h.finished(thread.id);
  const before = await snapshot(h, thread.id);
  llm.reply(sse(openaiText("Dette er det korte sidesvaret.")));
  const result = await question(h, thread.id, "BTWP_PRIVATE_QUESTION: hva betyr det?");
  assert.equal(result.status, 200);
  const parts = parse(result.body);
  assert.equal(parts[0].type, "start");
  assert.equal(parts.at(-1)!.type, "done");
  assert.equal(parts.filter((p) => p.type === "text").map((p) => p.type === "text" ? p.text : "").join(""), "Dette er det korte sidesvaret.");
  const sent = llm.requests.at(-1)!.body;
  assert.match(sent.messages[0].content, /quick side question/);
  assert.match(sent.messages[1].content, /CONTEXT_MARKER|Tidligere svar/);
  assert.match(sent.messages[1].content, /BTWP_PRIVATE_QUESTION/);
  assert.deepEqual(sent.tools ?? [], []);
  assert.equal(sent.web_search_options, undefined);
  assert.deepEqual(await snapshot(h, thread.id), before);
  assert.ok(!JSON.stringify(h.app.store.messages(thread.id)).includes("BTWP_PRIVATE_QUESTION"));
});

test("btw refuses a provider's tool call even in full-access Code and never creates the requested file", async (t) => {
  const { h, llm, model } = await setup(t);
  const folder = tempDir(t), project = await h.project(folder, { permissionMode: "full" }), thread = await h.thread(project.id, "code", model.id);
  const before = await snapshot(h, thread.id);
  llm.reply(sse(openaiToolCall("write_file", { path: "not-created.txt", content: "forbidden" })));
  const response = await question(h, thread.id, "Skriv en fil");
  assert.ok(parse(response.body).some((p) => p.type === "error" && p.code === "tool_unavailable"));
  assert.equal(existsSync(path.join(folder, "not-created.txt")), false);
  assert.deepEqual(await snapshot(h, thread.id), before);
});

test("btw does not steer, stop, enqueue or otherwise modify a main run that is still active", async (t) => {
  const { h, llm, model } = await setup(t), thread = await h.thread(null, "chat", model.id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  llm.reply(async (req, res) => { await gate; await sse(openaiText("Hovedsvaret."))(req, res); });
  llm.reply(sse(openaiText("Et raskt svar ved siden av.")));
  try {
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "MAIN_QUESTION" });
    await until(() => llm.requests.length === 1, "main provider request started");
    const before = await snapshot(h, thread.id);
    assert.equal(before.thread!.running, true);
    const response = await question(h, thread.id, "SIDE_QUESTION");
    assert.ok(parse(response.body).some((p) => p.type === "done"));
    assert.deepEqual(await snapshot(h, thread.id), before);
    release(); await h.finished(thread.id);
    assert.doesNotMatch(JSON.stringify(await h.events(thread.id)), /SIDE_QUESTION|Et raskt svar ved siden av/);
  } finally { release(); }
});

test("btw cancels on Chat-project context changes and exposes a discard code instead of stale completion", async (t) => {
  const { h, llm, model } = await setup(t);
  const a = await h.api("POST", "/api/chat-projects", { name: "A" }), b = await h.api("POST", "/api/chat-projects", { name: "B" });
  const thread = await h.api("POST", "/api/threads", { mode: "chat", modelId: model.id, chatProjectId: a.id });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  llm.reply(async (req, res) => { await gate; await sse(openaiText("Old scope"))(req, res); });
  try {
    const pending = question(h, thread.id, "Hva betyr dette?");
    await until(() => llm.requests.length === 1, "side provider request started");
    await h.api("PATCH", `/api/threads/${thread.id}`, { chatProjectId: b.id });
    const response = await pending;
    const parts = parse(response.body);
    assert.ok(parts.some((p) => p.type === "error" && p.code === "scope_changed"));
    assert.ok(!parts.some((p) => p.type === "done"));
    assert.equal(h.app.store.messages(thread.id).length, 0);
    assert.equal((await h.events(thread.id)).length, 0);
  } finally { release(); }
});

test("btw bounds concurrent requests and closing their HTTP requests releases their slots", async (t) => {
  const { h, llm, model } = await setup(t), thread = await h.thread(null, "chat", model.id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  llm.always(async (req, res) => { await gate; await sse(openaiText("Svar"))(req, res); });
  const controllers = [new AbortController(), new AbortController()];
  try {
    const requests = await Promise.all(controllers.map((controller, i) => fetch(`${h.origin}/api/threads/${thread.id}/btw`, { method: "POST", headers: { cookie: h.cookie, origin: h.origin, "content-type": "application/json" }, body: JSON.stringify({ question: "Vent", clientId: `parallel-${i}` }), signal: controller.signal })));
    await until(() => llm.requests.length === 2, "two side requests started");
    assert.equal((await question(h, thread.id, "Tredje", "third")).status, 429);
    for (const controller of controllers) controller.abort();
    await Promise.all(requests.map((r) => r.body?.cancel().catch(() => undefined)));
    // A new request should start after disconnection handling, not stay rate-limited.
    release();
    await until(async () => (await question(h, thread.id, "Ny forespørsel", "after-close")).status === 200, "side slots released on HTTP close");
  } finally { release(); for (const controller of controllers) controller.abort(); }
});

test("rewinding a source timeline cancels its btw snapshot without invalidating the replacement main send", async (t) => {
  const { h, llm, model } = await setup(t), thread = await h.thread(null, "chat", model.id);
  llm.reply(sse(openaiText("Original answer")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "ORIGINAL_QUESTION" });
  await h.finished(thread.id);
  const firstUser = (await h.events(thread.id)).find((item) => item.event.type === "user.message")!;
  assert.equal(firstUser.event.type, "user.message");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  llm.reply(async (req, res) => { await gate; await sse(openaiText("Old timeline answer"))(req, res); });
  llm.reply(sse(openaiText("Replacement answer")));
  try {
    const pending = question(h, thread.id, "Spørsmål om gammel tidslinje");
    await until(() => llm.requests.length === 2, "side request started");
    await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: firstUser.event.type === "user.message" ? firstUser.event.messageId : "", text: "REPLACEMENT_QUESTION" });
    const parts = parse((await pending).body);
    assert.ok(parts.some((part) => part.type === "error" && part.code === "scope_changed"));
    await until(() => llm.requests.length === 3 && !h.app.store.thread(thread.id)!.running, "legitimate replacement turn completed");
    assert.match(JSON.stringify(h.app.store.messages(thread.id)), /REPLACEMENT_QUESTION|Replacement answer/);
    assert.doesNotMatch(JSON.stringify(h.app.store.messages(thread.id)), /ORIGINAL_QUESTION|Old timeline answer/);
  } finally { release(); }
});

test("btw validates input and does not create a thread or provider call for invalid requests", async (t) => {
  const { h, llm, model } = await setup(t), thread = await h.thread(null, "chat", model.id);
  assert.equal((await question(h, thread.id, "")).status, 400);
  assert.equal((await question(h, thread.id, "x".repeat(8001))).status, 413);
  assert.equal((await question(h, thread.id, "Hei", "../bad")).status, 400);
  assert.equal(llm.requests.length, 0);
  assert.equal(h.app.store.threads().length, 1);
  assert.equal(h.app.store.messages(thread.id).length, 0);
});

test("background starts a separate concurrent conversation with source context and leaves its source run untouched", async (t) => {
  const { h, llm, model } = await setup(t), thread = await h.thread(null, "chat", model.id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  llm.reply(async (req, res) => { await gate; await sse(openaiText("Main answer"))(req, res); });
  llm.reply(sse(openaiText("Background answer")));
  try {
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "MAIN_CONTEXT_MARKER" });
    await until(() => llm.requests.length === 1, "main started");
    const before = await snapshot(h, thread.id);
    const { thread: child } = await h.api("POST", `/api/threads/${thread.id}/background`, { text: "BACKGROUND_TASK_MARKER" });
    await until(() => llm.requests.length === 2 && !h.app.store.thread(child.id)!.running, "background independently completed");
    assert.equal(child.parentThreadId, thread.id);
    assert.equal(child.modelId, model.id);
    assert.equal(child.forkedFrom.background, true);
    assert.match(JSON.stringify(llm.requests[1].body.messages), /MAIN_CONTEXT_MARKER/);
    assert.match(JSON.stringify(llm.requests[1].body.messages), /BACKGROUND_TASK_MARKER/);
    assert.deepEqual(await snapshot(h, thread.id), before);
    assert.doesNotMatch(JSON.stringify(h.app.store.messages(thread.id)), /BACKGROUND_TASK_MARKER|Background answer/);
    release(); await h.finished(thread.id);
  } finally { release(); }
});

test("background inherits effective Code permissions, plan mode and selected model rather than widening access", async (t) => {
  const { h, llm, model } = await setup(t), project = await h.project(undefined, { permissionMode: "full" });
  const source = h.app.store.createThread(project.id, "code", model.id, { permissionCap: "ask", origin: "agent" });
  h.app.store.updateThread(source.id, { planMode: true });
  llm.reply(sse(openaiText("Analyse uten filendringer")));
  const { thread: child } = await h.api("POST", `/api/threads/${source.id}/background`, { text: "Analyser prosjektet" });
  await until(() => llm.requests.length === 1 && !h.app.store.thread(child.id)!.running, "readonly background done");
  assert.equal(child.permissionCap, "ask");
  assert.equal(child.planMode, true);
  assert.equal(child.projectId, project.id);
  assert.equal(child.modelId, model.id);
  const tools = (llm.requests[0].body.tools ?? []).map((tool: any) => tool.function.name);
  assert.ok(!tools.some((name: string) => ["write_file", "edit_file", "delete_file", "run_command", "ui_mod"].includes(name)));
});

test("background preserves temporary Chat-project scope and per-chat tool choices", async (t) => {
  const { h, llm, model } = await setup(t), project = await h.api("POST", "/api/chat-projects", { name: "Isolert", instructions: "PROJECT_PRIVATE_CONTEXT" });
  const source = await h.api("POST", "/api/threads/temporary", { modelId: model.id, chatProjectId: project.id });
  await h.api("PATCH", `/api/threads/${source.id}`, { chatTools: { documents: false, python: false, memory: false } });
  llm.reply(sse(openaiText("Analyse")));
  const { thread: child } = await h.api("POST", `/api/threads/${source.id}/background`, { text: "Analyser dette" });
  await until(() => llm.requests.length === 1 && !h.app.store.thread(child.id)!.running, "temporary background done");
  assert.equal(child.temporary, true);
  assert.equal(child.chatProjectId, project.id);
  assert.equal(child.chatTools.documents, false);
  assert.equal(child.chatTools.memory, false);
  assert.match(llm.requests[0].body.messages[0].content, /PROJECT_PRIVATE_CONTEXT/);
  assert.ok(!(llm.requests[0].body.tools ?? []).some((tool: any) => ["create_document", "run_python"].includes(tool.function.name)));
});
