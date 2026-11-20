// One test per point in section 7 of the spec. These run before run_command is trusted.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { login, ofType, rawRequest, startHarness, tempDir } from "./helpers.ts";
import type { MemoryKeyring } from "../src/keyring.ts";

function connectable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

function rawHttp(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => socket.write(request));
    let response = "";
    socket.on("data", (chunk) => (response += chunk));
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

function wsAttempt(port: number, ticket: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`, { headers });
    ws.once("open", () => (ws.terminate(), resolve("open")));
    ws.once("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
    ws.once("error", (err) => resolve(`error ${err.message}`));
  });
}

test("1: binds only to 127.0.0.1", async (t) => {
  const h = await startHarness(t);
  assert.ok(await connectable("127.0.0.1", h.app.port));
  const external = Object.values(networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4");
  if (external) assert.equal(await connectable(external.address, h.app.port), false, "reachable on a non-loopback address");
  assert.equal(await connectable("::1", h.app.port), false, "reachable on ::1");
});

test("2: a fresh 32-byte token per run, in a 0600 file and the URL fragment", async (t) => {
  const first = await startHarness(t);
  const second = await startHarness(t);
  assert.notEqual(first.app.security.token, second.app.security.token);
  assert.equal(Buffer.from(first.app.security.token, "base64url").length, 32);
  assert.ok(first.app.link.endsWith(`/#token=${first.app.security.token}`));
  assert.ok(!first.app.link.includes("?"), "token must not be in the query string");
});

test("2: the token file is 0600 and readable before login", async (t) => {
  const { startApp } = await import("../src/app.ts");
  const dataDir = tempDir(t);
  const app = await startApp({ dataDir, port: 0 });
  try {
    const file = path.join(dataDir, "token");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(file, "utf8"), app.security.token);
  } finally {
    await app.close();
  }
});

test("3: the token becomes an HttpOnly, SameSite=Strict cookie", async (t) => {
  const h = await startHarness(t);
  const res = await rawRequest(h.app.port, "POST", "/api/auth/exchange", {
    headers: { origin: h.origin, "content-type": "application/json" },
    body: JSON.stringify({ token: h.app.security.token }),
  });
  const cookie = String(res.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(!cookie.includes(h.app.security.token), "the cookie must not carry the token");
  assert.equal(res.body.includes(h.app.security.token), false);

  const bad = await rawRequest(h.app.port, "POST", "/api/auth/exchange", {
    headers: { origin: h.origin, "content-type": "application/json" },
    body: JSON.stringify({ token: "feil" }),
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers["set-cookie"], undefined);
});

test("3: every API call needs the cookie", async (t) => {
  const h = await startHarness(t);
  for (const [method, url] of [["GET", "/api/bootstrap"], ["POST", "/api/ws-ticket"], ["POST", "/api/projects"], ["GET", "/api/threads/search?q=a"]]) {
    const res = await rawRequest(h.app.port, method, url, { headers: { origin: h.origin } });
    assert.equal(res.status, 401, `${method} ${url}`);
  }
  assert.equal((await h.raw("GET", "/api/bootstrap")).status, 200);
});

test("3: WebSocket tickets are short-lived and work once", async (t) => {
  const h = await startHarness(t);
  const { ticket } = await h.api("POST", "/api/ws-ticket");
  assert.equal(await wsAttempt(h.app.port, ticket, { origin: h.origin }), "open");
  assert.equal(await wsAttempt(h.app.port, ticket, { origin: h.origin }), "http 403", "ticket reused");
  assert.equal(await wsAttempt(h.app.port, "gjettet", { origin: h.origin }), "http 403");

  const originalNow = Date.now;
  const { ticket: old } = await h.api("POST", "/api/ws-ticket");
  Date.now = () => originalNow() + 31_000;
  t.after(() => (Date.now = originalNow));
  assert.equal(await wsAttempt(h.app.port, old, { origin: h.origin }), "http 403", "expired ticket");
  Date.now = originalNow;
});

test("4: Host must be exactly 127.0.0.1:port or localhost:port", async (t) => {
  const h = await startHarness(t);
  const port = h.app.port;
  for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1", "localhost", `127.0.0.1:${port + 1}`, `127.0.0.1.evil.example:${port}`, `LOCALHOST.:${port}`]) {
    const res = await h.raw("GET", "/api/bootstrap", { headers: { host } });
    assert.equal(res.status, 403, `Host ${host}`);
  }
  assert.equal((await h.raw("GET", "/api/bootstrap", { headers: { host: `localhost:${port}` } })).status, 200);
  // Node's HTTP client fills in an empty Host, so these two go over a raw socket.
  assert.match(await rawHttp(port, `GET /api/bootstrap HTTP/1.1\r\nHost:\r\nCookie: ${h.cookie}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 403/);
  assert.match(await rawHttp(port, `GET /api/bootstrap HTTP/1.0\r\nCookie: ${h.cookie}\r\n\r\n`), /^HTTP\/1\.1 403/);
  assert.equal((await h.raw("GET", "/", { headers: { host: "evil.example" } })).status, 403, "static files are covered too");

  const { ticket } = await h.api("POST", "/api/ws-ticket");
  assert.equal(await wsAttempt(port, ticket, { origin: h.origin, host: "evil.example" }), "http 403", "WebSocket upgrade");
});

test("5: Origin is checked exactly on mutations and before the WebSocket upgrade", async (t) => {
  const h = await startHarness(t);
  const port = h.app.port;
  const bad = ["http://evil.example", `http://127.0.0.1:${port + 1}`, `http://127.0.0.1:${port}.evil.example`, `https://127.0.0.1:${port}`, "null", `http://localhost:${port}/`];
  for (const origin of bad) {
    const res = await h.raw("POST", "/api/ws-ticket", { headers: { origin } });
    assert.equal(res.status, 403, `Origin ${origin}`);
    const { ticket } = await h.api("POST", "/api/ws-ticket");
    assert.equal(await wsAttempt(port, ticket, { origin }), "http 403", `WebSocket Origin ${origin}`);
  }
  // A missing Origin is refused too, on the login as well.
  const noOrigin = await rawRequest(port, "POST", "/api/ws-ticket", { headers: { cookie: h.cookie } });
  assert.equal(noOrigin.status, 403);
  const { ticket } = await h.api("POST", "/api/ws-ticket");
  assert.equal(await wsAttempt(port, ticket, {}), "http 403", "WebSocket without Origin");
  const login403 = await rawRequest(port, "POST", "/api/auth/exchange", {
    headers: { origin: "http://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ token: h.app.security.token }),
  });
  assert.equal(login403.status, 403);
  assert.equal((await h.raw("POST", "/api/ws-ticket", { headers: { origin: `http://localhost:${port}` } })).status, 200);
});

test("5: a form post with a text body is refused even with a good Origin", async (t) => {
  const h = await startHarness(t);
  const res = await h.raw("POST", "/api/projects", { headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(res.status, 415);
});

test("6: no CORS headers anywhere, and no preflight", async (t) => {
  const h = await startHarness(t);
  const preflight = await h.raw("OPTIONS", "/api/projects", {
    headers: { origin: "http://evil.example", "access-control-request-method": "POST" },
  });
  assert.notEqual(preflight.status, 200);
  const responses = [preflight, await h.raw("GET", "/api/bootstrap"), await h.raw("GET", "/"), await h.raw("POST", "/api/ws-ticket")];
  for (const res of responses) {
    for (const name of Object.keys(res.headers)) assert.ok(!name.startsWith("access-control-"), `found ${name}`);
  }
});

test("7: strict CSP without inline scripts, on pages and API alike", async (t) => {
  const h = await startHarness(t);
  for (const url of ["/", "/api/bootstrap"]) {
    const csp = String((await h.raw("GET", url)).headers["content-security-policy"]);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.ok(!/script-src[^;]*unsafe/.test(csp));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
  }
  const res = await h.raw("GET", "/");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
});

test("7: agent output stays data: a project file is served as text in JSON, never as a page", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "x.html"), "<script>alert(1)</script>");
  const res = await h.raw("GET", `/api/projects/${project.id}/file?path=x.html`);
  assert.match(String(res.headers["content-type"]), /application\/json/);
  assert.equal(JSON.parse(res.body).text, "<script>alert(1)</script>");
  assert.equal((await h.raw("GET", "/x.html")).status, 404, "project files are not on the app origin");
});

test("8: the token and keys never reach commands, terminals or file tools", async (t) => {
  process.env.AD_TEST_SECRET_VISIBLE = "skal-ikke-sees";
  process.env.MY_SERVICE_API_KEY = "sk-test-env-key";
  process.env.OUTSIDE_NAME = "sk-configured-key";
  t.after(() => {
    delete process.env.AD_TEST_SECRET_VISIBLE;
    delete process.env.MY_SERVICE_API_KEY;
    delete process.env.OUTSIDE_NAME;
  });
  const h = await startHarness(t);
  await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "x", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "OUTSIDE_NAME", apiKey: "sk-stored-key" });
  const project = await h.project(undefined, { permissionMode: "full" });
  const env = h.app.childEnv();
  for (const name of Object.keys(env)) assert.ok(!name.startsWith("AD_"), name);
  assert.equal(env.MY_SERVICE_API_KEY, undefined);
  assert.equal(env.OUTSIDE_NAME, undefined);
  assert.ok(env.PATH);

  // Through the real shell tool.
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "!env", shell: "env" });
  const events = await h.finished(thread.id);
  const output = ofType(events, "tool.finished")[0].result!;
  assert.ok(output.includes("PATH="), output.slice(0, 200));
  for (const secret of [h.app.security.token, "skal-ikke-sees", "sk-test-env-key", "sk-configured-key", "sk-stored-key"]) {
    assert.ok(!output.includes(secret), secret);
  }
  assert.ok(!/^AD_/m.test(output));

  // Through a real PTY.
  const socket = await h.socket();
  socket.send({ type: "terminal.open", projectId: project.id, cols: 200, rows: 50 });
  const opened = await socket.waitFor((m) => m.type === "terminal.opened") as { terminalId: string };
  socket.send({ type: "terminal.input", terminalId: opened.terminalId, data: "env; echo FERDIG-$((1+1))\n" });
  await socket.waitFor((m) => m.type === "terminal.output" && socket.received.some((r) => r.type === "terminal.output" && r.data.includes("FERDIG-2")));
  const terminalOutput = socket.received.flatMap((m) => (m.type === "terminal.output" ? [m.data] : [])).join("");
  for (const secret of [h.app.security.token, "skal-ikke-sees", "sk-test-env-key", "sk-configured-key"]) assert.ok(!terminalOutput.includes(secret));
  assert.ok(!/^AD_/m.test(terminalOutput));

  // The token file is gone by the time anything can run.
  assert.equal(existsSync(path.join(h.app.config.dataDir, "token")), false);
  // And the file tools cannot reach the data dir, even through a symlink.
  symlinkSync(h.app.config.dataDir, path.join(project.path, "lenke"));
  const refused = await h.raw("GET", `/api/projects/${project.id}/file?path=lenke/keys.json`);
  assert.equal(refused.status, 403);
  // Round 14 (SPEC 30.1): the key is in the keyring, and nothing in the data dir holds it.
  assert.equal(existsSync(path.join(h.app.config.dataDir, "keys.json")), false);
  assert.ok([...(h.keyring as MemoryKeyring).items.values()].some((item) => item.secret === "sk-stored-key"));
  assert.equal((await h.api("GET", "/api/bootstrap")).providers.find((p: any) => p.name === "x").hasKey, true);
  assert.ok(!(await h.raw("GET", "/api/bootstrap")).body.includes("sk-stored-key"), "keys never go to the UI");
});

test("8: a project cannot overlap the data dir", async (t) => {
  const h = await startHarness(t);
  const inside = await h.raw("POST", "/api/projects", { headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x", path: path.join(h.app.config.dataDir, "sub") }) });
  assert.equal(inside.status, 403);
  const around = await h.raw("POST", "/api/projects", { headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x", path: path.dirname(h.app.config.dataDir) }) });
  assert.equal(around.status, 403);
  const root = await h.raw("POST", "/api/projects", { headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x", path: "/" }) });
  assert.equal(root.status, 403);
});

test("9: API paths go through the same guard as the agent tools", async (t) => {
  const h = await startHarness(t);
  const outside = tempDir(t, "ad-outside-");
  writeFileSync(path.join(outside, "hemmelig.txt"), "hemmelig");
  const project = await h.project();
  mkdirSync(path.join(project.path, "src"));
  symlinkSync(outside, path.join(project.path, "src/ut"));
  symlinkSync(path.join(outside, "finnes-ikke"), path.join(project.path, "brutt"));

  const base = `/api/projects/${project.id}`;
  const attempts = [
    `${base}/file?path=../../etc/passwd`,
    `${base}/file?path=/etc/passwd`,
    `${base}/file?path=src/ut/hemmelig.txt`,
    `${base}/file?path=${encodeURIComponent("a\0b")}`,
    `${base}/tree?path=..`,
    `${base}/tree?path=src/ut`,
  ];
  for (const url of attempts) assert.equal((await h.raw("GET", url)).status, 403, url);

  // The agent's tools refuse the same paths.
  await h.api("PATCH", base, { permissionMode: "full" });
  for (const target of ["../utenfor.txt", "src/ut/hemmelig.txt", "src/ut/ny.txt", "brutt"]) {
    await assertToolRefused(h, project.id, target);
  }
  assert.equal(readFileSync(path.join(outside, "hemmelig.txt"), "utf8"), "hemmelig");
  assert.equal(existsSync(path.join(outside, "ny.txt")), false);
  assert.equal(existsSync(path.join(outside, "finnes-ikke")), false);
});

async function assertToolRefused(h: Awaited<ReturnType<typeof startHarness>>, projectId: string, target: string): Promise<void> {
  const { TOOLS_BY_NAME } = await import("../src/agent/tools.ts");
  const { FileState } = await import("../src/agent/filestate.ts");
  const project = h.app.store.project(projectId)!;
  const ctx: any = { project, dataDir: h.app.config.dataDir, thread: { id: "t" }, files: new FileState(), turns: { capture() {} }, filesChanged() {} };
  for (const [name, input] of [["read_file", { path: target }], ["write_file", { path: target, content: "x" }], ["edit_file", { path: target, old_string: "a", new_string: "b" }], ["list_dir", { path: target }]] as const) {
    await assert.rejects(() => TOOLS_BY_NAME.get(name)!.run(input, ctx), /utenfor|symlenke/, `${name} ${target}`);
  }
}

test("a second login works with the same token, and the session dies with the server", async (t) => {
  const h = await startHarness(t);
  const second = await login(h.app.port, h.app.security.token);
  assert.notEqual(second, h.cookie);
  const other = await startHarness(t);
  const res = await rawRequest(other.app.port, "GET", "/api/bootstrap", { headers: { cookie: h.cookie } });
  assert.equal(res.status, 401);
});

test("odd request targets get an error, never a crash", async (t) => {
  const h = await startHarness(t);
  const port = h.app.port;
  for (const target of ["//", "//evil.example/", "http://[", "/%", "/%00", "/api/%", "/api/projects/%ZZ/tree"]) {
    const response = await rawHttp(port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${h.cookie}\r\nConnection: close\r\n\r\n`);
    assert.match(response, /^HTTP\/1\.1 [2345]\d\d/, target);
  }
  const upgrade = await rawHttp(port, `GET // HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${h.origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  assert.match(upgrade, /403/);
  assert.equal((await h.raw("GET", "/api/bootstrap")).status, 200, "still up");
});
