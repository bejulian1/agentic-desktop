// OpenAI-style chat completions: OpenRouter, OpenAI, Ollama, LM Studio, Groq and others.
import { randomUUID } from "node:crypto";
import { getJson, mergeRoles, normalizeProviderBaseUrl, parseToolInput, postSse, redact, redactModelValue, reflectsKey, withoutToolHistory, type PostOptions, type SseMessage } from "./http.ts";
import { fetchLocalModels, localCatalogStatus } from "./local.ts";
import { compatibleAuthHeaders, parseModelList } from "./presets.ts";
import { ProviderError, type Block, type Message, type Provider, type ProviderRequest, type StopReason, type StreamPart } from "./types.ts";
import { isOpenRouter, modelAllowsTools, type LocalProviderKind, type ProviderPreset, type WebSource } from "../../../shared/protocol.ts";

export interface OpenAiOptions {
  baseUrl: string;
  apiKey?: string;
  localKind?: LocalProviderKind;
  authHeader?: ProviderPreset["authHeader"];
  stallMs?: number;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
  geminiThoughtSignature?: string;
}

const REASONING_FIELDS = ["reasoning", "reasoning_content", "thinking"] as const;

export function toOpenAiMessages(system: string, messages: Message[], supportsImages: boolean, gemini = false, localKind?: LocalProviderKind): unknown[] {
  const out: unknown[] = system ? [{ role: "system", content: system }] : [];
  for (const message of mergeRoles(messages)) {
    if (message.role === "assistant") {
      const text = textOf(message.content);
      const calls = message.content.filter((b) => b.type === "tool_use");
      if (localKind && !text && !calls.length) continue;
      const thinking = message.content.find((b) => b.type === "thinking" && b.field === (localKind ? "ollama_reasoning" : "reasoning_content"));
      const replay = localKind === "ollama" ? "reasoning" : localKind ? undefined : "reasoning_content";
      out.push({
        role: "assistant",
        content: text || (localKind ? "" : null),
        ...(thinking?.type === "thinking" && replay ? { [replay]: thinking.text } : {}),
        ...(calls.length
          ? { tool_calls: calls.map((call) => ({
            id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
            ...(gemini && call.geminiThoughtSignature
              ? { extra_content: { google: { thought_signature: call.geminiThoughtSignature } } }
              : {}),
          })) }
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
  const baseUrl = normalizeProviderBaseUrl(options.baseUrl);
  const { apiKey, localKind } = options;
  const auth = compatibleAuthHeaders(options.apiKey, options.authHeader);
  const hostname = new URL(baseUrl).hostname;
  const gemini = hostname === "generativelanguage.googleapis.com";
  const tokenLimitField = options.authHeader === "api-key" || hostname === "api.openai.com" ? "max_completion_tokens" : "max_tokens";

  async function* stream(request: ProviderRequest): AsyncGenerator<StreamPart> {
    const { model } = request;
    const toolsEnabled = modelAllowsTools(model, localKind);
    const tools = toolsEnabled ? request.tools : [];
    const allowToolCalls = toolsEnabled && (!localKind || tools.length > 0);
    const messages = allowToolCalls ? request.messages : withoutToolHistory(request.messages);
    const body = {
      model: model.model,
      messages: toOpenAiMessages(request.system, messages, model.supportsImages === true, gemini, localKind),
      stream: true,
      ...(tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
      ...(model.maxOutputTokens ? { [tokenLimitField]: model.maxOutputTokens } : {}),
      // Round 13 (SPEC 27.2): the provider's own web search, for models that have it.
      ...(!localKind && toolsEnabled && request.webSearch ? { web_search_options: {} } : {}),
      ...reasoningOptions(baseUrl, model.effort),
    };

    const calls = new Map<number, PendingCall>();
    let lastIndex = -1;
    let finish: string | undefined;
    let done = false;
    let hasText = false;
    let unsolicitedTool = false;
    let usage: Extract<StreamPart, { type: "usage" }> | undefined;
    const cited = new Map<string, WebSource>(); // url_citation annotations, the sources of a web search

    for await (const message of postChatStream(`${baseUrl}/chat/completions`, body, {
      headers: auth,
      signal: request.signal,
      secret: options.apiKey,
      stallMs: options.stallMs,
    }, !localKind || localKind === "ollama")) {
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
      if (chunk?.error) {
        const status = Number(chunk.error.code);
        const error = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
        throw new ProviderError(redact(String(error ?? "Feil fra leverandøren"), apiKey), {
          status: Number.isFinite(status) ? status : undefined,
          retryable: status === 429 || status >= 500,
        });
      }
      if (chunk?.usage) {
        const u = chunk.usage;
        usage = {
          type: "usage",
          inputTokens: u.prompt_tokens ?? 0,
          outputTokens: u.completion_tokens ?? 0,
          cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
        };
      }
      const choice = chunk?.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? choice.message ?? {};

      for (const field of REASONING_FIELDS) {
        const text = delta[field];
        const replay = localKind === "ollama" && field === "reasoning" ? "ollama_reasoning" : !localKind && field === "reasoning_content" ? field : undefined;
        if (typeof text === "string" && text) yield { type: "thinking", text: redactModelValue(text, apiKey), ...(replay ? { field: replay } : {}) };
      }
      for (const detail of Array.isArray(delta.reasoning_details) ? delta.reasoning_details : []) {
        // OpenRouter sends both `reasoning` and `reasoning_details`; only use the latter on its own.
        if (typeof detail?.text === "string" && detail.text && !delta.reasoning) yield { type: "thinking", text: redactModelValue(detail.text, apiKey) };
      }
      if (typeof delta.content === "string" && delta.content) {
        hasText ||= !!delta.content.trim();
        yield { type: "text", text: redactModelValue(delta.content, apiKey) };
      }
      for (const note of !localKind && Array.isArray(delta.annotations) ? delta.annotations : []) {
        const citation = note?.type === "url_citation" ? (note.url_citation ?? note) : null;
        if (typeof citation?.url === "string" && /^https?:/.test(citation.url) && !reflectsKey(citation.url, apiKey) && !cited.has(citation.url)) {
          cited.set(citation.url, { title: redactModelValue(String(citation.title || citation.url), apiKey).slice(0, 160), url: citation.url });
        }
      }

      if (choice.finish_reason) finish = choice.finish_reason;
      const parts = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      if (!allowToolCalls) {
        unsolicitedTool ||= parts.length > 0 || !!delta.function_call;
        continue;
      }
      for (const [position, part] of parts.entries()) {
        if (!part || typeof part !== "object") continue;
        let index: number = part.index ?? -1;
        if (index === -1) {
          // No index: match on id, a new id starts a new call, otherwise continue the last one.
          const known = [...calls].find(([, call]) => part.id && call.id === part.id);
          index = known ? known[0] : part.id ? lastIndex + 1 : parts.length > 1 ? position : Math.max(lastIndex, 0);
        }
        lastIndex = Math.max(lastIndex, index);
        const call = calls.get(index) ?? { id: "", name: "", args: "" };
        if (typeof part.id === "string" && part.id) call.id = part.id;
        if (typeof part.function?.name === "string" && part.function.name) call.name = part.function.name;
        if (part.function?.arguments) {
          const args = part.function.arguments;
          call.args += typeof args === "string" ? args : JSON.stringify(args);
        }
        // Gemini requires the opaque signature from a tool call to be replayed with that call.
        const signature = part.extra_content?.google?.thought_signature;
        if (gemini && typeof signature === "string" && signature) call.geminiThoughtSignature = signature;
        calls.set(index, call);
      }
    }

    if (!done && !finish) throw new ProviderError("Strømmen ble brutt før svaret var ferdig", { retryable: true });
    if (!allowToolCalls && (unsolicitedTool || mapFinishReason(finish ?? "") === "tool_use")) {
      if (!hasText) throw new ProviderError("Modellen svarte med et verktøykall, men denne turen hadde ingen tilgjengelige verktøy.");
      if (mapFinishReason(finish ?? "") === "tool_use") finish = "stop";
    }
    // The search itself is not announced in the stream, only the sources it gave.
    if (cited.size) {
      yield { type: "web_search", id: "web_search_1", query: "" };
      yield { type: "web_results", id: "web_search_1", sources: [...cited.values()] };
    }

    for (const [index, call] of [...calls].sort(([a], [b]) => a - b)) {
      if ([call.args, call.name, call.id, call.geminiThoughtSignature].some((value) => reflectsKey(value, apiKey))) {
        throw new ProviderError("Leverandøren returnerte API-nøkkelen i et verktøykall. Kallet ble avvist.");
      }
      const { input, parseError } = parseToolInput(call.args);
      yield {
        type: "tool_call", id: call.id || (localKind ? `call_${randomUUID().replaceAll("-", "")}` : `call_${index}`), name: call.name, input, parseError,
        ...(call.geminiThoughtSignature ? { geminiThoughtSignature: call.geminiThoughtSignature } : {}),
      };
    }
    if (usage) yield usage;
    yield { type: "stop", reason: calls.size && (!finish || finish === "stop") ? "tool_use" : mapFinishReason(finish ?? "stop") };
  }

  return {
    stream,
    async test(signal) {
      if (localKind) return localCatalogStatus(await fetchLocalModels(localKind, baseUrl, apiKey, signal));
      const models = parseModelList(await getJson(`${baseUrl}/models`, auth, signal, options.apiKey));
      const count = models.length === 1 ? "1 modell" : `${models.length} modeller`;
      return { ok: true, message: `Modellisten svarte, ${count}` };
    },
  };
}

async function* postChatStream(url: string, body: Record<string, unknown>, options: Omit<PostOptions, "body">, includeUsage: boolean): AsyncGenerator<SseMessage> {
  if (!includeUsage) {
    yield* postSse(url, { ...options, body });
    return;
  }
  try {
    yield* postSse(url, { ...options, body: { ...body, stream_options: { include_usage: true } } });
    return;
  } catch (err) {
    // Some compatible endpoints reject optional usage reporting during request validation.
    // Only HTTP validation errors from postSse qualify, before any model output has streamed.
    if (!(err instanceof ProviderError) || (err.status !== 400 && err.status !== 422) ||
        !/stream_options/i.test(err.message) ||
        !/unknown|unrecognized|unexpected|unsupported|not supported|not allowed|extra|invalid|forbidden/i.test(err.message)) throw err;
  }
  yield* postSse(url, { ...options, body });
}

export function reasoningOptions(baseUrl: string, effort: ProviderRequest["model"]["effort"]): object {
  if (!effort) return {};
  if (isOpenRouter(baseUrl)) return { reasoning: { effort } };
  return effort === "none" ? {} : { reasoning_effort: effort === "xhigh" || effort === "max" ? "high" : effort };
}
