import assert from "node:assert/strict";
import { flow, threadItem, waitFor } from "./harness.ts";

flow("modellvelgeren: søk på leverandør, avhuking og fokus tilbake til modellpillen", async (h) => {
  const { page } = h;
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "OpenRouter test", baseUrl: "http://127.0.0.1:9/v1" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Beta stor", model: "beta-stor", contextWindow: 100000 });
  const button = page.getByTestId("model-button");
  assert.equal(await button.locator(".provider-glyph").count(), 0, "Chat viser modellnavnet uten leverandørmerke");
  await button.focus();
  await page.keyboard.press("ArrowDown");
  const search = page.getByRole("combobox", { name: "Søk etter modeller" });
  await waitFor(() => search.evaluate((element) => element === document.activeElement), "søkefeltet får fokus");
  const list = page.getByRole("listbox", { name: "Modeller" });
  await list.getByRole("group", { name: provider.name }).waitFor();
  await search.fill("openrouter beta");
  await waitFor(async () => (await list.getByRole("option").count()) === 1, "leverandør og modell filtreres sammen");
  await search.press("Enter");
  await list.waitFor({ state: "detached" });
  assert.equal(await button.evaluate((element) => element === document.activeElement), true);
  await button.getByText(model.name, { exact: true }).waitFor();
  await button.click();
  const chosen = list.getByRole("option", { selected: true });
  assert.equal(await chosen.count(), 1);
  assert.equal(await chosen.innerText(), model.name);
  assert.equal(await chosen.locator(".menu-check svg").count(), 1);
  await page.keyboard.press("Escape");
  await list.waitFor({ state: "detached" });
  assert.equal(await button.evaluate((element) => element === document.activeElement), true);
});

flow("modell og innsats: menyene holder seg ved knappen gjennom filtrering, smalt vindu og nivåvalg", async (h) => {
  const { page } = h;
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal liste", baseUrl: "http://127.0.0.1:9/v1" });
  for (let index = 0; index < 18; index++) {
    await h.api("POST", "/api/models", { providerId: provider.id, name: `Modell ${index}`, model: `modell-${index}`, contextWindow: 100000 });
  }
  const button = page.getByTestId("model-button");
  await button.click();
  const popup = page.locator(".popover:has(.model-menu)");
  const search = page.getByRole("combobox", { name: "Søk etter modeller" });
  await popup.waitFor();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  assert.equal(await popup.evaluate((element) => element.closest(".pane") === null), true, "menyen slipper ut av rutens contain:strict");
  const before = (await popup.boundingBox())!;
  const trigger = (await button.boundingBox())!;
  assert.ok(Math.abs(before.y + before.height + 6 - trigger.y) < 1, "menyen er forankret over knappen");
  assert.equal(await page.locator(".model-list").evaluate((element) => element.scrollHeight > element.clientHeight), true);
  await search.fill("Modell 17");
  await waitFor(async () => (await page.getByRole("option").count()) === 1, "filtrert til én modell");
  const filtered = (await popup.boundingBox())!;
  assert.ok(Math.abs(filtered.x - before.x) < 1);
  assert.ok(Math.abs(filtered.y + filtered.height - before.y - before.height) < 1, "filtrering beholder forankringen");
  await search.fill("");
  await page.setViewportSize({ width: 540, height: 600 });
  await waitFor(async () => {
    const box = (await popup.boundingBox())!;
    const anchor = (await button.boundingBox())!;
    return box.x >= 7 && box.y >= 7 && box.x + box.width <= 533 && box.y + box.height <= anchor.y - 5;
  }, "menyen følger knappen og holder seg i det smale vinduet");
  await page.keyboard.press("Escape");

  const effortButton = page.getByTestId("effort-button");
  await effortButton.focus();
  await page.keyboard.press("ArrowUp");
  const effort = page.getByTestId("effort-picker");
  const slider = page.getByRole("slider", { name: "Innsats", exact: true });
  await waitFor(() => slider.evaluate((element) => element === document.activeElement), "innsatsslideren får fokus");
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const effortBefore = (await effort.boundingBox())!;
  await slider.press("Home");
  await page.getByTestId("effort-name").getByText("Lav", { exact: true }).waitFor();
  await slider.press("End");
  await page.getByTestId("effort-name").getByText("Høy", { exact: true }).waitFor();
  const effortAfter = (await effort.boundingBox())!;
  assert.ok(Math.abs(effortBefore.x - effortAfter.x) < 1, "innsatsvalget flytter ikke popupen");
  await effort.getByRole("button", { name: /^Velg modell\./ }).click();
  await effort.waitFor({ state: "detached" });
  await waitFor(() => search.evaluate((element) => element === document.activeElement), "modellvelgeren får fokus fra innsatsvelgeren");
  await page.keyboard.press("Escape");
  assert.equal(await button.evaluate((element) => element === document.activeElement), true);
});

flow("innsats på eksisterende tråd: raske valg og nullstilling lagrer alltid siste ønske", async (h) => {
  const { page } = h;
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "OpenRouter innsats", baseUrl: "https://openrouter.ai/api/v1" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Innsatsmodell", model: "test-effort", contextWindow: 100000, thinking: true, effort: "medium" });
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { modelId: model.id, reasoning: "xhigh" });
  await h.reload();
  await threadItem(page, thread.id).locator(".thread-text").click();
  const button = page.getByTestId("effort-button");
  await button.getByText("Ekstra høy", { exact: true }).waitFor();
  await button.click();
  const slider = page.getByRole("slider", { name: "Innsats", exact: true });
  const label = page.getByTestId("effort-name");
  const requested: Array<string | null> = [];
  let release!: () => void;
  let blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/threads/${thread.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const value = route.request().postDataJSON().reasoning;
    if (value === undefined) return route.continue();
    requested.push(value);
    if (value === "max") await blocked;
    await route.continue();
  });
  const savedEffort = async () => (await h.api("GET", "/api/bootstrap")).threads.find((item: any) => item.id === thread.id).reasoning;
  try {
    await slider.press("End");
    await waitFor(() => requested.length === 1, "Maks-forespørselen holdes tilbake");
    await label.getByText("Maks", { exact: true }).waitFor();
    await slider.press("ArrowLeft");
    await label.getByText("Ekstra høy", { exact: true }).waitFor();
    assert.deepEqual(requested, ["max"], "nytt valg sendes etter forrige forespørsel");
    release();
    await waitFor(async () => requested.length === 2 && await savedEffort() === "xhigh", "returen til allerede lagret nivå blir sist lagret");
    assert.deepEqual(requested, ["max", "xhigh"]);
    await label.getByText("Ekstra høy", { exact: true }).waitFor();
    await button.getByText("Ekstra høy", { exact: true }).waitFor();

    blocked = new Promise<void>((resolve) => { release = resolve; });
    await slider.press("End");
    await waitFor(() => requested.length === 3, "andre Maks-forespørsel holdes tilbake");
    await page.getByRole("button", { name: "Tilbake til modellens standard", exact: true }).click();
    await label.getByText("Standard (middels)", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Tilbake til modellens standard", exact: true }).isDisabled(), true);
    release();
    await waitFor(async () => requested.length === 4 && await savedEffort() === null, "nullstilling kommer etter det eldre Maks-valget");
    assert.deepEqual(requested, ["max", "xhigh", "max", null]);
    await label.getByText("Standard (middels)", { exact: true }).waitFor();
  } finally {
    release();
    await page.unroute(`**/api/threads/${thread.id}`);
  }

  // Sending a message waits for the selected effort to reach the server. No provider is called.
  let messageCount = 0;
  let messageEffort: string | null | undefined;
  await page.route(`**/api/threads/${thread.id}/messages`, async (route) => {
    messageEffort = await savedEffort();
    messageCount++;
    await route.fulfill({ status: 204 });
  });
  blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/threads/${thread.id}`, async (route) => {
    if (route.request().method() === "PATCH" && route.request().postDataJSON().reasoning === "max") await blocked;
    await route.continue();
  });
  try {
    await slider.press("End");
    await label.getByText("Maks", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    const field = page.getByLabel("Melding", { exact: true });
    await field.fill("Melding etter innsatsvalg");
    await field.press("Enter");
    await waitFor(async () => await field.inputValue() === "", "send venter med ryddet felt");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(messageCount, 0, "ingen tur starter med et eldre innsatsnivå");
    release();
    await waitFor(() => messageCount === 1, "meldingen sendes etter lagret innsats");
    assert.equal(messageEffort, "max");
  } finally {
    release();
    await page.unroute(`**/api/threads/${thread.id}`);
  }

  await button.click();
  await page.getByRole("button", { name: "Tilbake til modellens standard", exact: true }).click();
  await waitFor(async () => await savedEffort() === null, "standard er lagret før feilprøven");
  h.allow(/status of 503/);
  let releaseError!: () => void;
  const errorGate = new Promise<void>((resolve) => { releaseError = resolve; });
  await page.route(`**/api/threads/${thread.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await errorGate;
    await route.fulfill({ status: 503, json: { error: "Innsats kunne ikke lagres" } });
  });
  try {
    await slider.press("Home");
    await page.keyboard.press("Escape");
    const field = page.getByLabel("Melding", { exact: true });
    await field.fill("Utkast ved lagrefeil");
    await field.press("Enter");
    await waitFor(async () => await field.inputValue() === "", "send venter på innsatslagring");
    releaseError();
    await page.getByText("Innsats kunne ikke lagres", { exact: true }).waitFor();
    await waitFor(async () => await field.inputValue() === "Utkast ved lagrefeil", "lagrefeil beholder usendt utkast");
    assert.equal(messageCount, 1, "meldingen ved lagrefeil ble ikke sendt");
    await button.click();
    await label.getByText("Standard (middels)", { exact: true }).waitFor();
    assert.equal(await savedEffort(), null, "lagrefeil viser serverens bekreftede standard");
  } finally {
    releaseError();
  }
});
