// Per-turn snapshots: what each file looked like before and after the file tools touched it.
// Changes made by shell commands are not captured, and the UI says so.
import { closeSync, constants, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChangedFile, TurnDiff } from "../../../shared/protocol.ts";
import type { Store, TurnFileRow } from "../db.ts";
import { guardPath } from "../paths.ts";

export class TurnConflict extends Error {
  status = 409;
  conflicts: string[];

  constructor(conflicts: string[]) {
    super("Filer er endret etter denne turen");
    this.conflicts = conflicts;
  }
}

function readOrNull(file: string): Buffer | null {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

function equal(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  return Buffer.compare(a, b) === 0;
}

function decode(data: Uint8Array | null): string | null {
  if (data === null) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

// Line counts for the summary. Matches lines as a multiset, which is cheap and close enough;
// the UI computes the real diff from before and after.
export function countChanges(before: string, after: string): { additions: number; deletions: number } {
  const remaining = new Map<string, number>();
  const beforeLines = before === "" ? [] : before.split("\n");
  const afterLines = after === "" ? [] : after.split("\n");
  for (const line of beforeLines) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let additions = 0;
  for (const line of afterLines) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) remaining.set(line, left - 1);
    else additions++;
  }
  let deletions = 0;
  for (const left of remaining.values()) deletions += left;
  return { additions, deletions };
}

export class Turns {
  private store: Store;
  private dataDir: string;

  constructor(store: Store, dataDir: string) {
    this.store = store;
    this.dataDir = dataDir;
  }

  // Called before a file tool writes. Only the first write in a turn keeps the old content.
  capture(turnId: string, rel: string, before: Uint8Array | null): void {
    if (!this.store.hasTurnFile(turnId, rel)) this.store.addTurnFile(turnId, rel, before);
  }

  finish(turnId: string, root: string): ChangedFile[] {
    const changed: ChangedFile[] = [];
    for (const row of this.store.turnFiles(turnId)) {
      const after = readOrNull(guardPath(root, row.path, this.dataDir).abs);
      if (equal(row.before, after)) continue;
      const counts = countChanges(decode(row.before) ?? "", decode(after) ?? "");
      const change: ChangedFile["change"] = row.before === null ? "added" : after === null ? "deleted" : "modified";
      const file: TurnFileRow = { path: row.path, before: row.before, after, change, ...counts };
      this.store.finishTurnFile(turnId, file);
      changed.push({ path: row.path, change, ...counts });
    }
    return changed;
  }

  diff(turnId: string): TurnDiff {
    const files = this.store.turnFiles(turnId).filter((row) => row.change);
    return {
      turnId,
      files: files.map((row) => ({
        path: row.path,
        change: row.change!,
        additions: row.additions,
        deletions: row.deletions,
        before: decode(row.before),
        after: decode(row.after),
      })),
    };
  }

  // Refuses to overwrite anything changed since the turn, unless forced.
  revert(turnId: string, root: string, force: boolean): string[] {
    const files = this.store.turnFiles(turnId).filter((row) => row.change);
    const targets = files.map((row) => ({ row, abs: guardPath(root, row.path, this.dataDir).abs }));
    const conflicts = targets.filter(({ row, abs }) => !equal(row.after, readOrNull(abs))).map(({ row }) => row.path);
    if (conflicts.length && !force) throw new TurnConflict(conflicts);
    for (const { row, abs } of targets) {
      if (row.before === null) {
        rmSync(abs, { force: true });
      } else {
        mkdirSync(path.dirname(abs), { recursive: true });
        // O_NOFOLLOW, as in the file tools: no symlink put there since the path check.
        const fd = openSync(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
        try {
          writeFileSync(fd, row.before);
        } finally {
          closeSync(fd);
        }
      }
    }
    return targets.map(({ row }) => row.path);
  }
}
