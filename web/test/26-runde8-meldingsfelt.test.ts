// Runde 8, UI-retter 1: Kode-startsiden med prosjekter (SPEC 20), prosjektvelgeren, og rettelsene
// fra kritikken og QA i meldingsfeltet og samtalen. Alt med demo-modellen eller en lokal
// testserver, i headless Chrome.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { approveUntil, flow, openProject, send, waitFor, type Harness } from "./harness.ts";

const idle = (page: Page) => waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");
const focused = (page: Page) => page.locator(".pane-inner.focused");

// Projects in folders of their own, used in order, so the newest is the last one made.
async function makeProjects(h: Harness, names: string[]): Promise<{ root: string; cleanup: () => void }> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-ui-projects-")));
  for (const name of names) {
    const dir = path.join(root, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    mkdirSync(dir, { recursive: true });
    await h.api("POST", "/api/projects", { name, path: dir });
    await new Promise((resolve) => setTimeout(resolve, 15)); // lastUsedAt in order
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// A local stand-in for an OpenAI-compatible provider, made the default model.
async function fakeProvider(h: Harness, handle: (count: number, res: http.ServerResponse) => void): Promise<() => Promise<void>> {
  let count = 0;
  const llm = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => handle(++count, res));
  });
  await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `http://127.0.0.1:${(llm.address() as AddressInfo).port}/v1`, apiKey: "test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  await h.api("PATCH", "/api/settings", { defaultModelId: model.id });
  await h.reload();
  return async () => {
    llm.closeAllConnections();
    await new Promise((resolve) => llm.close(resolve));
  };
}

function streamText(res: http.ServerResponse, text: string): void {
  const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(chunk({ role: "assistant", content: text }) + chunk({}, "stop") + "data: [DONE]\n\n");
}

flow("Kode uten prosjekter: bare hilsenen, ingen statistikk, og ⋯ → Legg til prosjekt åpner oppretting", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Kode", exact: true }).click();
  await page.getByTestId("pane-empty").locator(".home-title", { hasText: "Hva skal vi bygge?" }).waitFor();
  assert.equal(await page.getByTestId("stats-card").count(), 0, "ingen statistikk");
  // Prosjektkort is chosen, but with no projects the greeting stays (SPEC 21.1).
  await h.api("PATCH", "/api/settings", { codeStartEmpty: "cards" });
  await page.waitForTimeout(100);
  assert.equal(await page.getByTestId("project-card").count(), 0);
  assert.equal(await page.getByText("Kode jobber i en mappe").count(), 0);
  await page.getByTestId("sidebar-menu").click();
  await page.getByRole("menuitem", { name: "Legg til prosjekt…" }).click();
  await page.getByRole("dialog", { name: "Opprett prosjekt", exact: true }).waitFor();
});

flow("Kode-startsiden: Prosjektboks med de fire sist brukte prosjektene, og teksten blir med", async (h) => {
  const { page } = h;
  const { cleanup } = await makeProjects(h, ["Alfa", "Beta", "Gamma", "Delta", "Et svært langt prosjektnavn som ikke får plass på kortet i det hele tatt"]);
  try {
    // Round 11b (SPEC 25.2): the old «Prosjektkort» moves over to Prosjektboks.
    await h.api("PATCH", "/api/settings", { codeStartEmpty: "cards" });
    await h.reload();
    await page.getByRole("button", { name: "Kode", exact: true }).click();
    const start = page.getByTestId("home-projects");
    const rows = start.getByTestId("home-project-row");
    await rows.first().waitFor();
    assert.equal(await rows.count(), 4, "opptil fire rader");
    const names = await rows.locator(".home-card-title").allTextContents();
    assert.deepEqual(names.slice(1), ["Delta", "Gamma", "Beta"], "sist brukt først");
    assert.match(names[0], /^Et svært langt/);
    // The long name is cut with an ellipsis, inside the row.
    const long = rows.first().locator(".home-card-title");
    assert.ok(await long.evaluate((el) => el.scrollWidth > el.clientWidth), "langt navn blir kuttet");
    const row = (await rows.first().boundingBox())!;
    const nameBox = (await long.boundingBox())!;
    assert.ok(nameBox.x + nameBox.width <= row.x + row.width, "navnet holder seg inne i raden");
    // Path and time on every row.
    assert.match((await rows.nth(1).locator(".home-box-path").textContent()) ?? "", /delta$/);
    assert.match((await rows.nth(1).locator(".home-card-detail").textContent()) ?? "", /^\d{2}:\d{2}$/);
    await start.getByRole("button", { name: "Vis alle (5)" }).waitFor();
    await start.getByTestId("env-picker").waitFor();

    // Text typed before a project is chosen follows into it.
    await page.locator(".pane-inner.focused").getByLabel("Melding").fill("forklar koden");
    await rows.nth(2).click();
    await page.locator(".home-title", { hasText: "Hva skal vi jobbe med i Gamma?" }).waitFor();
    assert.equal(await page.getByLabel("Melding").inputValue(), "forklar koden", "teksten ble med");
    // Kode with a project: the greeting and the project's box, with ways to start while it has no threads.
    await page.getByTestId("project-home").getByRole("button", { name: /Lag en side/ }).waitFor();
    assert.equal(await page.getByTestId("stats-card").count(), 0, "ingen statistikk med prosjekt heller");
  } finally {
    cleanup();
  }
});

flow("prosjektvelgeren: søk på navn og sti, Nylige og Alle prosjekter, piltaster, Enter og Esc", async (h) => {
  const { page } = h;
  const { cleanup } = await makeProjects(h, ["Nettside", "Kalkulator", "Spill", "Notater", "Økonomi", "Bilder"]);
  try {
    await h.api("PATCH", "/api/settings", { codeStartEmpty: "cards" });
    await h.reload();
    await page.getByRole("button", { name: "Kode", exact: true }).click();
    await page.getByTestId("all-projects").click();
    const picker = page.getByRole("dialog", { name: "Velg prosjekt" });
    const search = picker.getByLabel("Søk i prosjekter");
    await search.waitFor();
    await waitFor(() => search.evaluate((el) => el === document.activeElement), "søkefeltet har fokus");
    const groups = picker.getByRole("group");
    assert.deepEqual(await groups.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["Nylige", "Alle prosjekter"]);
    assert.deepEqual(await groups.nth(0).getByRole("option").locator(".menu-name").allTextContents(), ["Bilder", "Økonomi", "Notater"], "Nylige: de sist brukte");
    assert.deepEqual(await groups.nth(1).getByRole("option").locator(".menu-name").allTextContents(), ["Bilder", "Kalkulator", "Nettside", "Notater", "Spill", "Økonomi"], "Alle prosjekter: etter navn");
    await picker.getByRole("button", { name: "Nytt prosjekt" }).waitFor();
    await picker.getByRole("button", { name: "Ikke jobb i et prosjekt" }).waitFor();

    // The arrows move a marker; the field keeps the focus, and Enter picks the marked one.
    const marked = () => picker.locator(".menu-item.selected .menu-name").textContent();
    assert.equal(await marked(), "Bilder");
    await page.keyboard.press("ArrowDown");
    assert.equal(await marked(), "Økonomi");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    assert.equal(await marked(), "Ikke jobb i et prosjekt", "rundt til bunnen");
    assert.equal(await search.evaluate((el) => el === document.activeElement), true);

    // Search covers the path too, and an empty search says so.
    await search.fill("kalkulator");
    assert.deepEqual(await picker.getByRole("option").locator(".menu-name").allTextContents(), ["Kalkulator"]);
    await search.fill("finnes-ikke");
    await picker.getByText("Ingen prosjekter med «finnes-ikke» i navnet eller stien.").waitFor();
    await search.fill("ad-ui-projects");
    await waitFor(async () => (await picker.getByRole("option").count()) === 6, "treff på stien");
    await search.fill("spi");
    await page.keyboard.press("Enter");
    await page.locator(".home-title", { hasText: "Hva skal vi jobbe med i Spill?" }).waitFor();

    // Esc closes and gives the focus back to the chip.
    const chip = focused(page).getByTestId("project-picker");
    await chip.click();
    await search.waitFor();
    await picker.getByRole("option", { name: /Spill/, selected: true }).waitFor();
    await page.keyboard.press("Escape");
    await waitFor(async () => (await picker.count()) === 0, "velgeren er lukket");
    assert.equal(await chip.evaluate((el) => el === document.activeElement), true, "fokus tilbake på prosjektbrikken");
  } finally {
    cleanup();
  }
});

flow("Chat har ikke Kode-ting: ikke festet sammendrag, ingen kontekstring før bruk, søk og eksport i topplinjen", async (h) => {
  const { page } = h;
  assert.equal(await focused(page).getByTestId("context-ring").count(), 0, "ingen ring i en tom tråd");
  await send(page, "hei");
  await page.locator(".row-text").first().waitFor();
  await idle(page);
  assert.equal(await page.getByTestId("pinned-summary").count(), 0, "ingen festet sammendrag i Chat");
  assert.equal(await page.getByText("Ingen mål ennå").count(), 0);
  assert.equal(await focused(page).getByRole("button", { name: "Festet sammendrag" }).count(), 0, "ingen knapp for det heller");
  await focused(page).getByTestId("context-ring").waitFor();
  // Round 11 (SPEC 24.1): search and export are in ⋯ Flere valg in the top bar.
  assert.equal(await page.getByRole("button", { name: "Festet sammendrag" }).count(), 0, "ingen knapp for det");
  const more = page.getByRole("button", { name: "Flere valg" });
  await more.click();
  assert.equal(await page.getByRole("menuitemcheckbox", { name: /Festet sammendrag/ }).count(), 0, "ikke i menyen i Chat");
  await page.getByRole("menuitem", { name: /^Søk i samtalen/ }).click();
  const search = page.getByTestId("chat-search");
  await search.waitFor();
  // The search field takes its own row and covers no message.
  const field = (await search.boundingBox())!;
  const first = (await page.locator(".row-user").first().boundingBox())!;
  assert.ok(field.y + field.height <= first.y + 1 || first.y + first.height <= field.y, "søkefeltet dekker ikke meldingen");
  await page.keyboard.press("Escape");
  await more.click();
  await page.getByRole("menuitem", { name: "Eksporter til Markdown" }).waitFor();
  await page.keyboard.press("Escape");
});

flow("godkjenningskortet med vanlige ord og en diff, uten interne navn, og ingen dobbel status", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.getByLabel("Melding").focus();
  await send(page, "lag en side");
  const card = page.locator(".approval-card").first();
  await card.waitFor();
  const title = (await card.locator(".approval-title").textContent()) ?? "";
  assert.match(title, /^Vil (skrive|kjøre|endre)/, title);
  assert.ok(!/write_file|edit_file|run_command|list_dir/.test(title), `internt navn i tittelen: ${title}`);
  // No «Venter på godkjenning nedenfor» line, and no box for one step.
  assert.equal(await page.getByText("Venter på godkjenning nedenfor").count(), 0);
  assert.equal(await page.getByTestId("background-box").count(), 0);
  await page.locator('.row-tool[data-status="awaiting-approval"] .step-waiting').waitFor();
  // A file shows as a diff, folded to a few lines.
  await approveUntil(page, async () => (await page.locator(".approval-card", { hasText: "index.html" }).count()) > 0 || (await page.getByText("Ferdig. ").count()) > 0, "kortet for index.html");
  const write = page.locator(".approval-card", { hasText: "index.html" }).first();
  if (await write.count()) {
    await write.getByTestId("approval-diff").locator(".diff-line.add").first().waitFor();
    assert.match((await write.locator(".approval-meta").textContent()) ?? "", /\d+ linjer/);
  }
  // Esc on the card says no; Enter on Tillat says yes.
  await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "siden er laget");
});

flow("QA-H1: en midlertidig chat overlever et besøk i Kode, og slettes når ruten får en ny tråd", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Midlertidig chat" }).click();
  await page.getByTestId("temp-badge").waitFor();
  await send(page, "hei");
  await page.getByTestId("temp-banner").waitFor();
  await idle(page);
  const id = (await focused(page).getAttribute("data-thread-id"))!;
  await page.getByRole("button", { name: "Kode", exact: true }).first().click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Chat", exact: true }).first().click();
  await page.locator(`[data-thread-id="${id}"]`).waitFor({ timeout: 3000 });
  let threads = (await h.api("GET", "/api/bootstrap")).threads as Array<{ id: string }>;
  assert.ok(threads.some((t) => t.id === id), "chatten ble slettet uten å bli lukket");
  // A new thread in the same pane closes it for real.
  await send(page, "/new");
  await waitFor(async () => (await focused(page).getAttribute("data-thread-id")) !== id, "ny tråd i ruten");
  await waitFor(async () => {
    threads = (await h.api("GET", "/api/bootstrap")).threads;
    return !threads.some((t) => t.id === id);
  }, "den midlertidige chatten er slettet etter at den ble lukket", 6000);
});

flow("QA-M1: Esc i redigering av målet lagrer ikke, og Enter lagrer én gang", async (h) => {
  const { page } = h;
  await openProject(h);
  await send(page, "/goal Lag en kalkulator");
  const goal = page.getByTestId("goal-composer");
  await goal.getByText("Lag en kalkulator").waitFor();
  const patches: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && /\/api\/threads\//.test(r.url())) patches.push(r.postData() ?? "");
  });
  await goal.getByRole("button", { name: "Rediger mål" }).click();
  await goal.getByLabel("Mål", { exact: true }).fill("Noe helt annet");
  await goal.getByLabel("Mål", { exact: true }).press("Escape");
  await page.waitForTimeout(500);
  assert.equal(await goal.locator(".goal-text").textContent(), "Lag en kalkulator", "Esc avbryter");
  assert.deepEqual(patches, [], "Esc sendte ingenting");
  await goal.getByRole("button", { name: "Rediger mål" }).click();
  await goal.getByLabel("Mål", { exact: true }).fill("Lag en vitenskapelig kalkulator");
  await goal.getByLabel("Mål", { exact: true }).press("Enter");
  await goal.getByText("Lag en vitenskapelig kalkulator").waitFor();
  await page.waitForTimeout(500);
  assert.equal(patches.length, 1, `Enter ga ${patches.length} PATCH-kall`);
  // A click elsewhere saves too, once.
  await goal.getByRole("button", { name: "Rediger mål" }).click();
  await goal.getByLabel("Mål", { exact: true }).fill("Lag en kalkulator med historikk");
  await page.locator(".pane-body").click({ position: { x: 20, y: 20 } });
  await goal.getByText("Lag en kalkulator med historikk").waitFor();
  await page.waitForTimeout(400);
  assert.equal(patches.length, 2);
});

flow("QA-H5: to raske meldinger i en ny rute havner i samme tråd", async (h) => {
  const { page } = h;
  await page.route("**/api/threads", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  const box = page.getByLabel("Melding").first();
  await box.fill("første");
  await box.press("Enter");
  await box.fill("andre");
  await box.press("Enter");
  await page.waitForTimeout(1200);
  await idle(page);
  const threads = (await h.api("GET", "/api/bootstrap")).threads as Array<{ id: string; title: string }>;
  assert.equal(threads.length, 1, `ble ${threads.length} tråder: ${threads.map((t) => t.title).join(", ")}`);
  const texts = (await h.events(threads[0].id)).filter((e) => e.event.type === "user.message").map((e) => (e.event as { text: string }).text);
  assert.deepEqual(texts.sort(), ["andre", "første"], "begge meldingene er i tråden");
});

flow("QA-L1: dobbeltklikk på Lag svaret på nytt gir ingen feilmelding og bare ett nytt svar", async (h) => {
  const { page } = h;
  await send(page, "hei");
  await page.locator(".row-text").first().waitFor();
  await idle(page);
  let rewinds = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/rewind")) rewinds += 1;
  });
  const last = page.locator(".msg").last();
  await last.hover();
  await last.getByRole("button", { name: "Lag svaret på nytt", exact: true }).dblclick();
  await page.waitForTimeout(1000);
  await idle(page);
  const toasts = await page.locator(".toast").allTextContents();
  assert.deepEqual(toasts.filter((t) => /kjører|feil/i.test(t)), [], "feilmelding etter dobbeltklikk");
  assert.equal(rewinds, 1, "ett nytt svar");
});

flow("QA-H4: matte vises som formler, og det som ikke kan tegnes, er merket", async (h) => {
  const { page } = h;
  const close = await fakeProvider(h, (_count, res) =>
    streamText(res, "Pytagoras: $$a^2 + b^2 = c^2$$ og \\(x = \\frac{1}{2}\\). En pris på $5 og $10 er ikke matte.\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\nOg dette kan ikke tegnes: $\\unknowncommand{x}$."),
  );
  try {
    await send(page, "matte");
    const answer = page.locator(".row-text").first();
    await answer.getByText(/Pytagoras/).waitFor();
    await idle(page);
    await waitFor(async () => (await answer.locator("math").count()) >= 3, "tre formler er tegnet");
    const text = (await answer.textContent()) ?? "";
    assert.ok(!text.includes("$$"), `rå LaTeX i svaret: ${text}`);
    assert.match(text, /En pris på \$5 og \$10 er ikke matte/, "dollar i vanlig tekst står som før");
    assert.equal(await answer.locator(".md-math-block math[display=block]").count(), 1, "blokken er en egen linje");
    await answer.locator("mfrac").first().waitFor({ state: "attached" });
    // What it cannot draw is the formula as text, with a label that says so.
    const raw = answer.locator(".md-math-raw");
    assert.equal(await raw.count(), 1);
    assert.equal(await raw.locator(".md-math-label").textContent(), "Formel som tekst");
    assert.equal(await raw.locator("code").textContent(), "\\unknowncommand{x}");
  } finally {
    await close();
  }
});

flow("run.retrying: en rolig linje som teller ned, og forsvinner når svaret kommer", async (h) => {
  const { page } = h;
  const close = await fakeProvider(h, (count, res) => {
    if (count === 1) {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "3" });
      res.end(JSON.stringify({ error: { message: "For mange forespørsler" } }));
    } else streamText(res, "Svar etter ventingen.");
  });
  try {
    await send(page, "hei");
    const line = page.getByTestId("retry-line");
    await line.waitFor();
    assert.match((await line.textContent()) ?? "", /Venter på leverandøren, prøver igjen om \d s.*\(forsøk 1 av \d+\)/);
    const first = Number(await line.locator(".retry-left").textContent());
    await waitFor(async () => {
      const now = await line.locator(".retry-left").textContent().catch(() => null);
      return now !== null && Number(now) < first;
    }, "telleren går ned", 4000);
    await page.locator(".row-text", { hasText: "Svar etter ventingen." }).waitFor({ timeout: 10_000 });
    await waitFor(async () => (await line.count()) === 0, "linjen er borte");
  } finally {
    await close();
  }
});

flow("+-menyen: Skråstrekkommandoer med Enter åpner /-menyen, og den blir stående", async (h) => {
  const { page } = h;
  await openProject(h);
  const plus = focused(page).locator(".composer-foot").getByRole("button", { name: "Legg ved" });
  for (let round = 0; round < 5; round++) {
    // Straight from the field to the + menu and back, faster than any blur timer.
    await page.getByLabel("Melding").focus();
    await plus.focus();
    await page.keyboard.press("ArrowDown");
    const rows = page.getByRole("menu", { name: "Legg ved" }).getByRole("menuitem");
    await waitFor(async () => (await rows.first().evaluate((el) => el === document.activeElement)), "første rad har fokus");
    await page.keyboard.press("Enter");
    await page.getByTestId("composer-menu").getByText("/new", { exact: true }).waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.getByTestId("composer-menu").count(), 1, `menyen lukket seg igjen (runde ${round + 1})`);
    await page.keyboard.press("Escape");
    await page.getByLabel("Melding").fill("");
  }
});

flow("skråstrekmenyen: ikon per kommando, ingen alias, argumenter på valgt rad og på norsk", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.getByLabel("Melding").fill("/");
  const menu = page.getByTestId("composer-menu");
  await menu.getByText("/new", { exact: true }).waitFor();
  assert.equal(await menu.locator(".menu-alias").count(), 0, "ingen alias");
  assert.ok(await menu.locator(".menu-args").count() <= 1, "argumenter bare på valgt rad");
  await page.getByLabel("Melding").fill("/reasoning");
  await menu.locator(".command-item.selected .menu-args").getByText("[ingen | lav | middels | høy | ekstra høy | maks]").waitFor();
  const icons = await menu.locator(".command-item").evaluateAll((els) => new Set(els.map((el) => el.querySelector("svg")?.innerHTML)).size);
  assert.ok(icons >= 1);
  await page.getByLabel("Melding").fill("/");
  const all = await menu.locator(".command-item").evaluateAll((els) => new Set(els.map((el) => el.querySelector("svg")?.innerHTML)).size);
  assert.ok(all >= 6, `ulike ikoner (${all})`);
});
