// Real HTTP/WS routing and BrowserManager state, with an in-memory CDP/page stand-in: no Chrome.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { BrowserContext } from "playwright-core";
import { localBrowserAddress } from "../src/browser-address.ts";
import { startHarness, tempDir, until } from "./helpers.ts";

class MemoryPage extends EventEmitter {
  addresses = ["about:blank"];
  index = 0;
  closed = false;
  viewport = { width: 800, height: 600 };
  frame = {};
  cdp = new MemoryCDP(this);
  isClosed() { return this.closed; }
  url() { return this.addresses[this.index]; }
  async title() { return this.url(); }
  mainFrame() { return this.frame; }
  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}
  async setViewportSize(size: { width: number; height: number }) { this.viewport = size; }
  async goto(url: string) {
    this.addresses.splice(this.index + 1, Infinity, url);
    this.index++;
    this.emit("framenavigated", this.frame);
    this.emit("load");
  }
  async goBack() { this.index = Math.max(0, this.index - 1); this.emit("framenavigated", this.frame); }
  async goForward() { this.index = Math.min(this.addresses.length - 1, this.index + 1); this.emit("framenavigated", this.frame); }
  async reload() { this.emit("framenavigated", this.frame); }
  async evaluate() { return ""; }
  async screenshot() { return Buffer.from("FAKE-PNG"); }
  async close() { this.closed = true; this.emit("close"); }
}

class MemoryCDP extends EventEmitter {
  page: MemoryPage;
  commands: Array<{ method: string; params?: any }> = [];
  constructor(page: MemoryPage) { super(); this.page = page; }
  async send(method: string, params?: any): Promise<any> {
    this.commands.push({ method, params });
    if (method === "Page.getNavigationHistory") return { currentIndex: this.page.index, entries: this.page.addresses.map((url) => ({ url })) };
    if (method === "Page.startScreencast") queueMicrotask(() => this.emit("Page.screencastFrame", { data: "ZmFrZS1qcGVn", sessionId: 42, metadata: { deviceWidth: this.page.viewport.width, deviceHeight: this.page.viewport.height } }));
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame" } } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
    if (method === "Runtime.evaluate") return { result: { value: true } };
    return {};
  }
}

class MemoryContext {
  opened: MemoryPage[] = [];
  closed = false;
  request = { get: async () => ({ ok: () => false, headers: () => ({}), dispose: async () => {} }) };
  pages() { return this.opened; }
  async newPage() { const page = new MemoryPage(); this.opened.push(page); return page; }
  async newCDPSession(page: MemoryPage) { return page.cdp; }
  async close() { this.closed = true; for (const page of this.opened) await page.close(); }
}

test("lokale nettadresser får nett-skjema, mens stier og ugyldige adresser avvises før side åpnes", () => {
  assert.equal(localBrowserAddress("google.com"), "https://google.com/");
  assert.equal(localBrowserAddress("example.test:8443/side?q=1"), "https://example.test:8443/side?q=1");
  assert.equal(localBrowserAddress("localhost:1234/side"), "http://localhost:1234/side");
  assert.equal(localBrowserAddress("[::1]:1234/side"), "http://[::1]:1234/side");
  assert.equal(localBrowserAddress("https://example.test/side"), "https://example.test/side");
  assert.equal(localBrowserAddress("about:blank"), "about:blank");
  for (const address of ["", "/etc/passwd", "../privat", "a b.test", "bad\\host", "\0example.test"]) assert.throws(() => localBrowserAddress(address), { status: 400 });
});

test("ugyldige JSON-meldinger gir vanlig feil uten serverstopp, mens nettleserfeil beholder prosjekt og fane", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t, "ad-local-home-") });
  const socket = await h.socket();
  for (const invalid of [null, [], ["browser.open"], 42, true, "browser.open", {}, { projectId: "local" }, { type: null }, { type: 5 }, { type: "" }]) {
    socket.received.length = 0;
    socket.send(invalid);
    const error = await socket.waitFor((message) => message.type === "error");
    assert.equal(error.type === "error" && error.message, "Ugyldig melding", JSON.stringify(invalid));
  }
  socket.received.length = 0;
  socket.ws.send("{");
  await socket.waitFor((message) => message.type === "error" && message.message === "Ugyldig melding");
  assert.equal((await h.raw("GET", "/api/bootstrap")).status, 200, "HTTP-serveren lever etter ugyldige WS-meldinger");
  socket.send({ type: "browser.navigate", projectId: "local", tabId: "bare-denne", url: "file:///etc/passwd" });
  const scoped = await socket.waitFor((message) => message.type === "browser.error");
  assert.deepEqual(scoped, { type: "browser.error", projectId: "local", tabId: "bare-denne", command: "browser.navigate", message: "Bare http- og https-adresser kan åpnes" });
  assert.equal(h.app.browser.running, false, "valideringsfeil starter ingen Chrome");
  socket.send({ type: "browser.open", projectId: "ukjent-prosjekt", tabId: "annen", width: 640, height: 480 });
  await socket.waitFor((message) => message.type === "browser.error" && message.projectId === "ukjent-prosjekt" && message.tabId === "annen" && message.command === "browser.open");
  for (const invalidId of [5, {}, "", "x".repeat(101), "id\nfeil"]) {
    socket.received.length = 0;
    socket.send({ type: "browser.navigate", projectId: "local", tabId: "id-test", url: "file:///etc/passwd", requestId: invalidId });
    const error = await socket.waitFor((message) => message.type === "browser.error");
    assert.equal("requestId" in error, false, "ugyldige requestId reflekteres ikke");
  }
});

test("sen feil fra navigasjon A beholder requestId A etter at B har lykkes i samme lokale fane", async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t, "ad-local-home-") });
  const context = new MemoryContext();
  const internals = h.app.browser as unknown as { launch: () => Promise<BrowserContext>; context?: BrowserContext; native: boolean };
  t.mock.method(internals, "launch", async () => {
    internals.context = context as unknown as BrowserContext;
    internals.native = false;
    return internals.context;
  });
  const socket = await h.socket();
  socket.send({ type: "browser.open", projectId: "local", tabId: "samme", requestId: "open-1", width: 640, height: 480 });
  await socket.waitFor((message) => message.type === "browser.state" && message.tabId === "samme");
  const page = context.opened[0];
  const goto = page.goto.bind(page);
  let releaseA!: () => void;
  const heldA = new Promise<void>((resolve) => { releaseA = resolve; });
  let startedA = false;
  t.mock.method(page, "goto", async (url: string) => {
    if (url === "https://a.test/") {
      startedA = true;
      await heldA;
      throw new Error("Forsinket feil fra A");
    }
    await goto(url);
  });
  try {
    socket.send({ type: "browser.navigate", projectId: "local", tabId: "samme", requestId: "navigate-A", url: "a.test" });
    await until(() => startedA, "A er holdt tilbake");
    socket.send({ type: "browser.navigate", projectId: "local", tabId: "samme", requestId: "navigate-B", url: "b.test" });
    await socket.waitFor((message) => message.type === "browser.state" && message.tabId === "samme" && message.state.url === "https://b.test/");
    releaseA();
    const error = await socket.waitFor((message) => message.type === "browser.error");
    assert.deepEqual(error, { type: "browser.error", projectId: "local", tabId: "samme", command: "browser.navigate", requestId: "navigate-A", message: "Forsinket feil fra A" });
    assert.equal((await h.app.browser.screenshot("local", "samme")).url, "https://b.test/");
  } finally {
    releaseA();
  }
});

for (const native of [false, true]) test(`lokalt browserpanel: faner, historie, input, rammer/native, skjermbilde og gjenåpning (${native ? "native" : "fallback"})`, async (t) => {
  const h = await startHarness(t, { homeDir: tempDir(t, "ad-local-home-") });
  let context = new MemoryContext();
  const internals = h.app.browser as unknown as { launch: () => Promise<BrowserContext>; context?: BrowserContext; native: boolean };
  t.mock.method(internals, "launch", async () => {
    if (context.closed) context = new MemoryContext();
    internals.context = context as unknown as BrowserContext;
    internals.native = native;
    return internals.context;
  });
  const socket = await h.socket();
  socket.send({ type: "browser.open", projectId: "local", tabId: "en", width: 640, height: 480, native: true });
  await socket.waitFor((message) => message.type === "browser.state" && message.projectId === "local" && message.tabId === "en");
  socket.send({ type: "browser.navigate", projectId: "local", tabId: "en", url: "google.com" });
  await socket.waitFor((message) => message.type === "browser.state" && message.state.url === "https://google.com/");
  assert.equal(h.app.browser.inWindow, native);
  if (native) assert.ok(context.opened[0].cdp.commands.some((command) => command.method === "Agentic.label" && command.params.label === "local\u0001en"));
  else {
    await socket.waitFor((message) => message.type === "browser.frame" && message.projectId === "local" && message.tabId === "en");
    socket.send({ type: "browser.frame-ack", projectId: "local", tabId: "en", sessionId: 42 });
    await until(() => context.opened[0].cdp.commands.some((command) => command.method === "Page.screencastFrameAck"), "lokal ramme er kvittert");
  }
  socket.send({ type: "browser.navigate", projectId: "local", tabId: "en", url: "http://localhost:1234/to" });
  await socket.waitFor((message) => message.type === "browser.state" && message.state.url === "http://localhost:1234/to");
  socket.received.length = 0;
  socket.send({ type: "browser.history", projectId: "local", tabId: "en", action: "back" });
  await socket.waitFor((message) => message.type === "browser.state" && message.state.url === "https://google.com/" && message.state.canGoForward);
  socket.received.length = 0;
  socket.send({ type: "browser.history", projectId: "local", tabId: "en", action: "forward" });
  await socket.waitFor((message) => message.type === "browser.state" && message.state.url === "http://localhost:1234/to");
  socket.send({ type: "browser.input", projectId: "local", tabId: "en", event: { kind: "key", action: "down", key: "a", code: "KeyA", text: "a", modifiers: 0 } });
  await until(() => context.opened[0].cdp.commands.some((command) => command.method === "Input.dispatchKeyEvent"), "lokalt tastaturinput går til riktig side");
  socket.send({ type: "browser.open", projectId: "local", tabId: "to", width: 640, height: 480 });
  await socket.waitFor((message) => message.type === "browser.state" && message.tabId === "to");
  socket.send({ type: "browser.navigate", projectId: "local", tabId: "to", url: "file:///etc/passwd" });
  const error = await socket.waitFor((message) => message.type === "browser.error" && message.tabId === "to");
  assert.equal(error.type === "browser.error" && error.command, "browser.navigate");
  assert.equal((await h.app.browser.screenshot("local", "en")).url, "http://localhost:1234/to", "feil i én fane berører ikke en annen");
  assert.equal((await h.raw("GET", "/api/browser/screenshot?projectId=local&tabId=en")).status, 200);
  assert.equal((await h.raw("GET", "/api/browser/screenshot?projectId=finnes-ikke")).status, 404);
  socket.send({ type: "browser.open", projectId: "finnes-ikke", tabId: "ukjent", width: 640, height: 480 });
  await socket.waitFor((message) => message.type === "browser.error" && message.projectId === "finnes-ikke" && /Fant ikke prosjektet/.test(message.message));
  assert.throws(() => h.app.browser.forThread("local", "agent"), { status: 403 });
  assert.deepEqual(h.app.store.projects(), []);
  socket.close();
  const reconnected = await h.socket();
  reconnected.send({ type: "browser.open", projectId: "local", tabId: "en", width: 640, height: 480 });
  await reconnected.waitFor((message) => message.type === "browser.state" && message.tabId === "en" && message.state.url === "http://localhost:1234/to");
  await h.app.browser.close();
  reconnected.received.length = 0;
  reconnected.send({ type: "browser.open", projectId: "local", tabId: "en", width: 640, height: 480 });
  await reconnected.waitFor((message) => message.type === "browser.state" && message.tabId === "en" && message.state.url === "about:blank");
});
