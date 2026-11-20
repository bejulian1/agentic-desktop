// scripts/install-local.ts, only against a temporary HOME (docs/agent-regler-produksjon.md).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PACKAGED, ROOT } from "./helpers.ts";

const SCRIPT = path.join(ROOT, "scripts/install-local.ts");

function run(home: string, args: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH!, HOME: home, XDG_DATA_HOME: path.join(home, ".local/share"), XDG_CONFIG_HOME: path.join(home, ".config") },
    encoding: "utf8",
  });
}

test("install-local legger inn appen, .desktop-filen og ikonene, og --uninstall fjerner alt", () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-install-test-")));
  // A HOME with a space in its name, like the project folder: the Exec line must quote it.
  const home = path.join(dir, "home med mellomrom");
  try {
    mkdirSync(home, { recursive: true });
    // The packaged app when it is there; otherwise a stand-in folder with the same layout.
    let from = path.dirname(PACKAGED);
    if (!existsSync(PACKAGED)) {
      from = path.join(dir, "linux-unpacked");
      mkdirSync(path.join(from, "resources"), { recursive: true });
      writeFileSync(path.join(from, "agentic-desktop"), "#!/bin/sh\n");
      writeFileSync(path.join(from, "resources/app.asar"), "");
    }
    // The user's data and config must survive both steps.
    const data = path.join(home, ".local/share/agentic-desktop");
    const config = path.join(home, ".config/agentic-desktop");
    mkdirSync(data, { recursive: true });
    mkdirSync(config, { recursive: true });
    writeFileSync(path.join(data, "agentic-desktop.db"), "tråder");
    writeFileSync(path.join(config, "AGENTS.md"), "mine regler");

    const out = run(home, ["--from", from]);
    assert.match(out, /er installert/);
    const opt = path.join(home, ".local/opt/agentic-desktop");
    assert.ok(statSync(path.join(opt, "agentic-desktop")).mode & 0o100, "startskriptet kan kjøres");
    assert.ok(existsSync(path.join(opt, ".agentic-desktop-install")));
    const desktopFile = path.join(home, ".local/share/applications/io.github.AgenticDesktop.desktop");
    const entry = readFileSync(desktopFile, "utf8");
    assert.match(entry, /^Name=Agentic Desktop$/m);
    assert.match(entry, /^Categories=Development;$/m);
    assert.match(entry, /^StartupWMClass=io\.github\.AgenticDesktop$/m);
    assert.match(entry, /^Icon=io\.github\.AgenticDesktop$/m);
    // SPEC 29.2: the start script, which chooses Chromium's sandbox at every start, has the name
    // everything starts (also the Exec line of bygg 28, which GNOME Shell may still hold), Electron
    // is agentic-desktop-bin, and agentic-desktop-start (bygg 29) is a link to the script.
    assert.ok(entry.includes(`Exec="${opt}/agentic-desktop" --ozone-platform-hint=auto %U`), entry);
    assert.ok(entry.split("\n").includes(`TryExec=${opt}/agentic-desktop`), entry);
    const script = readFileSync(path.join(opt, "agentic-desktop"), "utf8");
    assert.match(script, /^#!\/bin\/sh\n/);
    assert.match(script, /app="\$here\/agentic-desktop-bin"/, "startskriptet starter Electron ved siden av seg");
    assert.ok(statSync(path.join(opt, "agentic-desktop-bin")).mode & 0o100, "Electron kan kjøres");
    assert.equal(readlinkSync(path.join(opt, "agentic-desktop-start")), "agentic-desktop", "den gamle stien peker på startskriptet");
    assert.ok(existsSync(path.join(opt, "resources/apparmor/agentic-desktop")), "AppArmor-profilen ligger i installasjonen");
    const validate = (() => {
      try {
        return execFileSync("desktop-file-validate", [desktopFile], { encoding: "utf8" });
      } catch (err) {
        return (err as { code?: string; stdout?: string }).code === "ENOENT" ? "" : String((err as { stdout?: string }).stdout);
      }
    })();
    assert.equal(validate.trim(), "", "desktop-file-validate har ingen merknader");
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
      assert.ok(existsSync(path.join(home, `.local/share/icons/hicolor/${size}x${size}/apps/io.github.AgenticDesktop.png`)), `ikon ${size}`);
    }
    assert.ok(existsSync(path.join(home, ".local/share/icons/hicolor/scalable/apps/io.github.AgenticDesktop.svg")));
    assert.ok(existsSync(path.join(home, ".local/share/icons/hicolor/symbolic/apps/io.github.AgenticDesktop-symbolic.svg")));

    // A second install replaces the first.
    run(home, ["--from", from]);
    assert.ok(existsSync(path.join(opt, "agentic-desktop")));

    const removed = run(home, ["--uninstall"]);
    assert.match(removed, /Fjernet Agentic Desktop/);
    assert.ok(!existsSync(opt));
    assert.ok(!existsSync(desktopFile));
    assert.ok(!existsSync(path.join(home, ".local/share/icons/hicolor/48x48")), "tomme ikonmapper er borte");
    assert.equal(readFileSync(path.join(data, "agentic-desktop.db"), "utf8"), "tråder", "dataene er urørt");
    assert.equal(readFileSync(path.join(config, "AGENTS.md"), "utf8"), "mine regler", "konfigen er urørt");
    assert.match(run(home, ["--uninstall"]), /var ikke installert/);

    // A folder the script did not make is never removed.
    mkdirSync(opt, { recursive: true });
    writeFileSync(path.join(opt, "noe-annet"), "x");
    assert.throws(() => run(home, ["--from", from]));
    assert.ok(existsSync(path.join(opt, "noe-annet")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
