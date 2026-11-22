// A small mark for the company or kind of server behind a model, for the sidebar rows and the hover
// card: Claude, OpenAI, Gemini, a model on this machine (Ollama and the like) or any other API. They
// are our own simple drawings on the 16-unit grid, not logos, and they take the text colour.
import { Match, Switch } from "solid-js";
import type { ModelConfig, ProviderConfig } from "../../../shared/protocol";
import { t } from "../lib/i18n";
import { app } from "../state/app";

export type ProviderFamily = "anthropic" | "openai" | "google" | "local" | "demo" | "api";

// Which family a model belongs to: the provider's kind or preset first, then its address, and last
// what the model is called (a gateway like OpenRouter serves all of them).
export function providerFamily(model: Pick<ModelConfig, "model" | "providerId" | "id"> | undefined, provider?: Pick<ProviderConfig, "kind" | "presetId" | "localKind" | "baseUrl" | "name">): ProviderFamily {
  if (!model) return "api";
  if (model.id === "mock-demo" || provider?.kind === "mock") return "demo";
  if (provider?.kind === "anthropic" || provider?.presetId === "anthropic") return "anthropic";
  if (provider?.localKind) return "local";
  if (provider?.presetId === "openai" || provider?.presetId === "azure-openai") return "openai";
  const where = `${provider?.baseUrl ?? ""} ${provider?.name ?? ""}`.toLowerCase();
  const name = model.model.toLowerCase();
  if (/openai\.com|openai/.test(where)) return "openai";
  if (/anthropic\.com/.test(where)) return "anthropic";
  if (/generativelanguage|googleapis|gemini/.test(where)) return "google";
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(where)) return "local";
  if (/claude/.test(name)) return "anthropic";
  if (/^(gpt|o\d|chatgpt)|openai\//.test(name)) return "openai";
  if (/gemini|gemma|google\//.test(name)) return "google";
  return "api";
}

export function modelProvider(modelId: string | null | undefined): { family: ProviderFamily; label: string } {
  const model = app.models.find((m) => m.id === (modelId ?? app.settings.defaultModelId));
  const provider = model ? app.providers.find((p) => p.id === model.providerId) : undefined;
  const family = providerFamily(model, provider);
  return { family, label: providerLabel(family, provider?.name) };
}

export function providerLabel(family: ProviderFamily, name?: string): string {
  if (family === "anthropic") return "Anthropic";
  if (family === "openai") return "OpenAI";
  if (family === "google") return "Google";
  if (family === "local") return name || t("På denne maskinen");
  if (family === "demo") return t("Demo");
  return name || "API";
}

export function ProviderGlyph(props: { family: ProviderFamily; size?: number; title?: string }) {
  const size = () => props.size ?? 12;
  return (
    <svg class="provider-glyph" data-provider={props.family} width={size()} height={size()} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role={props.title ? "img" : undefined} aria-label={props.title} aria-hidden={props.title ? undefined : "true"}>
      <Switch>
        {/* Claude: a burst of eight rays. */}
        <Match when={props.family === "anthropic"}><path d="M8 1.75v12.5M1.75 8h12.5M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" /></Match>
        {/* OpenAI: a six-sided knot. */}
        <Match when={props.family === "openai"}><path d="M8 1.75 13.4 4.9v6.2L8 14.25 2.6 11.1V4.9zM8 1.75v6.5m0 0 5.4 2.85M8 8.25 2.6 11.1" /></Match>
        {/* Gemini: a four-pointed star. */}
        <Match when={props.family === "google"}><path d="M8 1.5C8.6 5.3 10.7 7.4 14.5 8 10.7 8.6 8.6 10.7 8 14.5 7.4 10.7 5.3 8.6 1.5 8 5.3 7.4 7.4 5.3 8 1.5z" fill="currentColor" stroke="none" /></Match>
        {/* On this machine: a small chip. */}
        <Match when={props.family === "local"}><path d="M4.5 4.5h7v7h-7zM6.5 6.5h3v3h-3zM6 2.5v2M10 2.5v2M6 11.5v2M10 11.5v2M2.5 6v2M2.5 9.5v1M13.5 6v2M13.5 9.5v1" /></Match>
        {/* The demo model. */}
        <Match when={props.family === "demo"}><circle cx="8" cy="8" r="5.5" /><path d="M6.5 6v4l3.5-2z" fill="currentColor" stroke="none" /></Match>
        {/* Any other API: angle brackets around a dot. */}
        <Match when={props.family === "api"}><path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M8 8h.01" /></Match>
      </Switch>
    </svg>
  );
}
