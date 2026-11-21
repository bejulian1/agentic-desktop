// A visible Studio watches only the root and directories its tree has expanded. No recursive
// traversal: opening a large repository does not watch dependencies, its history or every folder.
import { statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { Project, ServerMessage } from "../../shared/protocol.ts";
import { guardPath, guardProjectRoot, isProtectedPath } from "./paths.ts";

export const MAX_PROJECT_WATCH_DIRS = 64;
const MAX_SHARED_WATCHES = 512;
const MAX_BATCH_PATHS = 256;
const DEBOUNCE_MS = 100;

export interface ProjectWatchClient {
  send(message: ServerMessage): void;
}
interface Subscription { projectId: string; root: string; keys: Set<string> }
interface DirectoryWatch {
  projectId: string;
  rel: string;
  abs: string;
  watcher: FSWatcher;
  dev: number;
  ino: number;
  stale: boolean;
  identity: symbol;
  clients: Set<ProjectWatchClient>;
  paths: Set<string>;
  timer?: NodeJS.Timeout;
  recovery?: NodeJS.Timeout;
}

export class ProjectWatches {
  private subscriptions = new Map<ProjectWatchClient, Subscription>();
  private directories = new Map<string, DirectoryWatch>();
  private closed = false;

  private dataDir: string;
  private invalidate: (projectId: string) => void;

  constructor(dataDir: string, invalidate: (projectId: string) => void) {
    this.dataDir = dataDir;
    this.invalidate = invalidate;
  }

  subscribe(client: ProjectWatchClient, project: Project, input: unknown): void {
    if (this.closed) return;
    if (!Array.isArray(input) || input.length > MAX_PROJECT_WATCH_DIRS || input.some((p) => typeof p !== "string" || p.length > 4096)) {
      throw new Error(`Velg høyst ${MAX_PROJECT_WATCH_DIRS} mapper å følge.`);
    }
    if (project.folderMissing) throw new Error("Prosjektmappen mangler. Velg mappen på nytt.");
    const projectRoot = guardProjectRoot(project.path, this.dataDir);
    const requested = new Map<string, { abs: string; rel: string }>();
    for (const dir of [".", ...input]) {
      const safe = guardPath(project.path, dir, this.dataDir);
      if (safe.rel.split(path.sep).some((part) => part === ".git" || part === "node_modules") || isProtectedPath(safe.rel)) {
        throw new Error("Denne mappen kan ikke følges i Kode Studio.");
      }
      const info = statSync(safe.abs, { throwIfNoEntry: false });
      // An expanded folder can disappear between the listing and subscription. Keep the
      // remaining visible directories live; outside/protected paths were still rejected above.
      if (!info && safe.rel !== ".") {
        // Preserve an existing expanded-directory intent while it is absent. Its parent
        // watch will attach to the new inode if the folder is recreated later.
        if (this.directories.has(`${project.id}:${safe.abs}`)) requested.set(`${project.id}:${safe.abs}`, safe);
        continue;
      }
      if (!info?.isDirectory()) throw new Error("Stien er ikke en mappe.");
      requested.set(`${project.id}:${safe.abs}`, safe);
    }
    if (requested.size > MAX_PROJECT_WATCH_DIRS) throw new Error(`Velg høyst ${MAX_PROJECT_WATCH_DIRS} mapper å følge.`);
    const extra = [...requested.keys()].filter((key) => !this.directories.has(key)).length;
    if (this.directories.size + extra > MAX_SHARED_WATCHES) throw new Error("For mange mapper følges. Lukk et annet Studio-vindu først.");

    // Open the next watchers before replacing the old subscription. A failed request leaves
    // its previous valid subscription intact and never partially follows a different project.
    const opened = new Map<string, DirectoryWatch>();
    const missing: string[] = [];
    try {
      for (const [key, safe] of requested) {
        const current = this.directories.get(key);
        const info = statSync(safe.abs, { throwIfNoEntry: false });
        if (!info && current) { missing.push(key); continue; }
        if (!info?.isDirectory()) throw new Error("Stien er ikke en mappe.");
        if (current && !current.stale && current.dev === info.dev && current.ino === info.ino) continue;
        opened.set(key, this.openDirectory(key, project, safe));
      }
    } catch (err) {
      for (const entry of opened.values()) entry.watcher.close();
      throw err;
    }
    for (const [key, entry] of opened) this.replaceDirectory(key, entry);
    for (const key of missing) this.repair(key, project);
    const previous = this.subscriptions.get(client);
    const keys = new Set(requested.keys());
    for (const key of keys) this.directories.get(key)!.clients.add(client);
    this.subscriptions.set(client, { projectId: project.id, root: projectRoot, keys });
    for (const key of previous?.keys ?? []) if (!keys.has(key)) this.detach(key, client);
    client.send({ type: "project.watch-state", projectId: project.id, directories: [...requested.values()].map((p) => p.rel), watching: true });
  }

  unsubscribe(client: ProjectWatchClient, projectId?: string): void {
    const current = this.subscriptions.get(client);
    if (!current || (projectId && current.projectId !== projectId)) return;
    this.subscriptions.delete(client);
    for (const key of current.keys) this.detach(key, client);
    client.send({ type: "project.watch-state", projectId: current.projectId, directories: [], watching: false });
  }

  projectChanged(projectId: string, project?: Project): void {
    for (const [client, subscription] of [...this.subscriptions]) {
      if (subscription.projectId !== projectId) continue;
      let root: string | undefined;
      try { if (project && !project.folderMissing) root = guardProjectRoot(project.path, this.dataDir); } catch { /* Gone or no longer safe. */ }
      if (root === subscription.root) continue;
      const directories = [...subscription.keys].flatMap((key) => this.directories.get(key)?.rel ?? []);
      this.unsubscribe(client);
      if (root && project) {
        // Rebased files are read by the client after the project.changed broadcast. Failure
        // deliberately stays unsubscribed instead of silently following the previous folder.
        try { this.subscribe(client, project, directories); } catch { /* The client may expand/retry again. */ }
      }
    }
  }

  private openDirectory(key: string, project: Project, safe: { abs: string; rel: string }): DirectoryWatch {
    const info = statSync(safe.abs);
    const identity = Symbol();
    const watcher = watch(safe.abs, { persistent: false }, (_event, name) => this.changed(key, identity, project, name));
    const entry: DirectoryWatch = { projectId: project.id, rel: safe.rel, abs: safe.abs, watcher,
      dev: info.dev, ino: info.ino, stale: false, identity, clients: new Set(), paths: new Set() };
    watcher.on("error", () => this.failed(key, identity, project));
    return entry;
  }

  private replaceDirectory(key: string, next: DirectoryWatch): void {
    const previous = this.directories.get(key);
    if (previous) {
      next.clients = previous.clients;
      next.paths = previous.paths;
      clearTimeout(previous.timer);
      clearTimeout(previous.recovery);
      previous.watcher.close();
    }
    this.directories.set(key, next);
    if (next.paths.size) this.queue(key, next, next.rel);
  }

  private queue(key: string, entry: DirectoryWatch, rel: string): void {
    if (entry.paths.size < MAX_BATCH_PATHS) entry.paths.add(rel);
    else { entry.paths.clear(); entry.paths.add(entry.rel); }
    entry.timer ??= setTimeout(() => this.flush(key), DEBOUNCE_MS);
    entry.timer.unref();
  }

  private repair(key: string, project: Project): DirectoryWatch | undefined {
    const entry = this.directories.get(key);
    if (!entry) return;
    try {
      const safe = guardPath(project.path, entry.rel, this.dataDir);
      const info = statSync(safe.abs, { throwIfNoEntry: false });
      if (info?.isDirectory() && safe.abs === entry.abs) {
        if (!entry.stale && entry.dev === info.dev && entry.ino === info.ino) return entry;
        const next = this.openDirectory(key, project, safe);
        this.replaceDirectory(key, next);
        this.queue(key, next, next.rel);
        if (entry.rel === ".") {
          // The recreated root may contain new inodes for every expanded child directory.
          for (const [childKey, child] of this.directories) if (childKey !== key && child.projectId === project.id) this.repair(childKey, project);
          for (const client of next.clients) this.sendWatchState(client);
        }
        return next;
      }
    } catch { /* Deleted, inaccessible or redirected outside the allowed project. */ }
    // Retain its bounded subscription entry so a later parent event can attach to a recreated
    // directory. Close the dead inode handle now rather than following a renamed old folder.
    const firstMissing = !entry.stale;
    entry.stale = true;
    entry.watcher.close();
    if (firstMissing || entry.rel !== ".") this.queue(key, entry, entry.rel);
    if (entry.rel === "." && entry.clients.size) {
      if (firstMissing) for (const client of entry.clients) this.sendWatchState(client);
      // One exact-path metadata probe for a missing visible root. This does not watch the
      // parent, walk a tree or run when no client follows the project. Ref-counted cleanup
      // cancels the unref timer on leave/disconnect/shutdown.
      entry.recovery ??= setTimeout(() => { entry.recovery = undefined; this.repair(key, project); }, 1000);
      entry.recovery.unref();
    }
    return entry;
  }

  private changed(key: string, identity: symbol, project: Project, name: string | Buffer | null): void {
    let entry = this.directories.get(key);
    if (!entry || entry.identity !== identity || !entry.clients.size) return;
    let sameDirectory = false;
    try {
      const info = statSync(entry.abs, { throwIfNoEntry: false });
      sameDirectory = !!info?.isDirectory() && entry.dev === info.dev && entry.ino === info.ino;
    } catch { /* The directory may have become inaccessible or a parent is now a file. */ }
    if (!sameDirectory) {
      this.repair(key, project);
      return; // A self rename/delete names the watched directory, not a child called src/src.
    }
    const rel = name ? path.join(entry.rel, String(name)) : entry.rel;
    if (rel.split(path.sep).some((part) => part === ".git" || part === "node_modules") || isProtectedPath(rel)) return;
    let abs: string;
    try { abs = guardPath(project.path, rel, this.dataDir).abs; } catch { return; }
    // Atomic folder replacement leaves fs.watch attached to the old inode. A parent event
    // repairs all affected visible descendants, including shared watches, without a resubscribe.
    for (const [childKey, child] of this.directories) {
      if (childKey !== key && child.projectId === project.id && (child.abs === abs || child.abs.startsWith(abs + path.sep))) this.repair(childKey, project);
    }
    entry = this.directories.get(key);
    if (entry && entry.identity === identity) this.queue(key, entry, rel);
  }

  private flush(key: string): void {
    const entry = this.directories.get(key);
    if (!entry) return;
    entry.timer = undefined;
    if (!entry.paths.size || !entry.clients.size) return;
    const paths = [...entry.paths];
    entry.paths.clear();
    this.invalidate(entry.projectId);
    const message: ServerMessage = { type: "project.files-changed", projectId: entry.projectId, paths };
    for (const client of entry.clients) client.send(message);
  }

  private sendWatchState(client: ProjectWatchClient): void {
    const subscription = this.subscriptions.get(client);
    if (!subscription) return;
    const directories = [...subscription.keys].flatMap((key) => {
      const entry = this.directories.get(key);
      return entry && !entry.stale ? [entry.rel] : [];
    });
    client.send({ type: "project.watch-state", projectId: subscription.projectId, directories, watching: directories.includes(".") });
  }

  private failed(key: string, identity: symbol, project: Project): void {
    const entry = this.directories.get(key);
    if (!entry || entry.identity !== identity) return;
    const missing = !entry.stale;
    entry.stale = true;
    if (missing) this.queue(key, entry, entry.rel);
    this.repair(key, project);
    if (missing) for (const client of entry.clients) this.sendWatchState(client);
  }

  private detach(key: string, client: ProjectWatchClient): void {
    const entry = this.directories.get(key);
    if (!entry) return;
    entry.clients.delete(client);
    if (!entry.clients.size) this.closeDirectory(key);
  }

  private closeDirectory(key: string): void {
    const entry = this.directories.get(key);
    if (!entry) return;
    this.directories.delete(key);
    clearTimeout(entry.timer);
    clearTimeout(entry.recovery);
    entry.watcher.close();
  }

  close(): void {
    this.closed = true;
    for (const key of this.directories.keys()) this.closeDirectory(key);
    this.subscriptions.clear();
  }
}
