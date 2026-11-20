// The packaged app in dist-desktop/linux-unpacked starts, serves the UI and stops everything again.
// The package has the Node inspector switched off (electronFuses), so Playwright cannot attach; the
// app is started as a normal process and followed by its output and its PIDs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { alive, assertOffScreen, commandOf, descendants, PACKAGED, sandbox, waitFor } from "./helpers.ts";

test("den pakkede appen fra dist-desktop starter og stopper", { skip: existsSync(PACKAGED) ? false : "dist-desktop/linux-unpacked mangler; kjør npm run dist først" }, async () => {
  assertOffScreen();
  const box = sandbox();
  const env = { ...box.env };
  delete env.AD_WEB_DIST; // the package's own web/dist
  const child = spawn(PACKAGED, ["--ozone-platform=headless", "--ozone-override-screen-size=1600,1000"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout!.on("data", (chunk) => (out += chunk));
  child.stderr!.on("data", (chunk) => (out += chunk));
  const pid = child.pid!;
  try {
    await waitFor(() => out.includes("Agentic Desktop er klar."), `grensesnittet er lastet:\n${out.slice(-2000)}`, 60_000);
    const instance = JSON.parse(readFileSync(path.join(box.dataDir, "instance.json"), "utf8"));
    assert.equal(instance.shell, "electron");
    const tree = descendants(pid);
    assert.ok(tree.includes(instance.pid), "serveren er under appen");
    assert.match(commandOf(instance.pid), /linux-unpacked\/agentic-desktop-bin --type=utility/);

    // The UI from the package's own web/dist, and the server's own files.
    const index = await fetch(`http://127.0.0.1:${instance.port}/`, { headers: { host: `127.0.0.1:${instance.port}` } });
    assert.equal(index.status, 200);
    assert.match(await index.text(), /<div id="app"|<script type="module"/);
    assert.ok(existsSync(path.join(path.dirname(PACKAGED), "resources/app-root/server/node_modules/node-pty/build/Release/pty.node")));
    // Hardened: the package does not run as plain Node.
    assert.ok(!out.includes("ELECTRON_RUN_AS_NODE"));

    const exited = new Promise((resolve) => child.once("exit", resolve));
    process.kill(pid, "SIGTERM");
    await exited;
    const all = [pid, ...tree];
    await waitFor(() => all.every((p) => !alive(p)), "alt er stoppet", 15_000);
  } finally {
    if (alive(pid)) process.kill(pid, "SIGKILL");
    box.cleanup();
  }
});

test("pakken kan ikke kjøres som Node (ELECTRON_RUN_AS_NODE er slått av)", { skip: existsSync(PACKAGED) ? false : "dist-desktop/linux-unpacked mangler" }, async () => {
  assertOffScreen();
  const box = sandbox();
  const child = spawn(PACKAGED, ["-e", "console.log('node-modus')", "--ozone-platform=headless"], { env: { ...box.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout!.on("data", (chunk) => (out += chunk));
  try {
    // Without the fuse it would print and exit at once. With it, it starts as the app; stop it.
    await waitFor(() => out.includes("Agentic Desktop er klar.") || out.includes("node-modus"), "starten", 60_000);
    assert.ok(!out.includes("node-modus"));
  } finally {
    const all = [child.pid!, ...descendants(child.pid!)];
    const exited = new Promise((resolve) => child.once("exit", resolve));
    process.kill(child.pid!, "SIGTERM");
    await exited;
    await waitFor(() => all.every((p) => !alive(p)), "alt er stoppet", 15_000);
    box.cleanup();
  }
});
