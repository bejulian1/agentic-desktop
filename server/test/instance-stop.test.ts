// SPEC 29.1: the Electron app may ask a localhost server that holds its data folder to stop, with the
// stop key from that folder's instance.json. Only temporary servers on random ports, never 4317.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readInstance, readStopKey } from "../src/instance.ts";
import { rawRequest, startHarness } from "./helpers.ts";

const STOP = "/api/instance/stop";

test("instance.json har en stoppnøkkel med mode 0600, og bare den stopper serveren", async (t) => {
  let asked = 0;
  const { app } = await startHarness(t, { onStopRequest: () => void (asked += 1) });
  const dataDir = app.config.dataDir;
  const file = path.join(dataDir, "instance.json");
  assert.notEqual(app.port, 4317);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const key = readStopKey(dataDir)!;
  assert.ok(key && key.length >= 40, "nøkkelen er lang nok");
  assert.equal(readInstance(dataDir)?.shell, "localhost");
  assert.ok(!JSON.stringify(readInstance(dataDir)).includes(key), "readInstance gir aldri nøkkelen videre");

  // Wrong key, no key, a key of the right length but wrong, a GET, and a request from a web page.
  assert.equal((await rawRequest(app.port, "POST", STOP)).status, 403);
  assert.equal((await rawRequest(app.port, "POST", STOP, { headers: { "x-agentic-stop-key": "feil" } })).status, 403);
  assert.equal((await rawRequest(app.port, "POST", STOP, { headers: { "x-agentic-stop-key": "x".repeat(key.length) } })).status, 403);
  assert.equal((await rawRequest(app.port, "GET", STOP, { headers: { "x-agentic-stop-key": key } })).status, 405);
  assert.equal((await rawRequest(app.port, "POST", STOP, { headers: { "x-agentic-stop-key": key, origin: `http://127.0.0.1:${app.port}` } })).status, 403);
  assert.equal((await rawRequest(app.port, "POST", STOP, { headers: { "x-agentic-stop-key": key, host: "evil.example" } })).status, 403);
  assert.equal(asked, 0);

  const ok = await rawRequest(app.port, "POST", STOP, { headers: { "x-agentic-stop-key": key } });
  assert.equal(ok.status, 202);
  assert.deepEqual(JSON.parse(ok.body), { ok: true, pid: process.pid });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked, 1);
  // A second ask does not stop it twice.
  await rawRequest(app.port, "POST", STOP, { headers: { "x-agentic-stop-key": key } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked, 1);
  assert.ok(readFileSync(file, "utf8").includes(key));
});

test("en server fra en annen datamappe kan ikke stoppes med denne mappens nøkkel", async (t) => {
  let askedA = 0;
  let askedB = 0;
  const a = await startHarness(t, { onStopRequest: () => void (askedA += 1) });
  const b = await startHarness(t, { onStopRequest: () => void (askedB += 1) });
  const keyA = readStopKey(a.app.config.dataDir)!;
  assert.notEqual(keyA, readStopKey(b.app.config.dataDir));
  assert.equal((await rawRequest(b.app.port, "POST", STOP, { headers: { "x-agentic-stop-key": keyA } })).status, 403);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(askedB, 0);
  assert.equal(askedA, 0);
});

test("uten onStopRequest (Electron-appens server og testene) finnes verken nøkkel eller endepunkt", async (t) => {
  const { app } = await startHarness(t);
  assert.equal(readStopKey(app.config.dataDir), null);
  assert.equal((await rawRequest(app.port, "POST", STOP, { headers: { "x-agentic-stop-key": "x".repeat(43) } })).status, 404);
});
