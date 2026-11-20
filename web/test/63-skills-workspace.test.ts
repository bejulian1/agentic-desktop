import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, waitFor } from "./harness.ts";

flow("Skills-arbeidsområde: kilder, status, appinnsyn og variant", async (h) => {
  const { page } = h;
  const project = await h.createProject("Skillprosjekt");
  await h.api("POST", "/api/skills", { name: "review", description: "Min globale gjennomgang", body: "Kontroller først endringene.", scope: "user" });
  await h.api("POST", "/api/skills", { name: "review", description: "Prosjektets gjennomgang", body: "Kjør lokale tester.", scope: "project", projectId: project.id });
  await page.locator(".sidebar").getByRole("button", { name: "Skills", exact: true }).click();
  const workspace = page.getByTestId("skills-workspace");
  await workspace.getByRole("heading", { name: "Skills", exact: true }).waitFor();
  assert.equal(await page.locator(".settings-view:visible").count(), 0);
  const items = workspace.locator(".skills-library-item");
  await waitFor(async () => await items.count() >= 3, "tre kilder i biblioteket");
  await workspace.getByLabel("Søk i skills").fill("prosjektets gjennomgang");
  assert.equal(await items.count(), 1);
  await items.first().click();
  await workspace.getByLabel("Skill-instruksjoner").waitFor();
  assert.equal(await workspace.getByLabel("Skill-instruksjoner").inputValue(), "Kjør lokale tester.\n");
  await workspace.getByLabel("Søk i skills").fill("");
  await workspace.getByRole("button", { name: "Skill-kilde", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Fra appen", exact: true }).click();
  const appSkill = items.filter({ has: page.locator("strong", { hasText: /^review$/ }) });
  await appSkill.click();
  await waitFor(async () => await workspace.getByLabel("Skill-instruksjoner").getAttribute("readonly") === "", "appens skrivebeskyttede detalj er lastet");
  assert.equal(await workspace.getByLabel("Skill-instruksjoner").getAttribute("readonly"), "");
  assert.equal(await workspace.getByRole("switch").isDisabled(), true);
  assert.equal(await workspace.getByRole("button", { name: "Lagre", exact: true }).count(), 0);
  await workspace.getByRole("button", { name: "Lag egen variant" }).click();
  assert.equal(await workspace.getByLabel("Skill-navn").inputValue(), "review");
  assert.equal(await workspace.getByLabel("Skill-instruksjoner").getAttribute("readonly"), null);
  await workspace.getByLabel("Skill-navn").fill("min-gjennomgang");
  await workspace.getByRole("button", { name: "Lag skill", exact: true }).click();
  await workspace.getByRole("heading", { name: "min-gjennomgang", exact: true }).waitFor();
  const global = (await h.api("GET", "/api/skills")).skills.find((s: any) => s.name === "min-gjennomgang");
  assert.equal(global.source, "user");
  await workspace.getByRole("switch").uncheck();
  await waitFor(async () => !(await h.api("GET", "/api/skills")).skills.find((s: any) => s.id === global.id).enabled, "varianten av uten å endre originalen");
  assert.equal((await h.api("GET", "/api/skills")).skills.find((s: any) => s.id === "a:review").enabled, true);
});

flow("Skills-arbeidsområde: utkast bevares, bytte spør og ekstern endring beskyttes", async (h) => {
  const { page } = h;
  const skill = await h.api("POST", "/api/skills", { name: "sikker-test", description: "Test av redigering", body: "Original instruks.", scope: "user" });
  await page.locator(".sidebar").getByRole("button", { name: "Skills", exact: true }).click();
  const workspace = page.getByTestId("skills-workspace");
  await workspace.locator(".skills-library-item", { hasText: "sikker-test" }).click();
  const instructions = workspace.getByLabel("Skill-instruksjoner");
  await instructions.fill("Mitt uferdige utkast.");
  // Menus live in a portal; covering the room must close them and suspend its save key.
  await workspace.getByRole("button", { name: "Skill-kilde", exact: true }).click();
  await page.getByRole("menu", { name: "Skill-kilde", exact: true }).waitFor();
  await page.keyboard.press("Control+,");
  await page.locator(".settings-back").waitFor();
  assert.equal(await page.getByRole("menu", { name: "Skill-kilde", exact: true }).count(), 0);
  await page.keyboard.press("Control+s");
  assert.match(readFileSync(path.join(skill.path, "SKILL.md"), "utf8"), /Original instruks\./, "Ctrl+S i Innstillinger må ikke lagre rommet under");
  await page.locator(".settings-back").click();
  assert.equal(await instructions.inputValue(), "Mitt uferdige utkast.");
  await workspace.getByRole("button", { name: "Tilbake fra Skills" }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Skills", exact: true }).click();
  assert.equal(await instructions.inputValue(), "Mitt uferdige utkast.");
  await workspace.getByRole("button", { name: "Ny skill", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await page.keyboard.press("Control+s");
  assert.match(readFileSync(path.join(skill.path, "SKILL.md"), "utf8"), /Original instruks\./, "forkastdialogen må også sperre underliggende lagring");
  await page.locator("dialog[open]").getByRole("button", { name: "Avbryt", exact: true }).click();
  assert.equal(await instructions.inputValue(), "Mitt uferdige utkast.");
  const file = path.join(skill.path, "SKILL.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("Original instruks.", "Endret på disken."));
  await workspace.getByText(/Filen er endret eller fjernet/).waitFor();
  assert.equal(await instructions.inputValue(), "Mitt uferdige utkast.");
  assert.equal(await workspace.getByRole("button", { name: "Lagre", exact: true }).isDisabled(), true);
  await workspace.getByRole("button", { name: "Last inn filen på nytt" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Forkast", exact: true }).click();
  await waitFor(async () => (await instructions.inputValue()).includes("Endret på disken."), "ny fil lastet inn");
  await instructions.fill("Lagret fra arbeidsområdet.");
  await instructions.press("Control+s");
  await waitFor(() => readFileSync(file, "utf8").includes("Lagret fra arbeidsområdet."), "Ctrl+S lagrer");
  // Even without a socket notification, an observed revision change blocks the PUT.
  await instructions.fill("Utkast før rask ekstern endring.");
  let updated = false;
  await page.route(`**/api/skills/${encodeURIComponent(skill.id)}`, async (route) => {
    if (!updated && route.request().method() === "GET") {
      updated = true;
      writeFileSync(file, readFileSync(file, "utf8").replace("Lagret fra arbeidsområdet.", "Diskendring før lagring."));
    }
    await route.continue();
  });
  await workspace.getByRole("button", { name: "Lagre", exact: true }).click();
  await workspace.getByText(/Last inn filen på nytt før du lagrer\./).waitFor();
  assert.match(readFileSync(file, "utf8"), /Diskendring før lagring\./);
  assert.equal(await instructions.inputValue(), "Utkast før rask ekstern endring.");
  await workspace.getByRole("button", { name: "Fjern", exact: true }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Fjern", exact: true }).click();
  await waitFor(async () => !(await h.api("GET", "/api/skills")).skills.some((s: any) => s.id === skill.id), "skillen fjernet");
});

flow("Skills-arbeidsområde: Kode-inngang og eksisterende importkontroll", async (h) => {
  const { page } = h;
  await openProject(h, "Importprosjekt");
  await page.locator(".sidebar").getByRole("button", { name: "Skills", exact: true }).click();
  const workspace = page.getByTestId("skills-workspace");
  await workspace.getByTestId("workspace-skill-files").setInputFiles({ name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.from('---\nname: import-test\ndescription: "Importert i arbeidsområdet"\n---\n\nKontroller filen før lagring.\n') });
  const preview = workspace.getByTestId("skill-import");
  await preview.getByText("Klar", { exact: true }).waitFor();
  assert.equal((await h.api("GET", "/api/skills")).skills.some((s: any) => s.name === "import-test"), false, "preview skriver ingen filer");
  await preview.getByRole("button", { name: "Importer 1 skill", exact: true }).click();
  await workspace.locator(".skills-library-item", { hasText: "import-test" }).waitFor();
  const imported = (await h.api("GET", "/api/skills")).skills.find((s: any) => s.name === "import-test");
  assert.equal(imported.source, "user");
});
