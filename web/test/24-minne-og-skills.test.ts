// Round 6, agent E: Innstillinger → Personalisering og minner and → Skills, and the choice for
// messages sent while the agent works. Screenshots in both themes go to $AD_E_SHOTS when it is set.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { flow, waitFor, type Harness } from "./harness.ts";

const openSettings = async (page: Page, section: string) => {
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
  await page.locator(".settings-title", { hasText: section }).waitFor();
};

async function shot(h: Harness, name: string): Promise<void> {
  const dir = process.env.AD_E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await h.page.locator(".settings-body").evaluate((el) => (el.scrollTop = 0));
  await h.page.waitForTimeout(150);
  await h.page.screenshot({ path: path.join(dir, `${name}.png`) });
}

function agentSkill(h: Harness): void {
  const dir = path.join(h.home, ".config/agentic-desktop/skills/kjor-e2e");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), '---\nname: kjor-e2e\ndescription: "Kjør e2e-testene og les feilene"\ncreated-by: agent\n---\n\n1. npm run e2e\n');
}

flow("minner: bryter, legg til, søk, endre, slett og slett alle", async (h) => {
  const { page } = h;
  h.allow(/status of 400/);
  const project = await h.createProject("Demo");
  await h.api("POST", "/api/memories", { scope: "project", projectId: project.id, text: "Testene kjøres med npm test" });
  await openSettings(page, "Personalisering og minner");
  await page.getByRole("group", { name: "Personalisering for", exact: true }).getByRole("button", { name: "Kode", exact: true }).click();

  const toggle = page.getByRole("switch", { name: /Minner på tvers av tråder/ });
  assert.equal(await toggle.isChecked(), true, "på som standard");
  assert.equal(await page.locator(".settings-title .demo-badge").count(), 0, "ikke Demo lenger");
  await page.locator(".memory-row", { hasText: "Testene kjøres med npm test" }).waitFor();
  assert.match(await page.locator(".memory-row").first().textContent() ?? "", /Demo/, "prosjektnavnet står ved minnet");

  // Add a global one.
  await page.locator('section[aria-label="Kode-minner"]').getByRole("button", { name: "Legg til" }).click();
  await page.getByLabel("Nytt minne").fill("Jeg vil ha korte svar på norsk");
  await page.locator('section[aria-label="Kode-minner"]').getByRole("button", { name: "Lagre" }).click();
  await page.locator(".memory-row", { hasText: "Jeg vil ha korte svar på norsk" }).waitFor();
  assert.match(readFileSync(path.join(h.home, ".config/agentic-desktop/MEMORY.md"), "utf8"), /- Jeg vil ha korte svar på norsk/);

  // A secret is refused, with a message.
  await page.locator('section[aria-label="Kode-minner"]').getByRole("button", { name: "Legg til" }).click();
  await page.getByLabel("Nytt minne").fill("passord: Hunter2!");
  await page.locator('section[aria-label="Kode-minner"]').getByRole("button", { name: "Lagre" }).click();
  await page.getByText(/nøkkel, et token eller et passord/).first().waitFor();
  await page.getByRole("button", { name: "Avbryt" }).click();

  // Search and the scope filter.
  await page.getByLabel("Søk i minner").fill("npm");
  await waitFor(async () => (await page.locator(".memory-row").count()) === 1, "ett treff");
  await page.getByLabel("Søk i minner").fill("");
  await page.getByRole("button", { name: "Vis minner fra" }).click();
  await page.getByRole("menuitemradio", { name: "Globale" }).click();
  await waitFor(async () => (await page.locator(".memory-row").count()) === 1, "bare globale");
  await page.getByRole("button", { name: "Vis minner fra" }).click();
  await page.getByRole("menuitemradio", { name: "Alle" }).click();
  await waitFor(async () => (await page.locator(".memory-row").count()) === 2, "alle");
  await shot(h, "minner-lys");

  // Edit and delete.
  await page.getByRole("button", { name: "Endre «Jeg vil ha korte svar på norsk»" }).click();
  await page.getByLabel("Endre minnet").fill("Jeg vil ha korte svar på bokmål");
  await page.getByLabel("Endre minnet").press("Enter");
  await page.locator(".memory-row", { hasText: "på bokmål" }).waitFor();
  await page.getByRole("button", { name: "Slett «Testene kjøres med npm test»" }).click();
  await waitFor(async () => (await page.locator(".memory-row").count()) === 1, "slettet");

  // Slett alle asks first.
  await page.locator('section[aria-label="Kode-minner"]').getByRole("button", { name: "Slett alle" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByText("Slette alle Kode-minner?").waitFor();
  await dialog.getByRole("button", { name: "Avbryt" }).click();
  assert.equal(await page.locator(".memory-row").count(), 1);
  await page.locator('section[aria-label="Kode-minner"]').getByRole("button", { name: "Slett alle" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Slett alle" }).click();
  await page.getByText(/Ingen minner ennå/).waitFor();

  await toggle.click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.memories === false, "bryteren er lagret");
});

flow("skills: liste, lag ny, endre, slå av, fjern, og valget for skills fra agenten", async (h) => {
  const { page } = h;
  const project = await h.createProject("Demo");
  agentSkill(h);
  await openSettings(page, "Skills");
  const agentRow = page.locator(".skill-row", { hasText: "kjor-e2e" });
  await agentRow.getByText("Laget av agenten").waitFor();
  await agentRow.getByText("Dine").waitFor();

  // A new skill in the project.
  await page.getByRole("button", { name: "Ny skill" }).click();
  await page.getByLabel("Navn").fill("Bygg Alt");
  assert.equal(await page.getByLabel("Navn").inputValue(), "bygg alt", "små bokstaver");
  await page.getByLabel("Navn").fill("bygg-alt");
  await page.getByRole("button", { name: "Hvor" }).click();
  await page.getByRole("menuitemradio", { name: "Prosjektet Demo" }).click();
  await page.getByLabel(/Beskrivelse/).fill("Bygger og tester hele prosjektet");
  await page.getByLabel("Innhold (Markdown)").fill("1. npm run build\n2. npm test\n");
  await page.getByRole("button", { name: "Lag skill" }).click();
  const row = page.locator(".skill-row", { hasText: "bygg-alt" });
  await row.getByText("Prosjekt: Demo").waitFor();
  const file = path.join(project.path, ".agentic/skills/bygg-alt/SKILL.md");
  assert.match(readFileSync(file, "utf8"), /description: "Bygger og tester hele prosjektet"/);
  await shot(h, "skills-lys");

  // Edit.
  await page.getByRole("button", { name: "Endre bygg-alt" }).click();
  await page.getByLabel(/Beskrivelse/).fill("Bygger alt");
  await page.getByRole("button", { name: "Lagre" }).click();
  await row.getByText("Bygger alt").waitFor();

  // Off and on.
  await page.getByRole("switch", { name: "Slå bygg-alt av eller på" }).click();
  await row.locator(".pill", { hasText: /^Av$/ }).waitFor();
  const commands = await h.api("GET", `/api/projects/${project.id}/commands`);
  assert.ok(!commands.some((c: any) => c.name === "bygg-alt"), "agenten ser den ikke");

  // Search.
  await page.getByLabel("Søk i skills").fill("e2e");
  await waitFor(async () => (await page.locator(".skill-row").count()) === 1, "ett treff");
  await page.getByLabel("Søk i skills").fill("");

  // Remove, with a question first.
  await page.getByRole("button", { name: "Fjern bygg-alt" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Fjern" }).click();
  await row.waitFor({ state: "detached" });
  assert.ok(!existsSync(file));

  // What the agent may do.
  const choice = page.getByRole("button", { name: "Når agenten foreslår en skill" });
  assert.equal(await choice.getAttribute("data-value"), "ask", "spør som standard");
  await choice.click();
  await page.getByRole("menuitemradio", { name: "Lagre uten å spørre" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.autoSkills === "auto", "valget er lagret");

  // The search in Innstillinger finds the new pages.
  await page.getByLabel("Søk i innstillinger").fill("selvforbedring");
  await page.locator(".search-result", { hasText: "Når agenten foreslår en skill" }).waitFor();
  await page.getByLabel("Søk i innstillinger").fill("steer");
  await page.locator(".search-result", { hasText: "Meldinger mens agenten jobber" }).click();
  await page.getByRole("button", { name: "Meldinger mens agenten jobber" }).click();
  await page.getByRole("menuitemradio", { name: "Send med en gang" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.busyMessages === "steer", "busyMessages er lagret");
});

flow("mørkt tema: minner og skills", async (h) => {
  const { page } = h;
  const project = await h.createProject("Demo");
  agentSkill(h);
  await h.api("POST", "/api/memories", { scope: "global", text: "Jeg heter Julian og skriver norsk" });
  await h.api("POST", "/api/memories", { scope: "project", projectId: project.id, text: "Bruk Solid og Vite, ikke React" });
  await h.api("POST", "/api/skills", { scope: "project", projectId: project.id, name: "rydd", description: "Rydder i importene", body: "Fjern ubrukte importer." });
  await openSettings(page, "Personalisering og minner");
  await page.getByRole("group", { name: "Personalisering for", exact: true }).getByRole("button", { name: "Kode", exact: true }).click();
  await page.locator(".memory-row").nth(1).waitFor();
  await shot(h, "minner-mork");
  await page.locator(".settings-nav").getByRole("button", { name: "Skills", exact: true }).click();
  await page.locator(".skill-row").nth(1).waitFor();
  await page.getByRole("button", { name: "Ny skill" }).click();
  await shot(h, "skills-mork");
}, { theme: "dark" });
