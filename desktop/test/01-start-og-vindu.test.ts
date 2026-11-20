// The app starts, the server runs in its own process, the UI loads, and the window controls work
// with the mouse and the keyboard (SPEC 29.1 and 29.4).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { alive, apiCall, closeAll, commandOf, launch, sandbox, sandboxWorks, waitFor, type Running } from "./helpers.ts";

test("appen starter, serveren kjører i egen prosess, og grensesnittet lastes", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe, mainPid } = running;
    const serverPid = await probe<number>("probe.serverPid");
    assert.ok(serverPid > 0 && serverPid !== mainPid, "serveren har sin egen PID");
    assert.ok(alive(serverPid));
    assert.match(commandOf(serverPid), /--type=utility/, "serveren er en utilityProcess");

    const instance = JSON.parse(readFileSync(path.join(box.dataDir, "instance.json"), "utf8"));
    assert.equal(instance.pid, serverPid);
    assert.equal(instance.shell, "electron");
    assert.ok(![4317, 4318].includes(instance.port), "aldri brukerens porter");
    const url = new URL(page.url());
    assert.equal(url.origin, `http://127.0.0.1:${instance.port}`);
    assert.equal(url.hash, "", "tokenet er byttet mot en økt og fjernet fra adressen");
    assert.ok(existsSync(path.join(box.dataDir, "electron")), "Electrons egne filer ligger i datamappen");

    // The renderer has no Node and only the named bridge.
    const renderer = await page.evaluate(() => ({
      require: typeof (window as any).require,
      process: typeof (window as any).process,
      bridge: Object.keys((window as any).agenticDesktop ?? {}).sort(),
      shell: document.documentElement.dataset.shell,
    }));
    assert.equal(renderer.require, "undefined");
    assert.equal(renderer.process, "undefined");
    assert.equal(renderer.shell, "electron");
    assert.deepEqual(renderer.bridge, ["appIcon", "browserPanel", "closeBehavior", "onCommand", "pickFolder", "quit", "reportActivity", "restartServer", "sandbox", "shell", "stopOtherServer", "window"]);
    // With Chromium's sandbox, as the app runs when the machine allows it (SPEC 29.2): the renderer
    // has the seccomp filter on.
    if (sandboxWorks) {
      const rendererPid = await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getOSProcessId());
      assert.match(readFileSync(`/proc/${rendererPid}/status`, "utf8"), /^Seccomp:\s+2$/m, "rendereren er i sandkassen");
      assert.equal((await probe<{ on: boolean }>("probe.sandbox")).on, true);
    }
    assert.ok(Array.isArray(await apiCall(page, "GET", "/api/servers")), "API-et svarer");

    // The top bar moves the window; its buttons do not.
    const regions = await page.evaluate(() => ({
      bar: getComputedStyle(document.querySelector(".topbar")!).getPropertyValue("-webkit-app-region"),
      button: getComputedStyle(document.querySelector(".topbar button")!).getPropertyValue("-webkit-app-region"),
      controls: getComputedStyle(document.querySelector('[data-control="close"]')!).getPropertyValue("-webkit-app-region"),
    }));
    assert.deepEqual(regions, { bar: "drag", button: "no-drag", controls: "no-drag" });
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("lenker til nettsider går til systemets nettleser, og vinduet blir på appen", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, windowState } = running;
    const origin = new URL(page.url()).origin;
    await page.evaluate(() => {
      location.href = "https://example.com/navigert";
    });
    await page.waitForTimeout(500);
    assert.equal(new URL(page.url()).origin, origin, "navigeringen ble stoppet");
    const opened = await page.evaluate(() => window.open("https://example.org/nytt-vindu") === null);
    assert.ok(opened, "window.open til en nettside gir ikke noe vindu");
    await page.evaluate(() => window.open("file:///etc/passwd"));
    await waitFor(() => existsSync(box.externalLog) && readFileSync(box.externalLog, "utf8").includes("example.org"), "lenken er sendt videre");
    const sent = readFileSync(box.externalLog, "utf8").trim().split("\n");
    assert.deepEqual(sent, ["https://example.com/navigert", "https://example.org/nytt-vindu"], "bare http og https går ut, file: gjør ikke");
    assert.equal((await windowState()).count, 1);
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("vinduskontrollene: minimer, maksimer og gjenopprett, med tips og tastatur", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, app, windowState } = running;
    const controls = page.getByTestId("window-controls");
    assert.equal(await controls.getAttribute("role"), "group");
    assert.equal(await controls.getAttribute("aria-label"), "Vindu");
    const buttons = controls.locator("button");
    assert.deepEqual(await buttons.evaluateAll((els) => els.map((el) => [el.getAttribute("aria-label"), el.getAttribute("title")])), [
      ["Minimer", "Minimer"],
      ["Maksimer", "Maksimer"],
      ["Lukk", "Lukk"],
    ]);
    // They are the last thing in the top bar, at its right edge.
    const edge = await page.evaluate(() => {
      const bar = document.querySelector(".topbar")!.getBoundingClientRect();
      const close = document.querySelector('[data-control="close"]')!.getBoundingClientRect();
      return Math.round(bar.right - close.right);
    });
    assert.ok(edge >= 0 && edge <= 12, `Lukk står ved høyre kant (${edge} px)`);

    // The app's tooltip card needs a pointer that can hover; headless Ozone has none, so the card is
    // checked in 05-statusfelt (xvfb). Here: the title it is made from.
    const maximize = page.locator('[data-control="maximize"]');

    await maximize.click();
    await waitFor(async () => (await windowState()).maximized, "maksimert");
    await waitFor(async () => (await maximize.getAttribute("aria-label")) === "Gjenopprett", "knappen heter Gjenopprett");
    await maximize.click();
    await waitFor(async () => !(await windowState()).maximized, "gjenopprettet");
    await waitFor(async () => (await maximize.getAttribute("aria-label")) === "Maksimer", "knappen heter Maksimer igjen");

    // Keyboard: Tab from Minimer to Maksimer, Enter and Space press it.
    await page.locator('[data-control="minimize"]').focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.control), "maximize");
    await page.keyboard.press("Enter");
    await waitFor(async () => (await windowState()).maximized, "maksimert med Enter");
    await page.keyboard.press("Space");
    await waitFor(async () => !(await windowState()).maximized, "gjenopprettet med mellomrom");
    // A visible focus ring.
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle), "none");

    // Maximized from outside (a double click in GNOME) is shown on the button too.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await waitFor(async () => (await maximize.getAttribute("aria-label")) === "Gjenopprett", "følger vinduets tilstand");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());

    await page.locator('[data-control="minimize"]').click();
    await waitFor(async () => (await windowState()).minimized, "minimert");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await waitFor(async () => !(await windowState()).minimized, "tilbake");
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("vindusstørrelsen og porten huskes til neste start", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1040, height: 700 }));
    const port = new URL(running.page.url()).port;
    await running.page.waitForTimeout(700);
    await closeAll(running);
    const saved = JSON.parse(readFileSync(path.join(box.dataDir, "electron/desktop-state.json"), "utf8"));
    assert.equal(saved.bounds.width, 1040);
    assert.equal(saved.bounds.height, 700);
    assert.equal(String(saved.port), port);

    running = await launch(box);
    const bounds = await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.equal(bounds.width, 1040);
    assert.equal(bounds.height, 700);
    assert.equal(new URL(running.page.url()).port, port, "samme port, så utseendet i localStorage følger med");
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
