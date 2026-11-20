// Threads that work together: the tools, every brake in section 12.3, and file conflicts.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ServerMessage, ThreadEvent } from "../../shared/protocol.ts";
import { Collab, MAX_AGENT_THREADS, MAX_DEPTH, MAX_THREAD_MESSAGES, type CollabHost } from "../src/agent/collab.ts";
import { EventLog } from "../src/agent/events.ts";
import { hang, httpError, openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, textOf, until, type Harness } from "./helpers.ts";

async function addFakeModel(h: Harness, llm: FakeLlm): Promise<string> {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  return (await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 })).id;
}

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });
const lastUserText = (body: any): string => body.messages.at(-1).content;

async function toolResults(h: Harness, threadId: string): Promise<Array<Extract<ThreadEvent, { type: "tool.finished" }>>> {
  return ofType((await h.events(threadId)).map((e) => e.event), "tool.finished");
}

test("the demo model creates a helper thread, waits and summarizes", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "a.txt"), "x");
  const thread = await h.thread(project.id);
  const socket = await h.socket();
  await send(h, thread.id, "samarbeid om dette");
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  const [spawned] = ofType(events, "thread.spawned");
  assert.equal(spawned.title, "Hjelpetråd");
  assert.match(textOf(events), /Hjelpetråden svarte/);
  assert.match(textOf(events), /1 oppføringer/);

  const child = h.app.store.thread(spawned.childThreadId)!;
  assert.equal(child.parentThreadId, thread.id);
  assert.equal(child.origin, "agent");
  assert.equal(child.projectId, project.id);
  const [message] = ofType((await h.events(child.id)).map((e) => e.event), "user.message");
  assert.deepEqual(message.from, { threadId: thread.id, title: "samarbeid om dette" });
  await socket.waitFor((m) => m.type === "thread.changed" && m.thread.id === child.id);
});

for (const parentUsesDefault of [false, true]) {
test(`API models run two parallel helpers through files, commands, tasks, send, read and wait (parent ${parentUsesDefault ? "uses default model" : "selects model"})`, async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const model = h.app.store.model(modelId)!;
  const helperModel = await h.api("POST", "/api/models", { providerId: model.providerId, name: "Hjelpermodell", model: "fake-helper", contextWindow: 100_000, effort: "low" });
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  if (parentUsesDefault) await h.api("PATCH", "/api/settings", { defaultModelId: modelId });
  await h.api("PATCH", `/api/threads/${root.id}`, { reasoning: "high", ...(parentUsesDefault ? { modelId: null } : {}) });
  const socket = await h.socket();
  let bothStarted!: () => void;
  const gate = new Promise<void>((resolve) => (bothStarted = resolve));
  const started = new Set<string>();
  const steps = new Map<string, number>();
  const childIds: string[] = [];
  llm.always(async (req, res) => {
    const prompt = String(req.body.messages.find((m: any) => m.role === "user").content);
    const n = (steps.get(prompt) ?? 0) + 1;
    steps.set(prompt, n);
    const call = (name: string, input: unknown) => sse(openaiToolCall(name, input, `${prompt}-${n}`))(req, res);
    if (prompt === "Utfør teamoppdraget") {
      assert.equal(req.body.model, "fake");
      if (n <= 2) return call("thread_create", { title: `Hjelper ${n}`, task: `Utfør del ${n}`, ...(n === 2 ? { model: helperModel.id } : parentUsesDefault ? { model: modelId } : {}) });
      if (!childIds.length) {
        for (const message of req.body.messages.filter((m: any) => m.role === "tool")) {
          const id = /tråd-id: ([\w-]+)/.exec(message.content)?.[1];
          if (id) childIds.push(id);
        }
      }
      if (n <= 4) return call("thread_wait", { threadId: childIds[n - 3], timeoutSeconds: 5 });
      if (n === 5) return call("thread_read", { threadId: childIds[0] });
      if (n === 6) return call("thread_send", { threadId: childIds[0], text: "Bekreft resultatet" });
      if (n === 7) return call("thread_wait", { threadId: childIds[0], timeoutSeconds: 5 });
      assert.match(req.body.messages.at(-1).content, /Bekreftet del 1/);
      return sse(openaiText("Begge delene er utført og bekreftet."))(req, res);
    }
    const part = /Utfør del (\d)/.exec(prompt)![1];
    assert.equal(req.body.model, part === "1" ? "fake" : "fake-helper");
    assert.equal(req.body.reasoning_effort, part === "1" ? "high" : "low");
    const offered = req.body.tools.map((tool: any) => tool.function.name);
    for (const name of ["write_file", "run_command", "task_add", "task_update"]) assert.ok(offered.includes(name));
    if (n === 1) {
      started.add(part);
      if (started.size === 2) bothStarted();
      await gate; // Neither helper can proceed unless both API runs really started in parallel.
      return call("task_add", { title: `Del ${part}` });
    }
    if (n === 2) return call("write_file", { path: `del-${part}.txt`, content: `Resultat ${part}\n` });
    if (n === 3) return call("run_command", { command: `node -e "process.stdout.write('Kontroll ${part} OK')"` });
    if (n === 4) {
      const task = h.app.store.tasks(project.id).find((task) => task.title === `Del ${part}`)!;
      return call("task_update", { id: task.id, status: "done" });
    }
    return sse(openaiText(n === 5 ? `Ferdig del ${part}` : `Bekreftet del ${part}`))(req, res);
  });
  await send(h, root.id, "Utfør teamoppdraget");
  const events = await h.finished(root.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.equal(ofType(events, "thread.spawned").length, 2);
  assert.equal(started.size, 2);
  assert.match(textOf(events), /Begge delene/);
  assert.deepEqual((await toolResults(h, root.id)).map((result) => result.status), Array(7).fill("done"));
  assert.match((await toolResults(h, root.id))[4].result!, /Assistent: Ferdig del 1/);
  for (const [index, id] of childIds.entries()) {
    const child = h.app.store.thread(id)!;
    assert.equal(child.parentThreadId, root.id);
    assert.equal(child.permissionCap, "full");
    assert.equal(child.modelId, index === 0 ? modelId : helperModel.id);
    assert.equal(child.reasoning, index === 0 ? "high" : null);
    assert.equal(readFileSync(path.join(project.path, `del-${index + 1}.txt`), "utf8"), `Resultat ${index + 1}\n`);
    const childEvents = (await h.events(id)).map((entry) => entry.event);
    assert.ok(ofType(childEvents, "tool.output").some((event) => event.text.includes(`Kontroll ${index + 1} OK`)));
    assert.ok(ofType(childEvents, "run.finished").every((event) => event.status === "done"));
  }
  assert.ok(h.app.store.tasks(project.id).every((task) => task.status === "done"));
  await socket.waitFor((message) => message.type === "project.tasks" && message.tasks.length === 2 && message.tasks.every((task) => task.status === "done"));
  // A fresh subscriber gets the persisted collaboration and command history after reconnect.
  const replay = await h.socket();
  replay.send({ type: "thread.subscribe", threadId: childIds[0], afterSeq: 0 });
  await replay.waitFor((message) => message.type === "thread.event" && message.envelope.event.type === "run.finished");
  assert.ok(replay.received.some((message) => message.type === "thread.event" && message.envelope.event.type === "tool.output"));
});
}

test("queued agent messages reserve capacity and stopping their recipient releases it", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  const busy = [await h.thread(project.id, "code", modelId), await h.thread(project.id, "code", modelId)];
  let n = 0;
  llm.always((req, res) => {
    if (req.body.messages[1].content !== "Fyll kapasiteten") return hang()(req, res);
    n++;
    if (n <= 3 || n === 6 || n === 9) return sse(openaiToolCall("thread_create", { title: `hjelper ${n}`, task: "Jobb" }, `c${n}`))(req, res);
    if (n === 4 || n === 5) return sse(openaiToolCall("thread_send", { threadId: busy[n - 4].id, text: "Køet agentoppdrag" }, `s${n}`))(req, res);
    if (n === 7) return sse(openaiToolCall("thread_send", { threadId: busy[0].id, text: "Oppdatering til samme agentplass" }, "update"))(req, res);
    return sse(openaiText("ferdig"))(req, res);
  });
  for (const thread of busy) await send(h, thread.id, "Brukerarbeid");
  await until(() => llm.requests.length === 2, "both user runs started");
  await send(h, root.id, "Fyll kapasiteten");
  await h.finished(root.id);
  assert.deepEqual((await toolResults(h, root.id)).map((result) => result.status), ["done", "done", "done", "done", "error", "error", "done"]);
  assert.equal(ofType((await h.events(busy[0].id)).map((entry) => entry.event), "user.queued").length, 2);
  assert.equal(ofType((await h.events(busy[1].id)).map((entry) => entry.event), "user.queued").length, 0);
  await h.api("POST", `/api/threads/${busy[0].id}/stop`);
  await h.finished(busy[0].id);
  assert.equal(h.app.store.hasQueued(busy[0].id), false);
  await send(h, root.id, "Bruk plassen som ble ledig");
  await h.finished(root.id, 2);
  assert.equal((await toolResults(h, root.id)).at(-1)!.status, "done");
  assert.equal(h.app.store.projectThreads(project.id).filter((thread) => thread.origin === "agent").length, 4);
  await h.api("POST", `/api/projects/${project.id}/stop-all`);
});

for (const outcome of ["done", "error"] as const) {
  test(`queued agent reservation releases after ${outcome}, and wait reports the latest run`, async (t) => {
    const h = await startHarness(t);
    const llm = await startFakeLlm(t);
    const modelId = await addFakeModel(h, llm);
    const project = await h.project(undefined, { permissionMode: "full" });
    const root = await h.thread(project.id, "code", modelId);
    const busy = await h.thread(project.id, "code", modelId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let n = 0;
    llm.always(async (req, res) => {
      if (req.body.messages[1].content === "Brukerarbeid") {
        const followup = req.body.messages.some((message: any) => String(message.content).includes("Køet agentoppdrag"));
        if (followup) return (outcome === "error" ? httpError(400, { error: { message: "Avvist agentoppdrag" } }) : sse(openaiText("Nytt agentsvar")))(req, res);
        await gate;
        return sse(openaiText("Tidligere brukersvar"))(req, res);
      }
      if (req.body.messages[1].content !== "Fyll kapasiteten") return hang()(req, res);
      n++;
      if (n <= 3 || n === 6) return sse(openaiToolCall("thread_create", { title: `hjelper ${n}`, task: "Jobb" }, `c${n}`))(req, res);
      if (n === 4) return sse(openaiToolCall("thread_send", { threadId: busy.id, text: "Køet agentoppdrag" }, "send"))(req, res);
      if (n === 5) return sse(openaiToolCall("thread_wait", { threadId: busy.id, timeoutSeconds: 5 }, "wait"))(req, res);
      return sse(openaiText("ferdig"))(req, res);
    });
    await send(h, busy.id, "Brukerarbeid");
    await until(() => llm.requests.length === 1, "user run started");
    await send(h, root.id, "Fyll kapasiteten");
    await until(async () => ofType((await h.events(busy.id)).map((entry) => entry.event), "user.queued").length === 1, "agent message queued");
    release();
    await h.finished(root.id);
    const results = await toolResults(h, root.id);
    assert.equal(results[4].status, outcome === "done" ? "done" : "error");
    assert.match(results[4].result!, outcome === "done" ? /Nytt agentsvar/ : /status error/);
    assert.equal(results[5].status, "done", "the released slot can immediately start another helper");
    assert.equal(h.app.store.projectThreads(project.id).filter((thread) => thread.origin === "agent").length, 4);
    assert.equal(h.app.store.lastRun(busy.id)!.status, outcome);
    await h.api("POST", `/api/projects/${project.id}/stop-all`);
  });
}

test("restart preserves helper links and queued messages without restarting API work", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  let n = 0;
  let childId = "";
  llm.always((req, res) => {
    if (req.body.messages.at(-1).content === "Fortsett etter omstart") return sse(openaiText("Fortsetter trygt"))(req, res);
    if (req.body.messages[1].content !== "Lag vedvarende hjelper") return hang()(req, res);
    n++;
    if (n === 1) return sse(openaiToolCall("thread_create", { title: "Vedvarende hjelper", task: "Arbeid lenge" }, "create"))(req, res);
    childId ||= /tråd-id: ([\w-]+)/.exec(req.body.messages.find((message: any) => message.role === "tool").content)![1];
    if (n === 2) return sse(openaiToolCall("thread_send", { threadId: childId, text: "Bevar denne beskjeden" }, "send"))(req, res);
    return sse(openaiToolCall("thread_wait", { threadId: childId }, "wait"))(req, res);
  });
  await send(h, root.id, "Lag vedvarende hjelper");
  await until(async () => (await toolResults(h, root.id)).length === 2 && ofType((await h.events(root.id)).map((entry) => entry.event), "tool.started").some((event) => event.tool === "thread_wait"), "helper queued and parent waiting");
  const dataDir = h.app.config.dataDir;
  await h.app.close();
  const requestsBeforeRestart = llm.requests.length;
  const { startApp } = await import("../src/app.ts");
  const restored = await startApp({
    dataDir, port: 0, keyring: h.keyring, mockDelayMs: 0,
    configDir: path.join(dataDir, "no-config"), userSkillsDir: path.join(dataDir, "no-user-skills"),
    appSkillsDir: path.join(dataDir, "no-app-skills"), webDist: path.join(dataDir, "no-dist"), seedDefaults: false,
  });
  try {
    assert.equal(llm.requests.length, requestsBeforeRestart, "restart makes no provider requests");
    const child = restored.store.thread(childId)!;
    assert.equal(child.parentThreadId, root.id);
    assert.equal(child.origin, "agent");
    assert.equal(child.permissionCap, "full");
    assert.equal(child.modelId, modelId);
    for (const id of [root.id, childId]) {
      assert.equal(restored.store.lastRun(id)!.status, "interrupted");
      assert.equal(restored.store.thread(id)!.running, false);
      assert.equal(restored.store.hasQueued(id), false);
    }
    assert.match(JSON.stringify(restored.store.messages(childId)), /Bevar denne beskjeden/);
    const events = restored.store.events(root.id, 0, 1000).map((entry) => entry.event);
    assert.equal(ofType(events, "tool.finished").at(-1)!.status, "cancelled");
    restored.runner.send(root.id, { text: "Fortsett etter omstart" });
    await until(() => !restored.store.thread(root.id)!.running, "resumed API turn finished");
    assert.equal(restored.store.lastRun(root.id)!.status, "done");
    assert.match(JSON.stringify(restored.store.messages(root.id)), /Fortsetter trygt/);
  } finally {
    await restored.close();
  }
});

test("thread_list, thread_read and thread_send between threads", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const a = await h.thread(project.id, "code", modelId);
  const b = await h.thread(project.id, "code", modelId);
  const otherProject = await h.project();
  const stranger = await h.thread(otherProject.id, "code", modelId);

  const script: Array<[string, Record<string, unknown>]> = [
    ["thread_list", {}],
    ["thread_read", { threadId: b.id }],
    ["thread_read", { threadId: stranger.id }],
    ["thread_send", { threadId: b.id, text: "Hallo B" }],
    ["thread_send", { threadId: a.id, text: "Til meg selv" }],
  ];
  llm.always((req, res) => {
    if (req.body.messages[1].content !== "Samarbeid") return sse(openaiText("Hei fra B"))(req, res);
    const step = script.shift();
    return sse(step ? openaiToolCall(step[0], step[1], `c${script.length}`) : openaiText("ferdig"))(req, res);
  });
  await send(h, b.id, "Si hei");
  await h.finished(b.id);
  await send(h, a.id, "Samarbeid");
  await h.finished(a.id);
  const results = await toolResults(h, a.id);
  assert.match(results[0].result!, new RegExp(b.id));
  assert.match(results[0].result!, /denne tråden/);
  assert.match(results[1].result!, /Assistent: Hei fra B/);
  assert.ok(!results[1].result!.includes("tool"), "no tool details");
  assert.equal(results[2].status, "error", "threads in another project are out of reach");
  assert.equal(results[3].status, "done");
  assert.equal(results[4].status, "error");

  const events = await h.finished(b.id, 2);
  const received = ofType(events, "user.message").at(-1)!;
  assert.equal(received.text, "Hallo B");
  assert.equal(received.from!.threadId, a.id);
  assert.match(JSON.stringify(h.app.store.messages(b.id)), /Melding fra tråden/);
});

test("full helper capacity still allows replies to busy ancestors, but no new peer run", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id);
  const children = Array.from({ length: MAX_AGENT_THREADS }, (_, i) => h.app.store.createThread(project.id, "code", root.modelId, { title: `Hjelper ${i}`, parentThreadId: root.id }));
  const peer = await h.thread(project.id);
  const otherProject = await h.project();
  const stranger = await h.thread(otherProject.id);
  const sent: Array<{ id: string; fromId: string }> = [];
  let rootBusy = true;
  const host: CollabHost = {
    sendFromThread: (id, _text, from) => { sent.push({ id, fromId: from.threadId }); },
    chainOf: () => "chain",
    runningAgentThreads: () => MAX_AGENT_THREADS,
    hasAgentSlot: (id) => children.some((child) => child.id === id),
    isBusy: (id) => id === root.id ? rootBusy : true,
    waitIdle: async () => false,
    threadChanged: () => {},
  };
  const collab = new Collab(h.app.store, new EventLog(h.app.store, () => {}), host);
  const result = collab.send(children[0], "run", { threadId: root.id, text: "Status fra barnet" });
  assert.equal(result.isError, undefined);
  assert.match(result.text, /pågående arbeid/);
  assert.deepEqual(sent, [{ id: root.id, fromId: children[0].id }]);
  assert.equal(collab.send(children[0], "run", { threadId: peer.id, text: "Start et nytt oppdrag" }).isError, true);
  rootBusy = false;
  assert.equal(collab.send(children[0], "run", { threadId: root.id, text: "Start forelderen" }).isError, true, "an idle ancestor still requires a free helper slot");
  assert.equal(collab.send(children[0], "run", { threadId: stranger.id, text: "Kryss prosjektgrensen" }).isError, true);
  assert.equal(sent.length, 1);
  const listedChild = collab.list(children[0]).split("\n").find((line) => line.startsWith(children[0].id))!;
  assert.ok(listedChild.includes(`overordnet: ${root.id}`));
  assert.match(listedChild, /denne tråden/);
  // Even malformed cyclic ancestry must terminate when an unrelated peer is queried.
  const cyclic = { ...children[0], parentThreadId: children[0].id };
  assert.equal(collab.send(cyclic, "run", { threadId: peer.id, text: "Syklus" }).isError, true);
});

test("thread_wait yields to incoming messages without presenting a stale final answer", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const root = await h.thread(project.id);
  const child = h.app.store.createThread(project.id, "code", root.modelId, { title: "Hjelper", parentThreadId: root.id });
  h.app.store.appendMessage(child.id, { role: "assistant", content: [{ type: "text", text: "Et gammelt svar" }] });
  const host: CollabHost = {
    sendFromThread: () => {},
    chainOf: () => "chain",
    runningAgentThreads: () => 1,
    hasAgentSlot: () => true,
    isBusy: () => true,
    waitIdle: async (id, _ms, _signal, requester) => {
      assert.equal(id, child.id);
      assert.equal(requester, root.id);
      return false;
    },
    hasIncomingMessage: (id) => id === root.id,
    threadChanged: () => {},
  };
  const collab = new Collab(h.app.store, new EventLog(h.app.store, () => {}), host);
  const result = await collab.wait(root, { threadId: child.id }, new AbortController().signal);
  assert.equal(result.isError, undefined);
  assert.match(result.text, /ny melding/);
  assert.ok(!result.text.includes("Et gammelt svar"));
  assert.ok(!result.text.includes("Tidsavbrudd"));
});

test("thread_send queues while the other thread works, and thread_wait times out", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const a = await h.thread(project.id, "code", modelId);
  const b = await h.thread(project.id, "code", modelId);
  llm.reply(hang());
  await send(h, b.id, "Jobb lenge");
  await until(() => llm.requests.length === 1, "b started");

  llm.reply(sse(openaiToolCall("thread_send", { threadId: b.id, text: "Husk dette" }, "1")));
  llm.reply(sse(openaiToolCall("thread_wait", { threadId: b.id, timeoutSeconds: 1 }, "2")));
  llm.reply(sse(openaiText("ferdig")));
  await send(h, a.id, "Send");
  await h.finished(a.id);
  const results = await toolResults(h, a.id);
  assert.match(results[0].result!, /kø/);
  assert.match(results[1].result!, /Tidsavbrudd/);
  const queued = ofType((await h.events(b.id)).map((e) => e.event), "user.queued");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].from!.threadId, a.id);
  await h.api("POST", `/api/threads/${b.id}/stop`);
  await h.finished(b.id);
});

test("brake: depth stops at 2", async (t) => {
  assert.equal(MAX_DEPTH, 2);
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  llm.always((req, res) => {
    const text = lastUserText(req.body);
    if (req.body.messages.at(-1).role === "tool") return sse(openaiText("ok"))(req, res);
    const level = Number(/nivå (\d)/.exec(text)?.[1] ?? 0);
    return sse(openaiToolCall("thread_create", { title: `nivå ${level + 1}`, task: `nivå ${level + 1}` }, `c${level}`))(req, res);
  });
  await send(h, root.id, "nivå 0");
  await h.finished(root.id);
  const levelOne = ofType((await h.events(root.id)).map((e) => e.event), "thread.spawned")[0].childThreadId;
  await h.finished(levelOne);
  const levelTwo = ofType((await h.events(levelOne)).map((e) => e.event), "thread.spawned")[0].childThreadId;
  await h.finished(levelTwo);
  assert.equal(ofType((await h.events(levelTwo)).map((e) => e.event), "thread.spawned").length, 0);
  const [refused] = await toolResults(h, levelTwo);
  assert.equal(refused.status, "error");
  assert.match(refused.result!, /dypere enn 2/);
  assert.equal(h.app.store.projectThreads(project.id).length, 3);
});

test("brake: at most 4 agent-started threads run at once per project", async (t) => {
  assert.equal(MAX_AGENT_THREADS, 4);
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = await h.thread(project.id, "code", modelId);
  const idle = await h.thread(project.id, "code", modelId);
  let n = 0;
  llm.always((req, res) => {
    const parent = req.body.messages[1].content === "Start mange";
    if (!parent) return hang()(req, res); // The helpers keep working.
    n++;
    if (n <= 5) return sse(openaiToolCall("thread_create", { title: `hjelper ${n}`, task: "Jobb" }, `c${n}`))(req, res);
    if (n === 6) return sse(openaiToolCall("thread_send", { threadId: idle.id, text: "Våkn" }, "s"))(req, res);
    return sse(openaiText("ferdig"))(req, res);
  });
  await send(h, root.id, "Start mange");
  await h.finished(root.id);
  const results = await toolResults(h, root.id);
  assert.deepEqual(results.map((r) => r.status), ["done", "done", "done", "done", "error", "error"]);
  assert.match(results[4].result!, /Grensen er nådd/);
  assert.match(results[5].result!, /Grensen er nådd/, "thread_send to an idle thread starts a run, so it counts");
  assert.equal(h.app.store.projectThreads(project.id).filter((x) => x.running).length, 4);

  // Stop all stops everything with one call.
  const { stopped } = await h.api("POST", `/api/projects/${project.id}/stop-all`);
  assert.equal(stopped, 4);
  await until(() => h.app.store.projectThreads(project.id).every((x) => !x.running), "all stopped");
});

test("brake: 20 messages between threads per user message, then the app asks", async (t) => {
  assert.equal(MAX_THREAD_MESSAGES, 20);
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const a = await h.thread(project.id, "code", modelId);
  const b = await h.thread(project.id, "code", modelId);
  let n = 0;
  llm.always((req, res) => {
    if (req.body.messages.some((m: any) => String(m.content).includes("Melding fra tråden"))) return sse(openaiText("mottatt"))(req, res);
    n++;
    return sse(n <= 21 ? openaiToolCall("thread_send", { threadId: b.id, text: `melding ${n}` }, `c${n}`) : openaiText("ferdig"))(req, res);
  });
  await send(h, a.id, "Snakk med B");
  let approval: Extract<ThreadEvent, { type: "approval.requested" }> | undefined;
  await until(async () => {
    approval = ofType((await h.events(a.id)).map((e) => e.event), "approval.requested")[0];
    return approval !== undefined;
  }, "the brake to ask");
  assert.match(approval!.title, /20 meldinger/);
  assert.equal(approval!.canAllowAlways, false, "a brake cannot be waved through forever");
  assert.equal((await toolResults(h, a.id)).filter((r) => r.status === "done").length, 20, "full access does not skip the brake");
  await h.api("POST", `/api/approvals/${approval!.approvalId}`, { decision: "deny" });
  await h.finished(a.id);
  const results = await toolResults(h, a.id);
  assert.equal(results.at(-1)!.status, "denied");
  assert.match(results.at(-1)!.result!, /avslo/);
});

test("brake: the count is per user message, and approval grants more", async () => {
  const { Collab } = await import("../src/agent/collab.ts");
  const collab = new Collab({} as never, {} as never, {} as never);
  (collab as any).sent.set("x", 20);
  assert.equal(collab.overBudget("x"), true);
  assert.equal(collab.overBudget("y"), false);
  collab.grant("x");
  assert.equal(collab.overBudget("x"), false);
});

test("brake: a thread never gets a higher permission mode than its creator", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "accept-edits" });
  const root = await h.thread(project.id, "code", modelId);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  llm.always(async (req, res) => {
    const isChild = String(req.body.messages[1].content).startsWith("[Melding");
    const answered = req.body.messages.at(-1).role === "tool";
    if (answered) return sse(openaiText("ok"))(req, res);
    if (!isChild) return sse(openaiToolCall("thread_create", { title: "barn", task: "kjør" }, "c"))(req, res);
    await gate; // Raise the project before the child reaches its command.
    return sse(openaiToolCall("run_command", { command: "echo barn" }, "d"))(req, res);
  });
  await send(h, root.id, "Lag barn");
  await until(async () => ofType((await h.events(root.id)).map((e) => e.event), "approval.requested").length > 0, "approval");
  const [first] = ofType((await h.events(root.id)).map((e) => e.event), "approval.requested");
  await h.api("POST", `/api/approvals/${first.approvalId}`, { decision: "allow" });
  await h.finished(root.id);
  const child = h.app.store.projectThreads(project.id).find((x) => x.origin === "agent")!;
  assert.equal(child.permissionCap, "accept-edits");

  // Raising the project does not raise the child above what its creator had.
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  release();
  await until(async () => ofType((await h.events(child.id)).map((e) => e.event), "approval.requested").length > 0, "child approval");
  const [asked] = ofType((await h.events(child.id)).map((e) => e.event), "approval.requested");
  assert.match(asked.title, /run_command/, "the approval shows up in the thread it belongs to");
  assert.equal(h.app.store.thread(child.id)!.pendingApprovals, 1);
  assert.equal(h.app.store.thread(root.id)!.pendingApprovals, 0);
  await h.api("POST", `/api/approvals/${asked.approvalId}`, { decision: "deny" });
  await h.finished(child.id);
});

test("stop all clears a project's threads but leaves other projects alone", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const one = await h.project();
  const two = await h.project();
  const a = await h.thread(one.id, "chat", modelId);
  const b = await h.thread(one.id, "chat", modelId);
  const c = await h.thread(two.id, "chat", modelId);
  llm.always(hang());
  for (const thread of [a, b, c]) await send(h, thread.id, "jobb");
  await until(() => llm.requests.length === 3, "started");
  assert.equal((await h.api("POST", `/api/projects/${one.id}/stop-all`)).stopped, 2);
  await h.finished(a.id);
  await h.finished(b.id);
  assert.equal(h.app.store.thread(c.id)!.running, true);
  await h.api("POST", `/api/threads/${c.id}/stop`);
  await h.finished(c.id);
});

test("conflict: write_file needs a read first, and refuses a file changed since", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const file = path.join(project.path, "delt.txt");
  writeFileSync(file, "original\n");
  const thread = await h.thread(project.id, "code", modelId);
  const write = (content: string, id: string) => sse(openaiToolCall("write_file", { path: "delt.txt", content }, id));
  llm.reply(write("uten å lese\n", "a"));
  llm.reply(sse(openaiToolCall("read_file", { path: "delt.txt" }, "b")));
  llm.reply(async (req, res) => {
    writeFileSync(file, "endret av noen andre\n"); // Between the read and the write.
    await write("etter lesing\n", "c")(req, res);
  });
  llm.reply(sse(openaiToolCall("read_file", { path: "delt.txt" }, "d")));
  llm.reply(write("nå går det\n", "e"));
  llm.reply(write("egen skriving teller som lest\n", "f"));
  llm.reply(sse(openaiToolCall("write_file", { path: "helt-ny.txt", content: "ny\n" }, "g")));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "skriv");
  await h.finished(thread.id);
  const results = await toolResults(h, thread.id);
  assert.deepEqual(results.map((r) => r.status), ["error", "done", "error", "done", "done", "done", "done"]);
  assert.match(results[0].result!, /Les filen med read_file/);
  assert.match(results[2].result!, /endret siden du leste/);
  assert.equal(readFileSync(file, "utf8"), "egen skriving teller som lest\n");
});

test("conflict: edit_file fails clearly when the text is gone", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "a.txt"), "den nye teksten\n");
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("edit_file", { path: "a.txt", old_string: "den gamle teksten", new_string: "x" }, "a")));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "endre");
  await h.finished(thread.id);
  const [result] = await toolResults(h, thread.id);
  assert.equal(result.status, "error");
  assert.match(result.result!, /finnes ikke lenger/);
});

test("conflict: two threads writing the same file take turns, and the second must read again", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await addFakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const file = path.join(project.path, "delt.txt");
  writeFileSync(file, "start\n");
  const a = await h.thread(project.id, "code", modelId);
  const b = await h.thread(project.id, "code", modelId);
  await h.api("PATCH", `/api/threads/${a.id}`, { title: "a" });
  await h.api("PATCH", `/api/threads/${b.id}`, { title: "b" });
  let bothRead!: () => void;
  const gate = new Promise<void>((resolve) => (bothRead = resolve));
  let reads = 0;
  llm.always(async (req, res) => {
    const who = String(req.body.messages[1].content);
    const last = req.body.messages.at(-1);
    if (last.role === "user") return sse(openaiToolCall("read_file", { path: "delt.txt" }, `${who}1`))(req, res);
    if (last.tool_call_id === `${who}1`) {
      if (++reads === 2) bothRead();
      await gate;
      return sse(openaiToolCall("write_file", { path: "delt.txt", content: `skrevet av ${who}\n` }, `${who}2`))(req, res);
    }
    return sse(openaiText("ferdig"))(req, res);
  });
  await Promise.all([send(h, a.id, "a"), send(h, b.id, "b")]);
  await Promise.all([h.finished(a.id), h.finished(b.id)]);
  const writes = [(await toolResults(h, a.id))[1], (await toolResults(h, b.id))[1]];
  assert.deepEqual(writes.map((w) => w.status).sort(), ["done", "error"], "exactly one write wins");
  assert.match(writes.find((w) => w.status === "error")!.result!, /endret siden du leste/);
  assert.match(readFileSync(file, "utf8"), /^skrevet av [ab]\n$/);
});

test("writes to the same file run one at a time", async () => {
  const { FileState } = await import("../src/agent/filestate.ts");
  const files = new FileState();
  const order: string[] = [];
  const job = (name: string, ms: number) => files.exclusive("/x", async () => {
    order.push(`${name} start`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(`${name} slutt`);
  });
  await Promise.all([job("a", 20), job("b", 1), job("c", 1)]);
  assert.deepEqual(order, ["a start", "a slutt", "b start", "b slutt", "c start", "c slutt"]);
});

test("several windows see the same thread, and project usage is pushed", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "chat");
  const [one, two] = await Promise.all([h.socket(), h.socket()]);
  for (const socket of [one, two]) socket.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 0 });
  await send(h, thread.id, "Hei");
  const done = (m: ServerMessage) => m.type === "thread.event" && m.envelope.event.type === "run.finished";
  await Promise.all([one.waitFor(done), two.waitFor(done)]);
  const seqs = (socket: typeof one) => socket.received.flatMap((m) => (m.type === "thread.event" ? [m.envelope.seq] : []));
  assert.deepEqual(seqs(one), seqs(two));
  assert.equal(new Set(seqs(one)).size, seqs(one).length);
  await one.waitFor((m) => m.type === "project.usage" && m.projectId === project.id);
});
