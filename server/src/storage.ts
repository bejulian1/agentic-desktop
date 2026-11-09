// Lagring: how much room the app's own data folder takes, and cleaning up what is not needed.
//
// Safety rules, all enforced here:
// - Every path is an explicit name joined onto the data folder from the configuration. Nothing is
//   found by globbing, and the user's home, projects and downloads are never touched.
// - Symlinks are never followed: a walk counts a link as nothing and never enters it, and a folder
//   that is a link (or sits under one) is skipped as a whole. Deleting a link removes only the link.
// - Each delete checks again that the real parent folder is inside the data folder.
// - The downloads folder belongs to the user. It is measured, never cleaned, and not in the total.
import { lstatSync, readdirSync, readlinkSync, realpathSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { StorageAction, StorageActionId, StorageCategory, StorageCategoryId, StorageCleanResult, StorageReport, Thread } from "../../shared/protocol.ts";
import type { Store } from "./db.ts";
import { HttpError } from "./errors.ts";
import { isInside } from "./paths.ts";

const DB_FILES = ["agentic-desktop.db", "agentic-desktop.db-wal", "agentic-desktop.db-shm"];
const FOLDERS: Partial<Record<StorageCategoryId, string>> = {
  images: "images",
  uploads: "uploads",
  screenshots: "screenshots",
  browser: "chrome-profile",
  logs: "logs",
  temp: "tmp",
};
// Caches inside the Chrome profile. Logins, cookies, history and settings live elsewhere in it.
const BROWSER_CACHES = [
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache",
  "Default/blob_storage",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "component_crx_cache",
  "extensions_crx_cache",
];
const ATTACHMENT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp|txt)$/;
const ORPHAN_GRACE_MS = 24 * 60 * 60_000; // an attachment can wait in the message field this long
const LOG_AGE_MS = 7 * 24 * 60 * 60_000;
const ACTION_IDS: StorageActionId[] = ["browser-cache", "browser-all", "orphans", "archived", "vacuum", "logs"];
const MAX_DOWNLOAD_FILES = 20_000;

export interface StorageDeps {
  dataDir: string;
  store: Store;
  downloadDir: () => string;
  browser?: { running: boolean; close: () => Promise<void> };
  deleteThread: (thread: Thread) => void; // the same path as DELETE /api/threads/:id
}

interface Size {
  bytes: number;
  files: number;
  capped?: boolean;
}

// Sums regular files under dir without following links. A missing dir is empty.
function measure(dir: string, limit = Infinity): Size {
  const out: Size = { bytes: 0, files: 0 };
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.files >= limit) {
        out.capped = true;
        return;
      }
      const full = path.join(current, name);
      const st = lstatSync(full, { throwIfNoEntry: false });
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        out.bytes += st.size;
        out.files += 1;
      }
    }
  };
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (st?.isDirectory()) walk(dir);
  else if (st?.isFile()) {
    out.bytes = st.size;
    out.files = 1;
  }
  return out;
}

function chromeAlive(lock: string): boolean {
  let target: string;
  try {
    target = readlinkSync(lock);
  } catch {
    return false;
  }
  const pid = Number(/-(\d+)$/.exec(target)?.[1]);
  if (!pid) return true; // an unknown form: assume it runs
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class Storage {
  private root: string;
  private deps: StorageDeps;

  constructor(deps: StorageDeps) {
    this.deps = deps;
    this.root = realpathSync(deps.dataDir);
  }

  // A path made of fixed names under the data folder, and only if no part of it is a symlink.
  // Returns null when it is not safe to look inside or delete.
  private own(...parts: string[]): string | null {
    const target = path.join(this.root, ...parts);
    if (!isInside(this.root, target) || target === this.root) return null;
    let current = this.root;
    for (const part of path.relative(this.root, target).split(path.sep)) {
      current = path.join(current, part);
      const st = lstatSync(current, { throwIfNoEntry: false });
      if (!st) return target; // missing from here on: nothing to read or delete
      if (st.isSymbolicLink()) return null;
    }
    return target;
  }

  private size(...parts: string[]): Size {
    const target = this.own(...parts);
    return target ? measure(target) : { bytes: 0, files: 0 };
  }

  // Deletes a file, a link (only the link) or a folder with what is in it, without following links.
  // Returns the bytes of the regular files removed.
  private remove(target: string): number {
    const st = lstatSync(target, { throwIfNoEntry: false });
    if (!st) return 0;
    const parent = realpathSync(path.dirname(target));
    if (!isInside(this.root, parent) || !isInside(this.root, target) || target === this.root) {
      throw new HttpError(403, "Bare appens egen datamappe kan ryddes");
    }
    if (st.isDirectory()) {
      let freed = 0;
      for (const name of readdirSync(target)) freed += this.remove(path.join(target, name));
      rmdirSync(target);
      return freed;
    }
    unlinkSync(target);
    return st.isFile() ? st.size : 0;
  }

  private running(): boolean {
    const { store } = this.deps;
    return store.threads().some((t) => store.isRunning(t.id));
  }

  // Files in a folder of ours that nothing mentions any more, and that are older than a day.
  private orphans(): Array<{ file: string; bytes: number }> {
    const used = this.deps.store.referencedIds();
    const out: Array<{ file: string; bytes: number }> = [];
    const now = Date.now();
    for (const folder of ["images", "uploads", "screenshots"]) {
      const dir = this.own(folder);
      if (!dir) continue;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const match = ATTACHMENT.exec(name);
        if (!match || used.has(match[1])) continue;
        const file = path.join(dir, name);
        const st = lstatSync(file, { throwIfNoEntry: false });
        if (!st?.isFile() || now - st.mtimeMs < ORPHAN_GRACE_MS) continue;
        out.push({ file, bytes: st.size });
      }
    }
    return out;
  }

  private oldLogs(): Array<{ file: string; bytes: number }> {
    const out: Array<{ file: string; bytes: number }> = [];
    const now = Date.now();
    const look = (dir: string | null, onlyLogs: boolean) => {
      if (!dir) return;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (onlyLogs && !name.endsWith(".log")) continue;
        const file = path.join(dir, name);
        const st = lstatSync(file, { throwIfNoEntry: false });
        if (st?.isFile() && now - st.mtimeMs > LOG_AGE_MS) out.push({ file, bytes: st.size });
      }
    };
    look(this.root, true);
    look(this.own("logs"), false);
    return out;
  }

  private rootLogs(): Size {
    const out: Size = { bytes: 0, files: 0 };
    for (const name of readdirSync(this.root)) {
      if (!name.endsWith(".log")) continue;
      const st = lstatSync(path.join(this.root, name), { throwIfNoEntry: false });
      if (st?.isFile()) {
        out.bytes += st.size;
        out.files += 1;
      }
    }
    return out;
  }

  report(archivedDays = 30): StorageReport {
    const { store } = this.deps;
    const db = DB_FILES.reduce((sum, name) => sum + this.size(name).bytes, 0);
    const artifacts = Math.min(store.artifactBytes(), db);
    const sizes: Record<StorageCategoryId, Size> = {
      database: { bytes: db - artifacts, files: DB_FILES.filter((name) => this.size(name).files).length },
      artifacts: { bytes: artifacts, files: 0 },
      images: this.size("images"),
      uploads: this.size("uploads"),
      screenshots: this.size("screenshots"),
      browser: this.size("chrome-profile"),
      logs: (() => {
        const dir = this.size("logs");
        const loose = this.rootLogs();
        return { bytes: dir.bytes + loose.bytes, files: dir.files + loose.files };
      })(),
      temp: (() => {
        const dir = this.size("tmp");
        let bytes = dir.bytes;
        let files = dir.files;
        for (const name of readdirSync(this.root)) {
          if (!name.endsWith(".tmp")) continue;
          const st = lstatSync(path.join(this.root, name), { throwIfNoEntry: false });
          if (st?.isFile()) {
            bytes += st.size;
            files += 1;
          }
        }
        return { bytes, files };
      })(),
      other: { bytes: 0, files: 0 },
    };
    // Everything else at the top of the data folder: the key file, the token and anything new.
    const known = new Set([...DB_FILES, ...Object.values(FOLDERS)]);
    for (const name of readdirSync(this.root)) {
      if (known.has(name) || name.endsWith(".log") || name.endsWith(".tmp")) continue;
      const st = lstatSync(path.join(this.root, name), { throwIfNoEntry: false });
      if (!st || st.isSymbolicLink()) continue;
      const size = measure(path.join(this.root, name));
      sizes.other.bytes += size.bytes;
      sizes.other.files += size.files;
    }
    const categories: StorageCategory[] = (Object.keys(sizes) as StorageCategoryId[]).map((id) => ({ id, bytes: sizes[id].bytes, files: sizes[id].files }));
    const total = categories.reduce((sum, c) => sum + c.bytes, 0);

    const busy = this.running();
    const browserOpen = this.deps.browser?.running ?? false;
    const caches = BROWSER_CACHES.reduce((sum, rel) => sum + this.size("chrome-profile", ...rel.split("/")).bytes, 0);
    const orphans = this.orphans();
    const archived = store.archivedBefore(Date.now() - archivedDays * 24 * 60 * 60_000).filter((t) => !store.isRunning(t.id));
    const wal = this.size("agentic-desktop.db-wal").bytes;
    const logs = this.oldLogs();
    const sum = (list: Array<{ bytes: number }>) => list.reduce((n, x) => n + x.bytes, 0);
    const actions: StorageAction[] = [
      { id: "browser-cache", bytes: caches, count: 0, available: caches > 0 },
      { id: "browser-all", bytes: sizes.browser.bytes, count: sizes.browser.files, available: sizes.browser.bytes > 0 },
      { id: "orphans", bytes: sum(orphans), count: orphans.length, available: orphans.length > 0 },
      { id: "archived", bytes: sum(archived), count: archived.length, available: archived.length > 0 && !busy, ...(busy && archived.length ? { reason: "En tråd kjører" } : {}) },
      { id: "vacuum", bytes: store.freeBytes() + wal, count: 0, available: !busy, ...(busy ? { reason: "En tråd kjører" } : {}) },
      { id: "logs", bytes: sum(logs), count: logs.length, available: logs.length > 0 },
    ];
    for (const action of actions) {
      if ((action.id === "browser-cache" || action.id === "browser-all") && browserOpen && action.available) action.reason = "Nettleseren lukkes først";
    }

    let downloads: StorageReport["downloads"] = null;
    try {
      const dir = this.deps.downloadDir();
      // Counted only. A folder inside ours would be counted twice, so it is left out.
      if (dir && path.isAbsolute(dir) && !isInside(this.root, dir) && statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        const size = measure(dir, MAX_DOWNLOAD_FILES);
        downloads = { dir, bytes: size.bytes, files: size.files, capped: size.capped === true };
      } else if (dir) downloads = { dir, bytes: 0, files: 0, capped: false };
    } catch {
      downloads = null;
    }

    return { dataDir: this.root, total, categories, actions, archivedDays, downloads, at: Date.now() };
  }

  async clean(actions: unknown, archivedDays: unknown): Promise<StorageCleanResult> {
    if (!Array.isArray(actions) || !actions.length || !actions.every((a) => ACTION_IDS.includes(a))) throw new HttpError(400, "Ukjent oppryddingshandling");
    const days = archivedDays === undefined ? 30 : Number(archivedDays);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new HttpError(400, "Ugyldig antall dager");
    const wanted = new Set(actions as StorageActionId[]);
    // Deleting threads only frees room in the file after VACUUM, so the two go together.
    if (wanted.has("archived")) wanted.add("vacuum");
    const before = this.report(days).total;
    const done: StorageCleanResult["done"] = [];
    const step = async (id: StorageActionId, fn: () => number | Promise<number>) => {
      if (!wanted.has(id)) return;
      try {
        done.push({ id, count: await fn() });
      } catch (err) {
        done.push({ id, count: 0, error: (err as Error).message });
      }
    };

    const closeBrowser = async () => {
      if (this.deps.browser?.running) await this.deps.browser.close();
      // Chrome holds this link, "host-pid", while it runs. A link left by a crash points at a
      // process that is gone, and is fine to delete with the rest.
      const profile = this.own("chrome-profile");
      if (profile && chromeAlive(path.join(profile, "SingletonLock"))) throw new Error("Nettleseren bruker fortsatt profilen");
    };

    await step("browser-all", async () => {
      await closeBrowser();
      const profile = this.own("chrome-profile");
      if (!profile) throw new Error("Profilen er en symlenke og ryddes ikke");
      const count = measure(profile).files;
      this.remove(profile);
      return count;
    });
    if (!wanted.has("browser-all")) {
      await step("browser-cache", async () => {
        await closeBrowser();
        let count = 0;
        for (const rel of BROWSER_CACHES) {
          const dir = this.own("chrome-profile", ...rel.split("/"));
          if (!dir) continue;
          count += measure(dir).files;
          this.remove(dir);
        }
        return count;
      });
    }
    await step("orphans", () => {
      const list = this.orphans();
      for (const { file } of list) this.remove(file);
      return list.length;
    });
    await step("logs", () => {
      const list = this.oldLogs();
      for (const { file } of list) this.remove(file);
      return list.length;
    });
    await step("archived", () => {
      if (this.running()) throw new Error("En tråd kjører. Prøv igjen når den er ferdig.");
      const cutoff = Date.now() - days * 24 * 60 * 60_000;
      let count = 0;
      for (const { id } of this.deps.store.archivedBefore(cutoff)) {
        const thread = this.deps.store.thread(id);
        if (!thread || this.deps.store.isRunning(id)) continue;
        this.deps.deleteThread(thread);
        count += 1;
      }
      return count;
    });
    await step("vacuum", () => {
      if (this.running()) throw new Error("En tråd kjører. Databasen komprimeres når ingen tur kjører.");
      this.deps.store.vacuum();
      return 1;
    });

    const report = this.report(days);
    return { freed: Math.max(0, before - report.total), done, report };
  }
}

type Route = (method: string, spec: string, handler: (ctx: { body: any; query: URLSearchParams }) => unknown) => void;

export function storageRoutes(route: Route, storage: Storage): void {
  route("GET", "/api/storage", ({ query }) => {
    const days = Number(query.get("days") ?? 30);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new HttpError(400, "Ugyldig antall dager");
    return storage.report(days);
  });
  route("POST", "/api/storage/clean", ({ body }) => storage.clean(body?.actions, body?.archivedDays));
}
