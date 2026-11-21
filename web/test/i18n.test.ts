import assert from "node:assert/strict";
import { test } from "node:test";
import { pluralKey, resolveLanguage, translate } from "../../shared/i18n.ts";
import { flow } from "./harness.ts";

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
