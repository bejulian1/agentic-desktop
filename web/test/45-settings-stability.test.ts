import assert from "node:assert/strict";
import { flow, waitFor } from "./harness.ts";

for (const scenario of [
  { name: "lyst", theme: "light" as const, viewport: { width: 1440, height: 900 } },
  { name: "mørkt", theme: "dark" as const, viewport: { width: 1440, height: 900 } },
  { name: "smalt", theme: "light" as const, viewport: { width: 680, height: 780 } },
]) {
  flow(`Innstillinger i ${scenario.name} vindu: stabile rammer, navigasjon og søk`, async (h) => {
    const { page } = h;
    page.setDefaultTimeout(10_000);
    await page.route("**/api/config", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.continue();
    });
    const openSettings = async () => {
      const button = page.getByRole("button", { name: "Innstillinger" }).first();
      if (await button.isVisible()) await button.click();
      else await page.keyboard.press("Control+,");
    };
    await openSettings();
    const region = page.getByRole("region", { name: "Innstillinger" });
    await region.waitFor();
    const nav = page.locator(".settings-nav");
    await nav.getByRole("button", { name: "Generelt", exact: true }).click();
    await page.getByRole("heading", { name: "Generelt", exact: true }).waitFor();
    const selectors = [".settings-page", ".settings-nav", ".settings-body", ".settings-content"];
    const persistent = await Promise.all(selectors.map((selector) => page.locator(selector).elementHandle()));
    assert.ok(persistent.every(Boolean));
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector(".settings-nav")!.getBoundingClientRect();
      const content = document.querySelector(".settings-content")!.getBoundingClientRect();
      return { navX: nav.x, navY: nav.y, navWidth: nav.width, navHeight: nav.height, contentX: content.x, contentWidth: content.width };
    });
    let longPages = 0;
    let shortPages = 0;
    for (const label of ["Utseende", "Modeller og leverandører", "Chat", "Konfigurasjon", "Om", "Generelt"]) {
      const scrolled = await page.locator(".settings-body").evaluate((body) => {
        body.scrollTop = body.scrollHeight;
        return body.scrollTop;
      });
      if (scrolled > 0) longPages++; else shortPages++;
      // Probe before the actual click, synchronously after its event, and during subsequent frames.
      // A screenshot after the transition would miss a brief transparent or translated page.
      await page.evaluate(() => {
        const samples: any[] = [];
        const sample = () => {
          const navElement = document.querySelector(".settings-nav");
          const contentElement = document.querySelector(".settings-content");
          if (!navElement || !contentElement) { samples.push({ missing: true }); return; }
          const nav = navElement.getBoundingClientRect();
          const content = contentElement.getBoundingClientRect();
          samples.push({
            missing: false,
            title: [...document.querySelectorAll(".settings-title")].find((title) => !title.closest("[hidden]"))?.textContent,
            navX: nav.x, navY: nav.y, navWidth: nav.width, navHeight: nav.height, contentX: content.x, contentWidth: content.width,
            layers: [".settings-page", ".settings-nav", ".settings-body", ".settings-content", ".settings-section"].map((selector) => {
              const element = [...document.querySelectorAll(selector)].find((node) => !node.closest("[hidden]"));
              if (!element) return null;
              const style = getComputedStyle(element);
              return { selector, opacity: style.opacity, transform: style.transform, animations: element.getAnimations().filter((animation) => animation.playState === "running" && !(animation.effect as KeyframeEffect | null)?.pseudoElement).length };
            }).filter(Boolean),
          });
        };
        const clicked = () => { sample(); queueMicrotask(sample); };
        document.addEventListener("click", clicked);
        const cleanup = () => document.removeEventListener("click", clicked);
        (window as any).__settingsFrameProbe = new Promise<any[]>((resolve, reject) => {
          let frames = 0;
          const timeout = setTimeout(() => { cleanup(); reject(new Error("Rammeprøven ble ikke ferdig")); }, 3000);
          const frame = () => {
            try {
              sample();
              if (++frames < 18) requestAnimationFrame(frame);
              else { clearTimeout(timeout); cleanup(); resolve(samples); }
            } catch (error) { clearTimeout(timeout); cleanup(); reject(error); }
          };
          sample();
          requestAnimationFrame(frame);
        });
      });
      await nav.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
      const samples = await page.evaluate(() => (window as any).__settingsFrameProbe) as any[];
      assert.ok(samples.some((sample) => sample.title === label), `den nye siden ${label} ble observert i faktiske rammer`);
      for (const sample of samples) {
        assert.equal(sample.missing, false, `${label}: innstillingsrammen forsvant under sidebyttet`);
        for (const [key, expected] of Object.entries(geometry)) assert.ok(Math.abs(sample[key] - expected) <= 0.5, `${label}: ${key} flyttet fra ${expected} til ${sample[key]}`);
        for (const layer of sample.layers) {
          assert.equal(layer.opacity, "1", `${label}: ${layer.selector} ble gjennomsiktig`);
          assert.equal(layer.transform, "none", `${label}: ${layer.selector} flyttet seg under sidebyttet`);
          assert.equal(layer.animations, 0, `${label}: ${layer.selector} startet en sideanimasjon`);
        }
      }
      assert.equal(await page.locator(".settings-body").evaluate((body) => body.scrollTop), 0, `${label} starter øverst`);
      for (const [index, handle] of persistent.entries()) {
        assert.equal(await handle!.evaluate((element, selector) => element.isConnected && element === document.querySelector(selector), selectors[index]), true, `${selectors[index]} ble erstattet`);
      }
    }
    assert.ok(longPages > 0 && shortPages > 0, "både lange og korte sider ble byttet uten horisontalt hopp");
    // Controls still work after repeated navigation; verify the resulting persisted setting.
    const sound = page.getByRole("switch", { name: "Spill av en lyd", exact: true });
    const enabled = !await sound.isChecked();
    await sound.setChecked(enabled);
    await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.soundOnDone === enabled, "bryteren virker etter sidebytter");
    const search = page.getByLabel("Søk i innstillinger");
    await search.fill("appikon");
    await page.locator(".search-result", { hasText: "Appikon" }).click();
    await page.locator(".search-hit", { hasText: "Appikon" }).waitFor();
    await nav.getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
    await nav.getByRole("button", { name: "Om", exact: true }).click();
    await page.evaluate(() => new Promise<void>((resolve) => {
      let frames = 0;
      const frame = () => ++frames < 6 ? requestAnimationFrame(frame) : resolve();
      requestAnimationFrame(frame);
    }));
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Om");
    assert.equal(await page.locator(".settings-body").evaluate((body) => body.scrollTop), 0);
    assert.equal(await page.locator(".search-hit").count(), 0, "tidligere søkeresultat flytter ikke den nye siden");
    await nav.getByRole("button", { name: "Tilbake til appen", exact: true }).click();
    await region.waitFor({ state: "detached" });
    await openSettings();
    await region.waitFor();
    await search.fill("steg per tur");
    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    await region.waitFor();
    await page.keyboard.press("Escape");
    await region.waitFor({ state: "detached" });
  }, { theme: scenario.theme, viewport: scenario.viewport });
}
