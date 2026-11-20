import assert from "node:assert/strict";
import { flow, send, threadItem, waitFor } from "./harness.ts";

flow("Spørrekort kan besvares med tastatur og lar meldingsutkastet stå", async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 740 });
  await send(page, "Test spørrekort");
  const card = page.getByRole("region", { name: "Spørsmål fra modellen" });
  const submit = card.getByRole("button", { name: "Send svar" });
  await submit.waitFor();
  assert.equal(await submit.isDisabled(), true);
  const radio = card.getByRole("radio", { name: /Kort oppsummering/ });
  assert.equal(await radio.isChecked(), false);
  await radio.press("Space");
  const checkbox = card.getByRole("checkbox", { name: "Eksempler" });
  await checkbox.press("Space");
  await card.getByRole("textbox", { name: "Eget svar: Innhold" }).fill("På norsk.");
  const draft = page.getByRole("textbox", { name: "Melding", exact: true });
  await draft.fill("Usendt utkast");
  await submit.press("Enter");
  await card.waitFor({ state: "detached" });
  const summary = page.locator('[data-row="question-done"]');
  await summary.locator("summary").click();
  assert.match(await summary.innerText(), /Eksempler · På norsk\./);
  assert.equal(await draft.inputValue(), "Usendt utkast");
});

flow("Spørrekort gjenopprettes når gjenkobling laster en omskrevet samtale", async (h) => {
  const { page } = h;
  h.allow(/Failed to load resource: the server responded with a status of 503/);
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { questionTestSockets: sockets });
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    } as typeof WebSocket;
  });
  const thread = await h.createThread(null);
  const messages = `/api/threads/${thread.id}`;
  await h.api("POST", `${messages}/messages`, { text: "Opprinnelig melding" });
  await waitFor(async () => (await h.events(thread.id)).some(({ event }) => event.type === "run.finished"), "opprinnelig tur ferdig");
  const original = (await h.events(thread.id)).find(({ event }) => event.type === "user.message");
  assert.ok(original?.event.type === "user.message");

  await h.reload();
  await threadItem(page, thread.id).locator(".thread-text").click();
  await page.getByText("Opprinnelig melding", { exact: true }).waitFor();
  let offline = true;
  await page.route("**/api/ws-ticket", (route) => offline
    ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' })
    : route.continue());
  await page.evaluate(() => {
    const sockets = (window as Window & { questionTestSockets?: WebSocket[] }).questionTestSockets ?? [];
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    }
  });
  await waitFor(() => page.evaluate(() => ((window as Window & { questionTestSockets?: WebSocket[] }).questionTestSockets ?? [])
    .every((socket) => socket.readyState === WebSocket.CLOSED)), "WebSocket koblet fra");
  await h.api("POST", `${messages}/rewind`, { messageId: original.event.messageId, text: "Test spørrekort" });
  await waitFor(async () => (await h.events(thread.id)).some(({ event }) => event.type === "question.requested"), "spørsmålet venter på serveren");
  offline = false;

  const card = page.getByRole("region", { name: "Spørsmål fra modellen" });
  await card.getByRole("button", { name: "Hopp over" }).click();
  await card.waitFor({ state: "detached" });
  assert.equal(await page.getByText("Opprinnelig melding", { exact: true }).count(), 0);
});
