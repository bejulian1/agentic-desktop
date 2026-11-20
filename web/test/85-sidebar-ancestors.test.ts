import assert from "node:assert/strict";
import { flow, openProject, threadItem, waitFor } from "./harness.ts";

flow("forkortet instanstre beholder hovedinstansen og mellomledd uten å duplisere Festet og seksjoner", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const parent = await h.createThread(project.id);
  const child = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code", sideOf: parent.id });
  const grandchild = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code", sideOf: child.id });
  const chain = [parent.id, child.id, grandchild.id];
  let filler!: Awaited<ReturnType<typeof h.createThread>>;
  for (let i = 0; i < 12; i++) filler = await h.createThread(project.id);

  // Keep the entire family older than the first ten rows even after it is opened. Statuses
  // come only from the isolated bootstrap fixture; no real model or running server task is used.
  let status: "idle" | "running" | "waiting" = "idle";
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    for (const thread of bootstrap.threads) {
      const index = chain.indexOf(thread.id);
      if (index >= 0) thread.updatedAt = Date.now() - 86_400_000 + index;
      if (thread.id === grandchild.id) {
        thread.running = status === "running";
        thread.pendingApprovals = status === "waiting" ? 1 : 0;
      }
    }
    await route.fulfill({ response, json: bootstrap });
  });
  await h.reload();
  const group = page.locator('.group[data-project="Demo"]');
  assert.equal(await threadItem(page, parent.id).count(), 0, "inaktiv gammel familie er forkortet bort");
  await group.getByRole("button", { name: /^Vis flere/ }).click();
  await threadItem(page, grandchild.id).locator(".thread-text").click();
  await threadItem(page, grandchild.id).locator('.thread-text[aria-current="true"]').waitFor();
  await group.getByRole("button", { name: "Vis færre", exact: true }).click();

  const expectFamily = async () => {
    await waitFor(async () => (await group.locator(".thread-item").count()) === 13, "ti vanlige rader og hele familien vises");
    const order = await group.locator(".thread-item").evaluateAll((items) => items.map((el) => el.getAttribute("data-thread-item")));
    assert.deepEqual(order.slice(-3), chain, "hovedinstansen og mellomleddet står foran underinstansen");
    for (const [depth, id] of chain.entries()) {
      const row = threadItem(page, id);
      assert.equal(await row.count(), 1, "ingen rad dupliseres");
      assert.equal(await row.evaluate((el) => el.classList.contains("child")), depth > 0);
      if (depth > 0) {
        assert.equal(await row.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--depth")), String(depth));
        assert.equal(await row.evaluate((el) => getComputedStyle(el, "::after").borderLeftStyle), "solid", "forbindelsesstreken vises");
      }
    }
    await group.getByRole("button", { name: "Vis flere (2)", exact: true }).waitFor();
  };
  await expectFamily();

  // Opening an unrelated thread releases the old family. A running or waiting grandchild
  // must retain the same ancestors even when none of them is the selected thread.
  await threadItem(page, filler.id).locator(".thread-text").click();
  await waitFor(async () => (await threadItem(page, parent.id).count()) === 0, "inaktiv familie skjules igjen");
  status = "running";
  await h.reload();
  await expectFamily();
  status = "waiting";
  await h.reload();
  await expectFamily();

  // Moving ancestors out of the project's list must keep their chosen location. Only
  // ancestors in the child's current list participate in its tree and retention.
  await h.api("PATCH", `/api/threads/${parent.id}`, { pinned: true });
  const section = await h.api("POST", "/api/sections", { name: "Hovedarbeid", mode: "code" });
  await h.api("PATCH", `/api/threads/${child.id}`, { sectionId: section.id });
  await h.reload();
  await page.locator(`.pinned-projects [data-thread-item="${parent.id}"]`).waitFor();
  await page.locator(`[data-section-id="${section.id}"] [data-thread-item="${child.id}"]`).waitFor();
  await group.locator(`[data-thread-item="${grandchild.id}"]`).waitFor();
  assert.equal(await group.locator(`[data-thread-item="${parent.id}"], [data-thread-item="${child.id}"]`).count(), 0, "forfedre hentes ikke tilbake fra andre grupper");
  for (const id of chain) assert.equal(await threadItem(page, id).count(), 1);
  assert.equal(await threadItem(page, grandchild.id).evaluate((el) => el.classList.contains("child")), false, "ingen strek peker på en annen gruppes rad");
});
