import assert from "node:assert/strict";
import { test } from "node:test";
import { startHarness } from "./helpers.ts";

test("queue snapshot is scoped, authoritative and exposes only public message metadata", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  const other = await h.thread(null, "chat");
  h.app.store.enqueue(thread.id, "old-queued", { id: "old-queued", kind: "message", text: "Venter på tur", modelText: "Venter på tur\nPRIVATE_ATTACHMENT_BODY", images: [{ image: "PRIVATE_IMAGE" }], chainId: "private-chain" });
  h.app.store.appendEvent(thread.id, { type: "user.queued", messageId: "old-queued", text: "Gammel tekst" });
  for (let i = 0; i < 600; i++) h.app.store.appendEvent(thread.id, { type: "text.delta", runId: "run", messageId: "answer", text: "." });
  const snapshot = await h.api("GET", `/api/threads/${thread.id}/queue`);
  assert.equal(snapshot.seq, 601);
  assert.deepEqual(snapshot.items, [{ messageId: "old-queued", text: "Venter på tur", steer: false, editable: true, steerable: true }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|private-chain|modelText|images/);
  assert.deepEqual((await h.api("GET", `/api/threads/${other.id}/queue`)).items, []);
  await assert.rejects(h.api("GET", "/api/threads/missing/queue"), /404/);
  await h.api("DELETE", `/api/threads/${thread.id}/queue/old-queued`);
  const after = await h.api("GET", `/api/threads/${thread.id}/queue`);
  assert.equal(after.seq, 602);
  assert.deepEqual(after.items, []);
});
