// v0.6, SPEC 17.1 (agent B): downloads in the Browser panel, the folder in Innstillinger →
// Nettleser, and as many projects as you like, renamed and moved in Rediger prosjekt. The files
// come from a local server in the test, and the folder is a temporary one.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { useFolderPickerFallback, flow, openProject, waitFor, openTool } from "./harness.ts";

function fileServer(): Promise<{ base: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const name = url.searchParams.get("navn") ?? "fil.txt";
    const big = url.searchParams.get("stor") === "1";
    if (url.pathname === "/side") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><title>Last ned</title><a id="a" href="/fil?navn=${encodeURIComponent(name)}&stor=${big ? 1 : 0}">last ned</a><script>addEventListener("load", () => setTimeout(() => document.getElementById("a").click(), 30))</script>`);
    }
    if (big) {
      const size = 6_000_000;
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "content-length": size });
      let sent = 0;
      const timer = setInterval(() => {
        res.write(Buffer.alloc(100_000, 66));
        sent += 100_000;
        if (sent >= size) {
          clearInterval(timer);
          res.end();
        }
      }, 60);
      return;
    }
    res.writeHead(200, { "content-type": "text/plain", "content-disposition": `attachment; filename="${name}"` });
    res.end(`innhold av ${name}\n`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })));
}

flow("nedlastinger: mappe i Innstillinger, fremdrift, varsel, like navn, Kopier stien, Fjern fra lista og Slett filen", async (h) => {
  const { page } = h;
  await useFolderPickerFallback(h);
  const files = await fileServer();
  try {
    const dir = path.join(h.home, "mine nedlastinger");
    // The folder is chosen in Innstillinger → Nettleser, with the folder picker.
    await page.getByRole("button", { name: "Innstillinger" }).click();
    const settings = page.getByRole("region", { name: "Innstillinger" });
    await settings.getByRole("button", { name: "Nettleser", exact: true }).click();
    const row = page.getByTestId("download-dir");
    await row.getByText(path.join(h.home, "Downloads", "Agentic Desktop")).waitFor();
    await row.getByText("(standard)").waitFor();
    await row.getByRole("button", { name: "Velg mappe…" }).click();
    const picker = page.getByRole("dialog", { name: "Velg mappe" });
    await picker.getByText("Velg mappe for nedlastinger").waitFor();
    await picker.getByLabel("Sti", { exact: true }).fill(dir);
    await picker.getByRole("button", { name: "Velg denne mappen" }).click();
    await row.getByText(dir).waitFor();
    assert.equal((await h.api("GET", "/api/bootstrap")).settings.downloadDir, dir);
    assert.equal(existsSync(dir), false, "laget først ved første nedlasting");
    await page.getByRole("button", { name: "Tilbake til appen" }).click();

    await openProject(h);
    await openTool(page, "Nettleser");
    const address = page.getByLabel("Adresse");
    const visit = async (query: string) => {
      await address.fill(`${files.base}/side?${query}`);
      await address.press("Enter");
    };

    // A file is saved, and a small note says so.
    await visit("navn=rapport.txt");
    await page.locator(".toast", { hasText: "Lastet ned «rapport.txt»." }).waitFor({ timeout: 30_000 });
    await visit("navn=rapport.txt");
    await page.locator(".toast", { hasText: "Lastet ned «rapport (1).txt»." }).waitFor({ timeout: 30_000 });
    assert.deepEqual(readdirSync(dir).filter((n) => !n.startsWith(".")).sort(), ["rapport (1).txt", "rapport.txt"]);

    // A big one shows its progress in the list.
    await page.getByRole("button", { name: "Mer for nettleseren" }).click();
    await page.locator(".browser-menu").getByRole("menuitem", { name: /Nedlastinger/ }).click();
    const list = page.getByTestId("downloads");
    await list.getByText(dir).waitFor();
    await visit("navn=stor.bin&stor=1");
    await list.getByRole("progressbar", { name: "Fremdrift for stor.bin" }).waitFor({ timeout: 30_000 });
    const big = list.locator(".download-row", { hasText: "stor.bin" });
    await big.getByText(/MB av 5,7 MB/).first().waitFor();
    await big.locator('.download-state[data-state="done"]').waitFor({ timeout: 30_000 });

    // Kopier stien shows the path and copies it. Nothing is opened.
    const first = list.locator(".download-row", { has: page.getByText("rapport.txt", { exact: true }) });
    await first.getByRole("button", { name: "Kopier stien" }).click();
    await first.getByText(path.join(dir, "rapport.txt")).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), path.join(dir, "rapport.txt"));

    // Off the list: the file stays. Slett filen asks first.
    await first.getByRole("button", { name: "Fjern fra lista" }).click();
    await waitFor(async () => (await first.count()) === 0, "borte fra lista");
    assert.ok(existsSync(path.join(dir, "rapport.txt")), "filen er der fortsatt");
    const second = list.locator(".download-row", { hasText: "rapport (1).txt" });
    await second.getByRole("button", { name: "Slett filen…" }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: "Slette filen?" });
    await confirm.getByRole("button", { name: "Avbryt" }).click();
    assert.ok(existsSync(path.join(dir, "rapport (1).txt")), "Avbryt sletter ingenting");
    await second.getByRole("button", { name: "Slett filen…" }).click();
    await confirm.getByRole("button", { name: "Slett filen" }).click();
    await waitFor(async () => !existsSync(path.join(dir, "rapport (1).txt")), "filen er slettet");
    assert.deepEqual(readdirSync(path.dirname(dir)).filter((n) => n === "mine nedlastinger" || n.startsWith("rapport")), ["mine nedlastinger"], "ingenting utenfor mappen");
  } finally {
    files.close();
  }
});

flow("så mange prosjekter du vil, og navn og mappe kan endres i Rediger prosjekt", async (h) => {
  const { page } = h;
  const root = path.join(h.home, "prosjekter");
  for (let i = 1; i <= 25; i++) await h.api("POST", "/api/projects", { name: `Prosjekt ${i}`, path: path.join(root, `p${i}`) });
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 25);
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click(); // Kode projects are listed in Kode (round 9)
  await page.getByRole("button", { name: "Vis flere" }).click();
  await waitFor(async () => (await page.locator(".group[data-project]").count()) === 25, "alle 25 i sidefanen");

  // Rename and move one through the in-app fallback.
  await useFolderPickerFallback(h);
  const group = page.locator('.group[data-project="Prosjekt 3"]');
  await group.locator(".group-head").hover();
  await group.getByRole("button", { name: "Valg for prosjektet" }).click();
  await page.getByRole("menuitem", { name: "Rediger prosjekt…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rediger prosjekt" });
  await dialog.getByLabel("Navn").fill("Omdøpt prosjekt");
  const moved = path.join(root, "ny-plass");
  mkdirSync(moved, { recursive: true });
  await dialog.getByRole("button", { name: "Bytt mappe…" }).click();
  const picker = page.getByRole("dialog", { name: "Velg mappe" });
  await picker.getByLabel("Sti", { exact: true }).fill(moved);
  await picker.getByRole("button", { name: "Velg denne mappen" }).click();
  await dialog.getByText(moved).waitFor();
  await dialog.getByRole("button", { name: "Lagre" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).projects.some((p: any) => p.name === "Omdøpt prosjekt" && p.path === moved), "lagret");
  await page.locator('.group[data-project="Omdøpt prosjekt"]').waitFor();
});
