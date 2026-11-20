import assert from "node:assert/strict";
import { approveUntil, openProject, flow, pane, send, threadItem, waitFor } from "./harness.ts";

flow("samarbeid lager en synlig tråd", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await send(page, "samarbeid om en oversikt");
  await page.locator(".approval-card").waitFor();
  const parent = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
  await approveUntil(page, async () => (await page.getByText("Samarbeidet er ferdig").count()) > 0, "samarbeidet er ferdig");
  assert.equal(await page.locator(".pane-inner.focused").getAttribute("data-thread-id"), parent, "ruten som åpnet seg tok ikke fokus");

  const boot = await h.api("GET", "/api/bootstrap");
  const child = boot.threads.find((t: any) => t.origin === "agent");
  assert.ok(child, "en agent laget en tråd");
  assert.equal(child.projectId, project.id);

  // Who made what is visible: in the sidebar, in the conversation and in the pane.
  await threadItem(page, child.id).locator(".thread-origin", { hasText: "Laget av" }).waitFor();
  await page.locator(".row-spawned", { hasText: "Hjelpetråd" }).waitFor();
  await pane(page, child.id).waitFor();
  await pane(page, child.id).locator(".from-label", { hasText: "Fra tråden" }).waitFor();
  await pane(page, child.id).locator(".row-text", { hasText: "Oversikt fra hjelpetråden" }).waitFor();
  await pane(page, child.id).locator(".origin-tag").waitFor();
  // The project total sits with the context ring in the message field, shown on hover.
  await page.locator(".pane-inner.focused").getByTestId("context-ring").hover();
  assert.ok(await page.locator(".pane-inner.focused").getByTestId("project-usage").isVisible(), "kontekstringen viser samlet bruk");
  assert.match(await page.locator(".pane-inner.focused").getByTestId("project-usage").textContent() ?? "", /Prosjekt: .* tokens/);

  const card = pane(page, parent!).getByTestId("agents-card");
  const assignment = /Demo-modell \(uten API\) · /;
  await card.getByRole("button", { name: assignment }).waitFor();
  const toggle = card.getByRole("button", { name: /1 underagent/ });
  await toggle.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.match(await toggle.innerText(), assignment);
  await h.reload();
  await threadItem(page, parent!).click();
  await card.getByRole("button", { name: assignment }).waitFor();
});

flow("godkjenning gir merke i sidefanen, og Stopp alt stopper alle tråder", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const waiting = await h.createThread(project.id);
  const first = await h.createThread(project.id);
  const second = await h.createThread(project.id);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await h.api("POST", `/api/threads/${first.id}/messages`, { text: "lang kommando" });
  await h.api("POST", `/api/threads/${second.id}/messages`, { text: "lang kommando" });

  // .env always asks, also in Full tilgang, so this one waits for an answer in a thread nobody is looking at.
  await h.api("POST", `/api/threads/${waiting.id}/messages`, { text: "godkjenning" });
  await threadItem(page, waiting.id).locator(".badge").waitFor();
  assert.match(await threadItem(page, waiting.id).locator(".badge").textContent() ?? "", /1/);

  const stopAll = page.getByTestId("stop-all");
  await stopAll.waitFor();
  await waitFor(async () => /3/.test(await stopAll.textContent() ?? ""), "tre tråder kjører");
  await stopAll.click();
  await stopAll.waitFor({ state: "detached" });
  await page.locator(".toast", { hasText: "Stoppet 3" }).waitFor();
  for (const id of [first.id, second.id, waiting.id]) {
    const events = await h.events(id);
    assert.equal(events.filter((e) => e.event.type === "run.finished").map((e) => (e.event as any).status).at(-1), "stopped");
  }
  await waitFor(async () => (await threadItem(page, waiting.id).locator(".badge").count()) === 0, "merket er borte");

  await threadItem(page, first.id).click();
  await pane(page, first.id).locator(".row-line", { hasText: "Stoppet" }).waitFor();
});
