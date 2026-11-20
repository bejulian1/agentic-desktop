// Shared parts of the Electron tests. Every test gets its own temporary HOME, config, data folder and
// D-Bus address that leads nowhere, so nothing reaches the user's folders, keyring, status area or
// notifications. The window never reaches the user's screen: the tests refuse to run unless
// WAYLAND_DISPLAY is unset (Electron 45 would otherwise pick the user's Wayland session even under
// xvfb-run) and DISPLAY points at xvfb; `npm run test:desktop` sets that up (scripts/test-desktop.ts).
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const ELECTRON = path.join(ROOT, "node_modules/electron/dist/electron");
// AD_DESKTOP_MAIN: a build of its own inside the project (scripts/build-desktop.ts --out), so agents
// working at the same time do not rebuild each other's desktop/build in the middle of a test.
export const MAIN = process.env.AD_DESKTOP_MAIN ?? path.join(ROOT, "desktop/build/main.mjs");
export const PACKAGED = path.join(ROOT, "dist-desktop/linux-unpacked/agentic-desktop-bin"); // Electron itself; agentic-desktop is the start script (SPEC 29.2)

export function assertOffScreen(): void {
  assert.equal(process.env.WAYLAND_DISPLAY, undefined, "WAYLAND_DISPLAY må være fjernet, ellers havner vinduet på skjermen. Kjør npm run test:desktop.");
  assert.ok(process.env.AD_DESKTOP_XVFB === "1" && process.env.DISPLAY, "Testene skal kjøre under xvfb-run. Kjør npm run test:desktop.");
  assert.ok(existsSync(MAIN), "desktop/build mangler. Kjør npm run test:desktop.");
  assert.ok(process.env.AD_WEB_DIST && existsSync(path.join(process.env.AD_WEB_DIST, "index.html")), "AD_WEB_DIST mangler. Kjør npm run test:desktop.");
}

export interface Sandbox {
  dir: string;
  home: string;
  dataDir: string;
  externalLog: string;
  env: Record<string, string>;
  cleanup: () => void;
}

export function sandbox(options: { tray?: "on" | "off" } = {}): Sandbox {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-desktop-test-")));
  const home = path.join(dir, "home");
  const dataDir = path.join(dir, "data");
  mkdirSync(home, { recursive: true });
  const externalLog = path.join(dir, "external.log");
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  delete env.WAYLAND_DISPLAY;
  for (const name of Object.keys(env)) if (name.startsWith("ELECTRON_") || name.startsWith("npm_")) delete env[name];
  Object.assign(env, {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_RUNTIME_DIR: path.join(dir, "run"),
    AD_DATA_DIR: dataDir,
    AD_MOCK_DELAY_MS: "1",
    AD_KEYRING: "memory", // round 14: never the user's real keyring (the bus below does not exist either)
    AD_DESKTOP_TRAY: options.tray ?? "off",
    AD_DESKTOP_TEST_EXTERNAL: externalLog,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(dir, "no-bus")}`,
    PATH: `${path.join(ROOT, "web/test/bin")}:${process.env.PATH}`, // the real `code` would open a window
  });
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  return { dir, home, dataDir, externalLog, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Running {
  app: ElectronApplication;
  page: Page;
  mainPid: number;
  sandbox: Sandbox;
  probe: <T = any>(expression: string) => Promise<T>;
  windowState: () => Promise<{ visible: boolean; maximized: boolean; minimized: boolean; focused: boolean; count: number }>;
}

// How the window is drawn, and never on the user's screen. Headless Ozone keeps it in memory and
// can maximize and minimize. The status area needs GTK, which needs a display, so with
// AD_DESKTOP_TRAY=on the window goes to xvfb's X server instead (no window manager there).
export function ozoneArgs(box: Sandbox): string[] {
  return box.env.AD_DESKTOP_TRAY === "on" ? ["--ozone-platform=x11"] : ["--ozone-platform=headless", "--ozone-override-screen-size=1600,1000"];
}

// Starts the app from desktop/build and waits for the UI.
// Playwright's _electron.launch adds --no-sandbox on Linux unless chromiumSandbox is true, so the
// tests ran without Chromium's sandbox until 6 November 2026 and never met what the user met.
// Now they run with it, as the app does, whenever this process may make user namespaces (the same
// check as desktop/launcher/agentic-desktop-start); otherwise as the start script would, without.
export const sandboxWorks = spawnSync("unshare", ["--user", "--map-root-user", "true"], { stdio: "ignore" }).status === 0;

// args: Chromium switches before the app, such as --no-sandbox (what the start script adds without
// the AppArmor profile, SPEC 29.2).
export async function launch(box: Sandbox, options: { waitForUi?: boolean; args?: string[] } = {}): Promise<Running> {
  assertOffScreen();
  const args = [...ozoneArgs(box), ...(options.args ?? []), MAIN];
  const chromiumSandbox = sandboxWorks && !args.includes("--no-sandbox");
  const app = await _electron.launch({ executablePath: ELECTRON, args, env: box.env, timeout: 60_000, chromiumSandbox });
  const mainPid = app.process().pid!;
  const page = await app.firstWindow();
  if (options.waitForUi !== false) await page.locator(".topbar").waitFor({ timeout: 60_000 });
  const probe = <T,>(expression: string) =>
    app.evaluate((_electron, source) => {
      const probe = (globalThis as any).__agenticDesktop;
      return new Function("probe", `return (${source});`)(probe);
    }, expression) as Promise<T>;
  const windowState = () =>
    app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const win = all[0];
      return { visible: win.isVisible(), maximized: win.isMaximized(), minimized: win.isMinimized(), focused: win.isFocused(), count: all.length };
    });
  return { app, page, mainPid, sandbox: box, probe, windowState };
}

export async function waitFor(check: () => Promise<boolean> | boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Ventet for lenge: ${what}`);
}

// The living descendants of a PID, read from /proc.
export function descendants(pid: number): number[] {
  const out: number[] = [];
  const queue = [pid];
  while (queue.length) {
    const next = queue.shift()!;
    let tasks: string[] = [];
    try {
      tasks = readdirSync(`/proc/${next}/task`);
    } catch {
      continue;
    }
    for (const task of tasks) {
      try {
        for (const child of readFileSync(`/proc/${next}/task/${task}/children`, "utf8").trim().split(/\s+/)) {
          if (child && !out.includes(Number(child))) {
            out.push(Number(child));
            queue.push(Number(child));
          }
        }
      } catch {
        // gone
      }
    }
  }
  return out;
}

export function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

export function commandOf(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "cmd=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// One known PID at a time, after a look at what it is (docs/agent-regler-produksjon.md).
export function killKnown(pid: number, expect: RegExp, signal: NodeJS.Signals = "SIGKILL"): void {
  const command = commandOf(pid);
  assert.match(command, expect, `PID ${pid} er ikke den ventede prosessen: ${command}`);
  process.kill(pid, signal);
}

// The app and everything under it, stopped by known PIDs if a test failed half way.
export async function closeAll(running: Running | undefined): Promise<void> {
  if (!running) return;
  const pids = [running.mainPid, ...descendants(running.mainPid)];
  await running.app.close().catch(() => undefined);
  await waitFor(() => pids.every((pid) => !alive(pid)), "alt er stoppet", 15_000).catch(() => {
    for (const pid of pids) if (alive(pid) && /agentic|electron|node|bash|chrome/i.test(commandOf(pid))) process.kill(pid, "SIGKILL");
  });
}

export async function apiCall<T = any>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ([m, u, b]) => {
      const res = await fetch(u as string, { method: m as string, headers: b === undefined ? undefined : { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
      const text = await res.text();
      if (!res.ok) throw new Error(`${m} ${u}: ${res.status} ${text}`);
      return text ? JSON.parse(text) : null;
    },
    [method, url, body] as const,
  ) as Promise<T>;
}

// The real localhost server (`node server/src/index.ts`) against a data folder, for the busy test.
export function startLocalhost(box: Sandbox): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, ["server/src/index.ts", "--no-open"], {
    cwd: ROOT,
    env: { ...box.env, AD_PORT: "0", AD_DESKTOP_TRAY: "", AD_SHELL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk) => {
      out += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
      if (match) resolve({ child, port: Number(match[1]) });
    });
    child.once("exit", (code) => reject(new Error(`localhost-serveren stoppet med kode ${code}`)));
  });
}

// A project with a terminal in the side panel, running `sleep <seconds>`: a shell and a child of it
// under the server, as when the user works. Returns the PIDs of the shell and of sleep.
export async function terminalWithChild(running: Running, seconds = 4242): Promise<{ shell: number; sleep: number }> {
  const { page, sandbox: box } = running;
  const projectDir = path.join(box.dir, "prosjekt");
  mkdirSync(projectDir, { recursive: true });
  await apiCall(page, "POST", "/api/projects", { name: "Demo", path: projectDir });
  const kode = page.locator(".sidebar .mode-button", { hasText: "Kode" });
  if ((await kode.count()) && (await kode.getAttribute("aria-pressed")) !== "true") await kode.click();
  await page.locator('.group[data-project="Demo"] .group-title').first().click();
  await page.waitForSelector(".project-label");
  const panel = page.locator(".right-panel");
  if (!(await panel.count())) await page.keyboard.press("Control+Shift+B");
  await panel.waitFor();
  const tab = panel.getByRole("tab", { name: "Terminal", exact: true });
  const tile = panel.locator(".panel-tool[data-tool]", { hasText: "Terminal" });
  if (await tab.count()) await tab.click();
  else if ((await panel.getByTestId("panel-home").count()) && (await tile.count())) await tile.first().click();
  else {
    await panel.getByTestId("panel-switch").click();
    await page.getByRole("menu", { name: "Verktøy i sidepanelet" }).getByRole("menuitemradio", { name: /^Terminal(\s|$)/ }).click();
  }
  const terminal = page.getByTestId("terminal");
  await terminal.waitFor();
  await waitFor(async () => ((await terminal.evaluate((el) => (el as any).readBuffer() as string)) ?? "").trim().length > 0, "skallet er klart");
  await terminal.click();
  await page.keyboard.type(`sleep ${seconds}\n`);
  let found: { shell: number; sleep: number } | undefined;
  await waitFor(() => {
    for (const pid of descendants(running.mainPid)) {
      if (commandOf(pid) === `sleep ${seconds}`) {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
        found = { shell: parent, sleep: pid };
        return true;
      }
    }
    return false;
  }, "sleep kjører i terminalen");
  return found!;
}
