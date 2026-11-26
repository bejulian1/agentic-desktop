import assert from "node:assert/strict";
import type { Bootstrap, ModelConfig } from "../../shared/protocol.ts";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

flow("Shift+klikk sammenligner to demomodeller side ved side fra et Chat-prosjekt", async h => {
  const { page } = h;
  const second = await h.api<ModelConfig>("POST", "/api/models", {
    providerId: "mock", name: "Demo B", model: "mock-b", contextWindow: 100000,
  });
  await h.api("PATCH", "/api/settings", { defaultModelId: "mock-demo" });
  const project = await h.api("POST", "/api/chat-projects", { name: "Sammenligning" });
  await page.locator('.chat-project[data-chat-project="Sammenligning"] .group-title').click();
  const landing = page.getByTestId("chat-project-page");
  const trigger = landing.getByTestId("model-button");
  const bar = landing.getByTestId("compare-models");
  const menu = page.getByTestId("model-menu");
  const option = menu.getByRole("option", { name: second.name });

  await trigger.getByText("Demo-modell (uten API)").waitFor();
  await trigger.click();
  await option.click({ modifiers: ["Shift"] });
  assert.equal(await menu.getByRole("option", { selected: true }).count(), 2);
  assert.equal(await bar.getByRole("button", { name: /^Fjern / }).count(), 2);
  await option.click();
  await menu.waitFor({ state: "detached" });
  assert.equal(await bar.count(), 0);
  await trigger.getByText(second.name).waitFor();

  await trigger.click();
  await menu.getByRole("option", { name: /Demo-modell/ }).click({ modifiers: ["Shift"] });
  await trigger.getByText("Sammenlign (2)").waitFor();
  await page.keyboard.press("Escape");
  await landing.getByTestId("text-file-input").setInputFiles([
    { name: "notat.txt", mimeType: "text/plain", buffer: Buffer.from("Testvedlegg") },
    { name: "piksel.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=", "base64") },
  ]);
  await landing.getByTestId("image-chip").waitFor();
  await landing.locator(".chip").getByText("notat.txt").waitFor();

  // Hold both message requests before the server accepts either. Serial sends cannot pass.
  const requests: { text: string; attachments: unknown[] }[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/threads/*/messages", async route => {
    requests.push(route.request().postDataJSON());
    await gate;
    await route.continue();
  });
  try {
    await send(page, "hjelp", landing);
    await waitFor(() => requests.length === 2, "begge meldinger sendt parallelt");
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].text, "hjelp");
    assert.equal(requests[0].attachments.length, 2);
  } finally { release(); }

  await landing.waitFor({ state: "detached" });
  const threads = (await h.api<Bootstrap>("GET", "/api/bootstrap")).threads;
  assert.equal(threads.length, 2);
  let right = 0;
  for (const modelId of [second.id, "mock-demo"]) {
    const thread = threads.find(item => item.modelId === modelId)!;
    assert.equal(thread.chatProjectId, project.id);
    const pane = page.locator(`.pane-inner[data-thread-id="${thread.id}"]`);
    await pane.getByText("Dette er demo-modellen.", { exact: false }).first().waitFor();
    const rect = (await pane.boundingBox())!;
    assert.ok(rect.x >= right - 1, "modellene står i valgrekkefølge i hver sin kolonne");
    right = rect.x + rect.width;
    assert.equal(await pane.getByTestId("compare-models").count(), 0);
    assert.ok((await h.events(thread.id)).some(({ event }) => event.type === "run.started" && event.modelId === modelId));
  }
});

flow("Kode beholder første tråd og innstillinger når én sammenligningsmodell feiler", async h => {
  const { page } = h;
  const project = await openProject(h);
  const original = await h.createThread(project.id);
  await h.api("PATCH", `/api/threads/${original.id}`, { modelId: "mock-demo", planMode: true, reasoning: "high" });
  await threadItem(page, original.id).locator(".thread-text").click();
  const models: ModelConfig[] = [];
  for (const name of ["Demo B", "Demo C", "Demo D", "Demo E"]) {
    models.push(await h.api<ModelConfig>("POST", "/api/models", { providerId: "mock", name, model: name, contextWindow: 100000 }));
  }
  const first = page.locator(`.pane-inner[data-thread-id="${original.id}"]`);
  await first.getByTestId("model-button").click();
  const menu = page.getByTestId("model-menu");
  for (const model of models) await menu.getByRole("option", { name: model.name }).click({ modifiers: ["Shift"] });
  await page.getByText("Du kan sammenligne inntil 4 modeller samtidig.").waitFor();
  assert.equal(await menu.getByRole("option", { selected: true }).count(), 4);
  await page.keyboard.press("Escape");
  await first.getByRole("button", { name: "Fjern Demo D" }).click();

  // Simulate a provider-specific preparation failure. The other two still answer.
  h.allow(/503/);
  await page.route("**/api/threads", route => route.request().method() === "POST" && route.request().postDataJSON().modelId === models[1].id
    ? route.fulfill({ status: 503, json: { error: "Demo C utilgjengelig" } }) : route.continue());
  await send(page, "hjelp", first);
  await page.getByText(/Kunne ikke sende til Demo C/).waitFor();
  await first.getByText("Dette er demo-modellen.", { exact: false }).first().waitFor();
  const threads = (await h.api<Bootstrap>("GET", "/api/bootstrap")).threads;
  assert.equal(threads.length, 2);
  const sibling = threads.find(thread => thread.id !== original.id)!;
  assert.equal(sibling.modelId, models[0].id);
  assert.equal(sibling.projectId, project.id);
  assert.equal(sibling.planMode, true);
  assert.equal(sibling.reasoning, "high");
  await page.locator(`.pane-inner[data-thread-id="${sibling.id}"]`).getByText("Dette er demo-modellen.", { exact: false }).first().waitFor();
});
