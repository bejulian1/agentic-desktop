// Round 5, agent A: the goal's clock is kept on the server, images can be attached, and a message
// takes at most 20 images and files. No real API is called.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_ATTACHMENTS } from "../../shared/protocol.ts";
import { Store } from "../src/db.ts";
import { toAnthropicMessages } from "../src/providers/anthropic.ts";
import { toOpenAiMessages } from "../src/providers/openai-compatible.ts";
import type { Message } from "../src/providers/types.ts";
import { compactToolResults, estimateTokens } from "../src/agent/context.ts";
import { ofType, startHarness, tempDir } from "./helpers.ts";

// The smallest valid PNG: one transparent pixel.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the goal's clock runs, stands still on pause, survives a restart, and is cleared with the goal", async (t) => {
  const dataDir = tempDir(t, "ad-data-");
  const h = await startHarness(t, { dataDir });
  const thread = await h.thread(null, "chat");
  assert.equal(thread.goal, null);
  assert.equal(thread.goalSetAt, null);
  assert.equal(thread.goalElapsedMs, 0);

  const before = Date.now();
  let current = await h.api("PATCH", `/api/threads/${thread.id}`, { goal: "Lag en kalkulator" });
  assert.equal(current.goal, "Lag en kalkulator");
  assert.ok(current.goalSetAt >= before && current.goalResumedAt === current.goalSetAt, "the clock starts when the goal is set");
  assert.equal(current.goalPausedAt, null);
  const setAt = current.goalSetAt;

  await sleep(30);
  current = await h.api("PATCH", `/api/threads/${thread.id}`, { goal: "Lag en bedre kalkulator" });
  assert.equal(current.goalSetAt, setAt, "editing the text keeps the clock");

  current = await h.api("PATCH", `/api/threads/${thread.id}`, { goalPaused: true });
  assert.ok(current.goalPausedAt !== null && current.goalResumedAt === null);
  assert.ok(current.goalElapsedMs >= 25, `ran ${current.goalElapsedMs} ms before the pause`);
  const ranBefore = current.goalElapsedMs;
  await sleep(40);
  current = await h.api("PATCH", `/api/threads/${thread.id}`, { goalPaused: true });
  assert.equal(current.goalElapsedMs, ranBefore, "pausing twice changes nothing");

  // A restart: the stored time comes back.
  await h.app.close();
  const again = await startHarness(t, { dataDir });
  current = (await again.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === thread.id);
  assert.equal(current.goal, "Lag en bedre kalkulator");
  assert.equal(current.goalElapsedMs, ranBefore, "the paused time survives the restart");
  assert.ok(current.goalPausedAt !== null);

  current = await again.api("PATCH", `/api/threads/${thread.id}`, { goalPaused: false });
  assert.equal(current.goalPausedAt, null);
  assert.ok(current.goalResumedAt >= current.goalSetAt);
  assert.equal(current.goalElapsedMs, ranBefore, "resuming starts a new stretch and keeps the old one");

  current = await again.api("PATCH", `/api/threads/${thread.id}`, { goal: null });
  assert.deepEqual([current.goal, current.goalSetAt, current.goalResumedAt, current.goalPausedAt, current.goalElapsedMs], [null, null, null, null, 0]);
  current = await again.api("PATCH", `/api/threads/${thread.id}`, { goalPaused: true });
  assert.equal(current.goalPausedAt, null, "no goal, nothing to pause");
});

test("a fork keeps the goal and its clock", (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  t.after(() => store.close());
  const thread = store.createThread(null, "chat", null);
  store.updateThread(thread.id, { goal: "Mål" });
  store.updateThread(thread.id, { goalPaused: true });
  const copy = store.forkThread(thread.id, "Kopi");
  const source = store.thread(thread.id)!;
  assert.equal(copy.goal, "Mål");
  assert.equal(copy.goalSetAt, source.goalSetAt);
  assert.equal(copy.goalPausedAt, source.goalPausedAt);
  assert.equal(copy.goalElapsedMs, source.goalElapsedMs);
});

test("images are uploaded, checked against their type, served, and reach the model with the message", async (t) => {
  const h = await startHarness(t);
  const { id } = await h.api("POST", "/api/images", { name: "skisse.png", mime: "image/png", data: PNG });
  assert.match(id, /^[0-9a-f-]{36}$/);
  const served = await h.raw("GET", `/api/images/${id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers["content-type"], "image/png");
  assert.equal(served.headers["x-content-type-options"], "nosniff");

  // Not an image, a type we do not keep, or a lie about the type.
  for (const body of [
    { name: "a.svg", mime: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") },
    { name: "a.png", mime: "image/png", data: Buffer.from("<html>").toString("base64") },
    { name: "a.html", mime: "text/html", data: PNG },
  ]) {
    await assert.rejects(h.api("POST", "/api/images", body), (err: any) => err.status === 415, body.name);
  }
  assert.equal((await h.raw("GET", "/api/images/../../agentic-desktop.db")).status, 404);
  assert.equal((await h.raw("GET", "/api/images/00000000-0000-0000-0000-000000000000")).status, 404);

  const thread = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hva er dette?", attachments: [{ kind: "image", imageId: id, name: "skisse.png" }] });
  const events = await h.finished(thread.id);
  const message = ofType(events, "user.message")[0];
  assert.deepEqual(message.attachments, [{ kind: "image", label: "skisse.png", imageId: id }]);

  await assert.rejects(
    h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Og dette?", attachments: [{ kind: "image", imageId: "00000000-0000-0000-0000-000000000000" }] }),
    (err: any) => err.status === 404,
  );
});

test("a message takes at most 20 images and files", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  for (let i = 0; i <= MAX_ATTACHMENTS; i++) writeFileSync(path.join(dir, `f${i}.txt`), `fil ${i}`);
  const project = await h.project(dir);
  const thread = await h.thread(project.id, "code");
  const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "file", path: `f${i}.txt` }));
  const err = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "se på disse", attachments: refs(MAX_ATTACHMENTS + 1) }).catch((e) => e);
  assert.equal(err.status, 400);
  assert.match(err.body.error ?? JSON.stringify(err.body), /maks 20/);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "se på disse", attachments: refs(MAX_ATTACHMENTS) });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "user.message")[0].attachments?.length, MAX_ATTACHMENTS);
});

test("the providers get attached images, and compaction drops old ones", () => {
  const image = { mime: "image/png", base64: PNG };
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "Hva er dette?" }, { type: "image", image, name: "skisse.png" }] },
    { role: "assistant", content: [{ type: "text", text: "En prikk." }] },
    { role: "user", content: [{ type: "text", text: "Takk" }] },
  ];
  const anthropic = toAnthropicMessages(messages) as any[];
  assert.deepEqual(anthropic[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } });

  const withImages = toOpenAiMessages("S", messages, true) as any[];
  assert.deepEqual(withImages[1].content[1], { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } });
  const without = toOpenAiMessages("S", messages, false) as any[];
  assert.equal(typeof without[1].content, "string");
  assert.match(without[1].content, /skisse\.png/, "a model without images is told an image was left out");

  assert.ok(estimateTokens("", messages) >= 1000, "an image counts in the estimate");
  const compacted = compactToolResults(messages, 1000);
  assert.equal(compacted[0].content.some((b) => b.type === "image"), false, "the old image is gone");
  assert.match(JSON.stringify(compacted[0].content), /fjernet ved komprimering/);
});

test("chapters are set, renamed and removed on the thread", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  let current = await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: "m1", title: "  Oppsett  " } });
  assert.deepEqual(current.chapters, [{ messageId: "m1", title: "Oppsett" }]);
  current = await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: "m2", title: "x".repeat(200) } });
  assert.equal(current.chapters[1].title.length, 80, "names are cut to 80");
  current = await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: "m1", title: "Nytt navn" } });
  assert.deepEqual(current.chapters.map((c: any) => c.title).sort(), ["Nytt navn", "x".repeat(80)]);
  current = await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: "m1", title: null } });
  assert.deepEqual(current.chapters.map((c: any) => c.messageId), ["m2"]);
  await assert.rejects(h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { title: "uten melding" } }), (err: any) => err.status === 400);
});

test("a branch from a message has the conversation up to it, and the model sees it", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "første" });
  await h.finished(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "andre" });
  await h.finished(thread.id, 2);
  const events = await h.events(thread.id);
  const firstAnswer = ofType(events.map((e) => e.event), "text.delta")[0].messageId;

  const branch = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: firstAnswer });
  assert.notEqual(branch.id, thread.id);
  const copied = (await h.events(branch.id)).map((e) => e.event);
  assert.deepEqual(ofType(copied, "user.message").map((m) => m.text), ["første"]);
  assert.equal(ofType(copied, "text.delta").every((d) => d.messageId === firstAnswer), true);
  assert.equal(ofType(copied, "run.finished").length, 1, "the run is closed in the copy");
  const original = events.find((e) => e.event.type === "user.message")!;
  assert.equal((await h.events(branch.id))[0].at, original.at, "the times are kept");

  const history = h.app.store.messages(branch.id);
  assert.equal(history[0].role, "user");
  assert.match(JSON.stringify(history), /første/);
  assert.doesNotMatch(JSON.stringify(history), /andre/);

  // From the user message itself: the question, with no answer, and no open run.
  const fromQuestion = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: ofType(events.map((e) => e.event), "user.message")[1].messageId });
  const second = (await h.events(fromQuestion.id)).map((e) => e.event);
  assert.deepEqual(ofType(second, "user.message").map((m) => m.text), ["første", "andre"]);
  assert.equal(ofType(second, "run.started").length, ofType(second, "run.finished").length);

  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: "finnes-ikke" }), (err: any) => err.status === 404);
});

test("text files from the disk: uploaded as text, binary and too big are refused, and the model gets the text", async (t) => {
  const h = await startHarness(t);
  const { id } = await h.api("POST", "/api/uploads", { name: "notater.txt", text: "Oppskrift: vafler" });
  for (const [body, status] of [
    [{ name: "a.bin", text: "ELF\u0000\u0001" }, 415],
    [{ name: "stor.txt", text: "x".repeat(512 * 1024 + 1) }, 413],
    [{ name: "", text: "hei" }, 400],
  ] as const) {
    await assert.rejects(h.api("POST", "/api/uploads", body), (err: any) => err.status === status, body.name);
  }
  const thread = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Les denne", attachments: [{ kind: "upload", uploadId: id, name: "notater.txt" }] });
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "user.message")[0].attachments, [{ kind: "upload", label: "notater.txt", uploadId: id }]);
  assert.match(JSON.stringify(h.app.store.messages(thread.id)[0]), /Oppskrift: vafler/);
  await assert.rejects(
    h.api("POST", `/api/threads/${thread.id}/messages`, { text: "igjen", attachments: [{ kind: "upload", uploadId: "../../agentic-desktop", name: "x" }] }),
    (err: any) => err.status === 404,
  );
});

test("mentions with kind=dir list only folders", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  mkdirSync(path.join(dir, "src/deler"), { recursive: true });
  writeFileSync(path.join(dir, "src/index.ts"), "x");
  writeFileSync(path.join(dir, "src/deler/a.ts"), "x");
  const project = await h.project(dir);
  const items = await h.api("GET", `/api/projects/${project.id}/mentions?kind=dir&q=src`);
  assert.ok(items.length >= 2);
  assert.equal(items.every((i: any) => i.kind === "dir"), true);
  assert.ok(items.some((i: any) => i.label === "src/deler/"));
});
