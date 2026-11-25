// A project's own favicon or app icon, used as its icon in the sidebar when the user has not picked
// one. Only read, only files inside the project folder (symlinks that lead out are skipped), at
// most 256 KB, and looked up again at most every half minute.
//
// v1.4.0: the icon a project declares itself goes first: a <link rel="icon"> in its index.html,
// the icons in its web manifest, and electron-builder's build.icon in package.json. Every such
// path is relative and must resolve inside the project. Then the table of usual places below.
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_FAVICON_BYTES = 256 * 1024;
// The most read from an index.html, manifest or package.json while looking for a declared icon.
const MAX_DECLARING_BYTES = 512 * 1024;
// v1.2.0: more of the places projects keep their icon, from the project folder down. The first
// folder with a hit wins, and within it the first name. v1.4.0: app icon folders and names are
// added at the end, so a project that had an icon keeps the same one.
export const FAVICON_NAMES = [
  "favicon.ico", "favicon.svg", "favicon.png", "icon.svg", "icon.png", "apple-touch-icon.png", "logo.svg", "logo.png", "pack.png",
  "app-icon.svg", "app-icon.png", "app.svg", "app.png", "agentic-desktop.svg", "app-128.png", "app-64.png", "app-32.png",
  "icon-192.png", "icon-512.png", "favicon.webp", "icon.webp", "logo.webp",
];
export const FAVICON_DIRS = [
  "", "public", "static", "assets", "src", "src/assets", "app", "web/public", "web/src/assets", "desktop/build", "resources",
  "desktop/icons", "desktop/icons/png", "src-tauri/icons", "build", "icons", "assets/icons", "images", "img", "web/dist",
  "client/public", "frontend/public",
];
// Where a project's HTML page and web manifest usually are, relative to its folder.
export const FAVICON_HTML = ["index.html", "web/index.html", "public/index.html", "client/index.html", "frontend/index.html"];
export const FAVICON_MANIFESTS = ["manifest.json", "manifest.webmanifest", "public/manifest.json", "public/manifest.webmanifest", "web/public/manifest.json", "web/public/manifest.webmanifest", "site.webmanifest", "public/site.webmanifest"];
const TYPES: Record<string, string> = { ".ico": "image/x-icon", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
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

// The file at `candidate` as a favicon, if it is a small image of a known type inside the root.
function accept(root: string, candidate: string): Favicon | null {
  const type = TYPES[path.extname(candidate).toLowerCase()];
  if (!type) return null;
  try {
    // Checked twice: the path as written (no "..") and where it really leads (no symlink out).
    if (!inside(root, path.resolve(candidate))) return null;
    const real = realpathSync(candidate);
    if (!inside(root, real)) return null;
    const stat = statSync(real);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FAVICON_BYTES) return null;
    return { file: real, type, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
  } catch {
    return null;
  }
}

// A small text file inside the root, or null.
function readSmall(root: string, rel: string): string | null {
  try {
    const real = realpathSync(path.join(root, rel));
    if (!inside(root, real)) return null;
    const stat = statSync(real);
    if (!stat.isFile() || stat.size > MAX_DECLARING_BYTES) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

// A declared icon path, cleaned: no scheme, no protocol-relative address, no data URL, no query or
// hash, no NUL. Returns the path with its leading slash (if any) kept, so the caller knows whether
// it was absolute to the site.
export function cleanIconHref(href: string): string | null {
  let value = href.trim().replace(/^%PUBLIC_URL%/i, "").replace(/^%BASE_URL%/i, "/").replace(/^\{\{\s*base\s*\}\}/i, "/");
  if (!value || value.length > 512 || /[\u0000-\u001f]/.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("\\")) return null;
  value = value.replace(/[?#].*$/, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!value || value.includes("\u0000")) return null;
  return value;
}

// Each place a declared href can point at: the page's folder, the project folder and the usual
// public folders (Vite and Create React App serve /favicon.svg from public/).
function placesFor(root: string, baseDir: string, href: string): string[] {
  const clean = cleanIconHref(href);
  if (!clean) return [];
  if (clean.startsWith("/")) {
    const rel = clean.replace(/^\/+/, "");
    return [path.join(baseDir, "public", rel), path.join(baseDir, rel), path.join(root, "public", rel), path.join(root, rel)];
  }
  return [path.join(baseDir, clean), path.join(baseDir, "public", clean)];
}

const LINK = /<link\b[^>]*>/gi;
function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

// The icon hrefs in an HTML page, best first: rel="icon", then "shortcut icon", then apple-touch-icon.
export function htmlIconHrefs(html: string): string[] {
  const found: Array<{ href: string; rank: number }> = [];
  for (const tag of html.slice(0, MAX_DECLARING_BYTES).match(LINK) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const href = attr(tag, "href");
    if (!href) continue;
    const rank = rel.includes("icon") && !rel.includes("shortcut") ? 0 : rel.includes("icon") ? 1 : rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed") ? 2 : -1;
    if (rank >= 0) found.push({ href, rank });
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.href);
}

// The icons in a web manifest, the largest first (an SVG counts as the largest).
export function manifestIconSrcs(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const icons = data && typeof data === "object" && Array.isArray((data as { icons?: unknown }).icons) ? (data as { icons: unknown[] }).icons : [];
  const size = (entry: { sizes?: unknown; src: string }) => {
    if (/\.svg$/i.test(entry.src) || entry.sizes === "any") return Number.MAX_SAFE_INTEGER;
    const nums = String(entry.sizes ?? "").match(/\d+/g)?.map(Number) ?? [0];
    return Math.max(...nums);
  };
  return icons
    .filter((icon): icon is { src: string; sizes?: unknown } => !!icon && typeof icon === "object" && typeof (icon as { src?: unknown }).src === "string")
    .slice(0, 64)
    .map((icon) => ({ src: icon.src, size: size(icon) }))
    .sort((a, b) => b.size - a.size)
    .map((icon) => icon.src);
}

// electron-builder's build.icon (and the per-platform linux/win/mac icon), from package.json.
export function packageIconPaths(text: string): string[] {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const build = data && typeof data === "object" ? data.build : null;
  if (!build || typeof build !== "object") return [];
  const out: string[] = [];
  for (const value of [build.icon, build.linux?.icon, build.win?.icon, build.mac?.icon]) {
    if (typeof value === "string" && value) out.push(value);
  }
  return out;
}

// A declared electron-builder icon may be a file, a file without its extension, or a folder of sizes.
function fromBuilderPath(root: string, declared: string): Favicon | null {
  const clean = cleanIconHref(declared);
  if (!clean || clean.startsWith("/")) return null;
  const base = path.join(root, clean);
  const direct = accept(root, base);
  if (direct) return direct;
  if (!path.extname(base)) {
    for (const ext of [".png", ".svg", ".ico", ".webp"]) {
      const hit = accept(root, base + ext);
      if (hit) return hit;
    }
  }
  for (const name of ["512x512.png", "256x256.png", "128x128.png", "icon.png", "icon.svg", ...FAVICON_NAMES]) {
    const hit = accept(root, path.join(base, name));
    if (hit) return hit;
  }
  return null;
}

function declared(root: string): Favicon | null {
  for (const rel of FAVICON_HTML) {
    const html = readSmall(root, rel);
    if (html === null) continue;
    const baseDir = path.join(root, path.dirname(rel));
    for (const href of htmlIconHrefs(html)) {
      for (const place of placesFor(root, baseDir, href)) {
        const hit = accept(root, place);
        if (hit) return hit;
      }
    }
  }
  for (const rel of FAVICON_MANIFESTS) {
    const text = readSmall(root, rel);
    if (text === null) continue;
    const baseDir = path.join(root, path.dirname(rel));
    for (const src of manifestIconSrcs(text)) {
      for (const place of placesFor(root, baseDir, src)) {
        const hit = accept(root, place);
        if (hit) return hit;
      }
    }
  }
  const pkg = readSmall(root, "package.json");
  if (pkg !== null) {
    for (const icon of packageIconPaths(pkg)) {
      const hit = fromBuilderPath(root, icon);
      if (hit) return hit;
    }
  }
  return null;
}

function lookup(projectPath: string): Favicon | null {
  let root: string;
  try {
    root = realpathSync(projectPath);
  } catch {
    return null;
  }
  const own = declared(root);
  if (own) return own;
  for (const dir of FAVICON_DIRS) {
    for (const name of FAVICON_NAMES) {
      const hit = accept(root, path.join(root, dir, name));
      if (hit) return hit;
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
