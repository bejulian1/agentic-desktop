import assert from "node:assert/strict";
import { flow, threadItem, waitFor } from "./harness.ts";

flow("Sending venter på bekreftet modell etter at tråden er åpnet på nytt", async (h) => {
  const { page } = h;
  const first = await h.createThread(null);
  const other = await h.createThread(null);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: "http://127.0.0.1:9/v1" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Valgt testmodell", model: "fake", contextWindow: 100000 });
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sentWith: string[] = [];
  let sends = 0;
  await page.route(`**/api/threads/${first.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    requested = true;
    await gate;
    await route.continue();
  });
  await page.route(`**/api/threads/${first.id}/messages`, async (route) => {
    sends++;
    const { threads } = await h.api("GET", "/api/bootstrap");
    sentWith.push(threads.find((thread: { id: string }) => thread.id === first.id).modelId);
    await route.fulfill({ json: { queued: false } });
  });
  const open = (id: string) => threadItem(page, id).locator(".thread-text").click();
  try {
    await open(first.id);
    await page.getByTestId("model-button").click();
    await page.getByRole("option", { name: model.name, exact: true }).click();
    await waitFor(() => requested, "modellagringen venter");
    await open(other.id);
    await page.locator(`[data-thread-id="${other.id}"] textarea`).waitFor();
    await open(first.id);
    const field = page.locator(`[data-thread-id="${first.id}"] textarea`);
    await field.fill("Bruk den valgte modellen");
    await field.press("Enter");
    await waitFor(async () => await field.inputValue() === "", "sendingen tok imot utkastet");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(sends, 0, "meldingen sendes ikke til forrige modell");
    assert.equal(await page.getByTestId("model-button").innerText(), model.name);
    release();
    await waitFor(() => sentWith.length > 0, "meldingen sendes etter lagring");
    assert.deepEqual(sentWith, [model.id]);
  } finally {
    release();
  }
});

flow("Et mislykket modellvalg sender ikke meldingen til forrige modell", async (h) => {
  const { page } = h;
  const thread = await h.createThread(null);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: "http://127.0.0.1:9/v1" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Ny testmodell", model: "fake", contextWindow: 100000 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let sends = 0;
  h.allow(/status of 503/);
  await page.route(`**/api/threads/${thread.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await gate;
    await route.fulfill({ status: 503, json: { error: "Test: modellen kunne ikke lagres" } });
  });
  await page.route(`**/api/threads/${thread.id}/messages`, (route) => {
    sends++;
    return route.fulfill({ json: { queued: false } });
  });
  try {
    await threadItem(page, thread.id).locator(".thread-text").click();
    await page.getByTestId("model-button").click();
    await page.getByRole("option", { name: model.name, exact: true }).click();
    const field = page.locator(`[data-thread-id="${thread.id}"] textarea`);
    await field.fill("Ikke send hvis modellvalget feiler");
    await field.press("Enter");
    await waitFor(async () => await field.inputValue() === "", "sendingen venter på modellagringen");
    release();
    await page.getByText("Test: modellen kunne ikke lagres", { exact: true }).waitFor();
    await waitFor(async () => await field.inputValue() === "Ikke send hvis modellvalget feiler", "usendt utkast gjenopprettes");
    assert.equal(sends, 0);
  } finally {
    release();
  }
});

flow("En forsinket sendefeil gjenoppretter tekst og vedlegg bare i avsendertråden", async (h) => {
  const { page } = h;
  const first = await h.createThread(null);
  const other = await h.createThread(null);
  const open = (id: string) => threadItem(page, id).locator(".thread-text").click();
  const field = (id: string) => page.locator(`[data-thread-id="${id}"] textarea`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  h.allow(/status of 503/);
  await page.route(`**/api/threads/${first.id}/messages`, async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ status: 503, json: { error: "Test: meldingen kunne ikke sendes" } });
  });
  try {
    await open(other.id);
    await field(other.id).fill("Det andre utkastet");
    await open(first.id);
    await field(first.id).fill("Meldingen som feiler");
    await page.getByTestId("text-file-input").setInputFiles({ name: "avsender.txt", mimeType: "text/plain", buffer: Buffer.from("For avsendertråden") });
    await page.getByTestId("attachment-strip").getByText("avsender.txt", { exact: true }).waitFor();
    await field(first.id).press("Enter");
    await waitFor(() => requested, "sendingen venter");
    await field(first.id).fill("Ny tekst i avsendertråden");
    await open(other.id);
    assert.equal(await field(other.id).inputValue(), "Det andre utkastet");
    release();
    await page.getByText("Test: meldingen kunne ikke sendes", { exact: true }).waitFor();
    assert.equal(await field(other.id).inputValue(), "Det andre utkastet");
    assert.equal(await page.getByTestId("attachment-strip").count(), 0);
    await open(first.id);
    assert.equal(await field(first.id).inputValue(), "Ny tekst i avsendertråden\n\nMeldingen som feiler");
    await page.getByTestId("attachment-strip").getByText("avsender.txt", { exact: true }).waitFor();
    await open(other.id);
    assert.equal(await field(other.id).inputValue(), "Det andre utkastet");
  } finally {
    release();
  }
});
