import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { approveUntil, flow, send, waitFor, openTool } from "./harness.ts";

flow("lag prosjekt, godkjenn, se filen og diffen, og angre turen", async (h) => {
  const { page } = h;

  await page.getByRole("button", { name: "Kode", exact: true }).click();
  await page.locator(".pane-inner.focused").getByTestId("project-picker").click();
  await page.getByRole("dialog", { name: "Velg prosjekt" }).getByRole("button", { name: "Nytt prosjekt" }).click();
  const creation = page.getByRole("dialog", { name: "Opprett prosjekt", exact: true });
  await creation.getByLabel("Prosjektnavn", { exact: true }).fill(path.basename(h.projectDir));
  await page.route("**/api/fs/pick-folder", (route) => route.fulfill({ json: { path: h.projectDir } }));
  await creation.getByRole("button", { name: "Legg til", exact: true }).click();
  await creation.getByText(h.projectDir, { exact: true }).waitFor();
  await creation.getByRole("button", { name: "Opprett prosjekt", exact: true }).click();
  await page.getByRole("dialog", { name: "Stoler du på denne mappen?", exact: true }).getByRole("button", { name: "Stol på mappen", exact: true }).click();
  await page.waitForSelector(".project-label");
  assert.match(await page.locator(".project-label").textContent() ?? "", new RegExp(path.basename(h.projectDir)));

  await send(page, "lag en side");
  await page.getByRole("button", { name: "Tillat", exact: true }).first().waitFor();
  assert.ok(await page.getByRole("button", { name: "Avslå" }).first().isVisible());
  const approvals = await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "demo-modellen er ferdig");
  assert.ok(approvals >= 5, `godkjente ${approvals} ganger`);
  assert.match(readFileSync(path.join(h.projectDir, "index.html"), "utf8"), /Hei fra demo-modellen/);

  // Round 13 (SPEC 27.1): the three browser steps in a row are one line, «Brukte nettleseren i 3 steg».
  const tools = page.locator(".row-tool, .row-run");
  assert.ok(await tools.count() >= 4);
  assert.equal(await page.locator('.row-run[data-kind="web"] .steps-summary').textContent(), "Brukte nettleseren i 3 steg");
  assert.equal(await page.locator('.row-tool[data-tool="write_file"]').getAttribute("data-status"), "done");
  await page.locator('.row-tool[data-tool="run_command"] .tool-head').click();
  await page.locator(".tool-output", { hasText: "index.html" }).first().waitFor();

  // In Kode, thinking is a step: its first line, folded out to the whole text.
  const thinking = page.locator(".row-thinking").first();
  assert.match(await thinking.textContent() ?? "", /Brukeren vil ha en side/);
  await thinking.locator("button").click();
  await page.locator(".thinking-text").first().waitFor();

  await openTool(page, "Filer");
  await page.locator('.tree-item[data-path="index.html"]').click();
  await page.locator(".cm-content", { hasText: "Hei fra demo-modellen" }).waitFor();
  await page.locator(".cm-content .tok-typeName, .cm-content .tok-keyword").first().waitFor(); // The language loads on demand.

  await openTool(page, "Endringer");
  await page.locator('[data-testid="diff-file"][data-path="index.html"]').waitFor();
  await page.locator(".diff-line.add", { hasText: "Hei fra demo-modellen" }).waitFor();
  assert.match(await page.locator(".changes-note").textContent() ?? "", /kommandoer fanges ikke/);

  await page.getByRole("button", { name: "Angre tur" }).click();
  await waitFor(() => !existsSync(path.join(h.projectDir, "index.html")), "filen er borte etter Angre tur");
  await page.locator(".row-changes .changes-reverted").waitFor();

  await openTool(page, "Filer");
  await waitFor(async () => (await page.locator('.tree-item[data-path="index.html"]').count()) === 0, "filen er borte fra treet");

  // Stop and queue.
  await send(page, "lang kommando");
  await page.getByRole("button", { name: "Tillat", exact: true }).first().click();
  await page.locator('.row-tool[data-tool="run_command"][data-status="running"]').waitFor();
  await page.locator(".tool-tail", { hasText: "Steg 1" }).waitFor(); // Live output, also while folded.
  await page.locator('.row-tool[data-status="running"] .tool-head').click();
  await page.locator(".tool-output", { hasText: "Steg 2" }).waitFor({ timeout: 5000 }); // Still arriving when opened.
  await send(page, "hjelp");
  await page.getByTestId("queue").getByText("hjelp").waitFor();
  await page.locator(".pane-inner.focused .composer").getByRole("button", { name: "Stopp", exact: true }).click();
  await page.locator(".row-line", { hasText: "Stoppet" }).waitFor();
  await page.locator(".user-text", { hasText: "hjelp" }).waitFor(); // Queued messages stay in the conversation.
  assert.equal(await page.getByTestId("queue").count(), 0, "køen er tom");
  assert.equal(await page.getByText("Dette er demo-modellen").count(), 0, "Stopp starter ikke det som lå i kø");
});

flow("Avslå stopper verktøyet, og endring etter turen krever bekreftelse ved angring", async (h) => {
  const { page } = h;
  await h.createProject("Demo");
  await page.getByRole("button", { name: "Kode", exact: true }).click();
  await page.locator('.group[data-project="Demo"] .group-title').click();
  await send(page, "lag en side");
  await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "siden er laget");
  await send(page, "rediger");
  await page.getByRole("button", { name: "Avslå" }).first().click();
  await page.getByText("Du avslo det").waitFor();
  await page.locator(".row-decided", { hasText: "Avslått" }).waitFor();

  // Tillat alltid is remembered: the same command does not ask twice.
  await send(page, "lang kommando");
  await page.getByRole("button", { name: "Tillat alltid" }).click();
  await page.locator('.row-tool[data-tool="run_command"][data-status="running"]').waitFor();
  await page.locator(".pane-inner.focused .composer").getByRole("button", { name: "Stopp", exact: true }).click();
  await page.locator(".row-line", { hasText: "Stoppet" }).waitFor();
  const cards = await page.locator(".approval-card").count();
  await send(page, "lang kommando");
  await page.locator('.row-tool[data-tool="run_command"][data-status="running"]').waitFor();
  assert.equal(await page.locator(".approval-card").count(), cards, "ingen nytt kort");
  await page.locator(".pane-inner.focused .composer").getByRole("button", { name: "Stopp", exact: true }).click();
});
