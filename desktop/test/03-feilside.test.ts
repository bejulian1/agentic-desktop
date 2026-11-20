// When the server crashes, the window shows a clear page with «Start på nytt», what the server had
// started is stopped, and a new server takes over (SPEC 29.1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { alive, closeAll, killKnown, launch, sandbox, terminalWithChild, waitFor, type Running } from "./helpers.ts";

test("feilsiden etter at serveren er drept, og Start på nytt", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe } = running;
    const serverPid = await probe<number>("probe.serverPid");
    const { shell, sleep } = await terminalWithChild(running, 4244);
    await waitFor(async () => (await probe<Array<{ pid: number }>>("probe.tree")).some((p) => p.pid === sleep), "treet er notert");

    killKnown(serverPid, /--type=utility.*Agentic Desktop-server|--type=utility/);
    const card = page.getByTestId("error-page");
    await card.waitFor({ timeout: 15_000 });
    assert.equal(await page.locator("h1").innerText(), "Serveren i Agentic Desktop stoppet");
    assert.match(await card.innerText(), /Trådene og innstillingene dine er lagret/);
    const restart = page.getByRole("button", { name: "Start på nytt" });
    assert.ok(await restart.evaluate((el) => el === document.activeElement), "Start på nytt har fokus");
    assert.match((await page.getByTestId("error-page").locator("details pre").textContent()) ?? "", /Avslutningskode: 9|Avslutningskode/, "detaljene har koden");
    // The window controls are there on the error page too, and the top bar moves the window.
    assert.equal(await page.locator(".window-controls button").count(), 3);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".topbar")!).getPropertyValue("-webkit-app-region")), "drag");
    // What the crashed server started is stopped by the PIDs noted.
    await waitFor(() => !alive(shell) && !alive(sleep), "skallet og sleep er stoppet", 10_000);

    await restart.click();
    await page.locator(".topbar .window-controls[data-shell]").waitFor({ timeout: 30_000 });
    const next = await probe<number>("probe.serverPid");
    assert.ok(next > 0 && next !== serverPid && alive(next), "en ny server kjører");
    assert.equal(await probe<number>("probe.serverStarts"), 2);
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
