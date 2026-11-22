// Coloured marks of the model's company or service everywhere a model is named: Chat rows and
// hover cards in the sidebar, the answer's model button and card, and never a grey chip.
import assert from "node:assert/strict";
import { flow, send, threadItem, waitFor } from "./harness.ts";

flow("Fargede merker: Chat-rad, hoverkort og svarknapp viser modellens merke, ikke en grå brikke", async (h) => {
  const { page } = h;
  await send(page, "hjelp");
  await page.getByText("Dette er demo-modellen").first().waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "svaret er ferdig");
  const thread = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.mode === "chat");
  assert.ok(thread, "Chat-tråden finnes");

  // Sidefanen: et lite farget merke før tittelen, uten en ekstra linje under.
  const row = threadItem(page, thread.id);
  await row.locator(".thread-provider-chat svg.provider-glyph[data-provider=demo]").waitFor();
  assert.equal(await row.getByTestId("thread-meta").count(), 0, "Chat-rader har ingen Kode-linje med gren");
  assert.match((await row.locator(".thread-provider-chat").getAttribute("title")) ?? "", /Demo/);

  // Hoverkortet for en Chat-tråd har samme merke som Kode, ikke CPU-brikken.
  await row.hover();
  const card = page.getByTestId("hover-card-thread");
  await card.waitFor();
  const model = card.getByTestId("hover-card-model");
  await model.locator("svg.provider-glyph[data-provider=demo]").waitFor();
  assert.equal(await model.locator("svg.icon").count(), 0, "ingen grå ikonbrikke i hoverkortet");
  await page.mouse.move(700, 600);
  await card.waitFor({ state: "detached" });

  // Svarknappen og kortet: merket til modellen som laget svaret.
  const answer = page.locator(".msg:has(.row-text)").first();
  await answer.hover();
  const button = answer.getByRole("button", { name: "Modell som laget svaret", exact: true });
  await button.locator("svg.provider-icon[data-brand=demo]").waitFor();
  assert.equal(await button.locator("svg.icon").count(), 0, "ingen grå CPU-brikke på svarknappen");
  await button.click();
  const info = page.getByTestId("answer-model-info");
  await info.locator(".answer-model-brand svg.provider-icon[data-brand=demo]").waitFor();
  assert.equal(await info.getAttribute("data-brand"), "demo");
  await page.keyboard.press("Escape");
  await info.waitFor({ state: "detached" });
});

flow("Fargede merker: kjente modellfamilier hos egendefinerte API-er får sitt eget merke", async (h) => {
  const { page } = h;
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Mitt API", baseUrl: "https://llm.example.invalid/v1" });
  const cases = [
    { name: "Qwen3 Coder", model: "qwen3-coder", brand: "qwen" },
    { name: "Kimi K2", model: "kimi-k2", brand: "moonshot" },
    { name: "GLM 4.6", model: "glm-4.6", brand: "zhipu" },
    { name: "Anthropic: Claude Opus 5", model: "default", brand: "anthropic" },
    { name: "Abliterated Model", model: "abliterated-model", brand: "api" },
  ];
  for (const item of cases) await h.api("POST", "/api/models", { providerId: provider.id, name: item.name, model: item.model, contextWindow: 100000 });
  await page.getByTestId("model-button").click();
  const list = page.getByRole("listbox", { name: "Modeller", exact: true });
  for (const item of cases) {
    const option = list.getByRole("option").filter({ hasText: item.name });
    await option.waitFor();
    assert.equal(await option.locator("svg.provider-icon").getAttribute("data-brand"), item.brand, item.name);
  }
  await page.keyboard.press("Escape");
});
