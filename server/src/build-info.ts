import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { BuildInfo } from "../../shared/protocol.ts";
import { REPO_ROOT } from "./config.ts";

// version.json is the source. build-info.json is written by the production build.
export function loadBuildInfo(webDist: string): BuildInfo {
  const versionFile = path.join(REPO_ROOT, "version.json");
  const source = JSON.parse(readFileSync(versionFile, "utf8")) as { version: string; build: number };
  let built: { build?: number; builtAt?: string } = {};
  try {
    built = JSON.parse(readFileSync(path.join(webDist, "build-info.json"), "utf8"));
  } catch {
    // Not built yet.
  }
  return {
    name: "Agentic Desktop",
    version: source.version,
    build: built.build ?? source.build,
    builtAt: built.builtAt ?? statSync(versionFile).mtime.toISOString(),
    signature: "Code Pro",
  };
}
