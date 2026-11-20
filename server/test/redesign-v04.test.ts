// v0.4, the redesign: the branch chip read from .git/HEAD, the statistics on the start page and
// the list of archived threads. No git command is run anywhere, and no real API is called.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readGitHead } from "../src/git-head.ts";
import { OPENAI_DONE, openaiChunk, openaiUsage, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir } from "./helpers.ts";

const SHA = "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39";

function repo(root: string, head: string): string {
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, ".git/HEAD"), head);
  return root;
}

test("the branch is read from .git/HEAD: names, slashes, a detached commit and worktrees", (t) => {
  const dir = tempDir(t);
  assert.deepEqual(readGitHead(repo(path.join(dir, "a"), "ref: refs/heads/main\n")), { branch: "main", detached: false });
  assert.deepEqual(readGitHead(repo(path.join(dir, "b"), "ref: refs/heads/feature/ny-meny\n")), { branch: "feature/ny-meny", detached: false });
  assert.deepEqual(readGitHead(repo(path.join(dir, "c"), `${SHA}\n`)), { branch: "3f2a9c1", detached: true });

  // A worktree or submodule: .git is a file that points at the real folder, relative or absolute.
  const real = path.join(dir, "real-git");
  mkdirSync(real, { recursive: true });
  writeFileSync(path.join(real, "HEAD"), "ref: refs/heads/worktree-gren\n");
  const relative = path.join(dir, "wt-relative");
  mkdirSync(relative);
  writeFileSync(path.join(relative, ".git"), "gitdir: ../real-git\n");
  assert.equal(readGitHead(relative).branch, "worktree-gren");
  const absolute = path.join(dir, "wt-absolute");
  mkdirSync(absolute);
  writeFileSync(path.join(absolute, ".git"), `gitdir: ${real}\n`);
  assert.equal(readGitHead(absolute).branch, "worktree-gren");
});

test("no branch when there is no checkout, or HEAD is something else", (t) => {
  const dir = tempDir(t);
  const none = { branch: null, detached: false };
  mkdirSync(path.join(dir, "plain"));
  assert.deepEqual(readGitHead(path.join(dir, "plain")), none, "no .git");
  assert.deepEqual(readGitHead(path.join(dir, "missing")), none, "the folder is gone");
  mkdirSync(path.join(dir, "empty/.git"), { recursive: true });
  assert.deepEqual(readGitHead(path.join(dir, "empty")), none, ".git without HEAD");
  assert.deepEqual(readGitHead(repo(path.join(dir, "junk"), "hei på deg\n")), none, "not a ref or a hash");
  assert.deepEqual(readGitHead(repo(path.join(dir, "tag"), "ref: refs/tags/v1\n")), none, "only branches");
  assert.deepEqual(readGitHead(repo(path.join(dir, "big"), `ref: refs/heads/${"x".repeat(10_000)}\n`)), none, "a huge file is not read");
  mkdirSync(path.join(dir, "badfile"));
  writeFileSync(path.join(dir, "badfile/.git"), "noe annet\n");
  assert.deepEqual(readGitHead(path.join(dir, "badfile")), none, ".git file without gitdir");
  mkdirSync(path.join(dir, "head-dir/.git/HEAD"), { recursive: true });
  assert.deepEqual(readGitHead(path.join(dir, "head-dir")), none, "HEAD is a folder");
});

test("reading the branch never runs a command", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../src/git-head.ts"), "utf8");
  assert.doesNotMatch(source, /import[^;]*child_process|require\(/, "git-head.ts imports nothing that can run a command");
  assert.doesNotMatch(source, /\b(spawn|execFile|execSync|spawnSync)\(/);
});

test("GET /api/projects/:id/git gives the project's branch", async (t) => {
  const h = await startHarness(t);
  const withGit = repo(tempDir(t), "ref: refs/heads/utvikling\n");
  const project = await h.project(withGit);
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/git`), { branch: "utvikling", detached: false });
  writeFileSync(path.join(withGit, ".git/HEAD"), "ref: refs/heads/main\n");
  assert.equal((await h.api("GET", `/api/projects/${project.id}/git`)).branch, "main", "read again each time, no cache");
  const plain = await h.project(tempDir(t));
  assert.deepEqual(await h.api("GET", `/api/projects/${plain.id}/git`), { branch: null, detached: false });
  const missing = await h.raw("GET", "/api/projects/finnes-ikke/git");
  assert.equal(missing.status, 404);
});

test("start page statistics: ranges, sessions, messages, streaks, peak hour, favourite model and the heat map", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake-modell", model: "fake", contextWindow: 100_000 });
  const usage = (input: number, output: number) => sse(openaiChunk({ role: "assistant", content: "ok" }) + openaiChunk({}, "stop") + openaiUsage(input, output) + OPENAI_DONE);

  const empty = await h.api("GET", "/api/stats?range=all");
  assert.deepEqual(
    [empty.sessions, empty.messages, empty.totalTokens, empty.activeDays, empty.currentStreak, empty.longestStreak, empty.peakHour, empty.favoriteModel],
    [0, 0, 0, 0, 0, 0, null, null],
  );
  const weekday = (new Date().getDay() + 6) % 7; // Monday is 0
  assert.equal(empty.heat.length, 25 * 7 + weekday + 1, "25 whole weeks and this week up to today");
  assert.equal(new Date(`${empty.heat[0].date}T12:00:00`).getDay(), 1, "the map starts on a Monday");
  assert.equal(empty.heat.at(-1).date, new Date().toLocaleDateString("sv-SE"), "and ends today");

  // Forty days ago, then three days ago, then today twice.
  const old = await h.thread(null, "chat", model.id);
  llm.reply(usage(1000, 100));
  await h.api("POST", `/api/threads/${old.id}/messages`, { text: "for lenge siden" });
  await h.finished(old.id);
  h.app.store.shiftThreadTime(old.id, 40 * 86_400_000);

  const recent = await h.thread(null, "chat", model.id);
  llm.reply(usage(200, 20));
  await h.api("POST", `/api/threads/${recent.id}/messages`, { text: "for tre dager siden" });
  await h.finished(recent.id);
  h.app.store.shiftThreadTime(recent.id, 3 * 86_400_000);

  const today = await h.thread(null, "chat", model.id);
  llm.reply(usage(300, 30));
  await h.api("POST", `/api/threads/${today.id}/messages`, { text: "i dag" });
  await h.finished(today.id);
  llm.reply(usage(500, 50)); // running total 800 + 80, so this step is 220
  await h.api("POST", `/api/threads/${today.id}/messages`, { text: "igjen i dag" });
  await h.finished(today.id, 2);

  const all = await h.api("GET", "/api/stats?range=all");
  assert.equal(all.range, "all");
  assert.equal(all.sessions, 3);
  assert.equal(all.messages, 4);
  assert.equal(all.totalTokens, 1100 + 220 + 880);
  assert.equal(all.activeDays, 3);
  assert.equal(all.currentStreak, 1);
  assert.equal(all.longestStreak, 1);
  assert.deepEqual(all.favoriteModel, { modelId: model.id, name: "Fake-modell" });
  assert.deepEqual(all.byModel, [{ modelId: model.id, name: "Fake-modell", tokens: 2200, runs: 4 }]);
  assert.equal(all.peakHour, new Date().getHours(), "two runs today, in this hour");

  const month = await h.api("GET", "/api/stats?range=30d");
  assert.deepEqual([month.sessions, month.messages, month.totalTokens, month.activeDays], [2, 3, 220 + 880, 2]);

  const week = await h.api("GET", "/api/stats?range=7d");
  assert.deepEqual([week.sessions, week.messages, week.totalTokens], [2, 3, 1100]);

  // The heat map covers half a year whatever the range, so the old day is in it too.
  const heatTotal = (stats: any) => stats.heat.reduce((sum: number, d: any) => sum + d.tokens, 0);
  assert.equal(heatTotal(week), 2200);
  assert.equal(week.heat.at(-1).tokens, 880);
  assert.equal(week.heat.at(-1).runs, 2);

  const profile = await h.api("GET", "/api/profile");
  assert.equal(profile.costUsd, null, "no price set, so no cost");
  await h.api("PATCH", `/api/models/${model.id}`, { providerId: provider.id, name: "Fake-modell", model: "fake", contextWindow: 100_000, inputPricePerMTok: 1_000_000, outputPricePerMTok: 1_000_000 });
  const priced = await h.thread(null, "chat", model.id);
  llm.reply(usage(3, 2));
  await h.api("POST", `/api/threads/${priced.id}/messages`, { text: "med pris" });
  await h.finished(priced.id);
  assert.equal((await h.api("GET", "/api/profile")).costUsd, 5, "a dollar per token in this test, so 3 + 2");

  const bad = await h.raw("GET", "/api/stats?range=1y");
  assert.equal(bad.status, 400);
});

test("the statistics card can be turned off in the settings", async (t) => {
  const h = await startHarness(t);
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.homeStats, undefined, "on by default");
  assert.equal((await h.api("PATCH", "/api/settings", { homeStats: false })).homeStats, false);
  assert.equal((await h.api("PATCH", "/api/settings", { homeStats: "ja" })).homeStats, false, "only true turns it on");
  assert.equal((await h.api("PATCH", "/api/settings", { homeStats: true })).homeStats, true);
});

test("archived threads: listed newest first, and gone from the list when restored or deleted", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(tempDir(t));
  const first = await h.thread(project.id, "code");
  const second = await h.thread(null, "chat");
  const kept = await h.thread(null, "chat");
  assert.deepEqual(await h.api("GET", "/api/threads/archived"), []);

  await h.api("PATCH", `/api/threads/${first.id}`, { archived: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await h.api("PATCH", `/api/threads/${second.id}`, { title: "Nyere" });
  await h.api("PATCH", `/api/threads/${second.id}`, { archived: true });
  const listed = await h.api("GET", "/api/threads/archived");
  assert.deepEqual(listed.map((thread: any) => thread.id).sort(), [first.id, second.id].sort());
  assert.ok(listed.every((thread: any) => thread.archived));
  assert.ok(!listed.some((thread: any) => thread.id === kept.id));
  assert.ok(listed[0].updatedAt >= listed[1].updatedAt, "newest first");

  await h.api("PATCH", `/api/threads/${first.id}`, { archived: false });
  assert.deepEqual((await h.api("GET", "/api/threads/archived")).map((thread: any) => thread.id), [second.id], "Gjenopprett takes it off the list");
  await h.api("DELETE", `/api/threads/${second.id}`);
  assert.deepEqual(await h.api("GET", "/api/threads/archived"), []);
});
