// Historical model display metadata stays in thread events, never in model-visible messages.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { AnswerModel, ModelConfig, ThreadEvent } from "../../shared/protocol.ts";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, until } from "./helpers.ts";

async function fixture(t: TestContext) {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const models: ModelConfig[] = [];
  const providers: Array<{ id: string; name: string }> = [];
  const snapshots: AnswerModel[] = [];
  for (const suffix of ["første", "andre", "tredje"]) {
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: `Leverandør ${suffix}`, baseUrl: `${llm.url}/v1`, apiKey: "isolert-test" });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: `Modell ${suffix}`, model: `technical-${suffix}`, contextWindow: 100_000 });
    providers.push(provider);
    models.push(model);
    snapshots.push({ modelId: model.id, modelName: model.name, model: model.model, providerId: provider.id, providerName: provider.name });
  }
  return { h, llm, models, providers, snapshots };
}

const metadata = (events: ThreadEvent[]) => events.filter((event) => event.type === "run.started" || event.type === "model.changed");

for (const mode of ["chat", "code"] as const) {
  test(`${mode}: modellvalg på tom tråd er stille, aktive svar får faktisk modell og snapshots overlever rename/delete`, async (t) => {
    const { h, llm, models, providers, snapshots } = await fixture(t);
    h.app.store.updateSettings({ defaultModelId: models[0].id });
    const thread = await h.thread(null, mode, models[0].id);
    for (const modelId of [models[1].id, models[0].id, null]) await h.api("PATCH", `/api/threads/${thread.id}`, { modelId });
    assert.deepEqual(await h.events(thread.id), [], "første modellvalg lager ikke en kunstig byttelinje");
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    llm.reply(async (req, res) => { await pending; await sse(openaiText("Svar fra den faktisk aktive modellen"))(req, res); });
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Forklar et eksempel" });
    await until(() => llm.requests.length === 1, "første modell er aktiv");
    await h.api("PATCH", `/api/threads/${thread.id}`, { modelId: models[1].id });
    const active = (await h.events(thread.id)).map(({ event }) => event);
    assert.deepEqual(ofType(active, "run.started")[0].model, snapshots[0]);
    assert.deepEqual(ofType(active, "model.changed"), [{ type: "model.changed", from: snapshots[0], to: snapshots[1] }]);
    await h.api("PATCH", `/api/threads/${thread.id}`, { modelId: models[1].id });
    assert.equal(ofType((await h.events(thread.id)).map(({ event }) => event), "model.changed").length, 1, "samme modell lager ingen duplikatlinje");
    release();
    await h.finished(thread.id);
    llm.reply(sse(openaiText("Neste svar")));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Gi et nytt eksempel" });
    const complete = await h.finished(thread.id, 2);
    assert.deepEqual(ofType(complete, "run.started").map((event) => event.model), snapshots.slice(0, 2));
    assert.doesNotMatch(JSON.stringify(h.app.store.messages(thread.id)), /model\.changed|providerName|"modelId"/);
    const before = metadata(complete);
    for (let i = 0; i < 2; i++) {
      await h.api("PATCH", `/api/models/${models[i].id}`, { name: "Nytt modellnavn", model: "changed-technical-name" });
      await h.api("PATCH", `/api/providers/${providers[i].id}`, { name: "Nytt leverandørnavn" });
    }
    assert.deepEqual(metadata((await h.events(thread.id)).map(({ event }) => event)), before);
    for (let i = 0; i < 2; i++) await h.api("DELETE", `/api/providers/${providers[i].id}`);
    assert.deepEqual(metadata((await h.events(thread.id)).map(({ event }) => event)), before, "historikken trenger ikke lenger modell-/leverandørinnstillinger for navnene");
  });

  test(`${mode}: regenerering bevarer faktisk gammel svarmodell før rewind og logger ny modell før det nye svaret`, async (t) => {
    const { h, llm, models, providers, snapshots } = await fixture(t);
    const thread = await h.thread(null, mode, models[0].id);
    llm.reply(sse(openaiText("Opprinnelig svar")));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Et kort spørsmål" });
    const first = await h.finished(thread.id);
    const answerId = ofType(first, "text.delta")[0].messageId;
    await h.api("PATCH", `/api/threads/${thread.id}`, { modelId: models[1].id });
    await h.api("PATCH", `/api/models/${models[0].id}`, { name: "Senere navn på gammel modell" });
    await h.api("PATCH", `/api/providers/${providers[0].id}`, { name: "Senere navn på gammel leverandør" });
    llm.reply(sse(openaiText("Regenerert svar")));
    await h.api("POST", `/api/threads/${thread.id}/rewind`, { messageId: answerId, modelId: models[2].id, ...(mode === "code" ? { keepFiles: true } : {}) });
    const regenerated = await h.finished(thread.id);
    assert.deepEqual(ofType(regenerated, "model.changed"), [{ type: "model.changed", from: snapshots[0], to: snapshots[2] }], "linjen viser modellen som faktisk skrev det erstattede svaret, ikke det senere trådvalget");
    assert.deepEqual(ofType(regenerated, "run.started")[0].model, snapshots[2]);
    assert.equal(regenerated[0].type, "model.changed", "modellbyttet overlever rewind og ligger før det nye svaret");
    assert.doesNotMatch(JSON.stringify(h.app.store.messages(thread.id)), /model\.changed|providerName|"modelId"/);
    const before = metadata(regenerated);
    await h.api("DELETE", `/api/providers/${providers[0].id}`);
    await h.api("DELETE", `/api/providers/${providers[2].id}`);
    assert.deepEqual(metadata((await h.events(thread.id)).map(({ event }) => event)), before);
  });
}
