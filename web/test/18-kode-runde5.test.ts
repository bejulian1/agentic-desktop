// Round 5, agent A (SPEC 16.1): the goal line, the placeholder, images, the run header with grouped
// steps, the edited files card, the permission and model menus, the timeline map, subagents and
// the pinned summary. All with the demo model in headless Chrome.
import assert from "node:assert/strict";
import { approveUntil, flow, openProject, send, waitFor } from "./harness.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });

flow("mål-linjen med tid, pause, redigering og sletting, og plassholderen i Kode", async (h) => {
  const { page } = h;
  await openProject(h);
  const hint = page.getByTestId("composer-hint");
  await hint.waitFor();
  // The three helpers and what they do (round 9, SPEC 21.1).
  for (const part of ["Spør om hva som helst", "kommandoer", "filer", "skills"]) assert.match(await hint.textContent() ?? "", new RegExp(part));
  await page.getByLabel("Melding").fill("hei");
  await waitFor(async () => (await hint.count()) === 0, "plassholderen forsvinner når du skriver");
  await page.getByLabel("Melding").fill("");
  await hint.waitFor();

  await send(page, "/goal Lag en kalkulator");
  const goal = page.getByTestId("goal-composer");
  await goal.getByText("Lag en kalkulator").waitFor();
  await goal.getByTestId("goal-time").waitFor();
  await waitFor(async () => /^[12]s$/.test((await goal.getByTestId("goal-time").textContent()) ?? ""), "tiden går");

  await goal.getByRole("button", { name: "Sett på pause" }).click();
  await goal.getByRole("button", { name: "Gjenoppta mål" }).waitFor();
  const paused = await goal.getByTestId("goal-time").textContent();
  await page.waitForTimeout(1300);
  assert.equal(await goal.getByTestId("goal-time").textContent(), paused, "tiden står stille på pause");
  const threadId = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
  const stored = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === threadId);
  assert.ok(stored.goalPausedAt !== null, "pausen er lagret på serveren");

  await goal.getByRole("button", { name: "Rediger mål" }).click();
  await goal.getByLabel("Mål", { exact: true }).fill("Lag en vitenskapelig kalkulator");
  await goal.getByLabel("Mål", { exact: true }).press("Enter");
  await goal.getByText("Lag en vitenskapelig kalkulator").waitFor();

  // The pinned summary shows the same, with its sections.
  await page.getByTestId("pinned-summary").click();
  await page.getByRole("dialog", { name: "Festet sammendrag", exact: true }).locator("summary").click();
  await page.getByTestId("goal-pinned").getByText("Lag en vitenskapelig kalkulator").waitFor();
  for (const id of ["pinned-results", "pinned-sources"]) await page.getByTestId(id).waitFor();

  await goal.getByRole("button", { name: "Gjenoppta mål" }).click();
  await goal.getByRole("button", { name: "Sett på pause" }).waitFor();
  await goal.getByRole("button", { name: "Slett mål" }).click();
  await waitFor(async () => (await page.getByTestId("goal-composer").count()) === 0, "målet er borte");
});

flow("bilder som miniatyrer, og maks 20 vedlegg", async (h) => {
  const { page } = h;
  await openProject(h);
  const input = page.getByTestId("image-input");
  await input.setInputFiles([png("en.png"), png("to.png")]);
  await waitFor(async () => (await page.getByTestId("image-chip").count()) === 2, "to bilder i feltet");
  await send(page, "Hva ser du på bildene?");
  const images = page.getByTestId("user-images").locator("img");
  await waitFor(async () => (await images.count()) === 2, "to miniatyrer i meldingen");
  await waitFor(async () => (await images.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)), "bildet er lastet");
  await page.getByText("Jeg er demo-modellen").first().waitFor();

  // The limit: 20, with a message in the field and a toast when you try for more.
  await input.setInputFiles(Array.from({ length: 20 }, (_, i) => png(`b${i}.png`)));
  await waitFor(async () => (await page.getByTestId("image-chip").count()) === 20, "20 bilder");
  await page.getByTestId("attach-limit").getByText("maks 20").waitFor();
  await input.setInputFiles([png("en-for-mye.png")]);
  await page.locator(".toast", { hasText: "maks 20" }).first().waitFor();
  assert.equal(await page.getByTestId("image-chip").count(), 20);
  await page.locator(".composer-foot").getByRole("button", { name: "Legg ved" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Bilder", exact: true }).isDisabled(), true, "knappen er av ved grensen");
});

flow("Jobbet i, grupperte steg, redigerte filer-kortet, og tillatelses- og modellmenyen", async (h) => {
  const { page } = h;
  const project = await openProject(h);

  await page.getByTestId("model-button").click();
  const menu = page.getByTestId("model-permissions");
  assert.equal(await menu.getByRole("radio").count(), 3);
  await menu.getByRole("radio", { name: "Be om godkjenning", checked: true }).waitFor();
  await menu.getByRole("radio", { name: "Full tilgang" }).click();
  await menu.getByRole("radio", { name: "Full tilgang", checked: true }).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.id === project.id).permissionMode, "full");
  await page.keyboard.press("Escape");

  await send(page, "lag en side");
  await page.getByText("Ferdig. ").waitFor({ timeout: 30_000 });
  const work = page.locator(".row-work").last();
  await work.getByText(/Jobbet i (\d+s|under ett sekund)/).waitFor();
  const summary = await page.locator(".steps-summary").allTextContents();
  assert.ok(summary.some((s) => /Redigerte 1 fil|kjørte \d kommando|Leste en mappe|Brukte nettleseren/i.test(s)), summary.join(" | "));
  await page.locator(".step .step-time").first().waitFor();

  // Edited files: totals, Vis endringer and Angre.
  const card = page.getByTestId("changes-card").last();
  await card.getByText("Endret 1 fil").waitFor();
  await card.getByText("index.html").waitFor();
  await card.getByRole("button", { name: "Vis endringer" }).click();
  await page.locator('[data-testid="diff-file"][data-path="index.html"]').waitFor();

  // Folding the run hides the steps and keeps the last answer.
  const steps = await page.locator(".row-steps").count();
  assert.ok(steps > 0);
  await work.locator(".work-head").click();
  await waitFor(async () => (await page.locator(".row-steps").count()) === 0, "stegene er foldet bort");
  await page.getByText("Ferdig. ").waitFor();
  await work.locator(".work-head").click();
  await waitFor(async () => (await page.locator(".row-steps").count()) === steps, "stegene er tilbake");

  await card.getByRole("button", { name: /Angre/ }).click();
  await card.locator(".changes-reverted").waitFor();

  // After a reload, an old run starts folded, with the answer in view.
  await h.reload();
  await page.locator(".row-work").first().getByText(/Jobbet i/).waitFor();
  assert.equal(await page.locator(".row-steps").count(), 0, "gamle kjøringer starter foldet");
  await page.getByText("Ferdig. ").waitFor();

  // Model and supported effort levels share the same menu.
  await page.getByTestId("model-button").click();
  await page.getByRole("option", { name: /Demo-modell/, selected: true }).waitFor();
  const effort = page.getByTestId("model-effort");
  await effort.getByRole("radio", { name: "Lav", exact: true }).click();
  await page.getByTestId("model-button-effort").getByText("Lav").waitFor();
  await effort.getByRole("radio", { name: "Maks", exact: true }).click();
  await effort.getByRole("radio", { name: "Maks", checked: true, exact: true }).waitFor();
  const threadId = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === threadId).reasoning === "max", "innsatsen er lagret");
});

flow("innstillingene for tenkesammendrag og skallutdata brukes i samtalen", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { thinkingSummary: false, expandShell: true });
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await send(page, "!echo skall-er-utvidet");
  await page.locator('.row-tool[data-tool="run_command"] .tool-output', { hasText: "skall-er-utvidet" }).waitFor();

  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await send(page, "hei");
  const thinking = page.locator(".row-thinking").first();
  await thinking.getByText(/Tenkte/).waitFor();
  assert.equal(await thinking.locator("button").isDisabled(), true, "tenkningen kan ikke foldes ut");

  await h.api("PATCH", "/api/settings", { thinkingSummary: true });
  await waitFor(async () => !(await thinking.locator("button").isDisabled()), "på igjen");
  await thinking.locator("button").click();
  await page.locator(".thinking-text").first().waitFor();
});

flow("tidslinjen: én strek per spørsmål og svar, kort ved hover og hopp ved klikk", async (h) => {
  const { page } = h;
  await openProject(h);
  for (const [i, text] of ["første spørsmål om noe", "andre spørsmål", "tredje spørsmål"].entries()) {
    await send(page, text);
    // The question shows before the run starts, so wait for its answer too, not only for no run.
    await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0 && (await page.locator(".user-text", { hasText: text }).count()) === 1 && (await page.locator(".row-text").count()) >= i + 1, "svaret er ferdig");
  }
  const map = page.getByTestId("minimap");
  await map.waitFor();
  // Round 9 (SPEC 21.5): a mark for each question and for each answer, the answers shorter.
  const ticks = map.locator('.minimap-tick[data-kind="user"]');
  assert.equal(await ticks.count(), 3);
  assert.equal(await map.locator('.minimap-tick[data-kind="answer"]').count(), 3);
  await waitFor(async () => (await ticks.nth(2).getAttribute("aria-current")) === "true", "den siste er den du ser");
  await ticks.first().hover();
  await page.getByTestId("minimap-card").getByText("første spørsmål om noe").waitFor();
  await ticks.first().click();
  await waitFor(async () => (await ticks.first().getAttribute("aria-current")) === "true", "hoppet til den første");
  const top = await page.locator(".user-text", { hasText: "første spørsmål om noe" }).boundingBox();
  const scroller = await page.getByTestId("scroller").boundingBox();
  assert.ok(top && scroller && top.y >= scroller.y - 1 && top.y < scroller.y + scroller.height / 2, "meldingen står øverst");

  // Narrow: no map.
  await page.setViewportSize({ width: 480, height: 800 });
  await waitFor(async () => !(await map.isVisible()), "skjult i en smal rute");
});

flow("underagenter som ett kort med status og rader som åpner tråden", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await send(page, "samarbeid om en oversikt");
  const card = page.getByTestId("agents-card").first();
  await card.getByText("1 underagent").waitFor({ timeout: 30_000 });
  await approveUntil(page, async () => (await page.getByText("Samarbeidet er ferdig").count()) > 0, "samarbeidet er ferdig");
  await card.getByText("1 ferdig").waitFor();
  // With several panes only the focused one has the pinned summary (round 8): focus the parent's.
  const parent = page.locator(".pane-inner", { has: card });
  await parent.locator(".pane-head").click();
  await page.getByTestId("pinned-summary").click();
  await page.getByTestId("pinned-agents").getByText("1 ferdig", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await card.locator(".agent-row").click();
  await page.locator(".pane-title", { hasText: "Hjelpetråd" }).first().waitFor();
});

flow("handlinger under en melding: kopier, forgrening herfra, kapittel og tid", async (h) => {
  const { page } = h;
  // Message actions and chapter pins remain available in Chat, without a timeline.
  for (const text of ["første spørsmål", "andre spørsmål", "tredje spørsmål"]) {
    await send(page, text);
    await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0 && (await page.locator(".user-text", { hasText: text }).count()) === 1, "svaret er ferdig");
  }
  const first = page.locator(".row-user", { hasText: "første spørsmål" });
  const actions = first.locator(".msg-actions");
  assert.equal(await actions.evaluate((el) => getComputedStyle(el).opacity), "0", "skjult til du holder over");
  await first.hover();
  await waitFor(async () => (await actions.evaluate((el) => getComputedStyle(el).opacity)) === "1", "vises ved hover");

  // The time, short, with the full date on hover.
  const time = actions.locator("time");
  assert.match(await time.textContent() ?? "", /^\d\d[:.]\d\d$/);
  assert.match(await time.getAttribute("title") ?? "", /\d{4} kl\. \d\d[:.]\d\d[:.]\d\d$/);

  // Kopier, also reached with the keyboard.
  await actions.getByRole("button", { name: "Kopier" }).focus();
  await page.keyboard.press("Enter");
  await actions.getByText("Kopiert").waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "første spørsmål");
  const answer = page.locator(".msg", { has: page.locator(".row-text") }).first();
  await answer.hover();
  await answer.locator(".msg-actions").getByRole("button", { name: "Kopier" }).click();
  await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())).includes("demo-modellen"), "svaret som Markdown");

  // Fest som kapittel: named, shown above the message, in the map and in the pinned summary.
  await first.hover();
  await actions.getByRole("button", { name: "Fest som kapittel" }).click();
  const dialog = page.getByRole("dialog", { name: "Fest som kapittel" });
  assert.equal(await dialog.locator("input").inputValue(), "første spørsmål", "forhåndsutfylt med starten av meldingen");
  await dialog.locator("input").fill("Oppstart");
  await dialog.getByRole("button", { name: "Fest" }).click();
  await first.getByTestId("chapter-mark").getByText("Oppstart").waitFor();
  assert.equal(await page.getByTestId("minimap").count(), 0, "Chat har ingen tidslinje");
  // Chat has no pinned summary (round 8, P1-2); in Kode the chapters are listed there.
  assert.equal(await page.getByTestId("pinned-summary").count(), 0);
  await first.hover();
  await actions.getByRole("button", { name: "Fjern kapittel" }).click();
  await waitFor(async () => (await page.getByTestId("chapter-mark").count()) === 0, "kapittelet er fjernet");

  // Gaffel herfra (round 14 name): a new thread with the conversation up to that message.
  const source = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
  await first.hover();
  await actions.getByRole("button", { name: "Gaffel herfra" }).click();
  await waitFor(async () => (await page.locator(".pane-inner.focused").getAttribute("data-thread-id")) !== source, "den nye tråden er åpnet");
  await page.locator(".pane-inner.focused .user-text", { hasText: "første spørsmål" }).waitFor();
  assert.equal(await page.locator(".pane-inner.focused .user-text", { hasText: "andre spørsmål" }).count(), 0, "bare fram til meldingen");
});

flow("én kommando som kjører har bare sin egen rad, uten bakgrunnsboks, og stopper med Stopp", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await send(page, "lang kommando");
  // Round 8: the row with its spinner and last line is enough for one command (critique P1-3).
  await page.locator('.row-tool[data-tool="run_command"][data-status="running"]').waitFor();
  await page.locator(".tool-tail", { hasText: "Steg 1" }).waitFor();
  assert.equal(await page.getByTestId("background-box").count(), 0, "ingen boks i tillegg");
  await page.locator(".pane-inner.focused .composer").getByRole("button", { name: "Stopp", exact: true }).click();
  await page.locator(".row-line", { hasText: "Stoppet" }).waitFor();
  await page.locator(".row-work").getByText(/Jobbet i/).waitFor();
});
