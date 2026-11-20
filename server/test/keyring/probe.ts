// Run by runde14-secret-service.test.ts inside a private session bus (dbus-run-session) with its own
// gnome-keyring-daemon in a temporary HOME. It refuses to do anything on the user's own bus.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KeyringError, SecretServiceKeyring } from "../../src/keyring.ts";
import { Secrets } from "../../src/secrets.ts";

const bus = process.env.DBUS_SESSION_BUS_ADDRESS ?? "";
if (!bus || bus === process.env.OUTER_BUS || bus.includes("/run/user/") || !process.env.HOME?.startsWith(tmpdir())) {
  console.error("Ikke en privat buss eller midlertidig HOME. Avbryter.");
  process.exit(3);
}

const mode = process.argv[2];
const keyring = new SecretServiceKeyring({ timeoutMs: 20_000 });
const failure = async () => {
  try {
    await keyring.load();
    return "ok";
  } catch (err) {
    return err instanceof KeyringError ? err.code : `annet: ${(err as Error).message}`;
  }
};

if (mode === "none") {
  assert.equal(await failure(), "no-service");
} else if (mode === "full") {
  assert.deepEqual(await keyring.load(), {}, "tom nøkkelring i starten");
  const dir = mkdtempSync(path.join(tmpdir(), "ad-kr-data-"));
  writeFileSync(path.join(dir, "keys.json"), JSON.stringify({ p1: "sk-æøå-🔑-1", "integration:github": "ghp_gammelt" }), { mode: 0o600 });
  const secrets = new Secrets(dir, keyring, (id) => `Agentic Desktop: ${id}`);
  assert.deepEqual(await secrets.load(), { store: "keyring", legacy: null });
  assert.equal(existsSync(path.join(dir, "keys.json")), false, "keys.json er slettet etter flyttingen");
  assert.deepEqual(await new SecretServiceKeyring().load(), { p1: "sk-æøå-🔑-1", "integration:github": "ghp_gammelt" }, "en ny prosess leser de samme nøklene");
  await secrets.set("p1", "sk-ny");
  await secrets.set("integration:github", null);
  assert.deepEqual(await keyring.load(), { p1: "sk-ny" });
  // The keyring is a file in the temporary HOME, encrypted: the key is not in it as text.
  const file = path.join(process.env.XDG_DATA_HOME!, "keyrings/login.keyring");
  assert.ok(existsSync(file), file);
  const { readFileSync } = await import("node:fs");
  assert.ok(!readFileSync(file).includes("sk-ny"), "nøkkelen står ikke i klartekst i nøkkelringfila");
} else if (mode === "locked") {
  assert.equal(await failure(), "locked");
  const secrets = new Secrets(mkdtempSync(path.join(tmpdir(), "ad-kr-data-")), keyring);
  assert.deepEqual(await secrets.load(), { store: "session", reason: "locked", legacy: null });
  await secrets.set("p2", "sk-bare-i-okta");
  assert.equal(secrets.get("p2"), "sk-bare-i-okta");
} else {
  process.exit(2);
}
console.log(`OK ${mode}`);
