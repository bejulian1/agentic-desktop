import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Settings, Thread } from "../../shared/protocol.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "../../server/test/fake-llm.ts";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

flow("Innstillinger finner innboksen og en flat liste setter festede tråder først", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Første prosjekt");
  const secondPath = path.join(h.projectDir, "second");
  mkdirSync(secondPath);
  const secondProject = await h.api("POST", "/api/projects", { name: "Andre prosjekt", path: secondPath });
  const pinned = await h.createThread(project.id);
  const second = await h.createThread(secondProject.id);
  await h.api("PATCH", `/api/threads/${pinned.id}`, { pinned: true });
  const inbox = page.getByTestId("sidebar-inbox");
  await page.locator('.group[data-project="Første prosjekt"]').waitFor();
  assert.equal(await inbox.count(), 0);

  await page.keyboard.press("Control+,");
  const search = page.getByLabel("Søk i innstillinger");
  await search.fill("innboks-liste");
  await page.locator(".search-result", { hasText: "Trådgruppering" }).click();
  const grouping = page.getByRole("group", { name: "Trådgruppering" });
  assert.equal(await grouping.getByRole("button", { name: "Etter prosjekt" }).getAttribute("aria-pressed"), "true");
  await grouping.getByRole("button", { name: "Innboks-liste" }).click();
  const inactivity = page.getByRole("button", { name: "Ferdigstill automatisk ved inaktivitet" });
  await inactivity.click();
  await page.getByRole("menuitemradio", { name: "7 dager", exact: true }).click();
  await page.getByRole("switch", { name: "Ferdigstill automatisk når tilknyttet GitHub-PR lukkes eller flettes" }).click();
  const wake = page.getByRole("switch", { name: "Vekk utsatte tråder ved ny aktivitet" });
  assert.equal(await wake.isChecked(), true);
  await wake.click();
  const read = async (): Promise<Settings> => (await h.api("GET", "/api/bootstrap")).settings;
  await waitFor(async () => {
    const settings = await read();
    return settings.sidebarGroupBy === "inbox" && settings.autoSettleAfterHours === 168 &&
      settings.autoSettleOnPrClose === true && settings.snoozeWakeOnActivity === false;
  }, "innstillinger for innboksen er lagret");
  await page.keyboard.press("Escape");
  await inbox.getByText("Første prosjekt", { exact: true }).waitFor();
  await inbox.getByText("Andre prosjekt", { exact: true }).waitFor();
  assert.deepEqual(await inbox.locator("[data-thread-item]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-thread-item"))), [pinned.id, second.id]);
});

flow("Jobber i Standard og Smart gir plass til en tråd som trenger svar", async (h, t) => {
  const { page } = h;
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Local", model: "test", contextWindow: 64_000 });
  const project = await openProject(h, "Prosjekt");
  const thread = await h.createThread(project.id);
  const url = `/api/threads/${thread.id}`;
  const questionGate = Promise.withResolvers<void>();
  t.after(() => questionGate.resolve());
  llm.reply(async (req, res) => {
    await questionGate.promise;
    await sse(openaiToolCall("ask_user", { questions: [{ id: "test", question: "Fortsette?" }] }, "question"))(req, res);
  });
  llm.reply(sse(openaiText("Ferdig")));
  await h.api("PATCH", url, { modelId: model.id, pinned: true });
  await h.api("POST", `${url}/messages`, { text: "Avklar planen" });
  await threadItem(page, thread.id).waitFor();
  await page.keyboard.press("Control+,");
  await page.getByLabel("Søk i innstillinger").fill("Skjul tråder");
  await page.locator(".search-result", { hasText: "Skjul tråder mens de jobber" }).click();
  await page.getByRole("switch", { name: "Skjul tråder mens de jobber" }).click();
  await page.keyboard.press("Escape");
  const standardFold = page.locator('[data-inbox-fold="working"]');
  const standardButton = standardFold.getByRole("button", { name: /Jobber 1/ });
  await standardButton.waitFor();
  await threadItem(page, thread.id).waitFor({ state: "detached" });
  await standardButton.click();
  await standardFold.locator(`[data-thread-item="${thread.id}"]`).waitFor();

  await h.api("PATCH", "/api/settings", { sidebarLayout: "smart", sidebarGroupBy: "inbox" });
  const smartFold = page.locator('.smart-group[data-group="working"]');
  const smartButton = smartFold.getByRole("button", { name: /Jobber 1/ });
  await smartButton.waitFor();
  assert.equal(await smartButton.getAttribute("aria-expanded"), "false");
  const card = page.getByTestId("sidebar-inbox").locator(`[data-smart-card="${thread.id}"]`);
  assert.equal(await card.count(), 0);
  await h.api("PATCH", "/api/settings", { hideWorkingThreads: false });
  await card.waitFor();
  await h.api("PATCH", "/api/settings", { hideWorkingThreads: true });
  await card.waitFor({ state: "detached" });
  questionGate.resolve();
  await card.locator('[data-state="waiting"]').waitFor();
  await smartFold.waitFor({ state: "detached" });
  const request = (await h.events(thread.id)).find(({ event }) => event.type === "question.requested")?.event;
  assert.equal(request?.type, "question.requested");
  await h.api("POST", `${url}/questions/${request.requestId}`, {
    runId: request.runId, answers: [{ questionId: "test", selectedOptions: [], text: "Ja" }],
  });
  await waitFor(async () => (await h.events(thread.id)).some(({ event }) => event.type === "run.finished"), "tråden er ferdig");
  await card.waitFor();
});

flow("Utsett fra hurtigtast og slash, og ferdigstill med Angre", async (h) => {
  const { page } = h;
  const thread = await h.createThread(null);
  const row = threadItem(page, thread.id);
  await row.locator(".thread-text").click();
  await page.getByTestId("topbar-title").getByText(thread.title, { exact: true }).waitFor();
  const read = async (): Promise<Thread> => (await h.api("GET", "/api/bootstrap")).threads.find((shown: Thread) => shown.id === thread.id);
  const localValue = (hours: number) => page.evaluate((offset) => {
    const date = new Date(Date.now() + offset * 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, hours);
  await page.keyboard.press("Control+Alt+Z");
  const dialog = page.getByRole("dialog", { name: "Velg tidspunkt for å vekke tråden" });
  const field = dialog.locator('input[type="datetime-local"]');
  await field.fill(await localValue(-2));
  await dialog.getByRole("button", { name: "Utsett" }).click();
  assert.equal(await field.evaluate((input: HTMLInputElement) => input.validity.customError), true);
  const chosen = await localValue(2);
  await field.fill(chosen);
  await dialog.getByRole("button", { name: "Utsett" }).click();
  const custom = await page.evaluate((value) => new Date(value).getTime(), chosen);
  await waitFor(async () => (await read()).snoozedUntil === custom, "egendefinert tidspunkt er lagret");
  await row.waitFor({ state: "detached" });
  const fold = page.locator('[data-inbox-fold="snoozed"]');
  await fold.getByRole("button", { name: /Utsatt 1/ }).click();
  await row.getByRole("button", { name: /Hent tilbake/ }).click();
  await waitFor(async () => (await read()).snoozedUntil === null, "tråden er hentet tilbake");

  for (const [command, expected] of [["/snooze 3h", 3], ["/utsett tomorrow", "tomorrow"], ["/snooze week", "week"]] as const) {
    const target = await page.evaluate((preset) => {
      const now = new Date();
      if (typeof preset === "number") return now.getTime() + preset * 3_600_000;
      now.setDate(now.getDate() + (preset === "tomorrow" ? 1 : ((8 - now.getDay()) % 7 || 7)));
      now.setHours(9, 0, 0, 0);
      return now.getTime();
    }, expected);
    await send(page, command);
    await waitFor(async () => Math.abs(((await read()).snoozedUntil ?? 0) - target) < 5_000, "riktig tidsvalg er lagret");
  }
  await send(page, "/snooze off");
  await waitFor(async () => (await read()).snoozedUntil === null, "slash henter tråden tilbake");
  await send(page, "/settle");
  await waitFor(async () => (await read()).archived, "tråden er arkivert");
  await page.getByRole("button", { name: "Angre", exact: true }).click();
  await waitFor(async () => !(await read()).archived, "Angre gjenoppretter tråden");
});
