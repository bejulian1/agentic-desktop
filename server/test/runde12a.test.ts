// Round 12, part A (SPEC 26.1, 26.2 and 26.4). Cookies are only ever read from fake profiles in a
// temporary home folder, with a fake secret-tool first on PATH. The user's real browser profiles
// and keyring are never touched: the server is given the temporary home, and the fake tool is the
// only secret-tool these tests can reach.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { CookieImportResult, CookieProfileInfo, CookieSiteList, ImportedCookieSite, SessionInfo, Thread } from "../../shared/protocol.ts";
import { COOKIE_FILE } from "../src/browser-cookies.ts";
import { siteOf } from "../src/cookie-import.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";
import { makeChromeProfile, makeFirefoxProfile, makeSecretTool } from "./runde12-fakes.ts";

const DAY = 86_400_000;

// The fake secret-tool, first on PATH for this test process (each test file runs in its own).
function fakeKeyring(t: TestContext): { log: string; bin: string } {
  const bin = tempDir(t, "ad-fake-bin-");
  const log = makeSecretTool(bin);
  const before = process.env.PATH;
  process.env.PATH = `${bin}:${before}`;
  t.after(() => void (process.env.PATH = before));
  return { log, bin };
}

const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);

async function withHome(t: TestContext): Promise<{ h: Harness; home: string }> {
  const home = tempDir(t, "ad-fake-home-");
  const h = await startHarness(t, { homeDir: home });
  return { h, home };
}

function chromeFixture(home: string): void {
  makeChromeProfile(home, [
    { host: ".example.com", name: "sid", value: "v10-verdi", httpOnly: true, secure: true, sameSite: 0, lastUsed: Date.now() - 2 * DAY },
    { host: "www.example.com", name: "pref", value: "lys", path: "/app" },
    { host: ".github.com", name: "user_session", value: "v11-hemmelig-økt", version: "v11", secure: true, lastUsed: Date.now() - DAY },
    { host: "news.example.org", name: "n", value: "1", lastUsed: Date.now() - 10 * DAY },
    { host: ".gammel.no", name: "utløpt", value: "x", expires: Math.floor(Date.now() / 1000) - 60 },
    { host: "plain.test", name: "p", value: "uten-kryptering", version: "plain", lastUsed: Date.now() - 3 * DAY },
  ]);
}

test("sites are grouped by registrable domain", () => {
  assert.equal(siteOf(".mail.example.com"), "example.com");
  assert.equal(siteOf("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(siteOf("someone.github.io"), "someone.github.io");
  assert.equal(siteOf("localhost"), "localhost");
  assert.equal(siteOf("127.0.0.1"), "127.0.0.1");
});

test("profiles are found from the home folder only: Chrome, Chromium and Firefox", async (t) => {
  const { h, home } = await withHome(t);
  chromeFixture(home);
  makeChromeProfile(home, [{ host: ".a.no", name: "a", value: "1" }], { folder: "chromium", profile: "Profile 2" });
  makeFirefoxProfile(home, [{ host: ".mozilla.example", name: "f", value: "1" }]);
  // A profile folder without a cookie database is not offered.
  mkdirSync(path.join(home, ".config/google-chrome/Profile 3"), { recursive: true });
  const profiles = await h.api<CookieProfileInfo[]>("GET", "/api/browser/cookie-profiles");
  assert.deepEqual(profiles.map((p) => p.label), ["Chrome · Standard", "Chromium · Profil 2", "Firefox · default-release"]);
  assert.deepEqual(profiles.map((p) => p.browser), ["chrome", "chromium", "firefox"]);
  // Nothing outside the known roots, and no paths out of them.
  for (const body of [{ browser: "chrome", profile: "../../etc" }, { browser: "chrome", profile: "Default/../.." }, { browser: "opera", profile: "Default" }, { browser: "firefox", profile: "" }]) {
    const res = await h.raw("POST", "/api/browser/cookie-sites", { headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await h.raw("POST", "/api/browser/cookie-sites", { headers: { "content-type": "application/json" }, body: JSON.stringify({ browser: "chrome", profile: "Profile 3" }) })).status, 404);
});

test("Chrome v10 and v11: listing decrypts nothing, only chosen sites are imported, the keyring is asked once", async (t) => {
  const { log } = fakeKeyring(t);
  const { h, home } = await withHome(t);
  chromeFixture(home);

  const list = await h.api<CookieSiteList>("POST", "/api/browser/cookie-sites", { browser: "chrome", profile: "Default" });
  // Most recently used first; the expired cookie is gone.
  assert.deepEqual(list.sites.map((s) => [s.site, s.cookies]), [["example.com", 2], ["github.com", 1], ["plain.test", 1], ["example.org", 1]]);
  assert.equal(list.keyring, "needed");
  assert.equal(list.source.label, "Chrome · Standard");
  assert.deepEqual(calls(log), [], "listing never asks the keyring");

  // Only v10 sites chosen: the keyring is not asked.
  const first = await h.api<CookieImportResult>("POST", "/api/browser/cookie-import", { browser: "chrome", profile: "Default", sites: ["example.com", "plain.test"] });
  assert.deepEqual(first, { sites: 2, cookies: 3, skipped: 0, keyringMissing: false });
  assert.deepEqual(calls(log), []);

  // A v11 site: the key comes from secret-tool, once, as «lookup application chrome».
  const second = await h.api<CookieImportResult>("POST", "/api/browser/cookie-import", { browser: "chrome", profile: "Default", sites: ["github.com"] });
  assert.deepEqual(second, { sites: 1, cookies: 1, skipped: 0, keyringMissing: false });
  assert.deepEqual(calls(log), ["lookup application chrome"]);

  // Kept in the app's own profile folder only, readable by the user only, with the values
  // decrypted for Chrome to take; example.org was never chosen.
  const file = path.join(h.app.config.dataDir, "chrome-profile", COOKIE_FILE);
  const stored = JSON.parse(readFileSync(file, "utf8"));
  const all = [...stored.pending, ...stored.session];
  const byName = Object.fromEntries(all.map((c: any) => [c.cookie.name, c.cookie]));
  assert.equal(byName.sid.value, "v10-verdi");
  assert.equal(byName.sid.domain, ".example.com");
  assert.equal(byName.sid.sameSite, "None");
  assert.equal(byName.sid.httpOnly, true);
  assert.equal(byName.pref.url, "http://www.example.com/app/", "a host cookie is given by address");
  assert.equal(byName.user_session.value, "v11-hemmelig-økt");
  assert.equal(byName.p.value, "uten-kryptering");
  assert.ok(!all.some((c: any) => c.site === "example.org" || c.site === "gammel.no"));
  assert.equal((await import("node:fs")).statSync(file).mode & 0o777, 0o600);

  const imported = await h.api<ImportedCookieSite[]>("GET", "/api/browser/cookies");
  assert.deepEqual(imported.map((s) => [s.site, s.cookies, s.source]), [["example.com", 2, "Chrome · Standard"], ["github.com", 1, "Chrome · Standard"], ["plain.test", 1, "Chrome · Standard"]]);

  // Nothing chosen, or nothing known, is refused.
  assert.equal((await h.raw("POST", "/api/browser/cookie-import", { headers: { "content-type": "application/json" }, body: JSON.stringify({ browser: "chrome", profile: "Default", sites: [] }) })).status, 400);
  assert.equal((await h.raw("POST", "/api/browser/cookie-import", { headers: { "content-type": "application/json" }, body: JSON.stringify({ browser: "chrome", profile: "Default", sites: ["ukjent.no"] }) })).status, 422);
});

test("without secret-tool the dialog is told, v11 cookies are skipped and v10 ones still come", async (t) => {
  const empty = tempDir(t, "ad-empty-bin-");
  const before = process.env.PATH;
  process.env.PATH = empty; // no secret-tool anywhere on PATH, so none can run
  t.after(() => void (process.env.PATH = before));
  const { h, home } = await withHome(t);
  chromeFixture(home);
  const list = await h.api<CookieSiteList>("POST", "/api/browser/cookie-sites", { browser: "chrome", profile: "Default" });
  assert.equal(list.keyring, "missing");
  const res = await h.api<CookieImportResult>("POST", "/api/browser/cookie-import", { browser: "chrome", profile: "Default", sites: ["example.com", "github.com"] });
  assert.deepEqual(res, { sites: 1, cookies: 2, skipped: 1, keyringMissing: true });
  const only = await h.raw("POST", "/api/browser/cookie-import", { headers: { "content-type": "application/json" }, body: JSON.stringify({ browser: "chrome", profile: "Default", sites: ["github.com"] }) });
  assert.equal(only.status, 422);
  assert.match(only.body, /nøkkelringen/);
});

test("Firefox: cookies.sqlite is read from a copy, only the default container, only chosen sites", async (t) => {
  const { log } = fakeKeyring(t);
  const { h, home } = await withHome(t);
  const now = Date.now();
  makeFirefoxProfile(home, [
    { host: ".mozilla.example", name: "login", value: "ff-økt", secure: true, sameSite: 2, lastUsed: now - DAY },
    { host: "docs.mozilla.example", name: "tema", value: "mørkt", lastUsed: now - 2 * DAY },
    { host: ".annet.example", name: "a", value: "b", lastUsed: now - 5 * DAY },
    // Newer Firefox keeps expiry in milliseconds.
    { host: ".ms.example", name: "ms", value: "1", expires: now + 5 * DAY, lastUsed: now - 3 * DAY },
  ]);
  const [profile] = await h.api<CookieProfileInfo[]>("GET", "/api/browser/cookie-profiles");
  assert.deepEqual(profile, { browser: "firefox", profile: "abcd1234.default-release", label: "Firefox · default-release" });
  const list = await h.api<CookieSiteList>("POST", "/api/browser/cookie-sites", { browser: "firefox", profile: profile.profile });
  assert.deepEqual(list.sites.map((s) => s.site), ["mozilla.example", "ms.example", "annet.example"]);
  assert.equal(list.keyring, "not-needed");
  const res = await h.api<CookieImportResult>("POST", "/api/browser/cookie-import", { browser: "firefox", profile: profile.profile, sites: ["mozilla.example", "ms.example"] });
  assert.deepEqual(res, { sites: 2, cookies: 3, skipped: 0, keyringMissing: false });
  const stored = JSON.parse(readFileSync(path.join(h.app.config.dataDir, "chrome-profile", COOKIE_FILE), "utf8"));
  const cookies = Object.fromEntries(stored.pending.map((c: any) => [c.cookie.name, c.cookie]));
  assert.equal(cookies.login.value, "ff-økt");
  assert.equal(cookies.login.sameSite, "Strict");
  assert.equal(cookies.tema.url, "http://docs.mozilla.example/");
  assert.ok(cookies.ms.expires > now / 1000 && cookies.ms.expires < now / 1000 + 6 * 86400, "milliseconds are read as such");
  assert.ok(!stored.pending.some((c: any) => c.site === "annet.example" || c.cookie.name === "beholder"));
  assert.deepEqual(calls(log), [], "Firefox never needs the keyring");
});

test("passwords, cards and autofill are never read", async (t) => {
  fakeKeyring(t);
  const { h, home } = await withHome(t);
  // The fakes make Login Data, Web Data, logins.json, key4.db and formhistory.sqlite unreadable,
  // so opening any of them would make the import fail.
  chromeFixture(home);
  makeFirefoxProfile(home, [{ host: ".x.example", name: "x", value: "1" }]);
  await h.api("POST", "/api/browser/cookie-import", { browser: "chrome", profile: "Default", sites: ["example.com", "github.com"] });
  await h.api("POST", "/api/browser/cookie-import", { browser: "firefox", profile: "abcd1234.default-release", sites: ["x.example"] });
  // And the reader names no such file at all.
  const source = readFileSync(path.join(import.meta.dirname, "../src/cookie-import.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  for (const name of ["Login Data", "Web Data", "logins.json", "key4.db", "formhistory", "History", "Bookmarks"]) assert.ok(!source.includes(name), name);
  // Nothing of it reached the stored file either.
  const stored = readFileSync(path.join(h.app.config.dataDir, "chrome-profile", COOKIE_FILE), "utf8");
  assert.ok(!/hemmelig|4111|PASSORD/.test(stored.replace(/v11-hemmelig-økt/g, "")));
});

test("forget one site and forget all", async (t) => {
  fakeKeyring(t);
  const { h, home } = await withHome(t);
  chromeFixture(home);
  await h.api("POST", "/api/browser/cookie-import", { browser: "chrome", profile: "Default", sites: ["example.com", "github.com", "plain.test"] });
  await h.api("DELETE", "/api/browser/cookies/github.com");
  assert.deepEqual((await h.api<ImportedCookieSite[]>("GET", "/api/browser/cookies")).map((s) => s.site), ["example.com", "plain.test"]);
  const file = path.join(h.app.config.dataDir, "chrome-profile", COOKIE_FILE);
  let stored = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(![...stored.pending, ...stored.session].some((c: any) => c.site === "github.com"));
  assert.deepEqual(stored.forget, ["github.com"], "taken out of Chrome when it next runs");
  assert.equal((await h.raw("DELETE", "/api/browser/cookies/github.com")).status, 404);
  await h.api("DELETE", "/api/browser/cookies");
  assert.deepEqual(await h.api("GET", "/api/browser/cookies"), []);
  stored = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual([stored.pending.length, stored.session.length], [0, 0]);
  assert.deepEqual(stored.forget.sort(), ["example.com", "github.com", "plain.test"]);
});

// A local site that shows which cookies it got.
async function echoServer(t: TestContext): Promise<{ port: number; seen: string[] }> {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.cookie ?? "");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Innlogget</title><button>Logg ut</button><p id="c">${(req.headers.cookie ?? "").replace(/[<>&]/g, "")}</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { port: (server.address() as AddressInfo).port, seen };
}

test("imported cookies reach the app's Chrome, and the agent asks before it uses a signed-in site", async (t) => {
  fakeKeyring(t);
  const { h, home } = await withHome(t);
  const { port, seen } = await echoServer(t);
  makeChromeProfile(home, [
    { host: "localhost", name: "okt", value: "innlogget-v10" },
    { host: "localhost", name: "kort", value: "okt-uten-utlop", expires: 0 },
    { host: "localhost", name: "__Host-strengt", value: "1", secure: true },
  ]);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const modelId = (await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 })).id;
  // Full access: nothing else would ask.
  const project = await h.project(undefined, { permissionMode: "full" });

  // Before any import, the same page asks nothing.
  const before = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("browser_navigate", { url: `http://localhost:${port}/` }, "n0")));
  llm.reply(sse(openaiText("Ferdig.")));
  await h.api("POST", `/api/threads/${before.id}/messages`, { text: "åpne siden" });
  assert.equal(ofType(await h.finished(before.id), "approval.requested").length, 0);
  assert.equal(seen.at(-1), "");

  const result = await h.api<CookieImportResult>("POST", "/api/browser/cookie-import", { browser: "chrome", profile: "Default", sites: ["localhost"] });
  assert.equal(result.sites, 1);
  assert.equal(result.cookies + result.skipped, 3);

  // Chrome runs, so they went straight in. The page gets them.
  await h.app.browser.navigate(project.id, `http://localhost:${port}/`);
  assert.match(seen.at(-1)!, /okt=innlogget-v10/);
  assert.match(seen.at(-1)!, /kort=okt-uten-utlop/, "a session cookie too");
  assert.match(seen.at(-1)!, /__Host-strengt=1/, "a host-only cookie stays one");

  // Consent checks follow the thread's own page even while the panel shows an unsigned site.
  const panel = await h.socket();
  panel.send({ type: "browser.open", projectId: project.id, tabId: "uten-innlogging", width: 640, height: 480 });
  await panel.waitFor((m) => m.type === "browser.state" && m.tabId === "uten-innlogging");
  panel.send({ type: "browser.navigate", projectId: project.id, tabId: "uten-innlogging", url: `http://127.0.0.1:${port}/` });
  await panel.waitFor((m) => m.type === "browser.state" && m.tabId === "uten-innlogging" && m.state.url === `http://127.0.0.1:${port}/`);
  assert.equal(h.app.browser.signedInSite(project.id, before.id), null, "legacy check sees the panel");
  assert.equal(h.app.browser.forThread(project.id, before.id).signedInSite?.(project.id, before.id), "localhost", "thread check sees its own imported site");

  // The agent: asked once for the site, in full access too; a yes holds for the rest of the thread.
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("browser_navigate", { url: `http://localhost:${port}/` }, "n1")));
  llm.reply(sse(openaiToolCall("browser_snapshot", {}, "s1")));
  llm.reply(sse(openaiText("Ferdig.")));
  const stop = h.approveAll(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "sjekk siden" });
  const events = await h.finished(thread.id);
  stop();
  const asked = ofType(events, "approval.requested");
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Bruke innloggingen din på localhost");
  assert.match(asked[0].detail, /importert[\s\S]*resten av denne tråden/);
  assert.equal(asked[0].canAllowAlways, false);
  assert.deepEqual(ofType(events, "tool.finished").map((e) => e.status), ["done", "done"]);
  assert.equal(h.app.browser.forThread(project.id, thread.id).signedInSite?.(project.id, thread.id), null);
  assert.equal(h.app.browser.forThread(project.id, before.id).signedInSite?.(project.id, before.id), "localhost", "another thread cannot inherit this consent");

  // A no is a no.
  const denied = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("browser_navigate", { url: `http://localhost:${port}/` }, "s2")));
  llm.reply(sse(openaiText("Greit.")));
  const stopDeny = h.approveAll(denied.id, "deny");
  await h.api("POST", `/api/threads/${denied.id}/messages`, { text: "les siden" });
  const deniedEvents = await h.finished(denied.id);
  stopDeny();
  assert.deepEqual(ofType(deniedEvents, "tool.finished").map((e) => e.status), ["denied"]);

  // With the choice off, nothing asks.
  await h.api("PATCH", "/api/settings", { browserAskSignedIn: false });
  const free = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("browser_navigate", { url: `http://localhost:${port}/` }, "s3")));
  llm.reply(sse(openaiText("Ok.")));
  await h.api("POST", `/api/threads/${free.id}/messages`, { text: "les siden" });
  assert.equal(ofType(await h.finished(free.id), "approval.requested").length, 0);
  assert.equal((await h.raw("PATCH", "/api/settings", { headers: { "content-type": "application/json" }, body: JSON.stringify({ browserAskSignedIn: "ja" }) })).status, 400);

  // Forgotten: Chrome no longer sends them.
  await h.api("DELETE", "/api/browser/cookies/localhost");
  await h.app.browser.navigate(project.id, `http://localhost:${port}/?etter`);
  assert.doesNotMatch(seen.at(-1)!, /okt=innlogget-v10/);
});

test("imported before Chrome runs: they wait, go in when it starts, and session cookies come back after a restart", async (t) => {
  fakeKeyring(t);
  const { h, home } = await withHome(t);
  const { port, seen } = await echoServer(t);
  makeChromeProfile(home, [
    { host: "localhost", name: "varig", value: "1" },
    { host: "localhost", name: "okt", value: "2", expires: 0 },
  ]);
  const project = await h.project();
  assert.equal(h.app.browser.running, false);
  await h.api("POST", "/api/browser/cookie-import", { browser: "chrome", profile: "Default", sites: ["localhost"] });
  assert.equal(h.app.browser.running, false, "the import does not start Chrome");
  await h.app.browser.navigate(project.id, `http://localhost:${port}/`);
  assert.match(seen.at(-1)!, /varig=1/);
  assert.match(seen.at(-1)!, /okt=2/);
  const file = path.join(h.app.config.dataDir, "chrome-profile", COOKIE_FILE);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).pending.length, 0, "handed to Chrome and gone from the queue");

  await h.app.browser.close();
  await h.app.browser.navigate(project.id, `http://localhost:${port}/?igjen`);
  assert.match(seen.at(-1)!, /varig=1/, "kept in the profile");
  assert.match(seen.at(-1)!, /okt=2/, "given again");

  // Forgotten while Chrome is closed: taken out when it starts.
  await h.app.browser.close();
  await h.api("DELETE", "/api/browser/cookies");
  await h.app.browser.navigate(project.id, `http://localhost:${port}/?glemt`);
  assert.equal(seen.at(-1), "");
});

test("the default is to ask, and the choices are stored as settings", async (t) => {
  const h = await startHarness(t);
  const { settings } = await h.api("GET", "/api/bootstrap");
  assert.equal(settings.browserAskSignedIn, undefined, "left out means on");
  assert.equal((await h.api("PATCH", "/api/settings", { cookieOffer: "never" })).cookieOffer, "never");
  assert.equal((await h.api("PATCH", "/api/settings", { cookieOffer: null })).cookieOffer, undefined);
  assert.equal((await h.raw("PATCH", "/api/settings", { headers: { "content-type": "application/json" }, body: JSON.stringify({ cookieOffer: "kanskje" }) })).status, 400);
});

test("Økt: environment, context parts, connections and background tasks from real data", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await h.finished(thread.id);

  // A team agent the thread started, and a terminal in the project.
  const child = h.app.store.createThread(project.id, "code", null, { title: "Skriv testene", parentThreadId: thread.id });
  const socket = await h.socket();
  socket.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const opened = await socket.waitFor<{ type: "terminal.opened"; terminalId: string } & any>((m) => m.type === "terminal.opened");

  const info = await h.api<SessionInfo>("GET", `/api/threads/${thread.id}/session`);
  assert.equal(info.environment.kind, "local");
  assert.ok(info.environment.host);
  assert.deepEqual(info.environment.project, { id: project.id, name: project.name, path: project.path, folderMissing: false });
  // The parts the harness builds, with tools and messages; percent agrees with the total.
  const parts = info.context.parts.map((p) => p.id);
  for (const id of ["system", "tools", "messages"]) assert.ok(parts.includes(id as never), id);
  const sum = info.context.parts.reduce((a, p) => a + p.tokens, 0);
  assert.equal(sum, info.context.usedTokens);
  assert.equal(info.context.percent, Math.round((info.context.usedTokens / info.context.contextWindow) * 100));
  assert.ok(info.context.parts.every((p) => p.label && p.tokens > 0));
  // The demo model, and the Browser panel that has not started. No GitHub, no MCP: not there.
  assert.deepEqual(info.connections.map((c) => [c.id, c.status]), [["model", "ok"], ["browser", "off"]]);
  assert.equal(info.connections[0].label, "Demo-modellen");
  // The terminal runs; the agent thread has never run, so it counts as ended.
  assert.deepEqual(info.tasks.map((x) => x.id), [`terminal:${opened.terminalId}`]);
  assert.ok(info.finished.some((x) => x.id === `agent:${child.id}` && x.kind === "agent" && x.title === "Skriv testene"));

  // Stopp ends the terminal, which moves to Avsluttet.
  await h.api("POST", `/api/threads/${thread.id}/session/stop`, { taskId: `terminal:${opened.terminalId}` });
  await until(async () => (await h.api<SessionInfo>("GET", `/api/threads/${thread.id}/session`)).finished.some((x) => x.id === `terminal:${opened.terminalId}`), "the terminal to end");
  assert.equal((await h.raw("POST", `/api/threads/${thread.id}/session/stop`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: "terminal:ukjent" }) })).status, 404);
  // Another thread's tasks are not this thread's to stop.
  const other = await h.thread(project.id);
  assert.equal((await h.raw("POST", `/api/threads/${other.id}/session/stop`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: `agent:${child.id}` }) })).status, 404);

  // Chat has no project, no tools and no browser.
  const chat = await h.thread(null, "chat");
  const chatInfo = await h.api<SessionInfo>("GET", `/api/threads/${chat.id}/session`);
  assert.equal(chatInfo.environment.project, null);
  assert.deepEqual(chatInfo.connections.map((c) => c.id), ["model"]);
  assert.ok(chatInfo.context.parts.some((p) => p.id === "tools" && p.tokens > 0));
});

test("a project whose folder is gone: no new threads, the old ones still read, and it opens again", async (t) => {
  const h = await startHarness(t);
  const dir = tempDir(t, "ad-gone-");
  const project = await h.project(dir);
  const thread = await h.thread(project.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await h.finished(thread.id);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Gammel tråd om sjiraffer" });
  rmSync(dir, { recursive: true, force: true });

  // No new thread, no fork, no message.
  for (const [method, url, body] of [
    ["POST", "/api/threads", { projectId: project.id, mode: "code" }],
    ["POST", `/api/threads/${thread.id}/fork`, {}],
    ["POST", `/api/threads/${thread.id}/messages`, { text: "mer" }],
  ] as const) {
    const res = await h.raw(method, url, { headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(res.status, 409, url);
    assert.match(JSON.parse(res.body).error ?? res.body, /Velg mappen på nytt/);
  }
  // Read, search and everything copy and export use still work.
  assert.equal((await h.api<any>("GET", `/api/projects/${project.id}`)).folderMissing, true);
  const events = await h.events(thread.id);
  assert.ok(ofType(events.map((e) => e.event), "text.delta").length > 0);
  const hits = await h.api<Array<{ threadId?: string; id?: string }>>("GET", "/api/threads/search?q=sjiraffer");
  assert.ok(JSON.stringify(hits).includes(thread.id));
  assert.ok((await h.api<{ threads: Thread[] }>("GET", "/api/bootstrap")).threads.some((x) => x.id === thread.id));
  // Other projects and Chat are not affected.
  assert.ok((await h.thread(null, "chat")).id);

  // The folder is back: new threads again, without a restart.
  mkdirSync(dir, { recursive: true });
  const fresh = await h.thread(project.id);
  assert.equal(fresh.projectId, project.id);
});
