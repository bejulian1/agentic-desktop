// The one path check. Agent tools, the REST API and the preview server all go through here.
import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export class PathError extends Error {
  status = 403;
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

// realpath that also works for paths that do not exist yet, by resolving the deepest existing
// ancestor. A dangling symlink is refused, since writing through it would land wherever it points.
export function realDeepest(target: string): string {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(realpathSync(current), ...missing);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw new PathError(`Ugyldig sti: ${code}`);
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new PathError("Stien går gjennom en brutt symlenke");
      }
      const parent = path.dirname(current);
      if (parent === current) throw new PathError("Ugyldig sti");
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

export interface SafePath {
  abs: string; // real path on disk
  rel: string; // relative to the project root, "." for the root
}

export function guardPath(root: string, input: string, dataDir: string): SafePath {
  if (typeof input !== "string" || input.includes("\0")) throw new PathError("Ugyldig sti");
  const rootReal = realpathSync(root);
  const abs = realDeepest(path.resolve(rootReal, input));
  if (!isInside(rootReal, abs)) throw new PathError("Stien er utenfor prosjektmappen");
  assertOutsideDataDir(abs, dataDir);
  return { abs, rel: path.relative(rootReal, abs) || "." };
}

export function assertOutsideDataDir(abs: string, dataDir: string): void {
  if (isInside(dataDir, abs)) throw new PathError("Appens datamappe er ikke tilgjengelig");
}

// Project roots: absolute, not the filesystem root, and never overlapping the data dir,
// which holds the token and the API keys.
export function guardProjectRoot(input: string, dataDir: string): string {
  if (typeof input !== "string" || !path.isAbsolute(input) || input.includes("\0")) {
    throw new PathError("Prosjektmappen må være en absolutt sti");
  }
  const abs = realDeepest(path.normalize(input));
  if (abs === path.parse(abs).root) throw new PathError("Filsystemets rot kan ikke være et prosjekt");
  if (isInside(dataDir, abs) || isInside(abs, dataDir)) {
    throw new PathError("Prosjektmappen kan ikke overlappe appens datamappe");
  }
  return abs;
}

// Paths that always need approval, in every permission mode.
export function isProtectedPath(rel: string): boolean {
  const parts = rel.split(path.sep);
  if (parts.some((part) => part.startsWith(".env"))) return true;
  const gitAt = parts.lastIndexOf(".git");
  if (gitAt === -1) return false;
  const next = parts[gitAt + 1];
  return next === "hooks" || next === "config";
}

// Text matching, so a best effort: commands run as the user, and an OS sandbox is out of scope.
export function isProtectedCommand(command: string, dataDir: string): boolean {
  return /\.env|\.git\/(hooks|config)/.test(command) || command.includes(dataDir) || command.includes("agentic-desktop/keys.json");
}

// Denne datamaskinen (round 9, SPEC 21.9): the panel without a project. Its key in place of a
// project id, for the terminal and the Browser panel only; no agent tool ever takes it.
export const LOCAL_PANEL = "local";

// The folder a terminal without a project starts in: the home folder, as its real path, an existing
// directory, not the filesystem root, and never inside the app's data folder. The project rule that
// a folder may not hold the data folder cannot apply, since the home folder holds it by default;
// the shell is the user's own, as any terminal on the machine is, and the agent never uses it.
export function localFolder(dataDir: string, home = homedir()): string {
  let real: string;
  try {
    real = realpathSync(home);
    if (!statSync(real).isDirectory()) throw new Error();
  } catch {
    throw new PathError("Fant ikke hjemmemappen");
  }
  if (real === path.parse(real).root) throw new PathError("Filsystemets rot kan ikke være arbeidsmappen");
  if (isInside(dataDir, real)) throw new PathError("Appens datamappe er ikke tilgjengelig");
  return real;
}
