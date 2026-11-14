// Optional context has no background networking. Only the explicit settings action calls lookup.
import { MAX_MODEL_CONTEXT_LOCATION, modelContextOf, type ModelContextSettingsPatch, type Settings } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";

const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const cleanContextText = (value: string, max = MAX_MODEL_CONTEXT_LOCATION) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, max);

// Check the entire patch before storage; never accept truthy strings as booleans.
export function modelContextPatch(value: unknown, current: Settings): ModelContextSettingsPatch {
  if (!plainObject(value)) throw new HttpError(400, "Ugyldig modellkontekst");
  const out: ModelContextSettingsPatch = {};
  for (const [mode, fields] of Object.entries(value)) {
    if (mode !== "chat" && mode !== "code") throw new HttpError(400, "Ukjent modus for modellkontekst");
    if (!plainObject(fields)) throw new HttpError(400, "Ugyldig modellkontekst for modusen");
    const next = modelContextOf(current, mode);
    for (const [key, field] of Object.entries(fields)) {
      if (key === "dateTime" || key === "model" || key === "location") {
        if (typeof field !== "boolean") throw new HttpError(400, "Modellkontekst må være av eller på");
        next[key] = field;
      } else if (key === "locationText") {
        if (typeof field !== "string" || field.length > MAX_MODEL_CONTEXT_LOCATION) throw new HttpError(400, `Sted må være tekst på høyst ${MAX_MODEL_CONTEXT_LOCATION} tegn`);
        next.locationText = cleanContextText(field);
      } else if (key === "locationSource") {
        if (field !== "manual" && field !== "ip") throw new HttpError(400, "Ugyldig stedskilde");
        next.locationSource = field;
      } else if (key === "locationUpdatedAt") {
        if (field === null) next.locationUpdatedAt = undefined;
        else if (typeof field === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(field) && Number.isFinite(Date.parse(field))) next.locationUpdatedAt = field;
        else throw new HttpError(400, "Ugyldig tidspunkt for sted");
      } else throw new HttpError(400, "Ukjent felt for modellkontekst");
    }
    // Editing text is a manual correction unless the caller explicitly supplies provenance.
    if ("locationText" in fields && !("locationSource" in fields)) {
      next.locationSource = "manual";
      next.locationUpdatedAt = undefined;
    }
    if (next.locationSource === "manual") next.locationUpdatedAt = undefined;
    out[mode] = next;
  }
  return out;
}

export type ModelContextLookup = () => Promise<{ city: string; country: string }>;
const LOOKUP_URL = "https://ipapi.co/json/";
const MAX_LOOKUP_BYTES = 32 * 1024;
// The app host makes the request. IP addresses and coordinates are discarded, never returned.
export async function lookupModelContextLocation(fetcher: typeof fetch = fetch): Promise<{ city: string; country: string }> {
  const signal = AbortSignal.timeout(5000);
  let response: Response | undefined;
  try {
    response = await fetcher(LOOKUP_URL, { redirect: "error", signal, headers: { accept: "application/json" } });
    if (!response.ok || !response.body) throw new Error();
    if (Number(response.headers.get("content-length")) > MAX_LOOKUP_BYTES) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_LOOKUP_BYTES) throw new Error();
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.error || typeof body.city !== "string" || typeof body.country_name !== "string") throw new Error();
    const city = cleanContextText(body.city, 70);
    const country = cleanContextText(body.country_name, 70);
    if (!city || !country) throw new Error();
    return { city, country };
  } catch {
    await response?.body?.cancel().catch(() => undefined);
    throw new HttpError(502, "Kunne ikke hente omtrentlig sted. Prøv igjen eller skriv stedet selv.");
  }
}
