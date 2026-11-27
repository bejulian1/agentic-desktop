import assert from "node:assert/strict";
import { flow, openProject } from "./harness.ts";

flow("toppfeltet: ☰ står i hjørnet over ikonraden, og startsiden sier Kode › Denne datamaskinen", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Kode", exact: true }).first().click();
  await page.getByLabel("Vis eller skjul sidefanen").first().click();
  const rail = page.getByTestId("sidebar-rail");
  await rail.waitFor();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const menu = (await page.locator(".topbar .main-menu").boundingBox())!;
  const railBox = (await rail.boundingBox())!;
  const railMiddle = railBox.x + railBox.width / 2;
  assert.ok(Math.abs(menu.x + menu.width / 2 - railMiddle) < 2, "☰ is centred above the row of icons");
  const crumb = page.getByTestId("topbar-crumb");
  await crumb.getByText("Kode", { exact: true }).waitFor();
  await crumb.getByRole("button", { name: /Denne datamaskinen/ }).click();
  await page.getByPlaceholder("Søk på navn eller sti").waitFor();
});

flow("toppfeltet: med sidefanen åpen står stien der hovedfeltet begynner, og prosjektnavnet kuttes ikke", async (h) => {
  const { page } = h;
  await openProject(h, "nettside-med-langt-navn");
  const crumb = page.getByTestId("topbar-crumb");
  await crumb.waitFor();
  assert.equal(await crumb.evaluate((el) => el.parentElement?.className), "topbar-mid", "the crumb is in the middle column");
  const name = crumb.locator(".crumb-project > span").filter({ hasText: "nettside-med-langt-navn" });
  assert.equal(await name.textContent(), "nettside-med-langt-navn");
  assert.ok(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), "the whole name is shown");
  const sidebar = (await page.locator(".sidebar").first().boundingBox())!;
  const box = (await crumb.boundingBox())!;
  assert.ok(box.x >= sidebar.x + sidebar.width - 1, "the crumb starts right of the sidebar");
});
