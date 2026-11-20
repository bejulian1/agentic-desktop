// Round 10 (SPEC 23): tabs in the Browser panel with favicons, the agent in the tab shown last, and
// import from Chrome. The Chrome profile is always a fake one in a temporary home folder: the
// user's real ~/.config/google-chrome is never read, not even to look.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { BrowserTabInfo, ServerMessage } from "../../shared/protocol.ts";
import { listChromeProfiles } from "../src/chrome-import.ts";
import { startHarness, tempDir, until } from "./helpers.ts";

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function pages(): Promise<{ base: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/ikon.png") return void res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    if (req.url === "/b") return void res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Side B</title><p>B");
    if (req.url === "/favicon.ico") return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><title>Side A</title><link rel="icon" href="/ikon.png"><p>A');
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })));
}

const lastTabs = (received: ServerMessage[], projectId: string) =>
  [...received].reverse().find((m): m is Extract<ServerMessage, { type: "browser.tabs" }> => m.type === "browser.tabs" && m.projectId === projectId);

test("tabs: one page per tab, favicons as data URLs, the agent in the tab shown last, and closing a tab", async (t) => {
  const site = await pages();
  t.after(site.close);
  const h = await startHarness(t);
  const project = await h.project();
  const socket = await h.socket();

  // The first tab is the page the project always had.
  socket.send({ type: "browser.open", projectId: project.id, width: 800, height: 600 });
  await socket.waitFor((m) => m.type === "browser.state" && m.projectId === project.id && (m.tabId ?? "") === "");
  socket.send({ type: "browser.navigate", projectId: project.id, url: `${site.base}/`, tabId: "" });
  await until(() => lastTabs(socket.received, project.id)?.tabs.some((tab) => tab.title === "Side A" && tab.favicon?.startsWith("data:image/png;base64,")) ?? false, "tab A with its icon");

  // A second tab: a page of its own, and the agent follows to it.
  socket.send({ type: "browser.open", projectId: project.id, width: 800, height: 600, tabId: "t-to" });
  await until(() => (lastTabs(socket.received, project.id)?.tabs.length ?? 0) === 2, "two tabs");
  assert.equal(lastTabs(socket.received, project.id)!.active, "t-to");
  assert.match(await h.app.browser.navigate(project.id, `${site.base}/b`), /Side B/);
  await until(() => {
    const tabs = lastTabs(socket.received, project.id)?.tabs ?? [];
    return tabs.map((tab: BrowserTabInfo) => `${tab.id}:${tab.title}`).join("|") === ":Side A|t-to:Side B";
  }, "the agent opened B in the second tab, A is left alone");
  assert.match(await h.app.browser.snapshot(project.id), /Side B/);
  // Frames come for the tab on screen only.
  const frame = await socket.waitFor((m) => m.type === "browser.frame" && m.tabId === "t-to");
  assert.equal(frame.type, "browser.frame");

  // Bad tab ids are the first tab, never a path or a key of another project.
  socket.send({ type: "browser.navigate", projectId: project.id, url: `${site.base}/b`, tabId: "../../x" });
  await until(() => lastTabs(socket.received, project.id)?.tabs.find((tab) => tab.id === "")?.title === "Side B", "the first tab");

  // A window that opens the panel without naming a tab (a reload) gets the tab shown last.
  const other = await h.socket();
  other.send({ type: "browser.open", projectId: project.id, width: 800, height: 600 });
  await other.waitFor((m) => m.type === "browser.state" && m.projectId === project.id && m.tabId === "t-to");

  // Closing the second tab: the agent is back in the first.
  socket.send({ type: "browser.close-tab", projectId: project.id, tabId: "t-to" });
  await until(() => (lastTabs(socket.received, project.id)?.tabs.length ?? 0) === 1, "one tab left");
  assert.equal(lastTabs(socket.received, project.id)!.active, "");
  assert.match(await h.app.browser.snapshot(project.id), /Side B/);
});

// A fake profile: Bookmarks, History, and the files that must never be read, with a marker in each.
const SECRET = "HEMMELIG-MÅ-ALDRI-LESES";
function fakeProfile(home: string): { history: string } {
  const root = path.join(home, ".config/google-chrome");
  const dir = path.join(root, "Default");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "Bookmarks"), JSON.stringify({
    roots: {
      bookmark_bar: { type: "folder", name: "Bookmarks bar", children: [
        { type: "url", name: "Eksempel", url: "https://example.com/" },
        { type: "folder", name: "Jobb", children: [{ type: "url", name: "Dokumentasjon", url: "https://docs.example.com/start" }] },
        { type: "url", name: "Skript", url: "javascript:alert(1)" },
        { type: "url", name: "Fil", url: "file:///etc/passwd" },
      ] },
      other: { type: "folder", name: "Other", children: [{ type: "url", name: "", url: "https://uten-navn.example/" }] },
    },
  }));
  const history = path.join(dir, "History");
  const db = new DatabaseSync(history);
  db.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)");
  const insert = db.prepare("INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)");
  const webkit = (ms: number) => (ms + 11_644_473_600_000) * 1000;
  insert.run("https://nyheter.example/", "Nyheter", 12, webkit(Date.UTC(2026, 10, 4, 12)), 0);
  insert.run("https://eldre.example/", "Eldre", 2, webkit(Date.UTC(2026, 9, 1)), 0);
  insert.run("https://skjult.example/", "Skjult", 1, webkit(Date.UTC(2026, 10, 5)), 1);
  insert.run("chrome://settings", "Innstillinger", 1, webkit(Date.UTC(2026, 10, 5)), 0);
  db.close();
  for (const name of ["Cookies", "Login Data", "Web Data", "Current Session", "Last Session"]) writeFileSync(path.join(dir, name), SECRET);
  mkdirSync(path.join(dir, "Sessions"));
  writeFileSync(path.join(dir, "Sessions", "Session_1"), SECRET);
  // A second profile with only bookmarks, and one whose Bookmarks is a symlink to a secret: skipped.
  mkdirSync(path.join(root, "Profile 2"));
  writeFileSync(path.join(root, "Profile 2", "Bookmarks"), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: "url", name: "To", url: "https://to.example/" }] } } }));
  mkdirSync(path.join(root, "Lenket"));
  symlinkSync(path.join(dir, "Cookies"), path.join(root, "Lenket", "Bookmarks"));
  return { history };
}

test("import from Chrome: profiles, a preview first, only bookmarks and history, never the rest", async (t) => {
  const home = tempDir(t, "ad-r10-home-");
  const { history } = fakeProfile(home);
  const before = { size: statSync(history).size, mtime: statSync(history).mtimeMs, bytes: readFileSync(history) };
  const h = await startHarness(t, { homeDir: home });

  const profiles = await h.api("GET", "/api/browser/chrome-profiles");
  assert.deepEqual(profiles.map((p: any) => [p.browser, p.profile, p.label, p.bookmarks, p.history]), [
    ["chrome", "Default", "Google Chrome · Standard", true, true],
    ["chrome", "Profile 2", "Google Chrome · Profil 2", true, false],
  ], "the symlinked Bookmarks is not offered");

  // The preview reads, and writes nothing.
  const preview = await h.api("POST", "/api/browser/chrome-import/preview", { browser: "chrome", profile: "Default", history: true });
  assert.equal(preview.bookmarks, 3, "only http and https");
  assert.deepEqual(preview.sampleBookmarks.map((b: any) => [b.title, b.folder]), [
    ["Eksempel", "Bokmerkelinjen"],
    ["Dokumentasjon", "Bokmerkelinjen / Jobb"],
    ["https://uten-navn.example/", "Andre bokmerker"],
  ]);
  assert.deepEqual(preview.sampleHistory.map((v: any) => v.title), ["Nyheter", "Eldre"], "newest first, no hidden or chrome:// rows");
  assert.equal(preview.sampleHistory[0].visitedAt, Date.UTC(2026, 10, 4, 12));
  assert.equal(existsSync(path.join(h.app.config.dataDir, "browser-import.json")), false, "a preview imports nothing");
  const noHistory = await h.api("POST", "/api/browser/chrome-import/preview", { browser: "chrome", profile: "Default" });
  assert.equal(noHistory.history, 0, "history only when asked for");

  // The checks on what is asked for.
  for (const [body, status] of [
    [{ browser: "chrome", profile: "../../.ssh" }, 400],
    [{ browser: "chrome", profile: "Default/../Default" }, 400],
    [{ browser: "firefox", profile: "Default" }, 400],
    [{ browser: "chrome", profile: "Finnes ikke" }, 404],
  ] as const) {
    assert.equal((await h.raw("POST", "/api/browser/chrome-import/preview", { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, status, JSON.stringify(body));
  }

  // The import, kept in the data folder, and the History file untouched.
  const result = await h.api("POST", "/api/browser/chrome-import", { browser: "chrome", profile: "Default", history: true });
  assert.deepEqual([result.bookmarks, result.history], [3, 2]);
  const imported = await h.api("GET", "/api/browser/imported");
  assert.equal(imported.source.label, "Google Chrome · Standard");
  assert.equal(imported.bookmarks.length, 3);
  const stored = readFileSync(path.join(h.app.config.dataDir, "browser-import.json"), "utf8");
  assert.ok(!stored.includes(SECRET) && !JSON.stringify(preview).includes(SECRET), "nothing from cookies, passwords or sessions");
  assert.equal(statSync(path.join(h.app.config.dataDir, "browser-import.json")).mode & 0o777, 0o600);
  assert.deepEqual({ size: statSync(history).size, mtime: statSync(history).mtimeMs }, { size: before.size, mtime: before.mtime });
  assert.ok(readFileSync(history).equals(before.bytes), "Chrome's History is never written");

  // Removed again.
  await h.api("DELETE", "/api/browser/imported");
  assert.equal((await h.api("GET", "/api/browser/imported")).importedAt, null);
});

test("import from Chrome: without a profile there is nothing to list, and Chromium is found too", async (t) => {
  const empty = tempDir(t, "ad-r10-empty-");
  assert.deepEqual(listChromeProfiles(path.join(empty, ".config")), []);
  const home = tempDir(t, "ad-r10-chromium-");
  mkdirSync(path.join(home, ".config/chromium/Default"), { recursive: true });
  writeFileSync(path.join(home, ".config/chromium/Default/Bookmarks"), JSON.stringify({ roots: { other: { children: [{ type: "url", name: "C", url: "https://c.example/" }] } } }));
  assert.deepEqual(listChromeProfiles(path.join(home, ".config")).map((p) => p.label), ["Chromium · Standard"]);
  // An empty profile cannot be imported.
  mkdirSync(path.join(home, ".config/chromium/Tom"));
  writeFileSync(path.join(home, ".config/chromium/Tom/Bookmarks"), JSON.stringify({ roots: {} }));
  const h = await startHarness(t, { homeDir: home });
  const res = await h.raw("POST", "/api/browser/chrome-import", { headers: { "content-type": "application/json" }, body: JSON.stringify({ browser: "chromium", profile: "Tom" }) });
  assert.equal(res.status, 422);
});
