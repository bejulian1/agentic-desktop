// Anthropic Messages API over raw fetch, sharing the SSE parser with the OpenAI provider so the
// app needs no SDK per vendor. Thinking blocks are passed back unchanged, with their signatures.
import { getJson, mergeRoles, parseToolInput, postSse, redact } from "./http.ts";
import { ProviderError, type Block, type Message, type Provider, type ProviderRequest, type StopReason, type StreamPart } from "./types.ts";
import type { WebSource } from "../../../shared/protocol.ts";

export interface AnthropicOptions {
  baseUrl?: string;
  apiKey?: string;
  stallMs?: number;
}

const API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 64_000;

export function toAnthropicMessages(messages: Message[]): unknown[] {
  const merged = mergeRoles(messages.map((m) => ({ role: m.role, content: m.content.flatMap(toAnthropicBlock) as any[] })));
  // Tool results must come first in a user message.
  for (const message of merged) {
    if (message.role === "user") message.content.sort((a, b) => Number(b.type === "tool_result") - Number(a.type === "tool_result"));
  }
  const lastBlock = merged.at(-1)?.content.at(-1);
  if (lastBlock) lastBlock.cache_control = { type: "ephemeral" };
  return merged;
}

function toAnthropicBlock(block: Block): unknown[] {
  switch (block.type) {
    case "text":
      return block.text ? [{ type: "text", text: block.text }] : [];
    case "thinking":
      // Without a signature it was cut off mid-stream, and the API would refuse it.
      return block.signature ? [{ type: "thinking", thinking: block.text, signature: block.signature }] : [];
    case "redacted_thinking":
      return [{ type: "redacted_thinking", data: block.data }];
    case "tool_use":
      return [{ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} }];
    case "image":
      return [{ type: "image", source: { type: "base64", media_type: block.image.mime, data: block.image.base64 } }];
    case "provider":
      return block.provider === "anthropic" ? [block.data] : [];
    case "tool_result":
      return [{
        type: "tool_result",
        tool_use_id: block.toolUseId,
        is_error: block.isError ?? false,
        content: block.image
          ? [{ type: "text", text: block.content }, { type: "image", source: { type: "base64", media_type: block.image.mime, data: block.image.base64 } }]
          : block.content,
      }];
  }
}

function mapStopReason(reason: string | undefined): StopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "refusal") return "refusal";
  if (reason === "pause_turn") return "pause";
  return "end";
}

// Round 13 (SPEC 27.2): Anthropic's own web search, a tool that runs on their side.
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

function webResults(block: any): { sources: WebSource[]; error?: string } {
  if (!Array.isArray(block?.content)) {
    return { sources: [], error: `Nettsøket feilet${block?.content?.error_code ? ` (${block.content.error_code})` : ""}` };
  }
  const sources = block.content
    .filter((r: any) => r?.type === "web_search_result" && typeof r.url === "string")
    .map((r: any): WebSource => ({ title: String(r.title || r.url).slice(0, 160), url: r.url }));
  return { sources };
}

export function createAnthropicProvider(options: AnthropicOptions): Provider {
  const baseUrl = (options.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const headers = (): Record<string, string> => {
    if (!options.apiKey) throw new ProviderError("Mangler API-nøkkel for Anthropic");
    return { "x-api-key": options.apiKey, "anthropic-version": API_VERSION };
  };

  async function* stream(request: ProviderRequest): AsyncGenerator<StreamPart> {
    const { model } = request;
    const body = {
      model: model.model,
      max_tokens: model.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: toAnthropicMessages(request.messages),
      ...(request.tools.length || request.webSearch
        ? { tools: [...request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })), ...(request.webSearch ? [WEB_SEARCH_TOOL] : [])] }
        : {}),
      // effort "none" (round 9, Ingen in the slider): no thinking, and no effort sent.
      ...(model.thinking === false || model.effort === "none" ? {} : { thinking: { type: "adaptive", display: "summarized" } }),
      ...(model.effort && model.effort !== "none" ? { output_config: { effort: model.effort } } : {}),
    };

    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string; raw?: unknown }>();
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | undefined;
    let stopDetail: string | undefined;
    let finished = false;

    for await (const message of postSse(`${baseUrl}/v1/messages`, {
      headers: headers(),
      body,
      signal: request.signal,
      secret: options.apiKey,
      stallMs: options.stallMs,
    })) {
      let event: any;
      try {
        event = JSON.parse(message.data);
      } catch {
        continue;
      }
      switch (event.type) {
        case "message_start": {
          const u = event.message?.usage ?? {};
          cachedInputTokens = u.cache_read_input_tokens ?? 0;
          // input_tokens excludes the cached part here, while Usage.inputTokens includes it.
          inputTokens = (u.input_tokens ?? 0) + cachedInputTokens + (u.cache_creation_input_tokens ?? 0);
          outputTokens = u.output_tokens ?? 0;
          break;
        }
        case "content_block_start": {
          const block = event.content_block;
          blocks.set(event.index, { type: block.type, id: block.id, name: block.name, json: "", ...(block.type === "web_search_tool_result" ? { raw: block } : {}) });
          if (block.type === "redacted_thinking") yield { type: "redacted_thinking", data: block.data };
          if (block.type === "text" && block.text) yield { type: "text", text: block.text };
          if (block.type === "thinking" && block.thinking) yield { type: "thinking", text: block.thinking };
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") yield { type: "text", text: delta.text };
          else if (delta.type === "thinking_delta") yield { type: "thinking", text: delta.thinking };
          else if (delta.type === "signature_delta") yield { type: "thinking_signature", signature: delta.signature };
          else if (delta.type === "input_json_delta") {
            const block = blocks.get(event.index);
            if (block) block.json += delta.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          const block = blocks.get(event.index);
          if (block?.type === "tool_use") {
            const { input, parseError } = parseToolInput(block.json);
            yield { type: "tool_call", id: block.id!, name: block.name!, input, parseError };
          } else if (block?.type === "server_tool_use") {
            const { input } = parseToolInput(block.json);
            yield { type: "provider_block", provider: "anthropic", data: { type: "server_tool_use", id: block.id, name: block.name, input } };
            if (block.name === "web_search") yield { type: "web_search", id: block.id!, query: String((input as any)?.query ?? "") };
          } else if (block?.type === "web_search_tool_result") {
            const raw = block.raw as any;
            yield { type: "provider_block", provider: "anthropic", data: raw };
            yield { type: "web_results", id: String(raw.tool_use_id), ...webResults(raw) };
          }
          break;
        }
        case "message_delta": {
          stopReason = event.delta?.stop_reason ?? stopReason;
          stopDetail = event.delta?.stop_details?.explanation ?? stopDetail;
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          break;
        }
        case "message_stop":
          finished = true;
          break;
        case "error": {
          const type: string = event.error?.type ?? "";
          throw new ProviderError(redact(String(event.error?.message ?? "Feil fra Anthropic"), options.apiKey), {
            retryable: type === "overloaded_error" || type === "rate_limit_error" || type === "api_error",
          });
        }
      }
      if (finished) break;
    }
    if (!finished) throw new ProviderError("Strømmen ble brutt før svaret var ferdig", { retryable: true });
    yield { type: "usage", inputTokens, outputTokens, cachedInputTokens };
    yield { type: "stop", reason: mapStopReason(stopReason), detail: stopDetail };
  }

  return {
    stream,
    async test(signal) {
      await getJson(`${baseUrl}/v1/models?limit=1`, headers(), signal, options.apiKey);
      return { ok: true, message: "Tilkoblingen virker" };
    },
  };
}
