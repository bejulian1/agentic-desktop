// SPEC 29.2: the app without Chromium's sandbox, as desktop/launcher/agentic-desktop-start starts it
// when the AppArmor profile is missing (--no-sandbox). The UI still runs (it only loads the app's own
// files), but no web page is opened in Electron: the Browser panel uses the server's headless Chrome.
// Innstillinger -> Om says so in one quiet line, with the command that turns the sandbox on.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { closeAll, launch, sandbox, sandboxWorks, waitFor, type Running } from "./helpers.ts";
import { restricted } from "./gnome.ts";
import { profileLoaded } from "../sandbox.ts";

function site(): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Testside</title><h1>Hei</h1>");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, server })));
}

async function socket(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const res = await fetch("/api/ws-ticket", { method: "POST" });
    const { ticket } = await res.json();
    const ws = new WebSocket(`ws://${location.host}/ws?ticket=${ticket}`);
    const t = { ws, messages: [] as any[], frames: 0 };
    (window as any).__t = t;
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.type === "browser.frame") {
        t.frames += 1;
        ws.send(JSON.stringify({ type: "browser.frame-ack", projectId: m.projectId, sessionId: m.sessionId, tabId: m.tabId }));
      } else if (String(m.type).startsWith("browser.")) t.messages.push(m);
    };
    await new Promise((resolve) => (ws.onopen = resolve));
  });
}

const wsSend = (page: Page, message: object) => page.evaluate((m) => (window as any).__t.ws.send(JSON.stringify(m)), message);
const lastState = (page: Page) => page.evaluate(() => (window as any).__t.messages.filter((m: any) => m.type === "browser.state").at(-1)?.state ?? null);
const panelOf = (app: ElectronApplication) => <T,>(expr: string) =>
  app.evaluate((_e, source) => new Function("p", `return (${source});`)((globalThis as any).__agenticBrowserPanel), expr) as Promise<T>;

async function openAbout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Innstillinger" }).click();
  await page.locator(".settings-nav").getByRole("button", { name: "Om", exact: true }).click();
  await page.getByTestId("about-version").waitFor();
}

test("uten sandkassen: Om sier det rolig, og nettleserpanelet bruker serverens Chrome", async () => {
  const box = sandbox();
  const web = await site();
  let running: Running | undefined;
  try {
    running = await launch(box, { args: ["--no-sandbox"] });
    const { app, page, probe } = running;
    const info = await probe<{ on: boolean; reason: string; command: string | null }>("probe.sandbox");
    assert.equal(info.on, false);

    // No note at start: nothing shows until Innstillinger -> Om is opened.
    assert.equal(await page.getByTestId("about-sandbox").count(), 0);
    assert.equal(await page.locator(".toast").count(), 0);
    await openAbout(page);
    const note = page.getByTestId("about-sandbox");
    await note.waitFor();
    if (restricted() && !profileLoaded()) {
      assert.match(await note.innerText(), /Chromium-sandkassen er av fordi AppArmor-profilen for Agentic Desktop mangler\. Nettleserpanelet bruker derfor Chrome, med sin egen sandkasse\./);
      const command = await note.locator("code").innerText();
      assert.match(command, /^sudo install -m 644 .*desktop\/apparmor\/agentic-desktop' \/etc\/apparmor\.d\/agentic-desktop && sudo apparmor_parser -r \/etc\/apparmor\.d\/agentic-desktop$/);
      await note.getByRole("button", { name: "Kopier" }).click();
      await page.locator(".toast", { hasText: "Kommandoen er kopiert." }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), command);
    }
    await page.keyboard.press("Escape");

    // The panel asks for a page in the window; it gets the server's Chrome and pictures instead.
    const panel = panelOf(app);
    await socket(page);
    await wsSend(page, { type: "browser.open", projectId: "local", width: 800, height: 600, tabId: "", native: true });
    await wsSend(page, { type: "browser.navigate", projectId: "local", url: web.url, tabId: "" });
    await waitFor(async () => (await lastState(page))?.title === "Testside", "testsiden er lastet", 60_000);
    assert.notEqual((await lastState(page))?.native, true, "ikke i vinduet");
    await waitFor(async () => (await page.evaluate(() => (window as any).__t.frames as number)) > 0, "bilder fra Chrome");
    assert.equal(await panel<number>("p.connects"), 0, "ingen bro til Electron");
    assert.equal(await panel<number>("p.pages().length"), 0, "ingen side i Electron");
  } finally {
    await closeAll(running);
    web.server.close();
    box.cleanup();
  }
});

test("med sandkassen: ingen linje i Om", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    assert.equal((await running.probe<{ on: boolean }>("probe.sandbox")).on, sandboxWorks);
    if (!sandboxWorks) return;
    await openAbout(running.page);
    await running.page.getByTestId("about-build").waitFor();
    assert.equal(await running.page.getByTestId("about-sandbox").count(), 0);
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
