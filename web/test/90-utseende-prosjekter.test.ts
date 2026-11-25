// v1.2.0: Utseende (tema-kort, grensesnittkontroller), Innstillinger → Prosjekter, smarte lenker og
// filchips i samtalen, rader i sidefanen og Tråddetaljer. Bare demomodellen og en lokal
// testtjener; ingen ekte API.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Page } from "playwright-core";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const openSettings = async (page: Page, section: string) => {
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
};
const rootVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

flow("Utseende: tema som tre kort, orber på fargetemaene og grensesnittkontroller som lagres", async (h) => {
  const { page } = h;
  await openSettings(page, "Utseende");

  // Tema: System, Lys og Mørk som en radiogruppe med piltaster.
  const scheme = page.getByRole("radiogroup", { name: "Tema", exact: true });
  assert.deepEqual(await scheme.getByRole("radio").evaluateAll((els) => els.map((el) => el.getAttribute("data-scheme"))), ["system", "light", "dark"]);
  await scheme.getByRole("radio", { name: "Mørk" }).click();
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "mørkt");
  await scheme.getByRole("radio", { name: "Mørk" }).press("ArrowLeft");
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "piltast til Lys");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-scheme")), "light", "fokus følger valget");
  await scheme.getByRole("radio", { name: "Lys" }).click();
  // Hvert kort viser et lite vindu med temaets egne farger, og System viser begge halvdeler.
  assert.equal(await scheme.locator('[data-scheme="system"] .scheme-window').count(), 2);
  assert.equal(await scheme.locator('[data-scheme="light"] .scheme-window').count(), 1);

  // Fargetemaene: to orber på hvert kort, og solen eller månen står på den varianten som vises nå.
  const cards = page.getByRole("radiogroup", { name: "Fargetema" }).getByRole("radio");
  assert.equal(await cards.nth(1).locator(".theme-orb").count(), 2);
  assert.equal(await cards.nth(1).locator('.theme-orb[data-active="true"]').getAttribute("data-variant"), "light");
  await scheme.getByRole("radio", { name: "Mørk" }).click();
  await waitFor(async () => (await cards.nth(1).locator('.theme-orb[data-active="true"]').getAttribute("data-variant")) === "dark", "månen på den mørke orben");
  await cards.nth(1).click(); // Ocean
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.palette)) === "ocean", "Ocean");
  assert.equal((await rootVar(page, "--bg")).toLowerCase(), "#1f2b36");
  await scheme.getByRole("radio", { name: "Lys" }).click();
  await waitFor(async () => (await rootVar(page, "--accent")).toLowerCase() === "#0d7c86", "Ocean lys");

  // Kontrast: glidebryteren går i steg på 5 og lagres.
  const slider = page.getByRole("slider", { name: "Kontrast i grensesnittet" });
  assert.deepEqual(await slider.evaluate((el: HTMLInputElement) => [el.min, el.max, el.step, el.value]), ["85", "115", "5", "100"]);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-ui-contrast")), false, "100 % setter ingenting");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("ui-contrast").getByText("110 %").waitFor();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.uiContrast === 110, "kontrasten er lagret");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.uiContrast), "custom");
  assert.equal(await rootVar(page, "--ui-contrast"), "1.1");
  assert.match(await rootVar(page, "--border"), /color-mix|rgba?\(/);
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.uiContrast === undefined, "100 % fjerner innstillingen");
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-ui-contrast")), false);

  // Bredde på samtalen.
  assert.equal(await rootVar(page, "--content-max"), "760px");
  await page.getByRole("group", { name: "Bredde på samtalen" }).getByRole("button", { name: "Bred" }).click();
  await waitFor(async () => (await rootVar(page, "--content-max")) === "960px", "bred samtale");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.chatWidth), "wide");
  await page.getByRole("group", { name: "Bredde på samtalen" }).getByRole("button", { name: "Kompakt" }).click();
  await waitFor(async () => (await rootVar(page, "--content-max")) === "640px", "kompakt samtale");
  await page.getByRole("group", { name: "Bredde på samtalen" }).getByRole("button", { name: "Komfortabel" }).click();
  await waitFor(async () => (await rootVar(page, "--content-max")) === "760px", "komfortabel igjen");
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.chatWidth, undefined);

  // Matte.
  const math = page.getByRole("switch", { name: "Vis matte" });
  assert.equal(await math.isChecked(), true);
  await math.click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.renderMath === false, "matte er av");
  await math.click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.renderMath === undefined, "matte er på igjen");

  // Forhåndsvisning av tekst, med chips for ferdigheter og filer.
  const preview = page.getByTestId("interface-font-preview");
  for (const name of ["frontend-design", "surface.test.ts", "SettingsPanels.tsx"]) await preview.getByText(name, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Tekststørrelse" }).click();
  await page.getByRole("menuitemradio", { name: "Større (16 px)" }).click();
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.uiSize)) === "16", "16 px");
  const big = await preview.locator(".font-preview-line").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(big >= 16, `forhåndsvisningen følger størrelsen: ${big}`);

  // Kode: forhåndsvisning av diff og terminal.
  await page.locator(".settings-nav").getByRole("button", { name: "Kode", exact: true }).click();
  const live = page.getByTestId("code-live-preview");
  await live.getByText("src/greet.ts").waitFor();
  await live.getByText("npm test").waitFor();
  assert.ok((await live.locator(".code-preview-line.add").count()) === 1 && (await live.locator(".code-preview-line.del").count()) === 1);
});

const projectOf = async (h: any, id: string) => (await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.id === id);

flow("Innstillinger → Prosjekter uten prosjekter: Ingen prosjekt (Denne datamaskinen) med ekte valg", async (h) => {
  const { page } = h;
  await openSettings(page, "Prosjekter");
  // Aldri en tom side: valget øverst, merknaden og innstillingene for tråder uten prosjekt.
  const scope = page.getByTestId("projects-scope");
  await scope.getByText("Gjelder for").waitFor();
  await scope.getByRole("button", { name: /Ingen prosjekt \(Denne datamaskinen\)/ }).waitFor();
  await scope.getByRole("button", { name: "Åpne mappe…" }).waitFor();
  await page.getByTestId("projects-callout").getByText("Finner du ikke en innstilling?", { exact: false }).waitFor();
  assert.equal(await page.getByTestId("projects-empty").count(), 0);

  // Nye tråder: modell med leverandørmerke, tenkeinnsats, tillatelser og nettleseren.
  await page.getByTestId("project-model").locator("svg").first().waitFor();
  await page.getByRole("button", { name: "Tenkeinnsats" }).click();
  await page.getByRole("menuitemradio", { name: "Høy", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.defaultReasoningEffort === "high", "innsatsen er lagret");
  await page.getByRole("button", { name: "Tenkeinnsats" }).click();
  await page.getByRole("menuitemradio", { name: "Modellens standard" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.defaultReasoningEffort === undefined, "tilbake til modellens standard");
  await page.getByRole("button", { name: "Standard tillatelsesmodus" }).click();
  await page.getByRole("menuitemradio", { name: "Godta redigeringer" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.defaultPermissionMode === "accept-edits", "standard tillatelsesmodus");
  await page.getByRole("button", { name: "Agenttilgang til nettleseren" }).click();
  await page.getByRole("menuitemradio", { name: "Av" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.agentBrowserAccess === false, "nettleseren er av");

  // Handlinger for Denne datamaskinen.
  const card = page.getByTestId("actions-card");
  await card.getByTestId("actions-empty").getByText("Ingen handlinger konfigurert ennå.").waitFor();
  await card.getByRole("button", { name: "Legg til handling" }).click();
  const form = card.getByTestId("action-form");
  await form.getByRole("textbox", { name: "Navn på handlingen" }).fill("Hjemme");
  await form.getByRole("textbox", { name: "Kommando" }).fill("touch hjemme-fra-ui.txt");
  assert.equal(await form.getByRole("checkbox").count(), 0, "ingen arbeidstrær uten prosjekt");
  await form.getByRole("button", { name: "Lagre handling" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.localActions?.[0]?.name === "Hjemme", "handlingen er lagret");
  await card.getByTestId("action-row").getByRole("button", { name: "Kjør" }).click();
  await waitFor(async () => existsSync(path.join(h.home, "hjemme-fra-ui.txt")), "handlingen kjørte i hjemmemappen");

  // Globale instruksjoner (AGENTS.md i konfigurasjonsmappen).
  const global = page.getByRole("textbox", { name: "Globale instruksjoner" });
  await global.fill("Svar kort.");
  await page.getByTestId("global-instructions").getByRole("button", { name: "Lagre instruksjoner" }).click();
  await page.locator(".toast", { hasText: "AGENTS.md" }).waitFor();
  assert.equal((await h.api("GET", "/api/config")).agentsMd, "Svar kort.");
  await page.getByRole("button", { name: "Åpne mappe…" }).last().waitFor();
});

flow("Innstillinger → Prosjekter: navn, ikondialog, fest, arkiv, nye tråder, handlinger, utsjekking, instruksjoner og fjerning", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Demo");
  await openSettings(page, "Prosjekter");
  const scope = page.getByTestId("projects-scope");
  await scope.getByText("Gjelder for").waitFor();
  await scope.getByRole("button", { name: /Demo/ }).waitFor();

  // Med flere prosjekter: velgeren bytter hva siden gjelder, og Ingen prosjekt er alltid med.
  const second = await h.api("POST", "/api/projects", { name: "Annet", path: h.home });
  await scope.getByRole("button", { name: /Demo/ }).click();
  const menu = page.getByRole("menu", { name: "Prosjekt" });
  await menu.getByRole("menuitemradio", { name: "Ingen prosjekt (Denne datamaskinen)" }).waitFor();
  await menu.getByText("Kode-prosjekter").waitFor();
  await menu.getByRole("menuitemradio", { name: "Annet" }).click();
  await scope.getByRole("button", { name: /Annet/ }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Navn" }).inputValue(), "Annet");
  await scope.getByRole("button", { name: /Annet/ }).click();
  await menu.getByRole("menuitemradio", { name: "Demo" }).click();
  await page.getByRole("textbox", { name: "Navn" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Navn" }).inputValue(), "Demo");

  // Navn med Lagre.
  const name = page.getByRole("textbox", { name: "Navn" });
  const saveName = page.getByRole("button", { name: "Lagre", exact: true });
  assert.equal(await saveName.isDisabled(), true);
  await name.fill("Nettbutikk");
  await saveName.click();
  await waitFor(async () => (await projectOf(h, project.id)).name === "Nettbutikk", "navnet er lagret");

  // Ikon: en egen dialog med Ikoner, Emoji og Monogram, 18 farger, søk, og Avbryt eller Lagre ikon.
  await page.getByRole("button", { name: "Velg ikon" }).click();
  const dialog = page.getByTestId("project-icon-dialog");
  await dialog.getByRole("heading", { name: "Velg prosjektikon" }).waitFor();
  const picker = dialog.getByTestId("icon-picker");
  assert.deepEqual(await picker.getByRole("tab").allTextContents(), ["Ikoner", "Emoji", "Monogram"]);
  assert.equal(await picker.getByRole("radiogroup", { name: "Farge" }).getByRole("radio").count(), 19, "ingen farge og 18 farger");
  await picker.getByRole("searchbox", { name: "Søk etter ikoner" }).fill("rak");
  assert.ok((await picker.getByRole("radiogroup", { name: "Ikoner" }).getByRole("radio").count()) >= 1);
  await picker.getByRole("radio", { name: "Rosenrød" }).click();
  await dialog.getByRole("button", { name: "Avbryt" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await projectOf(h, project.id)).color, null, "Avbryt lagrer ingenting");
  await page.getByRole("button", { name: "Velg ikon" }).click();
  await picker.getByRole("radio", { name: "Rosenrød" }).click();
  await picker.getByRole("tab", { name: "Monogram" }).click();
  const mono = picker.getByRole("textbox", { name: "Monogram" });
  assert.equal(await mono.inputValue(), "NE", "foreslått fra navnet");
  await mono.fill("nb!x9");
  assert.equal(await mono.inputValue(), "NBX", "bare bokstaver og tall, høyst tre");
  await picker.getByRole("button", { name: "Bruk monogram" }).click();
  assert.equal((await projectOf(h, project.id)).icon, null, "ikke lagret før Lagre ikon");
  await dialog.getByRole("button", { name: "Lagre ikon" }).click();
  await dialog.waitFor({ state: "detached" });
  await waitFor(async () => { const p = await projectOf(h, project.id); return p.icon === "mono:NBX" && p.color === "rose"; }, "ikon og farge er lagret");
  await page.getByTestId("project-icon-row").locator(".project-mono").getByText("NBX").waitFor();
  assert.ok(((await page.getByTestId("project-icon-row").locator(".projects-icon-preview").boundingBox())?.width ?? 0) >= 39, "40 × 40 forhåndsvisning");

  // Eget bilde fra en fil.
  await page.locator('input[type="file"][aria-label="Last opp ikon"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await waitFor(async () => /^file:[0-9a-f-]{36}\.png$/.test((await projectOf(h, project.id)).icon ?? ""), "bildet er lagret som ikon");
  const stored = (await projectOf(h, project.id)).icon as string;
  assert.ok(existsSync(path.join(h.dataDir, "project-icons", stored.slice(5))), "filen ligger i datamappen");
  const image = page.getByTestId("project-icon-row").locator("img.project-file-icon");
  await image.waitFor();
  await waitFor(async () => (await image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)), "bildet lastes");
  await page.locator('.group[data-project="Nettbutikk"] img.project-file-icon').first().waitFor({ state: "attached" });
  await page.locator('input[type="file"][aria-label="Last opp ikon"]').setInputFiles({ name: "notat.txt", mimeType: "text/plain", buffer: Buffer.from("hei") });
  await page.locator(".toast", { hasText: "PNG-, SVG-, ICO- eller WebP-bilde" }).waitFor();
  assert.equal((await projectOf(h, project.id)).icon, stored);
  await page.getByRole("button", { name: "Bruk favicon" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).icon === null, "tilbake til standard");
  assert.equal(existsSync(path.join(h.dataDir, "project-icons", stored.slice(5))), false);

  // Fest og arkiver: arkivert er borte fra sidefanen og står under Arkiverte i valget.
  await page.getByRole("switch", { name: "Fest prosjekt" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).pinned === true, "festet");
  await page.getByTestId("project-archive").getByText("Arkiver", { exact: true }).click();
  await waitFor(async () => (await projectOf(h, project.id)).archived === true, "arkivert");
  await page.getByTestId("project-archived-note").waitFor();
  await waitFor(async () => (await page.locator('.group[data-project="Nettbutikk"]').count()) === 0, "borte fra sidefanen");
  await scope.getByRole("button", { name: /Nettbutikk/ }).click();
  await menu.getByText("Arkiverte").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("project-archive").getByText("Gjenopprett", { exact: true }).click();
  await waitFor(async () => (await projectOf(h, project.id)).archived === false, "gjenopprettet");
  await page.locator('.group[data-project="Nettbutikk"]').first().waitFor({ state: "attached" });

  // Nye tråder: modell og innsats, arbeidsområde, tillatelser og nettleseren.
  await page.getByRole("button", { name: "Standardmodell" }).waitFor();
  await page.getByRole("button", { name: "Tenkeinnsats" }).click();
  await page.getByRole("menuitemradio", { name: "Maks" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).defaultReasoningEffort === "max", "innsatsen for prosjektet");
  const created = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code" });
  assert.equal(created.reasoning, "max", "en ny tråd arver innsatsen");
  await page.getByRole("group", { name: "Arbeidsområde" }).getByRole("button", { name: "Nytt arbeidstre" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).defaultWorkspaceMode === "worktree", "nytt arbeidstre");
  await page.getByRole("group", { name: "Arbeidsområde" }).getByRole("button", { name: "Gjeldende mappe" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).defaultWorkspaceMode === "local", "gjeldende mappe");
  await page.getByRole("button", { name: "Tillatelsesmodus" }).click();
  await page.getByRole("menuitemradio", { name: "Godta redigeringer" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).permissionMode === "accept-edits", "tillatelsesmodus");
  await page.getByRole("button", { name: "Agenttilgang til nettleseren" }).click();
  await page.getByRole("menuitemradio", { name: "Av" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).agentBrowserAccess === false, "nettleseren er av for prosjektet");

  // Handlinger: tomt kort, ny, endre med hurtigtast, slette.
  const card = page.getByTestId("actions-card");
  await card.getByText("Ingen handlinger konfigurert ennå.").waitFor();
  await card.getByRole("button", { name: "Legg til handling" }).click();
  const form = card.getByTestId("action-form");
  await form.getByRole("button", { name: "Lagre handling" }).click();
  await form.getByRole("alert").getByText("Gi handlingen et navn.").waitFor();
  await form.getByRole("textbox", { name: "Navn på handlingen" }).fill("Test");
  await form.getByRole("textbox", { name: "Kommando" }).fill("npm test");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Lagre handling" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).actions?.[0]?.runOnWorktreeCreate === true, "handlingen er lagret");
  const row = card.getByTestId("action-row");
  await row.getByText("npm test").waitFor();
  await row.getByRole("button", { name: "Rediger Test" }).click();
  const shortcut = form.getByRole("textbox", { name: "Hurtigtast for handlingen" });
  await shortcut.focus();
  await page.keyboard.press("Control+J");
  await form.getByRole("button", { name: "Lagre handling" }).click();
  await form.getByRole("alert").getByText("brukes allerede av appen", { exact: false }).waitFor();
  await shortcut.focus();
  await page.keyboard.press("Control+Shift+Y");
  assert.equal(await shortcut.inputValue(), "Ctrl+Shift+Y");
  await form.getByRole("button", { name: "Lagre handling" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).actions?.[0]?.shortcut === "Mod+Shift+Y", "hurtigtasten er lagret");
  await row.locator(".action-kbd").getByText("Ctrl+Shift+Y").waitFor();

  // Utsjekkinger: navn, sti og Bytt mappe.
  const checkout = page.getByTestId("project-checkout");
  await checkout.getByText(h.projectDir, { exact: true }).waitFor();
  await checkout.getByRole("button", { name: "Bytt mappe…" }).waitFor();

  // Instruksjoner i .agentic/AGENTS.md.
  const text = page.getByRole("textbox", { name: "Instruksjoner for prosjektet" });
  const save = page.getByRole("button", { name: "Lagre instruksjoner" });
  assert.equal(await save.isDisabled(), true);
  await text.fill("Bruk tabulatorer.");
  await save.click();
  await page.locator(".toast", { hasText: ".agentic/AGENTS.md" }).waitFor();
  assert.equal(readFileSync(path.join(h.projectDir, ".agentic/AGENTS.md"), "utf8"), "Bruk tabulatorer.");

  // Slette handlingen.
  await row.getByRole("button", { name: "Slett Test" }).click();
  await waitFor(async () => (await projectOf(h, project.id)).actions?.length === 0, "handlingen er slettet");

  // Faresone: spør først, og mappen røres ikke. Siden går til Ingen prosjekt etterpå.
  await page.getByRole("button", { name: "Fjern prosjektet…" }).click();
  await page.getByRole("dialog").filter({ hasText: "Fjerne prosjektet?" }).getByRole("button", { name: "Avbryt" }).click();
  assert.ok(await projectOf(h, project.id));
  await page.getByRole("button", { name: "Fjern prosjektet…" }).click();
  await page.getByRole("dialog").filter({ hasText: "Fjerne prosjektet?" }).getByRole("button", { name: "Fjern", exact: true }).click();
  await waitFor(async () => !(await projectOf(h, project.id)), "prosjektet er fjernet");
  assert.ok(existsSync(h.projectDir), "mappen er der fortsatt");
  await scope.getByRole("button", { name: /Ingen prosjekt/ }).waitFor();
  assert.ok(second.id);
});

flow("Innstillinger → Prosjekter: et Chat-prosjekt har egne valg i samme side", async (h) => {
  const { page } = h;
  const chat = await h.api("POST", "/api/chat-projects", { name: "Reise" });
  await openSettings(page, "Prosjekter");
  const scope = page.getByTestId("projects-scope");
  await scope.getByRole("button", { name: /Ingen prosjekt/ }).click();
  const menu = page.getByRole("menu", { name: "Prosjekt" });
  await menu.getByText("Chat-prosjekter").waitFor();
  await menu.getByRole("menuitemradio", { name: "Reise" }).click();
  await scope.getByRole("button", { name: /Reise/ }).waitFor();
  const chatOf = async () => (await h.api("GET", "/api/bootstrap")).chatProjects.find((p: any) => p.id === chat.id);

  await page.getByRole("textbox", { name: "Navn" }).fill("Reiser");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await waitFor(async () => (await chatOf()).name === "Reiser", "nytt navn");
  await page.getByRole("button", { name: "Velg ikon" }).click();
  const dialog = page.getByTestId("chat-icon-dialog");
  await dialog.getByRole("radio", { name: "Reise" }).click();
  await dialog.getByRole("radio", { name: "Smaragd" }).click();
  await dialog.getByRole("button", { name: "Lagre ikon" }).click();
  await waitFor(async () => { const p = await chatOf(); return p.icon === "plane" && p.color === "emerald"; }, "ikon og farge");
  await page.getByRole("switch", { name: "Fest prosjekt" }).click();
  await waitFor(async () => (await chatOf()).pinned === true, "festet");
  await page.getByRole("group", { name: "Minner" }).getByRole("button", { name: "Delt minne" }).click();
  await waitFor(async () => (await chatOf()).memoryMode === "shared", "delt minne");
  await page.getByRole("textbox", { name: "Instruksjoner for Chat-prosjektet" }).fill("Svar med reisetips.");
  await page.getByRole("button", { name: "Lagre instruksjoner" }).click();
  await waitFor(async () => (await chatOf()).instructions === "Svar med reisetips.", "instruksjonene");
  await page.getByRole("button", { name: "Fjern prosjektet…" }).click();
  await page.getByRole("dialog").filter({ hasText: "Fjerne Chat-prosjektet?" }).getByRole("button", { name: "Fjern prosjektet" }).click();
  await waitFor(async () => !(await chatOf()), "fjernet");
  await scope.getByRole("button", { name: /Ingen prosjekt/ }).waitFor();
});

flow("Tråddetaljer: prosjektets handlinger kjøres i terminalen, og Legg til prosjektskript åpner Handlinger", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Demo");
  await h.api("PATCH", `/api/projects/${project.id}`, { actions: [{ id: "skriv", name: "Skriv fil", command: "printf ferdig > fra-detaljer.txt" }] });
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  const button = page.getByTestId("thread-details-button");
  await button.click();
  const details = page.getByTestId("thread-details-card");
  await details.waitFor();
  // Rekkefølgen som i T3 Code: VS Code, handlingene, og så Legg til prosjektskript.
  const order = await details.locator('[data-group="project"] .details-row').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  assert.deepEqual(order.slice(0, 3), ["details-vscode", "details-action", "details-add-action"]);
  await details.getByTestId("details-action").getByText("Skriv fil").click();
  await details.waitFor({ state: "detached" });
  await waitFor(async () => existsSync(path.join(h.projectDir, "fra-detaljer.txt")), "handlingen kjørte");
  await page.getByTestId("terminal-panel").waitFor();
  await waitFor(async () => (await page.locator(".panel-workspace-bar, .terminal-tabs").getByText("Skriv fil").count()) > 0, "fanen heter som handlingen");

  // Legg til prosjektskript: Innstillinger → Prosjekter for dette prosjektet, med skjemaet åpent.
  await button.click();
  await page.getByTestId("details-add-action").click();
  await page.getByTestId("projects-scope").getByRole("button", { name: /Demo/ }).waitFor();
  await page.getByTestId("actions-card").getByTestId("action-form").getByRole("textbox", { name: "Navn på handlingen" }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Navn på handlingen");
});

flow("Utseende → Typografi: skrifttype og størrelse for grensesnitt og kode, med levende forhåndsvisning", async (h) => {
  const { page } = h;
  await openSettings(page, "Utseende");
  const ui = page.getByTestId("typography-interface");
  await ui.getByRole("button", { name: "Skrifttype for grensesnittet" }).click();
  await page.getByRole("menuitemradio", { name: "Inter" }).click();
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.uiFont)) === "inter", "Inter");
  assert.match(await rootVar(page, "--font-sans"), /^"Inter Variable"/);
  const line = page.getByTestId("interface-font-preview").locator(".font-preview-line");
  assert.match(await line.evaluate((el) => getComputedStyle(el).fontFamily), /Inter/);
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.uiFont === "inter", "lagret");
  await ui.getByRole("button", { name: "Tekststørrelse" }).click();
  await page.getByRole("menuitemradio", { name: "Stor (15 px)" }).click();
  await waitFor(async () => (await line.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 15, "størrelsen følger");
  await ui.getByRole("button", { name: "Skrifttype for grensesnittet" }).click();
  await page.getByRole("menuitemradio", { name: "Systemets skrift" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.uiFont === undefined, "systemets skrift fjerner valget");
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-ui-font")), false);

  const mono = page.getByTestId("typography-mono");
  await mono.getByRole("button", { name: "Kodeskrift" }).click();
  await page.getByRole("menuitemradio", { name: "Liberation Mono" }).click();
  await waitFor(async () => /^"Liberation Mono"/.test(await rootVar(page, "--font-mono")), "Liberation Mono");
  const code = mono.getByTestId("code-live-preview");
  await code.getByText("src/greet.ts").waitFor();
  assert.match(await code.locator("pre").first().evaluate((el) => getComputedStyle(el).fontFamily), /Liberation Mono/);
  await mono.getByRole("button", { name: "Skriftstørrelse for kode" }).click();
  await page.getByRole("menuitemradio", { name: "16 px" }).click();
  await waitFor(async () => (await code.locator("pre").first().evaluate((el) => getComputedStyle(el).fontSize)) === "16px", "kodestørrelsen følger");
  const wrapLine = code.locator(".code-preview-line.add");
  assert.equal(await wrapLine.evaluate((el) => getComputedStyle(el).whiteSpace), "pre");
  await page.getByRole("switch", { name: "Bryt lange linjer" }).click();
  await waitFor(async () => (await wrapLine.evaluate((el) => getComputedStyle(el).whiteSpace)) === "pre-wrap", "linjebryting i forhåndsvisningen");
  await waitFor(async () => { const s = (await h.api("GET", "/api/bootstrap")).settings; return s.codeFont === "liberation" && s.codeFontSize === 16 && s.wrapCode === true; }, "alt er lagret");
});

function chunk(text: string, finish: "stop" | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`;
}

flow("samtalen: GitHub-lenker og lange adresser som chips, filnavn med fargeprikk, og ingenting blir HTML", async (h) => {
  const { page } = h;
  const reply = [
    "PR https://github.com/acme/rakett/pull/25 og sak https://github.com/acme/rakett/issues/7.",
    "[Release v1.1.0](https://github.com/acme/rakett/releases/tag/v1.1.0) og [en pull request](https://github.com/acme/rakett/pull/26).",
    "Dokumentasjon: https://docs.example.com/guide/getting-started/installation/linux/ubuntu?utm=1",
    "Kort: https://example.com/",
    "[tekst](https://example.com/a) og <mailto:test@example.com>.",
    "Filer: `src/ui/Sidebar.tsx`, `README.md:12`, `npm run build`, `server/test/temaer.test.ts` og `a b.ts`.",
    "[<img src=x onerror=alert(1)>](https://github.com/acme/rakett/pull/27)",
    "Matte: $x^2 + 1$.",
  ].join("\n\n");
  const fake = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(chunk(reply, "stop") + "data: [DONE]\n\n");
    });
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  try {
    const baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lenketest", model: "local", contextWindow: 100_000 });
    await page.getByTestId("model-button").click();
    await page.getByRole("option", { name: model.name, exact: true }).click();
    await send(page, "Vis lenkene.");
    const answer = page.locator(".md-math, .md-link-chip").first();
    await answer.waitFor();
    const turn = page.locator(".conversation, .pane-inner").first();

    // PR og issue: kort etikett, tydelig tittel, ikon som SVG.
    const pr = page.locator('a.md-link-github[data-kind="pull"]', { has: page.locator(".md-link-label", { hasText: /^#25$/ }) });
    await pr.waitFor();
    assert.equal(await pr.getAttribute("href"), "https://github.com/acme/rakett/pull/25");
    assert.match((await pr.getAttribute("title")) ?? "", /acme\/rakett#25.*github\.com\/acme\/rakett\/pull\/25/);
    assert.equal(await pr.getAttribute("target"), "_blank");
    assert.match((await pr.getAttribute("rel")) ?? "", /noopener/);
    assert.equal(await pr.locator("svg.md-link-icon").count(), 1);
    assert.equal(await pr.locator("svg").evaluate((el) => el.namespaceURI), "http://www.w3.org/2000/svg");
    const issue = page.locator('a.md-link-github[data-kind="issue"]');
    assert.equal(await issue.locator(".md-link-label").textContent(), "#7");
    // Egen tekst beholdes, med ikon og chip.
    const release = page.locator("a.md-link-github", { hasText: "Release v1.1.0" });
    assert.equal(await release.locator(".md-link-label").textContent(), "Release v1.1.0");
    assert.equal(await release.getAttribute("data-kind"), "release");
    assert.equal(await page.locator('a.md-link-github[data-kind="pull"] .md-link-label', { hasText: "en pull request" }).count(), 1);
    // Lange adresser kortes ned, den fulle adressen står i tittelen.
    const docs = page.locator("a.md-link-chip:not(.md-link-github)", { has: page.locator(".md-link-label", { hasText: "docs.example.com" }) });
    const label = (await docs.locator(".md-link-label").textContent()) ?? "";
    assert.ok(label.length <= 37 && label.endsWith("…"), label);
    assert.ok(label.startsWith("docs.example.com/guide"), label);
    assert.equal(await docs.getAttribute("title"), "https://docs.example.com/guide/getting-started/installation/linux/ubuntu?utm=1");
    assert.equal(await docs.getAttribute("href"), "https://docs.example.com/guide/getting-started/installation/linux/ubuntu?utm=1");
    assert.equal(await page.locator("a.md-link-chip .md-link-label", { hasText: /^example\.com$/ }).count(), 1, "en kort adresse vises hel (uten / på slutten)");
    // v1.4.0: en lenke med egen tekst får også merke og farget tekst, beholder teksten sin og viser
    // adressen ved hover. E-post er fortsatt en vanlig lenke.
    const named = page.locator('a[href="https://example.com/a"]');
    assert.match((await named.getAttribute("class")) ?? "", /\bmd-link-chip\b/);
    assert.equal(await named.getAttribute("data-site"), "web");
    assert.equal(await named.locator(".md-link-label").textContent(), "tekst");
    assert.equal(await named.getAttribute("title"), "https://example.com/a");
    assert.equal(await named.locator("svg.md-link-icon.md-link-monogram").count(), 1);
    assert.equal(await named.locator("svg").evaluate((el) => el.namespaceURI), "http://www.w3.org/2000/svg");
    const mail = page.locator('a[href="mailto:test@example.com"]');
    assert.equal(await mail.count(), 1);
    assert.equal(await mail.getAttribute("class"), null);
    assert.equal(await mail.locator("svg").count(), 0);
    // Filnavn: bare ekte filnavn med kjent endelse får chip.
    const sidebar = page.locator("code.md-file-chip", { hasText: "src/ui/Sidebar.tsx" });
    assert.equal(await sidebar.getAttribute("data-file-ext"), "tsx");
    assert.equal(await page.locator("code.md-file-chip", { hasText: "README.md:12" }).getAttribute("data-file-ext"), "md");
    assert.equal(await page.locator("code.md-file-chip", { hasText: "server/test/temaer.test.ts" }).getAttribute("data-file-ext"), "ts");
    assert.equal(await page.locator("code.md-file-chip", { hasText: "npm run build" }).count(), 0);
    assert.equal(await page.locator("code.md-file-chip", { hasText: "a b.ts" }).count(), 0);
    const dot = await sidebar.evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
    assert.notEqual(dot, "rgba(0, 0, 0, 0)", "prikken har en farge");
    // Ingenting er blitt HTML.
    assert.equal(await turn.locator("img").count(), 0);
    assert.equal(await page.locator("a.md-link-github", { hasText: "<img src=x onerror=alert(1)>" }).count(), 1);
    assert.equal(await page.evaluate(() => (window as any).__xss ?? null), null);

    // Matte: på som standard, og som tekst når den er slått av (gjelder det neste svaret).
    await page.locator("math").first().waitFor();
    await h.api("PATCH", "/api/settings", { renderMath: false });
    await h.reload();
    await page.getByText("$x^2 + 1$").waitFor();
    assert.equal(await page.locator("math").count(), 0);
  } finally {
    fake.close();
  }
});

flow("sidefanen og tråddetaljer: gren og modell under tittelen, Ferdig, og kortet under knappen i toppen", async (h) => {
  const { page } = h;
  execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: h.projectDir });
  const project = await openProject(h, "Demo");
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  const thread = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.projectId === project.id);
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id).title !== "Ny tråd", "tråden har fått navn");

  // Sidefanen: leverandørmerke og gren, og tiden til høyre.
  const row = threadItem(page, thread.id);
  const meta = row.getByTestId("thread-meta");
  await meta.waitFor();
  await meta.locator('svg[data-provider="demo"]').waitFor();
  await meta.locator(".thread-branch").getByText("trunk").waitFor();
  assert.match((await meta.locator(".thread-provider").getAttribute("title")) ?? "", /Demo/);
  // v1.4.1: a finished thread has a green check before its age, and the age stays.
  const check = row.locator(".thread-done");
  await check.waitFor();
  assert.equal(await check.getAttribute("aria-label"), "Ferdig");
  const ok = await check.evaluate((el) => { const probe = document.createElement("span"); probe.style.color = "var(--ok)"; el.parentElement!.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
  assert.equal(await check.evaluate((el) => getComputedStyle(el).color), ok, "grønn hake");
  await row.locator(".thread-time").waitFor();
  // Not seen yet: the same check, named for it.
  await page.keyboard.press("Control+Shift+U");
  const unseen = row.locator(".thread-done[data-unseen]");
  await unseen.waitFor();
  assert.equal(await unseen.getAttribute("aria-label"), "Ferdig, og du har ikke sett svaret");
  assert.equal(await row.locator(".thread-time").count(), 1);
  await page.keyboard.press("Control+Shift+U");
  await unseen.waitFor({ state: "detached" });
  await check.waitFor();
  // Hover-kortet: gren og modell.
  await row.hover();
  const card = page.getByTestId("hover-card-thread");
  await card.waitFor();
  await card.getByTestId("hover-card-branch").getByText("trunk").waitFor();
  await card.getByTestId("hover-card-model").locator("svg.provider-glyph").waitFor();
  await page.mouse.move(700, 600);

  // Tråddetaljer: knappen står i toppen, kortet åpnes under den og lukker panelet ikke.
  const button = page.getByTestId("thread-details-button");
  await button.waitFor();
  assert.equal(await button.getAttribute("aria-expanded"), "false");
  const panelWasOpen = await page.locator(".right-panel").count();
  await button.click();
  const details = page.getByTestId("thread-details-card");
  await details.waitFor();
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".right-panel").count(), panelWasOpen, "kortet åpner ikke sidepanelet");
  const boxes = { button: (await button.boundingBox())!, card: (await details.boundingBox())! };
  assert.ok(boxes.card.y >= boxes.button.y + boxes.button.height - 1, "kortet står under knappen");
  assert.ok(boxes.card.x + boxes.card.width <= boxes.button.x + boxes.button.width + 40, "og er rettet mot høyre");
  await details.getByText("Demo", { exact: true }).waitFor();
  await details.getByTestId("details-vscode").waitFor();
  await details.getByTestId("details-project-settings").waitFor();
  await details.getByTestId("details-branch").getByText("trunk").waitFor();
  await details.getByTestId("details-git").waitFor();
  await details.getByTestId("details-changes").waitFor();
  assert.equal(await details.locator(".details-group").count(), 3);
  assert.equal(await details.getByTestId("details-agent-count").textContent(), "0");
  await page.keyboard.press("Escape");
  await details.waitFor({ state: "detached" });

  // Snarveien åpner og lukker det samme kortet.
  await page.keyboard.press("Control+Shift+D");
  await details.waitFor();
  await page.keyboard.press("Control+Shift+D");
  await details.waitFor({ state: "detached" });

  // Underagenter: trådene som er laget fra denne, i kortet.
  const side = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code", sideOf: thread.id });
  await waitFor(async () => (await page.evaluate(() => document.querySelectorAll("[data-testid='thread-details-button']").length)) === 1, "knappen er der");
  await button.click();
  await details.waitFor();
  await waitFor(async () => (await details.getByTestId("details-agent-count").textContent()) === "1", "én underagent");
  await details.getByTestId("details-agents").click();
  await details.getByTestId("details-agent").getByText(side.title).waitFor();
  // Endringer åpner panelet med endringene.
  await details.getByTestId("details-changes").click();
  await details.waitFor({ state: "detached" });
  await page.locator(".right-panel").waitFor();

  // Prosjektinnstillinger åpner Innstillinger → Prosjekter for dette prosjektet.
  await button.click();
  await page.getByTestId("details-project-settings").click();
  await page.getByTestId("projects-scope").getByRole("button", { name: /Demo/ }).waitFor();
});
