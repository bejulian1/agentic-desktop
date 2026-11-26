// Runs a shell command in its own process group, so stop and timeout reach everything it started.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { bwrapExecutable } from "../chat-python.ts";

export interface CommandOptions {
  command: string;
  cwd: string;
  confined?: boolean; // A delegated Git worktree.
  env: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
  onOutput: (text: string) => void;
  input?: string; // written to stdin, which is then closed; without it stdin is /dev/null
}

export interface CommandResult {
  exitCode: number | null;
  output: string; // stdout and stderr as they came
  stdout: string; // the same, kept apart, for hooks (server/src/hooks.ts)
  stderr: string;
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
  let executable = "bash";
  let args = ["-c", options.command];
  let env = options.env;
  if (options.confined) {
    const bwrap = bwrapExecutable();
    if (!bwrap) return Promise.reject(new Error("Worktree commands require bubblewrap on Linux."));
    executable = bwrap;
    const node = path.basename(process.execPath) === "node" && !process.execPath.startsWith("/usr/")
      ? ["--ro-bind", process.execPath, "/toolchain/node"] : [];
    const systemLinks = ["/bin", "/sbin", "/lib", "/lib64"].filter(dir => existsSync(dir))
      .flatMap(dir => ["--ro-bind", dir, dir]);
    args = [
      "--unshare-all", "--share-net", "--unshare-user", "--disable-userns", "--cap-drop", "ALL", "--die-with-parent",
      "--ro-bind", "/usr", "/usr", ...systemLinks, ...node, "--proc", "/proc", "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--ro-bind-try", "/etc/ssl/certs", "/etc/ssl/certs",
      "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
      "--ro-bind-try", "/etc/hosts", "/etc/hosts",
      "--bind", options.cwd, options.cwd, "--remount-ro", "/", "--chdir", options.cwd,
      "/bin/bash", ...args,
    ];
    env = { PATH: "/toolchain:/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8" };
  }
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env,
      detached: true, // A new process group, led by the child.
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const pid = child.pid;
    // Always piped (see stdio above); the conditional stdio only loses the tuple type.
    const out = child.stdout!;
    const err = child.stderr!;
    if (options.input !== undefined && child.stdin) {
      // A command that never reads stdin closes it early: that is not an error.
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.input);
    }
    let output = "";
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const onData = (chunk: Buffer, which: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-MAX_KEPT_CHARS);
      if (which === "stdout") stdout = (stdout + text).slice(-MAX_KEPT_CHARS);
      else stderr = (stderr + text).slice(-MAX_KEPT_CHARS);
      options.onOutput(text);
    };
    out.on("data", (chunk: Buffer) => onData(chunk, "stdout"));
    err.on("data", (chunk: Buffer) => onData(chunk, "stderr"));

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
      child.stdin?.destroy();
      out.destroy();
      err.destroy();
      resolve({ exitCode, output, stdout, stderr, timedOut, cancelled });
    };

    child.on("error", (error) => {
      output += `Kunne ikke starte kommandoen: ${error.message}\n`;
      stderr += `Kunne ikke starte kommandoen: ${error.message}\n`;
      finish(null);
    });
    // "close" waits for the pipes, which a background job can hold open forever.
    child.on("close", (code) => finish(code));
    child.on("exit", (code) => setTimeout(() => finish(code), CLOSE_GRACE_MS));
  });
}
