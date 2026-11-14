// Providers you can add with only an API key, and how their model lists are read. Base URLs and
// list formats were checked against each provider's own documentation on 2026-11-03 and
// 2026-11-04, from the docs pages only: no real API was called. `checked: false` marks what could not be confirmed.
import type { ListedModel, ProviderKind, ProviderPreset } from "../../../shared/protocol.ts";
import { getJson } from "./http.ts";
import { ProviderError } from "./types.ts";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // OpenRouter's authenticated connection/model list was confirmed by the user on 2026-11-14
  // (436 models). Other presets retain beta until their real-service access is confirmed.
  // https://openrouter.ai/docs/api-reference/models/get-models
  { id: "openrouter", name: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", keyRequired: true, docsUrl: "https://openrouter.ai/docs", checked: true, beta: false, note: "Mange modeller fra ulike leverandører med én nøkkel" },
  // https://docs.abliteration.ai/api/introduction (checked 2026-11-04): base https://api.abliteration.ai/v1,
  // "Authorization: Bearer", OpenAI surface with /v1/chat/completions and /v1/models. The page does
  // not say which fields /v1/models returns, so the context size comes from the table or the default.
  { id: "abliteration", name: "abliteration.ai", kind: "openai-compatible", baseUrl: "https://api.abliteration.ai/v1", apiKeyEnv: "ABLITERATION_API_KEY", keyRequired: true, docsUrl: "https://docs.abliteration.ai/api/introduction", checked: true, beta: true, note: "OpenAI-kompatibelt API for modellene deres" },
  // https://platform.claude.com/docs/en/api/models/list. The Anthropic provider adds /v1 itself.
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", keyRequired: true, docsUrl: "https://platform.claude.com/docs/en/api/overview", checked: true, beta: true, note: "Direkte tilgang til modellene fra Anthropic" },
  // https://developers.openai.com/api/reference/resources/models/methods/list
  { id: "openai", name: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", keyRequired: true, docsUrl: "https://developers.openai.com/api/docs/models", checked: true, beta: true, note: "Direkte tilgang til modellene fra OpenAI" },
  { id: "custom", name: "Egendefinert", kind: "openai-compatible", baseUrl: "", keyRequired: false, checked: false, note: "Alle tjenester med et OpenAI-kompatibelt API" },
];

// Context windows from the providers' model pages, used when the model list has no size.
// Checked 2026-11-03 except where marked. Prefix matches, longest first.
const CONTEXT_TABLE: Array<[string, number]> = [
  ["gpt-6", 1_050_000], // OpenAI flagships
  ["claude-", 1_000_000], // current Claude 5.5 family; older models are smaller (unverified)
  ["gemini-3", 1_048_576],
  ["gemini-4", 1_000_000],
  ["deepseek-flash", 1_048_576],
  ["deepseek-v4", 1_048_576],
  ["grok-4.20", 1_000_000],
  ["grok-4.3", 1_000_000],
  ["grok-4.5", 500_000],
  ["grok-4.6", 500_000],
  ["grok-4.7", 500_000],
  ["grok-build", 256_000],
  ["mistral-large-4", 1_000_000], // ID from the changelog, unverified on the model card
  ["llama-3.1-8b-instant", 131_072],
  ["llama-3.3-70b-versatile", 131_072],
  ["openai/gpt-oss", 131_072],
  ["minimaxai/minimax-m2.7", 196_608],
];

export const DEFAULT_CONTEXT_WINDOW = 128_000;

export function tableContext(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  let best: [string, number] | undefined;
  for (const entry of CONTEXT_TABLE) {
    if ((id.startsWith(entry[0]) || id.includes(`/${entry[0]}`)) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1];
}

// The fields the providers use for the context size: OpenRouter and xAI context_length, Groq and
// DeepSeek context_window, Mistral and LM Studio max_context_length, Anthropic max_input_tokens,
// Gemini's native API inputTokenLimit.
function contextFrom(item: any): number | undefined {
  const candidates = [item?.context_length, item?.context_window, item?.max_context_length, item?.max_input_tokens, item?.inputTokenLimit, item?.top_provider?.context_length];
  const found = candidates.find((value) => typeof value === "number" && Number.isFinite(value) && value >= 1000);
  return found;
}

export function parseModelList(body: unknown): ListedModel[] {
  const items = Array.isArray((body as any)?.data) ? (body as any).data : Array.isArray((body as any)?.models) ? (body as any).models : Array.isArray(body) ? body : null;
  if (!items) throw new ProviderError("Svaret fra /models hadde ingen liste over modeller");
  const out: ListedModel[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = typeof item === "string" ? item : typeof item?.id === "string" ? item.id : typeof item?.name === "string" ? item.name.replace(/^models\//, "") : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const fromApi = contextFrom(item);
    const fromTable = fromApi ? undefined : tableContext(id);
    out.push({
      id,
      name: (typeof item?.display_name === "string" && item.display_name) || (typeof item?.name === "string" && item.name !== id && !item.name.startsWith("models/") ? item.name : id),
      contextWindow: fromApi ?? fromTable ?? DEFAULT_CONTEXT_WINDOW,
      contextSource: fromApi ? "api" : fromTable ? "table" : "default",
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Reads the provider's model list with the stored key. The key never leaves the server, and
// errors are redacted by getJson.
export async function fetchModelList(
  provider: { kind: ProviderKind; baseUrl?: string },
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<ListedModel[]> {
  if (provider.kind === "mock") {
    return [{ id: "mock", name: "Demo-modell (uten API)", contextWindow: 200_000, contextSource: "table" }];
  }
  if (provider.kind === "anthropic") {
    if (!apiKey) throw new ProviderError("Mangler API-nøkkel for Anthropic");
    const base = (provider.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    const body = await getJson(`${base}/v1/models?limit=1000`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, signal, apiKey);
    return parseModelList(body);
  }
  if (!provider.baseUrl) throw new ProviderError("Leverandøren mangler baseUrl");
  const base = provider.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  return parseModelList(await getJson(`${base}/models`, headers, signal, apiKey));
}
