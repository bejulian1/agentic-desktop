import assert from "node:assert/strict";
import { flow, openProject, waitFor } from "./harness.ts";

flow("Fil-skills vises i Chat og Kode, med bare Chat-vennlige skills i Chat", async (h) => {
  const { page } = h;
  const field = page.getByLabel("Melding", { exact: true });
  await field.fill("$");
  const menu = page.getByTestId("composer-menu");
  for (const name of ["excel", "word", "powerpoint", "data-files"]) await menu.getByText(`$${name}`, { exact: true }).waitFor();
  assert.equal(await menu.getByText("$debug", { exact: true }).count(), 0);
  if (process.env.AD_DOCUMENT_SKILLS_SCREENSHOT) await page.screenshot({ path: process.env.AD_DOCUMENT_SKILLS_SCREENSHOT });
  await page.keyboard.press("Escape");
  await field.fill("");
  await openProject(h, "Dokumentprosjekt");
  await page.getByLabel("Melding", { exact: true }).fill("$excel");
  await menu.getByText("$excel", { exact: true }).waitFor();
});

flow("Chat-prosjekt kan velge innebygd fil-skill som brikke og sende den", async (h) => {
  const { page } = h;
  const project = await h.api("POST", "/api/chat-projects", { name: "Dokumenter", instructions: "Bruk korte norske tekster." });
  await h.reload();
  await page.locator('.chat-project[data-chat-project="Dokumenter"] .group-title').click();
  const landing = page.getByTestId("chat-project-page");
  await landing.waitFor();
  const field = landing.getByLabel("Melding", { exact: true });
  await field.fill("$word");
  await page.getByTestId("composer-menu").getByText("$word", { exact: true }).click();
  await page.locator(".chip-skill", { hasText: "/word" }).waitFor();
  const sent: any[] = [];
  await page.route("**/api/threads/*/messages", async (route) => {
    if (route.request().method() === "POST") sent.push(route.request().postDataJSON());
    await route.continue();
  });
  await field.fill("Lag et kort Word-notat.");
  await page.keyboard.press("Enter");
  await waitFor(() => sent.length === 1, "app-skill sendt i prosjektet");
  assert.equal(sent[0].skill, "word");
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.some((item: any) => item.chatProjectId === project.id && item.running), "svaret er ferdig");
  assert.ok(!(await page.locator("body").innerText()).includes("Skills brukes ikke i Chat-prosjekter"));
});
