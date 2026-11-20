// One instance at a time: a second start shows the window that is there and stops itself.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { closeAll, ELECTRON, launch, MAIN, ozoneArgs, sandbox, waitFor, type Running, type Sandbox } from "./helpers.ts";

function secondStart(box: Sandbox): Promise<{ code: number | null; ms: number }> {
  const started = Date.now();
  const child = spawn(ELECTRON, [...ozoneArgs(box), MAIN], { env: box.env, stdio: "ignore" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Den andre starten stoppet ikke av seg selv"));
    }, 20_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - started });
    });
  });
}

test("én instans om gangen: en ny start viser vinduet, også fra statusfeltet", async () => {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe, windowState } = running;
    const serverPid = await probe<number>("probe.serverPid");

    const first = await secondStart(box);
    assert.equal(first.code, 0, "den andre starten avslutter rent");
    assert.equal(await probe<number>("probe.secondInstances"), 1);
    assert.equal(await probe<number>("probe.serverPid"), serverPid, "ingen ny server");

    // In the status area: the window is hidden, and a new start brings it back.
    await page.locator('[data-control="close"]').click();
    await waitFor(async () => !(await windowState()).visible, "skjult i statusfeltet");
    const second = await secondStart(box);
    assert.equal(second.code, 0);
    await waitFor(async () => (await windowState()).visible, "vinduet vises igjen");
    assert.equal(await probe<number>("probe.secondInstances"), 2);
    assert.equal((await windowState()).count, 1, "fortsatt ett vindu");
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
