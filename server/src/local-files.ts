// Manual file-panel reads only. Agent tools keep their project-root guard in files.ts/paths.ts.
import { closeSync, constants, fstatSync, openSync, opendirSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { FileContent, FileEntry } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";
import { looksBinary, MAX_TEXT_FILE } from "./files.ts";
import { isInside, PathError } from "./paths.ts";

const MAX_PATH_BYTES = 4096;
const MAX_DIRECTORY_ENTRIES = 5000;

function outsideDataDir(target: string, dataDir: string): void {
  if (isInside(path.resolve(dataDir), target) || isInside(realpathSync(dataDir), target)) throw new PathError("Appens datamappe er ikke tilgjengelig");
}

export function localReadPath(input: string, dataDir: string): string {
  if (typeof input !== "string" || !path.isAbsolute(input) || input.includes("\0") || Buffer.byteLength(input) > MAX_PATH_BYTES || input.split(path.sep).includes("..")) {
    throw new HttpError(400, "Velg en gyldig absolutt sti uten ..");
  }
  const absolute = path.resolve(input);
  outsideDataDir(absolute, dataDir);
  const real = realpathSync(absolute);
  outsideDataDir(real, dataDir);
  return real;
}

export function listLocalDir(input: string, dataDir: string): FileEntry[] {
  const directory = localReadPath(input, dataDir);
  const entries: FileEntry[] = [];
  const handle = opendirSync(directory);
  try {
    let count = 0;
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      if (++count > MAX_DIRECTORY_ENTRIES) throw new HttpError(413, "Mappen har for mange oppføringer. Velg en mindre mappe.");
      const absolute = path.join(directory, entry.name);
      try {
        const real = localReadPath(absolute, dataDir);
        const stat = statSync(real);
        if (!stat.isDirectory() && !stat.isFile()) continue;
        entries.push({ name: entry.name, path: absolute, kind: stat.isDirectory() ? "dir" : "file", ...(stat.isFile() ? { size: stat.size } : {}) });
      } catch (error) {
        if (error instanceof PathError || ["ENOENT", "EACCES", "EPERM", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw error;
      }
    }
  } finally {
    handle.closeSync();
  }
  return entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, "nb") : a.kind === "dir" ? -1 : 1);
}

export function readLocalFile(input: string, dataDir: string): FileContent {
  const absolute = localReadPath(input, dataDir);
  // Nonblocking + regular-file checks keep FIFOs/devices from hanging the server.
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new HttpError(400, "Velg en vanlig fil");
    // On Linux, check the opened file too, so a replaced ancestor symlink cannot expose app data.
    if (process.platform === "linux") outsideDataDir(realpathSync(`/proc/self/fd/${fd}`), dataDir);
    const data = Buffer.alloc(Math.min(stat.size, MAX_TEXT_FILE));
    let length = 0;
    while (length < data.length) {
      const read = readSync(fd, data, length, data.length - length, length);
      if (!read) break;
      length += read;
    }
    const bytes = data.subarray(0, length);
    const binary = looksBinary(bytes);
    return { path: absolute, text: binary ? null : new TextDecoder().decode(bytes), size: stat.size, binary, truncated: stat.size > MAX_TEXT_FILE };
  } finally {
    closeSync(fd);
  }
}
