// The stdio transport: the app starts the server as a child process and talks JSON-RPC with it,
// one JSON message per line on stdin and stdout. What it writes to stderr is kept as a short tail
// for the status view in Innstillinger; it is never treated as an error by itself (spec).
//
// The child gets its own process group, so stopping it also stops what it started (npx starts
// node, Playwright starts a browser). Stopping follows the spec: close stdin, wait, SIGTERM, wait,
// SIGKILL.
import { spawn, type ChildProcess } from "node:child_process";
import type { JsonRpcMessage, Transport } from "./client.ts";

const MAX_LINE = 16 * 1024 * 1024; // a line longer than this is not a message we want
const STDERR_TAIL = 8 * 1024;
const GRACE_MS = 2000;

export interface StdioOptions {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  onStderr?: (tail: string) => void;
}

export class StdioTransport implements Transport {
  private options: StdioOptions;
  private child: ChildProcess | null = null;
  private buffer = "";
  private stderr = ""; // complete lines, at most STDERR_TAIL characters
  private partial = ""; // the line being written now
  private exited: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(options: StdioOptions) {
    this.options = options;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  // Whole lines only. The start is cut at a line boundary and a line still being written is left
  // out, so a secret is never shown in part, where the redaction in manager.ts could not find it.
  tail(): string {
    return this.stderr;
  }

  start(handlers: { onMessage: (message: JsonRpcMessage) => void; onClose: (error?: Error) => void }): Promise<void> {
    return new Promise((resolve, reject) => {
      let started = false;
      let closed = false;
      const close = (error?: Error) => {
        if (closed) return;
        closed = true;
        if (this.closing) handlers.onClose();
        else handlers.onClose(error ?? new Error("MCP-serveren avsluttet."));
      };
      const child = spawn(this.options.command, this.options.args, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true, // its own process group, led by the child
        windowsHide: true,
      });
      this.child = child;
      this.exited = new Promise((done) => child.once("close", () => done()));

      child.once("error", (err: NodeJS.ErrnoException) => {
        const error = new Error(err.code === "ENOENT" ? `Fant ikke kommandoen «${this.options.command.slice(0, 80)}». Er den installert og på PATH?` : `Kunne ikke starte MCP-serveren: ${err.message}`);
        if (!started) reject(error);
        close(error);
      });
      child.once("spawn", () => {
        started = true;
        resolve();
      });
      child.once("close", (code, signal) => {
        // What the server started (a browser) must not outlive it.
        this.killGroup(child, "SIGTERM");
        this.flushStderr();
        close(new Error(signal ? `MCP-serveren ble stoppet (${signal}).` : `MCP-serveren avsluttet med kode ${code}.`));
      });

      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        this.buffer += chunk;
        if (this.buffer.length > MAX_LINE && !this.buffer.includes("\n")) {
          this.buffer = "";
          this.addStderr("[Agentic Desktop: for lang linje fra serveren, forkastet]\n");
          return;
        }
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline).replace(/\r$/, "");
          this.buffer = this.buffer.slice(newline + 1);
          if (!line.trim()) continue;
          let message: unknown;
          try {
            message = JSON.parse(line);
          } catch {
            // The server must not write anything but MCP to stdout. Keep a trace for the user.
            // Only its length: a cut piece of it could hold part of a secret the redaction cannot see.
            this.addStderr(`[Agentic Desktop: ugyldig linje på stdout, ${line.length} tegn, ble forkastet]\n`);
            continue;
          }
          // A batch (allowed before 2025-06-18) is handled one message at a time.
          for (const item of Array.isArray(message) ? message : [message]) handlers.onMessage(item as JsonRpcMessage);
        }
      });
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (chunk: string) => this.addStderr(chunk));
      // Writing to a child that died: the close event says what happened.
      child.stdin!.on("error", () => undefined);
    });
  }

  send(message: JsonRpcMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return Promise.reject(new Error("MCP-serveren kjører ikke."));
    // JSON.stringify never puts a raw newline in its output, as the transport requires.
    return new Promise((resolve, reject) => stdin.write(`${JSON.stringify(message)}\n`, (err) => (err ? reject(err) : resolve())));
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || this.closing) return this.exited;
    this.closing = true;
    if (child.exitCode !== null || child.signalCode !== null) return this.exited;
    child.stdin?.end();
    if (await this.waitExit(GRACE_MS)) return;
    this.killGroup(child, "SIGTERM");
    if (await this.waitExit(GRACE_MS)) return;
    this.killGroup(child, "SIGKILL");
    await this.waitExit(GRACE_MS);
  }

  private waitExit(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      void this.exited.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  // The whole group, so a browser started by the server goes too. Falls back to the child alone.
  private killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  }

  private addStderr(text: string): void {
    this.partial += text;
    const end = this.partial.lastIndexOf("\n");
    if (end < 0) {
      // One endless line: dropped rather than shown in part.
      if (this.partial.length > STDERR_TAIL) this.partial = "";
      return;
    }
    let lines = this.stderr + this.partial.slice(0, end + 1);
    this.partial = this.partial.slice(end + 1);
    if (lines.length > STDERR_TAIL) {
      lines = lines.slice(-STDERR_TAIL);
      const first = lines.indexOf("\n");
      lines = lines.slice(first + 1); // the cut line goes whole
    }
    this.stderr = lines;
    this.options.onStderr?.(this.stderr);
  }

  // What is left when the process ends counts as a line.
  private flushStderr(): void {
    if (this.partial) this.addStderr("\n");
  }
}
