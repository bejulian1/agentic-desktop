// Round 13 (SPEC 27.2): the tools of a chat and the search page for web search. Kept apart from
// api.ts, like the rounds before, so the checks for this round are in one place.
import { CHAT_TOOL_IDS, type ChatTools, type Settings } from "../../../shared/protocol.ts";
import { HttpError } from "../errors.ts";

const MAX_SEARCH_URL = 500;

// A full set of switches. Partial objects are filled from base, so a client can send one switch.
export function chatToolsFromBody(value: unknown, base: ChatTools): ChatTools {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Ugyldige verktøy for chatten");
  const out = { ...base };
  for (const [key, on] of Object.entries(value)) {
    if (!CHAT_TOOL_IDS.includes(key as keyof ChatTools)) throw new HttpError(400, `Ukjent verktøy: ${key}`);
    if (typeof on !== "boolean") throw new HttpError(400, `Ugyldig verdi for ${key}`);
    out[key as keyof ChatTools] = on;
  }
  return out;
}

// The page the app's browser opens for a search: http or https, with {q} where the words go.
// Empty or null clears it.
export function checkSearchUrl(value: unknown): string | undefined {
  if (value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > MAX_SEARCH_URL) throw new HttpError(400, "Ugyldig søke-adresse");
  const url = value.trim();
  if (!url.includes("{q}")) throw new HttpError(400, "Søke-adressen må ha {q} der søkeordene skal stå, for eksempel https://eksempel.no/sok?q={q}");
  try {
    const parsed = new URL(url.replace("{q}", "test"));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new HttpError(400, "Søke-adressen må begynne med http:// eller https://");
  }
  return url;
}

// The settings this round adds, checked for PATCH /api/settings.
export function runde13Settings(body: any, current: Settings, defaults: ChatTools): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (body.chatTools !== undefined) out.chatTools = body.chatTools === null ? undefined : chatToolsFromBody(body.chatTools, { ...defaults, ...current.chatTools });
  if (body.webSearchUrl !== undefined) out.webSearchUrl = checkSearchUrl(body.webSearchUrl);
  return out;
}
