import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { lineChangeCounts, lineDiff } from "../../shared/line-diff.ts";
import { Store } from "../src/db.ts";
import { Turns } from "../src/agent/turns.ts";
import { tempDir } from "./helpers.ts";

test("ordered line counts match a move, repeated lines and real trailing terminators", () => {
  for (const [before, after, additions, deletions] of [
    ["a\nb\n", "b\na\n", 1, 1],
    ["a\na\nb\n", "a\nb\nb\n", 1, 1],
    ["", "new\n", 1, 0],
    ["old\n", "", 0, 1],
    ["a", "a\n", 1, 1],
    ["a\n", "a", 1, 1],
    ["a\n", "a\n\n", 1, 0],
    ["a\n", "a\n", 0, 0],
    ["\n", "", 0, 1],
  ] as const) {
    assert.deepEqual(lineChangeCounts(before, after), { additions, deletions, countsExact: true });
  }
  assert.deepEqual(lineDiff("a", "a\n").lines, [
    { kind: "del", text: "a", oldLine: 1, noNewline: true },
    { kind: "add", text: "a", newLine: 1 },
  ]);
});

test("large unrelated file middles are bounded and explicitly marked approximate", () => {
  const before = Array.from({ length: 2001 }, (_, n) => `old ${n}\n`).join("");
  const after = Array.from({ length: 2001 }, (_, n) => `new ${n}\n`).join("");
  assert.deepEqual(lineChangeCounts(before, after), { additions: 2001, deletions: 2001, countsExact: false });
  // Common prefix/suffix do not inflate the table; small edits in large files stay exact.
  assert.deepEqual(lineChangeCounts(before + "end\n", before + "changed\n"), { additions: 1, deletions: 1, countsExact: true });
});

test("persisted turn snapshots keep text precision, binary metadata and byte-safe undo", (t) => {
  const data = tempDir(t);
  const root = tempDir(t);
  const store = new Store(data);
  t.after(() => store.close());
  const turns = new Turns(store, data);
  const thread = store.createThread(null, "code", null);
  store.createRun({ id: "run-test", threadId: thread.id, modelId: "demo", turnId: "turn-test", startSeq: 1 });
  const originals = new Map<string, Buffer | null>([
    ["moved.txt", Buffer.from("a\nb\n")],
    ["invalid.bin", Buffer.from([0xff, 0xfe, 1])],
    ["nul.bin", Buffer.from([0, 1, 2])],
    ["added.txt", null],
  ]);
  for (const [file, before] of originals) turns.capture("turn-test", file, before);
  writeFileSync(path.join(root, "moved.txt"), "b\na\n");
  writeFileSync(path.join(root, "invalid.bin"), "valid\n");
  writeFileSync(path.join(root, "nul.bin"), Buffer.from([0, 3, 4]));
  writeFileSync(path.join(root, "added.txt"), "hello\n");
  for (const file of originals.keys()) turns.recordAfter("turn-test", file, readFileSync(path.join(root, file)));
  const files = turns.finish("turn-test", root);
  assert.deepEqual(files.find((f) => f.path === "moved.txt"), { path: "moved.txt", change: "modified", additions: 1, deletions: 1, countsExact: true, binary: false });
  for (const name of ["invalid.bin", "nul.bin"]) {
    assert.deepEqual(files.find((f) => f.path === name), { path: name, change: "modified", additions: 0, deletions: 0, binary: true, countsExact: false });
  }
  assert.equal(files.find((f) => f.path === "added.txt")?.additions, 1);
  assert.deepEqual(turns.diff("turn-test").files.map(({ before: _before, after: _after, ...file }) => file), files);
  turns.revert("turn-test", root, false);
  for (const [file, before] of originals) if (before) assert.deepEqual(readFileSync(path.join(root, file)), before);
});
