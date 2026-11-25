// Round 10 (SPEC 23): the Browser panel as a small Chrome (tabs, the + with its hover menu, full
// view, Ny fane that fits the width, import from a fake Chrome profile), the sidebar without empty
// texts, the model list with search, the effort picker without bolt and box, calm pane buttons,
// the profile menu inside the sidebar, the message field without a focus mark, and no «Ny tråd» as
// a title. Demo model and local fakes only; the Chrome profile lives in the test's temporary home.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { flow, openProject, send, threadItem, waitFor, type Harness, openTool } from "./harness.ts";

const focused = (page: Page) => page.locator(".pane-inner.focused");
const kode = (page: Page) => page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
const tabs = (page: Page) => page.locator(".browser-tab");
// The text a sighted user sees: everything but the parts only screen readers get.
const visibleText = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return (copy.textContent ?? "").trim();
};
const plus = (page: Page) => page.locator(".browser-tabs").getByRole("button", { name: "Ny nettleserfane", exact: true });

function fakeChromeProfile(h: Harness, count: number): void {
  const dir = path.join(h.home, ".config/google-chrome/Default");
  mkdirSync(dir, { recursive: true });
  const children = Array.from({ length: count }, (_, i) => ({ type: "url", name: `Bokmerke ${i + 1}`, url: `https://side${i + 1}.example/` }));
  writeFileSync(path.join(dir, "Bookmarks"), JSON.stringify({ roots: { bookmark_bar: { type: "folder", name: "Bookmarks bar", children } } }));
  // Never read: if it were, the marker would show up somewhere.
  for (const name of ["Cookies", "Login Data", "Web Data"]) writeFileSync(path.join(dir, name), "HEMMELIG");
}

flow("nettleseren som en liten Chrome: faner, + med hover-meny som ikke blinker, tastatur, hurtigtaster og fullvisning", async (h) => {
  const { page } = h;
  // v0.19: the default "Felles topprad" shows browser pages in the panel's shared tab row. This
  // test is about the Nettleser's own tab strip ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  await openProject(h);
  await openTool(page, "Nettleser");
  await page.getByTestId("browser-newtab").waitFor();
  await waitFor(async () => (await tabs(page).count()) === 1, "én fane");
  await page.locator(".browser-tab.active", { hasText: "Ny fane" }).waitFor();

  // A click on + makes a tab, and it is the one shown.
  await plus(page).click();
  await waitFor(async () => (await tabs(page).count()) === 2, "to faner");
  assert.equal(await page.locator(".browser-tab").nth(1).getAttribute("class").then((c) => c?.includes("active")), true);
  await page.mouse.move(700, 600);
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".newtab-menu").count(), 0, "klikket viste ingen meny");

  // Resting on + shows the menu. Moving from + into the menu never takes it away (no blink).
  await page.evaluate(() => {
    (window as any).__menuGone = 0;
    new MutationObserver((list) => {
      for (const m of list) for (const node of m.removedNodes) {
        if (node instanceof Element && (node.matches(".newtab-menu") || node.querySelector(".newtab-menu"))) (window as any).__menuGone++;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await plus(page).hover();
  const menu = page.getByRole("menu", { name: "Ny nettleserfane" });
  await menu.waitFor();
  assert.equal(await plus(page).getAttribute("aria-expanded"), "true");
  await menu.getByRole("menuitem", { name: /Ny nettleserfane i fullvisning/ }).locator("kbd", { hasText: "Ctrl+Shift+F" }).waitFor();
  await menu.getByRole("menuitem", { name: /^Ny nettleserfane/ }).first().locator("kbd", { hasText: "Ctrl+Alt+B" }).waitFor();
  const from = (await plus(page).boundingBox())!;
  const to = (await menu.getByRole("menuitem").first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.waitForTimeout(400);
  assert.equal(await menu.count(), 1, "menyen står");
  assert.equal(await page.evaluate(() => (window as any).__menuGone), 0, "menyen blinket ikke");
  // Leaving both, it goes after a moment.
  await page.mouse.move(700, 600);
  await waitFor(async () => (await menu.count()) === 0, "menyen går");

  // A click on + while the menu shows closes it and makes a tab; the menu does not come back.
  await plus(page).hover();
  await menu.waitFor();
  await plus(page).click();
  await waitFor(async () => (await tabs(page).count()) === 3, "tre faner");
  await page.waitForTimeout(500);
  assert.equal(await menu.count(), 0, "lukket, og ikke åpnet igjen");

  // From the keyboard: ↓ opens it with focus on the first row, Esc closes it and gives focus back.
  await page.mouse.move(700, 600);
  await plus(page).focus();
  await page.keyboard.press("ArrowDown");
  await menu.waitFor();
  await waitFor(async () => (await page.evaluate(() => document.activeElement?.textContent ?? "")).startsWith("Ny nettleserfane"), "første rad har fokus");
  await page.keyboard.press("ArrowDown");
  await waitFor(async () => (await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("fullvisning"), "andre rad");
  await page.keyboard.press("Escape");
  await waitFor(async () => (await menu.count()) === 0, "Esc lukker");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Ny nettleserfane", "fokus tilbake på ny nettleserfane");
  // Enter on a row: Ny fane i fullvisning.
  await page.keyboard.press("ArrowDown");
  await menu.waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.locator(".app.panel-full").waitFor();
  await waitFor(async () => (await tabs(page).count()) === 4, "fire faner");
  const panel = (await page.locator(".right-panel").boundingBox())!;
  const side = (await page.locator(".sidebar").boundingBox())!;
  assert.ok(Math.abs(panel.x - (side.x + side.width)) <= 2 && panel.width > 900, `panelet fyller bredden: ${JSON.stringify(panel)}`);
  assert.equal(await page.locator(".main").isVisible(), false);
  await page.getByRole("button", { name: "Avslutt fullvisning" }).first().click();
  await waitFor(async () => (await page.locator(".app.panel-full").count()) === 0, "tilbake");

  // Tabs close with ×; the tab next to it is shown.
  await page.getByRole("button", { name: "Lukk fanen Ny fane" }).last().click();
  await waitFor(async () => (await tabs(page).count()) === 3, "en fane lukket");
  assert.equal(await page.locator(".browser-tab.active").count(), 1);

  // The shortcuts: Ctrl+Alt+B and Ctrl+Shift+F, also from outside the panel.
  await focused(page).getByLabel("Melding").click();
  await page.keyboard.press("Control+Alt+B");
  await waitFor(async () => (await tabs(page).count()) === 4, "Ctrl+Alt+B");
  await focused(page).getByLabel("Melding").click();
  await page.keyboard.press("Control+Shift+F");
  await page.locator(".app.panel-full").waitFor();
  await waitFor(async () => (await tabs(page).count()) === 5, "Ctrl+Shift+F");
  await page.getByRole("button", { name: "Avslutt fullvisning" }).first().click();

  // They can be changed in Innstillinger → Hurtigtaster.
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Hurtigtaster", exact: true }).click();
  await page.locator(".setting", { hasText: "Ny fane i nettleseren" }).locator("kbd", { hasText: "Ctrl+Alt+B" }).waitFor();
  await page.locator(".setting", { hasText: "Ny fane i fullvisning" }).locator("kbd", { hasText: "Ctrl+Shift+F" }).waitFor();
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  // The tabs are on the server: after a reload they are all there.
  await h.reload();
  await openTool(page, "Nettleser");
  await waitFor(async () => (await tabs(page).count()) === 5, "fanene etter omlasting");
});

flow("Ny fane: verktøy og forslag tilpasser seg bredden med ⋯ bare når noe ikke får plass, og import fra en falsk Chrome-profil", async (h) => {
  const { page } = h;
  fakeChromeProfile(h, 20);
  // Round 12 (SPEC 26.4): the fake profile has a Cookies file, so the panel would offer to import
  // cookies the first time it opens. That offer is tested in 35-runde12b; here it is answered.
  await h.api("PATCH", "/api/settings", { cookieOffer: "never" });
  await openProject(h);
  await openTool(page, "Nettleser");
  const newtab = page.getByTestId("browser-newtab");
  await newtab.waitFor();
  // The panel is narrow: two tools, and ⋯ with the rest.
  await newtab.getByRole("button", { name: "Flere verktøy" }).waitFor();
  assert.equal(await newtab.locator(".newtab-tool").count(), 2);
  await newtab.getByRole("button", { name: "Flere verktøy" }).click();
  await page.getByRole("menu", { name: "Flere verktøy" }).getByRole("menuitem", { name: /Endringer/ }).waitFor();
  await page.keyboard.press("Escape");
  // In full view everything fits, and ⋯ is gone.
  await page.getByRole("button", { name: "Fullvisning", exact: true }).click();
  await waitFor(async () => (await newtab.getByRole("button", { name: "Flere verktøy" }).count()) === 0, "alt får plass");
  assert.equal(await newtab.locator(".newtab-tool").count(), 4);
  await newtab.locator(".newtab-tool kbd", { hasText: "Ctrl+Alt+1" }).waitFor();
  await page.getByRole("button", { name: "Avslutt fullvisning" }).first().click();

  // The tip on Ny fane opens the import: pick a profile, see what comes, then import.
  await newtab.getByRole("note", { name: "Tips: importer fra Chrome" }).getByRole("button", { name: "Importer…" }).click();
  const dialog = page.getByRole("dialog", { name: "Importer fra Chrome" });
  await dialog.getByText("Aldri passord, informasjonskapsler, kort eller økter").waitFor();
  await dialog.getByRole("radio", { name: /Google Chrome · Standard/, checked: true }).waitFor();
  const preview = dialog.getByTestId("chrome-import-preview");
  await preview.getByText("20 bokmerker").waitFor();
  await preview.getByText("Bokmerke 1", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("checkbox", { name: /Ta med historikken/ }).isDisabled(), true, "ingen historikk i profilen");
  assert.equal((await h.api("GET", "/api/browser/imported")).importedAt, null, "ingenting før du trykker Importer");
  await dialog.getByRole("button", { name: "Importer", exact: true }).click();
  await page.locator(".toast", { hasText: "Importerte 20 bokmerker." }).waitFor();
  assert.ok(!JSON.stringify(await h.api("GET", "/api/browser/imported")).includes("HEMMELIG"));

  // The bookmarks are suggested: as many tiles as two rows hold, and the rest behind Flere.
  await newtab.locator(".newtab-site", { hasText: "Bokmerke 1" }).first().waitFor();
  assert.equal(await newtab.getByRole("note", { name: "Tips: importer fra Chrome" }).count(), 0, "tipset er borte etter import");
  const more = newtab.locator(".newtab-site-more");
  await more.waitFor();
  const columns = await newtab.locator(".newtab-suggestions").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  assert.equal(await newtab.locator(".newtab-site:not(.newtab-site-more)").count(), columns * 2 - 1, "to rader og Flere");
  await more.click();
  await page.getByRole("menu", { name: "Flere forslag" }).getByRole("menuitem", { name: /Bokmerke 16/ }).waitFor();
  await page.keyboard.press("Escape");
  // ⋯ in the toolbar has them too.
  await page.getByRole("button", { name: "Mer for nettleseren" }).click();
  await page.locator(".browser-menu").getByRole("menuitem", { name: /Bokmerker/ }).hover();
  await page.locator('.context-menu[data-depth="1"]').getByRole("menuitem", { name: /Bokmerke 3/ }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Innstillinger → Nettleser says what was imported, and removes it.
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Nettleser", exact: true }).click();
  await page.getByTestId("chrome-import-status").getByText(/20 bokmerker fra Google Chrome · Standard/).waitFor();
  await page.locator(".setting", { hasText: "Bokmerker og historikk" }).getByRole("button", { name: "Fjern" }).click();
  await page.getByTestId("chrome-import-status").getByText("Ingenting er importert ennå.").waitFor();
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
});

flow("sidefanen uten tomtekst, modellvelger med søk og grupper, innsats uten lyn, rolige ruteknapper og profilmenyen i sidefanen", async (h) => {
  const { page } = h;
  await kode(page);
  // 23.2: no empty text, and no Denne datamaskinen before it has a thread.
  // Round 11 (SPEC 24.4): Kode has the heading Chatter, with no + by it.
  await page.locator('.section-head[data-section="chats"]', { hasText: "Chatter" }).waitFor();
  assert.equal(await page.locator(".sidebar .sidebar-empty").count(), 0, "ingen «Ingen prosjekter ennå»");
  assert.equal(await page.getByTestId("local-group").count(), 0, "Denne datamaskinen venter på en tråd");

  // The button shows the model without a provider monogram. Then three models from a local
  // provider (no calls are made) besides the demo model.
  const button = page.getByTestId("model-button");
  assert.equal(await button.locator(".provider-glyph").count(), 0);
  await button.getByText("Demo-modell").waitFor();
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: "http://127.0.0.1:9/v1" });
  for (const name of ["Alfa rask", "Beta stor", "Gamma liten"]) await h.api("POST", "/api/models", { providerId: provider.id, name, model: name.toLowerCase().replace(" ", "-"), contextWindow: 100000 });
  await button.click();
  const search = page.getByRole("combobox", { name: "Søk etter modeller" });
  await waitFor(async () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Søk etter modeller"), "søkefeltet har fokus");
  const list = page.getByRole("listbox", { name: "Modeller" });
  await list.getByRole("group", { name: "Demo" }).getByRole("option", { name: /Demo-modell/ }).waitFor();
  await list.getByRole("group", { name: "Lokal test" }).getByRole("option", { name: "Beta stor" }).waitFor();
  assert.equal(await list.getByRole("option", { selected: true }).count(), 1, "én valgt");
  await list.getByRole("option", { selected: true }).locator(".menu-check svg").waitFor();
  // Search, and Enter picks the marked row.
  await search.fill("gam");
  await waitFor(async () => (await list.getByRole("option").count()) === 1, "ett treff");
  await search.fill("finnes ikke");
  await page.getByText("Ingen modeller passer «finnes ikke».").waitFor();
  await search.fill("beta");
  await search.press("Enter");
  await button.getByText("Beta stor").waitFor();
  assert.equal(await button.locator(".provider-glyph").count(), 0);
  assert.equal(await list.count(), 0, "lukket etter valget");
  // ↓ and Enter: from the chosen one to the next.
  await button.click();
  await list.getByRole("option", { name: "Beta stor", selected: true }).waitFor();
  await search.press("ArrowDown");
  assert.equal(await list.locator(".model-option.active").textContent(), "Gamma liten");
  await search.press("Enter");
  await button.getByText("Gamma liten").waitFor();
  // The button that opened it closes it; Esc closes it.
  await button.click();
  await list.waitFor();
  await button.click();
  await page.waitForTimeout(300);
  assert.equal(await list.count(), 0, "lukket av knappen, ikke åpnet igjen");
  await button.click();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await list.count()) === 0, "Esc");
  // A long list scrolls between the search field and Administrer modeller.
  for (let i = 1; i <= 14; i++) await h.api("POST", "/api/models", { providerId: provider.id, name: `Ekstra ${i}`, model: `ekstra-${i}`, contextWindow: 100000 });
  await button.click();
  const scroll = await page.locator(".model-list").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  assert.ok(scroll.scroll > scroll.client, "lista scroller");
  await page.getByRole("button", { name: "Administrer modeller" }).waitFor();
  await page.getByRole("button", { name: "Administrer modeller" }).click();
  await page.locator(".settings-title", { hasText: "Modeller" }).waitFor();
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  // 23.4: no bolt and no grey box in the effort picker.
  await page.getByTestId("effort-button").click();
  const effort = page.getByTestId("effort-picker");
  await effort.waitFor();
  assert.equal(await effort.locator(".effort-bolt").count(), 0);
  const mid = await effort.locator(".effort-mid").evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.ok(mid === "rgba(0, 0, 0, 0)" || mid === "transparent", `ingen bakgrunn: ${mid}`);
  await page.keyboard.press("Escape");

  // 23.5: two panes. The buttons stand in both, and nothing changes when the pointer comes and goes.
  await page.getByTestId("new-pane").click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 2, "to ruter");
  const close = page.locator(".pane-inner").first().getByRole("button", { name: "Lukk ruten" });
  const look = () => close.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { x: r.x, y: r.y, w: r.width, opacity: s.opacity, visibility: s.visibility, color: s.color };
  });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  const outside = await look();
  const head = (await page.locator(".pane-inner").first().locator(".pane-head").boundingBox())!;
  await page.mouse.move(head.x + 60, head.y + head.height / 2);
  await page.waitForTimeout(250);
  assert.deepEqual(await look(), outside, "lik med og uten musen i ruten");
  assert.equal(outside.opacity, "1");
  const pane = (await page.locator(".pane-inner").first().boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.waitForTimeout(250);
  assert.deepEqual(await look(), outside, "lik med musen midt i ruten");

  // 23.6: the profile menu stays inside the sidebar, at the default, narrow and wide widths.
  const handle = page.locator(".sidebar-resize");
  for (const target of [null, 220, 460]) {
    if (target !== null) {
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 200);
      await page.mouse.down();
      await page.mouse.move(target, box.y + 200, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
    }
    const sidebar = (await page.locator(".sidebar").boundingBox())!;
    await page.getByRole("button", { name: "Profil", exact: true }).click();
    const profile = page.getByRole("menu", { name: "Profilmeny" });
    await profile.waitFor();
    await page.waitForTimeout(300); // after the menu's own small scale-in
    const box = (await profile.boundingBox())!;
    assert.ok(box.x >= sidebar.x + 4 && box.x + box.width <= sidebar.x + sidebar.width - 4, `inni sidefanen ved ${Math.round(sidebar.width)} px: ${JSON.stringify(box)}`);
    assert.ok(Math.abs(box.width - (sidebar.width - 16)) <= 2, `like bred som sidefanen minus marg: ${box.width} mot ${sidebar.width}`);
    const scroll = await profile.evaluate((el) => el.scrollWidth - el.clientWidth);
    assert.equal(scroll, 0, "ingenting stikker ut i menyen");
    // Hjelp › opens to the side, outside the sidebar.
    await profile.getByRole("menuitem", { name: /Hjelp/ }).hover();
    const sub = page.locator('.context-menu[data-depth="1"]');
    await sub.waitFor();
    await page.waitForTimeout(300);
    const subBox = (await sub.boundingBox())!;
    assert.ok(subBox.x >= box.x + box.width - 6, `undermenyen til siden: ${JSON.stringify(subBox)} ${JSON.stringify(box)}`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await waitFor(async () => (await profile.count()) === 0, "lukket");
  }
});

flow("meldingsfeltet har ingen markering ved fokus, i standard og Høy kontrast, mens knapper har fokusring fra tastaturet", async (h) => {
  const { page } = h;
  const box = focused(page).locator(".composer");
  const field = box.locator("textarea");
  const styles = async () => ({
    box: await box.evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor, s.borderTopWidth, s.boxShadow, s.outlineStyle, s.outlineWidth, s.backgroundColor].join(" | "); }),
    field: await field.evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopColor, s.borderTopWidth, s.boxShadow, s.outlineStyle, s.outlineWidth, s.backgroundColor].join(" | "); }),
  });
  for (const preset of ["standard", "kontrast"]) {
    await h.api("PATCH", "/api/settings", { themePreset: preset });
    await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.palette ?? "standard")) === preset, `tema ${preset}`);
    await field.evaluate((el) => (el as HTMLTextAreaElement).blur());
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    const before = await styles();
    await field.click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250); // past any transition
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "TEXTAREA");
    assert.deepEqual(await styles(), before, `likt med og uten fokus (${preset})`);
    // From the keyboard too.
    await field.evaluate((el) => (el as HTMLTextAreaElement).blur());
    await field.focus();
    await page.waitForTimeout(250);
    assert.deepEqual(await styles(), before, `likt med fokus fra tastaturet (${preset})`);
  }
  // A button still shows where focus is when you use the keyboard.
  await field.focus();
  await page.keyboard.press("Shift+Tab");
  const ring = await page.evaluate(() => { const el = document.activeElement as HTMLElement; const s = getComputedStyle(el); return { tag: el.tagName, style: s.outlineStyle, width: s.outlineWidth }; });
  assert.equal(ring.tag, "BUTTON");
  assert.notEqual(ring.style, "none", "fokusring på knappen");
});

flow("ingen «Ny tråd» som tittel: tomt toppfelt og rute, ikke i sidefanen før første melding, og et skjult navn i smale vinduer", async (h) => {
  const { page } = h;
  await kode(page);
  assert.equal(await page.getByTestId("topbar-title").count(), 0, "ingen tittel i toppfeltet");
  assert.equal(await page.locator(".topbar").getByText("Ny tråd", { exact: true }).count(), 0);
  assert.equal(await focused(page).locator(".pane-title").evaluate(visibleText), "", "ingen synlig tittel i ruten");
  // An empty thread (made by the API, as a pane does before the first message) is not listed.
  const empty = await h.api("POST", "/api/threads", { projectId: null, mode: "code" });
  await page.waitForTimeout(300);
  assert.equal(await threadItem(page, empty.id).count(), 0, "en tom tråd står ikke i sidefanen");
  assert.equal(await page.locator(".sidebar .thread-item", { hasText: "Ny tråd" }).count(), 0);
  // The button Ny tråd is an action and stays.
  await page.locator(".sidebar-nav").getByRole("button", { name: "Ny tråd", exact: true }).waitFor();

  // The first message gives it a title: then it is in the sidebar and at the top.
  await send(page, "hei der");
  await page.getByTestId("topbar-title").getByText("hei der").waitFor();
  await page.getByTestId("local-group").locator(".thread-item", { hasText: "hei der" }).waitFor();

  // Two panes in a narrow window: the empty one's tab has a hidden name, no visible text.
  await page.getByTestId("new-pane").click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 2, "to ruter");
  const pane = page.locator(".pane-inner").nth(1);
  assert.equal(await pane.locator(".pane-title").getAttribute("title"), null);
  assert.equal(await pane.locator(".pane-title").evaluate(visibleText), "", "bare et skjult navn");
  await pane.locator(".pane-title .sr-only", { hasText: "Tom tråd" }).waitFor({ state: "attached" });
  await page.setViewportSize({ width: 420, height: 760 });
  const tab = page.locator(".pane-tabs").getByRole("tab", { name: "Tom tråd" });
  await tab.waitFor();
  assert.equal((await tab.innerText()).trim(), "", "ingen synlig tekst");
  await page.locator(".pane-tabs").getByRole("tab", { name: "hei der" }).waitFor();
});

flow("skjult sidefane som en tynn ikonrad: rekkefølge, markering, tips, valget i Utseende og ingen rad i smale vinduer", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
  await page.locator(".sidebar").waitFor({ state: "detached" });
  const rail = page.getByRole("navigation", { name: "Snarveier" });
  await rail.waitFor();
  const box = (await rail.boundingBox())!;
  assert.ok(Math.abs(box.width - 48) <= 1, `48 px bred: ${box.width}`);
  const names = await rail.getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  assert.deepEqual(names, ["Vis sidefanen", "Chat", "Kode", "Studio", "Ny tråd", "Søk i tråder", "Artifacts", "Skills", "Prosjekt: Demo", "Varsler", "Innstillinger", "Pull requests", "Issues", "Profil"]);
  // The mode and the open project are marked; the mode switch is not also in the top bar.
  await rail.getByRole("button", { name: "Kode", pressed: true }).waitFor();
  assert.equal(await rail.getByRole("button", { name: "Prosjekt: Demo" }).getAttribute("aria-current"), "page");
  assert.equal(await page.locator(".topbar-mode").isVisible(), false);
  // The tip has the name and the keys.
  await rail.getByRole("button", { name: "Ny tråd" }).hover();
  const tip = page.locator(".app-tooltip.visible");
  await tip.getByText("Ny tråd").waitFor();
  await tip.locator("kbd", { hasText: "Ctrl+Alt+N" }).waitFor();
  // Chat: no projects in the row.
  await rail.getByRole("button", { name: "Chat" }).click();
  await rail.getByRole("button", { name: "Chat", pressed: true }).waitFor();
  assert.equal(await rail.getByRole("button", { name: /^Prosjekt:/ }).count(), 0);
  await rail.getByRole("button", { name: "Kode" }).click();
  // The avatar opens the profile menu, and Vis sidefanen brings the sidebar back.
  await rail.getByRole("button", { name: "Profil" }).click();
  await page.getByRole("menu", { name: "Profilmeny" }).waitFor();
  await page.keyboard.press("Escape");
  await rail.getByRole("button", { name: "Vis sidefanen" }).click();
  await page.locator(".sidebar").waitFor();
  assert.equal(await rail.count(), 0);

  // Innstillinger → Utseende: Helt borte.
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Utseende", exact: true }).click();
  await page.getByRole("group", { name: "Skjult sidefane" }).getByRole("button", { name: "Helt borte" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.sidebarCollapsed === "hidden", "lagret");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
  await page.locator(".sidebar").waitFor({ state: "detached" });
  await page.waitForTimeout(200);
  assert.equal(await rail.count(), 0, "helt borte");
  await page.locator(".topbar-mode").waitFor();

  // Back to the row, and in a narrow window there is none.
  await h.api("PATCH", "/api/settings", { sidebarCollapsed: "rail" });
  await rail.waitFor();
  await page.setViewportSize({ width: 800, height: 800 });
  await waitFor(async () => !(await rail.isVisible()), "ingen rad under 860 px");
  await page.locator(".topbar-mode").waitFor();
});

flow("glimt på statusteksten mens turen kjører, borte når den er ferdig, og stille ved redusert bevegelse", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  const look = (el: Element) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, state: s.animationPlayState, clip: s.backgroundClip, color: s.color, visible: el.hasAttribute("data-visible") };
  };

  // While the turn runs: «Jobber… 12s» shimmers, with one gradient clipped to the text, on screen only.
  await send(page, "lag en side");
  const live = page.locator(".work-label.shimmer");
  await live.waitFor();
  const running = await live.evaluate(look);
  assert.equal(running.name, "ad-shimmer");
  assert.equal(running.state, "running");
  assert.equal(running.clip, "text");
  assert.equal(running.color, "rgba(0, 0, 0, 0)", "teksten selv er gjennomsiktig, gradienten tegner den");
  assert.equal(running.visible, true);
  // Round 13 (SPEC 27.1): the now-line under the turn is the one text that shimmers.
  await page.locator(".now-line .shimmer").first().waitFor({ state: "attached" });

  // Done: no shimmer anywhere, and a calm «Jobbet i …» that lights up on hover.
  await page.getByText("Ferdig. ").waitFor({ timeout: 60_000 });
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "ferdig");
  await waitFor(async () => (await page.locator(".shimmer").count()) === 0, "ingen glimt etter turen");
  const label = page.locator(".work-label").first();
  assert.match((await label.textContent()) ?? "", /^Jobbet i/);
  await page.mouse.move(5, 5);
  const calm = await label.evaluate((el) => getComputedStyle(el).color);
  await page.locator(".work-head").first().hover();
  await waitFor(async () => (await label.evaluate((el) => getComputedStyle(el).color)) !== calm, "lys ved hover");

  // Reduced motion: the text stands still, muted.
  await h.api("PATCH", "/api/settings", { reduceMotion: true });
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.motion)) === "reduce", "redusert bevegelse");
  await page.locator(".sidebar-nav").getByRole("button", { name: "Ny tråd", exact: true }).click();
  await send(page, "lag en side");
  const still = page.locator(".work-label.shimmer");
  await still.waitFor();
  const quiet = await still.evaluate(look);
  assert.equal(quiet.name, "none", "ingen animasjon");
  assert.notEqual(quiet.color, "rgba(0, 0, 0, 0)", "vanlig dempet tekst");
  await page.getByText("Ferdig. ").first().waitFor({ timeout: 60_000 });
}, { mockDelayMs: 40 });

flow("premium tenkevisning i Chat: kort med modell, statuslinje, fremdrift og Detaljer, og kompakt form etterpå", async (h) => {
  const { page } = h;
  // Innstillinger → Chat: Tenkevisning.
  await page.keyboard.press("Control+,");
  await page.locator(".settings-nav").getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("group", { name: "Tenkevisning" }).getByRole("button", { name: "Premium" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.thinkingView === "premium", "lagret");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  // «tenk grundig» makes the demo model think for a few seconds, a line at a time.
  await send(page, "tenk grundig om dette");
  const card = page.getByTestId("thinking-card");
  await card.waitFor();
  await card.locator(".premium-title", { hasText: "Forespørsel til Demo-modell (uten API)" }).waitFor();
  const line = card.locator(".premium-line");
  await line.waitFor();
  const first = (await line.textContent()) ?? "";
  await waitFor(async () => ((await line.textContent()) ?? "") !== first && ((await line.textContent()) ?? "") !== "", "statuslinjen går videre");
  // The progress line fills with transform only, and never claims to be done while it works.
  const fill = await card.locator(".premium-fill").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  assert.ok(fill > 0 && fill < 0.95, `fremdrift ${fill}`);
  await card.getByRole("button", { name: "Detaljer" }).click();
  await page.locator(".premium-text", { hasText: "Går gjennom delene" }).waitFor();
  await card.getByRole("button", { name: "Detaljer" }).click();

  // Done: the same card, with «Tenkte i …» as the button that opens the summary, and no Detaljer.
  await page.getByText("Jeg tenkte meg om før jeg svarte.").waitFor({ timeout: 30_000 });
  const done = card.getByRole("button", { name: /^Tenkte i \d/ });
  await done.waitFor();
  assert.equal(await card.getByRole("button", { name: "Detaljer" }).count(), 0, "ingen egen Detaljer-knapp");
  assert.equal(await card.locator(".premium-progress").count(), 0);
  await card.locator(".premium-title", { hasText: "Forespørsel til" }).waitFor();
  await done.click();
  await page.locator(".premium-text", { hasText: "Samler svaret" }).waitFor();
  assert.equal(await done.getAttribute("aria-expanded"), "true");

  // Vanlig: the fold as before.
  await h.api("PATCH", "/api/settings", { thinkingView: "standard" });
  await waitFor(async () => (await card.count()) === 0, "vanlig visning");
  await page.locator(".row-thinking .fold", { hasText: /Tenkte i/ }).waitFor();
});

flow("en skjult overraskelse åpnes og lukkes uten bivirkninger", async (h) => {
  const { page } = h;
  const before = JSON.stringify((await h.api("GET", "/api/bootstrap")).settings);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
  // Typed in a field, nothing happens.
  await focused(page).getByLabel("Melding").click();
  await page.keyboard.type("nordlys");
  await page.waitForTimeout(400);
  assert.equal(await page.getByTestId("nordlys").count(), 0, "ikke fra et tekstfelt");
  await focused(page).getByLabel("Melding").fill("");
  // Typed with no field in focus, it opens.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type("nordlys");
  const layer = page.getByRole("dialog", { name: "Nordlys" });
  await layer.waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await layer.count()) === 0, "Esc lukker");
  // Again, and a click closes it; with reduced motion it stands still.
  await h.api("PATCH", "/api/settings", { reduceMotion: true });
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.motion)) === "reduce", "redusert bevegelse");
  const settings = JSON.stringify((await h.api("GET", "/api/bootstrap")).settings);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type("nordlys");
  await layer.waitFor();
  const moving = await layer.evaluate((el) => [el, ...el.querySelectorAll("*")].filter((n) => getComputedStyle(n).animationName !== "none").length);
  assert.equal(moving, 0, "ingen bevegelse");
  await layer.click();
  await waitFor(async () => (await layer.count()) === 0, "et klikk lukker");
  // Nothing went anywhere but the app's own files, and nothing changed.
  const origin = new URL(page.url()).origin;
  const writes = requests.filter((r) => !r.startsWith("GET ") && !r.includes("/api/settings"));
  assert.deepEqual(writes, [], "ingen skriving");
  assert.ok(requests.every((r) => r.split(" ")[1].startsWith(origin)), "bare appens egen adresse");
  assert.equal(JSON.stringify((await h.api("GET", "/api/bootstrap")).settings), settings, "innstillingene er urørt");
  assert.notEqual(before, settings); // (only the test's own reduceMotion)
});
