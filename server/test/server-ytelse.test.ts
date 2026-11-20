// SPEC 29.5, the server: what the optimisation changed must give the same answers as before.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage, ThreadEventEnvelope } from "../../shared/protocol.ts";
import { startHarness, tempDir } from "./helpers.ts";
import { Store } from "../src/db.ts";

// Events with text that JSON escapes in different ways: quotes, backslashes, newlines, Unicode.
function fill(store: Store, threadId: string): void {
  const runId = "run-1";
  store.appendEvent(threadId, { type: "user.message", messageId: "m1", text: "Hei \"du\" \\ æøå 🚀\n slutt" });
  store.appendEvent(threadId, { type: "run.started", runId, modelId: "mock-demo" });
  for (let i = 0; i < 30; i++) store.appendEvent(threadId, { type: "text.delta", runId, messageId: "m2", text: `del ${i}: <b>&</b>\t${"x".repeat(i * 50)}` });
  store.appendEvent(threadId, { type: "run.finished", runId, status: "done" });
}

test("eventsJson and eventsTailJson are the same text as JSON.stringify of events and eventsTail", (t) => {
  const store = new Store(tempDir(t));
  t.after(() => store.close());
  const thread = store.createThread(null, "chat", null);
  fill(store, thread.id);
  const text = (rows: string[]) => `[${rows.join(",")}]`;
  for (const [after, limit] of [[0, 20_000], [5, 10], [33, 100], [100, 5]]) {
    assert.equal(text(store.eventsJson(thread.id, after, limit)), JSON.stringify(store.events(thread.id, after, limit)));
  }
  for (const limit of [1, 7, 500]) assert.equal(text(store.eventsTailJson(thread.id, limit)), JSON.stringify(store.eventsTail(thread.id, limit)));
  assert.equal(text(store.eventsJson("ingen", 0, 10)), "[]");
});

test("GET /events and the WebSocket backlog send the stored events unchanged", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  fill(h.app.store, thread.id);
  const all = h.app.store.events(thread.id, 0, 20_000);

  const res = await h.raw("GET", `/api/threads/${thread.id}/events?limit=20000`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers["content-type"]), /^application\/json/);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.body, JSON.stringify(all));
  assert.equal((await h.raw("GET", `/api/threads/${thread.id}/events?tail=5`)).body, JSON.stringify(all.slice(-5)));
  assert.equal((await h.raw("GET", `/api/threads/${thread.id}/events?after=3&limit=4`)).body, JSON.stringify(all.slice(3, 7)));
  assert.equal((await h.raw("GET", "/api/threads/ingen/events")).status, 404);

  const socket = await h.socket();
  socket.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 2 });
  const last = all.at(-1)!.seq;
  await socket.waitFor((m) => m.type === "thread.event" && m.envelope.seq === last);
  const got = socket.received.filter((m): m is Extract<ServerMessage, { type: "thread.event" }> => m.type === "thread.event").map((m) => m.envelope);
  assert.deepEqual(got, all.slice(2) satisfies ThreadEventEnvelope[]);
});

test("one event to several windows reaches all of them, and a broadcast too", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  const sockets = [await h.socket(), await h.socket(), await h.socket()];
  for (const socket of sockets) socket.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 0 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await h.finished(thread.id);
  const finished = (m: ServerMessage) => m.type === "thread.event" && m.envelope.event.type === "run.finished";
  for (const socket of sockets) await socket.waitFor(finished);
  const streams = sockets.map((s) => JSON.stringify(s.received.filter((m) => m.type === "thread.event")));
  assert.equal(streams[1], streams[0]);
  assert.equal(streams[2], streams[0]);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Nytt navn" });
  for (const socket of sockets) await socket.waitFor((m) => m.type === "thread.changed" && m.thread.title === "Nytt navn");
});

test("the sidebar, statistics and forks use indexes, not a scan of every run or event", (t) => {
  const store = new Store(tempDir(t));
  t.after(() => store.close());
  const db = (store as unknown as { db: { prepare: (sql: string) => { all: (...args: unknown[]) => Array<{ detail: string }> } } }).db;
  const plan = (sql: string, ...args: unknown[]) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join("; ");
  // The queries word for word as db.ts has them: a partial index is only used when they match.
  assert.match(plan("SELECT status, error, MAX(start_seq) FROM runs WHERE thread_id = ?", "x"), /USING (COVERING )?INDEX runs_thread/);
  assert.match(plan(`SELECT thread_id, event FROM events WHERE event LIKE '{"type":"turn.%' ORDER BY thread_id, seq`), /INDEX events_turn/);
  assert.match(plan(`SELECT thread_id, at, event FROM events WHERE event LIKE '{"type":"usage"%' ORDER BY thread_id, seq`), /INDEX events_usage/);
  assert.match(plan(`SELECT at FROM events WHERE event LIKE '{"type":"user.message"%'`), /INDEX events_user_message/);
  assert.match(plan("SELECT t.id FROM turns t WHERE t.thread_id = ? AND t.reverted_at IS NULL", "x"), /INDEX turns_thread/);
});

test("statistics count each run on its own local day, also across midnight", (t) => {
  const store = new Store(tempDir(t));
  t.after(() => store.close());
  const thread = store.createThread(null, "chat", "mock-demo");
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const at = (daysBack: number, hour: number, minute: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  // Seconds either side of midnight, and several runs in the same quarter hour.
  const starts = [at(1, 23, 59) + 59_000, at(0, 0, 0) + 1_000, at(0, 0, 5), at(0, 0, 10), at(2, 10, 0)];
  starts.forEach((started, i) => {
    store.createRun({ id: `r${i}`, threadId: thread.id, modelId: "mock-demo", turnId: `t${i}`, startSeq: i + 1 });
    store.finishRun(`r${i}`, "done");
  });
  const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
  starts.forEach((started, i) => db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(started, `r${i}`));
  const day = (ms: number) => new Date(ms).toLocaleDateString("sv-SE");
  const runsOn = (date: string) => store.profileStats(now.getTime()).days.find((d) => d.date === date)?.runs;
  assert.equal(runsOn(day(at(1, 12, 0))), 1);
  assert.equal(runsOn(day(at(0, 12, 0))), 3);
  assert.equal(runsOn(day(at(2, 12, 0))), 1);
  const home = store.homeStats("7d", now.getTime());
  assert.equal(home.heat.find((d) => d.date === day(at(0, 12, 0)))?.runs, 3);
  assert.equal(home.heat.find((d) => d.date === day(at(1, 12, 0)))?.runs, 1);
});
