// Round 11 (SPEC 24): a tidy top bar, panel buttons in two styles, a side panel with a start page,
// Chatter in Kode, no side panel in Chat, and the sidebar's ⋯ menu with sections.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { dragTo, flow, openProject, openTool, send, threadItem, toolShown, waitFor } from "./harness.ts";

const settled = (page: Page) => waitFor(async () => (await page.evaluate(() => document.getAnimations().length)) === 0, "bevegelsene er ferdige");

flow("toppfeltet: ingen doble ikoner, ikonene i sin kolonne, tynne skillelinjer og ingen grå flate i ikonraden", async (h) => {
  const { page } = h;
  await openProject(h);
  // Open sidebar: one sidebar button, in the top bar.
  assert.equal(await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).count(), 1);
  await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
  const rail = page.getByRole("navigation", { name: "Snarveier" });
  await rail.waitFor();
  await settled(page);
  // The row has Vis sidefanen, so the top bar has none; and nothing else is in both.
  assert.equal(await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).count(), 0, "ikke dobbelt");
  const railNames = await rail.getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  const topNames = await page.locator(".topbar button:visible").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  assert.deepEqual(railNames.filter((n) => topNames.includes(n)), [], `ingen ikoner både i raden og toppfeltet: ${topNames.join(", ")}`);
  // ☰ stands in the corner above the row, centred on it (after 0.8); back and forward start past the row.
  const railBox = (await rail.boundingBox())!;
  const menu = (await page.getByRole("button", { name: "Meny" }).boundingBox())!;
  assert.ok(Math.abs(menu.x + menu.width / 2 - (railBox.x + railBox.width / 2)) < 2, `menyikonet står midt over raden (${menu.x})`);
  const back = (await page.getByRole("button", { name: "Forrige tråd" }).boundingBox())!;
  assert.ok(back.x >= railBox.x + railBox.width, `tilbake står til høyre for raden (${back.x} < ${railBox.width})`);
  // No grey box behind the mode or the open project, only a bright icon and a thin mark.
  const kode = rail.getByRole("button", { name: "Kode", pressed: true });
  await page.mouse.move(700, 400);
  const look = await kode.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, mark: getComputedStyle(el, "::before").width, group: getComputedStyle(el.parentElement!).backgroundColor }));
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(look.bg), `ingen flate bak Kode: ${look.bg}`);
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(look.group), `ingen flate bak modusene: ${look.group}`);
  assert.equal(look.mark, "2px", "en tynn markør");
  const project = await rail.getByRole("button", { name: "Prosjekt: Demo" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(project), `ingen flate bak prosjektet: ${project}`);
  // The outline: 1 px under the top bar and along the row, faint, in light and in dark.
  for (const theme of ["light", "dark"] as const) {
    await h.api("PATCH", "/api/settings", { theme });
    await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === theme, theme);
    const lines = await page.evaluate(() => {
      const top = getComputedStyle(document.querySelector(".topbar")!);
      const side = getComputedStyle(document.querySelector(".sidebar-rail")!);
      return { width: top.borderBottomWidth, color: top.borderBottomColor, side: side.boxShadow };
    });
    assert.equal(lines.width, "1px", theme);
    const alpha = Number((/\/\s*([\d.]+)\s*\)/.exec(lines.color) ?? /rgba\([^)]*,\s*([\d.]+)\)/.exec(lines.color))?.[1] ?? 1);
    assert.ok(alpha > 0 && alpha < 0.3, `${theme}: svak linje (${lines.color})`);
    assert.match(lines.side, /inset/, `${theme}: linjen langs raden`);
  }
  // Open again: the line follows the sidebar's edge.
  await rail.getByRole("button", { name: "Vis sidefanen" }).click();
  await page.locator(".sidebar").waitFor();
  assert.match(await page.locator(".sidebar").evaluate((el) => getComputedStyle(el).boxShadow), /inset/);
});

flow("rutens knapper i toppfeltet: ingen ekstra linje, ingen Løsriv, og Lukk ruten bare med flere ruter", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await send(page, "hei der");
  await page.locator(".row-text").first().waitFor();
  // One pane: no head of its own, and the buttons stand in the top bar.
  assert.equal(await page.locator(".pane-head:visible").count(), 0, "ingen ekstra linje");
  const top = page.locator(".topbar");
  await top.getByRole("button", { name: "Del til høyre" }).waitFor();
  await top.getByRole("button", { name: "Del nedover" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Lukk ruten" }).count(), 0, "ikke med én rute");
  assert.equal(await page.getByRole("button", { name: "Løsriv", exact: true }).count(), 0, "Løsriv er borte");
  const before = await top.getByRole("button", { name: "Del nedover" }).boundingBox();
  // Two panes: each has a head with its own Lukk ruten, and the top bar keeps its place.
  await page.getByTestId("new-pane").click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 2, "to ruter");
  await settled(page);
  assert.equal(await page.locator(".pane-head:visible").count(), 2);
  assert.equal(await page.locator(".pane-inner").getByRole("button", { name: "Lukk ruten" }).count(), 2);
  assert.equal(await top.getByRole("button", { name: "Lukk ruten" }).count(), 0, "ikke dobbelt i toppfeltet");
  assert.equal(await page.locator(".pane-head").getByRole("button", { name: /Del til høyre|Del nedover/ }).count(), 0, "ikke dobbelt i rutene");
  assert.deepEqual(await top.getByRole("button", { name: "Del nedover" }).boundingBox(), before, "knappene står fast");
  // Del nedover works on the pane with focus.
  await top.getByRole("button", { name: "Del nedover" }).click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 3, "tre ruter");
  await page.locator(".pane-inner").last().getByRole("button", { name: "Lukk ruten" }).click();
  await page.locator(".pane-inner").last().getByRole("button", { name: "Lukk ruten" }).click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 1, "én rute igjen");
  await waitFor(async () => (await page.getByRole("button", { name: "Lukk ruten" }).count()) === 0, "Lukk ruten er borte igjen");
  // Løsriv lives in ⋯ now, for a pane with a thread.
  await top.getByRole("button", { name: "Flere valg" }).click();
  await page.getByRole("menuitem", { name: "Løsriv ruten til eget vindu" }).waitFor();
  // A second click on the button closes the menu.
  await top.getByRole("button", { name: "Flere valg" }).click();
  await waitFor(async () => (await page.getByRole("menu", { name: "Flere valg" }).count()) === 0, "menyen lukkes");
  // The place for the window controls is last, and takes no width in a browser.
  const slot = page.getByTestId("window-controls");
  assert.equal((await slot.boundingBox())?.width ?? 0, 0);
  assert.equal(await page.locator(".topbar-right > *").evaluateAll((els) => els.at(-1)?.getAttribute("data-testid")), "window-controls");
  assert.ok(project.id);
});

flow("panelknapper: Samlet og Hver for seg, valgt i Utseende uten omstart", async (h) => {
  const { page } = h;
  await openProject(h);
  const group = page.getByRole("group", { name: "Panelknapper" });
  // Samlet: ⋯, the panel on and off, a thin line and +.
  assert.equal(await group.getAttribute("data-style"), "together");
  assert.deepEqual(await group.locator("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["Flere valg", "Vis eller skjul panelet", "Legg til sidepanel"]);
  await group.locator(".topbar-divider").waitFor();
  // + lists the panels with their keys, and where the panel stands.
  await group.getByRole("button", { name: "Legg til sidepanel" }).click();
  const add = page.getByRole("menu", { name: "Legg til sidepanel" });
  for (const name of ["Oversikt", "Filer", "Diff", "Terminal", "Nettleser", "Team", "Pull requests", "Agenter", "Tilknyttede pull requests", "Til høyre", "Fullvisning"]) await add.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).waitFor();
  await add.getByRole("menuitemradio", { name: /^Diff/ }).locator("kbd", { hasText: "Ctrl+Alt+2" }).waitFor();
  await add.getByRole("menuitemradio", { name: /^Filer/ }).click();
  await toolShown(page, "Filer");
  await group.getByRole("button", { name: "Legg til sidepanel" }).click();
  await add.getByRole("menuitemradio", { name: /^Filer/, checked: true }).waitFor();
  await add.getByRole("menuitemradio", { name: "Fullvisning" }).click();
  await page.locator(".app.panel-full").waitFor();
  await group.getByRole("button", { name: "Legg til sidepanel" }).click();
  await add.getByRole("menuitemradio", { name: "Til høyre" }).click();
  await waitFor(async () => (await page.locator(".app.panel-full").count()) === 0, "til høyre igjen");

  // Hver for seg, from Innstillinger → Utseende.
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Utseende", exact: true }).click();
  await page.getByRole("group", { name: "Panelknapper" }).getByRole("button", { name: "Hver for seg" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.panelButtons === "separate", "lagret");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await waitFor(async () => (await group.getAttribute("data-style")) === "separate", "Hver for seg");
  assert.deepEqual(await group.locator("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["Flere valg", "Øktpanel", "Terminal", "Diff", "Nettleser", "Filer", "Legg til sidepanel"]);
  // The tips name the panel and its keys; the one that is open is marked.
  assert.match((await group.getByRole("button", { name: "Terminal" }).getAttribute("title")) ?? "", /^Terminal \(Ctrl\+Alt\+3\)$/);
  await group.getByRole("button", { name: "Filer", pressed: true }).waitFor();
  await group.getByRole("button", { name: "Terminal" }).click();
  await toolShown(page, "Terminal");
  await group.getByRole("button", { name: "Terminal", pressed: true }).waitFor();
  // Round 12 (SPEC 26.3): Hver for seg stacks the panels, so Filer stays open beside Terminal.
  await group.getByRole("button", { name: "Filer", pressed: true }).waitFor();
  assert.match((await group.getByRole("button", { name: "Terminal" }).getAttribute("title")) ?? "", /^Skjul Terminal/);
  await group.getByRole("button", { name: "Terminal" }).click();
  await page.getByTestId("stack-panel-terminal").waitFor({ state: "detached" });
  await group.getByRole("button", { name: "Filer" }).click();
  await page.getByTestId("panel-home").waitFor();
  assert.equal(await page.locator(".right-panel").getByRole("tab").count(), 0, "siste lukking viser verktøyvelgeren");
  // Round 12 (SPEC 26.2): Øktpanel opens Økt; Oversikt is in + and on the start page.
  await group.getByRole("button", { name: "Øktpanel" }).click();
  await toolShown(page, "Økt");
  assert.match((await group.getByRole("button", { name: "Øktpanel" }).getAttribute("title")) ?? "", /^Skjul øktpanel/);
  // The shortcuts still work.
  await page.keyboard.press("Control+Alt+2");
  await toolShown(page, "Diff");
  await group.getByRole("button", { name: "Diff", pressed: true }).waitFor();
  // In a narrow window the separate buttons would not fit: Samlet there.
  await page.setViewportSize({ width: 800, height: 800 });
  await waitFor(async () => (await group.getAttribute("data-style")) === "together", "Samlet i smalt vindu");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `ingen vannrett skrolling (${overflow})`);
});

flow("sidepanelet: startside med verktøy som tilpasser seg bredden, uten tom side, og faner øverst som valg", async (h) => {
  const { page } = h;
  // All tools can open without a project; repo-dependent views explain the required context.
  // v0.19: the default "Felles topprad" shows terminal sessions in the panel's shared tab row.
  // This test is about the Terminal's own row ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  if (!(await page.locator(".right-panel").count())) await page.getByRole("button", { name: "Vis eller skjul panelet" }).click();
  const home = page.getByTestId("panel-home");
  await home.waitFor();
  assert.equal(await page.getByText("Oversikten hører til et prosjekt").count(), 0);
  assert.equal(await page.locator(".right-panel").getByRole("button", { name: "Velg prosjekt" }).count(), 0);
  assert.equal(await page.locator(".right-panel [role=tab]").count(), 0, "ingen fanelinje");
  const tiles = () => home.locator(".panel-tool").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-tool")}:${el.getAttribute("aria-disabled") ?? ""}`));
  assert.deepEqual(await tiles(), ["session:", "overview:", "files:", "changes:", "terminal:", "browser:", "side:true", "team:", "github:", "agents:", "linked-prs:"]);
  await home.locator('.panel-tool[data-tool="changes"]').click();
  await toolShown(page, "Diff");
  await page.locator(".right-panel").getByRole("button", { name: "Åpne verktøy", exact: true }).click();
  await home.waitFor();
  await openTool(page, "Terminal");
  await page.getByTestId("terminal-place").getByText("Denne datamaskinen").waitFor();
  // The shared + returns to the chooser without opening a second terminal.
  await page.locator(".right-panel").getByRole("button", { name: "Åpne verktøy", exact: true }).click();
  await home.waitFor();

  // With a project: one, two or three fields after the width, the keys go first, and nothing is cut.
  await openProject(h);
  await home.waitFor();
  const layout = async (width: number) => {
    await page.evaluate((w) => {
      const prefs = JSON.parse(localStorage.getItem("ad-ui") ?? "{}");
      localStorage.setItem("ad-ui", JSON.stringify({ ...prefs, panelWidth: w, panelOpen: true }));
    }, width);
    await h.reload();
    await home.waitFor();
    return home.evaluate((el) => {
      const tools = [...el.querySelectorAll<HTMLElement>(".panel-tool")];
      const columns = new Set(tools.map((t) => Math.round(t.getBoundingClientRect().left))).size;
      const keys = tools.filter((t) => { const k = t.querySelector("kbd"); return k && getComputedStyle(k).display !== "none"; }).length;
      const cut = tools.map((t) => t.querySelector<HTMLElement>(".panel-tool-name")!).filter((n) => n.scrollWidth > n.clientWidth + 0.5).map((n) => n.textContent);
      const over = tools.filter((t) => t.scrollWidth > t.clientWidth + 0.5).length;
      return { columns, keys, cut, over };
    });
  };
  const narrow = await layout(290);
  assert.equal(narrow.columns, 1, "ett felt i et smalt panel");
  assert.ok(narrow.keys > 0, "tastene står når det er plass");
  const mid = await layout(420);
  assert.equal(mid.columns, 2, "to felt");
  const wide = await layout(760);
  assert.equal(wide.columns, 3, "tre felt i et bredt panel");
  assert.ok(wide.keys >= 6, "tastene står i et bredt panel");
  for (const [name, l] of [["290", narrow], ["420", mid], ["760", wide]] as const) {
    assert.deepEqual(l.cut, [], `${name}: ingen navn kuttes`);
    assert.equal(l.over, 0, `${name}: ingenting flyter over`);
  }
  // Oversikt now works; the start page knows the project.
  await home.locator('.panel-tool[data-tool="overview"]').click();
  await toolShown(page, "Oversikt");

  // Faner øverst: the row of tabs, tidied, and no start page.
  await h.api("PATCH", "/api/settings", { panelStart: "tabs" });
  await page.locator(".right-panel [role=tab]").first().waitFor();
  assert.equal(await home.count(), 0);
  await openTool(page, "Filer");
  await toolShown(page, "Filer");
  await h.api("PATCH", "/api/settings", { panelStart: "tools" });
  await page.locator(".right-panel").getByRole("button", { name: "Åpne verktøy", exact: true }).click();
  await home.waitFor();
});

flow("Chat har ikke sidepanel: ingen Nettleser i panelknappene, menyen eller hurtigtasten", async (h) => {
  const { page } = h;
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  await send(page, "hei");
  await page.locator(".row-text").first().waitFor();
  for (const style of ["together", "separate"] as const) {
    await h.api("PATCH", "/api/settings", { panelButtons: style });
    const group = page.getByRole("group", { name: "Panelknapper" });
    await waitFor(async () => (await group.getAttribute("data-style")) === style, style);
    assert.deepEqual(await group.locator("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["Flere valg"], `${style}: bare ⋯ i Chat`);
  }
  assert.equal(await page.getByRole("button", { name: /Nettleser/ }).count(), 0);
  await page.getByRole("button", { name: "Flere valg" }).click();
  assert.equal(await page.getByRole("menuitem", { name: /Nettleser/ }).count(), 0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Alt+4");
  await page.locator(".toast", { hasText: "Sidepanelet med verktøy finnes i Kode" }).waitFor();
  assert.equal(await page.locator(".right-panel").count(), 0, "ingen panel i Chat");
  // Back in Kode, the panel is there as before.
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await page.getByRole("button", { name: "Legg til sidepanel" }).waitFor();
});

flow("Kode-sidefanen: «Chatter» i stedet for «Prosjekter +», og prosjektet dukker opp av seg selv", async (h) => {
  const { page } = h;
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  const heads = () => page.locator(".sidebar-scroll .section-head").evaluateAll((els) => els.map((el) => el.textContent?.trim()));
  await waitFor(async () => (await heads()).join() === "Chatter", "bare Chatter");
  assert.equal(await page.locator('.section-head[data-section="chats"]').getByRole("button").count(), 0, "ingen + ved Chatter");
  assert.equal(await page.getByRole("button", { name: "Nytt prosjekt", exact: true }).count(), 0);
  // A named project created in the message field comes into Chatter by itself.
  const folder = path.join(h.home, "kalkulator");
  mkdirSync(folder);
  await page.getByTestId("project-picker").click();
  const picker = page.getByRole("dialog", { name: "Velg prosjekt" });
  await picker.getByRole("button", { name: "Nytt prosjekt" }).click();
  const dialog = page.getByRole("dialog", { name: "Opprett prosjekt", exact: true });
  await dialog.getByLabel("Prosjektnavn", { exact: true }).fill("kalkulator");
  await page.route("**/api/fs/pick-folder", (route) => route.fulfill({ json: { path: folder } }));
  await dialog.getByRole("button", { name: "Legg til", exact: true }).click();
  await dialog.getByText(folder, { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Opprett prosjekt", exact: true }).click();
  await page.getByRole("dialog", { name: "Stoler du på denne mappen?", exact: true }).getByRole("button", { name: "Stol på mappen", exact: true }).click();
  await page.locator('.group[data-project="kalkulator"]').waitFor();
  await send(page, "hei der");
  await page.locator('.group[data-project="kalkulator"] .thread-item', { hasText: "hei der" }).waitFor();
  // Threads without a project are under Denne datamaskinen, and Festet stays above Chatter.
  const local = await h.api("POST", "/api/threads", { projectId: null, mode: "code" });
  await h.api("PATCH", `/api/threads/${local.id}`, { title: "Uten mappe", pinned: false });
  await page.getByTestId("local-group").locator(".thread-item", { hasText: "Uten mappe" }).waitFor();
  await h.api("PATCH", `/api/threads/${local.id}`, { pinned: true });
  await waitFor(async () => (await heads()).join() === "Festet,Chatter", "Festet over Chatter");
});

flow("sidefanens ⋯-meny: organiser, sorter, vis, og Ny seksjon som tar imot tråder", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const make = async (title: string) => {
    const t = await h.createThread(project.id);
    await h.api("PATCH", `/api/threads/${t.id}`, { title });
    await threadItem(page, t.id).waitFor();
    return t;
  };
  const first = await make("Alfa");
  const second = await make("Bravo");
  const titles = () => page.locator('.group[data-project="Demo"] .thread-title').allTextContents();
  await waitFor(async () => (await titles()).join() === "Bravo,Alfa", "sist oppdatert først");

  // One ⋯ by the icons at the top, the same size and spacing as them, and no old filter button.
  // v1.4.0: in a wide window those icons stand in the top bar, above the sidebar.
  const head = page.locator(".topbar-sidebar-tools");
  assert.equal(await page.locator(".sidebar-head").count(), 0, "ingen egen rad med appnavnet i et bredt vindu");
  const sizes = await head.locator(".icon-button").evaluateAll((els) => els.map((el) => `${el.getBoundingClientRect().width}x${el.getBoundingClientRect().height}`));
  assert.equal(new Set(sizes).size, 1, `lik størrelse: ${sizes.join(" ")}`);
  assert.equal(await page.getByTestId("projects-view").count(), 0, "ikke to menyer for det samme");
  const open = page.getByTestId("sidebar-menu");
  await open.click();
  const menu = page.getByRole("menu", { name: "Valg for sidefanen" });
  await menu.waitFor();
  for (const name of ["Organiser sidepanelet", "Sorter samtaler etter", "Legg til prosjekt…", "Ny seksjon"]) await menu.getByRole("menuitem", { name }).waitFor();
  await menu.getByRole("menuitemcheckbox", { name: "Festet", checked: true }).waitFor();
  // It stays inside the sidebar.
  const side = (await page.locator(".sidebar").boundingBox())!;
  const box = (await menu.boundingBox())!;
  assert.ok(box.x >= side.x && box.x + box.width <= side.x + side.width + 0.5, "inne i sidefanen");
  // Arrows open the submenu, and Esc closes.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("menu", { name: "Sorter samtaler etter" }).waitFor();
  await page.getByRole("menuitemradio", { name: "Sist oppdatert", checked: true }).waitFor();
  await page.getByRole("menuitemradio", { name: "Navn" }).click();
  await waitFor(async () => (await titles()).join() === "Alfa,Bravo", "etter navn");
  await open.click();
  await menu.getByRole("menuitem", { name: "Sorter samtaler etter" }).click();
  await page.getByRole("menuitemradio", { name: "Opprettet" }).click();
  await waitFor(async () => (await titles()).join() === "Bravo,Alfa", "nyest opprettet først");
  await open.click();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await menu.count()) === 0, "Esc lukker");
  // A second click on ⋯ closes it too.
  await open.click();
  await menu.waitFor();
  await open.click();
  await waitFor(async () => (await menu.count()) === 0, "nytt klikk lukker");

  // Organiser: by date, then fold all.
  await open.click();
  await menu.getByRole("menuitem", { name: "Organiser sidepanelet" }).click();
  await page.getByRole("menuitemradio", { name: "Etter dato" }).click();
  await page.getByTestId("project-list").locator(".date-head", { hasText: "I dag" }).waitFor();
  await open.click();
  await menu.getByRole("menuitem", { name: "Organiser sidepanelet" }).click();
  await page.getByRole("menuitemradio", { name: "Etter prosjekt" }).click();
  await open.click();
  await menu.getByRole("menuitem", { name: "Organiser sidepanelet" }).click();
  await page.getByRole("menuitem", { name: "Fold sammen alle" }).click();
  await waitFor(async () => (await threadItem(page, first.id).count()) === 0, "foldet");
  await open.click();
  await menu.getByRole("menuitem", { name: "Organiser sidepanelet" }).click();
  await page.getByRole("menuitem", { name: "Fold ut alle" }).click();
  await threadItem(page, first.id).waitFor();

  // Vis → Festet off: a pinned thread stands where it otherwise belongs.
  await h.api("PATCH", `/api/threads/${first.id}`, { pinned: true });
  await page.locator(".pinned-projects").locator(`[data-thread-item="${first.id}"]`).waitFor();
  await open.click();
  await menu.getByRole("menuitemcheckbox", { name: "Festet" }).click();
  await waitFor(async () => (await page.locator('.section-head[data-section="pinned"]').count()) === 0, "Festet er av");
  await page.locator('.group[data-project="Demo"]').locator(`[data-thread-item="${first.id}"]`).waitFor();
  await open.click();
  await menu.getByRole("menuitemcheckbox", { name: "Festet", checked: false }).click();
  await page.locator('.section-head[data-section="pinned"]').waitFor();
  await h.api("PATCH", `/api/threads/${first.id}`, { pinned: false });

  // + Ny seksjon: named, and kept on the server.
  await open.click();
  await menu.getByRole("menuitem", { name: "Ny seksjon" }).click();
  const prompt = page.getByRole("dialog", { name: "Ny seksjon" });
  await prompt.locator("input").fill("Viktig");
  await prompt.getByRole("button", { name: "Lag seksjonen" }).click();
  const section = page.locator(".user-section", { hasText: "Viktig" });
  await section.waitFor();
  await section.getByText("Dra tråder hit").waitFor();
  const stored = (await h.api("GET", "/api/bootstrap")).sections;
  assert.deepEqual(stored.map((s: any) => [s.name, s.mode]), [["Viktig", "code"]]);
  // From the thread menu.
  await threadItem(page, first.id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Flytt til seksjon" }).click();
  await page.getByRole("menuitemradio", { name: "Viktig" }).click();
  await section.locator(`[data-thread-item="${first.id}"]`).waitFor();
  assert.equal(await page.locator(`[data-thread-item="${first.id}"]`).count(), 1, "ikke vist to ganger");
  // Dragged onto it.
  const from = (await threadItem(page, second.id).boundingBox())!;
  const to = (await section.locator(".section-head").boundingBox())!;
  await dragTo(page, { x: from.x + 40, y: from.y + from.height / 2 }, { x: to.x + 60, y: to.y + to.height / 2 });
  await section.locator(`[data-thread-item="${second.id}"]`).waitFor();
  // Folded, renamed, and kept after a reload.
  await section.locator(".section-fold").click();
  await waitFor(async () => (await section.locator(".thread-item").count()) === 0, "foldet");
  await section.locator(".section-count", { hasText: "2" }).waitFor();
  await section.locator(".section-head").hover();
  await section.getByRole("button", { name: "Valg for Viktig" }).click();
  await page.getByRole("menuitem", { name: "Gi nytt navn…" }).click();
  const rename = page.getByRole("dialog", { name: "Gi seksjonen nytt navn" });
  await rename.locator("input").fill("Nå");
  await rename.getByRole("button", { name: "Lagre" }).click();
  const renamed = page.locator(".user-section", { hasText: "Nå" });
  await renamed.waitFor();
  await h.reload();
  await renamed.waitFor();
  await renamed.locator(".section-count", { hasText: "2" }).waitFor();
  // Deleted: the threads are back where they were.
  await renamed.locator(".section-head").hover();
  await renamed.getByRole("button", { name: "Valg for Nå" }).click();
  await page.getByRole("menuitem", { name: "Slett seksjonen…" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Slette seksjonen?" });
  await confirm.getByText("blir liggende der de var før").waitFor();
  await confirm.getByRole("button", { name: "Slett", exact: true }).click();
  await waitFor(async () => (await page.locator(".user-section").count()) === 0, "seksjonen er borte");
  await page.locator('.group[data-project="Demo"]').locator(`[data-thread-item="${first.id}"]`).waitFor();
  await page.locator('.group[data-project="Demo"]').locator(`[data-thread-item="${second.id}"]`).waitFor();
});

flow("smalt vindu: toppfeltet får plass, og sidepanelet ligger over samtalen", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.setViewportSize({ width: 760, height: 800 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `ingen vannrett skrolling (${overflow})`);
  // Below 860 px there is no row of icons, so the sidebar button is back in the top bar.
  await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).waitFor();
  const right = (await page.locator(".topbar-right").boundingBox())!;
  for (const name of ["Del til høyre", "Flere valg", "Legg til sidepanel"]) {
    const b = (await page.locator(".topbar").getByRole("button", { name }).boundingBox())!;
    assert.ok(b.x >= right.x - 0.5 && b.x + b.width <= right.x + right.width + 0.5, `${name} er inne i toppfeltet`);
  }
  await page.getByRole("button", { name: "Vis eller skjul panelet" }).click();
  await page.getByTestId("panel-home").waitFor();
  const tiles = await page.getByTestId("panel-home").locator(".panel-tool").evaluateAll((els) => els.filter((t) => t.scrollWidth > t.clientWidth + 0.5).length);
  assert.equal(tiles, 0, "ingen fliser flyter over");
});
