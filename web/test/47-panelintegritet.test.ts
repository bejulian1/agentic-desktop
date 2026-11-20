// Ekte tempfiler/PTY og lokale nettsider. Ingen nøkler, betalte kall eller eksterne sider.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { flow, openProject, openTool, waitFor } from "./harness.ts";
import type { Page } from "playwright-core";

flow("Filer viser bare valgt fil ved treg lasting og feil, og redigerer ekte tempfil", async (h) => {
  const { page } = h;
  for (const name of ["a.txt", "b.txt", "treg.txt"]) writeFileSync(path.join(h.projectDir, name), `Innhold ${name}\n`);
  writeFileSync(path.join(h.projectDir, "binær.dat"), Buffer.from([0, 1, 0, 2]));
  await openProject(h);
  await openTool(page, "Filer");
  const pick = (name: string) => page.locator(`.tree-item[data-path="${name}"]`).click();
  const preview = page.getByTestId("editor");
  await pick("a.txt");
  await preview.getByText("Innhold a.txt", { exact: true }).waitFor();

  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const slow = "**/api/projects/*/file?path=treg.txt";
  await page.route(slow, async (route) => {
    await pending;
    await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Forsinket prøvefeil"}' });
  });
  h.allow(/status of 404/);
  const request = page.waitForRequest((r) => r.url().endsWith("/file?path=treg.txt"));
  await pick("treg.txt");
  await request;
  assert.equal(await preview.isVisible(), false, "gammel fil skjules mens neste lastes");
  assert.equal(await page.locator(".file-edit").count(), 0, "kan ikke redigere med forrige fils metadata");
  await pick("b.txt");
  await preview.getByText("Innhold b.txt", { exact: true }).waitFor();
  const response = page.waitForResponse((r) => r.url().endsWith("/file?path=treg.txt"));
  release();
  await response;
  await page.waitForTimeout(80);
  assert.equal(await preview.isVisible(), true);
  assert.match(await preview.innerText(), /Innhold b.txt/);
  assert.equal(await page.getByText("Forsinket prøvefeil", { exact: true }).count(), 0, "sen feil kan ikke erstatte nyere fil");
  await page.unroute(slow);

  await pick("binær.dat");
  await page.getByText("Binærfil, 4 byte. Vises ikke.").waitFor();
  assert.equal(await preview.isVisible(), false);
  await page.route("**/api/projects/*/file?path=a.txt", (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Filen finnes ikke"}' }));
  await pick("a.txt");
  await page.getByTestId("files-panel").getByText("Filen finnes ikke", { exact: true }).waitFor();
  assert.equal(await preview.isVisible(), false, "ingen gammel editor under feilen");
  await page.unroute("**/api/projects/*/file?path=a.txt");

  await pick("b.txt");
  await preview.getByText("Innhold b.txt", { exact: true }).waitFor();
  await page.locator(".file-edit").click();
  const editor = page.getByTestId("mini-editor");
  await editor.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Lagret fra panelet\n");
  await page.keyboard.press("Control+s");
  await editor.getByText("Lagret", { exact: true }).waitFor();
  assert.match(readFileSync(path.join(h.projectDir, "b.txt"), "utf8"), /Lagret fra panelet/);
  await page.keyboard.press("Escape");
  await preview.getByText("Lagret fra panelet", { exact: true }).waitFor();
  const otherDir = path.join(h.home, "filer-annet-prosjekt");
  mkdirSync(otherDir);
  writeFileSync(path.join(otherDir, "b.txt"), "Dette er det andre prosjektet\n");
  await h.api("POST", "/api/projects", { name: "Andre filer", path: otherDir });
  await page.locator('.group[data-project="Andre filer"] .group-title').first().click();
  await openTool(page, "Filer");
  assert.equal(await preview.isVisible(), false, "forrige prosjektfil vises aldri i nytt prosjekt");
  await pick("b.txt");
  await preview.getByText("Dette er det andre prosjektet", { exact: true }).waitFor();
});

const buffer = (page: Page) => page.getByTestId("terminal").evaluate((el) => (el as any).readBuffer() as string);
flow("Terminal beholder tempkommando og fane ved panelbytte og isolerer prosjektet", async (h) => {
  const { page } = h;
  // v0.19: the default "Felles topprad" shows terminal sessions in the panel's shared tab row.
  // This test is about the Terminal's own row ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  await openProject(h, "Første");
  await openTool(page, "Terminal");
  await page.getByTestId("terminal").waitFor();
  await waitFor(async () => (await buffer(page)).trim().length > 0, "tempterminalen er klar");
  const first = await page.getByTestId("terminal").getAttribute("data-terminal-id");
  await page.getByTestId("terminal").click();
  await page.keyboard.type("printf 'panel-%s\\n' 42 > panelresultat.txt\n");
  await waitFor(() => { try { return readFileSync(path.join(h.projectDir, "panelresultat.txt"), "utf8") === "panel-42\n"; } catch { return false; } }, "kommandoen skrev bare tempfilen");
  await page.keyboard.type("cat panelresultat.txt\n");
  await waitFor(async () => (await buffer(page)).includes("panel-42"), "ekte PTY-utdata vises");
  await openTool(page, "Filer");
  await page.locator('.tree-item[data-path="panelresultat.txt"]').click();
  await page.getByTestId("editor").getByText("panel-42", { exact: true }).waitFor();
  await openTool(page, "Terminal");
  await waitFor(async () => (await buffer(page)).includes("panel-42"), "replay etter panelbytte");
  assert.equal(await page.getByTestId("terminal").getAttribute("data-terminal-id"), first);
  const otherDir = path.join(h.home, "annet-prosjekt");
  mkdirSync(otherDir);
  const other = await h.api("POST", "/api/projects", { name: "Andre", path: otherDir });
  await page.locator('.group[data-project="Andre"] .group-title').first().click();
  await openTool(page, "Terminal");
  await waitFor(async () => { const id = await page.getByTestId("terminal").getAttribute("data-terminal-id"); return !!id && id !== first; }, "egen terminal i annet prosjekt");
  assert.ok(!(await buffer(page)).includes("panel-42"));
  assert.ok((await h.api("GET", `/api/projects/${other.id}/terminals`)).length === 1);
  await page.locator('.group[data-project="Første"] .group-title').first().click();
  await openTool(page, "Terminal");
  await waitFor(async () => (await buffer(page)).includes("panel-42"), "første prosjekts terminal kommer tilbake");
  assert.equal(await page.getByTestId("terminal").getAttribute("data-terminal-id"), first);
  await page.getByRole("button", { name: "Ny terminal", exact: true }).click();
  await waitFor(async () => (await page.locator(".terminal-tab").count()) === 2, "ny terminalfane");
  await page.locator(".terminal-tab.on").getByRole("button", { name: "Lukk terminalen" }).click();
  await waitFor(async () => (await page.getByTestId("terminal").getAttribute("data-terminal-id")) === first, "lukking velger forrige terminal");
});

flow("Nettleser navigerer lokale sider og fjerner fane lukket i et annet vindu", async (h) => {
  const fake = createServer((req, res) => {
    if (req.url === "/favicon.ico") { res.writeHead(204).end(); return; }
    const title = req.url === "/to" ? "Lokal side to" : "Lokal side én";
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<html><head><title>${title}</title></head><body><h1>${title}</h1><a href="/to">Neste side</a></body></html>`);
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const port = (fake.address() as { port: number }).port;
  const { page } = h;
  // v0.19: the default "Felles topprad" shows browser pages in the panel's shared tab row. This
  // test is about the Nettleser's own tab strip ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  let second: Page | undefined;
  try {
    await openProject(h, "Nettprøve");
    await openTool(page, "Nettleser");
    await page.getByTestId("browser-newtab").waitFor();
    const address = page.getByRole("textbox", { name: "Adresse", exact: true });
    await address.fill(`http://127.0.0.1:${port}/en`);
    await address.press("Enter");
    await page.locator(".browser-tab.active .browser-tab-title", { hasText: "Lokal side én" }).waitFor();
    await address.fill(`http://127.0.0.1:${port}/to`);
    await address.press("Enter");
    await page.locator(".browser-tab.active .browser-tab-title", { hasText: "Lokal side to" }).waitFor();
    await page.locator(".browser-nav").getByRole("button", { name: "Tilbake", exact: true }).click();
    await waitFor(async () => (await address.inputValue()).endsWith("/en"), "Tilbake henter første lokale side");
    await page.locator(".browser-nav").getByRole("button", { name: "Frem", exact: true }).click();
    await waitFor(async () => (await address.inputValue()).endsWith("/to"), "Frem henter neste lokale side");
    const original = await page.locator(".browser-tab.active").getAttribute("data-tab");
    await page.getByRole("button", { name: "Ny nettleserfane", exact: true }).click();
    await waitFor(async () => (await page.locator(".browser-tab").count()) === 2, "to faner");
    const closing = await page.locator(".browser-tab.active").getAttribute("data-tab");
    assert.notEqual(closing, original);
    await page.getByTestId("browser-newtab").waitFor();
    second = await h.context.newPage();
    await second.goto(h.origin);
    await second.locator(".app").waitFor();
    const kode = second.locator(".sidebar .mode-button", { hasText: "Kode" });
    if ((await kode.getAttribute("aria-pressed")) !== "true") await kode.click();
    await second.locator('.group[data-project="Nettprøve"] .group-title').first().click();
    await openTool(second, "Nettleser");
    await waitFor(async () => (await second!.locator(".browser-tab").count()) === 2, "andre vindu ser samme faner");
    await second.locator(`.browser-tab[data-tab="${closing}"] .browser-tab-close`).click();
    await waitFor(async () => (await page.locator(".browser-tab").count()) === 1, "lukket fane forsvinner også i første vindu");
    assert.equal(await page.locator(".browser-tab.active").getAttribute("data-tab"), original);
    await waitFor(async () => (await address.inputValue()).endsWith("/to"), "gjenstående fane er tilkoblet og viser sin adresse");
    // Tab closure can leave the pointer over +, which intentionally opens its hover menu.
    await page.mouse.move(600, 700);
    await page.keyboard.press("Escape");
    await page.locator(".browser-nav").getByRole("button", { name: "Last på nytt", exact: true }).click();
    await page.locator(".browser-tab.active .browser-tab-title", { hasText: "Lokal side to" }).waitFor();
    await page.getByRole("button", { name: "Mer for nettleseren", exact: true }).click();
    await page.getByRole("menuitem", { name: "Finn på siden", exact: true }).click();
    const find = page.getByRole("textbox", { name: "Finn på siden", exact: true });
    await find.fill("  dette-finnes-ikke-på-siden  ");
    await find.press("Enter");
    await page.getByText("Ikke funnet", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    const otherDir = path.join(h.home, "nett-annet-prosjekt");
    mkdirSync(otherDir);
    await h.api("POST", "/api/projects", { name: "Andre nettsider", path: otherDir });
    await page.locator('.group[data-project="Andre nettsider"] .group-title').first().click();
    await openTool(page, "Nettleser");
    await page.getByTestId("browser-newtab").waitFor();
    assert.equal(await address.inputValue(), "", "annet prosjekt har egen blank nettleser");
    await page.locator('.group[data-project="Nettprøve"] .group-title').first().click();
    await openTool(page, "Nettleser");
    await waitFor(async () => (await address.inputValue()).endsWith("/to"), "prosjektets lokale side gjenopprettes");
  } finally {
    await second?.close();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  }
});

flow("Terminal starter ikke et skjult skall når en sen liste kommer etter panelbytte", async (h) => {
  const { page } = h;
  // With "Separate rader" a panel switch unmounts the Terminal; the shared row keeps it mounted
  // (as an open tool), so the unmount race this protects only exists in this layout.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  const project = await openProject(h);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const url = `**/api/projects/${project.id}/terminals`;
  await page.route(url, async (route) => {
    await pending;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  const requested = page.waitForRequest((r) => r.url().endsWith(`/api/projects/${project.id}/terminals`));
  await openTool(page, "Terminal");
  await requested;
  await openTool(page, "Filer");
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${project.id}/terminals`));
  release();
  await response;
  await page.unroute(url);
  await page.waitForTimeout(100);
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/terminals`), [], "ingen sen opprettelse av terminal etter unmount");
});
