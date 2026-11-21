import { applyLanguage, t } from "./i18n.ts";
import { isLanguage } from "../shared/i18n.ts";
// Agentic Desktop as a desktop app (SPEC 29). Electron is only a shell: the server is the same as
// for `npm start`, in its own process (utilityProcess) on 127.0.0.1 with a port and a token of its
// own, and the window loads the same web UI from it over HTTP and WebSocket. This file starts and
// stops that server, owns the window without a frame, the icon in the status area, the error page,
// and the rules for what the window may load and open.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  protocol,
  screen,
  session,
  shell,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type UtilityProcess,
  type WebContents,
} from "electron";
import { liveInstance, readInstance, readStopKey, type InstanceInfo } from "../server/src/instance.ts";
import { descendants, known, stillRunning, stopAll, type KnownProcess } from "./processes.ts";
import { StateFile, type CloseBehavior } from "./state.ts";
import { StatusArea, type Activity } from "./status-area.ts";
import { BrowserPanel } from "./browser-view.ts";
import { folderPicker } from "./folder-picker.ts";
import { sandboxInfo } from "./sandbox.ts";
import { installedFrom, installIcon } from "./app-icon.ts";
import { isAppIcon, type AppIconId } from "../shared/protocol.ts";

const APP_ID = "io.github.AgenticDesktop";
const PRODUCT = "Agentic Desktop";
const SCHEME = "agentic-desktop"; // the app's own pages: the error page and the page for a busy data folder
const SHELL_ORIGIN = `${SCHEME}://shell`;
const USER_PORTS = new Set([4317, 4318]); // npm start and Agentic Rigg; never taken by the app
const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

// AD_DESKTOP_TIMING=1: when each step of the start happens, for scripts/perf-desktop.ts.
const timing = !!process.env.AD_DESKTOP_TIMING;
const mark = (name: string) => timing && console.log(`tid: ${name} ${Date.now()}`);
mark("main");

// Built files sit next to this one: desktop/build in development, app.asar in the package.
const here = import.meta.dirname;
const shellDir = path.join(here, "shell");
const appRoot = app.isPackaged ? path.join(process.resourcesPath, "app-root") : path.resolve(here, "../..");
const serverEntry = app.isPackaged ? path.join(appRoot, "server/server.mjs") : path.join(here, "server/server.mjs");
const preload = path.join(here, "preload.cjs");

// SPEC 29.2: Chromium's sandbox. desktop/launcher/agentic-desktop-start adds --no-sandbox when
// AppArmor would make the sandbox abort the start. Without it, web pages stay out of Electron: the
// Browser panel uses the server's headless Chrome, which has a sandbox of its own.
const sandbox = sandboxInfo({
  noSandbox: app.commandLine.hasSwitch("no-sandbox"),
  executable: process.execPath,
  profile: app.isPackaged ? path.join(process.resourcesPath, "apparmor/agentic-desktop") : path.join(appRoot, "desktop/apparmor/agentic-desktop"),
});
if (!sandbox.on) console.log(`Uten Chromium-sandkassen: ${sandbox.reason}`);

// The same data folder as the localhost version, so the threads follow. Electron's own files
// (Chromium's profile, which holds the UI's local storage, and desktop-state.json) go in a folder
// of their own inside it.
const dataDir = process.env.AD_DATA_DIR || path.join(homedir(), ".local/share/agentic-desktop");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
app.setPath("userData", path.join(dataDir, "electron"));
const state = new StateFile(app.getPath("userData"));

// Round 14 (SPEC 30.2): the icon chosen in Innstillinger → Utseende. Each one has a folder of its own
// in shell/icons (desktop/icons/render.ts); the default is also at the top of it.
const iconDir = (id: AppIconId) => {
  const dir = path.join(shellDir, "icons", id);
  return existsSync(path.join(dir, "app-512.png")) ? dir : path.join(shellDir, "icons");
};
let iconPath = path.join(iconDir(state.get().appIcon), "app-512.png");
// Installed with scripts/install-local.ts: the app library's icon can follow the choice. Only the
// packaged app looks next to itself; the tests point at a stand-in folder with AD_DESKTOP_INSTALL_DIR.
const installDir = app.isPackaged ? installedFrom(path.dirname(app.getPath("exe"))) : process.env.AD_DESKTOP_INSTALL_DIR ? installedFrom(process.env.AD_DESKTOP_INSTALL_DIR) : null;

app.setName(PRODUCT);
// The Wayland app_id and the X11 WM_CLASS, so GNOME finds io.github.AgenticDesktop.desktop and shows
// the right name and icon in the dock and in Alt+Tab.
app.setDesktopName(`${APP_ID}.desktop`);
// Native Wayland, not XWayland. The .desktop file says it too; this covers a start without it.
if (!app.commandLine.hasSwitch("ozone-platform")) app.commandLine.appendSwitch("ozone-platform-hint", "auto");
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
Menu.setApplicationMenu(null); // the app has its own menu and shortcuts; no Ctrl+R or developer tools

// What the tests read through Playwright. Nothing in here is secret or can be changed from outside.
const probe = {
  serverPid: 0,
  serverStarts: 0,
  tree: [] as KnownProcess[],
  secondInstances: 0,
  hiddenToTray: 0,
  page: "none" as "none" | "ui" | "error" | "busy",
  closeBehavior: () => state.get().closeBehavior,
  statusArea: () => statusArea.state,
  notices: [] as string[],
  statusAreaAction: (_label: string) => undefined as void,
  sandbox,
  appIcon: () => ({ id: state.get().appIcon, windowIcon: iconPath, trayDir: statusArea.iconFolder, installed: !!installDir, launcherWrites: launcherWrites }),
};
let launcherWrites = 0;
(globalThis as Record<string, unknown>).__agenticDesktop = probe;

let win: BrowserWindow | null = null;
let quitting = false;
let shutdownDone = false;

interface Server {
  child: UtilityProcess;
  pid: number;
  port: number;
  token: string;
  origin: string;
  tree: KnownProcess[];
  watch: NodeJS.Timeout;
  log: string[];
}
let server: Server | null = null;
const planned = new WeakSet<UtilityProcess>(); // servers we asked to stop; their exit is no crash

const statusAreaActions = {
  show: () => showWindow(),
  newThread: () => {
    showWindow();
    if (probe.page === "ui") win?.webContents.send("desktop:command", "new-thread");
  },
  quit: () => app.quit(),
};
const statusArea = new StatusArea(iconDir(state.get().appIcon), statusAreaActions);
// SPEC 29.3: the Browser panel's pages as views in the window, for the server's Playwright.
const browserPanel = new BrowserPanel({ window: () => win, appOrigins: () => uiOrigins(), quit: () => app.quit() });
(globalThis as Record<string, unknown>).__agenticBrowserPanel = browserPanel.probe;
// The menu in the status area cannot be clicked under xvfb; the tests choose its entries here.
probe.statusAreaAction = (label: string) => {
  if (label === "Vis Agentic Desktop") statusAreaActions.show();
  else if (label === "Ny tråd") statusAreaActions.newThread();
  else if (label === t("Avslutt")) statusAreaActions.quit();
};

// ---- Single instance -------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  // Another Agentic Desktop runs with this data folder; it gets the second-instance event and shows
  // its window. This one stops before it has made a window or started a server.
  shutdownDone = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    probe.secondInstances += 1;
    showWindow();
  });
  void app.whenReady().then(start);
}

// ---- The server ------------------------------------------------------------------------------

function serverEnv(port: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  // Electron's own variables must not reach terminals and commands: CHROME_DESKTOP would make a
  // Chrome started from a terminal show up as this app in the dock, and ELECTRON_RUN_AS_NODE would
  // break any Electron app started there.
  for (const name of Object.keys(env)) if (name.startsWith("ELECTRON_") || name === "CHROME_DESKTOP") delete env[name];
  if (env.ORIGINAL_XDG_CURRENT_DESKTOP) {
    env.XDG_CURRENT_DESKTOP = env.ORIGINAL_XDG_CURRENT_DESKTOP;
    delete env.ORIGINAL_XDG_CURRENT_DESKTOP;
  }
  // Without Chromium's sandbox the Browser panel's pages would run unsandboxed in Electron; the
  // server's own Chrome shows them instead.
  if (!sandbox.on) env.AD_BROWSER_PANEL = "chrome";
  return { ...env, AD_SHELL: "electron", AD_PORT: String(port), AD_DATA_DIR: dataDir, AD_APP_ROOT: appRoot };
}

type Started = { ok: true; server: Server } | { ok: false; code: string | null; message: string; log: string[] };

function forkServer(port: number): Promise<Started> {
  mark("server-fork");
  const child = utilityProcess.fork(serverEntry, [], { env: serverEnv(port), stdio: "pipe", serviceName: "Agentic Desktop-server", cwd: homedir() });
  const log: string[] = [];
  const keep = (chunk: Buffer, out: NodeJS.WriteStream) => {
    out.write(chunk);
    for (const line of String(chunk).split("\n")) if (line.trim()) log.push(line.slice(0, 400));
    if (log.length > 40) log.splice(0, log.length - 40);
  };
  child.stdout?.on("data", (chunk: Buffer) => keep(chunk, process.stdout));
  child.stderr?.on("data", (chunk: Buffer) => keep(chunk, process.stderr));

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: Started) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      planned.add(child);
      child.kill();
      settle({ ok: false, code: "ETIMEDOUT", message: "Serveren svarte ikke innen ett minutt.", log });
    }, READY_TIMEOUT_MS);
    child.on("message", (message: { type?: string; port?: number; token?: string; pid?: number; code?: string | null; message?: string }) => {
      if (message?.type === "ready" && message.port && message.token) {
        mark("server-klar");
        const pid = child.pid ?? message.pid ?? 0;
        const origin = `http://127.0.0.1:${message.port}`;
        const started: Server = { child, pid, port: message.port, token: message.token, origin, tree: [], log, watch: setInterval(() => noteTree(started), 2000) };
        settle({ ok: true, server: started });
      } else if (message?.type === "browser-panel:connect") {
        if (sandbox.on) browserPanel.connect(child);
      } else if (message?.type === "failed") {
        planned.add(child);
        settle({ ok: false, code: message.code ?? null, message: message.message ?? "Serveren startet ikke.", log });
      }
    });
    child.once("exit", (code) => {
      if (!settled) settle({ ok: false, code: null, message: `Serveren stoppet under oppstarten (kode ${code}).`, log });
      else onServerExit(child, code);
    });
  });
}

// The VS Code that «Åpne i VS Code» starts is the user's own editor and lives on after the app.
function isUserEditor(pid: number): boolean {
  let args: string[];
  try {
    args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    return false; // gone in between
  }
  return args.some((arg) => /(^|\/)code$/.test(arg) || /\/code\/resources\/app\/out\/cli\.js$/.test(arg));
}

// Notes the server's descendants, so they can be stopped by known PID also when the server itself
// is gone. Processes noted before stay noted while they still run.
function noteTree(target: Server): void {
  const now = descendants(target.pid);
  const skip = new Set<number>();
  for (const process of now) if (isUserEditor(process.pid)) skip.add(process.pid);
  const keep = target.tree.filter((p) => stillRunning(p) && !skip.has(p.pid));
  for (const process of now) {
    if (skip.has(process.pid) || keep.some((p) => p.pid === process.pid && p.start === process.start)) continue;
    keep.push(process);
  }
  // Below the editor: its own processes are not ours either.
  target.tree = keep.filter((p) => !descendantOfAny(p.pid, skip));
  if (server === target) probe.tree = target.tree;
}

function descendantOfAny(pid: number, roots: Set<number>): boolean {
  if (!roots.size) return false;
  for (const root of roots) if (descendants(root).some((p) => p.pid === pid)) return true;
  return false;
}

async function startServer(): Promise<void> {
  // Without instance.json, which is the normal case, the server is forked at once, before start()
  // goes on to make the window.
  const other = readInstance(dataDir) ? await liveInstance(dataDir) : null;
  if (other) return void showBusy(other);

  const saved = state.get().port;
  const preferred = saved && !USER_PORTS.has(saved) ? saved : 0;
  let result = await forkServer(preferred);
  if (!result.ok && result.code === "EADDRINUSE" && preferred) result = await forkServer(0);
  if (!result.ok) {
    if (result.code === "EDATAINUSE") {
      const again = await liveInstance(dataDir);
      return void showBusy(again);
    }
    return void showShellPage("error", { reason: "start", message: result.message, log: result.log.slice(-12).join("\n") });
  }

  server = result.server;
  probe.serverPid = server.pid;
  probe.serverStarts += 1;
  noteTree(server);
  if (preferred !== server.port) state.set({ port: server.port });
  await loadUi(server);
}

function showBusy(other: InstanceInfo | null): void {
  // A browser version started from this data folder can be asked to stop (stoppable).
  const stoppable = other?.shell === "localhost" && other.port > 0 && !!readStopKey(dataDir);
  showShellPage("busy", { port: String(other?.port ?? ""), pid: String(other?.pid ?? ""), dir: dataDir, shell: other?.shell ?? "localhost", stoppable: stoppable ? "1" : "0" });
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

// «Avslutt nettleserversjonen og åpne appen» on the busy page (SPEC 29.1). Only a localhost server
// named in this data folder's instance.json is asked, with the stop key from the same file (mode
// 0600), so no other server can be stopped this way. It stops the way Ctrl+C stops it; then the app
// starts its own server.
let stoppingOther = false;
async function stopOtherServer(): Promise<{ ok: boolean; message?: string }> {
  if (stoppingOther) return { ok: false, message: "Holder allerede på." };
  stoppingOther = true;
  try {
    const other = await liveInstance(dataDir);
    if (other) {
      const key = readStopKey(dataDir);
      if (other.shell !== "localhost" || other.port === 0 || !key) return { ok: false, message: "Denne serveren kan ikke avsluttes herfra. Stopp den der du startet den." };
      let answer: Response;
      try {
        answer = await fetch(`http://127.0.0.1:${other.port}/api/instance/stop`, { method: "POST", headers: { "x-agentic-stop-key": key }, signal: AbortSignal.timeout(5000) });
      } catch {
        return { ok: false, message: "Nettleserversjonen svarte ikke." };
      }
      const body = (await answer.json().catch(() => null)) as { ok?: boolean; pid?: number } | null;
      if (answer.status !== 202 || !body?.ok || body.pid !== other.pid) return { ok: false, message: "Nettleserversjonen ville ikke avslutte." };
      // It closes terminals, runs and Chrome first, as on Ctrl+C.
      const until = Date.now() + 30_000;
      while (Date.now() < until && (pidAlive(other.pid) || (await liveInstance(dataDir)))) await new Promise((resolve) => setTimeout(resolve, 150));
      if (pidAlive(other.pid)) return { ok: false, message: "Nettleserversjonen bruker lang tid på å avslutte. Prøv igjen om litt." };
    }
    showShellPage("starting", {});
    await startServer();
    return { ok: true };
  } finally {
    stoppingOther = false;
  }
}

function onServerExit(child: UtilityProcess, code: number): void {
  if (!server || server.child !== child) return;
  const gone = server;
  clearInterval(gone.watch);
  server = null;
  probe.serverPid = 0;
  // What the server had started is left without a parent; stop it by the PIDs noted.
  void stopAll(gone.tree);
  if (planned.has(child) || quitting) return;
  console.error(`Serveren stoppet uventet (kode ${code}).`);
  showShellPage("error", { reason: "crash", code: String(code), log: gone.log.slice(-12).join("\n") });
}

async function stopServer(): Promise<void> {
  const target = server;
  if (!target) return;
  planned.add(target.child);
  clearInterval(target.watch);
  noteTree(target);
  const tree = [...target.tree];
  const self = known(target.pid);
  const exited = new Promise<void>((resolve) => {
    if (!self || !stillRunning(self)) return resolve();
    target.child.once("exit", () => resolve());
  });
  // The server closes terminals, dev servers and Chrome itself, as when npm start gets Ctrl+C.
  target.child.postMessage({ type: "shutdown" });
  const timedOut = await Promise.race([exited.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), STOP_TIMEOUT_MS))]);
  if (timedOut && self) await stopAll([self], 500);
  // Then whatever is left of what it started, by known PID.
  await stopAll(tree);
  if (server === target) server = null;
  probe.serverPid = 0;
}

async function restartServer(): Promise<void> {
  await stopServer();
  showShellPage("starting", {});
  await startServer();
}

// ---- The window ------------------------------------------------------------------------------

function background(): string {
  return nativeTheme.shouldUseDarkColors ? "#1b1b1b" : "#ffffff";
}

function onScreen(bounds: { x?: number; y?: number; width: number; height: number }): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return false;
  return screen.getAllDisplays().some(({ workArea: a }) => bounds.x! >= a.x - 40 && bounds.y! >= a.y - 40 && bounds.x! + 120 <= a.x + a.width && bounds.y! + 40 <= a.y + a.height);
}

function createWindow(): BrowserWindow {
  const saved = state.get();
  const bounds = { ...saved.bounds };
  if (!onScreen(bounds)) {
    delete bounds.x;
    delete bounds.y;
  }
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 600,
    minHeight: 420,
    frame: false,
    show: false,
    title: PRODUCT,
    icon: existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: background(),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false, // the dictionary would be fetched from Google
      navigateOnDragDrop: false,
      safeDialogs: true,
      devTools: !app.isPackaged,
    },
  });
  if (saved.maximized) window.maximize();

  const saveBounds = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const maximized = window.isMaximized();
    state.set(maximized ? { maximized } : { maximized, bounds: window.getNormalBounds() });
  };
  for (const event of ["resize", "move", "maximize", "unmaximize"] as const) window.on(event as "resize", saveBounds);
  const sendState = () => {
    if (!window.isDestroyed()) window.webContents.send("window:state", { maximized: window.isMaximized(), fullscreen: window.isFullScreen() });
  };
  for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) window.on(event as "maximize", sendState);
  window.on("focus", () => void statusArea.refresh());

  window.once("ready-to-show", () => window.show());

  window.on("close", (event) => {
    if (quitting) return;
    if (state.get().closeBehavior === "tray" && statusArea.available) {
      event.preventDefault();
      hideToStatusArea();
      return;
    }
    // Without a status area, or when chosen in Innstillinger: the close button quits.
    event.preventDefault();
    app.quit();
  });

  // Ctrl+Q always quits, also when the close button only hides the window.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.control && !input.alt && !input.meta && !input.shift && input.key.toLowerCase() === "q") {
      event.preventDefault();
      setImmediate(() => app.quit()); // after the key event is handled
    }
  });

  // «Spør før fanen lukkes»: the page asks while a thread runs. In a browser the browser asks; here
  // the app does, and only when it really quits.
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      buttons: [t("Avslutt"), t("Avbryt")],
      defaultId: 1,
      cancelId: 1,
      title: PRODUCT,
      message: t("Vil du avslutte Agentic Desktop?"),
      detail: t("Du kan ha ulagrede endringer eller en tråd som fortsatt kjører. Lagre arbeidet før du avslutter. Aktive kjøringer stoppes ved avslutning."),
    });
    if (choice === 0) event.preventDefault();
    else quitting = false;
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || quitting) return;
    if (server && probe.page === "ui") void loadUi(server);
  });

  // Copy and paste on the right button in text fields and selected text. The app's own menus
  // prevent the default, so this only shows where the page has none.
  window.webContents.on("context-menu", (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { label: t("Angre"), role: "undo", enabled: params.editFlags.canUndo },
        { label: t("Gjør om"), role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { label: t("Klipp ut"), role: "cut", enabled: params.editFlags.canCut },
        { label: t("Kopier"), role: "copy", enabled: params.editFlags.canCopy },
        { label: t("Lim inn"), role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { label: t("Merk alt"), role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      template.push({ label: t("Kopier"), role: "copy" });
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });

  window.on("closed", () => {
    if (win === window) win = null;
  });
  return window;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    win = createWindow();
    if (server) void loadUi(server);
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) {
    win.webContents.send("desktop:command", "reopen");
    win.show();
  }
  win.focus();
}

function hideToStatusArea(): void {
  if (!win) return;
  win.hide();
  probe.hiddenToTray += 1;
  if (!state.get().trayNoticeShown) {
    state.set({ trayNoticeShown: true }, true);
    const title = t("Agentic Desktop kjører videre i statusfeltet");
    probe.notices.push(title);
    if (Notification.isSupported()) {
      new Notification({ title, body: t("Trykk på ikonet øverst på skjermen for å åpne vinduet igjen. Ctrl+Q avslutter helt."), icon: iconPath, silent: true }).show();
    }
  }
}

async function loadUi(target: Server): Promise<void> {
  if (!win || win.isDestroyed()) return;
  probe.page = "ui";
  mark("loadURL");
  try {
    await win.loadURL(`${target.origin}/#token=${target.token}`);
    console.log("Agentic Desktop er klar.");
  } catch (err) {
    // A load that was replaced by another one (the error page, a restart) is not a failure.
    if ((err as { code?: string }).code !== "ERR_ABORTED") console.error("Kunne ikke laste grensesnittet:", (err as Error).message);
  }
}

function showShellPage(page: "error" | "busy" | "starting", params: Record<string, string>): void {
  if (!win || win.isDestroyed()) win = createWindow();
  probe.page = page === "starting" ? probe.page : page;
  const query = new URLSearchParams({ ...params, dark: nativeTheme.shouldUseDarkColors ? "1" : "0" });
  void win.loadURL(`${SHELL_ORIGIN}/${page === "busy" ? "busy" : page === "starting" ? "starting" : "error"}.html?${query}`).catch(() => undefined);
  if (!win.isVisible()) win.show();
}

// ---- What the window may load and open --------------------------------------------------------

function uiOrigins(): string[] {
  return server ? [server.origin, `http://localhost:${server.port}`] : [];
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isUi(url: string): boolean {
  const origin = originOf(url);
  return !!origin && uiOrigins().includes(origin);
}

// Links to web pages go to the system's browser. Nothing else leaves the app.
function openOutside(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return;
  if (process.env.AD_DESKTOP_TEST_EXTERNAL) {
    // Only the tests: they note the address instead of starting a browser.
    appendFileSync(process.env.AD_DESKTOP_TEST_EXTERNAL, `${parsed.href}\n`);
    return;
  }
  void shell.openExternal(parsed.href);
}

function guard(contents: WebContents): void {
  if (BrowserPanel.owns(contents)) return; // the Browser panel's pages have their own rules (browser-view.ts)
  contents.on("will-attach-webview", (event) => event.preventDefault());
  const navigate = (event: Electron.Event, url: string) => {
    if (isUi(url)) return;
    event.preventDefault();
    openOutside(url);
  };
  contents.on("will-navigate", navigate);
  contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) navigate(event, url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    // A pane opened in its own window (Åpne i eget vindu) is the app itself, with a normal frame
    // and the same locked-down settings, but without the window controls.
    if (isUi(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 760,
          height: 860,
          minWidth: 420,
          minHeight: 360,
          title: PRODUCT,
          icon: existsSync(iconPath) ? iconPath : undefined,
          backgroundColor: background(),
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, navigateOnDragDrop: false, devTools: !app.isPackaged },
        },
      };
    }
    openOutside(url);
    return { action: "deny" };
  });
}

const SHELL_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const PERMISSIONS = new Set(["clipboard-sanitized-write", "clipboard-read", "notifications", "fullscreen"]);

function lockDownSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const microphone = permission === "media" && details.isMainFrame && isUi(contents.getURL()) &&
      "mediaTypes" in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio";
    callback(isUi(details.requestingUrl) && (PERMISSIONS.has(permission) || microphone));
  });
  ses.setPermissionCheckHandler((contents, permission, origin, details) => {
    const microphone = permission === "media" && details.isMainFrame && !!contents && isUi(contents.getURL()) && details.mediaType === "audio";
    return isUi(origin) && (PERMISSIONS.has(permission) || microphone);
  });
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));

  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/+/, "");
    if (url.host !== "shell" || !/^(icons\/)?[a-z0-9@-]+\.(html|css|js|svg|png)$/.test(name)) return new Response("Fant ikke siden", { status: 404 });
    let body: Buffer;
    try {
      body = await readFile(path.join(shellDir, name)); // read from app.asar in the package
    } catch {
      return new Response("Fant ikke siden", { status: 404 });
    }
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": SHELL_TYPES[path.extname(name)] ?? "application/octet-stream",
        "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      },
    });
  });
}

// ---- Messages from the preload ---------------------------------------------------------------

// Only the main frame of the app's window, on the UI or on the app's own pages.
function trusted(event: IpcMainEvent | IpcMainInvokeEvent, shellOnly = false): boolean {
  if (!win || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  // The URL class gives a custom scheme the origin "null", so the app's own pages go by prefix.
  if (frame.url.startsWith(`${SHELL_ORIGIN}/`)) return true;
  return !shellOnly && isUi(frame.url);
}

function listen(): void {
  ipcMain.on("window:minimize", (event) => trusted(event) && win?.minimize());
  ipcMain.on("window:toggle-maximize", (event) => {
    if (!trusted(event) || !win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:close", (event) => trusted(event) && win?.close());
  ipcMain.handle("window:state", (event) => (trusted(event) && win ? { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } : null));

  ipcMain.handle("desktop:close-behavior", async (event, value?: CloseBehavior) => {
    if (!trusted(event)) return null;
    if (value === "tray" || value === "quit") state.set({ closeBehavior: value }, true);
    return { value: state.get().closeBehavior, statusArea: await statusArea.refresh() };
  });
  ipcMain.handle("desktop:sandbox", (event) => (trusted(event) ? sandbox : null));
  ipcMain.handle("desktop:pick-folder", folderPicker({ trusted, window: () => win ?? undefined, show: (window, options) => dialog.showOpenDialog(window, options) }));
  // Round 14 (SPEC 30.2): the app icon. Without a value: what it is now, and whether the app
  // library's icon can follow.
  ipcMain.handle("desktop:app-icon", (event, value?: unknown) => {
    if (!trusted(event)) return null;
    let launcher: "updated" | "same" | "not-installed" | "failed" = installDir ? "same" : "not-installed";
    if (isAppIcon(value) && value !== state.get().appIcon) launcher = applyAppIcon(value);
    return { value: state.get().appIcon, launcher };
  });
  ipcMain.handle("desktop:language", (event, setting) => {
    if (!trusted(event) || (setting !== "system" && !isLanguage(setting))) return null;
    applyLanguage(setting, app.getLocale());
    if (setting !== (state.get().language ?? "system")) state.set({ language: setting });
    statusArea.render();
    return app.getLocale();
  });
  ipcMain.on("desktop:activity", (event, activity: Activity) => {
    if (trusted(event) && activity && typeof activity === "object") statusArea.setActivity(activity);
  });
  ipcMain.on("shell:restart", (event) => trusted(event, true) && void restartServer());
  ipcMain.on("shell:quit", (event) => trusted(event, true) && app.quit());
  ipcMain.handle("shell:stop-other", (event) => (trusted(event, true) && probe.page === "busy" ? stopOtherServer() : { ok: false }));
  browserPanel.listen(ipcMain, (event) => trusted(event));
}

// ---- Start and stop --------------------------------------------------------------------------

// The window, any window opened from it, and the status area take the new icon at once; the app
// library's icon too, when the app is installed with install-local.
function applyAppIcon(id: AppIconId): "updated" | "same" | "not-installed" | "failed" {
  state.set({ appIcon: id }, true);
  iconPath = path.join(iconDir(id), "app-512.png");
  const image = nativeImage.createFromPath(iconPath);
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.setIcon(image);
  statusArea.setIconDir(iconDir(id));
  return syncLauncherIcon();
}

function syncLauncherIcon(): "updated" | "same" | "not-installed" | "failed" {
  if (!installDir) return "not-installed";
  try {
    const written = installIcon(iconDir(state.get().appIcon));
    launcherWrites += written.length;
    return written.length ? "updated" : "same";
  } catch (err) {
    console.error("Kunne ikke bytte ikonet i appbiblioteket:", (err as Error).message);
    return "failed";
  }
}

async function start(): Promise<void> {
  applyLanguage(state.get().language, app.getLocale());
  mark("ready");
  // An installation from before the choice, or a new install-local, has the default icon in the
  // app library; the one chosen is put back.
  syncLauncherIcon();
  lockDownSession();
  app.on("web-contents-created", (_event, contents) => guard(contents));
  listen();
  nativeTheme.on("updated", () => win?.setBackgroundColor(background()));
  // The server takes the longest, so it is started first; the window and the check for a status
  // area are made while it starts. The UI is loaded into the window when the server is ready.
  const serverStarted = startServer();
  const statusAreaChecked = statusArea.refresh();
  if (!win) win = createWindow();
  mark("vindu");
  await Promise.all([serverStarted, statusAreaChecked]);
}

app.on("before-quit", () => {
  quitting = true;
});

// The window is gone; stop the server and everything it started before the app ends.
app.on("will-quit", (event) => {
  if (shutdownDone) return;
  event.preventDefault();
  statusArea.destroy();
  state.flush();
  void stopServer()
    .catch((err) => console.error("Kunne ikke stoppe serveren:", (err as Error).message))
    .finally(() => {
      shutdownDone = true;
      // The windows are closed and the server is stopped. exit() and not quit(): a quit that began
      // with SIGTERM (logging out) ignores a second quit().
      app.exit(0);
    });
});

app.on("window-all-closed", () => {
  // The window is only hidden while the app sits in the status area, so this means quit.
  app.quit();
});
