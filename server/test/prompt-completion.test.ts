import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hang, openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir, until } from "./helpers.ts";

async function readyThread(h: Awaited<ReturnType<typeof startHarness>>, id: string) {
  const original = h.app.store.thread(id)!.modelId;
  h.app.store.updateThread(id, { modelId: "mock-demo" });
  for (let n = 1; n <= 2; n++) {
    await h.api("POST", `/api/threads/${id}/messages`, { text: `Hei, samtalekontekst ${n}` });
    await h.finished(id, n);
  }
  h.app.store.updateThread(id, { modelId: original });
}

async function setup(t: Parameters<typeof startHarness>[0]) {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal fullføring", baseUrl: `${llm.url}/v1` });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Forslagsmodell", model: "suggestions", contextWindow: 100_000, thinking: true });
  const seed = await h.thread(null, "chat", "mock-demo");
  await readyThread(h, seed.id);
  const base = { threadId: seed.id, clientId: "test-pane", mode: "chat", modelId: model.id, text: "Kan du forklare" };
  const complete = (body: any = {}) => h.api("POST", "/api/prompt-completion", { ...base, ...body });
  return { h, llm, model, complete, base };
}

test("prompt completion is opt-in, validated, persists a dedicated model and never makes a chat", async (t) => {
  const { h, llm, model, complete } = await setup(t);
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.promptAutocomplete, undefined);
  assert.deepEqual(await complete(), { completion: "" });
  assert.equal(llm.requests.length, 0);
  await assert.rejects(h.api("PATCH", "/api/settings", { promptAutocomplete: "yes" }), /400/);
  await assert.rejects(h.api("PATCH", "/api/settings", { promptAutocompleteModelId: "missing" }), /400/);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true, promptAutocompleteModelId: model.id });
  llm.reply(sse(openaiText(" dette steg for steg?")));
  assert.deepEqual(await complete({ modelId: "mock-demo" }), { completion: " dette steg for steg?" });
  assert.equal(llm.requests[0].body.model, "suggestions", "own model wins over the conversation model");
  assert.equal(llm.requests[0].body.max_tokens, 128);
  assert.equal(llm.requests[0].body.tools, undefined);
  assert.equal(llm.requests[0].body.web_search_options, undefined);
  assert.equal(llm.requests[0].body.reasoning_effort, undefined);
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, 1);
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.promptAutocompleteModelId, model.id);
  for (const body of [{ text: "a" }, { text: "x".repeat(4001) }, { mode: "invalid" }, { clientId: "" }]) await assert.rejects(complete(body), /400/);
});

test("completion gets bounded current conversation and explicit opened code file, without changing history or tool access", async (t) => {
  const { h, llm, model, complete } = await setup(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "opened.ts"), "export const chosenFile = 42;\n");
  writeFileSync(path.join(project.path, "other.ts"), "UNOPENED_FILE_PRIVATE_MARKER");
  writeFileSync(path.join(project.path, "AGENTS.md"), "CODE_INSTRUCTIONS_PRIVATE_MARKER");
  const thread = await h.thread(project.id, "code", "mock-demo");
  await readyThread(h, thread.id);
  const beforeEvents = await h.events(thread.id);
  h.app.store.appendMessage(thread.id, { role: "user", content: [{ type: "text", text: "Forklar chosenFile i TypeScript." }] });
  h.app.store.appendMessage(thread.id, { role: "assistant", content: [{ type: "text", text: "chosenFile er en konstant." }] });
  const before = h.app.store.messages(thread.id);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true, promptAutocompleteModelId: model.id });
  llm.reply(sse(openaiText(" denne konstanten?")));
  await complete({ threadId: thread.id, projectId: project.id, mode: "code", filePath: "opened.ts" });
  const request = llm.requests[0].body;
  const context = JSON.parse(request.messages.at(-1).content);
  assert.equal(context.openedFile.path, "opened.ts");
  assert.match(context.openedFile.text, /chosenFile = 42/);
  assert.match(context.conversation.map((m: any) => m.text).join("\n"), /chosenFile er en konstant/);
  assert.doesNotMatch(JSON.stringify(request), /UNOPENED_FILE_PRIVATE_MARKER|CODE_INSTRUCTIONS_PRIVATE_MARKER/);
  assert.deepEqual(h.app.store.messages(thread.id), before);
  assert.deepEqual(await h.events(thread.id), beforeEvents);
  assert.equal(h.app.store.thread(thread.id)!.modelId, "mock-demo");
  await assert.rejects(complete({ threadId: thread.id, mode: "chat" }), /400/);
  const other = await h.project();
  await assert.rejects(complete({ threadId: thread.id, mode: "code", projectId: other.id }), /400/);
  const outside = tempDir(t); writeFileSync(path.join(outside, "secret"), "secret");
  symlinkSync(path.join(outside, "secret"), path.join(project.path, "escape"));
  await assert.rejects(complete({ threadId: thread.id, mode: "code", projectId: project.id, filePath: "escape" }), /403/);
  mkdirSync(path.join(project.path, "dir"));
  await assert.rejects(complete({ threadId: thread.id, mode: "code", projectId: project.id, filePath: "../../escape" }), /403/);
});

test("temporary Chat and disabled memories do not inject saved personalisation; protected and binary files are excluded", async (t) => {
  const { h, llm, complete } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true });
  await h.api("PUT", "/api/chat-personal", { instructions: "PERSONAL_SYSTEM_MARKER", autoMemory: true });
  await h.api("POST", "/api/chat-personal/memories", { text: "SAVED_MEMORY_MARKER" });
  const temp = await h.api("POST", "/api/threads/temporary", {});
  await readyThread(h, temp.id);
  llm.always(sse(openaiText(" dette kort?")));
  await complete({ threadId: temp.id });
  assert.doesNotMatch(JSON.stringify(llm.requests[0].body), /PERSONAL_SYSTEM_MARKER|SAVED_MEMORY_MARKER/);
  const project = await h.project();
  writeFileSync(path.join(project.path, ".env"), "SECRET_TOKEN=PRIVATE_MARKER");
  writeFileSync(path.join(project.path, "binary.bin"), Buffer.from([0, 3, 4]));
  const code = await h.thread(project.id, "code", "mock-demo");
  await readyThread(h, code.id);
  for (const filePath of [".env", "binary.bin"]) await complete({ threadId: code.id, mode: "code", projectId: project.id, filePath });
  assert.ok(llm.requests.slice(1).every((r) => JSON.parse(r.body.messages.at(-1).content).openedFile === undefined));
  assert.equal((await h.api("GET", "/api/chat-personal")).memories.length, 1);
});

test("replacement, client abort, switch-off and concurrency bounds stop pending provider requests", async (t) => {
  const { h, llm, complete, base } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true });
  llm.reply(hang());
  const first = complete({ text: "Første utkast" });
  await until(() => llm.requests.length === 1, "first suggestion request");
  llm.reply(sse(openaiText(" med nytt innhold")));
  assert.deepEqual(await complete({ text: "Andre utkast" }), { completion: " med nytt innhold" });
  assert.deepEqual(await first, { completion: "" });
  llm.reply(hang());
  const controller = new AbortController();
  const aborted = fetch(`${h.origin}/api/prompt-completion`, { method: "POST", headers: { cookie: h.cookie, origin: h.origin, "content-type": "application/json" }, body: JSON.stringify({ ...base, clientId: "disconnect" }), signal: controller.signal }).catch(() => null);
  await until(() => llm.requests.length === 3, "abortable suggestion request");
  controller.abort(); await aborted;
  llm.reply(hang()); llm.reply(hang());
  const a = complete({ clientId: "slot-a" });
  await until(() => llm.requests.length === 4, "first slot started");
  const b = complete({ clientId: "slot-b" });
  await until(() => llm.requests.length === 5, "second slot started");
  assert.deepEqual(await complete({ clientId: "slot-c" }), { completion: "" });
  assert.equal(llm.requests.length, 5);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: false });
  assert.deepEqual(await a, { completion: "" }); assert.deepEqual(await b, { completion: "" });
});

test("bad provider output is harmless and switching the dedicated model back follows the chat model", async (t) => {
  const { h, llm, model, complete } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true });
  const thread = await h.thread(null, "chat", model.id);
  await readyThread(h, thread.id);
  const beforeEvents = await h.events(thread.id);
  llm.reply(sse(openaiToolCall("run_command", { command: "must-not-run" })));
  assert.deepEqual(await complete({ threadId: thread.id }), { completion: "" });
  llm.reply(sse(openaiText("```text\nwrong format\n```")));
  assert.deepEqual(await complete(), { completion: "" });
  llm.reply(sse(openaiText("Kan du forklare dette?")));
  assert.deepEqual(await complete(), { completion: " dette?" });
  await h.api("PATCH", "/api/settings", { promptAutocompleteModelId: "mock-demo" });
  assert.match((await complete()).completion, /forklar kort hvorfor/);
  await h.api("PATCH", "/api/settings", { promptAutocompleteModelId: null });
  llm.reply(sse(openaiText(" tilbake på valgt modell")));
  assert.deepEqual(await complete({ threadId: thread.id }), { completion: " tilbake på valgt modell" });
  assert.deepEqual(await h.events(thread.id), beforeEvents);
});


test("deleting a dedicated model resets the effective choice and running chats do not start side requests", async (t) => {
  const { h, llm, model, complete } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true, promptAutocompleteModelId: model.id });
  await h.api("DELETE", `/api/models/${model.id}`);
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.promptAutocompleteModelId, null);
  assert.match((await complete({ modelId: "mock-demo" })).completion, /forklar kort hvorfor/);
  assert.equal(llm.requests.length, 0);
  const thread = await h.thread(null, "chat", "mock-demo");
  await readyThread(h, thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lang strøm 20000 rolig" });
  assert.deepEqual(await complete({ threadId: thread.id, modelId: "mock-demo" }), { completion: "" });
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  await h.finished(thread.id, 3);
});


test("the first and second user drafts make no model calls; the third and copied history are eligible", async (t) => {
  const { h, llm, complete } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true });
  const thread = await h.thread(null, "chat", "mock-demo");
  assert.equal(h.app.store.thread(thread.id)!.promptHistoryReady, false);
  assert.deepEqual(await complete({ threadId: thread.id }), { completion: "" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei, første melding" });
  await h.finished(thread.id);
  assert.equal(h.app.store.thread(thread.id)!.promptHistoryReady, false);
  assert.deepEqual(await complete({ threadId: thread.id }), { completion: "" });
  assert.equal(llm.requests.length, 0);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei, andre melding" });
  await h.finished(thread.id, 2);
  assert.equal(h.app.store.thread(thread.id)!.promptHistoryReady, true);
  llm.reply(sse(openaiText(" neste spørsmål")));
  assert.deepEqual(await complete({ threadId: thread.id }), { completion: " neste spørsmål" });
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`, {});
  assert.equal(fork.promptHistoryReady, true, "forked conversation has real earlier answers too");
});

test("a pending suggestion cannot cross a Chat project move or project instruction edit", async (t) => {
  const { h, llm, complete, base } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true });
  const project = await h.api("POST", "/api/chat-projects", { name: "Isolert forslag", instructions: "PROSJEKTETS_EGNE_INSTRUKSER" });
  for (const change of [
    () => h.api("PATCH", `/api/threads/${base.threadId}`, { chatProjectId: project.id }),
    () => h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions: "NYE_PROSJEKTINSTRUKSER", memoryMode: "shared" }),
    async () => {
      await h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions: "MIDLERTIDIGE_INSTRUKSER" });
      await h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions: "NYE_PROSJEKTINSTRUKSER" });
    },
  ]) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const before = llm.requests.length;
    llm.reply(async (request, response) => { await gate; await sse(openaiText(" gammelt forslag"))(request, response); });
    const pending = complete();
    await until(() => llm.requests.length > before, "suggestion is streaming in previous context");
    try { await change(); } finally { release(); }
    assert.deepEqual(await pending, { completion: "" });
  }
  llm.reply(sse(openaiText(" nytt prosjektforslag")));
  assert.deepEqual(await complete(), { completion: " nytt prosjektforslag" });
});

test("deleting the source thread discards its late prompt completion", async (t) => {
  const { h, llm, complete, base } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  llm.reply(async (request, response) => { await gate; await sse(openaiText(" fra slettet chat"))(request, response); });
  const pending = complete();
  await until(() => llm.requests.length === 1, "suggestion request started");
  try { await h.api("DELETE", `/api/threads/${base.threadId}`); } finally { release(); }
  assert.deepEqual(await pending, { completion: "" });
});


test("Chat suggestions never transmit hidden summaries after moving into or out of a project", async (t) => {
  const { h, llm, complete, base } = await setup(t);
  await h.api("PATCH", "/api/settings", { promptAutocomplete: true });
  const project = await h.api("POST", "/api/chat-projects", { name: "Synlig kontekst" });
  llm.always(sse(openaiText(" fra synlig samtale")));
  for (const chatProjectId of [project.id, null]) {
    await h.api("PATCH", `/api/threads/${base.threadId}`, { chatProjectId });
    h.app.store.appendMessage(base.threadId, { role: "user", content: [{ type: "text", text: "HIDDEN_OLD_PERSONAL_SUMMARY" }] });
    await complete();
    const request = JSON.stringify(llm.requests.at(-1)!.body);
    assert.doesNotMatch(request, /HIDDEN_OLD_PERSONAL_SUMMARY/);
    assert.match(request, /samtalekontekst/);
  }
});
