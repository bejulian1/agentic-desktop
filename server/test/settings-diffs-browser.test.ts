import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { diffLines, inlineDiff, lineChangeCounts, splitDiffRows, stackedDiffSpans } from "../../shared/line-diff.ts";
import { agentBrowserAllowed, browserSearchUrl, modelSearchUrl, searchEngineOf, threadNotificationsOf, webSearchRoute } from "../../shared/protocol.ts";
import { migrateSettings } from "../src/db.ts";
import { startHarness, tempDir } from "./helpers.ts";

test("lineDiff ignoreWhitespace, inlineDiff, splitDiffRows and stackedDiffSpans", () => {
  const before = "function hello(a, b) {\n  return a + b;\n}\n";
  const wsOnly = "function   hello(a, b) {\n    return   a + b;\n}\n";
  assert.deepEqual(lineChangeCounts(before, wsOnly), { additions: 2, deletions: 2, countsExact: true });
  assert.deepEqual(lineChangeCounts(before, wsOnly, { ignoreWhitespace: true }), { additions: 0, deletions: 0, countsExact: true });

  const after = "function hello(a, c) {\n  return a * c;\n}\n";
  const lines = diffLines(before, after);
  const split = splitDiffRows(lines);
  assert.equal(split.length, 3);
  assert.equal(split[0].kind, "pair");
  if (split[0].kind === "pair") {
    assert.equal(split[0].left?.kind, "del");
    assert.equal(split[0].right?.kind, "add");
    assert.ok(split[0].leftSpans?.some((s) => s.changed && s.text.includes("b")));
    assert.ok(split[0].rightSpans?.some((s) => s.changed && s.text.includes("c")));
  }

  const word = inlineDiff("const alpha = 1;", "const beta = 1;");
  assert.ok(word.del.some((s) => s.changed && s.text === "alpha"));
  assert.ok(word.add.some((s) => s.changed && s.text === "beta"));

  const spans = stackedDiffSpans(lines);
  assert.ok(spans.size >= 2);
});

test("legacy notification and search engine settings migrate cleanly", () => {
  assert.equal(threadNotificationsOf({}), "off");
  assert.equal(threadNotificationsOf({ notifyOnDone: "unfocused" }), "notify");
  assert.equal(threadNotificationsOf({ soundOnDone: true }), "sound");
  assert.equal(threadNotificationsOf({ threadNotifications: "off", soundOnDone: true }), "off");

  const migratedNotify = migrateSettings({ theme: "system", defaultModelId: null, defaultPermissionMode: "ask", autoOpenAgentThreads: true, notifyOnDone: "always" });
  assert.equal(migratedNotify.threadNotifications, "notify");

  const migratedSound = migrateSettings({ theme: "system", defaultModelId: null, defaultPermissionMode: "ask", autoOpenAgentThreads: true, soundOnDone: true });
  assert.equal(migratedSound.threadNotifications, "sound");

  const migratedCustom = migrateSettings({ theme: "system", defaultModelId: null, defaultPermissionMode: "ask", autoOpenAgentThreads: true, webSearchUrl: "https://sok.example/?q={q}" });
  assert.equal(migratedCustom.searchEngine, "custom");
  assert.equal(browserSearchUrl(migratedCustom), "https://sok.example/?q={q}");

  const migratedBuiltIn = migrateSettings({ theme: "system", defaultModelId: null, defaultPermissionMode: "ask", autoOpenAgentThreads: true, webSearchUrl: "https://search.brave.com/search?q={q}" });
  assert.equal(migratedBuiltIn.searchEngine, "brave");
  assert.equal(searchEngineOf(migratedBuiltIn), "brave");
  assert.equal(modelSearchUrl(migratedBuiltIn), "https://search.brave.com/search?q={q}");
});

test("PATCH /api/settings validates and persists diffs, browser, notifications and projectOrder", async (t) => {
  const h = await startHarness(t);
  const saved = await h.api("PATCH", "/api/settings", {
    diffLayout: "split",
    diffIgnoreWhitespace: true,
    diffFileState: "collapsed",
    diffColors: "blue-orange",
    searchEngine: "brave",
    agentBrowserAccess: false,
    openLinksIn: "app",
    browserDefaultZoom: 1.25,
    browserAppearance: "dark",
    threadNotifications: "sound",
    inAppNotifications: true,
    projectOrder: "name",
  });
  assert.equal(saved.diffLayout, "split");
  assert.equal(saved.diffIgnoreWhitespace, true);
  assert.equal(saved.diffFileState, "collapsed");
  assert.equal(saved.diffColors, "blue-orange");
  assert.equal(saved.searchEngine, "brave");
  assert.equal(saved.webSearchUrl, "https://search.brave.com/search?q={q}");
  assert.equal(saved.agentBrowserAccess, false);
  assert.equal(saved.openLinksIn, "app");
  assert.equal(saved.browserDefaultZoom, 1.25);
  assert.equal(saved.browserAppearance, "dark");
  assert.equal(saved.threadNotifications, "sound");
  assert.equal(saved.soundOnDone, true);
  assert.equal(saved.inAppNotifications, true);
  assert.equal(saved.projectOrder, "name");

  // webSearchRoute sees the unified searchEngine
  assert.equal(webSearchRoute({ supportsTools: true }, "openai-compatible", saved), "browser");

  // Invalid values return 400
  for (const bad of [
    { diffLayout: "wide" },
    { diffFileState: "half" },
    { diffColors: "neon" },
    { searchEngine: "askjeeves" },
    { openLinksIn: "tab" },
    { browserDefaultZoom: 3.5 },
    { browserAppearance: "sepia" },
    { threadNotifications: "loud" },
    { projectOrder: "random" },
  ]) {
    await assert.rejects(h.api("PATCH", "/api/settings", bad), /400/, JSON.stringify(bad));
  }

  // Custom search URL validation
  await assert.rejects(h.api("PATCH", "/api/settings", { searchEngine: "custom", webSearchUrl: "https://sok.example/no-placeholder" }), /\{q\}/);
  const custom = await h.api("PATCH", "/api/settings", { searchEngine: "custom", webSearchUrl: "https://sok.example/q={q}" });
  assert.equal(custom.searchEngine, "custom");
  assert.equal(custom.webSearchUrl, "https://sok.example/q={q}");
});

test("agentBrowserAccess enforces global setting and per-project overrides without crashing", async (t) => {
  const h = await startHarness(t);
  const folder = tempDir(t, "ad-browser-access-");
  writeFileSync(path.join(folder, "index.html"), "<!doctype html><title>Test</title><h1>Hei</h1>");
  const project = await h.project(folder, { name: "AccessTest" });
  const thread = await h.thread(project.id, "code");
  const skills = h.app.runner.skillsFor(project, "code");

  // Default: enabled
  assert.equal(agentBrowserAllowed(h.app.store.settings(), project), true);
  assert.ok(h.app.runner.toolDefs(thread, project, skills).some((d) => d.name === "browser_navigate"));

  // Turn off globally -> browser tools removed from offered tools
  await h.api("PATCH", "/api/settings", { agentBrowserAccess: false });
  assert.equal(h.app.runner.toolDefs(thread, project, skills).some((d) => d.name === "browser_navigate"), false);

  // Override per project to allow -> browser tools offered again for this project
  const allowedProject = await h.api("PATCH", `/api/projects/${project.id}`, { agentBrowserAccess: true });
  assert.equal(allowedProject.agentBrowserAccess, true);
  assert.equal(h.app.runner.toolDefs(thread, allowedProject, skills).some((d) => d.name === "browser_navigate"), true);

  // Turn global back on, override project to false -> blocked for this project
  await h.api("PATCH", "/api/settings", { agentBrowserAccess: true });
  const blockedProject = await h.api("PATCH", `/api/projects/${project.id}`, { agentBrowserAccess: false });
  assert.equal(blockedProject.agentBrowserAccess, false);
  assert.equal(h.app.runner.toolDefs(thread, blockedProject, skills).some((d) => d.name === "browser_navigate"), false);

  // Even when the mock model invokes browser_navigate, it gets a clear tool-unavailable message (not a crash)
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  const done = h.finished(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  await done;
  const events = await h.events(thread.id);
  const browserError = events.find((e) => e.event.type === "tool.finished" && e.event.status === "error" && e.event.result?.includes("nettleseren er slått av"));
  assert.ok(browserError, "model received clear browser-disabled error instead of crashing");

  // Reset project override back to null (inherit global)
  const inherited = await h.api("PATCH", `/api/projects/${project.id}`, { agentBrowserAccess: null });
  assert.equal(inherited.agentBrowserAccess, null);
  assert.equal(h.app.runner.toolDefs(thread, inherited, skills).some((d) => d.name === "browser_navigate"), true);
});

test("GET /api/turns/:id/diff?ignoreWhitespace=1 hides whitespace-only counts", async (t) => {
  const h = await startHarness(t);
  const folder = tempDir(t, "ad-ws-diff-");
  const project = await h.project(folder, { name: "WsDiff" });
  const thread = await h.thread(project.id, "code");
  const turnId = "turn-ws-1";
  h.app.store.createRun({ id: "run-ws-1", threadId: thread.id, modelId: "mock-demo", turnId, startSeq: 0 });
  h.app.store.addTurnFile(turnId, "demo.txt", Buffer.from("const a = 1;\n"));
  h.app.store.recordTurnFileAfter(turnId, "demo.txt", Buffer.from("const   a   =   1;\n"));
  h.app.store.finishTurnFile(turnId, {
    path: "demo.txt",
    before: Buffer.from("const a = 1;\n"),
    after: Buffer.from("const   a   =   1;\n"),
    change: "modified",
    additions: 1,
    deletions: 1,
  });

  const normal = await h.api("GET", `/api/turns/${turnId}/diff`);
  assert.equal(normal.files[0].additions, 1);
  assert.equal(normal.files[0].deletions, 1);

  const ignored = await h.api("GET", `/api/turns/${turnId}/diff?ignoreWhitespace=1`);
  assert.equal(ignored.files[0].additions, 0);
  assert.equal(ignored.files[0].deletions, 0);
});

test("browserAppearance emulates prefers-color-scheme in headless Chrome", async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>Scheme</title></head><body><div id="scheme">unknown</div><script>
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const update = () => { document.getElementById("scheme").textContent = mq.matches ? "dark" : "light"; };
      update();
      mq.addEventListener("change", update);
    </script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const h = await startHarness(t);
  const folder = tempDir(t, "ad-appearance-");
  const project = await h.project(folder, { name: "Appearance" });

  await h.api("PATCH", "/api/settings", { browserAppearance: "dark" });
  await h.app.browser.navigate(project.id, url);
  let snap = await h.app.browser.snapshot(project.id);
  assert.match(snap, /dark/, "page sees prefers-color-scheme: dark");

  await h.api("PATCH", "/api/settings", { browserAppearance: "light" });
  await new Promise((r) => setTimeout(r, 150));
  snap = await h.app.browser.snapshot(project.id);
  assert.match(snap, /light/, "open page switches to prefers-color-scheme: light");
});
