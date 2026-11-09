// Listing and reading project files, for the file panel, @ mentions and the agent tools.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { FileContent, FileEntry } from "../../shared/protocol.ts";
import { guardPath } from "./paths.ts";

export const MAX_TEXT_FILE = 2 * 1024 * 1024;
const HIDDEN = new Set([".git", "node_modules"]);

// A matcher per .gitignore on the way from the project root down to `dir`.
function ignoreChain(root: string, relDir: string): Array<{ base: string; rules: Ignore }> {
  const chain: Array<{ base: string; rules: Ignore }> = [];
  let current = "";
  for (const part of ["", ...(relDir === "." ? [] : relDir.split(path.sep))]) {
    current = path.join(current, part);
    try {
      chain.push({ base: current, rules: ignore().add(readFileSync(path.join(root, current, ".gitignore"), "utf8")) });
    } catch {
      // No .gitignore at this level.
    }
  }
  return chain;
}

export function listDir(root: string, input: string, dataDir: string, options: { respectIgnore: boolean }): FileEntry[] {
  const { abs, rel } = guardPath(root, input, dataDir);
  const chain = options.respectIgnore ? ignoreChain(root, rel) : [];
  const entries: FileEntry[] = [];
  for (const dirent of readdirSync(abs, { withFileTypes: true })) {
    if (HIDDEN.has(dirent.name)) continue;
    const entryRel = rel === "." ? dirent.name : path.join(rel, dirent.name);
    let isDir = dirent.isDirectory();
    let size: number | undefined;
    try {
      const stat = statSync(path.join(abs, dirent.name));
      isDir = stat.isDirectory();
      size = stat.isFile() ? stat.size : undefined;
    } catch {
      continue; // Broken symlink.
    }
    const ignored = chain.some(({ base, rules }) => {
      const fromBase = path.relative(base, entryRel);
      return rules.ignores(isDir ? `${fromBase}/` : fromBase);
    });
    if (ignored) continue;
    entries.push({ name: dirent.name, path: entryRel, kind: isDir ? "dir" : "file", size });
  }
  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "nb") : a.kind === "dir" ? -1 : 1));
}

export function looksBinary(data: Uint8Array): boolean {
  if (data.subarray(0, 8192).includes(0)) return true;
  try {
    // stream: true, so a sequence cut off at the end of a slice is not an error.
    new TextDecoder("utf-8", { fatal: true }).decode(data, { stream: true });
    return false;
  } catch {
    return true;
  }
}

export function readFileContent(root: string, input: string, dataDir: string, maxBytes = MAX_TEXT_FILE): FileContent {
  const { abs, rel } = guardPath(root, input, dataDir);
  const stat = statSync(abs);
  if (!stat.isFile()) throw Object.assign(new Error("Ikke en fil"), { status: 400 });
  const data = readFileSync(abs);
  const truncated = data.length > maxBytes;
  const slice = truncated ? data.subarray(0, maxBytes) : data;
  const binary = looksBinary(slice);
  return {
    path: rel,
    text: binary ? null : new TextDecoder().decode(slice),
    size: stat.size,
    binary,
    truncated,
  };
}

// Every file ripgrep would search, which honours .gitignore, also in a folder that is not a git
// repository. Used for @ mentions.
export function listAllFiles(root: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn("rg", ["--no-config", "--files", "--hidden", "--no-require-git", "--glob", "!.git", "--glob", "!node_modules", "--glob", "!.env*"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", () => resolve([]));
    child.on("close", () => resolve(Buffer.concat(chunks).toString("utf8").split("\n").filter(Boolean).sort()));
  });
}

// Subsequence match with a bonus for hits in the file name and at word starts. Lower is better,
// null means no match.
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return target.length;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const nameStart = t.lastIndexOf("/") + 1;
  const direct = t.indexOf(q, nameStart);
  if (direct !== -1) return direct - nameStart;
  const anywhere = t.indexOf(q);
  if (anywhere !== -1) return 100 + anywhere;
  let at = -1;
  let gaps = 0;
  for (const char of q) {
    const next = t.indexOf(char, at + 1);
    if (next === -1) return null;
    gaps += next - at - 1;
    at = next;
  }
  return 1000 + gaps;
}
