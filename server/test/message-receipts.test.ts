import assert from "node:assert/strict";
import { test } from "node:test";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir, until } from "./helpers.ts";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function setup(t: Parameters<typeof startHarness>[0]) {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const p = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Receipt test", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: p.id, name: "Receipt test", model: "local", contextWindow: 64000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", model.id);
  return { h, llm, thread };
}

test("read receipt waits for actual model output and only acknowledges messages in that request", async (t) => {
  const { h, llm, thread } = await setup(t);
  const first = gate(), second = gate();
  t.after(() => { first.release(); second.release(); });
  llm.reply(async (req, res) => { await first.promise; await sse(openaiText("Første svar"))(req, res); });
  llm.reply(async (req, res) => { await second.promise; await sse(openaiText("Svar med korrigering"))(req, res); });
  const one = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Første melding" });
  await until(() => llm.requests.length === 1, "provider received initial request");
  const two = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Korrigering", steer: true });
  assert.equal(two.queued, true);
  let events = (await h.events(thread.id)).map((e) => e.event);
  assert.ok(!events.some((e) => e.type === "user.received"));
  first.release();
  await until(() => llm.requests.length === 2, "steered message reached its own provider request");
  events = (await h.events(thread.id)).map((e) => e.event);
  assert.deepEqual(events.filter((e) => e.type === "user.received").map((e) => e.messageId), [one.messageId]);
  assert.match(JSON.stringify(llm.requests[1].body.messages), /Korrigering/);
  second.release();
  await h.finished(thread.id);
  events = (await h.events(thread.id)).map((e) => e.event);
  assert.deepEqual(events.filter((e) => e.type === "user.received").map((e) => e.messageId), [one.messageId, two.messageId]);
  assert.equal(events.filter((e) => e.type === "run.started").length, 1);
  const stored = h.app.store.events(thread.id, 0, 20000);
  assert.equal(stored.filter((e) => e.event.type === "user.received").length, 2, "receipts survive history reload");
});

test("a hook-blocked message and a user shell command never receive a model read receipt", async (t) => {
  const { h, llm, thread } = await setup(t);
  await h.api("POST", "/api/hooks", { name: "Block prompt", event: "UserPromptSubmit", command: "exit 2" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Stopp denne" });
  await h.finished(thread.id);
  assert.equal(llm.requests.length, 0);
  assert.ok(!(await h.events(thread.id)).some((e) => e.event.type === "user.received"));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { shell: "echo lokal-kontroll" });
  await h.finished(thread.id, 2);
  assert.equal(llm.requests.length, 0);
  assert.ok(!(await h.events(thread.id)).some((e) => e.event.type === "user.received"));
});

test("a queued follow-up stays unread while the preceding turn responds", async (t) => {
  const { h, llm, thread } = await setup(t);
  const first = gate(), second = gate();
  t.after(() => { first.release(); second.release(); });
  llm.reply(async (req, res) => { await first.promise; await sse(openaiText("Første svar"))(req, res); });
  llm.reply(async (req, res) => { await second.promise; await sse(openaiText("Oppfølging"))(req, res); });
  const one = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Start" });
  await until(() => llm.requests.length === 1, "first request");
  const two = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Etterpå", steer: false });
  first.release();
  await until(() => llm.requests.length === 2, "queued turn starts");
  assert.deepEqual((await h.events(thread.id)).filter((e) => e.event.type === "user.received").map((e) => e.event.type === "user.received" && e.event.messageId), [one.messageId]);
  second.release();
  await h.finished(thread.id, 2);
  assert.equal((await h.events(thread.id)).filter((e) => e.event.type === "user.received" && e.event.messageId === two.messageId).length, 1);
});
