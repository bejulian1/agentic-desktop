// Round 8 (UI-retter 2, edge cases from agent G): a project's «sist brukt» moves when a thread is
// made or a message is sent in it, and every window hears of it; names of projects and threads
// lose characters with no width. Temporary folders only, and the demo model.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, ServerMessage } from "../../shared/protocol.ts";
import { cleanName } from "../src/names.ts";
import { startHarness, tempDir, until } from "./helpers.ts";

const lastUsed = async (h: Awaited<ReturnType<typeof startHarness>>, id: string) =>
  ((await h.api<{ projects: Project[] }>("GET", "/api/bootstrap")).projects.find((p) => p.id === id)!).lastUsedAt;

test("sist brukt: en ny tråd og en melding i et prosjekt flytter det først, og vinduene får beskjed", async (t) => {
  const h = await startHarness(t);
  const older = await h.project(tempDir(t, "ad-eldre-"));
  await new Promise((resolve) => setTimeout(resolve, 15));
  const newer = await h.project(tempDir(t, "ad-nyere-"));
  const order = async () => (await h.api<{ projects: Project[] }>("GET", "/api/bootstrap")).projects.map((p) => p.id);
  assert.deepEqual((await order()).slice(0, 2), [newer.id, older.id], "det nyeste først");

  const socket = await h.socket();
  const changed = (id: string, after: number) => (m: ServerMessage) => m.type === "project.changed" && m.project.id === id && m.project.lastUsedAt > after;

  // A new thread in the older project.
  const before = await lastUsed(h, older.id);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const thread = await h.thread(older.id);
  assert.ok((await lastUsed(h, older.id)) > before, "en ny tråd teller som bruk");
  assert.deepEqual((await order()).slice(0, 2), [older.id, newer.id], "nå står det eldre først");
  await socket.waitFor(changed(older.id, before));

  // A message in the newer project's thread moves that one back on top, also in the windows.
  const other = await h.thread(newer.id);
  const touched = await lastUsed(h, newer.id);
  await new Promise((resolve) => setTimeout(resolve, 15));
  await h.api("POST", `/api/threads/${other.id}/messages`, { text: "hjelp" });
  await socket.waitFor(changed(newer.id, touched));
  await until(async () => (await lastUsed(h, newer.id)) > touched, "meldingen teller som bruk");
  await h.finished(other.id);
  assert.ok(thread.id);
});

test("navn: tegn uten bredde fjernes fra prosjekter og tråder, og et navn av bare dem er tomt", async (t) => {
  assert.equal(cleanName("​Demo‌‍﻿⁠ "), "Demo");
  assert.equal(cleanName("Kafé ☕ 中文"), "Kafé ☕ 中文", "vanlige tegn og emoji står");

  const h = await startHarness(t);
  const dir = tempDir(t, "ad-navn-");
  const project = await h.api<Project>("POST", "/api/projects", { name: "​Nett﻿butikk‍", path: dir });
  assert.equal(project.name, "Nettbutikk");

  const renamed = await h.api<Project>("PATCH", `/api/projects/${project.id}`, { name: "Butikk​ 2" });
  assert.equal(renamed.name, "Butikk 2");
  const empty = await h.raw("PATCH", `/api/projects/${project.id}`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "​‌﻿" }) });
  assert.equal(empty.status, 400, "et navn av bare usynlige tegn er tomt");

  const thread = await h.thread(project.id);
  const titled = await h.api("PATCH", `/api/threads/${thread.id}`, { title: "﻿Plan​ for helgen‍" });
  assert.equal(titled.title, "Plan for helgen");
  const blank = await h.raw("PATCH", `/api/threads/${thread.id}`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "⁠​" }) });
  assert.equal(blank.status, 400);

  // The title made from the first message is cleaned the same way.
  const chat = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${chat.id}/messages`, { text: "​hjelp‍" });
  await h.finished(chat.id);
  const boot = await h.api<{ threads: Array<{ id: string; title: string }> }>("GET", "/api/bootstrap");
  assert.equal(boot.threads.find((x) => x.id === chat.id)!.title, "hjelp");
});
