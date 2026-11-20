// v0.5, the navigation round (agent B): pinned and snoozed threads, side chats, a branch from the
// last message, the context split for the right panel, project favicons and icons, the profile's
// year and longest task, the smart sidebar setting, line counts per thread, and find and clear in
// the Browser panel. Only the demo model; no real API is called.
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ofType, startHarness, tempDir, until } from "./helpers.ts";

test("threads can be pinned and snoozed, with checks on the values", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  assert.equal(thread.pinned, false);
  assert.equal(thread.snoozedUntil, null);
  const until = Date.now() + 3_600_000;
  const changed = await h.api("PATCH", `/api/threads/${thread.id}`, { pinned: true, snoozedUntil: until });
  assert.equal(changed.pinned, true);
  assert.equal(changed.snoozedUntil, until);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.equal(boot.threads.find((x: any) => x.id === thread.id).snoozedUntil, until, "kept in the database");
  const back = await h.api("PATCH", `/api/threads/${thread.id}`, { pinned: false, snoozedUntil: null });
  assert.deepEqual([back.pinned, back.snoozedUntil], [false, null]);
  for (const bad of ["i morgen", {}, true]) {
    const res = await h.raw("PATCH", `/api/threads/${thread.id}`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ snoozedUntil: bad }) });
    assert.equal(res.status, 400, `snoozedUntil ${JSON.stringify(bad)}`);
  }
});

test("a side chat is a user thread in the same project that links back", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const other = await h.project();
  const source = await h.thread(project.id);
  await h.api("PATCH", `/api/threads/${source.id}`, { title: "Hovedtråd" });
  const side = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code", sideOf: source.id });
  assert.equal(side.parentThreadId, source.id);
  assert.equal(side.origin, "user", "not an agent thread, so the brakes for agents do not apply");
  assert.equal(side.title, "Sidechat: Hovedtråd");
  const wrong = await h.raw("POST", "/api/threads", { headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: other.id, mode: "code", sideOf: source.id }) });
  assert.equal(wrong.status, 400);
  const missing = await h.raw("POST", "/api/threads", { headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, mode: "code", sideOf: "finnes-ikke" }) });
  assert.equal(missing.status, 404);
});

test("a branch from the last message has only the last question and its answer", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  await h.finished(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp igjen" });
  await h.finished(thread.id, 2);
  const branch = await h.api("POST", `/api/threads/${thread.id}/fork`, { from: "last" });
  assert.match(branch.title, / \(gaffel\)$/); // round 14 (SPEC 30.3)
  const events = (await h.events(branch.id)).map((e) => e);
  assert.equal(events[0].seq, 1, "numbered from 1");
  const users = ofType(events.map((e) => e.event), "user.message");
  assert.deepEqual(users.map((u) => u.text), ["hjelp igjen"]);
  assert.equal(ofType(events.map((e) => e.event), "run.finished").length, 1);
  const messages = h.app.store.messages(branch.id);
  assert.equal(messages[0].role, "user");
  assert.ok(messages.length >= 2 && messages.length < h.app.store.messages(thread.id).length);
  // The whole copy is still there, as before.
  const copy = await h.api("POST", `/api/threads/${thread.id}/fork`);
  assert.equal(ofType((await h.events(copy.id)).map((e) => e.event), "user.message").length, 2);
});

test("the context split: system prompt, tools and messages, and what is free", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const code = await h.thread(project.id);
  const empty = await h.api("GET", `/api/threads/${code.id}/context`);
  assert.equal(empty.contextWindow, 200_000, "the demo model's window");
  assert.ok(empty.parts.system > 0 && empty.parts.tools > 0 && empty.tools > 5);
  assert.equal(empty.parts.messages, 0);
  assert.equal(empty.parts.compactBuffer, 40_000, "20 % is kept for compaction");
  assert.equal(empty.usedTokens + empty.parts.compactBuffer + empty.parts.free, empty.contextWindow);

  await h.api("POST", `/api/threads/${code.id}/messages`, { text: "lag en side" });
  await h.finished(code.id);
  const used = await h.api("GET", `/api/threads/${code.id}/context`);
  assert.ok(used.parts.messages > 0, "the conversation counts");
  assert.ok(used.usedTokens >= used.parts.system + used.parts.tools + used.parts.messages - 1);
  assert.equal(used.usedTokens + used.parts.compactBuffer + used.parts.free, used.contextWindow);

  const chat = await h.thread(null, "chat");
  const chatContext = await h.api("GET", `/api/threads/${chat.id}/context`);
  assert.ok(chatContext.parts.tools > 0);
  assert.equal(chatContext.tools,4,"Chat har dokumentverktøy og spørrekort, uten Kode-verktøy");
  assert.equal((await h.raw("GET", "/api/threads/finnes-ikke/context")).status, 404);

  // Lines changed per thread, for the smart sidebar.
  const stats = await h.api("GET", "/api/thread-stats");
  assert.ok(stats[code.id].additions > 0);
  assert.equal(stats[chat.id], undefined);
});

test("project favicons: found in the usual places, served safely, never outside the folder", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  mkdirSync(path.join(dir, "public"));
  writeFileSync(path.join(dir, "public/favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const project = await h.project(dir);
  const list = await h.api("GET", "/api/favicons");
  assert.equal(typeof list[project.id], "number", "the version is the mtime");
  const icon = await h.raw("GET", `/api/projects/${project.id}/favicon?v=${list[project.id]}`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers["content-type"], "image/svg+xml");
  assert.equal(icon.headers["x-content-type-options"], "nosniff");
  assert.match(String(icon.headers["content-security-policy"]), /sandbox/);
  assert.match(String(icon.headers["content-security-policy"]), /default-src 'none'/);

  // A symlink that leads out of the project is not followed, and big files are skipped.
  const outside = tempDir(t);
  writeFileSync(path.join(outside, "secret.png"), "hemmelig");
  const linked = tempDir(t);
  symlinkSync(path.join(outside, "secret.png"), path.join(linked, "favicon.png"));
  const linkedProject = await h.project(linked);
  const big = tempDir(t);
  writeFileSync(path.join(big, "favicon.ico"), Buffer.alloc(300 * 1024));
  const bigProject = await h.project(big);
  const plain = await h.project(tempDir(t));
  const again = await h.api("GET", "/api/favicons");
  for (const p of [linkedProject, bigProject, plain]) {
    assert.equal(again[p.id], undefined);
    assert.equal((await h.raw("GET", `/api/projects/${p.id}/favicon`)).status, 404);
  }
});

test("project icons: the new ids and one emoji are accepted, anything else is not", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { icon: "rocket", color: "blue" })).icon, "rocket");
  assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { icon: "emoji:🎮" })).icon, "emoji:🎮");
  assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { icon: null })).icon, null);
  for (const bad of ["emoji:<b>", "emoji:", "emoji:abc", "ukjent", 5, `emoji:${"🎮".repeat(20)}`]) {
    const res = await h.raw("PATCH", `/api/projects/${project.id}`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ icon: bad }) });
    assert.equal(res.status, 400, `icon ${JSON.stringify(bad)}`);
  }
});

test("the profile has a year of days, Monday first, and the longest task", async (t) => {
  const h = await startHarness(t);
  const before = await h.api("GET", "/api/profile");
  const weekday = (new Date().getDay() + 6) % 7;
  assert.equal(before.year.length, 52 * 7 + weekday + 1);
  assert.equal(new Date(`${before.year[0].date}T12:00:00`).getDay(), 1);
  assert.equal(before.year.at(-1).date, new Date().toLocaleDateString("sv-SE"));
  assert.equal(before.longestRunMs, null);
  const thread = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  await h.finished(thread.id);
  const after = await h.api("GET", "/api/profile");
  assert.ok(after.longestRunMs >= 0);
  assert.equal(after.year.at(-1).runs, 1);
});

test("the sidebar layout setting and the new shortcut ids", async (t) => {
  const h = await startHarness(t);
  await h.api("PATCH", "/api/settings", { sidebarLayout: "smart" });
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.sidebarLayout, "smart");
  const bad = await h.raw("PATCH", "/api/settings", { headers: { "content-type": "application/json" }, body: JSON.stringify({ sidebarLayout: "kul" }) });
  assert.equal(bad.status, 400);
  await h.api("PATCH", "/api/settings", { shortcuts: { "palette.open": "Mod+P", "thread.pin": "Mod+Alt+F" } });
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.shortcuts["palette.open"], "Mod+P");
});

test("find on the page and clearing browsing data in the Browser panel", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Finn</title><p>Her står et sjeldent ord: blåbærsyltetøy.</p>");
  const project = await h.project(dir);
  const socket = await h.socket();
  socket.send({ type: "browser.open", projectId: project.id, width: 640, height: 400 });
  await socket.waitFor((m) => m.type === "browser.state" && m.projectId === project.id, 60_000);
  socket.send({ type: "browser.navigate", projectId: project.id, url: "index.html" });
  await socket.waitFor((m) => m.type === "browser.state" && /index\.html/.test(m.state.url) && !m.state.loading, 60_000);
  socket.send({ type: "browser.find", projectId: project.id, text: "blåbærsyltetøy", backwards: false });
  const hit = await socket.waitFor((m) => m.type === "browser.found" && m.text === "blåbærsyltetøy");
  assert.equal(hit.type === "browser.found" && hit.found, true);
  socket.send({ type: "browser.find", projectId: project.id, text: "finnes ikke her", backwards: false });
  const miss = await socket.waitFor((m) => m.type === "browser.found" && m.text === "finnes ikke her");
  assert.equal(miss.type === "browser.found" && miss.found, false);
  socket.send({ type: "browser.clear-data", projectId: project.id });
  await socket.waitFor((m) => m.type === "browser.cleared" && m.projectId === project.id);
  socket.send({ type: "browser.close", projectId: project.id });
  await until(() => true, "closed");
});
