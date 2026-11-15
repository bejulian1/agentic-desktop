// Hooks: shell commands the user sets up in Innstillinger → Hooks, run by the app on agent events.
// The event names and the JSON on stdin follow Claude Code's hooks, so scripts written for it need
// little or no change. Shared by the server (server/src/hooks.ts) and the settings page.

export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];
export type HookMode = "code" | "chat";

// What one run of a hook came to. "blocked" is exit code 2 or {"decision":"block"} on stdout;
// "error" is any other non-zero exit code or a command that could not start.
export type HookOutcome = "ok" | "blocked" | "error" | "timeout" | "cancelled";

export const HOOK_TIMEOUT_DEFAULT = 30; // seconds
export const HOOK_TIMEOUT_MAX = 300;
export const MAX_HOOKS = 50;
export const MAX_HOOK_COMMAND = 4000;
export const MAX_HOOK_NAME = 80;
export const MAX_HOOK_MATCHER = 500;

export interface HookConfig {
  id: string;
  name: string;
  event: HookEvent;
  matcher: string; // tool events only: "" or "*" for all, else names, globs and | alternatives
  command: string; // one line for bash -c
  timeoutSeconds: number;
  enabled: boolean;
  modes: HookMode[]; // where it applies: Kode, Chat or both
}

export interface HookRun {
  at: number;
  event: HookEvent;
  outcome: HookOutcome;
  exitCode: number | null;
  durationMs: number;
  output: string; // the tail of stdout and stderr, for the settings page
  test?: boolean; // started with «Test» in Innstillinger
}

export interface HookInfo extends HookConfig {
  lastRun: HookRun | null;
}

export interface HooksState {
  hooks: HookInfo[];
  file: string; // where they are kept, shown on the settings page
  warnings: string[]; // entries in the file that could not be read
}

// The result of «Test»: the run, plus what the app would have done with it.
export interface HookTestResult extends HookRun {
  stdout: string;
  stderr: string;
  effect: string; // in Norwegian, for example «Ville stoppet verktøykallet: …»
}

// Tool events can be narrowed to some tools; the others always run.
export function isToolEvent(event: HookEvent): boolean {
  return event === "PreToolUse" || event === "PostToolUse";
}

// Does a matcher take this tool name? Like Claude Code: empty or "*" is every tool, "a|b" is
// either, and "*" inside a part is any run of characters (mcp__github__*). ".*" is read as "*",
// so a matcher copied from Claude Code, where it is a regex, mostly works. Everything else is
// literal and the whole name has to match.
export function matchesTool(matcher: string, toolName: string): boolean {
  const text = matcher.trim();
  if (!text || text === "*") return true;
  return text.split("|").some((part) => {
    const glob = part.trim().replace(/\.\*/g, "*");
    if (!glob) return false;
    const source = glob.split("*").map((piece) => piece.replace(/[.+?^${}()[\]\\|]/g, "\\$&")).join(".*");
    return new RegExp(`^${source}$`).test(toolName);
  });
}
