// Both HTTP providers against a local server playing realistic streams. No real API calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnthropicProvider, toAnthropicMessages } from "../src/providers/anthropic.ts";
import { createOpenAiProvider, toOpenAiMessages } from "../src/providers/openai-compatible.ts";
import { ProviderError, type Message, type Provider, type ProviderRequest, type StreamPart } from "../src/providers/types.ts";
import { anthropicEvents, hang, httpError, OPENAI_DONE, openaiChunk, openaiUsage, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";

const MODEL = { id: "m", providerId: "p", name: "M", model: "test-model", contextWindow: 100_000 };

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: MODEL,
    system: "Du er en test.",
    messages: [{ role: "user", content: [{ type: "text", text: "Hei" }] }],
    tools: [{ name: "read_file", description: "Les", parameters: { type: "object", properties: {} } }],
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(provider: Provider, req = request()): Promise<StreamPart[]> {
  const parts: StreamPart[] = [];
  for await (const part of provider.stream(req)) parts.push(part);
  return parts;
}

const textParts = (parts: StreamPart[], type: "text" | "thinking") =>
  parts.flatMap((p) => (p.type === type ? [p.text] : [])).join("");

function openai(llm: FakeLlm, stallMs?: number) {
  return createOpenAiProvider({ baseUrl: `${llm.url}/v1/`, apiKey: "sk-hemmelig", stallMs });
}

function anthropic(llm: FakeLlm, stallMs?: number) {
  return createAnthropicProvider({ baseUrl: llm.url, apiKey: "sk-ant-hemmelig", stallMs });
}

const OPENAI_STREAM =
  openaiChunk({ role: "assistant", content: "" }) +
  ": OPENROUTER PROCESSING\n\n" +
  openaiChunk({ reasoning: "Jeg tenker på " }) +
  openaiChunk({ reasoning_content: "æøå" }) +
  openaiChunk({ content: "Hei på deg 👋, " }) +
  openaiChunk({ content: "æøå!" }) +
  openaiChunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "read_file", arguments: "" } }] }) +
  openaiChunk({ tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] }) +
  openaiChunk({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "list_dir", arguments: '{"path":' } }] }) +
  openaiChunk({ tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] }) +
  openaiChunk({ tool_calls: [{ index: 1, function: { arguments: '"."}' } }] }) +
  openaiChunk({}, "tool_calls") +
  openaiUsage(120, 30, 100) +
  OPENAI_DONE;

for (const [label, size] of [["whole", Infinity], ["3-byte chunks", 3], ["1-byte chunks", 1]] as const) {
  test(`openai: text, reasoning, tool calls in pieces and usage (${label})`, async (t) => {
    const llm = await startFakeLlm(t);
    llm.reply(sse(OPENAI_STREAM, size));
    const parts = await collect(openai(llm));
    assert.equal(textParts(parts, "text"), "Hei på deg 👋, æøå!");
    assert.equal(textParts(parts, "thinking"), "Jeg tenker på æøå");
    assert.deepEqual(parts.filter((p) => p.type === "tool_call"), [
      { type: "tool_call", id: "call_a", name: "read_file", input: { path: "a.txt" }, parseError: undefined },
      { type: "tool_call", id: "call_b", name: "list_dir", input: { path: "." }, parseError: undefined },
    ]);
    assert.deepEqual(parts.find((p) => p.type === "usage"), { type: "usage", inputTokens: 120, outputTokens: 30, cachedInputTokens: 100 });
    assert.deepEqual(parts.at(-1), { type: "stop", reason: "tool_use" });
  });
}

test("openai: request shape, auth and tools", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(openaiChunk({ content: "ok" }, "stop") + OPENAI_DONE));
  await collect(openai(llm));
  const sent = llm.requests[0];
  assert.equal(sent.url, "/v1/chat/completions");
  assert.equal(sent.headers.authorization, "Bearer sk-hemmelig");
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.stream_options.include_usage, true);
  assert.equal(sent.body.model, "test-model");
  assert.deepEqual(sent.body.messages[0], { role: "system", content: "Du er en test." });
  assert.equal(sent.body.tools[0].function.name, "read_file");
});

test("openai: CRLF line ends and calls without an index, as some local servers send", async (t) => {
  const llm = await startFakeLlm(t);
  const body =
    (openaiChunk({ tool_calls: [{ id: "x1", function: { name: "read_file", arguments: '{"path":"a"}' } }] }) +
      openaiChunk({ tool_calls: [{ id: "x2", function: { name: "read_file", arguments: { path: "b" } } }] }) +
      openaiChunk({}, "stop") +
      OPENAI_DONE).replaceAll("\n", "\r\n");
  llm.reply(sse(body, 7));
  const parts = await collect(openai(llm));
  const calls = parts.filter((p) => p.type === "tool_call");
  assert.deepEqual(calls.map((c) => c.input), [{ path: "a" }, { path: "b" }]);
  assert.deepEqual(parts.at(-1), { type: "stop", reason: "tool_use" });
});

test("openai: malformed tool arguments are reported, not thrown", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(openaiChunk({ tool_calls: [{ index: 0, id: "c", function: { name: "read_file", arguments: '{"pa' } }] }) + openaiChunk({}, "tool_calls") + OPENAI_DONE));
  const call = (await collect(openai(llm))).find((p) => p.type === "tool_call");
  assert.match(call!.type === "tool_call" ? call!.parseError! : "", /JSON/);
});

test("openai: an error in the middle of the stream", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(openaiChunk({ content: "Hei" }) + `data: ${JSON.stringify({ error: { code: 502, message: "Upstream feilet" } })}\n\n`));
  await assert.rejects(() => collect(openai(llm)), (err: ProviderError) => {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.message, "Upstream feilet");
    assert.equal(err.retryable, true);
    return true;
  });
});

test("errors inside a stream are stripped of the key too", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(`data: ${JSON.stringify({ error: { code: 401, message: "Nøkkelen sk-hemmelig er ugyldig" } })}\n\n`));
  await assert.rejects(() => collect(openai(llm)), (err: Error) => err.message === "Nøkkelen [skjult] er ugyldig");
  llm.reply(sse(anthropicEvents([{ type: "error", error: { type: "authentication_error", message: "Feil: sk-ant-hemmelig" } }])));
  await assert.rejects(() => collect(anthropic(llm)), (err: Error) => err.message === "Feil: [skjult]");
});

test("openai: HTTP errors keep the provider's message and never the key", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(httpError(401, { error: { message: "Ugyldig nøkkel sk-hemmelig" } }));
  await assert.rejects(() => collect(openai(llm)), (err: ProviderError) => {
    assert.equal(err.status, 401);
    assert.equal(err.retryable, false);
    assert.match(err.message, /HTTP 401: Ugyldig nøkkel \[skjult\]/);
    assert.ok(!err.message.includes("sk-hemmelig"));
    return true;
  });
  llm.reply(httpError(429, { error: { message: "Vent" } }, { "retry-after": "7" }));
  await assert.rejects(() => collect(openai(llm)), (err: ProviderError) => {
    assert.equal(err.retryable, true);
    assert.equal(err.retryAfterMs, 7000);
    return true;
  });
});

test("openai: a dropped connection is an error, not a short answer", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(openaiChunk({ content: "Halv" }));
    setTimeout(() => res.destroy(), 10);
  });
  await assert.rejects(() => collect(openai(llm)), (err: ProviderError) => err.retryable === true && /brutt/.test(err.message));
  // A clean close without [DONE] or finish_reason is just as incomplete.
  llm.reply(sse(openaiChunk({ content: "Halv" })));
  await assert.rejects(() => collect(openai(llm)), /brutt/);
});

test("openai: a stalled stream times out", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(hang(openaiChunk({ content: "Hei" })));
  await assert.rejects(() => collect(openai(llm, 50)), /stoppet opp/);
});

test("openai: aborting stops the stream", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(hang(openaiChunk({ content: "Hei" })));
  const controller = new AbortController();
  const parts: StreamPart[] = [];
  await assert.rejects(async () => {
    for await (const part of openai(llm).stream(request({ signal: controller.signal }))) {
      parts.push(part);
      controller.abort();
    }
  }, (err: Error) => !(err instanceof ProviderError));
  assert.equal(textParts(parts, "text"), "Hei");
});

test("openai: history translates to tool messages in the right order", () => {
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "Les" }] },
    { role: "assistant", content: [
      { type: "thinking", text: "Hm", field: "reasoning_content" },
      { type: "text", text: "Ok" },
      { type: "tool_use", id: "a", name: "read_file", input: { path: "x" } },
      { type: "tool_use", id: "b", name: "read_file", input: { path: "y" } },
    ] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "a", content: "X" }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "b", content: "Y", image: { mime: "image/png", base64: "QQ==" } }] },
    { role: "user", content: [{ type: "text", text: "Takk" }] },
  ];
  const out = toOpenAiMessages("S", messages, true) as any[];
  assert.deepEqual(out.map((m) => m.role), ["system", "user", "assistant", "tool", "tool", "user"]);
  assert.equal(out[2].reasoning_content, "Hm");
  assert.equal(out[2].tool_calls[1].function.arguments, '{"path":"y"}');
  assert.equal(out[5].content[0].text, "Takk");
  assert.equal(out[5].content[1].image_url.url, "data:image/png;base64,QQ==");
  const textOnly = toOpenAiMessages("S", messages, false) as any[];
  assert.equal(typeof textOnly[5].content, "string", "no images unless the model takes them");
  assert.equal(textOnly[3].content, "X", "ordinary tool text is unchanged");
  assert.match(textOnly[4].content, /^Y\n\n\[Verktøyet laget et bilde/);
  assert.match(textOnly[4].content, /Bildet er ikke videresendt/);
  assert.equal(out[4].content, "Y", "image-capable models receive the image without the fallback note");
});

test("openai: connection test lists models", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply((req, res) => {
    assert.equal(req.url, "/v1/models");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }));
  });
  const result = await openai(llm).test(new AbortController().signal);
  assert.equal(result.ok, true);
  assert.match(result.message, /, 2 modeller$/);
});

const ANTHROPIC_STREAM = anthropicEvents([
  { type: "message_start", message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 1 } } },
  { type: "ping" },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Jeg ser på " } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "æøå" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig123" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "kryptert" } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Hei 👋 " } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "der" } },
  { type: "content_block_stop", index: 2 },
  { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} } },
  { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: "" } },
  { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"path":' } },
  { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '"a.txt"}' } },
  { type: "content_block_stop", index: 3 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } },
  { type: "message_stop" },
]);

for (const [label, size] of [["whole", Infinity], ["5-byte chunks", 5]] as const) {
  test(`anthropic: thinking, signature, redacted thinking, text and tool input in pieces (${label})`, async (t) => {
    const llm = await startFakeLlm(t);
    llm.reply(sse(ANTHROPIC_STREAM, size));
    const parts = await collect(anthropic(llm));
    assert.equal(textParts(parts, "thinking"), "Jeg ser på æøå");
    assert.equal(textParts(parts, "text"), "Hei 👋 der");
    assert.deepEqual(parts.find((p) => p.type === "thinking_signature"), { type: "thinking_signature", signature: "sig123" });
    assert.deepEqual(parts.find((p) => p.type === "redacted_thinking"), { type: "redacted_thinking", data: "kryptert" });
    assert.deepEqual(parts.find((p) => p.type === "tool_call"), { type: "tool_call", id: "toolu_1", name: "read_file", input: { path: "a.txt" }, parseError: undefined });
    assert.deepEqual(parts.find((p) => p.type === "usage"), { type: "usage", inputTokens: 125, outputTokens: 42, cachedInputTokens: 100 });
    assert.deepEqual(parts.at(-1), { type: "stop", reason: "tool_use", detail: undefined });
  });
}

test("anthropic: request shape, headers, adaptive thinking with summaries, and caching", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(anthropicEvents([{ type: "message_start", message: { usage: {} } }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }])));
  await collect(anthropic(llm), request({ model: { ...MODEL, effort: "high" } }));
  const sent = llm.requests[0];
  assert.equal(sent.url, "/v1/messages");
  assert.equal(sent.headers["x-api-key"], "sk-ant-hemmelig");
  assert.equal(sent.headers["anthropic-version"], "2023-06-01");
  assert.equal(sent.body.stream, true);
  assert.deepEqual(sent.body.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(sent.body.output_config, { effort: "high" });
  assert.equal(sent.body.system[0].text, "Du er en test.");
  assert.deepEqual(sent.body.system[0].cache_control, { type: "ephemeral" });
  assert.equal(sent.body.tools[0].input_schema.type, "object");
  assert.ok(sent.body.max_tokens > 0);
  assert.ok(sent.body.temperature === undefined, "sampling parameters are refused by current models");
});

test("anthropic: thinking can be turned off for models without it", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(anthropicEvents([{ type: "message_start", message: { usage: {} } }, { type: "message_stop" }])));
  await collect(anthropic(llm), request({ model: { ...MODEL, thinking: false } }));
  assert.equal(llm.requests[0].body.thinking, undefined);
});

test("anthropic: history keeps thinking unchanged and groups tool results", () => {
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "Les" }] },
    { role: "assistant", content: [
      { type: "thinking", text: "Hm", signature: "s1" },
      { type: "thinking", text: "Avkortet" },
      { type: "redacted_thinking", data: "r1" },
      { type: "text", text: "" },
      { type: "tool_use", id: "a", name: "read_file", input: { path: "x" } },
      { type: "tool_use", id: "b", name: "read_file", input: { path: "y" } },
    ] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "a", content: "X", isError: true }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "b", content: "Y", image: { mime: "image/png", base64: "QQ==" } }] },
    { role: "user", content: [{ type: "text", text: "Merknad" }] },
  ];
  const out = toAnthropicMessages(messages) as any[];
  assert.equal(out.length, 3);
  assert.deepEqual(out[1].content.map((b: any) => b.type), ["thinking", "redacted_thinking", "tool_use", "tool_use"]);
  assert.deepEqual(out[1].content[0], { type: "thinking", thinking: "Hm", signature: "s1" });
  assert.deepEqual(out[2].content.map((b: any) => b.type), ["tool_result", "tool_result", "text"]);
  assert.equal(out[2].content[0].is_error, true);
  assert.equal(out[2].content[1].content[1].source.data, "QQ==");
  assert.deepEqual(out[2].content[2].cache_control, { type: "ephemeral" });
});

test("anthropic: errors in the stream and stop reasons", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(anthropicEvents([{ type: "message_start", message: { usage: {} } }, { type: "error", error: { type: "overloaded_error", message: "Overbelastet" } }])));
  await assert.rejects(() => collect(anthropic(llm)), (err: ProviderError) => err.retryable && err.message === "Overbelastet");

  llm.reply(httpError(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens er for høy" } }));
  await assert.rejects(() => collect(anthropic(llm)), (err: ProviderError) => !err.retryable && err.status === 400 && /max_tokens/.test(err.message));

  llm.reply(sse(anthropicEvents([{ type: "message_start", message: { usage: {} } }, { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { explanation: "Avvist" } } }, { type: "message_stop" }])));
  assert.deepEqual((await collect(anthropic(llm))).at(-1), { type: "stop", reason: "refusal", detail: "Avvist" });

  llm.reply(sse(anthropicEvents([{ type: "message_start", message: { usage: {} } }, { type: "message_delta", delta: { stop_reason: "max_tokens" } }, { type: "message_stop" }])));
  assert.equal(((await collect(anthropic(llm))).at(-1) as any).reason, "max_tokens");
});

test("anthropic: a stream that ends early is an error", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply(sse(anthropicEvents([{ type: "message_start", message: { usage: {} } }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }])));
  await assert.rejects(() => collect(anthropic(llm)), /brutt/);
});

test("anthropic: a missing key is a clear error, before any request", async (t) => {
  const llm = await startFakeLlm(t);
  await assert.rejects(() => collect(createAnthropicProvider({ baseUrl: llm.url })), /Mangler API-nøkkel/);
  assert.equal(llm.requests.length, 0);
});

test("anthropic: connection test", async (t) => {
  const llm = await startFakeLlm(t);
  llm.reply((req, res) => {
    assert.equal(req.url, "/v1/models?limit=1");
    res.writeHead(200).end("{}");
  });
  assert.equal((await anthropic(llm).test(new AbortController().signal)).ok, true);
  llm.reply(httpError(401, { error: { message: "Nei" } }));
  await assert.rejects(() => anthropic(llm).test(new AbortController().signal), /401/);
});
