import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import type { Bootstrap } from "../../shared/protocol.ts";
import { httpError, startFakeLlm } from "../../server/test/fake-llm.ts";
import { flow, send, threadItem, waitFor } from "./harness.ts";

const firstRun = { firstRun: true };
const welcome = (page: Page) => page.getByRole("heading", { name: "Velkommen til Agentic Desktop", exact: true });

async function openFromSettings(page: Page, row: string) {
  await page.getByTestId("settings-gear").click();
  await page.locator(".settings-nav").getByRole("button", { name: "Generelt", exact: true }).click();
  await page.locator(".setting").filter({ has: page.getByText(row, { exact: true }) }).getByRole("button", { name: "Åpne", exact: true }).click();
}

function claudeSession(home: string, project: string, id: string, question: string, answer: string) {
  const target = path.join(home, ".claude/projects/encoded");
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, `${id}.jsonl`), [
    { type: "user", cwd: project, sessionId: id, timestamp: "2025-06-01T10:00:00Z", message: { role: "user", content: question } },
    { type: "assistant", cwd: project, sessionId: id, timestamp: "2025-06-01T10:00:01Z", message: { role: "assistant", content: [{ type: "text", text: answer }] } },
    { type: "assistant", cwd: project, sessionId: id, timestamp: "2025-06-01T10:00:02Z", message: { role: "assistant", content: [
      { type: "tool_use", id: "example-call", name: "Read", input: { file_path: "guide.md" } },
    ] } },
  ].map((line) => JSON.stringify(line)).join("\n"));
}

flow("first run offers language and demo, saves Skip, and can be reopened in Settings", async (h) => {
  const { page } = h;
  let scans = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/history-import/scan")) scans++; });
  await welcome(page).waitFor();
  await page.getByRole("button", { name: "Standardmodell", exact: true }).getByText("Prøv uten API-nøkkel").waitFor();
  await page.getByRole("button", { name: "Språk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome to Agentic Desktop" }).waitFor();
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /Norsk/ }).click();
  await welcome(page).waitFor();
  await page.getByRole("button", { name: "Hopp over", exact: true }).click();
  await welcome(page).waitFor({ state: "hidden" });
  assert.equal((await h.api<Bootstrap>("GET", "/api/bootstrap")).settings.welcomeDone, true);
  await h.reload();
  await page.getByTestId("settings-gear").waitFor();
  assert.equal(await welcome(page).count(), 0);
  await openFromSettings(page, "Velkomstskjerm");
  await welcome(page).waitFor();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await welcome(page).waitFor({ state: "hidden" });
  assert.equal(scans, 0);
}, firstRun);

flow("an existing provider suppresses onboarding without the welcome flag", async (h, context) => {
  const llm = await startFakeLlm(context);
  await welcome(h.page).waitFor();
  await h.api("POST", "/api/providers", { preset: "custom-local", name: "Lokal testserver", baseUrl: llm.url });
  assert.equal((await h.api<Bootstrap>("GET", "/api/bootstrap")).settings.welcomeDone, undefined);
  await h.reload();
  await h.page.getByTestId("settings-gear").waitFor();
  assert.equal(await welcome(h.page).count(), 0);
}, firstRun);

flow("an existing thread suppresses onboarding without a configured provider", async (h) => {
  await welcome(h.page).waitFor();
  await h.createThread(null);
  const boot = await h.api<Bootstrap>("GET", "/api/bootstrap");
  assert.equal(boot.providers.length, 1);
  assert.equal(boot.settings.welcomeDone, undefined);
  await h.reload();
  await h.page.getByTestId("settings-gear").waitFor();
  assert.equal(await welcome(h.page).count(), 0);
}, firstRun);

flow("welcome reuses provider setup and the configured local model is available to select", async (h, context) => {
  const { page } = h;
  const llm = await startFakeLlm(context);
  await page.route("**/api/providers/local/detect", (route) => route.fulfill({ json: [{ presetId: "vllm", modelCount: 1 }] }));
  await welcome(page).waitFor();
  await page.getByRole("button", { name: "Finn lokale servere" }).click();
  await page.locator(".welcome-window .setting").filter({ hasText: "127.0.0.1:8000" }).getByText("Klar", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Legg til leverandør", exact: true }).click();
  const catalog = page.getByRole("list", { name: "Leverandører i katalogen" });
  await catalog.waitFor();
  await page.getByRole("button", { name: "Legg til leverandør", exact: true }).click();
  await catalog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Koble til vLLM" }).click();
  const connect = page.getByRole("region", { name: "Koble til vLLM" });
  await connect.getByLabel("API-adresse").fill(llm.url);
  await connect.getByLabel(/API-nøkkel/).fill("fake-local-history-key");
  llm.reply(httpError(200, { data: [{ id: "test-history-model", supports_tools: false }] }));
  await connect.getByRole("button", { name: "Fortsett" }).click();
  await connect.getByRole("checkbox", { name: /test-history-model/ }).check();
  await connect.getByRole("button", { name: "Legg til valgte (1)" }).click();
  const standard = page.getByRole("button", { name: "Standardmodell", exact: true });
  await standard.getByText(/test-history-model/).waitFor();
  await standard.click();
  await page.getByRole("menuitemradio", { name: "Prøv uten API-nøkkel" }).click();
  assert.equal((await h.api<Bootstrap>("GET", "/api/bootstrap")).settings.defaultModelId, "mock-demo");
  assert.equal(llm.requests[0].headers.authorization, "Bearer fake-local-history-key");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await welcome(page).waitFor({ state: "hidden" });
}, firstRun);

flow("review selects projects and threads, and imported conversations continue with the demo model", async (h) => {
  const { page, home, projectDir } = h;
  const another = path.join(home, "other-project");
  mkdirSync(another);
  claudeSession(home, projectDir, "selected-thread", "Vis arbeidsplanen", "Her er den opprinnelige planen.");
  claudeSession(home, projectDir, "unselected-thread", "Forklar testen", "Denne tråden blir ikke valgt.");
  claudeSession(home, another, "unselected-project", "En annen mappe", "Denne mappen blir ikke valgt.");
  await welcome(page).waitFor();
  await page.getByRole("button", { name: "Søk etter samtaler" }).click();
  await page.getByRole("button", { name: "Se alle 3" }).click();
  const all = page.getByRole("checkbox", { name: "Velg alle tråder" });
  await all.uncheck();
  assert.equal(await page.getByRole("checkbox", { name: "Vis arbeidsplanen" }).isChecked(), false);
  const project = page.getByRole("checkbox", { name: `Velg prosjektet ${projectDir}`, exact: true });
  await project.check();
  await page.getByRole("checkbox", { name: "Forklar testen" }).uncheck();
  assert.equal(await project.evaluate((input: HTMLInputElement) => input.indeterminate), true);
  assert.equal(await all.evaluate((input: HTMLInputElement) => input.indeterminate), true);
  await page.getByRole("button", { name: "Skjul tråder" }).click();
  await page.getByRole("button", { name: "Se alle 3" }).click();
  assert.ok(await page.getByRole("checkbox", { name: "Vis arbeidsplanen" }).isChecked());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/history-import", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Importer 1 prosjekt og start" }).click();
  try { await page.getByRole("progressbar", { name: "Importerer samtaler" }).waitFor(); }
  finally { release(); }
  await welcome(page).waitFor({ state: "hidden" });
  await page.locator(".toast").getByText(/Tråder importert: 1/).waitFor();
  const boot = await h.api<Bootstrap>("GET", "/api/bootstrap");
  assert.equal(boot.projects.length, 1);
  assert.equal(boot.threads.length, 1);
  const [thread] = boot.threads;
  const item = threadItem(page, thread.id);
  await item.click();
  await page.getByTestId("import-origin").getByText(/Importert fra Claude Code/).waitFor();
  await page.locator(".row-text").getByText("Her er den opprinnelige planen.").waitFor();
  await page.locator(".imported-tool-note").getByText("Verktøykall · Read · guide.md").waitFor();
  assert.equal(await page.locator(".row-tool").count(), 0);
  await send(page, "hjelp");
  await waitFor(async () => (await h.events(thread.id)).some(({ event }) => event.type === "run.finished" && event.status === "done"), "den importerte tråden fikk et demomodellsvar");
}, firstRun);

flow("Settings can open import on its own, show totals, and review an already imported thread", async (h) => {
  const { page, home, projectDir } = h;
  claudeSession(home, projectDir, "settings-thread", "Historikk fra innstillinger", "Et tidligere svar.");
  await openFromSettings(page, "Importer fra andre kodeapper");
  await page.getByRole("heading", { name: "Importer fra andre kodeapper" }).waitFor();
  assert.equal(await page.locator(".welcome-window").getByRole("button", { name: "Språk", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Søk etter samtaler" }).click();
  await page.getByRole("button", { name: "Importer 1 prosjekt", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /Tråder importert: 1/ }).waitFor();
  await page.getByRole("button", { name: "Søk på nytt" }).click();
  await page.getByRole("button", { name: "Se alle 1" }).click();
  await page.getByText("Allerede importert", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Lukk", exact: true }).click();
  await page.getByRole("heading", { name: "Generelt", exact: true }).waitFor();
  assert.equal((await h.api<Bootstrap>("GET", "/api/bootstrap")).threads.length, 1);
});
