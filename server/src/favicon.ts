// A project's own favicon, used as its icon in the sidebar when the user has not picked one. Only
// read, only files inside the project folder (symlinks that lead out are skipped), at most
// 256 KB, and looked up again at most every half minute.
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_FAVICON_BYTES = 256 * 1024;
const NAMES = ["favicon.ico", "favicon.svg", "favicon.png", "icon.svg", "logo.svg"];
const DIRS = ["", "public", "static", "assets", "src", "app"];
const TYPES: Record<string, string> = { ".ico": "image/x-icon", ".svg": "image/svg+xml", ".png": "image/png" };
const FRESH_MS = 30_000;

export interface Favicon {
  file: string; // real path, inside the project
  type: string;
  size: number;
  mtimeMs: number;
}

const cache = new Map<string, { at: number; found: Favicon | null }>();

function inside(root: string, file: string): boolean {
  return file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function lookup(projectPath: string): Favicon | null {
  let root: string;
  try {
    root = realpathSync(projectPath);
  } catch {
    return null;
  }
  for (const dir of DIRS) {
    for (const name of NAMES) {
      try {
        const real = realpathSync(path.join(root, dir, name));
        if (!inside(root, real)) continue;
        const stat = statSync(real);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FAVICON_BYTES) continue;
        return { file: real, type: TYPES[path.extname(name)], size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
      } catch {
        // Not there: try the next place.
      }
    }
  }
  return null;
}

export function findFavicon(projectPath: string, now = Date.now()): Favicon | null {
  const hit = cache.get(projectPath);
  if (hit && now - hit.at < FRESH_MS) return hit.found;
  const found = lookup(projectPath);
  cache.set(projectPath, { at: now, found });
  return found;
}

export function forgetFavicon(projectPath: string): void {
  cache.delete(projectPath);
}
