// Round 8 (agent G): GitHub (Beta) against a local fake server, and saving from the mini editor.
// No request ever goes to github.com: AD_GITHUB_API points at the fake server below.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { hashContent } from "../src/agent/filestate.ts";
import { apiBase, parseGitHubUrl, parseRemotes, plausibleToken, readGitHubRemote } from "../src/github.ts";
import { fakeGh, GOOD_TOKEN, OTHER_TOKEN, startFakeGitHub, type FakeGitHub } from "./fake-github.ts";
import { startHarness, tempDir } from "./helpers.ts";
import type { MemoryKeyring } from "../src/keyring.ts";

let fake: FakeGitHub;
before(async () => {
  fake = await startFakeGitHub();
  process.env.AD_GITHUB_API = fake.url;
});
after(async () => {
  delete process.env.AD_GITHUB_API;
  await fake.close();
});

function gitProject(dir: string, config: string): void {
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  writeFileSync(path.join(dir, ".git/HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(dir, ".git/config"), config);
}

const RAKETT = `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:acme/rakett.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;

test("GitHub-adresser og remotes leses uten git", () => {
  for (const [url, expected] of [
    ["https://github.com/acme/rakett.git", "acme/rakett"],
    ["https://github.com/acme/rakett", "acme/rakett"],
    ["https://bruker@github.com/acme/rakett.git/", "acme/rakett"],
    ["git@github.com:acme/rakett.git", "acme/rakett"],
    ["ssh://git@github.com/acme/rakett.git", "acme/rakett"],
    ["ssh://git@ssh.github.com:443/acme/rakett.git", "acme/rakett"],
    ["git://github.com/acme/rak.ett", "acme/rak.ett"],
  ] as const) {
    const found = parseGitHubUrl(url);
    assert.equal(found && `${found.owner}/${found.repo}`, expected, url);
  }
  for (const url of ["https://gitlab.com/acme/rakett.git", "https://github.com.evil.example/acme/rakett", "git@github.com:acme/rakett/extra.git", "https://github.com/acme", "/home/x/repo", "file:///tmp/repo", "https://github.com/acme/..", "git@github.com:acme/rak ett.git"]) {
    assert.equal(parseGitHubUrl(url), null, url);
  }
  const remotes = parseRemotes(`; kommentar\n[remote "upstream"]\n  url = https://gitlab.com/x/y\n[branch "main"]\n  remote = origin\n[remote "origin"]\n  URL = "git@github.com:acme/rakett.git"\n  url = https://github.com/annen/andre\n`);
  assert.deepEqual(remotes, [{ name: "upstream", url: "https://gitlab.com/x/y" }, { name: "origin", url: "git@github.com:acme/rakett.git" }]);
  assert.equal(apiBase("https://api.evil.example"), "https://api.github.com", "bare loopback kan overstyre");
  assert.equal(apiBase("http://127.0.0.1:9/api/"), "http://127.0.0.1:9/api");
  assert.equal(plausibleToken("ghp_abc def ghi jkl mno pqr"), false);
  assert.equal(plausibleToken(GOOD_TOKEN), true);
});

test("repoet finnes i .git/config, også i et worktree, og ellers står det hvorfor ikke", (t) => {
  const plain = tempDir(t);
  assert.match(readGitHubRemote(plain).reason ?? "", /ikke en git-mappe/);
  gitProject(plain, `[core]\n\tbare = false\n`);
  assert.match(readGitHubRemote(plain).reason ?? "", /ingen remote/);
  writeFileSync(path.join(plain, ".git/config"), `[remote "origin"]\n\turl = https://gitlab.com/acme/rakett.git\n`);
  assert.match(readGitHubRemote(plain).reason ?? "", /Ingen remote peker til GitHub/);
  writeFileSync(path.join(plain, ".git/config"), `[remote "origin"]\n\turl = https://gitlab.com/acme/rakett.git\n[remote "speil"]\n\turl = https://github.com/acme/rakett\n`);
  assert.deepEqual(readGitHubRemote(plain).remote, { owner: "acme", repo: "rakett", remote: "speil", url: "https://github.com/acme/rakett" });

  // A worktree: .git is a file, and the config lives in the main checkout's folder.
  const main = tempDir(t);
  gitProject(main, RAKETT);
  mkdirSync(path.join(main, ".git/worktrees/gren"), { recursive: true });
  writeFileSync(path.join(main, ".git/worktrees/gren/commondir"), "../..\n");
  const worktree = tempDir(t);
  writeFileSync(path.join(worktree, ".git"), `gitdir: ${path.join(main, ".git/worktrees/gren")}\n`);
  assert.equal(readGitHubRemote(worktree).remote?.repo, "rakett");
});

test("koble til, lese pull requests og issues, og koble fra, uten at tokenet forlater serveren", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  gitProject(dir, RAKETT);
  const project = await h.project(dir);

  assert.deepEqual(await h.api("GET", "/api/github"), { connected: false });
  const before = await h.api("GET", `/api/projects/${project.id}/github`);
  assert.equal(before.remote.repo, "rakett");
  assert.equal(before.error.code, "not-connected");
  assert.equal(fake.requests.length, 0, "ingen forespørsel uten token");

  // A wrong token and a pasted sentence: refused, and nothing is stored.
  const wrong = await h.raw("PUT", "/api/github/token", { headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "ghp_" + "feil000000000000000000000000000000" }) });
  assert.equal(wrong.status, 400);
  assert.equal(JSON.parse(wrong.body).code, "bad-token");
  const sentence = await h.raw("PUT", "/api/github/token", { headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "her er tokenet mitt" }) });
  assert.equal(sentence.status, 400);
  assert.deepEqual(await h.api("GET", "/api/github"), { connected: false });

  const status = await h.api("PUT", "/api/github/token", { token: `  ${GOOD_TOKEN}\n` });
  assert.equal(status.login, "testbruker");
  assert.equal(status.scopes, "repo, read:org");
  // Round 14 (SPEC 30.1): in the keyring, with a label, and not in a file in the data dir.
  assert.equal(existsSync(path.join(h.app.config.dataDir, "keys.json")), false);
  assert.deepEqual((h.keyring as MemoryKeyring).items.get("integration:github"), { label: "Agentic Desktop: GitHub-token", secret: GOOD_TOKEN });

  const data = await h.api("GET", `/api/projects/${project.id}/github`);
  assert.equal(data.repo.description, "En rakett av en app ✨");
  assert.deepEqual(data.pulls.map((p: any) => p.number), [42, 41]);
  assert.equal(data.pulls[1].draft, true);
  assert.equal(data.pulls[0].head, "rask-oppstart");
  assert.equal(data.pulls[0].url, `${fake.url}/acme/rakett/pull/42`, "lenken bygges fra repoet, ikke fra svaret");
  assert.deepEqual(data.issues.map((i: any) => i.number), [40, 39], "pull requests er ikke med blant issues");
  assert.equal(data.issues[1].author, null);
  assert.equal(data.issues[1].labels[0].color, "888888", "en ugyldig farge blir grå");
  assert.equal(fake.requests[0].path, "/user", "det gale tokenet ble prøvd én gang");
  assert.ok(fake.requests.slice(1).every((r) => r.auth === `Bearer ${GOOD_TOKEN}`));

  // Nothing the browser can read holds the token.
  for (const url of ["/api/github", "/api/bootstrap", `/api/projects/${project.id}/github`]) {
    assert.ok(!(await h.raw("GET", url)).body.includes(GOOD_TOKEN), url);
  }
  // A child process never sees it, whatever the variable is called.
  process.env.LITT_AV_HVERT = GOOD_TOKEN;
  assert.ok(!Object.values(h.app.childEnv()).includes(GOOD_TOKEN));
  delete process.env.LITT_AV_HVERT;

  // Within a minute the answer comes from the cache. A refresh asks with the ETag.
  const count = fake.requests.length;
  await h.api("GET", `/api/projects/${project.id}/github`);
  assert.equal(fake.requests.length, count, "ingen nye forespørsler innen et minutt");
  const refreshed = await h.api("GET", `/api/projects/${project.id}/github?refresh=1`);
  assert.equal(refreshed.repo.stars, 1234, "304 gir de lagrede dataene");
  assert.ok(fake.requests.slice(count).some((r) => r.path === "/repos/acme/rakett" && r.ifNoneMatch === '"rakett-v1"'));

  // Another token replaces the first.
  assert.equal((await h.api("PUT", "/api/github/token", { token: OTHER_TOKEN })).login, "annen");

  assert.deepEqual(await h.api("DELETE", "/api/github/token"), { connected: false });
  assert.equal((h.keyring as MemoryKeyring).items.has("integration:github"), false, "tokenet er fjernet fra nøkkelringen");
  assert.equal((await h.api("GET", `/api/projects/${project.id}/github`)).error.code, "not-connected");
});

test("PR-oppfølging leser status for gyldige repoer og sender aldri tokenet til klienten", async (t) => {
  fake.setMode("ok");
  const h = await startHarness(t);
  const dir = tempDir(t);
  gitProject(dir, RAKETT);
  const project = await h.project(dir);
  const direct = "/api/github/pull-watch?repo=acme%2Frakett&number=42";
  const initialRequests = fake.requests.length;
  await assert.rejects(h.api("GET", direct), /409/);
  assert.equal(fake.requests.length, initialRequests);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const before = fake.requests.length;
  await assert.rejects(h.api("GET", "/api/github/pull-watch?repo=acme%2F..&number=42"), /400/);
  await assert.rejects(h.api("GET", "/api/github/pull-watch?repo=acme%2Frakett&number=2147483648"), /400/);
  assert.equal(fake.requests.length, before);
  const byRepo = await h.api("GET", direct);
  assert.deepEqual(await h.api("GET", `/api/github/pull-watch?project=${project.id}&number=42`), byRepo);
  assert.deepEqual(byRepo, {
    repo: "acme/rakett", number: 42, title: "Rask oppstart: last CodeMirror først når editoren åpnes 🚀",
    url: `${fake.url}/acme/rakett/pull/42`, state: "OPEN", head: "a".repeat(40), draft: false, checks: "PENDING", review: "REVIEW_REQUIRED",
  });
  assert.ok(fake.requests.slice(before).every((request) => request.path === "/graphql" && request.auth === `Bearer ${GOOD_TOKEN}`));
  await assert.rejects(h.api("GET", "/api/github/pull-watch?repo=acme%2Frakett&number=43"), /404/);
  const limited = await h.raw("GET", "/api/github/pull-watch?repo=acme%2Frakett&number=44");
  assert.equal(limited.status, 429);
  assert.equal(JSON.parse(limited.body).resetAt, 2_000_000_000_000);
});

test("feil fra GitHub: grense, frakobling, tilbakekalt token og repo uten tilgang", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  gitProject(dir, RAKETT);
  const project = await h.project(dir);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const read = () => h.api("GET", `/api/projects/${project.id}/github?refresh=1`);
  try {
    fake.setMode("rate-limit");
    const limited = await read();
    assert.equal(limited.error.code, "rate-limit");
    assert.ok(limited.error.resetAt > Date.now(), "når grensen nullstilles");
    assert.equal(limited.remote.repo, "rakett", "repoet vises fortsatt");

    fake.setMode("offline");
    assert.equal((await read()).error.code, "offline");

    fake.setMode("revoked");
    const revoked = await read();
    assert.equal(revoked.error.code, "bad-token");
    assert.match(revoked.error.message, /utløpt eller trukket tilbake/);

    fake.setMode("ok");
    writeFileSync(path.join(dir, ".git/config"), `[remote "origin"]\n\turl = https://github.com/acme/hemmelig\n`);
    assert.equal((await read()).error.code, "not-found");
    writeFileSync(path.join(dir, ".git/config"), `[remote "origin"]\n\turl = https://github.com/acme/tom.git\n`);
    const empty = await read();
    assert.equal(empty.error, undefined);
    assert.deepEqual([empty.pulls, empty.issues, empty.repo.defaultBranch], [[], [], "trunk"]);
  } finally {
    fake.setMode("ok");
  }
});

test("mini-editoren lagrer bare prosjektfiler, med vanlige sjekker og uten å overskrive andres endringer", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t);
  const outside = tempDir(t);
  writeFileSync(path.join(dir, "kort.ts"), "﻿export const a = 1;\r\nexport const b = 2;\r\n");
  writeFileSync(path.join(dir, "kjør.sh"), "#!/bin/sh\necho hei\n");
  chmodSync(path.join(dir, "kjør.sh"), 0o755);
  writeFileSync(path.join(dir, ".env"), "HEMMELIG=1\n");
  writeFileSync(path.join(outside, "annen.txt"), "utenfor\n");
  symlinkSync(path.join(outside, "annen.txt"), path.join(dir, "lenke.txt"));
  const project = await h.project(dir);
  const socket = await h.socket();

  const file = await h.api("GET", `/api/projects/${project.id}/file/edit?path=kort.ts`);
  assert.equal(file.text, "export const a = 1;\r\nexport const b = 2;\r\n", "BOM vises ikke");
  assert.equal(file.eol, "crlf");
  assert.equal(file.editable, true);
  assert.equal(file.hash, hashContent(readFileSync(path.join(dir, "kort.ts"))));

  const saved = await h.api("PUT", `/api/projects/${project.id}/file`, { path: "kort.ts", text: "export const a = 3;\r\n", hash: file.hash });
  assert.equal(readFileSync(path.join(dir, "kort.ts"), "utf8"), "﻿export const a = 3;\r\n", "BOM og CRLF er beholdt");
  assert.notEqual(saved.hash, file.hash);
  await socket.waitFor((m) => m.type === "project.files-changed" && m.paths.includes("kort.ts"));

  // Changed on disk since it was opened: refused, unless the user says overwrite.
  writeFileSync(path.join(dir, "kort.ts"), "endret av noen andre\n");
  const stale = await h.raw("PUT", `/api/projects/${project.id}/file`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "kort.ts", text: "mitt", hash: saved.hash }) });
  assert.equal(stale.status, 409);
  assert.equal(JSON.parse(stale.body).code, "changed");
  await h.api("PUT", `/api/projects/${project.id}/file`, { path: "kort.ts", text: "mitt\n", hash: saved.hash, force: true });
  assert.equal(readFileSync(path.join(dir, "kort.ts"), "utf8"), "mitt\n");

  const script = await h.api("GET", `/api/projects/${project.id}/file/edit?path=kj%C3%B8r.sh`);
  await h.api("PUT", `/api/projects/${project.id}/file`, { path: "kjør.sh", text: "#!/bin/sh\necho hallo\n", hash: script.hash });
  assert.equal(statSync(path.join(dir, "kjør.sh")).mode & 0o777, 0o755, "kjørbar fil forblir kjørbar");

  const env = await h.api("GET", `/api/projects/${project.id}/file/edit?path=.env`);
  assert.equal(env.editable, false);
  const status = async (body: unknown) => (await h.raw("PUT", `/api/projects/${project.id}/file`, { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status;
  assert.equal(await status({ path: ".env", text: "X=2", hash: env.hash }), 403);
  assert.equal(readFileSync(path.join(dir, ".env"), "utf8"), "HEMMELIG=1\n");
  assert.equal(await status({ path: "../utenfor.txt", text: "x", hash: "" }), 403);
  assert.equal(await status({ path: "lenke.txt", text: "x", hash: "" }), 403, "en symlenke ut av prosjektet");
  assert.equal(readFileSync(path.join(outside, "annen.txt"), "utf8"), "utenfor\n");
  assert.equal(await status({ path: "finnes-ikke.ts", text: "x", hash: "" }), 404);
  assert.equal(await status({ path: "kort.ts", hash: "" }), 400);
});

test("GitHub CLI bruker aktiv innlogging fra PATH og kobler fra uten å logge ut gh", async (t) => {
  const bin = tempDir(t);
  const originalPath = process.env.PATH;
  const previousConfig = process.env.GH_CONFIG_DIR;
  const fakeCli = fakeGh(path.join(bin, "bin"), false);
  process.env.PATH = bin;
  process.env.GH_CONFIG_DIR = path.join(bin, "config");
  t.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (previousConfig === undefined) delete process.env.GH_CONFIG_DIR;
    else process.env.GH_CONFIG_DIR = previousConfig;
  });
  const h = await startHarness(t);
  assert.deepEqual(await h.api("GET", "/api/github/cli"), { state: "missing" });
  await assert.rejects(h.api("PUT", "/api/github/cli"), /409/);
  process.env.PATH = fakeCli.path;
  assert.deepEqual(await h.api("GET", "/api/github/cli"), { state: "signed-out" });
  assert.deepEqual(await h.api("PUT", "/api/github/cli"), { connected: false, method: "gh" });
  fakeCli.signIn();
  assert.deepEqual(await h.api("GET", "/api/github"), { connected: true, method: "gh", login: "testbruker" });

  const dir = tempDir(t);
  gitProject(dir, RAKETT);
  const project = await h.project(dir);
  const before = fake.requests.length;
  const list = await h.api("GET", "/api/github/list/issues");
  assert.deepEqual(list.items.map((item: any) => item.number), [40, 39]);
  assert.equal((await h.api("GET", `/api/projects/${project.id}/github`)).issues.length, 2);
  assert.equal((await h.api("GET", "/api/github/pull-watch?repo=acme%2Frakett&number=42")).checks, "PENDING");
  assert.ok(fake.requests.slice(before).every(request => request.auth === `Bearer ${GOOD_TOKEN}`));
  const boot = await h.api("GET", "/api/bootstrap");
  assert.equal(boot.settings.githubAuth, "gh");
  assert.ok(!JSON.stringify(boot).includes(GOOD_TOKEN));
  assert.ok(!JSON.stringify(list).includes(GOOD_TOKEN));
  assert.equal((h.keyring as MemoryKeyring).items.has("integration:github"), false);
  assert.ok(!Object.values(h.app.childEnv()).includes(GOOD_TOKEN));

  assert.deepEqual(await h.api("DELETE", "/api/github"), { connected: false });
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.githubAuth, null);
  assert.deepEqual(await h.api("GET", "/api/github/cli"), { state: "signed-in", login: "testbruker" });
  await assert.rejects(h.api("GET", "/api/github/list/issues"), /409/);
});

test("GitHub-prosjekter, søk, sortering, etiketter, paginering og lagrede visninger", async (t) => {
  const h = await startHarness(t);
  const rakett = tempDir(t);
  gitProject(rakett, RAKETT);
  const p1 = await h.project(rakett);
  const atlas = tempDir(t);
  gitProject(atlas, RAKETT.replace("acme/rakett", "acme/atlas"));
  const p2 = await h.project(atlas);
  const duplicate = tempDir(t);
  gitProject(duplicate, RAKETT.replace("acme/rakett", "ACME/RAKETT"));
  const p3 = await h.project(duplicate);
  await h.project();
  assert.deepEqual(new Set((await h.api("GET", "/api/github/projects")).map((p: any) => p.id)), new Set([p1.id, p2.id, p3.id]));
  // Put the two repos with results in different GitHub search requests.
  for (let i = 0; i < 7; i++) {
    const dir = tempDir(t);
    gitProject(dir, RAKETT.replace("acme/rakett", `acme/fyll-${i}`));
    await h.project(dir);
  }
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const first = await h.api("GET", "/api/github/list/issues");
  assert.equal(first.items.length, 25);
  const second = await h.api("GET", `/api/github/list/issues?cursor=${first.next}`);
  const numbers = [...first.items, ...second.items].map(item => item.number);
  assert.equal(numbers.length, 31);
  assert.equal(new Set(numbers).size, 31);
  assert.equal(second.next, null);
  const matches = async (kind: string, query: Record<string, string>) => (await h.api("GET", `/api/github/list/${kind}?${new URLSearchParams(query)}`)).items.map((item: any) => item.number);
  assert.deepEqual(await matches("issues", { sort: "oldest", projectId: p1.id }), [39, 40]);
  assert.deepEqual(await matches("issues", { sort: "newest", projectId: p1.id }), [40, 39]);
  assert.deepEqual(await matches("issues", { sort: "comments", search: "Unicode", label: "god første oppgave" }), [40]);
  assert.deepEqual(await matches("issues", { search: "#40", involvement: "mentions" }), [40]);
  assert.deepEqual(await matches("issues", { search: "40", involvement: "assignee" }), [40]);
  assert.deepEqual(await matches("pull", { involvement: "review-requested" }), [42]);
  assert.deepEqual(await matches("pull", { state: "merged" }), [38]);
  assert.deepEqual(await matches("pull", { state: "closed" }), []);
  assert.equal((await h.api("GET", "/api/github/list/pull")).items[0].checks, "PENDING");
  assert.equal((await h.api("GET", "/api/github/list/pull")).items[1].state, "draft");
  assert.ok((await h.api("GET", "/api/github/labels")).some((item: any) => item.name === "god første oppgave"));
  await assert.rejects(h.api("GET", "/api/github/list/issues?state=merged"), /400/);
  await assert.rejects(h.api("GET", "/api/github/list/issues?cursor=bogus"), /400/);

  const view = { id: "test-view", name: "Mine kartoppgaver", kind: "issues", filters: { projectId: p2.id, involvement: "author" } };
  const views = await h.api("POST", "/api/github/views", view);
  assert.equal(views[0].filters.projectId, p2.id);
  assert.equal(views[0].filters.state, "open");
  await assert.rejects(h.api("POST", "/api/github/views", view), /400/);
  assert.deepEqual((await h.api("GET", "/api/bootstrap")).settings.githubViews, views);
  assert.deepEqual(await h.api("DELETE", "/api/github/views/test-view"), []);

  assert.equal((await h.api("PATCH", "/api/settings", { githubOpenLinks: false })).githubOpenLinks, false);
  await assert.rejects(h.api("PATCH", "/api/settings", { githubOpenLinks: "false" }), /400/);
});

test("GitHub-detaljer har tidslinje, sjekker og filendringer, også for lenker utenfor prosjektene", async (t) => {
  const h = await startHarness(t);
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const pull = (path: string) => `/api/github/${path}/pull?repo=acme%2Frakett&number=42`;
  const detail = await h.api("GET", pull("detail"));
  assert.equal(detail.body, "Detaljer om **oppstarten**.");
  assert.deepEqual(detail.projectIds, []);
  assert.deepEqual(detail.pull, {
    base: "main", head: "rask-oppstart", review: "REVIEW_REQUIRED",
    checks: [{ name: "Typecheck", status: "SUCCESS" }, { name: "UI", status: "PENDING" }],
  });
  const comments = await h.api("GET", pull("comments"));
  assert.deepEqual(comments.items.map((comment: any) => comment.id), ["0:1", "1:2", "2:3"]);
  assert.equal(comments.items[2].path, "src/start.ts");
  assert.equal(comments.next, null);
  assert.equal((await h.api("GET", pull("files"))).items[0].patch, "@@ -1 +1 @@\n-før\n+etter");

  const issue = await h.api("GET", "/api/github/detail/issues?repo=acme%2Frakett&number=40");
  assert.deepEqual(issue.assignees, ["testbruker"]);
  assert.equal(issue.avatarId, 123);
  const avatar = await h.raw("GET", "/api/github/avatar/123");
  assert.equal(avatar.status, 200);
  assert.equal(fake.requests.at(-1)?.auth, undefined);
  await assert.rejects(h.api("GET", "/api/github/detail/pull?repo=evil.example%2Facme%2Frakett&number=42"), /400/);
  await assert.rejects(h.api("GET", "/api/github/files/issues?repo=acme%2Frakett&number=40"), /400/);

  fake.setMode("rate-limit");
  try {
    const response = await h.raw("GET", pull("detail") + "&refresh=1");
    assert.equal(response.status, 429);
    assert.ok(JSON.parse(response.body).resetAt > Date.now());
  } finally {
    fake.setMode("ok");
  }
});
