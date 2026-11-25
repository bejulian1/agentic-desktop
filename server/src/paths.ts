// The one path check. Agent tools, the REST API and the preview server all go through here.
import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Project } from "../../shared/protocol.ts";
import type { Store } from "./db.ts";

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

// Where keys, tokens, logins and browser profiles live under a home folder. Kode without a project
// works in the home folder (Denne datamaskinen), so these always ask before a file tool touches
// them, and search and glob leave them out. The same names inside a project are treated alike.
export const SENSITIVE_HOME_PATHS = [
  ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker/config.json", ".netrc", ".npmrc", ".pypirc", ".git-credentials",
  ".password-store", ".local/share/keyrings", ".mozilla", ".config/google-chrome", ".config/chromium", ".config/BraveSoftware",
  ".config/gh", ".config/op", ".config/agentic-desktop", ".local/share/agentic-desktop", ".claude/.credentials.json", ".claude.json",
  ".codex/auth.json", ".bash_history", ".zsh_history",
];

export function isSensitiveHomePath(rel: string): boolean {
  const normal = rel.split(path.sep).join("/");
  return SENSITIVE_HOME_PATHS.some((entry) => normal === entry || normal.startsWith(`${entry}/`));
}

// Paths that always need approval, in every permission mode.
export function isProtectedPath(rel: string): boolean {
  if (isSensitiveHomePath(rel)) return true;
  const parts = rel.split(path.sep);
  if (parts.some((part) => part.startsWith(".env"))) return true;
  const gitAt = parts.lastIndexOf(".git");
  if (gitAt === -1) return false;
  const next = parts[gitAt + 1];
  return next === "hooks" || next === "config";
}

// The ways a command can name one of the app's own folders: the real path, and, under the home
// folder, ~/…, $HOME/… and ${HOME}/….
function folderForms(dir: string, home: string): string[] {
  const forms = [dir];
  if (home && dir.startsWith(`${home}/`)) {
    const rel = dir.slice(home.length + 1);
    forms.push(`~/${rel}`, `$HOME/${rel}`, `\${HOME}/${rel}`);
  }
  return forms;
}

// The default places, whatever the folders are this time, and the app's own files by name.
const APP_FOLDER = /(?:\.local\/share|\.config|\$\{?XDG_(?:DATA|CONFIG)_HOME\}?)\/agentic-desktop(?:\/|\s|;|&|\||\)|$)/;
const APP_FILE = /agentic-desktop\/(?:keys\.json|hooks\.json|harness\.json|agentic-desktop\.db)/;

// Text matching, so a best effort: commands run as the user, and an OS sandbox is out of scope.
// It catches the plain ways to name the app's data and config folders (where hooks.json, the
// database and settings live), so writing there from a model's command always asks. It does not
// catch a path built at run time (variables, globs, cd and a relative path, a script file).
export function isProtectedCommand(command: string, dataDir: string, configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "agentic-desktop")): boolean {
  // Quotes and doubled slashes do not change the path the shell sees.
  const text = command.replace(/["']/g, "").replace(/\/{2,}/g, "/");
  if (/\.env|\.git\/(hooks|config)/.test(text) || APP_FOLDER.test(text) || APP_FILE.test(text)) return true;
  // Keys, tokens and browser profiles under the home folder: a command that names one always asks.
  if (SENSITIVE_HOME_PATHS.some((entry) => text.includes(entry))) return true;
  const home = homedir().replace(/\/+$/, "");
  return [dataDir, configDir].some((dir) => folderForms(dir.replace(/\/+$/, ""), home).some((form) => text.includes(form)));
}

// Denne datamaskinen (round 9, SPEC 21.9): the panel without a project. Its key in place of a
// project id, for the terminal and the Browser panel, and for the agent in Kode without a project,
// which then works in the home folder (Runner.localProject).
export const LOCAL_PANEL = "local";

// This machine has no stored project. The shell still needs a scope and starting folder.
export function localPanelProject(folder: string, store: Pick<Store, "settings">): Project {
  return { id: LOCAL_PANEL, name: "Denne datamaskinen", path: folder, permissionMode: store.settings().defaultPermissionMode ?? "ask", createdAt: 0, lastUsedAt: 0, color: null, icon: null, defaultModelId: null, pinned: false };
}

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
