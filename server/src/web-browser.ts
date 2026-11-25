// Security fix for round 13 (SPEC 27.2): the browser for web_search, web_fetch and the demo model's
// reads. It is not the Browser panel's Chrome (browser.ts):
// - Its own headless Chrome, started with chromium.launch() on first use and closed when it has not
//   been used for a while, like the panel's. Nothing is shared with the panel's profile, so the
//   cookies imported in round 12 (SPEC 26.4) and the user's logins never come here.
// - Each search or read gets a fresh incognito context (browser.newContext()) that is closed when
//   it is done: no cookies or storage carry over, nothing is written to disk, downloads are off and
//   service workers are blocked, so every request is seen by the checks below.
// - Only public addresses (web-guard.ts): the address is checked before the page is opened, every
//   request the page makes is checked in context.route, and all traffic goes through WebGuardProxy,
//   which checks again and connects only to the address it approved. That also covers redirects,
//   which context.route does not see, and DNS that changes its answer after the check.
import type { Browser, BrowserContext, Page, Route } from "playwright-core";
import type { WebSource } from "../../shared/protocol.ts";
import type { WebPage, WebReader } from "./agent/web.ts";
import { BLOCK_HEADER, PRIVATE_WEB_MESSAGE, WebBlockedError, WebGuard, WebGuardProxy, type WebTesting } from "./web-guard.ts";

// playwright-core is loaded on first use, not when the server starts.
let playwright: Promise<typeof import("playwright-core")> | undefined;
const loadPlaywright = () => (playwright ??= import("playwright-core"));

const NAV_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 5_000;
const SEARCH_RENDER_WAIT_MS = 2_500;
const DEFAULT_SIZE = { width: 1280, height: 800 };
const MAX_RESULTS = 8;
const MAX_FAVICON_BYTES = 64 * 1024;
const FAVICON_TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|webp|jpeg)$/;

function chromeUserAgent(browser: Browser): string {
  const match = /(\d+)\.\d+\.\d+\.\d+/.exec(browser.version?.() ?? "");
  const major = match?.[1] ?? "131";
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// Lightweight static HTML fallback when a JS-rendered search engine yields 0 results.
// Never triggers for localhost/loopback/IP test URLs or if we are already on html.duckduckgo.com.
function duckDuckGoHtmlFallback(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "html.duckduckgo.com" ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
      host.includes(":")
    ) {
      return null;
    }
    const query = parsed.searchParams.get("q") || parsed.searchParams.get("query") || parsed.searchParams.get("p");
    if (!query || !query.trim()) return null;
    return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`;
  } catch {
    return null;
  }
}

export interface WebBrowserOptions {
  idleMs: number;
  env: () => Record<string, string>;
  appOrigins: () => string[];
  testing?: WebTesting; // only from tests, see WebTesting in web-guard.ts
}

interface Running {
  browser: Browser;
  proxy: WebGuardProxy;
}

// What one search or read has seen: a request refused by the checks.
interface Operation {
  blocked: boolean;
}

export class WebBrowser implements WebReader {
  private options: WebBrowserOptions;
  readonly guard: WebGuard;
  private running?: Running;
  private launching?: Promise<Running>;
  private operations = new Set<Operation>();
  private faviconCache = new Map<string, string | null>();
  private idleTimer?: NodeJS.Timeout;
  private closing?: Promise<void>;
  private disposed = false;
  private busy = 0;

  constructor(options: WebBrowserOptions) {
    this.options = options;
    this.guard = new WebGuard({ appOrigins: options.appOrigins, testing: options.testing });
  }

  get isRunning(): boolean {
    return this.running !== undefined;
  }

  private launch(): Promise<Running> {
    if (this.disposed) return Promise.reject(new Error("Serveren stopper"));
    if (this.running) return Promise.resolve(this.running);
    this.launching ??= (async () => {
      // The proxy cannot tell which search a refusal belongs to, so every one under way hears of it.
      // It is only used to choose the error message.
      const proxy = new WebGuardProxy(this.guard, () => {
        for (const op of this.operations) op.blocked = true;
      });
      const server = await proxy.start();
      try {
        const { chromium } = await loadPlaywright();
        const browser = await chromium.launch({
          channel: "chrome",
          headless: true, // Never a window on the user's desktop.
          chromiumSandbox: true,
          env: this.options.env(),
          // Everything goes through the proxy, loopback too: "<-loopback>" removes Chrome's own
          // exception for localhost, and Playwright keeps it when it is given here.
          proxy: { server, bypass: "<-loopback>" },
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
          args: [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
            "--dns-prefetch-disable",
            // WebRTC only through the proxy, so it cannot reach the local network over UDP.
            "--force-webrtc-ip-handling-policy",
            "--webrtc-ip-handling-policy=disable_non_proxied_udp",
          ],
        });
        const running = { browser, proxy };
        this.running = running;
        browser.on("disconnected", () => {
          if (this.running !== running) return;
          this.running = undefined;
          clearTimeout(this.idleTimer);
          void proxy.close();
        });
        return running;
      } catch (err) {
        await proxy.close();
        throw err;
      }
    })().finally(() => {
      this.launching = undefined;
    });
    return this.launching;
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.closeIfIdle(), this.options.idleMs);
    this.idleTimer.unref();
  }

  private async closeIfIdle(): Promise<void> {
    if (this.busy > 0 || this.launching) return this.touch();
    await this.close();
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      clearTimeout(this.idleTimer);
      await this.launching?.catch(() => undefined);
      const running = this.running;
      this.running = undefined;
      await running?.browser.close().catch(() => undefined);
      await running?.proxy.close();
    })().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.close();
  }

  // Every request a page makes, its own address included, before it leaves Chrome.
  private async guardRoute(route: Route, op: Operation): Promise<void> {
    try {
      await this.guard.check(route.request().url());
    } catch (err) {
      if (err instanceof WebBlockedError) op.blocked = true;
      await route.abort(err instanceof WebBlockedError ? "blockedbyclient" : "namenotresolved").catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  }

  // Opens an address in a fresh incognito context, runs fn on the page, and closes it all again.
  private async withPage<T>(raw: string, signal: AbortSignal | undefined, fn: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    this.busy++;
    const op: Operation = { blocked: false };
    this.operations.add(op);
    let context: BrowserContext | undefined;
    let shown = raw;
    const onAbort = () => void context?.close().catch(() => undefined);
    try {
      const checked = await this.guard.check(raw);
      shown = checked.url;
      const { browser } = await this.launch();
      signal?.throwIfAborted();
      context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
        viewport: DEFAULT_SIZE,
        locale: "nb-NO",
        userAgent: chromeUserAgent(browser),
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      await context.route("**/*", (route) => this.guardRoute(route, op));
      const page = await context.newPage();
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
      page.on("popup", (popup) => void popup.close().catch(() => undefined));
      page.setDefaultTimeout(ACTION_TIMEOUT_MS);
      const response = await page.goto(checked.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      if (response?.headers()[BLOCK_HEADER]) throw new WebBlockedError();
      await page.waitForLoadState("load", { timeout: 3000 }).catch(() => undefined);
      signal?.throwIfAborted();
      // Where the page ended up, after redirects and its own scripts. A navigation the checks
      // stopped leaves Chrome's error page.
      const final = page.url();
      if (op.blocked && !/^https?:/.test(final)) throw new WebBlockedError();
      await this.guard.check(final);
      return await fn(page, context);
    } catch (err) {
      signal?.throwIfAborted();
      if (err instanceof WebBlockedError) throw new Error(err.message);
      const message = (err as Error).message ?? "";
      if (/ERR_BLOCKED_BY_CLIENT/.test(message) || (op.blocked && /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY/.test(message))) throw new Error(PRIVATE_WEB_MESSAGE);
      throw new Error(`Kunne ikke åpne ${shown}: ${message.split("\n")[0]}`);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.operations.delete(op);
      await context?.close().catch(() => undefined);
      this.busy--;
      if (this.running) this.touch();
    }
  }

  // An icon, fetched in the same incognito context and through the same checks, kept as a data URL
  // of at most 64 KB.
  private async favicon(context: BrowserContext, iconUrl: string): Promise<string | null> {
    if (this.faviconCache.has(iconUrl)) return this.faviconCache.get(iconUrl)!;
    let found: string | null = null;
    if (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|webp|jpeg)[;,]/.test(iconUrl)) {
      found = iconUrl.length <= MAX_FAVICON_BYTES * 1.4 ? iconUrl : null;
    } else if (/^https?:/.test(iconUrl)) {
      try {
        await this.guard.check(iconUrl);
        // context.request is not seen by context.route, but it uses the browser's proxy, so the
        // proxy checks it and every redirect. The context is fresh, so no cookies go with it.
        const res = await context.request.get(iconUrl, { timeout: 3000, maxRedirects: 3, failOnStatusCode: false });
        const type = (res.headers()["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (res.ok() && FAVICON_TYPES.test(type)) {
          const body = await res.body();
          if (body.length > 0 && body.length <= MAX_FAVICON_BYTES) found = `data:${type};base64,${body.toString("base64")}`;
        }
        await res.dispose().catch(() => undefined);
      } catch {
        found = null;
      }
    }
    if (this.faviconCache.size >= 200) this.faviconCache.delete(this.faviconCache.keys().next().value!);
    this.faviconCache.set(iconUrl, found);
    return found;
  }

  private async extractSearchPage(url: string, signal?: AbortSignal): Promise<WebSource[]> {
    return this.withPage(url, signal, async (page, context) => {
      let found = await page.evaluate(readResults, MAX_RESULTS);
      // JS-rendered search engines may paint results slightly after domcontentloaded/load.
      if (!found.length) {
        const deadline = Date.now() + SEARCH_RENDER_WAIT_MS;
        while (!found.length && Date.now() < deadline) {
          signal?.throwIfAborted();
          await page.waitForTimeout(Math.min(250, Math.max(50, deadline - Date.now()))).catch(() => undefined);
          found = await page.evaluate(readResults, MAX_RESULTS).catch(() => []);
        }
      }
      if (!found.length) return [];
      // Icons for the first sites, within a short time.
      const icons = new Map<string, string | null>();
      const origins = [...new Set(found.map((s) => originOf(s.url)).filter(Boolean))].slice(0, 6);
      await Promise.race([
        Promise.all(origins.map(async (origin) => icons.set(origin, await this.favicon(context, `${origin}/favicon.ico`)))),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
      return found.map((s) => {
        const favicon = icons.get(originOf(s.url));
        return favicon ? { ...s, favicon } : s;
      });
    });
  }

  async searchPage(url: string, signal?: AbortSignal): Promise<WebSource[]> {
    const primary = await this.extractSearchPage(url, signal);
    if (primary.length) return primary;
    const fallbackUrl = duckDuckGoHtmlFallback(url);
    if (!fallbackUrl) return primary;
    try {
      return await this.extractSearchPage(fallbackUrl, signal);
    } catch {
      signal?.throwIfAborted();
      return primary;
    }
  }

  async readPage(url: string, signal?: AbortSignal): Promise<WebPage> {
    return this.withPage(url, signal, async (page, context) => {
      const content = await page.evaluate(() => {
        const root = document.querySelector("main, article, [role=main]") ?? document.body;
        const link = document.querySelector<HTMLLinkElement>('link[rel~="icon" i], link[rel="shortcut icon" i]');
        return { title: document.title, text: (root as HTMLElement | null)?.innerText ?? "", icon: link ? String(link.href) : "" };
      });
      const at = page.url();
      let favicon: string | null = null;
      try {
        favicon = await Promise.race([
          this.favicon(context, content.icon ? new URL(content.icon, at).href : new URL("/favicon.ico", at).href),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);
      } catch {
        favicon = null;
      }
      return { url: at, title: content.title.trim(), text: content.text, ...(favicon ? { favicon } : {}) };
    });
  }
}

// Runs in the page: extracts results from DuckDuckGo static HTML (.result__a / .result__snippet)
// or from heading links on standard search pages. Redirect links (…/l/?uddg=…) on the same site
// family are unwrapped to their destination. Without headings, external links are taken instead.
function readResults(max: number): WebSource[] {
  const here = location.hostname.toLowerCase();
  const sameSiteFamily = (host: string) => {
    const h = host.toLowerCase();
    return h === here || h.endsWith(`.${here}`) || here.endsWith(`.${h}`);
  };
  const target = (href: string): string => {
    try {
      const url = new URL(href, location.href);
      if (sameSiteFamily(url.hostname)) {
        for (const key of ["uddg", "url", "u", "q", "target"]) {
          const value = url.searchParams.get(key);
          if (value && /^https?:\/\//.test(value)) return value;
        }
      }
      return url.href;
    } catch {
      return "";
    }
  };
  const out: WebSource[] = [];
  const seen = new Set<string>();
  const ddgLinks = [...document.querySelectorAll<HTMLAnchorElement>("a.result__a[href]")];
  if (ddgLinks.length) {
    for (const a of ddgLinks) {
      const url = target(a.getAttribute("href") ?? "");
      if (!/^https?:/.test(url) || seen.has(url)) continue;
      const title = a.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!title) continue;
      const container = a.closest(".result, .web-result, .results_links") ?? a.parentElement;
      const snippetEl = container?.querySelector(".result__snippet");
      const snippet = snippetEl?.textContent?.replace(/\s+/g, " ").trim().slice(0, 220) ?? "";
      seen.add(url);
      out.push({ title: title.slice(0, 160), url, ...(snippet ? { snippet } : {}) });
      if (out.length >= max) break;
    }
    if (out.length) return out;
  }
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const headed = anchors.map((a) => ({ a, heading: a.closest("h1, h2, h3, h4") ?? a.querySelector("h1, h2, h3, h4") })).filter((x) => x.heading);
  const list = headed.length ? headed : anchors.map((a) => ({ a, heading: null as Element | null }));
  for (const { a, heading } of list) {
    const url = target(a.getAttribute("href") ?? "");
    if (!/^https?:/.test(url) || seen.has(url)) continue;
    if (!heading && new URL(url).hostname.toLowerCase() === here) continue;
    const title = (heading ?? a).textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!title) continue;
    // The snippet: the text of the nearest box around the result that has more than the title.
    let box: Element | null = heading ?? a;
    let snippet = "";
    for (let i = 0; box && i < 4; i++, box = box.parentElement) {
      const text = (box as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length > title.length + 20) {
        snippet = text.replace(title, "").trim().slice(0, 220);
        break;
      }
    }
    seen.add(url);
    out.push({ title: title.slice(0, 160), url, ...(snippet ? { snippet } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}
