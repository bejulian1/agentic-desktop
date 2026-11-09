// What the two HTTP providers share: fetch with a stall timeout, error mapping and an SSE parser.
import { repairJson } from "../agent/args.ts";
import { ProviderError } from "./types.ts";

const STALL_TIMEOUT_MS = 120_000;

export interface SseMessage {
  event?: string;
  data: string;
}

export interface PostOptions {
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  secret?: string;
  stallMs?: number;
}

export function redact(text: string, secret?: string): string {
  return secret ? text.split(secret).join("[skjult]") : text;
}

// Maps a non-2xx response to a ProviderError, with the provider's own message when it has one.
export async function errorFromResponse(res: Response, secret?: string): Promise<ProviderError> {
  const body = await res.text().catch(() => "");
  let message = body.slice(0, 500);
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message ?? parsed?.message ?? message;
  } catch {
    // Not JSON, keep the raw text.
  }
  const retryAfter = Number(res.headers.get("retry-after"));
  return new ProviderError(redact(`HTTP ${res.status}: ${message || res.statusText}`, secret), {
    status: res.status,
    retryable: res.status === 408 || res.status === 429 || res.status >= 500,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
  });
}

// POST that yields server-sent events. Fails with a retryable error if the stream stalls.
export async function* postSse(url: string, options: PostOptions): AsyncGenerator<SseMessage> {
  const stall = new AbortController();
  const stallMs = options.stallMs ?? STALL_TIMEOUT_MS;
  let timer = setTimeout(() => stall.abort(), stallMs);
  const signal = AbortSignal.any([options.signal, stall.signal]);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...options.headers },
        body: JSON.stringify(options.body),
        signal,
      });
    } catch (err) {
      if (options.signal.aborted) throw err;
      throw new ProviderError(redact(`Fikk ikke kontakt med leverandøren: ${connectionMessage(err)}`, options.secret), { retryable: true });
    }
    if (!res.ok) throw await errorFromResponse(res, options.secret);
    if (!res.body) throw new ProviderError("Svaret manglet innhold");

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let data: string[] = [];
    let event: string | undefined;
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (options.signal.aborted) throw err;
        const reason = stall.signal.aborted ? "Strømmen stoppet opp" : `Strømmen ble brutt: ${connectionMessage(err)}`;
        throw new ProviderError(reason, { retryable: true });
      }
      clearTimeout(timer);
      timer = setTimeout(() => stall.abort(), stallMs);
      if (chunk.done) {
        if (data.length) yield { event, data: data.join("\n") };
        return;
      }
      buffer += chunk.value;
      let start = 0;
      for (;;) {
        const lineEnd = indexOfLineEnd(buffer, start);
        if (lineEnd === -1) break;
        const line = buffer.slice(start, lineEnd);
        // A trailing CR may be the first half of CRLF split across chunks.
        if (buffer[lineEnd] === "\r" && lineEnd + 1 === buffer.length) break;
        start = lineEnd + (buffer[lineEnd] === "\r" && buffer[lineEnd + 1] === "\n" ? 2 : 1);
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          data = [];
          event = undefined;
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "data") data.push(value);
          else if (field === "event") event = value;
        }
      }
      buffer = buffer.slice(start);
    }
  } finally {
    clearTimeout(timer);
  }
}

function indexOfLineEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) return i;
  }
  return -1;
}

function connectionMessage(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return cause?.code ?? cause?.message ?? (err as Error).message;
}

export async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal, secret?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (err) {
    throw new ProviderError(redact(`Fikk ikke kontakt: ${connectionMessage(err)}`, secret));
  }
  if (!res.ok) throw await errorFromResponse(res, secret);
  return res.json();
}

export function parseToolInput(raw: string): { input: unknown; parseError?: string } {
  if (raw.trim() === "") return { input: {} };
  try {
    const input = JSON.parse(raw);
    if (input !== null && typeof input === "object" && !Array.isArray(input)) return { input };
  } catch {
    // Repaired below, if it is one of the usual mistakes.
  }
  const repaired = repairJson(raw);
  if (repaired) return { input: repaired };
  const shown = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
  return { input: {}, parseError: `Verktøyargumentene var ikke gyldig JSON. Send dem på nytt som ett JSON-objekt med doble anførselstegn. Du sendte: ${shown}` };
}

// Consecutive messages with the same role are merged, so all tool results of a step go back
// together and providers that demand alternating roles are satisfied.
export function mergeRoles<T extends { role: string; content: unknown[] }>(messages: T[]): T[] {
  const merged: T[] = [];
  for (const message of messages) {
    if (!message.content.length) continue;
    const last = merged.at(-1);
    if (last?.role === message.role) last.content = [...last.content, ...message.content];
    else merged.push({ ...message });
  }
  return merged;
}
