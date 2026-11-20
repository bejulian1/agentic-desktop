// Round 14 (SPEC 30.1): the real keyring helper (Python and libsecret) against a real
// gnome-keyring-daemon, on a private session bus made by dbus-run-session, with a temporary HOME,
// XDG_DATA_HOME and XDG_RUNTIME_DIR. The bus has no service files, so nothing can be started on it
// by D-Bus activation, and DISPLAY and WAYLAND_DISPLAY are removed, so no prompt can reach the
// screen. The user's own keyring and session bus are never touched (keyring/run.sh and
// keyring/probe.ts check the bus address again before doing anything).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const HERE = path.join(import.meta.dirname, "keyring");

function available(): string | null {
  for (const tool of ["dbus-run-session", "gnome-keyring-daemon", "gdbus", "python3"]) {
    if (spawnSync("sh", ["-c", `command -v ${tool}`]).status !== 0) return `${tool} mangler`;
  }
  const gi = spawnSync("python3", ["-I", "-c", "import gi; gi.require_version('Secret', '1'); from gi.repository import Secret"]);
  return gi.status === 0 ? null : "python3-gi med Secret-1 mangler";
}

const missing = available();

test("30.1: hjelperen lagrer, leser og flytter nøkler i en ekte nøkkelring på en privat buss", { skip: missing ?? false, timeout: 90_000 }, async (t) => {
  // Short paths: the daemon's control socket must fit in 108 bytes.
  const root = mkdtempSync("/tmp/ad-kr-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "h");
  const runtime = path.join(root, "r");
  mkdirSync(home);
  mkdirSync(runtime);
  chmodSync(runtime, 0o700);
  const busConfig = path.join(root, "bus.conf");
  writeFileSync(
    busConfig,
    `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=${root}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>
`,
  );
  const env: Record<string, string> = {};
  for (const name of ["PATH", "LANG"]) if (process.env[name]) env[name] = process.env[name]!;
  Object.assign(env, {
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_RUNTIME_DIR: runtime,
    TMPDIR: "/tmp",
    OUTER_BUS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "ingen",
    NODE: process.execPath,
    PROBE: path.join(HERE, "probe.ts"),
    KEYRING_PASSWORD: "testpassord-runde14",
  });
  // No DBUS_SESSION_BUS_ADDRESS, DISPLAY or WAYLAND_DISPLAY from here: dbus-run-session sets the
  // first to its own bus.
  const child = spawn("dbus-run-session", [`--config-file=${busConfig}`, "--", "bash", path.join(HERE, "run.sh")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (out += chunk));
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, out);
  assert.match(out, /OK none/);
  assert.match(out, /OK full/);
  assert.match(out, /OK locked/);
});
