// v1.4.0: a calmer, T3-like workspace. Projects get a colour of their own by default, Kode rows in
// the sidebar are two lines (title and age; where it runs, a linked PR and the model's mark under
// the age), the sidebar's search, notifications and ⋯ stand in the top bar, Prosjekt / Tråd stands
// before the title, and Innstillinger → Utseende → Arbeidsflate switches between Full and Enkel
// (Kode-fokus), with each part on its own switch. Only the demo model; nothing leaves the machine.
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { defaultProjectColor, PROJECT_COLORS } from "../../shared/protocol.ts";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
const colorOf = (id: string) => PROJECT_COLORS.find((c) => c.id === id)!.value;
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

flow("Arbeidsflate: fargede prosjektikoner, tolinjers Kode-rader, verktøy og brødsmule i toppen, og Full/Enkel", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Demo");

  // 1. A project without a colour has one picked from its id, and the same one every time.
  const glyph = page.locator('.group[data-project="Demo"] .group-head .project-glyph');
  assert.equal(project.color, null);
  assert.equal(await glyph.getAttribute("data-color"), "auto");
  const auto = defaultProjectColor(project.id);
  assert.notEqual(auto, "gray", "grått velges aldri automatisk");
  assert.equal(await glyph.evaluate((el) => getComputedStyle(el).color), rgb(colorOf(auto)));

  // 2. A Kode thread is two lines: title and age on top; the project's mark, a linked PR and the
  //    model's coloured mark below, with the mark right under the age.
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "svaret er ferdig");
  const thread = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.projectId === project.id);
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id).title !== "Ny tråd", "tråden har fått navn");
  await h.api("PATCH", `/api/threads/${thread.id}`, { linkedPr: { repo: "eksempel/demo", number: 12 } });
  await page.mouse.move(700, 600);
  const row = threadItem(page, thread.id);
  await row.locator(".thread-pr", { hasText: "#12" }).waitFor();
  assert.match((await row.locator(".thread-pr").getAttribute("title")) ?? "", /eksempel\/demo#12/);
  const meta = row.getByTestId("thread-meta");
  await meta.locator(".thread-where .project-glyph").waitFor();
  await meta.locator('.thread-provider svg[data-provider="demo"]').waitFor();
  const time = (await row.locator(".thread-line .thread-time").boundingBox())!;
  const mark = (await meta.locator(".thread-provider").boundingBox())!;
  const title = (await row.locator(".thread-line .thread-title").boundingBox())!;
  assert.ok(mark.y >= time.y + time.height - 2, `merket står under tiden (${mark.y} / ${time.y + time.height})`);
  assert.ok(Math.abs(mark.x + mark.width - (time.x + time.width)) <= 3, `merket er høyrestilt under tiden (${mark.x + mark.width} / ${time.x + time.width})`);
  assert.ok(Math.abs(title.y - time.y) <= 4, "tittel og tid på samme linje");
  // Hover: the row's buttons take the age's place, and the row keeps its height.
  const before = (await row.boundingBox())!.height;
  await row.hover();
  await row.locator(".thread-menu").waitFor();
  assert.equal(await row.locator(".thread-line .thread-time").isVisible(), false, "tiden viker for knappene");
  assert.equal((await row.boundingBox())!.height, before, "ingen hopp i høyden");
  const markHover = (await meta.locator(".thread-provider").boundingBox())!;
  assert.ok(Math.abs(markHover.x - mark.x) <= 1, "merket flytter seg ikke");
  await page.mouse.move(700, 600);

  // 3. Search, notifications and ⋯ stand in the top bar above the sidebar, and still work.
  const tools = page.locator(".topbar-sidebar-tools");
  await tools.getByRole("button", { name: "Søk", exact: true }).waitFor();
  await tools.getByRole("button", { name: "Varsler" }).waitFor();
  await tools.getByTestId("sidebar-menu").waitFor();
  assert.equal(await page.locator(".sidebar-head").count(), 0);
  const side = await box(page, "aside.sidebar");
  for (const button of await tools.locator(".icon-button").all()) {
    const b = (await button.boundingBox())!;
    assert.ok(b.x >= side.x && b.x + b.width <= side.x + side.width + 1 && b.y + b.height <= side.y + 1, "over sidefanen");
  }
  await tools.getByRole("button", { name: "Søk", exact: true }).click();
  await page.locator(".sidebar .search-input").waitFor();
  await page.keyboard.press("Escape");

  // 4. Prosjekt / Tråd before the title, the title still the one you click to rename.
  const crumb = page.getByTestId("topbar-thread-crumb");
  await crumb.getByText("Demo").waitFor();
  await crumb.locator(".project-glyph").waitFor();
  const crumbBox = (await crumb.boundingBox())!;
  const titleBox = (await page.getByTestId("topbar-title").boundingBox())!;
  assert.ok(crumbBox.x + crumbBox.width <= titleBox.x + 2, "prosjektet står før tittelen");
  // Full keeps the old buttons.
  await page.getByTestId("ui-mods-button").waitFor();
  await page.locator(".project-label").waitFor();

  // 5. Innstillinger → Utseende → Arbeidsflate → Enkel (Kode-fokus).
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  const preset = page.getByRole("group", { name: "Arbeidsflate" });
  await preset.getByRole("button", { name: "Full", exact: true }).and(page.locator('[aria-pressed="true"]')).waitFor();
  await preset.getByRole("button", { name: "Enkel (Kode-fokus)" }).click();
  await waitFor(async () => {
    const s = (await h.api("GET", "/api/bootstrap")).settings;
    return s.topbarLayout === "minimal" && s.sidebarSimple === true && s.composerSimple === true && s.topbarShowPanes === false;
  }, "Enkel er lagret");
  assert.equal(await page.getByRole("switch", { name: "Enkel sidefane", exact: true }).isChecked(), true);
  assert.equal(await page.getByRole("switch", { name: "Enkelt meldingsfelt", exact: true }).isChecked(), true);
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  const minimal = page.getByTestId("topbar-minimal");
  await minimal.waitFor();
  await minimal.getByTestId("thread-details-button").waitFor();
  await minimal.getByRole("button", { name: "Vis eller skjul panelet" }).waitFor();
  for (const gone of ["ui-mods-button", "new-pane", "more-options", "add-panel"]) assert.equal(await page.getByTestId(gone).count(), 0, gone);
  assert.equal(await page.locator(".project-label").count(), 0, "prosjektet står bare i brødsmulen");
  await page.getByTestId("topbar-thread-crumb").getByText("Demo").waitFor();
  // The sidebar: no mode switch or navigation rows; one row with search, new project and new thread.
  assert.equal(await page.locator(".sidebar .mode-switch").count(), 0);
  assert.equal(await page.locator(".sidebar-nav").count(), 0);
  const quick = page.getByTestId("sidebar-quick");
  await quick.getByRole("searchbox", { name: "Søk i tråder" }).waitFor();
  await quick.getByRole("button", { name: "Ny tråd", exact: true }).waitFor();
  await quick.getByRole("button", { name: "Ny tråd i et nytt prosjekt" }).waitFor();
  assert.equal(await page.locator(".topbar-sidebar-tools").getByRole("button", { name: "Søk", exact: true }).count(), 0, "søkefeltet står alltid i sidefanen");
  await page.locator(".topbar-sidebar-tools").getByTestId("sidebar-menu").waitFor();
  // The message field: one calm box once the thread has started.
  assert.equal(await page.locator(".composer-context").count(), 0, "ingen prosjektlinje over feltet");
  // Search from the field still finds the thread.
  await quick.getByRole("searchbox", { name: "Søk i tråder" }).fill("demo");
  await page.locator(".sidebar .section-label", { hasText: "Treff" }).waitFor();
  await page.keyboard.press("Escape");

  // 6. Each part is its own switch: the pane buttons back, and the preset says Egendefinert.
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  await page.getByRole("switch", { name: "Knapper for flere ruter", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.topbarShowPanes === true, "rutene er slått på");
  assert.equal(await preset.locator('[aria-pressed="true"]').count(), 0, "verken Full eller Enkel");
  await page.getByText(/Egendefinert: du har valgt delene under selv/).waitFor();
  await page.getByRole("switch", { name: "Enkel sidefane", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.sidebarSimple === false, "vanlig sidefane");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await page.getByTestId("topbar-minimal").getByTestId("new-pane").waitFor();
  await page.locator(".sidebar .mode-switch").waitFor();
  await page.locator(".sidebar-nav").waitFor();

  // 7. Full clears every part, and the old top bar is back.
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.locator(".settings-nav").getByRole("button", { name: "Utseende", exact: true }).click();
  await preset.getByRole("button", { name: "Full", exact: true }).click();
  await waitFor(async () => {
    const s = (await h.api("GET", "/api/bootstrap")).settings;
    return !("topbarLayout" in s) && !("sidebarSimple" in s) && !("composerSimple" in s) && !("topbarShowPanes" in s);
  }, "Full fjerner valgene");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await page.getByTestId("ui-mods-button").waitFor();
  await page.locator(".composer-context").waitFor();
  assert.equal(await page.getByTestId("topbar-minimal").count(), 0);

  // 8. A colour the user picks wins, grey too.
  await h.api("PATCH", `/api/projects/${project.id}`, { color: "gray" });
  await waitFor(async () => (await glyph.getAttribute("data-color")) === "chosen", "valgt farge");
  assert.equal(await glyph.evaluate((el) => getComputedStyle(el).color), rgb(colorOf("gray")));
});

flow("Arbeidsflate i et smalt vindu: sidefanen har knappene i sin egen rad", async (h) => {
  const { page } = h;
  await page.locator(".sidebar").waitFor();
  // Below 860 px the sidebar lies over the rest when it is open, with the app's name and its buttons.
  await page.setViewportSize({ width: 760, height: 800 });
  const head = page.locator(".sidebar-head");
  await head.waitFor().catch(async () => {
    await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
    await head.waitFor();
  });
  await head.getByRole("button", { name: "Søk", exact: true }).waitFor();
  await head.getByTestId("sidebar-menu").waitFor();
  assert.equal(await page.locator(".topbar-sidebar-tools .icon-button").count(), 0, "ikke to sett med knapper");
}, { viewport: { width: 1360, height: 860 } });
