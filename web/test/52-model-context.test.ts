import assert from "node:assert/strict";
import { flow, waitFor } from "./harness.ts";

const open = async (page: import("playwright-core").Page, section: string) => {
  if (!await page.locator(".settings-nav").isVisible()) await page.keyboard.press("Control+,");
  await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
  await page.getByRole("heading", { name: section, exact: true }).waitFor();
  if (section === "Personalisering og minner") await page.getByRole("group", { name: "Personalisering for", exact: true }).getByRole("button", { name: "Chat", exact: true }).click();
};
const group = (page: import("playwright-core").Page) => page.locator(".settings-group").filter({ has: page.getByRole("heading", { name: "Kontekst til modellen", exact: true }) });
const context = async (h: import("./harness.ts").Harness, mode: string) => (await h.api("GET", "/api/bootstrap")).settings.modelContext[mode];

flow("Modellkontekst: tre brytere, separate moduser, persistens og riktig forhåndsvisning", async (h) => {
  const { page } = h;
  let lookups = 0;
  await page.route("**/api/model-context/location", (route) => { lookups++; return route.fulfill({ status: 502, json: { error: "Uventet oppslag" } }); });
  await open(page, "Personalisering og minner");
  const g = group(page);
  assert.equal(await g.getByRole("switch").count(), 3);
  assert.equal(await g.getByRole("switch", { name: "Lokal dato og tid", exact: true }).isChecked(), true);
  assert.equal(await g.getByRole("switch", { name: "Modell og leverandør", exact: true }).isChecked(), true);
  assert.equal(await g.getByRole("switch", { name: "Omtrentlig posisjon", exact: true }).isChecked(), false);
  await g.getByRole("switch", { name: "Lokal dato og tid", exact: true }).uncheck();
  await waitFor(async () => (await context(h, "chat")).dateTime === false, "Chat dato av");
  await g.getByRole("switch", { name: "Modell og leverandør", exact: true }).uncheck();
  await waitFor(async () => (await context(h, "chat")).model === false, "Chat modell av");
  await g.getByRole("switch", { name: "Omtrentlig posisjon", exact: true }).check();
  await waitFor(async () => (await context(h, "chat")).location === true, "Chat sted på");
  assert.equal(lookups, 0, "åpning og bryter bruker ikke IP-tjenesten");
  await g.getByLabel("Posisjon til modellen").fill("Bergen, Norge");
  await g.getByRole("button", { name: "Lagre posisjon", exact: true }).click();
  await waitFor(async () => (await context(h, "chat")).locationText === "Bergen, Norge", "manuelt sted lagret");
  const chat = (await h.api("GET", "/api/harness/preview?mode=chat")).layers.map((l: any) => l.text).join("\n");
  assert.match(chat, /Bergen, Norge/);
  assert.doesNotMatch(chat, /local date and time|model ID:/i);
  await open(page, "Konfigurasjon");
  assert.equal(await g.getByRole("switch", { name: "Lokal dato og tid", exact: true }).isChecked(), true);
  assert.equal(await g.getByRole("switch", { name: "Modell og leverandør", exact: true }).isChecked(), true);
  assert.equal(await g.getByRole("switch", { name: "Omtrentlig posisjon", exact: true }).isChecked(), false);
  await page.locator('.harness-layer[data-layer="env"] summary').click();
  const env = page.locator('.harness-layer[data-layer="env"] .harness-layer-text');
  await waitFor(async () => (await env.innerText()).includes("local date and time"), "lokal tid i forhåndsvisning");
  await g.getByRole("switch", { name: "Lokal dato og tid", exact: true }).uncheck();
  await waitFor(async () => !(await env.innerText()).includes("local date and time"), "forhåndsvisning oppdateres når bryteren lagres");
  await h.reload();
  await open(page, "Personalisering og minner");
  assert.equal(await g.getByRole("switch", { name: "Lokal dato og tid", exact: true }).isChecked(), false);
  assert.equal(await g.getByLabel("Posisjon til modellen").inputValue(), "Bergen, Norge");
  assert.equal(lookups, 0);
});

flow("Modellkontekst: eksplisitt IP-handling, nyere manuelt utkast og feil uten tap", async (h) => {
  const { page } = h;
  await open(page, "Personalisering og minner");
  const g = group(page);
  await g.getByRole("switch", { name: "Omtrentlig posisjon", exact: true }).check();
  await waitFor(async () => (await context(h, "chat")).location, "sted aktivert");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requested = 0;
  let fail = false;
  h.allow(/status of 502/);
  await page.route("**/api/model-context/location", async (route) => {
    requested++;
    if (fail) return route.fulfill({ status: 502, json: { error: "Test: oppslaget feilet" } });
    await pending;
    const saved = await h.api("PATCH", "/api/settings", { modelContext: { chat: { locationText: "Testbyen, Norge", locationSource: "ip", locationUpdatedAt: "2026-11-12T10:00:00.000Z" } } });
    await route.fulfill({ json: saved });
  });
  assert.equal(requested, 0);
  await g.getByRole("button", { name: "Hent fra IP", exact: true }).click();
  await waitFor(() => requested === 1, "eksplisitt oppslag starter");
  await g.getByLabel("Posisjon til modellen").fill("Mitt nyere sted");
  release();
  await waitFor(async () => (await context(h, "chat")).locationSource === "ip", "falskt IP-svar mottatt");
  assert.equal(await g.getByLabel("Posisjon til modellen").inputValue(), "Mitt nyere sted");
  await g.getByRole("button", { name: "Lagre posisjon", exact: true }).click();
  await waitFor(async () => (await context(h, "chat")).locationSource === "manual", "manuell retting");
  assert.equal((await context(h, "chat")).locationUpdatedAt, undefined);
  fail = true;
  await g.getByRole("button", { name: "Hent fra IP", exact: true }).click();
  await g.getByRole("alert").getByText("Test: oppslaget feilet", { exact: true }).waitFor();
  assert.equal(await g.getByLabel("Posisjon til modellen").inputValue(), "Mitt nyere sted");
  assert.equal(requested, 2);
});

flow("Modellkontekst: lagrefeil ruller bryteren tilbake og lar brukeren prøve igjen", async (h) => {
  const { page } = h;
  await open(page, "Konfigurasjon");
  const g = group(page);
  h.allow(/status of 503/);
  let fail = true;
  await page.route("**/api/settings", (route) => fail && route.request().method() === "PATCH" && route.request().postDataJSON().modelContext
    ? route.fulfill({ status: 503, json: { error: "Test: kontekst kunne ikke lagres" } }) : route.continue());
  const toggle = g.getByRole("switch", { name: "Lokal dato og tid", exact: true });
  await toggle.click();
  await g.getByRole("alert").getByText("Test: kontekst kunne ikke lagres", { exact: true }).waitFor();
  assert.equal(await toggle.isChecked(), true);
  assert.equal((await context(h, "code")).dateTime, true);
  fail = false;
  await toggle.uncheck();
  await waitFor(async () => (await context(h, "code")).dateTime === false, "nytt forsøk lagret");
});
