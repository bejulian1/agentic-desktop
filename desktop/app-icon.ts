// Round 14 (SPEC 30.2): the app icon the user chose in Innstillinger → Utseende. The window and the
// status area take it at once. The icon in the app library comes from the files install-local.ts
// put in ~/.local/share/icons/hicolor; the app replaces them only when it runs from such an
// installation (the folder has install-local's marker file), and only those files.
//
// Also used by scripts/install-local.ts, so both agree on where the files are.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const APP_ID = "io.github.AgenticDesktop";
export const INSTALL_MARKER = ".agentic-desktop-install"; // only a folder with this file is ever replaced or removed
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

export interface IconPlaces {
  icons: string; // ~/.local/share/icons/hicolor
  // Where each file goes, and the file it comes from in an icon's folder (desktop/icons/png/<id>).
  files: Array<{ file: string; source: string }>;
}

// Follows HOME and XDG_DATA_HOME, so the tests use a temporary HOME.
export function iconPlaces(env: NodeJS.ProcessEnv = process.env): IconPlaces {
  const home = env.HOME || homedir();
  const data = env.XDG_DATA_HOME || path.join(home, ".local/share");
  const icons = path.join(data, "icons/hicolor");
  return {
    icons,
    files: [
      ...ICON_SIZES.map((size) => ({ file: path.join(icons, `${size}x${size}/apps/${APP_ID}.png`), source: `app-${size}.png` })),
      { file: path.join(icons, `scalable/apps/${APP_ID}.svg`), source: "app.svg" },
      { file: path.join(icons, `symbolic/apps/${APP_ID}-symbolic.svg`), source: "symbolic.svg" },
    ],
  };
}

// The folder of an installation made by install-local.ts, or null when the app runs from somewhere
// else (the project, a .deb, an AppImage).
export function installedFrom(appDir: string): string | null {
  return existsSync(path.join(appDir, INSTALL_MARKER)) ? appDir : null;
}

// Puts one icon's files in the icon theme, each through a new file renamed into place, and only
// where the content differs. GNOME notices the change by the folder's time; gtk-update-icon-cache
// is run when the theme has a cache. Returns the files that were written.
export function installIcon(sourceDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const places = iconPlaces(env);
  const written: string[] = [];
  for (const { file, source } of places.files) {
    const from = path.join(sourceDir, source);
    if (!existsSync(from)) throw new Error(`Mangler ${source} for ikonet`);
    const content = readFileSync(from);
    if (existsSync(file) && readFileSync(file).equals(content)) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.ny`;
    try {
      writeFileSync(temp, content, { mode: 0o644 });
      renameSync(temp, file);
    } finally {
      rmSync(temp, { force: true });
    }
    written.push(file);
  }
  if (written.length) {
    const now = new Date();
    try {
      utimesSync(places.icons, now, now);
    } catch {
      // The theme folder was made above; nothing more to do if the time cannot be set.
    }
    if (existsSync(path.join(places.icons, "index.theme"))) spawnSync("gtk-update-icon-cache", ["-q", "-t", places.icons], { stdio: "ignore", timeout: 10_000 });
  }
  return written;
}
