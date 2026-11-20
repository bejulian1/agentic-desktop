// Pure local tool/storage tests: overlapping work must never become another turn's undo target.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/db.ts";
import { FileState } from "../src/agent/filestate.ts";
import { TOOLS_BY_NAME, type ToolContext } from "../src/agent/tools.ts";
import { TurnConflict, Turns } from "../src/agent/turns.ts";
import { tempDir } from "./helpers.ts";

function fixture(t: TestContext) {
  const data = tempDir(t);
  const root = tempDir(t);
  const store = new Store(data);
  t.after(() => store.close());
  const turns = new Turns(store, data);
  const files = new FileState();
  const project = store.createProject("Lokalt testprosjekt", root, "full");
  const parent = store.createThread(project.id, "code", null);
  let next = 0;
  const context = () => {
    const thread = store.createThread(project.id, "code", null, { title: `Hjelper ${++next}`, parentThreadId: parent.id, permissionCap: "full" });
    const turnId = `turn-${next}`;
    const runId = `run-${next}`;
    store.createRun({ id: runId, threadId: thread.id, modelId: "demo", turnId, startSeq: 1 });
    return {
      thread, project, turnId, runId, turns, files, dataDir: data,
      signal: new AbortController().signal, output: () => {}, filesChanged: () => {},
      commandTimeoutMs: 2000,
      env: () => ({ PATH: process.env.PATH ?? "", HOME: data, XDG_CONFIG_HOME: path.join(data, "config"), XDG_DATA_HOME: path.join(data, "share"), AD_DATA_DIR: data }),
    } as unknown as ToolContext;
  };
  const run = async (ctx: ToolContext, name: string, input: Record<string, unknown>) => {
    const result = await TOOLS_BY_NAME.get(name)!.run(input, ctx);
    assert.ok(!result.isError, result.text);
    return result;
  };
  return { data, root, store, turns, context, run };
}

test("interleaved helpers keep their own post-edit bytes and undo refuses to erase the later helper", async (t) => {
  const h = fixture(t);
  const file = path.join(h.root, "shared.txt");
  writeFileSync(file, "original\n");
  const a = h.context();
  const b = h.context();
  await h.run(a, "edit_file", { path: "shared.txt", old_string: "original", new_string: "helper A" });
  await h.run(b, "edit_file", { path: "shared.txt", old_string: "helper A", new_string: "helper B" });
  h.turns.finish(b.turnId, h.root);
  h.turns.finish(a.turnId, h.root); // A finishes last, while the shared disk contains B's work.
  assert.equal(h.turns.diff(a.turnId).files[0].after, "helper A\n");
  assert.equal(h.turns.diff(b.turnId).files[0].before, "helper A\n");
  assert.equal(h.turns.diff(b.turnId).files[0].after, "helper B\n");
  assert.throws(() => h.turns.revert(a.turnId, h.root, false), TurnConflict);
  assert.equal(readFileSync(file, "utf8"), "helper B\n");
  h.turns.revert(b.turnId, h.root, false);
  h.turns.revert(a.turnId, h.root, false);
  assert.equal(readFileSync(file, "utf8"), "original\n");
});

test("a command changing a tool-written file stays outside the recorded diff and blocks undo", async (t) => {
  const h = fixture(t);
  const ctx = h.context();
  await h.run(ctx, "write_file", { path: "result.txt", content: "tool bytes\n" });
  await h.run(ctx, "run_command", { command: "node -e \"require('node:fs').appendFileSync('result.txt', 'shell bytes\\n')\"" });
  h.turns.finish(ctx.turnId, h.root);
  const recorded = h.turns.diff(ctx.turnId).files[0];
  assert.equal(recorded.after, "tool bytes\n");
  assert.equal(recorded.additions, 1);
  assert.throws(() => h.turns.revert(ctx.turnId, h.root, false), TurnConflict);
  assert.equal(readFileSync(path.join(h.root, "result.txt"), "utf8"), "tool bytes\nshell bytes\n");
});

test("repeated A/B/A edits persist overlap and require explicit force before undo can erase B", async (t) => {
  const h = fixture(t);
  const file = path.join(h.root, "shared.txt");
  writeFileSync(file, "original\nuntouched\n");
  const a = h.context();
  const b = h.context();
  await h.run(a, "edit_file", { path: "shared.txt", old_string: "original", new_string: "helper A" });
  await h.run(b, "edit_file", { path: "shared.txt", old_string: "untouched", new_string: "helper B" });
  await h.run(a, "edit_file", { path: "shared.txt", old_string: "helper A", new_string: "helper A final" });
  h.turns.finish(b.turnId, h.root);
  h.turns.finish(a.turnId, h.root);
  assert.equal(h.store.turnFiles(a.turnId)[0].interleaved, true);
  assert.equal(h.turns.diff(a.turnId).files[0].overlapping, true);
  const reopened = new Store(h.data);
  try {
    assert.equal(reopened.turnFiles(a.turnId)[0].interleaved, true);
    assert.throws(() => new Turns(reopened, h.data).revert(a.turnId, h.root, false), TurnConflict);
    assert.equal(readFileSync(file, "utf8"), "helper A final\nhelper B\n");
  } finally {
    reopened.close();
  }
});

test("successive writes by the same helper stay attributable and can be undone normally", async (t) => {
  const h = fixture(t);
  const file = path.join(h.root, "own.txt");
  writeFileSync(file, "original\n");
  const ctx = h.context();
  await h.run(ctx, "edit_file", { path: "own.txt", old_string: "original", new_string: "first edit" });
  await h.run(ctx, "edit_file", { path: "own.txt", old_string: "first edit", new_string: "second edit" });
  h.turns.finish(ctx.turnId, h.root);
  assert.equal(h.store.turnFiles(ctx.turnId)[0].interleaved, false);
  h.turns.revert(ctx.turnId, h.root, false);
  assert.equal(readFileSync(file, "utf8"), "original\n");
});

test("a capture left by a failed write does not own an external edit before a later successful write", async (t) => {
  const h = fixture(t);
  const file = path.join(h.root, "retry.txt");
  writeFileSync(file, "original\n");
  const ctx = h.context();
  h.turns.capture(ctx.turnId, "retry.txt", readFileSync(file)); // The attempted write fails before changing bytes.
  writeFileSync(file, "external edit\n");
  await h.run(ctx, "edit_file", { path: "retry.txt", old_string: "external edit", new_string: "helper edit" });
  h.turns.finish(ctx.turnId, h.root);
  assert.equal(h.turns.diff(ctx.turnId).files[0].before, "external edit\n");
  assert.equal(h.store.turnFiles(ctx.turnId)[0].interleaved, false);
  h.turns.revert(ctx.turnId, h.root, false);
  assert.equal(readFileSync(file, "utf8"), "external edit\n");
});

test("recorded deletion survives database reopen and refuses to erase a recreated file", async (t) => {
  const h = fixture(t);
  const ctx = h.context();
  const file = path.join(h.root, "deleted.txt");
  writeFileSync(file, "original\n");
  await h.run(ctx, "delete_file", { path: "deleted.txt" });
  assert.equal(existsSync(file), false);
  assert.equal(h.store.turnFiles(ctx.turnId)[0].afterCaptured, true);
  writeFileSync(file, "recreated elsewhere\n");
  // A second connection proves the nullable after value is a persisted deletion marker.
  const reopened = new Store(h.data);
  try {
    const turns = new Turns(reopened, h.data);
    assert.equal(reopened.turnFiles(ctx.turnId)[0].afterCaptured, true);
    turns.finish(ctx.turnId, h.root);
    assert.equal(turns.diff(ctx.turnId).files[0].change, "deleted");
    assert.equal(turns.diff(ctx.turnId).files[0].after, null);
    assert.throws(() => turns.revert(ctx.turnId, h.root, false), TurnConflict);
    assert.equal(readFileSync(file, "utf8"), "recreated elsewhere\n");
  } finally {
    reopened.close();
  }
});

test("legacy database migration distinguishes an unfinished capture from a recorded deletion", (t) => {
  const data = tempDir(t);
  const original = new Store(data);
  const thread = original.createThread(null, "code", null);
  original.createRun({ id: "legacy-run", threadId: thread.id, modelId: "demo", turnId: "legacy-turn", startSeq: 1 });
  original.addTurnFile("legacy-turn", "legacy.txt", Buffer.from("before\n"));
  original.close();
  const legacy = new DatabaseSync(path.join(data, "agentic-desktop.db"));
  legacy.exec("ALTER TABLE turn_files DROP COLUMN after_captured");
  legacy.exec("ALTER TABLE turn_files DROP COLUMN interleaved");
  legacy.close();
  const migrated = new Store(data);
  try {
    const row = migrated.turnFiles("legacy-turn")[0];
    assert.equal(row.after, null);
    assert.equal(row.afterCaptured, false);
    assert.equal(row.interleaved, false);
    migrated.recordTurnFileAfter("legacy-turn", "legacy.txt", null);
    assert.equal(migrated.turnFiles("legacy-turn")[0].afterCaptured, true);
  } finally {
    migrated.close();
  }
});
