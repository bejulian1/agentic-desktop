// Round 14 (SPEC 30.2): the app icon chosen in Innstillinger → Utseende. The window and the status
// area take it at once; the app library's icon follows only when the app is installed with
// install-local, and only in a temporary HOME here (docs/agent-regler-produksjon.md).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { iconPlaces, installIcon, INSTALL_MARKER } from "../app-icon.ts";
import { closeAll, launch, ROOT, sandbox, waitFor, type Running, type Sandbox } from "./helpers.ts";

const PNG = path.join(ROOT, "desktop/icons/png");
const state = (box: Sandbox) => JSON.parse(readFileSync(path.join(box.dataDir, "electron/desktop-state.json"), "utf8"));
const iconEnv = (box: Sandbox) => ({ HOME: box.home, XDG_DATA_HOME: path.join(box.home, ".local/share") });

// Every file in the icon theme is the one from that icon's folder.
function launcherIs(box: Sandbox, id: string): boolean {
  return iconPlaces(iconEnv(box)).files.every(({ file, source }) => existsSync(file) && readFileSync(file).equals(readFileSync(path.join(PNG, id, source))));
}

async function chooseIcon(running: Running, name: string): Promise<void> {
  const { page } = running;
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByText("Utseende", { exact: true }).click();
  await page.getByTestId("app-icon-cards").getByRole("radio", { name, exact: true }).click();
}

test("hvert ikon har alle filene, og installIcon bytter bare det som er ulikt", () => {
  const box = sandbox();
  try {
    for (const id of ["boble", "boble-lys", "monogram", "terminal"]) {
      for (const { source } of iconPlaces({ HOME: "/x" }).files) assert.ok(existsSync(path.join(PNG, id, source)), `${id}/${source}`);
      for (const look of ["idle", "working", "waiting"]) assert.ok(existsSync(path.join(PNG, id, `tray-${look}@2x.png`)), `${id} ${look}`);
    }
    // The package's own icon is the default.
    assert.ok(readFileSync(path.join(PNG, "app-512.png")).equals(readFileSync(path.join(PNG, "boble/app-512.png"))));

    const written = installIcon(path.join(PNG, "terminal"), iconEnv(box));
    assert.equal(written.length, 10, "8 størrelser, det skalerbare og det symbolske ikonet");
    assert.ok(launcherIs(box, "terminal"));
    assert.deepEqual(installIcon(path.join(PNG, "terminal"), iconEnv(box)), [], "ingenting skrives når det er likt");
    // Only the files that differ (the light bubble shares its symbolic icon with the bubble).
    installIcon(path.join(PNG, "boble"), iconEnv(box));
    assert.equal(installIcon(path.join(PNG, "boble-lys"), iconEnv(box)).length, 9);
    // Never outside the temporary HOME.
    for (const { file } of iconPlaces(iconEnv(box)).files) assert.ok(file.startsWith(box.home), file);
  } finally {
    box.cleanup();
  }
});

test("valget bytter vinduets og statusfeltets ikon med en gang, og huskes til neste start", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    const { page, probe } = running;
    assert.equal((await probe<{ id: string }>("probe.appIcon()")).id, "boble");
    assert.deepEqual(await page.evaluate(() => (window as any).agenticDesktop.appIcon()), { value: "boble", launcher: "not-installed" });
    await chooseIcon(running, "Terminal");
    await waitFor(async () => (await probe<{ id: string }>("probe.appIcon()")).id === "terminal", "appen har valget");
    const icon = await probe<{ windowIcon: string; trayDir: string; installed: boolean; launcherWrites: number }>("probe.appIcon()");
    assert.match(icon.windowIcon, /shell\/icons\/terminal\/app-512\.png$/);
    assert.match(icon.trayDir, /shell\/icons\/terminal$/);
    assert.equal(icon.installed, false);
    assert.equal(icon.launcherWrites, 0, "ikke installert: appbiblioteket røres ikke");
    assert.equal(existsSync(path.join(box.home, ".local/share/icons")), false);
    await page.getByTestId("app-icon-scope").getByText("Ikonet i appbiblioteket følger med når appen er installert med install-local.").waitFor();
    assert.equal(state(box).appIcon, "terminal");
    // The tab's icon in the window follows too.
    assert.equal(await page.locator('link[rel="icon"]').getAttribute("href"), "/app-icons/terminal-tab.svg");
    await closeAll(running);

    // Next start: the window has the icon from the start.
    running = await launch(box);
    assert.match((await running.probe<{ windowIcon: string }>("probe.appIcon()")).windowIcon, /terminal\/app-512\.png$/);
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});

test("installert med install-local: ikonet i appbiblioteket følger valget, bare i den midlertidige HOME", async () => {
  const box = sandbox();
  // A stand-in for ~/.local/opt/agentic-desktop with install-local's marker. Only the app started
  // from the project reads AD_DESKTOP_INSTALL_DIR; the package looks next to itself.
  const opt = path.join(box.home, ".local/opt/agentic-desktop");
  mkdirSync(opt, { recursive: true });
  writeFileSync(path.join(opt, INSTALL_MARKER), "test\n");
  box.env.AD_DESKTOP_INSTALL_DIR = opt;
  let running: Running | undefined;
  try {
    // An installation from before has the monogram in the app library.
    installIcon(path.join(PNG, "monogram"), iconEnv(box));
    running = await launch(box);
    const { page, probe } = running;
    // At start the app puts the chosen icon (the default) back.
    await waitFor(() => launcherIs(box, "boble"), "standardikonet er lagt inn ved start");
    assert.deepEqual(await page.evaluate(() => (window as any).agenticDesktop.appIcon()), { value: "boble", launcher: "same" });
    await chooseIcon(running, "Snakkeboble, lys");
    await waitFor(() => launcherIs(box, "boble-lys"), "appbiblioteket har det lyse ikonet");
    await page.getByTestId("app-icon-scope").getByText("Gjelder vinduet, statusfeltet og ikonet i appbiblioteket.").waitFor();
    assert.equal((await probe<{ installed: boolean }>("probe.appIcon()")).installed, true);
    // Nothing else in the icon theme or HOME is written.
    const theme = path.join(box.home, ".local/share/icons/hicolor");
    const files = execFileSync("find", [theme, "-type", "f"], { encoding: "utf8" }).trim().split("\n").sort();
    assert.deepEqual(files, iconPlaces(iconEnv(box)).files.map((f) => f.file).sort());
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
