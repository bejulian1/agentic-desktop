// npm run test:desktop: the Electron tests (desktop/test). Builds the shell to desktop/build and the
// web UI to a temporary folder (never web/dist), then runs the tests one file at a time under
// xvfb-run, with WAYLAND_DISPLAY removed so no window can reach the user's screen.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDesktop } from "./build-desktop.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

export function memAvailableMb(): number {
  const line = readFileSync("/proc/meminfo", "utf8").split("\n").find((l) => l.startsWith("MemAvailable:"));
  return Math.floor(Number(line?.split(/\s+/)[1] ?? 0) / 1024);
}

// docs/agent-regler-produksjon.md: wait while less than 8 GB is free.
export async function waitForMemory(label: string): Promise<number> {
  for (let tries = 0; ; tries++) {
    const free = memAvailableMb();
    if (free >= 8192) return free;
    if (tries >= 60) throw new Error(`For lite ledig minne for ${label}: ${free} MB`);
    console.log(`Venter på minne før ${label}: ${free} MB ledig.`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

export function buildWeb(): { dist: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "ad-desktop-web-"));
  const dist = path.join(dir, "dist");
  const result = spawnSync(path.join(ROOT, "node_modules/.bin/vite"), ["build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], { cwd: path.join(ROOT, "web"), stdio: "inherit" });
  if (result.status !== 0) throw new Error("Bygget av web feilet");
  const info = path.join(ROOT, "web/dist/build-info.json");
  if (existsSync(info)) cpSync(info, path.join(dist, "build-info.json"));
  return { dist, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

if (import.meta.main) {
  console.log(`MemAvailable før bygg: ${await waitForMemory("bygget")} MB`);
  await buildDesktop();
  const web = process.env.AD_WEB_DIST ? { dist: process.env.AD_WEB_DIST, cleanup: () => undefined } : buildWeb();
  console.log(`MemAvailable før testene: ${await waitForMemory("testene")} MB`);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  delete env.WAYLAND_DISPLAY;
  env.AD_DESKTOP_XVFB = "1";
  env.AD_WEB_DIST = web.dist;
  const args = process.argv.slice(2);
  // --screenshots: the pictures in docs/screenshots/electron instead of the tests.
  const command = args.includes("--screenshots")
    ? ["desktop/test/screenshots.ts"]
    : ["--test", "--test-concurrency=1", ...(args.length ? args : ["desktop/test/*.test.ts"])];
  const child = spawn("xvfb-run", ["-a", "-s", "-screen 0 1600x1000x24", process.execPath, ...command], { cwd: ROOT, env, stdio: "inherit" });
  const code: number = await new Promise((resolve) => child.once("exit", (c) => resolve(c ?? 1)));
  web.cleanup();
  console.log(`MemAvailable etter testene: ${memAvailableMb()} MB`);
  process.exit(code);
}
