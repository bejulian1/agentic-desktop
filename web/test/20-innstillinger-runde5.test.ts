// Round 5, agent C: Innstillinger with search, the new settings that act at once, and the
// providers page. Every provider here is a local fake server; no real API is called.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { flow, openProject, send, waitFor, toolShown } from "./harness.ts";

const openSettings = async (page: import("playwright-core").Page) => {
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  // The gear opens the page for the mode (round 9); these tests start in Generelt.
  await page.locator(".settings-nav").getByRole("button", { name: "Generelt", exact: true }).click();
};

// Round 8: the choices in Innstillinger are the app's own select, a button that opens a menu.
const choose = async (page: import("playwright-core").Page, label: string, option: string) => {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
};

flow("søk i innstillinger filtrerer sider og rader, og bryterne for samtalen lagres", async (h) => {
  const { page } = h;
  await openSettings(page);
  const nav = page.locator(".settings-nav");
  const search = page.getByLabel("Søk i innstillinger");

  // Every page from before is still there, and has a title.
  for (const label of ["Generelt", "Utseende", "Modeller og leverandører", "Git", "Bruk", "Lagring", "Personvern og data", "Konfigurasjon", "Personalisering og minner", "Hurtigtaster", "MCP-servere", "Hooks", "Nettleser", "Tillatelser", "Arkiverte tråder", "Om"]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await page.locator(".settings-title:visible", { hasText: label }).waitFor();
  }

  await search.fill("aksent");
  await page.locator(".search-result", { hasText: "Aksentfarge" }).waitFor();
  assert.deepEqual(await nav.locator(".nav-item:not(.settings-back)").allTextContents(), ["Utseende"], "bare siden med treff");

  await search.fill("finnes ikke i det hele tatt");
  await page.getByText("Ingen innstillinger passer").waitFor();
  // Esc empties the search first, and only then leaves Innstillinger.
  await search.press("Escape");
  assert.equal(await search.inputValue(), "");
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();

  await search.fill("tenke");
  await page.locator(".search-result", { hasText: "Vis tenkesammendrag" }).click();
  assert.equal(await search.inputValue(), "", "søket tømmes når du går til treffet");
  await page.locator(".settings-title", { hasText: "Generelt" }).waitFor();
  await page.locator(".setting.search-hit", { hasText: "Vis tenkesammendrag" }).waitFor();

  const thinking = page.getByRole("switch", { name: /Vis tenkesammendrag/ });
  const shell = page.getByRole("switch", { name: /Skallutdata utvidet/ });
  assert.equal(await thinking.isChecked(), true, "tenkesammendrag er på som standard");
  assert.equal(await shell.isChecked(), false, "skallutdata er sammenlagt som standard");
  await thinking.click();
  await shell.click();
  await waitFor(async () => {
    const { settings } = await h.api("GET", "/api/bootstrap");
    return settings.thinkingSummary === false && settings.expandShell === true;
  }, "bryterne er lagret");

  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Innstillinger" }).waitFor({ state: "detached" });
});

flow("utseende virker med en gang, og gjelder før appen har startet ved neste lasting", async (h) => {
  const { page } = h;
  await openSettings(page);
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  const root = (name: string) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
  const cssVar = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

  await page.getByRole("radio", { name: "Grønn" }).click();
  assert.equal(await root("data-accent"), "green");
  assert.equal(await cssVar("--accent"), "#1d8350");
  await choose(page, "Tekststørrelse", "Større (16 px)");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontSize), "16px");
  await page.getByRole("group", { name: "Tetthet" }).getByRole("button", { name: "Kompakt" }).click();
  assert.equal(await cssVar("--row-h"), "28px");
  await page.getByRole("switch", { name: /Reduser bevegelse/ }).click();
  assert.equal(await root("data-motion"), "reduce");
  await page.locator(".settings-nav").getByRole("button", { name: "Kode", exact: true }).click();
  await choose(page, "Kodeskrift", "Ubuntu Mono");
  assert.match(await cssVar("--font-mono"), /^"Ubuntu Mono"/);
  await choose(page, "Skriftstørrelse for kode", "15 px");
  assert.equal(await cssVar("--code-font-size"), "15px");
  await page.getByRole("group", { name: "Tabulatorbredde" }).getByRole("button", { name: "2" }).click();
  await page.getByRole("switch", { name: /Bryt lange linjer/ }).click();
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  await page.getByRole("radio", { name: /^Smart/ }).click();

  await waitFor(async () => {
    const { settings } = await h.api("GET", "/api/bootstrap");
    return settings.accent === "green" && settings.uiFontSize === 16 && settings.density === "compact" && settings.reduceMotion === true
      && settings.codeFont === "ubuntu" && settings.codeFontSize === 15 && settings.tabSize === 2 && settings.wrapCode === true && settings.sidebarLayout === "smart";
  }, "alt er lagret på serveren");

  // theme.js applies the stored look before the app has its settings: with the bootstrap
  // blocked, the attributes are still there.
  await page.route("**/api/bootstrap", (route) => route.abort());
  await page.reload();
  await waitFor(async () => (await root("data-accent")) === "green", "aksenten før oppstart");
  assert.equal(await root("data-ui-size"), "16");
  assert.equal(await root("data-density"), "compact");
  assert.equal(await cssVar("--tab-size"), "2");
  h.allow(/api\/bootstrap|Failed to fetch|net::ERR_FAILED/);
  await page.unroute("**/api/bootstrap");
  await h.reload();

  // Back to the default code size: the field is left out on the server again.
  await openSettings(page);
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  await page.locator(".settings-nav").getByRole("button", { name: "Kode", exact: true }).click();
  await choose(page, "Skriftstørrelse for kode", "Standard");
  assert.equal(await root("data-code-size"), null);
  await waitFor(async () => !("codeFontSize" in (await h.api("GET", "/api/bootstrap")).settings), "standard igjen");
});

flow("når en tur er ferdig: lyd og systemvarsel, og appen åpner i valgt modus", async (h) => {
  const { page, context } = h;
  await context.grantPermissions(["notifications"]);
  await context.addInitScript(() => {
    const w = window as any;
    w.__oscillators = 0;
    w.__notes = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__oscillators++;
      return create.call(this);
    };
    w.Notification = class {
      static permission = "granted";
      static requestPermission = async () => "granted";
      constructor(title: string, options: { body?: string }) {
        w.__notes.push(`${title}: ${options?.body ?? ""}`);
      }
    };
  });
  await h.reload();
  await openSettings(page);
  await page.getByRole("switch", { name: "Spill av en lyd" }).click();
  await choose(page, "Systemvarsel", "Alltid");
  await choose(page, "Åpne appen i", "Kode");
  await waitFor(async () => {
    const { settings } = await h.api("GET", "/api/bootstrap");
    return settings.soundOnDone === true && settings.notifyOnDone === "always" && settings.startMode === "code";
  }, "lagret");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  await send(page, "hei");
  await waitFor(async () => (await page.evaluate(() => (window as any).__notes.length)) === 1, "ett varsel");
  assert.match(await page.evaluate(() => (window as any).__notes[0]), /^Agentic Desktop: «.+» er ferdig\.$/);
  assert.equal(await page.evaluate(() => (window as any).__oscillators), 2, "to toner");

  // The app was in Chat. With «Åpne appen i: Kode» it opens in Kode after a reload.
  await h.reload();
  await waitFor(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem("ad-ui") ?? "{}").mode)) === "code", "Kode ved oppstart");
});

flow("spør før fanen lukkes bare mens en tråd kjører", async (h) => {
  const { page } = h;
  const prevented = () => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
  await h.api("PATCH", "/api/settings", { confirmQuit: true });
  assert.equal(await prevented(), false, "ingenting kjører");
  await send(page, "hei");
  await page.locator(".pane-dot.running").first().waitFor({ state: "attached" }); // the pane has no head with one pane (round 11)
  assert.equal(await prevented(), true, "en tråd kjører");
  await page.locator(".pane-dot.running").first().waitFor({ state: "detached", timeout: 30_000 });
  assert.equal(await prevented(), false);
}, { mockDelayMs: 60 });

flow("leverandører: de opprinnelige valgene, tilkoblingstest, Koble til med nøkkel, og Koble fra", async (h) => {
  const { page } = h;
  const seen: Array<{ url: string; auth?: string }> = [];
  const fake = http.createServer((req, res) => {
    seen.push({ url: req.url!, auth: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "ablit-lokal" }] }));
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    await openSettings(page);
    await page.locator(".settings-nav").getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
    const popular = page.getByRole("list", { name: "Leverandører i katalogen" });
    await popular.locator(".setting").nth(3).waitFor();
    assert.deepEqual((await popular.locator(".setting-text strong").allTextContents()).slice(0, 4), ["OpenRouter", "abliteration.ai", "Anthropic", "OpenAI"]);
    await page.locator(".settings-group", { hasText: "Tilkoblede leverandører" }).getByText("Demo-modell").waitFor();
    await page.getByRole("button", { name: /^Egendefinert/ }).waitFor();

    // Esc and the arrow go back to the list, not out of Innstillinger.
    await page.getByRole("button", { name: "Koble til Anthropic" }).click();
    const anthropic = page.getByRole("region", { name: "Koble til Anthropic" });
    await anthropic.getByLabel("Anthropic-API-nøkkel").waitFor();
    assert.equal(await anthropic.getByRole("button", { name: "Fortsett" }).isDisabled(), true, "Fortsett venter på en nøkkel");
    await page.keyboard.press("Escape");
    await popular.waitFor();
    await page.getByRole("button", { name: "Koble til Anthropic" }).click();
    await page.getByRole("button", { name: "Tilbake til leverandørene" }).click();
    await popular.waitFor();

    await page.getByRole("button", { name: "Koble til abliteration.ai" }).click();
    const view = page.getByRole("region", { name: "Koble til abliteration.ai" });
    assert.equal(await view.locator(".beta-tag, .beta-note").count(), 0);
    await view.locator("summary", { hasText: "Adresse" }).click();
    const address = view.getByLabel("API-adresse", { exact: true });
    assert.equal(await address.inputValue(), "https://api.abliteration.ai/v1");
    await address.fill(`http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`);
    const key = view.getByLabel("abliteration.ai-API-nøkkel");
    assert.equal(await key.getAttribute("type"), "password");
    await key.fill("ablit-test-nokkel");
    await view.getByRole("button", { name: "Fortsett" }).click();
    await view.locator(".fetch-row", { hasText: "ablit-lokal" }).locator("input").check();
    await view.getByRole("button", { name: /Legg til valgte/ }).click();

    const row = page.locator(".provider-row", { hasText: "abliteration.ai" });
    await row.getByText("API-nøkkel").waitFor();
    await row.getByText("1 modell").waitFor();
    await popular.getByRole("button", { name: "Vis oppsett for abliteration.ai", exact: true }).waitFor();
    assert.deepEqual(seen, [{ url: "/v1/models", auth: "Bearer ablit-test-nokkel" }]);
    assert.ok(!(await page.evaluate(() => document.body.innerHTML.includes("ablit-test-nokkel"))), "nøkkelen står ikke i siden");
    assert.ok(!JSON.stringify(await h.api("GET", "/api/bootstrap")).includes("ablit-test-nokkel"));

    await row.getByRole("button", { name: "Test tilkobling", exact: true }).click();
    await row.getByRole("status").getByText(/Tilkoblingen virker|Modellisten svarte/).waitFor();
    // All named providers keep their own connection check, using only this local fixture.
    for (const preset of ["openrouter", "anthropic", "openai"]) {
      const provider = await h.api("POST", "/api/providers", { preset, apiKey: "lokal-testnokkel", baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}${preset === "anthropic" ? "" : "/v1"}` });
      const card = page.locator(`.provider-row[data-provider="${provider.name}"]`);
      await card.getByRole("button", { name: "Test tilkobling", exact: true }).click();
      await card.getByRole("status").getByText(/Tilkoblingen virker|Modellisten svarte/).waitFor();
      assert.equal(await card.locator(".beta-tag, .beta-note").count(), 0);
    }
    await row.getByRole("button", { name: "Koble fra abliteration.ai" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Koble fra" }).click();
    await row.waitFor({ state: "detached" });
    await popular.getByText("abliteration.ai", { exact: true }).waitFor();
  } finally {
    fake.close();
  }
});

flow("hurtigtaster: søk, ta opp, bytt ved konflikt, nettleserens taster, fjern og tilbakestill", async (h) => {
  const { page } = h;
  const shortcuts = async () => (await h.api("GET", "/api/bootstrap")).settings.shortcuts ?? {};
  await openSettings(page);
  await page.locator(".settings-nav").getByRole("button", { name: "Hurtigtaster", exact: true }).click();
  for (const group of ["Generelt", "Tråder", "Visning", "Panel", "Meldingsfelt"]) await page.locator(".settings-group-head h2", { hasText: group }).first().waitFor();

  await page.getByLabel("Søk i hurtigtaster").fill("nettleser");
  const rows = page.locator(".shortcut-row");
  // Round 10 adds Ny fane i nettleseren (Ctrl+Alt+B), and round 11b Annoter (Ctrl+Alt+A).
  assert.deepEqual(await rows.locator(".setting-text strong").allTextContents(), ["Vis Nettleser i panelet", "Ny fane i nettleseren", "Annoter siden i nettleseren"]);
  await rows.locator("kbd", { hasText: "Ctrl+Alt+4" }).waitFor();

  // Ctrl+Shift+B belongs to the panel: the clash is shown, and Bytt swaps the two.
  await page.getByRole("button", { name: "Endre hurtigtast for Vis Nettleser i panelet" }).click();
  await page.keyboard.press("Control+Shift+B");
  await page.getByText("Ctrl+Shift+B brukes allerede til «Vis eller skjul panelet».").waitFor();
  await page.getByRole("button", { name: "Bytt med «Vis eller skjul panelet»" }).click();
  await waitFor(async () => {
    const s = await shortcuts();
    return s["panel.browser"] === "Mod+Shift+B" && s["view.panel"] === "Mod+Alt+4";
  }, "byttet");

  await page.getByLabel("Søk i hurtigtaster").fill("");
  const newThread = page.locator(".shortcut-row", { hasText: "Ny tråd" }).first();
  await newThread.getByRole("button", { name: /^Endre hurtigtast/ }).click();
  await page.keyboard.press("Control+W");
  await newThread.getByText("brukes av nettleseren").waitFor();
  await page.keyboard.press("Escape");
  await newThread.locator("kbd", { hasText: "Ctrl+J" }).waitFor();
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();

  await newThread.getByRole("button", { name: /^Endre hurtigtast/ }).click();
  await page.keyboard.press("Backspace");
  await newThread.locator("kbd", { hasText: "Ingen" }).waitFor();
  await waitFor(async () => (await shortcuts())["thread.new"] === "", "fjernet");
  await newThread.getByRole("button", { name: "Tilbakestill Ny tråd" }).click();
  await newThread.locator("kbd", { hasText: "Ctrl+J" }).waitFor();

  await page.getByRole("button", { name: "Tilbakestill alle" }).click();
  await waitFor(async () => Object.keys(await shortcuts()).length === 0, "alt er standard igjen");
});

flow("hurtigtastene for panelet åpner fanene", async (h) => {
  const { page } = h;
  await openProject(h);
  if (!(await page.getByTestId("panel-home").isVisible())) await page.keyboard.press("Control+Shift+b");
  await page.getByTestId("panel-home").waitFor();
  await page.keyboard.press("Control+Alt+2");
  await toolShown(page, "Endringer");
  await page.keyboard.press("Control+Alt+1");
  await toolShown(page, "Filer");
});

flow("lagring: total og fordeling, rydd opp med bekreftelse, og kopier stien", async (h) => {
  const { page } = h;
  const old = new Date(Date.now() - 40 * 24 * 60 * 60_000);
  const orphan = path.join(h.dataDir, "images", "00000001-0000-4000-8000-000000000001.png");
  mkdirSync(path.dirname(orphan), { recursive: true });
  writeFileSync(orphan, "x".repeat(250_000));
  utimesSync(orphan, old, old);
  const downloads = path.join(h.home, "Nedlastinger-test");
  mkdirSync(downloads, { recursive: true });
  writeFileSync(path.join(downloads, "fil.zip"), "y".repeat(1234));
  await h.api("PATCH", "/api/settings", { downloadDir: downloads });

  await openSettings(page);
  await page.locator(".settings-nav").getByRole("button", { name: "Lagring", exact: true }).click();
  await page.getByTestId("storage-total").waitFor();
  await page.locator('[data-category="images"]', { hasText: "250 kB" }).waitFor();
  await page.getByText(downloads).waitFor();
  const orphans = page.locator('[data-action="orphans"] input');
  assert.equal(await orphans.isChecked(), true, "foreslått");
  assert.equal(await page.locator('[data-action="browser-all"] input').isChecked(), false, "innlogginger bare når du velger det");
  assert.equal(await page.locator('[data-action="archived"] input').isChecked(), false);

  await page.getByRole("button", { name: "Rydd opp" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Bekreft opprydding" });
  await confirm.getByText("1 bilde eller fil som ingen melding bruker.").waitFor();
  assert.ok(existsSync(orphan), "ingenting slettes før du bekrefter");
  await confirm.getByRole("button", { name: "Slett" }).click();
  await page.getByRole("status").filter({ hasText: /Frigjorde .*Appen bruker nå/ }).waitFor();
  assert.ok(!existsSync(orphan));
  assert.ok(existsSync(path.join(downloads, "fil.zip")));

  await page.getByRole("button", { name: "Kopier stien til datamappen" }).click();
  await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())) === h.dataDir, "stien er kopiert");

  await page.getByLabel("Søk i innstillinger").fill("rydd");
  await page.locator(".search-result", { hasText: "Rydd opp" }).click();
  await page.locator(".settings-title", { hasText: "Lagring" }).waitFor();
});
