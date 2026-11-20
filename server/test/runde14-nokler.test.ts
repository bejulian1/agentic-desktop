// Round 14 (SPEC 30.1): API keys in the keyring, never in plain text. These run against a keyring
// in memory (MemoryKeyring); runde14-secret-service.test.ts runs the real helper against a private
// gnome-keyring-daemon on a private session bus.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { defaultKeyring, MemoryKeyring } from "../src/keyring.ts";
import { Secrets } from "../src/secrets.ts";
import { startHarness, tempDir } from "./helpers.ts";

// Every file under the data dir that holds the text, so a key in plain text anywhere is caught.
function filesWith(dir: string, text: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (statSync(file).size > 20_000_000) continue;
    if (readFileSync(file).includes(text)) found.push(file);
  }
  return found;
}

test("30.1: en ny nøkkel havner i nøkkelringen og ingen andre steder på disken", async (t) => {
  const h = await startHarness(t);
  const keyring = h.keyring as MemoryKeyring;
  assert.deepEqual((await h.api("GET", "/api/bootstrap")).keyring, { store: "keyring", legacy: null });

  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-runde14-hemmelig" });
  assert.equal(provider.hasKey, true);
  assert.deepEqual(keyring.items.get(provider.id), { label: "Agentic Desktop: API-nøkkel for Lokal", secret: "sk-runde14-hemmelig" });
  assert.equal(existsSync(path.join(h.app.config.dataDir, "keys.json")), false);
  assert.deepEqual(filesWith(h.app.config.dataDir, "sk-runde14-hemmelig"), [], "ingen fil i datamappen har nøkkelen");

  // Never back to the browser, never to a child process.
  for (const url of ["/api/bootstrap", "/api/keyring", "/api/providers"]) {
    const res = await h.raw("GET", url);
    assert.ok(!res.body.includes("sk-runde14-hemmelig"), url);
  }
  assert.ok(!Object.values(h.app.childEnv()).includes("sk-runde14-hemmelig"));

  // A new key replaces the old one; an empty one removes it.
  await h.api("PATCH", `/api/providers/${provider.id}`, { apiKey: "sk-ny" });
  assert.equal(keyring.items.get(provider.id)?.secret, "sk-ny");
  await h.api("PATCH", `/api/providers/${provider.id}`, { apiKey: "" });
  assert.equal(keyring.items.has(provider.id), false);
  await h.api("PATCH", `/api/providers/${provider.id}`, { apiKey: "sk-tredje" });
  await h.api("DELETE", `/api/providers/${provider.id}`);
  assert.equal(keyring.items.size, 0, "en leverandør som kobles fra, tar nøkkelen med seg");
});

test("30.1: nøklene overlever en omstart gjennom nøkkelringen", async (t) => {
  const dataDir = tempDir(t, "ad-data-");
  const keyring = new MemoryKeyring();
  let providerId = "";
  {
    const h = await startHarness(t, { dataDir, keyring });
    providerId = (await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-vedvarer" })).id;
    await h.app.close();
  }
  const h = await startHarness(t, { dataDir, keyring });
  const providers = (await h.api("GET", "/api/bootstrap")).providers;
  assert.equal(providers.find((p: any) => p.id === providerId).hasKey, true);
});

test("30.1: keys.json flyttes inn i nøkkelringen og slettes først når alt er lest tilbake", async (t) => {
  const dataDir = tempDir(t, "ad-data-");
  writeFileSync(path.join(dataDir, "keys.json"), JSON.stringify({ "p-en": "sk-en", "integration:github": "ghp_gammel" }), { mode: 0o600 });
  const keyring = new MemoryKeyring();
  keyring.items.set("p-to", { label: "fra før", secret: "sk-to" });
  const h = await startHarness(t, { dataDir, keyring });
  assert.equal(existsSync(path.join(dataDir, "keys.json")), false, "fila er slettet");
  assert.deepEqual(Object.fromEntries([...keyring.items].map(([k, v]) => [k, v.secret])), { "p-to": "sk-to", "p-en": "sk-en", "integration:github": "ghp_gammel" });
  assert.equal(keyring.items.get("integration:github")?.label, "Agentic Desktop: GitHub-token");
  assert.deepEqual((await h.api("GET", "/api/keyring")), { store: "keyring", legacy: null });
});

test("30.1: går flyttingen galt, blir keys.json stående og nøklene brukes fortsatt", async (t) => {
  // Read back wrong: the file stays, and Innstillinger is told why.
  {
    const dataDir = tempDir(t, "ad-data-");
    writeFileSync(path.join(dataDir, "keys.json"), JSON.stringify({ "p-en": "sk-en" }), { mode: 0o600 });
    const keyring = new MemoryKeyring();
    keyring.corrupt = true;
    const h = await startHarness(t, { dataDir, keyring });
    assert.equal(existsSync(path.join(dataDir, "keys.json")), true);
    assert.deepEqual(await h.api("GET", "/api/keyring"), { store: "session", reason: "error", legacy: { reason: "readback" } });
  }
  // No keyring at all: the keys from the file are used, a new one is only in memory, and a removed
  // one goes from the file too, so it never comes back.
  const dataDir = tempDir(t, "ad-data-");
  const file = path.join(dataDir, "keys.json");
  const keyring = new MemoryKeyring();
  keyring.failure = "no-service";
  const first = await startHarness(t, { dataDir, keyring });
  const provider = await first.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal", baseUrl: "http://127.0.0.1:9/v1" });
  await first.app.close();
  writeFileSync(file, JSON.stringify({ [provider.id]: "sk-fra-fila", "p-annen": "sk-annen" }), { mode: 0o600 });

  const h = await startHarness(t, { dataDir, keyring });
  assert.deepEqual(await h.api("GET", "/api/keyring"), { store: "session", reason: "no-service", legacy: { reason: "no-service" } });
  assert.equal((await h.api("GET", "/api/bootstrap")).providers.find((p: any) => p.id === provider.id).hasKey, true, "nøkkelen fra fila virker");
  await h.api("PATCH", `/api/providers/${provider.id}`, { apiKey: "sk-bare-i-minnet" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "p-annen": "sk-annen" }, "den gamle verdien er tatt ut av fila, og den nye er aldri skrevet");
  assert.deepEqual(filesWith(dataDir, "sk-bare-i-minnet"), []);

  // The keyring comes back (unlocked): Prøv igjen moves everything into it and deletes the file.
  keyring.failure = null;
  const status = await h.api("POST", "/api/keyring/retry");
  assert.deepEqual(status, { store: "keyring", legacy: null });
  assert.equal(existsSync(file), false);
  assert.equal(keyring.items.get(provider.id)?.secret, "sk-bare-i-minnet");
  assert.equal(keyring.items.get("p-annen")?.secret, "sk-annen");
});

test("30.1: uten nøkkelring gjelder nøkkelen bare til appen lukkes", async (t) => {
  const dataDir = tempDir(t, "ad-data-");
  const keyring = new MemoryKeyring();
  keyring.failure = "locked";
  let id = "";
  {
    const h = await startHarness(t, { dataDir, keyring });
    const socket = await h.socket();
    assert.deepEqual((await h.api("GET", "/api/bootstrap")).keyring, { store: "session", reason: "locked", legacy: null });
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-okt" });
    id = provider.id;
    assert.equal(provider.hasKey, true, "nøkkelen virker i økta");
    assert.deepEqual(filesWith(dataDir, "sk-okt"), [], "og ligger ikke i klartekst noe sted");
    // Still locked: Prøv igjen says so, and the key is still there for the session.
    assert.equal((await h.api("POST", "/api/keyring/retry")).reason, "locked");
    assert.equal((await h.api("GET", "/api/bootstrap")).providers.find((p: any) => p.id === id).hasKey, true);
    socket.close();
    await h.app.close();
  }
  const h = await startHarness(t, { dataDir, keyring });
  assert.equal((await h.api("GET", "/api/bootstrap")).providers.find((p: any) => p.id === id).hasKey, false, "borte etter omstart");
});

test("30.1: et nøkkelring-skifte sendes til alle vinduer", async (t) => {
  const keyring = new MemoryKeyring();
  keyring.failure = "locked";
  const h = await startHarness(t, { keyring });
  const socket = await h.socket();
  keyring.failure = null;
  await h.api("POST", "/api/keyring/retry");
  const message = await socket.waitFor((m) => m.type === "keyring.changed");
  assert.deepEqual((message as any).keyring, { store: "keyring", legacy: null });
});

test("30.1: en ødelagt keys.json røres ikke", async (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, "keys.json"), "{ ikke json", { mode: 0o600 });
  const secrets = new Secrets(dir, new MemoryKeyring());
  assert.deepEqual(await secrets.load(), { store: "keyring", legacy: { reason: "unreadable" } });
  assert.equal(readFileSync(path.join(dir, "keys.json"), "utf8"), "{ ikke json");
});

test("30.1: skrivinger til nøkkelringen skjer i rekkefølge", async (t) => {
  const keyring = new MemoryKeyring();
  const secrets = new Secrets(tempDir(t), keyring);
  await secrets.load();
  const writes = [secrets.set("a", "1"), secrets.set("a", "2"), secrets.set("b", "3"), secrets.set("a", null)];
  assert.equal(secrets.get("a"), undefined, "minnet er oppdatert med en gang");
  await Promise.all(writes);
  assert.deepEqual([...keyring.items.keys()], ["b"]);
});

test("30.1: under node --test velges aldri den ekte nøkkelringen av seg selv", () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, "kjører under node --test");
  assert.equal(defaultKeyring({ NODE_TEST_CONTEXT: "child-v8" }).kind, "memory");
  assert.equal(defaultKeyring({ AD_KEYRING: "none" }).kind, "none");
  assert.equal(defaultKeyring({}).kind, "secret-service");
});
