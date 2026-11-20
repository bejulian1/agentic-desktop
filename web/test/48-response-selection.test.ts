import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";
import { flow, openProject, pane, send, threadItem, waitFor } from "./harness.ts";

const menu = (page: Page) => page.getByTestId("response-selection");
const quote = (text: string) => `Utdrag fra svaret:\n\n${text.split(/\r?\n/).map((line) => `> ${line}`).join("\n")}\n\n`;

async function selectContents(locator: Locator): Promise<string> {
  await locator.scrollIntoViewIfNeeded();
  // Let the native scroll event settle before creating a new selection, as a person does after
  // scrolling. Selection actions deliberately dismiss on scroll, including synthetic test scrolls.
  await locator.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return locator.evaluate((element) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return selection.toString();
  });
}

async function finished(page: Page): Promise<void> {
  await waitFor(async () => await page.locator(".pane-dot.running").count() === 0, "modellen er ferdig");
}

flow("Markert svartekst: bevarer utkast og full tekst, tastatur, avgrensning og lukking", async (h) => {
  const { page } = h;
  await send(page, "hei");
  await page.locator(".row-text p").first().waitFor();
  await finished(page);
  const field = page.getByLabel("Melding", { exact: true });
  const draft = "Mitt eksisterende utkast  \n";
  await field.fill(draft);
  const selected = await selectContents(page.locator(".row-text p").first());
  await menu(page).waitFor();
  const eventsBefore = await h.events((await page.locator(".pane-inner").getAttribute("data-thread-id"))!);
  await page.keyboard.press("Alt+Enter");
  assert.equal(await menu(page).getByRole("button", { name: "Legg til i chat", exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await menu(page).getByRole("button", { name: "Legg til i sidechat", exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await menu(page).waitFor({ state: "detached" });
  assert.equal(await field.inputValue(), `${draft}\n\n${quote(selected)}`, "utkastets eksisterende mellomrom og hele markeringen beholdes");
  assert.equal(await field.evaluate((el) => el === document.activeElement), true);
  assert.equal(await field.evaluate((el: HTMLTextAreaElement) => el.selectionStart === el.value.length && el.selectionEnd === el.value.length), true);
  const threadId = (await page.locator(".pane-inner").getAttribute("data-thread-id"))!;
  assert.deepEqual(await h.events(threadId), eventsBefore, "sitatet sendes ikke");

  const response = page.locator(".row-text p").first();
  await response.scrollIntoViewIfNeeded();
  const responseBox = (await response.boundingBox())!;
  await page.mouse.move(responseBox.x + 2, responseBox.y + responseBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(responseBox.x + 180, responseBox.y + responseBox.height / 2, { steps: 6 });
  assert.equal(await menu(page).count(), 0, "menyen forstyrrer ikke mens markeringen dras");
  await page.mouse.up();
  await menu(page).waitFor();
  assert.ok((await page.evaluate(() => window.getSelection()!.toString())).length > 0);
  await page.keyboard.press("Escape");

  await selectContents(page.locator(".user-text").first());
  await page.waitForTimeout(60);
  assert.equal(await menu(page).count(), 0, "brukermeldinger gir ingen meny");
  await field.focus();
  await field.evaluate((el: HTMLTextAreaElement) => el.select());
  assert.equal(await menu(page).count(), 0, "utkast gir ingen meny");

  await selectContents(response);
  await menu(page).waitFor();
  await page.keyboard.press("Escape");
  await menu(page).waitFor({ state: "detached" });
  await selectContents(response);
  await menu(page).waitFor();
  await field.click();
  await menu(page).waitFor({ state: "detached" });
  await selectContents(response);
  await menu(page).waitFor();
  await page.locator(".scroller").evaluate((element) => element.dispatchEvent(new Event("scroll")));
  await menu(page).waitFor({ state: "detached" });
  await selectContents(response);
  await menu(page).waitFor();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await menu(page).waitFor({ state: "detached" });

  // The original whole-message selection remains separate and suppresses the floating actions.
  await response.hover();
  await selectContents(response);
  await menu(page).waitFor();
  await page.locator('.msg [data-msg-action="select"]').first().focus();
  await page.keyboard.press("Space");
  await page.getByTestId("select-bar").waitFor();
  await menu(page).waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await page.getByTestId("select-bar").waitFor({ state: "detached" });
  assert.equal(await menu(page).count(), 0, "gammelt tekstutvalg åpnes ikke igjen etter helmeldingsutvalget");
  await page.locator('.msg [data-msg-action="select"]').first().click();
  await page.getByTestId("select-bar").waitFor();
  await selectContents(response);
  await page.waitForTimeout(60);
  assert.equal(await menu(page).count(), 0);
  assert.equal(await page.getByTestId("select-bar").isVisible(), true);
  await page.getByRole("button", { name: "Fjern utvalget", exact: true }).click();

  // A range crossing the user message boundary must never quote both roles as assistant text.
  await page.locator(".row-user").first().evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.querySelector(".user-text")!.firstChild!, 0);
    range.setEndAfter(document.querySelector(".row-text p")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForTimeout(60);
  assert.equal(await menu(page).count(), 0);

  // Keep the entire selection, and refuse oversize excerpts visibly instead of truncating them.
  await response.evaluate((element) => { element.textContent = "A".repeat(64_001); });
  await selectContents(response);
  await menu(page).waitFor();
  assert.equal(await menu(page).getByRole("button", { name: "Legg til i chat", exact: true }).isDisabled(), true);
  assert.equal(await menu(page).getByRole("button", { name: "Legg til i sidechat", exact: true }).isDisabled(), true);
  await menu(page).getByText("Velg inntil 64 000 tegn", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), `${draft}\n\n${quote(selected)}`);
});

flow("Markert svartekst: riktig rute, ny sidechat og Chat-prosjekt uten overføring av historikk", async (h) => {
  const { page } = h;
  const project = await h.api("POST", "/api/chat-projects", { name: "Markering" });
  const a = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${a.id}`, { chatProjectId: project.id });
  const b = await h.createThread(null);
  for (const thread of [a, b]) {
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
    await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "svaret er lagret");
  }
  await threadItem(page, a.id).click();
  await pane(page, a.id).waitFor();
  await page.getByTestId("new-pane").click();
  await threadItem(page, b.id).click();
  await pane(page, b.id).locator(".row-text p").first().waitFor();
  await pane(page, a.id).getByLabel("Melding", { exact: true }).fill("Utkast i A");
  await pane(page, b.id).getByLabel("Melding", { exact: true }).fill("Utkast i B");
  const selected = await selectContents(pane(page, a.id).locator(".row-text p").first());
  await menu(page).getByRole("button", { name: "Legg til i chat", exact: true }).click();
  assert.equal(await pane(page, a.id).getByLabel("Melding", { exact: true }).inputValue(), `Utkast i A\n\n${quote(selected)}`);
  assert.equal(await pane(page, b.id).getByLabel("Melding", { exact: true }).inputValue(), "Utkast i B");

  await selectContents(pane(page, a.id).locator(".row-text p").first());
  await menu(page).getByRole("button", { name: "Legg til i sidechat", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.parentThreadId === a.id), "sidechat er opprettet");
  const side = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.parentThreadId === a.id);
  await pane(page, side.id).getByLabel("Melding", { exact: true }).waitFor();
  await waitFor(async () => (await pane(page, side.id).getByLabel("Melding", { exact: true }).inputValue()) === quote(selected), "sidechatens utkast tar imot sitatet");
  assert.equal(side.mode, "chat");
  assert.equal(side.projectId, null);
  assert.equal(side.chatProjectId, project.id);
  assert.deepEqual(await h.events(side.id), [], "sidechat inneholder ingen historikk eller sendt sitat");
  assert.equal(await pane(page, a.id).getByLabel("Melding", { exact: true }).inputValue(), `Utkast i A\n\n${quote(selected)}`);
  assert.equal(await pane(page, b.id).getByLabel("Melding", { exact: true }).inputValue(), "Utkast i B");
});

flow("Markert svartekst i Kode: kodeutdrag, modus og prosjekt bevares; løsrevet rute har ingen skjult sidechat", async (h) => {
  const { page, context } = h;
  const project = await openProject(h, "Markeringskode");
  await send(page, "lang strøm 1200");
  await page.locator(".row-text pre code").first().waitFor();
  await finished(page);
  const original = (await page.locator(".pane-inner").getAttribute("data-thread-id"))!;
  const text = await selectContents(page.locator(".row-text pre code").first());
  await menu(page).getByRole("button", { name: "Legg til i sidechat", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.parentThreadId === original), "Kode-sidechat er opprettet");
  const side = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.parentThreadId === original);
  await pane(page, side.id).getByLabel("Melding", { exact: true }).waitFor();
  await waitFor(async () => (await pane(page, side.id).getByLabel("Melding", { exact: true }).inputValue()) === quote(text), "hele kodeutdraget er i utkastet");
  assert.equal(side.mode, "code");
  assert.equal(side.projectId, project.id);
  assert.deepEqual(await h.events(side.id), []);

  // Code-block controls and language labels must not become selected answer content.
  await selectContents(pane(page, original).locator(".row-text .md-code-head").first());
  await page.waitForTimeout(60);
  assert.equal(await menu(page).count(), 0);

  const solo = await context.newPage();
  await solo.goto(`${h.origin}/?rute=${original}`);
  await solo.locator(".app.solo").waitFor();
  const field = solo.getByLabel("Melding", { exact: true });
  await field.fill("Løsrevet utkast");
  const soloText = await selectContents(solo.locator(".row-text p").first());
  await menu(solo).waitFor();
  const disabled = menu(solo).getByRole("button", { name: "Legg til i sidechat", exact: true });
  assert.equal(await disabled.isDisabled(), true);
  assert.equal(await disabled.getAttribute("title"), "Åpne sidechat fra hovedvinduet");
  const countBefore = (await h.api("GET", "/api/bootstrap")).threads.length;
  const disabledBox = (await disabled.boundingBox())!;
  await solo.mouse.click(disabledBox.x + disabledBox.width / 2, disabledBox.y + disabledBox.height / 2);
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, countBefore, "ingen skjult sidechat opprettes");
  await menu(solo).getByRole("button", { name: "Legg til i chat", exact: true }).click();
  assert.equal(await field.inputValue(), `Løsrevet utkast\n\n${quote(soloText)}`);
  await solo.close();
});
