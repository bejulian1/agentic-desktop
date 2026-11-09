// node scripts/perf-desktop.ts: start time and memory of the packaged Electron app (SPEC 29.5, 29.7).
// It starts dist-desktop/linux-unpacked (or the app given with --app) under xvfb-run with
// WAYLAND_DISPLAY removed, in a temporary HOME and data folder, and measures:
//   - time to the first frame (first-contentful-paint) and until the app can be used (the composer
//     and the open thread are drawn), counted from the moment the process was started
//   - PSS from /proc/<pid>/smaps_rollup for every process under the app, per role, at rest
//   - the same after a long thread (300 messages) that has been scrolled through
//   - the same with the window hidden in the status area (AD_DESKTOP_TRAY=on)
//   - the highest PSS while the demo model streams 20 long answers, and at rest after (--only stream)
//   - that no process is left after the app quits
// The timings come over the Chrome DevTools protocol (--remote-debugging-port=0), which is closed
// before the memory is read. --no-cdp measures the memory without it, to see what it costs.
//
//   node scripts/perf-desktop.ts [--app <binary>] [--label <name>] [--runs <n>] [--json <file>] [--doc]
//                                [--only rest,long,tray] [--no-cdp] [--quick] [--app-log <file>]
//                                [-- <extra switches for the app>]
//
// --quick reads the memory at once instead of after 20 s at rest: for comparing start times only.
//
// --doc writes the result into docs/perf/electron-minne.md between the perf-desktop markers.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOC = path.join(ROOT, "docs/perf/electron-minne.md");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Arguments ---------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const own = dash >= 0 ? argv.slice(0, dash) : argv;
const extraArgs = dash >= 0 ? argv.slice(dash + 1) : [];
const option = (name: string) => {
  const at = own.indexOf(name);
  return at >= 0 ? own[at + 1] : undefined;
};
const APP = path.resolve(option("--app") ?? path.join(ROOT, "dist-desktop/linux-unpacked/agentic-desktop-bin"));
const LABEL = option("--label") ?? "måling";
const RUNS = Number(option("--runs") ?? 5);
const JSON_OUT = option("--json");
const ONLY = new Set((option("--only") ?? "rest,long,tray,stream").split(","));
const USE_CDP = !own.includes("--no-cdp");
const WRITE_DOC = own.includes("--doc");
const APP_LOG = option("--app-log"); // the app's own output, appended per start
const QUICK = own.includes("--quick"); // only the timings: no rest before the memory is read

// ---- Never on the user's screen ------------------------------------------------------------------

if (process.env.AD_DESKTOP_XVFB !== "1") {
  // Again, under xvfb-run and without WAYLAND_DISPLAY (Electron 45 picks Wayland when it is set).
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  delete env.WAYLAND_DISPLAY;
  env.AD_DESKTOP_XVFB = "1";
  const result = spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1600x1000x24", process.execPath, import.meta.filename, ...process.argv.slice(2)], { env, stdio: "inherit" });
  process.exit(result.status ?? 1);
}
if (process.env.WAYLAND_DISPLAY || !process.env.DISPLAY) throw new Error("Må kjøre under xvfb-run uten WAYLAND_DISPLAY.");
if (!existsSync(APP)) throw new Error(`Fant ikke appen: ${APP}. Kjør npm run dist først.`);

// ---- Memory on the machine -----------------------------------------------------------------------

function memAvailableMb(): number {
  const line = readFileSync("/proc/meminfo", "utf8").split("\n").find((l) => l.startsWith("MemAvailable:"));
  return Math.floor(Number(line?.split(/\s+/)[1] ?? 0) / 1024);
}
let lowestFree = memAvailableMb();
const freeWatch = setInterval(() => (lowestFree = Math.min(lowestFree, memAvailableMb())), 500);
freeWatch.unref();

async function waitForMemory(): Promise<void> {
  for (let tries = 0; ; tries++) {
    const free = memAvailableMb();
    lowestFree = Math.min(lowestFree, free);
    if (free >= 8192) return;
    if (tries >= 60) throw new Error(`For lite ledig minne: ${free} MB`);
    console.log(`Venter på minne: ${free} MB ledig.`);
    await sleep(10_000);
  }
}

// ---- Processes -----------------------------------------------------------------------------------

interface Proc {
  pid: number;
  start: string;
  cmd: string[];
}

function statOf(pid: number): { ppid: number; start: string; state: string } | null {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0], ppid: Number(fields[1]), start: fields[19] };
  } catch {
    return null;
  }
}

function childrenOf(pid: number): number[] {
  const out: number[] = [];
  let tasks: string[] = [];
  try {
    tasks = readdirSync(`/proc/${pid}/task`);
  } catch {
    return out;
  }
  for (const task of tasks) {
    try {
      for (const child of readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim().split(/\s+/)) if (child) out.push(Number(child));
    } catch {
      // gone
    }
  }
  return out;
}

function cmdOf(pid: number): string[] {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

// pid and everything under it that still runs.
function tree(root: number): Proc[] {
  const out: Proc[] = [];
  const queue = [root];
  const seen = new Set<number>();
  while (queue.length) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const info = statOf(pid);
    if (!info || info.state === "Z") continue;
    out.push({ pid, start: info.start, cmd: cmdOf(pid) });
    queue.push(...childrenOf(pid));
  }
  return out;
}

function alive(p: Proc): boolean {
  const info = statOf(p.pid);
  return !!info && info.state !== "Z" && info.start === p.start;
}

// Processes anywhere on the machine that were started with this sandbox's data folder: what would be
// left without a parent if the app forgot to stop it.
function withDataDir(dataDir: string): Proc[] {
  const out: Proc[] = [];
  const marker = `AD_DATA_DIR=${dataDir}\0`;
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      if (!readFileSync(`/proc/${name}/environ`, "latin1").includes(marker)) continue;
    } catch {
      continue;
    }
    const info = statOf(Number(name));
    if (info && info.state !== "Z") out.push({ pid: Number(name), start: info.start, cmd: cmdOf(Number(name)) });
  }
  return out;
}

function role(p: Proc, serverPid: number, serverTree: Set<number>): string {
  const args = p.cmd.join(" ");
  const sub = /--utility-sub-type=(\S+)/.exec(args)?.[1] ?? "";
  if (p.pid === serverPid) return "server (utilityProcess)";
  if (serverTree.has(p.pid)) return "serverens barn";
  if (/crashpad/.test(args)) return "crashpad";
  const type = /--type=(\S+)/.exec(args)?.[1];
  if (!type) return "hoved";
  if (type === "zygote") return "zygote";
  if (type === "gpu-process") return "GPU";
  if (type === "renderer") return "renderer";
  if (type === "utility") {
    if (sub === "network.mojom.NetworkService") return "nettverk";
    if (sub === "storage.mojom.StorageService") return "lagring";
    if (sub === "audio.mojom.AudioService") return "lyd";
    if (sub === "node.mojom.NodeService") return "utility (node)";
    return `utility (${sub || "?"})`;
  }
  return type;
}

interface Pss {
  pss: number; // kB
  anon: number;
  file: number;
  shmem: number;
  rss: number;
}

function pssOf(pid: number): Pss | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
  } catch {
    return null;
  }
  const field = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? 0);
  return { pss: field("Pss"), anon: field("Pss_Anon"), file: field("Pss_File"), shmem: field("Pss_Shmem"), rss: field("Rss") };
}

interface Sample {
  total: number; // kB
  byRole: Record<string, { pss: number; count: number; anon: number; file: number; shmem: number }>;
  processes: number;
}

function sample(mainPid: number, serverPid: number): Sample {
  const all = tree(mainPid);
  const serverTree = new Set(serverPid ? tree(serverPid).map((p) => p.pid).filter((pid) => pid !== serverPid) : []);
  const byRole: Sample["byRole"] = {};
  let total = 0;
  for (const p of all) {
    const m = pssOf(p.pid);
    if (!m) continue;
    const r = role(p, serverPid, serverTree);
    byRole[r] ??= { pss: 0, count: 0, anon: 0, file: 0, shmem: 0 };
    byRole[r].pss += m.pss;
    byRole[r].anon += m.anon;
    byRole[r].file += m.file;
    byRole[r].shmem += m.shmem;
    byRole[r].count += 1;
    total += m.pss;
  }
  return { total, byRole, processes: all.length };
}

function medianSample(samples: Sample[]): Sample {
  const sorted = [...samples].sort((a, b) => a.total - b.total);
  return sorted[Math.floor(sorted.length / 2)];
}

// ---- The DevTools protocol, over the browser's own WebSocket -------------------------------------

class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners: ((message: any) => void)[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}`));
        else resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener("error", () => reject(new Error(`Kunne ikke koble til ${url}`)), { once: true });
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(listener: (message: any) => void): void {
    this.listeners.push(listener);
  }

  close(): void {
    this.ws.close();
  }
}

// Notes, in the page, the first frame where the composer is visible and the first where the open
// thread's messages are drawn. Put into the UI's document as soon as it exists (polled every few
// ms), before its modules have run; it answers "sent" if the composer was there already.
const PROBE = `(() => {
  if (!/^https?:/.test(location.href)) return "";
  if (window.__adPerf) return "ok";
  const at = { klar: 0, tråd: 0, sent: !!document.querySelector(".composer-wrap") };
  window.__adPerf = at;
  const frame = (key) => requestAnimationFrame(() => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { if (!at[key]) at[key] = performance.timeOrigin + performance.now(); };
    port2.postMessage(0);
  });
  let asked = { klar: false, tråd: false };
  const check = () => {
    const composer = document.querySelector(".composer-wrap textarea, .composer-wrap [contenteditable]");
    if (!asked.klar && composer && composer.getBoundingClientRect().height > 0) { asked.klar = true; frame("klar"); }
    if (!asked.tråd && document.querySelector("[data-thread-id] .row-text")) { asked.tråd = true; frame("tråd"); }
    if (asked.klar && asked.tråd) observer.disconnect();
  };
  const observer = new MutationObserver(check);
  observer.observe(document, { subtree: true, childList: true, attributes: true });
  check();
  return at.sent ? "sent" : "ok";
})()`;

async function devtoolsPort(userData: string, deadline: number): Promise<number> {
  const file = path.join(userData, "DevToolsActivePort");
  while (Date.now() < deadline) {
    try {
      const port = Number(readFileSync(file, "utf8").split("\n")[0]);
      if (port) return port;
    } catch {
      // not yet
    }
    await sleep(5);
  }
  throw new Error("DevToolsActivePort kom ikke");
}

// ---- Seed data -----------------------------------------------------------------------------------

async function seed(dataDir: string, messages: number): Promise<void> {
  if (!messages) return;
  const { Store } = await import("../server/src/db.ts");
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(realpathSync(dataDir));
  const thread = store.createThread(null, "chat", null, { title: `Måling med ${messages} meldinger` });
  store.transaction(() => {
    for (let n = 0; n < messages; n += 2) {
      const runId = randomUUID();
      const text = [
        `## Svar ${n + 1}`,
        `Dette er melding **${n + 1}** med \`kode\`, en [lenke](https://example.com) og en liste:`,
        "- første punkt\n- andre punkt",
        "```ts",
        `export function steg${n}(verdi: number): number {`,
        `  return verdi * ${n + 1};`,
        "}",
        "```",
      ].join("\n\n");
      store.appendEvent(thread.id, { type: "user.message", messageId: randomUUID(), text: `Spørsmål ${n}` });
      store.appendMessage(thread.id, { role: "user", content: [{ type: "text", text: `Spørsmål ${n}` }] });
      store.appendEvent(thread.id, { type: "run.started", runId, modelId: "mock-demo" });
      store.appendEvent(thread.id, { type: "text.delta", runId, messageId: randomUUID(), text });
      store.appendMessage(thread.id, { role: "assistant", content: [{ type: "text", text }] });
      store.appendEvent(thread.id, { type: "run.finished", runId, status: "done" });
    }
  });
  store.close();
}

// ---- One run ---------------------------------------------------------------------------------------

type Scenario = "rest" | "long" | "tray" | "stream";

interface RunResult {
  scenario: Scenario;
  timings: Record<string, number> | null; // ms from the start of the process
  memory: Sample;
  visible?: Sample; // tray: the same start before the window was hidden
  peak?: Sample; // stream: the highest total while the mock model streamed
  samples: number[];
  quitMs: number;
  leftovers: string[];
  gpuSwitches: string;
  notes: string[];
}

function sandbox(tray: boolean) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-perf-desktop-")));
  const home = path.join(dir, "home");
  const dataDir = path.join(dir, "data");
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(dir, "run"), { recursive: true, mode: 0o700 });
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
    AD_KEYRING: "memory",
    AD_DESKTOP_TRAY: tray ? "on" : "off",
    AD_DESKTOP_TEST_EXTERNAL: path.join(dir, "external.log"),
    AD_DESKTOP_TIMING: "1", // main.ts and server-entry.ts print when each step of the start happens
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(dir, "no-bus")}`,
  });
  return { dir, dataDir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}


async function quit(child: ChildProcess, mainPid: number, dataDir: string): Promise<{ quitMs: number; leftovers: string[] }> {
  const before = tree(mainPid);
  const exited = new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", () => resolve())));
  const at = Date.now();
  process.kill(mainPid, "SIGTERM"); // as when the session ends; Ctrl+Q takes the same path in main.ts
  await Promise.race([exited, sleep(20_000)]);
  const until = Date.now() + 15_000;
  while (Date.now() < until && before.some(alive)) await sleep(50);
  const quitMs = Date.now() - at;
  await sleep(500);
  const left = [...before.filter(alive), ...withDataDir(dataDir).filter((p) => !before.some((b) => b.pid === p.pid))];
  const leftovers = left.map((p) => `${p.pid} ${p.cmd.join(" ").slice(0, 160)}`);
  // Clean up after a leak, one known PID at a time, after a look at what it is.
  for (const p of left) {
    if (!alive(p)) continue;
    const cmd = cmdOf(p.pid).join(" ");
    if (cmd.includes(path.dirname(APP)) || withDataDir(dataDir).some((q) => q.pid === p.pid)) {
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {
        // gone
      }
    }
  }
  return { quitMs, leftovers };
}

// The starts at rest share one data folder, as the user's starts do: the first one is with a new
// profile (no HTTP or code cache, no saved port), the others are ordinary starts.
type Box = ReturnType<typeof sandbox>;
let restBox: Box | null = null;
const cleanupRest = () => (restBox as Box | null)?.cleanup();

async function run(scenario: Scenario, shared = false): Promise<RunResult> {
  await waitForMemory();
  const fresh = !shared || !restBox;
  const box = shared ? (restBox ??= sandbox(false)) : sandbox(scenario === "tray");
  const notes: string[] = [];
  if (fresh) await seed(box.dataDir, scenario === "long" ? 300 : 10);
  const userData = path.join(box.dataDir, "electron");
  const args = ["--ozone-platform=x11", ...(USE_CDP ? ["--remote-debugging-port=0"] : []), ...extraArgs];
  rmSync(path.join(userData, "DevToolsActivePort"), { force: true }); // left by the start before
  const t0 = Date.now();
  const child = spawn(APP, args, { env: box.env, stdio: ["ignore", "pipe", "pipe"] });
  const mainPid = child.pid!;
  let out = "";
  let loadedAt = 0;
  child.stdout!.on("data", (chunk) => {
    out += chunk;
    if (!loadedAt && out.includes("Agentic Desktop er klar.")) loadedAt = Date.now();
  });
  child.stderr!.on("data", (chunk) => (out += chunk));
  let cdp: Cdp | null = null;
  let visible: Sample | undefined;
  let peak: Sample | undefined;
  let timings: Record<string, number> | null = null;
  try {
    let pageSession = "";
    if (USE_CDP) {
      const port = await devtoolsPort(userData, Date.now() + 30_000);
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      cdp = await Cdp.connect(version.webSocketDebuggerUrl);
      const sessions = new Map<string, string>(); // sessionId -> url
      cdp.on(async (message) => {
        if (message.method !== "Target.attachedToTarget") return;
        const { sessionId, targetInfo, waitingForDebugger } = message.params;
        if (targetInfo.type !== "page") {
          if (waitingForDebugger) void cdp!.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
          return;
        }
        sessions.set(sessionId, targetInfo.url);
        if (/^https?:/.test(targetInfo.url)) notes.push(`siden var allerede lastet da målingen koblet til (${targetInfo.url.replace(/#.*/, "")})`);
        if (waitingForDebugger) await cdp!.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
        if (!pageSession) pageSession = sessionId;
      });
      await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    }

    // Until the UI has loaded. With CDP, the probe goes into the UI's document as soon as it exists.
    const until = Date.now() + 60_000;
    let probed = !USE_CDP;
    while ((!loadedAt || !probed) && Date.now() < until) {
      if (child.exitCode !== null) throw new Error(`Appen stoppet:\n${out.slice(-2000)}`);
      if (!probed && pageSession) {
        const answer = (await cdp!.send("Runtime.evaluate", { expression: PROBE, returnByValue: true }, pageSession).catch(() => null))?.result?.value;
        if (answer === "sent") notes.push("målingen kom for sent til en start");
        if (answer) probed = true;
        else await sleep(3);
        continue;
      }
      await sleep(20);
    }
    if (!loadedAt) throw new Error(`Grensesnittet kom ikke:\n${out.slice(-2000)}`);
    const instance = JSON.parse(readFileSync(path.join(box.dataDir, "instance.json"), "utf8"));

    if (cdp) {
      const evaluate = async (expression: string) => (await cdp!.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, pageSession)).result?.value;
      const wait = async (expression: string, what: string, ms = 30_000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const value = await evaluate(expression).catch(() => null);
          if (value) return value;
          await sleep(25);
        }
        const state = await evaluate(`JSON.stringify({ url: location.href.replace(/#.*/, ""), perf: window.__adPerf ?? null, composer: !!document.querySelector(".composer-wrap"), rows: document.querySelectorAll("[data-thread-id] .row-text").length, panes: document.querySelectorAll("[data-thread-id]").length })`).catch((e) => String(e));
        throw new Error(`Ventet for lenge: ${what}. Siden: ${state}. Notater: ${notes.join("; ")}`);
      };
      const perf = await wait("window.__adPerf && window.__adPerf.klar && window.__adPerf.tråd ? JSON.stringify(window.__adPerf) : null", "meldingsfeltet og tråden");
      const marks = JSON.parse(perf);
      const page = JSON.parse(
        await evaluate(`JSON.stringify({ origin: performance.timeOrigin, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0, fp: performance.getEntriesByName("first-paint")[0]?.startTime ?? 0 })`),
      );
      timings = {
        "serveren lytter": instance.startedAt - t0,
        "siden begynner å laste": page.origin - t0,
        "første bilde": page.origin + page.fcp - t0,
        "klar (meldingsfeltet)": marks.klar - t0,
        "tråden er tegnet": marks.tråd - t0,
        "load (main.ts)": loadedAt - t0,
      };
      // The steps main.ts and the server print with AD_DESKTOP_TIMING=1 (older builds print none).
      for (const match of out.matchAll(/^tid: (\S+) (\d+)$/gm)) timings[`steg: ${match[1]}`] ??= Number(match[2]) - t0;

      if (scenario === "long") {
        // Read the whole thread: up to the start in steps, so older messages load, and back down.
        // Upwards in steps until no older messages come, then down again in steps.
        const read = JSON.parse(await evaluate(`(async () => {
          const el = document.querySelector("[data-thread-id] .scroller");
          if (!el) return JSON.stringify({ error: "fant ikke .scroller" });
          const pause = (ms) => new Promise((r) => setTimeout(r, ms));
          let stable = 0, last = -1, steps = 0;
          while (stable < 4 && steps < 2000) {
            el.scrollTop = Math.max(0, el.scrollTop - 1200); steps++;
            await pause(16);
            if (el.scrollTop === 0) { await pause(150); if (el.scrollHeight === last) stable++; else stable = 0; last = el.scrollHeight; }
          }
          const top = el.scrollHeight;
          while (el.scrollTop + el.clientHeight < el.scrollHeight - 2 && steps < 4000) { el.scrollTop += 1200; steps++; await pause(16); }
          await pause(300);
          return JSON.stringify({ height: top, steps, chunks: document.querySelectorAll("[data-thread-id] .chunk").length, rows: document.querySelectorAll("[data-thread-id] .row-text, [data-thread-id] .row-user").length });
        })()`));
        notes.push(read.error ?? `lang tråd lest: ${read.height} px høy, ${read.steps} scrollesteg, ${read.chunks} biter`);
      }
      if (scenario === "stream") {
        // 20 answers of 200 000 characters from the demo model into the open thread, one after the
        // other, as fast as the server can (AD_MOCK_DELAY_MS=1). The window shows them as they come.
        const threadId = await evaluate(`document.querySelector("[data-thread-id]")?.getAttribute("data-thread-id") ?? ""`);
        let streaming = true;
        const watch = (async () => {
          while (streaming) {
            const now = sample(mainPid, instance.pid);
            if (!peak || now.total > peak.total) peak = now;
            await sleep(250);
          }
        })();
        const started = Date.now();
        for (let i = 0; i < 20; i++) {
          await evaluate(`fetch("/api/threads/${threadId}/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "lang strøm 200000" }) }).then((r) => r.status)`);
          await wait(`fetch("/api/bootstrap").then((r) => r.json()).then((b) => { const t = b.threads.find((t) => t.id === "${threadId}"); return t && !t.running ? 1 : 0; })`, "strømmen ble ferdig", 120_000);
        }
        streaming = false;
        await watch;
        notes.push(`20 × 200 000 tegn strømmet på ${((Date.now() - started) / 1000).toFixed(0)} s`);
      }
      if (scenario === "tray") {
        // First at rest with the window shown and the icon in the status area, then hidden.
        await sleep(QUICK ? 500 : 20_000);
        visible = sample(mainPid, instance.pid);
        await evaluate("window.agenticDesktop.window.close()");
        await wait(`document.visibilityState === "hidden" ? 1 : 0`, "vinduet er skjult", 10_000);
      }
      await cdp.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false }).catch(() => undefined);
      cdp.close();
      cdp = null;
    } else if (scenario === "tray") {
      notes.push("uten CDP kan ikke vinduet skjules; måler som hvile");
    }

    // At rest: let it settle, then read three times.
    await sleep(QUICK ? 500 : 20_000);
    const samples: Sample[] = [];
    for (let i = 0; i < (QUICK ? 1 : 3); i++) {
      samples.push(sample(mainPid, instance.pid));
      await sleep(QUICK ? 0 : 3000);
    }
    const gpu = tree(mainPid).find((p) => p.cmd.some((a) => a === "--type=gpu-process"));
    const gpuSwitches = (gpu?.cmd ?? []).filter((a) => /^--(use-gl|use-angle|enable-unsafe-swiftshader|gpu-preferences|use-vulkan|ozone-platform)/.test(a)).map((a) => a.slice(0, 60)).join(" ");
    const { quitMs, leftovers } = await quit(child, mainPid, box.dataDir);
    if (APP_LOG) appendFileSync(APP_LOG, `---- ${scenario}\n${out}\n`);
    return { scenario, timings, memory: medianSample(samples), visible, peak, samples: samples.map((s) => s.total), quitMs, leftovers, gpuSwitches, notes };
  } catch (err) {
    cdp?.close();
    if (child.exitCode === null) await quit(child, mainPid, box.dataDir).catch(() => undefined);
    throw err;
  } finally {
    if (!shared) box.cleanup();
  }
}

// ---- All runs and the report ------------------------------------------------------------------------

const mbOf = (kb: number) => (kb / 1024).toFixed(1).replace(".", ",");
const median = (values: number[]) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const results: RunResult[] = [];
console.log(`Måler ${APP} (${LABEL}), MemAvailable ${memAvailableMb()} MB.`);
// One warm-up start first, so all measured starts read the app from the page cache.
console.log("Oppvarming ...");
await run("rest").catch((err) => console.log(`Oppvarmingen feilet: ${(err as Error).message}`));
const plan: Scenario[] = [];
if (ONLY.has("rest")) for (let i = 0; i < RUNS + 1; i++) plan.push("rest"); // + the first start
if (ONLY.has("long")) for (let i = 0; i < Math.max(2, Math.ceil(RUNS / 2)); i++) plan.push("long");
if (ONLY.has("stream")) for (let i = 0; i < Math.max(2, Math.ceil(RUNS / 2)); i++) plan.push("stream");
if (ONLY.has("tray")) for (let i = 0; i < Math.max(2, Math.ceil(RUNS / 2)); i++) plan.push("tray");
process.on("exit", cleanupRest);
for (const [i, scenario] of plan.entries()) {
  const result = await run(scenario, scenario === "rest");
  results.push(result);
  const t = result.timings;
  console.log(
    `${i + 1}/${plan.length} ${scenario}: ${mbOf(result.memory.total)} MB PSS i ${result.memory.processes} prosesser` +
      (t ? `, første bilde ${Math.round(t["første bilde"])} ms, klar ${Math.round(t["klar (meldingsfeltet)"])} ms` : "") +
      `, avsluttet på ${result.quitMs} ms${result.leftovers.length ? `, LEKKASJE: ${result.leftovers.join("; ")}` : ""}${result.notes.length ? ` (${result.notes.join("; ")})` : ""}`,
  );
}
clearInterval(freeWatch);
cleanupRest();

const columns: { name: string; of: (r: RunResult) => Sample | undefined; scenario: Scenario }[] = [
  { name: "Hvile, én kort tråd", scenario: "rest", of: (r) => r.memory },
  { name: "Hvile etter lang tråd (300 meldinger)", scenario: "long", of: (r) => r.memory },
  { name: "Ikon i statusfeltet, vinduet vises", scenario: "tray", of: (r) => r.visible },
  { name: "Skjult i statusfeltet", scenario: "tray", of: (r) => r.memory },
  { name: "Høyest under strømming (20 × 200 000 tegn)", scenario: "stream", of: (r) => r.peak },
  { name: "Hvile 20 s etter strømmingen", scenario: "stream", of: (r) => r.memory },
];
const present = columns.filter((c) => results.some((r) => r.scenario === c.scenario && c.of(r)));
const samplesOf = (c: (typeof columns)[number]) => results.filter((r) => r.scenario === c.scenario).map(c.of).filter((x): x is Sample => !!x);
const roles = [...new Set(results.flatMap((r) => [...Object.keys(r.memory.byRole), ...Object.keys(r.visible?.byRole ?? {})]))].sort();
const lines: string[] = [];
lines.push(`### ${LABEL}`, "");
lines.push(`Målt ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. App: \`${APP.startsWith(ROOT) ? path.relative(ROOT, APP) : APP}\`${extraArgs.length ? `, ekstra brytere \`${extraArgs.join(" ")}\`` : ""}. ${USE_CDP ? "Tidene over CDP, som er koblet fra før minnet leses." : "Uten CDP."} ${RUNS + 1} starter i hvile med samme profil, og ${Math.max(2, Math.ceil(RUNS / 2))} av hver av de andre. Laveste MemAvailable under målingen: ${lowestFree} MB.`, "");
lines.push("**Minne, PSS i MB (median):**", "");
lines.push(`| Prosess | ${present.map((c) => c.name).join(" | ")} |`, `|---|${present.map(() => "---:").join("|")}|`);
for (const r of roles) {
  const cells = present.map((c) => {
    const own = samplesOf(c);
    const count = Math.max(...own.map((x) => x.byRole[r]?.count ?? 0));
    return `${mbOf(median(own.map((x) => x.byRole[r]?.pss ?? 0)))}${count > 1 ? ` (${count})` : ""}`;
  });
  lines.push(`| ${r} | ${cells.join(" | ")} |`);
}
lines.push(`| **Sum** | ${present.map((c) => `**${mbOf(median(samplesOf(c).map((x) => x.total)))}**`).join(" | ")} |`);
lines.push(`| Prosesser | ${present.map((c) => String(median(samplesOf(c).map((x) => x.processes)))).join(" | ")} |`, "");
const restTimed = results.filter((r) => r.timings && r.scenario === "rest");
const firstStart = restTimed[0];
const timed = restTimed.length > 1 ? restTimed.slice(1) : restTimed;
if (timed.length) {
  lines.push(
    `**Oppstart, ms fra prosessen startes, hvile med kort tråd.** Vanlig start er medianen av ${timed.length} starter med den samme profilen. Første start er med ny profil, uten hurtigbuffer.`,
    "",
    "| Steg | Vanlig start | Min | Maks | Første start |",
    "|---|---:|---:|---:|---:|",
  );
  for (const key of Object.keys(timed[0].timings!)) {
    const values = timed.map((r) => r.timings![key]).filter(Number.isFinite);
    if (!values.length) continue;
    lines.push(`| ${key} | ${Math.round(median(values))} | ${Math.round(Math.min(...values))} | ${Math.round(Math.max(...values))} | ${firstStart && Number.isFinite(firstStart.timings![key]) ? Math.round(firstStart.timings![key]) : ""} |`);
  }
  const longTimed = results.filter((r) => r.timings && r.scenario === "long");
  if (longTimed.length) lines.push(`| tråden er tegnet, 300 meldinger | ${Math.round(median(longTimed.map((r) => r.timings!["tråden er tegnet"])))} | | |`);
  lines.push("");
}
lines.push(`**Avslutning:** median ${Math.round(median(results.map((r) => r.quitMs)))} ms til alle prosessene var borte. Prosesser igjen etter avslutning: ${results.reduce((n, r) => n + r.leftovers.length, 0)} i ${results.length} kjøringer.`, "");
const gpu = results.find((r) => r.gpuSwitches)?.gpuSwitches;
if (gpu) lines.push(`GPU-prosessen under xvfb: \`${gpu}\`.`, "");
const notes = [...new Set(results.flatMap((r) => r.notes))];
if (notes.length) lines.push(`Merknader: ${notes.join("; ")}.`, "");
const markdown = lines.join("\n");
console.log(`\n${markdown}`);

if (JSON_OUT) writeFileSync(JSON_OUT, `${JSON.stringify({ label: LABEL, app: APP, extraArgs, lowestFree, results }, null, 2)}\n`);
if (WRITE_DOC) {
  const start = "<!-- perf-desktop:start -->";
  const end = "<!-- perf-desktop:end -->";
  const doc = existsSync(DOC) ? readFileSync(DOC, "utf8") : `# Electron-appen: oppstart og minne\n\n${start}\n${end}\n`;
  const [head, rest] = doc.includes(start) ? doc.split(start) : [`${doc}\n`, `\n${end}\n`];
  const tail = rest.slice(rest.indexOf(end) + end.length);
  writeFileSync(DOC, `${head}${start}\n## Siste måling fra scripts/perf-desktop.ts\n\n${markdown}\n${end}${tail}`);
}
