// SPEC 14: artifacts in SQLite, the preview server on its own origin, and the checks that keep
// artifact HTML away from the app's API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import type { Artifact, ArtifactSummary, ServerMessage } from "../../shared/protocol.ts";
import { downloadName, titleFromHtml } from "../src/artifacts.ts";
import { ofType, rawRequest, startHarness, textOf } from "./helpers.ts";

const PAGE = "<!doctype html><html><head><title>Testspill</title></head><body><script>document.title = 'kjørte'</script></body></html>";

function get(url: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    // Connect to 127.0.0.1 even for localhost URLs, with the Host header the browser would send.
    const req = http.request({ host: "127.0.0.1", port: target.port, method, path: target.pathname + target.search, headers: { host: target.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function connectable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

test("artifacts are stored with title, HTML, thread and one earlier version, and every window hears about it", async (t) => {
  const h = await startHarness(t);
  const socket = await h.socket();
  const project = await h.project();
  const thread = await h.thread(project.id, "code");

  const created = await h.api<Artifact>("POST", "/api/artifacts", { html: PAGE, threadId: thread.id, messageId: "m1", sourceKey: "k1" });
  assert.equal(created.title, "Testspill", "the title comes from <title>");
  assert.equal(created.threadId, thread.id);
  assert.equal(created.threadTitle, thread.title);
  assert.equal(created.projectId, project.id, "the project comes from the thread");
  assert.equal(created.messageId, "m1");
  assert.equal(created.sourceKey, "k1");
  assert.equal(created.html, PAGE);
  assert.equal(created.previousHtml, null);
  assert.equal(created.hasPrevious, false);
  assert.ok(created.createdAt > 0 && created.updatedAt >= created.createdAt);
  assert.match(created.previewUrl, new RegExp(`^${h.app.preview.origin}/a/${created.id}/[\\w-]{43}$`));
  const changed = await socket.waitFor<Extract<ServerMessage, { type: "artifact.changed" }>>((m) => m.type === "artifact.changed");
  assert.equal(changed.artifact.id, created.id);
  assert.equal("html" in changed.artifact, false, "the broadcast leaves the HTML out");

  const list = await h.api<ArtifactSummary[]>("GET", "/api/artifacts");
  assert.equal(list.length, 1);
  assert.equal(list[0].size, PAGE.length);
  assert.equal("html" in list[0], false, "the list leaves the HTML out");
  assert.deepEqual((await h.api("GET", "/api/bootstrap")).artifacts.map((a: ArtifactSummary) => a.id), [created.id]);

  const edited = await h.api<Artifact>("PATCH", `/api/artifacts/${created.id}`, { html: "<!doctype html><p>ny</p>", title: "  Nytt   navn " });
  assert.equal(edited.html, "<!doctype html><p>ny</p>");
  assert.equal(edited.previousHtml, PAGE, "one earlier version is kept");
  assert.equal(edited.title, "Nytt navn");
  const again = await h.api<Artifact>("PATCH", `/api/artifacts/${created.id}`, { html: "<!doctype html><p>nyere</p>" });
  assert.equal(again.previousHtml, "<!doctype html><p>ny</p>", "only one");
  const restored = await h.api<Artifact>("POST", `/api/artifacts/${created.id}/restore`);
  assert.equal(restored.html, "<!doctype html><p>ny</p>");
  assert.equal(restored.previousHtml, "<!doctype html><p>nyere</p>");

  const copy = await h.api<Artifact>("POST", `/api/artifacts/${created.id}/duplicate`);
  assert.equal(copy.title, "Kopi av Nytt navn");
  assert.equal(copy.html, restored.html);
  assert.equal(copy.projectId, project.id);
  assert.equal(copy.messageId, null, "the chat card keeps pointing at the original");
  assert.equal((await h.api<ArtifactSummary[]>("GET", "/api/artifacts"))[0].id, copy.id, "newest first");

  // A deleted thread leaves the artifact, without the link.
  await h.api("DELETE", `/api/threads/${thread.id}`);
  const orphan = await h.api<Artifact>("GET", `/api/artifacts/${created.id}`);
  assert.equal(orphan.threadId, null);
  assert.equal(orphan.threadTitle, null);

  await h.api("DELETE", `/api/artifacts/${copy.id}`);
  await socket.waitFor((m) => m.type === "artifact.deleted" && m.artifactId === copy.id);
  await assert.rejects(h.api("GET", `/api/artifacts/${copy.id}`), /404/);

  // Made by hand: a blank template.
  const blank = await h.api<Artifact>("POST", "/api/artifacts", {});
  assert.equal(blank.title, "Ny artifact");
  assert.match(blank.html, /<!doctype html>/);
  assert.equal(blank.threadId, null);
});

test("artifact input is checked", async (t) => {
  const h = await startHarness(t);
  await assert.rejects(h.api("POST", "/api/artifacts", { html: 42 }), /400/);
  await assert.rejects(h.api("POST", "/api/artifacts", { html: "x".repeat(2 * 1024 * 1024 + 1) }), /413/);
  await assert.rejects(h.api("POST", "/api/artifacts", { html: PAGE, threadId: "finnes-ikke" }), /404/);
  await assert.rejects(h.api("POST", "/api/artifacts", { html: PAGE, sourceKey: "x".repeat(500) }), /400/);
  const artifact = await h.api<Artifact>("POST", "/api/artifacts", { html: PAGE });
  await assert.rejects(h.api("PATCH", `/api/artifacts/${artifact.id}`, { title: "  " }), /400/);
  await assert.rejects(h.api("POST", `/api/artifacts/${artifact.id}/restore`), /409/, "nothing to restore yet");
  await assert.rejects(h.api("PATCH", "/api/artifacts/finnes-ikke", { title: "x" }), /404/);
  await assert.rejects(h.api("POST", "/api/previews", { html: null }), /400/);
  // Plain text is refused, so a form on another site cannot write either.
  const form = await h.raw("POST", "/api/artifacts", { headers: { "content-type": "text/plain" }, body: JSON.stringify({ html: PAGE }) });
  assert.equal(form.status, 415);

  assert.equal(titleFromHtml("<h1>Hei <em>du</em></h1>"), "Hei du");
  assert.equal(titleFromHtml("<p>ingen</p>"), "Uten tittel");
  assert.match(downloadName('Spill: "../../etc/passwd"'), /^Spill-[\w.-]*\.html$/);
  assert.doesNotMatch(downloadName('a/b\\c"d'), /[/\\"]/);
  assert.equal(downloadName("øøø"), "artifact.html");
});

test("download is an attachment that never renders on the app's origin", async (t) => {
  const h = await startHarness(t);
  const artifact = await h.api<Artifact>("POST", "/api/artifacts", { html: PAGE, title: "Mitt spill" });
  const res = await h.raw("GET", `/api/artifacts/${artifact.id}/download`);
  assert.equal(res.status, 200);
  assert.equal(res.body, PAGE);
  assert.match(String(res.headers["content-disposition"]), /^attachment; filename="Mitt-spill\.html"; filename\*=UTF-8''Mitt%20spill\.html$/);
  assert.match(String(res.headers["content-security-policy"]), /^sandbox; default-src 'none'$/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  const anonymous = await rawRequest(h.app.port, "GET", `/api/artifacts/${artifact.id}/download`);
  assert.equal(anonymous.status, 401, "the usual login applies");
});

test("the preview server serves an artifact only with this run's key, and nothing from disk", async (t) => {
  const h = await startHarness(t);
  const artifact = await h.api<Artifact>("POST", "/api/artifacts", { html: PAGE });
  const { preview } = h.app;
  assert.notEqual(preview.listeningPort, h.app.port, "another port, so another origin");
  assert.equal(preview.origin, `http://localhost:${preview.listeningPort}`, "localhost, so the app cookie on 127.0.0.1 never goes there");

  const ok = await get(artifact.previewUrl);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, PAGE);
  assert.equal(ok.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(ok.headers["set-cookie"], undefined);
  assert.equal(ok.headers["access-control-allow-origin"], undefined);
  const csp = String(ok.headers["content-security-policy"]);
  assert.match(csp, /^sandbox allow-scripts allow-modals;/, "opaque origin even when opened on its own");
  assert.ok(!csp.includes("allow-same-origin"));
  assert.match(csp, new RegExp(`frame-ancestors http://127\\.0\\.0\\.1:${h.app.port} http://localhost:${h.app.port}$`));

  // Edits show on the next load: the URL is stable and the HTML is read from the database.
  await h.api("PATCH", `/api/artifacts/${artifact.id}`, { html: "<!doctype html><p>endret</p>" });
  assert.equal((await get(artifact.previewUrl)).body, "<!doctype html><p>endret</p>");

  const url = new URL(artifact.previewUrl);
  const [, , id, key] = url.pathname.split("/");
  const other = await h.api<Artifact>("POST", "/api/artifacts", { html: "<!doctype html>annen" });
  const otherKey = new URL(other.previewUrl).pathname.split("/")[3];
  const refused = [
    `/a/${id}`, // no key
    `/a/${id}/`, // empty key
    `/a/${id}/${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`, // one character off
    `/a/${id}/${key}x`,
    `/a/${id}/${otherKey}`, // another artifact's key
    `/a/${other.id}/${key}`,
    `/a/${id}/${key}/extra`,
    "/",
    "/index.html",
    "/etc/passwd",
    "/../../../../etc/passwd",
    "/%2e%2e/%2e%2e/etc/passwd",
    `/a/..%2f..%2fetc%2fpasswd/${key}`,
    "/s/",
    "/s/finnes-ikke",
    `/s/${key}`,
    `/${path.basename(h.app.config.dataDir)}/agentic-desktop.db`,
  ];
  for (const target of refused) {
    const res = await get(`${preview.origin}${target}`);
    assert.equal(res.status, 404, `${target} gave ${res.status}`);
    assert.equal(res.body, "Ikke funnet");
  }
  assert.equal((await get(artifact.previewUrl.replace(`/a/${id}/`, `/a/${encodeURIComponent(id)}/`))).status, 200);

  // Only reading, only its own Host.
  assert.equal((await get(artifact.previewUrl, {}, "POST")).status, 405);
  assert.equal((await get(artifact.previewUrl, {}, "HEAD")).status, 200);
  assert.equal((await get(artifact.previewUrl, { host: "evil.example" })).status, 403);
  assert.equal((await get(artifact.previewUrl, { host: `127.0.0.1:${h.app.port}` })).status, 403);

  // Deleted means gone.
  await h.api("DELETE", `/api/artifacts/${artifact.id}`);
  assert.equal((await get(artifact.previewUrl)).status, 404);

  // Loopback only.
  assert.ok(await connectable("127.0.0.1", preview.listeningPort));
  assert.equal(await connectable("::1", preview.listeningPort), false);

  // The code has no way to read files at all.
  const source = readFileSync(path.join(import.meta.dirname, "../src/preview.ts"), "utf8");
  assert.doesNotMatch(source, /from "node:fs|from "fs|require\(/);
});

test("the preview key is new for every run of the server", async (t) => {
  const a = await startHarness(t);
  const b = await startHarness(t);
  const keyOf = (url: string) => new URL(url).pathname.split("/")[3];
  assert.notEqual(keyOf(a.app.preview.artifactUrl("same-id")), keyOf(b.app.preview.artifactUrl("same-id")));
  const artifact = await a.api<Artifact>("POST", "/api/artifacts", { html: PAGE });
  const moved = artifact.previewUrl.replace(a.app.preview.origin, b.app.preview.origin);
  assert.equal((await get(moved)).status, 404, "a key from another run does not work");
});

test("chat previews are snapshots behind a random token, and the memory they use is capped", async (t) => {
  const h = await startHarness(t);
  const { url } = await h.api<{ url: string }>("POST", "/api/previews", { html: PAGE });
  assert.match(url, new RegExp(`^${h.app.preview.origin}/s/[\\w-]{43}$`));
  const res = await get(url);
  assert.equal(res.status, 200);
  assert.equal(res.body, PAGE);
  assert.match(String(res.headers["content-security-policy"]), /^sandbox allow-scripts allow-modals;/);
  assert.equal((await h.api("POST", "/api/previews", { html: PAGE })).url, url, "the same HTML gets the same URL");
  const anonymous = await rawRequest(h.app.port, "POST", "/api/previews", {
    headers: { origin: h.origin, "content-type": "application/json" },
    body: JSON.stringify({ html: PAGE }),
  });
  assert.equal(anonymous.status, 401);

  for (let i = 0; i < 70; i++) await h.api("POST", "/api/previews", { html: `<!doctype html>${i}` });
  assert.equal((await get(url)).status, 404, "the oldest snapshot was dropped");
  const newest = await h.api<{ url: string }>("POST", "/api/previews", { html: "<!doctype html>69" });
  assert.equal((await get(newest.url)).status, 200);
});

test("artifact HTML cannot reach the app: Origin null and the preview origin are refused, also with a valid cookie", async (t) => {
  const h = await startHarness(t);
  const artifact = await h.api<Artifact>("POST", "/api/artifacts", { html: PAGE });
  // A sandboxed iframe without allow-same-origin sends Origin: null; a page opened on the preview
  // server would send its own origin. Here they even carry the session cookie.
  for (const origin of ["null", h.app.preview.origin, `http://127.0.0.1:${h.app.preview.listeningPort}`]) {
    for (const [method, url, body] of [
      ["GET", "/api/bootstrap"],
      ["GET", "/api/artifacts"],
      ["GET", `/api/artifacts/${artifact.id}`],
      ["GET", `/api/artifacts/${artifact.id}/download`],
      ["POST", "/api/ws-ticket"],
      ["POST", "/api/threads", { mode: "chat" }],
      ["PATCH", `/api/artifacts/${artifact.id}`, { html: "pwned" }],
      ["DELETE", `/api/artifacts/${artifact.id}`],
      ["POST", "/api/previews", { html: "x" }],
    ] as Array<[string, string, unknown?]>) {
      const res = await h.raw(method, url, {
        headers: { origin, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(res.status, 403, `${method} ${url} with Origin ${origin} gave ${res.status}`);
      assert.equal(res.headers["access-control-allow-origin"], undefined, "no CORS");
    }
  }
  assert.equal((await h.api<Artifact>("GET", `/api/artifacts/${artifact.id}`)).html, PAGE, "nothing changed");
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, 0, "no thread was made");

  // The WebSocket refuses both origins before the upgrade, even with a valid ticket.
  for (const origin of ["null", h.app.preview.origin]) {
    const { ticket } = await h.api("POST", "/api/ws-ticket");
    const result = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${h.app.port}/ws?ticket=${ticket}`, { headers: { origin, cookie: h.cookie } });
      ws.once("open", () => (ws.terminate(), resolve("open")));
      ws.once("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
      ws.once("error", (err) => resolve(`error ${err.message}`));
    });
    assert.notEqual(result, "open", `WebSocket with Origin ${origin}`);
  }

  // The app may frame the preview origin and nothing else.
  const csp = String((await h.raw("GET", "/")).headers["content-security-policy"]);
  const frameSrc = csp.split("; ").filter((d) => d.startsWith("frame-src"));
  assert.deepEqual(frameSrc, [`frame-src ${h.app.preview.origin}`]);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/, "nothing may frame the app");
});

test("projects can be pinned and unpinned", async (t) => {
  const h = await startHarness(t);
  const socket = await h.socket();
  const project = await h.project();
  assert.equal(project.pinned, false);
  const pinned = await h.api("PATCH", `/api/projects/${project.id}`, { pinned: true });
  assert.equal(pinned.pinned, true);
  await socket.waitFor((m) => m.type === "project.changed" && m.project.pinned);
  assert.equal((await h.api("GET", "/api/bootstrap")).projects[0].pinned, true);
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { pinned: "ja" }), /400/);
  assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { pinned: false })).pinned, false);
});

test("the chat preview can be turned off in the settings", async (t) => {
  const h = await startHarness(t);
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.artifactPreview, undefined, "on by default");
  assert.equal((await h.api("PATCH", "/api/settings", { artifactPreview: false })).artifactPreview, false);
});

test("the demo model answers artifact with a single-file HTML program in an html block", async (t) => {
  const h = await startHarness(t);
  for (const [text, mode] of [["lag en artifact", "chat"], ["html-spill", "chat"], ["artifact", "code"]] as const) {
    const project = mode === "code" ? await h.project() : null;
    const thread = await h.thread(project?.id ?? null, mode);
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text });
    const events = await h.finished(thread.id);
    const reply = textOf(events);
    // Round 15: a file name may follow the language.
    const block = /```html(?: [\w.-]+)?\n([\s\S]*?)\n```/.exec(reply)?.[1];
    assert.ok(block, `an html block for "${text}" in ${mode}`);
    assert.match(block!, /^<!doctype html>/);
    assert.match(block!, /<canvas/);
    assert.match(block!, /Poeng/);
    assert.equal(ofType(events, "tool.started").length, 0, "no tools needed");
  }
});
