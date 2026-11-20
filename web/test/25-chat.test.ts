// Round 7, agent F (SPEC 18.2): Chat. Edit a message and send it again, a new answer (also from
// another model), Kopier on code blocks, attachments, personality in Settings, search with marks,
// export to Markdown, the start page and a temporary chat. And Kjør on shell blocks in Kode.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approveUntil, flow, openProject, send, waitFor } from "./harness.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const idle = (page: import("playwright-core").Page) => waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");

flow("Chat: rediger og send på nytt, nytt svar, søk, eksport og personlighet", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await send(page, "hei");
  const answer = page.locator(".row-text").first();
  await answer.locator(".md-code").first().waitFor();
  await idle(page);
  const threadId = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;

  // Kopier on every code block, with the language. No Kjør in Chat.
  await waitFor(async () => (await answer.locator(".md-code .md-copy").count()) === 2, "Kopier på begge blokkene");
  assert.deepEqual(await answer.locator(".md-lang").allTextContents(), ["ts", "python"]);
  assert.equal(await page.locator(".md-run:visible").count(), 0, "ingen Kjør i Chat");

  // Edit the message in place: everything after it is replaced.
  const user = page.locator(".row-user").first();
  await user.hover();
  await user.getByRole("button", { name: "Rediger" }).click();
  const field = page.getByLabel("Rediger meldingen");
  assert.equal(await field.inputValue(), "hei");
  await field.fill("hjelp");
  await page.getByRole("button", { name: "Lagre og send" }).click();
  await page.locator(".row-text", { hasText: "Dette er demo-modellen" }).waitFor();
  await idle(page);
  assert.equal(await page.locator(".user-text").count(), 1, "bare den redigerte meldingen");
  assert.equal(await page.locator(".user-text").first().textContent(), "hjelp");
  assert.equal(await page.locator(".row-text", { hasText: "En funksjon i TypeScript" }).count(), 0, "det gamle svaret er borte");
  let events = await h.events(threadId);
  assert.equal(events.filter((e) => e.event.type === "user.message").length, 1, "loggen er kuttet");

  // Esc leaves the edit without changing anything.
  await page.locator(".row-user").first().hover();
  await page.locator(".row-user").first().getByRole("button", { name: "Rediger" }).click();
  await page.getByLabel("Rediger meldingen").press("Escape");
  await waitFor(async () => (await page.getByTestId("user-edit").count()) === 0, "redigeringen er lukket");

  // A new answer to the last message, with the same model and from the model menu.
  const since = Math.max(...events.map((e) => e.at));
  const last = page.locator(".msg").last();
  await last.hover();
  await last.getByRole("button", { name: "Lag svaret på nytt", exact: true }).click();
  await waitFor(async () => (await h.events(threadId)).some((e) => e.event.type === "run.finished" && e.at > since), "nytt svar");
  await idle(page);
  await page.locator(".row-text", { hasText: "Dette er demo-modellen" }).waitFor();
  assert.equal(await page.locator(".row-text").count(), 1, "det forrige svaret er erstattet");
  await page.locator(".msg").last().hover();
  await page.locator(".msg").last().getByRole("button", { name: "Lag svaret på nytt med en annen modell" }).click();
  const menu = page.getByTestId("regen-menu");
  await menu.getByRole("menuitem", { name: "Demo-modell (uten API)" }).click();
  await idle(page);
  await page.locator(".row-text", { hasText: "Dette er demo-modellen" }).waitFor();
  events = await h.events(threadId);
  assert.equal(events.filter((e) => e.event.type === "user.message").length, 1);
  assert.equal(events.filter((e) => e.event.type === "run.started").length, 1, "bare én kjøring igjen i loggen");

  // Search with Ctrl+F while the pane has focus: marks the hits and counts the messages.
  await send(page, "hei");
  await page.locator(".row-text", { hasText: "En funksjon i TypeScript" }).waitFor();
  await idle(page);
  await page.getByLabel("Melding").click();
  await page.keyboard.press("Control+f");
  // The field, not the button in the pane's top line with the same name.
  const search = page.getByRole("textbox", { name: "Søk i samtalen", exact: true });
  await search.waitFor();
  await search.fill("demo-modellen");
  await waitFor(async () => /av 2$/.test((await page.getByTestId("chat-search-count").textContent()) ?? ""), "to meldinger med treff");
  await waitFor(() => page.evaluate(() => (CSS.highlights.get("chat-search-current")?.size ?? 0) > 0), "treffet er markert");
  await search.press("Enter");
  assert.match((await page.getByTestId("chat-search-count").textContent()) ?? "", /^1 av 2$/);
  await search.fill("finnes-ikke-noe-sted");
  await page.getByTestId("chat-search-count").getByText("Ingen treff").waitFor();
  await search.press("Escape");
  await waitFor(async () => (await page.getByTestId("chat-search").count()) === 0, "søket er lukket");
  assert.equal(await page.evaluate(() => CSS.highlights.has("chat-search")), false, "merkene er borte");

  // Export to Markdown: a .md file with both sides.
  await page.getByRole("button", { name: "Flere valg" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Eksporter til Markdown" }).click()]);
  assert.match(download.suggestedFilename(), /\.md$/);
  const markdown = readFileSync((await download.path())!, "utf8");
  assert.match(markdown, /^# /);
  assert.match(markdown, /## Du · .*\n\nhjelp/);
  assert.match(markdown, /## Svar · Demo-modell \(uten API\)/);
  assert.match(markdown, /Dette er demo-modellen/);

  // The personality still belongs to this chat, now chosen in Innstillinger → Chat.
  assert.equal(await page.getByTestId("personality-button").count(), 0);
  await page.getByTestId("chat-tools-button").click();
  await page.getByRole("menu", { name: "Verktøy", exact: true }).getByRole("button", { name: "Innstillinger → Chat" }).click();
  await page.getByRole("radiogroup", { name: "Personlighet for aktiv chat", exact: true }).getByRole("radio", { name: "Effektiv", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === threadId).personality === "effektiv", "lagret på tråden");
});

flow("Chat: vedlegg, startsiden og midlertidig chat", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();

  // + has files and images, but no folders or @ in Chat.
  await page.getByRole("button", { name: "Legg ved" }).click();
  await page.getByRole("menuitem", { name: /Legg til filer/ }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: /Legg til mappe/ }).count(), 0, "ingen mapper i Chat");
  await page.keyboard.press("Escape");
  await page.getByTestId("text-file-input").setInputFiles([{ name: "notat.txt", mimeType: "text/plain", buffer: Buffer.from("Handleliste: melk og brød\n") }]);
  await page.getByTestId("image-input").setInputFiles([{ name: "prikk.png", mimeType: "image/png", buffer: PNG }]);
  await waitFor(async () => (await page.getByTestId("image-chip").count()) === 1 && (await page.locator(".composer .chip", { hasText: "notat.txt" }).count()) === 1, "to vedlegg i feltet");
  await send(page, "hva står i vedleggene?");
  const sent = page.locator(".row-user").first();
  await sent.locator(".chip", { hasText: "notat.txt" }).waitFor();
  await sent.getByTestId("user-images").locator("img").waitFor();
  await page.locator(".row-text").first().waitFor();
  await idle(page);
  const first = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;

  // Back on the start page: continue where you left off.
  await page.keyboard.press("Control+j");
  const recent = page.getByTestId("home-recent");
  await recent.getByRole("button", { name: /hva står i vedleggene/ }).waitFor();
  await recent.getByRole("button", { name: /hva står i vedleggene/ }).getByRole("img", { name: "Chat", exact: true }).waitFor();
  const code = await h.api("POST", "/api/threads", { mode: "code", projectId: null });
  await h.api("PATCH", `/api/threads/${code.id}`, { title: "Lokal kodeøkt" });
  const codeResume = recent.getByRole("button", { name: /Lokal kodeøkt/ });
  await codeResume.getByRole("img", { name: "Kode", exact: true }).waitFor();


  // A temporary chat: marked, left out of search, and deleted when it is left.
  await page.getByRole("button", { name: "Midlertidig chat" }).click();
  await page.getByTestId("temp-badge").waitFor();
  await send(page, "hei i det skjulte");
  await page.getByTestId("temp-banner").waitFor();
  await idle(page);
  const temp = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  assert.notEqual(temp, first);
  const state = await h.api("GET", "/api/bootstrap");
  assert.equal(state.threads.find((t: any) => t.id === temp).temporary, true);
  assert.equal((await h.api("GET", "/api/threads/search?q=skjulte")).length, 0, "ikke i søket");
  await page.keyboard.press("Control+j");
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.id === temp), "den midlertidige chatten er slettet", 10_000);
  assert.ok((await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.id === first), "den vanlige chatten er der");
});

flow("Kode: Kjør på skallblokker går via ! med godkjenning, og et skript krever bekreftelse", async (h) => {
  const { page } = h;
  await openProject(h);
  await send(page, "kommandoblokk");
  const answer = page.locator(".row-text", { hasText: "Kjør denne" });
  await answer.waitFor();
  await idle(page);
  const runs = answer.locator(".md-run");
  await waitFor(async () => (await runs.count()) === 2, "Kjør på begge skallblokkene");
  assert.equal(await page.locator(".row-text .md-code").count(), 2);

  // Kopier leaves out the $ prompt.
  await answer.locator(".md-copy").first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "echo hei-fra-blokken");

  // One line: runs at once, through the usual approval.
  await runs.first().click();
  await page.locator(".user-text", { hasText: "!echo hei-fra-blokken" }).waitFor();
  await approveUntil(page, async () => (await page.locator('.row-tool[data-tool="run_command"][data-status="done"]').count()) >= 1, "kommandoen er kjørt");
  const tool = page.locator('.row-tool[data-tool="run_command"]').first();
  await tool.locator(".tool-head").click();
  await tool.locator(".tool-output", { hasText: "hei-fra-blokken" }).waitFor();

  // Two lines: the whole script is shown first, and Avbryt runs nothing.
  await runs.nth(1).click();
  const dialog = page.getByRole("dialog", { name: "Kjør skriptet" });
  await dialog.locator(".script-text", { hasText: "echo linje-en\necho linje-to" }).waitFor();
  await dialog.getByRole("button", { name: "Avbryt" }).click();
  await waitFor(async () => (await dialog.count()) === 0, "dialogen er lukket");
  assert.equal(await page.locator(".user-text", { hasText: "linje-to" }).count(), 0, "ingenting kjørt");
  await runs.nth(1).click();
  await dialog.getByRole("button", { name: "Kjør skriptet" }).click();
  await page.locator(".user-text", { hasText: "echo linje-to" }).waitFor();
  await approveUntil(page, async () => (await page.locator('.row-tool[data-tool="run_command"][data-status="done"]').count()) >= 2, "skriptet er kjørt");
  const script = page.locator('.row-tool[data-tool="run_command"]').nth(1);
  await script.locator(".tool-head").click();
  await script.locator(".tool-output", { hasText: "linje-to" }).waitFor();
});

flow("meldinger mens agenten jobber: kø eller send med en gang, med bryteren i kø-raden", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await send(page, "lang kommando");
  await waitFor(async () => {
    const id = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
    return !!id && (await h.api("GET", "/api/bootstrap")).threads.some((thread: any) => thread.id === id && thread.running);
  }, "tur kjører før meldingene legges i kø");
  const threadId = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;

  // Standard: the queue.
  await send(page, "første i kø");
  const queue = page.getByTestId("queue");
  await queue.locator(".queue-item", { hasText: "første i kø" }).waitFor();
  const toggle = page.getByTestId("busy-switch");
  assert.equal(await toggle.getByRole("button", { name: "Legg i kø" }).getAttribute("aria-pressed"), "true");

  // One message at once, from its own button.
  await queue.getByRole("button", { name: "Send «første i kø» med en gang" }).click();
  await queue.locator(".queue-item.steer", { hasText: "første i kø" }).waitFor();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.busyMessages !== "steer", "innstillingen er uendret");

  // The switch changes the setting, and what waits follows it.
  await toggle.getByRole("button", { name: "Send med en gang" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.busyMessages === "steer", "innstillingen er endret");
  await queue.locator(".queue-item.steer", { hasText: "første i kø" }).waitFor();
  await queue.getByText("Sendes inn i turen").waitFor();

  // A new message now goes into the running turn.
  await send(page, "andre rett inn");
  await waitFor(async () => (await h.events(threadId)).some((e) => e.event.type === "user.queued" && e.event.text === "andre rett inn" && e.event.steer === true), "sendt med steer");
  await queue.locator(".queue-item.steer", { hasText: "andre rett inn" }).waitFor();

  // And back.
  await toggle.getByRole("button", { name: "Legg i kø" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.busyMessages === "queue", "tilbake til kø");
  await waitFor(async () => (await queue.locator(".queue-item.steer").count()) === 0, "køen følger bryteren");
  await page.getByRole("button", { name: "Stopp", exact: true }).click();
  await idle(page);
});
