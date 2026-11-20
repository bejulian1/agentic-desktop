// Issue #12: "Åpne i standardnettleseren" in the browser panel menu opens the active HTTP(S) tab
// in a normal browser tab (localhost mode) and preserves the tab in the panel.
import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { flow, openTool } from "./harness.ts";

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

flow("Åpne i standardnettleseren åpner riktig fane og bevarer fanene i panelet", async (h) => {
  const site = await localTestSite();
  try {
    const { page } = h;
    await h.api("PATCH", "/api/settings", { cookieOffer: "never" });
    await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
    await openTool(page, "Nettleser");
    const rightPanel = page.locator(".right-panel");
    const panel = page.getByTestId("browser-panel");
    await panel.waitFor({ timeout: 15_000 });
    const address = panel.getByRole("textbox", { name: "Adresse" });
    const moreBtn = panel.getByRole("button", { name: "Mer for nettleseren" });

    // Disabled on a blank new tab.
    await moreBtn.click();
    const openExternalItem = page.getByRole("menuitem", { name: "Åpne i standardnettleseren" });
    await openExternalItem.waitFor();
    assert.equal(await openExternalItem.isDisabled(), true, "deaktivert på tom fane");
    await page.keyboard.press("Escape");

    // Navigate tab 1 to /side-a.
    const urlA = `${site.baseUrl}/side-a`;
    await address.fill(urlA);
    await address.press("Enter");
    await rightPanel.getByRole("tab", { name: /Side A/ }).waitFor({ timeout: 15_000 });

    // Open tab 2 via the menu and navigate to /side-b.
    await moreBtn.click();
    await page.getByRole("menuitem", { name: "Ny nettleserfane" }).click();
    const urlB = `${site.baseUrl}/side-b`;
    await address.fill(urlB);
    await address.press("Enter");
    await rightPanel.getByRole("tab", { name: /Side B/ }).waitFor({ timeout: 15_000 });

    // Open active tab (Side B) in a normal browser tab.
    const [popupB] = await Promise.all([
      page.context().waitForEvent("page"),
      (async () => {
        await moreBtn.click();
        await page.getByRole("menuitem", { name: "Åpne i standardnettleseren" }).click();
      })(),
    ]);
    await popupB.waitForLoadState("domcontentloaded");
    assert.equal(popupB.url(), urlB);
    await popupB.close();

    // Switch back to tab 1 (Side A) and verify it opens Side A, preserving both tabs.
    await rightPanel.getByRole("tab", { name: /Side A/ }).click();
    await page.waitForFunction((expected) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="browser-panel"] input[aria-label="Adresse"]');
      return input?.value === expected;
    }, urlA);

    const [popupA] = await Promise.all([
      page.context().waitForEvent("page"),
      (async () => {
        await moreBtn.click();
        await page.getByRole("menuitem", { name: "Åpne i standardnettleseren" }).click();
      })(),
    ]);
    await popupA.waitForLoadState("domcontentloaded");
    assert.equal(popupA.url(), urlA);
    await popupA.close();

    // Both tabs remain intact in the panel.
    assert.equal(await rightPanel.getByRole("tab", { name: /Side A/ }).count(), 1);
    assert.equal(await rightPanel.getByRole("tab", { name: /Side B/ }).count(), 1);
    assert.equal(await address.inputValue(), urlA);
  } finally {
    await new Promise<void>((resolve) => site.server.close(() => resolve()));
  }
});

flow("Åpne i standardnettleseren virker før en treg side har svart", async (h) => {
  const requested = Promise.withResolvers<ServerResponse>();
  let pending: ServerResponse | undefined;
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/plain; charset=utf-8");
    if (!pending) {
      pending = response;
      requested.resolve(response);
      return;
    }
    response.end("Systemnettleseren nådde siden");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/treg`;
  try {
    const { page } = h;
    await h.api("PATCH", "/api/settings", { cookieOffer: "never" });
    await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
    await openTool(page, "Nettleser");
    const panel = page.getByTestId("browser-panel");
    const address = panel.getByRole("textbox", { name: "Adresse" });
    await address.fill(url);
    await address.press("Enter");
    await requested.promise;
    await panel.getByRole("button", { name: "Mer for nettleseren" }).click();
    const [opened] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 10_000 }),
      page.getByRole("menuitem", { name: "Åpne i standardnettleseren" }).click({ timeout: 10_000 }),
    ]);
    await opened.getByText("Systemnettleseren nådde siden").waitFor();
    assert.equal(opened.url(), url);
    assert.equal(pending?.headersSent, false);
    await opened.close();
  } finally {
    pending?.end("Innebygd nettleser nådde siden");
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
