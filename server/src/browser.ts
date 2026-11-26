// One headless Chrome with its own profile, and pages per project: one per tab in the Browser panel.
// The user's panel (screencast and input over CDP) and the agent's tools act on the same pages; the
// agent uses its own thread tab. Chrome starts on first use and closes when nobody has
// used it for a while.
//
// Round 10 (SPEC 23.1): tabs. The first tab has the id "" and is the page every project had before,
// for older callers. Each tab's favicon is read from the
// page's own <link rel=icon> (or /favicon.ico) and sent as a small data URL.
//
// Web search and web reading for the model (round 13) do not use this Chrome: its profile holds the
// imported cookies (SPEC 26.4). They have their own, without cookies and only for public addresses,
// in web-browser.ts.
//
// SPEC 29.3: in the Electron app the pages are real views in the window instead (desktop/
// browser-view.ts). Playwright connects to them over CDP through a channel to the Electron main
// process (browser-panel.ts), and everything below works the same on both, except that a panel in
// the Electron window shows the page itself and needs no frames. playwright-core is loaded on
// first use, not when the server starts.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, CDPSession, ConnectOverCDPTransport, Locator, Page } from "playwright-core";
import type { BrowserAnnotationSnapshot, BrowserInput, BrowserState, BrowserTabInfo, ServerMessage, ThemeSetting } from "../../shared/protocol.ts";
import { annotationElements } from "./annotation-snapshot.ts";
import type { BrowserTools } from "./agent/tools.ts";
import type { ImportedCookies } from "./browser-cookies.ts";
import { HttpError } from "./errors.ts";
import { LOCAL_PANEL } from "./paths.ts";
import type { Downloads } from "./downloads.ts";
import { connectPanel, panelAvailable } from "./browser-panel.ts";

let playwright: Promise<typeof import("playwright-core")> | undefined;
const loadPlaywright = () => (playwright ??= import("playwright-core"));

// The panel's partition in the Electron app belongs with the profile folder: when Lagring empties
// the folder, this file goes with it, and the partition is emptied the next time it is used.
const PANEL_MARKER = "agentic-panel-partition";
// In the Electron app, a page nobody shows and the agent has not used for a while is let go this
// long after the panel closed (SPEC 29.3), instead of after the usual idle time.
const PANEL_GRACE_MS = Number(process.env.AD_BROWSER_PANEL_GRACE_MS ?? 30_000);

const NAV_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 5_000;
const MAX_CONSOLE = 200;
const MAX_BUFFERED_FRAME = 2 * 1024 * 1024;
const DEFAULT_SIZE = { width: 1280, height: 800 };
export const MAX_TABS = 12; // per project
const MAX_FAVICON_BYTES = 64 * 1024;
const FAVICON_TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|webp|jpeg)$/;

// A tab id from a client: short letters, digits and dashes. Anything else is the first tab.
export function cleanTabId(raw: unknown): string {
  return typeof raw === "string" && /^[a-z0-9-]{1,40}$/i.test(raw) ? raw : "";
}
const keyOf = (projectId: string, tabId: string) => (tabId ? `${projectId}\u0001${tabId}` : projectId);

export interface BrowserClient {
  send(message: ServerMessage): void;
  buffered(): number;
}

interface Session {
  projectId: string;
  tabId: string; // "" for the first tab
  key: string;
  favicon?: string; // data URL
  faviconFor?: string; // the page URL it was read for
  page: Page;
  cdp: CDPSession;
  viewers: Set<BrowserClient>;
  frameViewers: Set<BrowserClient>; // the viewers that get frames: all of them, except panels in the Electron window
  console: string[];
  screencasting: boolean;
  unackedFrame?: number;
  loading: boolean;
  navigation?: { from: string; url: string };
  pushing: boolean;
  pushAgain: boolean;
  width: number;
  height: number;
  viewport?: { width: number; height: number }; // the size the page was last given
  resizing?: Promise<void>;
  downloadStaging?: string; // where Chrome writes downloads for this page, see downloads.ts
}

export interface BrowserOptions {
  profileDir: string;
  idleMs: number;
  env: () => Record<string, string>;
  appOrigins: () => string[];
  resolveUrl: (projectId: string, url: string) => Promise<string>;
  downloads?: Downloads; // without it, downloads stay off
  cookies?: ImportedCookies; // round 12: cookies imported from the user's browser (SPEC 26.4)
  askSignedIn?: () => boolean; // ask before the agent acts on a site with imported cookies, default true
  appearance?: () => ThemeSetting; // preferred color scheme emulated for pages, default "system"
  // SPEC 29.3: the Electron app's panel. Without it (npm start, tests), the server's own Chrome.
  panel?: () => Promise<ConnectOverCDPTransport | null>;
}

const VIRTUAL_KEYS: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20, Escape: 27, " ": 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Insert: 45, Delete: 46, Meta: 91,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

function virtualKey(key: string): number {
  if (VIRTUAL_KEYS[key]) return VIRTUAL_KEYS[key];
  if (key.length === 1) {
    const upper = key.toUpperCase().charCodeAt(0);
    if ((upper >= 65 && upper <= 90) || (upper >= 48 && upper <= 57)) return upper;
  }
  return 0;
}

export class BrowserManager implements BrowserTools {
  private options: BrowserOptions;
  private context?: BrowserContext;
  private browser?: Browser; // the Electron app's panel, connected over CDP
  private native = false; // the pages are views in the Electron window
  private agentAt = 0; // when the agent last used the browser
  private launching?: Promise<BrowserContext>;
  private sessions = new Map<string, Promise<Session>>(); // by keyOf(projectId, tabId), in the order the tabs were opened
  private activeTabs = new Map<string, string>(); // the tab each project's panel showed last
  private threadOwners = new Map<string, string>(); // by project/tab key; survives tab recreation
  private watchers = new Map<string, Set<BrowserClient>>(); // panels open per project, for the list of tabs
  private faviconCache = new Map<string, string | null>();
  private pagesInUse = new Set<Page>();
  private ready = new Map<string, Session>(); // sessions that have started, for the agent's check of the page it is on
  private signedInGrants = new Set<string>(); // "<threadId>\u0001<site>": the user said yes once in that thread
  private idleTimer?: NodeJS.Timeout;
  private closing?: Promise<void>;
  private disposed = false;
  private busy = 0; // operations under way, which the idle timer must wait for

  constructor(options: BrowserOptions) {
    this.options = { ...options, panel: options.panel ?? (panelAvailable() ? () => connectPanel() : undefined) };
  }

  // A model owns one deterministic tab per project/thread. It remains a normal, visible panel
  // tab; selecting another tab only changes the user's view. Legacy callers retain panel behavior.
  forThread(projectId: string, threadId: string): BrowserTools {
    if (projectId === LOCAL_PANEL) throw new HttpError(403, "Nettleseren uten prosjekt brukes bare av brukeren");
    const tabId = `thread-${createHash("sha256").update(threadId).digest("hex").slice(0, 32)}`;
    this.threadOwners.set(keyOf(projectId, tabId), threadId);
    const active = () => { this.agentAt = Date.now(); };
    return {
      navigate: (_project, url) => { active(); return this.navigate(projectId, url, tabId); },
      snapshot: () => this.snapshot(projectId, tabId),
      click: (_project, target) => this.click(projectId, target, tabId),
      type: (_project, target, value, submit) => this.type(projectId, target, value, submit, tabId),
      screenshot: () => { active(); return this.screenshot(projectId, tabId); },
      console: () => this.console(projectId, tabId),
      signedInSite: (_project, _thread, url) => this.signedInSite(projectId, threadId, url, tabId),
      grantSignedIn: (_thread, site) => this.grantSignedIn(threadId, site),
    };
  }

  get running(): boolean {
    return this.context !== undefined;
  }

  // The pages are views in the Electron window (SPEC 29.3), known once the browser has started.
  get inWindow(): boolean {
    return this.native;
  }

  private launch(): Promise<BrowserContext> {
    if (this.disposed) return Promise.reject(new Error("Serveren stopper"));
    if (this.context) return Promise.resolve(this.context);
    mkdirSync(this.options.profileDir, { recursive: true, mode: 0o700 });
    this.launching ??= (async () => {
      const { chromium } = await loadPlaywright();
      const transport = this.options.panel ? await this.options.panel().catch(() => null) : null;
      let context: BrowserContext;
      if (transport) {
        const browser = await chromium.connectOverCDP(transport, { isLocal: true, noDefaults: true, timeout: 15_000 });
        context = browser.contexts()[0];
        this.browser = browser;
        this.native = true;
        browser.on("disconnected", () => this.onChromeGone());
        // A profile folder emptied in Lagring empties the panel's partition too.
        const marker = path.join(this.options.profileDir, PANEL_MARKER);
        if (!existsSync(marker)) {
          const root = await browser.newBrowserCDPSession();
          await (root.send as (method: string) => Promise<unknown>)("Agentic.clearData").catch(() => undefined);
          await root.detach().catch(() => undefined);
          writeFileSync(marker, "Nettleserpanelet i Electron-appen bruker denne profilen.\n", { mode: 0o600 });
        }
      } else {
        context = await chromium.launchPersistentContext(this.options.profileDir, {
          channel: "chrome",
          headless: true, // Never a window on the user's desktop.
          chromiumSandbox: true, // The agent visits pages we do not control.
          viewport: DEFAULT_SIZE,
          env: this.options.env(),
          acceptDownloads: false,
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
          args: ["--no-first-run", "--no-default-browser-check", "--disable-sync"],
        });
        this.native = false;
        context.on("close", () => this.onChromeGone());
      }
      // Imported cookies go in before any page is opened (SPEC 26.4).
      await this.options.cookies?.apply(context, this.native ? "panel" : "chrome").catch(() => undefined);
      this.context = context;
      return context;
    })().finally(() => {
      this.launching = undefined;
    });
    return this.launching;
  }

  private session(projectId: string, tabId: string): Promise<Session> {
    this.touch();
    const key = keyOf(projectId, tabId);
    let session = this.sessions.get(key);
    if (!session) {
      const open = [...this.sessions.keys()].filter((k) => k === projectId || k.startsWith(`${projectId}\u0001`)).length;
      if (open >= MAX_TABS) return Promise.reject(new HttpError(400, `Høyst ${MAX_TABS} faner per prosjekt`));
      session = this.createSession(projectId, tabId);
      this.sessions.set(key, session);
      session.then((s) => {
        this.ready.set(key, s);
        this.pushTabs(projectId);
      }, () => this.sessions.delete(key));
    }
    return session;
  }

  // Panel commands and legacy callers without a tab use the last panel selection.
  private tabFor(projectId: string, tabId?: string): string {
    return tabId === undefined ? (this.activeTabs.get(projectId) ?? "") : cleanTabId(tabId);
  }

  private async createSession(projectId: string, tabId: string): Promise<Session> {
    const context = await this.launch();
    const page = context.pages().find((candidate) => !candidate.isClosed() && !this.pagesInUse.has(candidate)) ?? (await context.newPage());
    this.pagesInUse.add(page);
    const cdp = await context.newCDPSession(page);
    const session: Session = { projectId, tabId, key: keyOf(projectId, tabId), page, cdp, viewers: new Set(), frameViewers: new Set(), console: [], screencasting: false, loading: false, pushing: false, pushAgain: false, ...DEFAULT_SIZE };
    // The Electron window places the view by project and tab (desktop/browser-view.ts).
    if (this.native) await (cdp.send as (method: string, params: object) => Promise<unknown>)("Agentic.label", { label: `${projectId}\u0001${tabId}` });
    await cdp.send("Page.enable");
    await this.applyAppearance(session, this.options.appearance?.() ?? "system");
    await this.allowDownloads(session);
    const { downloads } = this.options;
    if (downloads) {
      cdp.on("Page.downloadWillBegin", (e) => {
        try {
          downloads.begin(projectId, e.guid, e.url, e.suggestedFilename, session.downloadStaging ?? downloads.stagingDir());
        } catch {
          void cdp.send("Browser.cancelDownload", { guid: e.guid }).catch(() => undefined);
        }
      });
      cdp.on("Page.downloadProgress", (e) => downloads.progress(e.guid, e.receivedBytes, e.totalBytes, e.state));
    }

    cdp.on("Page.screencastFrame", (frame) => this.onFrame(session, frame));
    cdp.on("Page.frameStartedLoading", () => this.setLoading(session, true));
    cdp.on("Page.frameStoppedLoading", () => this.setLoading(session, false));
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      if (session.favicon && originOf(session.faviconFor) !== originOf(page.url())) {
        session.favicon = undefined;
        session.faviconFor = undefined;
      }
      void this.pushState(session);
    });
    page.on("load", () => {
      void this.pushState(session);
      void this.readFavicon(session);
    });
    page.on("console", (message) => addConsole(session, `${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => addConsole(session, `pageerror: ${error.message}`));
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
    page.on("popup", (popup) => void this.adoptPopup(session, popup));
    page.on("crash", () => this.endSession(session, "Siden krasjet"));
    page.on("close", () => this.endSession(session, "Siden ble lukket"));
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    return session;
  }

  // Keeps user and agent on one page: a link that opens a new tab opens here instead.
  private async adoptPopup(session: Session, popup: Page): Promise<void> {
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    const url = popup.url();
    await popup.close().catch(() => undefined);
    if (/^https?:/.test(url)) await session.page.goto(url).catch(() => undefined);
  }

  private endSession(session: Session, reason: string): void {
    this.pagesInUse.delete(session.page);
    const candidate = this.sessions.get(session.key);
    void candidate?.then((s) => {
      if (s !== session) return;
      this.sessions.delete(session.key);
      this.ready.delete(session.key);
      for (const viewer of session.viewers) viewer.send({ type: "browser.closed", projectId: session.projectId, tabId: session.tabId, reason });
      this.pushTabs(session.projectId);
    }, () => undefined);
  }

  private onChromeGone(): void {
    if (!this.context && !this.browser) return; // told twice: the context and the connection
    const reason = this.closing ? "Nettleseren ble lukket" : "Nettleseren stoppet";
    this.context = undefined;
    this.browser = undefined;
    clearTimeout(this.idleTimer);
    // Downloads under way die with Chrome: they end as canceled, and their half files go.
    this.options.downloads?.abortAll(reason);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.ready.clear();
    this.pagesInUse.clear();
    for (const session of sessions) {
      void session.then((s) => {
        for (const viewer of s.viewers) viewer.send({ type: "browser.closed", projectId: s.projectId, tabId: s.tabId, reason });
      }, () => undefined);
    }
  }

  private touch(ms = this.options.idleMs): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.closeIfIdle(), ms);
    this.idleTimer.unref();
  }

  // In the Electron window, closing the panel lets the pages go soon, unless the agent is using them.
  private async afterPanelClosed(): Promise<void> {
    if (!this.native || this.busy > 0) return;
    const sessions = await Promise.all([...this.sessions.values()].map((s) => s.catch(() => null)));
    if (sessions.some((s) => s && s.viewers.size > 0) || this.watchers.size > 0) return;
    if (Date.now() - this.agentAt < this.options.idleMs) return;
    this.touch(Math.min(PANEL_GRACE_MS, this.options.idleMs));
  }

  // A download under way keeps Chrome open, also with the panel closed.
  private async closeIfIdle(): Promise<void> {
    if (this.busy > 0 || this.launching || (this.options.downloads?.activeCount ?? 0) > 0) return this.touch();
    const sessions = await Promise.all(this.sessions.values());
    if (this.busy > 0 || sessions.some((s) => s.viewers.size > 0)) return this.touch();
    await this.close();
  }

  // Everyone who asks waits for the same close, so nobody returns while Chrome is still writing.
  close(): Promise<void> {
    this.closing ??= (async () => {
      clearTimeout(this.idleTimer);
      await this.launching?.catch(() => undefined);
      // The Electron panel: closing the connection lets main.ts close the views.
      if (this.browser) await this.browser.close().catch(() => undefined);
      else await this.context?.close().catch(() => undefined);
      this.onChromeGone();
    })().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }

  // Downloads go to the hidden folder inside the download folder, under random names; downloads.ts
  // gives them their real names when they are complete. Without a Downloads, they are refused.
  private async allowDownloads(session: Session): Promise<void> {
    const { downloads } = this.options;
    const staging = downloads?.stagingDir();
    if (session.downloadStaging === staging && staging) return;
    session.downloadStaging = staging;
    await session.cdp
      // "allowAndName" is in Chrome's protocol but missing from Playwright's types for the Page domain.
      .send("Page.setDownloadBehavior", staging ? { behavior: "allowAndName" as "allow", downloadPath: staging } : { behavior: "deny" })
      .catch(() => undefined);
  }

  async cancelDownload(id: string): Promise<void> {
    const session = await [...this.sessions.values()][0]?.catch(() => undefined);
    await session?.cdp.send("Browser.cancelDownload", { guid: id }).catch(() => undefined);
  }

  // Runs an operation on a project's page: the tab given, or the one the panel showed last. Chrome
  // stays open until it is done.
  private async use<T>(projectId: string, fn: (session: Session) => Promise<T>, tabId?: string): Promise<T> {
    this.busy++;
    try {
      const session = await this.session(projectId, this.tabFor(projectId, tabId));
      // The folder may have changed in Settings since the page was opened.
      if (this.options.downloads && session.downloadStaging !== this.options.downloads.stagingDir()) await this.allowDownloads(session);
      return await fn(session);
    } finally {
      this.busy--;
      if (this.context) this.touch();
    }
  }

  // For good: work still under way cannot start Chrome again after this.
  dispose(): Promise<void> {
    this.disposed = true;
    return this.close();
  }

  // State and screencast

  private async state(session: Session): Promise<BrowserState> {
    const { page, cdp } = session;
    const history = await cdp.send("Page.getNavigationHistory").catch(() => ({ currentIndex: 0, entries: [{}] }));
    const url = page.url();
    const pendingUrl = session.navigation?.from === url ? session.navigation.url : undefined;
    return {
      url,
      pendingUrl,
      title: await page.title().catch(() => ""),
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
      loading: session.loading,
      ...(this.native ? { native: true } : {}),
    };
  }

  // One at a time, with another round if something happened meanwhile, so the last state a
  // viewer gets is always a fresh one.
  private async pushState(session: Session): Promise<void> {
    if (!session.viewers.size) return this.pushTabs(session.projectId);
    session.pushAgain = true;
    if (session.pushing) return;
    session.pushing = true;
    while (session.pushAgain) {
      session.pushAgain = false;
      const state = await this.state(session).catch(() => null);
      if (!state) continue;
      for (const viewer of session.viewers) viewer.send({ type: "browser.state", projectId: session.projectId, tabId: session.tabId, state });
    }
    session.pushing = false;
    this.pushTabs(session.projectId);
  }

  // The tabs of a project, in the order they were opened, to every panel that shows the project.
  private async tabsOf(projectId: string): Promise<BrowserTabInfo[]> {
    const all = await Promise.all([...this.sessions.entries()]
      .filter(([key]) => key === projectId || key.startsWith(`${projectId}\u0001`))
      .map(([, s]) => s.catch(() => null)));
    const tabs: BrowserTabInfo[] = [];
    for (const s of all) {
      if (!s || s.page.isClosed()) continue;
      tabs.push({ id: s.tabId, threadId: this.threadOwners.get(s.key), url: s.page.url(), title: await s.page.title().catch(() => ""), loading: s.loading, favicon: s.favicon });
    }
    return tabs;
  }

  private pushTabs(projectId: string, only?: BrowserClient): void {
    const watchers = only ? [only] : [...(this.watchers.get(projectId) ?? [])];
    if (!watchers.length) return;
    void this.tabsOf(projectId).then((tabs) => {
      const active = this.activeTabs.get(projectId) ?? "";
      for (const viewer of watchers) viewer.send({ type: "browser.tabs", projectId, tabs, active });
    }, () => undefined);
  }

  // The page's own icon, or /favicon.ico on its origin, fetched once per address with the profile's
  // cookies and kept as a data URL of at most 64 KB. Never from the app itself.
  private async readFavicon(session: Session): Promise<void> {
    const pageUrl = session.page.url();
    if (!/^https?:/.test(pageUrl) || session.faviconFor === pageUrl) return;
    session.faviconFor = pageUrl;
    const declared = await Promise.race([
      session.page.evaluate(() => {
        const link = document.querySelector<HTMLLinkElement>('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]');
        return link ? String(link.href) : "";
      }).catch(() => ""),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 2000)),
    ]);
    let iconUrl = "";
    try {
      iconUrl = typeof declared === "string" && declared ? new URL(declared, pageUrl).href : new URL("/favicon.ico", pageUrl).href;
    } catch {
      return;
    }
    const icon = await this.fetchFavicon(iconUrl);
    if (session.page.isClosed() || session.page.url() !== pageUrl) return;
    if (icon === (session.favicon ?? null)) return;
    session.favicon = icon ?? undefined;
    this.pushTabs(session.projectId);
  }

  private async fetchFavicon(iconUrl: string): Promise<string | null> {
    if (this.faviconCache.has(iconUrl)) return this.faviconCache.get(iconUrl)!;
    let found: string | null = null;
    if (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|webp|jpeg)[;,]/.test(iconUrl)) {
      found = iconUrl.length <= MAX_FAVICON_BYTES * 1.4 ? iconUrl : null;
    } else if (/^https?:/.test(iconUrl) && !this.options.appOrigins().includes(new URL(iconUrl).origin) && this.context) {
      try {
        const res = await this.context.request.get(iconUrl, { timeout: 3000, maxRedirects: 3, failOnStatusCode: false });
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

  private setLoading(session: Session, loading: boolean): void {
    if (session.loading === loading) return;
    session.loading = loading;
    void this.pushState(session);
  }

  private onFrame(session: Session, frame: { data: string; sessionId: number; metadata: { deviceWidth?: number; deviceHeight?: number } }): void {
    session.unackedFrame = frame.sessionId;
    const message: ServerMessage = {
      type: "browser.frame",
      projectId: session.projectId,
      tabId: session.tabId,
      sessionId: frame.sessionId,
      jpegBase64: frame.data,
      width: frame.metadata.deviceWidth ?? session.width,
      height: frame.metadata.deviceHeight ?? session.height,
    };
    let delivered = false;
    for (const viewer of session.frameViewers) {
      if (viewer.buffered() > MAX_BUFFERED_FRAME) continue;
      viewer.send(message);
      delivered = true;
    }
    // Nobody can take it, so skip it. Chrome stops sending until a frame is acked.
    if (!delivered) this.ackFrame(session, frame.sessionId);
  }

  private ackFrame(session: Session, frameId: number): void {
    if (session.unackedFrame === frameId) session.unackedFrame = undefined;
    session.cdp.send("Page.screencastFrameAck", { sessionId: frameId }).catch(() => undefined);
  }

  // A panel shows a tab: it gets that tab's frames and the project's list of tabs, and stops
  // getting the frames of the tab it showed before. Thread tools keep their own tab.
  // Without a tab (a panel that has not shown one yet, after a reload), the one shown last.
  // inWindow: the panel is in the Electron window and shows the page itself, without frames, when
  // the pages are views there (SPEC 29.3). Any other panel gets frames, from either kind of page.
  async attach(client: BrowserClient, projectId: string, width: number, height: number, tabId?: string, inWindow = false): Promise<void> {
    const tab = this.tabFor(projectId, tabId);
    let watching = this.watchers.get(projectId);
    if (!watching) this.watchers.set(projectId, (watching = new Set()));
    watching.add(client);
    await this.leave(client, projectId, (s) => s.tabId !== tab);
    await this.use(projectId, async (session) => {
      session.viewers.add(client);
      this.activeTabs.set(projectId, tab);
      if (!(this.native && inWindow)) {
        session.frameViewers.add(client);
        await this.resize(projectId, width, height, tab);
        if (!session.screencasting) {
          session.screencasting = true;
          await session.cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
        }
      }
      client.send({ type: "browser.state", projectId, tabId: tab, state: await this.state(session) });
    }, tab);
    this.pushTabs(projectId);
  }

  // A tab closed from the panel. Thread tools recreate their own tab on the next use.
  async closeTab(projectId: string, tabId: string): Promise<void> {
    const tab = cleanTabId(tabId);
    const session = await this.sessions.get(keyOf(projectId, tab))?.catch(() => null);
    if (this.activeTabs.get(projectId) === tab) {
      const rest = [...this.sessions.keys()].filter((k) => k !== keyOf(projectId, tab) && (k === projectId || k.startsWith(`${projectId}\u0001`)));
      const next = rest.at(-1);
      this.activeTabs.set(projectId, next === undefined || next === projectId ? "" : next.slice(projectId.length + 1));
    }
    if (!session) return this.pushTabs(projectId);
    this.sessions.delete(session.key);
    this.ready.delete(session.key);
    // Keep the page claimed until its actual close event. A new thread/session can start while
    // stopScreencast or page.close waits, and must never adopt this still-open closing page.
    if (session.screencasting) await session.cdp.send("Page.stopScreencast").catch(() => undefined);
    await session.page.close().catch(() => undefined);
    this.pushTabs(projectId);
    this.touch();
  }

  private async leave(client: BrowserClient, projectId: string | undefined, which: (session: Session) => boolean = () => true): Promise<void> {
    const sessions = await Promise.all([...this.sessions.values()].map((s) => s.catch(() => null)));
    for (const session of sessions) {
      if (!session || (projectId && session.projectId !== projectId) || !which(session)) continue;
      if (!session.viewers.delete(client)) continue;
      session.frameViewers.delete(client);
      if (session.unackedFrame !== undefined) this.ackFrame(session, session.unackedFrame);
      if (!session.frameViewers.size && session.screencasting) {
        session.screencasting = false;
        await session.cdp.send("Page.stopScreencast").catch(() => undefined);
      }
      this.touch();
    }
  }

  // The panel closed (or the window went): no frames and no list of tabs. The tabs stay open.
  async detach(client: BrowserClient, projectId?: string): Promise<void> {
    for (const [id, watching] of this.watchers) {
      if (projectId && id !== projectId) continue;
      watching.delete(client);
      if (!watching.size) this.watchers.delete(id);
    }
    await this.leave(client, projectId);
    await this.afterPanelClosed();
  }

  frameAck(projectId: string, frameId: number, tabId = ""): void {
    void this.sessions.get(keyOf(projectId, cleanTabId(tabId)))?.then((session) => this.ackFrame(session, frameId), () => undefined);
  }

  // In the Electron window the page is as large as the view the UI places; nothing to emulate.
  // A panel that is dragged sends sizes close together. They are given to the page one at a time,
  // each with the size wanted when its turn comes, so the page always ends at the last one: two
  // setViewportSize calls under way at once could finish in either order.
  resize(projectId: string, width: number, height: number, tabId?: string): Promise<void> {
    if (this.native) return Promise.resolve();
    return this.use(projectId, async (session) => {
      session.width = Math.min(Math.max(Math.round(width) || DEFAULT_SIZE.width, 100), 4096);
      session.height = Math.min(Math.max(Math.round(height) || DEFAULT_SIZE.height, 100), 4096);
      const turn = (session.resizing ?? Promise.resolve()).then(async () => {
        const { width, height } = session;
        if (session.viewport?.width === width && session.viewport.height === height) return;
        await session.page.setViewportSize({ width, height });
        session.viewport = { width, height };
      });
      session.resizing = turn.catch(() => undefined);
      await turn;
    }, tabId);
  }

  history(projectId: string, action: "back" | "forward" | "reload", tabId?: string): Promise<void> {
    return this.use(projectId, async ({ page }) => {
      if (action === "back") await page.goBack().catch(() => undefined);
      else if (action === "forward") await page.goForward().catch(() => undefined);
      else await page.reload().catch(() => undefined);
    }, tabId);
  }

  // Finn på siden: the browser's own find, run in an isolated world so the page cannot replace
  // window.find or see the search. Only a yes or no comes back.
  find(projectId: string, text: string, backwards: boolean, tabId?: string): Promise<boolean> {
    if (!text) return Promise.resolve(false);
    return this.use(projectId, async ({ cdp }) => {
      const tree = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: "agentic-find" });
      const result = await cdp.send("Runtime.evaluate", {
        contextId: executionContextId,
        expression: `window.find(${JSON.stringify(text)}, false, ${backwards}, true)`,
        returnByValue: true,
        timeout: 1000,
      });
      return result.result.value === true;
    }, tabId);
  }

  // Tøm nettlesingsdata: cookies and cache for the shared profile, and stored data for the page
  // that is open. The history in the panel is kept by the panel itself.
  clearData(projectId: string): Promise<void> {
    return this.use(projectId, async ({ cdp, page }) => {
      await cdp.send("Network.clearBrowserCookies").catch(() => undefined);
      this.options.cookies?.clearAll(this.native ? "panel" : "chrome"); // the imported ones went with the rest
      this.signedInGrants.clear();
      await cdp.send("Network.clearBrowserCache").catch(() => undefined);
      const origin = (() => {
        try {
          return new URL(page.url()).origin;
        } catch {
          return "null";
        }
      })();
      if (origin !== "null") await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" }).catch(() => undefined);
    });
  }

  input(projectId: string, event: BrowserInput, tabId?: string): Promise<void> {
    return this.use(projectId, ({ cdp }) => this.dispatch(cdp, event), tabId);
  }

  private async dispatch(cdp: CDPSession, event: BrowserInput): Promise<void> {
    if (event.kind === "mouse") {
      const type = event.action === "move" ? "mouseMoved" : event.action === "down" ? "mousePressed" : "mouseReleased";
      await cdp.send("Input.dispatchMouseEvent", {
        type, x: event.x, y: event.y, button: event.button, clickCount: event.clicks, modifiers: event.modifiers,
      });
    } else if (event.kind === "wheel") {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: event.x, y: event.y, deltaX: event.deltaX, deltaY: event.deltaY, modifiers: event.modifiers,
      });
    } else {
      const text = event.key === "Enter" ? "\r" : event.text;
      const type = event.action === "up" ? "keyUp" : event.action === "char" ? "char" : text ? "keyDown" : "rawKeyDown";
      await cdp.send("Input.dispatchKeyEvent", {
        type, key: event.key, code: event.code, text, unmodifiedText: text,
        windowsVirtualKeyCode: virtualKey(event.key), modifiers: event.modifiers,
      });
    }
  }

  // Shared by the panel's address bar and the agent. Only web pages, and never the app itself.
  private checkUrl(raw: string): string {
    if (raw === "about:blank") return raw;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new HttpError(400, `Ugyldig adresse: ${raw}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Bare http- og https-adresser kan åpnes");
    if (this.options.appOrigins().includes(url.origin)) throw new HttpError(400, "Appens egen adresse kan ikke åpnes her");
    return url.href;
  }

  async navigate(projectId: string, raw: string, tabId?: string): Promise<string> {
    if (tabId === undefined) this.agentAt = Date.now(); // the agent; the panel always names its tab
    const url = this.checkUrl(await this.options.resolveUrl(projectId, raw));
    return this.use(projectId, async (session) => {
      const { page } = session;
      const navigation = { from: page.url(), url };
      session.navigation = navigation;
      void this.pushState(session);
      try {
        await page.goto(url);
        return `Åpnet ${page.url()}, tittel: ${await page.title()}`;
      } finally {
        if (session.navigation === navigation) {
          session.navigation = undefined;
          void this.pushState(session);
        }
      }
    }, tabId);
  }

  snapshot(projectId: string, tabId?: string): Promise<string> {
    this.agentAt = Date.now();
    return this.use(projectId, async ({ page }) => {
      return `Side: ${page.url()}\nTittel: ${await page.title()}\n\n${await page.ariaSnapshot({ mode: "ai" })}`;
    }, tabId);
  }

  private locate(page: Page, target: { ref?: string; text?: string }): Locator {
    if (target.ref) return page.locator(`aria-ref=${target.ref}`);
    if (target.text) return page.getByText(target.text).first();
    throw new HttpError(400, "Oppgi ref eller text");
  }

  click(projectId: string, target: { ref?: string; text?: string }, tabId?: string): Promise<string> {
    this.agentAt = Date.now();
    return this.use(projectId, async ({ page }) => {
      await this.locate(page, target).click();
      return `Klikket. Siden er nå ${page.url()}`;
    }, tabId);
  }

  type(projectId: string, target: { ref?: string; text?: string }, value: string, submit: boolean, tabId?: string): Promise<string> {
    this.agentAt = Date.now();
    return this.use(projectId, async ({ page }) => {
      const locator = this.locate(page, target);
      await locator.fill(value);
      if (submit) await locator.press("Enter");
      return "Skrev inn teksten";
    }, tabId);
  }

  // Annoter and thread-bound tools name their tab; legacy calls use the panel selection.
  screenshot(projectId: string, tabId?: string): Promise<{ png: Buffer; url: string }> {
    if (tabId === undefined) this.agentAt = Date.now();
    return this.use(projectId, async ({ page }) => ({ png: await page.screenshot({ type: "png" }), url: page.url() }), tabId);
  }

  annotationSnapshot(projectId: string, tabId: string): Promise<BrowserAnnotationSnapshot> {
    return this.use(projectId, async ({ page }) => {
      const url = page.url();
      const meta = await page.evaluate(annotationElements);
      const png = await page.screenshot({ type: "png", scale: "css" });
      if (page.url() !== url) throw new HttpError(409, "Siden ble endret. Åpne annotering på nytt.");
      return { ...meta, url, pngBase64: png.toString("base64") };
    }, tabId);
  }

  private async applyAppearance(session: Session, mode: ThemeSetting): Promise<void> {
    const features = mode === "light" || mode === "dark" ? [{ name: "prefers-color-scheme", value: mode }] : [];
    await session.cdp.send("Emulation.setEmulatedMedia", { features }).catch(() => undefined);
  }

  // Updates prefers-color-scheme emulation on all open sessions when Settings.browserAppearance changes.
  async setAppearance(mode: ThemeSetting): Promise<void> {
    const sessions = await Promise.all([...this.sessions.values()].map((s) => s.catch(() => null)));
    await Promise.all(sessions.filter((s): s is Session => !!s && !s.page.isClosed()).map((s) => this.applyAppearance(s, mode)));
  }

  // Round 12 (SPEC 26.4): imported cookies. They wait in the data folder until Chrome runs; when it
  // already does, they go in now. Returns what Chrome refused, when it runs.
  async syncCookies(): Promise<{ added: number; refused: number } | null> {
    if (!this.options.cookies) return null;
    await this.launching?.catch(() => undefined);
    if (!this.context) return null;
    return this.options.cookies.apply(this.context, this.native ? "panel" : "chrome");
  }

  // The imported site the agent would act on, when the user wants to be asked first and has not
  // said yes to it in this thread. With a url, that address (browser_navigate); without, the page
  // the agent's tab shows now. The check is synchronous, from what is known about the page.
  signedInSite(projectId: string, threadId: string, url?: string, tabId?: string): string | null {
    const cookies = this.options.cookies;
    if (!cookies || this.options.askSignedIn?.() === false) return null;
    const address = url ?? this.ready.get(keyOf(projectId, this.tabFor(projectId, tabId)))?.page.url();
    const site = address ? cookies.siteFor(address) : null;
    if (!site || this.signedInGrants.has(`${threadId}\u0001${site}`)) return null;
    return site;
  }

  grantSignedIn(threadId: string, site: string): void {
    this.signedInGrants.add(`${threadId}\u0001${site}`);
  }

  // A forgotten site asks again the next time it is imported.
  dropSignedInGrants(site?: string): void {
    if (site === undefined) return this.signedInGrants.clear();
    for (const key of this.signedInGrants) if (key.endsWith(`\u0001${site}`)) this.signedInGrants.delete(key);
  }

  console(projectId: string, tabId?: string): Promise<string> {
    this.agentAt = Date.now();
    return this.use(projectId, async (session) => session.console.join("\n") || "(ingen meldinger)", tabId);
  }
}

function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

function addConsole(session: Session, line: string): void {
  session.console.push(line.slice(0, 2000));
  if (session.console.length > MAX_CONSOLE) session.console.shift();
}
