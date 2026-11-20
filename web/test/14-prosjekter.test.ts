import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

flow("prosjektinnstillinger, bakgrunnsinstans og instanser som tre", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const group = page.locator('.group[data-project="Demo"]');

  await group.locator(".group-head").hover();
  await group.getByRole("button", { name: "Valg for prosjektet" }).click();
  // One dialog for the project (v0.6, round 8): Generelt, Agent and Kilder, saved together.
  await page.getByRole("menuitem", { name: "Rediger prosjekt…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rediger prosjekt" });
  await dialog.getByRole("button", { name: "Velg ikon" }).click();
  await dialog.getByRole("radio", { name: "Grønn", exact: true }).click();
  await dialog.getByRole("tab", { name: "Agent" }).click();
  await dialog.getByRole("button", { name: "Tillatelser" }).click();
  await page.getByRole("menuitemradio", { name: "Godta redigeringer" }).click();
  await dialog.getByLabel("Instruksjoner for prosjektet").fill("Bruk tabulatorer.");
  await dialog.getByRole("tab", { name: "Kilder" }).click();
  await dialog.getByText("Alt følger appens standard").waitFor();
  await dialog.getByRole("button", { name: "Lagre", exact: true }).click();
  await page.locator(".toast", { hasText: ".agentic/AGENTS.md" }).waitFor();
  assert.equal(readFileSync(path.join(h.projectDir, ".agentic/AGENTS.md"), "utf8"), "Bruk tabulatorer.");
  await waitFor(async () => {
    const p = (await h.api("GET", "/api/bootstrap")).projects[0];
    return p.color === "green" && p.permissionMode === "accept-edits";
  }, "fargen og tillatelsene er lagret");
  await waitFor(async () => (await dialog.count()) === 0, "dialogen lukkes");

  // A background instance starts without taking a pane.
  await group.locator(".group-head").hover();
  await group.getByRole("button", { name: "Valg for prosjektet" }).click();
  await page.getByRole("menuitem", { name: "Ny bakgrunnstråd…" }).click();
  await page.getByRole("dialog", { name: "Ny bakgrunnstråd" }).getByRole("textbox").fill("hjelp");
  await page.getByRole("button", { name: "Start" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.title === "hjelp" && t.lastStatus === "done"), "bakgrunnsinstansen er ferdig");
  assert.equal(await page.locator(".pane-inner").count(), 1, "ingen ny rute");

  // An instance made by another hangs under it.
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await send(page, "samarbeid om en oversikt");
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.origin === "agent"), "hjelpetråden finnes");
  const child = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.origin === "agent");
  await threadItem(page, child.id).and(page.locator(".thread-item.child")).waitFor();
  const order = await group.locator(".thread-item").evaluateAll((items) => items.map((el) => el.getAttribute("data-thread-item")));
  assert.equal(order[order.indexOf(child.id) - 1], child.parentThreadId, "rett under tråden som lagde den");
});
