// 1.2.x: pull requests and issues for the signed-in GitHub account, across every repo, when no
// project has a GitHub remote or when «Mine på GitHub» is chosen. Everything runs against the
// local fake from fake-github.ts; no request ever goes to github.com.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { GITHUB_ACCOUNT_SCOPE } from "../src/github-pages.ts";
import { GOOD_TOKEN, startFakeGitHub, type FakeGitHub } from "./fake-github.ts";
import { startHarness, tempDir } from "./helpers.ts";

let fake: FakeGitHub;
before(async () => {
  fake = await startFakeGitHub();
  process.env.AD_GITHUB_API = fake.url;
});
after(async () => {
  delete process.env.AD_GITHUB_API;
  await fake.close();
});

const list = (kind: string, query: Record<string, string> = {}) => `/api/github/list/${kind}?${new URLSearchParams(query)}`;
const searches = () => fake.requests.filter(request => request.path.startsWith("/search/issues")).map(request => new URL(request.path, "http://fake").searchParams.get("q") ?? "");

test("uten prosjekter på GitHub: kontoens pull requests og issues fra alle repoer", async (t) => {
  const h = await startHarness(t);
  // A project without any remote, so it can never be a GitHub scope.
  await h.project();
  assert.deepEqual(await h.api("GET", "/api/github/projects"), []);
  await assert.rejects(h.api("GET", list("pull")), /409/, "not connected: the room asks for a connection, not an empty list");

  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const pulls = await h.api("GET", list("pull"));
  assert.deepEqual(pulls.items.map((item: any) => `${item.repo}#${item.number}`), ["ekstern/verktoy#7", "acme/rakett#42", "ekstern/verktoy#8"]);
  assert.equal(pulls.next, null);
  assert.equal(pulls.items[0].url, `${fake.url}/ekstern/verktoy/pull/7`);
  assert.equal(pulls.items[0].labels[0].name, "forbedring");
  assert.equal(pulls.items[1].checks, "PENDING", "pull requests are hydrated with checks across repos");
  const q = searches().at(-1)!;
  assert.match(q, /\binvolves:testbruker\b/);
  assert.doesNotMatch(q, /\brepo:/);

  const issues = await h.api("GET", list("issues"));
  assert.deepEqual(issues.items.map((item: any) => `${item.repo}#${item.number}`), ["ekstern/verktoy#9", "acme/rakett#40"]);

  // An explicit «Mine på GitHub» gives the same list, also when it is the saved filter.
  assert.deepEqual((await h.api("GET", list("issues", { projectId: GITHUB_ACCOUNT_SCOPE }))).items, issues.items);
  assert.deepEqual(await h.api("GET", `/api/github/labels?projectId=${GITHUB_ACCOUNT_SCOPE}`), []);
});

test("kontoomfang: involvering, tilstand, søk, etikett og sortering blir GitHub-kvalifikatorer", async (t) => {
  const h = await startHarness(t);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const numbers = async (kind: string, query: Record<string, string>) => (await h.api("GET", list(kind, query))).items.map((item: any) => item.number);

  assert.deepEqual(await numbers("pull", { involvement: "author" }), [7]);
  assert.match(searches().at(-1)!, /\bauthor:testbruker\b/);
  assert.doesNotMatch(searches().at(-1)!, /involves:/);
  assert.deepEqual(await numbers("pull", { involvement: "review-requested" }), [42, 8]);
  assert.match(searches().at(-1)!, /\breview-requested:testbruker\b/);
  assert.deepEqual(await numbers("issues", { involvement: "assignee" }), [40]);
  assert.match(searches().at(-1)!, /\bassignee:testbruker\b/);
  assert.deepEqual(await numbers("issues", { involvement: "mentions" }), [40]);
  assert.deepEqual(await numbers("issues", { search: "Konto-issue" }), [9]);
  assert.deepEqual(await numbers("issues", { sort: "oldest" }), [40, 9]);
  assert.deepEqual(await numbers("pull", { label: "forbedring" }), [7]);
  assert.match(searches().at(-1)!, /label:"forbedring"/);
  assert.deepEqual(await numbers("pull", { state: "merged" }), []);

  // Search words are quoted one by one, so typed text can never add a qualifier of its own.
  await h.api("GET", list("issues", { search: "repo:acme/hemmelig involves:noen" }));
  const q = searches().at(-1)!;
  assert.match(q, /"repo:acme\/hemmelig" "involves:noen" in:title,body/);
  assert.match(q, /\binvolves:testbruker\b/);
  // A number is looked for as a word, since search has no qualifier for it.
  await h.api("GET", list("issues", { search: "#9" }));
  assert.match(searches().at(-1)!, /"9" in:title,body/);
});

test("med prosjekter på GitHub: Alle prosjekter er fortsatt prosjektenes repoer, kontoen bare når den velges", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  writeFileSync(path.join(dir, ".git/HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(dir, ".git/config"), `[remote "origin"]\n\turl = git@github.com:acme/rakett.git\n`);
  await h.project(dir);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const projects = await h.api("GET", list("pull"));
  assert.ok(projects.items.every((item: any) => item.repo === "acme/rakett"));
  assert.match(searches().at(-1)!, /\brepo:acme\/rakett\b/);
  const account = await h.api("GET", list("pull", { projectId: GITHUB_ACCOUNT_SCOPE }));
  assert.ok(account.items.some((item: any) => item.repo === "ekstern/verktoy"));
  // An unknown project id is still nothing, never the whole account.
  assert.deepEqual(await h.api("GET", list("pull", { projectId: "finnes-ikke" })), { items: [], next: null });
});

test("detaljer, kommentarer og filer for et repo som ikke er et prosjekt", async (t) => {
  const h = await startHarness(t);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const ref = (part: string, kind = "pull", number = 7) => `/api/github/${part}/${kind}?repo=ekstern%2Fverktoy&number=${number}`;
  const detail = await h.api("GET", ref("detail"));
  assert.equal(detail.title, "Konto-PR i et annet repo");
  assert.equal(detail.url, `${fake.url}/ekstern/verktoy/pull/7`);
  assert.deepEqual(detail.projectIds, []);
  assert.equal(detail.pull.base, "main");
  assert.deepEqual((await h.api("GET", ref("comments"))).items.map((comment: any) => comment.body), ["Ser bra ut."]);
  assert.equal((await h.api("GET", ref("files"))).items[0].name, "lib/verktoy.ts");
  assert.equal((await h.api("GET", ref("detail", "issues", 9))).body, "Fra kontoen.");
  // The same checks as always: an owner/repo and nothing else reaches the GitHub API.
  for (const repo of ["ekstern/verktoy/../../user", "https://evil.example/x", "ekstern", "../verktoy", "ekstern/.."]) {
    await assert.rejects(h.api("GET", `/api/github/detail/pull?repo=${encodeURIComponent(repo)}&number=7`), /400/, repo);
  }
});
