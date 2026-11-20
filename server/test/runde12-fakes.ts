// Fake browser profiles for the round 12 cookie tests (SPEC 26.4). Everything is made in a
// temporary home folder the test owns: a Chrome profile with v10 and v11 encrypted cookies, a
// Firefox profile with cookies.sqlite, files that must never be read (passwords, cards), and a
// fake secret-tool that logs how it was called. The user's real profiles and keyring are never
// read, listed or touched.
import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const KEYRING_PASSWORD = "testnøkkel-fra-nøkkelringen";
const WEBKIT_EPOCH_OFFSET_S = 11_644_473_600n;

export interface FakeCookie {
  host: string;
  name: string;
  value: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: number;
  expires?: number; // seconds since 1970; 0 for a session cookie
  lastUsed?: number; // ms since 1970
  version?: "v10" | "v11" | "plain";
}

function encrypt(value: string, password: string, host: string, prefix: "v10" | "v11"): Buffer {
  const key = pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  // Database version 24: a SHA-256 of the host in front of the value.
  const plain = Buffer.concat([createHash("sha256").update(host).digest(), Buffer.from(value, "utf8")]);
  return Buffer.concat([Buffer.from(prefix, "latin1"), cipher.update(plain), cipher.final()]);
}

const webkit = (seconds: number) => (BigInt(Math.floor(seconds)) + WEBKIT_EPOCH_OFFSET_S) * 1_000_000n;

// A file that must never be opened: unreadable, so any attempt would fail loudly.
function forbidden(file: string, text: string): void {
  writeFileSync(file, text);
  chmodSync(file, 0o000);
}

export function makeChromeProfile(home: string, cookies: FakeCookie[], options: { folder?: string; profile?: string; v11Password?: string } = {}): string {
  const dir = path.join(home, ".config", options.folder ?? "google-chrome", options.profile ?? "Default");
  mkdirSync(path.join(dir, "Network"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "Network", "Cookies"));
  db.exec(`CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta VALUES ('version', '24');
    CREATE TABLE cookies (creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,
      value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL,
      priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL, source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL);`);
  const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 2, 443, ?)");
  const now = Date.now() / 1000;
  for (const c of cookies) {
    const version = c.version ?? "v10";
    const encrypted = version === "plain" ? Buffer.alloc(0) : encrypt(c.value, version === "v11" ? (options.v11Password ?? KEYRING_PASSWORD) : "peanuts", c.host, version);
    const expires = c.expires ?? now + 30 * 86400;
    insert.run(webkit(now), c.host, c.name, version === "plain" ? c.value : "", encrypted, c.path ?? "/", expires ? webkit(expires) : 0n,
      c.secure ? 1 : 0, c.httpOnly ? 1 : 0, webkit((c.lastUsed ?? Date.now()) / 1000), expires ? 1 : 0, expires ? 1 : 0, c.sameSite ?? 1, webkit(now));
  }
  db.close();
  // What a real profile also has, and what the import must never open.
  forbidden(path.join(dir, "Login Data"), "PASSORD: hemmelig");
  forbidden(path.join(dir, "Web Data"), "KORT: 4111 1111 1111 1111");
  forbidden(path.join(dir, "History"), "historikk");
  return dir;
}

export function makeFirefoxProfile(home: string, cookies: FakeCookie[], options: { folder?: string; name?: string } = {}): string {
  const root = path.join(home, ".mozilla", "firefox");
  const folder = options.folder ?? "abcd1234.default-release";
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, "profiles.ini"), `[Profile0]\nName=${options.name ?? "default-release"}\nIsRelative=1\nPath=${folder}\nDefault=1\n`);
  const db = new DatabaseSync(path.join(dir, "cookies.sqlite"));
  db.exec(`CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '', name TEXT, value TEXT, host TEXT, path TEXT,
    expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER, isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0,
    sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0);`);
  const insert = db.prepare("INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const now = Date.now();
  for (const c of cookies) {
    insert.run("", c.name, c.value, c.host, c.path ?? "/", c.expires ?? Math.floor(now / 1000) + 30 * 86400, (c.lastUsed ?? now) * 1000, now * 1000, c.secure ? 1 : 0, c.httpOnly ? 1 : 0, c.sameSite ?? 1);
  }
  // A container cookie stays where it is.
  insert.run("^userContextId=1", "beholder", "x", ".container.example", "/", Math.floor(now / 1000) + 86400, now * 1000, now * 1000, 0, 0, 1);
  db.close();
  forbidden(path.join(dir, "logins.json"), '{"logins":[{"password":"hemmelig"}]}');
  forbidden(path.join(dir, "key4.db"), "nøkler");
  forbidden(path.join(dir, "formhistory.sqlite"), "autofyll");
  return dir;
}

// A fake secret-tool first on PATH. It logs its arguments next to itself and prints the password
// only for `lookup application chrome`.
export function makeSecretTool(binDir: string, password = KEYRING_PASSWORD): string {
  mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, "secret-tool");
  writeFileSync(script, `#!/bin/sh\necho "$@" >> "$(dirname "$0")/secret-tool.log"\nif [ "$1" = "lookup" ] && [ "$2" = "application" ] && [ "$3" = "chrome" ]; then printf '%s' '${password}'; fi\n`);
  chmodSync(script, 0o755);
  return path.join(binDir, "secret-tool.log");
}
