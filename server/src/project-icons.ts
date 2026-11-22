// Icons the user uploads for a project (Innstillinger → Prosjekter → Velg fil). A small PNG, SVG,
// ICO or WebP, up to 256 KB, kept in <data dir>/project-icons/<uuid>.<ext> and named by the
// project's icon setting ("file:<uuid>.<ext>"). The bytes are checked against the type they claim,
// an SVG that carries a script is refused, and the file is only ever read from that one folder.
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isProjectIconFile, MAX_PROJECT_ICON_BYTES } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";

interface IconType {
  ext: "png" | "svg" | "ico" | "webp";
  magic: (bytes: Buffer) => boolean;
}

const TYPES: Record<string, IconType> = {
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  // An icon file starts with reserved 0, the type 1 (icon) and a count of images.
  "image/x-icon": { ext: "ico", magic: (b) => b.length > 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b[4] > 0 },
  "image/svg+xml": { ext: "svg", magic: (b) => isSafeSvg(b) },
};
// The same ICO under its other registered name.
TYPES["image/vnd.microsoft.icon"] = TYPES["image/x-icon"];

const MIME_BY_EXT: Record<string, string> = { png: "image/png", webp: "image/webp", ico: "image/x-icon", svg: "image/svg+xml" };

// An SVG is served sandboxed with a policy that runs nothing, but it should not carry anything
// active in the first place.
function isSafeSvg(bytes: Buffer): boolean {
  const text = bytes.toString("utf8");
  if (!/<svg[\s>]/i.test(text)) return false;
  return !/<script|<foreignObject|<iframe|<!ENTITY|javascript:|\son[a-z]+\s*=/i.test(text);
}

function dir(dataDir: string): string {
  return path.join(dataDir, "project-icons");
}

export function projectIconPath(dataDir: string, icon: string | null | undefined): string | null {
  if (!icon || !isProjectIconFile(icon)) return null;
  return path.join(dir(dataDir), icon.slice("file:".length));
}

// Saves the upload and returns the icon setting for it ("file:<uuid>.<ext>").
export function saveProjectIcon(dataDir: string, mime: unknown, base64: unknown): string {
  const type = typeof mime === "string" ? TYPES[mime.toLowerCase()] : undefined;
  if (!type) throw new HttpError(415, "Bare PNG, SVG, ICO og WebP kan brukes som prosjektikon");
  if (typeof base64 !== "string" || !base64) throw new HttpError(400, "Bildet mangler");
  // Check the size before decoding anything: base64 is four characters for every three bytes.
  if (base64.length > Math.ceil((MAX_PROJECT_ICON_BYTES * 4) / 3) + 8) throw new HttpError(413, `Ikonet er for stort (maks ${MAX_PROJECT_ICON_BYTES / 1024} KB)`);
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new HttpError(400, "Bildet er tomt");
  if (bytes.length > MAX_PROJECT_ICON_BYTES) throw new HttpError(413, `Ikonet er for stort (maks ${MAX_PROJECT_ICON_BYTES / 1024} KB)`);
  if (!type.magic(bytes)) throw new HttpError(415, "Filen er ikke et ikon av typen den sier");
  const name = `${randomUUID()}.${type.ext}`;
  mkdirSync(dir(dataDir), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir(dataDir), name), bytes, { mode: 0o600, flag: "wx" }); // a new file, never through a link
  return `file:${name}`;
}

export function projectIconExists(dataDir: string, icon: string): boolean {
  return readProjectIcon(dataDir, icon) !== null;
}

// The bytes and the type, or null. Opened without following links and read from the open file, so
// a link put in the folder cannot lead out of it.
export function readProjectIcon(dataDir: string, icon: string | null | undefined): { bytes: Buffer; type: string; version: number } | null {
  const file = projectIconPath(dataDir, icon);
  if (!file) return null;
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PROJECT_ICON_BYTES) return null;
    return { bytes: readFileSync(fd), type: MIME_BY_EXT[path.extname(file).slice(1)] ?? "application/octet-stream", version: Math.round(stat.mtimeMs) };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// The file is gone when the project stops using it. Safe to call with any icon value.
export function removeProjectIcon(dataDir: string, icon: string | null | undefined): void {
  const file = projectIconPath(dataDir, icon);
  if (file) rmSync(file, { force: true });
}
