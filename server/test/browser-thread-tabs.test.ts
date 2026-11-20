// Two real tool loops, local fake models and pages only. The panel may inspect either thread
// without retargeting either model's next action or invalidating its accessibility refs.
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright-core";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { BrowserTabInfo, ServerMessage } from "../../shared/protocol.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, until } from "./helpers.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test("to samtidige Kode-tråder beholder egen side og refs når andre tråder og brukeren bytter fane", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const site = http.createServer((req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
    `<title>Side ${req.url}</title><button onclick="this.textContent='Trykket ${req.url}'">Trykk ${req.url}</button><input aria-label="Navn"><script>console.log('logg ${req.url}')</script>`,
  ));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  t.after(() => { site.closeAllConnections(); site.close(); });
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  const llmA = await startFakeLlm(t);
  const llmB = await startFakeLlm(t);
  const threads = [];
  for (const [name, llm] of [["A", llmA], ["B", llmB]] as const) {
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name, baseUrl: `${llm.url}/v1` });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name, model: "fake", contextWindow: 100_000, supportsImages: true });
    threads.push(await h.thread(project.id, "code", model.id));
  }
  const [a, b] = threads;
  const panel = await h.socket();
  panel.send({ type: "browser.open", projectId: project.id, tabId: "manual", width: 640, height: 480 });
  await panel.waitFor((m) => m.type === "browser.state" && m.tabId === "manual");
  const aPaused = deferred();
  const resumeA = deferred();
  t.after(() => resumeA.resolve());
  let nameRef = "";
  llmA.reply(sse(openaiToolCall("browser_navigate", { url: `${base}/a` }, "a-nav")));
  llmA.reply(sse(openaiToolCall("browser_snapshot", {}, "a-snap")));
  llmA.reply(async (req, res) => {
    const snapshot = req.body.messages.filter((m: any) => m.role === "tool").at(-1).content;
    const ref = /button "Trykk \/a" \[ref=(e\d+)\]/.exec(snapshot)?.[1];
    assert.ok(ref, snapshot);
    nameRef = /textbox "Navn" \[ref=(e\d+)\]/.exec(snapshot)?.[1] ?? "";
    assert.ok(nameRef, snapshot);
    aPaused.resolve();
    await resumeA.promise;
    await sse(openaiToolCall("browser_click", { ref }, "a-click"))(req, res);
  });
  llmA.reply((req, res) => sse(openaiToolCall("browser_type", { ref: nameRef, value: "fra A" }, "a-type"))(req, res));
  llmA.reply(sse(openaiToolCall("browser_snapshot", {}, "a-after")));
  llmA.reply(sse(openaiToolCall("browser_console", {}, "a-console")));
  llmA.reply(sse(openaiToolCall("browser_screenshot", {}, "a-shot")));
  llmA.reply(sse(openaiText("A ferdig")));
  llmB.reply(async (req, res) => {
    await aPaused.promise;
    await sse(openaiToolCall("browser_navigate", { url: `${base}/b` }, "b-nav"))(req, res);
  });
  llmB.reply(sse(openaiToolCall("browser_snapshot", {}, "b-snap")));
  llmB.reply(sse(openaiToolCall("browser_click", { text: "Trykk /b" }, "b-click")));
  llmB.reply(sse(openaiToolCall("browser_snapshot", {}, "b-after")));
  llmB.reply(sse(openaiText("B ferdig")));
  await Promise.all(threads.map((thread) => h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Kontroller din egen side." })));
  const eventsB = await h.finished(b.id);
  assert.ok(ofType(eventsB, "tool.finished").every((event) => event.status === "done"));
  assert.match(ofType(eventsB, "tool.finished").at(-1)!.result!, /Trykket \/b/);
  let tabs: BrowserTabInfo[] = [];
  await until(() => {
    const message = [...panel.received].reverse().find((m) => m.type === "browser.tabs");
    tabs = message?.type === "browser.tabs" ? message.tabs : [];
    return tabs.some((tab) => tab.threadId === a.id && tab.url === `${base}/a`) && tabs.some((tab) => tab.threadId === b.id && tab.url === `${base}/b`);
  }, "begge trådenes faner vises i panelet");
  const tabA = tabs.find((tab) => tab.threadId === a.id)!;
  const tabB = tabs.find((tab) => tab.threadId === b.id)!;
  assert.notEqual(tabA.id, tabB.id);
  // Inspect B, then browse manually while A still holds refs from its earlier snapshot.
  for (const [tabId, url] of [[tabB.id, `${base}/b`], ["manual", `${base}/bruker`]]) {
    panel.send({ type: "browser.open", projectId: project.id, tabId, width: 640, height: 480 });
    await panel.waitFor((m) => m.type === "browser.state" && m.tabId === tabId);
    panel.send({ type: "browser.navigate", projectId: project.id, tabId, url });
    await panel.waitFor((m) => m.type === "browser.state" && m.tabId === tabId && m.state.url === url);
  }
  resumeA.resolve();
  const resultsA = ofType(await h.finished(a.id), "tool.finished");
  assert.ok(resultsA.every((event) => event.status === "done"), JSON.stringify(resultsA));
  assert.match(resultsA[4].result!, /Trykket \/a/);
  assert.match(resultsA[4].result!, /fra A/);
  assert.match(resultsA[5].result!, /logg \/a/);
  assert.doesNotMatch(resultsA[5].result!, /logg \/b|logg \/bruker/);
  assert.equal(resultsA[6].result, `Skjermbilde av ${base}/a`);
  assert.equal((await h.app.browser.screenshot(project.id)).url, `${base}/bruker`, "agentverktøyene endrer ikke panelvalget");
  assert.match(await h.app.browser.snapshot(project.id, tabB.id), /Trykk \/b/);
  // The owner remains the same after a user closes a thread's tab. No fallback to B/manual.
  await h.app.browser.closeTab(project.id, tabA.id);
  assert.match(await h.app.browser.forThread(project.id, a.id).snapshot(project.id), /about:blank/);
  assert.equal((await h.app.browser.screenshot(project.id)).url, `${base}/bruker`);
  const other = await h.project();
  await h.app.browser.forThread(other.id, a.id).navigate(other.id, `${base}/annet-prosjekt`);
  assert.match(await h.app.browser.forThread(project.id, a.id).snapshot(project.id), /about:blank/);
  assert.throws(() => h.app.browser.forThread("local", a.id), /bare av brukeren/);
  // Browser restarts preserve thread ownership and recreate only the requested tab.
  await h.app.browser.close();
  await Promise.all([
    h.app.browser.forThread(project.id, a.id).navigate(project.id, `${base}/tilbake`),
    h.app.browser.forThread(project.id, b.id).navigate(project.id, `${base}/b-tilbake`),
  ]);
  const [sameA, sameAAgain, ownB] = await Promise.all([
    h.app.browser.forThread(project.id, a.id).snapshot(project.id),
    h.app.browser.forThread(project.id, a.id).snapshot(project.id),
    h.app.browser.forThread(project.id, b.id).snapshot(project.id),
  ]);
  assert.match(sameA, /Side \/tilbake/);
  assert.equal(sameAAgain, sameA, "samtidige kall til samme tråd gjenbruker fanen");
  assert.match(ownB, /Side \/b-tilbake/);
});


test("en fane som lukkes kan ikke adopteres av en ny tråd eller trådens erstatningsfane", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  for (const [file, title] of [["gammel.html", "Gammel A"], ["ny.html", "Ny A"], ["b.html", "Egen B"]]) {
    writeFileSync(path.join(project.path, file), `<title>${title}</title><button>${title}</button>`);
  }
  const a = h.app.browser.forThread(project.id, "lukket-tråd-a");
  const b = h.app.browser.forThread(project.id, "ny-tråd-b");
  await a.navigate(project.id, "gammel.html");
  // A deterministic transport stall: Chromium still lists the old page while close is awaiting.
  // Only the test accesses the context; public model/panel operations exercise the interleaving.
  const context = (h.app.browser as unknown as { context: BrowserContext }).context;
  const oldPage = context.pages().find((page) => page.url().endsWith("/gammel.html"))!;
  assert.ok(oldPage);
  const enteredClose = deferred();
  const releaseClose = deferred();
  const realClose = oldPage.close.bind(oldPage);
  const closeMock = t.mock.method(oldPage, "close", async (options?: Parameters<typeof oldPage.close>[0]) => {
    enteredClose.resolve();
    await releaseClose.promise;
    await realClose(options);
  });
  // Discover the actual owned tab through the same server messages the panel uses.
  const messages: ServerMessage[] = [];
  const viewer = { send: (message: ServerMessage) => { messages.push(message); }, buffered: () => 0 };
  await h.app.browser.attach(viewer, project.id, 640, 480, "manuell");
  await until(() => messages.some((message) => message.type === "browser.tabs" && message.tabs.some((tab) => tab.threadId === "lukket-tråd-a")), "trådeier er kjent");
  const tabsMessage = [...messages].reverse().find((message) => message.type === "browser.tabs");
  assert.ok(tabsMessage?.type === "browser.tabs");
  const tabId = tabsMessage.tabs.find((tab) => tab.threadId === "lukket-tråd-a")!.id;
  const closing = h.app.browser.closeTab(project.id, tabId);
  try {
    await enteredClose.promise;
    await Promise.all([a.navigate(project.id, "ny.html"), b.navigate(project.id, "b.html")]);
    assert.match(oldPage.url(), /\/gammel\.html$/, "ingen ny tråd navigerer den gamle siden mens den lukkes");
  } finally {
    releaseClose.resolve();
    await closing;
    closeMock.mock.restore();
  }
  assert.match(await a.snapshot(project.id), /Ny A/);
  assert.match(await b.snapshot(project.id), /Egen B/);
  assert.equal(context.pages().filter((page) => /\/(ny|b)\.html$/.test(page.url())).length, 2, "begge nye sider overlever gammel close-hendelse");
  await h.app.browser.detach(viewer, project.id);
});
