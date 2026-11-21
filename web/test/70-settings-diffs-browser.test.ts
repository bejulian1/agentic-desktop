// End-to-end UI tests for Package B settings: Differ, Nettleser, Varsler and Prosjektrekkefølge.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { flow, openTool, pane, send, waitFor } from "./harness.ts";

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}

flow("Innstillinger → Differ: oppsett, mellomrom, filvisning, farger og endringer-panelet", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { cookieOffer: "never" });
  const project = await h.createProject("DiffDemo");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "index.html"), "<!doctype html>\n<title>Før</title>\n<h1>Hei fra demo-modellen</h1>\n");

  // Open Settings → Differ and configure all 4 settings.
  await openSettings(page);
  await page.locator(".settings-nav").getByRole("button", { name: "Differ", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Differ" }).waitFor();

  await choose(page, "Diff-oppsett", "Side ved side");
  await page.getByRole("switch", { name: "Skjul mellomromsendringer" }).click();
  await choose(page, "Standard filvisning", "Sammenslått");
  await choose(page, "Diff-farger", "Blå og oransje (fargeblindvennlig)");

  await waitFor(async () => {
    const { settings } = await h.api("GET", "/api/bootstrap");
    return settings.diffLayout === "split"
      && settings.diffIgnoreWhitespace === true
      && settings.diffFileState === "collapsed"
      && settings.diffColors === "blue-orange";
  }, "diff-innstillinger lagret");

  assert.equal(await page.evaluate(() => document.documentElement.dataset.diffColors), "blue-orange");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  // Open the project in Kode and make a real edit via the demo model.
  await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
  await page.locator(".sidebar .group-title", { hasText: "DiffDemo" }).click();
  await send(page, "rediger");
  await page.getByTestId("changes-card").waitFor({ timeout: 20_000 });

  // Widen viewport and panel so side-by-side layout renders.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("ad-ui") ?? "{}");
    prefs.panelWidth = 720;
    localStorage.setItem("ad-ui", JSON.stringify(prefs));
  });
  await h.reload();
  await page.getByTestId("changes-card").getByRole("button", { name: "Vis endringer" }).click();
  const diffFile = page.getByTestId("diff-file").first();
  await diffFile.waitFor({ timeout: 15_000 });

  // Starts collapsed because diffFileState === "collapsed".
  assert.equal(await diffFile.getAttribute("data-expanded"), "false");
  await diffFile.locator(".diff-file-toggle").click();
  assert.equal(await diffFile.getAttribute("data-expanded"), "true");

  // Wide panel shows real side-by-side split view.
  const block = diffFile.locator(".diff-lines");
  await block.waitFor();
  assert.equal(await block.getAttribute("data-diff-layout"), "split");
  assert.ok((await block.locator(".diff-split-row").count()) > 0, "side-by-side rader rendret");

  // Narrowing the panel falls back to stacked automatically without changing the stored setting.
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("ad-ui") ?? "{}");
    prefs.panelWidth = 340;
    localStorage.setItem("ad-ui", JSON.stringify(prefs));
  });
  await h.reload();
  await page.getByTestId("changes-card").getByRole("button", { name: "Vis endringer" }).click();
  await diffFile.waitFor({ timeout: 15_000 });
  await diffFile.locator(".diff-file-toggle").click();
  await waitFor(async () => (await block.getAttribute("data-diff-layout")) === "stacked" && (await block.getAttribute("data-auto-stacked")) === "true", "smalt panel faller tilbake til stablet");

  // Toolbar toggles update the persisted settings live.
  await page.getByTestId("diff-layout-toggle").click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.diffLayout === "stacked", "stablet lagret fra verktøylinje");

  await page.getByTestId("diff-whitespace-toggle").click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.diffIgnoreWhitespace === false, "mellomrom lagret fra verktøylinje");
});

flow("Innstillinger → Nettleser: søkemotor, agenttilgang, lenker, avansert zoom og utseende", async (h) => {
  const server = createServer((req, res) => {
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      const content = `Se lenke: [Testlenke](${baseUrl}/lenke)`;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (req.url?.startsWith("/search")) {
      return res.end(`<!doctype html><title>Lokalt søk</title><h1>Søk: ${req.url}</h1>`);
    }
    res.end("<!doctype html><title>Testlenke</title><h1>Åpnet lenke</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const { page } = h;
    await h.api("PATCH", "/api/settings", { cookieOffer: "never" });

    // Open Settings → Nettleser.
    await openSettings(page);
    await page.locator(".settings-nav").getByRole("button", { name: "Nettleser", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Nettleser" }).waitFor();

    // Toggle Agent browser access off.
    const agentSwitch = page.getByRole("switch", { name: "Agenttilgang til nettleseren" });
    assert.equal(await agentSwitch.isChecked(), true);
    await agentSwitch.click();
    await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.agentBrowserAccess === false, "agenttilgang av");

    // Set Open links in -> Agentic Desktop browser.
    await choose(page, "Åpne lenker i", "Agentic Desktop-nettleseren");
    await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.openLinksIn === "app", "åpne lenker i appen");

    // Choose Search engine -> Brave Search, then Custom pointing to our local test server.
    await choose(page, "Søkemotor", "Brave Search");
    await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.searchEngine === "brave", "Brave Search lagret");

    await choose(page, "Søkemotor", "Egendefinert");
    const customInput = page.getByLabel("Egendefinert søke-adresse", { exact: true });
    await customInput.fill(`${baseUrl}/search?q={q}`);
    await customInput.press("Enter");
    await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.webSearchUrl === `${baseUrl}/search?q={q}`, "egendefinert søkemotor lagret");

    // Expand Advanced and configure default zoom & appearance.
    await page.getByTestId("browser-advanced-toggle").click();
    await choose(page, "Standard nettleserzoom", "125 %");
    await choose(page, "Standard utseende i nettleseren", "Mørk");
    await waitFor(async () => {
      const { settings } = await h.api("GET", "/api/bootstrap");
      return settings.browserDefaultZoom === 1.25 && settings.browserAppearance === "dark";
    }, "avanserte nettleservalg lagret");

    // Settings search finds advanced settings and auto-expands Avansert.
    const searchInput = page.getByLabel("Søk i innstillinger");
    await searchInput.fill("Standard nettleserzoom");
    await page.locator(".search-result", { hasText: "Standard nettleserzoom" }).click();
    await page.getByRole("button", { name: "Standard nettleserzoom", exact: true }).waitFor();

    await page.getByRole("button", { name: "Tilbake til appen" }).click();

    // Browser panel uses default zoom (125 %) and custom search engine when typing non-URL text.
    await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
    await openTool(page, "Nettleser");
    const browserPanel = page.getByTestId("browser-panel");
    await browserPanel.waitFor({ timeout: 15_000 });
    await browserPanel.getByRole("button", { name: "Mer for nettleseren" }).click();
    await page.getByRole("button", { name: "Faktisk størrelse" }).filter({ hasText: "125 %" }).waitFor();
    await page.keyboard.press("Escape");

    const address = browserPanel.getByRole("textbox", { name: "Adresse" });
    await address.fill("nordlys");
    await address.press("Enter");
    await page.locator(".right-panel").getByRole("tab", { name: /Lokalt søk/ }).waitFor({ timeout: 15_000 });

    // Create a local fake model that emits a Markdown link pointing to our local server.
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "LokalTest", baseUrl: `${baseUrl}/v1`, apiKey: "test-" + "key" });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "LenkeModell", model: "link-model", contextWindow: 8192 });
    await h.api("PATCH", "/api/settings", { defaultModelId: model.id });

    await send(page, "gi meg en lenke");
    const link = page.locator(".scroller a", { hasText: "Testlenke" }).first();
    await link.waitFor({ timeout: 15_000 });

    // Normal click opens in the Agentic Desktop Browser panel.
    await link.click();
    await page.locator(".right-panel").getByRole("tab", { name: /Testlenke/ }).waitFor({ timeout: 15_000 });

    // Ctrl+click always opens in the default/external browser (new page in localhost mode).
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 10_000 }),
      link.click({ modifiers: ["Control"] }),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    assert.equal(popup.url(), `${baseUrl}/lenke`);
    await popup.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

flow("Innstillinger → Generelt: varsler i appen for annen tråd åpner tråden ved klikk", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { inAppNotifications: true, threadNotifications: "notify" });
  await h.reload();

  // Create two Chat threads; view thread A while thread B finishes in the background.
  const threadA = await h.createThread(null);
  const threadB = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${threadA.id}`, { title: "Aktiv tråd" });
  await h.api("PATCH", `/api/threads/${threadB.id}`, { title: "Bakgrunnstråd" });
  await page.locator(`[data-thread-item="${threadA.id}"]`).first().click();
  await pane(page, threadA.id).waitFor();

  // Trigger a run in thread B via REST while thread A is in focus.
  await h.api("POST", `/api/threads/${threadB.id}/messages`, { text: "hei" });
  const toast = page.locator(".toast", { hasText: "Bakgrunnstråd" });
  await toast.waitFor({ timeout: 15_000 });
  await toast.getByRole("button", { name: "Åpne" }).click();

  // Clicking the toast action opens thread B in the pane.
  await pane(page, threadB.id).waitFor({ timeout: 10_000 });
});

flow("Innstillinger → Utseende → Prosjektrekkefølge styrer sidefane og kommandopalett", async (h) => {
  const { page } = h;
  const dirZ = path.join(h.projectDir, "zebra");
  const dirA = path.join(h.projectDir, "alfa");
  const dirM = path.join(h.projectDir, "midten");
  mkdirSync(dirZ, { recursive: true });
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirM, { recursive: true });

  await h.api("POST", "/api/projects", { name: "Zebra", path: dirZ });
  await new Promise((r) => setTimeout(r, 25));
  await h.api("POST", "/api/projects", { name: "Alfa", path: dirA });
  await new Promise((r) => setTimeout(r, 25));
  await h.api("POST", "/api/projects", { name: "Midten", path: dirM });

  await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();

  // Switch to Name (A–Å) in Settings → Utseende.
  await openSettings(page);
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  await choose(page, "Prosjektrekkefølge", "Navn (A–Å)");
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.projectOrder === "name", "prosjektrekkefølge lagret");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  const sidebarNames = async () =>
    page.locator(".sidebar .group-title span").allTextContents();
  await waitFor(async () => JSON.stringify(await sidebarNames()) === JSON.stringify(["Alfa", "Midten", "Zebra"]), "sidefanen sortert A–Å");

  // Command palette shows projects in the same A–Å order.
  await page.keyboard.press("Control+k");
  const palette = page.locator("dialog.palette");
  await palette.waitFor();
  const paletteProjects = await palette.getByRole("group", { name: "Prosjekter" }).getByRole("option").locator(".palette-label").allTextContents();
  assert.deepEqual(paletteProjects, ["Alfa", "Midten", "Zebra"]);
  await page.keyboard.press("Escape");

  // Switch to Last created -> newest first (Midten, Alfa, Zebra).
  await openSettings(page);
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  await choose(page, "Prosjektrekkefølge", "Sist opprettet");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await waitFor(async () => JSON.stringify(await sidebarNames()) === JSON.stringify(["Midten", "Alfa", "Zebra"]), "sidefanen sortert etter sist opprettet");
});
