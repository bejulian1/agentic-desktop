// Run by hand with `npm run screenshots`: takes pictures of the real app in both themes and at
// small window sizes, with the demo model, and saves them in docs/screenshots.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Page } from "playwright-core";
import { approveUntil, createHarness, openProject, ROOT, send, threadItem, waitFor, type HarnessOptions, openTool } from "./harness.ts";

const defaultOut = path.join(ROOT, "docs/screenshots");
const { values, positionals } = parseArgs({ options: { language: { type: "string", default: "nb" } }, allowPositionals: true });
if (!["nb", "en"].includes(values.language) || positionals.length > 1) throw new Error("Usage: npm run screenshots -- [--language nb|en] [output-directory]");
const out = positionals[0] ?? (values.language === "en" ? path.join(ROOT, "docs/bilder/en") : defaultOut);
mkdirSync(out, { recursive: true });
// The names changed with v0.4. Old pictures in the docs folder would only confuse.
if (out === defaultOut) for (const file of readdirSync(out)) if (/^(lys|mork)-.*\.png$/.test(file)) rmSync(path.join(out, file));

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
const settled = (page: Page) => page.waitForTimeout(350);
const idle = (page: Page, what: string) => waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, what);

async function run(theme: "light" | "dark", options: HarnessOptions = {}): Promise<void> {
  const h = await createHarness({ theme, viewport: { width: 1440, height: 900 }, ...options });
  const { page } = h;
  const t = theme === "light" ? "lys" : "mork";
  try {
    await h.api("PATCH", "/api/settings", { profileName: "Kari Nordmann" });
    // A few projects, so the sidebar and the project picker look like they do in use.
    for (const name of ["nettbutikk", "spillmotor", "dokumentasjon"]) await h.api("POST", "/api/projects", { name, path: path.join(h.home, "prosjekter", name) });
    const pinned = (await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.name === "nettbutikk");
    await h.api("PATCH", `/api/projects/${pinned.id}`, { pinned: true });

    // Chat: some use first, so the statistics card has numbers.
    await send(page, "Vis et kodeeksempel");
    await page.locator(".row-text .tok-keyword").first().waitFor();
    await idle(page, "svaret er ferdig");
    await settled(page);
    await shot(page, `${t}-04-chat`);
    await page.locator(".sidebar-nav").getByRole("button", { name: "Ny tråd", exact: true }).click();
    await page.getByTestId("examples").waitFor();
    await settled(page);
    await shot(page, `${t}-01-start-chat`);

    // Artifacts: the box in the answer and the panel beside it (round 15), the room with code and
    // preview, and the gallery.
    await send(page, "lag et html-spill");
    await page.locator(".artifact-panel iframe").waitFor();
    await idle(page, "spillet er ferdig");
    await page.waitForTimeout(700);
    await shot(page, `${t}-05-artifact-panel`);
    await page.locator(".artifact-panel").getByRole("button", { name: "Lagre som artifact" }).click();
    await page.locator(".artifact-panel").getByRole("button", { name: "Åpne i Artifacts" }).click();
    await page.locator("[data-artifact-open] .cm-content").waitFor();
    await page.waitForTimeout(900);
    await shot(page, `${t}-06-artifact-rom`);
    await page.getByRole("button", { name: "Alle artifacts" }).click();
    await page.locator(".artifact-tile").first().waitFor();
    await settled(page);
    await shot(page, `${t}-07-artifacts-galleri`);
    await page.getByRole("button", { name: "Lukk Artifacts" }).click();

    // Kode: the start page with the branch chip, and the project picker.
    writeFileSync(path.join(h.projectDir, "README.md"), "# Demo\n\nEt lite prosjekt.\n");
    mkdirSync(path.join(h.projectDir, ".git"), { recursive: true });
    writeFileSync(path.join(h.projectDir, ".git/HEAD"), "ref: refs/heads/main\n");
    const project = await openProject(h, "Butikken");
    await page.getByRole("button", { name: "Skjul panelet", exact: true }).click();
    await page.getByTestId("branch").waitFor();
    await waitFor(async () => (await page.getByTestId("stats-card").locator(".stats-tile", { hasText: "Økter" }).locator(".stats-value").textContent()) !== "0", "tallene er hentet");
    await page.mouse.move(700, 880);
    await settled(page);
    await shot(page, `${t}-02-start-kode`);
    await page.getByTestId("project-picker").click();
    await page.getByRole("dialog", { name: "Velg prosjekt" }).waitFor();
    await settled(page);
    await shot(page, `${t}-03-prosjektvelger`);
    await page.keyboard.press("Escape");

    await send(page, "lag en side");
    await page.locator(".approval-card").first().waitFor();
    await settled(page);
    await shot(page, `${t}-08-godkjenning`);
    await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "siden er laget");
    await idle(page, "kjøringen er ferdig");
    await page.mouse.move(700, 880);
    await settled(page);
    await shot(page, `${t}-09-samtale-verktoy`);

    await page.getByRole("button", { name: "Vis eller skjul panelet" }).click();
    await openTool(page, "Filer");
    await page.locator('.tree-item[data-path="index.html"]').click();
    await page.locator(".cm-content .tok-typeName, .cm-content .tok-keyword").first().waitFor();
    await settled(page);
    await shot(page, `${t}-10-filer`);

    await send(page, "rediger");
    await page.getByRole("button", { name: "Tillat", exact: true }).click();
    await page.getByText("Overskriften er endret").waitFor();
    await openTool(page, "Endringer");
    await page.locator(".diff-line.add").first().waitFor();
    await settled(page);
    await shot(page, `${t}-11-endringer`);

    await openTool(page, "Terminal");
    await page.getByTestId("terminal").waitFor();
    await page.waitForTimeout(500);
    await page.getByTestId("terminal").click();
    await page.keyboard.type("ls -la\n");
    await page.waitForTimeout(400);
    await shot(page, `${t}-12-terminal`);

    await page.getByRole("button", { name: "Stopp playtest" }).waitFor().catch(() => undefined);
    await openTool(page, "Nettleser");
    await page.getByTestId("browser-canvas").waitFor();
    await page.waitForTimeout(900);
    await shot(page, `${t}-13-nettleser`);

    // Several panes, one of them made by an agent, one waiting for an answer.
    await page.getByRole("button", { name: "Skjul panelet", exact: true }).click();
    await page.getByTestId("new-pane").click();
    await page.waitForTimeout(100);
    await send(page, "samarbeid om en oversikt");
    await approveUntil(page, async () => (await page.getByText("Samarbeidet er ferdig").count()) > 0, "samarbeidet er ferdig");
    const waiting = await h.createThread(project.id);
    await h.api("POST", `/api/threads/${waiting.id}/messages`, { text: "godkjenning" });
    await threadItem(page, waiting.id).locator(".badge").waitFor();
    await settled(page);
    await shot(page, `${t}-14-ruter`);

    // Settings, as a full page.
    await page.getByRole("button", { name: "Innstillinger" }).click();
    await settled(page);
    await shot(page, `${t}-15-innstillinger`);
    await page.getByRole("button", { name: "Bruk", exact: true }).click();
    await page.locator(".settings-page").getByTestId("stats-card").waitFor();
    await settled(page);
    await shot(page, `${t}-16-innstillinger-bruk`);
    await page.getByRole("button", { name: "Modeller", exact: true }).click();
    await settled(page);
    await shot(page, `${t}-17-modeller`);
    await page.getByRole("button", { name: "Om", exact: true }).click();
    await settled(page);
    await shot(page, `${t}-18-om`);
    await page.getByRole("button", { name: "Tilbake til appen" }).click();

    await page.getByLabel("Melding").first().click();
    await page.keyboard.type("/");
    await page.getByTestId("composer-menu").waitFor();
    await settled(page);
    await shot(page, `${t}-19-meny`);
    await page.keyboard.press("Escape");
    await page.getByLabel("Melding").first().fill("");

    for (const [name, width, height] of [["20-smal", 900, 700], ["21-mobil", 420, 780]] as const) {
      await page.setViewportSize({ width, height });
      await settled(page);
      await shot(page, `${t}-${name}`);
    }
    await page.setViewportSize({ width: 420, height: 780 });
    await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
    await settled(page);
    await shot(page, `${t}-22-mobil-sidefane`);
    await page.getByRole("button", { name: "Lukk sidefanen" }).click({ position: { x: 380, y: 300 } }).catch(() => undefined);
    await page.getByRole("button", { name: "Vis eller skjul panelet" }).click();
    await settled(page);
    await shot(page, `${t}-23-mobil-panel`);
    if (h.errors.length) console.log(h.errors);
  } finally {
    await h.close();
  }
}

async function englishGallery() {
  const harness = await createHarness({ theme: "light", viewport: { width: 1360, height: 860 } });
  const { page } = harness;
  try {
    await harness.api("PATCH", "/api/settings", { language: "en" });
    await harness.reload();
    await page.locator('html[lang="en"]').waitFor();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Help me plan a weekend walking tour.");
    await settled(page);
    await shot(page, "chat");
    writeFileSync(path.join(harness.projectDir, "temperature.ts"), "export function celsiusToFahrenheit(celsius: number) {\n  return celsius * 9 / 5 + 32;\n}\n");
    await harness.createProject("Weather station");
    await page.locator(".sidebar .mode-button").getByText("Code", { exact: true }).click();
    await page.locator('.group[data-project="Weather station"] .group-title').first().click();
    await page.waitForSelector(".project-label");
    await send(page, "/files");
    await page.locator('.tree-item[data-path="temperature.ts"]').click();
    await page.getByTestId("editor").getByText(/celsiusToFahrenheit/).first().waitFor();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Add tests for freezing and boiling temperatures.");
    await settled(page);
    await shot(page, "kode");
    await page.getByTestId("settings-gear").click();
    await page.locator(".settings-nav").getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("heading", { name: "Theme and color", exact: true }).waitFor();
    await settled(page);
    await shot(page, "appearance");
  } finally {
    await harness.close();
  }
}

if (values.language === "en") await englishGallery();
else {
  await run("light");
  await run("dark");
}
console.log(`Bildene ligger i ${out}`);
process.exit(0);
