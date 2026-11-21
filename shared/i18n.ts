export const languages = {
  nb: "Norsk bokmål", en: "English", sv: "Svenska", da: "Dansk", de: "Deutsch", fr: "Français",
  es: "Español", "pt-BR": "Português (Brasil)", it: "Italiano", nl: "Nederlands", ja: "日本語", "zh-CN": "简体中文",
} as const;
export type Language = keyof typeof languages;
export type LanguageSetting = Language | "system";
export type Catalog = Record<string, string>;
export type Values = Record<string, number | string>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(languages, value);
}

export function resolveLanguage(setting: LanguageSetting | undefined, preferences: readonly string[]): Language {
  if (isLanguage(setting)) return setting;
  for (const preference of preferences) {
    const base = preference.toLowerCase().split(/[-_]/)[0];
    if (["nb", "nn", "no"].includes(base)) return "nb";
    const match = Object.keys(languages).find(code => code.toLowerCase().split("-")[0] === base);
    if (isLanguage(match)) return match;
  }
  return "en";
}

export function translate(catalog: Catalog, source: string, values?: Values): string {
  const text = Object.hasOwn(catalog, source) ? catalog[source] || source : source;
  return values ? text.replace(/\{(\w+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token) : text;
}

export function pluralKey(language: Language, count: number, one: string, other: string): string {
  return new Intl.PluralRules(language).select(count) === "one" ? one : other;
}
