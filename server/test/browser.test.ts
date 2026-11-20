// Headless Chrome through Playwright. Nothing here may open a window on the user's desktop.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import type { ServerMessage } from "../../shared/protocol.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });

// Chrome processes started by this test process, found by parent PID and never by name.
function chromeProcesses(): Array<{ pid: number; args: string }> {
  const lines = execFileSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" }).trim().split("\n");
  const procs = lines.map((line) => {
    const [, pid, ppid, args] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)!;
    return { pid: Number(pid), ppid: Number(ppid), args };
  });
  const mine = new Set([process.pid]);
  for (let grown = true; grown;) {
    grown = false;
    for (const proc of procs) {
      if (mine.has(proc.ppid) && !mine.has(proc.pid)) {
        mine.add(proc.pid);
        grown = true;
      }
    }
  }
  return procs.filter((p) => mine.has(p.pid) && /chrome/i.test(p.args)).map(({ pid, args }) => ({ pid, args }));
}

test("the demo model's whole flow: write, command, open, snapshot, screenshot, in the same page the panel sees", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const socket = await h.socket();
  const thread = await h.thread(project.id);
  await send(h, thread.id, "lag en side");
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "run.finished").map((e) => e.status), ["done"]);
  assert.deepEqual(ofType(events, "tool.started").map((e) => e.tool), ["list_dir", "write_file", "run_command", "browser_navigate", "browser_snapshot", "browser_screenshot"]);
  assert.ok(ofType(events, "tool.finished").every((e) => e.status === "done"), JSON.stringify(ofType(events, "tool.finished")));
  assert.ok(existsSync(path.join(project.path, "index.html")));

  const results = ofType(events, "tool.finished");
  assert.match(results[3].result!, /Åpnet http:\/\/localhost:\d+\/index\.html/);
  assert.match(results[4].result!, /button "Klikket 0 ganger" \[ref=e\d+\]/);
  const shot = results[5];
  assert.ok(shot.screenshotId);
  const image = await h.raw("GET", `/api/screenshots/${shot.screenshotId}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.equal((await h.raw("GET", "/api/screenshots/..%2f..%2fetc")).status, 404);

  // The preview is another origin than the app, and on a host that does not get its cookie.
  const previewPort = Number(/localhost:(\d+)/.exec(results[3].result!)![1]);
  assert.notEqual(previewPort, h.app.port);
  await socket.waitFor((m) => m.type === "playtest.state" && m.state.status === "running");
  await h.api("POST", `/api/projects/${project.id}/playtest/stop`);

  // Chrome is headless: the rule is no windows on the user's desktop.
  const processes = chromeProcesses();
  assert.ok(processes.length > 0);
  const main = processes.find((p) => !p.args.includes("--type="))!;
  assert.match(main.args, /--headless/);
  assert.ok(!main.args.includes("--remote-debugging-port"), "no open debug port");
  const environ = readFileSync(`/proc/${main.pid}/environ`, "utf8");
  assert.ok(!environ.split("\0").some((entry) => entry.startsWith("AD_")) && !environ.includes(h.app.security.token), "Chrome gets the clean environment too");
});

test("user and agent share one page: screencast, input and agent tools see the same thing", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "index.html"), `<!doctype html><title>Delt</title>
    <input aria-label="Navn" id="navn"><button id="b" style="position:fixed;left:10px;top:100px;width:120px;height:40px" onclick="this.textContent='trykket'">trykk</button>
    <script>console.log("hei fra siden"); document.getElementById("navn").focus();</script>`);
  const [viewer, second] = await Promise.all([h.socket(), h.socket()]);
  await h.app.browser.navigate(project.id, "index.html");
  for (const socket of [viewer, second]) socket.send({ type: "browser.open", projectId: project.id, width: 800, height: 600 });
  const frame = await viewer.waitFor<Extract<ServerMessage, { type: "browser.frame" }>>((m) => m.type === "browser.frame");
  assert.equal(frame.width, 800);
  assert.ok(frame.jpegBase64.length > 100);
  assert.equal(Buffer.from(frame.jpegBase64, "base64").subarray(0, 2).toString("hex"), "ffd8", "a JPEG");
  await second.waitFor((m) => m.type === "browser.frame");
  const state = await viewer.waitFor<Extract<ServerMessage, { type: "browser.state" }>>((m) => m.type === "browser.state");
  assert.equal(state.state.title, "Delt");
  viewer.send({ type: "browser.frame-ack", projectId: project.id, sessionId: frame.sessionId });

  // Keyboard goes to the page from the panel.
  for (const char of "ab") {
    viewer.send({ type: "browser.input", projectId: project.id, event: { kind: "key", action: "down", key: char, code: `Key${char.toUpperCase()}`, text: char, modifiers: 0 } });
    viewer.send({ type: "browser.input", projectId: project.id, event: { kind: "key", action: "up", key: char, code: `Key${char.toUpperCase()}`, modifiers: 0 } });
  }
  await until(async () => (await h.app.browser.snapshot(project.id)).includes('"Navn"') && (await h.app.browser.snapshot(project.id)).includes("ab"), "typed text in the agent's snapshot");

  // Mouse too, and the agent sees the result.
  assert.match(await h.app.browser.snapshot(project.id), /button "trykk"/);
  for (const action of ["down", "up"] as const) {
    viewer.send({ type: "browser.input", projectId: project.id, event: { kind: "mouse", action, x: 60, y: 120, button: "left", clicks: 1, modifiers: 0 } });
  }
  await until(async () => (await h.app.browser.snapshot(project.id)).includes('"trykket"'), "click seen by agent");

  viewer.send({ type: "browser.input", projectId: project.id, event: { kind: "wheel", x: 10, y: 10, deltaX: 0, deltaY: 100, modifiers: 0 } });

  // And the agent's click shows up in the panel's state.
  assert.match(await h.app.browser.console(project.id), /hei fra siden/);
  assert.match(await h.app.browser.click(project.id, { text: "trykket" }), /Klikket/);
  await h.app.browser.type(project.id, { ref: /textbox "Navn" \[ref=(e\d+)\]/.exec(await h.app.browser.snapshot(project.id))![1] }, "ny verdi", false);
  assert.match(await h.app.browser.snapshot(project.id), /ny verdi/);

  viewer.send({ type: "browser.resize", projectId: project.id, width: 640, height: 480 });
  await until(async () => (await h.app.browser.screenshot(project.id)).png.readUInt32BE(16) === 640, "resize");

  await h.api("POST", `/api/projects/${project.id}/playtest/stop`);
});

test("address bar, history, reload, and only web pages can be opened", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const site = http.createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(`<title>Side ${req.url}</title><a href="/ny" target="_blank">ny fane</a>`));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  t.after(() => void site.close());
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  const socket = await h.socket();
  const title = (text: string) => socket.waitFor((m) => m.type === "browser.state" && m.state.title === text);

  socket.send({ type: "browser.open", projectId: project.id, width: 800, height: 600 });
  await socket.waitFor((m) => m.type === "browser.state");
  socket.send({ type: "browser.navigate", projectId: project.id, url: `${base}/en` });
  await title("Side /en");
  socket.send({ type: "browser.navigate", projectId: project.id, url: `${base}/to` });
  await title("Side /to");
  socket.received.length = 0;
  socket.send({ type: "browser.history", projectId: project.id, action: "back" });
  // State arrives in steps during a navigation. What counts is where it ends up.
  await socket.waitFor((m) => m.type === "browser.state" && m.state.title === "Side /en" && m.state.canGoForward && m.state.canGoBack);
  socket.received.length = 0;
  socket.send({ type: "browser.history", projectId: project.id, action: "forward" });
  await title("Side /to");
  socket.received.length = 0;
  socket.send({ type: "browser.history", projectId: project.id, action: "reload" });
  await title("Side /to");

  // A link to a new tab stays in the one page both of them see.
  await h.app.browser.click(project.id, { text: "ny fane" });
  await until(async () => (await h.app.browser.snapshot(project.id)).includes("Side /ny"), "popup adopted");

  // A bare host and port is what a model tends to write.
  assert.match(await h.app.browser.navigate(project.id, `${base.replace("http://", "")}/uten-skjema`), /uten-skjema/);

  for (const bad of ["file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "view-source:http://x", `${h.origin}/`, `http://localhost:${h.app.port}/`, `localhost:${h.app.port}`]) {
    await assert.rejects(() => h.app.browser.navigate(project.id, bad), /Bare http|egen adresse/, bad);
  }
  socket.received.length = 0;
  socket.send({ type: "browser.navigate", projectId: project.id, url: "file:///etc/passwd" });
  await socket.waitFor((m) => m.type === "browser.error");
});

test("a page's alert does not hang the agent", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "index.html"), `<title>Varsel</title><script>alert("hei")</script><p>etter</p>`);
  assert.match(await h.app.browser.navigate(project.id, "index.html"), /Varsel/);
  await h.api("POST", `/api/projects/${project.id}/playtest/stop`);
});

test("Chrome starts on first use and closes when nobody has used it for a while", async (t) => {
  const h = await startHarness(t, { browserIdleMs: 300 });
  const project = await h.project();
  assert.equal(h.app.browser.running, false, "no Chrome until it is needed");
  const socket = await h.socket();
  socket.send({ type: "browser.open", projectId: project.id, width: 400, height: 300 });
  await socket.waitFor((m) => m.type === "browser.state");
  assert.equal(h.app.browser.running, true);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(h.app.browser.running, true, "a viewer keeps it open");
  socket.send({ type: "browser.close", projectId: project.id });
  await until(() => !h.app.browser.running, "idle close");
  await until(() => chromeProcesses().every((p) => p.args.includes("<defunct>")), "Chrome processes gone");
  await h.app.browser.navigate(project.id, "about:blank");
  assert.equal(h.app.browser.running, true, "starts again on use");
});

test("after the server has stopped, nothing can start Chrome again", async (t) => {
  const { startApp } = await import("../src/app.ts");
  const app = await startApp({ dataDir: tempDir(t), port: 0, mockDelayMs: 0 });
  const project = app.store.createProject("x", tempDir(t, "ad-project-"), "full");
  await app.close();
  await assert.rejects(() => app.browser.navigate(project.id, "about:blank"), /Serveren stopper/);
  assert.equal(app.browser.running, false);
});

test("the idle timer waits for work under way, even when it is shorter than a page load", async (t) => {
  const site = http.createServer((_req, res) => {
    setTimeout(() => res.writeHead(200, { "content-type": "text/html" }).end("<title>Treg side</title>"), 400);
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    site.closeAllConnections();
    site.close();
  });
  const h = await startHarness(t, { browserIdleMs: 1 });
  const project = await h.project();
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
  assert.match(await h.app.browser.navigate(project.id, url), /Treg side/);
  await until(() => !h.app.browser.running, "idle close afterwards");
});

test("everyone who asks to close waits for the same close", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  await h.app.browser.navigate(project.id, "about:blank");
  const order: string[] = [];
  const first = h.app.browser.close().then(() => order.push("first"));
  const second = h.app.browser.close().then(() => order.push("second"));
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"], "the second caller must not return before Chrome has closed");
  assert.equal(h.app.browser.running, false);
});

test("playtest: index.html is served statically on another port, without dotfiles", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "index.html"), "<title>Statisk</title>");
  writeFileSync(path.join(project.path, ".env"), "HEMMELIG=1");
  mkdirSync(path.join(project.path, ".git"));
  writeFileSync(path.join(project.path, ".git/config"), "x");
  writeFileSync(path.join(project.path, "stil.css"), "a{}");
  const socket = await h.socket();
  const state = await h.api("POST", `/api/projects/${project.id}/playtest/start`);
  assert.equal(state.status, "running");
  assert.equal(state.terminalId, undefined);
  const url = new URL(state.url);
  assert.equal(url.hostname, "localhost");
  assert.notEqual(Number(url.port), h.app.port);

  const get = (target: string, host = url.host) => new Promise<{ status: number; body: string; type?: string }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: url.port, path: target, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body, type: res.headers["content-type"] }));
    }).on("error", reject);
  });
  assert.match((await get("/")).body, /Statisk/);
  assert.match((await get("/stil.css")).type!, /css/);
  assert.equal((await get("/.env")).status, 404);
  assert.equal((await get("/.git/config")).status, 404);
  assert.equal((await get("/%2eenv")).status, 404);
  assert.equal((await get("/../../etc/passwd")).status, 404);
  assert.equal((await get("/", "evil.example")).status, 403, "DNS rebinding");

  // The panel follows the preview.
  await until(async () => (await h.app.browser.snapshot(project.id)).includes("Statisk"), "browser opened the preview");
  await socket.waitFor((m) => m.type === "playtest.state" && m.state.status === "running");

  assert.equal((await h.api("GET", `/api/projects/${project.id}/playtest`)).status, "running");
  const stopped = await h.api("POST", `/api/projects/${project.id}/playtest/stop`);
  assert.equal(stopped.status, "stopped");
  await assert.rejects(() => get("/"));
});

function devProject(script: string): string {
  return JSON.stringify({ scripts: { dev: script } });
}

const DEV_SERVER = `
const http = require("http");
const port = Number(process.env.PORT);
http.createServer((_req, res) => res.end("<title>Dev</title>")).listen(port, "127.0.0.1", () => console.log("klar"));`;

test("playtest: a dev script runs in a terminal tab, on another port, and stop kills it", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "dev.js"), DEV_SERVER);
  writeFileSync(path.join(project.path, "package.json"), devProject("node dev.js"));
  const socket = await h.socket();
  const started = await h.api("POST", `/api/projects/${project.id}/playtest/start`);
  assert.equal(started.status, "starting");
  assert.ok(started.terminalId);
  const running = await socket.waitFor<Extract<ServerMessage, { type: "playtest.state" }>>((m) => m.type === "playtest.state" && m.state.status === "running", 30_000);
  assert.notEqual(Number(new URL(running.state.url!).port), h.app.port);
  assert.equal(running.state.terminalId, started.terminalId);
  assert.deepEqual((await h.api("GET", `/api/projects/${project.id}/terminals`)).map((x: any) => x.title), ["Playtest"]);

  socket.send({ type: "terminal.open", projectId: project.id, terminalId: started.terminalId, cols: 100, rows: 30 });
  const opened = await socket.waitFor((m) => m.type === "terminal.opened") as { replay: string };
  assert.match(opened.replay, /klar/);
  await until(async () => (await h.app.browser.snapshot(project.id)).includes("Dev"), "panel opened the address");

  await h.api("POST", `/api/projects/${project.id}/playtest/stop`);
  const port = new URL(running.state.url!).port;
  await until(() => !listening(Number(port)), "dev server gone");
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/terminals`), []);
});

function listening(port: number): boolean {
  try {
    return execFileSync("ss", ["-ltnH", `sport = :${port}`], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
}

test("playtest: follows the port a dev server prints, refuses the app's own, reports a crash", async (t) => {
  const h = await startHarness(t);
  const socket = await h.socket();

  const other = http.createServer((_req, res) => res.end("x"));
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
  t.after(() => void other.close());
  const otherPort = (other.address() as AddressInfo).port;
  const printed = await h.project();
  writeFileSync(path.join(printed.path, "dev.js"), `console.log("  Local: \\x1b[36mhttp://localhost:${otherPort}/\\x1b[0m"); setInterval(() => {}, 1000);`);
  writeFileSync(path.join(printed.path, "package.json"), devProject("node dev.js"));
  await h.api("POST", `/api/projects/${printed.id}/playtest/start`);
  const running = await socket.waitFor<Extract<ServerMessage, { type: "playtest.state" }>>((m) => m.type === "playtest.state" && m.state.projectId === printed.id && m.state.status === "running", 30_000);
  assert.equal(running.state.url, `http://localhost:${otherPort}/`);
  await h.api("POST", `/api/projects/${printed.id}/playtest/stop`);

  const clash = await h.project();
  writeFileSync(path.join(clash.path, "dev.js"), `console.log("http://localhost:${h.app.port}/"); setInterval(() => {}, 1000);`);
  writeFileSync(path.join(clash.path, "package.json"), devProject("node dev.js"));
  await h.api("POST", `/api/projects/${clash.id}/playtest/start`);
  const clashed = await socket.waitFor<Extract<ServerMessage, { type: "playtest.state" }>>((m) => m.type === "playtest.state" && m.state.projectId === clash.id && m.state.status === "error", 30_000);
  assert.match(clashed.state.error!, /samme port/);

  const crash = await h.project();
  writeFileSync(path.join(crash.path, "package.json"), JSON.stringify({ scripts: { start: "exit 1" } }));
  await h.api("POST", `/api/projects/${crash.id}/playtest/start`);
  const crashed = await socket.waitFor<Extract<ServerMessage, { type: "playtest.state" }>>((m) => m.type === "playtest.state" && m.state.projectId === crash.id && m.state.status === "error", 30_000);
  assert.match(crashed.state.error!, /stoppet/);
});

test("Open in VS Code starts code detached, and says so when it is missing", async (t) => {
  const bin = tempDir(t, "ad-bin-");
  const marker = path.join(bin, "kalt.txt");
  writeFileSync(path.join(bin, "code"), `#!/bin/sh\nprintf '%s' "$1" > "${marker}"\n`);
  chmodSync(path.join(bin, "code"), 0o755);
  const originalPath = process.env.PATH;
  t.after(() => (process.env.PATH = originalPath));
  const h = await startHarness(t);
  const project = await h.project(path.join(tempDir(t), "mappe med mellomrom"));

  process.env.PATH = `${bin}:${originalPath}`; // A stand-in, so no real VS Code window opens.
  await h.api("POST", `/api/projects/${project.id}/open-vscode`);
  await until(() => existsSync(marker), "fake code ran");
  assert.equal(readFileSync(marker, "utf8"), project.path, "the path is one argument");

  process.env.PATH = tempDir(t, "ad-tom-");
  const missing = await h.raw("POST", `/api/projects/${project.id}/open-vscode`);
  assert.equal(missing.status, 502);
  assert.match(JSON.parse(missing.body).error, /VS Code/);
});
