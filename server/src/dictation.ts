import { audioLimit, speechTarget } from '../../shared/dictation.ts';
import type { Store } from './db.ts';
import { HttpError } from './errors.ts';
import { apiKeyFor } from './providers/index.ts';
import { compatibleAuthHeaders, providerPreset } from './providers/presets.ts';
import type { Secrets } from './secrets.ts';

export async function transcribe(store: Store, secrets: Secrets, body: Record<string, unknown>, signal: AbortSignal) {
  const target = speechTarget(store.settings(), store.providers());
  if (!target || body.providerId !== target.providerId || body.baseUrl !== target.baseUrl || body.model !== target.model) throw new HttpError(409, 'Leverandøren for diktering er endret. Kontroller innstillingene og ta opp på nytt.');
  const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4' };
  const mime = String(body.mime).split(';')[0];
  if (!Object.hasOwn(extensions, mime) || typeof body.audio !== 'string' || !body.audio.length || body.audio.length > Math.ceil(audioLimit / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio)) throw new HttpError(400, 'Tomt, for stort eller ugyldig lydopptak.');
  const form = new FormData();
  form.set('model', target.model);
  form.set('file', new Blob([Buffer.from(body.audio, 'base64')], { type: mime }), `opptak.${extensions[mime]}`);
  const provider = store.provider(target.providerId)!;
  const headers = compatibleAuthHeaders(apiKeyFor(provider, secrets), providerPreset(provider.presetId)?.authHeader);
  try {
    const res = await fetch(`${target.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, { method: 'POST', headers, body: form, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
    if (!res.ok) throw new HttpError(502, `Leverandøren avviste opptaket (${res.status}). Kontroller modell, API-nøkkel og støtte for transkripsjon.`);
    const { text } = await res.json();
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(422, 'Fant ingen tale i opptaket.');
    return { text: text.trim() };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'Fikk ikke svar fra taleleverandøren. Kontroller adressen og prøv igjen.');
  }
}
