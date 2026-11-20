// v0.6 (agent B): servers the app's own commands start, in Oversikt in the right panel, with a note
// when one is up, Åpne i nettleserpanelet, Kopier adresse and Stopp. The dev server is a small
// Node server started by a `!` command in the test, and it is stopped before the test ends.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, send, waitFor, openTool, toolShown } from "./harness.ts";

const DEV_SERVER = `const http = require("node:http");
const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end("<title>Dev</title><h1>Hei fra dev-serveren</h1>"); });
server.listen(0, "127.0.0.1", () => console.log("Klar på http://localhost:" + server.address().port + "/"));
`;

flow("servere: varsel, rad i Oversikt, åpne i nettleserpanelet, kopier adresse og stopp", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "dev.cjs"), DEV_SERVER);
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await openTool(page, "Oversikt");
  const section = page.getByTestId("servers");
  await section.getByText("Ingen servere kjører.").waitFor();

  await send(page, "!node dev.cjs");
  const toast = page.locator(".toast", { hasText: /Server kjører på localhost:\d+/ });
  await toast.waitFor({ timeout: 30_000 });
  const listed = (await h.api("GET", "/api/servers")) as Array<{ port: number; pid: number | null; threadId: string | null }>;
  assert.equal(listed.length, 1);
  const { port } = listed[0];
  assert.ok(listed[0].pid, "PID-en er kjent");
  const row = section.locator(`.server-row[data-port="${port}"]`);
  await row.getByText(`:${port}`).waitFor();
  await row.getByText(/node dev\.cjs/).waitFor();

  // The note's Åpne opens it in the Browser panel.
  await toast.getByRole("button", { name: "Åpne" }).click();
  await toolShown(page, "Nettleser");
  await waitFor(async () => (await page.getByLabel("Adresse").inputValue()).includes(`localhost:${port}`), "adressen er åpen");

  await openTool(page, "Oversikt");
  await row.getByRole("button", { name: "Kopier adresse" }).click();
  await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())) === `http://localhost:${port}`, "adressen er kopiert");

  // Stopp asks first, and stops the process the app started.
  await row.getByRole("button", { name: "Stopp" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: `Stoppe serveren på :${port}?` });
  await confirm.getByRole("button", { name: "Stopp" }).click();
  await section.getByText("Ingen servere kjører.").waitFor();
  await waitFor(async () => (await h.api("GET", "/api/servers")).length === 0, "borte på serveren");
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kommandoen er ferdig");
});
