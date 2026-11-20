// Round 2 of the wish list: providers with only a key, model lists, profile numbers and the
// global AGENTS.md. Every provider here is a local fake server; no real API is called.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseModelList, tableContext } from "../src/providers/presets.ts";
import { OPENAI_DONE, openaiChunk, openaiText, openaiUsage, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir } from "./helpers.ts";

const json = (body: unknown) => (_req: unknown, res: import("node:http").ServerResponse) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

test("the provider catalogue retains the original presets and Egendefinert", async (t) => {
  const h = await startHarness(t);
  const presets = await h.api("GET", "/api/provider-presets");
  for (const id of ["openrouter", "abliteration", "anthropic", "openai", "custom"]) assert.ok(presets.some((p: any) => p.id === id));
  assert.equal(presets.find((p: any) => p.id === "abliteration").baseUrl, "https://api.abliteration.ai/v1");
  assert.equal(presets.find((p: any) => p.id === "abliteration").kind, "openai-compatible");
  const named = presets.filter((p: any) => p.id !== "custom");
  assert.ok(named.every((p: any) => p.checked && p.beta !== true), "Ingen Beta-merker på leverandørpresettene etter brukerens valg");
});

test("model lists: context from the response, then the table, then a safe default", () => {
  const models = parseModelList({
    data: [
      { id: "anthropic/claude-x", context_length: 400_000 }, // OpenRouter
      { id: "llama-3.3-70b-versatile", context_window: 131_072 }, // Groq
      { id: "mistral-large-4", max_context_length: 1_000_000 }, // Mistral
      { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", max_input_tokens: 1_000_000 }, // Anthropic
      { id: "gpt-6.1-sol" }, // OpenAI: no context field
      { id: "noe-helt-ukjent" },
      { id: "gpt-6.1-sol" }, // duplicate
    ],
  });
  const by = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.equal(models.length, 6);
  assert.deepEqual([by["anthropic/claude-x"].contextWindow, by["anthropic/claude-x"].contextSource], [400_000, "api"]);
  assert.equal(by["llama-3.3-70b-versatile"].contextWindow, 131_072);
  assert.equal(by["mistral-large-4"].contextWindow, 1_000_000);
  assert.equal(by["claude-opus-5-5"].name, "Claude Opus 5.5");
  assert.deepEqual([by["gpt-6.1-sol"].contextWindow, by["gpt-6.1-sol"].contextSource], [1_050_000, "table"]);
  assert.deepEqual([by["noe-helt-ukjent"].contextWindow, by["noe-helt-ukjent"].contextSource], [128_000, "default"]);
  assert.equal(tableContext("openai/gpt-6-luna"), 1_050_000, "OpenRouter's provider/model ids match after the slash");
  assert.equal(tableContext("my-gpt-6"), undefined, "but not in the middle of a name");
  assert.equal(tableContext("openai/gpt-oss-120b"), 131_072);
  assert.throws(() => parseModelList({ error: "nope" }), /ingen liste/);
});

test("a preset with a key fetches /models from the provider, and the key stays on the server", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  llm.reply(json({ object: "list", data: [{ id: "fake-a", context_length: 64_000 }, { id: "fake-b" }] }));
  const provider = await h.api("POST", "/api/providers", { preset: "openrouter", baseUrl: `${llm.url}/v1`, apiKey: "sk-hemmelig-123" });
  assert.equal(provider.name, "OpenRouter");
  assert.equal(provider.kind, "openai-compatible");
  assert.equal(provider.apiKeyEnv, provider.presetId ? undefined : "OPENROUTER_API_KEY");
  assert.equal(provider.hasKey, true);

  const listed = await h.api("POST", `/api/providers/${provider.id}/models/fetch`);
  assert.equal(llm.requests[0].url, "/v1/models");
  assert.equal(llm.requests[0].headers.authorization, "Bearer sk-hemmelig-123");
  assert.deepEqual(listed.map((m: any) => [m.id, m.contextWindow, m.contextSource]), [["fake-a", 64_000, "api"], ["fake-b", 128_000, "default"]]);
  assert.ok(!JSON.stringify(listed).includes("hemmelig"));

  const added = await h.api("POST", `/api/providers/${provider.id}/models`, { models: [{ model: "fake-a", contextWindow: 64_000 }, { model: "fake-b" }, { model: "fake-a" }] });
  assert.deepEqual(added.map((m: any) => [m.model, m.contextWindow]), [["fake-a", 64_000], ["fake-b", 128_000]]);
  const again = await h.api("POST", `/api/providers/${provider.id}/models`, { models: [{ model: "fake-a" }] });
  assert.deepEqual(again, [], "a model that is already added is skipped");
  const boot = await h.api("GET", "/api/bootstrap");
  assert.ok(!JSON.stringify(boot).includes("hemmelig"));

  // A provider error comes back as 502 with the key redacted.
  llm.reply((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "bad key sk-hemmelig-123" } }));
  });
  const failed = await h.raw("POST", `/api/providers/${provider.id}/models/fetch`);
  assert.equal(failed.status, 502);
  assert.ok(!failed.body.includes("sk-hemmelig-123"), failed.body);
  await assert.rejects(h.api("POST", "/api/providers", { preset: "finnes-ikke", apiKey: "x" }), /400/);
});

test("Anthropic's model list is read with its own headers and max_input_tokens", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  llm.reply(json({ data: [{ id: "claude-test", display_name: "Claude Test", max_input_tokens: 500_000, type: "model" }], has_more: false }));
  const provider = await h.api("POST", "/api/providers", { preset: "anthropic", baseUrl: llm.url, apiKey: "ant-key" });
  const listed = await h.api("POST", `/api/providers/${provider.id}/models/fetch`);
  assert.equal(llm.requests[0].url, "/v1/models?limit=1000");
  assert.equal(llm.requests[0].headers["x-api-key"], "ant-key");
  assert.equal(llm.requests[0].headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(listed, [{ id: "claude-test", name: "Claude Test", contextWindow: 500_000, contextSource: "api" }]);
});

test("profile numbers are counted from the usage events: totals, days, streaks and models", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake-modell", model: "fake", contextWindow: 100_000 });
  const usage = (input: number, output: number) => sse(openaiChunk({ role: "assistant", content: "ok" }) + openaiChunk({}, "stop") + openaiUsage(input, output) + OPENAI_DONE);

  const empty = await h.api("GET", "/api/profile");
  assert.equal(empty.totalTokens, 0);
  assert.equal(empty.currentStreak, 0);
  assert.equal(empty.days.length, 28);

  const old = await h.thread(null, "chat", model.id);
  llm.reply(usage(100, 10));
  await h.api("POST", `/api/threads/${old.id}/messages`, { text: "i forgårs" });
  await h.finished(old.id);
  h.app.store.shiftThreadTime(old.id, 2 * 86_400_000);

  const today = await h.thread(null, "chat", model.id);
  llm.reply(usage(200, 20));
  await h.api("POST", `/api/threads/${today.id}/messages`, { text: "i dag" });
  await h.finished(today.id);
  llm.reply(usage(500, 50)); // the thread's running total becomes 700 + 70
  await h.api("POST", `/api/threads/${today.id}/messages`, { text: "igjen" });
  await h.finished(today.id, 2);
  const demo = await h.thread(null, "chat", "mock-demo");
  await h.api("POST", `/api/threads/${demo.id}/messages`, { text: "hjelp" });
  await h.finished(demo.id);

  const stats = await h.api("GET", "/api/profile");
  const demoTokens = stats.byModel.find((m: any) => m.modelId === "mock-demo").tokens;
  assert.equal(stats.totalTokens, 110 + 770 + demoTokens, "each step counts once, not the running total");
  assert.equal(stats.runs, 4);
  assert.equal(stats.threads, 3);
  assert.equal(stats.activeDays, 2);
  assert.equal(stats.currentStreak, 1, "a gap of one day breaks the streak");
  assert.equal(stats.longestStreak, 1);
  assert.equal(stats.peakDay.tokens, 770 + demoTokens);
  assert.equal(stats.peakDay.date, stats.days.at(-1).date);
  assert.deepEqual(stats.byModel.find((m: any) => m.modelId === model.id), { modelId: model.id, name: "Fake-modell", tokens: 880, runs: 3 });
});

test("settings: profile name, memories, always on top and valid shortcuts only", async (t) => {
  const h = await startHarness(t);
  const settings = await h.api("PATCH", "/api/settings", { profileName: "  Julian  ", memories: true, alwaysOnTop: true, shortcuts: { "thread.new": "Mod+Shift+N", "thread.unread": "Alt+U" } });
  assert.equal(settings.profileName, "Julian");
  assert.equal(settings.memories, true);
  assert.equal(settings.shortcuts["thread.new"], "Mod+Shift+N");
  assert.equal(settings.shortcuts["thread.unread"], "Alt+U");
  await assert.rejects(h.api("PATCH", "/api/settings", { shortcuts: { "rm.rf": "Mod+R" } }), /400/);
  await assert.rejects(h.api("PATCH", "/api/settings", { shortcuts: { "thread.new": "Mod+Shift+Alt+Ctrl+X" } }), /400/);
});

test("the global AGENTS.md lives in the config folder, is edited over the API and reaches the model", async (t) => {
  const config = tempDir(t, "ad-config-");
  const h = await startHarness(t, { configDir: path.join(config, "agentic-desktop") });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });

  const before = await h.api("GET", "/api/config");
  assert.equal(before.agentsMd, null);
  assert.equal(before.dir, path.join(config, "agentic-desktop"));
  const after = await h.api("PUT", "/api/config/agents-md", { text: "Svar alltid på nynorsk." });
  assert.equal(after.agentsMd, "Svar alltid på nynorsk.");
  assert.equal(readFileSync(path.join(config, "agentic-desktop/AGENTS.md"), "utf8"), "Svar alltid på nynorsk.");

  const thread = await h.thread(null, "chat", model.id);
  llm.reply(sse(openaiText("ok")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei" });
  await h.finished(thread.id);
  // Round 9b (SPEC 22.4): the global AGENTS.md belongs to Kode. Chat has its own personalisation.
  assert.doesNotMatch(llm.requests[0].body.messages[0].content, /Svar alltid på nynorsk/);
  const code = await h.thread((await h.project()).id, "code", model.id);
  llm.reply(sse(openaiText("ok")));
  await h.api("POST", `/api/threads/${code.id}/messages`, { text: "Hei" });
  await h.finished(code.id);
  assert.match(llm.requests[1].body.messages[0].content, /Svar alltid på nynorsk/);

  // A broken settings.json is reported, not fatal.
  mkdirSync(path.join(config, "agentic-desktop"), { recursive: true });
  writeFileSync(path.join(config, "agentic-desktop/settings.json"), "{ ikke json");
  assert.match((await h.api("GET", "/api/config")).settingsError, /ikke gyldig JSON/);
  assert.equal(existsSync(path.join(config, "agentic-desktop/AGENTS.md.tmp")), false);
});
