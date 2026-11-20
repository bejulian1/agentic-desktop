import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

async function addModel(h: Harness, llm: FakeLlm, providerName: string, name: string, model: string, contextWindow = 50_000) {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: providerName, baseUrl: `${llm.url}/v1`, apiKey: "test-only" });
  return h.api("POST", "/api/models", { providerId: provider.id, name, model, contextWindow });
}

async function setup(t: TestContext, mode: "ask" | "full" = "full", contextWindow?: number) {
  const h = await startHarness(t, { localWorkspace: true, homeDir: tempDir(t) });
  const project = await h.project(undefined, { permissionMode: mode });
  const coordinator = await startFakeLlm(t);
  const helper = await startFakeLlm(t);
  const source = await addModel(h, coordinator, "Kilde", "Første modell", "source", contextWindow);
  const target = await addModel(h, helper, "Mål", "Andre modell", "target");
  const thread = await h.thread(project.id, "code", source.id);
  return { h, project, coordinator, helper, source, target, thread };
}

for (const action of ["allow", "deny", "stop", "change", "steer"] as const) {
  test(`delegering på tvers av leverandører: ${action}`, async (t) => {
    const { h, project, coordinator, helper, target, thread } = await setup(t, action === "allow" ? "ask" : "full");
    await h.api("PATCH", `/api/threads/${thread.id}`, { title: "PRIVAT-TITTEL-FRA-BRUKERMELDING" });
    const socket = await h.socket();
    socket.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 0 });
    coordinator.reply(sse(openaiToolCall("thread_create", { title: "Hjelper", task: "Se på testene", model: "andre modell" }, "create")));
    coordinator.reply(sse(openaiText("Koordinator ferdig")));
    helper.reply(sse(openaiText("Hjelper ferdig")));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Be en hjelper gjennomgå testene" });
    const { envelope } = await socket.waitFor((message) => message.type === "thread.event" && message.envelope.event.type === "approval.requested") as any;
    const approval = envelope.event;
    assert.equal(approval.canAllowAlways, false);
    assert.match(approval.title, /Mål/);
    assert.match(approval.detail, /Andre modell.+prosjektkonteksten/s);
    assert.equal(helper.requests.length, 0);
    if (action === "stop") await h.api("POST", `/api/threads/${thread.id}/stop`);
    else {
      if (action === "change") await h.api("PATCH", `/api/models/${target.id}`, { model: "new-destination" });
      if (action === "steer") await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Ikke deleger", steer: true });
      await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: action === "deny" ? "deny" : "allow" });
    }
    const events = await h.finished(thread.id);
    const spawned = ofType(events, "thread.spawned");
    if (action !== "allow") {
      assert.equal(spawned.length, 0);
      assert.equal(helper.requests.length, 0);
      assert.equal(ofType(events, "tool.finished")[0].status, action === "stop" ? "cancelled" : action === "change" ? "error" : "denied");
      if (action === "steer") assert.match(coordinator.requests[1].body.messages.at(-1).content, /Ikke deleger/);
      return;
    }
    assert.equal(spawned.length, 1);
    const child = h.app.store.thread(spawned[0].childThreadId)!;
    assert.equal(child.projectId, project.id);
    assert.equal(child.permissionCap, "ask");
    assert.equal(child.parentThreadId, thread.id);
    assert.equal(spawned[0].model?.providerName, "Mål");
    await h.finished(child.id);
    assert.equal(helper.requests[0].body.model, "target");
    const prompt = JSON.stringify(helper.requests[0].body.messages);
    assert.ok(prompt.includes(`tråd-id: ${thread.id}`));
    assert.ok(!prompt.includes("PRIVAT-TITTEL-FRA-BRUKERMELDING"));
    assert.ok(!prompt.includes("Be en hjelper gjennomgå testene"));
  });
}

test("modellsøk paginerer gyldig JSON i liten kontekst, uten tilgang utenfor prosjektet", async (t) => {
  const { h, project, source, target, thread, coordinator } = await setup(t, "full", 1000);
  const name = "Filter ".padEnd(210, "ø");
  for (const index of Array.from({ length: 13 }, (_, index) => index)) await h.api("POST", "/api/models", { providerId: target.providerId, name: `${name}${index}`, model: "samme-navn".repeat(20), contextWindow: 2000 });
  let offset = 0;
  const found = new Set<string>();
  coordinator.always((req, res) => {
    const results = req.body.messages.filter((message: any) => message.role === "tool");
    if (results.length) {
      const page = JSON.parse(results.at(-1).content);
      for (const entry of page.models) found.add(entry.id);
      if (page.nextOffset === null) return sse(openaiText("Ferdig"))(req, res);
      offset = page.nextOffset;
    }
    return sse(openaiToolCall("thread_models", { query: "Filter", offset }, `models-${offset}`))(req, res);
  });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "List opp modeller" });
  const events = await h.finished(thread.id);
  assert.equal(found.size, 13);
  assert.ok(ofType(events, "tool.finished").every(({ result }) => result!.length <= 2000));
  assert.equal(h.app.runner.toolNames("code", project).includes("thread_models"), true);
  assert.equal(h.app.runner.toolNames("code", undefined).includes("thread_models"), false);
  assert.equal(h.app.runner.toolNames("chat", undefined).includes("thread_models"), false);
  const plan = { ...h.app.store.thread(thread.id)!, planMode: true, modelId: source.id };
  assert.equal(h.app.runner.toolDefs(plan, project, []).some((tool) => tool.name === "thread_create"), false);
});

test("et implisitt modellvalg arver den pågående kjøringen selv om standarden byttes", async (t) => {
  const { h, project, coordinator, helper, source, target } = await setup(t);
  await h.api("PATCH", "/api/settings", { defaultModelId: source.id });
  const thread = await h.thread(project.id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  coordinator.reply(async (req, res) => {
    await gate;
    await sse(openaiToolCall("thread_create", { title: "Hjelper", task: "Test" }, "inherit"))(req, res);
  });
  coordinator.always(sse(openaiText("Ferdig")));
  helper.always(sse(openaiText("Feil leverandør")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Deleger" });
  try {
    await until(() => coordinator.requests.length > 0, "første modellkall");
    await h.api("PATCH", "/api/settings", { defaultModelId: target.id });
  } finally { release(); }
  const events = await h.finished(thread.id);
  const spawned = ofType(events, "thread.spawned")[0];
  assert.equal(spawned.model?.modelId, source.id);
  await h.finished(spawned.childThreadId);
  assert.equal(helper.requests.length, 0);
});
