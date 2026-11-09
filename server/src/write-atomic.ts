// Atomic writes for the files the app keeps in a folder it was given: memories, skills, AGENTS.md
// and settings.json in the global config folder or a project's .agentic/, and what is left of an
// old keys.json in the data folder (secrets.ts only ever takes keys out of it). The text goes to
// a new file with a random name in the target's own folder, opened with O_CREAT | O_EXCL |
// O_NOFOLLOW so nothing already there (such as a planted symlink) is followed, and is then renamed
// over the target. Refused when the target, or any folder between
// the root and it, is a symlink, or when the real folder is outside the root.
import { randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isInside, PathError } from "./paths.ts";

// mode is for a new file and goes through the umask, as with writeFileSync.
export function writeAtomic(file: string, text: string | Uint8Array, root: string, mode = 0o666): void {
  mkdirSync(root, { recursive: true });
  const rootReal = realpathSync(root);
  const rel = path.relative(isInside(rootReal, file) ? rootReal : path.resolve(root), path.resolve(file));
  const parts = rel.split(path.sep);
  if (!rel || parts[0] === ".." || path.isAbsolute(rel)) throw new PathError("Filen er utenfor mappen den hører til");
  const name = parts.pop()!;

  // Folder by folder from the real root, creating what is missing, and never through a symlink.
  let dir = rootReal;
  for (const part of parts) {
    dir = path.join(dir, part);
    let stat = lstatSync(dir, { throwIfNoEntry: false });
    if (!stat) {
      try {
        mkdirSync(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      stat = lstatSync(dir);
    }
    if (stat.isSymbolicLink()) throw new PathError(`${part} er en symbolsk lenke, så filen blir ikke skrevet`);
    if (!stat.isDirectory()) throw new PathError(`${part} er ikke en mappe`);
  }
  // Nothing on the way may have been swapped for a symlink since.
  const dirReal = realpathSync(dir);
  if (dirReal !== dir || !isInside(rootReal, dirReal)) throw new PathError("Mappen er utenfor mappen den hører til");
  const target = path.join(dir, name);
  if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new PathError(`${name} er en symbolsk lenke, så filen blir ikke skrevet`);

  const temp = path.join(dir, `.${name}.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    try {
      writeFileSync(fd, text);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}
