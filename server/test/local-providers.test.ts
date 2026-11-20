import assert from "node:assert/strict";
import { test } from "node:test";
import type { ListedModel, LocalModelRecommendations, ModelConfig, ProviderConfig } from "../../shared/protocol.ts";
import { probeLocalModels } from "../src/providers/local.ts";
import { availableRamGiB, largestNvidiaGpuGiB } from "../src/providers/local-hardware.ts";
import { detectLocalProviders } from "../src/providers/presets.ts";
import { httpError, OPENAI_DONE, openaiChunk, openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness } from "./helpers.ts";

test("fixed-address detection checks only known loopback defaults and sends no credentials", async (t) => {
  const ollama = await startFakeLlm(t);
  const compatible = await startFakeLlm(t);
  const redirected = await startFakeLlm(t);
  ollama.reply(httpError(200, { models: [] }));
  compatible.reply(httpError(200, { data: [{ id: "chat" }, { id: "vector", type: "embedding" }] }));
  compatible.reply(httpError(401, { message: "key required" }));
  compatible.reply(httpError(307, {}, { location: `${redirected.url}/v1/models` }));
  const checked: string[] = [];
  const result = await detectLocalProviders((kind, address, signal) => {
    checked.push(address);
    return probeLocalModels(kind, `${kind === "ollama" ? ollama.url : compatible.url}/v1`, signal);
  });
  assert.deepEqual(checked, [11434, 1234, 8080, 8000].map((port) => `http://127.0.0.1:${port}/v1`));
  assert.equal(ollama.requests[0].url, "/api/tags");
  assert.equal(redirected.requests.length, 0);
  assert.equal([...ollama.requests, ...compatible.requests].some((req) => req.headers.authorization), false);
  assert.equal(result.find((match) => match.presetId === "ollama")?.modelCount, 0);
  assert.equal(result.filter((match) => match.presetId !== "ollama").length, 1);
  assert.equal(result.find((match) => match.presetId !== "ollama")?.modelCount, 1);
});

test("Ollama lists models without a key and carries discovered context, tools and images through import", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  llm.always((req, res) => {
    if (req.url === "/api/tags") return httpError(200, { models: [{ model: "chat" }, { model: "vector" }, { model: "unknown" }] })(req, res);
    if (req.url === "/api/ps") return httpError(200, { models: [{ model: "chat", context_length: 16_384 }] })(req, res);
    if (req.url === "/api/show" && req.body.model === "chat") return httpError(200, { capabilities: ["completion", "tools", "vision"], parameters: "num_ctx 8192" })(req, res);
    if (req.url === "/api/show" && req.body.model === "vector") return httpError(200, { capabilities: ["embedding"] })(req, res);
    return httpError(404, {})(req, res);
  });
  const provider = await h.api<ProviderConfig>("POST", "/api/providers", { preset: "ollama", baseUrl: llm.url });
  assert.equal(provider.baseUrl, `${llm.url}/v1`);
  assert.equal(provider.localKind, "ollama");
  assert.equal(provider.hasKey, false);
  const modelsRoute = `/api/providers/${provider.id}/models`;
  const listed = await h.api<ListedModel[]>("POST", `${modelsRoute}/fetch`);
  assert.deepEqual(listed.map((model) => [model.id, model.contextWindow, model.contextSource, model.supportsTools, model.supportsImages]), [
    ["chat", 16_384, "api", true, true], ["unknown", 4_096, "default", undefined, undefined],
  ]);
  assert.ok(llm.requests.every((req) => !req.headers.authorization));
  const added = await h.api<ModelConfig[]>("POST", modelsRoute, { models: [...listed.map((model) => ({ ...model, model: model.id })), { model: "gpt-6-manual" }] });
  assert.deepEqual(added.map((model) => [model.model, model.contextWindow, model.supportsTools, model.supportsImages]), [
    ["chat", 16_384, true, true], ["unknown", 4_096, undefined, undefined], ["gpt-6-manual", 4_096, undefined, undefined],
  ]);
  assert.match((await h.api("POST", `/api/providers/${provider.id}/test`)).message, /Fant 2 chatmodeller/);
});

test("LM Studio merges active native metadata into compatible model IDs", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  llm.reply(httpError(200, { data: [{ id: "loaded" }, { id: "vector" }] }));
  llm.reply(httpError(200, { models: [
    { key: "original", display_name: "Lokal modell", capabilities: { trained_for_tool_use: true, vision: false }, loaded_instances: [{ id: "loaded", config: { context_length: 8192 } }] },
    { key: "vector", type: "embedding" },
  ] }));
  const provider = await h.api<ProviderConfig>("POST", "/api/providers", { preset: "lm-studio", baseUrl: `${llm.url}/test/v1/models` });
  const listed = await h.api<ListedModel[]>("POST", `/api/providers/${provider.id}/models/fetch`);
  assert.deepEqual(llm.requests.map((req) => req.url), ["/test/v1/models", "/test/api/v1/models"]);
  assert.deepEqual(listed, [{ id: "loaded", name: "Lokal modell", contextWindow: 8192, contextSource: "api", supportsImages: false, supportsTools: true }]);
});

test("a provider address change or redirect never reuses a previously saved key", async (t) => {
  const h = await startHarness(t);
  const original = await startFakeLlm(t);
  const other = await startFakeLlm(t);
  const key = "fake-provider-secret";
  const provider = await h.api<ProviderConfig>("POST", "/api/providers", { preset: "custom-local", baseUrl: original.url, apiKey: key });
  assert.equal(provider.localKind, "openai-compatible");
  const route = `/api/providers/${provider.id}`;
  for (const baseUrl of ["http:///host", "file:///etc", "http://user:pass@host", "http://@host", "https://host?q", "https://host#", "http://ho\nst"]) {
    await assert.rejects(h.api("PATCH", route, { baseUrl }), /400.*http- eller https-adresse/);
  }
  original.reply(httpError(307, { message: key }, { location: `${other.url}/v1/models` }));
  await assert.rejects(h.api("POST", `${route}/models/fetch`), /502.*videresender/);
  assert.equal(original.requests[0].headers.authorization, `Bearer ${key}`);
  assert.equal(other.requests.length, 0);
  original.reply(httpError(200, { data: [{ id: "usable", display_name: `Bearer ${key}` }, { id: key }] }));
  const reflected = await h.api<ListedModel[]>("POST", `${route}/models/fetch`);
  assert.deepEqual(reflected.map((model) => model.name), ["Bearer [skjult]"]);
  assert.equal((await h.api<ProviderConfig>("PATCH", route, { baseUrl: other.url })).hasKey, false);
  await h.keyring.store(provider.id, "Stale credential", key);
  await h.api("POST", "/api/keyring/retry");
  other.reply(httpError(200, { data: [] }));
  await h.api("POST", `${route}/models/fetch`);
  assert.equal(other.requests[0].headers.authorization, undefined);
  assert.doesNotMatch(JSON.stringify(await h.api("GET", "/api/bootstrap")), new RegExp(key));
});

test("the local generation test sends only its inert schema and rejects incorrect structured output", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api<ProviderConfig>("POST", "/api/providers", { preset: "vllm", baseUrl: llm.url });
  const route = `/api/providers/${provider.id}`;
  const [model] = await h.api<ModelConfig[]>("POST", `${route}/models`, { models: [{ model: "local", supportsTools: true }] });
  llm.reply(sse(openaiToolCall("confirm_connection", { value: "ok" }, "mock-test")));
  assert.equal((await h.api("POST", `${route}/test`, { modelId: model.id })).ok, true);
  assert.deepEqual(llm.requests[0].body.tools.map((tool: any) => tool.function.name), ["confirm_connection"]);
  assert.equal(llm.requests[0].body.stream_options, undefined);
  llm.reply(sse(openaiToolCall("confirm_connection", { value: "ok", unexpected: true }, "mock-test")));
  assert.match((await h.api("POST", `${route}/test`, { modelId: model.id })).message, /uten et gyldig verktøykall/);
  await h.api("PATCH", `/api/models/${model.id}`, { supportsTools: false });
  llm.reply(sse(openaiText("OK")));
  assert.equal((await h.api("POST", `${route}/test`, { modelId: model.id })).ok, true);
  assert.equal(llm.requests[2].body.tools, undefined);
});

test("unknown local model capabilities disable tools in Kode until the user opts in", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api<ProviderConfig>("POST", "/api/providers", { preset: "llama-cpp", baseUrl: llm.url });
  const [model] = await h.api<ModelConfig[]>("POST", `/api/providers/${provider.id}/models`, { models: [{ model: "local" }] });
  const project = await h.project();
  const thread = await h.thread(project.id, "code", model.id);
  const messages = `/api/threads/${thread.id}/messages`;
  llm.reply(sse(openaiChunk({ content: "Tekstsvar", tool_calls: [{ function: { name: "read_file", arguments: "{}" } }] }, "tool_calls") + OPENAI_DONE));
  await h.api("POST", messages, { text: "Kan du lese en fil?" });
  const first = await h.finished(thread.id, 1);
  assert.equal(ofType(first, "tool.finished").length, 0);
  assert.equal(llm.requests[0].body.tools, undefined);
  assert.match(llm.requests[0].body.messages[0].content, /text-only model/);
  await h.api("PATCH", `/api/models/${model.id}`, { supportsTools: true });
  llm.reply(sse(openaiText("Med verktøy")));
  await h.api("POST", messages, { text: "Prøv igjen." });
  await h.finished(thread.id, 2);
  assert.ok(llm.requests[1].body.tools.some((tool: any) => tool.function.name === "read_file"));
  assert.ok(llm.requests[1].body.messages.every((message: any) => !message.tool_calls));
});

test("local recommendations respect the context and RAM reserve and can use manual hardware", async (t) => {
  const h = await startHarness(t);
  assert.equal(availableRamGiB("MemTotal: 8388608 kB\nMemAvailable: 4194304 kB\n"), 4);
  assert.equal(largestNvidiaGpuGiB("4096\n20480\n[N/A]\n"), 20);
  const route = "/api/providers/local/recommend";
  const body = { source: "manual", mode: "code", contextTokens: 16_384 };
  const result = await h.api<LocalModelRecommendations>("POST", route, { ...body, availableRamGiB: 8, freeGpuGiB: 24 });
  assert.equal(result.suggestions[0].placement, "gpu");
  assert.ok(result.suggestions.every((item) => item.estimatedRamGiB <= 4 && (item.estimatedGpuGiB ?? 0) <= 24));
  const low = await h.api<LocalModelRecommendations>("POST", route, { ...body, availableRamGiB: 4, freeGpuGiB: 24 });
  assert.deepEqual(low.suggestions, []);
  await assert.rejects(h.api("POST", route, { ...body, availableRamGiB: -1 }), /400.*tilgjengelig RAM/);
  await assert.rejects(h.api("POST", route, { ...body, contextTokens: 1234, availableRamGiB: 32 }), /400.*kontekst/);
});
