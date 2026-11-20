import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { OPENAI_DONE, openaiChunk, openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, rawRequest, startHarness, tempDir, until, type Harness } from "./helpers.ts";
import type { ThreadEvent } from "../../shared/protocol.ts";

const input = { questions: [{ id: "choice", question: "Hvilket format?", options: [{ label: "Kort" }, { label: "Langt" }] }] };
const answer = [{ questionId: "choice", selectedOptions: ["Kort"], text: "På norsk." }];

async function setup(t: TestContext, mode: "chat" | "code" = "chat") {
  const h = await startHarness(t, { localWorkspace: true, homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: `${llm.url}/v1`, apiKey: "test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "fake", contextWindow: 100_000 });
  const thread = await h.thread(null, mode, model.id);
  llm.always((req, res) => sse(req.body.messages.some((message: any) => message.role === "tool")
    ? openaiText("Ferdig") : openaiToolCall("ask_user", input, "ask-1"))(req, res));
  return { h, llm, thread };
}

async function question(h: Harness, threadId: string) {
  let requested: Extract<ThreadEvent, { type: "question.requested" }> | undefined;
  await until(async () => !!(requested = ofType((await h.events(threadId)).map(({ event }) => event), "question.requested")[0]), "spørsmålet vises");
  return requested!;
}

test("spørsmål i lokal Kode respekterer planmodus, avviser fremmede svar og leverer full JSON med hook-tilbakemelding", async (t) => {
  const { h, llm, thread } = await setup(t, "code");
  await h.api("PATCH", `/api/threads/${thread.id}`, { planMode: true });
  await h.api("POST", "/api/hooks", { event: "PostToolUse", name: "Spørsmål", matcher: "request_user_input", modes: ["code"], command: "echo Veiledning >&2; exit 2" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Spør først" });
  const request = await question(h, thread.id);
  const path = `/api/threads/${thread.id}/questions/${request.requestId}`;
  const names = llm.requests[0].body.tools.map((tool: any) => tool.function.name);
  assert.ok(names.includes("request_user_input") && names.includes("read_file"));
  assert.ok(!names.some((name: string) => /^(thread_|task_|browser_|run_command$)/.test(name)));
  assert.equal((await rawRequest(h.app.port, "POST", path, { headers: { origin: h.origin } })).status, 401);
  await assert.rejects(h.api("POST", path, { runId: "feil", answers: answer }), { status: 409 });
  await assert.rejects(h.api("POST", path, { runId: request.runId, answers: [{ ...answer[0], selectedOptions: ["Kort", "Langt"] }] }), { status: 400 });
  const other = await h.thread(null, "chat");
  await assert.rejects(h.api("POST", `/api/threads/${other.id}/questions/${request.requestId}`, { runId: request.runId, answers: answer }), { status: 404 });
  const answers = [{ ...answer[0], text: "ø".repeat(8000) }];
  await h.api("POST", path, { runId: request.runId, answers });
  await assert.rejects(h.api("POST", path, { runId: request.runId, answers }), { status: 404 });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  const tool = llm.requests[1].body.messages.find((message: any) => message.role === "tool");
  assert.equal(tool.tool_call_id, "ask-1");
  const result = JSON.parse(tool.content);
  assert.deepEqual(result.answers, answers);
  assert.equal(result.cancelled, false);
  assert.match(result.hookFeedback[0], /Veiledning/);
});

test("PreToolUse kan stoppe et spørsmål før kortet opprettes", async (t) => {
  const { h, thread } = await setup(t);
  await h.api("POST", "/api/hooks", { event: "PreToolUse", name: "Ingen spørsmål", matcher: "request_user_input", modes: ["chat"], command: "exit 2" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Spør" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "tool.finished")[0].status, "denied");
  assert.equal(ofType(events, "question.requested").length, 0);
});

test("Stopp ved spørrekort starter ikke neste verktøy eller godkjenning i samme steg", async (t) => {
  const { h, llm, thread } = await setup(t, "code");
  llm.reply(sse(openaiChunk({ role: "assistant", tool_calls: [
    { index: 0, id: "ask", type: "function", function: { name: "ask_user", arguments: JSON.stringify(input) } },
    { index: 1, id: "write", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "stopp.txt", content: "test" }) } },
  ] }) + openaiChunk({}, "tool_calls") + OPENAI_DONE));
  const base = `/api/threads/${thread.id}`;
  await h.api("POST", `${base}/messages`, { text: "Spør først" });
  const request = await question(h, thread.id);
  await h.api("POST", `${base}/stop`);
  await assert.rejects(h.api("POST", `${base}/questions/${request.requestId}`, { runId: request.runId, answers: answer }), { status: 404 });
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "tool.started").map(event => event.callId), ["ask"]);
  assert.equal(ofType(events, "approval.requested").length, 0);
  assert.equal(llm.requests.length, 1);
});

for (const action of ["steer", "stop", "archive", "bulk-archive"] as const) {
  test(`${action} lukker spørsmålet uten å behandle det som et svar`, async (t) => {
    const { h, llm, thread } = await setup(t);
    const base = `/api/threads/${thread.id}`;
    await h.api("POST", `${base}/messages`, { text: "Spør" });
    const request = await question(h, thread.id);
    const queued = await h.api("POST", `${base}/messages`, { text: "Gjør noe annet", steer: false });
    assert.equal(queued.queued, true);
    assert.equal(h.app.store.thread(thread.id)?.pendingQuestions, 1);
    if (action === "steer") await h.api("PATCH", `${base}/queue/${queued.messageId}`, { steer: true });
    if (action === "stop") await h.api("POST", `${base}/stop`);
    if (action === "archive") await h.api("PATCH", base, { archived: true });
    if (action === "bulk-archive") await h.api("POST", "/api/threads/archive", { ids: [thread.id] });
    const events = await h.finished(thread.id);
    const closed = ofType(events, "question.resolved");
    assert.equal(closed.length, 1);
    assert.equal(closed[0].reason, action === "steer" ? "steered" : "stopped");
    assert.deepEqual(closed[0].answers, []);
    await assert.rejects(h.api("POST", `${base}/questions/${request.requestId}`, { runId: request.runId, answers: answer }), { status: 404 });
    if (action === "steer") assert.match(JSON.stringify(llm.requests[1].body.messages.at(-1)), /Gjør noe annet/);
    else assert.equal(llm.requests.length, 1);
  });
}
