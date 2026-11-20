import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import type { PermissionMode } from "../../shared/protocol.ts";
import { approveUntil, flow, type Harness, openProject, pane, send, threadItem, waitFor } from "./harness.ts";

const LABELS: Record<PermissionMode, string> = {
  ask: "Be om godkjenning",
  "accept-edits": "Godkjenn for meg",
  full: "Full tilgang",
};
const menu = (page: Page) => page.getByRole("menu", { name: "Tillatelser", exact: true });
const row = (page: Page, mode: PermissionMode) => menu(page).getByRole("menuitemradio").filter({ has: page.locator(".menu-name", { hasText: new RegExp(`^${LABELS[mode]}$`) }) });

async function choose(h: Harness, mode: PermissionMode): Promise<void> {
  await h.page.getByTestId("permission-button").click();
  await row(h.page, mode).click();
  await menu(h.page).waitFor({ state: "detached" });
  await waitFor(async () => (await h.page.getByTestId("permission-button").getAttribute("data-mode")) === mode, `${mode} vises i feltet`);
}

async function storedMode(h: Harness, projectId: string): Promise<PermissionMode> {
  return (await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.id === projectId).permissionMode;
}

flow("tillatelser uten prosjekt: ny standard lagres, synkroniseres med Generelt og bevarer eksisterende prosjekt", async (h) => {
  const { page } = h;
  const existing = await h.createProject("Eksisterende");
  assert.equal(await page.getByTestId("permission-button").count(), 0, "Chat har ikke prosjektets tillatelsesvalg");
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  const button = page.getByTestId("permission-button");
  await button.waitFor();
  assert.equal(await button.isDisabled(), false);
  await choose(h, "full");
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.defaultPermissionMode, "full");
  assert.equal(await storedMode(h, existing.id), "ask");
  await h.reload();
  await button.getByText(LABELS.full, { exact: true }).waitFor();
  await button.click();
  assert.match(await menu(page).innerText(), /nye prosjekter/);
  assert.match(await menu(page).innerText(), /ikke tilgang til filer eller kommandoer/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await page.locator(".settings-nav").getByRole("button", { name: "Generelt", exact: true }).click();
  const modes = page.getByRole("radiogroup", { name: "Standardtillatelser i Kode" });
  assert.equal(await modes.getByRole("radio", { name: /^Full tilgang/ }).isChecked(), true);
  await modes.getByRole("radio", { name: /^Godkjenn for meg/ }).check();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.defaultPermissionMode === "accept-edits", "standard lagres i Generelt");
  await page.getByRole("button", { name: "Tilbake til appen", exact: true }).click();
  await button.getByText(LABELS["accept-edits"], { exact: true }).waitFor();
  const newProject = await h.api("POST", "/api/projects", { name: "Ny standard", path: h.home });
  assert.equal(newProject.permissionMode, "accept-edits", "nye prosjekter får valgt standard");
  assert.equal(await storedMode(h, existing.id), "ask");
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  assert.equal(await button.count(), 0);
});

flow("tillatelser uten prosjekt: lagrefeil beholder valgt nivå og kan prøves igjen", async (h) => {
  const { page } = h;
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  h.allow(/status of 503/);
  let fail = true;
  await page.route("**/api/settings", (route) => fail && route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Test: standard kunne ikke lagres" } }) : route.continue());
  await page.getByTestId("permission-button").click();
  await row(page, "full").click();
  await page.getByText("Test: standard kunne ikke lagres", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("permission-button").getAttribute("data-mode"), "ask");
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.defaultPermissionMode, "ask");
  fail = false;
  if (await menu(page).count()) await page.keyboard.press("Escape");
  await choose(h, "full");
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.defaultPermissionMode, "full");
});

flow("tillatelser i feltet: utkast og eksisterende tråd lagrer prosjektet, ikke global standard", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const before = await h.api("GET", "/api/bootstrap");
  assert.equal(before.threads.length, 0, "valget virker før første melding");
  const patches: unknown[] = [];
  await page.route(`**/api/projects/${project.id}`, (route) => {
    if (route.request().method() === "PATCH") patches.push(route.request().postDataJSON());
    return route.continue();
  });
  await choose(h, "accept-edits");
  assert.equal(await storedMode(h, project.id), "accept-edits");
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, 0, "tillatelsesvalget lager ingen tråd");
  await h.reload();
  await page.getByTestId("permission-button").getByText(LABELS["accept-edits"], { exact: true }).waitFor();
  await page.getByTestId("permission-button").click();
  assert.equal(await row(page, "accept-edits").getAttribute("aria-checked"), "true");
  assert.equal(await menu(page).getByRole("menuitemradio", { checked: true }).count(), 1);
  await page.keyboard.press("Escape");

  const thread = await h.createThread(project.id);
  await threadItem(page, thread.id).click();
  await pane(page, thread.id).waitFor();
  await choose(h, "full");
  assert.equal(await storedMode(h, project.id), "full");
  await h.reload();
  await page.getByTestId("permission-button").getByText(LABELS.full, { exact: true }).waitFor();
  await choose(h, "ask");
  assert.equal(await storedMode(h, project.id), "ask");
  assert.deepEqual(patches, [{ permissionMode: "accept-edits" }, { permissionMode: "full" }, { permissionMode: "ask" }]);
  const after = await h.api("GET", "/api/bootstrap");
  assert.equal(after.settings.defaultPermissionMode, before.settings.defaultPermissionMode);
  assert.equal(after.threads.find((t: any) => t.id === thread.id).permissionCap, null);
});

flow("tillatelser i feltet: tydelige nivåer, vernede filer og Les mer", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.getByTestId("permission-button").click();
  assert.equal(await menu(page).getByRole("menuitemradio").count(), 3);
  for (const mode of Object.keys(LABELS) as PermissionMode[]) {
    await row(page, mode).getByText(LABELS[mode], { exact: true }).waitFor();
    assert.ok((await row(page, mode).locator(".menu-desc").innerText()).trim().length > 30, `${mode} forklares`);
  }
  assert.match(await row(page, "ask").innerText(), /spør|godkjenn/i);
  assert.match(await row(page, "accept-edits").innerText(), /rediger|fil/i);
  assert.match(await row(page, "accept-edits").innerText(), /kommando/i);
  const more = menu(page).getByRole("button", { name: "Les mer", exact: true });
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  await more.click();
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  assert.match(await menu(page).innerText(), /hele prosjektet/);
  assert.match(await menu(page).innerText(), /Lagrede godkjenninger/);
  assert.match(await menu(page).innerText(), /\.env/);
  assert.match(await menu(page).innerText(), /\.git\/hooks/);
  assert.equal(await menu(page).getByRole("menuitemradio").count(), 3, "forklaringen beholder valgene tilgjengelige");
});

flow("tillatelser i feltet: tastatur, Escape, fokus og klikk utenfor", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const button = page.getByTestId("permission-button");
  await button.focus();
  await page.keyboard.press("Enter");
  await waitFor(() => row(page, "ask").evaluate((el) => el === document.activeElement), "valgt nivå får fokus");
  await page.keyboard.press("ArrowDown");
  assert.equal(await row(page, "accept-edits").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("End");
  assert.equal(await row(page, "full").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Home");
  assert.equal(await row(page, "ask").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Escape");
  await menu(page).waitFor({ state: "detached" });
  assert.equal(await button.evaluate((el) => el === document.activeElement), true);
  assert.equal(await storedMode(h, project.id), "ask", "navigering endrer ikke tillatelser");
  await page.keyboard.press("Space");
  await menu(page).waitFor();
  await page.mouse.click(8, 8);
  await menu(page).waitFor({ state: "detached" });
  await button.focus();
  await page.keyboard.press("Enter");
  await waitFor(() => row(page, "ask").evaluate((el) => el === document.activeElement), "menyen har flyttet fokus før neste tast");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await waitFor(async () => (await storedMode(h, project.id)) === "accept-edits", "Enter velger fokusert nivå");
  assert.equal(await button.evaluate((el) => el === document.activeElement), true);
});

flow("tillatelser i feltet: mislykket lagring beholder nivået og kan prøves igjen", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  h.allow(/status of 503/);
  let fail = true;
  await page.route(`**/api/projects/${project.id}`, (route) => {
    if (route.request().method() === "PATCH" && fail) return route.fulfill({ status: 503, json: { error: "Kunne ikke lagre tillatelser i testen" } });
    return route.continue();
  });
  await page.getByTestId("permission-button").click();
  await row(page, "full").click();
  await page.getByText("Kunne ikke lagre tillatelser i testen", { exact: true }).waitFor();
  assert.equal(await storedMode(h, project.id), "ask");
  assert.equal(await page.getByTestId("permission-button").getAttribute("data-mode"), "ask");
  fail = false;
  if (await menu(page).count()) await page.keyboard.press("Escape");
  await choose(h, "full");
  assert.equal(await storedMode(h, project.id), "full");
});

flow("tillatelser i feltet: Full tilgang ber fortsatt om godkjenning for vernede filer", async (h) => {
  const { page } = h;
  await openProject(h);
  await choose(h, "full");
  await send(page, "godkjenning");
  const approval = page.locator(".approval-card");
  await approval.waitFor();
  assert.match(await approval.innerText(), /\.env\.demo/);
  assert.equal(existsSync(path.join(h.projectDir, ".env.demo")), false, "full tilgang skriver ikke den vernede filen automatisk");
  await approval.getByRole("button", { name: "Avslå", exact: true }).click();
  await approval.waitFor({ state: "detached" });
  assert.equal(existsSync(path.join(h.projectDir, ".env.demo")), false);
});

flow("tillatelser i feltet: hjelpetrådens tak vises selv når prosjektet får full tilgang", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await choose(h, "accept-edits");
  await send(page, "samarbeid om en oversikt");
  await approveUntil(page, async () => (await page.getByText("Samarbeidet er ferdig").count()) > 0, "hjelpetråden fullfører");
  const child = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.parentThreadId && t.projectId === project.id);
  assert.ok(child, "den ekte demo-modellen oppretter hjelpetråden");
  assert.equal(child.permissionCap, "accept-edits");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await threadItem(page, child.id).click();
  const childPane = pane(page, child.id);
  const button = childPane.getByTestId("permission-button");
  await button.waitFor();
  assert.match(`${await button.innerText()} ${await button.getAttribute("title")} ${await button.getAttribute("aria-label")}`, /tak|høyst|begrens/i);
  await button.click();
  assert.match(await menu(page).innerText(), /tak|høyst|begrens/i);
  assert.match(await menu(page).innerText(), /Godkjenn for meg/);
  assert.equal(await storedMode(h, project.id), "full");
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === child.id).permissionCap, "accept-edits");
});

flow("tillatelser i feltet: menyen og alle valg får plass i smale vinduer", async (h) => {
  const { page } = h;
  await openProject(h);
  for (const width of [420, 360]) {
    await page.setViewportSize({ width, height: 640 });
    const hide = page.getByRole("button", { name: "Lukk sidefanen", exact: true });
    // Resizing may remove the scrim between visibility and click; setup only needs it closed.
    await hide.evaluateAll((buttons) => buttons.forEach((button) => (button as HTMLButtonElement).click()));
    await page.getByTestId("permission-button").click();
    await menu(page).waitFor();
    const bounds = (await menu(page).boundingBox())!;
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${width}: menyen er innenfor bredden`);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 641, `${width}: menyen er innenfor høyden`);
    for (const mode of Object.keys(LABELS) as PermissionMode[]) {
      const item = (await row(page, mode).boundingBox())!;
      assert.ok(item.x >= 0 && item.x + item.width <= width + 1 && item.y >= 0 && item.y + item.height <= 641, `${width}: ${mode} er synlig`);
    }
    await page.keyboard.press("Escape");
  }
});
