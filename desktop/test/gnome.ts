// The packaged app as GNOME starts it: installed with scripts/install-local.ts into a temporary HOME,
// and started with the Exec line of its .desktop file, without any test switch.
//
// Why the other tests did not see the crash of 6 November 2026: the agents' shell runs under the
// AppArmor profile of the program that started it (here "claude-desktop", which has `userns`), and
// every child inherits it, so Chromium could make its user namespaces. GNOME starts apps as plain
// "unconfined", and with kernel.apparmor_restrict_unprivileged_userns=1 such a process may not use
// one. `aa-exec -p unconfined` gives a test exactly that label, without sudo.
//
// The only switch added is --ozone-platform=x11, which the rules require (no window may reach the
// user's screen; WAYLAND_DISPLAY and XDG_SESSION_TYPE are removed too). It has nothing to do with the
// sandbox. Windows and keys go through desktop/test/x11.py, as the package has no inspector.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { alive, commandOf, PACKAGED, ROOT, waitFor, type Sandbox } from "./helpers.ts";

const INSTALL = path.join(ROOT, "scripts/install-local.ts");
const X11 = path.join(ROOT, "desktop/test/x11.py");

export const packaged = existsSync(PACKAGED);

// Ubuntu's rule is on: an unconfined process may not use user namespaces.
export function restricted(): boolean {
  try {
    return readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1";
  } catch {
    return false;
  }
}

export function labelOf(pid: number | "self"): string {
  for (const file of [`/proc/${pid}/attr/apparmor/current`, `/proc/${pid}/attr/current`]) {
    try {
      return readFileSync(file, "utf8").replace(/\0/g, "").trim();
    } catch {
      // older kernels have only the second
    }
  }
  return "";
}

export interface Installed {
  opt: string;
  desktopFile: string;
  exec: string[];
  installOutput: string;
}

// scripts/install-local.ts against the sandbox's HOME, from dist-desktop/linux-unpacked.
export function install(box: Sandbox): Installed {
  const installOutput = execFileSync(process.execPath, [INSTALL, "--from", path.dirname(PACKAGED)], {
    env: { PATH: process.env.PATH!, HOME: box.home, XDG_DATA_HOME: path.join(box.home, ".local/share"), XDG_CONFIG_HOME: path.join(box.home, ".config") },
    encoding: "utf8",
  });
  const opt = path.join(box.home, ".local/opt/agentic-desktop");
  const desktopFile = path.join(box.home, ".local/share/applications/io.github.AgenticDesktop.desktop");
  return { opt, desktopFile, exec: execLine(readFileSync(desktopFile, "utf8")), installOutput };
}

// The Exec key as the Desktop Entry Specification reads it: quoted arguments, escapes inside the
// quotes, and field codes (%U and the like) removed, as GNOME does when nothing is opened.
export function execLine(entry: string): string[] {
  const line = /^Exec=(.*)$/m.exec(entry)?.[1];
  assert.ok(line, "Exec mangler");
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === "\\" && i + 1 < line.length) current += line[++i];
      else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') {
      quoted = true;
      any = true;
    } else if (c === " ") {
      if (current || any) args.push(current);
      current = "";
      any = false;
    } else current += c;
  }
  if (current || any) args.push(current);
  return args.filter((arg) => !/^%[fFuUdDnNickvm]$/.test(arg));
}

export interface Started {
  child: ChildProcess;
  pid: number;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  done: () => boolean;
}

// The environment of an app started from the app library: the sandbox's folders, no Wayland, no test
// switches in the command. AD_DESKTOP_TRAY only when a test needs the status area.
export function gnomeEnv(box: Sandbox, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = { ...box.env };
  for (const name of ["AD_WEB_DIST", "AD_DESKTOP_TRAY", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE", "AD_DESKTOP_MAIN"]) delete env[name];
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

// Starts the Exec line, as plain "unconfined" when Ubuntu's rule is on (what GNOME gives an app), or
// under another label to stand in for an AppArmor profile that allows user namespaces.
export function startLikeGnome(installed: Installed, env: Record<string, string>, options: { label?: string } = {}): Started {
  assert.equal(env.WAYLAND_DISPLAY, undefined);
  assert.ok(env.DISPLAY && process.env.AD_DESKTOP_XVFB === "1", "bare under xvfb");
  const label = options.label ?? (restricted() ? "unconfined" : undefined);
  const command = [...installed.exec, "--ozone-platform=x11"];
  const child = label ? spawn("aa-exec", ["-p", label, "--", ...command], { env, stdio: ["ignore", "pipe", "pipe"] }) : spawn(command[0], command.slice(1), { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let finished = false;
  child.stdout!.on("data", (chunk) => (out += chunk));
  child.stderr!.on("data", (chunk) => (out += chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once("exit", (code, signal) => {
      finished = true;
      resolve({ code, signal });
    }),
  );
  return { child, pid: child.pid!, output: () => out, exited, done: () => finished };
}

// Every process that runs a file from the installed folder: the app, its zygotes, renderers, GPU
// process and the server, also those that lost their parent.
export function processesFrom(opt: string): Array<{ pid: number; cmd: string }> {
  const found: Array<{ pid: number; cmd: string }> = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    let exe = "";
    let cmd = "";
    try {
      exe = readlinkSync(`/proc/${pid}/exe`);
    } catch {
      // not ours, or gone
    }
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
    } catch {
      continue;
    }
    if (!alive(pid)) continue;
    if (exe.startsWith(`${opt}/`) || cmd.startsWith(`${opt}/`)) found.push({ pid, cmd });
  }
  return found;
}

export interface XWindow {
  id: number;
  mapped: boolean;
  overrideRedirect: boolean;
  width: number;
  height: number;
  class: string;
  name: string;
}

function x11(args: string[]): string {
  return execFileSync("python3", ["-I", X11, ...args], { encoding: "utf8", env: { ...process.env } });
}

// The app's own windows (not menus or tooltips), as the X server sees them.
export function appWindows(pid: number): XWindow[] {
  return x11(["windows", String(pid)])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as XWindow)
    .filter((w) => !w.overrideRedirect && w.class === "io.github.AgenticDesktop" && w.width > 100);
}

export const shownWindows = (pid: number) => appWindows(pid).filter((w) => w.mapped);

export function closeWindow(id: number): void {
  x11(["close", String(id)]);
}

export function pressKeys(id: number, combo: string): void {
  x11(["key", String(id), combo]);
}

// What a start may leave behind in the data folder while it runs: the server's instance.json and
// token, and Chromium's single-instance lock. None of them may be there after the app has ended.
export function leftovers(box: Sandbox): string[] {
  const names = ["instance.json", "token", "electron/SingletonLock", "electron/SingletonSocket", "electron/SingletonCookie"];
  return names.filter((name) => {
    try {
      readlinkSync(path.join(box.dataDir, name)); // the Singleton files are symlinks, maybe dangling
      return true;
    } catch {
      return existsSync(path.join(box.dataDir, name));
    }
  });
}

export async function waitForReady(started: Started, what = "appen er klar"): Promise<void> {
  await waitFor(() => started.output().includes("Agentic Desktop er klar.") || started.done(), what, 60_000);
  assert.ok(!started.done(), `appen stoppet under starten:\n${started.output().slice(-3000)}`);
  assert.ok(started.output().includes("Agentic Desktop er klar."));
}

// After a run: nothing of the app runs any more, and it left no lock.
export async function assertAllGone(installed: Installed, box: Sandbox, what: string): Promise<void> {
  await waitFor(() => processesFrom(installed.opt).length === 0, `${what}: ingen prosesser igjen (${processesFrom(installed.opt).map((p) => `${p.pid} ${p.cmd.slice(0, 120)}`).join("; ")})`, 20_000);
  assert.deepEqual(leftovers(box), [], `${what}: ingen gjenglemte låser`);
}

// Stops what is left by known PIDs, one at a time after a look at each, if a test failed half way.
export function stopLeftovers(installed: Installed): void {
  for (const { pid } of processesFrom(installed.opt)) {
    const command = commandOf(pid);
    if (command.startsWith(installed.opt)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // gone in between
      }
    }
  }
}
