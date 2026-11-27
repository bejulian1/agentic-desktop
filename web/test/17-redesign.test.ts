// v0.4, SPEC 15: the start page with statistics, the project picker and branch chip above the
// message field, the approval card right above the field, notifications, Skills and Planlagt in
// the sidebar, and Settings as a full page with archived threads.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { approveUntil, flow, openProject, send, threadItem, waitFor } from "./harness.ts";

flow("startsiden: hilsen og eksempler i Chat, stort spørsmål og prosjektvelger i Kode, statistikken i Bruk", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { profileName: "Kari Nordmann" });
  await page.getByTestId("pane-empty").getByText("Hva skjer nå, Kari?").waitFor();
  // Chat has example cards, and neither the statistics card nor the project row above the field.
  await page.getByTestId("examples").getByRole("button", { name: /Hva kan du\?/ }).click();
  assert.equal(await page.getByLabel("Melding").inputValue(), "hjelp");
  assert.equal(await page.getByTestId("stats-card").count(), 0);
  assert.equal(await page.getByTestId("project-picker").count(), 0);

  // One run, then the numbers in Innstillinger → Bruk come from the database.
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");
  mkdirSync(path.join(h.projectDir, ".git"));
  writeFileSync(path.join(h.projectDir, ".git/HEAD"), "ref: refs/heads/hovedgren\n");
  await h.api("PATCH", "/api/settings", { codeStart: "projects" }); // round 11b: Prosjektboks (SPEC 25.2)
  await openProject(h);
  await page.locator(".home-title", { hasText: "Hva skal vi jobbe med i Demo?" }).waitFor();
  // SPEC 20 and 21.1: no statistics on the Kode start page, only the question and the project's card.
  await page.getByTestId("project-home").waitFor();
  assert.equal(await page.getByTestId("stats-card").count(), 0, "ingen statistikk på startsiden");

  // SPEC 20: the card is in Innstillinger → Bruk, and the switch for the start page is gone.
  await page.getByRole("button", { name: "Innstillinger" }).click();
  await page.getByRole("button", { name: "Bruk", exact: true }).click();
  await page.locator(".settings-page").getByTestId("stats-card").locator(".stats-tile", { hasText: "Økter" }).locator(".stats-value", { hasText: "1" }).waitFor();
  assert.equal(await page.getByText("Statistikk på startsiden").count(), 0);
  await page.keyboard.press("Escape");

  // The project name opens the picker. The branch is read from .git/HEAD.
  await page.getByTestId("branch").getByText("hovedgren").waitFor();
  await page.getByTestId("project-picker").getByText("Demo").waitFor();
  await page.locator(".home-project").click();
  const picker = page.getByRole("dialog", { name: "Velg prosjekt" });
  await picker.getByRole("option", { name: "Demo", selected: true }).waitFor();
  // Round 9: no project is Kode on Denne datamaskinen, not Chat.
  await picker.getByRole("button", { name: "Ikke jobb i et prosjekt" }).click();
  await page.getByRole("button", { name: "Kode", exact: true, pressed: true }).waitFor();
  await page.locator(".home-title", { hasText: "Hva skal vi bygge?" }).waitFor();
  await page.getByTestId("project-picker").getByText("Velg prosjekt").waitFor();
  await page.getByTestId("project-picker").click();
  await picker.getByLabel("Søk i prosjekter").fill("dem");
  await picker.getByRole("option", { name: "Demo" }).click();
  await page.getByRole("button", { name: "Kode", exact: true, pressed: true }).waitFor();
  await page.getByTestId("model-button").click();
  await page.getByTestId("model-permissions").getByRole("radio", { name: "Be om godkjenning", checked: true }).waitFor();
  await page.keyboard.press("Escape");
});

flow("godkjenningskortet ligger rett over meldingsfeltet, og varsler viser det som venter", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await send(page, "lag en side");
  const card = page.locator(".approval-card").first();
  await card.waitFor();
  const focused = page.locator(".pane-inner.focused");
  assert.equal(await focused.locator(".scroller .approval-card").count(), 0, "ikke inne i samtalen");
  // The step waits with a small mark; the card is the one place that says so (round 8, P1-3).
  await focused.locator('.row-tool[data-status="awaiting-approval"] .step-waiting').waitFor();
  assert.equal(await focused.getByText("Venter på godkjenning nedenfor").count(), 0);
  const cardBox = (await card.boundingBox())!;
  const fieldBox = (await focused.locator(".composer").boundingBox())!;
  assert.ok(cardBox.y + cardBox.height <= fieldBox.y, "over meldingsfeltet");
  assert.ok(Math.abs(cardBox.x - fieldBox.x) <= 2 && Math.abs(cardBox.width - fieldBox.width) <= 2, "samme bredde som feltet");
  await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "siden er laget");
  assert.equal(await page.locator(".approval-card").count(), 0);

  // A thread nobody looks at waits for an answer: the bell says so, and takes you there.
  const waiting = await h.createThread(project.id);
  await h.api("PATCH", `/api/threads/${waiting.id}`, { title: "Venter i bakgrunnen" });
  await h.api("POST", `/api/threads/${waiting.id}/messages`, { text: "godkjenning" });
  await threadItem(page, waiting.id).locator(".badge").waitFor();
  await page.getByRole("button", { name: /^Varsler \(\d+\)$/ }).click();
  await page.getByRole("list", { name: "Varsler" }).getByRole("button", { name: /Venter i bakgrunnen/ }).click();
  await page.locator(`.pane-inner.focused[data-thread-id="${waiting.id}"] .approval-card`).waitFor();
});

flow("Skills og Planlagt i sidefanen, og Innstillinger som fullside med arkiverte tråder", async (h) => {
  const { page } = h;
  mkdirSync(path.join(h.projectDir, ".agentic/skills/hils"), { recursive: true });
  writeFileSync(path.join(h.projectDir, ".agentic/skills/hils/SKILL.md"), "---\nname: hils\ndescription: Hilser pent\n---\nSi hei.\n");
  await openProject(h);
  await page.locator(".sidebar-nav").getByRole("button", { name: "Skills" }).click();
  const skills = page.getByTestId("skills-workspace");
  await skills.locator(".skills-library-item", { hasText: "hils" }).click();
  await waitFor(async () => (await skills.getByLabel("Skill-instruksjoner").inputValue()).includes("Si hei."), "prosjektets skill åpnes i arbeidsområdet");
  await skills.getByRole("button", { name: "Tilbake fra Skills" }).click();
  assert.equal(await page.locator(".sidebar-nav").getByRole("button", { name: /Planlagt/ }).count(), 0);
  await page.keyboard.press("Control+K");
  await page.keyboard.type("planlagte");
  await page.getByRole("dialog", { name: "Kommandopalett" }).getByRole("option", { name: /Planlagte oppgaver/ }).click();
  const scheduled = page.getByRole("dialog", { name: "Planlagt" });
  await scheduled.getByRole("button", { name: "Ny oppgave" }).click();
  await scheduled.getByLabel("Navn").fill("Ukentlig oppsummering");
  await scheduled.getByLabel("Melding").fill("Oppsummer uken");
  await scheduled.getByLabel("Gjenta").selectOption("weekly");
  await scheduled.getByLabel("fredag").check();
  await scheduled.getByRole("button", { name: "Lagre oppgave" }).click();
  await scheduled.getByText(/mandag, fredag kl/).waitFor();
  await scheduled.getByRole("button", { name: "Pause" }).click();
  await scheduled.getByText(/Neste: pauset/).waitFor();
  await page.keyboard.press("Escape");

  // Settings cover the whole window, with both groups, and Esc goes back.
  await page.getByRole("button", { name: "Innstillinger" }).click();
  const settings = page.getByRole("region", { name: "Innstillinger" });
  const box = (await settings.boundingBox())!;
  const viewport = page.viewportSize()!;
  assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, viewport.width, viewport.height], "hele vinduet");
  for (const name of ["Generelt", "Utseende", "Modeller og leverandører", "Git", "Bruk", "Konfigurasjon", "Personalisering og minner", "Hurtigtaster", "MCP-servere", "Hooks", "Nettleser", "Tillatelser", "Arkiverte tråder", "Om"]) {
    await settings.getByRole("button", { name, exact: true }).click();
    await settings.locator(".settings-title", { hasText: name }).waitFor();
  }
  await page.keyboard.press("Escape");
  await waitFor(async () => (await settings.count()) === 0, "Esc lukker");

  // Archive from the sidebar, and restore from Settings.
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Gammel tråd", archived: true });
  await page.getByRole("button", { name: "Arkiverte (1)" }).click();
  const row = page.locator(`.setting[data-archived="${thread.id}"]`);
  await row.getByText("Gammel tråd").waitFor();
  await row.getByRole("button", { name: "Gjenopprett" }).click();
  await waitFor(async () => (await row.count()) === 0, "borte fra listen");
  await page.getByText("Ingen arkiverte tråder.").waitFor();
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  // The chat is back in Chat's list (round 11: Kode's sidebar has its own Chatter).
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  await threadItem(page, thread.id).waitFor();
});
