import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_AGENTS_MD, DEFAULT_CHAT, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, HarnessStore, MAX_CHAT_FIELD } from "../src/agent/harness.ts";
import { basePrompt, environmentPrompt } from "../src/agent/prompt.ts";
import { startHarness, tempDir, textOf } from "./helpers.ts";

test("Chat ships editable instructions, migrates legacy emptiness, preserves custom and deliberate empty text", (t) => {
  assert.ok(DEFAULT_CHAT_SYSTEM_INSTRUCTIONS.length > 200 && DEFAULT_CHAT_SYSTEM_INSTRUCTIONS.length <= MAX_CHAT_FIELD);
  const dir = tempDir(t);
  const file = path.join(dir, "harness.json");
  const old = { version: 1, chat: { ...DEFAULT_CHAT, instructions: "", about: "Lærer", tone: "kort", autoMemory: true } };
  writeFileSync(file, JSON.stringify(old));
  const migrated = new HarnessStore(dir);
  assert.equal(migrated.state().chat.instructions, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS);
  assert.equal(migrated.state().chat.about, "Lærer");
  migrated.setChat({ instructions: "" });
  assert.equal(new HarnessStore(dir).state().chat.instructions, "", "an explicitly saved empty value survives reopening");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).chatInstructionsCustomized, true);
  writeFileSync(file, JSON.stringify({ ...old, chat: { ...old.chat, instructions: "Mine egne regler" } }));
  assert.equal(new HarnessStore(dir).state().chat.instructions, "Mine egne regler");
});

test("instruction reset restores only the Chat instruction, while full reset keeps stored memories", async (t) => {
  const h = await startHarness(t);
  const initial = await h.api("GET", "/api/chat-personal");
  assert.equal(initial.defaults.instructions, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS);
  assert.equal(initial.defaults.maxLength, MAX_CHAT_FIELD);
  assert.equal(initial.instructionsAreDefault, true);
  const custom = { instructions: "Bruk egne eksempler", about: "Lærer", tone: "vennlig", traits: { warm: 1, enthusiastic: 0, structure: -1, emoji: 0 }, autoMemory: true, memories: false };
  await h.api("PUT", "/api/chat-personal", custom);
  await h.api("POST", "/api/chat-personal/memories", { text: "Brukeren liker matematikk" });
  const reset = await h.api("POST", "/api/chat-personal/instructions/reset");
  assert.deepEqual(reset, { ...custom, instructions: DEFAULT_CHAT_SYSTEM_INSTRUCTIONS });
  assert.equal((await h.api("GET", "/api/chat-personal")).memories.length, 1);
  assert.deepEqual(await h.api("POST", "/api/chat-personal/reset"), DEFAULT_CHAT);
  assert.equal((await h.api("GET", "/api/chat-personal")).memories.length, 1);
});

test("Kode without project keeps Kode identity and no tools or Chat personalization in preview and a real request", async (t) => {
  const h = await startHarness(t);
  await h.api("PUT", "/api/chat-personal", { instructions: "CHAT_PRIVATE_INSTRUCTIONS", autoMemory: true });
  await h.api("POST", "/api/chat-personal/memories", { text: "CHAT_PRIVATE_MEMORY" });
  await h.api("POST", "/api/memories", { scope: "global", text: "CODE_MEMORY" });
  const preview = await h.api("GET", "/api/harness/preview?mode=code");
  assert.equal(preview.mode, "code");
  assert.deepEqual(preview.tools, ["ui_mod"]);
  const prompt = preview.layers.map((l: any) => l.text).join("\n");
  assert.match(prompt, /^You are the coding agent/);
  assert.match(prompt, /Mode: Kode/);
  assert.match(prompt, /Tools on: ui_mod/);
  assert.match(prompt, /already in Kode/);
  assert.doesNotMatch(prompt, /chat assistant|CHAT_PRIVATE|CODE_MEMORY|keep a short plan with update_plan|Change existing files with edit_file/);
  const thread = await h.thread(null, "code");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hvem er du?" });
  assert.match(textOf(await h.finished(thread.id)), /kodeagenten.*Kode uten et valgt prosjekt/s);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Husk at jeg heter Testperson." });
  await h.finished(thread.id, 2);
  assert.equal((await h.api("GET", "/api/chat-personal")).memories.length, 1, "no-project Kode never writes Chat memories");
});

test("runtime distinguishes configured transport, exact tools, panel visibility and plan mode", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const code = await h.thread(project.id, "code");
  const full = h.app.runner.systemLayers(code, project, []);
  const env = full.find((l) => l.id === "env")!.text;
  assert.match(env, /Model transport: local demo\/mock/);
  assert.match(env, /Panels do not grant you tools, desktop control, screen vision/);
  const plan = { ...code, planMode: true };
  const planLayers = h.app.runner.systemLayers(plan, project, []);
  const planText = planLayers.map((l) => l.text).join("\n");
  assert.match(planText, /plan mode: read-only/);
  assert.doesNotMatch(planText, /keep a short plan with update_plan|Change existing files with edit_file|After you change code, check it/);
  assert.doesNotMatch(planLayers.find((l) => l.id === "env")!.text, /Tools on:.*(?:run_command|edit_file|update_plan)/);
  assert.match(basePrompt(undefined, { tools: [] }), /no tools/);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Konfigurert lokalmodell", baseUrl: "http://localhost:11434/v1" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "configured-runtime-model", contextWindow: 32000, supportsImages: false });
  await h.api("PATCH", "/api/settings", { defaultModelId: model.id });
  const localPreview = await h.api("GET", "/api/harness/preview?mode=chat");
  const localText = localPreview.layers.map((l: any) => l.text).join("\n");
  assert.match(localText, /configured-runtime-model/);
  assert.match(localText, /endpoint: http:\/\/localhost:11434; configured loopback endpoint/);
  assert.match(localText, /no image forwarding is enabled/);
  const imageText = environmentPrompt(undefined, { runtime: { mode: "chat", provider: { kind: "openai-compatible" }, model: { model: "images", supportsImages: true }, providerWebSearch: true }, tools: [] });
  assert.match(imageText, /adapter forwards supplied images/);
  assert.match(imageText, /Provider-managed web search: enabled for this turn/);
  const anthropic = environmentPrompt(undefined, { runtime: { mode: "chat", provider: { kind: "anthropic" }, model: { model: "images", supportsImages: false } } });
  assert.match(anthropic, /adapter forwards supplied images/, "Anthropic adapter forwards images independently of the OpenAI-compatible flag");
  for (const [baseUrl, expected] of [
    ["http://127.0.0.1:11434/v1", /configured loopback endpoint/],
    ["https://openrouter.ai/api/v1", /configured network endpoint/],
    ["https://user:DO_NOT_LEAK@example.com/private?key=DO_NOT_LEAK", /endpoint: https:\/\/example.com/],
  ] as const) {
    const text = environmentPrompt(undefined, { runtime: { mode: "chat", provider: { kind: "openai-compatible", baseUrl }, model: { model: "configured-model" } }, tools: ["web_fetch"] });
    assert.match(text, expected);
    assert.match(text, /Mode: Chat/);
    assert.match(text, /Tools on: web_fetch/);
    assert.match(text, /does not prove where inference executes/);
    assert.doesNotMatch(text, /DO_NOT_LEAK|\/private|key=/);
  }
});

test("an untouched default from an earlier version follows the app; anything the user changed is kept", async (t) => {
  const { upgradeGlobalAgents, HarnessStore: Store } = await import("../src/agent/harness.ts");
  const oldAgents = readFileSync(path.join(import.meta.dirname, "fixtures/agents-default-v020.md"), "utf8");
  const oldChat = readFileSync(path.join(import.meta.dirname, "fixtures/chat-default-v022.md"), "utf8").trim();
  // The global AGENTS.md: replaced, with the old text in backups.
  const config = tempDir(t);
  writeFileSync(path.join(config, "AGENTS.md"), oldAgents);
  assert.equal(upgradeGlobalAgents(config), "upgraded");
  assert.equal(readFileSync(path.join(config, "AGENTS.md"), "utf8"), DEFAULT_AGENTS_MD);
  const backups = readdirSync(path.join(config, "backups"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(config, "backups", backups[0]), "utf8"), oldAgents);
  assert.equal(upgradeGlobalAgents(config), "kept", "the current default is left alone");
  // One changed character means it is the user's own text.
  const edited = tempDir(t);
  writeFileSync(path.join(edited, "AGENTS.md"), `${oldAgents}\n- Bruk pnpm.\n`);
  assert.equal(upgradeGlobalAgents(edited), "kept");
  assert.match(readFileSync(path.join(edited, "AGENTS.md"), "utf8"), /Bruk pnpm/);
  assert.equal(upgradeGlobalAgents(tempDir(t)), "kept", "no file, nothing to do");
  // The Chat instruction in harness.json: the same rule.
  const data = tempDir(t);
  writeFileSync(path.join(data, "harness.json"), JSON.stringify({ version: 1, chat: { instructions: oldChat, about: "Lærer" } }));
  const upgraded = new Store(data).state().chat;
  assert.equal(upgraded.instructions, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS);
  assert.equal(upgraded.about, "Lærer");
  const own = tempDir(t);
  writeFileSync(path.join(own, "harness.json"), JSON.stringify({ version: 1, chat: { instructions: `${oldChat}\nSvar alltid kort.` } }));
  assert.match(new Store(own).state().chat.instructions, /Svar alltid kort/);
});

test("the agent's picture of itself comes from the tool registry", async (t) => {
  const { CODE_TOOLS, abilities } = await import("../src/agent/tools.ts");
  // Every registered tool says what it lets the agent do; one without it would be invisible there.
  for (const tool of CODE_TOOLS) assert.ok(tool.can && tool.can.length > 8 && !/[.\n]/.test(tool.can), `${tool.def.name} needs a plain "can" phrase`);
  const kode = abilities(CODE_TOOLS);
  assert.equal(new Set(kode).size, kode.length, "each phrase once");
  // A tool added to the list shows up without touching the prompt code.
  const extra = { ...CODE_TOOLS[0], def: { ...CODE_TOOLS[0].def, name: "ny_ting" }, can: "do the new thing" };
  assert.ok(abilities([...CODE_TOOLS, extra]).includes("do the new thing"));
  // No project: the description of Kode comes from the registry, and only the offered tool is "here".
  const none = basePrompt(undefined, { tools: ["ui_mod"], abilities: ["change the app's theme and visual mods"] });
  for (const phrase of kode) assert.ok(none.includes(phrase), `Kode's abilities name: ${phrase}`);
  assert.doesNotMatch(none, /Here you can/);
  // A running app: the preview for a project lists what its tools can do, and Chat what its tools can.
  const h = await startHarness(t);
  const project = await h.project();
  const code = (await h.api("GET", `/api/harness/preview?mode=code&projectId=${project.id}`)).layers.find((l: any) => l.id === "base").text;
  assert.match(code, /Here you can read, search and explain the code, write and change code, fix bugs and refactor, run commands, tests and builds/);
  assert.match(code, /change the app's theme and visual mods/);
  const chat = (await h.api("GET", "/api/harness/preview?mode=chat")).layers.find((l: any) => l.id === "chat-base").text;
  assert.match(chat, /With the tools switched on in this chat you can .*create Word, Excel, PowerPoint and text files to download/);
});
