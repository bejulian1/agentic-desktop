import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import { openProject, flow, waitFor, openTool } from "./harness.ts";
import type { Page } from "playwright-core";

// Stands in for VS Code and writes down what it was asked to open.
const STAND_IN = mkdtempSync(path.join(tmpdir(), "ad-ui-code-"));
const OPENED = path.join(STAND_IN, "opened.txt");
writeFileSync(path.join(STAND_IN, "code"), `#!/bin/sh\necho "$1" > "${OPENED}"\n`);
chmodSync(path.join(STAND_IN, "code"), 0o755);
after(() => rmSync(STAND_IN, { recursive: true, force: true }));

const PAGE = `<!doctype html><title>Klikkside</title><style>body,button{margin:0;width:100vw;height:100vh;border:0;background:rgb(255,255,255)}</style>
<button id="b"></button>
<script>
const set = (c) => { document.body.style.background = c; document.getElementById("b").style.background = c; };
document.getElementById("b").addEventListener("click", () => set("rgb(0,160,0)"));
addEventListener("keydown", (e) => { if (e.key === "x") set("rgb(0,0,200)"); });
</script>`;

function centerPixel(page: Page): Promise<number[]> {
  return page.getByTestId("browser-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext("2d")!.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1);
    return [...data];
  });
}

flow("Playtest viser siden i nettleserpanelet, og klikk og taster virker", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "index.html"), PAGE);
  writeFileSync(path.join(h.projectDir, "side2.html"), "<!doctype html><title>Side 2</title><body style='background:rgb(200,0,0)'>");
  await openProject(h);

  await page.getByRole("button", { name: "Playtest", exact: true }).click();
  await page.getByTestId("browser-canvas").waitFor();
  await page.getByRole("button", { name: /Stopp playtest/ }).waitFor();
  await waitFor(async () => (await centerPixel(page))[0] > 240, "panelet viser den hvite siden");
  const address = page.getByLabel("Adresse");
  await waitFor(async () => /^http:\/\/localhost:\d+\//.test(await address.inputValue()), "adressen er forhåndsvisningen");
  const url = new URL(await address.inputValue());
  assert.notEqual(url.port, String(h.server.port), "forhåndsvisning har en annen port enn appen");

  await page.getByTestId("browser-canvas").click();
  await waitFor(async () => {
    const [r, g] = await centerPixel(page);
    return r < 40 && g > 120;
  }, "klikket i panelet gjorde siden grønn");

  await page.keyboard.press("x");
  await waitFor(async () => {
    const [r, , b] = await centerPixel(page);
    return r < 40 && b > 150;
  }, "tasten i panelet gjorde siden blå");

  await address.fill(`${url.origin}/side2.html`);
  await address.press("Enter");
  await waitFor(async () => (await centerPixel(page))[0] > 170, "adressefeltet åpnet side 2");
  const back = page.getByRole("button", { name: "Tilbake" });
  await waitFor(() => back.isEnabled(), "tilbake er tilgjengelig");
  await back.click();
  await waitFor(async () => (await address.inputValue()) === `${url.origin}/`, "tilbake virket");
  await page.getByRole("button", { name: "Last på nytt" }).click();
  await waitFor(async () => (await centerPixel(page))[0] > 240, "last på nytt ga den hvite siden");

  await page.getByRole("button", { name: /Stopp playtest/ }).click();
  await page.getByRole("button", { name: "Playtest", exact: true }).waitFor();
});

flow("Playtest med dev-skript kjører i terminalfanen, på en annen port", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "tjener.mjs"), `
    import http from "node:http";
    const port = Number(process.env.PORT);
    http.createServer((_q, s) => s.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Dev</title><body style='background:rgb(0,0,210)'>")).listen(port, () => console.log("Klar på http://localhost:" + port));
  `);
  writeFileSync(path.join(h.projectDir, "package.json"), JSON.stringify({ scripts: { dev: "node tjener.mjs" } }));
  await openProject(h);
  await page.getByRole("button", { name: "Playtest", exact: true }).click();
  await page.getByTestId("browser-canvas").waitFor();
  await waitFor(async () => (await centerPixel(page))[2] > 150, "panelet viser dev-tjeneren");
  await openTool(page, "Terminal");
  await page.getByTestId("terminal").waitFor();
  await waitFor(async () => (await page.getByTestId("terminal").evaluate((el) => (el as any).readBuffer() as string)).includes("Klar på"), "utdataene er i terminalfanen");
  await page.getByRole("button", { name: /Stopp playtest/ }).click();
  await page.locator(".topbar").getByRole("button", { name: "Playtest", exact: true }).waitFor(); // not the terminal tab of the same name
});

flow("Åpne i VS Code viser feil når code mangler", async (h) => {
  const { page } = h;
  h.allow(/502/);
  await openProject(h);
  await page.getByRole("button", { name: "Flere valg" }).click();
  await page.getByRole("menuitem", { name: "Åpne i VS Code" }).click();
  await page.locator(".toast", { hasText: "Fant ikke kommandoen code" }).waitFor();
}, { env: { PATH: "/nonexistent" } }); // Nothing named code can be found here, so no window can open.

flow("Åpne i VS Code starter code med prosjektmappen", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.getByRole("button", { name: "Flere valg" }).click();
  await page.getByRole("menuitem", { name: "Åpne i VS Code" }).click();
  await page.locator(".toast", { hasText: "Åpnet i VS Code" }).waitFor();
  await waitFor(() => existsSync(OPENED) && readFileSync(OPENED, "utf8").trim() === h.projectDir, "stand-in for code fikk mappen");
}, { env: { PATH: STAND_IN } });
