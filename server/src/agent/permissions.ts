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

export interface Decision {
  ask: boolean;
  canAllowAlways: boolean;
  rule?: { kind: "command" | "tool"; value: string };
  reason?: string;
}

export function decide(tool: Tool, input: any, project: Project, thread: Thread, store: Store, dataDir: string): Decision {
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

  const rule: Decision["rule"] = name === "run_command" ? { kind: "command", value: String(input.command) } : { kind: "tool", value: name };
  if (store.isAllowed(project.id, rule.kind, rule.value)) return { ask: false, canAllowAlways: false };
  return { ask: true, canAllowAlways: true, rule };
}
