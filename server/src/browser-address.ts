import { HttpError } from "./errors.ts";

// Without a project, a bare address is a web host, never a project-relative preview file.
export function localBrowserAddress(input: string): string {
  if (typeof input !== "string" || !input.trim() || input.length > 8192 || /[\u0000-\u0020\\]/.test(input.trim())) throw new HttpError(400, "Ugyldig nettadresse");
  const raw = input.trim();
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(raw)) return `http://${raw}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/?#]+:\d+([/?#]|$)/.test(raw)) return raw;
  if (raw.startsWith("/") || raw.startsWith(".")) throw new HttpError(400, "Skriv inn en nettadresse. Lokale filstier åpnes i Filer-panelet.");
  try {
    const url = new URL(`https://${raw}`);
    if (!url.hostname || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new HttpError(400, "Ugyldig nettadresse");
  }
}
