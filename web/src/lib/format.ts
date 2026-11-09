const numbers = new Intl.NumberFormat("nb-NO");
const compact = new Intl.NumberFormat("nb-NO", { notation: "compact", maximumFractionDigits: 1 });

export function formatTokens(count: number): string {
  return count < 10_000 ? numbers.format(count) : compact.format(count);
}

export function formatCost(usd: number): string {
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1).replace(".", ",") : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

export function formatBuildDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("nb-NO", { dateStyle: "long", timeStyle: "short" });
}

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "nå";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} t`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(at).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}
