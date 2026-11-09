// Servers the app's own processes started: dev servers from commands the model runs (also `!`
// commands), terminal tabs and Playtest. An address like localhost:5173 in their output is a
// candidate. It is listed only when a short TCP connection to 127.0.0.1 succeeds and, on Linux,
// when the socket that listens belongs to a process this server started (a descendant of it).
// The machine's ports are never scanned, and other programs' servers are never shown. While the
// list is not empty, every port is checked again every few seconds and dropped when it is gone.
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import net from "node:net";
import type { PlaytestState, RunningServer, ServerMessage, ThreadEventEnvelope } from "../../shared/protocol.ts";

const ADDRESS = /(?:\bhttps?:\/\/)?(?:\blocalhost|\b127\.0\.0\.1|\b0\.0\.0\.0|\[::1?\])(?::(\d{2,5}))\b/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;
const RECHECK_MS = 5000;
const CONFIRM_DELAYS_MS = [150, 600, 1500, 3000, 6000, 10_000];
const CONNECT_TIMEOUT_MS = 600;
const TAIL_CHARS = 300;

interface Source {
  key: string; // the command call or terminal it came from
  projectId: string;
  threadId: string | null;
  source: RunningServer["source"];
  command: string;
}

export interface ServersOptions {
  publish: (message: ServerMessage) => void;
  ignorePorts: () => number[]; // the app's own and its preview server's
  projectOfThread: (threadId: string) => string | null;
  stopPlaytest: (projectId: string) => Promise<unknown>;
  selfPid?: number;
}

// Whether something accepts a connection on the port, on 127.0.0.1 or ::1.
export function listening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function answers(port: number): Promise<boolean> {
  return (await listening(port, "127.0.0.1")) || (await listening(port, "::1"));
}

// Ports in the text, from addresses on this machine only.
export function portsIn(text: string): number[] {
  const out: number[] = [];
  for (const match of text.replace(ANSI, "").matchAll(ADDRESS)) {
    const port = Number(match[1]);
    if (port >= 1 && port <= 65535 && !out.includes(port)) out.push(port);
  }
  return out;
}

// Linux: the process that holds the listening socket, if it is one of ours. undefined means it
// cannot be known here (no /proc), null that it is someone else's.
export function ownerOf(port: number, root = process.pid): number | null | undefined {
  let inodes: Set<string>;
  try {
    inodes = new Set<string>();
    for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      let text = "";
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10 || cols[3] !== "0A") continue; // 0A is LISTEN
        if (parseInt(cols[1].split(":").pop()!, 16) === port) inodes.add(cols[9]);
      }
    }
    readdirSync("/proc");
  } catch {
    return undefined;
  }
  if (!inodes.size) return null;
  for (const pid of descendants(root)) {
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
        const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
        if (inode && inodes.has(inode)) return pid;
      } catch {
        // Gone meanwhile.
      }
    }
  }
  return null;
}

// Every process below root, found through the parent in /proc/<pid>/stat.
export function descendants(root: number): number[] {
  const parents = new Map<number, number>();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      parents.set(Number(name), ppid);
    } catch {
      // Gone meanwhile.
    }
  }
  const found = new Set([root]);
  for (let grown = true; grown;) {
    grown = false;
    for (const [pid, ppid] of parents) {
      if (!found.has(pid) && found.has(ppid)) {
        found.add(pid);
        grown = true;
      }
    }
  }
  found.delete(root);
  return [...found];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// When a process started, in clock ticks since boot (field 22 of /proc/<pid>/stat). Two processes
// with the same PID never have the same start time, so this tells a reused PID apart.
export function startTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

export class Servers {
  private options: ServersOptions;
  private servers = new Map<number, RunningServer>();
  private pending = new Set<number>(); // ports being confirmed
  private calls = new Map<string, Source>(); // run_command calls by callId
  private tails = new Map<string, string>(); // the end of each source's output, for addresses split in two
  private timer?: NodeJS.Timeout;
  private closed = false;

  constructor(options: ServersOptions) {
    this.options = options;
  }

  list(): RunningServer[] {
    return [...this.servers.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  private changed(): void {
    this.options.publish({ type: "servers.changed", servers: this.list() });
    this.schedule();
  }

  // Thread events: run_command calls, from the model and from `!`.
  onThreadEvent(envelope: ThreadEventEnvelope): void {
    const { event, threadId } = envelope;
    if (event.type === "tool.started" && event.tool === "run_command") {
      const projectId = this.options.projectOfThread(threadId);
      const command = String((event.input as { command?: unknown })?.command ?? event.summary ?? "").slice(0, 300);
      if (projectId) this.calls.set(event.callId, { key: `c:${event.callId}`, projectId, threadId, source: "command", command });
    } else if (event.type === "tool.output") {
      const source = this.calls.get(event.callId);
      if (source) this.observe(source, event.text);
    } else if (event.type === "tool.finished") {
      const source = this.calls.get(event.callId);
      this.calls.delete(event.callId);
      if (source) this.tails.delete(source.key);
      // The command's processes die with it, so its servers go too. The next check confirms it.
      if (source && [...this.servers.values()].some((s) => s.source === "command" && s.threadId === threadId)) setTimeout(() => void this.recheck(), 300);
    }
  }

  onTerminalOutput(terminal: { terminalId: string; projectId: string; title: string }, text: string): void {
    this.observe({ key: `t:${terminal.terminalId}`, projectId: terminal.projectId, threadId: null, source: "terminal", command: terminal.title }, text);
  }

  // Playtest's static preview runs inside this server; its dev scripts run in a terminal tab.
  onPlaytest(state: PlaytestState): void {
    const existing = [...this.servers.values()].find((s) => s.source === "playtest" && s.projectId === state.projectId);
    const port = state.status === "running" && state.url ? Number(new URL(state.url).port) : 0;
    if (existing && existing.port !== port) {
      this.servers.delete(existing.port);
      this.changed();
    }
    if (!port || this.servers.has(port)) return;
    this.servers.set(port, { id: String(port), port, url: `http://localhost:${port}`, projectId: state.projectId, threadId: null, source: "playtest", command: "Playtest", startedAt: Date.now(), pid: null });
    this.changed();
  }

  private observe(source: Source, text: string): void {
    if (this.closed) return;
    const tail = (this.tails.get(source.key) ?? "") + text;
    this.tails.set(source.key, tail.slice(-TAIL_CHARS));
    for (const port of portsIn(tail)) {
      if (this.servers.has(port) || this.pending.has(port) || this.options.ignorePorts().includes(port)) continue;
      void this.confirm(port, source);
    }
  }

  // The address is often printed a moment before the port listens, so it is tried a few times.
  private async confirm(port: number, source: Source): Promise<void> {
    this.pending.add(port);
    try {
      for (const delay of CONFIRM_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.closed || this.servers.has(port)) return;
        if (!(await answers(port))) continue;
        const owner = ownerOf(port, this.options.selfPid);
        if (owner === null) return; // Someone else's server.
        this.servers.set(port, {
          id: String(port),
          port,
          url: `http://localhost:${port}`,
          projectId: source.projectId,
          threadId: source.threadId,
          source: source.source,
          command: source.command,
          startedAt: Date.now(),
          pid: owner ?? null,
        });
        this.changed();
        return;
      }
    } finally {
      this.pending.delete(port);
    }
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (this.closed || !this.servers.size) return;
    this.timer = setTimeout(() => void this.recheck(), RECHECK_MS);
    this.timer.unref();
  }

  private async recheck(): Promise<void> {
    let removed = false;
    for (const server of [...this.servers.values()]) {
      const gone = (server.pid !== null && !alive(server.pid)) || !(await answers(server.port));
      if (gone && this.servers.get(server.port) === server) {
        this.servers.delete(server.port);
        removed = true;
      }
    }
    if (removed) this.changed();
    else this.schedule();
  }

  // Only a process this server started: the one that holds the socket, checked again right now.
  async stop(id: string): Promise<void> {
    const server = this.servers.get(Number(id));
    if (!server) throw Object.assign(new Error("Fant ikke serveren"), { status: 404 });
    if (server.source === "playtest") {
      await this.options.stopPlaytest(server.projectId);
    } else {
      const owner = ownerOf(server.port, this.options.selfPid);
      const pid = owner ?? null;
      if (pid === null || (server.pid !== null && pid !== server.pid)) throw Object.assign(new Error("Fant ikke prosessen som appen startet"), { status: 409 });
      const started = startTime(pid);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Gone already.
      }
      // SIGKILL only to the same process, still one of ours: if it died and the PID went to a
      // stranger meanwhile, the start time or the parent chain is different, and it is left alone.
      const root = this.options.selfPid ?? process.pid;
      const killer = setTimeout(() => {
        if (!alive(pid) || started === null || startTime(pid) !== started || !descendants(root).includes(pid)) return;
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Gone.
        }
      }, 1500);
      killer.unref();
    }
    this.servers.delete(server.port);
    this.changed();
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
  }
}
