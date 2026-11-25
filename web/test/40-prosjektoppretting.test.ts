import assert from "node:assert/strict";
import type { Locator, Page, Route } from "playwright-core";
import { flow, PROJECT_CRUMB, type Harness, useFolderPickerFallback, waitFor } from "./harness.ts";

const creationDialog = (page: Page) => page.getByRole("dialog", { name: "Opprett prosjekt", exact: true });
const trustDialog = (page: Page) => page.getByRole("dialog", { name: "Stoler du på denne mappen?", exact: true });

async function openCreation(h: Harness): Promise<Locator> {
  const { page } = h;
  const code = page.locator(".sidebar .mode-button", { hasText: "Kode" });
  if ((await code.getAttribute("aria-pressed")) !== "true") await code.click();
  await page.getByTestId("project-picker").click();
  await page.getByRole("dialog", { name: "Velg prosjekt", exact: true }).getByRole("button", { name: "Nytt prosjekt", exact: true }).click();
  const dialog = creationDialog(page);
  await dialog.waitFor();
  return dialog;
}

async function selectFolder(h: Harness, dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Legg til", exact: true }).click();
  await dialog.getByText(h.projectDir, { exact: true }).waitFor();
}

async function requestTrust(page: Page, dialog: Locator): Promise<Locator> {
  await dialog.getByRole("button", { name: "Opprett prosjekt", exact: true }).click();
  const trust = trustDialog(page);
  await trust.waitFor();
  return trust;
}

flow("opprett prosjekt: navn og kildemappe, avbrutt mappevalg og tillit før lagring", async (h) => {
  const { page } = h;
  const picks: unknown[] = [];
  let cancelPick = false;
  await page.route("**/api/fs/pick-folder", (route) => {
    assert.equal(route.request().method(), "POST");
    picks.push(route.request().postDataJSON());
    return route.fulfill({ json: { path: cancelPick ? null : h.projectDir } });
  });
  const created: unknown[] = [];
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "POST") created.push(route.request().postDataJSON());
    return route.continue();
  });

  const dialog = await openCreation(h);
  assert.equal(await dialog.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "");
  await dialog.getByText("Kildemappe", { exact: true }).waitFor();
  const create = dialog.getByRole("button", { name: "Opprett prosjekt", exact: true });
  assert.equal(await create.isDisabled(), true, "tomt utkast kan ikke opprettes");
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("  Min kalkulator  ");
  assert.equal(await create.isDisabled(), true, "navn alene er ikke nok");
  await selectFolder(h, dialog);
  assert.equal(picks.length, 1, "Legg til bruker systemmappevelgerens API");
  assert.equal(await page.getByRole("dialog", { name: "Velg mappe", exact: true }).count(), 0);
  assert.equal(await create.isDisabled(), false);
  assert.deepEqual(created, [], "mappevalg oppretter ikke prosjektet");

  cancelPick = true;
  await dialog.getByRole("button", { name: "Endre mappe", exact: true }).click();
  await waitFor(async () => picks.length === 2 && !(await dialog.getByRole("button", { name: "Endre mappe", exact: true }).isDisabled()), "mappevalget er avbrutt");
  await dialog.getByText(h.projectDir, { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "  Min kalkulator  ");

  let trust = await requestTrust(page, dialog);
  await trust.getByText(h.projectDir, { exact: true }).waitFor();
  assert.deepEqual(created, [], "ingen POST før eksplisitt tillit");
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0);
  await trust.getByRole("button", { name: "Avbryt", exact: true }).click();
  await trust.waitFor({ state: "detached" });
  assert.equal(await dialog.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "  Min kalkulator  ");
  await dialog.getByText(h.projectDir, { exact: true }).waitFor();
  assert.deepEqual(created, [], "avbrutt tillit lagrer ingenting");

  trust = await requestTrust(page, dialog);
  await trust.getByRole("button", { name: "Stol på mappen", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(created, [{ name: "Min kalkulator", path: h.projectDir }]);
  const projects = (await h.api("GET", "/api/bootstrap")).projects;
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "Min kalkulator");
  assert.equal(projects[0].path, h.projectDir);
  await page.locator('.group[data-project="Min kalkulator"]').waitFor();
  await page.locator(PROJECT_CRUMB, { hasText: "Min kalkulator" }).first().waitFor();
});

flow("opprett prosjekt: avbrutt og fjernet kildemappe, Escape beholder tillitsutkast og lukker oppretting", async (h) => {
  const { page } = h;
  let selected: string | null = null;
  let picks = 0;
  await page.route("**/api/fs/pick-folder", (route) => {
    picks += 1;
    return route.fulfill({ json: { path: selected } });
  });
  const dialog = await openCreation(h);
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("Behold utkastet");
  await dialog.getByRole("button", { name: "Legg til", exact: true }).click();
  await waitFor(async () => picks === 1 && !(await dialog.getByRole("button", { name: "Legg til", exact: true }).isDisabled()), "tomt mappevalg er avbrutt");
  assert.equal(await dialog.getByRole("button", { name: "Opprett prosjekt", exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "Behold utkastet");

  selected = h.projectDir;
  await selectFolder(h, dialog);
  await dialog.getByRole("button", { name: "Fjern mappe", exact: true }).click();
  assert.equal(await dialog.getByText(h.projectDir, { exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "Opprett prosjekt", exact: true }).isDisabled(), true);
  await selectFolder(h, dialog);
  const trust = await requestTrust(page, dialog);
  await page.keyboard.press("Escape");
  await trust.waitFor({ state: "detached" });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "Behold utkastet");
  await dialog.getByText(h.projectDir, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0);
  const reopened = await openCreation(h);
  assert.equal(await reopened.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "", "ny åpning starter et nytt utkast");
  assert.equal(await reopened.getByText(h.projectDir, { exact: true }).count(), 0);
});

flow("opprett prosjekt: feil i mappevalg og lagring kan prøves på nytt med samme utkast", async (h) => {
  const { page } = h;
  h.allow(/status of 500/);
  let pickerFails = true;
  await page.route("**/api/fs/pick-folder", (route) => pickerFails
    ? route.fulfill({ status: 500, json: { error: "Mappevelgeren kunne ikke åpnes" } })
    : route.fulfill({ json: { path: h.projectDir } }));
  let projectFails = true;
  await page.route("**/api/projects", (route) => route.request().method() === "POST" && projectFails
    ? route.fulfill({ status: 500, json: { error: "Prosjektet kunne ikke lagres" } })
    : route.continue());

  const dialog = await openCreation(h);
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("Prøv igjen");
  await dialog.getByRole("button", { name: "Legg til", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Mappevelgeren kunne ikke åpnes" }).waitFor();
  assert.equal(await dialog.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "Prøv igjen");
  pickerFails = false;
  await selectFolder(h, dialog);
  let trust = await requestTrust(page, dialog);
  await trust.getByRole("button", { name: "Stol på mappen", exact: true }).click();
  await trust.getByRole("alert").filter({ hasText: "Prosjektet kunne ikke lagres" }).waitFor();
  await trust.getByRole("button", { name: "Avbryt", exact: true }).click();
  await trust.waitFor({ state: "detached" });
  assert.equal(await dialog.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "Prøv igjen");
  await dialog.getByText(h.projectDir, { exact: true }).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0);
  projectFails = false;
  trust = await requestTrust(page, dialog);
  await trust.getByRole("button", { name: "Stol på mappen", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await h.api("GET", "/api/bootstrap")).projects[0].name, "Prøv igjen");
});

flow("opprett prosjekt: sent svar fra mappevelgeren endrer ikke et nytt utkast", async (h) => {
  const { page } = h;
  let pending!: Route;
  await page.route("**/api/fs/pick-folder", (route) => { pending = route; });
  const dialog = await openCreation(h);
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("Gammelt utkast");
  await dialog.getByRole("button", { name: "Legg til", exact: true }).click();
  await waitFor(() => !!pending, "systemmappevalget venter");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  const reopened = await openCreation(h);
  await reopened.getByLabel("Prosjektnavn", { exact: true }).fill("Nytt utkast");
  const response = page.waitForResponse("**/api/fs/pick-folder");
  await pending.fulfill({ json: { path: h.projectDir } });
  await response;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(await reopened.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "Nytt utkast");
  assert.equal(await reopened.getByText(h.projectDir, { exact: true }).count(), 0, "gammelt mappevalg er forkastet");
  assert.equal(await reopened.getByRole("button", { name: "Opprett prosjekt", exact: true }).isDisabled(), true);
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0);
});

flow("opprett prosjekt: uten systemmappevelger virker tilbakefallet inne i appen", async (h) => {
  const { page } = h;
  await useFolderPickerFallback(h);
  const dialog = await openCreation(h);
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("Med tilbakefall");
  await dialog.getByRole("button", { name: "Legg til", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Velg mappe", exact: true });
  await picker.getByLabel("Sti", { exact: true }).fill(h.projectDir);
  await picker.getByRole("button", { name: "Velg denne mappen", exact: true }).click();
  await dialog.getByText(h.projectDir, { exact: true }).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0);
  const trust = await requestTrust(page, dialog);
  await trust.getByRole("button", { name: "Stol på mappen", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await h.api("GET", "/api/bootstrap")).projects[0].name, "Med tilbakefall");
});

flow("opprett prosjekt: Electron bruker broens mappevelger før nettleserens API", async (h) => {
  const { page } = h;
  await page.addInitScript((folder) => {
    (window as any).__folderPicks = [];
    (window as any).agenticDesktop = {
      shell: "electron",
      window: { minimize() {}, toggleMaximize() {}, close() {}, state: async () => null, onState: () => () => {} },
      closeBehavior: async () => null,
      reportActivity() {},
      onCommand: () => () => {},
      pickFolder: async (start?: string, title?: string) => {
        (window as any).__folderPicks.push({ start, title });
        return folder;
      },
    };
  }, h.projectDir);
  let browserPicks = 0;
  await page.route("**/api/fs/pick-folder", (route) => {
    browserPicks += 1;
    return route.fulfill({ json: { path: null } });
  });
  await h.reload();
  const dialog = await openCreation(h);
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("Fra Electron");
  await selectFolder(h, dialog);
  assert.equal(await page.evaluate(() => (window as any).__folderPicks.length), 1);
  assert.equal(browserPicks, 0, "Electron bruker den smale native broen");
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});
