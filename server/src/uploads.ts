// Text files from the user's disk, attached to a message. The browser reads them and sends the
// text; nothing here touches the user's disk. Kept in the data folder under a random id.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_TEXT_UPLOAD_BYTES } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";

const ID = /^[0-9a-f-]{36}$/;

function dir(dataDir: string): string {
  return path.join(dataDir, "uploads");
}

export function saveTextUpload(dataDir: string, name: unknown, text: unknown): string {
  if (typeof text !== "string") throw new HttpError(400, "Teksten mangler");
  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, "Filnavnet mangler");
  if (text.includes("\u0000")) throw new HttpError(415, `${name} ser ut som en binærfil. Bare tekstfiler kan legges ved.`);
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_UPLOAD_BYTES) throw new HttpError(413, `${name} er for stor (maks ${MAX_TEXT_UPLOAD_BYTES / 1024} kB)`);
  const id = randomUUID();
  mkdirSync(dir(dataDir), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir(dataDir), `${id}.txt`), text, { mode: 0o600, flag: "wx" }); // a new file, never through a link
  return id;
}

export function readTextUpload(dataDir: string, id: string): string | null {
  if (!ID.test(id)) return null;
  const file = path.join(dir(dataDir), `${id}.txt`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}
