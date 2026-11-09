// npm run perf: measures the real UI in headless Chrome and writes docs/perf-latest.md.
//
// The tool tests itself first. Hermes's measuring tool counted frames double and reported 3 fps
// for something running at 23, so here every number comes with a control: a set of pages with a
// known answer, and if the tool gets one of them wrong it stops and refuses to report.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import { closeChrome, launchChrome, startServer, type ServerProcess } from "../web/test/harness.ts";
import { productionBuild } from "./build-lib.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
// The server reads AD_WEB_DIST too (server/src/config.ts), and inherits it from here. With it set,
// nothing is ever built and web/dist is never touched.
const WEB_DIST = process.env.AD_WEB_DIST ? path.resolve(process.env.AD_WEB_DIST) : path.join(ROOT, "web/dist");
const BUDGET_MS = 1000 / 240;
const RUNS = Number(process.env.AD_PERF_RUNS ?? 3);
// Playwright's own waits (click, waitForSelector, waitFor) give up after this, with its message.
const ACTION_TIMEOUT_MS = 15_000;

// Every step has a time limit, so the run can never hang: it stops with a message that says which
// step, how long it waited and what it was waiting for, and the finally block closes everything.
async function step<T>(name: string, limitMs: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Steget «${name}» ble ikke ferdig på ${Math.round(limitMs / 1000)} s. Målingen stoppes uten tall.`)), limitMs);
  });
  const started = Date.now();
  try {
    return await Promise.race([work(), timeout]);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    throw new Error(message.startsWith("Steget «") ? message : `Steget «${name}» feilet etter ${((Date.now() - started) / 1000).toFixed(1)} s: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
// Headless Chrome stays at 60 Hz, so the numbers that matter for 240 Hz are task times from the
// trace, not frame intervals. --disable-frame-rate-limit and --disable-gpu-vsync used to be here
// to lift that cap. They do not lift it on an idle page, but as soon as a CSS animation runs (a
// pulsing status dot, the arc on the stop button) they do: requestAnimationFrame then fires about
// 12 000 times a second, and the recorder's own rAF loop makes Chrome run a main frame for each.
// That made "busy" while streaming about three times too high, and not comparable with 0.1, which
// had no running animations. Without them the cap is the same with and without an animation, and
// a control below checks that. The GL flags put compositing on the real GPU, without a window,
// which is closer to the user's machine.
const CHROME_FLAGS = [
  "--use-gl=angle",
  "--use-angle=gl",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];
const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "viz", "benchmark", "input.scrolling", "latencyInfo"];

interface Stats {
  count: number;
  p50: number;
  p99: number;
  worst: number;
}

function stats(values: number[]): Stats {
  if (!values.length) return { count: 0, p50: 0, p99: 0, worst: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { count: values.length, p50: at(0.5), p99: at(0.99), worst: sorted.at(-1)! };
}

const fmt = (ms: number) => ms.toFixed(ms < 10 ? 2 : 1);
const row = (s: Stats) => `${fmt(s.p50)} | ${fmt(s.p99)} | ${fmt(s.worst)} | ${s.count}`;

// In the page. One rAF loop, one array: a frame can only be counted once. Callbacks the app
// schedules are timed by wrapping requestAnimationFrame, which needs no changes in the app.
const RECORDER = `(() => {
  window.__adFrameMs = 1000 / 240; // The app's budget for work it can split, see web/src/lib/frame.ts.
  const realRaf = window.requestAnimationFrame.bind(window);
  const state = { on: false, frames: [], callbacks: [], longTasks: [], loafs: [], at: 0 };
  window.requestAnimationFrame = (cb) => realRaf((t) => {
    const start = performance.now();
    cb(t);
    if (state.on) state.callbacks.push([start, performance.now() - start]);
  });
  try {
    new PerformanceObserver((list) => {
      if (!state.on) return;
      for (const e of list.getEntries()) state.longTasks.push(e.duration);
    }).observe({ type: "longtask" });
    new PerformanceObserver((list) => {
      if (!state.on) return;
      for (const e of list.getEntries()) state.loafs.push(e.duration);
    }).observe({ type: "long-animation-frame" });
  } catch {}
  let run = 0;
  const loop = (id) => {
    if (!state.on || id !== run) return;
    state.frames.push(performance.now());
    realRaf(() => loop(id));
  };
  window.__perf = {
    start() {
      Object.assign(state, { on: true, frames: [], callbacks: [], longTasks: [], loafs: [] });
      const id = ++run;
      realRaf(() => loop(id));
    },
    frameCount: () => state.frames.length,
    async stop() {
      const frames = state.frames.slice();
      await new Promise((resolve) => realRaf(() => setTimeout(resolve, 80))); // Late observer entries.
      state.on = false;
      return { frames, callbacks: state.callbacks, longTasks: state.longTasks, loafs: state.loafs };
    },
  };
})();`;

interface Recording {
  frames: number[];
  callbacks: Array<[number, number]>;
  longTasks: number[];
  loafs: number[];
}

interface Measured {
  frameMs: Stats;
  fps: number;
  callbackMs: Stats;
  longTasks: number;
  longTaskWorst: number;
  taskMs: Stats; // Main-thread tasks of at least 0.25 ms, from the trace.
  mainTasks: { over4ms: number; over16ms: number; worst: number; busyPercent: number } | null;
  scrollLatencyMs: Stats | null; // EventLatency: from a scroll input to the frame showing it.
  compositorTaskWorst: number | null;
  recording: Recording;
}

function intervals(frames: number[]): number[] {
  return frames.slice(1).map((t, i) => t - frames[i]);
}

interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: any;
  id?: string;
  id2?: { local?: string; global?: string };
}

function analyzeTrace(buffer: Buffer): Pick<Measured, "mainTasks" | "scrollLatencyMs" | "taskMs" | "compositorTaskWorst"> {
  const { traceEvents } = JSON.parse(buffer.toString("utf8")) as { traceEvents: TraceEvent[] };
  const threads = new Map<string, string>();
  for (const e of traceEvents) if (e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args?.name);
  const started = traceEvents.find((e) => e.name === "TracingStartedInBrowser");
  const rendererPid = started?.args?.data?.frames?.[0]?.processId;
  const inRenderer = (e: TraceEvent, thread: string) => threads.get(`${e.pid}:${e.tid}`) === thread && (!rendererPid || e.pid === rendererPid);
  const main = traceEvents.filter((e) => e.name === "RunTask" && e.ph === "X" && inRenderer(e, "CrRendererMain"));
  const durations = main.map((e) => (e.dur ?? 0) / 1000);
  const first = main.length ? Math.min(...main.map((e) => e.ts)) : 0;
  const last = main.length ? Math.max(...main.map((e) => e.ts + (e.dur ?? 0))) : 1;

  // EventLatency runs from the input until the frame with its result was presented.
  const open = new Map<string, TraceEvent>();
  const latencies: number[] = [];
  for (const e of traceEvents) {
    if (e.name !== "EventLatency") continue;
    const id = e.id ?? e.id2?.local ?? e.id2?.global ?? "";
    if (e.ph === "b") open.set(id, e);
    else if (e.ph === "e") {
      const begin = open.get(id);
      open.delete(id);
      const type = String(begin?.args?.event_latency?.event_type ?? "");
      if (begin && /SCROLL_UPDATE/.test(type)) latencies.push((e.ts - begin.ts) / 1000);
    }
  }
  const compositor = traceEvents.filter((e) => e.name === "RunTask" && e.ph === "X" && inRenderer(e, "Compositor"));
  return {
    taskMs: stats(durations.filter((d) => d >= 0.25)),
    mainTasks: main.length
      ? {
          over4ms: durations.filter((d) => d > BUDGET_MS).length,
          over16ms: durations.filter((d) => d > 1000 / 60).length,
          worst: Math.max(...durations),
          busyPercent: (durations.reduce((a, b) => a + b, 0) / ((last - first) / 1000)) * 100,
        }
      : null,
    scrollLatencyMs: latencies.length ? stats(latencies) : null,
    compositorTaskWorst: compositor.length ? Math.max(...compositor.map((e) => (e.dur ?? 0) / 1000)) : null,
  };
}

async function measure(browser: Browser, page: Page, work: () => Promise<void>): Promise<Measured> {
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  await page.evaluate(() => (window as any).__perf.start());
  await work();
  const recording = await page.evaluate(() => (window as any).__perf.stop()) as Recording;
  const trace = await browser.stopTracing();
  const frameMs = stats(intervals(recording.frames));
  const span = (recording.frames.at(-1)! - recording.frames[0]) / 1000;
  return {
    frameMs,
    fps: frameMs.count / span,
    callbackMs: stats(recording.callbacks.map((c) => c[1])),
    longTasks: recording.longTasks.length,
    longTaskWorst: Math.max(0, ...recording.longTasks),
    recording,
    ...analyzeTrace(trace),
  };
}

// Controls. Each page has a known behaviour, and the tool has to find it.

const CONTROL_PAGE = `<!doctype html><title>kontroll</title><style>
html, body { margin: 0; height: 100% }
#list { height: 100%; overflow-y: auto }
#list div { height: 40px }
</style><div id="list"></div><script>
const list = document.getElementById("list");
for (let i = 0; i < 2000; i++) list.appendChild(document.createElement("div")).textContent = "rad " + i;
const blockFor = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };
window.control = {
  // Busy for exactly ms in every frame: the frame time cannot be shorter.
  busyFrames(ms) { this.loop(ms); },
  // Counts frames with its own independent loop, to compare with the tool.
  countFrames() { this.loop(0); },
  loop(ms) {
    window.selfCount = 0;
    const generation = (window.generation = (window.generation ?? 0) + 1);
    const step = () => {
      if (window.generation !== generation) return;
      window.selfCount++;
      if (ms) blockFor(ms);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  jank(ms, every, times) {
    let left = times;
    const timer = setInterval(() => { blockFor(ms); if (--left === 0) clearInterval(timer); }, every);
  },
  stop() { window.generation++; return window.selfCount; },
  // An infinite CSS animation, like the app's status dots while something runs.
  animate(on) { document.body.classList.toggle("pulse", on); },
};
</script><style>@keyframes pulse { 50% { opacity: 0.5 } } body.pulse #list div:first-child { animation: pulse 2s infinite }</style>`;

interface ControlResult {
  name: string;
  expected: string;
  got: string;
  ok: boolean;
}

async function runControls(browser: Browser): Promise<{ results: ControlResult[]; capFps: number }> {
  const server = http.createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(CONTROL_PAGE));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await context.addInitScript(RECORDER);
  const page = await context.newPage();
  const results: ControlResult[] = [];
  const check = (name: string, expected: string, got: string, ok: boolean) => results.push({ name, expected, got, ok });
  let capFps = 0;

  try {
    await page.goto(url);
    await page.waitForLoadState("load");

    // 1. Counts each frame once: the tool's count against the page's own loop, in the same window.
    await page.evaluate(() => {
      (window as any).__perf.start();
      (window as any).control.countFrames();
    });
    await page.waitForTimeout(1500);
    const counts = await page.evaluate(() => ({ own: (window as any).control.stop() as number, tool: (window as any).__perf.frameCount() as number }));
    await page.evaluate(() => (window as any).__perf.stop());
    const ratio = counts.tool / counts.own;
    capFps = counts.tool / 1.5;
    check("Hvert bilde telles én gang", "verktøyet og sidens egen teller er like, innen 3 %", `${counts.tool} mot ${counts.own} bilder (forhold ${ratio.toFixed(3)})`, ratio > 0.97 && ratio < 1.03);

    // 1b. The cap must not change when a CSS animation runs, or every scenario with a pulsing dot
    // gets more frames, and so more work, than one without. With --disable-frame-rate-limit it went
    // from 59 to about 12 000 frames a second here.
    await page.evaluate(() => (window as any).control.animate(true));
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as any).__perf.start());
    await page.waitForTimeout(1500);
    const animatedFps = (await page.evaluate(() => (window as any).__perf.frameCount() as number)) / 1.5;
    await page.evaluate(() => (window as any).__perf.stop());
    await page.evaluate(() => (window as any).control.animate(false));
    check("Taket er det samme mens en CSS-animasjon går", "bilder i sekundet med en uendelig animasjon er innen 10 % av uten", `${animatedFps.toFixed(0)} mot ${capFps.toFixed(0)} bilder i sekundet`, animatedFps > capFps * 0.9 && animatedFps < capFps * 1.1);

    // 2. A frame that takes 16 ms. The cap is 60 Hz, so the interval is close to that too.
    await page.evaluate(() => (window as any).control.busyFrames(16));
    const busy = await measure(browser, page, () => page.waitForTimeout(1500));
    await page.evaluate(() => (window as any).control.stop());
    check("Kjent arbeid: 16 ms per bilde", "oppgaven i sporet tar 16 til 18 ms, og intervallet er 16 til 34 ms", `oppgave p50 ${fmt(busy.taskMs.p50)} ms, intervall p50 ${fmt(busy.frameMs.p50)} ms`, busy.taskMs.p50 >= 15.9 && busy.taskMs.p50 <= 18 && busy.frameMs.p50 >= 15.9 && busy.frameMs.p50 <= 34);

    // 3. A different known cost, so the result above cannot be a constant. Under a cap the
    // interval snaps to whole frames, which is why the task time is the exact one.
    await page.evaluate(() => (window as any).control.busyFrames(40));
    const slow = await measure(browser, page, () => page.waitForTimeout(1500));
    await page.evaluate(() => (window as any).control.stop());
    check("Kjent arbeid: 40 ms per bilde", "oppgaven i sporet tar 40 til 42 ms, og intervallet er 40 til 70 ms", `oppgave p50 ${fmt(slow.taskMs.p50)} ms, intervall p50 ${fmt(slow.frameMs.p50)} ms`, slow.taskMs.p50 >= 39.9 && slow.taskMs.p50 <= 42 && slow.frameMs.p50 >= 39.9 && slow.frameMs.p50 <= 70);

    // 4. Five 100 ms long tasks, every 400 ms.
    await page.evaluate(() => (window as any).control.jank(100, 400, 5));
    const jank = await measure(browser, page, () => page.waitForTimeout(2600));
    const main = jank.mainTasks;
    check("Kjente lange oppgaver: 5 på 100 ms", "5 lange oppgaver, verste bilde minst 100 ms, sporet ser dem også", `${jank.longTasks} lange oppgaver, verste bilde ${fmt(jank.frameMs.worst)} ms, sporet: verste oppgave ${main ? fmt(main.worst) : "?"} ms`, jank.longTasks === 5 && jank.frameMs.worst >= 100 && jank.frameMs.worst < 150 && (main?.worst ?? 0) >= 100 && (main?.worst ?? 0) < 130);

    // 5. Idle means nothing to report: no false long tasks.
    const idle = await measure(browser, page, () => page.waitForTimeout(1000));
    check("Tom side gir ingen falske funn", "0 lange oppgaver", `${idle.longTasks} lange oppgaver, verste bilde ${fmt(idle.frameMs.worst)} ms`, idle.longTasks === 0);

    // 6. The gesture really goes through the compositor: it moves the page while the main thread is blocked.
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => (window as any).control.jank(600, 50, 1));
    const before = Date.now();
    await scrollGesture(cdp, { x: 600, y: 400, distance: -3000, speed: 6000 });
    const elapsed = Date.now() - before;
    await page.waitForTimeout(700);
    const scrolled = await page.evaluate(() => document.getElementById("list")!.scrollTop);
    check("Skrollbevegelsen går på kompositoren", "siden flytter seg 3000 px selv om hovedtråden er blokkert i 600 ms", `flyttet ${Math.round(scrolled)} px på ${elapsed} ms`, Math.abs(scrolled - 3000) < 60);
    await cdp.detach();
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
  return { results, capFps };
}

async function compositingMode(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto("chrome://gpu");
    await page.waitForTimeout(600);
    const text = await page.evaluate(() => {
      const view = document.querySelector("info-view")?.shadowRoot ?? document.body;
      return (view as any).textContent as string;
    });
    const mode = /Compositing:\s*([A-Za-z ]+?)(?:\*|Multiple|OpenGL|\s{2})/.exec(text)?.[1]?.trim();
    const renderer = /GL_RENDERER\s*(.{0,80}?)(?:GL_VERSION|\s{2})/.exec(text)?.[1]?.trim();
    return `${mode ?? "ukjent"}${renderer ? `, ${renderer}` : ""}`;
  } catch {
    return "ukjent";
  } finally {
    await page.close();
  }
}

async function scrollGesture(cdp: CDPSession, options: { x: number; y: number; distance: number; speed: number }): Promise<void> {
  await cdp.send("Input.synthesizeScrollGesture", {
    x: options.x,
    y: options.y,
    yDistance: options.distance,
    speed: options.speed,
    gestureSourceType: "mouse",
    preventFling: true,
  });
}

// The app.

async function openApp(browser: Browser, server: ServerProcess, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await context.addInitScript(RECORDER);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.link);
  await page.waitForSelector(".app");
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

const threadRow = (page: Page, id: string) => page.locator(`[data-thread-item="${id}"]`);

async function postJson(page: Page, url: string, body: unknown): Promise<any> {
  return page.evaluate(async ([u, b]) => {
    const res = await fetch(u as string, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    if (!res.ok) throw new Error(`${u}: ${res.status}`);
    return res.json();
  }, [url, body]);
}

// Round 10 (SPEC 23.8): an empty thread has no title and is not in the sidebar until it gets one,
// so a thread made here to stream into is given a name first, the way a first message would.
async function namedThread(page: Page, title: string): Promise<any> {
  const created = await postJson(page, "/api/threads", { projectId: null, mode: "chat" });
  await page.evaluate(async ([u, t]) => {
    const res = await fetch(u, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: t }) });
    if (!res.ok) throw new Error(`${u}: ${res.status}`);
  }, [`/api/threads/${created.id}`, title]);
  return created;
}

// Sparse on purpose, so the waiting does not show up in what is measured.
async function waitForRunEnd(page: Page, threadId: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const running = await page.evaluate(async (id) => {
      const res = await fetch("/api/bootstrap");
      const boot = await res.json();
      return boot.threads.find((t: any) => t.id === id)?.running ?? false;
    }, threadId);
    if (!running) return;
  }
  throw new Error("Kjøringen ble ikke ferdig");
}

// Click on a thread in the sidebar, until the new thread is in the DOM and a frame has followed.
// Measured on the page's own clock, from the input event's timestamp, so it is the same clock as
// the gesture. A thread that is shown already gives no change to wait for, so that is an error,
// and so is a switch that takes more than ten seconds: the run stops with a message, never hangs.
async function measureSwitch(page: Page, id: string): Promise<{ toDom: number; toFrame: number }> {
  await threadRow(page, id).scrollIntoViewIfNeeded();
  const box = await threadRow(page, id).boundingBox();
  if (!box) throw new Error(`Tråden ${id} har ingen rad i sidefanen å klikke på`);
  const done = page.evaluate((target) => new Promise<{ toDom: number; toFrame: number }>((resolve, reject) => {
    let inputAt = 0;
    const onUp = (e: Event) => (inputAt = e.timeStamp);
    const grid = document.querySelector('[data-testid="grid"]');
    const ready = () => grid?.querySelector(`[data-thread-id="${target}"] .row, [data-thread-id="${target}"] .pane-empty`);
    if (!grid) return reject(new Error("Fant ikke rutenettet"));
    const shown = () => [...grid.querySelectorAll("[data-thread-id]")].map((e) => e.getAttribute("data-thread-id")).join(", ");
    if (ready()) return reject(new Error(`Tråden ${target} vises allerede (${shown()}), så det er ikke noe bytte å måle`));
    addEventListener("pointerup", onUp, { capture: true, once: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Byttet til tråden ${target} ble ikke ferdig på 10 s. Rutenettet viser: ${shown()}`));
    }, 10_000);
    const check = () => {
      if (!ready()) return;
      observer.disconnect();
      clearTimeout(timer);
      const domAt = performance.now();
      requestAnimationFrame(() => {
        // The next task after rAF is after the frame was handed to the compositor.
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => {
          if (!inputAt) return reject(new Error("Trådbyttet startet før klikket"));
          resolve({ toDom: domAt - inputAt, toFrame: performance.now() - inputAt });
        };
        port2.postMessage(0);
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(grid, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-thread-id"] });
  }), id);
  done.catch(() => undefined); // Handled below; a rejection during the click must not crash the process.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return done;
}

// From the keydown of "/" until the frame after the slash menu has an item. The listener and the
// observer are in place before the key is sent, the menu is looked for at once as well (a menu that
// came before the observer started would otherwise never be seen), and there is a time limit with a
// message instead of a promise that waits for ever. Scoped to this pane's composer.
async function measureMenu(page: Page, threadId: string): Promise<number> {
  const armed = await page.evaluate((id) => {
    const scope = document.querySelector(`[data-thread-id="${id}"] .composer-wrap`);
    if (!scope) return `Fant ikke meldingsfeltet i ruten for ${id}`;
    const w = window as any;
    w.__menuResult = new Promise<number>((resolve, reject) => {
      let keyAt = 0;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "/") keyAt = e.timeStamp;
      };
      addEventListener("keydown", onKey, { capture: true });
      const finish = (error?: Error) => {
        observer.disconnect();
        clearTimeout(timer);
        removeEventListener("keydown", onKey, { capture: true });
        if (error) return reject(error);
        // Same point as in 0.1: the next rAF after the menu is in the DOM.
        requestAnimationFrame(() => (keyAt ? resolve(performance.now() - keyAt) : reject(new Error("Menyen kom før tastetrykket"))));
      };
      const check = () => {
        if (keyAt && scope.querySelector(".slash-menu .menu-item")) finish();
      };
      const observer = new MutationObserver(check);
      observer.observe(scope, { subtree: true, childList: true });
      const timer = setTimeout(() => finish(new Error(`Menyen for / kom ikke på 5 s. Feltet inneholder «${(scope.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "?"}», og ${scope.querySelector(".slash-menu") ? "menyen finnes uten punkter" : "det er ingen meny"}.`)), 5000);
      // The key may already have been handled when the observer starts.
      addEventListener("keyup", check, { capture: true, once: true });
    });
    w.__menuResult.catch(() => undefined);
    return "";
  }, threadId);
  if (armed) throw new Error(armed);
  await page.keyboard.press("/");
  return page.evaluate(() => (window as any).__menuResult as Promise<number>);
}

// The window saves its layout 200 ms after a switch, and the server sends it back to every window.
// Between switches and outside what is measured: wait until the server has this layout, and a
// little for the echo, so a late echo cannot put the old thread back during the next switch.
async function layoutSaved(page: Page, id: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const saved = await page.evaluate(async () => JSON.stringify((await (await fetch("/api/projects/chat/layout")).json()).layout));
    if (saved.includes(id)) return void (await page.waitForTimeout(100));
    await page.waitForTimeout(50);
  }
  throw new Error(`Oppsettet med tråden ${id} ble ikke lagret på 10 s`);
}

interface Row {
  name: string;
  m: Measured;
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

function combine(runs: Measured[]): Measured {
  const pick = (get: (m: Measured) => Stats): Stats => ({
    count: runs.reduce((sum, m) => sum + get(m).count, 0),
    p50: median(runs.map((m) => get(m).p50)),
    p99: median(runs.map((m) => get(m).p99)),
    worst: Math.max(...runs.map((m) => get(m).worst)),
  });
  const withMain = runs.filter((m) => m.mainTasks);
  const withLatency = runs.filter((m) => m.scrollLatencyMs);
  const compositorWorst = runs.flatMap((m) => m.compositorTaskWorst ?? []);
  return {
    frameMs: pick((m) => m.frameMs),
    fps: median(runs.map((m) => m.fps)),
    callbackMs: pick((m) => m.callbackMs),
    longTasks: runs.reduce((sum, m) => sum + m.longTasks, 0),
    longTaskWorst: Math.max(...runs.map((m) => m.longTaskWorst)),
    taskMs: pick((m) => m.taskMs),
    mainTasks: withMain.length
      ? {
          over4ms: withMain.reduce((sum, m) => sum + m.mainTasks!.over4ms, 0),
          over16ms: withMain.reduce((sum, m) => sum + m.mainTasks!.over16ms, 0),
          worst: Math.max(...withMain.map((m) => m.mainTasks!.worst)),
          busyPercent: median(withMain.map((m) => m.mainTasks!.busyPercent)),
        }
      : null,
    scrollLatencyMs: withLatency.length ? {
      count: withLatency.reduce((sum, m) => sum + m.scrollLatencyMs!.count, 0),
      p50: median(withLatency.map((m) => m.scrollLatencyMs!.p50)),
      p99: median(withLatency.map((m) => m.scrollLatencyMs!.p99)),
      worst: Math.max(...withLatency.map((m) => m.scrollLatencyMs!.worst)),
    } : null,
    compositorTaskWorst: compositorWorst.length ? Math.max(...compositorWorst) : null,
    recording: runs[0].recording,
  };
}

async function repeat(work: () => Promise<Measured>): Promise<Measured> {
  const runs: Measured[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await work());
  return combine(runs);
}

// Time per rAF callback in the first and last fifth of a stream: flat means the cost does not
// grow with the length of the message.
function growth(recording: Recording): { early: Stats; late: Stats } {
  const calls = recording.callbacks;
  const fifth = Math.max(1, Math.floor(calls.length / 5));
  return { early: stats(calls.slice(0, fifth).map((c) => c[1])), late: stats(calls.slice(-fifth).map((c) => c[1])) };
}

async function main(): Promise<void> {
  if (process.env.AD_WEB_DIST) {
    if (!existsSync(path.join(WEB_DIST, "index.html"))) throw new Error(`AD_WEB_DIST=${WEB_DIST} har ingen index.html. Bygg dit først med npx vite build --outDir.`);
  } else if (!existsSync(path.join(WEB_DIST, "index.html"))) productionBuild(ROOT);
  console.log(`Appen hentes fra ${WEB_DIST}`);

  const dataDir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-perf-data-")));
  const browser = await launchChrome(CHROME_FLAGS);
  let server: ServerProcess | undefined;
  const lines: string[] = [];

  try {
    console.log("Tester måleverktøyet mot sider med kjent resultat…");
    const controls = await step("kontroll av måleverktøyet", 90_000, () => runControls(browser));
    for (const c of controls.results) console.log(`  ${c.ok ? "ok  " : "FEIL"} ${c.name}: ${c.got}`);
    const failed = controls.results.filter((c) => !c.ok);
    if (failed.length) throw new Error(`Måleverktøyet klarte ikke kontrollene: ${failed.map((c) => c.name).join(", ")}. Ingen tall rapporteres.`);

    const compositing = await step("tegnemodus fra chrome://gpu", 20_000, () => compositingMode(browser));
    console.log(`Tegning: ${compositing}`);
    console.log("Lager tråden med 5 000 meldinger…");
    const seed = spawnSync("npm", ["run", "--silent", "seed:perf", "--", "5000"], { cwd: ROOT, env: { ...process.env, AD_DATA_DIR: dataDir }, encoding: "utf8", timeout: 120_000 });
    assert.equal(seed.status, 0, seed.stderr);
    const bigThread = seed.stdout.trim().split("\n").at(-1)!;

    server = await step("start av serveren", 30_000, () => startServer(dataDir, { mockDelayMs: 0 }));
    const started = server;
    const { context, page, cdp } = await step("åpning av appen", 30_000, () => openApp(browser, started));
    const rows: Row[] = [];

    // A small thread to switch back and forth with.
    const small = await step("en liten tråd å bytte til", 60_000, async () => {
      const created = await postJson(page, "/api/threads", { projectId: null, mode: "chat" });
      await postJson(page, `/api/threads/${created.id}/messages`, { text: "hjelp" });
      await waitForRunEnd(page, created.id);
      await threadRow(page, created.id).waitFor();
      await threadRow(page, created.id).click();
      await page.waitForSelector(`[data-thread-id="${created.id}"] .row-text`);
      await layoutSaved(page, created.id); // So a reload comes back to this thread.
      await page.reload();
      await page.waitForSelector(`[data-thread-id="${created.id}"] .row-text`);
      await threadRow(page, bigThread).waitFor();
      return created;
    });

    console.log("Måler trådbytte…");
    const coldBig = await step("første åpning av den store tråden", 30_000, async () => {
      const result = await measureSwitch(page, bigThread);
      await page.waitForSelector(`[data-thread-id="${bigThread}"] .row-text`);
      await layoutSaved(page, bigThread);
      return result;
    });
    const toFrame: number[] = [];
    const toDom: number[] = [];
    // The big thread is shown after the cold switch, so the small one comes first: every click is
    // a real switch. With the big one first, the first click changed nothing and the wait never ended.
    // Now and then the window puts the previous thread back by itself after a switch (a race in the
    // client, see docs/review). Then the other thread is opened first, outside what is measured,
    // and the report says how often it happened.
    let reverted = 0;
    for (let i = 0; i < 20; i++) {
      for (const id of [small.id, bigThread]) {
        const other = id === bigThread ? small.id : bigThread;
        await step(`trådbytte ${i * 2 + (id === bigThread ? 2 : 1)} av 40`, 45_000, async () => {
          // The revert can also come between this check and the click, so a switch that finds the
          // thread already shown is tried again, up to three times, and counted.
          for (let attempt = 1; ; attempt++) {
            if (await page.locator(`[data-testid="grid"] [data-thread-id="${id}"]`).count()) {
              reverted++;
              await threadRow(page, other).click();
              await page.waitForSelector(`[data-testid="grid"] [data-thread-id="${other}"] .row-text`);
              await layoutSaved(page, other);
              await page.waitForTimeout(300);
            }
            try {
              const switched = await measureSwitch(page, id);
              toFrame.push(switched.toFrame);
              toDom.push(switched.toDom);
              break;
            } catch (err) {
              if (attempt >= 3 || !/vises allerede/.test((err as Error).message)) throw err;
            }
          }
          await layoutSaved(page, id);
        });
      }
    }
    const switchFrame = stats(toFrame);
    const switchDom = stats(toDom);

    console.log("Måler scrolling i 5 000 meldinger…");
    const scroller = page.locator(`[data-thread-id="${bigThread}"] .scroller`);
    const box = await step("åpning av den store tråden", 30_000, async () => {
      await threadRow(page, bigThread).click();
      await page.waitForSelector(`[data-thread-id="${bigThread}"] .row-text`);
      const found = await scroller.boundingBox();
      if (!found) throw new Error("Tråden har ingen synlig .scroller");
      return found;
    });
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const scroll = await step("scrolling, 4000 px/s", 180_000, () => repeat(() => measure(browser, page, async () => {
      await scrollGesture(cdp, { ...at, distance: 8000, speed: 4000 });
      await scrollGesture(cdp, { ...at, distance: -8000, speed: 4000 });
    })));
    rows.push({ name: "Scrolling, 4000 px/s i 5 000 meldinger", m: scroll });
    const fast = await step("rask scrolling", 180_000, () => repeat(() => measure(browser, page, async () => {
      await scrollGesture(cdp, { ...at, distance: 30000, speed: 20000 });
      await scrollGesture(cdp, { ...at, distance: -30000, speed: 20000 });
    })));
    rows.push({ name: "Rask scrolling, 20 000 px/s", m: fast });
    // All the way up, past what is in memory, so older pages load while the gesture runs.
    const before = await page.evaluate((id) => document.querySelectorAll(`[data-thread-id="${id}"] .chunk`).length, bigThread);
    const deep = await step("langt opp", 120_000, () => measure(browser, page, async () => {
      await scrollGesture(cdp, { ...at, distance: 200_000, speed: 15_000 });
    }));
    rows.push({ name: "Langt opp, 200 000 px med lasting av eldre meldinger", m: deep });
    const scrolledTo = await scroller.evaluate((el) => el.scrollTop);
    const domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);
    const loadedChunks = await page.evaluate((id) => document.querySelectorAll(`[data-thread-id="${id}"] .chunk`).length, bigThread);

    console.log("Måler strømming…");
    // The thread is shown before the stream starts, so what is measured is the stream, not the switch.
    const measureStream = (name: string, threadId: string, text: string) => step(name, 180_000, async () => {
      await threadRow(page, threadId).click();
      await page.waitForSelector(`[data-testid="grid"] [data-thread-id="${threadId}"] .composer-wrap`);
      await page.waitForTimeout(300);
      return measure(browser, page, async () => {
        await postJson(page, `/api/threads/${threadId}/messages`, { text });
        await page.waitForTimeout(200);
        await waitForRunEnd(page, threadId);
      });
    });
    const shortThread = await step("en kort tråd for strømming", 30_000, async () => {
      const created = await namedThread(page, "Kort tråd");
      await threadRow(page, created.id).waitFor();
      return created;
    });
    rows.push({ name: "Strømming i vanlig fart, 2,5 kB/s i kort tråd", m: await measureStream("strømming i kort tråd", shortThread.id, "lang strøm 10000 rolig") });
    rows.push({ name: "Strømming i vanlig fart, 2,5 kB/s med 5 000 meldinger", m: await measureStream("strømming i lang tråd", bigThread, "lang strøm 10000 rolig") });
    const streamShort = await measureStream("stresstest i kort tråd", shortThread.id, "lang strøm 1000000");
    rows.push({ name: "Stresstest, 1 MB så fort serveren klarer, kort tråd", m: streamShort });
    const streamLong = await measureStream("stresstest i lang tråd", bigThread, "lang strøm 1000000");
    rows.push({ name: "Stresstest, 1 MB, tråd med 5 000 meldinger", m: streamLong });
    const shortGrowth = growth(streamShort.recording);
    const longGrowth = growth(streamLong.recording);

    console.log("Måler menyen i meldingsfeltet…");
    const menuBox = page.locator(`[data-thread-id="${shortThread.id}"] textarea`);
    await step("åpning av den korte tråden", 30_000, async () => {
      await threadRow(page, shortThread.id).click();
      await menuBox.waitFor();
      await menuBox.focus();
    });
    const menuTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      await step(`menyen for /, forsøk ${i + 1} av 20`, 20_000, async () => {
        await menuBox.fill("");
        // The menu from the last try must be gone, or there is no change to wait for.
        await page.locator(`[data-thread-id="${shortThread.id}"] .slash-menu`).waitFor({ state: "detached" });
        menuTimes.push(await measureMenu(page, shortThread.id));
        await page.keyboard.press("Escape");
      });
    }
    const menu = stats(menuTimes);

    console.log("Måler scrolling mens andre ruter strømmer…");
    await context.close();
    const multi = await step("et nytt vindu med flere ruter", 30_000, () => openApp(browser, started, { width: 1800, height: 1000 }));
    const streamers: string[] = [];
    const multiScroller = multi.page.locator(`[data-thread-id="${bigThread}"] .scroller`);
    const { panes, multiBox } = await step("oppsett av fem ruter", 60_000, async () => {
      await threadRow(multi.page, bigThread).click();
      await multi.page.waitForSelector(`[data-thread-id="${bigThread}"] .row-text`);
      for (let i = 0; i < 4; i++) {
        // Ny rute (Ctrl+\): to the right or below, whichever way the focused pane is wider, so the
        // five panes are laid out the same as before round 11 (the button there is Del til høyre now).
        await multi.page.keyboard.press("Control+Backslash");
        const created = await namedThread(multi.page, `Strømmer ${i + 1}`);
        await threadRow(multi.page, created.id).waitFor();
        await threadRow(multi.page, created.id).click();
        await multi.page.waitForSelector(`[data-testid="grid"] [data-thread-id="${created.id}"]`);
        streamers.push(created.id);
      }
      await multi.page.waitForTimeout(300);
      const box = await multiScroller.boundingBox();
      if (!box) throw new Error("Den store tråden er ikke synlig blant rutene");
      return { panes: await multi.page.locator(".pane-inner").count(), multiBox: box };
    });
    const multiAt = { x: multiBox.x + multiBox.width / 2, y: multiBox.y + multiBox.height / 2 };
    const quiet = await step("scrolling i én av flere ruter", 60_000, () => measure(browser, multi.page, async () => {
      await scrollGesture(multi.cdp, { ...multiAt, distance: 6000, speed: 3000 });
      await scrollGesture(multi.cdp, { ...multiAt, distance: -6000, speed: 3000 });
    }));
    rows.push({ name: `Scrolling i én av ${panes} ruter, de andre i ro`, m: quiet });
    const busy = await step("scrolling mens fire ruter strømmer", 120_000, () => measure(browser, multi.page, async () => {
      for (const id of streamers) await postJson(multi.page, `/api/threads/${id}/messages`, { text: "lang strøm 1500000" });
      await scrollGesture(multi.cdp, { ...multiAt, distance: 6000, speed: 3000 });
      await scrollGesture(multi.cdp, { ...multiAt, distance: -6000, speed: 3000 });
    }));
    rows.push({ name: `Scrolling i én av ${panes} ruter, ${streamers.length} andre strømmer`, m: busy });
    await step("slutten på strømmene i rutene", 150_000, async () => {
      for (const id of streamers) await waitForRunEnd(multi.page, id);
    });

    assert.ok(loadedChunks > before, "den lange scrollingen hentet eldre meldinger");
    const infoFile = path.join(WEB_DIST, "build-info.json");
    const version = JSON.parse(readFileSync(existsSync(infoFile) ? infoFile : path.join(ROOT, "version.json"), "utf8"));
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const chrome = browser.version();
    lines.push(
      "# Ytelsesmåling",
      "",
      `Laget av \`npm run perf\` ${now} UTC, bygg ${version.version} (build ${version.build}), Chrome ${chrome}, headless, ${RUNS} kjøringer der det står en medianverdi.`,
      "",
      "## Kontroll av måleverktøyet",
      "",
      "Verktøyet nekter å rapportere tall hvis det bommer på en av disse.",
      "",
      "| Kontroll | Forventet | Målt | Resultat |",
      "|---|---|---|---|",
      ...controls.results.map((c) => `| ${c.name} | ${c.expected} | ${c.got} | ${c.ok ? "ok" : "FEIL"} |`),
      "",
      `**Bildetaket:** En tom side ga ${controls.capFps.toFixed(0)} bilder i sekundet. Headless Chrome har et tak, også med ekte GPU, så bildeintervall kan ikke vise noe bedre enn taket, og det er oppgavetiden som sier noe om 240 Hz. Flaggene \`--disable-frame-rate-limit\` og \`--disable-gpu-vsync\` er tatt bort: de løftet ikke taket på en tom side, men så snart en CSS-animasjon gikk, fikk siden rundt 12 000 bilder i sekundet, og da ble «opptatt» under strømming tre ganger for høyt. Tegning: ${compositing}.`,
      "",
      "## Arbeid på hovedtråden",
      "",
      "Dette er hovedtallene. De er hentet fra Chrome-sporet (`RunTask` på `CrRendererMain`), så de avhenger ikke av bildetaket. En oppgave over 4,17 ms er for lang til å passe i ett bilde ved 240 Hz. Oppgaver under 0,25 ms er ikke med i p50 og p99.",
      "",
      "| Scenario | p50 | p99 | verste | oppgaver | over 4,17 ms | over 16,7 ms | opptatt | over 50 ms |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...rows.map((r) => {
        const m = r.m.mainTasks;
        return `| ${r.name} | ${row(r.m.taskMs)} | ${m?.over4ms ?? "?"} | ${m?.over16ms ?? "?"} | ${m ? m.busyPercent.toFixed(0) : "?"} % | ${r.m.longTasks} |`;
      }),
      "",
      "## Bildeintervall under taket",
      "",
      `Tid mellom to \`requestAnimationFrame\`, i millisekunder. Taket her er ${(1000 / controls.capFps).toFixed(1)} ms, så en p50 på det betyr at appen holdt følge med taket. Dette viser hakk, ikke om appen ville klart 240 Hz.`,
      "",
      "| Scenario | p50 | p99 | verste | bilder | fps |",
      "|---|---:|---:|---:|---:|---:|",
      ...rows.map((r) => `| ${r.name} | ${row(r.m.frameMs)} | ${r.m.fps.toFixed(0)} |`),
      "",
      "## Fra skrollbevegelse til bilde",
      "",
      "`EventLatency` fra Chrome-sporet: tiden fra skrollbevegelsen kom inn til bildet med resultatet var vist. Dette er kompositorens egen tid, så den er nærmest det brukeren merker. Taket på bildefrekvensen ligger inne i tallene.",
      "",
      "| Scenario | p50 | p99 | verste | bevegelser | verste oppgave på kompositoren |",
      "|---|---:|---:|---:|---:|---:|",
      ...rows.filter((r) => r.m.scrollLatencyMs).map((r) => `| ${r.name} | ${row(r.m.scrollLatencyMs!)} | ${r.m.compositorTaskWorst === null ? "?" : `${fmt(r.m.compositorTaskWorst)} ms`} |`),
      "",
      "## Trådbytte",
      "",
      "Fra `pointerup` på tråden i sidefanen, på sidens egen klokke.",
      "",
      "| Måling | p50 | p99 | verste | antall |",
      "|---|---:|---:|---:|---:|",
      `| Innhold i DOM | ${row(switchDom)} |`,
      `| Bildet er tegnet | ${row(switchFrame)} |`,
      "",
      `Første åpning av tråden med 5 000 meldinger, der hendelsene må hentes fra serveren: ${fmt(coldBig.toFrame)} ms til bildet er tegnet. Musen var over tråden bare et øyeblikk, så det er nesten uten forhåndslasting. Bytte til en tråd som er i minnet er tallene over.${reverted ? ` Vinduet satte forrige tråd tilbake av seg selv ${reverted} ganger i løpet av de 40 byttene, og da ble den andre tråden åpnet først, utenom målingen.` : ""}`,
      "",
      "## Koster strømming mer jo lenger den varer?",
      "",
      "Tid i `requestAnimationFrame`-kallene til appen under stresstesten, i første og siste femdel av strømmen. Likt betyr at kostnaden ikke vokser med meldingen. Appen sprer dette arbeidet over flere bilder, så stresstesten viser et tak, ikke en fart.",
      "",
      "| Tråd | Første femdel p50 / p99 | Siste femdel p50 / p99 |",
      "|---|---:|---:|",
      `| Kort tråd | ${fmt(shortGrowth.early.p50)} / ${fmt(shortGrowth.early.p99)} ms | ${fmt(shortGrowth.late.p50)} / ${fmt(shortGrowth.late.p99)} ms |`,
      `| 5 000 meldinger | ${fmt(longGrowth.early.p50)} / ${fmt(longGrowth.early.p99)} ms | ${fmt(longGrowth.late.p50)} / ${fmt(longGrowth.late.p99)} ms |`,
      "",
      "## Andre tall",
      "",
      `- Menyen for \`/\`: fra tastetrykk til bildet etter at menyen er i DOM: p50 ${fmt(menu.p50)} ms, verste ${fmt(menu.worst)} ms, ${menu.count} forsøk.`,
      `- Tråden var delt i ${before} biter før den lange scrollingen og ${loadedChunks} etter, og etter scrollingen var ${(-scrolledTo).toFixed(0)} px over bunnen. Hele appen hadde da ${domNodes} DOM-noder.`,
      "",
      "## Hva dette kan og ikke kan si",
      "",
      "- **Dette er ikke skjermen, og ikke 240 Hz.** Headless har ingen skjerm og et tak på 60 bilder i sekundet som flaggene ikke fjerner. Ingen tall her beviser at et 240 Hz-panel får 240 bilder. Det målingen viser er om arbeidet per bilde er kort nok til å passe i 4,17 ms.",
      "- **Oppgavetid er ikke hele bildet.** Rastering og sammensetting skjer på andre tråder og i GPU-prosessen. Bare hovedtråden og kompositorens bilder er målt.",
      "- **Målingen påvirker seg selv.** Løkken med `requestAnimationFrame` tvinger Chrome til å lage bilder hele tiden, også når appen ellers ville vært i ro. Sporing gir også litt ekstra arbeid.",
      "- **`EventLatency` er Chromes egen måling.** Kontrollene over tester bildetid og oppgavetid, ikke denne.",
      "- **Skrollingen er syntetisk**, med `Input.synthesizeScrollGesture` og musehjul. Den går gjennom kompositoren, som kontrollen viser, men er jevnere enn en ekte hånd og uten treghet.",
      "- **Tomme områder måles ikke.** Når du skroller raskere enn appen rekker å tegne deler av tråden, ser du et øyeblikk en tom flate i riktig høyde. Hverken bildetid eller oppgavetid fanger det.",
      "- **Maskinen var ikke tom.** Brukerens andre apper kjørte under målingen, så enkeltverdier for verste bilde kan komme derfra.",
      "",
    );
    // AD_PERF_OUT writes the report elsewhere, for repeated runs that should not replace the latest one.
    // AD_PERF_JSON also writes the raw numbers, so several runs can be compared.
    writeFileSync(process.env.AD_PERF_OUT ? path.resolve(process.env.AD_PERF_OUT) : path.join(ROOT, "docs/perf-latest.md"), lines.join("\n"));
    if (process.env.AD_PERF_JSON) {
      const strip = ({ recording: _, ...rest }: Measured) => rest;
      writeFileSync(path.resolve(process.env.AD_PERF_JSON), JSON.stringify({ rows: rows.map((r) => ({ name: r.name, m: strip(r.m) })), switchDom, switchFrame, coldBig, menu, menuTimes, shortGrowth, longGrowth, domNodes, loadedChunks }, null, 1));
    }
    console.log(lines.join("\n"));
  } finally {
    await server?.stop();
    await closeChrome(browser);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}

await main();
process.exit(0);
