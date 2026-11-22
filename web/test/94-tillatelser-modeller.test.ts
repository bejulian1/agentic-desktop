// 1.2.0: what "Tillat alltid" covers and where the saved rules are, one mode for every project,
// the first model ID in the custom connect form, and the pending context handoff when the model of
// an answered thread changes.
import assert from "node:assert/strict";
import type { Bootstrap } from "../../shared/protocol.ts";
import { httpError, openaiText, sse, startFakeLlm } from "../../server/test/fake-llm.ts";
import { flow, openProject, send, waitFor } from "./harness.ts";

async function openSettings(page: import("playwright-core").Page, section: string) {
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
}

flow("Tillat alltid sier hva som lagres, og regelen kan fjernes under Tillatelser", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await send(page, "lag en side");
  const card = page.locator(".approval-card");
  await card.waitFor();
  assert.match(await card.getByTestId("approval-always").innerText(), /verktøyet write_file hver gang/);
  await card.getByRole("button", { name: "Tillat alltid", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/permissions/rules")).some((rule: any) => rule.value === "write_file"), "the rule is saved");
  await page.getByRole("button", { name: "Stopp", exact: true }).click().catch(() => undefined);

  // The default changes, the projects keep theirs until the user applies it to all.
  await h.api("PATCH", "/api/settings", { defaultPermissionMode: "full" });
  await openSettings(page, "Tillatelser");
  const apply = page.getByTestId("permission-apply-all");
  await apply.getByText("1 prosjekt bruker en annen modus").waitFor();
  await apply.getByRole("button", { name: "Bruk på alle prosjekter" }).click();
  await apply.waitFor({ state: "detached" });
  const projects = (await h.api<Bootstrap>("GET", "/api/bootstrap")).projects;
  assert.equal(projects.find((p) => p.id === project.id)?.permissionMode, "full");

  const rules = page.getByTestId("permission-rules");
  await rules.getByText("write_file", { exact: true }).waitFor();
  await rules.getByRole("button", { name: /^Fjern write_file/ }).click();
  await page.getByText("Ingen lagrede godkjenninger.", { exact: false }).waitFor();
  assert.deepEqual(await h.api("GET", "/api/permissions/rules"), []);
});

flow("Egendefinert oppsett: API-adresse (Base URL) og egen modell-ID i samme skjema", async (h, context) => {
  const { page } = h;
  const llm = await startFakeLlm(context);
  llm.always(httpError(404, {}));
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
  await page.getByRole("button", { name: "Koble til leverandør", exact: true }).click();
  await page.getByRole("button", { name: "Egendefinert oppsett" }).click();
  const view = page.getByRole("region", { name: "Koble til Egendefinert" });
  await view.getByLabel("Navn").fill("Min API");
  await view.getByLabel("API-adresse (Base URL)").fill(`${llm.url}/v1`);
  await view.getByLabel("Modell-ID (valgfri)").fill("gpt-5.4");
  await view.getByRole("button", { name: "Fortsett" }).click();
  await view.getByTestId("connect-added").getByText(/Min API er lagret med modellen gpt-5\.4/).waitFor();
  const model = (await h.api<Bootstrap>("GET", "/api/bootstrap")).models.find((m) => m.model === "gpt-5.4");
  assert.ok(model, "the model is added right away");
  assert.equal(model.supportsImages, true, "a cloud OpenAI-compatible model takes pasted images");
  await view.getByRole("button", { name: "Ferdig" }).click();
  await view.waitFor({ state: "detached" });
});

flow("kontekstoverføring venter når modellen byttes i en besvart tråd, og Angre går tilbake", async (h, context) => {
  const { page } = h;
  const llm = await startFakeLlm(context);
  llm.always(sse(openaiText("Svar fra den andre modellen")));
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Annen", baseUrl: `${llm.url}/v1`, apiKey: "test-only" });
  await h.api("POST", "/api/models", { providerId: provider.id, name: "Annen modell", model: "other", contextWindow: 100_000 });
  await h.api("PATCH", "/api/settings", { defaultModelId: "mock-demo" });
  await openProject(h);
  await send(page, "hei");
  await page.locator(".row-text").first().waitFor();
  const handoff = page.getByTestId("context-handoff");
  assert.equal(await handoff.count(), 0);
  await page.getByTestId("model-button").click();
  await page.locator(".model-menu").getByRole("option", { name: "Annen modell" }).click();
  await handoff.waitFor();
  assert.match(await handoff.innerText(), /Kontekstoverføring venter/);
  assert.match(await handoff.innerText(), /Bytter fra Demo-modell \(uten API\) til Annen modell ved neste melding/);
  await handoff.getByRole("button", { name: "Angre" }).click();
  await handoff.waitFor({ state: "detached" });
  await waitFor(async () => /Demo-modell/.test(await page.getByTestId("model-button").innerText()), "the old model is back");

  await page.getByTestId("model-button").click();
  await page.locator(".model-menu").getByRole("option", { name: "Annen modell" }).click();
  await handoff.waitFor();
  await send(page, "fortsett");
  await handoff.waitFor({ state: "detached" });
  await page.locator(".row-text", { hasText: "Svar fra den andre modellen" }).waitFor();
});
