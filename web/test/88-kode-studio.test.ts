// UI tests for Kode Studio: landing, multi-tab editing, keyboard navigation, search,
// live external updates & conflict resolution, missing-file recovery, agent follow, dock tools,
// responsive switch and missing-folder state.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { approveUntil, flow, openProject, openTool, send, waitFor } from "./harness.ts";

flow("Kode Studio: startside, valg av prosjekt, overgang fra Filer-panelet og ingen eksperimentmerking", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "hello.ts"), "export const greeting = 'hei';\n");
  await h.createProject("Verksted");

  // Open Studio before selecting a project -> shows landing screen with project cards.
  const studioBtn = page.locator(".sidebar .mode-button", { hasText: "Studio" });
  await studioBtn.click();
  await page.getByTestId("code-studio").waitFor();
  await page.getByTestId("studio-landing").waitFor();
  assert.equal(await page.locator(".studio-preview-tag").count(), 0, "ingen Forhåndsvisning-merkelapp");
  assert.equal(await page.getByTestId("code-studio").getByText(/eksperiment|forhåndsvisning/i).count(), 0, "ingen eksperiment- eller forhåndsvisningstekst på startsiden");

  // Pick project card -> enters Studio workspace with file tree and agent column.
  await page.getByTestId("studio-landing").getByRole("button", { name: "Verksted" }).click();
  await page.getByTestId("studio-files").waitFor();
  await page.getByTestId("studio-tree").locator('.tree-item[data-path="hello.ts"]').waitFor();
  assert.equal(await page.locator(".studio-agent").isVisible(), true);

  // Switch back to Kode, open Filer panel, preview hello.ts, and jump straight into Studio.
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await page.getByTestId("code-studio").waitFor({ state: "detached" });
  await openTool(page, "Filer");
  await page.locator('.files-panel .tree-item[data-path="hello.ts"]').click();
  await page.locator(".files-panel").getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByTestId("code-studio").waitFor();
  await page.getByTestId("studio-tabs").getByRole("tab", { name: "hello.ts" }).waitFor();
  assert.match(await page.getByTestId("studio-editor").textContent() ?? "", /greeting/);
});

flow("Kode Studio: ny fil, flere faner, tastaturnavigasjon, søk, angre/gjør om og utkastbevaring", async (h) => {
  const { page } = h;
  h.allow(/status of 400|status of 409/);
  mkdirSync(path.join(h.projectDir, "src"), { recursive: true });
  writeFileSync(path.join(h.projectDir, "src/a.ts"), "const alpha = 1;\nconst beta = alpha + 1;\n");
  writeFileSync(path.join(h.projectDir, "src/b.ts"), "export const b = 2;\n");
  await openProject(h, "Demo");
  await page.locator(".sidebar .mode-button", { hasText: "Studio" }).click();
  await page.getByTestId("studio-files").waitFor();

  // Create new file with missing parent -> shows clear error, form stays open; then create valid file.
  await page.getByRole("button", { name: "Ny fil", exact: true }).click();
  const newInput = page.getByLabel("Navn på ny fil");
  await newInput.fill("mangler/fil.ts");
  await page.getByRole("button", { name: "Opprett fil", exact: true }).click();
  await page.locator(".studio-error").waitFor();
  assert.match(await page.locator(".studio-error").textContent() ?? "", /Foreldremappen finnes ikke/);

  await newInput.fill("src/ny.ts");
  await page.getByRole("button", { name: "Opprett fil", exact: true }).click();
  await page.getByTestId("studio-tabs").getByRole("tab", { name: "src/ny.ts" }).waitFor();

  // Type, undo, redo, save with Ctrl+S.
  const cm = page.locator('[data-testid="studio-editor"] .cm-content');
  await cm.click();
  await page.keyboard.type("export const verdi = 42;");
  await waitFor(async () => (await cm.textContent())?.includes("verdi = 42") ?? false, "tekst skrevet i editoren");
  assert.equal(await page.getByTestId("studio-tabs").getByRole("tab", { name: "src/ny.ts" }).getAttribute("data-dirty"), "true");

  await page.keyboard.press("Control+z");
  await waitFor(async () => !(await cm.textContent())?.includes("verdi = 42"), "angre tømte teksten");
  await page.keyboard.press("Control+Shift+z");
  await waitFor(async () => (await cm.textContent())?.includes("verdi = 42") ?? false, "gjør om gjenopprettet teksten");

  await page.keyboard.press("Control+s");
  await waitFor(async () => readFileSync(path.join(h.projectDir, "src/ny.ts"), "utf8").includes("verdi = 42"), "filen ble lagret på disk");
  await waitFor(async () => (await page.getByTestId("studio-tabs").getByRole("tab", { name: "src/ny.ts" }).getAttribute("data-dirty")) === "false", "fanen ble markert som lagret");

  // Open a.ts and b.ts, test keyboard tablist navigation (ArrowLeft/ArrowRight).
  await page.getByTestId("studio-tree").locator('.tree-item[data-path="src/a.ts"]').click();
  await page.getByTestId("studio-tabs").getByRole("tab", { name: "src/a.ts" }).waitFor();
  await page.getByTestId("studio-tree").locator('.tree-item[data-path="src/b.ts"]').click();
  await page.getByTestId("studio-tabs").getByRole("tab", { name: "src/b.ts" }).waitFor();

  const tabB = page.getByTestId("studio-tabs").getByRole("tab", { name: "src/b.ts" });
  await tabB.focus();
  await page.keyboard.press("ArrowLeft");
  const tabA = page.getByTestId("studio-tabs").getByRole("tab", { name: "src/a.ts" });
  assert.equal(await tabA.getAttribute("aria-selected"), "true", "ArrowLeft byttet fane til a.ts");

  // Search in a.ts: match count updates, Enter cycles without stealing focus, Escape closes search.
  await page.getByRole("button", { name: "Søk i fil", exact: true }).click();
  const searchInput = page.getByLabel("Søk i åpen fil");
  await searchInput.fill("alpha");
  await searchInput.press("Enter");
  await waitFor(async () => (await page.locator(".studio-search-count").textContent()) === "1 / 2", "første treff 1 / 2");
  await searchInput.press("Enter");
  await waitFor(async () => (await page.locator(".studio-search-count").textContent()) === "2 / 2", "andre treff 2 / 2");
  await searchInput.press("Escape");
  await page.locator(".studio-search").waitFor({ state: "detached" });

  // Dirty draft survives switching to Kode and back to Studio.
  await cm.click();
  await page.keyboard.type("// utkast\n");
  await waitFor(async () => (await tabA.getAttribute("data-dirty")) === "true", "a.ts er merket som ulagret");
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await page.getByTestId("code-studio").waitFor({ state: "detached" });
  await page.locator(".sidebar .mode-button", { hasText: "Studio" }).click();
  await page.getByTestId("code-studio").waitFor();
  assert.equal(await tabA.getAttribute("data-dirty"), "true");
  assert.match(await cm.textContent() ?? "", /\/\/ utkast/);
});

flow("Kode Studio: direkte filoppdatering, konflikthåndtering, gjenoppretting av slettet fil og skrivebeskyttet fil", async (h) => {
  const { page } = h;
  h.allow(/status of 404|status of 409/);
  writeFileSync(path.join(h.projectDir, "notes.txt"), "versjon 1\n");
  writeFileSync(path.join(h.projectDir, ".env"), "SECRET=1\n");
  await openProject(h, "Konflikt");
  await page.locator(".sidebar .mode-button", { hasText: "Studio" }).click();
  await page.getByTestId("studio-files").waitFor();

  // Clean buffer updates live when disk file changes externally.
  await page.getByTestId("studio-tree").locator('.tree-item[data-path="notes.txt"]').click();
  const cm = page.locator('[data-testid="studio-editor"] .cm-content');
  await waitFor(async () => (await cm.textContent())?.includes("versjon 1") ?? false, "notes.txt lastet");
  writeFileSync(path.join(h.projectDir, "notes.txt"), "versjon 2 fra disk\n");
  await waitFor(async () => (await cm.textContent())?.includes("versjon 2 fra disk") ?? false, "ren fane oppdatert fra disk");

  // Dirty buffer keeps draft and shows conflict banner on external change.
  await cm.click();
  await page.keyboard.type("mitt utkast\n");
  await waitFor(async () => (await cm.textContent())?.includes("mitt utkast") ?? false, "utkast skrevet");
  writeFileSync(path.join(h.projectDir, "notes.txt"), "versjon 3 fra disk\n");
  await page.getByTestId("studio-conflict").waitFor();
  assert.match(await cm.textContent() ?? "", /mitt utkast/, "utkastet ble ikke overskrevet");

  // Compare disk version and keep/merge draft.
  await page.getByTestId("studio-conflict").getByRole("button", { name: "Vis diskversjon" }).click();
  await waitFor(async () => (await page.getByTestId("studio-conflict").locator("pre").textContent())?.includes("versjon 3 fra disk") ?? false, "diskversjonen vises");

  // Delete file on disk while dirty -> missing conflict -> recreate with "Lagre på nytt".
  unlinkSync(path.join(h.projectDir, "notes.txt"));
  await waitFor(async () => (await page.getByTestId("studio-conflict").textContent())?.includes("slettet eller flyttet") ?? false, "slettet-konflikt vises");
  await page.getByTestId("studio-conflict").getByRole("button", { name: "Lagre på nytt" }).click();
  await page.getByTestId("studio-conflict").waitFor({ state: "detached" });
  assert.match(readFileSync(path.join(h.projectDir, "notes.txt"), "utf8"), /mitt utkast/);

  // Protected file (.env) opens read-only with Save disabled.
  await page.getByTestId("studio-tree").locator('.tree-item[data-path=".env"]').click();
  await page.locator(".studio-readonly").waitFor();
  assert.equal(await page.getByRole("button", { name: "Lagre fil" }).isDisabled(), true);
});

flow("Kode Studio: agentfølging, verktøydokk, smal visning og manglende prosjektmappe", async (h) => {
  const { page } = h;
  h.allow(/status of 404|status of 409/);
  await openProject(h, "AgentStudio");
  await page.locator(".sidebar .mode-button", { hasText: "Studio" }).click();
  await page.getByTestId("studio-files").waitFor();

  // Ask the demo agent to create a page; approve and verify the file opens automatically in Studio.
  await send(page, "lag en side");
  await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "agenten ble ferdig");
  await page.getByTestId("studio-tabs").getByRole("tab", { name: "index.html" }).waitFor();
  assert.match(await page.getByTestId("studio-editor").textContent() ?? "", /<html/i);

  // Open Endringer and Terminal in the dock; Terminal must not display a bogus "studio" local-mode badge.
  await page.locator(".studio-toolbar").getByRole("button", { name: "Endringer", exact: true }).click();
  await page.getByTestId("studio-dock").getByTestId("changes-panel").waitFor();
  await page.locator(".studio-toolbar").getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByTestId("studio-dock").getByTestId("terminal").waitFor();
  assert.equal(await page.getByTestId("studio-dock").getByTestId("terminal-place").count(), 0, "ingen feilaktig lokal-badge på prosjektterminal");
  await page.getByRole("button", { name: "Lukk Studio-verktøy" }).click();
  await page.getByTestId("studio-dock").waitFor({ state: "detached" });

  // Opening Studio dock tools did not silently open Kode's side panel.
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await page.getByTestId("code-studio").waitFor({ state: "detached" });
  assert.equal(await page.locator(".right-panel").count(), 0, "Kodes sidepanel forble skjult");
  await page.locator(".sidebar .mode-button", { hasText: "Studio" }).click();
  await page.getByTestId("code-studio").waitFor();

  // Responsive mobile view toggles between Filer og editor and Kodeagent.
  await page.setViewportSize({ width: 680, height: 780 });
  await page.locator(".studio-mobile-switch").getByRole("button", { name: "Kodeagent" }).click();
  assert.equal(await page.locator(".studio-agent").isVisible(), true);
  await page.locator(".studio-mobile-switch").getByRole("button", { name: "Filer og editor" }).click();
  assert.equal(await page.getByTestId("studio-files").isVisible(), true);

  // Restore desktop viewport and verify missing project folder renders FolderMissingBar calmly.
  await page.setViewportSize({ width: 1360, height: 860 });
  rmSync(h.projectDir, { recursive: true, force: true });
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await page.locator(".sidebar .mode-button", { hasText: "Studio" }).click();
  await page.getByTestId("studio-files").getByTestId("folder-missing").waitFor();
});
