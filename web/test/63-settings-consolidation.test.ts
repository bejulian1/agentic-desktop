import assert from "node:assert/strict";
import { flow, waitFor } from "./harness.ts";

const combined = "Modeller og leverandører";

flow("samlede modeller og leverandører: umiddelbar valgt rad og innhold mens katalogen hentes", async (h) => {
  const { page } = h;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/provider-presets", async (route) => { await gate; await route.continue(); });
  await page.keyboard.press("Control+Comma");
  const nav = page.locator(".settings-nav");
  try {
    await nav.getByRole("button", { name: combined, exact: true }).click();
    await page.getByRole("heading", { name: combined, exact: true }).waitFor();
    await page.getByRole("button", { name: "Standardmodell", exact: true }).waitFor();
    assert.equal(await nav.getByRole("button", { name: "Modeller", exact: true }).count(), 0);
    assert.equal(await nav.getByRole("button", { name: "Leverandører", exact: true }).count(), 0);
    await page.getByRole("status").filter({ hasText: "Henter leverandører" }).waitFor();
    for (const label of ["Chat", combined, "Utseende", combined, "Chat"]) {
      // Dispatch fast clicks without waiting out any animation; observe the synchronous result.
      await nav.getByRole("button", { name: label, exact: true }).evaluate((button: HTMLButtonElement) => button.click());
      assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
      assert.equal(await nav.locator('[aria-current="page"]').textContent(), label);
      assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), label);
    }
    await nav.getByRole("button", { name: combined, exact: true }).hover();
    const tones = await nav.evaluate((element) => {
      const current = element.querySelector('[aria-current="page"]')!;
      const hovered = [...element.querySelectorAll("button")].find((button) => button.textContent === "Modeller og leverandører")!;
      return { current: getComputedStyle(current).backgroundColor, hovered: getComputedStyle(hovered).backgroundColor, transition: getComputedStyle(current).transitionProperty };
    });
    assert.notEqual(tones.current, tones.hovered, "hover ser forskjellig ut fra valgt side");
    assert.ok(!tones.transition.includes("background"), "forrige valgte bakgrunn falmer ikke videre");
  } finally { release(); }
});

flow("samlede modeller og leverandører beholder utkast og feil ved raske sidebytter", async (h) => {
  const { page } = h;
  const provider = await h.api("POST", "/api/providers", { name: "Lokal prøve", kind: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", apiKey: "kun-lokal-test" });
  await page.keyboard.press("Control+Comma");
  const nav = page.locator(".settings-nav");
  const open = (label: string) => nav.getByRole("button", { name: label, exact: true }).click();
  await open(combined);
  const card = page.locator('.provider-cards .card[data-provider="Lokal prøve"]');
  await card.getByRole("button", { name: "Rediger Lokal prøve", exact: true }).click();
  const form = card.getByRole("form", { name: "Leverandør", exact: true });
  await form.getByLabel("Navn", { exact: true }).fill("Behold mitt utkast");
  await form.getByLabel("Nøkkel", { exact: true }).fill("hemmelig-utkast");
  h.allow(/status of 503/);
  await page.route(`**/api/providers/${provider.id}`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Midlertidig lagringsfeil" }) }));
  await form.getByRole("button", { name: "Lagre", exact: true }).click();
  await form.getByRole("alert").filter({ hasText: "Midlertidig lagringsfeil" }).waitFor();
  for (const label of ["Chat", combined, "Generelt", combined]) await open(label);
  assert.equal(await form.getByLabel("Navn", { exact: true }).inputValue(), "Behold mitt utkast");
  assert.equal(await form.getByLabel("Nøkkel", { exact: true }).inputValue(), "hemmelig-utkast");
  assert.equal(await form.getByLabel("Nøkkel", { exact: true }).getAttribute("type"), "password");
  await form.getByRole("alert").waitFor();
  await form.getByRole("button", { name: "Avbryt", exact: true }).click();
  await page.unroute(`**/api/providers/${provider.id}`);
  await card.getByRole("button", { name: "Legg til modell", exact: true }).click();
  const model = card.getByRole("form", { name: "Modell", exact: true });
  await model.getByLabel("Navn", { exact: true }).fill("Min modell");
  await model.getByLabel("Modell-ID", { exact: true }).fill("modell-lokal");
  await open("Chat");
  await open(combined);
  assert.equal(await model.getByLabel("Modell-ID", { exact: true }).inputValue(), "modell-lokal");
  await model.getByRole("button", { name: "Lagre", exact: true }).click();
  await card.locator(".model-row", { hasText: "Min modell" }).waitFor();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).models.some((m: any) => m.model === "modell-lokal"), "modellutkastet kunne lagres etter navigasjon");
  await page.getByLabel("Søk i innstillinger").fill("steg per tur");
  await page.locator(".search-result", { hasText: "Steg per tur" }).click();
  await page.locator(".search-hit", { hasText: "Steg per tur" }).waitFor();
  assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), combined);
  assert.equal(await nav.locator('[aria-current="page"]').textContent(), combined);
});

flow("leverandørkatalog kan feile og prøves igjen uten å skjule lagrede modeller", async (h) => {
  const { page } = h;
  h.allow(/status of 503/);
  let attempts = 0;
  await page.route("**/api/provider-presets", (route) => ++attempts === 1
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Prøvefeil i katalog" }) })
    : route.continue());
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: combined, exact: true }).click();
  const error = page.getByRole("alert").filter({ hasText: "Prøvefeil i katalog" });
  await error.waitFor();
  await page.getByRole("button", { name: "Standardmodell", exact: true }).waitFor();
  await page.locator('.provider-cards [data-provider="Demo"]').waitFor();
  await error.getByRole("button", { name: "Prøv igjen", exact: true }).click();
  await page.getByRole("button", { name: "Koble til OpenRouter", exact: true }).waitFor();
  assert.equal(attempts, 2);
});

flow("tilkoblingsutkast og mislykket modellhenting overlever navigasjon uten skjulte Escape-lyttere", async (h) => {
  const { page } = h;
  const provider = await h.api("POST", "/api/providers", { name: "Lokal feilkilde", kind: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1" });
  h.allow(/status of 503/);
  await page.route(`**/api/providers/${provider.id}/models/fetch`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Modellisten svarte ikke" }) }));
  await page.route(`**/api/providers/${provider.id}/test`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, message: "Kunne ikke koble til prøvetjenesten" }) }));
  await page.keyboard.press("Control+Comma");
  const nav = page.locator(".settings-nav");
  const open = (label: string) => nav.getByRole("button", { name: label, exact: true }).click();
  await open(combined);
  const card = page.locator('.provider-cards .card[data-provider="Lokal feilkilde"]');
  await card.getByRole("button", { name: "Hent modeller", exact: true }).click();
  await card.getByRole("alert").filter({ hasText: "Modellisten svarte ikke" }).waitFor();
  await open("Chat");
  await open(combined);
  await card.getByRole("alert").filter({ hasText: "Modellisten svarte ikke" }).waitFor();
  await card.getByRole("button", { name: "Lukk", exact: true }).click();
  await card.getByRole("button", { name: "Test tilkobling", exact: true }).click();
  await card.getByRole("status").filter({ hasText: "Kunne ikke koble til prøvetjenesten" }).waitFor();
  await open("Chat");
  await open(combined);
  await card.getByRole("status").filter({ hasText: "Kunne ikke koble til prøvetjenesten" }).waitFor();
  await page.getByRole("button", { name: "Koble til OpenRouter", exact: true }).click();
  await page.getByLabel("OpenRouter-API-nøkkel", { exact: true }).fill("hemmelig-tilkoblingsutkast");
  await open("Chat");
  await open(combined);
  assert.equal(await page.getByLabel("OpenRouter-API-nøkkel", { exact: true }).inputValue(), "hemmelig-tilkoblingsutkast");
  await open("Chat");
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Innstillinger", exact: true }).waitFor({ state: "detached" });
});

flow("skjult modellside lukker portalmenyer ved tastatur og programmatiske sidebytter", async (h) => {
  const { page } = h;
  await page.keyboard.press("Control+Comma");
  const nav = page.locator(".settings-nav");
  const models = nav.getByRole("button", { name: combined, exact: true });
  await models.click();
  await page.getByRole("button", { name: "Standardmodell", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Standardmodell", exact: true });
  await menu.waitFor();
  // Keyboard activation produces no pointerdown, so the Select must react to active=false.
  const chat = nav.getByRole("button", { name: "Chat", exact: true });
  await chat.focus();
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Chat");
  assert.equal(await chat.evaluate((button) => button === document.activeElement), true, "menyen flytter ikke fokus tilbake til skjult modellside");
  await models.click();
  await page.getByRole("button", { name: "Standardmodell", exact: true }).click();
  await menu.waitFor();
  await nav.getByRole("button", { name: "Generelt", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await menu.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest("[hidden], [inert]")), false);
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Innstillinger", exact: true }).waitFor({ state: "detached" });
  await waitFor(async () => page.evaluate(() => !!document.activeElement && !document.activeElement.closest("[inert], [hidden]")), "fokus blir i den aktive appen");
});

flow("ekte pekerklikk i innstillinger beholder valgt markør på siden som vises i hver ramme", async (h) => {
  const { page } = h;
  await page.keyboard.press("Control+Comma");
  const nav = page.locator(".settings-nav");
  await nav.getByRole("button", { name: "Kode", exact: true }).click();
  await page.getByRole("heading", { name: "Kode", exact: true }).waitFor();
  await page.evaluate(() => {
    const samples: Array<{ current: string | null; title: string | null; gliding: boolean; ghosts: number; background: string; marker: string }> = [];
    let frame = 0;
    const sample = () => {
      const nav = document.querySelector(".settings-nav")!;
      const current = nav.querySelector('[aria-current="page"]');
      const title = [...document.querySelectorAll(".settings-title")].find((node) => !node.closest("[hidden]"));
      const style = current ? getComputedStyle(current) : null;
      samples.push({ current: current?.textContent ?? null, title: title?.textContent ?? null, gliding: nav.classList.contains("gliding"), ghosts: nav.querySelectorAll(".glide-ghost").length, background: style?.backgroundColor ?? "", marker: style?.boxShadow ?? "" });
    };
    const tick = () => { sample(); frame = requestAnimationFrame(tick); };
    // Also observe the end of the click task before the first post-click frame.
    const onClick = () => queueMicrotask(sample);
    document.addEventListener("click", onClick, true);
    sample();
    frame = requestAnimationFrame(tick);
    (window as any).__settingsPointerProbe = { stop: () => { cancelAnimationFrame(frame); document.removeEventListener("click", onClick, true); return samples; } };
  });
  for (const label of [combined, "Chat", combined, "Utseende", "Kode", combined, "Chat"]) {
    // Locator.click sends actual pointerdown/up events, activating MotionHost's real path.
    await nav.getByRole("button", { name: label, exact: true }).click({ delay: 0 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  const samples = await page.evaluate(async () => {
    // Cover the complete lifetime of any 200 ms global glide after the last click too.
    await new Promise<void>((resolve) => {
      let frames = 0;
      const tick = () => ++frames >= 18 ? resolve() : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    });
    return (window as any).__settingsPointerProbe.stop();
  }) as Array<{ current: string | null; title: string | null; gliding: boolean; ghosts: number; background: string; marker: string }>;
  assert.ok(samples.length >= 25, "sidebyttene ble observert gjennom faktiske animasjonsrammer");
  assert.ok(samples.some((sample) => sample.title === combined));
  for (const sample of samples) {
    assert.equal(sample.current, sample.title, "valgt navigasjonsrad samsvarer med synlig innhold");
    assert.equal(sample.gliding, false, "innstillingsmenyen bruker aldri global glide-animasjon");
    assert.equal(sample.ghosts, 0, "ingen forsinket kopi av valgt markør");
    assert.ok(sample.background && sample.background !== "transparent" && sample.background !== "rgba(0, 0, 0, 0)", "valgt bakgrunn er synlig i hver ramme");
    assert.ok(sample.marker && sample.marker !== "none", "valgt markør er synlig i hver ramme");
  }
});
