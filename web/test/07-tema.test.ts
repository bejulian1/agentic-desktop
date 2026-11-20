import assert from "node:assert/strict";
import { flow } from "./harness.ts";

const LIGHT = "rgb(255, 255, 255)";
const DARK = "rgb(27, 27, 27)";

const background = (page: import("playwright-core").Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
const theme = (page: import("playwright-core").Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

// Records the theme attribute and the background from the very first frames of a page load.
const WATCH_FIRST_FRAMES = `
  window.__frames = [];
  window.__attr = [];
  new MutationObserver((records) => {
    for (const r of records) if (r.attributeName === "data-theme") window.__attr.push([document.documentElement.getAttribute("data-theme"), !!document.body]);
  }).observe(document, { attributes: true, subtree: true });
  const sample = () => {
    if (window.__frames.length >= 12) return;
    window.__frames.push(getComputedStyle(document.documentElement).backgroundColor);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
`;

flow("Lys, Mørk og System, uten blink ved oppstart", async (h) => {
  const { page, context } = h;
  await page.getByRole("button", { name: "Innstillinger" }).click();
  await page.getByRole("button", { name: "Utseende", exact: true }).click();
  const group = page.getByRole("group", { name: "Tema" });

  await group.getByRole("button", { name: "Mørk" }).click();
  assert.equal(await theme(page), "dark");
  assert.equal(await background(page), DARK);

  await group.getByRole("button", { name: "Lys" }).click();
  assert.equal(await theme(page), "light");
  assert.equal(await background(page), LIGHT);

  await group.getByRole("button", { name: "System" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");

  // A stored dark theme on a light system: no light frame, ever.
  await group.getByRole("button", { name: "Mørk" }).click();
  await page.waitForTimeout(100);
  await context.addInitScript(WATCH_FIRST_FRAMES);
  await page.reload();
  await page.waitForSelector(".app");
  await page.waitForFunction(() => (window as any).__frames.length >= 12);
  const frames = await page.evaluate(() => (window as any).__frames) as string[];
  assert.deepEqual([...new Set(frames)], [DARK], "alle de første bildene er mørke");
  const attr = await page.evaluate(() => (window as any).__attr) as Array<[string, boolean]>;
  assert.deepEqual(attr[0], ["dark", false], "temaet settes før <body> finnes");
  assert.ok(attr.every(([value]) => value === "dark"), "temaet skifter aldri under oppstart");

  // The choice follows the user to a window without the local copy.
  const second = await context.newPage();
  await second.addInitScript("try { localStorage.removeItem('ad-theme') } catch {}");
  await second.goto(h.origin);
  await second.waitForSelector(".app");
  await second.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
  await second.close();
});

flow("System følger mørkt system ved oppstart", async (h) => {
  const { page } = h;
  assert.equal(await theme(page), "dark");
  assert.equal(await background(page), DARK);
}, { theme: "dark" });
