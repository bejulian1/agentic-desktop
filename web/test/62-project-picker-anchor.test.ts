import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, waitFor } from "./harness.ts";

flow("prosjektvelgeren følger toppknappen og prosjektbrikken hver for seg, med søk, tastatur og smalt vindu", async (h) => {
  const { page } = h;
  for (let index = 0; index < 14; index++) {
    const folder = path.join(h.home, `prosjekt-${index}`);
    mkdirSync(folder);
    await h.api("POST", "/api/projects", { name: `Prosjekt ${String(index).padStart(2, "0")}`, path: folder });
  }
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  const top = page.getByTestId("topbar-project-picker");
  const chip = page.locator(".pane-inner.focused").getByTestId("project-picker");
  const popup = page.locator(".popover:has(> .project-picker)");
  const picker = page.getByTestId("project-picker-menu");
  const search = picker.getByRole("combobox", { name: "Søk i prosjekter" });
  await top.getByText("Denne datamaskinen", { exact: true }).waitFor();
  const field = page.locator(".pane-inner.focused").getByLabel("Melding", { exact: true });
  await field.fill("Utkast fra aktiv rute");
  await top.focus();
  await top.press("ArrowDown");
  await waitFor(() => search.evaluate((element) => element === document.activeElement), "prosjektsøket har fokus");
  assert.equal(await chip.getAttribute("aria-expanded"), "false");
  assert.equal(await picker.count(), 1, "bare én prosjektvelger er åpen");
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const topBox = (await top.boundingBox())!;
  const menuBox = (await popup.boundingBox())!;
  assert.ok(Math.abs(menuBox.y - topBox.y - topBox.height - 6) < 1, "toppmenyen er forankret under toppknappen");
  assert.ok(Math.abs(menuBox.x - topBox.x) < 1, "toppmenyen starter ved toppknappen");
  assert.equal(await popup.evaluate((element) => element.closest(".pane") === null), true);
  assert.equal(await picker.locator(".picker-list").evaluate((element) => element.scrollHeight > element.clientHeight), true);
  await search.fill("Prosjekt 07");
  await waitFor(async () => await picker.getByRole("option").count() === 1, "filtrert til ett prosjekt");
  const filteredBox = (await popup.boundingBox())!;
  assert.ok(Math.abs(filteredBox.y - menuBox.y) < 1, "søk flytter ikke toppmenyen");
  await search.press("Enter");
  await picker.waitFor({ state: "detached" });
  await top.getByText("Prosjekt 07", { exact: true }).waitFor();
  await waitFor(async () => await field.inputValue() === "Utkast fra aktiv rute", "utkastet følger prosjektvalget");
  await top.click();
  await waitFor(() => search.evaluate((element) => element === document.activeElement), "toppmenyens søk har fokus før nytt triggerklikk");
  await top.click();
  await picker.waitFor({ state: "detached" });
  assert.equal(await top.evaluate((element) => element === document.activeElement), true, "andre klikk lukker toppmenyen med fokus på triggeren");
  await top.click();
  await search.fill("Prosjekt 07");
  await search.press("Enter");
  await picker.waitFor({ state: "detached" });
  assert.equal(await top.evaluate((element) => element === document.activeElement), true, "valg av samme prosjekt gir fokus tilbake");
  assert.equal(await field.inputValue(), "Utkast fra aktiv rute");
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await waitFor(async () => await field.inputValue() === "Utkast fra aktiv rute", "samme prosjektvalg bevarer utkastet etter navigasjon");

  await chip.click();
  await search.waitFor();
  assert.equal(await top.getAttribute("aria-expanded"), "false");
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const chipBox = (await chip.boundingBox())!;
  const composerBox = (await popup.boundingBox())!;
  assert.ok(Math.abs(composerBox.y + composerBox.height + 6 - chipBox.y) < 1, "prosjektbrikken åpner sin meny ved meldingsfeltet");
  await search.press("Escape");
  assert.equal(await chip.evaluate((element) => element === document.activeElement), true);
  await chip.click();
  await waitFor(() => search.evaluate((element) => element === document.activeElement), "prosjektbrikkens søk har fokus før nytt triggerklikk");
  await chip.click();
  await picker.waitFor({ state: "detached" });
  assert.equal(await chip.evaluate((element) => element === document.activeElement), true, "andre klikk lukker prosjektbrikkens meny");
  await top.click();
  await search.waitFor();
  await search.press("Escape");
  assert.equal(await top.evaluate((element) => element === document.activeElement), true);
  await top.click();
  await search.waitFor();
  await field.click();
  await picker.waitFor({ state: "detached" });
  assert.equal(await field.evaluate((element) => element === document.activeElement), true, "klikk utenfor beholder valgt fokus");
  await top.click();
  await search.waitFor();
  await waitFor(() => search.evaluate((element) => element === document.activeElement), "søkefeltet får fokus før Tab-navigasjon");
  // Chrome can give the scrollable list its own Tab stop. Leaving the whole picker closes it.
  for (let stop = 0; stop < 6 && await picker.count(); stop++) await page.keyboard.press("Tab");
  await picker.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest(".project-picker")), false);

  await top.click();
  await search.waitFor();
  await page.setViewportSize({ width: 900, height: 560 });
  await waitFor(async () => {
    const box = await popup.boundingBox();
    const anchor = await top.boundingBox();
    return !!box && !!anchor && box.x >= 7 && box.x + box.width <= 893 && box.y >= anchor.y + anchor.height && box.y + box.height <= 553;
  }, "toppmenyen følger knappen og holder seg i vinduet");
  await page.setViewportSize({ width: 540, height: 600 });
  await picker.waitFor({ state: "detached" });
  await chip.click();
  await search.waitFor();
  await waitFor(async () => {
    const box = (await popup.boundingBox())!;
    return box.x >= 7 && box.x + box.width <= 533 && box.y >= 7 && box.y + box.height <= 593;
  }, "prosjektbrikkens meny passer et smalt vindu");
  await search.press("Escape");
});

flow("toppens prosjektvelger lukkes ved ny aktiv rute og Innstillinger, og Nytt prosjekt bruker mappe- og tillitsflyten", async (h) => {
  const { page } = h;
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  const top = page.getByTestId("topbar-project-picker");
  const picker = page.getByTestId("project-picker-menu");
  await top.click();
  await picker.waitFor();
  await page.keyboard.press("Control+\\");
  await picker.waitFor({ state: "detached" });
  await waitFor(async () => await page.locator(".pane-inner").count() === 2, "en ny aktiv rute er åpnet");
  await top.click();
  await picker.waitFor();
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Tilbake til appen" }).waitFor();
  await picker.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  assert.equal(await picker.count(), 0, "menyen gjenåpnes ikke etter Innstillinger");

  const folder = path.join(h.home, "nytt-prosjekt-fra-toppen");
  mkdirSync(folder);
  let folderCalls = 0;
  await page.route("**/api/fs/pick-folder", (route) => {
    folderCalls++;
    return route.fulfill({ json: { path: folder } });
  });
  await top.click();
  await picker.getByRole("button", { name: "Nytt prosjekt", exact: true }).click();
  await picker.waitFor({ state: "detached" });
  const dialog = page.getByRole("dialog", { name: "Opprett prosjekt", exact: true });
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("Fra toppen");
  await dialog.getByRole("button", { name: "Legg til", exact: true }).click();
  await dialog.getByText(folder, { exact: true }).waitFor();
  assert.equal(folderCalls, 1, "den eksisterende systemmappevelgeren brukes");
  await dialog.getByRole("button", { name: "Opprett prosjekt", exact: true }).click();
  await page.getByRole("dialog", { name: "Stoler du på denne mappen?", exact: true }).getByRole("button", { name: "Stol på mappen", exact: true }).click();
  await top.getByText("Fra toppen", { exact: true }).waitFor();
  assert.equal(await picker.count(), 0);
});

flow("miljøknappen følger valgt prosjekt, viser ekte gren og åpner prosjektinnstillingene uten forsinkede grener fra forrige prosjekt", async (h) => {
  const { page } = h;
  assert.equal(await page.getByTestId("project-environment-button").count(), 0, "ingen prosjektmiljøknapp i Chat");
  const aFolder = path.join(h.home, "miljo-a");
  const bFolder = path.join(h.home, "miljo-b");
  const movedFolder = path.join(h.home, "miljo-flyttet");
  const finalFolder = path.join(h.home, "miljo-siste");
  for (const [folder, branch] of [[aFolder, "main"], [bFolder, "feature/ekte-gren"], [movedFolder, "flyttet"], [finalFolder, "feature/siste-gren"]]) {
    mkdirSync(path.join(folder, ".git"), { recursive: true });
    writeFileSync(path.join(folder, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
  }
  const a = await h.api("POST", "/api/projects", { name: "Miljø A", path: aFolder });
  const b = await h.api("POST", "/api/projects", { name: "Miljø B", path: bFolder });
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route(`**/api/projects/${a.id}/git`, async (route) => {
    requested = true;
    await delayed;
    await route.continue();
  });
  try {
    await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
    assert.equal(await page.getByTestId("project-environment-button").count(), 0, "ingen miljøknapp uten prosjekt");
    await page.locator(`.group[data-project="${a.name}"] .group-title`).first().click();
    const gear = page.locator(".pane-inner.focused").getByTestId("project-environment-button");
    const environment = page.getByTestId("project-environment-menu");
    await gear.focus();
    await gear.press("ArrowDown");
    await environment.getByText("Denne datamaskinen", { exact: true }).waitFor();
    await waitFor(() => Promise.resolve(requested), "grenlesingen for første prosjekt er holdt tilbake");
    await environment.getByTestId("project-environment-branch").getByText("Leser gren…", { exact: true }).waitFor();
    await waitFor(() => environment.evaluate((element) => element.contains(document.activeElement)), "miljømenyen har fokus før nytt tannhjulklikk");
    await gear.click();
    await environment.waitFor({ state: "detached" });
    assert.equal(await gear.evaluate((element) => element === document.activeElement), true, "andre tannhjulklikk lukker miljømenyen");
    await gear.click();
    await environment.waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await gear.evaluate((element) => element === document.activeElement), true);

    await page.getByTestId("topbar-project-picker").click();
    await page.getByTestId("project-picker-menu").getByRole("combobox", { name: "Søk i prosjekter" }).fill("Miljø B");
    await page.keyboard.press("Enter");
    await page.getByTestId("topbar-project-picker").getByText("Miljø B", { exact: true }).waitFor();
    await gear.click();
    await environment.getByTestId("project-environment-branch").getByText("feature/ekte-gren", { exact: true }).waitFor();
    const oldResponse = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${a.id}/git`));
    release();
    await oldResponse;
    assert.equal(await environment.getByTestId("project-environment-branch").textContent(), "feature/ekte-gren", "forsinket svar bytter ikke grenen i det valgte prosjektet");
    assert.equal(await environment.getByRole("switch").count(), 0, "ingen arbeidstre-bryter uten implementasjon");
    await environment.getByRole("button", { name: "Prosjektinnstillinger", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Rediger prosjekt", exact: true });
    await edit.getByRole("tab", { name: "Agent", selected: true }).waitFor();
    await edit.getByRole("button", { name: "Lukk", exact: true }).click();
    await gear.click();
    await environment.getByRole("button", { name: /Prosjektmappe/ }).click();
    await edit.getByRole("tab", { name: "Generelt", selected: true }).waitFor();
    await edit.getByText(bFolder, { exact: true }).waitFor();
    await edit.getByRole("button", { name: "Lukk", exact: true }).click();
    await gear.click();
    await page.keyboard.press("Control+,");
    await environment.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Tilbake til appen" }).click();
    assert.equal(await environment.count(), 0);
    assert.equal((await h.api("GET", `/api/projects/${b.id}/git`)).branch, "feature/ekte-gren");

    let releaseOldPath!: () => void;
    const delayedOldPath = new Promise<void>((resolve) => { releaseOldPath = resolve; });
    let capturedOldPath!: () => void;
    const oldPathCaptured = new Promise<void>((resolve) => { capturedOldPath = resolve; });
    let heldOldPath = false;
    await page.route(`**/api/projects/${b.id}/git`, async (route) => {
      // Capture the actual old HEAD before changing this same project's path a second time.
      const response = await route.fetch();
      if (heldOldPath || (await response.json()).branch !== "flyttet") return route.fulfill({ response });
      heldOldPath = true;
      capturedOldPath();
      await delayedOldPath;
      await route.fulfill({ response });
    });
    try {
      await page.route("**/api/fs/pick-folder", (route) => route.fulfill({ json: { path: movedFolder } }));
      await gear.click();
      await environment.getByRole("button", { name: /Prosjektmappe/ }).click();
      await edit.getByRole("button", { name: "Bytt mappe…", exact: true }).click();
      await edit.getByText(movedFolder, { exact: true }).waitFor();
      await edit.getByRole("button", { name: "Lukk", exact: true }).click();
      await gear.click();
      await oldPathCaptured;
      await environment.getByTestId("project-environment-branch").getByText("Leser gren…", { exact: true }).waitFor();
      assert.equal(await environment.getByRole("button", { name: /Prosjektmappe/ }).getAttribute("title"), movedFolder);
      const moved = (await h.api("GET", "/api/bootstrap")).projects.find((project: any) => project.id === b.id);
      assert.equal(moved.path, movedFolder, "mappebyttet beholder prosjektets ID");

      await h.api("PATCH", `/api/projects/${b.id}`, { path: finalFolder });
      await environment.getByTestId("project-environment-branch").getByText("feature/siste-gren", { exact: true }).waitFor();
      assert.equal(await environment.getByRole("button", { name: /Prosjektmappe/ }).getAttribute("title"), finalFolder);
      const staleResponse = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${b.id}/git`));
      releaseOldPath();
      await staleResponse;
      // A subsequent browser roundtrip lets the response's JSON handler finish before checking.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      assert.equal(await environment.getByTestId("project-environment-branch").textContent(), "feature/siste-gren", "forsinket Git-svar fra forrige mappe kan ikke overskrive den nye grenen");
      assert.equal((await h.api("GET", `/api/projects/${b.id}/git`)).branch, "feature/siste-gren");
    } finally {
      releaseOldPath();
    }
  } finally {
    release();
  }
});
