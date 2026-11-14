// OpenAI-style chat completions: OpenRouter, OpenAI, Ollama, LM Studio, Groq and others.
import { getJson, mergeRoles, parseToolInput, postSse, redact } from "./http.ts";
import { ProviderError, type Block, type Message, type Provider, type ProviderRequest, type StopReason, type StreamPart } from "./types.ts";
import { isOpenRouter, type WebSource } from "../../../shared/protocol.ts";

export interface OpenAiOptions {
  baseUrl: string;
  apiKey?: string;
  stallMs?: number;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

const REASONING_FIELDS = ["reasoning", "reasoning_content", "thinking"] as const;

export function toOpenAiMessages(system: string, messages: Message[], supportsImages: boolean): unknown[] {
  const out: unknown[] = system ? [{ role: "system", content: system }] : [];
  for (const message of mergeRoles(messages)) {
    if (message.role === "assistant") {
      const text = textOf(message.content);
      const calls = message.content.filter((b) => b.type === "tool_use");
      const thinking = message.content.find((b) => b.type === "thinking" && b.field);
      out.push({
        role: "assistant",
        content: text || null,
        ...(thinking?.type === "thinking" && thinking.field ? { [thinking.field]: thinking.text } : {}),
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
          : {}),
      });
      continue;
    }
    // Tool results must directly follow the assistant message, before any user text.
    const images: unknown[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const content = block.image && !supportsImages
        ? `${block.content}\n\n[Verktøyet laget et bilde, men modellen er ikke satt opp for bilder. Bildet er ikke videresendt; du har bare tekstdelen av resultatet.]`
        : block.content;
      out.push({ role: "tool", tool_call_id: block.toolUseId, content });
      if (block.image && supportsImages) {
        images.push({ type: "image_url", image_url: { url: `data:${block.image.mime};base64,${block.image.base64}` } });
      }
    }
    let text = textOf(message.content);
    for (const block of message.content) {
      if (block.type !== "image") continue;
      if (supportsImages) images.push({ type: "image_url", image_url: { url: `data:${block.image.mime};base64,${block.image.base64}` } });
      else text += `${text ? "\n\n" : ""}[Brukeren la ved bildet ${block.name ?? ""}, men modellen er ikke satt opp for bilder]`;
    }
    if (images.length) out.push({ role: "user", content: [{ type: "text", text: text || "Skjermbilde:" }, ...images] });
    else if (text) out.push({ role: "user", content: text });
  }
  return out;
}

function textOf(blocks: Block[]): string {
  return blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n\n");
}

function mapFinishReason(reason: string): StopReason {
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "refusal";
  return "end";
}

export function createOpenAiProvider(options: OpenAiOptions): Provider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const auth: Record<string, string> = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};

  async function* stream(request: ProviderRequest): AsyncGenerator<StreamPart> {
    const { model } = request;
    const body = {
      model: model.model,
      messages: toOpenAiMessages(request.system, request.messages, model.supportsImages === true),
      stream: true,
      stream_options: { include_usage: true },
      ...(request.tools.length
        ? { tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
      ...(model.maxOutputTokens ? { max_tokens: model.maxOutputTokens } : {}),
      // Round 13 (SPEC 27.2): the provider's own web search, for models that have it.
      ...(request.webSearch ? { web_search_options: {} } : {}),
      ...reasoningOptions(baseUrl, model.effort),
    };

    const calls = new Map<number, PendingCall>();
    let lastIndex = -1;
    let finish: string | undefined;
    let done = false;
    let usage: Extract<StreamPart, { type: "usage" }> | undefined;
    const cited = new Map<string, WebSource>(); // url_citation annotations, the sources of a web search

    for await (const message of postSse(`${baseUrl}/chat/completions`, {
      headers: auth,
      body,
      signal: request.signal,
      secret: options.apiKey,
      stallMs: options.stallMs,
    })) {
      if (message.data.trim() === "[DONE]") {
        done = true;
        break;
      }
      let chunk: any;
      try {
        chunk = JSON.parse(message.data);
      } catch {
        continue; // Some gateways send keep-alive noise.
      }
      if (chunk.error) {
        const status = Number(chunk.error.code);
        throw new ProviderError(redact(String(chunk.error.message ?? "Feil fra leverandøren"), options.apiKey), {
          status: Number.isFinite(status) ? status : undefined,
          retryable: status === 429 || status >= 500,
        });
      }
      if (chunk.usage) {
        const u = chunk.usage;
        usage = {
          type: "usage",
          inputTokens: u.prompt_tokens ?? 0,
          outputTokens: u.completion_tokens ?? 0,
          cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? choice.message ?? {};

      for (const field of REASONING_FIELDS) {
        const text = delta[field];
        if (typeof text === "string" && text) yield { type: "thinking", text, ...(field === "reasoning_content" ? { field } : {}) };
      }
      for (const detail of delta.reasoning_details ?? []) {
        // OpenRouter sends both `reasoning` and `reasoning_details`; only use the latter on its own.
        if (typeof detail?.text === "string" && detail.text && !delta.reasoning) yield { type: "thinking", text: detail.text };
      }
      if (typeof delta.content === "string" && delta.content) yield { type: "text", text: delta.content };
      for (const note of Array.isArray(delta.annotations) ? delta.annotations : []) {
        const citation = note?.type === "url_citation" ? (note.url_citation ?? note) : null;
        if (typeof citation?.url === "string" && /^https?:/.test(citation.url) && !cited.has(citation.url)) {
          cited.set(citation.url, { title: String(citation.title || citation.url).slice(0, 160), url: citation.url });
        }
      }

      for (const part of delta.tool_calls ?? []) {
        let index: number = part.index ?? -1;
        if (index === -1) {
          // No index: match on id, a new id starts a new call, otherwise continue the last one.
          const known = [...calls].find(([, call]) => part.id && call.id === part.id);
          index = known ? known[0] : part.id || lastIndex === -1 ? lastIndex + 1 : lastIndex;
        }
        lastIndex = Math.max(lastIndex, index);
        const call = calls.get(index) ?? { id: "", name: "", args: "" };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name = part.function.name;
        if (part.function?.arguments) {
          const args = part.function.arguments;
          call.args += typeof args === "string" ? args : JSON.stringify(args);
        }
        calls.set(index, call);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    if (!done && !finish) throw new ProviderError("Strømmen ble brutt før svaret var ferdig", { retryable: true });
    // The search itself is not announced in the stream, only the sources it gave.
    if (cited.size) {
      yield { type: "web_search", id: "web_search_1", query: "" };
      yield { type: "web_results", id: "web_search_1", sources: [...cited.values()] };
    }

    for (const [index, call] of [...calls].sort(([a], [b]) => a - b)) {
      const { input, parseError } = parseToolInput(call.args);
      yield { type: "tool_call", id: call.id || `call_${index}`, name: call.name, input, parseError };
    }
    if (usage) yield usage;
    yield { type: "stop", reason: calls.size && (!finish || finish === "stop") ? "tool_use" : mapFinishReason(finish ?? "stop") };
  }

  return {
    stream,
    async test(signal) {
      const list = (await getJson(`${baseUrl}/models`, auth, signal, options.apiKey)) as { data?: unknown[] };
      const count = Array.isArray(list?.data) ? list.data.length : 0;
      return { ok: true, message: count ? `Tilkoblingen virker, ${count} modeller` : "Tilkoblingen virker" };
    },
  };
}

export function reasoningOptions(baseUrl: string, effort: ProviderRequest["model"]["effort"]): object {
  if (!effort) return {};
  if (isOpenRouter(baseUrl)) return { reasoning: { effort } };
  return effort === "none" ? {} : { reasoning_effort: effort === "xhigh" || effort === "max" ? "high" : effort };
}
