// Prompt contracts, not claims about how any particular model will behave.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { threadChoices } from "../src/agent/context.ts";
import { defaultParts } from "../src/agent/harness.ts";
import { basePrompt, USER_TASK_PROMPT } from "../src/agent/prompt.ts";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir } from "./helpers.ts";

test("the user's objective is mandatory even with every optional workflow part off", async (t) => {
  const parts = Object.fromEntries(Object.keys(defaultParts()).map((id) => [id, false]));
  const prompt = basePrompt(undefined, { parts, tools: [] });
  assert.ok(prompt.includes(USER_TASK_PROMPT));
  assert.match(prompt, /actual objective, including later clarifications and limits/);
  assert.match(prompt, /completing the authorized work and its necessary checks/);
  assert.match(prompt, /question, assessment or discussion calls for an answer, not unrequested changes/);
  assert.match(prompt, /do not invent independent goals/);
  assert.match(prompt, /current instructions take precedence over older goals/);
  assert.doesNotMatch(prompt, /# How to work|Here you can|keep a short plan with update_plan/);
  const h = await startHarness(t);
  await assert.rejects(h.api("PATCH", "/api/harness", { parts: { safety: false } }), /400/);
});

test("existing custom Code instructions are preserved while actual model requests receive the objective rule", async (t) => {
  const configDir = tempDir(t, "ad-intent-config-");
  const custom = "# Mine eldre instruksjoner\nSvar på nynorsk.\n";
  writeFileSync(path.join(configDir, "AGENTS.md"), custom);
  const h = await startHarness(t, { configDir, seedDefaults: true });
  const llm = await startFakeLlm(t);
  llm.always(sse(openaiText("Vurderingen er klar.")));
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: `${llm.url}/v1` });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Test", model: "fake", contextWindow: 32000 });
  const project = await h.project();
  writeFileSync(path.join(project.path, "AGENTS.md"), "Prosjektets eksisterende instruksjoner.");
  mkdirSync(path.join(project.path, ".agentic"));
  writeFileSync(path.join(project.path, ".agentic", "AGENTS.md"), "Prosjektets ekstra instruksjoner.");
  await h.api("PATCH", "/api/harness", { parts: { workflow: false } });
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Vurder om løsningen er klar. Ingen endringer." });
  await h.finished(thread.id);
  const sent = llm.requests.at(-1)!.body.messages[0].content as string;
  assert.ok(sent.includes(USER_TASK_PROMPT));
  assert.ok(sent.includes(custom.trim()));
  assert.match(sent, /project wins, within the user's current task and the app's permissions/);
  assert.equal(readFileSync(path.join(configDir, "AGENTS.md"), "utf8"), custom);
  assert.doesNotMatch(sent, /Understand before you change/);
});

test("Chat customization, saved goals, plan mode and no-project Code keep the objective without adding access", async (t) => {
  const h = await startHarness(t);
  await h.api("PUT", "/api/chat-personal", { instructions: "Mine egne Chat-regler." });
  const chat = await h.thread(null, "chat");
  let chatBase = h.app.runner.systemLayers(chat, undefined, []).find((l) => l.id === "chat-base")!.text;
  assert.ok(chatBase.includes(USER_TASK_PROMPT));
  assert.match(chatBase, /Chat cannot inspect or edit/);
  await h.api("PUT", "/api/chat-personal", { instructions: "" });
  chatBase = h.app.runner.systemLayers(chat, undefined, []).find((l) => l.id === "chat-base")!.text;
  assert.ok(chatBase.includes(USER_TASK_PROMPT));
  const project = await h.project();
  const code = await h.thread(project.id, "code");
  const plan = { ...code, planMode: true, goal: "Et eldre mål" };
  const layers = h.app.runner.systemLayers(plan, project, []);
  assert.ok(layers.find((l) => l.id === "base")!.text.includes(USER_TASK_PROMPT));
  assert.match(threadChoices(plan).join("\n"), /later user clarifications, changes and limits take precedence/);
  assert.match(layers.find((l) => l.id === "env")!.text, /plan mode: read-only/);
  assert.ok(h.app.runner.toolDefs(plan, project, []).every((tool) => !["edit_file", "write_file", "run_command", "remember", "forget", "propose_skill", "thread_create"].includes(tool.name)));
  const noProject = await h.thread(null, "code");
  const noProjectLayers = h.app.runner.systemLayers(noProject, undefined, []);
  assert.ok(noProjectLayers.find((l) => l.id === "base")!.text.includes(USER_TASK_PROMPT));
  assert.deepEqual(h.app.runner.toolDefs(noProject, undefined, []).map(t=>t.name), ["ui_mod", "request_user_input"]);
  assert.match(noProjectLayers.find((l) => l.id === "env")!.text, /Tools on: ui_mod/);
});
