// SPEC 29.3: the Browser panel as a real view in the Electron window, with the server's Playwright
// connected over CDP through main.ts (desktop/browser-view.ts). Only local test pages, a temporary
// HOME and data folder, and no window on the user's screen (helpers.ts).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { alive, apiCall, closeAll, launch, ROOT, sandbox, waitFor, type Running } from "./helpers.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "../../server/test/fake-llm.ts";

// A local site: a page with a button that counts, a second page and a file to download.
function testSite(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.url === "/andre") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end("<!doctype html><title>Andre side</title><h1>Andre side</h1>");
    }
    if (req.url === "/fil") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=hei.txt" });
      return res.end("hei fra testen\n");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>Testside</title><style>body{margin:0;font:16px sans-serif;background:#fff}
button{position:absolute;left:40px;top:60px;width:200px;height:60px}</style></head>
<body><p id="teller">0</p><button id="knapp" type="button" onclick="const n=Number(document.getElementById('teller').textContent)+1;document.getElementById('teller').textContent=n;document.title='Klikket '+n">Tell</button>
<a id="lenke" href="/andre" style="position:absolute;left:40px;top:160px">Andre side</a>
<a id="fil" href="/fil" style="position:absolute;left:40px;top:200px">Last ned</a></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, server })));
}

// A WebSocket to the server from the UI's own page, like the panel's: browser.* messages are kept,
// and frames are counted and acked.
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
      } else if (String(m.type).startsWith("browser.") || m.type === "error" || String(m.type).startsWith("download")) t.messages.push(m);
    };
    await new Promise((resolve) => (ws.onopen = resolve));
  });
}

const wsSend = (page: Page, message: object) => page.evaluate((m) => (window as any).__t.ws.send(JSON.stringify(m)), message);
const lastState = (page: Page) => page.evaluate(() => (window as any).__t.messages.filter((m: any) => m.type === "browser.state").at(-1)?.state ?? null);
const frames = (page: Page) => page.evaluate(() => (window as any).__t.frames as number);

interface PanelPage {
  targetId: string;
  label: string;
  url: string;
  title: string;
  shown: boolean;
  pid: number;
  bounds: { x: number; y: number; width: number; height: number };
}
const panelOf = (app: ElectronApplication) => <T,>(expr: string) =>
  app.evaluate((_e, source) => new Function("p", `return (${source});`)((globalThis as any).__agenticBrowserPanel), expr) as Promise<T>;

test("panelet i vinduet: lages når det åpnes, serveren navigerer og klikker, annotering gir bilde, og det frigjøres når panelet lukkes", async () => {
  const box = sandbox();
  box.env.AD_BROWSER_PANEL_GRACE_MS = "1500";
  const site = await testSite();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { app, page } = running;
    const panel = panelOf(app);
    assert.equal(await panel<number>("p.pages().length"), 0, "ingen visning før panelet åpnes");
    assert.equal(await panel<number>("p.connects"), 0, "ingen CDP-bro før panelet åpnes");

    await socket(page);
    await wsSend(page, { type: "browser.open", projectId: "local", width: 800, height: 600, tabId: "", native: true });
    await waitFor(async () => (await panel<number>("p.pages().length")) === 1, "visningen er laget");
    await waitFor(async () => (await lastState(page))?.native === true, "serveren sier at siden er i vinduet");

    await wsSend(page, { type: "browser.navigate", projectId: "local", url: site.url, tabId: "" });
    await waitFor(async () => (await lastState(page))?.title === "Testside", "testsiden er lastet");
    const [view] = await panel<PanelPage[]>("p.pages()");
    assert.equal(view.url, site.url);
    assert.equal(view.label, "local\u0001");
    assert.equal(view.shown, false, "skjult til UI-et plasserer den");
    assert.equal(await frames(page), 0, "ingen bilder når siden vises i vinduet");

    // The UI places it where the panel's stage is.
    await page.evaluate(() => (window as any).agenticDesktop.browserPanel.place("local", "", { x: 100, y: 120, width: 640, height: 400 }, 1));
    await waitFor(async () => (await panel<PanelPage[]>("p.pages()"))[0].shown, "visningen vises");
    assert.deepEqual((await panel<PanelPage[]>("p.pages()"))[0].bounds, { x: 100, y: 120, width: 640, height: 400 });

    // A still picture for a menu over the panel; it also means the page has drawn.
    const still = await page.evaluate(() => (window as any).agenticDesktop.browserPanel.freeze("local", ""));
    assert.match(String(still), /^data:image\/png;base64,/);

    // The server's own input (the panel's click path over CDP) reaches the page.
    for (const action of ["down", "up"]) {
      await wsSend(page, { type: "browser.input", projectId: "local", tabId: "", event: { kind: "mouse", action, x: 120, y: 90, button: "left", clicks: 1, modifiers: 0 } });
    }
    await waitFor(async () => (await panel<PanelPage[]>("p.pages()"))[0].title === "Klikket 1", "klikket kom fram");

    // Annotering (SPEC 25.1): the screenshot comes from the view, through Playwright.
    const shot = await page.evaluate(async () => {
      const res = await fetch("/api/browser/screenshot?projectId=local&tabId=");
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, png: bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47, size: bytes.length };
    });
    assert.equal(shot.status, 200);
    assert.ok(shot.png && shot.size > 1000, `et PNG-bilde: ${JSON.stringify(shot)}`);

    // A second tab is a second view; showing it hides the first.
    await wsSend(page, { type: "browser.open", projectId: "local", width: 800, height: 600, tabId: "t2", native: true });
    await waitFor(async () => (await panel<number>("p.pages().length")) === 2, "fane 2 er laget");
    await page.evaluate(() => {
      const bridge = (window as any).agenticDesktop.browserPanel;
      bridge.place("local", "", null);
      bridge.place("local", "t2", { x: 100, y: 120, width: 640, height: 400 }, 1);
    });
    await waitFor(async () => {
      const pages = await panel<PanelPage[]>("p.pages()");
      return pages.find((p) => p.label === "local\u0001")?.shown === false && pages.find((p) => p.label === "local\u0001t2")?.shown === true;
    }, "bare fane 2 vises");
    await wsSend(page, { type: "browser.close-tab", projectId: "local", tabId: "t2" });
    await waitFor(async () => (await panel<number>("p.pages().length")) === 1, "fane 2 er lukket");

    // The panel closes: the view is hidden by the UI, and let go after the grace time.
    const pid = (await panel<PanelPage[]>("p.pages()"))[0].pid;
    assert.ok(pid > 0 && alive(pid), "sidens renderer kjører");
    await page.evaluate(() => (window as any).agenticDesktop.browserPanel.place("local", "", null));
    await wsSend(page, { type: "browser.close", projectId: "local" });
    await waitFor(async () => (await panel<number>("p.pages().length")) === 0, "visningen er frigjort", 15_000);
    await waitFor(() => !alive(pid), "sidens renderer er stoppet", 10_000);

    // It comes back when the panel opens again.
    await wsSend(page, { type: "browser.open", projectId: "local", width: 800, height: 600, tabId: "", native: true });
    await waitFor(async () => (await panel<number>("p.pages().length")) === 1, "visningen er laget igjen");
  } finally {
    await closeAll(running);
    site.server.close();
    box.cleanup();
  }
});

test("Playwright gjennom den samme broen klikker, leser og tar bilde i en fane som ikke vises, og klikker med vinduet skjult", async () => {
  const box = sandbox();
  const site = await testSite();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { app } = running;
    // In place of the server's Playwright: the same bridge, the same allowlist and the same views,
    // with a Playwright in the main process. The tab is never placed, as when the agent works with
    // the panel closed.
    const result = await app.evaluate(async ({ BrowserWindow, MessageChannelMain }, { root, url }) => {
      const { createRequire } = (process as any).getBuiltinModule("node:module");
      const { chromium } = createRequire(`${root}/package.json`)("playwright-core");
      const probe = (globalThis as any).__agenticBrowserPanel;
      const { port1, port2 } = new MessageChannelMain();
      probe.open(port1);
      const transport: any = { send: (m: object) => port2.postMessage(m), close: () => (port2.close(), transport.onclose?.()) };
      port2.on("message", (event: { data: object }) => transport.onmessage?.(event.data));
      port2.start();
      const browser = await chromium.connectOverCDP(transport, { isLocal: true, noDefaults: true, timeout: 15_000 });
      const page = await browser.contexts()[0].newPage();
      await page.goto(url);
      await page.getByRole("button", { name: "Tell" }).click();
      await page.getByRole("button", { name: "Tell" }).click();
      const counted = await page.locator("#teller").textContent();
      const snapshot = await page.ariaSnapshot({ mode: "ai" });
      const ref = /link "Andre side" \[ref=(e\d+)\]/.exec(snapshot)?.[1];
      await page.locator(`aria-ref=${ref}`).click();
      await page.waitForURL(/\/andre$/);
      const png = await page.screenshot({ type: "png" });
      const shown = probe.pages()[0]?.shown;
      // The window in the status area (SPEC 29.6): the agent goes on in the tab.
      const win = BrowserWindow.getAllWindows()[0];
      win.hide();
      await page.goBack();
      await page.getByRole("button", { name: "Tell" }).click();
      const hiddenCount = await page.locator("#teller").textContent();
      const started = Date.now();
      const hiddenShot = await page.screenshot({ type: "png", timeout: 10_000 }).then(() => "bilde", (e: Error) => `${Date.now() - started < 3000 ? "straks" : "sent"}: ${e.message.split("\n")[0]}`);
      win.show();
      await browser.close();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { counted, ref, png: png.length, shown, hiddenCount, hiddenShot, after: probe.pages().length };
    }, { root: ROOT, url: site.url });
    assert.equal(result.counted, "2", "to klikk med Playwright");
    assert.ok(result.ref, "ariaSnapshot har lenken med ref");
    assert.ok(result.png > 1000, "skjermbilde av en fane som ikke vises");
    assert.equal(result.shown, false, "fanen var aldri synlig");
    assert.equal(result.hiddenCount, "1", "klikk med vinduet skjult");
    // Nothing is drawn while the window is hidden: a picture fails at once and says why.
    assert.match(String(result.hiddenShot), /^straks: .*Vinduet til Agentic Desktop er skjult/);
    assert.equal(result.after, 0, "visningen går når Playwright kobler fra");
  } finally {
    await closeAll(running);
    site.server.close();
    box.cleanup();
  }
});

test("UI-rendereren kan ikke nås via CDP-broen, og sidene i panelet er låst ned", async () => {
  const box = sandbox();
  const site = await testSite();
  // An imported cookie waiting for the panel (SPEC 26.4), for 127.0.0.1.
  const profile = path.join(box.dataDir, "chrome-profile");
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  const cookie = { name: "innlogget", value: "ja", domain: "127.0.0.1", path: "/", expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: false, secure: false, sameSite: "Lax" };
  writeFileSync(path.join(profile, "agentic-imported-cookies.json"), JSON.stringify({ version: 1, sites: { "127.0.0.1": { cookies: 1, importedAt: Date.now(), source: "Test" } }, pending: [{ site: "127.0.0.1", cookie }], session: [], forget: [] }), { mode: 0o600 });
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { app, page } = running;
    const panel = panelOf(app);
    await socket(page);
    await wsSend(page, { type: "browser.open", projectId: "local", width: 800, height: 600, tabId: "", native: true });
    await waitFor(async () => (await panel<number>("p.pages().length")) === 1, "visningen er laget");
    await wsSend(page, { type: "browser.navigate", projectId: "local", url: site.url, tabId: "" });
    await waitFor(async () => (await lastState(page))?.title === "Testside", "testsiden er lastet");

    const report = await app.evaluate(async ({ BrowserWindow, session, webContents }) => {
      const probe = (globalThis as any).__agenticBrowserPanel;
      const ui = BrowserWindow.getAllWindows()[0].webContents;
      const uiAttachedByBridge = ui.debugger.isAttached();
      // The UI's own target id, read here by the test only.
      ui.debugger.attach("1.3");
      const uiId = (await ui.debugger.sendCommand("Target.getTargetInfo")).targetInfo.targetId as string;
      ui.debugger.detach();
      const panelPage = probe.pages()[0];
      const panelContents = webContents.getAllWebContents().find((w: any) => w.getOSProcessId() === panelPage.pid && w !== ui)!;

      // Everything below goes in as if from the server, and the answers are read back.
      probe.record = true;
      probe.sent.length = 0;
      let id = 1000;
      const ask = async (method: string, params: object = {}, sessionId?: string) => {
        const mine = ++id;
        probe.send({ id: mine, method, params, ...(sessionId ? { sessionId } : {}) });
        for (let i = 0; i < 100; i++) {
          const answer = probe.sent.find((m: any) => m.id === mine);
          if (answer) return answer;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { timeout: true };
      };
      const out: Record<string, any> = { uiAttachedByBridge };
      out.targets = (await ask("Target.getTargets")).result?.targetInfos ?? [];
      out.rootAttachUi = await ask("Target.attachToTarget", { targetId: uiId, flatten: true });
      out.rootInfoUi = (await ask("Target.getTargetInfo", { targetId: uiId })).result?.targetInfo;
      const browserSession = (await ask("Target.attachToBrowserTarget")).result.sessionId;
      out.browserAttachUi = await ask("Target.attachToTarget", { targetId: uiId, flatten: true }, browserSession);
      const pageSession = (await ask("Target.attachToTarget", { targetId: panelPage.targetId, flatten: true }, browserSession)).result.sessionId;
      out.page = {
        attachUi: await ask("Target.attachToTarget", { targetId: uiId, flatten: true }, pageSession),
        targets: await ask("Target.getTargets", {}, pageSession),
        discover: await ask("Target.setDiscoverTargets", { discover: true }, pageSession),
        browserTarget: await ask("Target.attachToBrowserTarget", {}, pageSession),
        expose: await ask("Target.exposeDevToolsProtocol", { targetId: uiId }, pageSession),
        create: await ask("Target.createTarget", { url: "about:blank" }, pageSession),
        closeUi: await ask("Target.closeTarget", { targetId: uiId }, pageSession),
        browserClose: await ask("Browser.close", {}, pageSession),
        file: await ask("Page.navigate", { url: "file:///etc/passwd" }, pageSession),
        app: await ask("Page.navigate", { url: ui.getURL() }, pageSession),
        info: (await ask("Target.getTargetInfo", { targetId: uiId }, pageSession)).result?.targetInfo,
        evaluate: (await ask("Runtime.evaluate", { expression: "location.href", returnByValue: true }, pageSession)).result?.result?.value,
      };
      // What the panel's own debugger would allow without the allowlist, for the report.
      out.rawGetTargets = await panelContents.debugger.sendCommand("Target.getTargets").then((r: any) => `svarte med ${r.targetInfos.length} mål`, (e: Error) => `avvist: ${e.message}`);
      probe.record = false;
      out.uiAttachedAfter = ui.debugger.isAttached();
      out.uiUrl = ui.getURL();

      // The page's settings, partition and permissions.
      const prefs = (panelContents as any).getLastWebPreferences?.() ?? null;
      out.prefs = prefs && { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, preload: prefs.preload ?? null, webviewTag: prefs.webviewTag };
      out.globals = await panelContents.executeJavaScript("[typeof require, typeof process, typeof module, typeof window.agenticDesktop].join(',')");
      out.cmdline = (process as any).getBuiltinModule("node:fs").readFileSync(`/proc/${panelPage.pid}/cmdline`, "utf8").split("\0");
      out.partition = panelContents.session === session.fromPartition("persist:browser-panel");
      out.camera = await panelContents.executeJavaScript("navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'tillatt', (e) => 'avslått: ' + e.name)", true);
      out.cookie = await panelContents.executeJavaScript("document.cookie");
      out.defaultSessionCookie = (await session.defaultSession.cookies.get({ name: "innlogget" })).length;
      // Navigation: only http and https, from the page itself too.
      await panelContents.executeJavaScript("location.href = 'file:///etc/passwd'");
      await new Promise((resolve) => setTimeout(resolve, 500));
      out.afterFile = panelContents.getURL();
      return out;
    });

    assert.equal(report.uiAttachedByBridge, false, "broen har aldri koblet seg til UI-et");
    assert.ok(report.targets.length === 1 && report.targets.every((t: any) => t.url.startsWith(site.url)), `bare panelets sider: ${JSON.stringify(report.targets)}`);
    assert.ok(!JSON.stringify(report.targets).includes("token"), "ingen adresse med token");
    for (const [name, answer] of [["rotøkten", report.rootAttachUi], ["nettleserøkten", report.browserAttachUi]] as const) {
      assert.ok(answer.error, `${name} kan ikke koble til UI-et: ${JSON.stringify(answer)}`);
    }
    assert.equal(report.rootInfoUi?.targetId, "browser-panel", "UI-ets id er ukjent for broen");
    for (const [name, answer] of Object.entries(report.page)) {
      if (name === "info" || name === "evaluate") continue;
      assert.ok((answer as any).error, `sideøkten avviser ${name}: ${JSON.stringify(answer)}`);
    }
    assert.notEqual(report.page.info?.targetId, undefined);
    assert.notEqual(report.page.info?.url, report.uiUrl, "Target.getTargetInfo gir bare sin egen side");
    assert.ok(String(report.page.evaluate).startsWith(site.url), "Runtime.evaluate kjører i panelets side");
    assert.equal(report.uiAttachedAfter, false, "UI-et har fortsatt ingen debugger");
    if (report.prefs) assert.deepEqual(report.prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: null, webviewTag: false });
    assert.equal(report.globals, "undefined,undefined,undefined,undefined", "ingen Node og ingen bro i siden");
    assert.ok(!report.cmdline.some((a: string) => /^--(node-integration|preload)/.test(a)), `ingen Node eller preload: ${report.cmdline.join(" ")}`);
    assert.equal(report.partition, true, "egen partisjon");
    assert.match(report.camera, /^avslått/, "kamera er avslått");
    assert.match(report.cookie, /innlogget=ja/, "den importerte informasjonskapselen er i panelets partisjon");
    assert.equal(report.defaultSessionCookie, 0, "og ikke i UI-ets økt");
    assert.ok(report.afterFile.startsWith(site.url), `file:// er stoppet: ${report.afterFile}`);
    console.log(`Panelets egen debugger uten broen, Target.getTargets: ${report.rawGetTargets}`);
  } finally {
    await closeAll(running);
    site.server.close();
    box.cleanup();
  }
});

test("UI-et: panelet følger rammen, viker for menyer og annotering med et stillbilde, og skjules med sidepanelet", async () => {
  const box = sandbox();
  const site = await testSite();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { app, page } = running;
    const panel = panelOf(app);
    const projectDir = path.join(box.dir, "prosjekt");
    mkdirSync(projectDir, { recursive: true });
    await apiCall(page, "POST", "/api/projects", { name: "Demo", path: projectDir });
    const kode = page.locator(".sidebar .mode-button", { hasText: "Kode" });
    if ((await kode.count()) && (await kode.getAttribute("aria-pressed")) !== "true") await kode.click();
    await page.locator('.group[data-project="Demo"] .group-title').first().click();
    await page.waitForSelector(".project-label");
    await page.keyboard.press("Control+Alt+4");
    const browser = page.getByTestId("browser-panel");
    await browser.waitFor();
    assert.equal(await panel<number>("p.pages().length") <= 1, true);
    await browser.getByLabel("Adresse").fill(site.url);
    await browser.getByLabel("Adresse").press("Enter");

    const stageRect = () => browser.locator(".browser-stage").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    });
    const view = async () => (await panel<PanelPage[]>("p.pages()")).find((p) => p.url.startsWith(site.url));
    const matches = async () => {
      const v = await view();
      const r = await stageRect();
      return !!v && v.shown && Math.abs(v.bounds.x - r.x) <= 1 && Math.abs(v.bounds.y - r.y) <= 1 && Math.abs(v.bounds.width - r.width) <= 1 && Math.abs(v.bounds.height - r.height) <= 1;
    };
    await waitFor(matches, "siden vises der panelet er");
    assert.equal(await browser.getByTestId("browser-canvas").isHidden(), true, "ingen bilder på lerretet");

    // A menu over the panel: the page is a still picture until the menu goes.
    await browser.getByRole("button", { name: "Mer for nettleseren" }).click();
    await page.getByRole("menu", { name: "Nettlesermeny" }).waitFor();
    await waitFor(async () => (await view())?.shown === false, "visningen viker for menyen");
    assert.equal(await browser.locator("img.browser-still").count(), 1, "stillbildet vises i stedet");
    await page.keyboard.press("Escape");
    await waitFor(matches, "siden er tilbake når menyen er lukket");
    await waitFor(async () => (await browser.locator("img.browser-still").count()) === 0, "stillbildet er borte");

    // The response-selection toolbar is portalled outside the conversation. Like a menu,
    // it must remain clickable if it extends over the native browser's rectangle.
    await browser.locator(".browser-stage").evaluate((stage) => {
      const rect = stage.getBoundingClientRect();
      const toolbar = document.createElement("div");
      toolbar.className = "response-selection";
      toolbar.dataset.testid = "selection-native-overlap";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "Markert svartekst i integrasjonsprøven");
      Object.assign(toolbar.style, { position: "fixed", left: `${rect.left + 8}px`, top: `${rect.top + 8}px` });
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Legg til i chat";
      toolbar.append(button);
      document.body.append(toolbar);
    });
    await waitFor(async () => (await view())?.shown === false, "visningen viker for markeringens verktøylinje");
    assert.equal(await browser.locator("img.browser-still").count(), 1);
    await page.getByTestId("selection-native-overlap").getByRole("button").click();
    await page.getByTestId("selection-native-overlap").evaluate((toolbar) => toolbar.remove());
    await waitFor(matches, "siden kommer tilbake etter markeringsmenyen");

    // Full view: a larger stage, and the page follows.
    const before = await stageRect();
    await browser.getByRole("button", { name: "Fullvisning" }).first().click();
    await waitFor(async () => (await stageRect()).width > before.width + 50, "panelet er bredere");
    await waitFor(matches, "siden følger fullvisningen");
    await browser.getByRole("button", { name: "Avslutt fullvisning" }).first().click();
    await waitFor(async () => Math.abs((await stageRect()).width - before.width) <= 2, "tilbake");
    await waitFor(matches, "siden følger tilbake");

    // Annotering: the overlay lies over the stage with the server's picture, and the view steps aside.
    await page.keyboard.press("Control+Alt+A");
    const annotate = page.getByTestId("annotate");
    await annotate.waitFor();
    await waitFor(async () => (await view())?.shown === false, "visningen viker for annoteringen");
    await annotate.locator("img.annotate-picture, canvas.annotate-picture:not(.hidden)").first().waitFor({ timeout: 15_000 });
    await annotate.getByRole("button", { name: /Avbryt/ }).click();
    await annotate.waitFor({ state: "detached" });
    await waitFor(matches, "siden er tilbake etter annoteringen");

    // The shared chooser hides a native stack view without destroying its mounted tool.
    await apiCall(page, "PATCH", "/api/settings", { panelButtons: "separate" });
    await waitFor(matches, "native siden flyttes med stablet panel");
    await browser.evaluate((element) => element.setAttribute("data-native-retained", "ja"));
    await page.getByRole("button", { name: "Åpne verktøy", exact: true }).click();
    await page.getByTestId("panel-home").waitFor();
    await waitFor(async () => (await view())?.shown === false, "native visning viker for felles verktøyvelger");
    assert.equal(await browser.isVisible(), false);
    await page.locator(".right-panel").getByRole("tab", { name: "Testside", exact: true }).click();
    await waitFor(matches, "native siden kommer tilbake fra verktøyvelgeren");
    assert.equal(await browser.getAttribute("data-native-retained"), "ja");
    await page.keyboard.press("Control+Comma");
    await page.getByRole("region", { name: "Innstillinger", exact: true }).waitFor();
    await waitFor(async () => (await view())?.shown === false, "native visning dekker ikke innstillinger");
    await page.keyboard.press("Escape");
    await waitFor(matches, "native siden kommer tilbake etter innstillinger");

    // The side panel hides: so does the page.
    await page.keyboard.press("Control+Shift+B");
    await browser.waitFor({ state: "detached" });
    await waitFor(async () => (await view())?.shown === false, "skjult med sidepanelet");
    await page.keyboard.press("Control+Shift+B");
    await page.getByTestId("browser-panel").waitFor();
    await waitFor(matches, "tilbake med sidepanelet");
  } finally {
    await closeAll(running);
    site.server.close();
    box.cleanup();
  }
});

test("nedlastinger fra panelet i vinduet går til nedlastingsmappen, uten lagre-dialog", async () => {
  const box = sandbox();
  const site = await testSite();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { app, page } = running;
    const panel = panelOf(app);
    await socket(page);
    await wsSend(page, { type: "browser.open", projectId: "local", width: 800, height: 600, tabId: "", native: true });
    await waitFor(async () => (await panel<number>("p.pages().length")) === 1, "visningen er laget");
    await wsSend(page, { type: "browser.navigate", projectId: "local", url: `${site.url}fil`, tabId: "" });
    let items: Array<{ filename: string; state: string; path: string | null }> = [];
    await waitFor(async () => {
      items = (await apiCall(page, "GET", "/api/downloads")).items;
      return items.some((i) => i.state === "done");
    }, "nedlastingen er ferdig");
    const done = items.find((i) => i.state === "done")!;
    assert.equal(done.filename, "hei.txt");
    assert.ok(done.path && done.path.startsWith(box.home), `i den midlertidige HOME: ${done.path}`);
    assert.equal(readFileSync(done.path!, "utf8"), "hei fra testen\n");
  } finally {
    await closeAll(running);
    site.server.close();
    box.cleanup();
  }
});

test("modelltråders egne faner forblir isolert gjennom native Electron-broen", async (t) => {
  const box = sandbox();
  const site = await testSite();
  const llm = await startFakeLlm(t);
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { app, page } = running;
    const folder = path.join(box.dir, "prosjekt");
    mkdirSync(folder, { recursive: true });
    const project = await apiCall(page, "POST", "/api/projects", { name: "Native trådfaner", path: folder });
    await apiCall(page, "PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
    const provider = await apiCall(page, "POST", "/api/providers", { name: "Lokal test", kind: "openai-compatible", baseUrl: `${llm.url}/v1` });
    const model = await apiCall(page, "POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "fake", contextWindow: 100_000 });
    const a = await apiCall(page, "POST", "/api/threads", { projectId: project.id, mode: "code", modelId: model.id });
    const b = await apiCall(page, "POST", "/api/threads", { projectId: project.id, mode: "code", modelId: model.id });
    const run = async (id: string, tool: string, input: object, callId: string) => {
      llm.reply(sse(openaiToolCall(tool, input, callId)));
      llm.reply(sse(openaiText("Kontrollert lokalt.")));
      const before = llm.requests.length;
      await apiCall(page, "POST", `/api/threads/${id}/messages`, { text: "Kontroller fanen." });
      try {
        await waitFor(async () => {
          const state = await apiCall(page, "GET", "/api/bootstrap");
          return llm.requests.length >= before + 2 && state.threads.find((thread: any) => thread.id === id)?.running === false;
        }, "verktøyløkken fullfører");
      } catch (err) {
        const events = await apiCall(page, "GET", `/api/threads/${id}/events?limit=30`);
        throw new Error(`${String(err)}; modellkall=${llm.requests.length}; hendelser=${JSON.stringify(events.map((entry: any) => ({ type: entry.event.type, status: entry.event.status, error: entry.event.error, result: entry.event.result })))}`);
      }
    };
    await run(a.id, "browser_navigate", { url: site.url }, "a-nav");
    await run(b.id, "browser_navigate", { url: `${site.url}andre` }, "b-nav");
    await run(a.id, "browser_snapshot", {}, "a-read");
    const messages = llm.requests.at(-1)!.body.messages;
    const result = messages.find((message: any) => message.role === "tool" && message.tool_call_id === "a-read");
    assert.match(result?.content ?? "", /Testside/);
    assert.doesNotMatch(result?.content ?? "", /heading "Andre side"/);
    const pages = await panelOf(app)<PanelPage[]>("p.pages()");
    assert.equal(pages.filter((entry) => entry.label.startsWith(`${project.id}\u0001thread-`)).length, 2);
    assert.ok(pages.some((entry) => entry.url === site.url));
    assert.ok(pages.some((entry) => entry.url === `${site.url}andre`));
  } finally {
    site.server.closeAllConnections();
    site.server.close();
    await closeAll(running);
    box.cleanup();
  }
});
