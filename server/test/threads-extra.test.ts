// Round 1 of the wish list: /fork, /init, and the per-thread choices behind /goal, /plan,
// /reasoning and /personality.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, textOf } from "./helpers.ts";

async function setup(t: TestContext) {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  return { h, llm, project, modelId: model.id as string };
}

test("goal, plan mode, reasoning and personality are stored, validated and reach the model", async (t) => {
  const { h, llm, project, modelId } = await setup(t);
  const thread = await h.thread(project.id, "code", modelId);
  assert.equal(thread.goal, null);
  assert.equal(thread.planMode, false);

  const patched = await h.api("PATCH", `/api/threads/${thread.id}`, { goal: "  Lag en kalkulator  ", planMode: true, reasoning: "xhigh", personality: "kort" });
  assert.equal(patched.goal, "Lag en kalkulator");
  assert.equal(patched.planMode, true);
  assert.equal(patched.reasoning, "xhigh");
  assert.equal(patched.personality, "kort");
  await assert.rejects(h.api("PATCH", `/api/threads/${thread.id}`, { reasoning: "turbo" }), /400/);
  await assert.rejects(h.api("PATCH", `/api/threads/${thread.id}`, { personality: "pirat" }), /400/);

  llm.reply(sse(openaiText("1. Les filene\n2. Skriv koden")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei" });
  await h.finished(thread.id);
  const body = llm.requests[0].body;
  const system = body.messages[0].content as string;
  assert.match(system, /goal for this thread: Lag en kalkulator/);
  assert.match(system, /Plan mode is on/);
  assert.match(system, /Be brief/);
  assert.equal(body.reasoning_effort, "high", "xhigh maps to OpenAI's highest level");
  const tools = body.tools.map((tool: any) => tool.function.name);
  assert.ok(tools.includes("read_file") && tools.includes("list_dir"));
  for (const name of ["write_file", "edit_file", "run_command", "browser_navigate", "thread_create"]) assert.ok(!tools.includes(name), `${name} is hidden in plan mode`);

  const after = (await h.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === thread.id);
  assert.equal(after.plan, "1. Les filene\n2. Skriv koden", "the plan is kept for the pinned summary");
  assert.equal(after.lastStatus, "done");

  await h.api("PATCH", `/api/threads/${thread.id}`, { goal: null, planMode: false, reasoning: null, personality: "standard" });
  llm.reply(sse(openaiText("ok")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Igjen" });
  await h.finished(thread.id, 2);
  const second = llm.requests[1].body;
  assert.doesNotMatch(second.messages[0].content, /Plan mode|goal for this thread|Style:/);
  assert.equal(second.reasoning_effort, undefined);
  assert.ok(second.tools.some((tool: any) => tool.function.name === "write_file"));
});

test("a tool call outside the read-only set is refused in plan mode, even if the model sends it", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code");
  await h.api("PATCH", `/api/threads/${thread.id}`, { planMode: true });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "tool.started").map((e) => e.tool), ["list_dir"], "the demo model only looks around");
  assert.match(textOf(events), /Plan:/);
  assert.equal(existsSync(path.join(project.path, "index.html")), false);
});

test("fork copies history and choices into an idle thread, and the copy can go on alone", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code");
  await h.api("PATCH", `/api/threads/${thread.id}`, { goal: "Mål" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  await h.finished(thread.id);

  const copy = await h.api("POST", `/api/threads/${thread.id}/fork`);
  assert.notEqual(copy.id, thread.id);
  assert.equal(copy.title, "hjelp (gaffel)"); // round 14 (SPEC 30.3)
  assert.equal(copy.goal, "Mål");
  assert.equal(copy.running, false);
  const original = await h.events(thread.id);
  const copied = await h.events(copy.id);
  assert.deepEqual(copied.map((e) => e.event), original.map((e) => e.event));

  await h.api("POST", `/api/threads/${copy.id}/messages`, { text: "hjelp igjen" });
  await h.finished(copy.id, 2);
  assert.equal((await h.events(thread.id)).length, original.length, "the original is untouched");
  await assert.rejects(h.api("POST", "/api/threads/finnes-ikke/fork"), /404/);
});

test("init writes an AGENTS.md template once and never overwrites", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const socket = await h.socket();
  assert.deepEqual(await h.api("POST", `/api/projects/${project.id}/init`), { path: "AGENTS.md" });
  const text = readFileSync(path.join(project.path, "AGENTS.md"), "utf8");
  assert.match(text, new RegExp(`^# ${project.name}`));
  await socket.waitFor((m) => m.type === "project.files-changed" && m.paths.includes("AGENTS.md"));
  writeFileSync(path.join(project.path, "AGENTS.md"), "min egen");
  await assert.rejects(h.api("POST", `/api/projects/${project.id}/init`), /409/);
  assert.equal(readFileSync(path.join(project.path, "AGENTS.md"), "utf8"), "min egen");
});
