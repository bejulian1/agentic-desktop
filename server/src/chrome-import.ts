// Round 10 (SPEC 23.1): bookmarks and, if asked for, history from a Chrome or Chromium profile on
// this machine, for the Browser panel's new tab page and ⋯ menu.
//
// What is read, and only when the user asks for it in Innstillinger → Nettleser or on Ny fane:
// - `Bookmarks` (JSON) in the chosen profile folder.
// - `History` (SQLite), copied to a private temporary file that is opened read-only and removed
//   right after. Chrome's own file is never opened by SQLite, so a running Chrome is not disturbed.
// Never `Cookies`, `Login Data`, `Web Data`, sessions or anything else in the profile; those names
// do not occur below. Symlinks are not followed, so a profile cannot point the reader elsewhere.
// The result is kept in the app's data folder as browser-import.json, and can be removed again.
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrowserImported, ChromeBrowserKind, ChromeImportPreview, ChromeProfileInfo, ImportedBookmark, ImportedVisit } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";
import { writeAtomic } from "./write-atomic.ts";

const MAX_BOOKMARKS_FILE = 20 * 1024 * 1024;
const MAX_HISTORY_FILE = 200 * 1024 * 1024;
export const MAX_BOOKMARKS = 5000;
export const MAX_HISTORY = 1000;
const SAMPLE = 8;
const FILE = "browser-import.json";

// Chrome counts microseconds from 1601-01-01.
const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000;

const BROWSERS: Array<{ kind: ChromeBrowserKind; folder: string; name: string }> = [
  { kind: "chrome", folder: "google-chrome", name: "Google Chrome" },
  { kind: "chromium", folder: "chromium", name: "Chromium" },
];

const ROOT_NAMES: Record<string, string> = { bookmark_bar: "Bokmerkelinjen", other: "Andre bokmerker", synced: "Mobilbokmerker" };

// Where Chrome keeps its profiles: $XDG_CONFIG_HOME, else ~/.config. A home folder given by the app
// (tests set a temporary one) is used on its own, so a test never reaches the user's real profile.
export function chromeConfigHome(home?: string): string {
  if (home) return path.join(home, ".config");
  return process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
}

function profileLabel(browserName: string, profile: string): string {
  const name = profile === "Default" ? "Standard" : /^Profile (\d+)$/.exec(profile) ? `Profil ${/^Profile (\d+)$/.exec(profile)![1]}` : profile;
  return `${browserName} · ${name}`;
}

// A regular file, not a symlink, not too big. Anything else counts as missing.
function regularFile(file: string, max: number): boolean {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  return !!stat && stat.isFile() && stat.size > 0 && stat.size <= max;
}

function realFolder(dir: string): boolean {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  return !!stat && stat.isDirectory();
}

export function listChromeProfiles(configHome: string): ChromeProfileInfo[] {
  const out: ChromeProfileInfo[] = [];
  for (const browser of BROWSERS) {
    const root = path.join(configHome, browser.folder);
    if (!realFolder(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const profile of entries.sort((a, b) => (a === "Default" ? -1 : b === "Default" ? 1 : a.localeCompare(b, "nb", { numeric: true })))) {
      const dir = path.join(root, profile);
      const bookmarks = regularFile(path.join(dir, "Bookmarks"), MAX_BOOKMARKS_FILE);
      const history = regularFile(path.join(dir, "History"), MAX_HISTORY_FILE);
      if (bookmarks || history) out.push({ browser: browser.kind, profile, label: profileLabel(browser.name, profile), bookmarks, history });
    }
  }
  return out;
}

// The chosen profile folder, checked: a known browser, a plain folder name, a real folder.
function profileDir(configHome: string, browser: unknown, profile: unknown): { dir: string; label: string; browser: ChromeBrowserKind; profile: string } {
  const known = BROWSERS.find((b) => b.kind === browser);
  if (!known) throw new HttpError(400, "Ukjent nettleser");
  if (typeof profile !== "string" || !profile || profile.length > 80 || profile === "." || profile === ".." || /[/\\\0]/.test(profile)) {
    throw new HttpError(400, "Ugyldig profil");
  }
  const root = path.join(configHome, known.folder);
  const dir = path.join(root, profile);
  if (!realFolder(root) || !realFolder(dir)) throw new HttpError(404, "Fant ikke profilen");
  return { dir, label: profileLabel(known.name, profile), browser: known.kind, profile };
}

const webUrl = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url) && url.length <= 2048;
const cleanTitle = (title: unknown, url: string) => (typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : url);

function readBookmarks(dir: string): ImportedBookmark[] {
  const file = path.join(dir, "Bookmarks");
  if (!regularFile(file, MAX_BOOKMARKS_FILE)) return [];
  let data: any;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new HttpError(422, "Bokmerkefilen kunne ikke leses");
  }
  const out: ImportedBookmark[] = [];
  const seen = new Set<string>();
  const walk = (node: any, folder: string, depth: number) => {
    if (!node || typeof node !== "object" || depth > 30 || out.length >= MAX_BOOKMARKS) return;
    if (node.type === "url") {
      if (webUrl(node.url) && !seen.has(node.url)) {
        seen.add(node.url);
        out.push({ title: cleanTitle(node.name, node.url), url: node.url, folder });
      }
      return;
    }
    if (Array.isArray(node.children)) {
      const name = typeof node.name === "string" ? node.name.trim().slice(0, 80) : "";
      const next = depth === 0 ? folder : folder ? `${folder} / ${name}` : name;
      for (const child of node.children) walk(child, next, depth + 1);
    }
  };
  const roots = data?.roots && typeof data.roots === "object" ? data.roots : {};
  for (const key of ["bookmark_bar", "other", "synced"]) {
    if (roots[key]) walk(roots[key], ROOT_NAMES[key], 0);
  }
  return out;
}

function readHistory(dir: string): ImportedVisit[] {
  const file = path.join(dir, "History");
  if (!regularFile(file, MAX_HISTORY_FILE)) return [];
  const temp = mkdtempSync(path.join(tmpdir(), "ad-chrome-history-"));
  const copy = path.join(temp, "History");
  try {
    copyFileSync(file, copy);
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(copy, { readOnly: true });
      // The time is turned into milliseconds since 1970 in SQL: Chrome's microseconds since 1601 are
      // too large for a JavaScript number.
      const rows = db.prepare(`SELECT url, title, visit_count, CASE WHEN last_visit_time > 0 THEN last_visit_time / 1000 - ${WEBKIT_EPOCH_OFFSET_MS} ELSE 0 END AS visited FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?`)
        .all(MAX_HISTORY * 3) as Array<{ url: unknown; title: unknown; visit_count: unknown; visited: unknown }>;
      const out: ImportedVisit[] = [];
      for (const row of rows) {
        if (!webUrl(row.url)) continue;
        out.push({ title: cleanTitle(row.title, row.url), url: row.url, visitedAt: Math.max(0, Number(row.visited) || 0), visits: Math.max(0, Number(row.visit_count) || 0) });
        if (out.length >= MAX_HISTORY) break;
      }
      return out;
    } catch {
      throw new HttpError(422, "Historikken kunne ikke leses");
    } finally {
      db?.close();
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function read(configHome: string, body: { browser?: unknown; profile?: unknown; history?: unknown }) {
  const chosen = profileDir(configHome, body.browser, body.profile);
  const bookmarks = readBookmarks(chosen.dir);
  const history = body.history === true ? readHistory(chosen.dir) : [];
  return { source: { browser: chosen.browser, profile: chosen.profile, label: chosen.label }, bookmarks, history };
}

export function previewChromeImport(configHome: string, body: { browser?: unknown; profile?: unknown; history?: unknown }): ChromeImportPreview {
  const found = read(configHome, body);
  return {
    source: found.source,
    bookmarks: found.bookmarks.length,
    history: found.history.length,
    sampleBookmarks: found.bookmarks.slice(0, SAMPLE),
    sampleHistory: found.history.slice(0, SAMPLE),
  };
}

export function runChromeImport(configHome: string, dataDir: string, body: { browser?: unknown; profile?: unknown; history?: unknown }): BrowserImported {
  const found = read(configHome, body);
  if (!found.bookmarks.length && !found.history.length) throw new HttpError(422, "Fant ingenting å importere i profilen");
  const imported: BrowserImported = { importedAt: Date.now(), source: found.source, bookmarks: found.bookmarks, history: found.history };
  writeAtomic(path.join(dataDir, FILE), JSON.stringify(imported), dataDir, 0o600);
  return imported;
}

const EMPTY: BrowserImported = { importedAt: null, source: null, bookmarks: [], history: [] };

export function readImported(dataDir: string): BrowserImported {
  const file = path.join(dataDir, FILE);
  if (!existsSync(file)) return EMPTY;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as BrowserImported;
    return {
      importedAt: typeof data.importedAt === "number" ? data.importedAt : null,
      source: data.source ?? null,
      bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks.filter((b) => webUrl(b?.url)) : [],
      history: Array.isArray(data.history) ? data.history.filter((v) => webUrl(v?.url)) : [],
    };
  } catch {
    return EMPTY;
  }
}

export function removeImported(dataDir: string): void {
  rmSync(path.join(dataDir, FILE), { force: true });
}
