import assert from "node:assert/strict";
import { flow, openProject, waitFor } from "./harness.ts";

flow("Innebygde skills vises for riktig modus og CI-skillen kan sendes fra Kode", async (h) => {
  const { page } = h;
  const field = page.getByLabel("Melding", { exact: true });
  await field.fill("$");
  const menu = page.getByTestId("composer-menu");
  for (const name of ["excel", "word", "powerpoint", "data-files", "action-items", "analyze-data", "source-brief"]) {
    await menu.getByText(`$${name}`, { exact: true }).waitFor();
  }
  for (const name of ["debug", "benchmark", "ci-triage"]) {
    assert.equal(await menu.getByText(`$${name}`, { exact: true }).count(), 0);
  }
  if (process.env.AD_DOCUMENT_SKILLS_SCREENSHOT) await page.screenshot({ path: process.env.AD_DOCUMENT_SKILLS_SCREENSHOT });
  await page.keyboard.press("Escape");
  await field.fill("");
  await openProject(h, "Dokumentprosjekt");
  const code = page.getByLabel("Melding", { exact: true });
  await code.fill("$excel");
  await menu.getByText("$excel", { exact: true }).waitFor();
  await code.fill("$benchmark");
  await menu.getByText("$benchmark", { exact: true }).waitFor();
  await code.fill("$ci-triage");
  await menu.getByText("$ci-triage", { exact: true }).click();
  await page.locator(".chip-skill", { hasText: "/ci-triage" }).waitFor();
  const sent = page.waitForRequest((request) => request.method() === "POST" && /\/api\/threads\/[^/]+\/messages$/.test(request.url()));
  await code.fill("Undersøk loggen for testjobben.");
  await code.press("Enter");
  assert.equal((await sent).postDataJSON().skill, "ci-triage");
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
