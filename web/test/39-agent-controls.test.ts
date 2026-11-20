import assert from "node:assert/strict";
import { flow, openProject, send, waitFor } from "./harness.ts";

flow("Modeller lagrer komprimering og egendefinert steggrense og viser ugyldige tall", async (h) => {
  const { page } = h;
  const openModels = async () => {
    if (!await page.getByRole("region", { name: "Innstillinger" }).isVisible()) {
      await page.getByRole("button", { name: "Innstillinger" }).first().click();
    }
    await page.locator(".settings-nav").getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
  };
  await openModels();
  const compact = page.getByRole("switch", { name: /Komprimering/ });
  const steps = page.getByRole("spinbutton", { name: "Steg per tur", exact: true });
  assert.equal(await compact.isChecked(), true);
  assert.equal(await steps.inputValue(), "50");
  await compact.uncheck();
  for (const invalid of ["", "0", "1.5", "1001"]) {
    await steps.fill(invalid);
    await page.getByRole("button", { name: "Lagre steggrense", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Velg et heltall fra 1 til 1000" }).waitFor();
    assert.equal((await h.api("GET", "/api/bootstrap")).settings.maxStepsPerTurn, 50);
  }
  await steps.fill("137");
  await page.getByRole("button", { name: "Lagre steggrense", exact: true }).click();
  await waitFor(async () => {
    const { settings } = await h.api("GET", "/api/bootstrap");
    return settings.autoCompact === false && settings.maxStepsPerTurn === 137;
  }, "agentinnstillingene lagres");
  await h.reload();
  await openModels();
  assert.equal(await compact.isChecked(), false);
  assert.equal(await steps.inputValue(), "137");
  await page.getByText(/maksimalt 137 modellsteg/).waitFor();
  // /compact remains available when automatic compaction is disabled.
  await page.keyboard.press("Escape");
  const project = await openProject(h);
  await send(page, "Hei");
  await waitFor(async () => {
    const thread = (await h.api("GET", "/api/bootstrap")).threads.find((item: { projectId: string }) => item.projectId === project.id);
    return thread && (await h.events(thread.id)).some((row) => row.event.type === "run.finished");
  }, "første tur ferdig");
  await page.getByLabel("Melding").fill("/compact");
  await page.getByLabel("Melding").press("Enter");
  await page.locator(".row-line", { hasText: "Konteksten ble komprimert" }).waitFor({ timeout: 10_000 });
});
