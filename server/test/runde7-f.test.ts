// Round 7, agent F: Chat. Rewind (edit a message, or a new answer from the same or another model),
// what the model sees afterwards, and temporary chats. Against a local fake provider only.
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { ThreadEventEnvelope } from "../../shared/protocol.ts";
import { historyBefore } from "../src/http/chat-routes.ts";
import type { Message } from "../src/providers/types.ts";
import { hang, openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness } from "./helpers.ts";

async function setup(t: TestContext) {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  return { h, llm, modelId: model.id as string };
}

const said = (body: any) => (body.messages as Array<{ role: string; content: any }>).filter((m) => m.role !== "system").map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : m.content.map((c: any) => c.text ?? "").join("")}`);

test("rewind: an edited message replaces it and what came after, and the model sees the cut history", async (t) => {
  const { h, llm, modelId } = await setup(t);
  const thread = await h.thread(null, "chat", modelId);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Eget navn" });
  llm.reply(sse(openaiText("svar en")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "første" });
  await h.finished(thread.id, 1);
  llm.reply(sse(openaiText("svar to")));
  const second = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "andre" });
  await h.finished(thread.id, 2);
  await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: second.messageId, title: "Borte" } });

  llm.reply(sse(openaiText("svar tre")));
  const sent = await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: second.messageId, text: "  andre, rettet  " });
  assert.equal(sent.queued, false);
  const events = (await h.finished(thread.id, 2));
  const users = ofType(events, "user.message").map((e) => e.text);
  assert.deepEqual(users, ["første", "andre, rettet"]);
  assert.equal(ofType(events, "run.finished").length, 2, "the old second run is gone");
  assert.ok(!JSON.stringify(events).includes("svar to"), "the old answer is gone");
  assert.deepEqual(said(llm.requests[2].body), ["user: første", "assistant: svar en", "user: andre, rettet"]);
  const after = await h.api("GET", "/api/bootstrap").then((b: any) => b.threads.find((x: any) => x.id === thread.id));
  assert.deepEqual(after.chapters, [], "a chapter on a removed message goes too");
  assert.equal(after.title, "Eget navn");
  const seqs = (await h.events(thread.id)).map((e: ThreadEventEnvelope) => e.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "seq numbers stay without gaps");
});

test("rewind: a new answer from the answer's id, with another model, and the checks around it", async (t) => {
  const { h, llm, modelId } = await setup(t);
  const thread = await h.thread(null, "chat", modelId);
  llm.reply(sse(openaiText("gammelt svar")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "spørsmål" });
  const events = await h.finished(thread.id, 1);
  const answerId = ofType(events, "text.delta")[0].messageId;

  // Another model: the thread switches, and the demo model answers.
  const demo = (await h.api("GET", "/api/bootstrap")).models.find((m: any) => m.model === "mock").id;
  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: answerId, modelId: demo });
  const again = await h.finished(thread.id, 1);
  assert.deepEqual(ofType(again, "user.message").map((e) => e.text), ["spørsmål"]);
  assert.equal(ofType(again, "run.started")[0].modelId, demo);
  assert.ok(!JSON.stringify(again).includes("gammelt svar"));
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === thread.id).modelId, demo);

  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: "finnes-ikke" }), /404/);
  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: answerId, modelId: "nei" }), /400/);
  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: ofType(again, "user.message")[0].messageId, text: "  " }), /400/);

  // Not while it runs.
  await h.api("PATCH", `/api/threads/${thread.id}`, { modelId });
  llm.reply(hang());
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "henger" });
  const running = ofType((await h.events(thread.id)).map((e: ThreadEventEnvelope) => e.event), "user.message").at(-1)!.messageId;
  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: running }), /409/);
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const project = await h.project();
  const code = await h.thread(project.id, "code", modelId);
  // Kode since round 9: only with keepFiles, since files are not rolled back (runde9.test.ts).
  await assert.rejects(h.api("POST", `/api/threads/${code.id}/rewind`, { messageId: "x" }), /400/);
  await assert.rejects(h.api("POST", `/api/threads/${code.id}/rewind`, { messageId: "x", keepFiles: true }), /404/);
});

test("rewind validation preserves history, model and chapters when an attachment disappeared", async (t) => {
  const { h, llm, modelId } = await setup(t);
  const upload = await h.api("POST", "/api/uploads", { name: "notat.txt", text: "vedleggets innhold" });
  const thread = await h.thread(null, "chat", modelId);
  llm.reply(sse(openaiText("Dette svaret skal beholdes ved feil.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Forklar vedlegget", attachments: [{ kind: "upload", uploadId: upload.id, name: "notat.txt" }] });
  const events = await h.finished(thread.id);
  const user = ofType(events, "user.message")[0];
  await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: user.messageId, title: "Behold dette" } });
  const beforeEvents = await h.events(thread.id);
  const beforeMessages = h.app.store.messages(thread.id);
  const beforeThread = h.app.store.thread(thread.id);
  const file = path.join(h.app.config.dataDir, "uploads", `${upload.id}.txt`);
  rmSync(file);
  const missing = await h.raw("POST", `/api/threads/${thread.id}/rewind`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: user.messageId, text: "Ny tekst", modelId: "mock-demo" }) });
  assert.equal(missing.status, 404);
  assert.deepEqual(await h.events(thread.id), beforeEvents);
  assert.deepEqual(h.app.store.messages(thread.id), beforeMessages);
  assert.deepEqual(h.app.store.thread(thread.id), beforeThread);
  assert.equal(llm.requests.length, 1);
  writeFileSync(file, "vedleggets innhold");
  // An attachment-only edit is refused by the composer/server, with the old answer intact.
  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: user.messageId, text: "" }), /400/);
  assert.deepEqual(await h.events(thread.id), beforeEvents);
  assert.deepEqual(h.app.store.messages(thread.id), beforeMessages);
  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: user.messageId, text: "Ny tekst", modelId: "mock-demo" });
  const again = await h.finished(thread.id);
  assert.equal(ofType(again, "run.started")[0].modelId, "mock-demo");
  assert.equal(ofType(again, "user.message")[0].text, "Ny tekst");
  assert.equal(ofType(again, "user.message")[0].attachments?.[0].uploadId, upload.id);
});

test("historyBefore keeps the stored history when it lines up, and rebuilds it when it does not", () => {
  const env = (seq: number, event: any): ThreadEventEnvelope => ({ seq, threadId: "t", at: seq, event });
  const events = [
    env(1, { type: "user.message", messageId: "u1", text: "a" }),
    env(2, { type: "text.delta", runId: "r", messageId: "m1", text: "A" }),
    env(3, { type: "user.message", messageId: "u2", text: "b" }),
    env(4, { type: "text.delta", runId: "r2", messageId: "m2", text: "B" }),
  ];
  const image = { type: "image", mime: "image/png", data: "x" } as any;
  const stored: Message[] = [
    { role: "user", content: [{ type: "text", text: "a" }, image] },
    { role: "assistant", content: [{ type: "text", text: "A" }] },
    { role: "user", content: [{ type: "text", text: "b" }] },
    { role: "assistant", content: [{ type: "text", text: "B" }] },
  ];
  assert.deepEqual(historyBefore(stored, events, 3), stored.slice(0, 2), "the image stays");
  assert.deepEqual(historyBefore(stored, events, 1), []);
  // A note the app added (as after Angre) breaks the line-up: rebuilt from the log as text.
  const noted: Message[] = [...stored.slice(0, 2), { role: "user", content: [{ type: "text", text: "[note]" }] }, ...stored.slice(2)];
  assert.deepEqual(historyBefore(noted, events, 3), [
    { role: "user", content: [{ type: "text", text: "a" }] },
    { role: "assistant", content: [{ type: "text", text: "A" }] },
  ]);
});

test("a temporary chat is marked, left out of search, and can be deleted", async (t) => {
  const { h, llm, modelId } = await setup(t);
  const temp = await h.api("POST", "/api/threads/temporary", { modelId });
  assert.equal(temp.temporary, true);
  assert.equal(temp.mode, "chat");
  assert.equal(temp.title, "Midlertidig chat");
  llm.reply(sse(openaiText("hemmelig svar")));
  await h.api("POST", `/api/threads/${temp.id}/messages`, { text: "ord-som-ikke-finnes-ellers" });
  await h.finished(temp.id, 1);
  const kept = (await h.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === temp.id);
  assert.equal(kept.title, "Midlertidig chat", "the title stays as the mark");
  assert.deepEqual(await h.api("GET", "/api/threads/search?q=ord-som-ikke-finnes-ellers"), []);
  const normal = await h.thread(null, "chat", modelId);
  assert.equal(normal.temporary, undefined);
  await assert.rejects(h.api("POST", "/api/threads/temporary", { modelId: "nei" }), /400/);
  await h.api("DELETE", `/api/threads/${temp.id}`);
  assert.ok(!(await h.api("GET", "/api/bootstrap")).threads.some((x: any) => x.id === temp.id));
});
