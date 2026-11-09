// Images attached to a message. They are uploaded on their own first, so a message only carries
// ids. The bytes are checked against the type, and only four plain image types are kept.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_IMAGE_BYTES } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { ext: "gif", magic: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
};

const ID = /^[0-9a-f-]{36}$/;

function dir(dataDir: string): string {
  return path.join(dataDir, "images");
}

export function saveImage(dataDir: string, mime: unknown, base64: unknown): string {
  const type = typeof mime === "string" ? TYPES[mime] : undefined;
  if (!type) throw new HttpError(415, "Bare PNG, JPEG, WebP og GIF kan legges ved");
  if (typeof base64 !== "string" || !base64) throw new HttpError(400, "Bildet mangler");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, `Bildet er for stort (maks ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
  if (!type.magic(bytes)) throw new HttpError(415, "Filen er ikke et bilde av typen den sier");
  const id = randomUUID();
  mkdirSync(dir(dataDir), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir(dataDir), `${id}.${type.ext}`), bytes, { mode: 0o600, flag: "wx" }); // a new file, never through a link
  return id;
}

export function findImage(dataDir: string, id: string): { file: string; mime: string } | null {
  if (!ID.test(id)) return null;
  for (const [mime, type] of Object.entries(TYPES)) {
    const file = path.join(dir(dataDir), `${id}.${type.ext}`);
    if (existsSync(file)) return { file, mime };
  }
  return null;
}

export function readImage(dataDir: string, id: string): { mime: string; base64: string } | null {
  const found = findImage(dataDir, id);
  return found ? { mime: found.mime, base64: readFileSync(found.file).toString("base64") } : null;
}
