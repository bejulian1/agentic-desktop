// Whether Chromium's sandbox is on, and if not, why and how to turn it on (SPEC 29.2). The choice
// itself is made before the app runs, by desktop/launcher/agentic-desktop-start, because Chromium
// sets up its sandbox before main.js: with the sandbox off the script has added --no-sandbox.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface SandboxInfo {
  on: boolean;
  reason: string | null; // one sentence, only when it is off
  command: string | null; // what turns it on, to copy, only when it is off for want of the profile
}

const PROFILE_DIR = "/sys/kernel/security/apparmor/policy/profiles";
// Where the profile from desktop/apparmor is attached: @{HOME}/.local/opt/agentic-desktop/agentic-desktop-bin
// (Electron itself; agentic-desktop next to it is the start script).
const ATTACHED = /^(\/home\/[^/]+|\/root)\/\.local\/opt\/agentic-desktop\/agentic-desktop-bin$/;

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

export function profileLoaded(): boolean {
  try {
    return readdirSync(PROFILE_DIR).some((name) => name.startsWith("agentic-desktop.") && read(path.join(PROFILE_DIR, name, "name")) === "agentic-desktop");
  } catch {
    return false;
  }
}

// A path as one word for a shell, in single quotes when it needs them.
export function shellWord(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export function profileCommand(profile: string): string {
  return `sudo install -m 644 ${shellWord(profile)} /etc/apparmor.d/agentic-desktop && sudo apparmor_parser -r /etc/apparmor.d/agentic-desktop`;
}

export function sandboxInfo(options: { noSandbox: boolean; executable: string; profile: string }): SandboxInfo {
  if (!options.noSandbox) return { on: true, reason: null, command: null };
  const restricted = read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") === "1";
  if (!restricted) return { on: false, reason: "Chromium-sandkassen er av fordi maskinen ikke gir appen brukernavnerom.", command: null };
  if (profileLoaded() && !ATTACHED.test(options.executable)) {
    return { on: false, reason: "Chromium-sandkassen er av fordi appen kjører utenfor ~/.local/opt/agentic-desktop, der AppArmor-profilen gjelder.", command: null };
  }
  if (profileLoaded()) return { on: false, reason: "Chromium-sandkassen er av. AppArmor-profilen er lastet nå, så den slås på neste gang appen starter.", command: null };
  return { on: false, reason: "Chromium-sandkassen er av fordi AppArmor-profilen for Agentic Desktop mangler.", command: profileCommand(options.profile) };
}
