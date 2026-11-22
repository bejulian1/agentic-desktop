import { t } from "../lib/i18n";
// Small marks for the provider of a model, in the model picker and on the model chip. They are
// simple drawings in the text color, so they follow every theme; each only hints at the provider
// and carries its name as a title for assistive technology.
import { Match, Switch } from "solid-js";
import type { ModelConfig, ProviderConfig } from "../../../shared/protocol";

export type ProviderBrand = "anthropic" | "openai" | "google" | "openrouter" | "xai" | "local" | "demo" | "api";

type BrandSource = Pick<ProviderConfig, "kind" | "name"> & Partial<Pick<ProviderConfig, "presetId" | "baseUrl" | "localKind">>;

export function providerBrand(provider: BrandSource | undefined, model?: Pick<ModelConfig, "model">): ProviderBrand {
  if (!provider) return "api";
  if (provider.kind === "mock") return "demo";
  const text = [provider.presetId, provider.baseUrl, provider.name].filter(Boolean).join(" ").toLowerCase();
  if (provider.kind === "anthropic" || /anthropic|claude/.test(text)) return "anthropic";
  if (/openrouter/.test(text)) return "openrouter";
  if (/(?:^|[^a-z])x\.ai|xai|grok/.test(text)) return "xai";
  if (/gemini|generativelanguage|google|vertex/.test(text)) return "google";
  if (/openai\.com|(?:^|\s)openai(?:\s|$)|azure-openai/.test(text)) return "openai";
  if (provider.localKind || /ollama|lm-?studio|llama|vllm|localhost|127\.0\.0\.1|custom-local/.test(text)) return "local";
  // A gateway of its own: the model ID can still tell (gpt-…, claude-…, gemini-…).
  const id = model?.model.toLowerCase() ?? "";
  if (/^(?:anthropic\/)?claude/.test(id)) return "anthropic";
  if (/^(?:openai\/)?(?:gpt|o\d|chatgpt)/.test(id)) return "openai";
  if (/^(?:google\/)?gemini/.test(id)) return "google";
  if (/^(?:x-ai\/)?grok/.test(id)) return "xai";
  return "api";
}

const BRAND_NAMES: Record<ProviderBrand, () => string> = {
  anthropic: () => "Anthropic", openai: () => "OpenAI", google: () => "Google", openrouter: () => "OpenRouter",
  xai: () => "xAI", local: () => t("Lokal modellserver"), demo: () => t("Demo-modell"), api: () => t("API"),
};

export function ProviderIcon(props: { brand: ProviderBrand; size?: number }) {
  const size = () => props.size ?? 14;
  return (
    <svg class="provider-icon" data-brand={props.brand} width={size()} height={size()} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={BRAND_NAMES[props.brand]()}>
      <Switch fallback={<><rect x="2.5" y="4" width="11" height="8" rx="2" /><path d="M5.5 8h1.5M9 8h1.5" /></>}>
        {/* A spark of eight rays. */}
        <Match when={props.brand === "anthropic"}><path d="M8 2v12M2 8h12M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" stroke-width="1.6" /></Match>
        {/* Three linked rings. */}
        <Match when={props.brand === "openai"}><circle cx="8" cy="5.6" r="2.6" /><circle cx="5.9" cy="9.6" r="2.6" /><circle cx="10.1" cy="9.6" r="2.6" /></Match>
        {/* A four-point star. */}
        <Match when={props.brand === "google"}><path d="M8 1.75c.6 3.4 2.85 5.65 6.25 6.25-3.4.6-5.65 2.85-6.25 6.25-.6-3.4-2.85-5.65-6.25-6.25C5.15 7.4 7.4 5.15 8 1.75Z" fill="currentColor" stroke="none" /></Match>
        {/* Routes that split and meet. */}
        <Match when={props.brand === "openrouter"}><path d="M2 8h3.5c2 0 2.5-4 5-4H14M5.5 8c2 0 2.5 4 5 4H14" /><path d="m12.25 2.5 1.75 1.5-1.75 1.5M12.25 10.5 14 12l-1.75 1.5" /></Match>
        {/* A slanted cross. */}
        <Match when={props.brand === "xai"}><path d="M3 2.5 13 13.5M13 2.5 9.4 6.5M6.6 9.5 3 13.5" stroke-width="1.6" /></Match>
        {/* A small machine. */}
        <Match when={props.brand === "local"}><rect x="2.5" y="3" width="11" height="7.5" rx="1.5" /><path d="M5.5 13h5M8 10.5V13" /></Match>
        {/* Two sparkles for the built-in demo. */}
        <Match when={props.brand === "demo"}><path d="M6 2.5c.4 2 1.5 3.1 3.5 3.5-2 .4-3.1 1.5-3.5 3.5-.4-2-1.5-3.1-3.5-3.5 2-.4 3.1-1.5 3.5-3.5ZM11.5 9c.25 1.2.85 1.8 2 2-1.15.2-1.75.8-2 2-.25-1.2-.85-1.8-2-2 1.15-.2 1.75-.8 2-2Z" /></Match>
      </Switch>
    </svg>
  );
}
