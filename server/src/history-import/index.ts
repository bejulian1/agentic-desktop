import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, opendir, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { HistoryImportResult, HistoryScan, HistorySource, ImportProjectPreview } from "../../../shared/history-import.ts";
import type { Project } from "../../../shared/protocol.ts";
import type { ConfigDirs } from "../config-dirs.ts";
import type { Store } from "../db.ts";
import { HttpError } from "../errors.ts";
import { cleanName } from "../names.ts";
import { guardProjectRoot } from "../paths.ts";
import { parseSession, type HistoricalSession } from "./formats.ts";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 160;
const MAX_ENTRIES = 12_000;
const MAX_LINES = 50_000;
const SCAN_AGE = 30 * 60 * 1000;
const MAX_SCANS = 3;

interface SourceTree {
  source: HistorySource;
  root: string[];
  directories: RegExp[];
  files: RegExp;
}

const trees: SourceTree[] = [
  { source: "claude", root: [".claude", "projects"], directories: [/./], files: /\.jsonl$/ },
  { source: "codex", root: [".codex", "sessions"], directories: [/^\d{4}$/, /^\d{2}$/, /^\d{2}$/], files: /^rollout-.*\.jsonl$/ },
  { source: "gemini", root: [".gemini", "tmp"], directories: [/./, /^chats$/], files: /\.jsonl?$/ },
  { source: "pi", root: [".pi", "agent", "sessions"], directories: [/./], files: /\.jsonl$/ },
];

interface ScanEntry {
  source: HistorySource;
  filename: string[];
  sessionId: string;
  projectPath: string;
}

interface ScanSelection {
  at: number;
  entries: Map<string, ScanEntry>;
}

interface ImporterOptions {
  home: string;
  dataDir: string;
  store: Store;
  config: ConfigDirs;
  findModel: (name: string | undefined) => string | undefined;
  projectChanged: (project: Project) => void;
  threadChanged: (id: string) => void;
}

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

// Linux file descriptors anchor each component. Even if a directory is swapped for a symlink
// during a scan, neither traversal nor the import re-open can escape the selected history tree.
function inside(handle: FileHandle, child = ""): string {
  return path.join("/proc/self/fd", String(handle.fd), child);
}

async function inDirectory<T>(parent: FileHandle, names: string[], run: (dir: FileHandle) => Promise<T>): Promise<T> {
  if (!names.length) return run(parent);
  const dir = await open(inside(parent, names[0]), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { return await inDirectory(dir, names.slice(1), run); }
  finally { await dir.close(); }
}

async function withFile<T>(dir: FileHandle, name: string, run: (file: FileHandle) => Promise<T>): Promise<T> {
  const file = await open(inside(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { return await run(file); }
  finally { await file.close(); }
}

async function readMarker(dir: FileHandle): Promise<string> {
  try {
    return await withFile(dir, ".project_root", async (file) => {
      const info = await file.stat();
      if (!info.isFile() || info.size > 4096) return "";
      const buffer = Buffer.alloc(info.size);
      const { bytesRead } = await file.read(buffer, 0, info.size, 0);
      return buffer.toString("utf8", 0, bytesRead).trim();
    });
  } catch { return ""; }
}

interface ScanBudget {
  entries: number;
  files: number;
  bytes: number;
}

async function walk(
  dir: FileHandle, tree: SourceTree, parts: string[], budget: ScanBudget, scan: HistoryScan,
  visit: (dir: FileHandle, parts: string[], marker?: string) => Promise<void>, marker?: string,
): Promise<void> {
  const directory = await opendir(inside(dir));
  for await (const entry of directory) {
    if (++budget.entries > MAX_ENTRIES || budget.files === MAX_FILES || budget.bytes === 0) {
      scan.limited = true;
      return;
    }
    const current = [...parts, entry.name];
    const subdir = tree.directories[parts.length];
    if (entry.isSymbolicLink()) {
      if ((subdir ?? tree.files).test(entry.name)) scan.skippedFiles++;
      continue;
    }
    if (subdir?.test(entry.name) && entry.isDirectory()) {
      // The Gemini project directory owns a marker beside its chats subdirectory.
      const nextMarker = tree.source === "gemini" && parts.length === 1 ? await readMarker(dir) : marker;
      try {
        await inDirectory(dir, [entry.name], (child) => walk(child, tree, current, budget, scan, visit, nextMarker));
      } catch (err) {
        if (errno(err) !== "ENOENT") scan.skippedFiles++;
      }
    } else if (!subdir && tree.files.test(entry.name) && entry.isFile()) {
      budget.files++;
      await visit(dir, current, marker);
    }
  }
}

interface SessionRead {
  session?: HistoricalSession;
  invalidLines: number;
  limited: boolean;
  skipped: boolean;
}

async function readSession(
  source: HistorySource, dir: FileHandle, filename: string, budget: ScanBudget, marker?: string,
): Promise<SessionRead> {
  const read: SessionRead = { invalidLines: 0, limited: false, skipped: false };
  return withFile(dir, filename, async (file) => {
    const info = await file.stat();
    if (!info.isFile() || info.size === 0 || (source === "gemini" && !marker)) return { ...read, skipped: true };
    if (info.size > MAX_FILE_BYTES || info.size > budget.bytes) return { ...read, skipped: true, limited: true };
    budget.bytes -= info.size;
    const parser = parseSession(source, path.basename(filename, ".jsonl"), info.mtimeMs, marker);
    const input = file.createReadStream({ encoding: "utf8", autoClose: false, start: 0, end: info.size - 1 });
    try {
      if (filename.endsWith(".json")) {
        // Legacy Gemini sessions are one JSON document, with the same byte cap as JSONL.
        const chunks: string[] = [];
        for await (const chunk of input) chunks.push(chunk);
        try { parser.read(JSON.parse(chunks.join(""))); }
        catch (err) {
          if (!(err instanceof SyntaxError)) throw err;
          read.invalidLines++;
        }
      } else {
        const lines = createInterface({ input, crlfDelay: Infinity });
        let count = 0;
        for await (const line of lines) {
          if (++count > MAX_LINES) return { ...read, skipped: true, limited: true };
          if (!line.trim()) continue;
          try { parser.read(JSON.parse(line)); }
          catch (err) {
            if (!(err instanceof SyntaxError)) throw err;
            read.invalidLines++;
          }
        }
      }
    } finally {
      input.destroy();
    }
    read.session = parser.finish();
    read.skipped = !read.session;
    return read;
  });
}

export class HistoryImporter {
  private readonly options: ImporterOptions;
  private scans = new Map<string, ScanSelection>();
  private scanning = false;
  private importing = false;

  constructor(options: ImporterOptions) {
    this.options = options;
  }

  private async projectPath(cwd: string): Promise<string | undefined> {
    try {
      const root = guardProjectRoot(cwd, this.options.dataDir);
      if ((await stat(root)).isDirectory()) return root;
    } catch { /* The working directory may have moved or been removed. */ }
  }

  async scan(): Promise<HistoryScan> {
    if (this.scanning) throw new HttpError(409, "Et søk etter samtalehistorikk pågår allerede.");
    this.scanning = true;
    try {
      const scan: HistoryScan = { id: randomUUID(), projects: [], files: 0, invalidLines: 0, missingFolders: 0, skippedFiles: 0, limited: false };
      const entries = new Map<string, ScanEntry>();
      const seenSessions = new Set<string>();
      const projects = new Map<string, ImportProjectPreview>();
      const paths = new Map<string, string | undefined>();
      const missing = new Set<string>();
      const home = await open(this.options.home, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        for (const tree of trees) {
          const budget = { entries: 0, files: 0, bytes: MAX_SOURCE_BYTES };
          try {
            await inDirectory(home, tree.root, (dir) => walk(dir, tree, [], budget, scan, async (parent, parts, marker) => {
              const name = parts.at(-1)!;
              scan.files++;
              let read: SessionRead;
              try { read = await readSession(tree.source, parent, name, budget, marker); }
              catch {
                scan.skippedFiles++;
                return;
              }
              const { session } = read;
              scan.invalidLines += read.invalidLines;
              scan.skippedFiles += Number(read.skipped);
              scan.limited ||= read.limited;
              if (!session) return;
              if (!paths.has(session.cwd)) paths.set(session.cwd, await this.projectPath(session.cwd));
              const projectPath = paths.get(session.cwd);
              if (!projectPath) {
                missing.add(session.cwd);
                return;
              }
              const key = `${tree.source}\0${session.sessionId}`;
              if (seenSessions.has(key)) {
                scan.skippedFiles++;
                return;
              }
              seenSessions.add(key);
              const id = randomUUID();
              entries.set(id, { source: tree.source, filename: [...tree.root, ...parts], sessionId: session.sessionId, projectPath });
              const project = projects.get(projectPath) ?? { path: projectPath, updatedAt: 0, threads: [] };
              project.updatedAt = Math.max(project.updatedAt, session.updatedAt);
              project.threads.push({
                id, source: tree.source, title: session.title, updatedAt: session.updatedAt,
                imported: this.options.store.hasImportedSession(tree.source, session.sessionId),
              });
              projects.set(projectPath, project);
            }));
          } catch (err) {
            if (errno(err) !== "ENOENT") scan.skippedFiles++;
          }
        }
      } finally {
        await home.close();
      }
      scan.missingFolders = missing.size;
      scan.projects = [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const project of scan.projects) project.threads.sort((a, b) => b.updatedAt - a.updatedAt);
      this.scans.set(scan.id, { at: Date.now(), entries });
      if (this.scans.size > MAX_SCANS) this.scans.delete(this.scans.keys().next().value!);
      return scan;
    } finally {
      this.scanning = false;
    }
  }

  async apply(scanId: unknown, selection: unknown): Promise<HistoryImportResult> {
    const scan = typeof scanId === "string" ? this.scans.get(scanId) : undefined;
    if (!scan || Date.now() - scan.at > SCAN_AGE) throw new HttpError(409, "Søket er utløpt. Søk etter samtalehistorikk på nytt.");
    if (!Array.isArray(selection) || !selection.length || selection.length > MAX_FILES * trees.length
      || selection.some((id) => typeof id !== "string" || !scan.entries.has(id))) {
      throw new HttpError(400, "Velg tråder fra søkeresultatet.");
    }
    if (this.importing) throw new HttpError(409, "En import pågår allerede.");
    this.importing = true;
    try {
      return await this.importSessions([...new Set<string>(selection)].map((id) => scan.entries.get(id)!));
    } finally {
      this.importing = false;
    }
  }

  private async importSessions(selection: ScanEntry[]): Promise<HistoryImportResult> {
    const { store, config, findModel, projectChanged, threadChanged } = this.options;
    const result: HistoryImportResult = { projectsCreated: 0, projectsReused: 0, threadsImported: 0, threadsSkipped: 0, problems: 0 };
    const projects = new Set<string>();
    const budget = { entries: 0, files: 0, bytes: MAX_SOURCE_BYTES * trees.length };
    const home = await open(this.options.home, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      for (const entry of selection) {
        try {
          if (store.hasImportedSession(entry.source, entry.sessionId)) {
            result.threadsSkipped++;
            if (!projects.has(entry.projectPath) && store.projectByPath(entry.projectPath)) {
              projects.add(entry.projectPath);
              result.projectsReused++;
            }
            continue;
          }
          const dirs = entry.filename.slice(0, -1);
          const marker = entry.source === "gemini"
            ? await inDirectory(home, dirs.slice(0, -1), readMarker) : undefined;
          const { session } = await inDirectory(home, dirs, (dir) => readSession(entry.source, dir, entry.filename.at(-1)!, budget, marker));
          if (!session || session.sessionId !== entry.sessionId || await this.projectPath(session.cwd) !== entry.projectPath) {
            result.problems++;
            continue;
          }
          const root = guardProjectRoot(session.cwd, this.options.dataDir);
          if (root !== entry.projectPath) {
            result.problems++;
            continue;
          }
          const { project, reused, threadId } = store.transaction(() => {
            const existing = store.projectByPath(root);
            const folder = config.effective({ path: root } as Project);
            const name = cleanName(path.basename(root)) || path.basename(root);
            const project = existing ?? store.createProject(name, root, folder.permissionMode ?? store.settings().defaultPermissionMode);
            const modelId = project.defaultModelId ?? findModel(folder.model) ?? null;
            const threadId = store.createImportedThread(project.id, session, modelId);
            if (folder.personality && folder.personality !== "standard") store.updateThread(threadId, { personality: folder.personality });
            return { project, reused: !!existing, threadId };
          });
          if (!projects.has(root)) {
            projects.add(root);
            if (reused) result.projectsReused++;
            else result.projectsCreated++;
          }
          result.threadsImported++;
          if (!reused) projectChanged(project);
          threadChanged(threadId);
        } catch {
          result.problems++;
        }
      }
    } finally {
      await home.close();
    }
    return result;
  }
}
