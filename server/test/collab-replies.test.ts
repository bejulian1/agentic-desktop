import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_AGENT_THREADS } from "../src/agent/collab.ts";
import { hang, httpError, openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, textOf, until, type Harness } from "./helpers.ts";

async function fakeModel(h: Harness, url: string): Promise<string> {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Isolert test", baseUrl: `${url}/v1`, apiKey: "test-only" });
  return (await h.api("POST", "/api/models", { providerId: provider.id, name: "Samarbeidstest", model: "fake", contextWindow: 100_000 })).id;
}

test("a child reply interrupts its ancestor's wait in the same run at full helper capacity", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm.url);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  let releaseReply!: () => void;
  const replyGate = new Promise<void>((resolve) => { releaseReply = resolve; });
  t.after(() => releaseReply());
  let rootSteps = 0;
  let childSteps = 0;
  let consumedReply = false;
  llm.always(async (req, res) => {
    const firstUser = String(req.body.messages.find((message: any) => message.role === "user").content);
    if (firstUser === "Koordiner fire hjelpere") {
      rootSteps++;
      if (rootSteps <= MAX_AGENT_THREADS) return sse(openaiToolCall("thread_create", { title: `Hjelper ${rootSteps}`, task: `Del ${rootSteps}` }, `create-${rootSteps}`))(req, res);
      const child = h.app.store.projectThreads(project.id).find((thread) => thread.title === "Hjelper 1")!;
      if (rootSteps === MAX_AGENT_THREADS + 1) return sse(openaiToolCall("thread_wait", { threadId: child.id, timeoutSeconds: 60 }, "wait-child"))(req, res);
      if (rootSteps === MAX_AGENT_THREADS + 2) {
        const waitResult = req.body.messages.find((message: any) => message.role === "tool" && message.tool_call_id === "wait-child");
        assert.match(waitResult.content, /ny melding/);
        const incoming = req.body.messages.findLast((message: any) => message.role === "user");
        assert.ok(incoming.content.includes(`tråd-id: ${child.id}`), "the receiving model gets the sender id");
        assert.match(incoming.content, /Jeg trenger en avklaring/);
        consumedReply = true;
        return sse(openaiToolCall("thread_create", { title: "En femte hjelper", task: "Skal avvises" }, "fifth-helper"))(req, res);
      }
      const refusal = req.body.messages.find((message: any) => message.role === "tool" && message.tool_call_id === "fifth-helper");
      assert.match(refusal.content, /Grensen er nådd/);
      return sse(openaiText("Jeg har behandlet barnets melding i samme tur."))(req, res);
    }
    if (firstUser.includes("Del 1")) {
      childSteps++;
      if (childSteps === 1) {
        await replyGate;
        return sse(openaiToolCall("thread_send", { threadId: root.id, text: "Jeg trenger en avklaring" }, "reply-parent"))(req, res);
      }
    }
    return hang()(req, res);
  });
  await h.api("POST", `/api/threads/${root.id}/messages`, { text: "Koordiner fire hjelpere" });
  await until(async () => ofType((await h.events(root.id)).map((entry) => entry.event), "tool.started").some((event) => event.callId === "wait-child"), "the parent is waiting for its child");
  assert.equal(h.app.store.projectThreads(project.id).filter((thread) => thread.origin === "agent" && thread.running).length, MAX_AGENT_THREADS);
  releaseReply();
  const events = await h.finished(root.id);
  assert.equal(consumedReply, true);
  assert.equal(ofType(events, "run.started").length, 1);
  assert.equal(ofType(events, "run.finished").length, 1);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.match(textOf(events), /samme tur/);
  assert.equal(ofType(events, "user.queued").find((event) => !!event.from)?.steer, true);
  assert.equal(h.app.store.projectThreads(project.id).filter((thread) => thread.origin === "agent").length, MAX_AGENT_THREADS);
  assert.equal(h.app.store.hasQueued(root.id), false);
  await h.api("POST", `/api/projects/${project.id}/stop-all`);
});

test("stopping a waiting parent cleans up wait listeners and leaves its child running", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm.url);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  let steps = 0;
  llm.always((req, res) => {
    const firstUser = String(req.body.messages.find((message: any) => message.role === "user").content);
    if (firstUser !== "Vent på hjelperen") return hang()(req, res);
    steps++;
    if (steps === 1) return sse(openaiToolCall("thread_create", { title: "Langvarig hjelper", task: "Vent videre" }, "create"))(req, res);
    const child = h.app.store.projectThreads(project.id).find((thread) => thread.parentThreadId === root.id)!;
    return sse(openaiToolCall("thread_wait", { threadId: child.id, timeoutSeconds: 60 }, "wait"))(req, res);
  });
  await h.api("POST", `/api/threads/${root.id}/messages`, { text: "Vent på hjelperen" });
  const waits = h.app.runner as unknown as { idleWaiters: Map<string, Set<() => void>>; incomingWaiters: Map<string, Set<() => void>> };
  await until(() => waits.incomingWaiters.has(root.id), "the parent registered its wait listeners");
  const child = h.app.store.projectThreads(project.id).find((thread) => thread.parentThreadId === root.id)!;
  await h.api("POST", `/api/threads/${root.id}/stop`);
  const events = await h.finished(root.id);
  assert.equal(ofType(events, "run.finished")[0].status, "stopped");
  assert.equal(waits.idleWaiters.size, 0);
  assert.equal(waits.incomingWaiters.size, 0);
  assert.equal(h.app.store.thread(child.id)!.running, true);
  await h.api("POST", `/api/projects/${project.id}/stop-all`);
});

for (const action of ["resume", "stop", "stop-all", "archive", "bulk-archive"] as const) {
test(`an ancestor reply survives a failed parent run safely when the next action is ${action}`, async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm.url);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  let releaseReply!: () => void;
  let releaseFailure!: () => void;
  const replyGate = new Promise<void>((resolve) => { releaseReply = resolve; });
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  t.after(() => { releaseReply(); releaseFailure(); });
  let rootSteps = 0;
  let childSteps = 0;
  let parentRequestPending = false;
  let resumed = false;
  llm.always(async (req, res) => {
    const firstUser = String(req.body.messages.find((message: any) => message.role === "user").content);
    if (firstUser === "Koordiner og håndter feil") {
      rootSteps++;
      if (rootSteps <= MAX_AGENT_THREADS) return sse(openaiToolCall("thread_create", { title: `Feilhjelper ${rootSteps}`, task: `Feildel ${rootSteps}` }, `create-${rootSteps}`))(req, res);
      if (rootSteps === MAX_AGENT_THREADS + 1) {
        parentRequestPending = true;
        await failureGate;
        return httpError(400, { error: { message: "Simulert avvist modellforespørsel" } })(req, res);
      }
      const incoming = req.body.messages.findLast((message: any) => message.role === "user");
      const child = h.app.store.projectThreads(project.id).find((thread) => thread.title === "Feilhjelper 1")!;
      assert.match(incoming.content, /Bevar meldingen etter feilen/);
      assert.ok(incoming.content.includes(`tråd-id: ${child.id}`));
      assert.ok(h.app.store.projectThreads(project.id).filter((thread) => thread.running).length <= MAX_AGENT_THREADS);
      resumed = true;
      return sse(openaiText("Den bevarte meldingen er behandlet etter ledig plass."))(req, res);
    }
    if (firstUser.includes("Feildel 1")) {
      childSteps++;
      if (childSteps === 1) {
        await replyGate;
        return sse(openaiToolCall("thread_send", { threadId: root.id, text: "Bevar meldingen etter feilen" }, "reply-before-error"))(req, res);
      }
    }
    return hang()(req, res);
  });
  await h.api("POST", `/api/threads/${root.id}/messages`, { text: "Koordiner og håndter feil" });
  await until(() => parentRequestPending, "the parent provider request is pending");
  releaseReply();
  await until(() => h.app.store.hasQueued(root.id) && childSteps >= 2, "the child's reply is queued while all four helpers remain busy");
  releaseFailure();
  const failed = await h.finished(root.id);
  assert.equal(ofType(failed, "run.finished")[0].status, "error");
  assert.equal(h.app.store.thread(root.id)!.running, false);
  assert.equal(h.app.store.hasQueued(root.id), true, "the reply survives without starting a fifth agent run");
  assert.equal(resumed, false);
  assert.equal(h.app.store.projectThreads(project.id).filter((thread) => thread.running).length, MAX_AGENT_THREADS);
  assert.equal(await h.app.runner.waitIdle(root.id, 10, new AbortController().signal), false, "a pending queue is not reported as a completed thread");
  const childToStop = h.app.store.projectThreads(project.id).find((thread) => thread.title === "Feilhjelper 2")!;
  if (action !== "resume") {
    const waiting = h.app.runner.waitIdle(root.id, 5000, new AbortController().signal);
    if (action === "stop") {
      const result = await h.api("POST", `/api/threads/${root.id}/stop`);
      assert.equal(result.stopped, true);
    } else if (action === "stop-all") {
      const result = await h.api("POST", `/api/projects/${project.id}/stop-all`);
      assert.equal(result.stopped, MAX_AGENT_THREADS + 1, "idle queued parent is included in the stop operation");
    } else if (action === "archive") {
      await h.api("PATCH", `/api/threads/${root.id}`, { archived: true });
    } else {
      const result = await h.api("POST", "/api/threads/archive", { ids: [root.id], archived: true });
      assert.deepEqual(result.ids, [root.id]);
    }
    assert.equal(await waiting, true, "cancelling queued work releases existing waiters");
    assert.equal(h.app.store.hasQueued(root.id), false);
    assert.equal(await h.app.runner.waitIdle(root.id, 10, new AbortController().signal), true);
    if (action === "stop-all") {
      await until(() => h.app.store.projectThreads(project.id).every((thread) => !thread.running), "all project runs stopped without reviving the parent");
    } else {
      await h.api("POST", `/api/threads/${childToStop.id}/stop`);
      await until(() => !h.app.store.thread(childToStop.id)!.running, "the helper released capacity after cancelling the parent queue");
    }
    const preserved = (await h.events(root.id)).map((entry) => entry.event);
    assert.equal(resumed, false, "free capacity must not revive stopped or archived work");
    assert.equal(ofType(preserved, "run.started").length, 1);
    assert.equal(h.app.store.thread(root.id)!.running, false);
    assert.equal(ofType(preserved, "user.message").filter((event) => event.text === "Bevar meldingen etter feilen").length, 1, "the cancelled reply remains readable exactly once");
    assert.match(JSON.stringify(h.app.store.messages(root.id)), /Bevar meldingen etter feilen/);
    assert.equal(h.app.store.thread(root.id)!.archived, action === "archive" || action === "bulk-archive");
    await h.api("POST", `/api/projects/${project.id}/stop-all`);
    return;
  }
  await h.api("POST", `/api/threads/${childToStop.id}/stop`);
  const completed = await h.finished(root.id, 2);
  assert.equal(resumed, true);
  assert.equal(ofType(completed, "run.started").length, 2);
  assert.deepEqual(ofType(completed, "run.finished").map((event) => event.status), ["error", "done"]);
  assert.equal(h.app.store.hasQueued(root.id), false);
  assert.match(textOf(completed), /etter ledig plass/);
  await h.api("POST", `/api/projects/${project.id}/stop-all`);
});
}
