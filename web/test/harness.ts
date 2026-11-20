// Harness for the UI tests: a real server process with the demo model and a temporary data dir,
// and headless Chrome. Nothing here can open a window, everything is stopped by PID, and the
// temporary folders go when the test is done, also when it fails.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { Project, Thread, ThreadEventEnvelope } from "../../shared/protocol.ts";

export const ROOT = path.resolve(import.meta.dirname, "../..");

export interface ServerProcess {
  child: ChildProcess;
  port: number;
  link: string;
  stop: () => Promise<void>;
}

export function startServer(dataDir: string, options: { port?: number; mockDelayMs?: number; env?: Record<string, string>; home?: string } = {}): Promise<ServerProcess> {
  const child = spawn(process.execPath, ["server/src/index.ts", "--no-open"], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: options.home ?? dataDir, // No skills or shell setup from the real home folder.
      XDG_CONFIG_HOME: path.join(options.home ?? dataDir, ".config"), // Never the user's ~/.config/agentic-desktop.
      XDG_DATA_HOME: path.join(options.home ?? dataDir, ".local/share"),
      AD_DATA_DIR: dataDir,
      AD_PORT: String(options.port ?? 0),
      AD_MOCK_DELAY_MS: String(options.mockDelayMs ?? 1),
      AD_KEYRING: "memory", // round 14: keys in memory, never the user's real keyring
      PATH: `${path.join(ROOT, "web/test/bin")}:${process.env.PATH}`, // The real `code` opens a window.
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      const match = /(http:\/\/127\.0\.0\.1:(\d+)\/#token=\S+)/.exec(output);
      if (match) resolve({ child, port: Number(match[2]), link: match[1], stop });
    });
    child.once("exit", (code) => reject(new Error(`Serveren stoppet med kode ${code}: ${stderr}`)));
  });
}

export interface Harness {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  server: ServerProcess;
  dataDir: string;
  projectDir: string;
  home: string;
  origin: string;
  errors: string[];
  allow: (pattern: RegExp) => void;
  allowed: RegExp[];
  api: <T = any>(method: string, url: string, body?: unknown) => Promise<T>;
  createProject: (name?: string) => Promise<Project>;
  createThread: (projectId: string | null) => Promise<Thread>;
  events: (threadId: string) => Promise<ThreadEventEnvelope[]>;
  reload: () => Promise<void>;
}

export interface HarnessOptions {
  deviceScaleFactor?: number;
  theme?: "light" | "dark";
  viewport?: { width: number; height: number };
  mockDelayMs?: number;
  port?: number;
  env?: Record<string, string>;
}

const CHROME_ARGS = ["--no-first-run", "--no-default-browser-check", "--disable-sync", "--mute-audio"];

const chromePids = new WeakMap<Browser, number[]>();

// Headless, always. The PIDs are noted by looking at what is new among this process's children,
// because Chrome and Electron apps of the user's are running too and must never be touched.
export async function launchChrome(args: string[] = []): Promise<Browser> {
  const before = new Set(descendants(process.pid));
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...CHROME_ARGS, ...args] });
  chromePids.set(browser, descendants(process.pid).filter((pid) => !before.has(pid)));
  return browser;
}

export async function closeChrome(browser: Browser): Promise<void> {
  const pids = chromePids.get(browser) ?? [];
  await browser.close().catch(() => undefined);
  for (const pid of pids) killIfAlive(pid);
}

const WATCH_CSP = `
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
`;

export function watchErrors(page: Page, errors: string[]): void {
  page.on("console", (message) => {
    // Chrome's own notes about reading a canvas back, which only the tests do.
    if (/GPU stall due to ReadPixels|Multiple readback operations/.test(message.text())) return;
    if (message.type() === "error" || message.type() === "warning") errors.push(`konsoll: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`sidefeil: ${error.message}`));
}

export async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Tidsavbrudd: ${what}`);
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness & { close: () => Promise<void> }> {
  const webDist = options.env?.AD_WEB_DIST ?? process.env.AD_WEB_DIST ?? path.join(ROOT, "web/dist");
  assert.ok(existsSync(path.join(webDist, "build-info.json")), "Bygg webgrensesnittet og legg build-info.json i AD_WEB_DIST først");
  const dataDir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-ui-data-")));
  const projectDir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-ui-project-")));
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-ui-home-")));
  const removeFolders = () => {
    for (const dir of [dataDir, projectDir, home]) rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  };
  const server = await startServer(dataDir, { mockDelayMs: options.mockDelayMs, port: options.port, env: options.env, home });
  const browser = await launchChrome();
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1360, height: 860 }, deviceScaleFactor: options.deviceScaleFactor ?? 1, colorScheme: options.theme ?? "light", permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript(WATCH_CSP);
  const page = await context.newPage();
  const errors: string[] = [];
  const allowed: RegExp[] = [];
  watchErrors(page, errors);
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    await page.goto(server.link);
    await page.waitForSelector(".app", { timeout: 15_000 });
    assert.equal(new URL(page.url()).hash, "", "tokenet er borte fra adressen");
  } catch (err) {
    await closeChrome(browser);
    await server.stop();
    removeFolders();
    throw new Error(`Appen startet ikke: ${(err as Error).message}\n${errors.join("\n")}`);
  }

  let threadsMade = 0;
  const api: Harness["api"] = (method, url, body) =>
    page.evaluate(async ([m, u, b]) => {
      const res = await fetch(u as string, {
        method: m as string,
        headers: b === undefined ? undefined : { "content-type": "application/json" },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${m} ${u}: ${res.status} ${text}`);
      return text ? JSON.parse(text) : undefined;
    }, [method, url, body]);

  const harness: Harness = {
    page,
    context,
    browser,
    server,
    dataDir,
    projectDir,
    home,
    origin,
    errors,
    allow: (pattern) => allowed.push(pattern),
    allowed,
    api,
    createProject: (name = "Demo") => api("POST", "/api/projects", { name, path: projectDir }),
    // Round 10 (SPEC 23.8): an empty thread has no title and is not in the sidebar until it gets one,
    // so a thread made for a test is given a name, the way a first message would.
    createThread: async (projectId) => {
      const thread = await api<Thread>("POST", "/api/threads", { projectId, mode: projectId ? "code" : "chat" });
      const title = `Tråd ${++threadsMade}`;
      await api("PATCH", `/api/threads/${thread.id}`, { title });
      return { ...thread, title };
    },
    events: (threadId) => api("GET", `/api/threads/${threadId}/events?limit=20000`),
    reload: async () => {
      await page.reload();
      await page.waitForSelector(".app");
    },
  };

  const close = async () => {
    await closeChrome(browser);
    await harness.server.stop(); // A test may have replaced it with a restarted one.
    removeFolders();
  };
  return Object.assign(harness, { close });
}

function killIfAlive(pid: number): void {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    if (stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z") process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

export function descendants(pid: number): number[] {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,stat="], { encoding: "utf8" }).trim().split("\n").map((line) => line.trim().split(/\s+/));
  const found = new Set([pid]);
  for (let grown = true; grown;) {
    grown = false;
    for (const [child, parent, stat] of rows) {
      if (found.has(Number(parent)) && !found.has(Number(child)) && !stat.startsWith("Z")) {
        found.add(Number(child));
        grown = true;
      }
    }
  }
  found.delete(pid);
  return [...found];
}

// A test with its own server and browser. It also fails on any console error or CSP violation.
export function flow(name: string, body: (h: Harness, context: TestContext) => Promise<void>, options: HarnessOptions = {}): void {
  test(name, { timeout: 120_000 }, async (context) => {
    const harness = await createHarness(options);
    let failed = true;
    try {
      await body(harness, context);
      const csp = await harness.page.evaluate(() => (window as any).__csp as string[]).catch(() => [] as string[]);
      assert.deepEqual(csp, [], "CSP ble brutt");
      assert.deepEqual(harness.errors.filter((e) => !harness.allowed.some((p) => p.test(e))), [], "feil i konsollen");
      failed = false;
    } finally {
      if (failed) await screenshotOnFailure(harness, name);
      await harness.close();
    }
  });
}

async function screenshotOnFailure(harness: Harness, name: string): Promise<void> {
  const dir = path.join(ROOT, "web/test/failures");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^a-z0-9æøå]+/gi, "-").slice(0, 60)}.png`);
  await harness.page.screenshot({ path: file }).catch(() => undefined);
  writeFileSync(`${file}.txt`, harness.errors.join("\n"));
}

// Common steps.

// Exercise the in-app fallback explicitly, without opening the operating system's chooser.
export async function useFolderPickerFallback(h: Harness): Promise<void> {
  h.allow(/status of 501/);
  await h.page.route("**/api/fs/pick-folder", (route) => route.fulfill({
    status: 501,
    contentType: "application/json",
    body: JSON.stringify({ error: "Ingen systemmappevelger i testen" }),
  }));
}

export async function openProject(h: Harness, name = "Demo"): Promise<Project> {
  const project = await h.createProject(name);
  // Round 9: Kode projects are listed in Kode; Chat lists its own projects.
  const kode = h.page.locator(".sidebar .mode-button", { hasText: "Kode" });
  if (await kode.count() && (await kode.getAttribute("aria-pressed")) !== "true") await kode.click();
  await h.page.locator(`.group[data-project="${name}"] .group-title`).first().click();
  await h.page.waitForSelector(".project-label");
  return project;
}

export const pane = (page: Page, threadId: string) => page.locator(`[data-thread-id="${threadId}"]`);
export const threadItem = (page: Page, threadId: string) => page.locator(`[data-thread-item="${threadId}"]`);

export async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.waitForTimeout(40);
  await page.mouse.up();
}

export async function send(page: Page, text: string, pane = page.locator(".pane-inner.focused, .solo .pane-inner").first()): Promise<void> {
  const box = pane.locator("textarea");
  await box.fill(text);
  await box.press("Enter");
}

// Presses Tillat on every card that shows up, until the text appears in the pane.
export async function approveUntil(page: Page, done: () => Promise<boolean>, what: string): Promise<number> {
  let approved = 0;
  await waitFor(async () => {
    if (await done()) return true;
    const button = page.getByRole("button", { name: "Tillat", exact: true }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => undefined);
      approved += 1;
    }
    return false;
  }, what, 45_000);
  return approved;
}

// v0.19 (SIDEPANEL-WORKSPACE.md): a fresh start opens an empty conversation with the tool panel
// hidden. A test that needs the panel opens it, the way the user would.
export async function openPanel(page: Page): Promise<void> {
  const panel = page.locator(".right-panel");
  if (!(await panel.count())) await page.getByRole("button", { name: "Vis eller skjul panelet" }).click();
  await panel.waitFor();
}

// Round 11 (SPEC 24.3): a tool in the side panel, with the start page (the default) or with tabs on
// top. Opens the panel first when it is closed.
export async function openTool(page: Page, name: string): Promise<void> {
  const panel = page.locator(".right-panel");
  if (!(await panel.count())) await page.keyboard.press("Control+Shift+B");
  await panel.waitFor();
  const tab = panel.getByRole("tab", { name, exact: true });
  if (await tab.count()) return tab.click();
  const tile = panel.locator(`.panel-tool[data-tool]:visible`, { hasText: name });
  if (await panel.getByTestId("panel-home").filter({ visible: true }).count() && await tile.first().isVisible()) return tile.first().click();
  const addTool = panel.getByRole("button", { name: "Åpne verktøy", exact: true });
  if (await addTool.count()) {
    await addTool.click();
    await panel.getByTestId("panel-home").filter({ visible: true }).locator(`.panel-tool[data-tool]`, { hasText: name }).first().click();
    return;
  }
  // Round 12 (SPEC 26.3): stacked panels have no ⌄ switch; + adds the tool beside the others.
  if (await panel.getByTestId("panel-stack").count()) {
    await page.getByRole("button", { name: "Legg til sidepanel" }).click();
    await page.getByRole("menu", { name: "Legg til sidepanel" }).getByRole("menuitemradio", { name: new RegExp(`^${name}(\\s|$)`) }).click();
    return;
  }
  await panel.getByTestId("panel-switch").click();
  await page.getByRole("menu", { name: "Verktøy i sidepanelet" }).getByRole("menuitemradio", { name: new RegExp(`^${name}(\\s|$)`) }).click();
}

// The tool the side panel shows, by name.
export async function toolShown(page: Page, name: string): Promise<void> {
  await page.locator(`.right-panel .panel-switch[aria-label^="${name}:"], .right-panel [role="tab"][aria-label="${name}"][aria-selected="true"], .right-panel .stack-panel[aria-label="${name}"]:not([hidden])`).first().waitFor();
}
