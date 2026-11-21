import assert from "node:assert/strict";
import { test } from "node:test";
import { pluralKey, resolveLanguage, translate } from "../../shared/i18n.ts";
import english from "../src/locales/en.json" with { type: "json" };
import { flow, openProject, openTool } from "./harness.ts";

test("system language matching, fallback, placeholders and plurals", () => {
  for (const locale of ["nb-NO", "nn-NO", "no"]) assert.equal(resolveLanguage(undefined, [locale]), "nb");
  assert.equal(resolveLanguage("system", ["fi", "pt-PT"]), "pt-BR");
  assert.equal(resolveLanguage("system", ["fi"]), "en");
  assert.equal(resolveLanguage("ja", ["de"]), "ja");
  assert.equal(translate({}, "Mangler {name}", { name: "$&" }), "Mangler $&");
  const one = "{count} fil", other = "{count} filer";
  const catalog = { [one]: "{count} file", [other]: "{count} files" };
  for (const count of [1, 2]) assert.equal(translate(catalog, pluralKey("en", count, one, other), { count }), count === 1 ? "1 file" : "2 files");
  for (const locale of ["ja", "zh-CN"] as const) assert.equal(pluralKey(locale, 1, one, other), other);
});

flow("changing language updates settings and navigation without a reload and survives restart", async ({ page, api }) => {
  await page.getByTestId("settings-gear").click();
  await page.locator(".settings-nav").getByRole("button", { name: "Generelt", exact: true }).click();
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("button", { name: "Språk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "General", exact: true }).waitFor();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("heading", { name: "Theme and color", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to the app", exact: true }).click();
  await page.getByRole("button", { name: "Code", exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  assert.equal((await api("GET", "/api/bootstrap")).settings.language, "en");
  await page.reload();
  await page.getByRole("button", { name: "Code", exact: true }).first().waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
});

flow("English composer, settings and side panel retain responsive controls", async (harness) => {
  const { page } = harness;
  await openProject(harness);
  await openTool(page, "Oversikt");
  await page.route(/\/assets\/en-[^/]+\.js$/, route => route.fulfill({
    contentType: "application/javascript",
    body: `export default ${JSON.stringify({ ...english, Melding: "Message", Snakkeboble: "Speech bubble" })};`,
  }));
  await page.getByTestId("settings-gear").click();
  await page.locator(".settings-nav").getByRole("button", { name: "Generelt", exact: true }).click();
  await page.getByRole("button", { name: "Språk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "General", exact: true }).waitFor();
  assert.equal((await harness.api("GET", "/api/bootstrap")).settings.language, "en");
  await page.locator(".settings-nav").getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByTestId("app-icon-cards").getByRole("radio", { name: "Speech bubble", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to the app", exact: true }).click();
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await page.locator(".right-panel").getByRole("tab", { name: "Overview", exact: true }).waitFor();
  const split = page.locator('[data-action="split-down"]');
  assert.equal(await split.getAttribute("aria-label"), "Split down");
  assert.notEqual(await split.evaluate(button => getComputedStyle(button).display), "none");
  await page.setViewportSize({ width: 480, height: 850 });
  assert.equal(await split.evaluate(button => getComputedStyle(button).display), "none");
});
