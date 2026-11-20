// Round 4 of the wish list: /review on a thread's changes, and Agent Teams with a shared task list.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Turns } from "../src/agent/turns.ts";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, textOf, until } from "./helpers.ts";

test("review sends the thread's changes as a diff, and the demo model reviews them", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code");
  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", review: true }), /400/, "nothing to review yet");

  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  await h.finished(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", review: true });
  const events = await h.finished(thread.id, 2);
  const users = ofType(events, "user.message");
  assert.equal(users.at(-1)!.text, "/review-changes");
  const reply = textOf(events.slice(events.findLastIndex((e) => e.type === "user.message")));
  assert.match(reply, /Kodegjennomgang/);
  assert.match(reply, /`index\.html` \(ny\)/);
  assert.match(reply, /Inline-skript/);
});

test("the review diff reaches a real provider as text, and reverted turns are left out", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", "mock-demo");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  await h.finished(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "rediger" });
  const events = await h.finished(thread.id, 2);
  const [first, second] = ofType(events, "turn.changes");
  await h.api("POST", `/api/turns/${second.turnId}/revert`, {});

  await h.api("PATCH", `/api/threads/${thread.id}`, { modelId: model.id });
  llm.reply(sse(openaiText("Ser fint ut.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "se på sikkerhet", review: true });
  await h.finished(thread.id, 3);
  const sent: string = llm.requests[0].body.messages.at(-1).content;
  assert.match(sent, /\[Kodegjennomgang\]\n/);
  assert.match(sent, /The user adds: se på sikkerhet/);
  assert.match(sent, /--- index\.html \(added\)/);
  assert.match(sent, /\+  <h1>Hei fra demo-modellen<\/h1>/);
  assert.doesNotMatch(sent, /Hei igjen/, "the reverted edit is not part of the review");
  assert.ok(first);
});

test("review labels binary content and overlapping authorship instead of inventing a text diff", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "local-only" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", model.id);
  h.app.store.createRun({ id: "review-fixture-run", threadId: thread.id, modelId: model.id, turnId: "review-fixture-turn", startSeq: 1 });
  const turns = new Turns(h.app.store, h.app.config.dataDir);
  turns.capture("review-fixture-turn", "binary.dat", Buffer.from([0xff, 0xfe]));
  turns.recordAfter("review-fixture-turn", "binary.dat", Buffer.from([0xfe, 0xff]));
  turns.capture("review-fixture-turn", "shared.txt", Buffer.from("before\n"));
  turns.recordAfter("review-fixture-turn", "shared.txt", Buffer.from("A\n"));
  turns.capture("review-fixture-turn", "shared.txt", Buffer.from("B\n"));
  turns.recordAfter("review-fixture-turn", "shared.txt", Buffer.from("B plus A\n"));
  turns.finish("review-fixture-turn", project.path);
  h.app.store.finishRun("review-fixture-run", "done");
  llm.reply(sse(openaiText("Reviewed recorded text only.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", review: true });
  await h.finished(thread.id);
  const sent = llm.requests[0].body.messages.at(-1).content;
  assert.match(sent, /Shell writes are not covered/);
  assert.match(sent, /--- binary\.dat \(modified\)\n\[Binary file: text content is unavailable\.\]/);
  assert.match(sent, /Overlaps other work; do not attribute every changed line to this thread/);
  assert.match(sent, /\+B plus A/);
});

test("Agent Teams: the lead fills the task list, hands tasks to two threads and ticks them off", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const socket = await h.socket();
  const lead = await h.thread(project.id, "code");
  await h.api("POST", `/api/threads/${lead.id}/messages`, { text: "team: lag en oversikt" });
  const events = await h.finished(lead.id);
  assert.match(textOf(events), /Teamet er ferdig/);

  const tasks = await h.api("GET", `/api/projects/${project.id}/tasks`);
  assert.deepEqual(tasks.map((x: any) => [x.title, x.status]), [["Kartlegg prosjektmappen", "done"], ["Skriv en kort oversikt", "done"]]);
  const helpers = (await h.api("GET", "/api/bootstrap")).threads.filter((x: any) => x.parentThreadId === lead.id);
  assert.equal(helpers.length, 2);
  assert.deepEqual(tasks.map((x: any) => x.ownerThreadId).sort(), helpers.map((x: any) => x.id).sort());
  assert.ok(tasks.every((x: any) => x.createdByThreadId === lead.id));
  await socket.waitFor((m) => m.type === "project.tasks" && m.projectId === project.id && m.tasks.every((x) => x.status === "done"));
});

test("the task list over REST: validation, owners in the project only, and no reach into other projects", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const other = await h.project();
  const thread = await h.thread(project.id, "code");
  const foreign = await h.thread(other.id, "code");
  const task = await h.api("POST", `/api/projects/${project.id}/tasks`, { title: "  Skriv tester  " });
  assert.equal(task.title, "Skriv tester");
  assert.equal(task.status, "todo");
  assert.equal(task.createdByThreadId, null);
  await assert.rejects(h.api("POST", `/api/projects/${project.id}/tasks`, { title: " " }), /400/);
  await assert.rejects(h.api("PATCH", `/api/tasks/${task.id}`, { status: "kanskje" }), /400/);
  await assert.rejects(h.api("PATCH", `/api/tasks/${task.id}`, { ownerThreadId: foreign.id }), /400/);
  const owned = await h.api("PATCH", `/api/tasks/${task.id}`, { ownerThreadId: thread.id, status: "doing" });
  assert.deepEqual([owned.ownerThreadId, owned.status], [thread.id, "doing"]);
  assert.deepEqual(await h.api("GET", `/api/projects/${other.id}/tasks`), []);

  // A model in the other project cannot touch this task through the tool.
  const board = (h.app.runner as any).deps.tasks;
  assert.throws(() => board.update(task.id, { status: "done" }, other.id), /Fant ikke oppgaven/);
  await h.api("DELETE", `/api/tasks/${task.id}`);
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/tasks`), []);
  await until(async () => true, "noop");
});
