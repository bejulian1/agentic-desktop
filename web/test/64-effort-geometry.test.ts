import assert from "node:assert/strict";
import { flow, openProject } from "./harness.ts";

for (const deviceScaleFactor of [1, 1.25]) {
  flow(`modellvelgeren: tenkeinnsats og kolonner holder posisjonen ved skalering ${deviceScaleFactor}`, async (h) => {
    const { page } = h;
    await openProject(h);
    const button = page.getByTestId("model-button");
    const picker = page.getByTestId("model-menu");
    const effort = picker.getByTestId("model-effort");
    const positions = () => picker.evaluate((el) => {
      return [".model-extra", ".model-middle", ".model-providers"].map((selector) => {
        const rect = el.querySelector(selector)!.getBoundingClientRect();
        return [rect.y, rect.height];
      });
    });
    const settled = () => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));

    for (let visit = 0; visit < 3; visit++) {
      await button.click();
      await settled();
      const baseline = await positions();
      for (const level of ["Maks", "Ingen", "Standard"]) {
        const option = effort.getByRole("radio", { name: level, exact: true });
        await option.click();
        await effort.getByRole("radio", { name: level, exact: true, checked: true }).waitFor();
        assert.deepEqual(await positions(), baseline, level);
      }
      await page.keyboard.press("Escape");
      await picker.waitFor({ state: "detached" });
    }
  }, { theme: "dark", deviceScaleFactor });
}
