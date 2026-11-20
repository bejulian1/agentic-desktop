import assert from "node:assert/strict";
import { approveUntil, flow, openProject, send, waitFor, openTool } from "./harness.ts";

flow("Gjennomgå i Endringer, Agent Teams i Team-panelet, og spilltestkortet", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await send(page, "lag en side");
  await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "siden er laget");

  await openTool(page, "Endringer");
  await page.getByRole("button", { name: "Gjennomgå" }).click();
  await page.locator(".row-user .user-text", { hasText: "/review" }).waitFor();
  await page.locator(".row-text", { hasText: "Kodegjennomgang" }).waitFor();
  await page.locator(".row-text", { hasText: "Inline-skript" }).waitFor();

  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await openTool(page, "Team");
  await page.getByTestId("team-panel").getByText("Ingen oppgaver ennå.").waitFor();
  await send(page, "team: lag en oversikt");
  await page.locator('.team-task[data-task-status="done"]', { hasText: "Skriv en kort oversikt" }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator('.team-task[data-task-status="done"]').count(), 2);
  await page.locator(".team-task", { hasText: "Kartlegg prosjektmappen" }).locator(".team-owner").waitFor();

  await page.getByLabel("Ny oppgave").fill("Skriv README");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.locator('.team-task[data-task-status="todo"]', { hasText: "Skriv README" }).waitFor();
  await page.getByLabel("Ferdig: Skriv README").check();
  await page.locator('.team-task[data-task-status="done"]', { hasText: "Skriv README" }).waitFor();

  await openTool(page, "Nettleser");
  await page.getByRole("button", { name: "Mer for nettleseren" }).click();
  await page.locator(".browser-menu").getByRole("menuitem", { name: /Spilltesting headless/ }).click();
  await page.getByRole("note", { name: "Spilltesting headless" }).locator(".demo-badge").waitFor();

  // Double-click on the edge gives the panel its standard width back.
  await page.locator(".panel-resize").dblclick();
  await waitFor(async () => Math.round((await page.locator(".right-panel").boundingBox())!.width) === 420, "standardbredde");
});
