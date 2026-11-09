// The two main folders: a global one in $XDG_CONFIG_HOME/agentic-desktop (default
// ~/.config/agentic-desktop) and .agentic/ in the root of each project. Both hold AGENTS.md,
// settings.json and skills/. The project wins over the global one.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { PermissionMode, Project } from "../../shared/protocol.ts";
import { PERSONALITIES } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";
import { guardPath } from "./paths.ts";
import { writeAtomic } from "./write-atomic.ts";

export const PROJECT_CONFIG_DIR = ".agentic";
const MAX_INSTRUCTIONS = 64 * 1024;
const MAX_SETTINGS = 64 * 1024;

export function defaultGlobalConfigDir(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "agentic-desktop");
}

// What settings.json may hold. Anything else in the file is kept but ignored.
export interface FolderSettings {
  model?: string; // a model id, name or model string
  permissionMode?: PermissionMode;
  personality?: string;
}

const PERMISSION_MODES: PermissionMode[] = ["ask", "accept-edits", "full"];

export function cleanSettings(raw: unknown): FolderSettings {
  const out: FolderSettings = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const value = raw as Record<string, unknown>;
  if (typeof value.model === "string" && value.model.trim()) out.model = value.model.trim();
  if (PERMISSION_MODES.includes(value.permissionMode as PermissionMode)) out.permissionMode = value.permissionMode as PermissionMode;
  if (typeof value.personality === "string" && PERSONALITIES.some((p) => p.id === value.personality)) out.personality = value.personality;
  return out;
}

function readText(file: string, max: number): string | null {
  try {
    return readFileSync(file, "utf8").slice(0, max);
  } catch {
    return null;
  }
}

function readJson(file: string): { settings: FolderSettings; error?: string } {
  const text = readText(file, MAX_SETTINGS);
  if (text === null) return { settings: {} };
  try {
    return { settings: cleanSettings(JSON.parse(text)) };
  } catch (err) {
    return { settings: {}, error: `${path.basename(file)} er ikke gyldig JSON: ${(err as Error).message}` };
  }
}

export interface ConfigLayer {
  dir: string;
  agentsMd: string | null;
  settings: FolderSettings;
  settingsError?: string;
}

export class ConfigDirs {
  readonly globalDir: string;
  private dataDir: string;

  constructor(globalDir: string, dataDir: string) {
    this.globalDir = globalDir;
    this.dataDir = dataDir;
  }

  get skillsDir(): string {
    return path.join(this.globalDir, "skills");
  }

  global(): ConfigLayer {
    const { settings, error } = readJson(path.join(this.globalDir, "settings.json"));
    return { dir: this.globalDir, agentsMd: readText(path.join(this.globalDir, "AGENTS.md"), MAX_INSTRUCTIONS), settings, ...(error ? { settingsError: error } : {}) };
  }

  writeGlobalAgents(text: string): void {
    if (text.length > MAX_INSTRUCTIONS) throw new HttpError(413, "AGENTS.md er for stor");
    writeAtomic(path.join(this.globalDir, "AGENTS.md"), text, this.globalDir);
  }

  writeGlobalSettings(patch: FolderSettings): FolderSettings {
    const file = path.join(this.globalDir, "settings.json");
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // Missing or broken: start over with what we know.
    }
    const next: Record<string, unknown> = { ...current, ...patch };
    for (const [key, value] of Object.entries(patch)) if (value === undefined || value === null || value === "") delete next[key];
    writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`, this.globalDir);
    return cleanSettings(next);
  }

  // Everything in the project goes through the same path guard as the agent's tools.
  project(project: Project): ConfigLayer {
    const read = (name: string) => {
      try {
        return guardPath(project.path, path.join(PROJECT_CONFIG_DIR, name), this.dataDir).abs;
      } catch {
        return null;
      }
    };
    const agents = read("AGENTS.md");
    const settingsFile = read("settings.json");
    const { settings, error } = settingsFile ? readJson(settingsFile) : { settings: {} };
    return {
      dir: path.join(project.path, PROJECT_CONFIG_DIR),
      agentsMd: agents ? readText(agents, MAX_INSTRUCTIONS) : null,
      settings,
      ...(error ? { settingsError: error } : {}),
    };
  }

  writeProjectAgents(project: Project, text: string): void {
    if (text.length > MAX_INSTRUCTIONS) throw new HttpError(413, "AGENTS.md er for stor");
    const { abs } = guardPath(project.path, path.join(PROJECT_CONFIG_DIR, "AGENTS.md"), this.dataDir);
    writeAtomic(abs, text, project.path);
  }

  // The project wins, key by key.
  effective(project: Project | undefined): FolderSettings {
    return { ...this.global().settings, ...(project ? this.project(project).settings : {}) };
  }
}
