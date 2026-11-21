// Server tests for Kode Studio: create-only POST /api/projects/:id/file, projectPath guards,
// and bounded ProjectWatches lifecycle over WebSocket.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { startHarness, tempDir, until } from "./helpers.ts";

test("POST /api/projects/:id/file oppretter nye tekstfiler uten å overskrive eksisterende eller beskyttede stier", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  const outside = tempDir(t);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "eksisterer.ts"), "export const x = 1;\n");
  writeFileSync(path.join(outside, "utenfor.txt"), "hemmelig\n");
  symlinkSync(path.join(outside, "utenfor.txt"), path.join(dir, "lenke.txt"));
  const project = await h.project(dir);
  const socket = await h.socket();

  // Creating a new file works and broadcasts project.files-changed.
  const created = await h.api("POST", `/api/projects/${project.id}/file`, {
    path: "src/ny.ts",
    projectPath: project.path,
    text: "export const hei = true;\n",
  });
  assert.equal(created.path, "src/ny.ts");
  assert.equal(created.editable, true);
  assert.equal(created.text, "export const hei = true;\n");
  assert.equal(readFileSync(path.join(dir, "src/ny.ts"), "utf8"), "export const hei = true;\n");
  await socket.waitFor((m) => m.type === "project.files-changed" && m.projectId === project.id && m.paths.includes("src/ny.ts"));

  const postRaw = (body: unknown) =>
    h.raw("POST", `/api/projects/${project.id}/file`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Existing file: 409 without overwriting.
  const dup = await postRaw({ path: "eksisterer.ts", projectPath: project.path, text: "ny" });
  assert.equal(dup.status, 409);
  assert.equal(readFileSync(path.join(dir, "eksisterer.ts"), "utf8"), "export const x = 1;\n");

  // Missing parent directory: clean 400.
  const noParent = await postRaw({ path: "mangler/fil.ts", projectPath: project.path, text: "" });
  assert.equal(noParent.status, 400);
  assert.match(JSON.parse(noParent.body).error, /Foreldremappen finnes ikke/);

  // Directory path: clean 400/409 (EEXIST for existing directory).
  const isDir = await postRaw({ path: "src", projectPath: project.path, text: "" });
  assert.ok(isDir.status === 400 || isDir.status === 409);

  // Protected, ignored, traversal, symlink, binary.
  assert.equal((await postRaw({ path: ".env", projectPath: project.path, text: "A=1" })).status, 403);
  assert.equal((await postRaw({ path: ".git/foo", projectPath: project.path, text: "x" })).status, 403);
  assert.equal((await postRaw({ path: "node_modules/a.js", projectPath: project.path, text: "x" })).status, 403);
  assert.equal((await postRaw({ path: "../ut.txt", projectPath: project.path, text: "x" })).status, 403);
  assert.equal((await postRaw({ path: "lenke.txt", projectPath: project.path, text: "x" })).status, 403);
  assert.equal(readFileSync(path.join(outside, "utenfor.txt"), "utf8"), "hemmelig\n");
  assert.equal((await postRaw({ path: "bin.dat", projectPath: project.path, text: "abc\0def" })).status, 400);

  // Stale projectPath rejected on both POST and PUT with code: project-moved.
  const wrongRootPost = await postRaw({ path: "annet.ts", projectPath: outside, text: "" });
  assert.equal(wrongRootPost.status, 409);
  assert.equal(JSON.parse(wrongRootPost.body).code, "project-moved");

  const wrongRootPut = await h.raw("PUT", `/api/projects/${project.id}/file`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "src/ny.ts", projectPath: outside, text: "endret", hash: created.hash }),
  });
  assert.equal(wrongRootPut.status, 409);
  assert.equal(JSON.parse(wrongRootPut.body).code, "project-moved");
});

test("ProjectWatches følger bare synlige mapper, avviser beskyttede stier og gjenoppretter etter mappebytte", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/app.ts"), "export const v = 1;\n");
  const project = await h.project(dir);
  const socket = await h.socket();

  // Subscribe to root and src.
  socket.send({ type: "project.watch", projectId: project.id, directories: ["src"] });
  const state = await socket.waitFor((m) => m.type === "project.watch-state" && m.projectId === project.id && m.watching);
  assert.equal(state.type, "project.watch-state");
  assert.ok(state.directories.includes(".") && state.directories.includes("src"));

  // External file write notifies the subscribed client.
  writeFileSync(path.join(dir, "src/app.ts"), "export const v = 2;\n");
  const changed = await socket.waitFor((m) => m.type === "project.files-changed" && m.projectId === project.id && m.paths.some((p) => p.includes("app.ts")));
  assert.equal(changed.type, "project.files-changed");

  // Replace src directory with a new inode (atomic rename + recreate) and verify watch recovers.
  const backup = path.join(dir, "src-old");
  renameSync(path.join(dir, "src"), backup);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  // Let parent event repair the child directory watch.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const beforeCount = socket.received.length;
  writeFileSync(path.join(dir, "src/recovered.ts"), "export const ok = true;\n");
  await until(
    () => socket.received.slice(beforeCount).some((m) => m.type === "project.files-changed" && m.projectId === project.id && m.paths.some((p) => p.includes("recovered.ts"))),
    "gjenopprettet mappeovervåking etter inode-bytte",
    5000,
  );
  rmSync(backup, { recursive: true, force: true });

  // Protected / ignored directories are rejected without dropping the valid watch.
  socket.send({ type: "project.watch", projectId: project.id, directories: [".git"] });
  const errMsg = await socket.waitFor((m) => m.type === "error" && /kan ikke følges/.test(m.message));
  assert.equal(errMsg.type, "error");

  // Unwatch stops notifications cleanly.
  socket.send({ type: "project.unwatch", projectId: project.id });
  const unwatched = await socket.waitFor((m) => m.type === "project.watch-state" && m.projectId === project.id && !m.watching);
  assert.equal(unwatched.type, "project.watch-state");
  assert.deepEqual(unwatched.directories, []);

  // Re-subscribe and verify project move updates/rebinds watchers cleanly.
  socket.send({ type: "project.watch", projectId: project.id, directories: [] });
  await socket.waitFor((m) => m.type === "project.watch-state" && m.projectId === project.id && m.watching && m.directories.length === 1);
  const nextDir = tempDir(t);
  writeFileSync(path.join(nextDir, "fresh.ts"), "export const n = 1;\n");
  await h.api("PATCH", `/api/projects/${project.id}`, { path: nextDir });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const afterMoveCount = socket.received.length;
  writeFileSync(path.join(nextDir, "fresh.ts"), "export const n = 2;\n");
  await until(
    () => socket.received.slice(afterMoveCount).some((m) => m.type === "project.files-changed" && m.projectId === project.id && m.paths.some((p) => p.includes("fresh.ts"))),
    "overvåking etter prosjektflytting",
    5000,
  );
});
