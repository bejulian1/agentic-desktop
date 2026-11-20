import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

flow("kømeny: rediger uten tap eller ombytting, slett og flytt vedlegg til usendt sideutkast", async (h) => {
  const { page } = h;
  await openProject(h);
  writeFileSync(path.join(h.projectDir, "notat.txt"), "et lokalt vedlegg");
  await send(page, "lag en side");
  await page.getByTestId("approval-dock").waitFor();
  const id = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  const first = await h.api("POST", `/api/threads/${id}/messages`, { text: "første i kø", attachments: [{ kind: "file", path: "notat.txt" }] });
  const second = await h.api("POST", `/api/threads/${id}/messages`, { text: "andre i kø" });
  const queue = page.getByTestId("queue");
  const row = (messageId: string) => queue.locator(`.queue-entry[data-message-id="${messageId}"]`);
  await row(first.messageId).getByText("første i kø", { exact: false }).waitFor();
  await row(first.messageId).getByRole("button", { name: /^Valg for kømeldingen/ }).click();
  await page.getByRole("menuitem", { name: "Rediger melding", exact: true }).click();
  await page.getByRole("textbox", { name: "Rediger kømelding", exact: true }).fill("første er redigert");
  await page.getByRole("button", { name: "Lagre melding", exact: true }).click();
  await row(first.messageId).getByText("første er redigert", { exact: false }).waitFor();
  assert.deepEqual(await queue.locator(".queue-entry").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-message-id"))), [first.messageId, second.messageId]);
  assert.equal((await h.api("GET", `/api/threads/${id}/queue`)).items[0].attachments[0].path, "notat.txt");

  // An unsuccessful edit retains the entered text and the queued original.
  const editUrl = `**/api/threads/${id}/queue/${first.messageId}`;
  h.allow(/status of 503/);
  await page.route(editUrl, (route) => route.request().method() === "PATCH" && route.request().postDataJSON().text
    ? route.fulfill({ status: 503, json: { error: "Køredigering kunne ikke lagres" } }) : route.continue());
  await row(first.messageId).getByRole("button", { name: /^Valg for kømeldingen/ }).click();
  await page.getByRole("menuitem", { name: "Rediger melding", exact: true }).click();
  await page.getByRole("textbox", { name: "Rediger kømelding", exact: true }).fill("usikret endring");
  await page.getByRole("button", { name: "Lagre melding", exact: true }).click();
  await page.getByText("Køredigering kunne ikke lagres", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Rediger kømelding", exact: true }).inputValue(), "usikret endring");
  await row(first.messageId).getByText("første er redigert", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await page.unroute(editUrl);

  await row(second.messageId).getByRole("button", { name: /^Valg for kømeldingen/ }).click();
  await page.getByRole("menu", { name: "Kømelding", exact: true }).waitFor();
  await h.api("DELETE", `/api/threads/${id}/queue/${second.messageId}`);
  await row(second.messageId).waitFor({ state: "detached" });
  await page.getByRole("menu", { name: "Kømelding", exact: true }).waitFor({ state: "detached" });
  await row(first.messageId).getByRole("button", { name: /^Valg for kømeldingen/ }).click();
  await page.getByRole("menuitem", { name: "Slå av kø", exact: true }).click();
  await row(first.messageId).locator(".queue-item.steer").waitFor();
  await h.reload();
  await row(first.messageId).locator(".queue-item.steer").waitFor();
  await page.getByTestId("busy-switch").getByRole("button", { name: "Legg i kø", exact: true }).click();
  await waitFor(async () => !(await h.api("GET", `/api/threads/${id}/queue`)).items[0].steer, "køvalget er tilbake");
  const main = page.locator(`.pane-inner[data-thread-id="${id}"]`);
  await main.getByRole("textbox", { name: "Melding", exact: true }).fill("behold hovedkladden");
  await row(first.messageId).getByRole("button", { name: /^Valg for kømeldingen/ }).click();
  await page.getByRole("menuitem", { name: "Flytt til sidesamtale", exact: true }).click();
  await row(first.messageId).waitFor({ state: "detached" });
  const moved = (await h.api("GET", "/api/bootstrap")).threads.find((thread: any) => thread.parentThreadId === id && thread.origin === "user");
  assert.ok(moved);
  const side = page.locator(`.pane-inner[data-thread-id="${moved.id}"]`);
  await waitFor(async () => await side.getByRole("textbox", { name: "Melding", exact: true }).inputValue() === "første er redigert", "teksten står i sideutkastet");
  await side.locator(".chips").getByText("notat.txt", { exact: false }).waitFor();
  assert.equal(await main.getByRole("textbox", { name: "Melding", exact: true }).inputValue(), "behold hovedkladden");
  assert.deepEqual(await h.events(moved.id), [], "flytting sender ingen modellforespørsel");
  const away = await h.createThread(moved.projectId);
  await threadItem(page, away.id).locator(".thread-text").click();
  await side.waitFor({ state: "detached" });
  await threadItem(page, moved.id).locator(".thread-text").click();
  await waitFor(async () => await side.getByRole("textbox", { name: "Melding", exact: true }).inputValue() === "første er redigert", "lokal tekst overlever trådbytte");
  await side.locator(".chips").getByText("notat.txt", { exact: false }).waitFor();
  await h.reload();
  await threadItem(page, moved.id).locator(".thread-text").click();
  await waitFor(async () => await side.getByRole("textbox", { name: "Melding", exact: true }).inputValue() === "første er redigert", "serverutkastet overlever sidelast");
  await side.locator(".chips").getByText("notat.txt", { exact: false }).waitFor();
  assert.deepEqual(await h.events(moved.id), []);
  await side.getByRole("button", { name: "Fjern vedlegg", exact: true }).click();
  await threadItem(page, away.id).locator(".thread-text").click();
  await side.waitFor({ state: "detached" });
  await threadItem(page, moved.id).locator(".thread-text").click();
  await side.getByRole("textbox", { name: "Melding", exact: true }).waitFor();
  assert.equal(await side.locator(".chips .chip").count(), 0, "bevisst fjernet vedlegg kommer ikke tilbake ved trådbytte");
});

flow("køflytting gjenopprettes etter mistet HTTP-svar uten dublett eller automatisk sending", async (h) => {
  const { page } = h;
  await openProject(h);
  await send(page, "lag en side");
  await page.getByTestId("approval-dock").waitFor();
  const source = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  const queued = await h.api("POST", `/api/threads/${source}/messages`, { text: "gjenopprett dette utkastet" });
  const url = `**/api/threads/${source}/queue/${queued.messageId}/side-draft`;
  h.allow(/net::ERR_FAILED|Failed to fetch/);
  await page.route(url, async (route) => {
    await route.fetch(); // The server commits the move, but the client never receives its response.
    await route.abort("failed");
  });
  await page.getByTestId("queue").getByRole("button", { name: /^Valg for kømeldingen/ }).click();
  await page.getByRole("menuitem", { name: "Flytt til sidesamtale", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((thread: any) => thread.parentThreadId === source && thread.origin === "user"), "serveren opprettet utkastet");
  const side = (await h.api("GET", "/api/bootstrap")).threads.find((thread: any) => thread.parentThreadId === source && thread.origin === "user");
  await page.unroute(url);
  await threadItem(page, side.id).locator(".thread-text").click();
  const field = page.locator(`.pane-inner[data-thread-id="${side.id}"]`).getByRole("textbox", { name: "Melding", exact: true });
  await waitFor(async () => await field.inputValue() === "gjenopprett dette utkastet", "utkastet hentes uten opprinnelig HTTP-svar");
  await h.reload();
  await threadItem(page, side.id).locator(".thread-text").click();
  await waitFor(async () => await field.inputValue() === "gjenopprett dette utkastet", "utkastet dupliseres ikke ved sidelast");
  assert.deepEqual(await h.events(side.id), []);
  // A recovery response captured before typing must not resurrect the old draft after Send.
  let release!: () => void;
  let markReady!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  const draftUrl = `**/api/threads/${side.id}/queued-draft`;
  await page.route(draftUrl, async (route) => {
    const response = await route.fetch();
    markReady();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await h.reload();
    await threadItem(page, side.id).locator(".thread-text").click();
    await ready;
    await field.fill("hei");
    await field.press("Enter");
    await waitFor(async () => (await h.api("GET", `/api/threads/${side.id}/queued-draft?verify=1`)).draft === null, "akseptert sending fjerner gjenopprettingskopien");
    const lateResponse = page.waitForResponse((response) => response.url().endsWith(`/api/threads/${side.id}/queued-draft`));
    release();
    await lateResponse;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    assert.equal(await field.inputValue(), "", "sent gjenopprettingssvar gjenoppliver ikke den allerede sendte kladden");
  } finally {
    release();
    await page.unroute(draftUrl);
  }
});

flow("sendt sideutkast i ett vindu gjenopplives ikke av gammelt draft-svar i et annet", async (h) => {
  const { page, context } = h;
  await openProject(h);
  await send(page, "lag en side");
  await page.getByTestId("approval-dock").waitFor();
  const source = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  const queued = await h.api("POST", `/api/threads/${source}/messages`, { text: "gammelt sideutkast" });
  const moved = await h.api("POST", `/api/threads/${source}/queue/${queued.messageId}/side-draft`, {});
  const other = await context.newPage();
  let release!: () => void;
  let markReady!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  await other.route(`**/api/threads/${moved.thread.id}/queued-draft`, async (route) => {
    const response = await route.fetch();
    markReady();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await other.goto(h.origin);
    await other.locator(".app").waitFor();
    await threadItem(other, moved.thread.id).locator(".thread-text").click();
    await ready;
    await h.api("POST", `/api/threads/${moved.thread.id}/messages`, { text: "hei fra annet vindu" });
    await other.locator(".user-text", { hasText: "hei fra annet vindu" }).waitFor();
    const late = other.waitForResponse((response) => response.url().endsWith(`/api/threads/${moved.thread.id}/queued-draft`));
    release();
    await late;
    await other.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const field = other.locator(`.pane-inner[data-thread-id="${moved.thread.id}"]`).getByRole("textbox", { name: "Melding", exact: true });
    assert.equal(await field.inputValue(), "", "meldingshendelsen fra det andre vinduet ugyldiggjør gammelt gjenopprettingssvar");
    assert.equal((await h.api("GET", `/api/threads/${moved.thread.id}/queued-draft`)).draft, null);
  } finally {
    release();
    await other.close();
  }
});
