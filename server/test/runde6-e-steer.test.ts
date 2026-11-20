// Round 6, agent E: a message sent while the agent works can go into the running turn (steer)
// instead of waiting in the queue. It joins at the next step, never in the middle of a tool call.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ThreadEvent } from "../../shared/protocol.ts";
import { OPENAI_DONE, openaiChunk, openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, textOf, until, type Harness } from "./helpers.ts";

async function waitForApproval(h: Harness, threadId: string, index = 0) {
  let found: Extract<ThreadEvent, { type: "approval.requested" }> | undefined;
  await until(async () => {
    found = ofType((await h.events(threadId)).map((e) => e.event), "approval.requested")[index];
    return found !== undefined;
  }, "approval");
  return found!;
}

const types = (events: ThreadEvent[]) => events.map((e) => e.type);

async function fakeCodeThread(t: Parameters<typeof startHarness>[0]) {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", model.id);
  return { h, llm, project, thread };
}

test("steering during the provider response skips every unstarted call and supplies its result", async (t) => {
  const { h, llm, project, thread } = await fakeCodeThread(t);
  llm.reply(async (req, res) => {
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Ikke skriv noen filer", steer: true });
    const tool_calls = [
      { index: 0, id: "list", type: "function", function: { name: "list_dir", arguments: '{"path":"."}' } },
      { index: 1, id: "write", type: "function", function: { name: "write_file", arguments: '{"path":"ny.txt","content":"nei"}' } },
    ];
    return sse(openaiChunk({ role: "assistant", tool_calls }) + openaiChunk({}, "tool_calls") + OPENAI_DONE)(req, res);
  });
  llm.reply(sse(openaiText("Jeg skriver ingen filer.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Lag en fil" });
  const events = await h.finished(thread.id);
  assert.equal(existsSync(path.join(project.path, "ny.txt")), false);
  assert.deepEqual(ofType(events, "tool.started"), []);
  const messages = llm.requests[1].body.messages as Array<{ tool_call_id?: string; content: string }>;
  assert.deepEqual(messages.filter((message) => message.tool_call_id).map((message) => message.tool_call_id), ["list", "write"]);
  assert.ok(messages.filter((message) => message.tool_call_id).every((message) => message.content.includes("Ikke kjørt")));
  assert.equal(messages.at(-1)?.content, "Ikke skriv noen filer");
});

for (const control of ["planMode", "permissionMode"] as const) {
  test(`${control} changed during the provider response governs its write call`, async (t) => {
    const { h, llm, project, thread } = await fakeCodeThread(t);
    llm.reply(async (req, res) => {
      if (control === "planMode") await h.api("PATCH", `/api/threads/${thread.id}`, { planMode: true });
      else await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "ask" });
      return sse(openaiToolCall("write_file", { path: "ny.txt", content: "nei" }))(req, res);
    });
    llm.reply(sse(openaiText("Ingen filer endret.")));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Lag en fil" });
    await until(async () => (await h.events(thread.id)).some(({ event }) => event.type === "approval.requested" || event.type === "run.finished"), "the decision on the write");
    if (control === "permissionMode") {
      const [approval] = ofType((await h.events(thread.id)).map(({ event }) => event), "approval.requested");
      assert.ok(approval, "write must wait for approval");
      await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "deny" });
    }
    await h.finished(thread.id);
    assert.equal(existsSync(path.join(project.path, "ny.txt")), false);
  });
}

test("demo model: a steered message joins the running turn after the tool call that was waiting", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "ask" });
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  const approval = await waitForApproval(h, thread.id); // write_file waits for the user
  const sent = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp", steer: true });
  assert.deepEqual({ queued: sent.queued, steer: sent.steer }, { queued: true, steer: true });
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "allow" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.started").length, 1, "one turn, not two");
  const queued = ofType(events, "user.queued")[0];
  assert.equal(queued.steer, true);
  const order = types(events);
  const joined = events.findIndex((e) => e.type === "user.message" && e.messageId === sent.messageId);
  const written = events.findIndex((e) => e.type === "tool.finished" && e.status === "done" && ofType(events, "tool.started").some((s) => s.callId === e.callId && s.tool === "write_file"));
  assert.ok(written > 0 && joined > written, `the message joins after write_file finished: ${order.join(",")}`);
  assert.ok(joined < order.indexOf("run.finished"));
  assert.match(textOf(events.slice(joined)), /Dette er demo-modellen/, "the model answered the new message");
  assert.equal(ofType(events, "run.finished")[0].status, "done");
});

test("without steer the message waits in the queue, and Settings can make steering the default", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "ask" });
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  let approval = await waitForApproval(h, thread.id);
  const queued = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  assert.equal(queued.steer, false);
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "deny" });
  const events = await h.finished(thread.id, 2);
  assert.equal(ofType(events, "run.started").length, 2, "a turn of its own after the first");

  await assert.rejects(h.api("PATCH", "/api/settings", { busyMessages: "straks" }), /400/);
  assert.equal((await h.api("PATCH", "/api/settings", { busyMessages: "steer" })).busyMessages, "steer");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  approval = await waitForApproval(h, thread.id, 1);
  const steered = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  assert.equal(steered.steer, true, "the setting decides when the flag is left out");
  const explicit = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp igjen", steer: false });
  assert.equal(explicit.steer, false, "an explicit flag wins over the setting");
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "allow" });
  const after = await h.finished(thread.id, 4);
  assert.equal(ofType(after, "run.started").length, 4, "the steered message joined turn 3; the queued one got turn 4");
});

test("a queued message can be switched to steer while it waits", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "ask" });
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  const approval = await waitForApproval(h, thread.id);
  const queued = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hjelp" });
  assert.deepEqual(await h.api("PATCH", `/api/threads/${thread.id}/queue/${queued.messageId}`, { steer: true }), { messageId: queued.messageId, steer: true });
  await assert.rejects(h.api("PATCH", `/api/threads/${thread.id}/queue/finnes-ikke`, { steer: true }), /404/);
  await assert.rejects(h.api("PATCH", `/api/threads/${thread.id}/queue/${queued.messageId}`, { steer: "ja" }), /400/);
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "allow" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.started").length, 1);
  assert.ok(ofType(events, "user.message").some((m) => m.messageId === queued.messageId));
  await assert.rejects(h.api("PATCH", `/api/threads/${thread.id}/queue/${queued.messageId}`, { steer: false }), /404/, "it has left the queue");
});

test("fake OpenAI: a message steered in while the model writes its last answer gets its own step", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", model.id);
  let release!: () => void;
  const steered = new Promise<void>((resolve) => (release = resolve));
  llm.reply(sse(openaiToolCall("list_dir", { path: "." }, "l")));
  llm.reply(async (req, res) => {
    // The user sends while this answer is being written.
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Bruk heller tabell", steer: true });
    release();
    return sse(openaiText("Her er en liste."))(req, res);
  });
  llm.always(sse(openaiText("Her er en tabell.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "vis filene" });
  await steered;
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.started").length, 1);
  assert.equal(llm.requests.length, 3);
  const third = llm.requests[2].body.messages as any[];
  assert.equal(third.at(-1).role, "user");
  assert.equal(third.at(-1).content, "Bruk heller tabell");
  assert.equal(third.at(-2).content, "Her er en liste.", "the earlier answer stays in the history");
  assert.match(textOf(events), /Her er en liste\.Her er en tabell\./);
});

test("messages from other threads never steer", async (t) => {
  const h = await startHarness(t);
  await h.api("PATCH", "/api/settings", { busyMessages: "steer" });
  const project = await h.project(undefined, { permissionMode: "ask" });
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  const approval = await waitForApproval(h, thread.id);
  const result = h.app.runner.send(thread.id, { text: "fra en annen tråd", from: { threadId: "x", title: "Annen" } });
  assert.equal(result.steer, false);
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "deny" });
  await h.finished(thread.id, 2);
});
