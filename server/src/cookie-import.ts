// Round 12 (SPEC 26.4): cookies from Chrome, Chromium or Firefox on this machine, so the user is
// signed in to their sites in the app's own Browser panel.
//
// What is read, and only when the user asks for it in the dialog:
// - Chrome and Chromium: the profile's `Cookies` database (or `Network/Cookies`).
// - Firefox: the profile's `cookies.sqlite`.
// Each is copied to a private temporary folder (with its -wal file, if there is one) and opened
// there, so a running browser's lock does not matter and its own file is never opened by SQLite.
// The copy is removed right after. Passwords, cards, autofill, history and sessions are never
// read; no other file in the profile is opened. Symlinks are not followed.
//
// Chrome and Chromium on Linux encrypt the values. v10 uses the fixed key every Linux build knows;
// v11 uses a password from the system keyring, which is fetched with `secret-tool` only in the
// moment the user imports, and only when a chosen site has v11 cookies. The key is derived with
// PBKDF2 and the values are decrypted with AES-128-CBC, both from node:crypto.
//
// Listing the sites reads host names, counts and times only; nothing is decrypted until import.
import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { accessSync, constants, copyFileSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CookieBrowserKind, CookieImportResult, CookieProfileInfo, CookieSiteInfo, CookieSiteList } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";

const MAX_DB_FILE = 256 * 1024 * 1024;
const MAX_VALUE = 4096;
export const MAX_IMPORT_COOKIES = 10_000;
const MAX_SITES = 5000;
const KEYRING_TIMEOUT_MS = 60_000; // the keyring may ask the user to unlock it

// Chrome counts microseconds from 1601-01-01.
const WEBKIT_EPOCH_OFFSET_S = 11_644_473_600;

// A cookie as Playwright's addCookies takes it.
export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
  expires: number; // seconds since 1970, or -1 for a session cookie
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface ReadCookie {
  site: string;
  cookie: BrowserCookie;
}

interface Root {
  browser: CookieBrowserKind;
  prefix: string; // "" or "snap:" / "flatpak:" in the profile id
  name: string; // «Chrome», «Chromium (snap)»
  dir: string;
}

// Where each browser keeps its profiles. home is the user's home folder (tests give a temporary
// one), configHome is $XDG_CONFIG_HOME or ~/.config for that home.
export function cookieRoots(home: string, configHome: string): Root[] {
  return [
    { browser: "chrome", prefix: "", name: "Chrome", dir: path.join(configHome, "google-chrome") },
    { browser: "chromium", prefix: "", name: "Chromium", dir: path.join(configHome, "chromium") },
    { browser: "chromium", prefix: "snap:", name: "Chromium (snap)", dir: path.join(home, "snap/chromium/common/chromium") },
    { browser: "firefox", prefix: "", name: "Firefox", dir: path.join(home, ".mozilla/firefox") },
    { browser: "firefox", prefix: "snap:", name: "Firefox (snap)", dir: path.join(home, "snap/firefox/common/.mozilla/firefox") },
    { browser: "firefox", prefix: "flatpak:", name: "Firefox (Flatpak)", dir: path.join(home, ".var/app/org.mozilla.firefox/.mozilla/firefox") },
  ];
}

export function defaultHome(): string {
  return homedir();
}

function regularFile(file: string, max = MAX_DB_FILE): boolean {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  return !!stat && stat.isFile() && stat.size > 0 && stat.size <= max;
}

function realFolder(dir: string): boolean {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  return !!stat && stat.isDirectory();
}

// The cookie database in a profile folder, or null.
function cookieFile(browser: CookieBrowserKind, dir: string): string | null {
  const candidates = browser === "firefox" ? ["cookies.sqlite"] : [path.join("Network", "Cookies"), "Cookies"];
  for (const rel of candidates) {
    const parent = path.dirname(path.join(dir, rel));
    if (parent !== dir && !realFolder(parent)) continue;
    if (regularFile(path.join(dir, rel))) return path.join(dir, rel);
  }
  return null;
}

function chromeLabel(name: string, profile: string): string {
  const numbered = /^Profile (\d+)$/.exec(profile);
  return `${name} · ${profile === "Default" ? "Standard" : numbered ? `Profil ${numbered[1]}` : profile}`;
}

// Firefox names its profiles in profiles.ini. Only Name and Path are read from it.
function firefoxNames(root: string): Map<string, string> {
  const names = new Map<string, string>();
  const file = path.join(root, "profiles.ini");
  if (!regularFile(file, 256 * 1024)) return names;
  let name = "";
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) name = "";
    else if (line.startsWith("Name=")) name = line.slice(5).trim().slice(0, 60);
    else if (line.startsWith("Path=") && name) names.set(path.basename(line.slice(5).trim()), name);
  }
  return names;
}

export function listCookieProfiles(home: string, configHome: string): CookieProfileInfo[] {
  const out: CookieProfileInfo[] = [];
  for (const root of cookieRoots(home, configHome)) {
    if (!realFolder(root.dir)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root.dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    const names = root.browser === "firefox" ? firefoxNames(root.dir) : new Map<string, string>();
    entries.sort((a, b) => (a === "Default" ? -1 : b === "Default" ? 1 : a.localeCompare(b, "nb", { numeric: true })));
    for (const profile of entries) {
      if (!cookieFile(root.browser, path.join(root.dir, profile))) continue;
      const label = root.browser === "firefox"
        ? `${root.name} · ${names.get(profile) ?? (profile.includes(".") ? profile.slice(profile.indexOf(".") + 1) : profile)}`
        : chromeLabel(root.name, profile);
      out.push({ browser: root.browser, profile: `${root.prefix}${profile}`, label });
    }
  }
  return out;
}

// The chosen profile, checked: a known browser, a plain folder name, a real folder with a database.
function chosenProfile(home: string, configHome: string, browser: unknown, profile: unknown): { file: string; label: string; browser: CookieBrowserKind; profile: string } {
  if (browser !== "chrome" && browser !== "chromium" && browser !== "firefox") throw new HttpError(400, "Ukjent nettleser");
  if (typeof profile !== "string" || !profile || profile.length > 120) throw new HttpError(400, "Ugyldig profil");
  const match = /^(snap:|flatpak:)?(.+)$/.exec(profile)!;
  const prefix = match[1] ?? "";
  const folder = match[2];
  if (folder === "." || folder === ".." || /[/\\\0]/.test(folder)) throw new HttpError(400, "Ugyldig profil");
  const root = cookieRoots(home, configHome).find((r) => r.browser === browser && r.prefix === prefix);
  if (!root) throw new HttpError(400, "Ugyldig profil");
  const dir = path.join(root.dir, folder);
  if (!realFolder(root.dir) || !realFolder(dir)) throw new HttpError(404, "Fant ikke profilen");
  const file = cookieFile(root.browser, dir);
  if (!file) throw new HttpError(404, "Profilen har ingen informasjonskapsler");
  const label = listCookieProfiles(home, configHome).find((p) => p.browser === browser && p.profile === profile)?.label ?? `${root.name} · ${folder}`;
  return { file, label, browser: root.browser, profile };
}

// The registrable part of a host, so «mail.example.com» and «.example.com» are one site. A short
// list of shared suffixes keeps «example.co.uk» and «someone.github.io» apart from their neighbours.
const SHARED_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp", "or.jp",
  "com.br", "com.cn", "co.in", "co.kr", "com.mx", "com.tr", "co.za", "com.sg", "com.hk", "com.tw", "priv.no",
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "herokuapp.com", "appspot.com", "blogspot.com", "web.app", "firebaseapp.com",
]);

export function siteOf(host: string): string {
  const clean = host.replace(/^\./, "").toLowerCase();
  if (!clean.includes(".") || /^[\d.]+$/.test(clean) || clean.includes(":")) return clean;
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;
  if (SHARED_SUFFIXES.has(parts.slice(-2).join("."))) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

const VALID_HOST = /^\.?[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?$/i;
const VALID_NAME = /^[^\s;,=\x00-\x1f\x7f]{1,256}$/;
const VALID_VALUE = /^[^;\x00-\x1f\x7f]*$/;

// The database is copied with its write-ahead log into a temporary folder that only this process
// knows, opened there, and removed again.
function withCopy<T>(file: string, read: (db: DatabaseSync) => T): T {
  const temp = mkdtempSync(path.join(tmpdir(), "ad-cookies-"));
  const copy = path.join(temp, "cookies.db");
  let db: DatabaseSync | undefined;
  try {
    copyFileSync(file, copy);
    if (regularFile(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`);
    db = new DatabaseSync(copy);
    return read(db);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, "Informasjonskapslene kunne ikke leses");
  } finally {
    db?.close();
    rmSync(temp, { recursive: true, force: true });
  }
}

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
}

interface Row {
  host: string;
  name: string;
  value: string;
  encrypted: Uint8Array | null;
  path: string;
  expires: number; // seconds since 1970, 0 for a session cookie
  secure: boolean;
  httpOnly: boolean;
  sameSite: number; // Chrome: -1 unset, 0 none, 1 lax, 2 strict. Firefox: 0 none, 1 lax, 2 strict
  lastUsed: number; // ms since 1970
}

// Times are turned into seconds and milliseconds since 1970 in SQL: Chrome's microseconds since
// 1601 are too large for a JavaScript number.
function chromeRows(db: DatabaseSync, withValues: boolean): Row[] {
  const cols = columns(db, "cookies");
  const pick = (...names: string[]) => names.find((n) => cols.has(n));
  const secure = pick("is_secure", "secure") ?? "0";
  const httpOnly = pick("is_httponly", "httponly") ?? "0";
  const sameSite = pick("samesite") ?? "-1";
  const lastUsed = cols.has("last_access_utc") ? `CASE WHEN last_access_utc > 0 THEN last_access_utc / 1000 - ${WEBKIT_EPOCH_OFFSET_S * 1000} ELSE 0 END` : "0";
  const persistent = cols.has("is_persistent") ? "is_persistent" : cols.has("has_expires") ? "has_expires" : "1";
  const values = withValues ? "value, encrypted_value" : "'' AS value, NULL AS encrypted_value";
  const rows = db.prepare(
    `SELECT host_key AS host, name, ${values}, path, ` +
    `CASE WHEN ${persistent} = 1 AND expires_utc > 0 THEN expires_utc / 1000000 - ${WEBKIT_EPOCH_OFFSET_S} ELSE 0 END AS expires, ` +
    `${secure} AS secure, ${httpOnly} AS httpOnly, ${sameSite} AS sameSite, ${lastUsed} AS lastUsed FROM cookies`,
  ).all() as any[];
  return rows.map((r) => ({
    host: String(r.host ?? ""), name: String(r.name ?? ""), value: typeof r.value === "string" ? r.value : "",
    encrypted: r.encrypted_value instanceof Uint8Array ? r.encrypted_value : null, path: String(r.path || "/"),
    expires: Number(r.expires) || 0, secure: Number(r.secure) === 1, httpOnly: Number(r.httpOnly) === 1,
    sameSite: Number(r.sameSite), lastUsed: Math.max(0, Number(r.lastUsed) || 0),
  }));
}

// Firefox keeps seconds in expiry (milliseconds in newer versions) and microseconds in lastAccessed.
// Only the default container: cookies from private windows and containers stay where they are.
function firefoxRows(db: DatabaseSync, withValues: boolean): Row[] {
  const cols = columns(db, "moz_cookies");
  const where = cols.has("originAttributes") ? "WHERE originAttributes = ''" : "";
  const sameSite = cols.has("sameSite") ? "sameSite" : "0";
  const rows = db.prepare(
    `SELECT host, name, ${withValues ? "value" : "'' AS value"}, path, expiry, isSecure AS secure, isHttpOnly AS httpOnly, ${sameSite} AS sameSite, ` +
    `CASE WHEN lastAccessed > 0 THEN lastAccessed / 1000 ELSE 0 END AS lastUsed FROM moz_cookies ${where}`,
  ).all() as any[];
  return rows.map((r) => {
    const expiry = Number(r.expiry) || 0;
    return {
      host: String(r.host ?? ""), name: String(r.name ?? ""), value: typeof r.value === "string" ? r.value : "", encrypted: null,
      path: String(r.path || "/"), expires: expiry > 100_000_000_000 ? Math.floor(expiry / 1000) : expiry,
      secure: Number(r.secure) === 1, httpOnly: Number(r.httpOnly) === 1, sameSite: Number(r.sameSite), lastUsed: Math.max(0, Number(r.lastUsed) || 0),
    };
  });
}

function readRows(browser: CookieBrowserKind, file: string, withValues: boolean): { rows: Row[]; hashPrefix: boolean } {
  return withCopy(file, (db) => {
    if (browser === "firefox") return { rows: firefoxRows(db, withValues), hashPrefix: false };
    // From database version 24, Chrome puts a SHA-256 of the host in front of each value.
    let version = 0;
    try {
      version = Number((db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: unknown } | undefined)?.value) || 0;
    } catch {
      version = 0;
    }
    return { rows: chromeRows(db, withValues), hashPrefix: version >= 24 };
  });
}

const now = () => Math.floor(Date.now() / 1000);
const live = (row: Row) => row.host && VALID_HOST.test(row.host) && (row.expires === 0 || row.expires > now());
const isV11 = (row: Row) => !!row.encrypted && row.encrypted.length > 3 && Buffer.from(row.encrypted.subarray(0, 3)).toString("latin1") === "v11";

// secret-tool, found on PATH. Never another program, and never run when it is not there.
export function findSecretTool(envPath = process.env.PATH ?? ""): string | null {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, "secret-tool");
    try {
      accessSync(candidate, constants.X_OK);
      if (lstatSync(candidate).isDirectory()) continue;
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

export function listCookieSites(home: string, configHome: string, body: { browser?: unknown; profile?: unknown }): CookieSiteList {
  const chosen = chosenProfile(home, configHome, body.browser, body.profile);
  // The encrypted values are only looked at for their first three bytes, to know if v11 is used.
  const { rows } = readRows(chosen.browser, chosen.file, chosen.browser !== "firefox");
  const bySite = new Map<string, CookieSiteInfo>();
  let v11 = false;
  for (const row of rows) {
    if (!live(row)) continue;
    if (isV11(row)) v11 = true;
    const site = siteOf(row.host);
    const entry = bySite.get(site) ?? { site, cookies: 0, lastUsed: null };
    entry.cookies++;
    if (row.lastUsed && (entry.lastUsed === null || row.lastUsed > entry.lastUsed)) entry.lastUsed = row.lastUsed;
    bySite.set(site, entry);
  }
  // The sites used most recently first: they are the ones people want.
  const sites = [...bySite.values()].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0) || a.site.localeCompare(b.site, "nb")).slice(0, MAX_SITES);
  return {
    source: { browser: chosen.browser, profile: chosen.profile, label: chosen.label },
    sites,
    keyring: !v11 ? "not-needed" : findSecretTool() ? "needed" : "missing",
  };
}

const chromeKey = (password: string) => pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
const IV = Buffer.alloc(16, 0x20);

function decryptWith(key: Buffer, data: Uint8Array): Buffer | null {
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    return null;
  }
}

function decryptValue(row: Row, keys: { v10: Buffer; v11: Buffer[] }, hashPrefix: boolean): string | null {
  if (!row.encrypted || row.encrypted.length === 0) return row.value;
  const prefix = Buffer.from(row.encrypted.subarray(0, 3)).toString("latin1");
  const body = row.encrypted.subarray(3);
  const candidates = prefix === "v10" ? [keys.v10] : prefix === "v11" ? keys.v11 : [];
  for (const key of candidates) {
    let plain = decryptWith(key, body);
    if (!plain) continue;
    if (hashPrefix && plain.length >= 32 && plain.subarray(0, 32).equals(createHash("sha256").update(row.host).digest())) plain = plain.subarray(32);
    const text = plain.toString("utf8");
    if (VALID_VALUE.test(text) && !text.includes("�")) return text;
  }
  return null;
}

// The keyring's password for Chrome or Chromium, through secret-tool. Undefined when it is not
// there or has no password for the browser.
function keyringPassword(tool: string, browser: CookieBrowserKind): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(tool, ["lookup", "application", browser === "chromium" ? "chromium" : "chrome"], { timeout: KEYRING_TIMEOUT_MS, encoding: "utf8", maxBuffer: 64 * 1024 }, (err, stdout) => {
      const password = typeof stdout === "string" ? stdout.replace(/\r?\n$/, "") : "";
      resolve(err || !password ? undefined : password);
    });
  });
}

function toBrowserCookie(row: Row, value: string): BrowserCookie | null {
  if (!VALID_NAME.test(row.name) || value.length > MAX_VALUE || !VALID_VALUE.test(value)) return null;
  const host = row.host.toLowerCase();
  const cookiePath = row.path.startsWith("/") ? row.path : "/";
  // SameSite=None is only allowed on secure cookies; Chrome refuses the rest.
  const sameSite = row.sameSite === 2 ? "Strict" : row.sameSite === 0 && row.secure ? "None" : "Lax";
  const base = { name: row.name, value, expires: row.expires > 0 ? row.expires : -1, httpOnly: row.httpOnly, secure: row.secure, sameSite } as const;
  if (host.startsWith(".")) return { ...base, domain: host, path: cookiePath };
  // A cookie for one host only is given by address, so it stays a host cookie.
  const dir = cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`;
  return { ...base, url: `${row.secure ? "https" : "http"}://${host}${dir}` };
}

export async function readCookies(home: string, configHome: string, body: { browser?: unknown; profile?: unknown; sites?: unknown }): Promise<{ cookies: ReadCookie[]; label: string; skipped: number; keyringMissing: boolean }> {
  if (!Array.isArray(body.sites) || !body.sites.length) throw new HttpError(400, "Velg minst ett nettsted");
  if (body.sites.length > MAX_SITES || !body.sites.every((s) => typeof s === "string" && s.length > 0 && s.length <= 253)) throw new HttpError(400, "Ugyldige nettsteder");
  const wanted = new Set((body.sites as string[]).map((s) => s.toLowerCase()));
  const chosen = chosenProfile(home, configHome, body.browser, body.profile);
  const { rows, hashPrefix } = readRows(chosen.browser, chosen.file, true);
  const picked = rows.filter((row) => live(row) && wanted.has(siteOf(row.host)));

  // The keyring is asked only now, and only when a chosen cookie needs it.
  const keys = { v10: chromeKey("peanuts"), v11: [] as Buffer[] };
  let keyringMissing = false;
  if (chosen.browser !== "firefox" && picked.some(isV11)) {
    const tool = findSecretTool();
    const password = tool ? await keyringPassword(tool, chosen.browser) : undefined;
    if (password !== undefined) keys.v11.push(chromeKey(password));
    else keyringMissing = true;
    // Chrome uses an empty password for v11 when the keyring had none to give it.
    keys.v11.push(chromeKey(""));
  }

  const cookies: ReadCookie[] = [];
  let skipped = 0;
  for (const row of picked) {
    const value = chosen.browser === "firefox" ? row.value : decryptValue(row, keys, hashPrefix);
    const cookie = value === null ? null : toBrowserCookie(row, value);
    if (!cookie || cookies.length >= MAX_IMPORT_COOKIES) {
      skipped++;
      continue;
    }
    cookies.push({ site: siteOf(row.host), cookie });
  }
  return { cookies, label: chosen.label, skipped, keyringMissing };
}

export type { CookieImportResult };
