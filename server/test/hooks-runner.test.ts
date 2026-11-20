// Hooks in real turns: the runner, the settings API and the conversation. The model is the local
// fake LLM (fake-llm.ts) or the demo model; every hook only touches temporary folders.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { HooksState } from "../../shared/hooks.ts";
import { MOCK_MODEL_ID } from "../src/db.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm, hang, httpError, type FakeLlm } from "./fake-llm.ts";
import { ofType, rawRequest, startHarness, tempDir, textOf, until, type Harness } from "./helpers.ts";

const SECRET = "sk-hemmelig-testnokkel-4711";
const quote = (file: string) => `'${file.replace(/'/g, `'\\''`)}'`;

async function fakeModel(h: Harness, llm: FakeLlm) {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: `${llm.url}/v1`, apiKey: SECRET });
  return h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "fake", contextWindow: 100_000 });
}

async function addHook(h: Harness, body: Record<string, unknown>): Promise<string> {
  const state = await h.api<HooksState>("POST", "/api/hooks", body);
  return state.hooks.at(-1)!.id;
}

// One tool call, then a short answer, whatever the conversation is.
function toolThenText(llm: FakeLlm, name: string, input: unknown, answer = "Ferdig.") {
  llm.always((req, res) => {
    const last = req.body.messages.at(-1);
    return sse(last?.role === "tool" ? openaiText(answer) : openaiToolCall(name, input, "call-1"))(req, res);
  });
}

async function setup(t: Parameters<typeof startHarness>[0]) {
  const home = tempDir(t, "ad-hooks-home-");
  const h = await startHarness(t, { homeDir: home });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(h, llm);
  const out = tempDir(t, "ad-hooks-out-");
  return { h, llm, model, out, home };
}

test("PreToolUse: exit 2 stops run_command after approval, the model reads the reason, and the conversation shows the hook", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  mkdirSync(path.join(project.path, "build"));
  // The ready-made example from the settings page, unchanged.
  await addHook(h, {
    name: "Ingen rm -rf", event: "PreToolUse", matcher: "run_command", modes: ["code"],
    command: `cat > ${quote(path.join(out, "pre.json"))}; if grep -Eq 'rm[[:space:]]+-[[:alpha:]]*(r[[:alpha:]]*f|f[[:alpha:]]*r)' ${quote(path.join(out, "pre.json"))}; then echo "rm -rf er sperret av en hook." >&2; exit 2; fi`,
  });
  toolThenText(llm, "run_command", { command: "rm -rf build" });
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Rydd" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.ok(existsSync(path.join(project.path, "build")), "the command never ran");
  const finished = ofType(events, "tool.finished")[0];
  assert.equal(finished.status, "denied");
  assert.match(finished.result!, /Stoppet av hooken «Ingen rm -rf».*\n.*rm -rf er sperret av en hook\./s);
  const hookRow = ofType(events, "hook.ran")[0];
  assert.equal(hookRow.effect, "blocked");
  assert.equal(hookRow.callId, "call-1");
  assert.equal(hookRow.exitCode, 2);
  assert.match(JSON.stringify(llm.requests[1].body.messages), /rm -rf er sperret av en hook/);
  const payload = JSON.parse(readFileSync(path.join(out, "pre.json"), "utf8"));
  assert.deepEqual({ ...payload }, { hook_event_name: "PreToolUse", session_id: thread.id, cwd: project.path, mode: "code", tool_name: "run_command", tool_input: { command: "rm -rf build" }, tool_use_id: "call-1" });

  // A harmless command goes through, and the hook's run shows in Innstillinger.
  toolThenText(llm, "run_command", { command: "echo trygt" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Igjen" });
  const second = await h.finished(thread.id, 2);
  assert.equal(ofType(second, "tool.finished")[1].status, "done");
  assert.equal(ofType(second, "hook.ran").length, 1, "an ok run gets no row");
  const state = await h.api<HooksState>("GET", "/api/hooks");
  assert.equal(state.hooks[0].lastRun?.outcome, "ok");
  assert.equal(state.hooks[0].lastRun?.exitCode, 0);
});

test("PreToolUse waits for the app's own approval: a denied call never reaches the hook", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "ask" });
  const marker = path.join(out, "ran");
  await addHook(h, { event: "PreToolUse", matcher: "run_command", command: `touch ${quote(marker)}` });
  toolThenText(llm, "run_command", { command: "echo hei" });
  const thread = await h.thread(project.id, "code", model.id);
  const stop = h.approveAll(thread.id, "deny");
  t.after(stop);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Kjør" });
  const events = await h.finished(thread.id);
  stop();
  assert.equal(ofType(events, "tool.finished")[0].status, "denied");
  assert.equal(existsSync(marker), false);
});

test("PostToolUse: feedback is appended to the tool result the model reads, labelled with the hook's name", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "a.txt"), "innhold\n");
  await addHook(h, { name: "Påminnelse", event: "PostToolUse", matcher: "read_file|list_dir", command: `cat > ${quote(path.join(out, "post.json"))}; echo "Husk testene" >&2; exit 2` });
  toolThenText(llm, "read_file", { path: "a.txt" });
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Les" });
  const events = await h.finished(thread.id);
  const finished = ofType(events, "tool.finished")[0];
  assert.equal(finished.status, "done");
  assert.match(finished.result!, /innhold[\s\S]*\[Tilbakemelding fra hooken «Påminnelse»[^\]]*\]\nHusk testene$/);
  assert.match(JSON.stringify(llm.requests[1].body.messages), /Husk testene/);
  assert.equal(ofType(events, "hook.ran")[0].effect, "feedback");
  const payload = JSON.parse(readFileSync(path.join(out, "post.json"), "utf8"));
  assert.equal(payload.hook_event_name, "PostToolUse");
  assert.equal(payload.tool_name, "read_file");
  assert.match(payload.tool_response.content, /innhold/);
  assert.equal(payload.tool_response.is_error, false);
});

test("UserPromptSubmit: exit 2 keeps the message from the model; stdout on exit 0 is added as context", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", model.id);
  const blocker = await addHook(h, { name: "Hemmelig", event: "UserPromptSubmit", command: `cat > ${quote(path.join(out, "prompt.json"))}; if grep -q passord ${quote(path.join(out, "prompt.json"))}; then echo "Ikke send passord" >&2; exit 2; fi` });
  llm.always(sse(openaiText("Svar.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "mitt passord er hunter2" });
  const events = await h.finished(thread.id);
  assert.equal(llm.requests.length, 0, "the model was never called");
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.equal(ofType(events, "user.message")[0].text, "mitt passord er hunter2", "the user still sees what they sent");
  const row = ofType(events, "hook.ran")[0];
  assert.equal(row.effect, "blocked");
  assert.equal(row.event, "UserPromptSubmit");
  assert.equal(row.message, "Ikke send passord");
  assert.equal(JSON.stringify(h.app.store.messages(thread.id)).includes("hunter2"), false, "not in the model's history");
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, "prompt.json"), "utf8")), { hook_event_name: "UserPromptSubmit", session_id: thread.id, cwd: project.path, mode: "code", prompt: "mitt passord er hunter2" });

  await h.api("PATCH", `/api/hooks/${blocker}`, { enabled: false });
  await addHook(h, { name: "Gren", event: "UserPromptSubmit", command: "echo 'Gjeldende gren: main'" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hva er grenen?" });
  await h.finished(thread.id, 2);
  assert.equal(llm.requests.length, 1);
  const sent = JSON.stringify(llm.requests[0].body.messages);
  assert.match(sent, /Hva er grenen\?/);
  assert.match(sent, /Kontekst fra hooken «Gren».*Gjeldende gren: main/);
  assert.equal(sent.includes("hunter2"), false);
});

test("Stop: once per finished turn, also after an error, never after the user's Stop", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const log = path.join(out, "stop.log");
  await addHook(h, { name: "Logg", event: "Stop", command: `cat >> ${quote(log)}; echo >> ${quote(log)}` });
  const thread = await h.thread(null, "chat", model.id);
  llm.reply(sse(openaiText("Første svar.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Én" });
  await h.finished(thread.id, 1);
  llm.reply(sse(openaiText("Andre svar.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "To" });
  await h.finished(thread.id, 2);
  let lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => [l.hook_event_name, l.status, l.mode, l.last_assistant_message]), [["Stop", "done", "chat", "Første svar."], ["Stop", "done", "chat", "Andre svar."]]);

  llm.reply(httpError(400, { error: { message: "dårlig forespørsel" } }));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Tre" });
  const events = await h.finished(thread.id, 3);
  assert.equal(ofType(events, "run.finished")[2].status, "error");
  lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[2].status, "error");
  assert.ok(lines[2].error);

  llm.reply(hang());
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Fire" });
  await until(() => llm.requests.length === 4, "the hanging request");
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const stopped = await h.finished(thread.id, 4);
  assert.equal(ofType(stopped, "run.finished")[3].status, "stopped");
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 3, "no Stop hook after the user's Stop");
});

test("the user's Stop cancels a running hook at once, and the tool never runs", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const started = path.join(out, "started");
  await addHook(h, { event: "PreToolUse", matcher: "write_file", timeoutSeconds: 120, command: `touch ${quote(started)}; sleep 60` });
  toolThenText(llm, "write_file", { path: "ny.txt", content: "x" });
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Skriv" });
  await until(() => existsSync(started), "the hook to start");
  const at = Date.now();
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const events = await h.finished(thread.id);
  assert.ok(Date.now() - at < 5000, `stopped in ${Date.now() - at} ms`);
  assert.equal(ofType(events, "run.finished")[0].status, "stopped");
  assert.equal(ofType(events, "tool.finished")[0].status, "cancelled");
  assert.equal(existsSync(path.join(project.path, "ny.txt")), false);
  await until(async () => (await h.api<HooksState>("GET", "/api/hooks")).hooks[0].lastRun?.outcome === "cancelled", "the run to be recorded");
});

test("a hook that times out is a non-blocking error: shown in the conversation, and the tool still runs", async (t) => {
  const { h, llm, model } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  await addHook(h, { name: "Treg", event: "PreToolUse", matcher: "write_file", timeoutSeconds: 1, command: "sleep 30" });
  toolThenText(llm, "write_file", { path: "ny.txt", content: "x" });
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Skriv" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "tool.finished")[0].status, "done");
  assert.ok(existsSync(path.join(project.path, "ny.txt")));
  const row = ofType(events, "hook.ran")[0];
  assert.equal(row.outcome, "timeout");
  assert.equal(row.effect, "error");
});

test("Chat tools: hooks run for Chat's own tools in the home folder, and Kode-only hooks stay out", async (t) => {
  const { h, llm, model, out, home } = await setup(t);
  const codeOnly = path.join(out, "code-only");
  await addHook(h, { name: "Bare Kode", event: "PreToolUse", modes: ["code"], command: `touch ${quote(codeOnly)}` });
  await addHook(h, { name: "Chat-sperre", event: "PreToolUse", matcher: "list_chat_files", modes: ["chat"], command: `cat > ${quote(path.join(out, "chat.json"))}; echo >> ${quote(path.join(out, "chat.json"))}; pwd >> ${quote(path.join(out, "chat.json"))}; echo "ikke i dag" >&2; exit 2` });
  toolThenText(llm, "list_chat_files", {});
  const thread = await h.thread(null, "chat", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hvilke filer?" });
  const events = await h.finished(thread.id);
  const finished = ofType(events, "tool.finished")[0];
  assert.equal(finished.status, "denied");
  assert.match(finished.result!, /Chat-sperre[\s\S]*ikke i dag/);
  assert.equal(existsSync(codeOnly), false);
  const [json, pwd] = readFileSync(path.join(out, "chat.json"), "utf8").trim().split("\n");
  assert.equal(JSON.parse(json).mode, "chat");
  assert.equal(JSON.parse(json).cwd, home);
  assert.equal(pwd, home);
});

test("the hook's environment has no provider API key or app token, but has AD_HOOK_* and the project folder", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const envFile = path.join(out, "env");
  await addHook(h, { event: "UserPromptSubmit", command: `env > ${quote(envFile)}` });
  llm.always(sse(openaiText("Ok.")));
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei" });
  await h.finished(thread.id);
  const env = readFileSync(envFile, "utf8");
  assert.equal(env.includes(SECRET), false, "the provider key is not in the environment");
  assert.equal(env.includes(h.app.security.token), false, "nor the app's login token");
  assert.match(env, /^AD_HOOK_EVENT=UserPromptSubmit$/m);
  assert.match(env, new RegExp(`^AD_HOOK_THREAD_ID=${thread.id}$`, "m"));
  assert.ok(env.split("\n").includes(`CLAUDE_PROJECT_DIR=${project.path}`));
});

test("hooks come only from the authenticated settings API: no cookie, a foreign Origin or a project file installs nothing", async (t) => {
  const { h, llm, model, out } = await setup(t);
  const body = JSON.stringify({ event: "Stop", command: "touch /tmp/should-never-exist" });
  const noCookie = await rawRequest(h.app.port, "POST", "/api/hooks", { headers: { origin: h.origin, "content-type": "application/json" }, body });
  assert.equal(noCookie.status, 401);
  const foreign = await h.raw("POST", "/api/hooks", { headers: { origin: "https://evil.example", "content-type": "application/json" }, body });
  assert.equal(foreign.status, 403);
  const form = await h.raw("POST", "/api/hooks", { headers: { "content-type": "text/plain" }, body });
  assert.equal(form.status, 415);
  const test = await rawRequest(h.app.port, "POST", "/api/hooks/test", { headers: { origin: h.origin, "content-type": "application/json" }, body });
  assert.equal(test.status, 401, "«Test» needs the session too");
  assert.equal((await h.api<HooksState>("GET", "/api/hooks")).hooks.length, 0);

  // A cloned repository with Claude Code-style hooks and a planted hooks.json: none of it is read.
  const marker = path.join(out, "planted");
  const project = await h.project(undefined, { permissionMode: "full" });
  const planted = { hooks: { Stop: [{ hooks: [{ type: "command", command: `touch ${quote(marker)}` }] }] } };
  mkdirSync(path.join(project.path, ".claude"));
  writeFileSync(path.join(project.path, ".claude", "settings.json"), JSON.stringify(planted));
  mkdirSync(path.join(project.path, ".agentic"));
  writeFileSync(path.join(project.path, ".agentic", "hooks.json"), JSON.stringify({ version: 1, hooks: [{ id: "x", event: "Stop", command: `touch ${quote(marker)}` }] }));
  llm.always(sse(openaiText("Ok.")));
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei" });
  await h.finished(thread.id);
  assert.equal(existsSync(marker), false);
  assert.equal((await h.api<HooksState>("GET", "/api/hooks")).hooks.length, 0);

  // The model is offered no tool that touches hooks.
  const tools: string[] = llm.requests.at(-1)!.body.tools.map((tool: any) => tool.function.name);
  assert.equal(tools.some((name) => /hook/i.test(name)), false, tools.join(", "));
});

test("settings API: create, change, reorder, delete and «Test», with hooks.changed on the socket", async (t) => {
  const { h } = await setup(t);
  const socket = await h.socket();
  const id = await addHook(h, { name: "Varsel", event: "Stop", command: "echo ferdig" });
  await socket.waitFor((m) => m.type === "hooks.changed" && m.state.hooks.some((hook) => hook.id === id));
  const second = await addHook(h, { name: "Annen", event: "PreToolUse", matcher: "edit_file|write_file", command: "true", modes: ["code"] });
  let state = await h.api<HooksState>("PATCH", `/api/hooks/${id}`, { enabled: false, timeoutSeconds: 5 });
  assert.deepEqual([state.hooks[0].enabled, state.hooks[0].timeoutSeconds, state.hooks[0].command], [false, 5, "echo ferdig"]);
  await assert.rejects(h.api("PATCH", `/api/hooks/${id}`, { timeoutSeconds: 999 }), /400/);
  await assert.rejects(h.api("PATCH", "/api/hooks/finnes-ikke", { enabled: true }), /404/);
  state = await h.api<HooksState>("PUT", "/api/hooks/order", { ids: [second, id] });
  assert.deepEqual(state.hooks.map((hook) => hook.id), [second, id]);
  const result = await h.api("POST", "/api/hooks/test", { id, name: "Varsel", event: "Stop", command: "echo ferdig; exit 1", timeoutSeconds: 5, enabled: false, modes: ["chat", "code"], matcher: "" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.trim(), "ferdig");
  assert.match(result.effect, /Ikke-blokkerende feil/);
  await socket.waitFor((m) => m.type === "hooks.changed" && m.state.hooks.some((hook) => hook.id === id && hook.lastRun?.test === true));
  state = await h.api<HooksState>("DELETE", `/api/hooks/${id}`);
  assert.deepEqual(state.hooks.map((hook) => hook.id), [second]);
});

test("end to end with the demo model: a PreToolUse hook stops read_file, and the model's answer says why", async (t) => {
  const { h, out } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  await addHook(h, { name: "Ingen lesing", event: "PreToolUse", matcher: "read_file", command: `cat > ${quote(path.join(out, "mock.json"))}; echo "lesing er sperret i dette prosjektet" >&2; exit 2` });
  const thread = await h.thread(project.id, "code", MOCK_MODEL_ID);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "vis en feil" });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.equal(ofType(events, "tool.finished")[0].status, "denied");
  assert.match(textOf(events), /lesing er sperret i dette prosjektet/);
  assert.equal(JSON.parse(readFileSync(path.join(out, "mock.json"), "utf8")).tool_input.path, "finnes-ikke.txt");
});

test("UserPromptSubmit also covers a message steered into a running turn: a blocked one never reaches the model", async (t) => {
  const { h, llm, model } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  await addHook(h, { name: "Filter", event: "UserPromptSubmit", command: `if grep -q hemmelig; then echo "ikke den" >&2; exit 2; fi` });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let calls = 0;
  llm.always(async (req, res) => {
    calls++;
    if (calls === 1) {
      await gate;
      return sse(openaiToolCall("list_dir", { path: "." }, "call-1"))(req, res);
    }
    return sse(openaiText("Ferdig."))(req, res);
  });
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Start" });
  await until(() => llm.requests.length === 1, "the first step");
  const queued = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "dette er hemmelig", steer: true });
  assert.equal(queued.steer, true);
  release();
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.equal(llm.requests.length, 2);
  assert.equal(JSON.stringify(llm.requests[1].body.messages).includes("hemmelig"), false);
  assert.equal(ofType(events, "hook.ran").filter((e) => e.effect === "blocked" && e.event === "UserPromptSubmit").length, 1);
  assert.ok(ofType(events, "user.message").some((e) => e.text === "dette er hemmelig"), "still shown in the conversation");
});

test("a message a hook stopped stays out of a history rebuilt from the conversation (fork)", async (t) => {
  const { h, llm, model } = await setup(t);
  await addHook(h, { event: "UserPromptSubmit", modes: ["chat"], command: `if grep -q hunter2; then echo nei >&2; exit 2; fi` });
  llm.always(sse(openaiText("Svar.")));
  const thread = await h.thread(null, "chat", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "passordet er hunter2" });
  await h.finished(thread.id, 1);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei igjen" });
  const events = await h.finished(thread.id, 2);
  const last = ofType(events, "user.message").at(-1)!;
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: last.messageId });
  const history = JSON.stringify(h.app.store.messages(fork.id));
  assert.match(history, /Hei igjen/);
  assert.equal(history.includes("hunter2"), false);
});
