import { createSignal } from "solid-js";
import { pluralKey, resolveLanguage, translate, type Catalog, type Language, type LanguageSetting, type Values } from "../../../shared/i18n.ts";

const [current, setCurrent] = createSignal<{ language: Language; catalog: Catalog }>({ language: "nb", catalog: {} });
let revision = 0;
export const language = () => current().language;
export const t = (source: string, values?: Values) => translate(current().catalog, source, values);
export const lookupMessage = (source: string | null | undefined, values?: Values) => source == null ? "" : t(source, values);
export const plural = (count: number, one: string, other: string, values?: Values) =>
  translate(current().catalog, pluralKey(language(), count, one, other), { ...values, count });

export async function applyLanguage(setting?: LanguageSetting, nativeLocale?: Promise<string | null>): Promise<void> {
  const request = ++revision;
  const system = nativeLocale && await nativeLocale;
  const next = resolveLanguage(setting, system ? [system] : navigator.languages.length ? navigator.languages : [navigator.language]);
  if (request !== revision) return;
  if (next !== language()) {
    const catalog: Catalog = next === "nb" ? {} : (await import(`../locales/${next}.json`)).default;
    if (request !== revision) return;
    setCurrent({ language: next, catalog });
  }
  document.documentElement.lang = next;
}

export function localizedFormat<Value extends number | Date>(make: (locale: Language) => { format(value: Value): string }) {
  let cached: ReturnType<typeof make> | undefined, previous: Language | undefined;
  return { format(value: Value) {
    const locale = language();
    if (locale !== previous || !cached) { cached = make(locale); previous = locale; }
    return cached.format(value);
  } };
}
