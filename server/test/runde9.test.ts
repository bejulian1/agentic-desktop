// Round 9 (SPEC 21): Kode without a project (Denne datamaskinen), a project whose folder is gone and
// how it is connected again, Chat projects that never reach the tools for files and commands, the
// effort levels from Ingen to Maks, and the new settings. Only the demo model; no real API is called.
import assert from "node:assert/strict";
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { effortSteps } from "../../shared/protocol.ts";
import { ofType, startHarness, tempDir } from "./helpers.ts";

const json = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("Kode without a project is Denne datamaskinen: a thread with no tools, and ! is refused", async (t) => {
  const h = await startHarness(t);
  const thread = await h.api("POST", "/api/threads", { projectId: null, mode: "code" });
  assert.equal(thread.mode, "code");
  assert.equal(thread.projectId, null);
  const store = h.app.store;
  assert.deepEqual(h.app.runner.toolDefs(store.thread(thread.id)!, undefined, []).map(t=>t.name), ["ui_mod", "request_user_input"], "ingen fil-/kommandoverktøy uten mappe");
  // The demo model writes files when it has the tool. Here it answers with text.
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "tool.started").length, 0, "no tool ran");
  const shell = await h.raw("POST", `/api/threads/${thread.id}/messages`, json({ text: "", shell: "ls" }));
  assert.equal(shell.status, 400);
  // Its panes have their own layout, like Chat.
  await h.api("PUT", "/api/projects/local/layout", { layout: { panes: 1 } });
  assert.deepEqual((await h.api("GET", "/api/projects/local/layout")).layout, { panes: 1 });
});

test("a project whose folder is gone says so, runs nothing, and can be connected to a folder again", async (t) => {
  const h = await startHarness(t);
  const root = tempDir(t);
  const folder = path.join(root, "app");
  mkdirSync(folder);
  const project = await h.project(folder);
  assert.equal(project.folderMissing, undefined, "only set when the folder is gone");
  const thread = await h.thread(project.id);

  const moved = path.join(root, "app-flyttet");
  renameSync(folder, moved);
  assert.equal((await h.api("GET", `/api/projects/${project.id}`)).folderMissing, true);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.equal(boot.projects.find((p: any) => p.id === project.id).folderMissing, true, "also in the bootstrap");
  const run = await h.raw("POST", `/api/threads/${thread.id}/messages`, json({ text: "hei" }));
  assert.equal(run.status, 409, "nothing runs against a folder that is not there");
  assert.match(JSON.parse(run.body).error, /Fant ikke mappen/);

  // The checks: an existing directory, absolute, not the root, not the data folder, not a file,
  // not another project, and a symlink is followed to where it points.
  const bad = async (body: unknown, status: number) => {
    const res = await h.raw("POST", `/api/projects/${project.id}/relink`, json(body));
    assert.equal(res.status, status, JSON.stringify(body));
  };
  await bad({ path: path.join(root, "finnes-ikke") }, 400);
  assert.equal((await h.api("GET", `/api/projects/${project.id}`)).path, folder, "never creates a folder");
  await bad({ path: "relativ/sti" }, 403);
  await bad({ path: "/" }, 403);
  await bad({ path: h.app.config.dataDir }, 403);
  await bad({}, 400);
  writeFileSync(path.join(root, "fil.txt"), "x");
  await bad({ path: path.join(root, "fil.txt") }, 400);
  const other = await h.project();
  await bad({ path: other.path }, 409);
  const missing = await h.raw("POST", "/api/projects/finnes-ikke/relink", json({ path: moved }));
  assert.equal(missing.status, 404);

  const link = path.join(root, "lenke");
  symlinkSync(moved, link);
  const socket = await h.socket();
  const fixed = await h.api("POST", `/api/projects/${project.id}/relink`, { path: link });
  assert.equal(fixed.path, moved, "the real path, not the link");
  assert.equal(fixed.folderMissing, undefined);
  await socket.waitFor((m) => m.type === "project.changed" && m.project.id === project.id && !m.project.folderMissing);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await h.finished(thread.id);

  // A folder deleted for good shows the same way.
  rmSync(moved, { recursive: true });
  assert.equal((await h.api("GET", `/api/projects/${project.id}`)).folderMissing, true);
});

test("Chat projects gather chats, have no folder, and never reach the file and command tools", async (t) => {
  const h = await startHarness(t);
  const socket = await h.socket();
  const created = await h.api("POST", "/api/chat-projects", { name: "  Ferie\u200b " });
  assert.equal(created.name, "Ferie");
  assert.equal("path" in created, false, "no folder");
  await socket.waitFor((m) => m.type === "chat-project.changed" && m.project.id === created.id);
  assert.equal((await h.raw("POST", "/api/chat-projects", json({ name: "   " }))).status, 400);

  // They are not projects: nothing that works on a folder knows them.
  for (const url of [`/api/projects/${created.id}`, `/api/projects/${created.id}/tree`, `/api/projects/${created.id}/terminals`, `/api/projects/${created.id}/mentions?q=a`]) {
    assert.equal((await h.raw("GET", url)).status, 404, url);
  }
  assert.equal((await h.raw("POST", "/api/threads", json({ projectId: created.id, mode: "code" }))).status, 404, "not a Kode project either");

  // A new chat in it, and one moved in from the thread menu.
  const inside = await h.api("POST", "/api/threads", { projectId: null, mode: "chat", chatProjectId: created.id });
  assert.equal(inside.chatProjectId, created.id);
  assert.equal(inside.projectId, null);
  const loose = await h.thread(null, "chat");
  const moved = await h.api("PATCH", `/api/threads/${loose.id}`, { chatProjectId: created.id });
  assert.equal(moved.chatProjectId, created.id);
  assert.equal((await h.raw("PATCH", `/api/threads/${loose.id}`, json({ chatProjectId: "finnes-ikke" }))).status, 400);

  // Only chats: not a Kode thread, and not a new Kode thread.
  const project = await h.project();
  const code = await h.thread(project.id);
  assert.equal((await h.raw("PATCH", `/api/threads/${code.id}`, json({ chatProjectId: created.id }))).status, 400);
  const local = await h.api("POST", "/api/threads", { projectId: null, mode: "code" });
  assert.equal((await h.raw("PATCH", `/api/threads/${local.id}`, json({ chatProjectId: created.id }))).status, 400);
  assert.equal((await h.raw("POST", "/api/threads", json({ projectId: null, mode: "code", chatProjectId: created.id }))).status, 400);

  // A chat in a Chat project has no tools, and ! is refused there.
  const thread = h.app.store.thread(inside.id)!;
  assert.deepEqual(h.app.runner.toolDefs(thread, undefined, []).map(t=>t.name), ["ui_mod","create_document","list_chat_files","request_user_input"]);
  assert.equal((await h.raw("POST", `/api/threads/${inside.id}/messages`, json({ text: "", shell: "ls" }))).status, 400);
  await h.api("POST", `/api/threads/${inside.id}/messages`, { text: "lag en side" });
  assert.equal(ofType(await h.finished(inside.id), "tool.started").length, 0);

  // A copy stays in the project.
  const branch = await h.api("POST", `/api/threads/${inside.id}/fork`, { from: "last" });
  assert.equal(branch.chatProjectId, created.id);

  // Rename, pin, colour; then out again, and the project removed with the chats left as they were.
  const renamed = await h.api("PATCH", `/api/chat-projects/${created.id}`, { name: "Sommerferie", pinned: true, color: "green" });
  assert.deepEqual([renamed.name, renamed.pinned, renamed.color], ["Sommerferie", true, "green"]);
  assert.equal((await h.raw("PATCH", `/api/chat-projects/${created.id}`, json({ color: "neon" }))).status, 400);
  const out = await h.api("PATCH", `/api/threads/${loose.id}`, { chatProjectId: null });
  assert.equal(out.chatProjectId, undefined);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.deepEqual(boot.chatProjects.map((p: any) => p.id), [created.id]);
  await h.api("DELETE", `/api/chat-projects/${created.id}`);
  await socket.waitFor((m) => m.type === "chat-project.deleted" && m.projectId === created.id);
  await socket.waitFor((m) => m.type === "thread.changed" && m.thread.id === inside.id && !m.thread.chatProjectId);
  assert.ok(h.app.store.thread(inside.id), "the chat is kept");
  assert.equal(h.app.store.thread(inside.id)!.chatProjectId, undefined);
  assert.equal((await h.raw("DELETE", `/api/chat-projects/${created.id}`)).status, 404);
});

test("effort from Ingen to Maks: none is accepted, and the steps follow the provider", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  assert.equal((await h.api("PATCH", `/api/threads/${thread.id}`, { reasoning: "none" })).reasoning, "none");
  assert.equal((await h.raw("PATCH", `/api/threads/${thread.id}`, json({ reasoning: "ingen" }))).status, 400);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await h.finished(thread.id);
  assert.deepEqual(effortSteps("mock"), ["none", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(effortSteps("anthropic"), ["none", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(effortSteps("anthropic", { thinking: false }), ["low", "medium", "high", "xhigh", "max"], "Ingen means no thinking, which that model has anyway");
  assert.deepEqual(effortSteps("openai-compatible"), ["low", "medium", "high"]);
  assert.deepEqual(effortSteps(undefined), []);
});

test("the Kode start page choices and the red accent are settings like the others", async (t) => {
  const h = await startHarness(t);
  const saved = await h.api("PATCH", "/api/settings", { codeStartEmpty: "cards", codeStartProject: "greeting", accent: "red" });
  assert.deepEqual([saved.codeStartEmpty, saved.codeStartProject, saved.accent], ["cards", "greeting", "red"]);
  for (const bad of [{ codeStartEmpty: "kort" }, { codeStartProject: true }, { accent: "neon" }]) {
    assert.equal((await h.raw("PATCH", "/api/settings", json(bad))).status, 400, JSON.stringify(bad));
  }
  const reset = await h.api("PATCH", "/api/settings", { codeStartEmpty: null, codeStartProject: null });
  assert.equal(reset.codeStartEmpty, undefined);
  assert.equal(reset.codeStartProject, undefined);
});

test("the panel without a project: a terminal in the home folder, with the same checks, and nothing else opens on it", async (t) => {
  const home = tempDir(t, "ad-home-");
  const h = await startHarness(t, { homeDir: home });
  const socket = await h.socket();
  socket.send({ type: "terminal.open", projectId: "local", cols: 80, rows: 24 });
  const opened = await socket.waitFor((m) => m.type === "terminal.opened");
  assert.equal(opened.type === "terminal.opened" && opened.projectId, "local");
  const id = opened.type === "terminal.opened" ? opened.terminalId : "";
  socket.send({ type: "terminal.input", terminalId: id, data: "pwd; echo LOKAL-$((20+1))\n" });
  const text = () => socket.received.flatMap((m) => (m.type === "terminal.output" && m.terminalId === id ? [m.data] : [])).join("");
  await socket.waitFor((m) => m.type === "terminal.output" && text().includes("LOKAL-21"));
  assert.ok(text().includes(home), "starts in the home folder");
  assert.deepEqual((await h.api("GET", "/api/projects/local/terminals")).map((x: any) => x.terminalId), [id]);

  // "local" is only for the terminal and the Browser panel: nothing that reads or writes files takes it.
  for (const url of ["/api/projects/local/tree", "/api/projects/local/file?path=a", "/api/projects/local/git", "/api/projects/local/playtest"]) {
    assert.equal((await h.raw("GET", url)).status, 404, url);
  }
  assert.equal((await h.raw("POST", "/api/threads", json({ projectId: "local", mode: "code" }))).status, 404);
  // An unknown key is refused over the socket, as before.
  socket.send({ type: "terminal.open", projectId: "finnes-ikke", cols: 80, rows: 24 });
  await socket.waitFor((m) => m.type === "error" && /Fant ikke prosjektet/.test(m.message));
});

test("a home folder inside the app's data folder, or missing, is refused for the terminal", async (t) => {
  const data = tempDir(t, "ad-data-own-");
  const inside = path.join(data, "hjem");
  mkdirSync(inside);
  const h = await startHarness(t, { dataDir: data, homeDir: inside });
  const socket = await h.socket();
  socket.send({ type: "terminal.open", projectId: "local", cols: 80, rows: 24 });
  await socket.waitFor((m) => m.type === "error" && /datamappe/.test(m.message));
  assert.deepEqual(await h.api("GET", "/api/projects/local/terminals"), []);
});

test("editing a message in Kode: only with keepFiles, files stay, and never on a missing folder", async (t) => {
  const h = await startHarness(t);
  const root = tempDir(t);
  const folder = path.join(root, "kode");
  mkdirSync(folder);
  const project = await h.project(folder);
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  const first = await h.finished(thread.id);
  const question = ofType(first, "user.message")[0].messageId;
  writeFileSync(path.join(folder, "beholdes.txt"), "laget før redigeringen");

  assert.equal((await h.raw("POST", `/api/threads/${thread.id}/rewind`, json({ messageId: question, text: "hjelp igjen" }))).status, 400, "the app must have said that files stay");
  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: question, text: "hjelp igjen", keepFiles: true });
  const again = await h.finished(thread.id);
  assert.deepEqual(ofType(again, "user.message").map((e) => e.text), ["hjelp igjen"]);
  assert.equal(ofType(again, "run.finished").length, 1, "what came after the message is gone");
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(path.join(folder, "beholdes.txt"), "utf8"), "laget før redigeringen", "files are not rolled back");

  renameSync(folder, path.join(root, "borte"));
  const latest = ofType(again, "user.message")[0].messageId;
  assert.equal((await h.raw("POST", `/api/threads/${thread.id}/rewind`, json({ messageId: latest, keepFiles: true }))).status, 409);
});
