// When the app closes, the server and everything it started stop: terminals, their children and the
// rest. Checked by PID (SPEC 29.1 Livsløp).
import assert from "node:assert/strict";
import { test } from "node:test";
import { alive, closeAll, commandOf, descendants, launch, sandbox, terminalWithChild, waitFor, type Running } from "./helpers.ts";

test("Lukk uten statusfelt avslutter, og serveren og alle barneprosessene stopper", async () => {
  const box = sandbox({ tray: "off" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe, mainPid } = running;
    const serverPid = await probe<number>("probe.serverPid");
    const { shell, sleep } = await terminalWithChild(running);
    const all = [mainPid, ...descendants(mainPid)];
    assert.ok(all.includes(serverPid) && all.includes(shell) && all.includes(sleep), "serveren, skallet og sleep er under appen");
    assert.match(commandOf(shell), /bash|sh/);
    // The server noted the shell and its child, so they can be stopped even if it crashes.
    await waitFor(async () => (await probe<Array<{ pid: number }>>("probe.tree")).some((p) => p.pid === sleep), "treet er notert");

    const exited = new Promise<void>((resolve) => running!.app.process().once("exit", () => resolve()));
    await page.locator('[data-control="close"]').click();
    await exited;
    await waitFor(() => all.every((pid) => !alive(pid)), `alle stoppet: ${all.filter(alive).map((pid) => `${pid} ${commandOf(pid)}`).join(", ")}`, 15_000);
    running = undefined;
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("SIGTERM til appen (som ved utlogging) stopper også alt", async () => {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { mainPid } = running;
    await terminalWithChild(running, 4243);
    const all = [mainPid, ...descendants(mainPid)];
    const exited = new Promise<void>((resolve) => running!.app.process().once("exit", () => resolve()));
    process.kill(mainPid, "SIGTERM");
    await exited;
    await waitFor(() => all.every((pid) => !alive(pid)), `alle stoppet: ${all.filter(alive).map((pid) => `${pid} ${commandOf(pid)}`).join(", ")}`, 15_000);
    running = undefined;
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
