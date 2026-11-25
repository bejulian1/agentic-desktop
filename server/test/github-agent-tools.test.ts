import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { test } from "node:test";
import type { ThreadEvent } from "../../shared/protocol.ts";
import { fakeGh, GOOD_TOKEN, startFakeGitHub } from "./fake-github.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until } from "./helpers.ts";

const SHA = "a".repeat(40);
const PR = { number: 42, title: "Fix the build", body: "PR body", state: "open", draft: false, mergeable: true,
  base: { ref: "main" }, head: { ref: "feature", sha: SHA } };
const REPO = { full_name: "acme/rakett", private: true, default_branch: "main", description: "Space app", updated_at: "2026-11-18T09:00:00Z" };
const READ = ["github_repos", "github_pr_list", "github_pr_read", "github_issue_list", "github_issue_read", "github_ci_logs"];
const WRITE = ["github_repo_create", "github_repo_clone", "github_pr_create", "github_pr_comment", "github_pr_merge", "github_issue_create", "github_issue_comment"];
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

function payload(req: IncomingMessage, next: (body: any) => void) {
  let text = "";
  req.on("data", chunk => { text += chunk; });
  req.on("end", () => next(JSON.parse(text)));
}

test("Kode GitHub context, reads, approvals, PR linking and authenticated clone", async t => {
  const fixture = tempDir(t, "ad-github-fixture-");
  const bare = path.join(fixture, "rakett.git");
  git(fixture, "init", "--template=", "--initial-branch=main");
  writeFileSync(path.join(fixture, "readme.txt"), "Private clone worked.\n");
  git(fixture, "add", "readme.txt");
  git(fixture, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "Fixture");
  git(fixture, "clone", "--bare", ".", bare);
  git(bare, "update-server-info");
  const writes: Array<{ method: string; route: string; body: any }> = [];
  let cloneAuthenticated = false;
  let downloadedAuth: string | undefined;
  const fake = await startFakeGitHub((req, res, url) => {
    const route = url.pathname;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      return true;
    };
    if (route.startsWith("/acme/rakett.git/")) {
      const expected = "Basic " + Buffer.from(`x-access-token:${GOOD_TOKEN}`).toString("base64");
      if (req.headers.authorization !== expected) {
        res.writeHead(401, { "www-authenticate": 'Basic realm="Git"' }).end();
        return true;
      }
      cloneAuthenticated = true;
      const file = route.slice("/acme/rakett.git/".length);
      if (/^(?:HEAD|info\/refs|objects\/(?:info\/packs|[0-9a-f]{2}\/[0-9a-f]{38}))$/.test(file) && existsSync(path.join(bare, file))) {
        res.writeHead(200).end(readFileSync(path.join(bare, file)));
      } else res.writeHead(404).end();
      return true;
    }
    if (route === "/job-log") {
      downloadedAuth = req.headers.authorization;
      res.writeHead(200).end(`setup\nrun\nfailed with ${GOOD_TOKEN}\n`);
      return true;
    }
    const paths = ["/user/repos", "/repos/acme/rakett/pulls/42", "/repos/acme/rakett/commits/" + SHA + "/check-runs",
      "/repos/acme/rakett/actions/jobs/9/logs", "/repos/acme/rakett/pulls", "/repos/acme/rakett/issues",
      "/repos/acme/rakett/pulls/42/merge", "/repos/acme/rakett/issues/42/comments", "/repos/acme/rakett/issues/40/comments"];
    if (!paths.includes(route)) return false;
    if (req.headers.authorization !== `Bearer ${GOOD_TOKEN}`) return send(401, { message: "Bad credentials" });
    if (req.method === "POST" || req.method === "PUT") {
      payload(req, body => {
        writes.push({ method: req.method!, route, body });
        if (route === "/user/repos") send(201, { ...REPO, full_name: `testbruker/${body.name}`, private: body.private });
        else if (route.endsWith("/merge")) send(body.sha === SHA ? 200 : 409, { merged: body.sha === SHA, sha: SHA });
        else if (route.endsWith("/comments")) send(201, { id: 15, body: body.body });
        else if (route.endsWith("/pulls")) send(201, { ...PR, number: 45, title: body.title });
        else send(201, { number: 46, title: body.title, state: "open" });
      });
      return true;
    }
    if (route === "/user/repos") return send(200, [REPO]);
    if (route.endsWith("/check-runs")) return send(200, { total_count: 2, check_runs: [
      { name: "build", status: "completed", conclusion: "failure", app: { slug: "github-actions" }, details_url: "https://github.com/acme/rakett/actions/runs/12/job/9" },
      { name: "external", status: "completed", conclusion: "neutral" },
    ] });
    if (route.endsWith("/logs")) {
      res.writeHead(302, { location: "/job-log?signature=test" }).end();
      return true;
    }
    if (route.endsWith("/pulls/42") && req.headers.accept === "application/vnd.github.diff") {
      res.writeHead(200).end(`diff --git a/file b/file\n+${GOOD_TOKEN}\n${"+a\n".repeat(5000)}`);
      return true;
    }
    if (route.endsWith("/pulls/42")) return send(200, PR);
    return false;
  });
  t.after(fake.close);
  const home = tempDir(t, "ad-github-home-");
  const previousBase = process.env.AD_GITHUB_API;
  const previousPath = process.env.PATH;
  process.env.AD_GITHUB_API = fake.url;
  t.after(() => {
    if (previousBase === undefined) delete process.env.AD_GITHUB_API;
    else process.env.AD_GITHUB_API = previousBase;
    process.env.PATH = previousPath;
  });
  const h = await startHarness(t, { localWorkspace: true, homeDir: home });
  const socket = await h.socket();
  const llm = await startFakeLlm(t);
  llm.always(sse(openaiText("Done.")));
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local test", baseUrl: `${llm.url}/v1`, apiKey: "test-only" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "GitHub tools", model: "test", contextWindow: 100_000 });
  const project = await h.project(undefined, { permissionMode: "ask" });
  const empty = await h.project(undefined, { permissionMode: "accept-edits" });
  git(project.path, "init", "--template=");
  git(project.path, "remote", "add", "origin", "git@github.com:acme/rakett.git");

  let callId = 0;
  type Invocation = [name: string, input: unknown];
  async function turn(projectId: string | null, calls: Invocation[] = [], options: { plan?: boolean; approve?: boolean; mode?: "chat" | "code" } = {}) {
    const thread = await h.thread(projectId, options.mode ?? "code", model.id);
    if (options.plan) await h.api("PATCH", `/api/threads/${thread.id}`, { planMode: true });
    const runs = ofType((await h.events(thread.id)).map(entry => entry.event), "run.finished").length;
    const requestIndex = llm.requests.length;
    for (const [name, input] of calls) llm.reply(sse(openaiToolCall(name, input, `github_call_${++callId}`)));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Use the specified tools." });
    const approvals: Array<Extract<ThreadEvent, { type: "approval.requested" }>> = [];
    if (options.approve) {
      for (let i = 0; i < calls.length; i++) {
        await until(async () => {
          const previous = (await h.events(thread.id)).map(entry => entry.event);
          const approval = ofType(previous, "approval.requested")[i];
          if (!approval) return false;
          approvals.push(approval);
          return true;
        }, "GitHub write approval");
        await h.api("POST", `/api/approvals/${approvals[i].approvalId}`, { decision: "allow" });
      }
    }
    const events = await h.finished(thread.id, runs + 1);
    const request = llm.requests[requestIndex].body;
    const tools = (request.tools ?? []).map((tool: any) => tool.function.name).filter((name: string) => name.startsWith("github_"));
    const prompt = request.messages.find((message: any) => message.role === "system").content;
    assert.ok(!JSON.stringify({ events, request }).includes(GOOD_TOKEN));
    return { thread, events, approvals, tools, prompt, results: ofType(events, "tool.finished") };
  }

  const disconnected = await turn(project.id);
  assert.deepEqual(disconnected.tools, []);
  assert.doesNotMatch(disconnected.prompt, /# GitHub/);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  await assert.rejects(h.api("PATCH", "/api/settings", { agentGitHubAccess: "admin" }), { status: 400 });

  const reading: Invocation[] = [
    ["github_repos", { query: "space" }], ["github_pr_list", { repo: "acme/rakett" }],
    ["github_pr_read", { repo: "acme/rakett", number: 42, includeDiff: true, includeComments: true }],
    ["github_issue_list", { repo: "acme/rakett" }], ["github_issue_read", { repo: "acme/rakett", number: 40 }],
    ["github_ci_logs", { repo: "acme/rakett", number: 42, tailLines: 1 }],
  ];
  for (const plan of [false, true]) {
    const out = await turn(plan ? empty.id : project.id, reading, { plan });
    assert.deepEqual(new Set(out.tools), new Set(plan ? READ : [...READ, ...WRITE]));
    assert.match(out.prompt, /GitHub is connected as testbruker/);
    assert.match(out.prompt, plan ? /not linked to a GitHub remote yet/ : /repository is acme\/rakett/);
    assert.deepEqual(ofType(out.events, "approval.requested"), []);
    assert.deepEqual(out.results.map(result => result.status), Array(6).fill("done"));
    const [repos, pulls, pr, issues, issue, ci] = out.results.map(result => JSON.parse(result.result!));
    assert.equal(repos[0].fullName, "acme/rakett");
    assert.equal(pulls[0].number, 42);
    assert.equal(pr.headSha, SHA);
    assert.equal(pr.checks.failed, 1);
    assert.equal(pr.reviewThreads[0].path, "src/start.ts");
    assert.match(pr.diff, /\[redacted\]/);
    assert.equal(pr.diffTruncated, true);
    assert.equal(issues[0].number, 40);
    assert.equal(issue.assignees[0], "testbruker");
    assert.equal(issue.comments.length, 1);
    assert.match(ci.logs[0].log, /^failed with \[redacted\]/);
    assert.equal(downloadedAuth, undefined);
  }

  const local = await turn(null, [["github_pr_list", {}], ["github_issue_list", {}]]);
  assert.match(local.prompt, /not linked to a GitHub remote yet.*github_repo_clone.*github_repo_create/);
  assert.ok(JSON.parse(local.results[0].result!).some((item: any) => item.repo === "ekstern/verktoy"));
  assert.ok(JSON.parse(local.results[1].result!).some((item: any) => item.repo === "ekstern/verktoy"));

  const writeAttempt: Invocation[] = [["github_issue_create", { title: "Do not write" }]];
  await h.api("PATCH", "/api/settings", { agentGitHubAccess: "read" });
  const readOnly = await turn(project.id, writeAttempt);
  assert.deepEqual(new Set(readOnly.tools), new Set(READ));
  assert.equal(readOnly.results[0].status, "error");
  await h.api("PATCH", "/api/settings", { agentGitHubAccess: "off" });
  const off = await turn(project.id);
  assert.deepEqual(off.tools, []);
  assert.doesNotMatch(off.prompt, /# GitHub/);
  await h.api("PATCH", "/api/settings", { agentGitHubAccess: "read-write" });
  assert.deepEqual((await turn(null, [], { mode: "chat" })).tools, []);
  const planWrite = await turn(project.id, writeAttempt, { plan: true });
  assert.equal(planWrite.results[0].status, "error");
  assert.equal(writes.length, 0);

  // A stale always-allow rule cannot suppress a GitHub approval.
  h.app.store.allow(project.id, "tool", "github_pr_create");
  const changed = await turn(project.id, [
    ["github_pr_create", { title: "New pull request", head: "feature" }],
    ["github_issue_create", { title: "New issue", labels: ["feil"] }],
    ["github_pr_comment", { number: 42, body: "PR feedback" }],
    ["github_issue_comment", { number: 40, body: "Issue feedback" }],
    ["github_pr_merge", { number: 42, method: "squash", expectedHeadSha: "b".repeat(40) }],
    ["github_pr_merge", { number: 42, method: "squash", expectedHeadSha: SHA }],
  ], { approve: true });
  assert.deepEqual(changed.results.map(result => result.status), ["done", "done", "done", "done", "error", "done"]);
  assert.match(changed.results[4].result!, /head no longer matches/);
  assert.match(changed.approvals[0].title, /acme\/rakett.*feature.*New pull request/);
  assert.ok(changed.approvals.every(approval => approval.allowAlways === undefined));
  assert.equal(writes[0].body.base, "main");
  assert.equal(writes.at(-1)!.body.sha, SHA);
  const linked = h.app.store.thread(changed.thread.id)!;
  assert.deepEqual(linked.linkedPr, { repo: "acme/rakett", number: 45, url: "https://github.com/acme/rakett/pull/45" });
  await socket.waitFor(msg => msg.type === "thread.changed" && msg.thread.id === changed.thread.id && msg.thread.linkedPr?.number === 45);

  const created = await turn(empty.id, [["github_repo_create", { name: "new-project", connectCurrentFolder: true }]], { approve: true });
  assert.match(created.approvals[0].title, /private.*new-project.*connect/);
  assert.equal(created.results[0].status, "done");
  assert.equal(writes.at(-1)!.body.private, true);
  assert.equal(git(empty.path, "remote", "get-url", "origin"), "https://github.com/testbruker/new-project.git");
  assert.ok(!readFileSync(path.join(empty.path, ".git", "config"), "utf8").includes(GOOD_TOKEN));
  assert.match(llm.requests.at(-1)!.body.messages[0].content, /repository is testbruker\/new-project/);

  const outside = tempDir(t, "ad-github-outside-");
  symlinkSync(outside, path.join(project.path, "escape"));
  const invalid = await turn(project.id, [
    ["github_repo_clone", { repo: "acme/rakett", directory: "../escape" }],
    ["github_repo_clone", { repo: "acme/rakett", directory: "escape/clone" }],
    ["github_pr_read", { number: "42.8" }],
  ]);
  assert.deepEqual(invalid.results.map(result => result.status), ["error", "error", "error"]);
  assert.deepEqual(ofType(invalid.events, "approval.requested"), []);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(cloneAuthenticated, false);

  const cli = fakeGh(tempDir(t, "ad-github-cli-"));
  process.env.PATH = cli.path;
  await h.api("PUT", "/api/github/cli");
  const clone = await turn(project.id, [["github_repo_clone", { repo: "git@github.com:acme/rakett.git", directory: "copies/copy" }]], { approve: true });
  assert.equal(clone.results[0].status, "done", clone.results[0].result ?? "Clone failed");
  assert.equal(cloneAuthenticated, true);
  const copy = path.join(project.path, "copies", "copy");
  assert.equal(readFileSync(path.join(copy, "readme.txt"), "utf8"), "Private clone worked.\n");
  assert.equal(git(copy, "remote", "get-url", "origin"), "https://github.com/acme/rakett.git");
  assert.ok(!readFileSync(path.join(copy, ".git", "config"), "utf8").includes(GOOD_TOKEN));
  assert.deepEqual(readdirSync(project.path).sort(), [".git", "copies", "escape"]);
});
