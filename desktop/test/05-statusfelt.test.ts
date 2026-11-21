// The status area (SPEC 29.6). There is no status area under xvfb, so AD_DESKTOP_TRAY=on stands in
// for the AppIndicator extension; the icon itself and its menu on the real top bar cannot be seen
// here. What is tested is the logic behind them, and that the app quits without one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { alive, closeAll, descendants, launch, sandbox, waitFor, type Running } from "./helpers.ts";

const state = (dataDir: string) => JSON.parse(readFileSync(path.join(dataDir, "electron/desktop-state.json"), "utf8"));

async function quitsFully(running: Running, act: () => Promise<unknown>): Promise<void> {
  const all = [running.mainPid, ...descendants(running.mainPid)];
  const exited = new Promise<void>((resolve) => running.app.process().once("exit", () => resolve()));
  await act();
  await exited;
  await waitFor(() => all.every((pid) => !alive(pid)), "alt er stoppet", 15_000);
}

test("native tray follows the language saved in Settings", async () => {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe } = running;
    await page.evaluate(() => fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "en" }) }));
    await waitFor(async () => (await probe<string[]>("probe.statusArea().menu")).includes("New thread"), "translated tray");
    await page.locator('html[lang="en"]').waitFor();
  } finally { if (running) await closeAll(running); box.cleanup(); }
});

test("Lukk legger appen i statusfeltet, serveren kjører videre, og varselet kommer én gang", async () => {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe, windowState } = running;
    const serverPid = await probe<number>("probe.serverPid");
    const area = await probe<{ available: boolean; shown: boolean; look: string; menu: string[] }>("probe.statusArea()");
    assert.equal(area.available, true);
    assert.equal(area.shown, true);
    assert.equal(area.look, "idle");
    assert.deepEqual(area.menu, ["Vis Agentic Desktop", "Ny tråd", "Avslutt"], "ingen statuslinje når ingenting skjer");

    // The app's own tooltip on the window controls (a pointer that hovers, under xvfb).
    await page.locator('[data-control="close"]').hover();
    await page.locator(".app-tooltip", { hasText: "Lukk" }).waitFor({ timeout: 5000 });
    await page.locator('[data-control="maximize"]').hover();
    await page.locator(".app-tooltip", { hasText: "Maksimer" }).waitFor({ timeout: 5000 });

    await page.locator('[data-control="close"]').click();
    await waitFor(async () => !(await windowState()).visible, "vinduet er skjult");
    assert.ok(alive(serverPid), "serveren kjører videre");
    assert.equal(await probe<number>("probe.serverPid"), serverPid);
    assert.deepEqual(await probe<string[]>("probe.notices"), ["Agentic Desktop kjører videre i statusfeltet"]);
    assert.equal(state(box.dataDir).trayNoticeShown, true);

    // Vis brings the same window back, at the same size.
    const before = await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    await probe("probe.statusAreaAction('Vis Agentic Desktop')");
    await waitFor(async () => (await windowState()).visible, "vinduet vises");
    const after = await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.deepEqual([after.width, after.height], [before.width, before.height]);

    // Closed again: no second note.
    await page.locator('[data-control="close"]').click();
    await waitFor(async () => !(await windowState()).visible, "skjult igjen");
    assert.equal((await probe<string[]>("probe.notices")).length, 1, "varselet kommer bare første gang");
    assert.equal(await probe<number>("probe.hiddenToTray"), 2);

    // Ny tråd shows the window and starts a new thread in it.
    await probe("probe.statusAreaAction('Ny tråd')");
    await waitFor(async () => (await windowState()).visible, "vinduet vises for ny tråd");
    await page.locator(".composer textarea").first().waitFor();

    // Avslutt in the menu quits fully.
    await quitsFully(running, () => probe("probe.statusAreaAction('Avslutt')"));
    running = undefined;
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("statusikonet viser hva som jobber og venter, med en linje i menyen", async () => {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe } = running;
    const look = () => probe<{ look: string; status: string | null; menu: string[] }>("probe.statusArea()");
    await page.evaluate(() => (window as any).agenticDesktop.reportActivity(2, 0));
    await waitFor(async () => (await look()).look === "working", "prikken for jobber");
    assert.equal((await look()).status, "2 tråder jobber");
    await page.evaluate(() => (window as any).agenticDesktop.reportActivity(1, 1));
    await waitFor(async () => (await look()).look === "waiting", "prikken for venter går foran");
    assert.deepEqual((await look()).menu, ["Vis Agentic Desktop", "Ny tråd", "1 tråd jobber · 1 tråd venter på deg", "Avslutt"]);
    await page.evaluate(() => (window as any).agenticDesktop.reportActivity(0, 0));
    await waitFor(async () => (await look()).look === "idle", "tilbake til rolig");
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("Ctrl+Q avslutter helt, også når Lukk legger appen i statusfeltet", async () => {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    // Ctrl+Q as a key event to the window. Playwright's keyboard.press keeps a call open to the page
    // that is closing, which holds the process at exit while Playwright's debugger is attached, so
    // the key goes in through Electron instead. It meets the same before-input-event either way.
    await quitsFully(running, () =>
      running!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: "keyDown", keyCode: "Q", modifiers: ["control"] })),
    );
    running = undefined;
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("valget «Avslutt» i Innstillinger gjør at Lukk avslutter", async () => {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page } = running;
    await page.keyboard.press("Control+,");
    const group = page.getByRole("group", { name: "Når vinduet lukkes" });
    await group.waitFor();
    assert.equal(await group.getByRole("button", { name: "Legg i statusfeltet" }).getAttribute("aria-pressed"), "true", "statusfeltet er standard");
    await group.getByRole("button", { name: "Avslutt" }).click();
    await waitFor(() => state(box.dataDir).closeBehavior === "quit", "valget er lagret");
    await page.keyboard.press("Escape");
    await quitsFully(running, () => page.locator('[data-control="close"]').click());
    running = undefined;

    // The choice holds at the next start.
    running = await launch(box);
    assert.equal(await running.probe<string>("probe.closeBehavior()"), "quit");
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("uten statusfelt sier Innstillinger det, og Lukk avslutter", async () => {
  const box = sandbox({ tray: "off" });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe } = running;
    assert.equal((await probe<{ shown: boolean }>("probe.statusArea()")).shown, false);
    await page.keyboard.press("Control+,");
    await page.getByRole("group", { name: "Når vinduet lukkes" }).waitFor();
    await page.getByText("Statusfeltet er ikke tilgjengelig nå, så Lukk avslutter appen.").waitFor();
    await page.keyboard.press("Escape");
    await quitsFully(running, () => page.locator('[data-control="close"]').click());
    running = undefined;
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
