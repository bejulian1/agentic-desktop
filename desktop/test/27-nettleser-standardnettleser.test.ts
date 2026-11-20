// Issue #12: in Electron, "Åpne i standardnettleseren" hands the active HTTP(S) tab's URL
// to the app's existing external-link handler (openOutside / shell.openExternal) and preserves
// the tab in the browser panel.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { apiCall, closeAll, launch, sandbox, waitFor, type Running } from "./helpers.ts";

function localTestSite(): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (req.url === "/side-b") {
      return res.end("<!doctype html><title>Side B</title><h1>Side B</h1>");
    }
    res.end("<!doctype html><title>Side A</title><h1>Side A</h1>");
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server })),
  );
}

test("Åpne i standardnettleseren sender aktiv fanes adresse til systemnettleseren og bevarer fanen", async () => {
  const box = sandbox();
  const site = await localTestSite();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, windowState } = running;
    await apiCall(page, "PATCH", "/api/settings", { cookieOffer: "never", panelButtons: "separate" });
    await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();

    // Open the Browser panel from the panel buttons.
    await page.getByRole("group", { name: "Panelknapper" }).getByRole("button", { name: "Nettleser" }).click();
    const rightPanel = page.locator(".right-panel");
    const panel = page.getByTestId("browser-panel");
    await panel.waitFor({ timeout: 15_000 });
    const address = panel.getByRole("textbox", { name: "Adresse" });
    const moreBtn = panel.getByRole("button", { name: "Mer for nettleseren" });
    await moreBtn.click();
    assert.equal(await page.getByRole("menuitem", { name: "Åpne i standardnettleseren" }).isDisabled(), true);
    await page.keyboard.press("Escape");

    // Navigate tab 1 to /side-a.
    const urlA = `${site.baseUrl}/side-a`;
    await address.fill(urlA);
    await address.press("Enter");
    await rightPanel.getByRole("tab", { name: /Side A/ }).waitFor({ timeout: 20_000 });

    // Open tab 2 via the menu and navigate to /side-b.
    await moreBtn.click();
    await page.getByRole("menuitem", { name: "Ny nettleserfane" }).click();
    const urlB = `${site.baseUrl}/side-b`;
    await address.fill(urlB);
    await address.press("Enter");
    await rightPanel.getByRole("tab", { name: /Side B/ }).waitFor({ timeout: 20_000 });

    // Trigger "Åpne i standardnettleseren" on Side B.
    await moreBtn.click();
    await page.getByRole("menuitem", { name: "Åpne i standardnettleseren" }).click();
    await waitFor(() => existsSync(box.externalLog) && readFileSync(box.externalLog, "utf8").includes(urlB), "Side B sendt til systemnettleseren");

    // Switch back to Side A and trigger "Åpne i standardnettleseren".
    await rightPanel.getByRole("tab", { name: /Side A/ }).click();
    await page.waitForFunction((expected) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="browser-panel"] input[aria-label="Adresse"]');
      return input?.value === expected;
    }, urlA);

    await moreBtn.click();
    await page.getByRole("menuitem", { name: "Åpne i standardnettleseren" }).click();
    await waitFor(() => existsSync(box.externalLog) && readFileSync(box.externalLog, "utf8").includes(urlA), "Side A sendt til systemnettleseren");

    const sent = readFileSync(box.externalLog, "utf8").trim().split("\n");
    assert.deepEqual(sent, [urlB, urlA]);
    assert.equal((await windowState()).count, 1, "ingen ekstra Electron-vindu åpnes");
    assert.equal(await rightPanel.getByRole("tab", { name: /Side A/ }).count(), 1, "Side A-fanen er bevart");
    assert.equal(await rightPanel.getByRole("tab", { name: /Side B/ }).count(), 1, "Side B-fanen er bevart");
  } finally {
    await closeAll(running);
    await new Promise<void>((resolve) => site.server.close(() => resolve()));
    box.cleanup();
  }
});
