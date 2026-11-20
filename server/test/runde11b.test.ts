// Round 11b (SPEC 25): the one Kode start choice that replaces the two old ones, how the old ones
// move over, and the screenshot Annoter in the Browser panel freezes.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { migrateCodeStart, Store } from "../src/db.ts";
import type { Settings } from "../../shared/protocol.ts";
import { startHarness, tempDir } from "./helpers.ts";

const json = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const base: Settings = { theme: "system", defaultModelId: null, defaultPermissionMode: "ask", autoOpenAgentThreads: true };

test("the old Kode start choices move over: cards is Prosjektboks, greeting is Tekst in Middels", () => {
  assert.equal(migrateCodeStart(base).codeStart, undefined, "nothing stored, the default");
  assert.deepEqual(pick(migrateCodeStart({ ...base, codeStartEmpty: "greeting" })), ["text", "medium"]);
  assert.deepEqual(pick(migrateCodeStart({ ...base, codeStartProject: "greeting" })), ["text", "medium"]);
  assert.deepEqual(pick(migrateCodeStart({ ...base, codeStartEmpty: "cards" })), ["projects", undefined]);
  assert.deepEqual(pick(migrateCodeStart({ ...base, codeStartProject: "cards" })), ["projects", undefined]);
  assert.deepEqual(pick(migrateCodeStart({ ...base, codeStartEmpty: "greeting", codeStartProject: "cards" })), ["projects", undefined], "any cards wins");
  // A new choice is never overwritten by the old ones.
  assert.deepEqual(pick(migrateCodeStart({ ...base, codeStartEmpty: "cards", codeStart: "tokens" })), ["tokens", undefined]);
});

function pick(settings: Settings) {
  return [settings.codeStart, settings.codeStartSize];
}

test("settings saved by an older version are read as the new choice", (t) => {
  const dir = tempDir(t);
  const first = new Store(dir);
  first.updateSettings({ codeStartEmpty: "cards", codeStartProject: "greeting" });
  first.close();
  const store = new Store(dir);
  t.after(() => store.close());
  assert.equal(store.settings().codeStart, "projects");
  // Saving something else keeps it, now as the new setting.
  store.updateSettings({ accent: "green" });
  assert.equal(store.settings().codeStart, "projects");
});

test("codeStart and codeStartSize are settings like the others, and the old fields still work", async (t) => {
  const h = await startHarness(t);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.equal(boot.settings.codeStart, undefined, "Tekst is the default");
  const saved = await h.api("PATCH", "/api/settings", { codeStart: "tokens", codeStartSize: "large" });
  assert.deepEqual([saved.codeStart, saved.codeStartSize], ["tokens", "large"]);
  for (const bad of [{ codeStart: "kort" }, { codeStartSize: "enorm" }, { codeStart: 1 }]) {
    assert.equal((await h.raw("PATCH", "/api/settings", json(bad))).status, 400, JSON.stringify(bad));
  }
  // An old client that sets the old field gets what it stands for.
  assert.equal((await h.api("PATCH", "/api/settings", { codeStartEmpty: "cards" })).codeStart, "projects");
  assert.equal((await h.api("PATCH", "/api/settings", { codeStartEmpty: "greeting" })).codeStart, "text");
  const reset = await h.api("PATCH", "/api/settings", { codeStart: null, codeStartSize: null, codeStartEmpty: null });
  assert.equal(reset.codeStart, undefined);
  assert.equal(reset.codeStartSize, undefined);
});

test("Annoter: a PNG of the tab named, and nothing for an unknown project", async (t) => {
  const site = http.createServer((req, res) => {
    const title = req.url === "/b" ? "Side B" : "Side A";
    res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>${title}</title><body style="margin:0;background:${req.url === "/b" ? "rgb(0,0,200)" : "rgb(200,0,0)"}">`);
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => site.close(() => resolve())));
  const origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  const h = await startHarness(t);
  const project = await h.project();
  const socket = await h.socket();
  socket.send({ type: "browser.open", projectId: project.id, width: 640, height: 400 });
  await socket.waitFor((m) => m.type === "browser.state" && m.projectId === project.id);
  socket.send({ type: "browser.navigate", projectId: project.id, url: `${origin}/`, tabId: "" });
  socket.send({ type: "browser.open", projectId: project.id, width: 640, height: 400, tabId: "t-b" });
  await socket.waitFor((m) => m.type === "browser.state" && m.tabId === "t-b");
  socket.send({ type: "browser.navigate", projectId: project.id, url: `${origin}/b`, tabId: "t-b" });
  await socket.waitFor((m) => m.type === "browser.state" && m.tabId === "t-b" && m.state.title === "Side B");

  await socket.waitFor((m) => m.type === "browser.tabs" && m.tabs.some((tab) => tab.id === "" && tab.title === "Side A"));
  const shot = await h.raw("GET", `/api/browser/screenshot?projectId=${project.id}&tabId=t-b`);
  assert.equal(shot.status, 200);
  assert.equal(shot.headers["content-type"], "image/png");
  assert.equal(shot.headers["cache-control"], "no-store");
  assert.equal(shot.body.slice(1, 4), "PNG");
  // The tab named, not the one the agent would use.
  const first = await h.raw("GET", `/api/browser/screenshot?projectId=${project.id}&tabId=`);
  assert.equal(first.status, 200);
  assert.notEqual(first.body, shot.body, "two tabs, two pictures");

  assert.equal((await h.raw("GET", "/api/browser/screenshot?projectId=finnes-ikke")).status, 404);
  assert.equal((await h.raw("GET", "/api/browser/screenshot")).status, 404);
});
