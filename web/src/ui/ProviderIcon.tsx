import { t } from "../lib/i18n";
// Recognisable coloured brand favicons for AI providers and model families, used in the model
// picker, model chip, sidebar rows, hover cards, Tråddetaljer, subagent cards and provider list.
import { createUniqueId, Match, Switch } from "solid-js";
import type { ModelConfig, ProviderConfig } from "../../../shared/protocol";

export type ProviderBrand =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "deepseek"
  | "mistral"
  | "meta"
  | "xai"
  | "groq"
  | "perplexity"
  | "cohere"
  | "github"
  | "local"
  | "demo"
  | "api";

export type BrandSource = Pick<ProviderConfig, "kind" | "name"> & Partial<Pick<ProviderConfig, "presetId" | "baseUrl">> & { localKind?: unknown };

function brandFromModelId(id: string): ProviderBrand | null {
  const lower = id.toLowerCase();
  if (!lower) return null;
  if (/(?:^|\/)claude/.test(lower)) return "anthropic";
  if (/(?:^|\/)(?:gpt|o\d|chatgpt|codex)/.test(lower) || /^openai\//.test(lower)) return "openai";
  if (/(?:^|\/)(?:gemini|gemma)/.test(lower) || /^google\//.test(lower)) return "google";
  if (/(?:^|\/)deepseek/.test(lower)) return "deepseek";
  if (/(?:^|\/)(?:mistral|mixtral|codestral|pixtral|ministral|devstral|magistral)/.test(lower) || /^mistralai\//.test(lower)) return "mistral";
  if (/(?:^|\/)(?:llama|meta-llama)/.test(lower) || /^meta\//.test(lower)) return "meta";
  if (/(?:^|\/)grok/.test(lower) || /^x-?ai\//.test(lower)) return "xai";
  if (/(?:^|\/)(?:sonar|pplx)/.test(lower) || /^perplexity\//.test(lower)) return "perplexity";
  if (/(?:^|\/)command/.test(lower) || /^cohere\//.test(lower)) return "cohere";
  return null;
}

export function providerBrand(provider: BrandSource | undefined, model?: Pick<ModelConfig, "model">): ProviderBrand {
  if (!provider) return (model ? brandFromModelId(model.model) : null) ?? "api";
  if (provider.kind === "mock") return "demo";
  const text = [provider.presetId, provider.baseUrl, provider.name].filter(Boolean).join(" ").toLowerCase();
  const isGateway = /openrouter|together|fireworks|bedrock|vertex|azure|litellm|portkey|cloudflare|gateway/.test(text);
  // On gateways or generic custom OpenAI-compatible servers, prefer the actual model family when known.
  if (model && (isGateway || provider.kind === "openai-compatible")) {
    const direct =
      /anthropic|claude/.test(text) ? "anthropic"
      : /openai\.com|(?:^|\s)openai(?:\s|$)/.test(text) ? "openai"
      : /generativelanguage|googleapis|gemini/.test(text) ? "google"
      : /deepseek/.test(text) ? "deepseek"
      : /mistral/.test(text) ? "mistral"
      : /(?:^|[^a-z])x\.ai|xai|grok/.test(text) ? "xai"
      : /groq/.test(text) ? "groq"
      : /perplexity/.test(text) ? "perplexity"
      : /cohere/.test(text) ? "cohere"
      : /github|models\.inference\.ai/.test(text) ? "github"
      : null;
    if (direct) return direct;
    const fromModel = brandFromModelId(model.model);
    if (fromModel) return fromModel;
  }
  if (provider.kind === "anthropic" || /anthropic|claude/.test(text)) return "anthropic";
  if (/openrouter/.test(text)) return "openrouter";
  if (/deepseek/.test(text)) return "deepseek";
  if (/mistral/.test(text)) return "mistral";
  if (/(?:^|[^a-z])x\.ai|xai|grok/.test(text)) return "xai";
  if (/groq/.test(text)) return "groq";
  if (/perplexity/.test(text)) return "perplexity";
  if (/cohere/.test(text)) return "cohere";
  if (/github|models\.inference\.ai/.test(text)) return "github";
  if (/gemini|generativelanguage|googleapis|google|vertex/.test(text)) return "google";
  if (/openai\.com|(?:^|\s)openai(?:\s|$)|azure-openai/.test(text)) return "openai";
  if (/meta|llama/.test(text) && !provider.localKind && !/ollama|lm-?studio|localhost|127\.0\.0\.1/.test(text)) return "meta";
  if (provider.localKind || /ollama|lm-?studio|llama\.cpp|vllm|localhost|127\.0\.0\.1|\[::1\]|custom-local/.test(text)) return "local";
  if (model) {
    const fromModel = brandFromModelId(model.model);
    if (fromModel) return fromModel;
  }
  return "api";
}

export const BRAND_NAMES: Record<ProviderBrand, () => string> = {
  anthropic: () => "Anthropic",
  openai: () => "OpenAI",
  google: () => "Google",
  openrouter: () => "OpenRouter",
  deepseek: () => "DeepSeek",
  mistral: () => "Mistral",
  meta: () => "Meta",
  xai: () => "xAI",
  groq: () => "Groq",
  perplexity: () => "Perplexity",
  cohere: () => "Cohere",
  github: () => "GitHub",
  local: () => t("Lokal modellserver"),
  demo: () => t("Demo-modell"),
  api: () => t("API"),
};

export function BrandSvg(props: {
  brand: ProviderBrand;
  size?: number;
  class: string;
  dataBrand?: boolean;
  dataProvider?: boolean;
  ariaLabel?: string;
  ariaHidden?: boolean;
}) {
  const size = () => props.size ?? 14;
  const uid = createUniqueId();
  return (
    <svg
      class={props.class}
      data-brand={props.dataBrand ? props.brand : undefined}
      data-provider={props.dataProvider ? props.brand : undefined}
      width={size()}
      height={size()}
      viewBox="0 0 16 16"
      fill="none"
      role={props.ariaLabel ? "img" : undefined}
      aria-label={props.ariaLabel}
      aria-hidden={props.ariaHidden ? "true" : undefined}
    >
      <Switch
        fallback={
          <>
            <rect x="1" y="1" width="14" height="14" rx="3.5" fill="#0EA5E9" />
            <path d="M5.4 5.2 2.9 8l2.5 2.8M10.6 5.2 13.1 8l-2.5 2.8M9 4.5 7 11.5" stroke="#fff" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" />
          </>
        }
      >
        {/* Anthropic / Claude: terracotta-coral starburst */}
        <Match when={props.brand === "anthropic"}>
          <g stroke="#D97757" stroke-width="1.65" stroke-linecap="round">
            <path d="M8 1.4v13.2M1.4 8h13.2M3.35 3.35l9.3 9.3M12.65 3.35l-9.3 9.3" />
            <path d="M5.45 1.85l5.1 12.3M10.55 1.85l-5.1 12.3M1.85 5.45l12.3 5.1M14.15 5.45l-12.3 5.1" stroke-width="1.1" />
          </g>
          <circle cx="8" cy="8" r="1.7" fill="#D97757" />
        </Match>
        {/* OpenAI: emerald green badge with crisp hexagonal blossom */}
        <Match when={props.brand === "openai"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#10A37F" />
          <g stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3.2a2.1 2.1 0 0 1 2.1 2.1v2.1L8 8.6 5.9 7.4V5.3A2.1 2.1 0 0 1 8 3.2Z" />
            <path d="M12.1 5.6a2.1 2.1 0 0 1-.77 2.87L9.5 9.5 8 8.6V6.2l1.83-1.05a2.1 2.1 0 0 1 2.27.45Z" />
            <path d="M12.1 10.4a2.1 2.1 0 0 1-2.87.77L7.4 10.1V8.6l2.1-1.2 1.83 1.05a2.1 2.1 0 0 1 .77 1.95Z" />
            <path d="M8 12.8a2.1 2.1 0 0 1-2.1-2.1V8.6L8 7.4l2.1 1.2v2.1A2.1 2.1 0 0 1 8 12.8Z" />
            <path d="M3.9 10.4a2.1 2.1 0 0 1 .77-2.87L6.5 6.5 8 7.4v2.4l-1.83 1.05a2.1 2.1 0 0 1-2.27-.45Z" />
            <path d="M3.9 5.6a2.1 2.1 0 0 1 2.87-.77L8.6 5.9v1.5L6.5 8.6 4.67 7.55A2.1 2.1 0 0 1 3.9 5.6Z" />
          </g>
        </Match>
        {/* Google / Gemini: vibrant blue -> violet -> coral four-point star */}
        <Match when={props.brand === "google"}>
          <defs>
            <linearGradient id={`gem-${uid}`} x1="1.5" y1="1.5" x2="14.5" y2="14.5" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#4285F4" />
              <stop offset="52%" stop-color="#9B72CB" />
              <stop offset="100%" stop-color="#D96570" />
            </linearGradient>
          </defs>
          <path d="M8 1c.7 4.1 2.9 6.3 7 7-4.1.7-6.3 2.9-7 7-.7-4.1-2.9-6.3-7-7 4.1-.7 6.3-2.9 7-7Z" fill={`url(#gem-${uid})`} />
        </Match>
        {/* OpenRouter: indigo badge with crisp split-route arrows */}
        <Match when={props.brand === "openrouter"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#6366F1" />
          <path d="M2.9 8h2.6c1.5 0 2-3.2 4.1-3.2h3.1M5.5 8c1.5 0 2 3.2 4.1 3.2h3.1" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
          <path d="m11.2 3.4 1.8 1.4-1.8 1.4M11.2 9.8l1.8 1.4-1.8 1.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </Match>
        {/* DeepSeek: royal blue badge with stylised whale wave */}
        <Match when={props.brand === "deepseek"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#4D6BFE" />
          <path d="M3.5 9.6c0-2.6 2-4.6 4.7-4.6 1.5 0 2.7.6 3.5 1.5l1.3-.9c-.2 1.4-.7 2.4-1.5 3.1-.7 1.7-2.2 2.7-4.2 2.7-2.2 0-3.8-.7-3.8-1.8Z" fill="#fff" />
          <circle cx="6.7" cy="7.9" r="0.8" fill="#4D6BFE" />
        </Match>
        {/* Mistral: authentic 5-colour stepped pixel M */}
        <Match when={props.brand === "mistral"}>
          <rect x="1.5" y="2.5" width="2.6" height="2.2" fill="#FFD800" />
          <rect x="11.9" y="2.5" width="2.6" height="2.2" fill="#FFD800" />
          <rect x="1.5" y="4.7" width="5.2" height="2.2" fill="#FFAF00" />
          <rect x="9.3" y="4.7" width="5.2" height="2.2" fill="#FFAF00" />
          <rect x="1.5" y="6.9" width="13" height="2.2" fill="#FF8205" />
          <rect x="1.5" y="9.1" width="2.6" height="2.2" fill="#FA500F" />
          <rect x="6.7" y="9.1" width="2.6" height="2.2" fill="#FA500F" />
          <rect x="11.9" y="9.1" width="2.6" height="2.2" fill="#FA500F" />
          <rect x="1.5" y="11.3" width="3.8" height="2.2" fill="#E10500" />
          <rect x="10.7" y="11.3" width="3.8" height="2.2" fill="#E10500" />
        </Match>
        {/* Meta / Llama: vibrant Meta blue infinity loop */}
        <Match when={props.brand === "meta"}>
          <defs>
            <linearGradient id={`meta-${uid}`} x1="1" y1="12" x2="15" y2="4" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#0064E0" />
              <stop offset="100%" stop-color="#38BDF8" />
            </linearGradient>
          </defs>
          <path d="M3.2 11.4c-1.1 0-1.9-1-1.9-2.5 0-2.1 1.4-4.3 3-4.3 1.2 0 2.1 1 3.7 3.4 1.6-2.4 2.5-3.4 3.7-3.4 1.6 0 3 2.2 3 4.3 0 1.5-.8 2.5-1.9 2.5-1.2 0-2.1-.9-3.6-3.1l-1.2-1.8-1.2 1.8c-1.5 2.2-2.4 3.1-3.6 3.1Z" stroke={`url(#meta-${uid})`} stroke-width="1.9" stroke-linejoin="round" />
        </Match>
        {/* xAI / Grok: crisp high-contrast dark badge with bright slash */}
        <Match when={props.brand === "xai"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#18181B" stroke="rgba(255,255,255,0.22)" stroke-width="0.75" />
          <path d="M4.2 3.8 11.8 12.2M11.8 3.8 8.9 7.1M7.1 8.9 4.2 12.2" stroke="#FAFAFA" stroke-width="1.65" stroke-linecap="round" />
        </Match>
        {/* Groq: vivid orange-red badge */}
        <Match when={props.brand === "groq"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#F55036" />
          <path d="M11.4 6.5a3.7 3.7 0 1 0 .2 2.4H8.4" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
        </Match>
        {/* Perplexity: teal prism */}
        <Match when={props.brand === "perplexity"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#20B8CD" />
          <path d="M8 2.8v10.4M4.3 4.6l3.7 3.2 3.7-3.2M4.3 4.6v4.6L8 12.4l3.7-3.2V4.6M3.6 7.8h8.8" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </Match>
        {/* Cohere: emerald-coral mark */}
        <Match when={props.brand === "cohere"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#39594D" />
          <circle cx="6.4" cy="6.4" r="2.6" fill="#D18EE2" />
          <circle cx="10.2" cy="9.9" r="2.3" fill="#FF7759" />
          <circle cx="5.4" cy="10.6" r="1.7" fill="#5EEAD4" />
        </Match>
        {/* GitHub Models */}
        <Match when={props.brand === "github"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#24292F" stroke="rgba(255,255,255,0.2)" stroke-width="0.75" />
          <path d="M8 2.7a5.3 5.3 0 0 0-1.68 10.33c.26.05.36-.11.36-.25v-.98c-1.47.32-1.78-.62-1.78-.62-.24-.61-.58-.77-.58-.77-.48-.32.03-.32.03-.32.53.04.81.54.81.54.47.8 1.23.57 1.53.44.05-.34.18-.57.33-.7-1.17-.13-2.4-.58-2.4-2.61 0-.58.21-1.05.54-1.42-.05-.13-.24-.67.05-1.4 0 0 .45-.14 1.46.54a5.1 5.1 0 0 1 2.66 0c1.01-.68 1.46-.54 1.46-.54.29.73.1 1.27.05 1.4.34.37.54.84.54 1.42 0 2.03-1.24 2.48-2.42 2.61.19.16.36.48.36.98v1.45c0 .14.1.3.37.25A5.3 5.3 0 0 0 8 2.7Z" fill="#fff" />
        </Match>
        {/* Local server (Ollama, LM Studio, llama.cpp): vibrant emerald chip */}
        <Match when={props.brand === "local"}>
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.75" fill="#16A34A" />
          <rect x="3.5" y="4" width="9" height="6.2" rx="1.2" stroke="#fff" stroke-width="1.35" />
          <path d="M5.6 12.4h4.8M8 10.2v2.2" stroke="#fff" stroke-width="1.35" stroke-linecap="round" />
        </Match>
        {/* Built-in demo model: bright amber sparkles */}
        <Match when={props.brand === "demo"}>
          <path d="M6.4 1.8c.45 2.4 1.8 3.75 4.2 4.2-2.4.45-3.75 1.8-4.2 4.2-.45-2.4-1.8-3.75-4.2-4.2 2.4-.45 3.75-1.8 4.2-4.2Z" fill="#F59E0B" />
          <path d="M11.8 8.7c.3 1.45 1.05 2.2 2.5 2.5-1.45.3-2.2 1.05-2.5 2.5-.3-1.45-1.05-2.2-2.5-2.5 1.45-.3 2.2-1.05 2.5-2.5Z" fill="#FBBF24" />
        </Match>
      </Switch>
    </svg>
  );
}

export function ProviderIcon(props: { brand: ProviderBrand; size?: number; decorative?: boolean }) {
  return (
    <BrandSvg
      brand={props.brand}
      size={props.size}
      class="provider-icon"
      dataBrand
      ariaLabel={props.decorative ? undefined : BRAND_NAMES[props.brand]()}
      ariaHidden={props.decorative}
    />
  );
}
