import { readFileSync } from "node:fs";
import { pluralKey, resolveLanguage, translate, type Catalog, type Language, type LanguageSetting, type Values } from "../shared/i18n.ts";

let language: Language = "nb", catalog: Catalog = {};
export function applyLanguage(setting: LanguageSetting | undefined, system: string): void {
  const next = resolveLanguage(setting, [system]);
  if (next === language) return;
  catalog = next === "nb" ? {} : JSON.parse(readFileSync(new URL(`./locales/${next}.json`, import.meta.url), "utf8"));
  language = next;
}
export const t = (source: string, values?: Values) => translate(catalog, source, values);
export const lookupMessage = t;
export const plural = (count: number, one: string, other: string) => translate(catalog, pluralKey(language, count, one, other), { count });
