// Security fix for round 13 (SPEC 27.2): web search and web reading run in their own Chrome without
// cookies, and only reach public addresses. Everything here is local: test servers on 127.0.0.1
// and stubbed DNS. Names that look public (offentlig.test) are given a public-looking address by
// the stub, and the test-only connect hook sends that address to a local test server, so no
// request ever leaves the machine.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { ThreadEvent } from "../../shared/protocol.ts";
import { ImportedCookies } from "../src/browser-cookies.ts";
import { addressKind, PRIVATE_WEB_MESSAGE, WebBlockedError, WebGuard, type WebTesting } from "../src/web-guard.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, type Harness } from "./helpers.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PUBLIC = "93.184.216.34"; // given by the stubbed DNS only; the connect hook sends it to a local server

interface Seen {
  path: string;
  cookie: string;
}

// A local site. pages maps a path to a handler; every request is noted with its Cookie header.
async function site(t: TestContext, pages: Record<string, (res: http.ServerResponse, port: number) => void> = {}): Promise<{ port: number; url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    seen.push({ path: url.pathname, cookie: req.headers.cookie ?? "" });
    const port = (server.address() as AddressInfo).port;
    const page = pages[url.pathname];
    if (page) return page(res, port);
    if (url.pathname.endsWith(".png") || url.pathname === "/favicon.ico") return void res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Side ${url.pathname}</title><main><p>Innhold på ${url.pathname}</p></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const port = (server.address() as AddressInfo).port;
  return { port, url: `http://127.0.0.1:${port}`, seen };
}

async function chatSay(h: Harness, tools: Record<string, boolean>, text: string): Promise<ThreadEvent[]> {
  const thread = await h.api("POST", "/api/threads", { projectId: null, mode: "chat", chatTools: tools });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text });
  return h.finished(thread.id);
}

test("web reading has no cookies: an imported login reaches the panel's Chrome, never web_fetch", async (t) => {
  const h = await startHarness(t, { webTesting: { allowLoopback: true } });
  const local = await site(t, {
    "/les": (res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end('<!doctype html><title>Lesbar</title><link rel="icon" href="/les-ikon.png"><main>Offentlig tekst</main>'),
  });
  const base = `http://localhost:${local.port}`;

  // An import for localhost, written the way the import flow writes it (browser-cookies.ts).
  const dataDir = h.app.config.dataDir;
  new ImportedCookies(path.join(dataDir, "chrome-profile"), dataDir).add([
    { site: "localhost", cookie: { name: "okt", value: "innlogget", domain: "localhost", path: "/", expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: true, secure: false, sameSite: "Lax" } },
  ], "Chrome");

  // The panel's Chrome has it.
  const project = await h.project();
  await h.app.browser.navigate(project.id, `${base}/panel`);
  assert.match(local.seen.find((s) => s.path === "/panel")!.cookie, /okt=innlogget/);

  // The web reader does not: not for the page, and not for its icon.
  const page = await h.app.web.readPage(`${base}/les`);
  assert.equal(page.title, "Lesbar");
  assert.match(page.text, /Offentlig tekst/);
  assert.match(page.favicon ?? "", /^data:image\/png;base64,/);
  const read = local.seen.filter((s) => s.path === "/les" || s.path === "/les-ikon.png");
  assert.deepEqual([...new Set(read.map((s) => s.path))].sort(), ["/les", "/les-ikon.png"]);
  assert.ok(read.every((s) => s.cookie === ""), `no Cookie header: ${JSON.stringify(read)}`);

  // The same through Chat with Les nettsider, which is the demo model's way of reading.
  const events = await chatSay(h, { fetch: true }, `Hva står det på ${base}/chat-les ?`);
  const finished = ofType(events, "tool.finished").at(-1)!;
  assert.equal(finished.status, "done", finished.result ?? "");
  assert.equal(local.seen.find((s) => s.path === "/chat-les")?.cookie, "");

  // Two different Chromes, and the panel's still has the login.
  assert.equal(h.app.browser.running, true);
  assert.equal(h.app.web.isRunning, true);
  await h.app.browser.navigate(project.id, `${base}/panel-igjen`);
  assert.match(local.seen.find((s) => s.path === "/panel-igjen")!.cookie, /okt=innlogget/);
});

test("web reading refuses local and private addresses with the test option off, before anything is sent", async (t) => {
  // No testing at all: the production guard. Literal addresses and local names need no DNS.
  const guard = new WebGuard({ appOrigins: () => [] });
  const refused = [
    "http://127.0.0.1/", "http://127.8.9.10:4318/", "http://localhost:4318/", "http://LOCALHOST./", "http://app.localhost/",
    "http://[::1]/", "http://[::]/", "http://0.0.0.0/", "http://0/", "http://2130706433/", "http://0x7f.1/",
    "http://10.0.0.1/", "http://172.16.5.4/", "http://192.168.1.1/", "http://100.64.0.1/", "http://100.100.100.200/",
    "http://169.254.169.254/latest/meta-data/", "http://[fd00:ec2::254]/", "http://[fe80::1]/", "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:a00:1]/", "http://[64:ff9b::7f00:1]/", "http://[2002:c0a8:101::1]/",
    "http://metadata.google.internal/", "http://skriver.local/", "http://ruter.lan/", "http://224.0.0.1/",
  ];
  for (const url of refused) await assert.rejects(guard.check(url), (err) => err instanceof WebBlockedError && err.message === PRIVATE_WEB_MESSAGE, url);
  await assert.rejects(guard.check("file:///etc/passwd"), /Bare http- og https-adresser/);
  for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2a00:1450:4010::64"]) assert.equal(addressKind(ip), "public", ip);
  assert.equal(addressKind("::1"), "loopback");
  assert.equal(addressKind("ikke-en-adresse"), "private");

  // Through the app, with stubbed DNS and loopback not allowed.
  const lookups: string[] = [];
  const webTesting: WebTesting = {
    lookup: async (host) => {
      lookups.push(host);
      if (host === "intern.test") return ["127.0.0.1"];
      if (host === "blandet.test") return [PUBLIC, "10.1.2.3"];
      throw new Error(`ENOTFOUND ${host}`);
    },
  };
  const h = await startHarness(t, { webTesting });
  const local = await site(t);
  const urls = [
    `http://127.0.0.1:${local.port}/`, `http://localhost:${local.port}/`, `http://[::1]:${local.port}/`,
    "http://10.0.0.1/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
    `http://intern.test:${local.port}/`, "http://blandet.test/",
  ];
  for (const url of urls) {
    await assert.rejects(h.app.web.readPage(url), (err: Error) => err.message === PRIVATE_WEB_MESSAGE, url);
    await assert.rejects(h.app.web.searchPage(url), (err: Error) => err.message === PRIVATE_WEB_MESSAGE, url);
  }
  assert.deepEqual([...new Set(lookups)].sort(), ["blandet.test", "intern.test"], "only names are looked up, and localhost is refused by name");
  assert.equal(h.app.web.isRunning, false, "refused before Chrome was even started");

  // What the model sees: the short message, as an error from web_fetch.
  let events = await chatSay(h, { fetch: true }, `Hva står det på http://127.0.0.1:${local.port}/hemmelig ?`);
  let finished = ofType(events, "tool.finished").at(-1)!;
  assert.equal(finished.status, "error");
  assert.match(finished.result ?? "", /Lokale og private adresser kan ikke leses med nettlesing/);

  // The search page from Settings goes through the same check when it is used.
  await h.api("PATCH", "/api/settings", { webSearchUrl: `http://127.0.0.1:${local.port}/sok?q={q}` });
  events = await chatSay(h, { web: true }, "søk på nettet etter nordlys");
  finished = ofType(events, "tool.finished").at(-1)!;
  assert.equal(finished.status, "error");
  assert.match(finished.result ?? "", /Lokale og private adresser/);
  assert.deepEqual(local.seen, [], "the local server never got a request");
});

test("redirects, subresources and a DNS answer that changes cannot reach a private address", async (t) => {
  const secret = await site(t);
  let changing = 0;
  const pub = await site(t, {
    "/til-loopback": (res) => res.writeHead(302, { location: `http://127.0.0.1:${secret.port}/hemmelig` }).end(),
    "/til-navn": (res) => res.writeHead(301, { location: `http://intern.test:${secret.port}/hemmelig` }).end(),
    "/til-metadata": (res) => res.writeHead(307, { location: "http://169.254.169.254/latest/meta-data/" }).end(),
    "/via-skript": (res) => res.writeHead(200, { "content-type": "text/html" }).end(`<title>skript</title><script>location.href = "http://127.0.0.1:${secret.port}/hemmelig"</script>`),
    "/med-ressurser": (res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>Ressurser</title>
      <main>Siden finnes</main>
      <img src="http://127.0.0.1:${secret.port}/spor.png">
      <img src="http://intern.test:${secret.port}/spor2.png">
      <script>fetch("http://127.0.0.1:${secret.port}/data").catch(() => {}); new Image().src = "http://[::1]:${secret.port}/spor3.png";</script>`),
  });
  const webTesting: WebTesting = {
    lookup: async (host) => {
      if (host === "offentlig.test") return [PUBLIC];
      if (host === "intern.test") return ["127.0.0.1"];
      // DNS rebinding: public the first time it is asked, loopback after that.
      if (host === "skiftende.test") return changing++ === 0 ? [PUBLIC] : ["127.0.0.1"];
      throw new Error(`ENOTFOUND ${host}`);
    },
    // Only the stubbed public address is served, by the local "public" server. Anything else would
    // go to a closed port; nothing else gets this far.
    connect: (address) => (address === PUBLIC ? { host: "127.0.0.1", port: pub.port } : { host: "127.0.0.1", port: 9 }),
  };
  const h = await startHarness(t, { webTesting });

  // The way there is allowed: the page is read through the proxy.
  const ok = await h.app.web.readPage("http://offentlig.test/med-ressurser");
  assert.equal(ok.title, "Ressurser");
  assert.equal(ok.url, "http://offentlig.test/med-ressurser");

  for (const way of ["/til-loopback", "/til-navn", "/til-metadata", "/via-skript"]) {
    await assert.rejects(h.app.web.readPage(`http://offentlig.test${way}`), (err: Error) => err.message === PRIVATE_WEB_MESSAGE, way);
    assert.ok(pub.seen.some((s) => s.path === way), `${way} was asked for`);
  }

  // Rebinding: the address that was checked is the one connected to, also on the next requests.
  const rebound = await h.app.web.readPage("http://skiftende.test/etter-sjekk");
  assert.equal(rebound.title, "Side /etter-sjekk");
  assert.ok(pub.seen.some((s) => s.path === "/etter-sjekk"));

  assert.deepEqual(secret.seen, [], "the private server never got a request");
});

test("Kode's browser tools still open localhost, as before", async (t) => {
  // No test option: the production setup.
  const h = await startHarness(t);
  const local = await site(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  assert.match(await h.app.browser.navigate(project.id, `http://localhost:${local.port}/utvikling`), /Åpnet http:\/\/localhost:\d+\/utvikling/);
  assert.match(await h.app.browser.snapshot(project.id), /Innhold på \/utvikling/);

  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const modelId = (await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 })).id;
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("browser_navigate", { url: `http://127.0.0.1:${local.port}/fra-agenten` }, "n1")));
  llm.reply(sse(openaiToolCall("browser_snapshot", {}, "s1")));
  llm.reply(sse(openaiText("Ferdig.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "åpne utviklingsserveren" });
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "tool.finished").map((e) => e.status), ["done", "done"]);
  assert.match(ofType(events, "tool.finished")[1].result ?? "", /Innhold på \/fra-agenten/);
  assert.equal(h.app.web.isRunning, false, "the web reader's Chrome was not involved");
});
