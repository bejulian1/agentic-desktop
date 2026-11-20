// Round 8 (agent G): GitHub (Beta) against a local fake server, and saving from the mini editor.
// No request ever goes to github.com: AD_GITHUB_API points at the fake server below.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { hashContent } from "../src/agent/filestate.ts";
import { apiBase, parseGitHubUrl, parseRemotes, plausibleToken, readGitHubRemote } from "../src/github.ts";
import { GOOD_TOKEN, OTHER_TOKEN, startFakeGitHub, type FakeGitHub } from "./fake-github.ts";
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
  const wrong = await h.raw("PUT", "/api/github/token", { headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "ghp_feil000000000000000000000000000000" }) });
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
