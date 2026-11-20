import assert from "node:assert/strict";
import { dragTo, flow, pane, threadItem, waitFor } from "./harness.ts";

flow("to ruter strømmer samtidig, tråd dras inn, rute løsrives og hentes tilbake", async (h) => {
  const { page, context } = h;
  const a = await h.createThread(null);
  const b = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${a.id}`, { title: "Tråd A" });
  await h.api("PATCH", `/api/threads/${b.id}`, { title: "Tråd B" });
  await threadItem(page, a.id).click();
  await pane(page, a.id).waitFor();

  // A second pane, and a thread dragged into it from the sidebar.
  await page.getByTestId("new-pane").click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 2, "to ruter");
  const empty = page.locator('.pane-inner[data-thread-id=""]');
  const target = (await empty.boundingBox())!;
  const source = (await threadItem(page, b.id).boundingBox())!;
  await dragTo(page, { x: source.x + 40, y: source.y + 12 }, { x: target.x + target.width / 2, y: target.y + target.height / 2 });
  await pane(page, b.id).waitFor();
  assert.equal(await page.locator(".pane-inner").count(), 2, "slipp midt i ruten gir ingen ny rute");

  // Both stream at the same time, each in its own pane with its own message field.
  const box = (id: string) => pane(page, id).getByLabel("Melding");
  await box(a.id).fill("lang strøm 4000 rolig");
  await box(b.id).fill("lang strøm 4000 rolig");
  await box(a.id).press("Enter");
  await box(b.id).press("Enter");
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 2, "begge strømmer");
  await pane(page, a.id).locator(".row-text h3", { hasText: "Del 1" }).first().waitFor();
  await pane(page, b.id).locator(".row-text h3", { hasText: "Del 1" }).first().waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "begge er ferdige", 60_000);
  const eventsA = await h.events(a.id);
  const eventsB = await h.events(b.id);
  const start = (events: typeof eventsA) => events.find((e) => e.event.type === "run.started")!.at;
  const end = (events: typeof eventsA) => events.find((e) => e.event.type === "run.finished")!.at;
  assert.ok(start(eventsA) < end(eventsB) && start(eventsB) < end(eventsA), "kjøringene overlappet");

  // Dragging a title bar to the edge of the other pane moves it there.
  const headA = (await pane(page, a.id).locator(".pane-head").boundingBox())!;
  const boxB = (await pane(page, b.id).boundingBox())!;
  const beforeA = (await pane(page, a.id).boundingBox())!;
  await dragTo(page, { x: headA.x + 120, y: headA.y + 18 }, { x: boxB.x + boxB.width / 2, y: boxB.y + boxB.height - 12 });
  await waitFor(async () => {
    const now = (await pane(page, a.id).boundingBox())!;
    return now.y > beforeA.y + 50 && now.width > boxB.width + 100;
  }, "ruten ligger under den andre");
  await page.waitForTimeout(300); // The panes glide into place with a transform, which boxes include.

  // Middle of the other pane swaps them.
  const headA2 = (await pane(page, a.id).locator(".pane-head").boundingBox())!;
  const boxB2 = (await pane(page, b.id).boundingBox())!;
  const beforeSwap = (await pane(page, a.id).boundingBox())!;
  await dragTo(page, { x: headA2.x + 120, y: headA2.y + 18 }, { x: boxB2.x + boxB2.width / 2, y: boxB2.y + boxB2.height / 2 });
  await waitFor(async () => (await pane(page, a.id).boundingBox())!.y < beforeSwap.y - 50, "rutene byttet plass");

  // The layout comes back after a reload.
  await page.waitForTimeout(300);
  await h.reload();
  await pane(page, a.id).waitFor();
  await pane(page, b.id).waitFor();
  assert.equal(await page.locator(".pane-inner").count(), 2, "oppsettet er lagret");

  // Løsriv from ⋯ in the top bar (round 11), for the pane with focus.
  await pane(page, b.id).locator(".pane-head").click();
  await page.locator(`.pane-inner.focused[data-thread-id="${b.id}"]`).waitFor();
  await page.getByRole("button", { name: "Flere valg" }).click();
  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("menuitem", { name: "Løsriv ruten til eget vindu" }).click()]);
  await popup.waitForSelector(".app.solo");
  await pane(popup, b.id).locator(".row-text").first().waitFor();
  await page.getByTestId("detached-bar").getByText("i eget vindu").waitFor();
  assert.equal(await page.locator(".pane-inner").count(), 1);

  // A detached window is a full pane that works on its own.
  await popup.getByLabel("Melding").fill("hei fra eget vindu");
  await popup.getByLabel("Melding").press("Enter");
  await popup.locator(".user-text", { hasText: "hei fra eget vindu" }).waitFor();

  // Closing it leaves a way back.
  await popup.close();
  await page.getByTestId("detached-bar").getByText("vinduet er lukket").waitFor();
  await page.getByTestId("detached-bar").getByRole("button", { name: "Hent tilbake" }).click();
  await pane(page, b.id).waitFor();
  await page.locator(".pane-inner", { hasText: "hei fra eget vindu" }).waitFor();
  assert.equal(await page.getByTestId("detached-bar").count(), 0);

  // Dropping a pane outside the window detaches it too.
  const head = (await pane(page, b.id).locator(".pane-head").boundingBox())!;
  const popupEvent = context.waitForEvent("page");
  await dragTo(page, { x: head.x + 120, y: head.y + 18 }, { x: 1500, y: 300 });
  const dropped = await popupEvent;
  await dropped.waitForSelector(".app.solo");
  await pane(dropped, b.id).waitFor();

  // Legg tilbake from the detached window itself.
  await dropped.getByRole("button", { name: "Legg tilbake" }).click();
  await pane(page, b.id).waitFor();
  assert.equal(await page.getByTestId("detached-bar").count(), 0);
});

flow("flere vinduer er likeverdige og holdes i sync", async (h) => {
  const { page, context } = h;
  // v0.19: a new window starts on an empty conversation by default ("Ny, tom samtale"). Windows
  // that share the layout are the "Fortsett der jeg slapp" choice, which this test is about.
  await h.api("PATCH", "/api/settings", { startConversation: "resume" });
  const a = await h.createThread(null);
  await threadItem(page, a.id).click();
  await pane(page, a.id).waitFor();
  await page.waitForTimeout(300); // The layout is stored after a short delay.
  const second = await context.newPage();
  await second.goto(h.origin);
  await pane(second, a.id).waitFor();
  await page.getByTestId("new-pane").click();
  await waitFor(async () => (await second.locator(".pane-inner").count()) === 2, "den nye ruten kom til det andre vinduet");
  await second.getByRole("button", { name: "Lukk ruten" }).last().click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 1, "lukkingen kom tilbake");
  await pane(page, a.id).getByLabel("Melding").fill("hjelp");
  await pane(page, a.id).getByLabel("Melding").press("Enter");
  // The mouse in the second window may rest on the timeline, whose card quotes the same reply.
  await pane(second, a.id).getByText("Dette er demo-modellen").first().waitFor();
  await second.close();
});

flow("seks ruter er taket, og Lukk og delt visning virker", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Del til høyre" }).click();
  await page.getByRole("button", { name: "Del nedover" }).first().click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 3, "tre ruter");
  for (let i = 0; i < 3; i++) await page.getByTestId("new-pane").click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 6, "seks ruter");
  await page.getByTestId("new-pane").click();
  await page.locator(".toast", { hasText: "6 ruter" }).waitFor();
  assert.equal(await page.locator(".pane-inner").count(), 6);
  await page.getByRole("button", { name: "Lukk ruten" }).first().click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 5, "fem ruter");
  assert.equal(await page.locator(".pane-inner.focused").count(), 1, "én rute har fokus");
}, { viewport: { width: 1600, height: 1000 } });
