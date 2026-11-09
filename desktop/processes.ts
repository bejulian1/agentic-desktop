// The server's process tree, read from /proc. The server starts terminals (node-pty, each in its own
// session), command shells, dev servers and headless Chrome. When the server stops normally it
// closes them itself. When it crashes, or does not stop in time, their parent is gone and they are
// moved to another parent, so the tree is noted while the server lives and stopped by known PID.
// A PID is only signalled when its start time is the one noted, so a reused PID is never touched.
import { readdirSync, readFileSync } from "node:fs";

export interface KnownProcess {
  pid: number;
  start: string; // field 22 of /proc/<pid>/stat, in clock ticks since boot
}

function stat(pid: number): { ppid: number; start: string; state: string } | null {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The name is in parentheses and may hold spaces and parentheses; the fields follow the last ")".
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0], ppid: Number(fields[1]), start: fields[19] };
  } catch {
    return null;
  }
}

function children(pid: number): number[] {
  const out: number[] = [];
  let tasks: string[];
  try {
    tasks = readdirSync(`/proc/${pid}/task`);
  } catch {
    return out;
  }
  for (const task of tasks) {
    try {
      for (const child of readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim().split(/\s+/)) {
        if (child) out.push(Number(child));
      }
    } catch {
      // The thread ended while we looked.
    }
  }
  return out;
}

// All living descendants of pid, not pid itself.
export function descendants(pid: number): KnownProcess[] {
  const out: KnownProcess[] = [];
  const seen = new Set<number>([pid]);
  const queue = children(pid);
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const info = stat(next);
    if (!info || info.state === "Z") continue;
    out.push({ pid: next, start: info.start });
    queue.push(...children(next));
  }
  return out;
}

export function known(pid: number): KnownProcess | null {
  const info = stat(pid);
  return info ? { pid, start: info.start } : null;
}

// Still the same process: alive, not a zombie, and started at the noted time.
export function stillRunning(process: KnownProcess): boolean {
  const info = stat(process.pid);
  return !!info && info.state !== "Z" && info.start === process.start;
}

function signal(target: KnownProcess, name: NodeJS.Signals): void {
  if (!stillRunning(target)) return;
  try {
    process.kill(target.pid, name);
  } catch {
    // Gone already.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// SIGTERM to each that still runs, then SIGKILL to those that did not stop within graceMs.
export async function stopAll(targets: KnownProcess[], graceMs = 1500): Promise<void> {
  const left = () => targets.filter(stillRunning);
  if (!left().length) return;
  for (const target of left()) signal(target, "SIGTERM");
  const until = Date.now() + graceMs;
  while (left().length && Date.now() < until) await sleep(50);
  for (const target of left()) signal(target, "SIGKILL");
}
