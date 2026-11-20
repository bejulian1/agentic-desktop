import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSettingsOf, DEFAULT_MAX_STEPS_PER_TURN, MAX_STEPS_PER_TURN, isMaxStepsPerTurn } from "../../shared/protocol.ts";
import { Store } from "../src/db.ts";
import type { Message } from "../src/providers/types.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

async function model(h: Harness, llm: FakeLlm, contextWindow = 100_000) {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: `${llm.url}/v1`, apiKey: "test" });
  return h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "fake", contextWindow });
}

test("agent settings have safe legacy defaults and persist across reopening", (t) => {
  assert.deepEqual(agentSettingsOf({}), { autoCompact: true, maxStepsPerTurn: DEFAULT_MAX_STEPS_PER_TURN });
  for (const value of [NaN, Infinity, -Infinity, 0, -1, 1.5, MAX_STEPS_PER_TURN + 1, "25", null]) {
    assert.equal(isMaxStepsPerTurn(value), false);
    assert.equal(agentSettingsOf({ maxStepsPerTurn: value as number }).maxStepsPerTurn, DEFAULT_MAX_STEPS_PER_TURN);
  }
  const dir = tempDir(t);
  const first = new Store(dir);
  assert.equal(first.settings().autoCompact, true);
  first.updateSettings({ autoCompact: false, maxStepsPerTurn: 137 });
  first.close();
  const reopened = new Store(dir);
  t.after(() => reopened.close());
  assert.deepEqual(agentSettingsOf(reopened.settings()), { autoCompact: false, maxStepsPerTurn: 137 });
  reopened.updateSettings({ autoCompact: "false" as any, maxStepsPerTurn: -10 });
  assert.deepEqual(agentSettingsOf(reopened.settings()), { autoCompact: true, maxStepsPerTurn: DEFAULT_MAX_STEPS_PER_TURN });
});

test("settings API exposes defaults and rejects invalid limits and boolean values atomically", async (t) => {
  const h = await startHarness(t);
  const defaults = (await h.api("GET", "/api/bootstrap")).settings;
  assert.deepEqual(agentSettingsOf(defaults), { autoCompact: true, maxStepsPerTurn: 50 });
  assert.equal(defaults.autoCompact, true);
  assert.equal(defaults.maxStepsPerTurn, 50);
  for (const maxStepsPerTurn of [1, 25, 137, MAX_STEPS_PER_TURN]) {
    const saved = await h.api("PATCH", "/api/settings", { autoCompact: false, maxStepsPerTurn });
    assert.equal(saved.maxStepsPerTurn, maxStepsPerTurn);
    assert.equal(saved.autoCompact, false);
  }
  for (const bad of [
    { autoCompact: "false" }, { autoCompact: 0 }, { autoCompact: null },
    ...[NaN, Infinity, 0, -1, 1.5, MAX_STEPS_PER_TURN + 1, "25", null].map((maxStepsPerTurn) => ({ autoCompact: true, maxStepsPerTurn })),
  ]) await assert.rejects(h.api("PATCH", "/api/settings", bad), /400/);
  const settings = (await h.api("GET", "/api/bootstrap")).settings;
  assert.equal(settings.autoCompact, false, "a rejected patch does not partially enable compaction");
  assert.equal(settings.maxStepsPerTurn, MAX_STEPS_PER_TURN);
});

test("automatic compaction off retains oversized tool history, while manual compact still summarizes", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const chosen = await model(h, llm, 4000);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", chosen.id);
  await h.api("PATCH", "/api/settings", { autoCompact: false });
  const history: Message[] = [{ role: "user", content: [{ type: "text", text: "Behold denne historikken" }] }];
  for (let i = 0; i < 10; i++) {
    history.push({ role: "assistant", content: [{ type: "tool_use", id: `old-${i}`, name: "read_file", input: { path: "stor.txt" } }] });
    history.push({ role: "user", content: [{ type: "tool_result", toolUseId: `old-${i}`, content: `original-${i}:` + "lang utdata ".repeat(2000) }] });
  }
  h.app.store.replaceMessages(thread.id, history);
  llm.always((req, res) => sse(openaiText(req.body.tools === undefined ? "Kort manuelt sammendrag." : "Ferdig uten komprimering."))(req, res));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Fortsett" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.equal(ofType(events, "context.compacted").length, 0);
  assert.equal(llm.requests.length, 1, "no automatic summary model call");
  assert.deepEqual(h.app.store.messages(thread.id).slice(0, history.length), history, "old tool results remain intact");
  const sent = JSON.stringify(llm.requests[0].body.messages);
  assert.ok(sent.includes("original-0:") && sent.includes("original-9:"));
  assert.equal(sent.includes("Utdata komprimert"), false);
  await h.api("POST", `/api/threads/${thread.id}/compact`);
  const manual = await h.finished(thread.id, 2);
  assert.equal(ofType(manual, "context.compacted").length, 1);
  assert.equal(llm.requests.length, 2);
  assert.equal(llm.requests[1].body.tools, undefined, "manual compact calls the summary model");
  assert.match(JSON.stringify(h.app.store.messages(thread.id)), /Kort manuelt sammendrag/);
});

test("the configured step budget is exact and settings changes apply on the next turn", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const chosen = await model(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", chosen.id);
  await h.api("PATCH", "/api/settings", { maxStepsPerTurn: 3 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let call = 0;
  llm.always(async (req, res) => {
    const index = ++call;
    if (index === 1) await gate;
    await sse(openaiToolCall("list_dir", { path: ".", index }, `call-${index}`))(req, res);
  });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Fortsett" });
  await until(() => llm.requests.length === 1, "first step started");
  await h.api("PATCH", "/api/settings", { maxStepsPerTurn: 1 });
  release();
  const first = await h.finished(thread.id);
  assert.match(ofType(first, "run.finished")[0].error!, /3 steg/);
  assert.equal(llm.requests.length, 3);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Ny tur" });
  const second = await h.finished(thread.id, 2);
  assert.match(ofType(second, "run.finished")[1].error!, /1 steg/);
  assert.equal(llm.requests.length, 4);
});
