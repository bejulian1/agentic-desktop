import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openProject, flow, waitFor, openTool } from "./harness.ts";
import type { Page } from "playwright-core";

const buffer = (page: Page) => page.getByTestId("terminal").evaluate((el) => (el as any).readBuffer() as string);

flow("terminalen tar input, og overlever panelbytte og sidelast", async (h) => {
  const { page } = h;
  // v0.19: the default "Felles topprad" shows terminal sessions in the panel's shared tab row.
  // This test is about the Terminal's own row ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  await openProject(h);
  await openTool(page, "Terminal");
  await page.getByTestId("terminal").waitFor();
  await waitFor(async () => (await buffer(page)).trim().length > 0, "skallet er klart");

  await page.getByTestId("terminal").click();
  await page.keyboard.type("echo hei-$((40+2)) | tee utdata.txt\n");
  await waitFor(async () => (await buffer(page)).includes("hei-42"), "utdataene vises i xterm");
  assert.equal(readFileSync(path.join(h.projectDir, "utdata.txt"), "utf8").trim(), "hei-42");
  const id = await page.getByTestId("terminal").getAttribute("data-terminal-id");

  await openTool(page, "Filer");
  assert.equal(await page.getByTestId("terminal").count(), 0, "terminalen er ute av DOM når fanen er lukket");
  await openTool(page, "Terminal");
  await waitFor(async () => (await page.getByTestId("terminal").count()) === 1 && (await buffer(page)).includes("hei-42"), "utdataene er tilbake etter panelbytte");
  assert.equal(await page.getByTestId("terminal").getAttribute("data-terminal-id"), id);

  await h.reload();
  await openTool(page, "Terminal");
  await waitFor(async () => (await page.getByTestId("terminal").count()) === 1 && (await buffer(page)).includes("hei-42"), "utdataene er tilbake etter sidelast");
  assert.equal(await page.getByTestId("terminal").getAttribute("data-terminal-id"), id, "samme PTY");
  await page.getByTestId("terminal").click();
  await page.keyboard.type("echo igjen-$((1+1))\n");
  await waitFor(async () => (await buffer(page)).includes("igjen-2"), "PTY-en tar input etter sidelast");

  // Losing the WebGL context must not cost the terminal: xterm falls back to its DOM renderer.
  const lost = await page.getByTestId("terminal").evaluate((el) => {
    const canvas = el.querySelector("canvas");
    const context = canvas?.getContext("webgl2");
    const extension = context?.getExtension("WEBGL_lose_context");
    extension?.loseContext();
    return Boolean(extension);
  });
  if (lost) await page.waitForTimeout(3300); // The addon waits 3 s for the context to come back.
  await page.getByTestId("terminal").click();
  await page.keyboard.type("echo etter-tapet\n");
  await waitFor(async () => (await buffer(page)).includes("etter-tapet\n"), "terminalen virker etter tapt kontekst");
  if (lost) await page.locator(".xterm-rows", { hasText: "etter-tapet" }).waitFor();

  await page.getByRole("button", { name: "Ny terminal" }).click();
  await waitFor(async () => (await page.locator(".terminal-tab").count()) === 2, "ny fane");
  await waitFor(async () => (await page.getByTestId("terminal").getAttribute("data-terminal-id")) !== id, "den nye fanen er valgt");
});
