import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// The folder with version.json, docs/ and web/dist. The Electron app runs a built copy of the server
// from its own resources and points AD_APP_ROOT there (desktop/main.ts).
export const REPO_ROOT = process.env.AD_APP_ROOT || path.resolve(import.meta.dirname, "../..");

export interface Config {
  dataDir: string;
  port: number;
  webDist: string;
  browserIdleMs: number;
  mockDelayMs: number;
  commandTimeoutMs: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? process.env.AD_DATA_DIR ?? path.join(homedir(), ".local/share/agentic-desktop");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    dataDir: realpathSync(dataDir),
    port: overrides.port ?? Number(process.env.AD_PORT ?? 4317),
    webDist: overrides.webDist ?? process.env.AD_WEB_DIST ?? path.join(REPO_ROOT, "web/dist"),
    browserIdleMs: overrides.browserIdleMs ?? Number(process.env.AD_BROWSER_IDLE_MS ?? 5 * 60_000),
    mockDelayMs: overrides.mockDelayMs ?? Number(process.env.AD_MOCK_DELAY_MS ?? 12),
    commandTimeoutMs: overrides.commandTimeoutMs ?? 120_000,
  };
}
