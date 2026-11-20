// Issue #11: reconnecting after a missed history rewrite (edit/regenerate) must trigger thread.reset
// for both shorter and longer replacements, rather than replaying against stale/reused seq numbers.
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MOCK_MODEL_ID, Store } from "../src/db.ts";
import { openaiText, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir, until, type Harness } from "./helpers.ts";

async function fakeModel(h: Harness, llm: FakeLlm): Promise<string> {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1` });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake-1", contextWindow: 32_000 });
  return model.id as string;
}

test("thread.subscribe med foreldet historyRevision sender thread.reset både ved kortere og lengre omskriving", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);

  // Two turns initially so the log has a high seq before a shorter rewrite.
  llm.reply(sse(openaiText("Første svar")));
  llm.reply(sse(openaiText("Andre svar")));
  const thread = await h.thread(null, "chat", modelId);

  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Første spørsmål" });
  await until(() => !h.app.runner.isRunning(thread.id), "første tur ferdig");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Andre spørsmål" });
  await until(() => !h.app.runner.isRunning(thread.id), "andre tur ferdig");

  const initialRes = await h.raw("GET", `/api/threads/${thread.id}/events?tail=500`);
  assert.equal(initialRes.status, 200);
  assert.equal(initialRes.headers["x-thread-history-revision"], "0");
  const initialEvents = JSON.parse(initialRes.body) as Array<{ seq: number; event: { type: string; messageId?: string; text?: string } }>;
  const firstUser = initialEvents.find((e) => e.event.type === "user.message" && e.event.text === "Første spørsmål")!;
  const initialLastSeq = initialEvents.at(-1)!.seq;
  assert.ok(initialLastSeq >= 6);

  // Client A connects with current revision 0 and disconnects before the rewrite.
  const clientA = await h.socket();
  clientA.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: initialLastSeq, historyRevision: 0 });
  await new Promise((r) => setTimeout(r, 40));
  clientA.close();

  // Shorter replacement: edit the first message, removing the second turn so new lastSeq < initialLastSeq.
  llm.reply(sse(openaiText("Kort nytt svar")));
  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: firstUser.event.messageId, text: "Redigert kort" });
  await until(() => !h.app.runner.isRunning(thread.id), "kortere omskriving ferdig");

  const shorterRes = await h.raw("GET", `/api/threads/${thread.id}/events?tail=500`);
  assert.equal(shorterRes.headers["x-thread-history-revision"], "1");
  const shorterEvents = JSON.parse(shorterRes.body) as Array<{ seq: number; event: { type: string; messageId?: string; text?: string } }>;
  const shorterLastSeq = shorterEvents.at(-1)!.seq;
  assert.ok(shorterLastSeq < initialLastSeq, `forventet kortere erstatning (${shorterLastSeq} < ${initialLastSeq})`);

  // Client A reconnects with old afterSeq and old historyRevision=0 -> must receive thread.reset.
  const reconnectShort = await h.socket();
  reconnectShort.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: initialLastSeq, historyRevision: 0 });
  const resetShort = await reconnectShort.waitFor((m) => m.type === "thread.reset");
  assert.equal(resetShort.type, "thread.reset");
  assert.equal(resetShort.threadId, thread.id);
  assert.equal(resetShort.historyRevision, 1);
  reconnectShort.close();

  // Longer replacement: edit the first message and add a second turn so new lastSeq > shorterLastSeq.
  const editedUser = shorterEvents.find((e) => e.event.type === "user.message" && e.event.text === "Redigert kort")!;
  llm.reply(sse(openaiText("Lengre nytt svar 1")));
  llm.reply(sse(openaiText("Lengre nytt svar 2")));
  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: editedUser.event.messageId, text: "Redigert lang" });
  await until(() => !h.app.runner.isRunning(thread.id), "første del av lengre omskriving ferdig");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Ekstra oppfølging" });
  await until(() => !h.app.runner.isRunning(thread.id), "andre del av lengre omskriving ferdig");

  const longerRes = await h.raw("GET", `/api/threads/${thread.id}/events?tail=500`);
  assert.equal(longerRes.headers["x-thread-history-revision"], "2");
  const longerEvents = JSON.parse(longerRes.body) as Array<{ seq: number }>;
  const longerLastSeq = longerEvents.at(-1)!.seq;
  assert.ok(longerLastSeq > shorterLastSeq, `forventet lengre erstatning (${longerLastSeq} > ${shorterLastSeq})`);

  // Client B reconnects with shorterLastSeq and stale historyRevision=1 -> must receive thread.reset,
  // NOT partial thread.event replay from seq > shorterLastSeq.
  const reconnectLong = await h.socket();
  reconnectLong.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: shorterLastSeq, historyRevision: 1 });
  const firstMsg = await reconnectLong.waitFor((m) => m.type === "thread.reset" || m.type === "thread.event");
  assert.equal(firstMsg.type, "thread.reset", "må sende thread.reset i stedet for delvis replay");
  assert.equal(firstMsg.threadId, thread.id);
  assert.equal(firstMsg.historyRevision, 2);
  reconnectLong.close();

  // Subscribing with the current revision 2 replays normal backlog without thread.reset.
  const upToDate = await h.socket();
  upToDate.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 0, historyRevision: 2 });
  const firstReplay = await upToDate.waitFor((m) => m.type === "thread.reset" || m.type === "thread.event");
  assert.equal(firstReplay.type, "thread.event");
  assert.equal(firstReplay.historyRevision, 2);
  upToDate.close();

  const answer = (await h.events(thread.id)).find(({ event }) => event.type === "text.delta")?.event;
  assert.ok(answer?.type === "text.delta");
  llm.reply(sse(openaiText("Regenerert svar")));
  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: answer.messageId });
  await until(() => !h.app.runner.isRunning(thread.id), "regenerering ferdig");
  assert.equal(h.app.store.historyRevision(thread.id), 3);
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`);
  assert.equal(h.app.store.historyRevision(fork.id), 0);
  assert.equal(h.app.store.historyRevision(thread.id), 3);

  // history_revision persists in SQLite across store reopen.
  const dataDir = h.app.config.dataDir;
  await h.app.close();
  const reopened = new Store(dataDir);
  t.after(() => reopened.close());
  assert.equal(reopened.historyRevision(thread.id), 3);
});

test("en database uten history_revision oppgraderes uten å miste tråder eller hendelser", (t) => {
  const dataDir = tempDir(t);
  const oldStore = new Store(dataDir);
  const thread = oldStore.createThread(null, "chat", MOCK_MODEL_ID, { title: "Behold denne tråden" });
  const envelope = oldStore.appendEvent(thread.id, { type: "user.message", messageId: "old-message", text: "Behold denne meldingen" });
  oldStore.close();
  {
    using db = new DatabaseSync(path.join(dataDir, "agentic-desktop.db"));
    db.exec("ALTER TABLE threads DROP COLUMN history_revision");
  }

  const upgraded = new Store(dataDir);
  try {
    assert.equal(upgraded.thread(thread.id)?.title, thread.title);
    assert.deepEqual(upgraded.events(thread.id, 0, 10), [envelope]);
    assert.equal(upgraded.historyRevision(thread.id), 0);
    upgraded.rewindThread(thread.id, envelope.seq, []);
    assert.equal(upgraded.historyRevision(thread.id), 1);
  } finally {
    upgraded.close();
  }
});
