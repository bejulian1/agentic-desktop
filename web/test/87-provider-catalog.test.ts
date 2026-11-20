import assert from "node:assert/strict";
import { type Page } from "playwright-core";
import type { Bootstrap } from "../../shared/protocol.ts";
import { httpError, openaiText, sse, startFakeLlm } from "../../server/test/fake-llm.ts";
import { flow, waitFor } from "./harness.ts";

async function openCatalog(page: Page) {
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
  await page.getByRole("button", { name: "Koble til leverandør", exact: true }).click();
}

flow("leverandørkatalogen oppdager en lokal adresse og bruker den vanlige flyten uten nøkkel", async (h, context) => {
  const { page } = h;
  const llm = await startFakeLlm(context);
  let detections = 0;
  await page.route("**/api/providers/local/detect", (route) => {
    detections++;
    assert.equal(route.request().method(), "POST");
    return route.fulfill({ json: [{ presetId: "vllm", modelCount: 1 }] });
  });
  llm.reply(httpError(200, { data: [{ id: "lokal-test", context_length: 8192, supports_tools: false, supports_images: true }] }));
  await openCatalog(page);
  const search = page.getByRole("searchbox", { name: "Søk etter leverandør" });
  assert.equal(await search.evaluate((input) => input === document.activeElement), true);
  await search.fill("ollama");
  const entry = page.getByRole("button", { name: "Koble til Ollama" });
  await entry.click();
  await page.keyboard.press("Escape");
  assert.equal(await search.inputValue(), "ollama");
  assert.equal(await entry.evaluate((button) => button === document.activeElement), true);

  assert.equal(detections, 0);
  await page.getByRole("button", { name: "Finn lokale servere" }).click();
  await page.getByRole("status").filter({ hasText: "1 API svarte" }).waitFor();
  assert.equal(detections, 1);
  const catalog = page.getByRole("list", { name: "Leverandører i katalogen" });
  await catalog.getByText(/Svarte på standardadressen \(1 modell\)/).waitFor();
  await catalog.getByRole("button", { name: "Koble til vLLM" }).click();
  const view = page.getByRole("region", { name: "Koble til vLLM" });
  assert.equal(await view.getByLabel("API-adresse").inputValue(), "http://127.0.0.1:8000/v1");
  await view.getByLabel("API-adresse").fill(llm.url);
  await view.getByRole("button", { name: "Fortsett" }).click();
  await view.getByRole("checkbox", { name: /lokal-test/ }).check();
  await view.getByRole("button", { name: "Legg til valgte (1)" }).click();
  const card = page.getByRole("group", { name: "vLLM", exact: true });
  await card.getByText("Verktøy av").waitFor();
  assert.equal(llm.requests[0].url, "/v1/models");
  assert.equal(llm.requests[0].headers.authorization, undefined);
  const snapshot = await h.api<Bootstrap>("GET", "/api/bootstrap");
  const model = snapshot.models.find((item) => item.model === "lokal-test");
  assert.equal(model?.contextWindow, 8192);
  assert.equal(model?.supportsImages, true);
  llm.reply(sse(openaiText("OK")));
  await card.getByRole("button", { name: "Test modell lokal-test" }).click();
  await card.getByRole("status").filter({ hasText: "Modellen svarte på testmeldingen" }).waitFor();
});

flow("en egendefinert lokal server uten modelliste kan legges til for hånd", async (h, context) => {
  const { page } = h;
  const llm = await startFakeLlm(context);
  llm.reply(httpError(404, {}));
  h.allow(/status of 502/);
  await openCatalog(page);
  await page.getByRole("button", { name: "Egendefinert oppsett" }).click();
  const view = page.getByRole("region", { name: "Koble til Egendefinert" });
  await view.getByLabel("Navn").fill("Min modellserver");
  await view.getByRole("button", { name: "Type" }).click();
  await page.getByRole("menuitemradio", { name: "Lokal modellserver" }).click();
  await view.getByLabel("API-adresse").fill(llm.url);
  await view.getByLabel("Nøkkel", { exact: true }).fill("local-test-key");
  await view.getByRole("button", { name: "Fortsett" }).click();
  await view.getByRole("alert").filter({ hasText: "Legg til modell-ID manuelt" }).waitFor();
  await view.getByRole("button", { name: "Skriv inn modell-ID" }).click();
  const modelId = view.getByLabel("Modell-ID");
  await waitFor(() => modelId.evaluate((input) => input === document.activeElement), "modell-ID har fokus");
  await modelId.fill("my-local-chat");
  await view.getByRole("button", { name: "Legg til modell", exact: true }).click();
  const card = page.getByRole("group", { name: "Min modellserver", exact: true });
  await card.getByText("my-local-chat", { exact: true }).first().waitFor();
  await card.getByRole("button", { name: "Rediger", exact: true }).click();
  assert.equal(await card.getByLabel("Kontekstvindu (tokens)").inputValue(), "4096");
  assert.equal(await card.getByRole("switch", { name: /Verktøykall/ }).isChecked(), false);
  await card.getByRole("form", { name: "Modell" }).getByRole("button", { name: "Avbryt" }).click();
  assert.equal(llm.requests[0].headers.authorization, "Bearer local-test-key");
  await card.getByRole("button", { name: "Rediger Min modellserver" }).click();
  const settings = card.getByRole("form", { name: "Leverandør" });
  await settings.getByRole("checkbox", { name: "Fjern nøkkelen fra dette oppsettet" }).check();
  await settings.getByRole("button", { name: "Lagre" }).click();
  await card.getByText("Valgfri nøkkel", { exact: true }).waitFor();
});

flow("modellanbefaling bruker oppgitt minne og viser et forståelig resultat", async (h) => {
  const { page } = h;
  await openCatalog(page);
  await page.getByRole("button", { name: "Anbefal modell" }).click();
  const form = page.getByRole("form", { name: "Anbefal lokal modell" });
  await form.getByRole("button", { name: "Maskinvare" }).click();
  await page.getByRole("menuitemradio", { name: "Oppgi minne selv" }).click();
  await form.getByRole("textbox", { name: "Tilgjengelig RAM (GiB)" }).fill("24");
  await form.getByRole("button", { name: "Vis anbefaling" }).click();
  const results = page.getByRole("list", { name: "Anbefalte lokale modeller" });
  await results.getByText("Anbefalt", { exact: true }).waitFor();
  assert.ok(await results.getByRole("link", { name: /GGUF/ }).count());
});
