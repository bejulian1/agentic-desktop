// Real PTYs that outlive the panel and the page: output is kept for replay, and any number of
// windows can attach to the same terminal.
import { randomUUID } from "node:crypto";
import pty, { type IPty } from "node-pty";
import type { Project, ServerMessage } from "../../shared/protocol.ts";

const REPLAY_CHARS = 256 * 1024;
const FLUSH_MS = 4;
const MAX_BUFFERED = 4 * 1024 * 1024;
const MAX_TERMINALS = 16;

export interface TerminalClient {
  send(message: ServerMessage): void;
  buffered(): number;
}

interface Terminal {
  id: string;
  projectId: string;
  title: string;
  pty: IPty;
  replay: string;
  pending: string;
  flushTimer?: NodeJS.Timeout;
  resumeTimer?: NodeJS.Timeout;
  clients: Set<TerminalClient>;
  exited: boolean;
  exitCode: number | null;
  exitWaiters: Array<() => void>;
  outputListeners: Set<(text: string) => void>;
  startedAt: number;
  exitedAt: number | null;
}

export class Terminals {
  private terminals = new Map<string, Terminal>();
  private env: () => Record<string, string>;
  // Read-only observers of every terminal's output, for the list of servers (servers.ts).
  readonly watchers = new Set<(terminal: { terminalId: string; projectId: string; title: string; pid: number }, text: string) => void>();

  constructor(env: () => Record<string, string>) {
    this.env = env;
  }

  list(projectId: string): Array<{ terminalId: string; title: string; exited: boolean }> {
    return [...this.terminals.values()]
      .filter((t) => t.projectId === projectId)
      .map((t) => ({ terminalId: t.id, title: t.title, exited: t.exited }));
  }

  // Round 12 (SPEC 26.2): the same, with when each started and ended, for Økt.
  timed(projectId: string): Array<{ terminalId: string; title: string; exited: boolean; startedAt: number; exitedAt: number | null }> {
    return [...this.terminals.values()]
      .filter((t) => t.projectId === projectId)
      .map((t) => ({ terminalId: t.id, title: t.title, exited: t.exited, startedAt: t.startedAt, exitedAt: t.exitedAt }));
  }

  // Attaches to an existing terminal, or starts a new shell in the project folder.
  open(client: TerminalClient, project: Project, options: { terminalId?: string; cols: number; rows: number }): void {
    const existing = options.terminalId ? this.terminals.get(options.terminalId) : undefined;
    const terminal = existing?.projectId === project.id
      ? existing
      : this.spawn(project, { title: "Terminal", file: process.env.SHELL || "/bin/bash", args: [], cols: options.cols, rows: options.rows });
    this.attach(client, terminal, options.cols, options.rows);
  }

  private attach(client: TerminalClient, terminal: Terminal, cols: number, rows: number): void {
    this.flush(terminal);
    terminal.clients.add(client);
    if (!terminal.exited) terminal.pty.resize(clamp(cols, 2, 500), clamp(rows, 1, 300));
    client.send({ type: "terminal.opened", terminalId: terminal.id, projectId: terminal.projectId, title: terminal.title, replay: terminal.replay });
    if (terminal.exited) client.send({ type: "terminal.exit", terminalId: terminal.id, code: terminal.exitCode });
  }

  // A command in a visible terminal tab. Used by playtest.
  spawnCommand(project: Project, title: string, command: string, extraEnv: Record<string, string>): string {
    const terminal = this.spawn(project, { title, file: "bash", args: ["-c", command], cols: 100, rows: 30, extraEnv });
    return terminal.id;
  }

  onOutput(terminalId: string, listener: (text: string) => void): () => void {
    const terminal = this.terminals.get(terminalId);
    terminal?.outputListeners.add(listener);
    return () => terminal?.outputListeners.delete(listener);
  }

  isExited(terminalId: string): boolean {
    return this.terminals.get(terminalId)?.exited ?? true;
  }

  private spawn(project: Project, options: { title: string; file: string; args: string[]; cols: number; rows: number; extraEnv?: Record<string, string> }): Terminal {
    if (this.terminals.size >= MAX_TERMINALS) throw new Error("For mange åpne terminaler");
    const child = pty.spawn(options.file, options.args, {
      name: "xterm-256color",
      cols: clamp(options.cols, 2, 500),
      rows: clamp(options.rows, 1, 300),
      cwd: project.path,
      env: { ...this.env(), ...options.extraEnv, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    const terminal: Terminal = {
      id: randomUUID(),
      projectId: project.id,
      title: options.title,
      pty: child,
      replay: "",
      pending: "",
      clients: new Set(),
      exited: false,
      exitCode: null,
      exitWaiters: [],
      outputListeners: new Set(),
      startedAt: Date.now(),
      exitedAt: null,
    };
    this.terminals.set(terminal.id, terminal);
    child.onData((data) => {
      terminal.pending += data;
      for (const listener of terminal.outputListeners) listener(data);
      for (const watcher of this.watchers) watcher({ terminalId: terminal.id, projectId: terminal.projectId, title: terminal.title, pid: child.pid }, data);
      terminal.flushTimer ??= setTimeout(() => this.flush(terminal), FLUSH_MS);
    });
    child.onExit(({ exitCode }) => {
      this.flush(terminal);
      terminal.exited = true;
      terminal.exitedAt = Date.now();
      terminal.exitCode = exitCode;
      clearTimeout(terminal.resumeTimer);
      for (const client of terminal.clients) client.send({ type: "terminal.exit", terminalId: terminal.id, code: exitCode });
      for (const resolve of terminal.exitWaiters) resolve();
    });
    return terminal;
  }

  private flush(terminal: Terminal): void {
    clearTimeout(terminal.flushTimer);
    terminal.flushTimer = undefined;
    if (!terminal.pending) return;
    const data = terminal.pending;
    terminal.pending = "";
    terminal.replay = trimReplay(terminal.replay + data);
    let slow = false;
    for (const client of terminal.clients) {
      client.send({ type: "terminal.output", terminalId: terminal.id, data });
      if (client.buffered() > MAX_BUFFERED) slow = true;
    }
    if (slow) this.pauseUntilDrained(terminal);
  }

  private pauseUntilDrained(terminal: Terminal): void {
    if (terminal.resumeTimer || terminal.exited) return;
    terminal.pty.pause();
    const check = () => {
      terminal.resumeTimer = undefined;
      if (terminal.exited) return;
      if ([...terminal.clients].some((c) => c.buffered() > MAX_BUFFERED)) terminal.resumeTimer = setTimeout(check, 50);
      else terminal.pty.resume();
    };
    terminal.resumeTimer = setTimeout(check, 50);
  }

  input(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (terminal && !terminal.exited) terminal.pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (terminal && !terminal.exited) terminal.pty.resize(clamp(cols, 2, 500), clamp(rows, 1, 300));
  }

  async close(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    await stopProcess(terminal);
    this.flush(terminal);
    this.terminals.delete(terminalId);
  }

  // Round 12 (SPEC 26.2): Stopp in Økt ends the process; the tab stays, with its output, as ended.
  async stop(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (terminal) await stopProcess(terminal);
  }

  detach(client: TerminalClient): void {
    for (const terminal of this.terminals.values()) terminal.clients.delete(client);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.terminals.keys()].map((id) => this.close(id)));
  }
}

function stopProcess(terminal: Terminal): Promise<void> {
  if (terminal.exited) return Promise.resolve();
  return new Promise((resolve) => {
    terminal.exitWaiters.push(resolve);
    const { pid } = terminal.pty;
    signalGroup(pid, "SIGHUP");
    signalGroup(pid, "SIGTERM");
    setTimeout(() => signalGroup(pid, "SIGKILL"), 1000).unref();
    // Exit can get lost if the master closes first.
    setTimeout(resolve, 2500).unref();
  });
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal); // The PTY child leads its own session and group.
  } catch {
    // Already gone.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(Number(value)) || min, min), max);
}

function trimReplay(text: string): string {
  if (text.length <= REPLAY_CHARS) return text;
  const cut = text.slice(-REPLAY_CHARS);
  const newline = cut.indexOf("\n"); // Do not start in the middle of an escape sequence.
  return newline === -1 ? cut : cut.slice(newline + 1);
}
