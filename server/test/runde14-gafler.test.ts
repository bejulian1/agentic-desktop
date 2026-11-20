// Round 14 (SPEC 30.3): forks. A clear name, a link back to where they came from, and a Kode fork
// stays in its project without touching the files.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { forkTitle } from "../src/agent/fork.ts";
import { ofType, startHarness } from "./helpers.ts";

test("30.3: standardnavnet er «‹tittel› (gaffel)», så (gaffel 2) og videre", () => {
  assert.equal(forkTitle("Plan for appen", new Set()), "Plan for appen (gaffel)");
  assert.equal(forkTitle("Plan for appen", new Set(["Plan for appen (gaffel)"])), "Plan for appen (gaffel 2)");
  assert.equal(forkTitle("Plan for appen (gaffel)", new Set(["Plan for appen (gaffel)", "Plan for appen (gaffel 2)"])), "Plan for appen (gaffel 3)", "en gaffel av en gaffel får ikke to endelser");
  const long = forkTitle("x".repeat(200), new Set());
  assert.equal(long.length, 80);
  assert.ok(long.endsWith(" (gaffel)"));
  assert.equal(forkTitle("   ", new Set()), "Ny tråd (gaffel)");
});

test("30.3: gaffel fra en melding husker opprinnelsen, og alle tre slagene får navn og lenke", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Reiseplan" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  await h.finished(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp igjen" });
  await h.finished(thread.id, 2);
  const events = (await h.events(thread.id)).map((e) => e.event);
  const threadOf = async (id: string) => (await h.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === id);
  const first = ofType(events, "user.message")[0];

  const fromMessage = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: first.messageId });
  assert.equal(fromMessage.title, "Reiseplan (gaffel)");
  assert.deepEqual(fromMessage.forkedFrom, { threadId: thread.id, title: "Reiseplan", messageId: first.messageId, from: "message" });
  const copied = ofType((await h.events(fromMessage.id)).map((e) => e.event), "user.message");
  assert.deepEqual(copied.map((u) => u.text), ["hjelp"], "historikken til og med meldingen");

  const whole = await h.api("POST", `/api/threads/${thread.id}/fork`);
  assert.equal(whole.title, "Reiseplan (gaffel 2)");
  assert.equal(whole.forkedFrom.from, "whole");
  const last = await h.api("POST", `/api/threads/${thread.id}/fork`, { from: "last" });
  assert.equal(last.title, "Reiseplan (gaffel 3)");
  assert.equal(last.forkedFrom.from, "last");
  const ofFork = await h.api("POST", `/api/threads/${fromMessage.id}/fork`);
  assert.equal(ofFork.title, "Reiseplan (gaffel 4)");
  assert.equal(ofFork.forkedFrom.threadId, fromMessage.id, "lenken går til tråden den kom fra");

  // The original is unchanged, and has no origin of its own.
  assert.equal((await threadOf(thread.id)).forkedFrom, undefined);
  // In the bootstrap too, so the sidebar can show it.
  assert.equal((await threadOf(whole.id)).forkedFrom.title, "Reiseplan");

  // The source deleted: the fork keeps the title it had.
  await h.api("DELETE", `/api/threads/${thread.id}`);
  assert.equal((await threadOf(whole.id)).forkedFrom.title, "Reiseplan");
});

test("30.3: en Kode-gaffel beholder prosjektet, og filene på disken røres ikke", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "notat.md"), "uendret\n");
  const snapshot = () =>
    readdirSync(project.path, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return `${path.relative(project.path, file)}:${statSync(file).mtimeMs}:${readFileSync(file, "utf8")}`;
      })
      .sort();
  const thread = await h.thread(project.id, "code");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  await h.finished(thread.id);
  const before = snapshot();
  const answer = ofType((await h.events(thread.id)).map((e) => e.event), "text.delta")[0];
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: answer.messageId });
  assert.equal(fork.projectId, project.id);
  assert.equal(fork.mode, "code");
  assert.deepEqual(snapshot(), before);
});
