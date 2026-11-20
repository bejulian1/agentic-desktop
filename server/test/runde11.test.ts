// Round 11 (SPEC 24): sections in the sidebar, and the two new choices in Innstillinger → Utseende.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startHarness } from "./helpers.ts";

const json = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("sections: made per mode, threads put in and taken out, renamed, and deleted with the threads kept", async (t) => {
  const h = await startHarness(t);
  const socket = await h.socket();

  const first = await h.api("POST", "/api/sections", { name: "  Viktig​ ", mode: "code" });
  assert.equal(first.name, "Viktig");
  assert.equal(first.mode, "code");
  await socket.waitFor((m) => m.type === "section.changed" && m.section.id === first.id);
  const second = await h.api("POST", "/api/sections", { name: "Senere", mode: "code" });
  assert.ok(second.position > first.position, "a new section comes last");
  const chat = await h.api("POST", "/api/sections", { name: "Ferie", mode: "chat" });
  assert.equal((await h.raw("POST", "/api/sections", json({ name: "   ", mode: "code" }))).status, 400);
  assert.equal((await h.raw("POST", "/api/sections", json({ name: "X", mode: "annet" }))).status, 400);

  // A Kode thread goes in a Kode section, never in one of Chat.
  const project = await h.project();
  const thread = await h.thread(project.id);
  const moved = await h.api("PATCH", `/api/threads/${thread.id}`, { sectionId: first.id });
  assert.equal(moved.sectionId, first.id);
  assert.equal((await h.raw("PATCH", `/api/threads/${thread.id}`, json({ sectionId: chat.id }))).status, 400);
  assert.equal((await h.raw("PATCH", `/api/threads/${thread.id}`, json({ sectionId: "finnes-ikke" }))).status, 400);

  // A copy stays in the section.
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await h.finished(thread.id);
  const branch = await h.api("POST", `/api/threads/${thread.id}/fork`, {});
  assert.equal(branch.sectionId, first.id);

  // Renamed, and listed in the bootstrap in their order.
  const renamed = await h.api("PATCH", `/api/sections/${first.id}`, { name: "Nå" });
  assert.equal(renamed.name, "Nå");
  assert.equal((await h.raw("PATCH", `/api/sections/${first.id}`, json({ name: "" }))).status, 400);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.deepEqual(boot.sections.filter((s: any) => s.mode === "code").map((s: any) => s.name), ["Nå", "Senere"]);

  // Out again by hand.
  const out = await h.api("PATCH", `/api/threads/${branch.id}`, { sectionId: null });
  assert.equal(out.sectionId, undefined);

  // Deleted: the threads stay, back where they were.
  await h.api("DELETE", `/api/sections/${first.id}`);
  await socket.waitFor((m) => m.type === "section.deleted" && m.sectionId === first.id);
  await socket.waitFor((m) => m.type === "thread.changed" && m.thread.id === thread.id && !m.thread.sectionId);
  assert.ok(h.app.store.thread(thread.id), "the thread is kept");
  assert.equal(h.app.store.thread(thread.id)!.sectionId, undefined);
  assert.equal(h.app.store.thread(thread.id)!.projectId, project.id);
  assert.equal((await h.raw("DELETE", `/api/sections/${first.id}`)).status, 404);
});

test("Panelknapper and Sidepanel are stored, and only known values are taken", async (t) => {
  const h = await startHarness(t);
  const settings = await h.api("PATCH", "/api/settings", { panelButtons: "separate", panelStart: "tabs" });
  assert.equal(settings.panelButtons, "separate");
  assert.equal(settings.panelStart, "tabs");
  assert.equal((await h.raw("PATCH", "/api/settings", json({ panelButtons: "alle" }))).status, 400);
  assert.equal((await h.raw("PATCH", "/api/settings", json({ panelStart: "under" }))).status, 400);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.equal(boot.settings.panelButtons, "separate");
  assert.equal(boot.settings.panelStart, "tabs");
});
