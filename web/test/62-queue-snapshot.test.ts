import assert from "node:assert/strict";
import { Store } from "../../server/src/db.ts";
import { flow, threadItem, waitFor } from "./harness.ts";

flow("Køsnapshot beholder eldre ventende meldinger og et forsinket snapshot gjenoppliver ikke fjernede meldinger", async (h) => {
  const { page } = h;
  const thread = await h.createThread(null);
  const store = new Store(h.dataDir);
  try {
    store.enqueue(thread.id, "old-waiting", { id: "old-waiting", kind: "message", text: "Eldre ventende melding", modelText: "Eldre ventende melding", chainId: "chain" });
    store.appendEvent(thread.id, { type: "user.queued", messageId: "old-waiting", text: "Eldre ventende melding" });
    for (let i = 0; i < 600; i++) store.appendEvent(thread.id, { type: "user.message", messageId: `later-${i}`, text: `Senere ${i}` });
  } finally { store.close(); }
  await h.reload();
  await threadItem(page, thread.id).locator(".thread-text").click();
  const queued = page.locator('.queue-entry[data-message-id="old-waiting"]');
  await queued.getByText("Eldre ventende melding", { exact: true }).waitFor();
  const tail = await h.api("GET", `/api/threads/${thread.id}/events?tail=500`);
  assert.equal(tail.some((entry: any) => entry.event.type === "user.queued"), false);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let captured = false;
  await page.route(`**/api/threads/${thread.id}/queue`, async (route) => {
    const response = await route.fetch();
    captured = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await h.reload();
    await threadItem(page, thread.id).locator(".thread-text").click();
    await waitFor(() => captured, "det gamle køsnapshotet er fanget");
    await h.api("DELETE", `/api/threads/${thread.id}/queue/old-waiting`);
    release();
    await page.getByText("Senere 599", { exact: true }).waitFor();
    await queued.waitFor({ state: "detached" });
    assert.deepEqual((await h.api("GET", `/api/threads/${thread.id}/queue`)).items, []);
  } finally { release(); }
});
