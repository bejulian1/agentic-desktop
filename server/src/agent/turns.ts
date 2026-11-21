// Per-turn snapshots: what each file looked like before and after this turn's file tools wrote it.
// Changes made by shell commands are not captured, and the UI says so.
import { closeSync, constants, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChangedFile, TurnDiff } from "../../../shared/protocol.ts";
import type { Store, TurnFileRow } from "../db.ts";
import { lineChangeCounts } from "../../../shared/line-diff.ts";
import { guardPath } from "../paths.ts";

export class TurnConflict extends Error {
  status = 409;
  conflicts: string[];

  constructor(conflicts: string[]) {
    super("Kan ikke angre uten å overskrive andre endringer");
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

// Keep the public count helper compatible; finish/diff also expose precision and binary metadata.
export function countChanges(before: string, after: string): { additions: number; deletions: number } {
  const { additions, deletions } = lineChangeCounts(before, after);
  return { additions, deletions };
}

function textChanges(before: Uint8Array | null, after: Uint8Array | null, ignoreWhitespace = false) {
  const a = decode(before);
  const b = decode(after);
  const binary = (before !== null && (a === null || a.includes("\0"))) || (after !== null && (b === null || b.includes("\0")));
  return binary
    ? { additions: 0, deletions: 0, binary: true, countsExact: false }
    : { ...lineChangeCounts(a, b, { ignoreWhitespace }), binary: false };
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
    else {
      const previous = this.store.turnFiles(turnId).find((row) => row.path === rel);
      // Another writer intervened between this turn's own writes. A combined before/after
      // can be displayed, but reversing it would also reverse that other writer's work.
      if (previous?.afterCaptured && !equal(previous.after, before)) this.store.markTurnFileInterleaved(turnId, rel);
      else if (previous && !previous.afterCaptured) this.store.updateUncapturedTurnFileBefore(turnId, rel, before);
    }
  }

  // Called inside the same file lock immediately after a successful write/delete. Later writes
  // by another thread or shell must cause an undo conflict, not become part of this turn.
  recordAfter(turnId: string, rel: string, after: Uint8Array | null): void {
    this.store.recordTurnFileAfter(turnId, rel, after);
  }

  finish(turnId: string, _root: string): ChangedFile[] {
    const changed: ChangedFile[] = [];
    for (const row of this.store.turnFiles(turnId)) {
      if (!row.afterCaptured) continue; // A failed write has no postimage to attribute.
      const after = row.after;
      if (equal(row.before, after)) continue;
      const counts = textChanges(row.before, after);
      const change: ChangedFile["change"] = row.before === null ? "added" : after === null ? "deleted" : "modified";
      const file: TurnFileRow = { path: row.path, before: row.before, after, change, ...counts };
      this.store.finishTurnFile(turnId, file);
      changed.push({ path: row.path, change, ...counts, ...(row.interleaved ? { overlapping: true } : {}) });
    }
    return changed;
  }

  diff(turnId: string, ignoreWhitespace = false): TurnDiff {
    const files = this.store.turnFiles(turnId).filter((row) => row.change);
    return {
      turnId,
      files: files.map((row) => ({
        path: row.path,
        change: row.change!,
        ...textChanges(row.before, row.after, ignoreWhitespace),
        ...(row.interleaved ? { overlapping: true } : {}),
        before: decode(row.before),
        after: decode(row.after),
      })),
    };
  }

  // Refuses to overwrite anything changed since the turn, unless forced.
  revert(turnId: string, root: string, force: boolean): string[] {
    const files = this.store.turnFiles(turnId).filter((row) => row.change);
    const targets = files.map((row) => ({ row, abs: guardPath(root, row.path, this.dataDir).abs }));
    const conflicts = targets.filter(({ row, abs }) => row.interleaved || !equal(row.after, readOrNull(abs))).map(({ row }) => row.path);
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
