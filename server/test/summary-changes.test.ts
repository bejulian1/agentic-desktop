import assert from "node:assert/strict";
import { test } from "node:test";
import { startHarness } from "./helpers.ts";

test("Code summary retains older changes beyond the conversation page and respects undo, forks and scope", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "code");
  const other = await h.thread(null, "code");
  const file = { path: "older.ts", change: "added" as const, additions: 7, deletions: 0, countsExact: true };
  h.app.store.appendEvent(thread.id, { type: "turn.changes", runId: "run-old", turnId: "old", files: [file] });
  h.app.store.appendEvent(other.id, { type: "turn.changes", runId: "run-other", turnId: "other", files: [{ ...file, path: "private.ts" }] });
  for (let i = 0; i < 600; i++) h.app.store.appendEvent(thread.id, { type: "text.delta", runId: "later", messageId: "answer", text: "long history" });
  const summary = await h.api("GET", `/api/threads/${thread.id}/summary-changes`);
  assert.deepEqual(summary, [{ turnId: "old", files: [file], reverted: false }]);
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`);
  assert.deepEqual(await h.api("GET", `/api/threads/${fork.id}/summary-changes`), summary);
  h.app.store.appendEvent(thread.id, { type: "turn.reverted", turnId: "old" });
  assert.equal((await h.api("GET", `/api/threads/${thread.id}/summary-changes`))[0].reverted, true);
  assert.equal((await h.api("GET", `/api/threads/${fork.id}/summary-changes`))[0].reverted, false);
  await assert.rejects(h.api("GET", "/api/threads/missing/summary-changes"), /404/);
  const chat = await h.thread(null, "chat");
  await assert.rejects(h.api("GET", `/api/threads/${chat.id}/summary-changes`), /400/);
});
