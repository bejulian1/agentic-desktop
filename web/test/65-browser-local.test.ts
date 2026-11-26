import assert from "node:assert/strict";
import http from "node:http";
import type { Page, WebSocketRoute } from "playwright-core";
import { flow, openTool, threadItem, waitFor } from "./harness.ts";

const pixel = (page: Page) => page.getByTestId("browser-canvas").evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext("2d")!.getImageData(Math.min(10, canvas.width - 1), Math.min(10, canvas.height - 1), 1, 1).data]);

flow("nettleseren uten prosjekt viser rammer, tar input og har historikk, søk og selvstendige nettleserfaner", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  let twoLoads = 0;
  const fake = http.createServer((request, response) => {
    if (request.url === "/favicon.ico") return void response.writeHead(204).end();
    if (request.url?.startsWith("/sok")) return void response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Lokal søkeside</title><body style='background:rgb(200,0,0)'>Søkeresultat");
    const two = request.url === "/to";
    if (two) twoLoads++;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>${two ? "Lokal side to" : "Lokal side en"}</title><style>body,button{margin:0;width:100vw;height:100vh;border:0;background:${two ? "rgb(200,0,0)" : "rgb(255,255,255)"}}</style><button id="b">Prøveside</button><script>const b=document.getElementById('b');b.onclick=()=>b.style.background='rgb(0,160,0)';addEventListener('keydown',e=>{if(e.key==='x')b.style.background='rgb(0,0,200)'})</script>`);
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  try {
    await h.api("PATCH", "/api/settings", { cookieOffer: "never", webSearchUrl: `${origin}/sok?q={q}` });
    await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
    await openTool(page, "Nettleser");
    await page.getByTestId("browser-newtab").waitFor();
    const address = page.getByRole("textbox", { name: "Adresse", exact: true });
    await address.fill(origin.replace("http://", ""));
    await address.press("Enter");
    await waitFor(async () => (await pixel(page))[0] > 240, "den lokale siden tegnes uten prosjekt");
    await page.getByTestId("browser-canvas").click();
    await waitFor(async () => { const [r, g] = await pixel(page); return r < 40 && g > 120; }, "pekerinput blir sendt til den lokale siden");
    await page.keyboard.press("x");
    await waitFor(async () => { const [r, , b] = await pixel(page); return r < 40 && b > 150; }, "tastaturinput blir sendt til den lokale siden");
    // A wider panel: the page gets a wider viewport and reflows. The frame is never stretched to the
    // stage meanwhile, which showed as the page growing and shrinking while the panel changed size.
    const canvas = page.getByTestId("browser-canvas");
    const frameWidth = () => canvas.evaluate((el: HTMLCanvasElement) => el.width);
    const narrow = await frameWidth();
    await canvas.evaluate((el: HTMLCanvasElement) => {
      const w = window as unknown as { __scale: number[] };
      w.__scale = [];
      const sample = () => { w.__scale.push(el.getBoundingClientRect().width / el.width); requestAnimationFrame(sample); };
      sample();
    });
    await page.getByRole("button", { name: "Fullvisning", exact: true }).first().click();
    await waitFor(async () => (await frameWidth()) > narrow + 100, "siden får en bredere visningsflate når panelet blir bredere");
    const stageWidth = await page.locator(".browser-stage").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await waitFor(async () => Math.abs((await frameWidth()) - stageWidth) <= 1, "visningsflaten er like bred som panelet");
    const scales = await page.evaluate(() => (window as unknown as { __scale: number[] }).__scale);
    assert.ok(scales.length > 3 && scales.every((scale) => Math.abs(scale - 1) < 0.01), `bildet av siden holder målestokken mens panelet endrer størrelse: ${Math.max(...scales)}`);
    await page.getByRole("button", { name: "Avslutt fullvisning", exact: true }).first().click();
    await waitFor(async () => Math.abs((await frameWidth()) - narrow) <= 1, "og smalere igjen");
    await address.fill(`${origin}/to`);
    await address.press("Enter");
    await waitFor(async () => (await address.inputValue()).endsWith("/to"), "side to er åpen");
    await page.locator(".browser-nav").getByRole("button", { name: "Tilbake", exact: true }).click();
    await waitFor(async () => await address.inputValue() === `${origin}/`, "tilbake virker uten prosjekt");
    await page.locator(".browser-nav").getByRole("button", { name: "Frem", exact: true }).click();
    await waitFor(async () => (await address.inputValue()).endsWith("/to"), "frem virker uten prosjekt");
    const beforeReload = twoLoads;
    await page.locator(".browser-nav").getByRole("button", { name: "Last på nytt", exact: true }).click();
    await waitFor(() => twoLoads > beforeReload, "oppfriskning laster siden på nytt");
    await page.getByRole("button", { name: "Nettleserhistorikk", exact: true }).click();
    await page.getByRole("menu", { name: "Nettleserhistorikk", exact: true }).getByRole("menuitem", { name: /Lokal side en/ }).click();
    await waitFor(async () => await address.inputValue() === `${origin}/`, "historikk åpner tidligere side");
    await address.fill("en lokal prøve");
    await address.press("Enter");
    await page.locator(".browser-tab.active .browser-tab-title", { hasText: "Lokal søkeside" }).waitFor();
    assert.equal(new URL(await address.inputValue()).searchParams.get("q"), "en lokal prøve");
    await page.getByRole("button", { name: "Ny nettleserfane", exact: true }).click();
    await page.getByTestId("browser-newtab").waitFor();
    assert.equal(await page.locator(".browser-tab").count(), 2);
    assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0, "nettleseren oppretter ikke et falskt prosjekt");
    await h.reload();
    await openTool(page, "Nettleser");
    await waitFor(async () => await page.locator(".browser-tab").count() === 2, "nettleserfanene bevares etter omlasting");
  } finally { fake.closeAllConnections(); await new Promise<void>((resolve) => fake.close(() => resolve())); }
});

flow("nettleserfeil vises lokalt med nytt forsøk og følger riktig fane", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  let fail = true;
  const fake = http.createServer((request, response) => {
    if (request.url === "/favicon.ico") return void response.writeHead(204).end();
    if (fail) return request.socket.destroy();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Prøv igjen lyktes</title><body style='background:rgb(0,160,0)'>Klar");
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    await h.api("PATCH", "/api/settings", { cookieOffer: "never" });
    await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
    await openTool(page, "Nettleser");
    await page.getByTestId("browser-newtab").waitFor();
    const original = await page.locator(".browser-tab.active").getAttribute("data-tab");
    const address = page.getByRole("textbox", { name: "Adresse", exact: true });
    await address.fill(`http://127.0.0.1:${(fake.address() as { port: number }).port}/retry`);
    await address.press("Enter");
    const error = page.locator(".browser-navigation-error");
    await error.getByRole("heading", { name: "Kunne ikke åpne siden", exact: true }).waitFor();
    assert.equal(await page.locator(".toast").filter({ hasText: /Fant ikke prosjektet|ERR_/ }).count(), 0);
    await page.getByRole("button", { name: "Ny nettleserfane", exact: true }).click();
    await page.getByTestId("browser-newtab").waitFor();
    assert.equal(await error.count(), 0, "andre faner arver ikke navigasjonsfeilen");
    await page.locator(`.browser-tab[data-tab="${original}"] .browser-tab-main`).click();
    await error.waitFor();
    fail = false;
    await error.getByRole("button", { name: "Prøv igjen", exact: true }).click();
    await page.locator(".browser-tab.active .browser-tab-title", { hasText: "Prøv igjen lyktes" }).waitFor();
    await waitFor(async () => (await pixel(page))[1] > 120, "nytt forsøk tegner siden");
    assert.equal(await error.count(), 0);
  } finally { fake.closeAllConnections(); await new Promise<void>((resolve) => fake.close(() => resolve())); }
});

flow("sidechat fra lokal nettleserfane bruker den fokuserte Kode-tråden", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  await h.api("PATCH", "/api/settings", { cookieOffer: "never" });
  await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
  const thread = await h.api("POST", "/api/threads", { projectId: null, mode: "code" });
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Lokal sidechatprøve" });
  await threadItem(page, thread.id).click();
  await waitFor(async () => await page.locator(".pane-inner.focused").getAttribute("data-thread-id") === thread.id, "lokal Kode-tråd er fokusert");
  await openTool(page, "Nettleser");
  const newtab = page.getByTestId("browser-newtab");
  await newtab.waitFor();
  const request = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/threads");
  const side = newtab.getByRole("button", { name: "Sidechat", exact: true });
  if (await side.isVisible()) await side.click();
  else {
    await newtab.getByRole("button", { name: "Flere verktøy", exact: true }).click();
    await page.getByRole("menu", { name: "Flere verktøy", exact: true }).getByRole("menuitem", { name: /^Sidechat/ }).click();
  }
  const body = (await request).postDataJSON();
  assert.equal(body.sideOf, thread.id, "sidechat er knyttet til den aktive tråden");
  assert.equal(body.mode, "code");
  assert.equal(body.projectId, null);
  await waitFor(async () => await page.locator(".pane-inner").count() === 2, "sidechat åpnes ved siden av originalen");
});

flow("en forsinket feil fra forrige nettadresse skjuler ikke siden som allerede lyktes", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  const fake = http.createServer((request, response) => {
    if (request.url === "/favicon.ico") return void response.writeHead(204).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Nyere side B</title><body style='margin:0;background:rgb(0,160,0)'>B er klar");
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  let client: WebSocketRoute | undefined;
  let delayedError: { type: "browser.error"; projectId: string; tabId?: string; requestId: string; command: string; message: string } | undefined;
  try {
    await h.api("PATCH", "/api/settings", { cookieOffer: "never" });
    // Delay A at the socket boundary. The backend test separately checks real CDP cancellation;
    // this controlled order proves that the renderer ignores A even after B's state/frame arrived.
    await page.routeWebSocket(/\/ws\?ticket=/, (socket) => {
      client = socket;
      const server = socket.connectToServer();
      socket.onMessage((raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === "browser.navigate" && message.url === `${origin}/slow`) {
          delayedError = { type: "browser.error", projectId: message.projectId, tabId: message.tabId, requestId: message.requestId, command: message.type, message: "Forsinket feil fra side A" };
          return;
        }
        server.send(raw);
      });
      server.onMessage((raw) => socket.send(raw));
    });
    await h.reload();
    await page.locator(".sidebar .mode-button").filter({ hasText: "Kode" }).click();
    await openTool(page, "Nettleser");
    await page.getByTestId("browser-newtab").waitFor();
    const address = page.getByRole("textbox", { name: "Adresse", exact: true });
    await address.fill(`${origin}/slow`);
    await address.press("Enter");
    await waitFor(() => !!delayedError, "første navigasjon har egen forespørsels-ID");
    assert.ok(delayedError!.requestId);
    await address.fill(`${origin}/good`);
    await address.press("Enter");
    await page.locator(".browser-tab.active .browser-tab-title", { hasText: "Nyere side B" }).waitFor();
    await waitFor(async () => (await pixel(page))[1] > 120, "B er ferdig tegnet før A-feilen leveres");
    client!.send(JSON.stringify(delayedError));
    await page.evaluate(() => new Promise<void>((resolve) => {
      let frames = 0;
      const sample = () => ++frames >= 12 ? resolve() : requestAnimationFrame(sample);
      requestAnimationFrame(sample);
    }));
    assert.equal(await page.locator(".browser-navigation-error").count(), 0, "utdatert feil overtar ikke den nyere navigasjonen");
    assert.equal(await address.inputValue(), `${origin}/good`);
    assert.ok((await pixel(page))[1] > 120, "B forblir synlig");
    assert.equal(await page.locator(".toast").filter({ hasText: "Forsinket feil fra side A" }).count(), 0);
  } finally { fake.closeAllConnections(); await new Promise<void>((resolve) => fake.close(() => resolve())); }
});
