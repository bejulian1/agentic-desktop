import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { pullWatchVersion } from "../../shared/linked-pr.ts";
import type { PullWatchStatus, Thread } from "../../shared/protocol.ts";
import { Store } from "../src/db.ts";
import { ThreadInbox } from "../src/thread-inbox.ts";
import { GOOD_TOKEN, startFakeGitHub } from "./fake-github.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until } from "./helpers.ts";

const HOUR = 3_600_000;
const future = () => Date.now() + HOUR;
const repo = "acme/rakett";
const threadUrl = (thread: Thread) => `/api/threads/${thread.id}`;

function ageThreads(dataDir: string, threads: Thread[]): void {
  using db = new DatabaseSync(path.join(dataDir, "agentic-desktop.db"));
  const update = db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?");
  for (const thread of threads) update.run(Date.now() - 48 * HOUR, thread.id);
}

test("startup and settings changes settle inactive threads while protecting active, waiting, pinned, snoozed and temporary threads", async (t) => {
  const dataDir = tempDir(t);
  let startup: Thread;
  const seeded = new Store(dataDir);
  try {
    startup = seeded.createThread(null, "chat", null, { title: "Oppstart" });
    seeded.updateSettings({ autoSettleAfterHours: 24 });
    ageThreads(dataDir, [startup]);
  } finally {
    seeded.close();
  }
  const h = await startHarness(t, { dataDir });
  const store = h.app.store;
  assert.equal(store.thread(startup.id)?.archived, true);
  await h.api("PATCH", "/api/settings", { autoSettleAfterHours: null });
  const [old, recent, pinned, running, approving, answering, snoozed, temporary, archived] =
    await Promise.all(Array.from({ length: 9 }, () => h.thread(null)));
  store.isRunning = (id) => id === running.id;
  store.pendingApprovals = (id) => Number(id === approving.id);
  store.pendingQuestions = (id) => Number(id === answering.id);
  store.markTemporary(temporary.id);
  store.updateThread(archived.id, { archived: true });
  await h.api("PATCH", threadUrl(pinned), { pinned: true });
  await h.api("PATCH", threadUrl(snoozed), { snoozedUntil: future() });
  ageThreads(dataDir, [old, pinned, running, approving, answering, snoozed, temporary, archived]);

  const socket = await h.socket();
  await h.api("PATCH", "/api/settings", { autoSettleAfterHours: 24 });
  await socket.waitFor((message) => message.type === "thread.changed" && message.thread.id === old.id && message.thread.archived);
  for (const thread of [recent, pinned, running, approving, answering, snoozed, temporary]) {
    assert.equal(store.thread(thread.id)?.archived, false, thread.id);
  }
  assert.equal(store.thread(archived.id)?.archived, true);
  assert.ok(!socket.received.some((message) => message.type === "thread.changed" && message.thread.id === archived.id));
});

test("linked merged and closed PRs settle eligible threads with mocked GitHub status", async (t) => {
  const github = await startFakeGitHub();
  const previousApi = process.env.AD_GITHUB_API;
  process.env.AD_GITHUB_API = github.url;
  t.after(async () => {
    if (previousApi === undefined) delete process.env.AD_GITHUB_API;
    else process.env.AD_GITHUB_API = previousApi;
    await github.close();
  });
  const h = await startHarness(t);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  github.setPullState(41, "MERGED");
  github.setPullState(42, "CLOSED");
  github.setPullState(45, "OPEN");
  const [merged, closed, open, pinned, running, waiting, snoozed, unlinked] = await Promise.all(Array.from({ length: 8 }, () => h.thread(null)));
  h.app.store.isRunning = (id) => id === running.id;
  h.app.store.pendingQuestions = (id) => Number(id === waiting.id);
  for (const [thread, number] of [[merged, 41], [closed, 42], [open, 45], [pinned, 42], [running, 42], [waiting, 42], [snoozed, 42]] as const) {
    await h.api("PATCH", threadUrl(thread), { linkedPr: { repo, number } });
  }
  await h.api("PATCH", threadUrl(pinned), { pinned: true });
  await h.api("PATCH", threadUrl(snoozed), { snoozedUntil: future() });
  assert.equal(github.requests.filter((request) => request.path === "/graphql").length, 0);
  const socket = await h.socket();
  await h.api("PATCH", "/api/settings", { autoSettleOnPrClose: true });
  for (const thread of [merged, closed]) {
    await socket.waitFor((message) => message.type === "thread.changed" && message.thread.id === thread.id && message.thread.archived);
  }
  for (const thread of [open, pinned, running, waiting, snoozed, unlinked]) {
    assert.equal(h.app.store.thread(thread.id)?.archived, false, thread.id);
  }

  const watch = { threadId: open.id, repo, number: "46" };
  github.setPullState(46, "OPEN");
  const status = await h.api<PullWatchStatus>("POST", "/api/github/pull-watch", { ...watch, link: true });
  assert.deepEqual(h.app.store.thread(open.id)?.linkedPr, { repo, number: 46, url: `https://github.com/${repo}/pull/46` });
  await h.api("PATCH", threadUrl(open), { snoozedUntil: future() });
  await h.api("POST", "/api/github/pull-watch", { ...watch, previous: pullWatchVersion(status) });
  assert.ok(h.app.store.thread(open.id)?.snoozedUntil, "samme status holder tråden utsatt");
  github.setPullState(46, "MERGED");
  await h.api("POST", "/api/github/pull-watch", { ...watch, previous: pullWatchVersion(status) });
  assert.equal(h.app.store.thread(open.id)?.snoozedUntil, null, "oppfølgingen vekker en utsatt tråd");
  assert.equal(h.app.store.thread(open.id)?.archived, false, "tråden var utsatt da PR-en ble sjekket");
  await h.api("POST", "/api/github/pull-watch", watch);
  assert.equal(h.app.store.thread(open.id)?.archived, true);
});

test("a pending PR check revalidates thread state and its linked PR before settling", async (t) => {
  const store = new Store(tempDir(t));
  t.after(() => store.close());
  store.updateSettings({ autoSettleOnPrClose: true });
  const pull = { repo, number: 42 };
  const [pinned, running, relinked, snoozed, eligible] = Array.from({ length: 5 }, () => {
    const thread = store.createThread(null, "chat", null);
    store.updateThread(thread.id, { linkedPr: pull });
    return thread;
  });
  const pending = Promise.withResolvers<PullWatchStatus>();
  const changed: string[] = [];
  let reads = 0;
  const inbox = new ThreadInbox(store, (id) => changed.push(id), () => {
    reads++;
    return pending.promise;
  });
  const checking = inbox.checkPulls();
  store.isRunning = (id) => id === running.id;
  store.updateThread(pinned.id, { pinned: true });
  store.updateThread(relinked.id, { linkedPr: { repo, number: 43 } });
  store.updateThread(snoozed.id, { snoozedUntil: future() });
  pending.resolve({ ...pull, title: "PR", url: `https://github.com/${repo}/pull/42`, state: "MERGED",
    head: "mock", draft: false, checks: null, review: null });
  await checking;
  assert.equal(reads, 1, "the same PR is checked once per sweep");
  assert.deepEqual(changed, [eligible.id]);
  assert.equal(store.thread(eligible.id)?.archived, true);
});

test("activity clears snooze on messages, completion and requests for approval or input", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Local", model: "test", contextWindow: 64_000 });
  const chat = await h.thread(null, "chat", model.id);
  const socket = await h.socket();
  const response = Promise.withResolvers<void>();
  t.after(() => response.resolve());
  llm.reply(async (req, res) => {
    await response.promise;
    await sse(openaiText("Ferdig"))(req, res);
  });
  await h.api("PATCH", threadUrl(chat), { snoozedUntil: future() });
  await h.api("POST", `${threadUrl(chat)}/messages`, { text: "Vekk tråden" });
  await socket.waitFor((message) => message.type === "thread.changed" && message.thread.id === chat.id && message.thread.snoozedUntil === null);
  await h.api("PATCH", threadUrl(chat), { snoozedUntil: future() });
  response.resolve();
  await h.finished(chat.id);
  assert.equal(h.app.store.thread(chat.id)?.snoozedUntil, null);

  const project = await h.project(undefined, { permissionMode: "ask" });
  const code = await h.thread(project.id, "code", model.id);
  const approve = Promise.withResolvers<void>();
  const input = Promise.withResolvers<void>();
  t.after(() => { approve.resolve(); input.resolve(); });
  llm.reply(async (req, res) => {
    await approve.promise;
    await sse(openaiToolCall("run_command", { command: "echo test" }, "approval"))(req, res);
  });
  llm.reply(async (req, res) => {
    await input.promise;
    await sse(openaiToolCall("ask_user", { questions: [{ id: "test", question: "Fortsette?" }] }, "question"))(req, res);
  });
  await h.api("POST", `${threadUrl(code)}/messages`, { text: "Be om tillatelse" });
  await h.api("PATCH", threadUrl(code), { snoozedUntil: future() });
  approve.resolve();
  await socket.waitFor((message) => message.type === "thread.changed" && message.thread.id === code.id &&
    message.thread.pendingApprovals === 1 && message.thread.snoozedUntil === null);
  const approval = ofType((await h.events(code.id)).map(({ event }) => event), "approval.requested")[0];
  await h.api("POST", `/api/approvals/${approval.approvalId}`, { decision: "deny" });
  await h.api("PATCH", threadUrl(code), { snoozedUntil: future() });
  input.resolve();
  await socket.waitFor((message) => message.type === "thread.changed" && message.thread.id === code.id &&
    message.thread.pendingQuestions === 1 && message.thread.snoozedUntil === null);
  await h.api("POST", `${threadUrl(code)}/stop`);
  await h.finished(code.id);

  await h.api("PATCH", "/api/settings", { snoozeWakeOnActivity: false });
  const untilWake = future();
  await h.api("PATCH", threadUrl(chat), { snoozedUntil: untilWake });
  llm.reply(sse(openaiText("Ferdig mens tråden er utsatt")));
  await h.api("POST", `${threadUrl(chat)}/messages`, { text: "Behold utsettelsen" });
  await h.finished(chat.id, 2);
  assert.equal(h.app.store.thread(chat.id)?.snoozedUntil, untilWake);
});

test("inbox settings and thread snooze/PR links validate and persist", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null);
  const defaults = { autoSettleAfterHours: null, autoSettleOnPrClose: false, snoozeWakeOnActivity: true, hideWorkingThreads: false, sidebarGroupBy: "project" };
  const read = async () => (await h.api("GET", "/api/bootstrap")).settings;
  const pick = (settings: Record<string, unknown>) => Object.fromEntries(Object.keys(defaults).map((key) => [key, settings[key]]));
  assert.deepEqual(pick(await read()), defaults);
  const changed = { ...defaults, autoSettleAfterHours: 168, snoozeWakeOnActivity: false, hideWorkingThreads: true, sidebarGroupBy: "inbox" };
  await h.api("PATCH", "/api/settings", changed);
  assert.deepEqual(pick(await read()), changed);
  for (const patch of [{ autoSettleAfterHours: 48 }, { autoSettleAfterHours: "24" }, { autoSettleOnPrClose: "true" },
    { hideWorkingThreads: 1 }, { snoozeWakeOnActivity: null }, { sidebarGroupBy: "custom" }]) {
    await assert.rejects(h.api("PATCH", "/api/settings", patch), /400/);
  }
  const linkedPr = { repo, number: 42, url: `https://github.com/${repo}/pull/42` };
  const snoozedUntil = future();
  const patched = await h.api("PATCH", threadUrl(thread), { linkedPr: { ...linkedPr, url: `${linkedPr.url}?tab=files` }, snoozedUntil });
  assert.deepEqual(patched.linkedPr, linkedPr);
  assert.equal(h.app.store.thread(thread.id)?.snoozedUntil, snoozedUntil);
  for (const bad of [{ repo: "acme/..", number: 42 }, { repo, number: 0 }, { repo, number: 42.5 }, { repo, number: 2_147_483_648 },
    { ...linkedPr, url: "https://example.com/acme/rakett/pull/42" }, { ...linkedPr, url: `${linkedPr.url}0` }]) {
    await assert.rejects(h.api("PATCH", threadUrl(thread), { linkedPr: bad }), /400/);
  }
  for (const bad of ["tomorrow", Date.now() - HOUR, future() + 0.5, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(h.api("PATCH", threadUrl(thread), { snoozedUntil: bad }), /400/);
  }
  const reset = await h.api("PATCH", threadUrl(thread), { snoozedUntil: null, linkedPr: null });
  assert.deepEqual([reset.snoozedUntil, reset.linkedPr], [null, null]);
  await h.api("PATCH", "/api/settings", { shortcuts: { "thread.snooze": "Mod+Alt+Z" } });
  await until(async () => (await read()).shortcuts["thread.snooze"] === "Mod+Alt+Z", "hurtigtasten er lagret");
});
