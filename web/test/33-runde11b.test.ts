// Round 11b (SPEC 25): Annoter in the Browser panel, from the button to an image and a numbered list
// in the message field, Esc that adds nothing, and the Kode start page: Tekst in three sizes,
// Token-historikk and Prosjektboks, with and without a project, and the old settings moving over.
// Demo model only; the Browser panel shows a local test page, never the internet.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright-core";
import { flow, openProject, openTool, waitFor, type Harness } from "./harness.ts";

const focused = (page: Page) => page.locator(".pane-inner.focused");
const kode = (page: Page) => page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
const still = (page: Page) => page.waitForFunction(() => document.getAnimations().length === 0);

const PAGE = `<!doctype html><meta charset="utf-8"><title>Testside</title>
<body style="margin:0;font:16px system-ui;background:rgb(250,250,250)">
<header style="padding:18px 24px;background:rgb(29,37,51);color:white">Min app</header>
<main style="padding:24px"><h1>Velkommen</h1><button>Lagre</button></main>`;

// A local page in the Browser panel of a project.
async function openPage(h: Harness): Promise<{ url: string; close: () => void }> {
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  const site = http.createServer((_req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
  await openTool(h.page, "Nettleser");
  const address = h.page.getByLabel("Adresse");
  await address.fill(url);
  await address.press("Enter");
  await h.page.locator(".browser-tab", { hasText: "Testside" }).waitFor();
  await waitFor(() => h.page.getByRole("button", { name: "Annoter", exact: true }).evaluate((el) => el.getAttribute("aria-disabled") === "false"), "Annoter er klar");
  return { url, close: () => site.close() };
}

async function frozen(page: Page) {
  const layer = page.getByRole("dialog", { name: "Annoter siden" });
  await layer.waitFor();
  // The server's PNG has replaced the frame from the canvas.
  await layer.locator("img.annotate-picture").waitFor();
  await waitFor(() => layer.getByRole("button", { name: "Ferdig" }).isEnabled(), "klar til å tegne");
  await layer.getByRole("button", { name: "Klikk", exact: true }).click();
  return { layer, frame: (await layer.locator(".annotate-frame").boundingBox())! };
}

flow("Annoter: markører med kommentarer, rektangel, penn, tekst, Angre og Tøm, og Ferdig gir bilde og liste i meldingsfeltet", async (h) => {
  const { page } = h;
  await openProject(h);
  const site = await openPage(h);
  try {
    const button = page.getByRole("button", { name: "Annoter", exact: true });
    assert.equal(await button.getAttribute("data-keys"), "browser.annotate", "tipset viser hurtigtasten");
    await button.click();
    const { layer, frame } = await frozen(page);
    await still(page);
    assert.equal(await layer.getByRole("button", { name: "Klikk", exact: true }).getAttribute("aria-pressed"), "true", "Klikk er valgt");
    await layer.getByRole("status").getByText("Klikk der noe skal endres").waitFor();

    // Two markers, each with a comment typed right after the click.
    const at = (fx: number, fy: number) => [frame.x + frame.width * fx, frame.y + frame.height * fy] as const;
    await page.mouse.click(...at(0.3, 0.3));
    await page.keyboard.type("Knappen er for liten");
    await page.keyboard.press("Enter");
    await page.mouse.click(...at(0.6, 0.5));
    await page.keyboard.type("Mer luft over overskriften");
    await page.keyboard.press("Enter");
    const markers = layer.getByTestId("annotate-marker");
    assert.equal(await markers.count(), 2);
    assert.deepEqual(await markers.locator("text").allTextContents(), ["1", "2"]);
    // A marker again opens its comment.
    const first = (await markers.first().boundingBox())!;
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
    assert.equal(await layer.getByLabel("Kommentar til markør 1").inputValue(), "Knappen er for liten");
    await page.keyboard.press("Escape");
    assert.equal(await layer.count(), 1, "Esc i boblen lukker bare boblen");

    // A rectangle, a line with the pen, and text, chosen with the keys.
    await page.keyboard.press("r");
    await page.mouse.move(...at(0.05, 0.03));
    await page.mouse.down();
    await page.mouse.move(...at(0.45, 0.12), { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("p");
    await page.mouse.move(...at(0.2, 0.7));
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(...at(0.2 + i * 0.04, 0.7 + (i % 2) * 0.04));
    await page.mouse.up();
    await layer.getByRole("button", { name: "Tekst", exact: true }).click();
    await page.mouse.click(...at(0.5, 0.85));
    await page.keyboard.type("Mangler logo");
    await page.keyboard.press("Enter");
    assert.equal(await layer.locator(".annotate-ink").count(), 2, "rektangel og penn");
    await layer.locator(".annotate-label-mark", { hasText: "Mangler logo" }).waitFor();

    // Angre takes the last one; Tøm takes all, and Angre brings them back.
    await page.keyboard.press("Control+z");
    assert.equal(await layer.locator(".annotate-label-mark").count(), 0, "teksten er angret");
    await layer.getByRole("button", { name: "Tøm" }).click();
    assert.equal(await markers.count(), 0);
    await layer.getByRole("button", { name: "Angre" }).click();
    assert.equal(await markers.count(), 2, "Tøm kan angres");
    assert.equal(await layer.locator(".annotate-ink").count(), 2);

    // Ferdig: one PNG in the field of the pane that owns the panel, and the list under what is typed.
    await focused(page).getByLabel("Melding").fill("Se på dette");
    await layer.getByRole("button", { name: "Ferdig" }).click();
    await waitFor(async () => (await page.getByRole("dialog", { name: "Annoter siden" }).count()) === 0, "laget er lukket");
    const chip = focused(page).getByTestId("image-chip");
    await chip.waitFor();
    assert.match((await chip.getAttribute("title")) ?? "", /^annotering-127\.0\.0\.1.*\.png$/);
    const text = await focused(page).getByLabel("Melding").inputValue();
    assert.equal(text, `Se på dette\n\nKommentarer til skjermbildet (${site.url.replace("http://", "").replace(/\/$/, "")}):\n1. Knappen er for liten\n2. Mer luft over overskriften`);
    assert.equal(await focused(page).getByLabel("Melding").evaluate((el) => el === document.activeElement), true, "meldingsfeltet har fokus");

    // The picture is the page with the marks drawn in: the accent where marker 1 is.
    const pixel = await chip.locator("img").evaluate(async (img: HTMLImageElement, [fx, fy]) => {
      const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      // A little left of the centre: inside the dot, beside the number.
      return { at: [...ctx.getImageData(Math.round(bitmap.width * fx) - 6, Math.round(bitmap.height * fy), 1, 1).data], accent, png: (await (await fetch(img.src)).blob()).type };
    }, [0.3, 0.3]);
    assert.equal(pixel.png, "image/png");
    const hex = pixel.accent.replace("#", "");
    const accent = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(pixel.at.slice(0, 3).every((v, i) => Math.abs(v - accent[i]) < 40), `aksentfargen på markøren: ${pixel.at} mot ${accent}`);

    // Sent, the image goes with the message.
    await focused(page).getByLabel("Melding").press("Enter");
    await page.getByTestId("user-images").first().waitFor();
  } finally {
    site.close();
  }
});

flow("Annoter: Esc avbryter uten vedlegg, også fra hurtigtasten, og uten side er knappen dempet", async (h) => {
  const { page } = h;
  await openProject(h);
  await openTool(page, "Nettleser");
  await page.getByTestId("browser-newtab").waitFor();
  const button = page.getByRole("button", { name: "Annoter", exact: true });
  assert.equal(await button.getAttribute("aria-disabled"), "true", "Ny fane har ingen side å annotere");
  await button.click({ force: true });
  await page.getByText("Åpne en side i nettleseren først").waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Annoter siden" }).count(), 0);

  const site = await openPage(h);
  try {
    await focused(page).getByLabel("Melding").click();
    await page.keyboard.press("Control+Alt+a");
    const { layer, frame } = await frozen(page);
    await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.keyboard.type("Skal ikke bli med");
    await page.keyboard.press("Escape");
    await waitFor(async () => (await layer.getByTestId("annotate-marker").count()) === 0, "Esc tok den nye markøren");
    await page.mouse.click(frame.x + frame.width / 3, frame.y + frame.height / 3);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await waitFor(async () => (await page.getByRole("dialog", { name: "Annoter siden" }).count()) === 0, "laget er lukket");
    await still(page);
    assert.equal(await focused(page).getByTestId("image-chip").count(), 0, "ingen vedlegg");
    assert.equal(await focused(page).getByLabel("Melding").inputValue(), "", "ingen tekst");
    // Focus goes back to the button.
    assert.equal(await button.evaluate((el) => el === document.activeElement), true);
    // Avbryt does the same.
    await button.click();
    await frozen(page);
    await page.getByRole("dialog", { name: "Annoter siden" }).getByRole("button", { name: "Avbryt" }).click();
    await waitFor(async () => (await page.getByRole("dialog", { name: "Annoter siden" }).count()) === 0, "Avbryt lukker");
    assert.equal(await focused(page).getByTestId("image-chip").count(), 0);
  } finally {
    site.close();
  }
});

flow("Kode-startsiden: Tekst, Token-historikk og Prosjektboks, uten og med prosjekt", async (h) => {
  const { page } = h;
  await kode(page);
  const start = page.getByTestId("pane-empty");
  const expect = async (choice: "text" | "tokens" | "projects", withProject: boolean) => {
    await page.locator(`.home-start[data-start="${choice}"]`).waitFor();
    await start.locator(".home-title", { hasText: withProject ? "Hva skal vi jobbe med i Spill?" : "Hva skal vi bygge?" }).waitFor();
    assert.equal(await start.locator(".home-mark").count(), 1, "ikonet");
    assert.equal(await start.getByTestId("home-tokens").count(), choice === "tokens" ? 1 : 0, `token-historikk: ${choice}`);
    assert.equal(await start.getByTestId(withProject ? "project-home" : "home-projects").count(), choice === "projects" ? 1 : 0, `prosjektboks: ${choice}`);
    // The field at the bottom is the same in all three.
    await focused(page).getByLabel("Melding").waitFor();
    await focused(page).getByTestId("project-picker").waitFor();
  };

  // Without a project. Tekst is the default.
  await expect("text", false);
  await h.api("PATCH", "/api/settings", { codeStart: "tokens" });
  await expect("tokens", false);
  const tokens = start.getByTestId("home-tokens");
  await tokens.locator(".heat-map rect").first().waitFor();
  assert.equal(await tokens.locator(".heat-map rect").count() >= 175, true, "et halvt år");
  assert.equal(await tokens.locator(".token-bars rect").count(), 30, "de siste 30 dagene");
  await tokens.getByText("Ingen tokens ennå").waitFor();
  await h.api("PATCH", "/api/settings", { codeStart: "projects" });
  await expect("projects", false);
  await start.getByTestId("home-projects").getByRole("button", { name: /Velg en mappe/ }).waitFor();
  await start.getByTestId("home-github").getByText("Koble til GitHub").waitFor();

  // A project: its row picks it, and the box then holds the project's own things.
  await h.createProject("Spill");
  const row = start.getByTestId("home-project-row").filter({ hasText: "Spill" });
  await row.click();
  await expect("projects", true);
  const box = start.getByTestId("project-home");
  await box.getByRole("button", { name: /Lag en side/ }).waitFor();
  await box.getByTestId("local-environment").waitFor();
  await box.getByTestId("home-github").getByText("Koble til GitHub").waitFor();
  // The order inside the box: rows, then Lokalt miljø, then GitHub at the bottom.
  const y = async (sel: string) => (await box.locator(sel).first().boundingBox())!.y;
  assert.ok((await y(".home-box-rows")) < (await y('[data-testid="local-environment"]')), "Lokalt miljø under radene");
  assert.ok((await y('[data-testid="local-environment"]')) < (await y('[data-testid="home-github"]')), "GitHub nederst");
  await h.api("PATCH", "/api/settings", { codeStart: "tokens" });
  await expect("tokens", true);
  await h.api("PATCH", "/api/settings", { codeStart: "text" });
  await expect("text", true);
  // The project name still opens the project picker.
  await start.locator(".home-project").click();
  await page.getByRole("dialog", { name: "Velg prosjekt" }).waitFor();
  await page.keyboard.press("Escape");
});

flow("Kode-startsiden: Liten, Middels og Stor, og ikonet skalerer med vinduet", async (h) => {
  const { page } = h;
  await kode(page);
  const mark = page.getByTestId("pane-empty").locator(".home-mark .icon");
  const title = page.getByTestId("pane-empty").locator(".home-title");
  const measure = async () => {
    await still(page);
    return { mark: (await mark.boundingBox())!.width, title: await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) };
  };
  const sizes: Record<string, { mark: number; title: number }> = {};
  for (const size of ["small", "medium", "large"] as const) {
    await h.api("PATCH", "/api/settings", { codeStartSize: size });
    await page.locator(`.home-start[data-size="${size}"]`).waitFor();
    sizes[size] = await measure();
  }
  assert.ok(sizes.small.mark < sizes.medium.mark && sizes.medium.mark < sizes.large.mark, `ikonet: ${JSON.stringify(sizes)}`);
  assert.ok(sizes.small.title < sizes.medium.title && sizes.medium.title < sizes.large.title, `teksten: ${JSON.stringify(sizes)}`);
  assert.ok(sizes.medium.mark > 44, "Middels er større enn det gamle ikonet");

  // A wider window gives a bigger mark; a narrow one a smaller, and nothing flows over.
  await page.setViewportSize({ width: 1900, height: 1000 });
  const wide = await measure();
  await page.setViewportSize({ width: 700, height: 800 });
  const narrow = await measure();
  assert.ok(wide.mark > sizes.large.mark || wide.title > sizes.large.title, "større i et bredt vindu");
  assert.ok(narrow.mark < wide.mark, "mindre i et smalt vindu");
  const over = await title.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  assert.equal(over, false, "teksten flyter ikke over");

  // Chosen in Innstillinger → Kode: the size only shows with Tekst.
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Innstillinger" });
  await settings.getByRole("button", { name: "Kode", exact: true }).click();
  await settings.locator(".settings-title", { hasText: "Kode" }).waitFor();
  const group = settings.getByRole("group", { name: "Størrelse på teksten" });
  await group.getByRole("button", { name: "Liten", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.codeStartSize === "small", "Liten er lagret");
  await settings.getByRole("radio", { name: /^Prosjektboks/ }).click();
  await waitFor(async () => (await group.count()) === 0, "størrelsen gjelder bare Tekst");
  await settings.getByRole("radio", { name: /^Prosjektboks/ }).press("ArrowLeft");
  await settings.getByRole("radio", { name: /^Token-historikk/, checked: true }).waitFor();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.codeStart === "tokens", "piltaster velger");
});

flow("Kode-startsiden: de gamle valgene går over til de nye", async (h) => {
  const { page } = h;
  await kode(page);
  // «Prosjektkort» without a project, or «Hilsen med prosjektkort» with one, is Prosjektboks.
  await h.createProject("Gammel");
  await h.api("PATCH", "/api/settings", { codeStartEmpty: "cards", codeStartProject: "greeting" });
  let boot = (await h.api("GET", "/api/bootstrap")).settings;
  assert.equal(boot.codeStart, "projects");
  await page.locator('.home-start[data-start="projects"]').waitFor();
  await page.getByTestId("home-projects").getByTestId("home-project-row").getByText("Gammel").waitFor();
  // «Enkel hilsen» and «Bare hilsen» are Tekst in Middels.
  await h.api("PATCH", "/api/settings", { codeStartEmpty: "greeting", codeStartProject: "greeting" });
  boot = (await h.api("GET", "/api/bootstrap")).settings;
  assert.deepEqual([boot.codeStart, boot.codeStartSize], ["text", "medium"]);
  await page.locator('.home-start[data-start="text"][data-size="medium"]').waitFor();
  // Innstillinger → Kode shows the choice it became, and the old choices are gone.
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Innstillinger" });
  await settings.getByRole("button", { name: "Kode", exact: true }).click();
  await settings.getByRole("radio", { name: /^Tekst/, checked: true }).waitFor();
  await settings.getByRole("group", { name: "Størrelse på teksten" }).getByRole("button", { name: "Middels", pressed: true }).waitFor();
  assert.equal(await settings.getByRole("radio").count(), 3, "tre valg");
  for (const old of ["Enkel hilsen", "Prosjektkort", "Bare hilsen", "Hilsen med prosjektkort"]) assert.equal(await settings.getByText(old, { exact: true }).count(), 0, old);
});
