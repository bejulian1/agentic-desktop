// The model's tab is visible and can be inspected without replacing manual browsing.
import assert from "node:assert/strict";
import { flow, openProject, openTool, send, waitFor } from "./harness.ts";

flow("nettleserpanelet viser trådens egen fane og lar brukeren gå tilbake til manuell fane", async (h) => {
  const { page } = h;
  // v0.19: the default "Felles topprad" shows browser pages in the panel's shared tab row. This
  // test is about the Nettleser's own tab strip ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await openTool(page, "Nettleser");
  await page.getByTestId("browser-newtab").waitFor();
  const manual = await page.locator(".browser-tab.active").getAttribute("data-tab");
  assert.notEqual(manual, null);
  await send(page, "lag en side");
  await page.getByText("Ferdig. ").waitFor({ timeout: 60_000 });
  await waitFor(async () => (await page.locator(".browser-tab").count()) === 2, "manuell fane og trådens fane");
  assert.equal(await page.locator(".browser-tab.active").getAttribute("data-tab"), manual);
  await page.getByTestId("browser-newtab").waitFor();
  const inspect = page.getByRole("button", { name: "Vis fanen til denne tråden", exact: true });
  await inspect.click();
  await waitFor(async () => (await page.locator(".browser-tab.active").getAttribute("data-tab")) !== manual, "viser trådens fane");
  assert.match((await page.locator(".browser-tab.active").innerText()).trim(), /lag en side ·/);
  await waitFor(async () => /\/index\.html$/.test(await page.locator(".browser-bar input").inputValue()), "trådens sideadresse");
  assert.equal(await inspect.count(), 0, "knappen trengs bare når en annen fane vises");
  await page.locator(".browser-tab").filter({ has: page.getByRole("tab", { name: "Ny fane", exact: true }) }).getByRole("tab").click();
  await page.getByTestId("browser-newtab").waitFor();
  await inspect.waitFor();
  await h.reload();
  await openTool(page, "Nettleser");
  await waitFor(async () => (await page.locator(".browser-tab").count()) === 2, "trådeierskap etter omlasting");
  await page.getByRole("tab", { name: /lag en side ·/ }).waitFor();
  await page.getByRole("button", { name: "Vis fanen til denne tråden", exact: true }).click();
  await waitFor(async () => /\/index\.html$/.test(await page.locator(".browser-bar input").inputValue()), "samme trådfane etter omlasting");
});
