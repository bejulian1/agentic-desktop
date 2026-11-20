// Focused summary regressions: real demo changes, separate thread/project scopes and no new PTY.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openTool, threadItem, waitFor } from "./harness.ts";

flow("Kode-sammendraget står øverst til høyre og følger tråd og prosjekt", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "index.html"), "<h1>Hei fra demo-modellen</h1>\n");
  const project = await h.createProject("Første prosjekt");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  const thread = await h.createThread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "rediger" });
  await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "endringen er ferdig");
  const otherPath = path.join(h.home, "annet-prosjekt");
  mkdirSync(otherPath);
  const otherProject = await h.api("POST", "/api/projects", { name: "Andre prosjekt", path: otherPath });
  const other = await h.createThread(otherProject.id);
  await h.reload();
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await threadItem(page, thread.id).locator(".thread-text").click();
  const pin = page.getByTestId("pinned-summary");
  const card = page.getByRole("dialog", { name: "Festet sammendrag", exact: true });
  assert.equal(await page.locator(".topbar-right").getByTestId("pinned-summary").count(), 1);
  assert.equal(await page.locator(".pane-body .pinned").count(), 0);
  assert.equal(await page.getByTestId("changes-chip").count(), 0, "endringstallene står bare i sammendraget");
  await pin.focus();
  await page.keyboard.press("Enter");
  await card.locator(".code-summary-head").getByText("Første prosjekt").waitFor();
  await card.getByTestId("changes-chip").getByText("· 1 fil").waitFor();
  await card.getByText("Ingen åpne bakgrunnsterminaler.", { exact: true }).waitFor();
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/terminals`), [], "åpning starter ingen terminal");
  await page.keyboard.press("Escape");
  await card.waitFor({ state: "detached" });
  assert.equal(await pin.evaluate((button) => button === document.activeElement), true, "Escape gir fokus tilbake til knappen");

  await pin.click();
  await page.keyboard.press("Control+,");
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  await card.waitFor({ state: "detached" });
  await page.keyboard.press("Escape");

  await pin.click();
  await page.locator(".topbar-mid").click();
  await card.waitFor({ state: "detached" });
  await pin.click();
  await card.getByTestId("changes-chip").click();
  await card.waitFor({ state: "detached" });
  await page.locator(".right-panel .diff-view").waitFor();

  // Reverted turns disappear from the same cached model while the summary remains open.
  const turn = (await h.events(thread.id)).find((e) => e.event.type === "turn.changes")!;
  assert.equal(turn.event.type, "turn.changes");
  if (turn.event.type !== "turn.changes") throw new Error("Endringen mangler");
  await pin.click();
  await h.api("POST", `/api/turns/${turn.event.turnId}/revert`, {});
  await card.getByTestId("changes-chip").getByText("Ingen endringer").waitFor();

  await threadItem(page, other.id).locator(".thread-text").click();
  await card.waitFor({ state: "detached" });
  await pin.click();
  await card.locator(".code-summary-head").getByText("Andre prosjekt").waitFor();
  await card.getByTestId("changes-chip").getByText("Ingen endringer").waitFor();
  await card.getByTestId("pinned-agents").getByText("Ingen underagenter i tråden.").waitFor();
  await page.keyboard.press("Escape");

  // Reading terminals reports a failure, offers retry and still never opens a shell.
  const url = `**/api/projects/${otherProject.id}/terminals`;
  h.allow(/status of 503/);
  await page.route(url, (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Prøvefeil"}' }));
  await pin.click();
  await card.getByText("Kunne ikke hente terminalene.").waitFor();
  await page.unroute(url);
  await card.getByRole("button", { name: "Prøv igjen", exact: true }).click();
  await card.getByText("Ingen åpne bakgrunnsterminaler.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");

  await openTool(page, "Terminal");
  await page.getByTestId("terminal").waitFor();
  await pin.click();
  await card.getByRole("button", { name: "Bakgrunnsterminal 1 åpne", exact: true }).waitFor();
  await card.getByRole("button", { name: "Bakgrunnsterminal 1 åpne", exact: true }).click();
  await card.waitFor({ state: "detached" });
  await page.getByTestId("terminal").waitFor();

  await page.setViewportSize({ width: 680, height: 720 });
  await pin.click();
  const box = await card.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 680, "kortet holder seg innenfor et smalt vindu");
  await page.keyboard.press("Escape");
  await page.locator(".topbar-mode").getByRole("button", { name: "Chat", exact: true }).click();
  assert.equal(await pin.count(), 0, "sammendraget vises bare i Kode");
});

flow("Sammendragets underagenter har ekte status og åpner sin egen tråd", async (h) => {
  const { page } = h;
  const project = await h.createProject("Teamprosjekt");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await h.api("PATCH", "/api/settings", { autoOpenAgentThreads: false });
  const thread = await h.createThread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "samarbeid om en oversikt" });
  await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "samarbeidet er ferdig");
  const children = (await h.api("GET", "/api/bootstrap")).threads.filter((t: any) => t.parentThreadId === thread.id && t.origin === "agent");
  assert.equal(children.length, 1);
  await h.reload();
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await threadItem(page, thread.id).locator(".thread-text").click();
  const pin = page.getByTestId("pinned-summary");
  const card = page.getByRole("dialog", { name: "Festet sammendrag", exact: true });
  await pin.click();
  await card.getByTestId("pinned-agents").getByText("1 ferdig", { exact: true }).waitFor();
  await card.getByRole("button", { name: /Hjelpetråd.*ferdig/ }).click();
  await card.waitFor({ state: "detached" });
  await page.locator(`.pane-inner.focused[data-thread-id="${children[0].id}"]`).waitFor();
  await pin.click();
  await card.getByText("Ingen underagenter i tråden.").waitFor();
  await page.keyboard.press("Escape");

  await h.api("PATCH", `/api/threads/${children[0].id}`, { archived: true });
  await threadItem(page, thread.id).locator(".thread-text").click();
  await pin.click();
  await card.getByText("Ingen underagenter i tråden.").waitFor();
});

flow("Sammendrag og Endringer åpner også en ekte tur før de siste 500 samtalehendelsene", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "index.html"), "<h1>Hei fra demo-modellen</h1>\n");
  const project = await h.createProject("Lang historikk");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  const thread = await h.createThread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "rediger" });
  await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "den gamle filendringen er ferdig");
  const { Store } = await import("../../server/src/db.ts");
  const store = new Store(h.dataDir);
  try {
    for (let i = 0; i < 600; i++) store.appendEvent(thread.id, { type: "user.message", messageId: `later-${i}`, text: `Senere melding ${i}` });
  } finally {
    store.close();
  }
  await h.reload();
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  const loading = page.waitForResponse((response) => response.url().includes(`/api/threads/${thread.id}/events?tail=`));
  await threadItem(page, thread.id).locator(".thread-text").click();
  const loadedEvents = await (await loading).json();
  assert.equal(loadedEvents.some((entry: any) => entry.event.type === "turn.changes"), false, "den gamle turen er utenfor siste hendelsesside");
  assert.equal(await page.getByTestId("changes-card").count(), 0, "den gamle turen er utenfor lastet samtale");
  await page.getByTestId("pinned-summary").click();
  const card = page.getByRole("dialog", { name: "Festet sammendrag", exact: true });
  await card.getByTestId("changes-chip").getByText("· 1 fil").waitFor();
  await card.locator("summary").click();
  await card.getByTestId("pinned-results").getByRole("button", { name: /index\.html/ }).click();
  await card.waitFor({ state: "detached" });
  await page.getByTestId("changes-panel").locator(".turn-files", { hasText: "index.html" }).waitFor();
  await page.getByTestId("diff-file").locator(".diff-path", { hasText: "index.html" }).waitFor();
  assert.match(await page.getByTestId("diff-file").innerText(), /Hei fra demo-modellen/);
});
