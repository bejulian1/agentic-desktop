// Installs Agentic Desktop for this user, without sudo (SPEC 29.2):
//   ~/.local/opt/agentic-desktop/                              the app, from dist-desktop/linux-unpacked
//   ~/.local/opt/agentic-desktop/agentic-desktop               the start script, which the .desktop
//                                                              file starts: it chooses Chromium's
//                                                              sandbox (SPEC 29.2)
//   ~/.local/opt/agentic-desktop/agentic-desktop-bin           Electron itself
//   ~/.local/opt/agentic-desktop/agentic-desktop-start         a link to the start script (bygg 29)
//   ~/.local/share/applications/io.github.AgenticDesktop.desktop
//   ~/.local/share/icons/hicolor/<size>/apps/io.github.AgenticDesktop.png, the SVG and the symbolic SVG
// `--uninstall` removes exactly these again. The threads and settings in ~/.local/share/agentic-desktop
// and ~/.config/agentic-desktop are never touched.
//
//   node scripts/install-local.ts [--from <folder>]
//   node scripts/install-local.ts --uninstall
//
// It follows HOME and XDG_DATA_HOME, so the tests run it against a temporary HOME.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { profileLoaded } from "../desktop/sandbox.ts";
import { APP_ID, ICON_SIZES, iconPlaces, INSTALL_MARKER } from "../desktop/app-icon.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
// The .desktop file starts the start script, not Electron: Chromium sets up its sandbox before
// main.js runs, so whether it can (AppArmor) is decided there, at every start (desktop/launcher).
// The script has the name everything starts (also an Exec line GNOME Shell still holds from bygg
// 28, which pointed straight at Electron), and Electron is next to it as agentic-desktop-bin.
const LAUNCHER = "agentic-desktop";
const BINARY = "agentic-desktop-bin";
const OLD_LAUNCHER = "agentic-desktop-start"; // the Exec line of bygg 29
const LAUNCHER_SOURCE = path.join(ROOT, "desktop/launcher/agentic-desktop-start");
const PROFILE_SOURCE = path.join(ROOT, "desktop/apparmor/agentic-desktop");
const MARKER = INSTALL_MARKER; // only a folder with this file is ever replaced or removed
const SIZES = ICON_SIZES;

export interface Places {
  opt: string;
  desktopFile: string;
  icons: string;
  iconFiles: string[];
}

export function places(): Places {
  const home = process.env.HOME || homedir();
  const data = process.env.XDG_DATA_HOME || path.join(home, ".local/share");
  // The same places the app replaces when another icon is chosen (desktop/app-icon.ts, SPEC 30.2).
  const icons = iconPlaces({ HOME: home, XDG_DATA_HOME: data });
  return {
    opt: path.join(home, ".local/opt/agentic-desktop"),
    desktopFile: path.join(data, "applications", `${APP_ID}.desktop`),
    icons: icons.icons,
    iconFiles: icons.files.map((f) => f.file),
  };
}

// A value in the Exec line: quoted when it has to be (Desktop Entry Specification, «The Exec key»).
function execArg(value: string): string {
  if (!/[\s"'\\`$<>~|&;*?#()]/.test(value)) return value;
  return `"${value.replace(/(["`$\\])/g, "\\$1")}"`;
}

export function desktopEntry(opt: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Agentic Desktop",
    "GenericName=Kodeapp",
    "Comment=Kodeapp for API-modeller",
    `Exec=${execArg(path.join(opt, LAUNCHER))} --ozone-platform-hint=auto %U`,
    `TryExec=${path.join(opt, LAUNCHER)}`,
    `Icon=${APP_ID}`,
    "Terminal=false",
    "Categories=Development;",
    "Keywords=kode;agent;terminal;AI;",
    `StartupWMClass=${APP_ID}`,
    "StartupNotify=true",
    "SingleMainWindow=true",
    "",
  ].join("\n");
}

function refreshCaches(p: Places): void {
  // Optional helpers: GNOME also finds the files without them.
  const quiet = { stdio: "ignore" as const };
  spawnSync("update-desktop-database", [path.dirname(p.desktopFile)], quiet);
  if (existsSync(path.join(p.icons, "index.theme"))) spawnSync("gtk-update-icon-cache", ["-q", "-t", p.icons], quiet);
}

function removeOurFolder(dir: string): void {
  if (!existsSync(dir)) return;
  if (lstatSync(dir).isSymbolicLink() || !existsSync(path.join(dir, MARKER))) {
    throw new Error(`${dir} finnes, men er ikke lagt inn av dette skriptet. Den blir ikke rørt.`);
  }
  rmSync(dir, { recursive: true, force: true });
}

export function install(from: string): Places {
  const p = places();
  if (process.getuid?.() === 0) throw new Error("Kjør ikke som root. Appen installeres for brukeren din.");
  if (!existsSync(path.join(from, LAUNCHER))) throw new Error(`Fant ikke ${LAUNCHER} i ${from}. Kjør npm run dist først.`);

  // The new copy goes next to the old one and is renamed into place, so a failed copy leaves the
  // installed app as it was.
  mkdirSync(path.dirname(p.opt), { recursive: true });
  const fresh = `${p.opt}.ny-${process.pid}`;
  rmSync(fresh, { recursive: true, force: true });
  cpSync(from, fresh, { recursive: true, verbatimSymlinks: true });
  writeFileSync(path.join(fresh, MARKER), `${new Date().toISOString()}\n`);
  // A package from before bygg 30 (or a stand-in in the tests) has Electron as agentic-desktop: it
  // becomes agentic-desktop-bin, and the start script comes from here.
  if (!existsSync(path.join(fresh, BINARY))) {
    renameSync(path.join(fresh, LAUNCHER), path.join(fresh, BINARY));
    rmSync(path.join(fresh, OLD_LAUNCHER), { force: true });
    cpSync(LAUNCHER_SOURCE, path.join(fresh, LAUNCHER));
  }
  chmodSync(path.join(fresh, BINARY), 0o755);
  chmodSync(path.join(fresh, LAUNCHER), 0o755);
  if (!existsSync(path.join(fresh, OLD_LAUNCHER))) symlinkSync(LAUNCHER, path.join(fresh, OLD_LAUNCHER));
  const profile = path.join(fresh, "resources/apparmor/agentic-desktop");
  if (!existsSync(profile)) {
    mkdirSync(path.dirname(profile), { recursive: true });
    cpSync(PROFILE_SOURCE, profile);
  }
  removeOurFolder(p.opt);
  renameSync(fresh, p.opt);

  const iconSource = path.join(ROOT, "desktop/icons");
  SIZES.forEach((size, i) => {
    mkdirSync(path.dirname(p.iconFiles[i]), { recursive: true });
    cpSync(path.join(iconSource, `png/app-${size}.png`), p.iconFiles[i]);
  });
  const [scalable, symbolic] = p.iconFiles.slice(SIZES.length);
  mkdirSync(path.dirname(scalable), { recursive: true });
  cpSync(path.join(iconSource, "agentic-desktop.svg"), scalable);
  mkdirSync(path.dirname(symbolic), { recursive: true });
  cpSync(path.join(iconSource, "agentic-desktop-symbolic.svg"), symbolic);

  mkdirSync(path.dirname(p.desktopFile), { recursive: true });
  writeFileSync(p.desktopFile, desktopEntry(p.opt), { mode: 0o644 });
  refreshCaches(p);
  return p;
}

// Ubuntu 24.04 and later stop unconfined apps from creating user namespaces. Without the AppArmor
// profile in desktop/apparmor/ the start script runs the app without Chromium's sandbox (it starts,
// and says so in Innstillinger -> Om). The profile takes root to install, so the script only says how.
// The command uses the copy inside the installation, which is also what the app shows.
export function apparmorHint(opt = places().opt): string | undefined {
  let restricted = "0";
  try { restricted = readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim(); } catch { return undefined; }
  if (restricted !== "1" || profileLoaded()) return undefined;
  const profile = path.join(opt, "resources/apparmor/agentic-desktop");
  return [
    "Appen starter, men uten Chromium-sandkassen, til AppArmor-profilen er lagt inn. Kjør dette én gang for å slå den på:",
    `  sudo install -m 644 ${execArg(profile)} /etc/apparmor.d/agentic-desktop`,
    "  sudo apparmor_parser -r /etc/apparmor.d/agentic-desktop",
    "Neste gang appen starter, bruker den sandkassen.",
  ].join("\n");
}

export function uninstall(): { removed: string[]; places: Places } {
  const p = places();
  const removed: string[] = [];
  if (existsSync(p.opt)) {
    removeOurFolder(p.opt);
    removed.push(p.opt);
  }
  for (const file of [p.desktopFile, ...p.iconFiles]) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
      removed.push(file);
    }
  }
  // Folders made for the icons, only when they are empty now.
  for (const file of p.iconFiles) {
    let dir = path.dirname(file);
    while (dir.startsWith(p.icons) && dir !== p.icons && existsSync(dir) && readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true });
      dir = path.dirname(dir);
    }
  }
  refreshCaches(p);
  return { removed, places: p };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--uninstall")) {
      const { removed } = uninstall();
      console.log(removed.length ? `Fjernet Agentic Desktop:\n${removed.map((f) => `  ${f}`).join("\n")}` : "Agentic Desktop var ikke installert.");
      console.log("Trådene og innstillingene i ~/.local/share/agentic-desktop og ~/.config/agentic-desktop er beholdt.");
      if (existsSync("/etc/apparmor.d/agentic-desktop")) console.log("AppArmor-profilen fjernes med: sudo apparmor_parser -R /etc/apparmor.d/agentic-desktop && sudo rm /etc/apparmor.d/agentic-desktop");
    } else {
      const at = args.indexOf("--from");
      const from = at >= 0 ? path.resolve(args[at + 1]) : path.join(ROOT, "dist-desktop/linux-unpacked");
      const p = install(from);
      console.log(`Agentic Desktop er installert i ${p.opt}.`);
      console.log(`Den ligger i appbiblioteket som «Agentic Desktop» (${p.desktopFile}).`);
      const hint = apparmorHint(p.opt);
      if (hint) console.log(`\n${hint}`);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
