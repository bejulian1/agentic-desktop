// Round 14 (SPEC 30.4 and 30.5): archive and bring back one thread, or all the threads of a project.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import { startHarness, tempDir, until } from "./helpers.ts";

test("30.4: alle trådene i et prosjekt arkiveres og hentes tilbake, uten den som kjører", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const other = await h.project();
  const a = await h.thread(project.id);
  const b = await h.thread(project.id);
  const busy = await h.thread(project.id);
  const elsewhere = await h.thread(other.id);
  const chat = await h.thread(null, "chat");
  // A run that waits for an approval is running.
  await h.api("POST", `/api/threads/${busy.id}/messages`, { text: "godkjenning" });
  await until(async () => (await h.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === busy.id).running, "tråden kjører");

  const socket = await h.socket();
  const result = await h.api("POST", "/api/threads/archive", { projectId: project.id, archived: true });
  assert.deepEqual([...result.ids].sort(), [a.id, b.id].sort());
  assert.equal(result.running, 1, "den som kjører, blir stående og telles");
  await socket.waitFor((m) => m.type === "thread.changed" && m.thread.id === a.id && m.thread.archived);
  const threads = (await h.api("GET", "/api/bootstrap")).threads as any[];
  const archived = (id: string) => threads.find((x) => x.id === id).archived;
  assert.equal(archived(a.id), true);
  assert.equal(archived(b.id), true);
  assert.equal(archived(busy.id), false);
  assert.equal(archived(elsewhere.id), false, "andre prosjekter røres ikke");
  assert.equal(archived(chat.id), false);
  assert.deepEqual((await h.api("GET", "/api/threads/archived")).map((x: any) => x.id).sort(), [a.id, b.id].sort());

  // Angre: the same ids back.
  const undo = await h.api("POST", "/api/threads/archive", { ids: result.ids, archived: false });
  assert.deepEqual([...undo.ids].sort(), [a.id, b.id].sort());
  assert.deepEqual(await h.api("GET", "/api/threads/archived"), []);

  // Hent tilbake alle for a project, and archiving twice changes nothing the second time.
  await h.api("POST", "/api/threads/archive", { ids: [a.id], archived: true });
  assert.deepEqual((await h.api("POST", "/api/threads/archive", { ids: [a.id], archived: true })).ids, []);
  assert.deepEqual((await h.api("POST", "/api/threads/archive", { projectId: project.id, archived: false })).ids, [a.id]);

  await assert.rejects(h.api("POST", "/api/threads/archive", { archived: true }), (err: any) => err.status === 400);
  await assert.rejects(h.api("POST", "/api/threads/archive", { projectId: "finnes-ikke" }), (err: any) => err.status === 404);
});

test("30.4: chattene i et Chat-prosjekt arkiveres samlet", async (t) => {
  const h = await startHarness(t);
  const group = await h.api("POST", "/api/chat-projects", { name: "Ferie" });
  const inside = await h.thread(null, "chat");
  await h.api("PATCH", `/api/threads/${inside.id}`, { chatProjectId: group.id });
  const outside = await h.thread(null, "chat");
  const result = await h.api("POST", "/api/threads/archive", { chatProjectId: group.id });
  assert.deepEqual(result.ids, [inside.id]);
  const threads = (await h.api("GET", "/api/bootstrap")).threads as any[];
  assert.equal(threads.find((x) => x.id === outside.id).archived, false);
});

test("30.5: trådene i et prosjekt med borte mappe kan arkiveres, og relink gir prosjektet tilbake", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t, "ad-flyttes-");
  const project = await h.project(dir);
  const thread = await h.thread(project.id);
  rmSync(dir, { recursive: true, force: true });
  await until(async () => (await h.api("GET", `/api/projects/${project.id}`)).folderMissing === true, "mappen mangler");
  const result = await h.api("POST", "/api/threads/archive", { projectId: project.id });
  assert.deepEqual(result.ids, [thread.id]);
  // A new name: the same project and threads go on in the new folder.
  const moved = tempDir(t, "ad-nytt-navn-");
  const relinked = await h.api("POST", `/api/projects/${project.id}/relink`, { path: moved });
  assert.equal(relinked.folderMissing, undefined);
  assert.equal(relinked.id, project.id);
  await h.api("POST", "/api/threads/archive", { ids: result.ids, archived: false });
  const back = (await h.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === thread.id);
  assert.equal(back.projectId, project.id);
  assert.equal(back.archived, false);
});
