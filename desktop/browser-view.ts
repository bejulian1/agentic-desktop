// SPEC 29.3: the Browser panel as a real WebContentsView in the app's window, with Playwright on the
// server connected to it over CDP.
//
// How the server reaches the pages, and nothing else:
// - No remote debugging port and no pipe. Each panel page gets its own webContents.debugger, which
//   speaks CDP for that one page only.
// - main.ts hands the server one end of a MessageChannelMain when it asks (utilityProcess messages,
//   which no other process can reach). The server's Playwright connects with
//   chromium.connectOverCDP(transport), so the CDP messages go server ↔ this file ↔ the debuggers.
// - This file plays the browser target: it answers the browser-level commands itself and lists only
//   the panel's pages. Commands to a page go through an allowlist first (checkPageCommand): only
//   page-level domains, Page.navigate only to http and https, and no Target command that could
//   attach to another target, list targets, open or close windows, or reach the browser. The app's
//   own window (the UI, which holds the token) is never attached to a debugger here and has no
//   target id in this file, so there is nothing to address it with.
//
// The pages live in their own session partition (persist:browser-panel), with the imported cookies
// that the server puts in through Storage.setCookies (emulated here with session.cookies). They run
// sandboxed, without Node and without a preload, may only navigate to http and https, and every
// permission is refused except writing to the clipboard.
//
// Where a page is shown comes from the UI through the preload (place): the rectangle of the panel's
// stage in the window, or nothing when the panel is closed, another tab is shown or a menu covers it.
// freeze() gives the UI a picture of the page to show while the view is hidden under a menu.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { app, Menu, MessageChannelMain, session as electronSession, WebContentsView, type BrowserWindow, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent, type MessagePortMain, type Session, type UtilityProcess, type WebContents } from "electron";

export const PANEL_PARTITION = "persist:browser-panel";
const DEFAULT_SIZE = { width: 1280, height: 800 };
const MAX_PAGES = 48; // every project's tabs together; the server allows 12 per project
const PERMISSIONS = new Set(["clipboard-sanitized-write"]);
let panelSession: Session | null = null; // made when the first page is, not when the app starts
// A page that is not on screen is parked outside the window instead of hidden, with the size it
// last had given to it over CDP: a hidden view, or one that has never been inside the window, has a
// viewport of 0 × 0, and Playwright could not click or take pictures in it while the panel is closed.
const PARK_X = 32_000;

type Json = Record<string, any>;
interface CdpMessage {
  id?: number;
  method?: string;
  params?: Json;
  sessionId?: string;
}

interface Target {
  targetId: string;
  view: WebContentsView;
  contents: WebContents;
  label?: string; // "<projectId>\u0001<tabId>", set by the server
  children: Set<string>; // the debugger's own sessions under this page (iframes, workers)
  shown: boolean;
  size: { width: number; height: number }; // as it was last on screen, for the parked page
  downloadTo?: string; // the folder from Page.setDownloadBehavior; without it, downloads are refused
}

interface PageSession {
  id: string;
  target: Target;
  parent: string; // "" for the root, or a browser session
  domains: Set<string>; // domains it has used, whose events it gets
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelOptions {
  window: () => BrowserWindow | null;
  appOrigins: () => string[]; // the UI's own addresses, which a panel page may not open
  quit: () => void;
}

// ---- The allowlist for commands to a page ----------------------------------------------------------

// Page-level domains. Browser, Target, SystemInfo, Tethering, Tracing and the rest are not here.
const PAGE_DOMAINS = new Set([
  "Accessibility", "Animation", "Audits", "CacheStorage", "Console", "CSS", "Debugger", "DOM", "DOMDebugger", "DOMSnapshot",
  "DOMStorage", "Emulation", "Fetch", "HeapProfiler", "IndexedDB", "Input", "Inspector", "IO", "LayerTree", "Log", "Media",
  "Network", "Overlay", "Page", "Performance", "Profiler", "Runtime", "Security", "Storage",
]);
const BLOCKED = new Set([
  "Network.loadNetworkResource", // loads any address with the page's rights, files included
  "Security.setIgnoreCertificateErrors", // for the whole browser
  "Storage.getCookies", "Storage.setCookies", "Storage.clearCookies", // the root answers these, for the partition
  "Page.setWebLifecycleState",
]);
// What a page session may do in Target and Browser: attach to its own frames and workers, and no more.
const PAGE_TARGET = new Set(["Target.setAutoAttach", "Target.getTargetInfo", "Target.detachFromTarget"]);
const PAGE_BROWSER = new Set(["Browser.getVersion", "Browser.cancelDownload"]);

export function allowedUrl(raw: unknown, blockedOrigins: string[] = []): boolean {
  if (raw === "about:blank") return true;
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && !blockedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

// null when the command may go to the page; otherwise why not.
export function checkPageCommand(method: string, params: Json | undefined, blockedOrigins: string[] = []): string | null {
  const domain = method.split(".")[0];
  if (BLOCKED.has(method)) return `${method} er ikke tillatt i nettleserpanelet`;
  if (domain === "Target") return PAGE_TARGET.has(method) ? null : `${method} er ikke tillatt i nettleserpanelet`;
  if (domain === "Browser") return PAGE_BROWSER.has(method) ? null : `${method} er ikke tillatt i nettleserpanelet`;
  if (!PAGE_DOMAINS.has(domain)) return `${domain} er ikke tillatt i nettleserpanelet`;
  if (method === "Page.navigate" && !allowedUrl(params?.url, blockedOrigins)) return "Bare http- og https-adresser kan åpnes";
  return null;
}

// Events that would tell about other targets never leave this file.
const DROPPED_EVENTS = new Set(["Target.targetCreated", "Target.targetDestroyed", "Target.targetInfoChanged"]);

// ---- Cookies between CDP and Electron's session.cookies -----------------------------------------------

const SAME_SITE_IN: Record<string, "strict" | "lax" | "no_restriction"> = { Strict: "strict", Lax: "lax", None: "no_restriction" };
const SAME_SITE_OUT: Record<string, string> = { strict: "Strict", lax: "Lax", no_restriction: "None" };

function cookieUrl(cookie: Json): string {
  if (typeof cookie.url === "string" && cookie.url) return cookie.url;
  const host = String(cookie.domain ?? "").replace(/^\./, "");
  return `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`;
}

async function setCookie(ses: Session, cookie: Json): Promise<void> {
  const url = cookieUrl(cookie);
  const expires = typeof cookie.expires === "number" ? cookie.expires : -1;
  if (expires >= 0 && expires * 1000 <= Date.now()) {
    // An end date that has passed: Playwright's clearCookies with a filter, or a cookie that is gone.
    await ses.cookies.remove(url, String(cookie.name));
    return;
  }
  await ses.cookies.set({
    url,
    name: String(cookie.name),
    value: String(cookie.value ?? ""),
    ...(typeof cookie.domain === "string" && cookie.domain && !cookie.url ? { domain: cookie.domain } : {}),
    ...(typeof cookie.path === "string" && cookie.path ? { path: cookie.path } : {}),
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    ...(expires >= 0 ? { expirationDate: expires } : {}),
    ...(SAME_SITE_IN[cookie.sameSite] ? { sameSite: SAME_SITE_IN[cookie.sameSite] } : {}),
  });
}

async function getCookies(ses: Session): Promise<Json[]> {
  const all = await ses.cookies.get({});
  return all.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain ?? "",
    path: c.path ?? "/",
    expires: c.session || c.expirationDate === undefined ? -1 : c.expirationDate,
    size: c.name.length + c.value.length,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    session: !!c.session,
    ...(SAME_SITE_OUT[c.sameSite] ? { sameSite: SAME_SITE_OUT[c.sameSite] } : {}),
    priority: "Medium",
    sameParty: false,
    sourceScheme: c.secure ? "Secure" : "NonSecure",
    sourcePort: c.secure ? 443 : 80,
  }));
}

// ---- The panel ---------------------------------------------------------------------------------------

export class BrowserPanel {
  private options: PanelOptions;
  private port: MessagePortMain | null = null;
  private targets = new Map<string, Target>();
  private sessions = new Map<string, PageSession>();
  private children = new Map<string, Target>(); // a debugger session id (iframe, worker) → its page
  private browserSessions = new Set<string>();
  private downloads = new Map<string, Electron.DownloadItem>();
  private placements = new Map<string, { rect: Rect | null; zoom: number }>(); // by label, also before the page exists
  private autoAttach = false;
  private counter = 0;
  private ses: Session | null = null;
  private watchedWindow: BrowserWindow | null = null;
  // For the tests (desktop/test): what the panel has, never anything from the pages.
  readonly probe = {
    connects: 0,
    created: 0,
    destroyed: 0,
    refused: [] as string[],
    pages: () => [...this.targets.values()].map((t) => ({ targetId: t.targetId, label: t.label ?? "", url: t.contents.isDestroyed() ? "" : t.contents.getURL(), title: t.contents.isDestroyed() ? "" : t.contents.getTitle(), shown: t.shown, pid: t.contents.isDestroyed() ? 0 : t.contents.getOSProcessId(), bounds: t.view.getBounds() })),
    send: (message: CdpMessage) => this.receive(message), // as if from the server, for the test of the allowlist
    open: (port: MessagePortMain) => this.open(port), // a test's own Playwright in place of the server's
    sent: [] as CdpMessage[],
    record: false,
  };

  constructor(options: PanelOptions) {
    this.options = options;
  }

  private session(): Session {
    if (this.ses) return this.ses;
    const ses = electronSession.fromPartition(PANEL_PARTITION);
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(PERMISSIONS.has(permission)));
    ses.setPermissionCheckHandler((_contents, permission) => PERMISSIONS.has(permission));
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    // Downloads go where the server said with Page.setDownloadBehavior, under a random name, and
    // the server hears of them as it would from Chrome. Any other is refused, so a save dialog never
    // opens on the user's screen.
    ses.on("will-download", (event, item, contents) => this.download(event, item, contents));
    this.ses = ses;
    panelSession = ses;
    return ses;
  }

  // ---- The connection to the server ----

  // The server asked for its end of the channel. A new one replaces the old one, and the pages of
  // the old one go with it.
  connect(child: UtilityProcess): void {
    const { port1, port2 } = new MessageChannelMain();
    this.open(port1);
    child.postMessage({ type: "browser-panel:port" }, [port2]);
  }

  // One end of a channel; the other end is the server's (or a test's) Playwright.
  open(port1: MessagePortMain): void {
    this.disconnect();
    this.port = port1;
    this.probe.connects += 1;
    port1.on("message", (event) => {
      if (this.port === port1) this.receive(event.data as CdpMessage);
    });
    port1.on("close", () => {
      if (this.port === port1) this.disconnect();
    });
    port1.start();
  }

  // The server is gone or closed its browser: every page goes.
  disconnect(): void {
    const port = this.port;
    this.port = null;
    try {
      port?.close();
    } catch {
      // Already closed.
    }
    for (const target of [...this.targets.values()]) this.destroy(target, false);
    // The server ends the downloads it no longer hears of, as when its Chrome stops.
    for (const item of this.downloads.values()) item.cancel();
    this.downloads.clear();
    this.sessions.clear();
    this.children.clear();
    this.browserSessions.clear();
    this.autoAttach = false;
  }

  private send(message: Json): void {
    if (this.probe.record) this.probe.sent.push(message);
    try {
      this.port?.postMessage(message);
    } catch {
      // The server is going.
    }
  }

  private reply(message: CdpMessage, result: Json): void {
    if (message.id === undefined) return;
    this.send({ id: message.id, result, ...(message.sessionId ? { sessionId: message.sessionId } : {}) });
  }

  private fail(message: CdpMessage, text: string): void {
    if (message.id === undefined) return;
    this.send({ id: message.id, error: { code: -32000, message: text }, ...(message.sessionId ? { sessionId: message.sessionId } : {}) });
  }

  private emit(sessionId: string, method: string, params: Json): void {
    this.send({ method, params, ...(sessionId ? { sessionId } : {}) });
  }

  receive(message: CdpMessage): void {
    if (!message || typeof message !== "object" || typeof message.method !== "string") return;
    const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
    if (!sessionId || this.browserSessions.has(sessionId)) {
      void this.browserCommand(message, sessionId).then(
        (result) => this.reply(message, result),
        (err) => this.fail(message, (err as Error).message),
      );
      return;
    }
    const page = this.sessions.get(sessionId);
    const target = page?.target ?? this.children.get(sessionId);
    if (!target || target.contents.isDestroyed()) return this.fail(message, "Fant ikke siden");
    const method = message.method;
    const params = message.params ?? {};
    if (page && method === "Agentic.label") {
      this.label(target, String(params.label ?? ""));
      return this.reply(message, {});
    }
    // Downloads are Electron's (download() below), not the DevTools download manager's.
    if (method === "Page.setDownloadBehavior") {
      const allow = (params.behavior === "allow" || params.behavior === "allowAndName") && typeof params.downloadPath === "string" && path.isAbsolute(params.downloadPath);
      target.downloadTo = allow ? params.downloadPath : undefined;
      return this.reply(message, {});
    }
    if (method === "Browser.cancelDownload") {
      this.downloads.get(String(params.guid))?.cancel();
      return this.reply(message, {});
    }
    const refused = checkPageCommand(method, params, this.options.appOrigins());
    if (refused) {
      this.probe.refused.push(method);
      return this.fail(message, refused);
    }
    let sendParams: Json = params;
    if (method === "Target.getTargetInfo") sendParams = {}; // its own, never another target's
    if (method === "Target.detachFromTarget" && !(typeof params.sessionId === "string" && target.children.has(params.sessionId))) return this.fail(message, "Ukjent økt");
    if (page) page.domains.add(method.split(".")[0]);
    // With the window hidden (in the status area) or minimized, nothing is drawn, and a picture over
    // CDP would wait for ever. The agent hears why at once instead.
    const win = this.window();
    if (method === "Page.captureScreenshot" && (!win || !win.isVisible() || win.isMinimized())) {
      return this.fail(message, "Vinduet til Agentic Desktop er skjult, så siden tegnes ikke. Vis vinduet for å ta et skjermbilde.");
    }
    target.contents.debugger.sendCommand(method, sendParams, page ? undefined : sessionId).then(
      (result: Json) => {
        if (method === "Target.getTargetInfo" && result?.targetInfo) result = { targetInfo: this.info(target) };
        this.reply(message, result ?? {});
      },
      (err: Error) => this.fail(message, err.message),
    );
  }

  // ---- The browser target, played here ----

  private info(target: Target): Json {
    const url = target.contents.isDestroyed() ? "about:blank" : target.contents.getURL() || "about:blank";
    return { targetId: target.targetId, type: "page", title: target.contents.isDestroyed() ? "" : target.contents.getTitle(), url, attached: true, canAccessOpener: false, browserContextId: "browser-panel" };
  }

  private attachSession(target: Target, parent: string): string {
    const id = `ad-page-${++this.counter}`;
    this.sessions.set(id, { id, target, parent, domains: new Set() });
    this.emit(parent, "Target.attachedToTarget", { sessionId: id, targetInfo: this.info(target), waitingForDebugger: false });
    return id;
  }

  private async browserCommand(message: CdpMessage, sessionId: string): Promise<Json> {
    const params = message.params ?? {};
    switch (message.method) {
      case "Browser.getVersion":
        return { protocolVersion: "1.3", product: `Chrome/${process.versions.chrome}`, revision: "", userAgent: this.session().getUserAgent(), jsVersion: process.versions.v8 };
      case "Target.setAutoAttach":
        if (!sessionId) {
          this.autoAttach = params.autoAttach === true;
          if (this.autoAttach) for (const target of this.targets.values()) if (![...this.sessions.values()].some((s) => s.target === target && s.parent === "")) this.attachSession(target, "");
        }
        return {};
      case "Target.getTargetInfo": {
        const target = typeof params.targetId === "string" ? this.targets.get(params.targetId) : undefined;
        return { targetInfo: target ? this.info(target) : { targetId: "browser-panel", type: "browser", title: "", url: "", attached: true, canAccessOpener: false } };
      }
      case "Target.getTargets":
        return { targetInfos: [...this.targets.values()].map((t) => this.info(t)) };
      case "Target.setDiscoverTargets":
      case "Target.activateTarget":
      case "Runtime.runIfWaitingForDebugger": // Playwright, when it lets a browser session go
      case "Browser.setDownloadBehavior":
      case "Browser.grantPermissions":
      case "Browser.resetPermissions":
        return {};
      case "Target.attachToBrowserTarget": {
        const id = `ad-browser-${++this.counter}`;
        this.browserSessions.add(id);
        return { sessionId: id };
      }
      case "Target.createTarget":
        return { targetId: (await this.create(params.url)).targetId };
      case "Target.closeTarget": {
        const target = this.targets.get(String(params.targetId));
        if (target) this.destroy(target, true);
        return { success: !!target };
      }
      case "Target.attachToTarget": {
        const target = this.targets.get(String(params.targetId));
        if (!target) throw new Error("Fant ikke siden");
        if (params.flatten !== true) throw new Error("Bare flate økter");
        return { sessionId: this.attachSession(target, sessionId) };
      }
      case "Target.detachFromTarget": {
        const page = this.sessions.get(String(params.sessionId));
        if (page) {
          this.sessions.delete(page.id);
          this.emit(page.parent, "Target.detachedFromTarget", { sessionId: page.id, targetId: page.target.targetId });
        } else if (this.browserSessions.delete(String(params.sessionId))) {
          // A browser session closed.
        }
        return {};
      }
      case "Storage.getCookies":
        return { cookies: await getCookies(this.session()) };
      case "Storage.setCookies": {
        const ses = this.session();
        const failed: string[] = [];
        for (const cookie of Array.isArray(params.cookies) ? params.cookies : []) {
          try {
            await setCookie(ses, cookie);
          } catch {
            failed.push(String(cookie?.name));
          }
        }
        // One refused cookie fails the call, as in Chrome, so ImportedCookies counts them one by one.
        if (failed.length) throw new Error(`Informasjonskapselen ble avvist: ${failed.join(", ")}`);
        return {};
      }
      case "Storage.clearCookies":
        await this.session().clearStorageData({ storages: ["cookies"] });
        return {};
      case "Agentic.clearData": // the server's profile folder was emptied (Lagring): the partition goes too
        await this.session().clearStorageData();
        await this.session().clearCache();
        return {};
      case "Browser.close":
        setImmediate(() => this.disconnect());
        return {};
      default:
        this.probe.refused.push(String(message.method));
        throw new Error(`${message.method} er ikke tillatt i nettleserpanelet`);
    }
  }

  // ---- The pages ----

  private async create(rawUrl: unknown): Promise<Target> {
    // Web pages never run in Electron without Chromium's sandbox (SPEC 29.2); main.ts then gives the
    // panel to the server's Chrome and never connects this bridge. This is the second lock.
    if (app.commandLine.hasSwitch("no-sandbox")) throw new Error("Nettleserpanelet åpner ikke sider i appen uten Chromium-sandkassen");
    if (this.targets.size >= MAX_PAGES) throw new Error("For mange faner i nettleserpanelet");
    const ses = this.session();
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        devTools: false,
        backgroundThrottling: false, // the agent works in tabs that are not on screen
        autoplayPolicy: "document-user-activation-required",
      },
    });
    view.setBackgroundColor("#ffffff");
    const contents = view.webContents;
    // Playwright knows a page's main frame by the target's id, so the page keeps the id Chromium
    // gave it. It is only ever looked up among the panel's own pages.
    contents.debugger.attach("1.3");
    let targetId = "";
    try {
      targetId = String((await contents.debugger.sendCommand("Target.getTargetInfo"))?.targetInfo?.targetId ?? "");
    } catch {
      // Below.
    }
    if (!targetId) {
      contents.close();
      throw new Error("Fikk ikke åpnet siden");
    }
    const target: Target = { targetId, view, contents, children: new Set(), shown: false, size: { ...DEFAULT_SIZE } };
    this.targets.set(target.targetId, target);
    this.probe.created += 1;
    this.guard(target);
    const win = this.window();
    win?.contentView.addChildView(view);
    view.setBounds({ x: PARK_X, y: 0, ...DEFAULT_SIZE });

    contents.debugger.on("message", (_event, method, params, sessionId) => this.onEvent(target, method, params, sessionId));
    contents.debugger.on("detach", () => {
      if (this.targets.get(target.targetId) === target) this.destroy(target, false);
    });
    await contents.loadURL("about:blank").catch(() => undefined);
    await this.parkedSize(target);
    if (this.autoAttach) this.attachSession(target, "");
    if (allowedUrl(rawUrl, this.options.appOrigins()) && rawUrl !== "about:blank") void contents.loadURL(String(rawUrl)).catch(() => undefined);
    const pending = target.label ? this.placements.get(target.label) : undefined;
    if (pending) this.apply(target, pending.rect, pending.zoom);
    return target;
  }

  private destroy(target: Target, announce: boolean): void {
    if (this.targets.get(target.targetId) !== target) return;
    this.targets.delete(target.targetId);
    this.probe.destroyed += 1;
    for (const child of target.children) this.children.delete(child);
    for (const page of [...this.sessions.values()]) {
      if (page.target !== target) continue;
      this.sessions.delete(page.id);
      if (announce || this.port) this.emit(page.parent, "Target.detachedFromTarget", { sessionId: page.id, targetId: target.targetId });
    }
    try {
      if (target.contents.debugger.isAttached()) target.contents.debugger.detach();
    } catch {
      // Gone with the page.
    }
    const win = this.window();
    try {
      win?.contentView.removeChildView(target.view);
    } catch {
      // Not in this window.
    }
    if (!target.contents.isDestroyed()) target.contents.close();
  }

  private download(event: Electron.Event, item: Electron.DownloadItem, contents: WebContents): void {
    const target = [...this.targets.values()].find((t) => t.contents === contents);
    if (!target?.downloadTo || !this.port) {
      event.preventDefault();
      return;
    }
    const guid = randomUUID();
    try {
      mkdirSync(target.downloadTo, { recursive: true, mode: 0o700 });
      item.setSavePath(path.join(target.downloadTo, guid));
    } catch {
      event.preventDefault();
      return;
    }
    this.downloads.set(guid, item);
    const tell = (method: string, params: Json) => this.toPage(target, method, params);
    tell("Page.downloadWillBegin", { frameId: target.targetId, guid, url: item.getURL(), suggestedFilename: item.getFilename() });
    item.on("updated", () => tell("Page.downloadProgress", { guid, totalBytes: item.getTotalBytes(), receivedBytes: item.getReceivedBytes(), state: "inProgress" }));
    item.once("done", (_event, state) => {
      this.downloads.delete(guid);
      tell("Page.downloadProgress", { guid, totalBytes: item.getTotalBytes(), receivedBytes: item.getReceivedBytes(), state: state === "completed" ? "completed" : "canceled" });
    });
  }

  // An event of the page's own, to the sessions that use its domain.
  private toPage(target: Target, method: string, params: Json): void {
    const domain = method.split(".")[0];
    for (const page of this.sessions.values()) if (page.target === target && page.domains.has(domain)) this.emit(page.id, method, params);
  }

  private onEvent(target: Target, method: string, params: Json, sessionId: string | undefined): void {
    if (DROPPED_EVENTS.has(method)) return;
    if (sessionId) {
      // From a frame or worker under the page: to the server as it is.
      if (method === "Target.detachedFromTarget" && typeof params?.sessionId === "string") {
        target.children.delete(params.sessionId);
        this.children.delete(params.sessionId);
      }
      if (method === "Target.attachedToTarget" && typeof params?.sessionId === "string") {
        target.children.add(params.sessionId);
        this.children.set(params.sessionId, target);
      }
      return this.emit(sessionId, method, params);
    }
    if (method === "Target.attachedToTarget" && typeof params?.sessionId === "string") {
      target.children.add(params.sessionId);
      this.children.set(params.sessionId, target);
    } else if (method === "Target.detachedFromTarget" && typeof params?.sessionId === "string") {
      target.children.delete(params.sessionId);
      this.children.delete(params.sessionId);
    }
    const domain = method.split(".")[0];
    for (const page of this.sessions.values()) {
      if (page.target !== target) continue;
      if (domain === "Inspector" || page.domains.has(domain)) this.emit(page.id, method, params);
    }
  }

  // Navigation, new windows, downloads and the right button, for the pages in the panel.
  private guard(target: Target): void {
    const { contents } = target;
    const check = (event: Electron.Event, url: string) => {
      if (!allowedUrl(url, this.options.appOrigins())) event.preventDefault();
    };
    contents.on("will-navigate", check);
    contents.on("will-frame-navigate", (event) => {
      if (event.isMainFrame && !allowedUrl(event.url, this.options.appOrigins())) event.preventDefault();
    });
    contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame) check(event, url);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    // A link that opens a window opens in the same tab, as in the server's own Chrome.
    contents.setWindowOpenHandler(({ url }) => {
      if (allowedUrl(url, this.options.appOrigins()) && url !== "about:blank") setImmediate(() => !contents.isDestroyed() && void contents.loadURL(url).catch(() => undefined));
      return { action: "deny" };
    });
    contents.on("render-process-gone", () => this.park(target));
    // Copy and paste on the right button, as in the app's window.
    contents.on("context-menu", (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (params.isEditable) {
        template.push(
          { label: "Angre", role: "undo", enabled: params.editFlags.canUndo },
          { label: "Gjør om", role: "redo", enabled: params.editFlags.canRedo },
          { type: "separator" },
          { label: "Klipp ut", role: "cut", enabled: params.editFlags.canCut },
          { label: "Kopier", role: "copy", enabled: params.editFlags.canCopy },
          { label: "Lim inn", role: "paste", enabled: params.editFlags.canPaste },
          { type: "separator" },
          { label: "Merk alt", role: "selectAll", enabled: params.editFlags.canSelectAll },
        );
      } else if (params.selectionText.trim()) {
        template.push({ label: "Kopier", role: "copy" });
      }
      const win = this.window();
      if (template.length && win) Menu.buildFromTemplate(template).popup({ window: win });
    });
    // The app's own keys work with the page in focus too: Ctrl+Q, and Ctrl+Alt+… and Ctrl+Shift+B
    // and F, which pages seldom use. Everything else belongs to the page.
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.control || input.meta) return;
      const key = input.key.toLowerCase();
      if (!input.alt && !input.shift && key === "q") {
        event.preventDefault();
        setImmediate(() => this.options.quit());
        return;
      }
      const forApp = input.alt || (input.shift && (input.code === "KeyB" || input.code === "KeyF"));
      if (!forApp) return;
      const ui = this.window()?.webContents;
      if (!ui || ui.isDestroyed()) return;
      event.preventDefault();
      const keyCode = /^Key[A-Z]$/.test(input.code) ? input.code.slice(3) : /^Digit\d$/.test(input.code) ? input.code.slice(5) : input.key;
      const modifiers: Array<"control" | "shift" | "alt"> = ["control"];
      if (input.shift) modifiers.push("shift");
      if (input.alt) modifiers.push("alt");
      ui.focus();
      ui.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      ui.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    });
  }

  private window(): BrowserWindow | null {
    const win = this.options.window();
    if (!win || win.isDestroyed()) return null;
    if (this.watchedWindow !== win) {
      this.watchedWindow = win;
      // The UI loads again (a reload, the error page): no page may stay over it.
      win.webContents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) this.hideAll();
      });
      for (const target of this.targets.values()) {
        try {
          win.contentView.addChildView(target.view);
        } catch {
          // Already there.
        }
      }
    }
    return win;
  }

  // ---- Where the pages are shown, from the UI ----

  private label(target: Target, label: string): void {
    target.label = label;
    const placement = this.placements.get(label);
    if (placement) this.apply(target, placement.rect, placement.zoom);
  }

  private apply(target: Target, rect: Rect | null, zoom: number): void {
    if (target.contents.isDestroyed()) return;
    const win = this.window();
    if (!win || !rect || rect.width < 1 || rect.height < 1) return this.park(target);
    // The UI measures in CSS pixels; the window in DIPs, which differ by the UI's own zoom.
    const factor = win.webContents.getZoomFactor() || 1;
    const [cw, ch] = win.getContentSize();
    const x = Math.max(0, Math.round(rect.x * factor));
    const y = Math.max(0, Math.round(rect.y * factor));
    const bounds = { x, y, width: Math.max(1, Math.min(Math.round(rect.width * factor), cw - x)), height: Math.max(1, Math.min(Math.round(rect.height * factor), ch - y)) };
    target.view.setBounds(bounds);
    if (Math.abs(target.contents.getZoomFactor() - zoom) > 0.001) target.contents.setZoomFactor(zoom);
    if (!target.shown) {
      void target.contents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      // Only one page shows in a place: another one the UI forgot to hide goes.
      for (const other of this.targets.values()) {
        if (other !== target && other.shown && overlaps(other.view.getBounds(), bounds)) this.park(other);
      }
      target.shown = true;
    }
  }

  // Off screen, at the size it had, and without the keyboard: keys go back to the app.
  private park(target: Target): void {
    if (!target.shown || target.contents.isDestroyed()) return;
    target.shown = false;
    const { width, height } = target.view.getBounds();
    target.size = { width: Math.max(width, 100), height: Math.max(height, 100) };
    const focused = target.contents.isFocused();
    target.view.setBounds({ x: PARK_X, y: 0, ...target.size });
    void this.parkedSize(target);
    const ui = this.options.window()?.webContents;
    if (focused && ui && !ui.isDestroyed()) ui.focus();
  }

  private parkedSize(target: Target): Promise<void> {
    if (target.contents.isDestroyed()) return Promise.resolve();
    return target.contents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { ...target.size, deviceScaleFactor: 0, mobile: false }).then(() => undefined, () => undefined);
  }

  place(projectId: string, tabId: string, rect: Rect | null, zoom = 1): void {
    const label = `${projectId}\u0001${tabId}`;
    const z = Number.isFinite(zoom) ? Math.min(Math.max(zoom, 0.25), 5) : 1;
    if (rect) this.placements.set(label, { rect, zoom: z });
    else this.placements.delete(label);
    for (const target of this.targets.values()) if (target.label === label) this.apply(target, rect, z);
  }

  // A picture of the page as it is on screen, for the UI to show while a menu covers the panel.
  async freeze(projectId: string, tabId: string): Promise<string | null> {
    const label = `${projectId}\u0001${tabId}`;
    const target = [...this.targets.values()].find((t) => t.label === label);
    if (!target || target.contents.isDestroyed()) return null;
    try {
      const image = await target.contents.capturePage(undefined, { stayHidden: true });
      return image.isEmpty() ? null : image.toDataURL();
    } catch {
      return null;
    }
  }

  hideAll(): void {
    this.placements.clear();
    for (const target of this.targets.values()) this.park(target);
  }

  // The UI's calls, from the main frame of the app's window only (main.ts's trusted()).
  listen(ipcMain: IpcMain, trusted: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean): void {
    ipcMain.on("browser-panel:place", (event, value: { projectId?: unknown; tabId?: unknown; rect?: unknown; zoom?: unknown }) => {
      if (!trusted(event) || !value || typeof value.projectId !== "string" || typeof value.tabId !== "string") return;
      this.place(value.projectId, value.tabId, cleanRect(value.rect), Number(value.zoom) || 1);
    });
    ipcMain.handle("browser-panel:freeze", (event, value: { projectId?: unknown; tabId?: unknown }) => {
      if (!trusted(event) || !value || typeof value.projectId !== "string" || typeof value.tabId !== "string") return null;
      return this.freeze(value.projectId, value.tabId);
    });
  }

  // Is this one of the panel's pages? main.ts leaves them to the guard here.
  static owns(contents: WebContents): boolean {
    return panelSession !== null && contents.session === panelSession;
  }
}

function cleanRect(raw: unknown): Rect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const rect = { x: n(r.x), y: n(r.y), width: n(r.width), height: n(r.height) };
  if (Object.values(rect).some(Number.isNaN) || rect.width < 1 || rect.height < 1 || rect.width > 20000 || rect.height > 20000) return null;
  return rect;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
