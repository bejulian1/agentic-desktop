import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Schedule } from "../../shared/schedules.ts";
import { hang, openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

const testKey = "orchestration-fixture-credential";
const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });
const call = (name: string, input: unknown, id: number) => sse(openaiToolCall(name, input, `call-${id}`));
const answer = sse(openaiText("Finished."));
const results = (body: any): string[] => body.messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);

async function setup(t: TestContext) {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", {
    kind: "openai-compatible", name: "Test provider", baseUrl: `${llm.url}/v1`, apiKey: testKey,
  });
  const { id: modelId } = await h.api("POST", "/api/models", { providerId: provider.id, name: "Test model", model: "fake", contextWindow: 100_000 });
  return { h, llm, modelId };
}

test("read-only helpers reject mutating tools and cancellation clears only a descendant's queue", async t => {
  const { h, llm, modelId } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const parent = await h.thread(project.id, "code", modelId);
  const peer = await h.thread(project.id, "code", modelId);
  const blocked = ["write_file", "edit_file", "delete_file", "run_command", "thread_organize", "schedule_create"];
  llm.always(async (req, res) => {
    const prompt = req.body.messages[1].content;
    const previous = results(req.body);
    const step = previous.length;
    if (prompt.includes("Helper task")) {
      const names = req.body.tools.map((tool: any) => tool.function.name);
      assert.ok(names.includes("read_file") && names.includes("thread_search") && names.includes("schedule_list"));
      assert.ok(blocked.every(name => !names.includes(name)));
      if (step === 0) return call("write_file", { path: "denied.txt", content: "denied" }, step)(req, res);
      if (step === 1) return call("run_command", { command: "touch denied.txt" }, step)(req, res);
      assert.ok(previous.every(result => /Planmodus/.test(result)));
      return prompt.includes("Review") ? hang()(req, res) : answer(req, res);
    }
    if (step === 0) return call("thread_create", { title: "Read only", task: "Read-only Helper task", readOnly: true }, step)(req, res);
    if (step === 1) return call("thread_create", { title: "Review", task: "Review Helper task", role: "review", readOnly: false }, step)(req, res);
    const [reader, review] = previous.slice(0, 2).map(result => JSON.parse(result));
    assert.ok(reader.readOnly && reader.planMode && review.readOnly && review.planMode);
    if (step === 2) {
      await until(() => llm.requests.some(({ body }) => body.messages[1].content.includes("Review Helper task") &&
        results(body).length === 2), "review helper reached its streaming response");
      return call("thread_cancel", { threadId: peer.id }, step)(req, res);
    }
    if (step === 3) return call("thread_send", { threadId: review.threadId, text: "Queued follow-up" }, step)(req, res);
    if (step === 4) {
      assert.equal(h.app.store.hasQueued(review.threadId), true);
      return call("thread_cancel", { threadId: review.threadId, reason: "Review is complete" }, step)(req, res);
    }
    assert.equal(JSON.parse(previous[4]).cancelled, true);
    return answer(req, res);
  });
  await send(h, parent.id, "Delegate the review");
  const parentEvents = await h.finished(parent.id);
  assert.deepEqual(ofType(parentEvents, "tool.finished").map(event => event.status), ["done", "done", "error", "done", "done"]);
  const [reader, review] = ofType(parentEvents, "thread.spawned").map(event => event.childThreadId);
  assert.equal(h.app.store.thread(reader)?.planMode, true);
  assert.equal(h.app.store.thread(review)?.planMode, true);
  assert.equal(ofType(await h.finished(reader), "run.finished")[0].status, "done");
  const reviewEvents = await h.finished(review);
  assert.equal(ofType(reviewEvents, "run.finished")[0].status, "stopped");
  assert.equal(ofType(reviewEvents, "user.queue-removed").length, 1);
  assert.equal(h.app.store.hasQueued(review), false);
  assert.equal(existsSync(path.join(project.path, "denied.txt")), false);
});

test("worktree delegation checks out committed files and confines child file tools and shell", async t => {
  const { h, llm, modelId } = await setup(t);
  const temp = tempDir(t);
  const repo = path.join(temp, "repo");
  const folder = path.join(repo, "src");
  mkdirSync(folder, { recursive: true });
  const tracked = path.join(folder, "tracked.txt");
  const git = (wd: string, ...args: string[]) => execFileSync("git", ["-C", wd, "-c", "core.hooksPath=/dev/null", ...args], {
    env: { PATH: process.env.PATH, HOME: temp, XDG_CONFIG_HOME: temp, GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8",
  }).trim();
  git(repo, "init", "-b", "main");
  writeFileSync(tracked, "committed version\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "initial");
  writeFileSync(tracked, "parent's local edit\n");
  const project = await h.project(folder, { permissionMode: "full" });
  const parent = await h.thread(project.id, "code", modelId);
  const nonGit = await h.project(undefined, { permissionMode: "full" });
  const other = await h.thread(nonGit.id, "code", modelId);
  const escape = path.join(folder, "escape.txt");
  llm.always((req, res) => {
    const prompt = req.body.messages[1].content;
    const previous = results(req.body);
    const step = previous.length;
    if (!prompt.includes("Edit in isolation")) {
      return (step ? answer : call("thread_create", {
        title: "Isolated work", task: "Edit in isolation", role: "implementation", isolation: "worktree",
      }, step))(req, res);
    }
    if (step === 0) return call("read_file", { path: "tracked.txt" }, step)(req, res);
    assert.match(previous[0], /committed version/);
    if (step === 1) return call("edit_file", { path: "tracked.txt", old_string: "committed version", new_string: "child edit" }, step)(req, res);
    if (step === 2) return call("write_file", { path: escape, content: "escape" }, step)(req, res);
    if (step === 3) return call("run_command", {
      command: `test ! -e "${tracked}" && ! (printf escape > "${escape}") 2>/dev/null && pwd && printf command > shell.txt`,
    }, step)(req, res);
    return answer(req, res);
  });
  await send(h, other.id, "Reject a non-Git project");
  const failed = await h.finished(other.id);
  assert.equal(ofType(failed, "thread.spawned").length, 0);
  assert.match(ofType(failed, "tool.finished")[0].result!, /Git-repo/);
  await send(h, parent.id, "Delegate an isolated edit");
  const parentEvents = await h.finished(parent.id);
  const result = JSON.parse(ofType(parentEvents, "tool.finished")[0].result!);
  const child = h.app.store.thread(result.threadId)!;
  assert.equal(child.worktreePath, result.worktreePath);
  assert.equal(child.worktreeBranch, result.branch);
  assert.match(result.branch, /^agent\/isolated-work-/);
  const childEvents = await h.finished(child.id);
  const childTools = ofType(childEvents, "tool.finished");
  assert.deepEqual(childTools.slice(0, 3).map(event => event.status), ["done", "done", "error"]);
  assert.equal(childTools[3].status, "done");
  assert.match(childTools[3].result!, new RegExp(`^${result.worktreePath}`));
  assert.equal(readFileSync(path.join(result.worktreePath, "shell.txt"), "utf8"), "command");
  assert.equal(readFileSync(path.join(result.worktreePath, "tracked.txt"), "utf8"), "child edit\n");
  assert.equal(readFileSync(tracked, "utf8"), "parent's local edit\n");
  assert.equal(existsSync(escape), false);
  assert.equal(existsSync(path.join(folder, "shell.txt")), false);
  assert.equal(git(result.worktreePath, "branch", "--show-current"), result.branch);
  assert.equal(git(repo, "branch", "--show-current"), "main");
});

test("search discovers eligible threads and inbox actions persist and broadcast", async t => {
  const { h, llm, modelId } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const parent = await h.thread(project.id, "code", modelId);
  const other = await h.project();
  const target = await h.thread(other.id, "code", modelId);
  await h.api("PATCH", `/api/threads/${target.id}`, { title: "Orchestration target" });
  const temporary = h.app.store.createThread(null, "chat", modelId, { title: "Orchestration temporary" });
  h.app.store.markTemporary(temporary.id);
  h.app.store.appendEvent(target.id, { type: "history.answer", messageId: "fixture", text: `Visible answer.\n${testKey}` });
  h.app.store.appendEvent(target.id, { type: "tool.output", runId: "fixture", callId: "fixture", text: "private tool output" });
  const socket = await h.socket();
  const untilAt = Date.now() + 86_400_000;
  const organize = (action: string, patch = {}) => ({ threadId: target.id, action, ...patch });
  const search = { query: "Orchestration", limit: 50 };
  const steps: Array<[string, unknown]> = [
    ["thread_read", { threadId: target.id }],
    ["thread_search", search],
    ["thread_read", { threadId: target.id }],
    ["thread_organize", organize("settle")],
    ["thread_search", search],
    ["thread_search", { ...search, includeArchived: true, projectId: other.id }],
    ["thread_organize", organize("unsettle")],
    ["thread_organize", organize("snooze", { snoozedUntil: "2099-02-31T12:00:00Z" })],
    ["thread_organize", organize("snooze", { snoozedUntil: new Date(untilAt).toISOString() })],
    ["thread_organize", organize("unsnooze")],
    ["thread_organize", organize("pin")],
    ["thread_organize", organize("rename", { title: "  Renamed target  " })],
    ["thread_organize", { action: "snooze", snoozedUntil: untilAt }],
    ["thread_organize", { action: "settle" }],
  ];
  llm.always((req, res) => {
    const step = results(req.body).length;
    const next = steps[step];
    return (next ? call(...next, step) : answer)(req, res);
  });
  await send(h, parent.id, "Manage the inbox");
  const events = await h.finished(parent.id);
  const tools = ofType(events, "tool.finished");
  assert.equal(tools[0].status, "error");
  assert.deepEqual(JSON.parse(tools[1].result!).map((row: any) => row.id), [target.id]);
  assert.match(tools[2].result!, /Visible answer/);
  assert.doesNotMatch(tools[2].result!, /private tool output|orchestration-fixture-credential/);
  assert.deepEqual(JSON.parse(tools[4].result!), []);
  assert.equal(JSON.parse(tools[5].result!)[0].archived, true);
  assert.equal(tools[7].status, "error");
  const final = h.app.store.thread(target.id)!;
  assert.deepEqual({ archived: final.archived, snoozedUntil: final.snoozedUntil, pinned: final.pinned, title: final.title },
    { archived: false, snoozedUntil: null, pinned: true, title: "Renamed target" });
  assert.ok(final.updatedAt > target.updatedAt);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.equal(h.app.store.thread(parent.id)?.archived, true);
  assert.equal(h.app.store.thread(parent.id)?.snoozedUntil, untilAt);
  for (const predicate of [
    (thread: typeof target) => thread.archived,
    (thread: typeof target) => thread.snoozedUntil === untilAt,
    (thread: typeof target) => thread.pinned === true && thread.title === "Renamed target",
  ]) await socket.waitFor(message => message.type === "thread.changed" && message.thread.id === target.id && predicate(message.thread));
});

test("scheduler tools use the HTTP scheduler, require approval for changes and preserve execution limits", async t => {
  const { h, llm, modelId } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "accept-edits" });
  const parent = await h.thread(project.id, "code", modelId);
  const stopApprovals = h.approveAll(parent.id);
  t.after(stopApprovals);
  const rule = { kind: "daily", time: "08:15" };
  const other = await h.api<Schedule>("POST", "/api/schedules", { name: "Existing Chat job", prompt: "Existing", projectId: null, modelId, rule });
  llm.always(async (req, res) => {
    if (req.body.messages[1].content === "Updated prompt") return answer(req, res);
    const previous = results(req.body);
    const step = previous.length;
    if (step === 0) return call("schedule_create", { name: "Recurring test", prompt: "Initial prompt", mode: "code", rule, enabled: false }, step)(req, res);
    const { id } = JSON.parse(previous[0]);
    if (step === 1) return call("schedule_list", { scope: "project" }, step)(req, res);
    if (step === 2) return call("schedule_update", { id, enabled: true, name: "Renamed schedule", prompt: "Updated prompt", rule: { kind: "interval", hours: 2 } }, step)(req, res);
    if (step === 3) {
      const [item] = JSON.parse(previous[1]);
      assert.equal(item.id, id);
      assert.equal(item.enabled, false);
      const updated = (await h.api<Schedule[]>("GET", "/api/schedules")).find(schedule => schedule.id === id)!;
      assert.equal(updated.paused, false);
      assert.equal(updated.prompt, "Updated prompt");
      assert.equal(updated.name, "Renamed schedule");
      assert.deepEqual(updated.rule, { kind: "interval", hours: 2 });
      await h.api("POST", `/api/schedules/${id}/run`);
      const launched = h.app.store.projectThreads(project.id).find(thread => thread.id !== parent.id)!;
      assert.equal(launched.permissionCap, "accept-edits");
      await h.finished(launched.id);
      return call("schedule_delete", { id }, step)(req, res);
    }
    return answer(req, res);
  });
  await send(h, parent.id, "Manage the schedule");
  const events = await h.finished(parent.id);
  assert.deepEqual(ofType(events, "tool.finished").map(event => event.status), ["done", "done", "done", "done"]);
  assert.equal(ofType(events, "approval.requested").length, 3);
  assert.deepEqual((await h.api<Schedule[]>("GET", "/api/schedules")).map(schedule => schedule.id), [other.id]);
});
