// v0.5, SPEC 16.2 (agent B): the command palette, the thread menu, hover cards, Rediger prosjekt with
// the icon picker, the profile menu and page, the thread name at the top, Oversikt in the right
// panel, the Browser panel's new tab and ⋯ menu, the smart sidebar with snooze, and the tooltip.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, send, threadItem, waitFor, openTool, toolShown } from "./harness.ts";

const idle = (page: import("playwright-core").Page) => waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");

flow("kommandopaletten: handlinger, chatter, filer og tekst, med piltaster, Tab, Enter og Esc", async (h) => {
  const { page } = h;
  mkdirSync(path.join(h.projectDir, "src"), { recursive: true });
  writeFileSync(path.join(h.projectDir, "src/hovedfil.ts"), "export const svar = 42;\n");
  const project = await openProject(h);
  const thread = await h.createThread(project.id);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Planlegg lanseringen" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp med blåbærsyltetøy" });
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id).running, "svaret er ferdig");

  // Ctrl+K opens it on Alle, with quick actions and recent conversations with their project.
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Kommandopalett" });
  await palette.getByRole("tab", { name: "Alle", selected: true }).waitFor();
  await palette.getByRole("group", { name: "Hurtighandlinger" }).getByRole("option", { name: /Ny tråd/ }).waitFor();
  await palette.getByRole("group", { name: "Nylige tråder" }).getByRole("option", { name: /Planlegg lanseringen.*Demo/ }).waitFor();
  // Tab moves between the tabs, and Shift+Tab back.
  await page.keyboard.press("Tab");
  await palette.getByRole("tab", { name: "Handlinger", selected: true }).waitFor();
  await page.keyboard.press("Shift+Tab");
  await palette.getByRole("tab", { name: "Alle", selected: true }).waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await palette.count()) === 0, "Esc lukker");

  // An action, picked with the arrows and run with Enter.
  await page.keyboard.press("Control+K");
  await page.keyboard.type("innstil");
  await palette.getByRole("option", { name: /Innstillinger/ }).first().waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await page.getByRole("region", { name: "Innstillinger" }).count()) === 0, "innstillingene lukkes");

  // Tråder: the thread search.
  await page.keyboard.press("Control+K");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await palette.getByRole("tab", { name: "Tråder", selected: true }).waitFor();
  await page.keyboard.type("lansering");
  await palette.getByRole("option", { name: /Planlegg lanseringen/ }).waitFor();
  await page.keyboard.press("Enter");
  await page.getByTestId("topbar-title").getByText("Planlegg lanseringen").waitFor();

  // Tekst: words in the messages, not in the title.
  await page.keyboard.press("Control+K");
  await palette.getByRole("tab", { name: "Tekst" }).click();
  await page.keyboard.type("blåbærsyltetøy");
  await palette.getByRole("option", { name: /Planlegg lanseringen.*Treff i meldingene/ }).waitFor();
  await page.keyboard.press("Escape");

  // Filer: the same list as @, and the file opens in the Files panel. Then it is recently opened.
  await page.keyboard.press("Control+K");
  await palette.getByRole("tab", { name: "Filer" }).click();
  await page.keyboard.type("hovedfil");
  await palette.getByRole("option", { name: /hovedfil\.ts/ }).waitFor();
  await page.keyboard.press("Enter");
  await page.locator('.tree-item.selected[data-path="src/hovedfil.ts"]').waitFor();
  await page.getByTestId("editor").getByText("export const svar").waitFor();
  await page.keyboard.press("Control+K");
  await palette.getByRole("group", { name: "Nylig åpnet" }).getByRole("option", { name: /hovedfil\.ts/ }).waitFor();
  await page.keyboard.press("Escape");

  // The Gå menu has it too.
  await page.getByRole("button", { name: "Meny" }).click();
  await page.getByRole("menuitem", { name: "Gå", exact: true }).hover();
  await page.getByRole("menu", { name: "Gå" }).getByRole("menuitemcheckbox", { name: /Kommandopalett/ }).click();
  await palette.waitFor();
  await page.keyboard.press("Escape");
});

flow("trådmenyen, hover-kort, festing, sidechat, kopier og Rediger prosjekt med ikonvelger", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  await idle(page);
  const thread = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.projectId === project.id);
  const item = threadItem(page, thread.id);

  // The hover card: title, project and age.
  await item.hover();
  const card = page.getByTestId("hover-card-thread");
  await card.getByText("hjelp", { exact: true }).waitFor();
  await card.getByText("Demo", { exact: true }).waitFor();
  await card.getByText(/^1 melding$/).waitFor();

  // Right-click gives the menu with shortcuts. Fest puts it under Festet.
  await item.click({ button: "right" });
  const menu = page.locator(".context-menu").first();
  await menu.getByRole("menuitem", { name: /Gi nytt navn.*Ctrl\+Alt\+R/ }).waitFor();
  await menu.getByRole("menuitem", { name: /^Fest/ }).click();
  await page.locator(".pinned-projects").locator(`[data-thread-item="${thread.id}"]`).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id).pinned, true);

  // Kopier › Tråd-ID, from the ⋯ button, through the submenu with the keyboard.
  await item.hover();
  await item.getByRole("button", { name: "Valg for tråden" }).click();
  await menu.getByRole("menuitem", { name: /^Kopier/ }).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator('.context-menu[data-depth="1"]').getByRole("menuitem", { name: "Tråd-ID" }).click();
  await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())) === thread.id, "ID-en er kopiert");

  // Ny sidechat: a new thread in the same project, beside this one, linked back.
  await item.click({ button: "right" });
  await menu.getByRole("menuitem", { name: /Ny sidechat/ }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.parentThreadId === thread.id && t.title === "Sidechat: hjelp"), "sidechatten finnes");
  await page.locator(".pane-title", { hasText: "Sidechat: hjelp" }).waitFor();
  // Lag gaffel › Fra siste melding (round 14 name).
  await item.click({ button: "right" });
  await menu.getByRole("menuitem", { name: /Lag gaffel/ }).hover();
  await page.locator('.context-menu[data-depth="1"]').getByRole("menuitem", { name: "Fra siste melding" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.title === "hjelp (gaffel)"), "gaffelen finnes");
  // Menyen har bare fungerende handlinger, med lokal eksport fremfor en skytjeneste.
  await item.click({ button: "right" });
  assert.equal(await menu.getByRole("menuitem", { name: /Legg til planlagt oppgave/ }).count(), 0);
  await menu.getByRole("menuitem", { name: "Eksporter samtale…" }).waitFor();
  await menu.getByRole("menuitem", { name: /Utsett/ }).waitFor();
  assert.equal(await menu.getByRole("menuitem", { name: /^Del/ }).count(), 0);
  await page.keyboard.press("Escape");
  await waitFor(async () => (await page.locator(".context-menu").count()) === 0, "Esc lukker menyen");

  // The project card has Rediger prosjekt.
  await page.mouse.move(700, 500);
  await page.locator('.group[data-project="Demo"] .group-head').hover();
  const projectCard = page.getByTestId("hover-card-project");
  await projectCard.getByText(h.projectDir).waitFor();
  await projectCard.getByText(/\d tråder i Kode/).waitFor();
  await projectCard.getByRole("button", { name: "Rediger prosjekt" }).click();
  const dialog = page.getByRole("dialog", { name: "Rediger prosjekt" });
  await dialog.getByLabel("Navn").fill("Nettbutikk");
  await dialog.getByRole("button", { name: "Velg ikon" }).click();
  await dialog.getByRole("tab", { name: "Emoji" }).click();
  await dialog.getByLabel("Søk etter ikoner").fill("rakett");
  await dialog.getByRole("radio", { name: "rakett" }).click();
  await dialog.getByRole("radio", { name: "Lilla" }).click();
  await dialog.getByRole("button", { name: "Lagre" }).click();
  await waitFor(async () => {
    const p = (await h.api("GET", "/api/bootstrap")).projects[0];
    return p.name === "Nettbutikk" && p.icon === "emoji:🚀" && p.color === "purple";
  }, "lagret");
  await page.locator('.group[data-project="Nettbutikk"] .project-emoji', { hasText: "🚀" }).waitFor();

  // Fjern prosjektet asks first, and never touches the folder.
  await page.locator('.group[data-project="Nettbutikk"] .group-head').hover();
  await page.getByRole("button", { name: "Valg for prosjektet" }).click();
  await page.getByRole("menuitem", { name: "Rediger prosjekt…" }).click();
  await dialog.getByRole("button", { name: "Fjern prosjektet…" }).click();
  await page.getByRole("dialog", { name: "" }).filter({ hasText: "Fjerne prosjektet?" }).getByRole("button", { name: "Fjern" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).projects.length === 0, "prosjektet er fjernet");
  assert.ok(existsSync(h.projectDir), "mappen er der fortsatt");
});

flow("profilmeny og profilside, trådnavnet øverst, og verktøytips", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { profileName: "Kari Nordmann" });
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  await idle(page);

  // The name at the top: rename with Enter, and details behind ›.
  const title = page.getByTestId("topbar-title");
  await title.getByText("hjelp").waitFor();
  assert.equal(await page.locator(".pane-title:visible").count(), 0, "ikke to ganger med én rute");
  await title.click();
  const field = page.getByLabel("Gi nytt navn");
  await field.fill("Mitt spørsmål");
  await field.press("Enter");
  await title.getByText("Mitt spørsmål").waitFor();
  await title.click();
  await page.getByRole("button", { name: "Samtaledetaljer" }).click();
  const details = page.getByTestId("title-details");
  await details.getByText("Demo-modell (uten API)").waitFor();
  await details.getByText("Ingen (Chat)").waitFor();
  await page.keyboard.press("Escape");

  // The profile menu, and the profile page with the real numbers.
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  const menu = page.locator(".profile-menu");
  await menu.getByText("Kari Nordmann").waitFor();
  // v0.6: the default model and this week's tokens under the name, and a theme switch.
  await waitFor(async () => /Demo-modell \(uten API\) · .* tokens siste 7 dager/.test((await page.getByTestId("profile-menu-sub").textContent()) ?? ""), "modell og tokens");
  await menu.getByRole("menuitemradio", { name: "Mørk", exact: true }).click();
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "mørkt tema");
  await menu.getByRole("menuitemradio", { name: "Lys", exact: true }).click();
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "lyst tema");
  // The arrows move through the rows, theme buttons included.
  await menu.getByRole("menuitem", { name: /^Profil/ }).focus();
  await page.keyboard.press("ArrowDown");
  assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ""), /^Innstillinger/);
  await menu.getByRole("menuitem", { name: /Hjelp/ }).hover();
  const help = page.locator('.context-menu[data-depth="1"]');
  await help.getByRole("menuitem", { name: /Kommandoer/ }).waitFor();
  await help.getByRole("menuitem", { name: /Hva er nytt/ }).click();
  await page.getByRole("dialog", { name: "Hva er nytt" }).locator(".whatsnew-entry").first().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  await menu.getByRole("menuitem", { name: /^Profil/ }).click();
  const profile = page.getByTestId("profile-page");
  await profile.getByRole("heading", { name: "Kari Nordmann" }).waitFor();
  await profile.locator(".profile-avatar", { hasText: "KN" }).waitFor();
  const tiles = page.getByTestId("profile-tiles");
  for (const label of ["Totalt antall tokens", "Høyeste antall tokens på en dag", "Lengste oppgave", "Lengste rekke", "Nåværende rekke"]) await tiles.getByText(label).waitFor();
  await tiles.locator(".profile-tile", { hasText: "Nåværende rekke" }).getByText("1 dag").waitFor();
  const cells = await page.getByTestId("profile-daily").locator("rect").count();
  assert.ok(cells >= 52 * 7 + 1 && cells <= 53 * 7, `et år med dager (${cells})`);
  await profile.getByRole("tab", { name: "Ukentlig" }).click();
  await page.getByTestId("profile-weekly").waitFor();
  await profile.getByRole("tab", { name: "Akkumulert" }).click();
  await page.getByTestId("profile-cumulative").waitFor();
  // Going to a thread leaves the page.
  await page.locator(".thread-item").first().click();
  await waitFor(async () => (await profile.count()) === 0, "profilsiden lukkes");

  // One tooltip for the app, with the chosen shortcut.
  await page.locator(".sidebar .mode-button").first().hover();
  const tip = page.locator(".app-tooltip.visible");
  await tip.getByText("Chat: samtale uten prosjekt").waitFor();
  await tip.locator("kbd", { hasText: "Ctrl+Shift+M" }).waitFor();
  await page.mouse.move(700, 600);
  await waitFor(async () => (await tip.count()) === 0, "tipset forsvinner");
});

flow("høyre panel: Oversikt med kontekst, bakgrunnsoppgaver og utdata, endringsbrikken og nettleserens ny fane og meny", async (h) => {
  const { page } = h;
  // v0.19: the default "Felles topprad" shows browser pages in the panel's shared tab row. This
  // test is about the Nettleser's own tab strip ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });

  // A new tab before anything is open: tools, and suggestions once there are any (round 10: from
  // the projects).
  await openTool(page, "Nettleser");
  const newtab = page.getByTestId("browser-newtab");
  await newtab.getByRole("button", { name: "Terminal" }).waitFor();
  await newtab.getByText("foreslås her").waitFor();
  await newtab.getByRole("button", { name: "Filer" }).click();
  await toolShown(page, "Filer");

  await send(page, "lag en side");
  await page.getByText("Ferdig. ").waitFor({ timeout: 40_000 });
  await idle(page);

  // The chip at the top says what the thread changed, and opens Endringer.
  await page.getByTestId("pinned-summary").click();
  const chip = page.getByTestId("changes-chip");
  await chip.getByText("· 1 fil").waitFor();
  await chip.click();
  await toolShown(page, "Endringer");

  await openTool(page, "Oversikt");
  const overview = page.getByTestId("overview-panel");
  await overview.getByText("Denne datamaskinen").waitFor();
  await waitFor(async () => /\d.* % brukt/.test((await page.getByTestId("context-used").textContent()) ?? ""), "kontekstbruken vises");
  for (const part of ["messages", "system", "tools", "compactBuffer", "free"]) await overview.locator(`[data-part="${part}"]`).waitFor();
  await page.getByTestId("background-tasks").locator('.task-row[data-task="command"]').first().waitFor();
  await page.getByTestId("background-tasks").getByText("Avsluttet").waitFor();
  await overview.getByRole("region", { name: "Utdata" }).getByRole("button", { name: /index\.html/ }).click();
  await page.locator('.tree-item.selected[data-path="index.html"]').waitFor();

  // The agent uses its own tab; keep the user's new tab, then explicitly select the local page.
  await openTool(page, "Nettleser");
  await page.locator('.browser-tab[title*="127.0.0.1"], .browser-tab[title*="localhost"]').getByRole("tab").click();
  await page.getByTestId("browser-canvas").waitFor();
  await page.getByRole("button", { name: "Mer for nettleseren" }).click();
  await page.getByRole("button", { name: "Zoom inn" }).click();
  await page.locator(".browser-zoom-value", { hasText: "110 %" }).waitFor();
  await page.getByRole("button", { name: "Faktisk størrelse" }).click();
  await page.locator(".browser-zoom-value", { hasText: "100 %" }).waitFor();
  await page.locator(".browser-menu").getByRole("menuitem", { name: /Historikk/ }).hover();
  await page.locator('.context-menu[data-depth="1"]').getByRole("menuitem", { name: /localhost|127\.0\.0\.1/ }).waitFor();
  await page.locator(".browser-menu").getByRole("menuitem", { name: /Finn på siden/ }).click();
  const find = page.getByRole("search", { name: "Finn på siden" }).getByRole("textbox");
  await find.fill("Klikket");
  await find.press("Enter");
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".browser-find-miss").count(), 0, "teksten finnes");
  await find.fill("finnes ikke på siden");
  await find.press("Enter");
  await page.locator(".browser-find-miss", { hasText: "Ikke funnet" }).waitFor();
});

flow("smart sidefane: kort for det som trenger deg, Utsett og hent tilbake, og favicon som prosjektikon", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#e4572e"/></svg>');
  const project = await openProject(h);
  await page.locator('.group[data-project="Demo"] img.project-favicon').waitFor();
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  await idle(page);
  const thread = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.projectId === project.id);

  await h.api("PATCH", "/api/settings", { sidebarLayout: "smart" });
  const smart = page.getByTestId("smart-sidebar");
  const card = smart.locator(`[data-smart-card="${thread.id}"]`);
  await card.getByText("hjelp").waitFor();
  await card.getByText("Demo").waitFor();
  await smart.locator('[data-group="snoozed"] .smart-count', { hasText: "0" }).waitFor();

  // Utsett › Om 1 time: out of the list, into Utsatt, and back again from there.
  await card.click({ button: "right" });
  await page.locator(".context-menu").first().getByRole("menuitem", { name: /Utsett/ }).hover();
  await page.locator('.context-menu[data-depth="1"]').getByRole("menuitem", { name: "Om 1 time" }).click();
  await smart.locator('[data-group="snoozed"] .smart-count', { hasText: "1" }).waitFor();
  const snoozedUntil = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id).snoozedUntil;
  assert.ok(snoozedUntil > Date.now() + 50 * 60_000, "om en time");
  await smart.getByRole("button", { name: /Utsatt/ }).click();
  const snoozed = smart.locator(`[data-group="snoozed"] [data-smart-card="${thread.id}"]`);
  await snoozed.getByRole("button", { name: "Hent tilbake" }).click();
  await smart.locator('[data-group="snoozed"] .smart-count', { hasText: "0" }).waitFor();
  await smart.locator(`.smart-scroll [data-smart-card="${thread.id}"]`).waitFor();

  // A card opens its thread.
  await page.getByRole("button", { name: "Ny tråd", exact: true }).first().click();
  await smart.locator(`.smart-scroll [data-smart-card="${thread.id}"] .smart-card-title`).click();
  await page.getByTestId("topbar-title").getByText("hjelp").waitFor();

  // Back to the standard sidebar: everything is where it was.
  await h.api("PATCH", "/api/settings", { sidebarLayout: "standard" });
  await threadItem(page, thread.id).waitFor();
  await page.locator(".sidebar-nav").getByRole("button", { name: /Artifacts/ }).waitFor();
});
