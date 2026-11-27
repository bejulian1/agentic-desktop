// Round 13 (SPEC 27.1 and 27.2): a Kode turn that is easy to read, with the demo model going through
// every kind of step, and the tools of a chat: the menu by +, the choice per thread, web
// search with demo sources and a dimmed Nettsøk when the model cannot search. The demo model and a
// provider pointed at a closed local port only; no real search, page or provider is reached.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { flow, openProject, ROOT, send, toolShown, waitFor, type Harness } from "./harness.ts";

const SHOTS = path.join(ROOT, "docs/screenshots/runde13");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, name) });
// Moves that end: loops (spinners, the shimmer, a running dot) go on while something runs.
const settled = (page: Page) => waitFor(async () => (await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).length)) === 0, "bevegelsene er ferdige");

async function allSteps(h: Harness): Promise<void> {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await h.api("PATCH", "/api/settings", { autoOpenAgentThreads: false });
  await send(page, "vis alle steg");
}

async function finishTurn(page: Page): Promise<void> {
  await page.getByTestId("turn-summary").waitFor({ timeout: 60_000 });
  await waitFor(async () => (await page.getByTestId("now-line").count()) === 0, "nå-linjen er borte");
}

async function openChat(page: Page): Promise<void> {
  const button = page.locator(".sidebar .mode-button", { hasText: "Chat" });
  if (await button.count() && (await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await page.getByTestId("chat-tools-button").first().waitFor();
}

const toolMenu = (page: Page) => page.getByRole("menu", { name: "Verktøy" });
const toolItem = (page: Page, name: string) => toolMenu(page).getByRole("menuitemcheckbox", { name: new RegExp(`^${name}`) });

flow("Kode: stegtyper med ikon og verb, like steg samlet, nå-linjen, Venter på deg og oppsummeringen som åpner Endringer", async (h) => {
  const { page } = h;
  await allSteps(h);

  // While it runs: one line under the turn, shimmering, with the time, and the window says so too.
  const now = page.getByTestId("now-line");
  await now.locator(".now-label.shimmer").waitFor();
  await waitFor(async () => (await page.title()).startsWith("Jobber… · "), "vindustittelen sier Jobber…");
  assert.equal(await page.locator(".row-work").count(), 0, "overskriften kommer først når turen er ferdig");

  // Waiting for you: calm, no shimmer, in the line, on the step and in the window title.
  const card = page.locator(".approval-card");
  await card.waitFor({ timeout: 60_000 });
  await waitFor(async () => (await now.getAttribute("data-state")) === "waiting", "nå-linjen venter");
  assert.match((await now.textContent()) ?? "", /Venter på deg.*Oppretter \.env\.demo/);
  assert.equal(await now.locator(".shimmer").count(), 0);
  await page.locator('.row-tool[data-status="awaiting-approval"] .step-waiting', { hasText: "Venter på deg" }).waitFor();
  await waitFor(async () => (await page.title()).startsWith("Venter på deg · "), "vindustittelen sier Venter på deg");
  assert.equal(await page.locator(".thread-dot[data-state=\"waiting\"]").first().getAttribute("title"), "Venter på deg");
  await settled(page);
  await shot(page, "01-kode-venter-pa-deg.png");
  await card.getByRole("button", { name: "Tillat", exact: true }).click();

  await finishTurn(page);
  assert.equal(await page.title(), "vis alle steg");

  // Steps of the same kind in a row are one line, and it folds out.
  const created = page.locator('.row-run[data-kind="create"]');
  assert.equal(await created.locator(".steps-summary").textContent(), "Opprettet 3 filer");
  assert.match((await created.locator(".step-result").textContent()) ?? "", /^\+\d+$/);
  const read = page.locator('.row-run[data-kind="read"]');
  assert.equal(await read.locator(".steps-summary").textContent(), "Leste 3 filer");
  assert.equal(await read.locator('.row-tool[data-tool="read_file"]').count(), 0, "foldet til å begynne med");
  await read.locator(".run-head").click();
  await waitFor(async () => (await read.locator('.row-tool[data-tool="read_file"]').count()) === 3, "tre lesesteg");
  assert.match((await read.locator(".row-tool").first().innerText()).replace(/\s+/g, " "), /Leste demo\/app\.js \d+ linjer/);

  // Each kind has its verb, what it was about and a short result.
  const step = (kind: string, text: RegExp) => page.locator(`.row-tool[data-kind="${kind}"]`).filter({ hasText: text }).first();
  await step("search", /Søkte etter\s*function/).getByText("1 treff").waitFor();
  await step("web", /Søkte på nettet etter «hilsefunksjon i JavaScript»/).getByText("3 kilder").waitFor();
  await step("edit", /Endret\s*demo\/app\.js/).getByText("+2 −1").waitFor();
  await step("command", /Kjørte/).getByText("exit 0").waitFor();
  await step("delete", /Slettet\s*demo\/LESMEG\.md/).getByText(/^−\d+$/).waitFor();
  await step("create", /Opprettet\s*\.env\.demo/).waitFor();
  await step("team", /Startet underagenten/).waitFor();
  // The failed step says why without folding out, and its tag is calm.
  const failed = page.locator('.row-tool[data-status="error"]');
  assert.equal(await failed.locator(".step-tag.step-failed").textContent(), "Feilet");
  assert.match((await failed.locator(".step-note").textContent()) ?? "", /Filen finnes ikke: demo\/mangler\.txt/);
  // Every step has the icon of its kind.
  const kinds = await page.locator(".row-tool .step-icon[data-kind]").evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("data-kind")))].sort());
  for (const kind of ["command", "create", "delete", "edit", "read", "search", "team", "web"]) assert.ok(kinds.includes(kind), `${kind} har ikon: ${kinds.join(", ")}`);

  // The agent's text and the steps look different: smaller and quieter steps.
  const sizes = await page.evaluate(() => {
    const text = document.querySelector(".row-text p")!;
    const verb = document.querySelector(".row-tool .step-verb")!;
    return { text: parseFloat(getComputedStyle(text).fontSize), step: parseFloat(getComputedStyle(verb).fontSize), textColor: getComputedStyle(text).color, stepColor: getComputedStyle(verb).color };
  });
  assert.ok(sizes.step < sizes.text, JSON.stringify(sizes));
  assert.notEqual(sizes.stepColor, sizes.textColor);

  // The header folds the turn, and the summary opens Endringer on the turn's changes.
  await page.locator(".row-work").getByText(/^Jobbet i /).waitFor();
  const summary = page.getByTestId("turn-summary");
  assert.match((await summary.innerText()).replace(/\s+/g, " "), /^Ferdig på .+ · 3 filer endret · 1 kommando kjørt \+\d+ Endringer$/);
  await page.mouse.move(5, 5);
  await settled(page);
  await shot(page, "02-kode-tur-ferdig.png");
  await summary.locator(".summary-line").click();
  await toolShown(page, "Diff");
  await page.locator('[data-testid="diff-file"][data-path="demo/app.js"]').waitFor();

  // Narrow: the lines keep to one row each, and the summary keeps its words.
  await page.getByRole("button", { name: "Skjul panelet", exact: true }).first().click();
  await waitFor(async () => (await page.locator(".right-panel").count()) === 0, "panelet er lukket");
  await page.setViewportSize({ width: 720, height: 900 });
  await summary.scrollIntoViewIfNeeded();
  const overflow = await page.locator(".row-steps .step-head, .row-steps .run-head").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
  assert.equal(overflow, 0, "ingen steglinje går utenfor");
  await settled(page);
  await shot(page, "03-kode-smal.png");
}, { mockDelayMs: 25, viewport: { width: 1360, height: 1500 } });

flow("Kode i mørkt tema og en annen aksentfarge: stegene, Venter på deg og oppsummeringen", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { accent: "violet" });
  await allSteps(h);
  const card = page.locator(".approval-card");
  await card.waitFor({ timeout: 60_000 });
  await settled(page);
  await shot(page, "04-kode-mork-venter.png");
  await card.getByRole("button", { name: "Tillat", exact: true }).click();
  await finishTurn(page);
  await page.mouse.move(5, 5);
  await settled(page);
  await shot(page, "05-kode-mork-fiolett.png");
  // The summary's check mark and «Endringer» stay readable on the dark background.
  const contrast = await page.getByTestId("turn-summary").locator(".summary-open").evaluate((el) => getComputedStyle(el).color);
  assert.notEqual(contrast, "rgba(0, 0, 0, 0)");
}, { theme: "dark", mockDelayMs: 5, viewport: { width: 1360, height: 1500 } });

flow("Chat: verktøymenyen ved + og valg som gjelder per tråd, med standard fra Innstillinger → Chat", async (h) => {
  const { page } = h;
  h.allow(/status of 400/); // the search page without {q} below, which the server refuses on purpose
  await openChat(page);

  // The defaults: Artifacts and Minne on, Nettsøk and Les nettsider off. v0.22 added Lag filer (on)
  // and Python-analyse (off).
  assert.equal(await page.getByTestId("tool-chips").count(), 0, "ingen verktøybrikker i feltet");
  await page.getByTestId("chat-tools-button").click();
  assert.equal(await toolMenu(page).getByRole("menuitemcheckbox").count(), 6);
  assert.equal(await toolItem(page, "Lag filer").getAttribute("aria-checked"), "true");
  assert.equal(await toolItem(page, "Python-analyse").getAttribute("aria-checked"), "false");
  assert.equal(await toolItem(page, "Nettsøk").getAttribute("aria-checked"), "false");
  assert.equal(await toolItem(page, "Les nettsider").getAttribute("aria-checked"), "false");
  assert.equal(await toolItem(page, "Artifacts").getAttribute("aria-checked"), "true");
  assert.equal(await toolItem(page, "Minne").getAttribute("aria-checked"), "true");
  // The demo model can search: with demo sources, which the menu says.
  await toolItem(page, "Nettsøk").getByText("Demo-kilder, tydelig merket").waitFor();
  await toolItem(page, "Nettsøk").click();
  await waitFor(async () => (await toolItem(page, "Nettsøk").getAttribute("aria-checked")) === "true", "Nettsøk er på");
  await settled(page);
  await shot(page, "06-chat-verktoymeny.png");
  await page.keyboard.press("Escape");

  // The first message makes the chat with the tools chosen before it.
  await send(page, "hei");
  await page.locator(".row-text").first().waitFor();
  const first = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  assert.deepEqual((await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === first).chatTools, { web: true, fetch: false, artifacts: true, memory: true, documents: true, python: false });

  // The menu turns one off, for this chat only.
  await page.getByTestId("chat-tools-button").click();
  await toolItem(page, "Minne").click();
  await waitFor(async () => (await toolItem(page, "Minne").getAttribute("aria-checked")) === "false", "Minne er av");
  await page.keyboard.press("Escape");
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === first).chatTools?.memory === false, "lagret på tråden");

  // A new chat starts from the defaults again.
  await page.keyboard.press("Control+Alt+n");
  await page.getByTestId("chat-tools-button").click();
  assert.equal(await toolItem(page, "Nettsøk").getAttribute("aria-checked"), "false");
  assert.equal(await toolItem(page, "Minne").getAttribute("aria-checked"), "true");
  await page.keyboard.press("Escape");

  // Back in the first chat, its own choice.
  await page.locator(`[data-thread-item="${first}"]`).first().click();
  await page.getByTestId("chat-tools-button").click();
  await waitFor(async () => (await toolItem(page, "Nettsøk").getAttribute("aria-checked")) === "true" && (await toolItem(page, "Minne").getAttribute("aria-checked")) === "false", "trådens egne valg");

  // Innstillinger → Chat sets the defaults, and links to Nettleser for the unified search engine.
  await toolMenu(page).getByRole("button", { name: "Innstillinger → Chat" }).click();
  const settings = page.locator(".settings-section");
  await settings.getByRole("heading", { name: "Verktøy i nye chatter" }).waitFor();
  await settings.locator("label.setting", { hasText: "Les nettsider" }).getByRole("switch").check();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.chatTools?.fetch === true, "standard lagret");
  await settings.getByRole("button", { name: "Åpne Nettleser-innstillinger" }).click();
  await settings.getByRole("heading", { level: 1, name: "Nettleser" }).waitFor();
  await settings.getByRole("button", { name: "Søkemotor" }).click();
  await page.getByRole("menuitemradio", { name: "Egendefinert" }).click();
  const url = settings.getByLabel("Egendefinert søke-adresse", { exact: true });
  await url.fill("https://sok.example/sok");
  await url.press("Enter");
  await settings.getByRole("alert").getByText(/\{q\}/).waitFor();
  await url.fill("https://sok.example/sok?q={q}");
  await url.press("Enter");
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.webSearchUrl === "https://sok.example/sok?q={q}", "søkesiden lagret");
  assert.equal(await settings.getByRole("alert").count(), 0);
  await settled(page);
  await shot(page, "07-innstillinger-chat-verktoy.png");
});

flow("Chat: nettsøk med demo-kilder, «Søker på nettet…» med glimt, og kildene som kort", async (h) => {
  const { page } = h;
  await openChat(page);
  await page.getByTestId("chat-tools-button").click();
  await toolItem(page, "Nettsøk").click();
  await page.keyboard.press("Escape");
  await send(page, "søk på nettet etter nordlys over Tromsø");

  // While it searches: the step itself shimmers, since Chat has no now-line.
  const running = page.locator('.row-tool[data-tool="web_search"][data-status="running"] .step-text.shimmer');
  await running.waitFor();
  assert.match((await running.textContent()) ?? "", /^Søker på nettet etter «nordlys over Tromsø»…$/);

  const sources = page.getByTestId("sources");
  await sources.waitFor({ timeout: 20_000 });
  const cards = sources.locator(".source-card");
  assert.equal(await cards.count(), 3);
  // Demo sources say so, and are not links: they point nowhere.
  assert.equal(await sources.locator("a").count(), 0);
  assert.equal(await sources.locator(".source-demo", { hasText: "Demo" }).count(), 3);
  assert.match((await cards.first().innerText()).replace(/\s+/g, " "), /Demo: nordlys over Tromsø, kort forklart demo-kilde\.invalid/);
  await page.locator('.row-tool[data-tool="web_search"]').getByText("3 kilder").waitFor();
  await page.getByText("Jeg fant 3 kilder:").waitFor();
  await waitFor(async () => (await page.locator(".shimmer").count()) === 0, "ingen glimt etter søket");
  await page.mouse.move(5, 5);
  await settled(page);
  await shot(page, "08-chat-nettsok-demo.png");

  // Dark, and narrow: the cards wrap and keep their title.
  await page.emulateMedia({ colorScheme: "dark" });
  await h.api("PATCH", "/api/settings", { theme: "dark", accent: "green" });
  await page.setViewportSize({ width: 700, height: 860 });
  await settled(page);
  const widths = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  assert.ok(widths.every((right) => right <= 700), "kortene holder seg i vinduet");
  await shot(page, "09-chat-nettsok-mork-smal.png");
});

flow("Chat: Nettsøk er dempet med en forklaring når modellen ikke kan søke og ingen søkeside er satt opp", async (h) => {
  const { page } = h;
  // A provider on a closed local port: nothing is sent to it in this test.
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal", baseUrl: "http://127.0.0.1:9/v1" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal modell", model: "lokal", contextWindow: 32_000 });
  await h.api("PATCH", "/api/settings", { defaultModelId: model.id, chatTools: { web: true } });
  await openChat(page);

  // The composer stays free of tool chips, also when the default cannot be used.
  assert.equal(await page.getByTestId("tool-chips").count(), 0, "ingen verktøybrikker");
  await page.getByTestId("chat-tools-button").click();
  const web = toolItem(page, "Nettsøk");
  assert.equal(await web.getAttribute("aria-disabled"), "true");
  assert.equal(await web.getAttribute("aria-checked"), "false");
  await web.getByText("Lokal modell har ikke eget nettsøk, og ingen søkeside er satt opp i Innstillinger → Chat").waitFor();
  await web.dispatchEvent("click");
  assert.equal(await web.getAttribute("aria-checked"), "false", "et klikk gjør ingenting");
  await settled(page);
  await shot(page, "10-chat-nettsok-dempet.png");

  // With a search page set, the app's browser can search, and the switch wakes up.
  await h.api("PATCH", "/api/settings", { webSearchUrl: "http://127.0.0.1:9/sok?q={q}" });
  await waitFor(async () => (await web.getAttribute("aria-disabled")) === null, "Nettsøk kan slås på");
  await web.getByText("Appens nettleser søker på søkesiden din").waitFor();
});
