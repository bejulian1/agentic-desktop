// v0.6, SPEC 17.1 (agent B): downloads from the Browser panel. Files land in the folder from
// Settings under safe, numbered names, with progress, and nothing is written outside it. Always a
// temporary folder here, never the user's real one, and a local server for the files.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { DownloadItem, ServerMessage } from "../../shared/protocol.ts";
import { checkDownloadDir, defaultDownloadDir, numbered, safeFileName, STAGING } from "../src/downloads.ts";
import { listening, portsIn } from "../src/servers.ts";
import { startHarness, tempDir, until } from "./helpers.ts";

test("file names are made safe and numbered", () => {
  assert.equal(safeFileName("../../.hemmelig fil.txt"), "hemmelig fil.txt");
  assert.equal(safeFileName("a/b\\c.exe"), "c.exe");
  assert.equal(safeFileName(".bashrc"), "bashrc");
  assert.equal(safeFileName("..."), "nedlasting");
  assert.equal(safeFileName(""), "nedlasting");
  assert.equal(safeFileName("ra\u0000pp\u001f<o>rt?.pdf"), "ra_pp__o_rt_.pdf");
  const long = safeFileName(`${"x".repeat(400)}.tar.gz`);
  assert.ok(Buffer.byteLength(long) <= 180 && long.endsWith(".gz"));
  assert.equal(numbered("rapport.pdf", 0), "rapport.pdf");
  assert.equal(numbered("rapport.pdf", 2), "rapport (2).pdf");
  assert.equal(numbered("LESMEG", 1), "LESMEG (1)");
});

test("the default folder: XDG first, then Nedlastinger or Downloads", (t) => {
  const home = tempDir(t);
  assert.equal(defaultDownloadDir(home, {}), path.join(home, "Downloads", "Agentic Desktop"), "nothing exists");
  mkdirSync(path.join(home, "Nedlastinger"));
  assert.equal(defaultDownloadDir(home, {}), path.join(home, "Nedlastinger", "Agentic Desktop"));
  mkdirSync(path.join(home, "cfg"));
  mkdirSync(path.join(home, "Mine filer"));
  writeFileSync(path.join(home, "cfg/user-dirs.dirs"), 'XDG_DESKTOP_DIR="$HOME/Skrivebord"\nXDG_DOWNLOAD_DIR="$HOME/Mine filer"\n');
  assert.equal(defaultDownloadDir(home, { XDG_CONFIG_HOME: path.join(home, "cfg") }), path.join(home, "Mine filer", "Agentic Desktop"));
  writeFileSync(path.join(home, "cfg/user-dirs.dirs"), 'XDG_DOWNLOAD_DIR="$HOME/Finnes ikke"\n');
  assert.equal(defaultDownloadDir(home, { XDG_CONFIG_HOME: path.join(home, "cfg") }), path.join(home, "Nedlastinger", "Agentic Desktop"), "a missing XDG folder is skipped");
});

test("the folder from Settings is checked", async (t) => {
  const dir = tempDir(t);
  const data = path.join(dir, "data");
  writeFileSync(path.join(dir, "en-fil"), "x");
  assert.equal(checkDownloadDir("", data), "");
  assert.equal(checkDownloadDir(`${dir}/ny/mappe`, data), path.join(dir, "ny/mappe"));
  for (const bad of ["relativ/sti", `${dir}/../annet`, "/", data, `${data}/under`, path.join(dir, "en-fil"), 5]) {
    assert.throws(() => checkDownloadDir(bad, data), Error, String(bad));
  }
  const h = await startHarness(t);
  const res = await h.raw("PATCH", "/api/settings", { headers: { "content-type": "application/json" }, body: JSON.stringify({ downloadDir: "ikke/absolutt" }) });
  assert.equal(res.status, 400);
  const target = path.join(tempDir(t), "lastet ned");
  await h.api("PATCH", "/api/settings", { downloadDir: target });
  assert.equal((await h.api("GET", "/api/downloads")).dir, target);
  assert.equal(existsSync(target), false, "not created before the first download");
  await h.api("PATCH", "/api/settings", { downloadDir: "" });
  const list = await h.api("GET", "/api/downloads");
  assert.equal(list.dir, list.defaultDir, "back to the default");
});

// A page that starts a download by itself, and the files behind it. The big one comes in pieces,
// so there is progress to see.
function fileServer(t: TestContext): Promise<string> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/side") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><a id="a" href="/fil?navn=${encodeURIComponent(url.searchParams.get("navn") ?? "fil.txt")}&stor=${url.searchParams.get("stor") ?? ""}">last ned</a><script>addEventListener("load", () => setTimeout(() => document.getElementById("a").click(), 30))</script>`);
    }
    const name = url.searchParams.get("navn") ?? "fil.txt";
    if (url.searchParams.get("stor")) {
      const size = 4_000_000;
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "content-length": size });
      let sent = 0;
      const timer = setInterval(() => {
        res.write(Buffer.alloc(100_000, 66));
        sent += 100_000;
        if (sent >= size) {
          clearInterval(timer);
          res.end();
        }
      }, 60);
      return;
    }
    res.writeHead(200, { "content-type": "text/plain", "content-disposition": `attachment; filename="${name}"` });
    res.end(`innhold av ${name}\n`);
  });
  t.after(() => server.close());
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

test("downloads land in the folder under safe, numbered names, with progress, and can leave the list", async (t) => {
  const h = await startHarness(t);
  const base = await fileServer(t);
  const dir = path.join(tempDir(t), "Nedlastinger", "Agentic Desktop");
  await h.api("PATCH", "/api/settings", { downloadDir: dir });
  const project = await h.project();
  const socket = await h.socket();
  socket.send({ type: "browser.open", projectId: project.id, width: 640, height: 400 });
  await socket.waitFor((m) => m.type === "browser.state" && m.projectId === project.id, 60_000);

  const done = (name: string) => (m: ServerMessage) => m.type === "download.changed" && m.download.state === "done" && m.download.filename === name;
  const go = (query: string) => socket.send({ type: "browser.navigate", projectId: project.id, url: `${base}/side?${query}` });

  go("navn=rapport.txt");
  await socket.waitFor(done("rapport.txt"), 30_000);
  go("navn=rapport.txt");
  await socket.waitFor(done("rapport (1).txt"), 30_000);
  assert.equal(readFileSync(path.join(dir, "rapport (1).txt"), "utf8"), "innhold av rapport.txt\n");

  // A name that tries to leave the folder or hide stays in the folder, visible.
  go(`navn=${encodeURIComponent("../../.skjult")}`);
  const sneaky = await socket.waitFor<Extract<ServerMessage, { type: "download.changed" }>>((m) => m.type === "download.changed" && m.download.state === "done" && !/rapport/.test(m.download.filename), 30_000);
  assert.ok(!sneaky.download.filename.startsWith("."), sneaky.download.filename);
  assert.equal(path.dirname(sneaky.download.path!), dir);

  // A big file reports progress before it is done.
  go("navn=stor.bin&stor=1");
  await socket.waitFor((m) => m.type === "download.changed" && m.download.filename === "stor.bin" && m.download.state === "progress" && m.download.receivedBytes > 0 && m.download.receivedBytes < 4_000_000, 30_000);
  await socket.waitFor(done("stor.bin"), 60_000);

  const names = readdirSync(dir).sort();
  assert.deepEqual(names.filter((n) => n !== STAGING), [sneaky.download.filename, "rapport (1).txt", "rapport.txt", "stor.bin"].sort());
  assert.deepEqual(readdirSync(path.join(dir, STAGING)), [], "nothing left half-done");
  assert.equal(readdirSync(path.dirname(dir)).length, 1, "nothing written beside the folder");

  const list = await h.api<{ items: DownloadItem[] }>("GET", "/api/downloads");
  assert.equal(list.items.length, 4);
  assert.equal(list.items[0].filename, "stor.bin", "newest first");
  assert.equal(list.items[0].totalBytes, 4_000_000);

  // Off the list keeps the file. Deleting it too needs file=1, which the UI asks about first.
  const first = list.items.find((i) => i.filename === "rapport.txt")!;
  await h.api("DELETE", `/api/downloads/${first.id}`);
  assert.ok(existsSync(path.join(dir, "rapport.txt")));
  await socket.waitFor((m) => m.type === "download.removed" && m.id === first.id);
  const second = list.items.find((i) => i.filename === "rapport (1).txt")!;
  await h.api("DELETE", `/api/downloads/${second.id}?file=1`);
  assert.equal(existsSync(path.join(dir, "rapport (1).txt")), false);
  assert.equal((await h.raw("DELETE", "/api/downloads/finnes-ikke")).status, 404);
  assert.equal((await h.api("GET", "/api/downloads")).items.length, 2);
  socket.send({ type: "browser.close", projectId: project.id });
  await until(() => true, "closed");
});

// A small dev server that says where it listens, like Vite or Next does.
const DEV_SERVER = `const http = require("node:http");
const server = http.createServer((req, res) => res.end("hei"));
server.listen(0, "127.0.0.1", () => console.log("  ➜  Local:   http://localhost:" + server.address().port + "/"));
`;

test("servers: found in a command's output, confirmed, with thread and PID, and stopped; never someone else's", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "server.cjs"), DEV_SERVER);
  const socket = await h.socket();
  const thread = await h.thread(project.id);

  // A port the app did not start: printed by a command, but owned by this test's own server.
  const other = http.createServer((_req, res) => res.end("annen"));
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", () => resolve()));
  t.after(() => other.close());
  const otherPort = (other.address() as AddressInfo).port;
  await h.api("POST", `/api/threads/${thread.id}/messages`, { shell: `echo "se http://127.0.0.1:${otherPort}"` });
  await h.finished(thread.id);

  await h.api("POST", `/api/threads/${thread.id}/messages`, { shell: "node server.cjs" });
  const changed = await socket.waitFor<Extract<ServerMessage, { type: "servers.changed" }>>((m) => m.type === "servers.changed" && m.servers.length > 0, 30_000);
  const [found] = changed.servers;
  assert.equal(changed.servers.length, 1, "bare serveren appen startet");
  assert.notEqual(found.port, otherPort);
  assert.equal(found.url, `http://localhost:${found.port}`);
  assert.deepEqual([found.projectId, found.threadId, found.source, found.command], [project.id, thread.id, "command", "node server.cjs"]);
  assert.equal(typeof found.pid, "number");
  assert.deepEqual((await h.api("GET", "/api/servers")).map((s: any) => s.port), [found.port]);

  // Stop reaches the process that listens, and the command ends with it.
  await h.api("POST", `/api/servers/${found.id}/stop`);
  await socket.waitFor((m) => m.type === "servers.changed" && m.servers.length === 0);
  await h.finished(thread.id, 2);
  await until(async () => !(await listening(found.port)), "porten er lukket");
  assert.equal((await h.raw("POST", "/api/servers/12345/stop")).status, 404);
});

test("servers: a dev server in a terminal tab is found too, and goes when it stops", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  writeFileSync(path.join(project.path, "server.cjs"), DEV_SERVER);
  const socket = await h.socket();
  socket.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const opened = await socket.waitFor<Extract<ServerMessage, { type: "terminal.opened" }>>((m) => m.type === "terminal.opened");
  socket.send({ type: "terminal.input", terminalId: opened.terminalId, data: "node server.cjs\r" });
  const changed = await socket.waitFor<Extract<ServerMessage, { type: "servers.changed" }>>((m) => m.type === "servers.changed" && m.servers.length > 0, 30_000);
  assert.equal(changed.servers[0].source, "terminal");
  assert.equal(changed.servers[0].threadId, null);
  // Ctrl+C in the terminal: the next check drops it.
  socket.send({ type: "terminal.input", terminalId: opened.terminalId, data: "\u0003" });
  await socket.waitFor((m) => m.type === "servers.changed" && m.servers.length === 0, 20_000);
  socket.send({ type: "terminal.close", terminalId: opened.terminalId });
});

test("addresses are read from output, with colours and in many forms", () => {
  assert.deepEqual(portsIn("\u001b[32m➜\u001b[0m  Local: \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[0m"), [5173]);
  assert.deepEqual(portsIn("on 127.0.0.1:3000 and 0.0.0.0:8080 and [::1]:4000"), [3000, 8080, 4000]);
  assert.deepEqual(portsIn("https://example.com:443 eller localhost uten port"), []);
});
