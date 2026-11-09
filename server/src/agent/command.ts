// Runs a shell command in its own process group, so stop and timeout reach everything it started.
import { spawn } from "node:child_process";

export interface CommandOptions {
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
  onOutput: (text: string) => void;
}

export interface CommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
}

const MAX_KEPT_CHARS = 200_000;
const KILL_GRACE_MS = 1500;
const CLOSE_GRACE_MS = 100;

export function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

export function runCommand(options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", options.command], {
      cwd: options.cwd,
      env: options.env,
      detached: true, // A new process group, led by the child.
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    let output = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-MAX_KEPT_CHARS);
      options.onOutput(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const terminate = () => {
      if (pid === undefined) return;
      killGroup(pid, "SIGTERM");
      killTimer = setTimeout(() => killGroup(pid, "SIGKILL"), KILL_GRACE_MS);
    };
    const onAbort = () => {
      cancelled = true;
      terminate();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      options.signal.removeEventListener("abort", onAbort);
      // Background jobs die with the command. They would otherwise outlive the app.
      if (pid !== undefined) killGroup(pid, "SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ exitCode, output, timedOut, cancelled });
    };

    child.on("error", (err) => {
      output += `Kunne ikke starte kommandoen: ${err.message}\n`;
      finish(null);
    });
    // "close" waits for the pipes, which a background job can hold open forever.
    child.on("close", (code) => finish(code));
    child.on("exit", (code) => setTimeout(() => finish(code), CLOSE_GRACE_MS));
  });
}
