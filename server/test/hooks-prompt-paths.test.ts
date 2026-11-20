// Every way a user message can reach the model goes through UserPromptSubmit hooks: queued
// messages after a Stop, messages still queued at a restart, a Stop or a crash while a hook runs,
// forks and titles. Also: !commands skip tool hooks, and model commands that name the app's own
// folders always ask. Every hook only touches temporary folders.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { HooksState } from "../../shared/hooks.ts";
import type { ThreadEvent } from "../../shared/protocol.ts";
import { isProtectedCommand } from "../src/paths.ts";
import { hang, openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

const quote = (file: string) => `'${file.replace(/'/g, `'\\''`)}'`;

async function fakeModel(h: Harness, llm: FakeLlm) {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: `${llm.url}/v1`, apiKey: "test" });
  return h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "fake", contextWindow: 100_000 });
}

async function addHook(h: Harness, body: Record<string, unknown>): Promise<string> {
  return (await h.api<HooksState>("POST", "/api/hooks", body)).hooks.at(-1)!.id;
}

const BLOCK_SECRET = `if grep -q hemmelig; then echo "ikke den" >&2; exit 2; fi`;
const stored = (h: Harness, threadId: string) => JSON.stringify(h.app.store.messages(threadId));

test("queued messages after Stop go through UserPromptSubmit: a blocked one stays out, the others are checked", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(h, llm);
  await addHook(h, { event: "UserPromptSubmit", command: BLOCK_SECRET });
  llm.always(hang());
  const thread = await h.thread(null, "chat", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Start" });
  await until(() => llm.requests.length === 1, "the first request");
  const blocked = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "kø hemmelig", steer: false });
  const passed = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "kø vanlig", steer: false });
  assert.equal(blocked.queued, true);
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  await h.finished(thread.id);
  await until(() => !h.app.runner.isRunning(thread.id), "the queue to be drained");
  const events = (await h.events(thread.id)).map((e) => e.event);
  assert.equal(stored(h, thread.id).includes("hemmelig"), false);
  assert.match(stored(h, thread.id), /kø vanlig/);
  assert.ok(ofType(events, "hook.ran").some((e) => e.effect === "blocked" && e.messageId === blocked.messageId));
  assert.ok(ofType(events, "user.checked").some((e) => e.messageId === passed.messageId));
  assert.equal(llm.requests.length, 1, "nothing new started");
});

test("messages still queued at a restart are not checked and not sent: shown as not sent", async (t) => {
  const dataDir = tempDir(t, "ad-data-");
  const first = await startHarness(t, { dataDir, homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(first, llm);
  await addHook(first, { event: "UserPromptSubmit", command: "true" });
  llm.always(hang());
  const thread = await first.thread(null, "chat", model.id);
  await first.api("POST", `/api/threads/${thread.id}/messages`, { text: "Start" });
  await until(() => llm.requests.length === 1, "the first request");
  const queued = await first.api("POST", `/api/threads/${thread.id}/messages`, { text: "venter i køen", steer: false });
  await first.app.close(); // a shutdown leaves the queue in the database

  const second = await startHarness(t, { dataDir, homeDir: tempDir(t) });
  const events = (await second.events(thread.id)).map((e) => e.event);
  assert.ok(ofType(events, "user.unsent").some((e) => e.messageId === queued.messageId && e.reason === "restart"));
  assert.equal(stored(second, thread.id).includes("venter i køen"), false);
});

test("Stop while UserPromptSubmit runs: the message is not sent, and the conversation says so", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(h, llm);
  const out = tempDir(t);
  const started = path.join(out, "started");
  await addHook(h, { event: "UserPromptSubmit", timeoutSeconds: 120, command: `touch ${quote(started)}; sleep 60` });
  llm.always(sse(openaiText("Svar.")));
  const thread = await h.thread(null, "chat", model.id);
  const sent = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hemmelig innhold" });
  await until(() => existsSync(started), "the hook to start");
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "stopped");
  assert.deepEqual(ofType(events, "user.unsent").map((e) => [e.messageId, e.reason]), [[sent.messageId, "interrupted"]]);
  assert.equal(stored(h, thread.id).includes("hemmelig"), false);
  assert.equal(llm.requests.length, 0);
  assert.equal(h.app.store.thread(thread.id)!.title, "Melding ikke sendt", "a neutral title, nothing from the unchecked message");
});

test("forks: a blocked message stays out when forking at it or after it; a checked one at the cut stays in", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(h, llm);
  await addHook(h, { event: "UserPromptSubmit", command: BLOCK_SECRET });
  llm.always(sse(openaiText("Svar.")));
  const thread = await h.thread(null, "chat", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hello" });
  await h.finished(thread.id, 1);
  const blocked = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "SECRET=abc123 please hemmelig" });
  await h.finished(thread.id, 2);

  const atBlocked = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: blocked.messageId });
  const history = stored(h, atBlocked.id);
  assert.match(history, /hello/);
  assert.equal(history.includes("abc123"), false, history);

  const last = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "vanlig" });
  await h.finished(thread.id, 3);
  const atChecked = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: last.messageId });
  assert.match(stored(h, atChecked.id), /vanlig/);
  // The fork's own log says the message got through, so a rebuild inside the fork keeps it.
  const forkEvents = (await h.events(atChecked.id)).map((e) => e.event);
  assert.ok(ofType(forkEvents, "user.checked").some((e) => e.messageId === last.messageId));
  const again = await h.api("POST", `/api/threads/${atChecked.id}/fork`, { messageId: last.messageId });
  assert.match(stored(h, again.id), /vanlig/);
  assert.equal(stored(h, again.id).includes("abc123"), false);
});

test("a steered message a hook stopped stays out of a fork made at it", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  await addHook(h, { event: "UserPromptSubmit", command: BLOCK_SECRET });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let calls = 0;
  llm.always(async (req, res) => {
    if (++calls === 1) {
      await gate;
      return sse(openaiToolCall("list_dir", { path: "." }, "call-1"))(req, res);
    }
    return sse(openaiText("Ferdig."))(req, res);
  });
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Start" });
  await until(() => llm.requests.length === 1, "the first step");
  const steered = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "steer hemmelig", steer: true });
  release();
  await h.finished(thread.id);
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`, { messageId: steered.messageId });
  assert.match(stored(h, fork.id), /Start/);
  assert.equal(stored(h, fork.id).includes("steer hemmelig"), false);
});

test("a crash during the check: after restart the message is marked not sent and stays out of every rebuilt history", async (t) => {
  const dataDir = tempDir(t, "ad-data-");
  const first = await startHarness(t, { dataDir, homeDir: tempDir(t) });
  const thread = await first.thread(null, "chat");
  // What a crash leaves behind: the message logged as held, a run still marked running, and no
  // check result. Written straight to the store, since a real crash cannot be staged here.
  const store = first.app.store;
  store.appendEvent(thread.id, { type: "user.message", messageId: "m-ok", text: "tidligere", held: true });
  store.appendEvent(thread.id, { type: "user.checked", messageId: "m-ok" });
  store.appendMessage(thread.id, { role: "user", content: [{ type: "text", text: "tidligere" }] });
  const messageId = randomUUID();
  store.appendEvent(thread.id, { type: "user.message", messageId, text: "krasj hemmelig", held: true });
  const runId = randomUUID();
  store.createRun({ id: runId, threadId: thread.id, modelId: "mock-demo", turnId: randomUUID(), startSeq: store.lastSeq(thread.id) + 1 });
  store.appendEvent(thread.id, { type: "run.started", runId, modelId: "mock-demo" });
  await first.app.close();

  const second = await startHarness(t, { dataDir, homeDir: tempDir(t) });
  const events = (await second.events(thread.id)).map((e) => e.event);
  assert.deepEqual(ofType(events, "user.unsent").map((e) => [e.messageId, e.reason]), [[messageId, "restart"]]);
  assert.equal(ofType(events, "run.finished").at(-1)!.status, "interrupted");
  assert.equal(stored(second, thread.id).includes("krasj"), false);
  const fork = await second.api("POST", `/api/threads/${thread.id}/fork`, { messageId });
  assert.match(stored(second, fork.id), /tidligere/);
  assert.equal(stored(second, fork.id).includes("krasj"), false);
});

test("the title comes only from a message the hooks let through", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(h, llm);
  await addHook(h, { event: "UserPromptSubmit", command: BLOCK_SECRET });
  llm.always(sse(openaiText("Svar.")));
  const thread = await h.thread(null, "chat", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hemmelig prosjektnavn" });
  await h.finished(thread.id, 1);
  assert.equal(h.app.store.thread(thread.id)!.title, "Melding stoppet av hook", "listed, but with nothing from the blocked message");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Planlegg ferien" });
  await h.finished(thread.id, 2);
  assert.equal(h.app.store.thread(thread.id)!.title, "Planlegg ferien");
});

test("a !command the user typed skips PreToolUse and PostToolUse hooks", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const out = tempDir(t);
  const marker = path.join(out, "ran");
  const project = await h.project(undefined, { permissionMode: "full" });
  await addHook(h, { event: "PreToolUse", matcher: "run_command", command: `touch ${quote(marker)}; echo nei >&2; exit 2` });
  await addHook(h, { event: "PostToolUse", matcher: "run_command", command: `touch ${quote(marker)}; echo nei >&2; exit 2` });
  const thread = await h.thread(project.id, "code");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "", shell: "echo fra-brukeren" });
  const events: ThreadEvent[] = await h.finished(thread.id);
  const finished = ofType(events, "tool.finished")[0];
  assert.equal(finished.status, "done");
  assert.match(finished.result!, /fra-brukeren/);
  assert.equal(finished.result!.includes("hooken"), false);
  assert.equal(existsSync(marker), false);
  assert.equal(ofType(events, "hook.ran").length, 0);
});

test("commands that name the app's data or config folder always ask, in every plain form", (t) => {
  const home = homedir();
  const dataDir = path.join(home, ".local/share/agentic-desktop");
  const configDir = path.join(home, ".config/agentic-desktop");
  for (const command of [
    `echo x > ${dataDir}/hooks.json`,
    "echo x > ~/.local/share/agentic-desktop/hooks.json",
    `echo x > "$HOME/.local/share/agentic-desktop/hooks.json"`,
    "echo x > ${HOME}/.local/share/agentic-desktop/hooks.json",
    "sqlite3 ~//.local/share/agentic-desktop/agentic-desktop.db .dump",
    "cat $XDG_DATA_HOME/agentic-desktop/hooks.json",
    "rm -rf ~/.local/share/agentic-desktop",
    "ls ~/.config/agentic-desktop/",
    `cp evil.md ${configDir}/AGENTS.md`,
    "cat agentic-desktop/keys.json",
    "cat ../agentic-desktop/hooks.json",
    "cp x '/home/someone/.local/share'/agentic-desktop/x",
  ]) assert.equal(isProtectedCommand(command, dataDir, configDir), true, command);

  // A data folder elsewhere (AD_DATA_DIR): its own path and the ~ forms of it.
  const custom = path.join(home, "egen-data");
  assert.equal(isProtectedCommand("cat ~/egen-data/hooks.json", custom, configDir), true);
  assert.equal(isProtectedCommand("cat $HOME/egen-data/x", custom, configDir), true);
  const tmp = tempDir(t);
  mkdirSync(path.join(tmp, "data"));
  assert.equal(isProtectedCommand(`ls ${path.join(tmp, "data")}`, path.join(tmp, "data"), configDir), true);

  for (const command of ["npm test", "ls -la", "cat src/agentic-desktop.ts", "git log -- agentic-desktop-notes.md", "cd ~/prosjekter/agentic-desktop-klone && ls", "echo ~/.local/share/andre-app/x"]) {
    assert.equal(isProtectedCommand(command, dataDir, configDir), false, command);
  }
});

test("a model's command writing hooks.json asks even in Full access", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const model = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  llm.always((req, res) => sse(req.body.messages.at(-1)?.role === "tool" ? openaiText("Ok.") : openaiToolCall("run_command", { command: "echo '{}' > ~/.local/share/agentic-desktop/hooks.json" }, "c1"))(req, res));
  const thread = await h.thread(project.id, "code", model.id);
  const stop = h.approveAll(thread.id, "deny");
  t.after(stop);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Gjør det" });
  const events = await h.finished(thread.id);
  stop();
  assert.equal(ofType(events, "approval.requested").length, 1);
  assert.equal(ofType(events, "approval.requested")[0].canAllowAlways, false);
  assert.equal(ofType(events, "tool.finished")[0].status, "denied");
});
