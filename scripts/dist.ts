// npm run dist: Agentic Desktop as a Linux app in dist-desktop/ (SPEC 29.2):
//   linux-unpacked/   the app as a folder, which scripts/install-local.ts installs
//   *.deb             for apt, with the AppArmor profile electron-builder writes
//   *.AppImage        a single file to share (needs FUSE 2 to run)
// It builds the web UI, the server and the shell into a temporary folder, and packs only what runs:
//   app.asar                 main.mjs, preload.cjs and the app's own pages and icons
//   resources/app-root/      version.json, docs/PATCHLOG.md, web/dist and server/ with the four
//                            packages the server loads (node-pty built for Electron, playwright-core,
//                            ws and ignore). Outside the asar, because the server runs as its own
//                            process and node-pty is a native module.
// version.json and web/dist are only read; the build number is the coordinator's (npm run build).
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDesktop } from "./build-desktop.ts";
import { memAvailableMb, waitForMemory } from "./test-desktop.ts";
import { copySystemInstructions } from "./system-instructions.ts";
import { copyAppSkills } from "./skill-assets.ts";

// Hardening: the package cannot be run as plain Node, and NODE_OPTIONS and --inspect are ignored.
// The server runs as a utilityProcess and needs none of them.
const FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  onlyLoadAppFromAsar: true,
  enableCookieEncryption: false,
  grantFileProtocolExtraPrivileges: false,
  enableEmbeddedAsarIntegrityValidation: false,
};

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "dist-desktop");
const APP_ID = "io.github.AgenticDesktop";
const ELECTRON_VERSION = JSON.parse(readFileSync(path.join(ROOT, "node_modules/electron/package.json"), "utf8")).version as string;

// npm 11 runs no install scripts unless package.json allows them, and the electron package gets its
// binary from its own install.js, so a fresh clone (git clone + npm ci) has no node_modules/electron/
// dist yet. Fetch it here, once (from Electron's cache when it is there).
function ensureElectronBinary(): void {
  if (existsSync(path.join(ROOT, "node_modules/electron/dist/electron"))) return;
  console.log(`Henter Electron ${ELECTRON_VERSION}…`);
  const fetched = spawnSync(process.execPath, [path.join(ROOT, "node_modules/electron/install.js")], { cwd: path.join(ROOT, "node_modules/electron"), stdio: "inherit" });
  if (fetched.status !== 0 || !existsSync(path.join(ROOT, "node_modules/electron/dist/electron"))) throw new Error("Kunne ikke hente Electron. Sjekk nettet og prøv npm run dist igjen.");
}
const SERVER_PACKAGES = ["node-pty", "playwright-core", "ws", "ignore"];

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${path.basename(command)} feilet (kode ${result.status})`);
}

function sizeOf(target: string): number {
  const info = statSync(target);
  if (!info.isDirectory()) return info.size;
  return readdirSync(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Only what node-pty needs at run time: its JavaScript and the built module.
function prunePty(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (!["package.json", "LICENSE", "lib", "build"].includes(name)) rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  const release = path.join(dir, "build/Release");
  for (const name of readdirSync(path.join(dir, "build"))) if (name !== "Release") rmSync(path.join(dir, "build", name), { recursive: true, force: true });
  for (const name of readdirSync(release)) if (!name.endsWith(".node") && name !== "spawn-helper") rmSync(path.join(release, name), { recursive: true, force: true });
  const lib = path.join(dir, "lib");
  for (const name of readdirSync(lib, { recursive: true }) as string[]) {
    if (/\.test\.js$|\.map$|windows|conpty|winpty/i.test(name)) rmSync(path.join(lib, name), { recursive: true, force: true });
  }
}

// Type definitions, maps and read-mes are not needed to run.
function pruneTypes(dir: string): void {
  for (const name of readdirSync(dir, { recursive: true }) as string[]) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    if (/\.d\.ts$|\.map$|(^|\/)README\.md$|(^|\/)CHANGELOG\.md$/i.test(name) && statSync(file).isFile()) rmSync(file);
  }
  rmSync(path.join(dir, "types"), { recursive: true, force: true });
}

export async function dist(): Promise<void> {
  console.log(`MemAvailable før pakkingen: ${await waitForMemory("pakkingen")} MB`);
  ensureElectronBinary();
  const version = JSON.parse(readFileSync(path.join(ROOT, "version.json"), "utf8")) as { version: string; build: number };
  const stage = mkdtempSync(path.join(tmpdir(), "ad-dist-"));
  try {
    const app = path.join(stage, "app");
    const appRoot = path.join(stage, "app-root");
    const serverDir = path.join(appRoot, "server");

    // 1. The shell and the server, as JavaScript.
    const built = await buildDesktop(path.join(stage, "built"));
    mkdirSync(app, { recursive: true });
    cpSync(path.join(built, "main.mjs"), path.join(app, "main.mjs"));
    cpSync(path.join(built, "preload.cjs"), path.join(app, "preload.cjs"));
    cpSync(path.join(built, "shell"), path.join(app, "shell"), { recursive: true });
    mkdirSync(serverDir, { recursive: true });
    cpSync(path.join(built, "server/server.mjs"), path.join(serverDir, "server.mjs"));
    writeFileSync(
      path.join(app, "package.json"),
      `${JSON.stringify(
        {
          name: "agentic-desktop",
          productName: "Agentic Desktop",
          version: version.version,
          description: "Kodeapp for API-modeller",
          main: "main.mjs",
          desktopName: `${APP_ID}.desktop`,
          author: { name: "Agentic Desktop" },
          // The .deb needs a homepage. The app has none yet; .invalid is reserved for exactly that
          // (RFC 2606), so it can never point anywhere by mistake.
          homepage: "https://agentic-desktop.invalid/",
          license: "UNLICENSED",
          private: true,
        },
        null,
        2,
      )}\n`,
    );

    // 2. The web UI, into the package and never into web/dist.
    console.log("Bygger grensesnittet ...");
    run(path.join(ROOT, "node_modules/.bin/vite"), ["build", "--outDir", path.join(appRoot, "web/dist"), "--emptyOutDir", "--logLevel", "warn"], path.join(ROOT, "web"));
    writeFileSync(path.join(appRoot, "web/dist/build-info.json"), `${JSON.stringify({ ...version, builtAt: new Date().toISOString() }, null, 2)}\n`);
    cpSync(path.join(ROOT, "version.json"), path.join(appRoot, "version.json"));
    mkdirSync(path.join(appRoot, "docs"), { recursive: true });
    cpSync(path.join(ROOT, "docs/PATCHLOG.md"), path.join(appRoot, "docs/PATCHLOG.md"));
    copySystemInstructions(ROOT, appRoot);
    copyAppSkills(ROOT, appRoot);

    // 3. The server's packages. node-pty is built for Electron's ABI with @electron/rebuild.
    const modules = path.join(serverDir, "node_modules");
    mkdirSync(modules, { recursive: true });
    const deps: Record<string, string> = {};
    for (const name of SERVER_PACKAGES) {
      cpSync(path.join(ROOT, "node_modules", name), path.join(modules, name), { recursive: true, dereference: true });
      deps[name] = JSON.parse(readFileSync(path.join(modules, name, "package.json"), "utf8")).version;
    }
    cpSync(path.join(ROOT, "node_modules/node-addon-api"), path.join(modules, "node-addon-api"), { recursive: true }); // only to build
    writeFileSync(path.join(serverDir, "package.json"), `${JSON.stringify({ name: "agentic-desktop-server", private: true, type: "module", dependencies: deps }, null, 2)}\n`);
    rmSync(path.join(modules, "node-pty/build"), { recursive: true, force: true });
    console.log(`Bygger node-pty for Electron ${ELECTRON_VERSION} ...`);
    run(path.join(ROOT, "node_modules/.bin/electron-rebuild"), ["--version", ELECTRON_VERSION, "--module-dir", serverDir, "--only", "node-pty", "--force"], ROOT);
    rmSync(path.join(modules, "node-addon-api"), { recursive: true, force: true });
    prunePty(path.join(modules, "node-pty"));
    for (const name of ["playwright-core", "ws", "ignore"]) pruneTypes(path.join(modules, name));

    // 4. Icons for the package, by size.
    const icons = path.join(stage, "build-resources/icons");
    mkdirSync(icons, { recursive: true });
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) cpSync(path.join(ROOT, `desktop/icons/png/app-${size}.png`), path.join(icons, `${size}x${size}.png`));

    // 5. electron-builder.
    rmSync(OUT, { recursive: true, force: true });
    console.log(`MemAvailable før electron-builder: ${await waitForMemory("electron-builder")} MB`);
    const { build, Platform } = await import("electron-builder");
    await build({
      targets: Platform.LINUX.createTarget(["dir", "deb", "AppImage"]),
      projectDir: app,
      publish: "never",
      config: {
        appId: APP_ID,
        productName: "Agentic Desktop",
        executableName: "agentic-desktop",
        copyright: "Agentic Desktop",
        directories: { app, output: OUT, buildResources: path.join(stage, "build-resources") },
        electronVersion: ELECTRON_VERSION,
        electronDist: path.join(ROOT, "node_modules/electron/dist"),
        afterPack: async (context) => {
          // Electron's own sample app comes with electronDist; it is not ours to ship.
          rmSync(path.join(context.appOutDir, "resources/default_app.asar"), { force: true });
          // SPEC 29.2: the start script, which chooses the sandbox, takes the executable's name and
          // Electron becomes agentic-desktop-bin, so everything that starts "agentic-desktop" (the
          // .desktop file, an Exec line GNOME Shell still holds from bygg 28, the .deb's /usr/bin
          // link, the AppImage) goes through it. agentic-desktop-start stays as a link, for bygg 29.
          // Then the AppArmor profile whose install command the app shows when the sandbox is off.
          const out = context.appOutDir;
          const { flipFuses, FuseVersion, FuseV1Options: F } = await import("@electron/fuses");
          await flipFuses(path.join(out, "agentic-desktop"), {
            version: FuseVersion.V1,
            [F.RunAsNode]: FUSES.runAsNode,
            [F.EnableNodeOptionsEnvironmentVariable]: FUSES.enableNodeOptionsEnvironmentVariable,
            [F.EnableNodeCliInspectArguments]: FUSES.enableNodeCliInspectArguments,
            [F.OnlyLoadAppFromAsar]: FUSES.onlyLoadAppFromAsar,
            [F.EnableCookieEncryption]: FUSES.enableCookieEncryption,
            [F.GrantFileProtocolExtraPrivileges]: FUSES.grantFileProtocolExtraPrivileges,
            [F.EnableEmbeddedAsarIntegrityValidation]: FUSES.enableEmbeddedAsarIntegrityValidation,
          });
          renameSync(path.join(out, "agentic-desktop"), path.join(out, "agentic-desktop-bin"));
          cpSync(path.join(ROOT, "desktop/launcher/agentic-desktop-start"), path.join(out, "agentic-desktop"));
          chmodSync(path.join(out, "agentic-desktop"), 0o755);
          symlinkSync("agentic-desktop", path.join(out, "agentic-desktop-start"));
          mkdirSync(path.join(context.appOutDir, "resources/apparmor"), { recursive: true });
          cpSync(path.join(ROOT, "desktop/apparmor/agentic-desktop"), path.join(context.appOutDir, "resources/apparmor/agentic-desktop"));
        },
        npmRebuild: false,
        nodeGypRebuild: false,
        asar: true,
        files: ["**/*"],
        extraResources: [{ from: appRoot, to: "app-root" }],
        electronLanguages: ["nb", "en-US"],
        // The fuses (FUSES) are flipped in afterPack: electron-builder's own step would flip them on
        // the file named executableName, which is the start script by then.
        linux: {
          category: "Development",
          icon: icons,
          executableArgs: ["--ozone-platform-hint=auto"],
          maintainer: "Agentic Desktop",
          synopsis: "Kodeapp for API-modeller",
          description: "Agentic Desktop er en kodeapp for API-modeller, med tråder, terminal, nettleser og prosjekter.",
          syncDesktopName: true,
          desktop: {
            entry: {
              Name: "Agentic Desktop",
              Comment: "Kodeapp for API-modeller",
              StartupWMClass: APP_ID,
              Keywords: "kode;agent;terminal;AI;",
            },
          },
        },
        deb: { packageCategory: "devel", compression: "xz" },
        appImage: { artifactName: "Agentic-Desktop-${version}-${arch}.AppImage" },
      },
    });

    const unpacked = path.join(OUT, "linux-unpacked");
    console.log("");
    console.log(`Ferdig i ${path.relative(ROOT, OUT)}/:`);
    console.log(`  linux-unpacked/  ${mb(sizeOf(unpacked))}  (app-root ${mb(sizeOf(path.join(unpacked, "resources/app-root")))}, app.asar ${mb(sizeOf(path.join(unpacked, "resources/app.asar")))})`);
    for (const name of readdirSync(OUT)) if (/\.(deb|AppImage)$/.test(name)) console.log(`  ${name}  ${mb(sizeOf(path.join(OUT, name)))}`);
    console.log(`MemAvailable etter pakkingen: ${memAvailableMb()} MB`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) await dist();
