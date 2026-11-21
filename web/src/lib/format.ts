import { language, localizedFormat, t } from "./i18n.ts";
const numbers = localizedFormat(locale => new Intl.NumberFormat(locale));
const compact = localizedFormat(locale => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }));

export function formatTokens(count: number): string {
  return count < 10_000 ? numbers.format(count) : compact.format(count);
}

export function formatCost(usd: number): string {
  if (language() !== "nb") {
    const digits = usd < 0.01 ? 4 : 2;
    return usd.toLocaleString(language(), { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toLocaleString(language(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

export function formatBuildDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(language(), { dateStyle: "long", timeStyle: "short" });
}

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (language() !== "nb" && minutes < 7 * 1440) {
    const format = new Intl.RelativeTimeFormat(language(), { numeric: "auto", style: "short" });
    if (minutes < 1) return format.format(0, "second");
    if (minutes < 60) return format.format(-minutes, "minute");
    if (minutes < 1440) return format.format(-Math.round(minutes / 60), "hour");
    return format.format(-Math.round(minutes / 1440), "day");
  }
  if (minutes < 1) return t("nå");
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} t`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(at).toLocaleDateString(language(), { day: "numeric", month: "short" });
}
