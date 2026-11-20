// The app and the localhost server never write to the same data folder at once (SPEC 29.1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { alive, closeAll, killKnown, launch, sandbox, startLocalhost, waitFor, type Running } from "./helpers.ts";

test("når localhost-serveren bruker datamappen, sier appen det tydelig og venter", async () => {
  const box = sandbox();
  let running: Running | undefined;
  let localhost: Awaited<ReturnType<typeof startLocalhost>> | undefined;
  try {
    localhost = await startLocalhost(box);
    running = await launch(box, { waitForUi: false });
    const { page, probe } = running;
    const card = page.getByTestId("busy-page");
    await card.waitFor({ timeout: 20_000 });
    assert.equal(await page.locator("h1").innerText(), "Agentic Desktop kjører allerede i nettleseren");
    const text = await card.innerText();
    assert.ok(text.includes(box.dataDir), "mappen står der");
    assert.ok(text.includes(`port ${localhost.port}`), "porten står der");
    assert.equal(await probe<number>("probe.serverPid"), 0, "appen har ikke startet sin egen server");

    // Stopped in its terminal; Prøv igjen starts the app's own.
    const exited = new Promise((resolve) => localhost!.child.once("exit", resolve));
    killKnown(localhost.child.pid!, /server\/src\/index\.ts/, "SIGTERM");
    await exited;
    localhost = undefined;
    await page.getByRole("button", { name: "Prøv igjen" }).click();
    await page.locator(".topbar .window-controls[data-shell]").waitFor({ timeout: 30_000 });
    assert.ok(alive(await probe<number>("probe.serverPid")));
  } finally {
    if (localhost?.child.pid && alive(localhost.child.pid)) killKnown(localhost.child.pid, /server\/src\/index\.ts/);
    await closeAll(running);
    box.cleanup();
  }
});

test("knappen på siden avslutter nettleserversjonen pent og åpner appen", async () => {
  const box = sandbox();
  let running: Running | undefined;
  let localhost: Awaited<ReturnType<typeof startLocalhost>> | undefined;
  try {
    localhost = await startLocalhost(box);
    assert.notEqual(localhost.port, 4317);
    let out = "";
    localhost.child.stdout!.on("data", (chunk) => (out += chunk));
    const exited = new Promise<number | null>((resolve) => localhost!.child.once("exit", (code) => resolve(code)));
    running = await launch(box, { waitForUi: false });
    const { page, probe } = running;
    await page.getByTestId("busy-page").waitFor({ timeout: 20_000 });
    const stop = page.getByRole("button", { name: "Avslutt nettleserversjonen og åpne appen" });
    assert.ok(await stop.evaluate((el) => el.classList.contains("primary") && document.activeElement === el), "hovedknappen, med fokus");
    assert.ok(!(await page.getByRole("button", { name: "Prøv igjen" }).evaluate((el) => el.classList.contains("primary"))));
    await stop.click();
    // It stops the way Ctrl+C does (exit code 0), and the app starts its own server.
    assert.equal(await exited, 0);
    localhost = undefined;
    assert.match(out, /Agentic Desktop-appen ba nettleserversjonen avslutte/);
    await page.locator(".topbar .window-controls[data-shell]").waitFor({ timeout: 30_000 });
    assert.ok(alive(await probe<number>("probe.serverPid")));
    assert.equal(JSON.parse(readFileSync(path.join(box.dataDir, "instance.json"), "utf8")).shell, "electron");
  } finally {
    if (localhost?.child.pid && alive(localhost.child.pid)) killKnown(localhost.child.pid, /server\/src\/index\.ts/);
    await closeAll(running);
    box.cleanup();
  }
});

test("localhost-serveren starter ikke mot en datamappe appen bruker", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    await assert.rejects(startLocalhost(box), /stoppet med kode 1/);
    await waitFor(async () => alive(await running!.probe<number>("probe.serverPid")), "appens server kjører fortsatt");
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
