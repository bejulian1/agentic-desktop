// Round 12, part B (SPEC 26.1 to 26.4): Økt among the panel tools, panels stacked side by side and
// over and under each other with «Hver for seg», the cookie offer the first time the Browser panel
// opens, and + dimmed by a project whose folder is gone. Fake browser profiles only, in the
// harness's temporary home; a fake secret-tool is first on the server's PATH.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import type { Page } from "playwright-core";
import { makeChromeProfile, makeSecretTool } from "../../server/test/runde12-fakes.ts";
import { flow, openProject, ROOT, send, toolShown, waitFor, type Harness } from "./harness.ts";

const SHOTS = path.join(ROOT, "docs/screenshots/runde12");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, name) });

const fakeBin = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-ui-fake-bin-")));
makeSecretTool(fakeBin);
after(() => rmSync(fakeBin, { recursive: true, force: true }));
const env = { PATH: `${fakeBin}:${path.join(ROOT, "web/test/bin")}:${process.env.PATH}` };

const settled = (page: Page) => waitFor(async () => (await page.evaluate(() => document.getAnimations().length)) === 0, "bevegelsene er ferdige");
const box = async (page: Page, tool: string) => (await page.getByTestId(`stack-panel-${tool}`).boundingBox())!;

async function separate(h: Harness): Promise<void> {
  await h.api("PATCH", "/api/settings", { panelButtons: "separate" });
  await waitFor(async () => (await h.page.getByRole("group", { name: "Panelknapper" }).getAttribute("data-style")) === "separate", "Hver for seg");
}

async function addPanel(page: Page, name: string, place?: "Til høyre" | "Under"): Promise<void> {
  const menu = page.getByRole("menu", { name: "Legg til sidepanel" });
  if (place) {
    await page.getByRole("button", { name: "Legg til sidepanel" }).click();
    await menu.getByRole("menuitemradio", { name: place, exact: true }).click();
  }
  await page.getByRole("button", { name: "Legg til sidepanel" }).click();
  await menu.getByRole("menuitemradio", { name: new RegExp(`^${name}(\\s|$)`) }).click();
}

flow("Økt er et panelverktøy: knappen Øktpanel, startsiden og +, og Oversikt står igjen i +", async (h) => {
  const { page } = h;
  await openProject(h);
  await send(page, "hei");
  await page.locator(".row-text").first().waitFor();
  // Samlet: Økt is a tile on the start page and a tool in +.
  if (!(await page.locator(".right-panel").count())) await page.getByRole("button", { name: "Vis eller skjul panelet" }).click();
  await page.getByTestId("panel-home").locator('.panel-tool[data-tool="session"]').click();
  await page.locator(".right-panel").getByTestId("session-panel").getByText("Denne datamaskinen").waitFor();
  await toolShown(page, "Økt");

  // Hver for seg: Øktpanel opens Økt; Oversikt is not a button but is in +.
  await separate(h);
  const group = page.getByRole("group", { name: "Panelknapper" });
  assert.deepEqual(await group.locator("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["Flere valg", "Øktpanel", "Terminal", "Endringer", "Nettleser", "Filer", "Legg til sidepanel"]);
  await group.getByRole("button", { name: "Øktpanel", pressed: true }).waitFor();
  await page.getByTestId("stack-panel-session").getByTestId("session-panel").waitFor();
  await page.getByRole("button", { name: "Legg til sidepanel" }).click();
  const add = page.getByRole("menu", { name: "Legg til sidepanel" });
  await add.getByRole("menuitemradio", { name: /^Oversikt/ }).waitFor();
  await add.getByRole("menuitemradio", { name: /^Økt/, checked: true }).waitFor();
  await add.getByRole("menuitemradio", { name: "Under", exact: true }).waitFor();
  await add.getByRole("menuitemradio", { name: /^Oversikt/ }).click();
  await page.getByTestId("stack-panel-overview").waitFor();
  // The shortcut for Økt, Ctrl+Alt+7, and Øktpanel closes only its own panel.
  await group.getByRole("button", { name: "Øktpanel" }).click();
  await page.getByTestId("stack-panel-session").waitFor({ state: "detached" });
  await page.getByTestId("stack-panel-overview").waitFor();
  await page.keyboard.press("Control+Alt+7");
  await page.getByTestId("stack-panel-session").waitFor();
});

flow("stablede paneler: Økt ved siden av Terminal over Nettleser, skiller som dras, dobbeltklikk, maksimer, flytting med målflate, og husket per prosjekt", async (h) => {
  const { page } = h;
  await page.setViewportSize({ width: 1440, height: 900 });
  // v0.19: the default "Felles topprad" shows terminal sessions in the panel's shared tab row.
  // This test is about the stacked Terminal's and Nettleser's own tabs in their heads ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  await openProject(h);
  await send(page, "hei");
  await page.locator(".row-text").first().waitFor();
  await separate(h);
  const group = page.getByRole("group", { name: "Panelknapper" });
  if (await page.locator(".right-panel").count()) await page.keyboard.press("Control+Shift+B");
  await waitFor(async () => (await page.locator(".right-panel").count()) === 0, "panelet er lukket");

  // Økt first, then Terminal in a column to the right, then Nettleser under Terminal.
  await group.getByRole("button", { name: "Øktpanel" }).click();
  await page.getByTestId("stack-panel-session").waitFor();
  const before = (await page.locator(".right-panel").boundingBox())!.width;
  await addPanel(page, "Terminal", "Til høyre");
  await page.getByTestId("stack-panel-terminal").locator(".stack-head .terminal-tabs").waitFor();
  await waitFor(async () => (await page.locator(".right-panel").boundingBox())!.width > before + 200, "panelet blir bredere for en ny kolonne");
  await addPanel(page, "Nettleser", "Under");
  await page.getByTestId("stack-panel-browser").locator(".stack-head .browser-tablist").waitFor();
  // Every separate button that is open is marked.
  for (const name of ["Øktpanel", "Terminal", "Nettleser"]) await group.getByRole("button", { name, pressed: true }).waitFor();
  assert.equal(await group.getByRole("button", { name: "Filer", pressed: true }).count(), 0);
  const [session, terminal, browser] = [await box(page, "session"), await box(page, "terminal"), await box(page, "browser")];
  assert.ok(terminal.x >= session.x + session.width - 1, "Terminal står til høyre for Økt");
  assert.ok(Math.abs(browser.x - terminal.x) < 2 && browser.y >= terminal.y + terminal.height - 1, "Nettleser står under Terminal");
  assert.ok(Math.abs(session.height - (terminal.height + browser.height)) < 3, "Økt går over hele høyden");
  // Each has a slim top line with ⋯, Maksimer and Lukk; Terminal and Nettleser have their tabs and + there.
  for (const [tool, label] of [["session", "Økt"], ["terminal", "Terminal"], ["browser", "Nettleser"]] as const) {
    const head = page.getByTestId(`stack-panel-${tool}`).locator(".stack-head");
    for (const name of [`Mer for ${label}`, `Maksimer ${label}`, `Lukk ${label}`]) await head.getByRole("button", { name, exact: true }).waitFor();
    assert.ok((await head.boundingBox())!.height <= 37, "slank topplinje");
  }
  await page.getByTestId("stack-panel-terminal").locator(".stack-head").getByRole("button", { name: "Ny terminal" }).waitFor();
  await page.getByTestId("stack-panel-browser").locator(".stack-head").getByRole("button", { name: /Ny nettleserfane/ }).first().waitFor();
  await settled(page);
  await shot(page, "11-stablede-paneler.png");

  // A divider moves the sizes directly, with no animation, and a double click shares equally.
  const start = await box(page, "session");
  const divider = page.getByTestId("stack-divider-c0");
  const d = (await divider.boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + 200);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2 - 40, d.y + 200, { steps: 3 });
  await page.mouse.move(d.x + d.width / 2 - 80, d.y + 200, { steps: 3 });
  await page.waitForTimeout(40);
  const during = await page.evaluate(() => document.querySelectorAll(".stack-panel").length && document.getAnimations().filter((a) => (a as CSSAnimation).animationName && (a.effect as KeyframeEffect)?.target instanceof Element && ((a.effect as KeyframeEffect).target as Element).closest(".stack-root")).length);
  assert.equal(during, 0, "ingen animasjon mens skillet dras");
  await page.mouse.up();
  const narrowed = await box(page, "session");
  assert.ok(Math.abs(narrowed.width - (start.width - 80)) < 4, `Økt ble 80 px smalere (${start.width} → ${narrowed.width})`);
  await divider.dblclick({ position: { x: 3, y: 120 } });
  await waitFor(async () => Math.abs((await box(page, "session")).width - (await box(page, "terminal")).width) < 3, "lik plass etter dobbeltklikk");
  const rowDivider = page.getByTestId("stack-divider-r1:0");
  const r = (await rowDivider.boundingBox())!;
  await page.mouse.move(r.x + 100, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + 100, r.y + r.height / 2 - 120, { steps: 4 });
  await page.mouse.up();
  const shorter = (await box(page, "terminal")).height;
  assert.ok(shorter < terminal.height - 100, "Terminal ble lavere");

  // Kept for the project, through a reload.
  await h.reload();
  await page.getByTestId("stack-panel-browser").waitFor();
  assert.ok(Math.abs((await box(page, "terminal")).height - shorter) < 3, "høyden er husket");
  assert.ok(Math.abs((await box(page, "session")).width - (await box(page, "terminal")).width) < 3, "bredden er husket");

  // Maksimer and Gjenopprett: the terminal keeps its tab, nothing is mounted again.
  const terminalId = await page.getByTestId("terminal").getAttribute("data-terminal-id");
  await page.getByRole("button", { name: "Maksimer Terminal" }).click();
  await waitFor(async () => (await box(page, "terminal")).height > shorter + 300, "Terminal fyller panelet");
  assert.equal(await page.getByTestId("stack-panel-browser").isVisible(), false);
  await page.getByRole("button", { name: "Gjenopprett Terminal" }).click();
  await page.getByTestId("stack-panel-browser").waitFor();
  assert.equal(await page.getByTestId("terminal").getAttribute("data-terminal-id"), terminalId, "samme terminal");

  // Dragged by its top line, a panel shows where it lands, and lands there.
  const from = (await page.getByTestId("stack-panel-browser").locator(".stack-head .stack-title").boundingBox())!;
  const target = await box(page, "session");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x - 40, from.y + 40, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height - 30, { steps: 8 });
  const drop = page.getByTestId("stack-drop");
  await drop.getByText("Under Økt").waitFor();
  const field = (await drop.boundingBox())!;
  assert.ok(field.y >= target.y + target.height / 2 - 2 && Math.abs(field.width - target.width) < 4, "målflaten er nedre halvdel av Økt");
  await page.waitForTimeout(200);
  await shot(page, "12-flytt-panel-malflate.png");
  await page.mouse.up();
  await waitFor(async () => {
    const [s, b] = [await box(page, "session"), await box(page, "browser")];
    return Math.abs(s.x - b.x) < 2 && b.y > s.y;
  }, "Nettleser står under Økt");
  assert.equal(await page.getByTestId("terminal").getAttribute("data-terminal-id"), terminalId, "terminalen er ikke startet på nytt");

  // ⋯ moves too.
  await page.getByRole("button", { name: "Mer for Nettleser", exact: true }).click();
  await page.getByRole("menu", { name: "Mer for Nettleser", exact: true }).getByRole("menuitem", { name: "Flytt opp" }).click();
  await waitFor(async () => (await box(page, "browser")).y < (await box(page, "session")).y, "Nettleser over Økt");

  // Lukk closes one; the last one returns to the shared chooser.
  await page.getByRole("button", { name: "Lukk Nettleser", exact: true }).click();
  await page.getByTestId("stack-panel-browser").waitFor({ state: "detached" });
  assert.equal(await group.getByRole("button", { name: "Nettleser", pressed: true }).count(), 0);
  await page.getByRole("button", { name: "Lukk Økt", exact: true }).click();
  await page.getByRole("button", { name: "Lukk Terminal", exact: true }).click();
  await page.getByTestId("panel-home").waitFor();
  assert.equal(await page.locator(".right-panel").isVisible(), true);

  // Samlet: one tool at a time, as before, and the stack waits for later.
  await group.getByRole("button", { name: "Terminal" }).click();
  await page.getByTestId("stack-panel-terminal").waitFor();
  await h.api("PATCH", "/api/settings", { panelButtons: "together" });
  await page.locator(".right-panel").getByRole("tablist", { name: "Åpne verktøy" }).waitFor();
  assert.equal(await page.getByTestId("panel-stack").count(), 0);
  // Below 860 px, one panel too.
  await h.api("PATCH", "/api/settings", { panelButtons: "separate" });
  await page.getByTestId("panel-stack").waitFor();
  await page.setViewportSize({ width: 820, height: 800 });
  await waitFor(async () => (await page.getByTestId("panel-stack").count()) === 0, "ett panel i smalt vindu");
}, { theme: "dark" });

flow("første gang nettleserpanelet åpnes: tilbudet om informasjonskapsler, Ikke nå for økten og Ikke vis igjen for godt", async (h) => {
  const { page } = h;
  makeChromeProfile(h.home, [{ host: ".example.com", name: "sid", value: "x" }]);
  await openProject(h);
  await separate(h);
  const group = page.getByRole("group", { name: "Panelknapper" });
  await group.getByRole("button", { name: "Nettleser" }).click();
  const dialog = page.getByTestId("cookie-dialog");
  await dialog.getByRole("heading", { name: "Forbli innlogget på nettstedene dine" }).waitFor();
  await dialog.getByRole("button", { name: "Ikke vis igjen" }).waitFor();
  await settled(page);
  await shot(page, "13-tilbud-forste-gang.png");
  await dialog.getByRole("button", { name: "Ikke nå" }).click();
  await dialog.waitFor({ state: "detached" });
  // Not again in this session.
  await group.getByRole("button", { name: "Nettleser" }).click();
  await group.getByRole("button", { name: "Nettleser" }).click();
  await page.getByTestId("browser-panel").waitFor();
  await page.waitForTimeout(400);
  assert.equal(await dialog.count(), 0);
  // After a reload it is offered again, until it is answered for good.
  await h.reload();
  await page.getByTestId("browser-panel").waitFor();
  await dialog.getByRole("button", { name: "Ikke vis igjen" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.cookieOffer === "never", "lagret");
  await h.reload();
  await page.getByTestId("browser-panel").waitFor();
  await page.waitForTimeout(400);
  assert.equal(await dialog.count(), 0, "aldri igjen");
}, { env });

flow("uten nettleserprofiler kommer ikke tilbudet, og + ved et prosjekt uten mappe er dempet med et tips", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await page.keyboard.press("Control+Alt+4");
  await page.getByTestId("browser-panel").waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.getByTestId("cookie-dialog").count(), 0, "ingen profil, ingen dialog");

  const thread = await h.createThread(project.id);
  rmSync(h.projectDir, { recursive: true, force: true });
  await h.reload();
  const groupHead = page.locator(`.group[data-project="${project.name}"]`).first();
  await groupHead.locator(".group-head").hover();
  const plus = groupHead.getByRole("button", { name: `Ny tråd i ${project.name}` });
  await waitFor(async () => (await plus.getAttribute("aria-disabled")) === "true", "+ er dempet");
  assert.match((await plus.getAttribute("title")) ?? "", /Mappen mangler/);
  const threads = (await h.api("GET", "/api/bootstrap")).threads.length;
  await plus.click({ force: true });
  await page.waitForTimeout(300);
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, threads, "ingen ny tråd");
  await shot(page, "14-pluss-dempet-mappe-mangler.png");
  mkdirSync(h.projectDir, { recursive: true });
  await h.api("POST", `/api/projects/${project.id}/relink`, { path: h.projectDir });
  await waitFor(async () => (await plus.getAttribute("aria-disabled")) === null, "+ virker igjen");
  void thread;
});
