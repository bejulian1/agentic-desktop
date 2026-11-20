import assert from "node:assert/strict";
import type { Thread, ThreadEvent, ThreadEventEnvelope } from "../../shared/protocol.ts";
import { flow, pane, threadItem, waitFor } from "./harness.ts";

flow("Kode-tidslinjen fra fjerde melding: parvis forhåndsvisning, kapittel, tastatur og smale ruter", async (h) => {
  const { page } = h;
  const thread = await h.api<Thread>("POST", "/api/threads", { mode: "code", projectId: null });
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Tidslinjeprøve" });
  const envelopes = (events: ThreadEvent[]): ThreadEventEnvelope[] => events.map((event, index) => ({ seq: index + 1, threadId: thread.id, at: Date.now() + index, event }));
  const firstTurn: ThreadEvent[] = [
    { type: "user.message", messageId: "q1", text: "Undersøk prosjektets oppsett" },
    { type: "run.started", runId: "r1", modelId: "demo" },
    { type: "text.delta", runId: "r1", messageId: "a1-progress", text: "Jeg undersøker filene først." },
    { type: "thinking.delta", runId: "r1", blockId: "thought", text: "En intern vurdering skal ikke bli en tidslinjestrek." },
    { type: "thinking.done", runId: "r1", blockId: "thought", durationMs: 10 },
    { type: "text.delta", runId: "r1", messageId: "a1", text: "Oppsettet er kontrollert. Bygget og testene fungerer." },
    { type: "run.finished", runId: "r1", status: "done" },
  ];
  let events = envelopes([...firstTurn, { type: "user.message", messageId: "q2", text: "Forenkle oversikten" }]);
  await page.route(`**/api/threads/${thread.id}/events?*`, (route) => route.fulfill({ json: events }));
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await threadItem(page, thread.id).click();
  const target = pane(page, thread.id);
  await target.locator(".user-text", { hasText: "Forenkle oversikten" }).waitFor();
  assert.equal(await target.getByTestId("minimap").count(), 0, "tre meningsfulle meldinger; tenkning og flere tekstblokker teller ikke ekstra");

  events = envelopes([...firstTurn,
    { type: "user.message", messageId: "q2", text: "Forenkle oversikten" },
    { type: "run.started", runId: "r2", modelId: "demo" },
    { type: "text.delta", runId: "r2", messageId: "a2", text: "Oversikten er enklere og lettere å lese." },
    { type: "run.finished", runId: "r2", status: "done" },
  ]);
  await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: "a1", title: "Kontrollert oppsett" } });
  await h.reload();
  const map = target.getByTestId("minimap");
  await map.waitFor();
  assert.equal(await map.locator(".minimap-tick").count(), 4, "to spørsmål og to svar");
  const tick = map.locator('.minimap-tick[data-kind="user"]').first();
  assert.equal(await tick.locator("..").getAttribute("aria-label"), "Tidslinje");
  assert.ok((await tick.getAttribute("aria-label"))?.includes("Spørsmål 1 av 2"));
  assert.ok((await tick.getAttribute("class"))?.includes("chapter"), "kapittel på svaret markerer spørsmålet");
  await page.mouse.move(900, 100);
  const quiet = await tick.evaluate((el) => {
    const style = getComputedStyle(el, "::before");
    return { width: parseFloat(style.width), height: parseFloat(style.height), opacity: parseFloat(style.opacity) };
  });
  assert.ok(quiet.width <= 12 && quiet.height <= 1, "tynne, korte streker i ro");
  const normal = await map.locator('.minimap-tick[data-kind="answer"]').first().evaluate((el) => Number(getComputedStyle(el, "::before").opacity));
  assert.ok(normal <= 0.5, "vanlige streker er dempet");
  await tick.hover();
  const card = target.getByTestId("minimap-card");
  await card.getByText("Undersøk prosjektets oppsett", { exact: true }).waitFor();
  await card.getByText("Oppsettet er kontrollert. Bygget og testene fungerer.", { exact: true }).waitFor();
  await card.getByText("Kontrollert oppsett", { exact: true }).waitFor();
  assert.equal(await card.getByText("Jeg undersøker filene først.", { exact: true }).count(), 0, "viser siste svartekst fremfor arbeidskommentar");
  const answerTick = map.locator('.minimap-tick[data-kind="answer"]').first();
  await answerTick.hover();
  await card.getByText("Undersøk prosjektets oppsett", { exact: true }).waitFor();
  await card.getByText("Oppsettet er kontrollert. Bygget og testene fungerer.", { exact: true }).waitFor();
  assert.equal(await answerTick.getAttribute("aria-describedby"), await card.getAttribute("id"), "forhåndsvisningen er koblet til knappen");
  await page.mouse.move(900, 100);
  await tick.focus();
  await card.waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await card.count()) === 0, "Escape lukker forhåndsvisningen");
  await tick.press("Enter");
  await waitFor(async () => (await tick.getAttribute("aria-current")) === "true", "Enter hopper til kapittelets spørsmål");
  const first = await target.locator(".user-text", { hasText: "Undersøk prosjektets oppsett" }).boundingBox();
  const scroll = await target.getByTestId("scroller").boundingBox();
  assert.ok(first && scroll && first.y >= scroll.y - 1 && first.y < scroll.y + scroll.height / 2, "spørsmålet står øverst etter hopp");
  await page.setViewportSize({ width: 480, height: 800 });
  await waitFor(async () => !(await map.isVisible()), "tidslinjen skjules i smal rute");
});
