// Focused checks with the demo model and temporary data. No external API or Playtest server.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openTool, threadItem, waitFor } from "./harness.ts";

flow("Sammendrag og sidepaneler viser ekte tråddata, åpner resultater og kan hente på nytt etter feil", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "index.html"), "<h1>Hei fra demo-modellen</h1>\n");
  const project = await h.createProject("Panelprøve");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  const thread = await h.createThread(project.id);
  await h.api("PATCH", `/api/threads/${thread.id}`, { goal: "Kontroller sammendraget" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, {
    text: "rediger",
    attachments: [{ kind: "file", label: "index.html", path: "index.html" }],
  });
  await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "demoredigeringen er ferdig");
  const events = await h.events(thread.id);
  const message = events.find((e) => e.event.type === "user.message")!;
  assert.equal(message.event.type, "user.message");
  if (message.event.type !== "user.message") throw new Error("Meldingen mangler");
  await h.api("PATCH", `/api/threads/${thread.id}`, { chapter: { messageId: message.event.messageId, title: "Redigeringen" } });
  await h.reload();
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await threadItem(page, thread.id).locator(".thread-text").click();
  await page.getByTestId("pinned-summary").click();
  const summary = page.getByRole("dialog", { name: "Festet sammendrag", exact: true });
  await summary.locator("summary").click();
  await summary.getByTestId("pinned-goal-section").getByText("Kontroller sammendraget", { exact: true }).waitFor();
  await summary.getByTestId("pinned-sources").getByText("index.html", { exact: true }).waitFor();
  await summary.getByTestId("pinned-chapters").getByRole("button", { name: "Redigeringen", exact: true }).waitFor();
  await summary.locator(".pinned-last").getByText("Overskriften er endret.", { exact: false }).waitFor();
  assert.match(await summary.locator(".pinned-stats").innerText(), /1 melding · 1 verktøykall · 1 fil endret/);
  await summary.getByTestId("pinned-results").getByRole("button", { name: /index\.html/ }).click();
  await page.locator(".right-panel .diff-view").waitFor();

  await openTool(page, "Oversikt");
  const overview = page.getByTestId("overview-panel");
  await overview.getByTestId("context-used").waitFor();
  for (const part of ["messages", "system", "tools", "compactBuffer", "free"]) await overview.locator(`[data-part="${part}"]`).waitFor();
  await overview.getByRole("region", { name: "Utdata" }).getByRole("button", { name: /index\.html/ }).click();
  await page.locator('.tree-item.selected[data-path="index.html"]').waitFor();

  // A failed request must stop showing a spinner and offer a working retry.
  const contextUrl = `**/api/threads/${thread.id}/context`;
  await page.route(contextUrl, (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Prøvefeil"}' }));
  h.allow(/status of 503/);
  await openTool(page, "Oversikt");
  await overview.getByText("Kunne ikke hente kontekstbruken.", { exact: true }).waitFor();
  await page.unroute(contextUrl);
  await overview.getByRole("button", { name: "Prøv igjen", exact: true }).click();
  await overview.getByTestId("context-used").waitFor();

  // While the next thread's request is pending, the previous thread's numbers disappear.
  const next = await h.createThread(project.id);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const nextUrl = `**/api/threads/${next.id}/context`;
  await page.route(nextUrl, async (route) => { await pending; await route.continue(); });
  try {
    await threadItem(page, next.id).locator(".thread-text").click();
    await overview.getByText("Regner…", { exact: true }).waitFor();
    assert.equal(await overview.getByTestId("context-used").count(), 0, "ingen konteksttall fra forrige tråd");
  } finally {
    release();
  }
  await overview.getByTestId("context-used").waitFor();
  await page.unroute(nextUrl);

  const sessionUrl = `**/api/threads/${next.id}/session`;
  await page.route(sessionUrl, (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Prøvefeil"}' }));
  await openTool(page, "Økt");
  const session = page.locator(".right-panel").getByTestId("session-panel");
  await session.getByText("Kunne ikke hente økten.", { exact: true }).waitFor();
  assert.equal(await session.getAttribute("aria-busy"), "false");
  await page.unroute(sessionUrl);
  await session.getByRole("button", { name: "Prøv igjen", exact: true }).click();
  await session.getByTestId("okt-project").getByText("Panelprøve").waitFor();
  await session.getByRole("button", { name: /^Kontekst/ }).click();
  await session.getByTestId("okt-context").getByText("Systemprompt og harness", { exact: true }).waitFor();
  await session.getByTestId("okt-context").getByText("Verktøy", { exact: true }).waitFor();
  await session.getByText("Ingenting kjører i bakgrunnen.", { exact: true }).waitFor();
});
