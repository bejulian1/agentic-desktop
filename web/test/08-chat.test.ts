import assert from "node:assert/strict";
import { flow, send, waitFor } from "./harness.ts";

flow("Chat uten prosjekt svarer med Markdown og utheving", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  assert.equal(await page.locator(".right-panel").count(), 0, "ingen høyre panel i Chat");
  await send(page, "hei");

  const answer = page.locator(".row-text").first();
  await answer.locator("h3", { hasText: "En funksjon i TypeScript" }).waitFor();
  await answer.locator("table td", { hasText: "Filer, kommandoer og nettleser" }).waitFor();
  await waitFor(async () => (await answer.locator(".md-code").count()) === 2, "to kodeblokker");
  await answer.locator(".md-code .tok-keyword").first().waitFor();
  await page.locator(".row-thinking").first().waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");

  const groups = page.locator(".section-head", { hasText: "Chatter" });
  assert.equal(await groups.count(), 1);
  await page.locator(".thread-item", { hasText: "hei" }).waitFor();

  await answer.locator(".md-copy").first().click();
  await answer.getByText("Kopiert").waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /export function hils/);

  // Rename and archive from the sidebar.
  const item = page.locator(".thread-item", { hasText: "hei" });
  await item.hover();
  await item.getByRole("button", { name: "Valg for tråden" }).click();
  await page.getByRole("menuitem", { name: "Gi nytt navn" }).click();
  await page.getByLabel("Nytt navn").fill("Omdøpt tråd");
  await page.getByLabel("Nytt navn").press("Enter");
  // With one pane, the name is shown at the top of the window, not in the pane (v0.5).
  await page.getByTestId("topbar-title").getByText("Omdøpt tråd").waitFor();

  await page.getByRole("button", { name: "Søk", exact: true }).click();
  await page.getByLabel("Søk i tråder").fill("omdøpt");
  await page.locator(".section-label", { hasText: "Treff" }).waitFor();
  await page.locator(".thread-item", { hasText: "Omdøpt tråd" }).waitFor();
  await page.getByLabel("Søk i tråder").fill("finnes ikke");
  await page.getByText("Ingen tråder funnet").waitFor();
  await page.getByLabel("Søk i tråder").fill("");

  const renamed = page.locator(".thread-item", { hasText: "Omdøpt tråd" });
  await renamed.hover();
  await renamed.getByRole("button", { name: "Valg for tråden" }).click();
  await page.getByRole("menuitem", { name: "Arkiver" }).click();
  await page.getByRole("button", { name: /Arkiverte \(1\)/ }).waitFor();
});

flow("trådbytte og lange tråder: eldre meldinger lastes når du skroller opp", async (h) => {
  const { page } = h;
  // 320 messages through the real API would take long, so the demo model repeats a short answer.
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Lang tråd" });
  for (let i = 0; i < 300; i++) {
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: `hjelp nummer ${i}` });
    await waitFor(async () => {
      const state = await h.api("GET", "/api/bootstrap");
      return !state.threads.find((t: any) => t.id === thread.id).running;
    }, "svaret er ferdig");
  }
  await h.reload();
  await page.locator(`[data-thread-item="${thread.id}"]`).click();
  const list = page.locator(`[data-thread-id="${thread.id}"]`);
  await list.locator(".user-text", { hasText: "hjelp nummer 299" }).waitFor();
  assert.equal(await list.locator(".user-text", { hasText: "hjelp nummer 0" }).count(), 0, "bare slutten er lastet");
  const scroller = list.locator(".scroller");
  await waitFor(async () => {
    await scroller.evaluate((el) => (el.scrollTop = -el.scrollHeight));
    return (await list.locator(".user-text", { hasText: /^hjelp nummer 0$/ }).count()) > 0;
  }, "den første meldingen er nådd", 30_000);
  await page.getByRole("button", { name: "Til bunnen" }).click();
  await list.locator(".user-text", { hasText: "hjelp nummer 299" }).waitFor();
}, { mockDelayMs: 0 });
