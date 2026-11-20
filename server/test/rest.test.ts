// REST surface, as promised in shared/protocol.ts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "../src/config.ts";
import { needsBuild, productionBuild } from "../../scripts/build-lib.ts";
import { httpError, openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { login, rawRequest, startHarness, tempDir, until } from "./helpers.ts";

test("projects: create, folder is made, rename, permission, delete leaves the folder", async (t) => {
  const h = await startHarness(t);
  const base = tempDir(t);
  const folder = path.join(base, "ny/mappe");
  const socket = await h.socket();
  const project = await h.api("POST", "/api/projects", { name: "Ny", path: folder });
  assert.ok(existsSync(folder));
  assert.equal(project.permissionMode, "ask");
  await socket.waitFor((m) => m.type === "project.changed" && m.project.id === project.id);
  assert.equal((await h.api("POST", "/api/projects", { name: "Igjen", path: folder })).id, project.id, "same folder, same project");

  const patched = await h.api("PATCH", `/api/projects/${project.id}`, { name: "Annet", permissionMode: "full" });
  assert.equal(patched.name, "Annet");
  assert.equal(patched.permissionMode, "full");
  assert.equal((await h.raw("PATCH", `/api/projects/${project.id}`, { headers: { "content-type": "application/json" }, body: '{"permissionMode":"gud"}' })).status, 400);

  const thread = await h.thread(project.id);
  await h.api("DELETE", `/api/projects/${project.id}`);
  assert.ok(existsSync(folder), "the folder stays");
  assert.equal(h.app.store.project(project.id), undefined);
  assert.equal(h.app.store.thread(thread.id), undefined);
  await socket.waitFor((m) => m.type === "project.deleted" && m.projectId === project.id);
});

test("the folder picker lists folders only and has a way up", async (t) => {
  const h = await startHarness(t);
  const base = tempDir(t);
  mkdirSync(path.join(base, "mappe"));
  mkdirSync(path.join(base, ".skjult"));
  writeFileSync(path.join(base, "fil.txt"), "x");
  const res = await h.api("GET", `/api/fs/browse?path=${encodeURIComponent(base)}`);
  assert.equal(res.path, base);
  assert.equal(res.parent, path.dirname(base));
  assert.deepEqual(res.dirs.map((d: any) => d.name), ["mappe"]);
  assert.equal((await h.raw("GET", `/api/fs/browse?path=${encodeURIComponent(h.app.config.dataDir)}`)).status, 403);
});

test("threads: create, rename, archive, search, delete", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const thread = await h.thread(project.id);
  assert.equal(thread.origin, "user");
  assert.equal(thread.parentThreadId, null);
  // Round 9: Kode without a project is Denne datamaskinen, a thread with no tools (runde9.test.ts).
  assert.equal((await h.raw("POST", "/api/threads", { headers: { "content-type": "application/json" }, body: '{"mode":"code"}' })).status, 200, "Kode uten prosjekt");
  const chat = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${chat.id}/messages`, { text: "Fortell om sjiraffer" });
  await h.finished(chat.id);

  assert.equal((await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Omdøpt", archived: true })).archived, true);
  assert.deepEqual((await h.api("GET", `/api/threads/search?q=${encodeURIComponent("omdøp")}`)).map((x: any) => x.id), [thread.id]);
  assert.deepEqual((await h.api("GET", "/api/threads/search?q=sjiraff")).map((x: any) => x.id), [chat.id], "searches the conversation too");
  assert.deepEqual(await h.api("GET", "/api/threads/search?q=100%25"), [], "% is a literal");

  const events = await h.api("GET", `/api/threads/${chat.id}/events?after=0&limit=2`);
  assert.deepEqual(events.map((e: any) => e.seq), [1, 2]);
  assert.equal(events[0].threadId, chat.id);
  const next = await h.api("GET", `/api/threads/${chat.id}/events?after=2&limit=1`);
  assert.equal(next[0].seq, 3);
  const tail = await h.api("GET", `/api/threads/${chat.id}/events?tail=2`);
  assert.equal(tail.length, 2);
  assert.equal(tail[1].event.type, "run.finished");

  await h.api("DELETE", `/api/threads/${chat.id}`);
  assert.equal((await h.raw("GET", `/api/threads/${chat.id}/events`)).status, 404);
});

test("file tree honours .gitignore and hides node_modules and .git, and updates reach the UI", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const root = project.path;
  writeFileSync(path.join(root, ".gitignore"), "*.log\nbygg/\n");
  writeFileSync(path.join(root, "a.ts"), "x");
  writeFileSync(path.join(root, "feil.log"), "x");
  for (const dir of ["bygg", "node_modules", ".git", "src/under"]) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, "src/.gitignore"), "hemmelig.txt\n");
  writeFileSync(path.join(root, "src/hemmelig.txt"), "x");
  writeFileSync(path.join(root, "src/b.ts"), "x");
  const tree = await h.api("GET", `/api/projects/${project.id}/tree`);
  assert.deepEqual(tree.map((e: any) => e.name), ["src", ".gitignore", "a.ts"]);
  assert.equal(tree[0].kind, "dir");
  const sub = await h.api("GET", `/api/projects/${project.id}/tree?path=src`);
  assert.deepEqual(sub.map((e: any) => e.path), ["src/under", "src/.gitignore", "src/b.ts"]);

  const socket = await h.socket();
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "godkjenning" });
  const approve = h.approveAll(thread.id);
  t.after(approve);
  await h.finished(thread.id);
  await socket.waitFor((m) => m.type === "project.files-changed" && m.paths.includes(".env.demo"));
});

test("file reads say what they are: text, binary or cut short", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "tekst.txt"), "blåbær");
  writeFileSync(path.join(project.path, "bin.dat"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(path.join(project.path, "stor.txt"), "x".repeat(3 * 1024 * 1024));
  const read = (name: string) => h.api("GET", `/api/projects/${project.id}/file?path=${name}`);
  assert.deepEqual(await read("tekst.txt"), { path: "tekst.txt", text: "blåbær", size: 8, binary: false, truncated: false });
  assert.equal((await read("bin.dat")).text, null);
  assert.equal((await read("bin.dat")).binary, true);
  const big = await read("stor.txt");
  assert.equal(big.truncated, true);
  assert.equal(big.text.length, 2 * 1024 * 1024);
  assert.equal((await h.raw("GET", `/api/projects/${project.id}/file?path=finnes-ikke`)).status, 404);
});

test("settings, providers and models", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const socket = await h.socket();
  assert.equal((await h.api("PATCH", "/api/settings", { theme: "dark", autoOpenAgentThreads: false })).theme, "dark");
  await socket.waitFor((m) => m.type === "settings.changed" && m.settings.autoOpenAgentThreads === false);
  assert.equal((await h.raw("PATCH", "/api/settings", { headers: { "content-type": "application/json" }, body: '{"theme":"rosa"}' })).status, 400);

  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal", baseUrl: `${llm.url}/v1`, apiKey: "sk-hemmelig-nøkkel" });
  assert.equal(provider.hasKey, true);
  assert.equal(provider.apiKey, undefined);
  assert.equal((await h.raw("POST", "/api/providers", { headers: { "content-type": "application/json" }, body: '{"kind":"openai-compatible","name":"x","baseUrl":"file:///etc"}' })).status, 400);
  assert.equal((await h.raw("POST", "/api/providers", { headers: { "content-type": "application/json" }, body: '{"kind":"mock","name":"x"}' })).status, 400);

  llm.reply((_req, res) => void res.writeHead(200).end('{"data":[{"id":"m"}]}'));
  const verified = await h.api("POST", `/api/providers/${provider.id}/test`);
  assert.equal(verified.ok, true);
  assert.match(verified.message, /, 1 modell(?:er)?$/);
  llm.reply(httpError(401, { error: { message: "Avvist sk-hemmelig-nøkkel" } }));
  const refused = await h.api("POST", `/api/providers/${provider.id}/test`);
  assert.equal(refused.ok, false);
  assert.ok(!refused.message.includes("sk-hemmelig"), "keys are redacted");

  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Min", model: "m", contextWindow: 8000, inputPricePerMTok: 1, effort: "high" });
  assert.equal(model.effort, "high");
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.defaultModelId, model.id, "the demo model steps aside once another exists");
  assert.equal((await h.api("PATCH", `/api/models/${model.id}`, { name: "Nytt navn" })).name, "Nytt navn");
  assert.equal((await h.raw("POST", "/api/models", { headers: { "content-type": "application/json" }, body: JSON.stringify({ providerId: provider.id, name: "x", model: "y", contextWindow: 1 }) })).status, 400);
  await h.api("DELETE", `/api/models/${model.id}`);
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.defaultModelId, "mock-demo");
  assert.equal((await h.raw("DELETE", "/api/models/mock-demo")).status, 400);
  assert.equal((await h.raw("DELETE", "/api/providers/mock")).status, 400);

  const patched = await h.api("PATCH", `/api/providers/${provider.id}`, { apiKey: "" });
  assert.equal(patched.hasKey, false);
  await h.api("DELETE", `/api/providers/${provider.id}`);
  assert.equal((await h.api("POST", "/api/providers", { kind: "anthropic", name: "A", apiKeyEnv: "UBRUKT_NOKKEL" })).hasKey, false);
});

test("a key from apiKeyEnv is used for requests", async (t) => {
  process.env.AD_TEST_PROVIDER_KEY = "sk-fra-miljoet";
  t.after(() => delete process.env.AD_TEST_PROVIDER_KEY);
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Env", baseUrl: `${llm.url}/v1`, apiKeyEnv: "AD_TEST_PROVIDER_KEY" });
  assert.equal(provider.hasKey, true);
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "m", model: "m", contextWindow: 8000 });
  const thread = await h.thread(null, "chat", model.id);
  llm.reply(sse(openaiText("ok")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei" });
  await h.finished(thread.id);
  assert.equal(llm.requests[0].headers.authorization, "Bearer sk-fra-miljoet");
});

test("the pane layout is stored per project, survives a restart and reaches other windows", async (t) => {
  const { startApp } = await import("../src/app.ts");
  const h = await startHarness(t);
  const project = await h.project();
  const dataDir = h.app.config.dataDir;
  const socket = await h.socket();
  const layout = { panes: [{ threadId: "a" }, { threadId: "b" }], split: "horizontal" };
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/layout`), { layout: null });
  await h.api("PUT", `/api/projects/${project.id}/layout`, { layout });
  await h.api("PUT", "/api/projects/chat/layout", { layout: { panes: [] } });
  assert.equal((await socket.waitFor((m) => m.type === "project.layout" && m.projectId === project.id) as any).layout.split, "horizontal");
  assert.equal((await h.raw("PUT", `/api/projects/${project.id}/layout`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: "x".repeat(70_000) }) })).status, 413);
  assert.equal((await h.raw("PUT", "/api/projects/finnes-ikke/layout", { headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
  await h.app.close();

  const again = await startApp({ dataDir, port: 0 });
  t.after(() => again.close());
  assert.deepEqual(again.store.layout(project.id), layout);
});

test("static files: the built UI, client routes, build info, and no way out of dist", async (t) => {
  const dist = tempDir(t, "ad-dist-");
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>UI</title>");
  writeFileSync(path.join(dist, "assets/app-abc.js"), "console.log(1)");
  writeFileSync(path.join(dist, "build-info.json"), '{"build":7,"builtAt":"2026-11-02T00:00:00.000Z"}');
  writeFileSync(path.join(dist, "../ad-utenfor.txt"), "utenfor");
  t.after(() => rmSync(path.join(dist, "../ad-utenfor.txt"), { force: true }));
  const h = await startHarness(t, { webDist: dist });
  const index = await h.raw("GET", "/");
  assert.equal(index.status, 200);
  assert.match(index.body, /<title>UI/);
  assert.equal(index.headers["cache-control"], "no-cache");
  const asset = await h.raw("GET", "/assets/app-abc.js");
  assert.match(String(asset.headers["content-type"]), /javascript/);
  assert.match(String(asset.headers["cache-control"]), /immutable/);
  assert.match((await h.raw("GET", "/innstillinger")).body, /<title>UI/, "client routes get the app");
  assert.equal((await h.raw("GET", "/assets/finnes-ikke.js")).status, 404);
  assert.notEqual((await h.raw("GET", "/..%2fad-utenfor.txt")).body, "utenfor");
  assert.notEqual((await h.raw("GET", "/%2e%2e/ad-utenfor.txt")).body, "utenfor");
  assert.equal((await h.raw("POST", "/")).status, 405);
  const build = (await h.api("GET", "/api/bootstrap")).build;
  assert.equal(build.build, 7);
  assert.equal(build.builtAt, "2026-11-02T00:00:00.000Z");
  assert.equal(build.version, JSON.parse(readFileSync(path.join(REPO_ROOT, "version.json"), "utf8")).version);
  assert.equal((await h.api("GET", "/api/bootstrap")).build.signature, "Code Pro");
});

test("a production build bumps the number and records the date, only when needed", async (t) => {
  const root = tempDir(t, "ad-build-");
  mkdirSync(path.join(root, "web/src"), { recursive: true });
  mkdirSync(path.join(root, "shared"));
  writeFileSync(path.join(root, "version.json"), '{ "version": "0.1.0", "build": 11 }');
  writeFileSync(path.join(root, "web/src/main.ts"), "1");
  assert.equal(needsBuild(root), false, "no build script yet");
  assert.equal(productionBuild(root), null);

  const script = `node -e "require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html','x')"`;
  writeFileSync(path.join(root, "web/package.json"), JSON.stringify({ scripts: { build: script } }));
  assert.equal(needsBuild(root), true);
  const result = productionBuild(root)!;
  assert.equal(result.build, 12);
  assert.equal(JSON.parse(readFileSync(path.join(root, "version.json"), "utf8")).build, 12);
  assert.equal(JSON.parse(readFileSync(path.join(root, "web/dist/build-info.json"), "utf8")).build, 12);
  assert.ok(!Number.isNaN(Date.parse(result.builtAt)));
  assert.equal(needsBuild(root), false);

  await new Promise((resolve) => setTimeout(resolve, 20));
  mkdirSync(path.join(root, "web/test"));
  writeFileSync(path.join(root, "web/test/flow.test.ts"), "// a UI test");
  assert.equal(needsBuild(root), false, "a changed UI test is not part of the bundle");
  writeFileSync(path.join(root, "web/src/main.ts"), "2");
  assert.equal(needsBuild(root), true, "a changed source needs a build");
});

test("npm start: --no-open prints the link, AD_PORT=0 picks a port, SIGTERM stops it cleanly", async (t) => {
  const dataDir = tempDir(t);
  const bin = tempDir(t, "ad-bin-");
  const marker = path.join(dataDir, "xdg-open-called");
  writeFileSync(path.join(bin, "xdg-open"), `#!/bin/sh\necho "$@" > "${marker}"\n`);
  chmodSync(path.join(bin, "xdg-open"), 0o755);
  const child = spawn(process.execPath, ["scripts/start.ts", "--no-open"], {
    cwd: REPO_ROOT,
    env: { ...process.env, AD_DATA_DIR: dataDir, AD_PORT: "0", AD_WEB_DIST: path.join(dataDir, "dist"), PATH: `${bin}:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGKILL"));
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  await until(() => /#token=/.test(output), `link in output: ${output}`);
  const match = /http:\/\/127\.0\.0\.1:(\d+)\/#token=(\S+)/.exec(output)!;
  const port = Number(match[1]);
  assert.notEqual(port, 4317);
  assert.equal(statSync(path.join(dataDir, "token")).mode & 0o777, 0o600);
  await login(port, match[2]);
  assert.equal(existsSync(path.join(dataDir, "token")), false, "the file goes at first login");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(existsSync(marker), false, "--no-open must not open anything");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  assert.equal(await exited, 0);
  await assert.rejects(() => rawRequest(port, "GET", "/"));
});

test("without --no-open the link goes to the default browser", async (t) => {
  const dataDir = tempDir(t);
  const bin = tempDir(t, "ad-bin-");
  const marker = path.join(dataDir, "xdg-open-called");
  writeFileSync(path.join(bin, "xdg-open"), `#!/bin/sh\necho "$@" > "${marker}"\n`);
  chmodSync(path.join(bin, "xdg-open"), 0o755);
  const child = spawn(process.execPath, ["server/src/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, AD_DATA_DIR: dataDir, AD_PORT: "0", PATH: `${bin}:${process.env.PATH}` },
    stdio: "ignore",
  });
  t.after(() => child.kill("SIGKILL"));
  await until(() => existsSync(marker) && readFileSync(marker, "utf8").includes("#token="), "fake xdg-open");
});

test("a busy port is a clear error", async (t) => {
  const h = await startHarness(t);
  const child = spawn(process.execPath, ["server/src/index.ts", "--no-open"], {
    cwd: REPO_ROOT,
    env: { ...process.env, AD_DATA_DIR: tempDir(t), AD_PORT: String(h.app.port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  t.after(() => child.kill("SIGKILL"));
  let errors = "";
  child.stderr.on("data", (chunk) => (errors += chunk));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 1);
  assert.match(errors, /Porten er opptatt/);
});

test("symlinks are listed without following them out of the project", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const outside = tempDir(t, "ad-outside-");
  symlinkSync(outside, path.join(project.path, "ut"));
  symlinkSync("finnes-ikke", path.join(project.path, "brutt"));
  const tree = await h.api("GET", `/api/projects/${project.id}/tree`);
  assert.deepEqual(tree.map((e: any) => e.name), ["ut"]);
  assert.equal((await h.raw("GET", `/api/projects/${project.id}/tree?path=ut`)).status, 403);
});
