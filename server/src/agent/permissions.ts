import type { PermissionMode, Project, Thread } from "../../../shared/protocol.ts";
import type { Store } from "../db.ts";
import { guardPath, isProtectedCommand, isProtectedPath } from "../paths.ts";
import type { Tool } from "./tools.ts";

const ORDER: PermissionMode[] = ["ask", "accept-edits", "full"];

export function lowerMode(a: PermissionMode, b: PermissionMode): PermissionMode {
  return ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))];
}

export function effectiveMode(project: Project, thread: Thread): PermissionMode {
  return thread.permissionCap ? lowerMode(project.permissionMode, thread.permissionCap) : project.permissionMode;
}

// command: one exact command line. prefix: a simple command that starts with these words (see
// commandPrefix). tool: a tool by name, or every browser tool as "browser_*".
export type AllowKind = "command" | "prefix" | "tool";

export interface Decision {
  ask: boolean;
  canAllowAlways: boolean;
  rule?: { kind: AllowKind; value: string };
  reason?: string;
}

// rules: where "allow always" is kept. A project keeps its rules in the store; Denne datamaskinen
// is not a row there, so the runner passes its own.
export interface AllowRules {
  isAllowed(kind: AllowKind, value: string): boolean;
}

// Anything the shell reads as more than one plain command: chains, pipes, redirects, command
// substitution, background jobs, several lines, variable assignments in front. A command with any
// of these is only ever allowed exactly as written.
const SHELL_SYNTAX = /&&|\|\||[;|&`<>\n\r]|\$\(|\$\{|<\(|>\(/;
const WORD = /^[A-Za-z0-9][A-Za-z0-9._+@:-]*$/;

// Programs whose first word after the name is a subcommand: "git status", "cargo test".
const SUBCOMMAND = new Set([
  "git", "cargo", "go", "dotnet", "mvn", "gradle", "./gradlew", "make", "just", "deno", "uv", "poetry", "pip", "pip3",
  "rustup", "swift", "mix", "composer", "bundle", "rake", "flutter", "dart",
]);
// Subcommands that change how the program itself runs later: never by prefix.
const NEVER_SUBCOMMAND = new Set(["config", "alias", "remote", "submodule", "filter-branch", "credential", "install", "uninstall", "publish", "login", "logout", "adduser", "token"]);
// Package managers: "npm test", but "npm run build" and "npx tsc" keep the script or package too.
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SCRIPT_RUNNERS = new Set(["run", "run-script", "exec", "x", "dlx"]);
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpx"]);
// Programs that only read or check, where any arguments are fine as long as the line is simple.
const READERS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "ag", "tree", "du", "df", "stat", "file", "which", "whereis",
  "echo", "printf", "date", "uname", "whoami", "diff", "cmp", "sort", "uniq", "cut", "basename", "dirname", "realpath",
  "readlink", "nl", "less", "more", "true", "false", "jq", "yq", "tsc", "eslint", "pytest", "vitest", "jest", "mypy",
  "ruff", "pyright", "shellcheck", "ps",
]);
// Interpreters: the script or module stays part of the rule, and inline code never gets one.
const INTERPRETERS = new Set(["node", "python", "python3", "ruby", "perl", "php", "bash", "sh", "zsh"]);
const INLINE_CODE = new Set(["-c", "-e", "-p", "--eval", "--print", "-r", "--require", "--import", "--loader", "-i", "--interactive", "-s"]);
// Never as a prefix, whatever follows: these run other programs, change rights or delete.
const NEVER_PREFIX = new Set(["sudo", "su", "doas", "env", "xargs", "eval", "exec", "command", "nohup", "time", "watch", "rm", "rmdir", "dd", "mkfs", "chmod", "chown", "chgrp", "kill", "pkill", "killall", "find", "sed", "awk", "curl", "wget", "ssh", "scp", "rsync", "nc", "ncat", "socat", "shred", "truncate", "crontab", "systemctl", "reboot", "shutdown"]);

// The words a simple command is allowed by when the user answers "allow always": "git status" for
// "git status --short", "npm run build" for "npm run build -- --watch", "cat" for any cat. Undefined
// when the command is compound, starts with a path or an assignment, runs inline code or uses a
// program that is never allowed by prefix: then only the exact line can be allowed.
export function commandPrefix(command: string): string | undefined {
  const text = command.trim();
  if (!text || text.length > 2000 || SHELL_SYNTAX.test(text)) return undefined;
  const words = text.split(/\s+/);
  const program = words[0];
  if (!WORD.test(program) && program !== "./gradlew") return undefined;
  if (NEVER_PREFIX.has(program)) return undefined;
  const next = words[1];
  const plain = (word: string | undefined) => !!word && WORD.test(word) && !word.startsWith("-");
  if (next && NEVER_SUBCOMMAND.has(next) && (PACKAGE_MANAGERS.has(program) || SUBCOMMAND.has(program))) return undefined;
  if (PACKAGE_MANAGERS.has(program)) {
    if (!plain(next)) return undefined;
    if (SCRIPT_RUNNERS.has(next!)) return plain(words[2]) ? `${program} ${next} ${words[2]}` : undefined;
    return `${program} ${next}`;
  }
  if (PACKAGE_RUNNERS.has(program)) return plain(next) ? `${program} ${next}` : undefined;
  if (SUBCOMMAND.has(program)) {
    if (next === undefined) return program;
    return plain(next) ? `${program} ${next}` : undefined;
  }
  if (INTERPRETERS.has(program)) {
    if (next === "-m" && plain(words[2])) return `${program} -m ${words[2]}`;
    if (next === "--test") return words.slice(2).some((word) => INLINE_CODE.has(word.split("=")[0])) ? undefined : `${program} --test`;
    if (!next || next.startsWith("-") || INLINE_CODE.has(next)) return undefined;
    // A script file in the project: "node scripts/check.ts", "python manage.py".
    return /^[A-Za-z0-9_./-]+\.(?:[cm]?[jt]s|py|rb|pl|php|sh)$/.test(next) && !next.includes("..") && !next.startsWith("/") ? `${program} ${next}` : undefined;
  }
  if (READERS.has(program)) return program;
  return undefined;
}

// The rule an "allow always" answer saves for this call.
export function allowRule(name: string, input: any): NonNullable<Decision["rule"]> {
  if (name === "run_command") {
    const command = String(input?.command ?? "");
    const prefix = commandPrefix(command);
    return prefix ? { kind: "prefix", value: prefix } : { kind: "command", value: command };
  }
  if (name.startsWith("browser_")) return { kind: "tool", value: "browser_*" };
  return { kind: "tool", value: name };
}

function allowed(name: string, input: any, check: (kind: AllowKind, value: string) => boolean): boolean {
  if (name === "run_command") {
    const command = String(input?.command ?? "");
    if (check("command", command)) return true; // exact rules from earlier versions
    const prefix = commandPrefix(command);
    return prefix !== undefined && check("prefix", prefix);
  }
  if (check("tool", name)) return true;
  return name.startsWith("browser_") && check("tool", "browser_*");
}

export function decide(tool: Tool, input: any, project: Project, thread: Thread, store: Store, dataDir: string, rules?: AllowRules): Decision {
  const name = tool.def.name;

  // Protected paths ask in every mode, and "allow always" never applies to them.
  if (name === "run_command" && typeof input.command === "string" && isProtectedCommand(input.command, dataDir)) {
    return { ask: true, canAllowAlways: false, reason: "Kommandoen berører en beskyttet fil" };
  }
  const target = tool.path?.(input);
  if (typeof target === "string") {
    try {
      if (isProtectedPath(guardPath(project.path, target, dataDir).rel)) {
        return { ask: true, canAllowAlways: false, reason: "Beskyttet fil" };
      }
    } catch {
      // Refused when the tool runs. There is nothing to approve.
    }
  }

  if (tool.kind === "read") return { ask: false, canAllowAlways: false };
  const mode = effectiveMode(project, thread);
  const allowedByMode = mode === "full" || (mode === "accept-edits" && tool.kind === "edit");
  if (allowedByMode) return { ask: false, canAllowAlways: false };

  const check = (kind: AllowKind, value: string) => rules ? rules.isAllowed(kind, value) : store.isAllowed(project.id, kind, value);
  if (allowed(name, input, check)) return { ask: false, canAllowAlways: false };
  return { ask: true, canAllowAlways: true, rule: allowRule(name, input) };
}

// What "allow always" covers, in the words of the approval card and Innstillinger → Tillatelser.
export function ruleLabel(rule: { kind: AllowKind; value: string }): string {
  if (rule.kind === "prefix") return `${rule.value} …`;
  if (rule.kind === "tool" && rule.value === "browser_*") return "browser_*";
  return rule.value;
}

// "Allow always" on Denne datamaskinen, kept with the app's own values since it has no project row.
// Each entry is "kind:value".
export const LOCAL_RULES_KEY = "app:local-allow-rules";

export function readLocalRules(store: Store): Set<string> {
  const saved = store.metaValue(LOCAL_RULES_KEY);
  return new Set(Array.isArray(saved) ? saved.filter((rule): rule is string => typeof rule === "string") : []);
}

export function writeLocalRules(store: Store, rules: Iterable<string>): void {
  store.setMetaValue(LOCAL_RULES_KEY, [...rules].slice(-500));
}

export function parseLocalRule(entry: string): { kind: AllowKind; value: string } | undefined {
  const cut = entry.indexOf(":");
  const kind = entry.slice(0, cut);
  return cut > 0 && (kind === "command" || kind === "prefix" || kind === "tool") ? { kind, value: entry.slice(cut + 1) } : undefined;
}
