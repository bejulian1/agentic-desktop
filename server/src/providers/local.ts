import { DEFAULT_LOCAL_CONTEXT_WINDOW, type ListedModel, type LocalProviderKind, type ModelConfig } from "../../../shared/protocol.ts";
import { normalizeProviderBaseUrl, redactModelValue, reflectsKey } from "./http.ts";
import { ProviderError, type Provider, type ToolDef } from "./types.ts";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 1_000;
const MAX_OLLAMA_DETAILS = 24; // One native request per model. Keep discovery bounded on large catalogs.

type Entry = Record<string, unknown>;
const record = (value: unknown): Entry =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Entry : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined;
const bool = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;
const context = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1000 ? value : undefined;

async function localJson(url: string, apiKey: string | undefined, signal: AbortSignal, payload?: Entry): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (payload) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(url, {
      headers, signal, redirect: "manual",
      ...(payload ? { method: "POST", body: JSON.stringify(payload) } : {}),
    });
  } catch {
    throw new ProviderError(signal.aborted
      ? "Serveren brukte for lang tid på å svare."
      : "Fikk ikke kontakt med serveren. Sjekk adressen og at modellserveren kjører.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const status = response.status;
    const message = status === 401 || status === 403
      ? "Serveren avviste tilkoblingen. Kontroller API-nøkkelen og tilgangen."
      : status >= 300 && status < 400
        ? "Serveren videresender forespørselen. Skriv den endelige serveradressen."
        : `Modellisten svarte med HTTP ${status}.`;
    throw new ProviderError(message, { status });
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("Serveren sendte en tom modelliste.");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_CATALOG_BYTES) throw new ProviderError("Modellisten fra serveren er for stor.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(signal.aborted ? "Serveren brukte for lang tid på å svare." : "Serveren sendte ikke en gyldig JSON-modelliste.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function catalog(value: unknown, ollamaTags = false, apiKey?: string): Map<string, ListedModel> {
  const items = record(value)[ollamaTags ? "models" : "data"];
  if (!Array.isArray(items)) throw new ProviderError("Adressen svarte, men returnerte ingen kompatibel modelliste. Kontroller API-adressen eller legg til modellen manuelt.");
  const models = new Map<string, ListedModel>();
  for (const raw of items) {
    const item = record(raw);
    const id = ollamaTags ? asText(item.model) ?? asText(item.name) : asText(item.id);
    if (!id || reflectsKey(id, apiKey) || models.has(id) || item.type === "embedding" || item.type === "decision") continue;
    const window = [item.context_length, item.context_window, item.max_context_length, item.max_model_len].map(context).find(Boolean);
    models.set(id, {
      id,
      name: redactModelValue(asText(item.display_name) ?? id, apiKey),
      contextWindow: window ?? DEFAULT_LOCAL_CONTEXT_WINDOW,
      contextSource: window ? "api" : "default",
      supportsTools: bool(item.supports_tools),
      supportsImages: bool(item.supports_images),
    });
    if (models.size >= MAX_MODELS) break;
  }
  return models;
}

function applyContext(model: ListedModel, value: unknown): void {
  const window = context(value);
  if (!window) return;
  model.contextWindow = window;
  model.contextSource = "api";
}

async function enrichOllama(models: Map<string, ListedModel>, api: string, apiKey: string | undefined, signal: AbortSignal): Promise<void> {
  const details = [...models.values()].slice(0, MAX_OLLAMA_DETAILS);
  const running = localJson(`${api}/ps`, apiKey, signal).then((data) => {
    for (const raw of list(record(data).models)) {
      const item = record(raw);
      const model = models.get(asText(item.model) ?? asText(item.name) ?? "");
      if (model) applyContext(model, item.context_length);
    }
  }).catch(() => {});
  for (let i = 0; i < details.length && !signal.aborted; i += 3) {
    await Promise.all(details.slice(i, i + 3).map(async (model) => {
      try {
        const info = record(await localJson(`${api}/show`, apiKey, signal, { model: model.id }));
        const capabilities = info.capabilities;
        if (Array.isArray(capabilities)) {
          if (!capabilities.includes("completion") && ["embedding", "audio", "transcription"].some((capability) => capabilities.includes(capability))) {
            models.delete(model.id);
            return;
          }
          model.supportsTools = capabilities.includes("tools");
          model.supportsImages = capabilities.includes("vision");
        }
        if (model.contextSource !== "api" && typeof info.parameters === "string") {
          applyContext(model, Number(info.parameters.match(/^\s*num_ctx\s+(\d+)\s*$/m)?.[1]));
        }
      } catch {
        // Older installs and proxies may expose only /v1. Keep the model with unknown capabilities.
      }
    }));
  }
  await running;
}

async function enrichLmStudio(models: Map<string, ListedModel>, api: string, apiKey: string | undefined, signal: AbortSignal): Promise<void> {
  const data = await localJson(`${api}/v1/models`, apiKey, signal).catch(() => null);
  for (const raw of list(record(data).models)) {
    const item = record(raw);
    const key = asText(item.key);
    const instances = list(item.loaded_instances).map(record);
    const byId = new Map(instances.map((instance) => [asText(instance.id), instance]));
    for (const id of new Set([key, ...byId.keys()])) {
      const model = id ? models.get(id) : undefined;
      if (!model) continue;
      if (item.type === "embedding" || item.type === "decision") {
        models.delete(model.id);
        continue;
      }
      const capabilities = record(item.capabilities);
      model.name = redactModelValue(asText(item.display_name) ?? model.name, apiKey);
      model.supportsTools = bool(capabilities.trained_for_tool_use) ?? model.supportsTools;
      model.supportsImages = bool(capabilities.vision) ?? model.supportsImages;
      const instance = byId.get(id) ?? (instances.length === 1 ? instances[0] : undefined);
      applyContext(model, record(instance?.config).context_length);
    }
  }
}

export async function fetchLocalModels(
  kind: LocalProviderKind,
  baseUrl: string,
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<ListedModel[]> {
  const base = normalizeProviderBaseUrl(baseUrl);
  const api = base.endsWith("/v1") ? `${base.slice(0, -3)}/api` : undefined;
  let models: Map<string, ListedModel>;
  try {
    models = catalog(await localJson(`${base}/models`, apiKey, signal), false, apiKey);
  } catch (err) {
    if (!(err instanceof ProviderError) || ![404, 405, 501].includes(err.status ?? 0)) throw err;
    if (kind !== "ollama" || !api) {
      throw new ProviderError("Serveren har ingen kompatibel modelliste. Legg til modell-ID manuelt og test modellen.");
    }
    models = catalog(await localJson(`${api}/tags`, apiKey, signal), true, apiKey);
  }
  if (api && models.size) {
    const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(4_000)]);
    if (kind === "ollama") await enrichOllama(models, api, apiKey, metadataSignal);
    if (kind === "lmstudio") await enrichLmStudio(models, api, apiKey, metadataSignal);
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function probeLocalModels(kind: LocalProviderKind, baseUrl: string, signal: AbortSignal): Promise<number> {
  if (kind === "ollama") return catalog(await localJson(`${baseUrl.slice(0, -3)}/api/tags`, undefined, signal), true).size;
  return catalog(await localJson(`${baseUrl}/models`, undefined, signal)).size;
}

export function localCatalogStatus(models: ListedModel[]): { ok: true; message: string } {
  const message = models.length === 1 ? "Tilkoblet. Fant 1 chatmodell."
    : models.length ? `Tilkoblet. Fant ${models.length} chatmodeller.`
      : "Tilkoblet. Ingen chatmodeller i listen ennå.";
  return { ok: true, message };
}

const CONNECTION_PROBE: ToolDef = {
  name: "confirm_connection",
  description: "Confirm the connection test. This function does not perform any action.",
  parameters: {
    type: "object",
    properties: { value: { type: "string", enum: ["ok"] } },
    required: ["value"],
    additionalProperties: false,
  },
};

export async function testProviderModel(client: Provider, model: ModelConfig, local: boolean, signal: AbortSignal): Promise<{ ok: boolean; message: string }> {
  const toolTest = local && model.supportsTools === true;
  const instruction = toolTest ? 'Call confirm_connection once with value "ok".' : 'Reply with the word "OK".';
  let hasText = false;
  let calls = 0;
  let validCall = false;
  for await (const part of client.stream({
    model: { ...model, maxOutputTokens: toolTest ? 512 : local ? 256 : 64, effort: undefined, thinking: false },
    system: "",
    messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
    tools: toolTest ? [CONNECTION_PROBE] : [],
    signal,
  })) {
    if (part.type === "text" && part.text.trim()) hasText = true;
    if (part.type === "tool_call") {
      calls += 1;
      const input = record(part.input);
      validCall = part.name === CONNECTION_PROBE.name && !part.parseError && input.value === "ok" && Object.keys(input).length === 1;
    }
  }
  if (toolTest && !(calls === 1 && validCall)) {
    return { ok: false, message: "Modellen svarte uten et gyldig verktøykall. Kontroller verktøystøtten på serveren, eller slå av verktøy for denne modellen." };
  }
  if (toolTest) return { ok: true, message: "Modellen svarte med et gyldig testkall." };
  if (hasText) return { ok: true, message: "Modellen svarte på testmeldingen." };
  return { ok: false, message: "Modellen ga ikke et tekstsvar på testmeldingen." };
}
