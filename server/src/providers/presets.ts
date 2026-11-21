import { sourceText } from "../../../shared/i18n.ts";
// Provider presets and model discovery. The catalogue links to the vendors' own setup
// documentation. Compatibility depends on the endpoint and model selected by the user.
import type { DetectedLocalProvider, ListedModel, LocalProviderKind, ProviderKind, ProviderPreset } from "../../../shared/protocol.ts";
import { ADDITIONAL_PROVIDER_PRESETS } from "./catalog.ts";
import { getJson, normalizeProviderBaseUrl, redactModelValue, reflectsKey } from "./http.ts";
import { fetchLocalModels, probeLocalModels } from "./local.ts";
import { ProviderError } from "./types.ts";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // The user confirmed live OpenRouter (436 models) and abliteration.ai connections on
  // 2026-11-14 and requested removing provider Beta labels. This is not evidence of live
  // OpenAI/Anthropic testing; connection checks remain available for each saved provider.
  // https://openrouter.ai/docs/api-reference/models/get-models
  { id: "openrouter", name: "OpenRouter", kind: "openai-compatible", category: "gateway", modelDiscovery: "auto", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", keyRequired: true, docsUrl: "https://openrouter.ai/docs", checked: true, beta: false, note: sourceText("Mange modeller fra ulike leverandører med én nøkkel") },
  // https://docs.abliteration.ai/api/introduction (checked 2026-11-04): base https://api.abliteration.ai/v1,
  // "Authorization: Bearer", OpenAI surface with /v1/chat/completions and /v1/models. The page does
  // not say which fields /v1/models returns, so the context size comes from the table or the default.
  { id: "abliteration", name: "abliteration.ai", kind: "openai-compatible", category: "cloud", modelDiscovery: "auto", baseUrl: "https://api.abliteration.ai/v1", apiKeyEnv: "ABLITERATION_API_KEY", keyRequired: true, docsUrl: "https://docs.abliteration.ai/api/introduction", checked: true, beta: false, note: sourceText("Direkte tilgang til modellene fra abliteration.ai") },
  // https://platform.claude.com/docs/en/api/models/list. The Anthropic provider adds /v1 itself.
  { id: "anthropic", name: "Anthropic", kind: "anthropic", category: "cloud", modelDiscovery: "auto", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", keyRequired: true, docsUrl: "https://platform.claude.com/docs/en/api/overview", checked: true, beta: false, note: sourceText("Direkte tilgang til modellene fra Anthropic") },
  // https://developers.openai.com/api/reference/resources/models/methods/list
  { id: "openai", name: "OpenAI", kind: "openai-compatible", category: "cloud", modelDiscovery: "auto", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", keyRequired: true, docsUrl: "https://developers.openai.com/api/docs/models", checked: true, beta: false, note: sourceText("Direkte tilgang til modellene fra OpenAI") },
  { id: "azure-openai", name: "Azure OpenAI", kind: "openai-compatible", category: "cloud", modelDiscovery: "manual", authHeader: "api-key", baseUrl: "", keyRequired: true, docsUrl: "https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle", checked: true, note: sourceText("Bruk ressursens adresse med /openai/v1 og modellens deployment-navn.") },
  ...ADDITIONAL_PROVIDER_PRESETS,
  { id: "custom", name: "Egendefinert", kind: "openai-compatible", baseUrl: "", keyRequired: false, checked: false, note: sourceText("Alle tjenester med et OpenAI-kompatibelt API") },
];

const CUSTOM_LOCAL_PRESET: ProviderPreset = {
  id: "custom-local", name: "Egen lokal modellserver", kind: "openai-compatible", category: "local",
  baseUrl: "", keyRequired: false, modelDiscovery: "auto", checked: false,
};

export function providerPreset(id: unknown): ProviderPreset | undefined {
  return id === CUSTOM_LOCAL_PRESET.id ? CUSTOM_LOCAL_PRESET : PROVIDER_PRESETS.find((preset) => preset.id === id);
}

type ProviderAddress = { kind: ProviderKind; baseUrl?: string; presetId?: string };

export function localKindFor(provider: ProviderAddress): LocalProviderKind | undefined {
  if (provider.kind !== "openai-compatible") return;
  const preset = provider.presetId ? providerPreset(provider.presetId) : legacyLocalPreset(provider.baseUrl);
  if (preset?.category !== "local") return;
  if (preset.id === "ollama") return "ollama";
  if (preset.id === "lm-studio") return "lmstudio";
  return "openai-compatible";
}

function legacyLocalPreset(baseUrl?: string): ProviderPreset | undefined {
  try {
    if (!baseUrl) return;
    const url = new URL(baseUrl);
    if (url.hostname === "localhost" || url.hostname === "[::1]") url.hostname = "127.0.0.1";
    const address = url.href.replace(/\/+$/, "");
    const matches = PROVIDER_PRESETS.filter((preset) => preset.category === "local" && preset.baseUrl === address);
    return matches.length === 1 ? matches[0] : undefined;
  } catch {
    return undefined;
  }
}

export async function detectLocalProviders(probe = probeLocalModels): Promise<DetectedLocalProvider[]> {
  const detected = await Promise.all(["ollama", "lm-studio", "llama-cpp", "vllm"].map(async (presetId) => {
    const preset = providerPreset(presetId)!;
    const kind = localKindFor({ ...preset, presetId })!;
    try {
      return { presetId, modelCount: await probe(kind, preset.baseUrl, AbortSignal.timeout(1_500)) };
    } catch {
      return null;
    }
  }));
  return detected.flatMap((match) => match ? [match] : []);
}

export function compatibleAuthHeaders(apiKey?: string, header?: ProviderPreset["authHeader"]): Record<string, string> {
  if (!apiKey) return {};
  return header === "api-key" ? { "api-key": apiKey } : { authorization: `Bearer ${apiKey}` };
}

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
  provider: ProviderAddress,
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<ListedModel[]> {
  const localKind = localKindFor(provider);
  if (localKind && provider.baseUrl) return fetchLocalModels(localKind, provider.baseUrl, apiKey, signal);
  if (provider.kind === "mock") {
    return [{ id: "mock", name: "Demo-modell (uten API)", contextWindow: 200_000, contextSource: "table" }];
  }
  if (provider.kind === "anthropic") {
    if (!apiKey) throw new ProviderError("Mangler API-nøkkel for Anthropic");
    const base = normalizeProviderBaseUrl(provider.baseUrl || "https://api.anthropic.com");
    const body = await getJson(`${base}/v1/models?limit=1000`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, signal, apiKey);
    return redactModelList(parseModelList(body), apiKey);
  }
  if (!provider.baseUrl) throw new ProviderError("Leverandøren mangler baseUrl");
  const base = normalizeProviderBaseUrl(provider.baseUrl);
  const headers = compatibleAuthHeaders(apiKey, providerPreset(provider.presetId)?.authHeader);
  return redactModelList(parseModelList(await getJson(`${base}/models`, headers, signal, apiKey)), apiKey);
}

export function redactModelList(models: ListedModel[], key?: string): ListedModel[] {
  if (!key) return models;
  return models.filter((model) => !reflectsKey(model.id, key)).map((model) => ({ ...model, name: redactModelValue(model.name, key) }));
}
