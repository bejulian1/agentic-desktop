// Round 12, part A (SPEC 26.1, 26.2 and 26.4): the cookie dialog against fake browser profiles,
// Økt in the side panel, and the message field in a project whose folder is gone.
// The fake profiles are made in the harness's temporary home; a fake secret-tool is first on the
// server's PATH. The user's real browser profiles and keyring are never touched.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import type { Page } from "playwright-core";
import type { SessionInfo } from "../../shared/protocol.ts";
import { makeChromeProfile, makeFirefoxProfile, makeSecretTool } from "../../server/test/runde12-fakes.ts";
import { flow, ROOT, threadItem, waitFor, type Harness } from "./harness.ts";

const SHOTS = path.join(ROOT, "docs/screenshots/runde12");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, name) });

// The fake secret-tool, first on the server's PATH.
const fakeBin = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-ui-fake-bin-")));
makeSecretTool(fakeBin);
after(() => rmSync(fakeBin, { recursive: true, force: true }));
const env = { PATH: `${fakeBin}:${path.join(ROOT, "web/test/bin")}:${process.env.PATH}` };

const DAY = 86_400_000;

function fakeProfiles(home: string): void {
  const now = Date.now();
  makeChromeProfile(home, [
    { host: ".github.com", name: "user_session", value: "okt", version: "v11", secure: true, lastUsed: now - 3_600_000 },
    { host: ".github.com", name: "logged_in", value: "yes", secure: true, lastUsed: now - 3_600_000 },
    { host: ".nrk.no", name: "nrk", value: "1", lastUsed: now - DAY },
    { host: "www.yr.no", name: "sted", value: "oslo", lastUsed: now - 2 * DAY },
    { host: ".example.com", name: "sid", value: "x", lastUsed: now - 5 * DAY },
    { host: ".finn.no", name: "f", value: "1", lastUsed: now - 9 * DAY },
    { host: ".vg.no", name: "v", value: "1", lastUsed: now - 14 * DAY },
    { host: ".wikipedia.org", name: "w", value: "1", lastUsed: now - 40 * DAY },
  ]);
  makeFirefoxProfile(home, [{ host: ".mozilla.example", name: "login", value: "ff" }]);
}

async function openBrowserSettings(page: Page): Promise<void> {
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Nettleser", exact: true }).click();
  await page.getByRole("heading", { name: "Informasjonskapsler", exact: true }).waitFor();
}

flow("informasjonskapsler: løftene, profil, nettsteder med søk og Velg alle, oppsummering, import, og glem per nettsted", async (h: Harness) => {
  const { page } = h;
  fakeProfiles(h.home);
  await openBrowserSettings(page);
  // The agents' choice is on by default.
  const ask = page.getByRole("switch", { name: "Spør før agenter bruker innloggede nettsteder" });
  assert.equal(await ask.isChecked(), true);
  assert.equal(await page.getByTestId("cookie-imported").count(), 0, "ingenting importert ennå");

  await page.getByTestId("cookie-import-open").click();
  const dialog = page.getByTestId("cookie-dialog");
  await dialog.getByRole("heading", { name: "Forbli innlogget på nettstedene dine" }).waitFor();
  for (const promise of ["Bare informasjonskapsler og nettstedsdata. Passord importeres ikke.", "Du velger nettstedene.", "Ingenting forlater denne datamaskinen."]) {
    await dialog.getByText(promise, { exact: true }).waitFor();
  }
  // From Innstillinger there is no «Ikke vis igjen»; that belongs to the first time.
  assert.equal(await dialog.getByRole("button", { name: "Ikke vis igjen" }).count(), 0);
  await page.waitForTimeout(300);
  await shot(page, "01-dialog-forbli-innlogget.png");

  // Step 1: the profiles found in the (fake) home folder.
  await dialog.getByRole("button", { name: "Importer informasjonskapsler" }).click();
  const profiles = dialog.getByRole("radiogroup", { name: "Nettleserprofil" });
  await profiles.getByRole("radio", { name: "Chrome · Standard" }).waitFor();
  await profiles.getByRole("radio", { name: "Firefox · default-release" }).waitFor();
  assert.equal(await profiles.getByRole("radio", { name: "Chrome · Standard" }).getAttribute("aria-checked"), "true");
  await shot(page, "02-velg-profil.png");
  await dialog.getByRole("button", { name: "Neste" }).click();

  // Step 2: nothing chosen beforehand, the newest first, search and Velg alle.
  const sites = dialog.getByTestId("cookie-sites");
  await sites.getByText("github.com", { exact: true }).waitFor();
  const names = await sites.locator(".cookie-site-name").allTextContents();
  assert.deepEqual(names.slice(0, 3), ["github.com", "nrk.no", "yr.no"]);
  assert.equal(await sites.getByRole("checkbox", { checked: true }).count(), 0, "ingenting er valgt på forhånd");
  assert.equal(await dialog.getByRole("button", { name: "Neste" }).isDisabled(), true);
  await dialog.getByText("Ingen valgt").waitFor();
  await dialog.getByRole("searchbox", { name: "Søk etter nettsted" }).fill(".no");
  await waitFor(async () => (await sites.locator(".cookie-site").count()) === 4, "fire treff på .no");
  await dialog.getByText("Velg alle treff").click();
  await dialog.getByText("4 nettsteder valgt").waitFor();
  // Unpick one, and the box shows it is partly chosen.
  await sites.locator(".cookie-site", { hasText: "vg.no" }).click();
  assert.equal(await dialog.locator(".cookie-all input").evaluate((el: HTMLInputElement) => el.indeterminate), true);
  await dialog.getByRole("searchbox", { name: "Søk etter nettsted" }).fill("");
  await sites.locator(".cookie-site", { hasText: "github.com" }).click();
  await dialog.getByText("4 nettsteder valgt").waitFor();
  assert.equal(await dialog.locator(".cookie-all input").evaluate((el: HTMLInputElement) => el.indeterminate), true, "Velg alle viser at noen er valgt");
  await shot(page, "03-velg-nettsteder.png");
  assert.deepEqual(await h.api("GET", "/api/browser/cookies"), [], "ingenting før du trykker Importer");
  await dialog.getByRole("button", { name: "Neste" }).click();

  // Step 3: the summary, with what the keyring is used for.
  const summary = dialog.getByTestId("cookie-summary");
  await summary.getByText("5 informasjonskapsler", { exact: true }).waitFor();
  await dialog.getByText(/nøkkel i systemets nøkkelring/).waitFor();
  await dialog.getByText("Agenter spør før de bruker et nettsted du er innlogget på.").waitFor();
  await shot(page, "04-oppsummering.png");
  await dialog.getByRole("button", { name: "Importer", exact: true }).click();
  const done = dialog.getByTestId("cookie-done");
  await done.getByText("Importerte 5 informasjonskapsler fra 4 nettsteder.", { exact: false }).waitFor();
  await shot(page, "05-ferdig.png");
  await done.getByRole("button", { name: "Ferdig" }).click();
  await dialog.waitFor({ state: "detached" });

  // Only the chosen sites, and the dialog will not be offered on its own again.
  const imported = await h.api("GET", "/api/browser/cookies");
  assert.deepEqual(imported.map((s: { site: string }) => s.site), ["finn.no", "github.com", "nrk.no", "yr.no"]);
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.cookieOffer, "done");

  // Innstillinger lists them per site, and each can be forgotten.
  const list = page.getByTestId("cookie-imported");
  await list.getByText("github.com", { exact: true }).waitFor();
  await list.getByText(/2 informasjonskapsler fra Chrome · Standard, importert i dag/).waitFor();
  await page.locator(".cookie-imported").scrollIntoViewIfNeeded();
  await shot(page, "06-innstillinger-nettleser.png");
  await list.getByRole("button", { name: "Glem informasjonskapslene for nrk.no" }).click();
  await page.locator(".toast", { hasText: "Glemte informasjonskapslene for nrk.no." }).waitFor();
  assert.equal(await list.getByText("nrk.no", { exact: true }).count(), 0);

  // The agents' choice is saved.
  await ask.click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.browserAskSignedIn === false, "valget er lagret");

  // Glem importerte informasjonskapsler asks first, then they are gone.
  await page.getByTestId("cookie-forget-all").click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Glemme importerte informasjonskapsler?" });
  await confirm.getByText(/logges ut av 3 nettsteder/).waitFor();
  await confirm.getByRole("button", { name: "Glem", exact: true }).click();
  await page.getByTestId("cookie-imported").waitFor({ state: "detached" });
  assert.deepEqual(await h.api("GET", "/api/browser/cookies"), []);
}, { theme: "dark", env });

flow("informasjonskapsler: uten profiler sier dialogen det, og Esc lukker", async (h: Harness) => {
  const { page } = h;
  await openBrowserSettings(page);
  await page.getByTestId("cookie-import-open").click();
  const dialog = page.getByTestId("cookie-dialog");
  await dialog.getByRole("button", { name: "Importer informasjonskapsler" }).click();
  await dialog.getByTestId("cookie-no-profiles").waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Neste" }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
}, { env });

async function sessionThread(h: Harness): Promise<string> {
  const project = await h.createProject("Økt-demo");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  const thread = await h.createThread(project.id);
  // The demo model writes a page, runs a command and opens it: Playtest serves it on its own port.
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "kjøringen er ferdig", 60_000);
  await waitFor(async () => (await h.api<SessionInfo>("GET", `/api/threads/${thread.id}/session`)).tasks.length > 0, "en server kjører", 30_000);
  return thread.id;
}

flow("Økt: miljø, kontekst med fordeling, tilkoblinger og oppgaver i bakgrunnen med Stopp og Avsluttet", async (h: Harness) => {
  const { page } = h;
  const threadId = await sessionThread(h);
  await page.setViewportSize({ width: 1280, height: 800 });
  await h.reload();
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await threadItem(page, threadId).locator(".thread-text").click();
  // The panel belongs to the thread's project: wait until the thread (and so its project) is open.
  await page.locator(`.pane-inner.focused[data-thread-id="${threadId}"]`).waitFor();
  await page.locator(".project-label", { hasText: "Økt-demo" }).first().waitFor();
  // Round 12, part B: Økt is a tool in the side panel, Ctrl+Alt+7.
  await page.keyboard.press("Control+Alt+7");
  const panel = page.locator(".right-panel").getByTestId("session-panel");
  await panel.getByText("Denne datamaskinen", { exact: true }).waitFor();
  await panel.getByTestId("okt-project").getByText("Økt-demo").waitFor();
  assert.match((await panel.getByTestId("okt-context-percent").textContent())!, /^\d+ %$/);
  assert.match((await panel.getByTestId("okt-connected").textContent())!, /^\d+ tilkoblet$/);

  // Oppgaver i bakgrunnen: the Playtest server, with its time and a stop button.
  const task = panel.getByTestId("okt-task").first();
  await task.getByText(/^localhost:\d+$/).waitFor();
  await task.getByText(/^\d+[smtd]/).waitFor();

  // Kontekst and Tilkoblinger fold out.
  await panel.getByRole("button", { name: /^Kontekst/ }).click();
  const context = panel.getByTestId("okt-context");
  for (const part of ["Systemprompt og harness", "Verktøy", "Meldinger"]) await context.getByText(part, { exact: true }).waitFor();
  await context.getByText(/Estimert|estimert/).waitFor();
  await panel.getByRole("button", { name: /^Tilkoblinger/ }).click();
  await panel.getByTestId("okt-connection-model").getByText("Demo-modellen").waitFor();
  await panel.getByTestId("okt-connection-browser").getByText("Nettleserpanelet").waitFor();
  assert.equal(await panel.getByTestId("okt-connection-github").count(), 0, "GitHub er ikke koblet til, så det vises ikke");
  await page.waitForTimeout(300);
  await page.locator(".right-panel").screenshot({ path: path.join(SHOTS, "07-oktpanel.png") });

  // Stopp: the task ends and is counted under Avsluttet.
  await task.getByRole("button", { name: /^Stopp localhost:/ }).click();
  await panel.getByTestId("okt-finished").getByText("Avsluttet: 1").waitFor();
  await waitFor(async () => (await panel.getByTestId("okt-task").count()) === 0, "ingenting kjører");
  await panel.getByTestId("okt-finished").click();
  await panel.locator(".okt-finished .okt-task").first().waitFor();
  await page.waitForTimeout(250);
  await page.locator(".right-panel").screenshot({ path: path.join(SHOTS, "08-oktpanel-avsluttet.png") });

  // The open sections are remembered.
  await h.reload();
  await page.keyboard.press("Control+Alt+7");
  await page.locator(".right-panel").getByTestId("okt-context").waitFor();
}, { theme: "dark" });

flow("mappen mangler: meldingsfeltet er låst, prosjektvelgeren demper prosjektet, og alt åpner seg igjen uten omstart", async (h: Harness) => {
  const { page } = h;
  const project = await h.createProject("Borte");
  const other = mkdtempSync(path.join(tmpdir(), "ad-ui-annet-"));
  after(() => rmSync(other, { recursive: true, force: true }));
  await h.api("POST", "/api/projects", { name: "Annet", path: other });
  const thread = await h.createThread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "svaret");
  rmSync(h.projectDir, { recursive: true, force: true });

  await page.goto(`${h.origin}/?rute=${thread.id}`);
  await page.getByTestId("folder-missing").waitFor();
  // Round 14 (SPEC 30.5): the bar takes the field's place; the field stays locked behind it.
  const field = page.locator(".composer textarea");
  await waitFor(() => field.isDisabled(), "feltet er låst");
  assert.equal(await field.isVisible(), false, "feltet er byttet ut med baren");
  assert.equal(await field.getAttribute("placeholder"), "Mappen mangler. Velg mappen på nytt for å skrive her.");
  assert.equal(await page.locator('.composer button[aria-label="Send"]').isDisabled(), true);
  // The thread can still be read.
  await page.locator(".pane-body").getByText("Hva vil du jobbe med?").waitFor();
  await shot(page, "09-mappen-mangler-meldingsfelt.png");

  // The project picker shows it dimmed, and it cannot be chosen.
  await page.getByTestId("project-picker").click();
  const menu = page.getByTestId("project-picker-menu");
  const gone = menu.getByRole("option", { name: /Borte/ });
  await gone.getByTestId("picker-missing").getByText("Mappen mangler").waitFor();
  assert.equal(await gone.getAttribute("aria-disabled"), "true");
  assert.ok(Number(await gone.evaluate((el) => getComputedStyle(el).opacity)) < 1, "dempet");
  await waitFor(async () => (await page.evaluate(() => document.getAnimations().length)) === 0, "menyen har kommet fram");
  await shot(page, "10-prosjektvelger-mappen-mangler.png");
  await gone.click({ force: true });
  await page.waitForTimeout(150);
  assert.equal(await menu.isVisible(), true, "valget gjør ingenting");
  assert.equal(await menu.getByRole("option", { name: /Annet/ }).getAttribute("aria-disabled"), null);
  await page.keyboard.press("Escape");

  // The server says no to a new thread too (the test's own request, so the 409 in the console is expected).
  h.allow(/status of 409/);
  await assert.rejects(h.api("POST", "/api/threads", { projectId: project.id, mode: "code" }), /409/);

  // The folder is chosen again: the field opens without a reload.
  mkdirSync(h.projectDir, { recursive: true });
  await h.api("POST", `/api/projects/${project.id}/relink`, { path: h.projectDir });
  await waitFor(async () => !(await field.isDisabled()), "feltet er åpent igjen");
  await page.getByTestId("folder-missing").waitFor({ state: "detached" });
});
