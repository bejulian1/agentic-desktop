// Issue #11: reconnecting WebSocket after a missed edit/rewrite reloads the conversation
// for both shorter and longer replacements, without needing a full page reload.
import assert from "node:assert/strict";
import { flow, threadItem, waitFor } from "./harness.ts";

flow("Gjenkoblet WebSocket laster samtalen på nytt etter både kortere og lengre omskriving", async (h) => {
  const { page } = h;
  h.allow(/Failed to load resource: the server responded with a status of 503/);
  await page.addInitScript(() => {
    const NativeWS = window.WebSocket;
    (window as any).__sockets = [];
    window.WebSocket = class extends NativeWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as any).__sockets.push(this);
      }
    } as typeof WebSocket;
  });

  const thread = await h.createThread(null);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Første opprinnelige melding" });
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id)?.running, "første tur ferdig");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Andre opprinnelige melding" });
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id)?.running, "andre tur ferdig");

  await h.reload();
  await threadItem(page, thread.id).locator(".thread-text").click();
  await page.getByText("Første opprinnelige melding", { exact: true }).waitFor();
  await page.getByText("Andre opprinnelige melding", { exact: true }).waitFor();

  let blockTicket = false;
  let failNextReload = false;
  let failedReload = false;
  await page.route("**/api/ws-ticket", async (route) => {
    if (blockTicket) return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' });
    return route.continue();
  });
  await page.route(`**/api/threads/${thread.id}/events?tail=*`, async (route) => {
    if (!failNextReload) return route.continue();
    failNextReload = false;
    failedReload = true;
    return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"midlertidig feil"}' });
  });

  const disconnectWs = async () => {
    blockTicket = true;
    await page.evaluate(() => {
      for (const ws of (window as any).__sockets ?? []) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      }
    });
    await waitFor(
      () => page.evaluate(() => ((window as any).__sockets ?? []).every((ws: WebSocket) => ws.readyState === WebSocket.CLOSED)),
      "WebSocket koblet fra",
    );
  };

  // 1. Shorter replacement while disconnected (2 turns -> 1 turn).
  const initialEvents = await h.events(thread.id);
  const firstUser = initialEvents.find((e) => e.event.type === "user.message" && e.event.text === "Første opprinnelige melding");
  assert.ok(firstUser && firstUser.event.type === "user.message");
  await disconnectWs();

  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: firstUser.event.messageId, text: "Redigert kort versjon" });
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id)?.running, "kortere omskriving ferdig");

  failNextReload = true;
  blockTicket = false;
  await page.getByText("Redigert kort versjon", { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(failedReload, true);
  assert.equal(await page.getByText("Første opprinnelige melding", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Andre opprinnelige melding", { exact: true }).count(), 0);

  // 2. Longer replacement while disconnected (1 turn -> 2 turns).
  const shortEvents = await h.events(thread.id);
  const editedUser = shortEvents.find((e) => e.event.type === "user.message" && e.event.text === "Redigert kort versjon");
  assert.ok(editedUser && editedUser.event.type === "user.message");
  await disconnectWs();

  await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: editedUser.event.messageId, text: "Redigert lang versjon" });
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id)?.running, "lengre omskriving del 1 ferdig");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Ny oppfølgingsmelding" });
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id)?.running, "lengre omskriving del 2 ferdig");

  blockTicket = false;
  await page.getByText("Redigert lang versjon", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByText("Ny oppfølgingsmelding", { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await page.getByText("Redigert kort versjon", { exact: true }).count(), 0);
});
