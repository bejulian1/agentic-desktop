// Production build: bumps the build number in version.json, builds web/ and records the date.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function webBuildScript(root: string): string | undefined {
  try {
    return JSON.parse(readFileSync(path.join(root, "web/package.json"), "utf8")).scripts?.build;
  } catch {
    return undefined;
  }
}

function newestMtime(target: string): number {
  const info = statSync(target, { throwIfNoEntry: false });
  if (!info) return 0;
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

export function needsBuild(root: string): boolean {
  if (!webBuildScript(root)) return false;
  const built = path.join(root, "web/dist/index.html");
  if (!existsSync(built)) return true;
  // The UI tests live in web/test but are not part of the bundle, so a changed test is no reason
  // to build again and bump the build number.
  const web = readdirSync(path.join(root, "web"), { withFileTypes: true })
    .filter((entry) => entry.name !== "test" && entry.name !== "dist" && entry.name !== "node_modules")
    .map((entry) => newestMtime(path.join(root, "web", entry.name)));
  const sources = Math.max(0, ...web, newestMtime(path.join(root, "shared")));
  return sources > statSync(built).mtimeMs;
}

export interface BuildResult {
  version: string;
  build: number;
  builtAt: string;
}

export function productionBuild(root: string): BuildResult | null {
  if (!webBuildScript(root)) return null;
  const result = spawnSync("npm", ["run", "build"], { cwd: path.join(root, "web"), stdio: "inherit" });
  if (result.status !== 0) throw new Error("Bygget av web feilet");

  const versionFile = path.join(root, "version.json");
  const current = JSON.parse(readFileSync(versionFile, "utf8")) as { version: string; build: number };
  const next = { ...current, build: current.build + 1 };
  writeFileSync(versionFile, `${JSON.stringify(next, null, 2)}\n`);
  const info = { ...next, builtAt: new Date().toISOString() };
  writeFileSync(path.join(root, "web/dist/build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}
