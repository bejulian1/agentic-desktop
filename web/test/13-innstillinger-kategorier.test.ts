import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { flow, send, waitFor } from "./harness.ts";

flow("leverandør fra listen: nøkkel, hent modeller fra /models og kryss av", async (h) => {
  const { page } = h;
  const seen: Array<{ url: string; auth?: string }> = [];
  const fake = http.createServer((req, res) => {
    seen.push({ url: req.url!, auth: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "lokal-a", context_window: 32_000 }, { id: "lokal-b" }] }));
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    await page.getByRole("button", { name: "Innstillinger" }).click();
    await page.getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
    await page.getByRole("button", { name: "Koble til OpenRouter" }).click();
    const view = page.getByRole("region", { name: "Koble til OpenRouter" });
    await view.locator("summary", { hasText: "Adresse" }).click();
    assert.equal(await view.getByLabel("Adresse").inputValue(), "https://openrouter.ai/api/v1");
    // The test points the preset at a local fake server. No real API is called.
    await view.getByLabel("Adresse").fill(`http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`);
    await view.getByLabel("OpenRouter-API-nøkkel").fill("gsk-test");
    await view.getByRole("button", { name: "Fortsett" }).click();
    await view.locator(".fetch-row", { hasText: "lokal-a" }).locator("input").check();
    await view.getByRole("button", { name: /Legg til valgte/ }).click();
    await page.locator(".provider-row", { hasText: "OpenRouter" }).getByText("API-nøkkel").waitFor();
    await page.getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
    const card = page.locator('.card[data-provider="OpenRouter"]');
    await card.getByText("API-nøkkel").waitFor();
    await card.locator(".model-row", { hasText: "lokal-a" }).waitFor();
    assert.deepEqual(seen, [{ url: "/v1/models", auth: "Bearer gsk-test" }]);
    const boot = await h.api("GET", "/api/bootstrap");
    assert.equal(boot.models.find((m: any) => m.model === "lokal-a").contextWindow, 32_000);
    assert.ok(!JSON.stringify(boot).includes("gsk-test"), "nøkkelen kommer aldri tilbake til UI-et");
  } finally {
    fake.close();
  }
});

flow("profil, global AGENTS.md, hurtigtaster og skrivebordskortet", async (h) => {
  const { page } = h;
  await send(page, "hjelp");
  await page.locator(".pane-dot.running").waitFor({ state: "detached" }).catch(() => undefined);
  await waitFor(async () => (await h.api("GET", "/api/profile")).runs === 1, "kjøringen er telt");

  await page.getByRole("button", { name: "Innstillinger" }).click();
  await page.getByRole("button", { name: "Bruk", exact: true }).click();
  // Bruk has the statistics card (SPEC 20) and the cost; the long view is on the profile page.
  const stats = page.locator(".settings-page").getByTestId("stats-card");
  await waitFor(async () => (await stats.locator(".stats-tile", { hasText: "Økter" }).locator(".stats-value").textContent()) === "1", "én økt");
  await stats.getByRole("tab", { name: "Modeller" }).click();
  await stats.locator(".stats-model", { hasText: "Demo-modell" }).waitFor();
  await page.getByTestId("usage-cost").waitFor();

  await page.getByRole("button", { name: "Konfigurasjon", exact: true }).click();
  await page.getByLabel("Global AGENTS.md").fill("Svar kort.");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await page.locator(".toast", { hasText: "Lagret AGENTS.md" }).waitFor();
  assert.equal(readFileSync(path.join(h.home, ".config/agentic-desktop/AGENTS.md"), "utf8"), "Svar kort.", "i den midlertidige XDG_CONFIG_HOME");

  await page.getByRole("button", { name: "Hurtigtaster", exact: true }).click();
  const row = page.locator(".setting", { hasText: "Søk i tråder" });
  await row.getByRole("button", { name: "Endre" }).click();
  // Ctrl+Shift+F is Ny fane i fullvisning since round 10, so the example is a free combination.
  await page.keyboard.press("Control+Shift+Y");
  await row.locator("kbd", { hasText: "Ctrl+Shift+Y" }).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.shortcuts["thread.search"], "Mod+Shift+Y");

  await page.getByRole("button", { name: "Skrivebordsstyring" }).click();
  assert.equal(await page.getByTestId("cua-status").textContent(), "Ikke installert");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  await page.keyboard.press("Control+Shift+Y");
  await waitFor(async () => page.evaluate(() => document.activeElement?.classList.contains("search-input") ?? false), "den nye hurtigtasten virker");
});
