// Coloured brand mark for the company or server behind a model, used in sidebar rows, hover cards
// and Tråddetaljer. Delegates icon art and detection to ProviderIcon so every surface stays vivid
// and consistent while preserving the .provider-glyph and data-provider attributes.
import type { ModelConfig, ProviderConfig } from "../../../shared/protocol";
import { t } from "../lib/i18n";
import { app } from "../state/app";
import { BRAND_NAMES, BrandSvg, providerBrand, type ProviderBrand } from "./ProviderIcon";

export type ProviderFamily = ProviderBrand;

export function providerFamily(
  model: (Pick<ModelConfig, "model" | "providerId" | "id"> & { name?: string }) | undefined,
  provider?: Pick<ProviderConfig, "kind" | "presetId" | "localKind" | "baseUrl" | "name">,
): ProviderFamily {
  if (!model) return "api";
  if (model.id === "mock-demo" || provider?.kind === "mock") return "demo";
  return providerBrand(provider, model);
}

export function modelProvider(modelId: string | null | undefined): { family: ProviderFamily; label: string } {
  const model = app.models.find((m) => m.id === (modelId ?? app.settings.defaultModelId));
  const provider = model ? app.providers.find((p) => p.id === model.providerId) : undefined;
  const family = providerFamily(model, provider);
  return { family, label: providerLabel(family, provider?.name) };
}

export function providerLabel(family: ProviderFamily, name?: string): string {
  if (family === "local") return name || t("På denne maskinen");
  if (family === "demo") return t("Demo");
  if (family === "api") return name || "API";
  return BRAND_NAMES[family]();
}

export function ProviderGlyph(props: { family: ProviderFamily; size?: number; title?: string }) {
  return (
    <BrandSvg
      brand={props.family}
      size={props.size ?? 13}
      class="provider-glyph"
      dataProvider
      ariaLabel={props.title}
      ariaHidden={!props.title}
    />
  );
}
