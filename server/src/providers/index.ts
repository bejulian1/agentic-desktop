import type { StoredProvider } from "../db.ts";
import type { Secrets } from "../secrets.ts";
import { createAnthropicProvider } from "./anthropic.ts";
import { createMockProvider } from "./mock.ts";
import { createOpenAiProvider } from "./openai-compatible.ts";
import { localKindFor, providerPreset } from "./presets.ts";
import { ProviderError, type Provider } from "./types.ts";

export interface ProviderRegistryOptions {
  secrets: Secrets;
  mockDelayMs: number;
  stallMs?: number;
}

export function apiKeyFor(provider: StoredProvider, secrets: Secrets): string | undefined {
  return secrets.get(provider.credentialId ?? provider.id) || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
}

export function createProvider(provider: StoredProvider, options: ProviderRegistryOptions): Provider {
  const apiKey = apiKeyFor(provider, options.secrets);
  switch (provider.kind) {
    case "mock":
      return createMockProvider({ delayMs: options.mockDelayMs });
    case "anthropic":
      return createAnthropicProvider({ baseUrl: provider.baseUrl, apiKey, stallMs: options.stallMs });
    case "openai-compatible":
      if (!provider.baseUrl) throw new ProviderError("Leverandøren mangler baseUrl");
      return createOpenAiProvider({ baseUrl: provider.baseUrl, apiKey, localKind: localKindFor(provider), authHeader: providerPreset(provider.presetId)?.authHeader, stallMs: options.stallMs });
  }
}
