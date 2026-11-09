// Downloads from the Browser panel. Chrome writes each file under a random name into a hidden
// folder inside the download folder, and when it is complete it gets its real name: the suggested
// name made safe (no folders, no "..", not hidden), with (1), (2) and so on if the name is taken.
// Nothing is written outside the folder, and nothing is ever opened or run.
import { existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DownloadItem, ServerMessage } from "../../shared/protocol.ts";
import { isInside, realDeepest } from "./paths.ts";

export const STAGING = ".agentic-nedlastinger";
const MAX_ITEMS = 200;
const PROGRESS_EVERY_MS = 250;
// A file in the hidden folder that has not changed for this long is left over from a server that
// stopped in the middle of a download. Younger ones may belong to another server that is running.
export const STAGING_STALE_MS = 5 * 60 * 1000;
// A page may not start downloads without end: at most this many per project per minute, and this
// many under way at once. More than that is refused, and the list says so once a minute.
export const MAX_STARTS_PER_MINUTE = 8;
export const MAX_ACTIVE = 6;
const RATE_WINDOW_MS = 60_000;

// ~/Nedlastinger/Agentic Desktop on a Norwegian desktop: the XDG download folder when it is set
// and exists, else ~/Nedlastinger or ~/Downloads if one exists, else ~/Downloads.
export function defaultDownloadDir(home = homedir(), env: Record<string, string | undefined> = process.env): string {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  try {
    const text = readFileSync(path.join(configHome, "user-dirs.dirs"), "utf8");
    const match = /^XDG_DOWNLOAD_DIR="([^"]*)"/m.exec(text);
    if (match) {
      const dir = match[1].replace(/^\$HOME(?=\/|$)/, home);
      if (path.isAbsolute(dir) && dir !== home && existsSync(dir) && statSync(dir).isDirectory()) return path.join(dir, "Agentic Desktop");
    }
  } catch {
    // No user-dirs.dirs: the usual names below.
  }
  for (const name of ["Nedlastinger", "Downloads"]) {
    const dir = path.join(home, name);
    if (existsSync(dir) && statSync(dir).isDirectory()) return path.join(dir, "Agentic Desktop");
  }
  return path.join(home, "Downloads", "Agentic Desktop");
}

// A name for a file in the folder: the last part only, without control characters or characters
// that some systems refuse, without leading dots or spaces, and not too long.
export function safeFileName(suggested: string): string {
  let name = suggested.split(/[/\\]/).pop() ?? "";
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (!name || name === "." || name === "..") name = "nedlasting";
  if (Buffer.byteLength(name) > 180) {
    const ext = path.extname(name).slice(0, 16);
    let base = name.slice(0, name.length - ext.length);
    while (Buffer.byteLength(base + ext) > 180) base = base.slice(0, -1);
    name = base + ext;
  }
  return name;
}

// "rapport.pdf", then "rapport (1).pdf", "rapport (2).pdf" and so on.
export function numbered(name: string, n: number): string {
  if (n === 0) return name;
  const ext = path.extname(name);
  const base = ext && ext !== name ? name.slice(0, -ext.length) : name;
  return `${base} (${n})${ext && ext !== name ? ext : ""}`;
}

interface Active {
  item: DownloadItem;
  staging: string; // the folder Chrome writes into
  dir: string; // the folder the file ends up in, fixed when it started
  lastSent: number;
}

export interface DownloadsOptions {
  dir: () => string;
  publish: (message: ServerMessage) => void;
  cancel?: (id: string) => Promise<void>;
  dataDir?: string; // never written into, also not through a symlink
}

export class Downloads {
  private options: DownloadsOptions;
  private items: DownloadItem[] = [];
  private active = new Map<string, Active>();
  private starts = new Map<string, number[]>(); // per project, when downloads began, for the cap
  private refusedNoted = new Map<string, number>(); // per project, when the list last said so

  constructor(options: DownloadsOptions) {
    this.options = options;
  }

  dir(): string {
    return this.options.dir();
  }

  // Where Chrome should write. Created when a download starts, never before.
  stagingDir(dir = this.dir()): string {
    return path.join(dir, STAGING);
  }

  list(): DownloadItem[] {
    return this.items;
  }

  private send(item: DownloadItem): void {
    this.options.publish({ type: "download.changed", download: { ...item } });
  }

  // Downloads under way. The browser's idle timer waits for them.
  get activeCount(): number {
    return this.active.size;
  }

  // Throws when the download may not start; the browser then cancels it.
  begin(projectId: string, id: string, url: string, suggested: string, staging: string): void {
    this.checkRate(projectId, id, url, suggested);
    const dir = path.dirname(staging);
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    // The folder may have become a symlink into the data folder since it was chosen.
    if (this.options.dataDir && isInside(realpathSync(this.options.dataDir), realpathSync(staging))) {
      throw new Error("Nedlastingsmappen kan ikke være i appens datamappe");
    }
    const item: DownloadItem = {
      id,
      projectId,
      url: url.slice(0, 2000),
      filename: safeFileName(suggested),
      path: null,
      state: "progress",
      receivedBytes: 0,
      totalBytes: 0,
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.items = [item, ...this.items.filter((i) => i.id !== id)].slice(0, MAX_ITEMS);
    this.active.set(id, { item, staging, dir, lastSent: 0 });
    this.send(item);
  }

  // Nettsider can start downloads without a click (Chrome would ask after the first). Here a page
  // gets a few a minute, and a handful at once; the first one refused in a minute shows in the list
  // as stopped, with the reason, so it is not silent. The ones after that are refused quietly.
  private checkRate(projectId: string, id: string, url: string, suggested: string): void {
    const now = Date.now();
    const recent = (this.starts.get(projectId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
    const tooMany = recent.length >= MAX_STARTS_PER_MINUTE || this.active.size >= MAX_ACTIVE;
    if (!tooMany) {
      recent.push(now);
      this.starts.set(projectId, recent);
      return;
    }
    if (now - (this.refusedNoted.get(projectId) ?? 0) >= RATE_WINDOW_MS) {
      this.refusedNoted.set(projectId, now);
      const item: DownloadItem = {
        id,
        projectId,
        url: url.slice(0, 2000),
        filename: safeFileName(suggested),
        path: null,
        state: "canceled",
        receivedBytes: 0,
        totalBytes: 0,
        startedAt: now,
        finishedAt: now,
        error: "Stoppet: siden prøvde å laste ned mange filer på kort tid. Vent et minutt og prøv igjen.",
      };
      this.items = [item, ...this.items.filter((i) => i.id !== id)].slice(0, MAX_ITEMS);
      this.send(item);
    }
    throw new Error("For mange nedlastinger på kort tid");
  }

  progress(id: string, received: number, total: number, state: "inProgress" | "completed" | "canceled"): void {
    const active = this.active.get(id);
    if (!active) return;
    const { item } = active;
    item.receivedBytes = received;
    item.totalBytes = total;
    if (state === "inProgress") {
      // A few updates a second are enough for a progress bar, however fast the file comes.
      const now = Date.now();
      if (now - active.lastSent < PROGRESS_EVERY_MS) return;
      active.lastSent = now;
      return this.send(item);
    }
    this.active.delete(id);
    item.finishedAt = Date.now();
    const temp = path.join(active.staging, id);
    if (state === "canceled") {
      item.state = "canceled";
      rmSync(temp, { force: true });
      return this.send(item);
    }
    try {
      item.path = this.place(temp, active.dir, item.filename);
      item.filename = path.basename(item.path);
      item.state = "done";
    } catch (err) {
      item.state = "error";
      item.error = (err as Error).message;
      rmSync(temp, { force: true });
    }
    this.send(item);
  }

  // A hard link to a free name, then the random name goes. A link never replaces a file, so two
  // downloads with the same name cannot overwrite each other or anything else.
  private place(temp: string, dir: string, name: string): string {
    for (let n = 0; n < 10_000; n++) {
      const target = path.join(dir, numbered(name, n));
      if (path.dirname(target) !== dir) throw new Error("Ugyldig filnavn");
      try {
        linkSync(temp, target);
        unlinkSync(temp);
        return target;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    throw new Error("Fant ikke et ledig filnavn");
  }

  async cancel(id: string): Promise<void> {
    if (!this.active.has(id)) return;
    await this.options.cancel?.(id);
  }

  // Chrome has gone (idle, Lagring, a crash or the server stopping): what was under way can never
  // finish. Each ends as canceled with the reason, and its half file goes.
  abortAll(reason: string): void {
    for (const [id, active] of [...this.active]) {
      this.active.delete(id);
      const { item } = active;
      item.state = "canceled";
      item.error = reason;
      item.finishedAt = Date.now();
      removePartial(active.staging, id);
      this.send(item);
    }
  }

  // Half files left by a server that stopped in the middle of a download, at start. Only files in
  // the hidden folder, never through a symlink, and only those untouched for olderThanMs.
  sweepStaging(olderThanMs = STAGING_STALE_MS): void {
    try {
      const staging = this.stagingDir();
      if (!lstatSync(staging, { throwIfNoEntry: false })?.isDirectory()) return;
      const cutoff = Date.now() - olderThanMs;
      for (const name of readdirSync(staging)) {
        if ([...this.active.keys()].some((id) => name.startsWith(id))) continue;
        const stat = lstatSync(path.join(staging, name), { throwIfNoEntry: false });
        if (stat && !stat.isDirectory() && stat.mtimeMs < cutoff) rmSync(path.join(staging, name), { force: true });
      }
    } catch {
      // Next start. A folder that cannot be read must not stop the server.
    }
  }

  // Off the list. The file stays, unless the user has confirmed that it should go too. One that is
  // still under way is cancelled first, so a row can always be removed.
  remove(id: string, deleteFile: boolean): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    const active = this.active.get(id);
    if (active) {
      this.active.delete(id);
      void this.options.cancel?.(id).catch(() => undefined);
      removePartial(active.staging, id);
    }
    if (deleteFile && item.path) {
      const dir = path.dirname(item.path);
      if (path.basename(item.path) === item.filename && !item.filename.startsWith(".")) rmSync(path.join(dir, item.filename), { force: true });
    }
    this.items = this.items.filter((i) => i.id !== id);
    this.options.publish({ type: "download.removed", id });
    return true;
  }
}

// Chrome's file for a download is named by its id, perhaps with an ending while it is under way.
function removePartial(staging: string, id: string): void {
  try {
    for (const name of readdirSync(staging)) if (name.startsWith(id)) rmSync(path.join(staging, name), { force: true });
  } catch {
    // Already gone.
  }
}

// The folder from Settings: an absolute path without "..", not the root, not inside the app's own
// data, and not a file. "" means the default folder. It is created when the first download starts.
export function checkDownloadDir(value: unknown, dataDir: string): string {
  if (typeof value !== "string") throw new Error("Nedlastingsmappen må være en sti");
  const raw = value.trim();
  if (!raw) return "";
  if (raw.length > 1024 || raw.includes("\0")) throw new Error("Ugyldig nedlastingsmappe");
  if (!path.isAbsolute(raw)) throw new Error("Nedlastingsmappen må være en absolutt sti");
  if (raw.split(/[/\\]/).includes("..")) throw new Error("Nedlastingsmappen kan ikke inneholde ..");
  const dir = path.resolve(raw);
  if (dir === path.parse(dir).root) throw new Error("Velg en mappe, ikke roten av disken");
  // Through symlinks too: a link into the data folder is the data folder.
  let real: string;
  try {
    real = realDeepest(dir);
  } catch {
    throw new Error("Nedlastingsmappen går gjennom en brutt symbolsk lenke");
  }
  const data = [path.resolve(dataDir), existsSync(dataDir) ? realpathSync(dataDir) : path.resolve(dataDir)];
  if ([dir, real].some((d) => data.some((root) => isInside(root, d) || isInside(d, root)))) throw new Error("Nedlastingsmappen kan ikke være i appens datamappe");
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new Error("Stien er en fil, ikke en mappe");
  return dir;
}
