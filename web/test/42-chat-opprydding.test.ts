import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import type { ChatTools } from "../../shared/protocol.ts";
import { flow, type Harness, openProject, pane, send, threadItem, waitFor, watchErrors } from "./harness.ts";

const toolsMenu = (page: Page) => page.getByRole("menu", { name: "Verktøy", exact: true });
const tools = [
  ["web", "Nettsøk"], ["fetch", "Les nettsider"], ["artifacts", "Artifacts"], ["memory", "Minne"],
] as const;
const personality = (page: Page) => page.getByRole("radiogroup", { name: "Personlighet for aktiv chat", exact: true });
const idle = (page: Page) => waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "svaret er ferdig");
const storedThread = async (h: Harness, id: string) => (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === id);

async function openChatSettings(page: Page): Promise<void> {
  await page.getByTestId("chat-tools-button").click();
  await toolsMenu(page).getByRole("button", { name: "Innstillinger → Chat", exact: true }).click();
  await personality(page).waitFor();
}

async function assertTools(page: Page, expected: ChatTools): Promise<void> {
  for (const [id, label] of tools) {
    const item = toolsMenu(page).getByRole("menuitemcheckbox", { name: new RegExp(`^${label}`) });
    await waitFor(async () => (await item.getAttribute("aria-checked")) === String(expected[id]), `${label}: ${expected[id]}`);
  }
}

async function assertProjectsFirst(page: Page): Promise<void> {
  await page.locator('.sidebar [data-section="projects"]').waitFor();
  await page.locator('.sidebar [data-section="chats"]').waitFor();
  assert.deepEqual(await page.locator('.sidebar [data-section="projects"], .sidebar [data-section="chats"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-section"))), ["projects", "chats"]);
  const projects = await page.locator('.sidebar [data-section="projects"]').boundingBox();
  const chats = await page.locator('.sidebar [data-section="chats"]').boundingBox();
  assert.ok(projects && chats && projects.y < chats.y, "Prosjekter vises over Chatter");
}

flow("Chat-opprydding: Prosjekter før Chatter i tom og fylt sidefane, med fungerende + og løse chatter", async (h) => {
  const { page } = h;
  await assertProjectsFirst(page);
  await page.locator(".sidebar").getByText("Samle chatter i et prosjekt med +", { exact: true }).waitFor();
  assert.equal(await page.locator(".sidebar .thread-item").count(), 0);
  await page.getByRole("button", { name: "Nytt prosjekt i Chat", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nytt prosjekt i Chat", exact: true });
  await dialog.getByTestId("chat-project-name").fill("Planer");
  await dialog.getByRole("button", { name: "Lag prosjektet", exact: true }).click();
  const group = page.locator('.sidebar [data-chat-project="Planer"]');
  await group.waitFor();
  await assertProjectsFirst(page);
  assert.equal(await group.evaluate((el) => !!(el.compareDocumentPosition(document.querySelector('.sidebar [data-section="chats"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "prosjektraden ligger før Chatter");
  const project = (await h.api("GET", "/api/bootstrap")).chatProjects.find((p: any) => p.name === "Planer");
  assert.ok(project, "+ lagret Chat-prosjektet");
  await group.locator(".group-head").hover();
  await group.getByRole("button", { name: "Ny chat i Planer", exact: true }).click();
  await send(page, "prosjektsamtale",page.getByTestId("chat-project-page"));
  await page.locator(".row-text").first().waitFor();
  await idle(page);
  const projectThread = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  assert.equal((await storedThread(h, projectThread)).chatProjectId, project.id);
  await group.locator(`[data-thread-item="${projectThread}"]`).waitFor();

  await page.getByRole("button", { name: "Ny tråd i Chat", exact: true }).click();
  await send(page, "løs samtale");
  await page.locator(".row-text").first().waitFor();
  await idle(page);
  const loose = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  assert.equal((await storedThread(h, loose)).chatProjectId ?? null, null);
  assert.equal(await group.locator(`[data-thread-item="${loose}"]`).count(), 0);
  assert.equal(await threadItem(page, loose).evaluate((el) => !!(document.querySelector('.sidebar [data-section="chats"]')!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "løs chat ligger under Chatter");
  await threadItem(page, projectThread).click();
  await pane(page, projectThread).waitFor();
  await threadItem(page, loose).click();
  await pane(page, loose).waitFor();
  assert.equal(await threadItem(page, loose).getByRole("button", { name: "løs samtale", exact: true }).getAttribute("aria-current"), "true");
  await h.reload();
  await assertProjectsFirst(page);
});

flow("Chat-opprydding: én Verktøy-knapp uten brikker, alle brytere bevares per chat etter omlasting", async (h) => {
  const { page } = h;
  const untouched = await h.createThread(null);
  const before = await storedThread(h, untouched.id);
  assert.equal(await page.getByTestId("chat-tools-button").count(), 1);
  assert.equal(await page.getByTestId("personality-button").count(), 0);
  assert.equal(await page.getByTestId("tool-chips").count(), 0);
  assert.equal(await page.getByTestId("permission-button").count(), 0);
  const model = page.getByTestId("model-button");
  await model.getByText(/Demo-modell/).waitFor();
  assert.equal(await model.locator(".provider-glyph").count(), 0, "Chat-modellknappen viser modellnavnet uten leverandørmerke");
  await model.click();
  await page.getByRole("listbox", { name: "Modeller", exact: true }).getByRole("option", { name: /Demo-modell/ }).waitFor();
  await page.keyboard.press("Escape");

  const chosen: ChatTools = { web: true, fetch: true, artifacts: false, memory: false, documents: true, python: false };
  await page.getByTestId("chat-tools-button").click();
  assert.equal(await toolsMenu(page).getByRole("menuitemcheckbox").count(), 6);
  for (const [, label] of tools) await toolsMenu(page).getByRole("menuitemcheckbox", { name: new RegExp(`^${label}`) }).click();
  await assertTools(page, chosen);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByTestId("tool-chips").count(), 0, "aktiverte verktøy lager ingen brikker");
  await send(page, "lagre verktøyvalgene");
  await page.locator(".row-text").first().waitFor();
  await idle(page);
  const id = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  assert.deepEqual((await storedThread(h, id)).chatTools, chosen, "utkastets brytere følger første melding");
  await h.reload();
  await page.getByTestId("chat-tools-button").click();
  await assertTools(page, chosen);
  for (const [, label] of tools) await toolsMenu(page).getByRole("menuitemcheckbox", { name: new RegExp(`^${label}`) }).click();
  const defaults: ChatTools = { web: false, fetch: false, artifacts: true, memory: true, documents: true, python: false };
  await assertTools(page, defaults);
  await waitFor(async () => JSON.stringify((await storedThread(h, id)).chatTools) === JSON.stringify(defaults), "alle endringer lagres på eksisterende chat");
  await page.keyboard.press("Escape");
  await h.reload();
  await page.getByTestId("chat-tools-button").click();
  await assertTools(page, defaults);
  await page.keyboard.press("Escape");
  assert.deepEqual((await storedThread(h, untouched.id)).chatTools, before.chatTools, "andre chatter beholder verktøyvalgene");
  assert.equal(await page.getByTestId("personality-button").count(), 0);
  assert.equal(await page.getByTestId("tool-chips").count(), 0);
});

flow("Chat-opprydding: Personlighet i Innstillinger gjelder aktiv chat og utkast, med isolering og varig valg", async (h) => {
  const { page } = h;
  const other = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${other.id}`, { personality: "vennlig" });
  const codeProject = await h.createProject("Kodeisolering");
  const code = await h.createThread(codeProject.id);
  await h.api("PATCH", `/api/threads/${code.id}`, { personality: "lærer" });
  const originalSettings = (await h.api("GET", "/api/bootstrap")).settings;
  await openChatSettings(page);
  assert.equal(await personality(page).getByRole("radio").count(), 8, "alle personlighetstilene er tilgjengelige");
  await personality(page).getByRole("radio", { name: "Effektiv", exact: true }).click();
  assert.equal(await personality(page).getByRole("radio", { name: "Effektiv", exact: true }).isChecked(), true);
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, 2, "personlighet for et utkast oppretter ingen chat");
  await page.keyboard.press("Escape");
  await send(page, "min personlighet");
  await page.locator(".row-text").first().waitFor();
  await idle(page);
  const id = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  await waitFor(async () => (await storedThread(h, id)).personality === "effektiv", "utkastets personlighet følger første melding");
  await openChatSettings(page);
  await personality(page).getByRole("radio", { name: "Nerdete", exact: true }).click();
  await waitFor(async () => (await storedThread(h, id)).personality === "nerdete", "den aktive chatten oppdateres");
  await page.keyboard.press("Escape");
  await h.reload();
  await openChatSettings(page);
  assert.equal(await personality(page).getByRole("radio", { name: "Nerdete", exact: true }).isChecked(), true, "valget vises etter omlasting");
  await page.keyboard.press("Escape");
  await threadItem(page, other.id).click();
  await pane(page, other.id).waitFor();
  await openChatSettings(page);
  assert.equal(await personality(page).getByRole("radio", { name: "Vennlig", exact: true }).isChecked(), true, "Innstillinger følger chatten som er aktiv");
  await page.keyboard.press("Escape");
  assert.equal((await storedThread(h, other.id)).personality, "vennlig");
  assert.equal((await storedThread(h, code.id)).personality, "lærer", "Kode-tråden er uendret");
  assert.deepEqual((await h.api("GET", "/api/bootstrap")).settings, originalSettings, "ingen globale standarder endres");
});

flow("Chat-opprydding: mislykket personlighet beholder lagret valg og kan prøves på nytt", async (h) => {
  const { page } = h;
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { personality: "effektiv" });
  await threadItem(page, thread.id).click();
  await pane(page, thread.id).waitFor();
  h.allow(/status of 503/);
  let fails = true;
  await page.route(`**/api/threads/${thread.id}`, (route) => {
    const request = route.request();
    if (request.method() === "PATCH" && request.postDataJSON()?.personality && fails) {
      return route.fulfill({ status: 503, json: { error: "Personlighet kunne ikke lagres nå" } });
    }
    return route.continue();
  });
  await openChatSettings(page);
  await personality(page).getByRole("radio", { name: "Nerdete", exact: true }).click();
  await page.locator(".settings-section").getByRole("alert").getByText(/Personlighet kunne ikke lagres nå/).waitFor();
  assert.equal(await personality(page).getByRole("radio", { name: "Effektiv", exact: true }).isChecked(), true, "lagret valg vises etter feil");
  assert.equal(await personality(page).getByRole("radio", { name: "Nerdete", exact: true }).isChecked(), false, "mislykket valg er ikke markert");
  assert.equal((await storedThread(h, thread.id)).personality, "effektiv");
  fails = false;
  await personality(page).getByRole("radio", { name: "Nerdete", exact: true }).check();
  await waitFor(async () => (await storedThread(h, thread.id)).personality === "nerdete", "nytt forsøk lagres");
  assert.equal(await personality(page).getByRole("radio", { name: "Nerdete", exact: true }).isChecked(), true);
  assert.equal(await page.locator(".settings-section").getByRole("alert").count(), 0, "feilen fjernes etter vellykket lagring");
});

flow("Chat-opprydding: Kode beholder modellvalg, tillatelsesvalg og sidefanen sin", async (h) => {
  const { page } = h;
  await h.api("POST", "/api/chat-projects", { name: "Bare Chat" });
  const project = await openProject(h, "Kodeprosjekt");
  const thread = await h.createThread(project.id);
  await threadItem(page, thread.id).click();
  await pane(page, thread.id).waitFor();
  assert.equal(await page.getByTestId("chat-tools-button").count(), 0);
  assert.equal(await page.getByTestId("personality-button").count(), 0);
  await page.getByTestId("model-button").getByText("Demo-modell (uten API)", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("model-button").locator(".provider-glyph").count(), 0);
  await page.getByTestId("permission-button").getByText("Be om godkjenning", { exact: true }).waitFor();
  await page.getByTestId("permission-button").click();
  assert.equal(await page.getByRole("menu", { name: "Tillatelser", exact: true }).getByRole("menuitemradio").count(), 3);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('.sidebar [data-section="projects"]').count(), 0, "Kode får ingen Chat-prosjektseksjon");
  assert.equal(await page.locator('.sidebar [data-chat-project="Bare Chat"]').count(), 0);
  const heading = page.locator('.sidebar [data-section="chats"]');
  await heading.getByText("Chatter", { exact: true }).waitFor();
  assert.equal(await heading.getByRole("button").count(), 0, "Kode har fortsatt Chatter uten +");
  await page.locator('.sidebar [data-project="Kodeprosjekt"]').waitFor();
  const before = await storedThread(h, thread.id);
  await page.getByTestId("settings-gear").click();
  await page.locator(".settings-nav").getByRole("button", { name: "Chat", exact: true }).click();
  await personality(page).waitFor();
  assert.equal(await personality(page).getByRole("radio").count(), 8);
  for (const option of await personality(page).getByRole("radio").all()) assert.equal(await option.isDisabled(), true, "Chat-personlighet kan ikke endre aktiv Kode-tråd");
  assert.equal((await storedThread(h, thread.id)).personality, before.personality);
});

flow("Chat-opprydding: løsrevet chat åpner Innstillinger og lagrer sin egen personlighet", async (h) => {
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { personality: "effektiv" });
  const solo = await h.context.newPage();
  watchErrors(solo, h.errors);
  await solo.goto(`${h.origin}/?rute=${thread.id}`);
  await solo.locator(".app.solo").waitFor();
  await pane(solo, thread.id).waitFor();
  assert.equal(await solo.getByTestId("personality-button").count(), 0);
  assert.equal(await solo.getByTestId("tool-chips").count(), 0);
  await openChatSettings(solo);
  assert.equal(await personality(solo).getByRole("radio", { name: "Effektiv", exact: true }).isChecked(), true);
  await personality(solo).getByRole("radio", { name: "Vennlig", exact: true }).click();
  await waitFor(async () => (await storedThread(h, thread.id)).personality === "vennlig", "personlighet lagres fra den løsrevne chatten");
  await solo.keyboard.press("Escape");
  await solo.getByTestId("chat-tools-button").click();
  await toolsMenu(solo).waitFor();
  await solo.keyboard.press("Escape");
  await solo.reload();
  await openChatSettings(solo);
  assert.equal(await personality(solo).getByRole("radio", { name: "Vennlig", exact: true }).isChecked(), true, "løsrevet chat beholder personlighet etter omlasting");
  assert.deepEqual(await solo.evaluate(() => (window as any).__csp), []);
});
