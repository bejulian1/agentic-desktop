// Screenshots of the Electron window for docs/screenshots/electron/, under xvfb only:
//   node scripts/test-desktop.ts --screenshots
// (scripts/test-desktop.ts builds and starts this under xvfb-run with WAYLAND_DISPLAY removed.)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron } from "playwright-core";
import { apiCall, assertOffScreen, closeAll, ELECTRON, killKnown, MAIN, ROOT, sandbox, startLocalhost, type Running } from "./helpers.ts";

const OUT = path.join(ROOT, "docs/screenshots/electron");
mkdirSync(OUT, { recursive: true });
assertOffScreen();

async function start(box: ReturnType<typeof sandbox>, dark: boolean, waitForUi = true): Promise<Running> {
  const app = await _electron.launch({ executablePath: ELECTRON, args: ["--ozone-platform=x11", "--force-device-scale-factor=1", MAIN], env: box.env, timeout: 60_000 });
  await app.evaluate(({ nativeTheme }, dark) => {
    nativeTheme.themeSource = dark ? "dark" : "light";
  }, dark);
  const page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  if (waitForUi) await page.locator(".topbar .window-controls[data-shell]").waitFor({ timeout: 60_000 });
  return { app, page, mainPid: app.process().pid!, sandbox: box, probe: async () => undefined as any, windowState: async () => ({}) as any };
}

// What the window shows, taken by Electron itself, so hover and focus are kept as they are.
async function shoot(running: Running, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await running.page.waitForTimeout(450);
  const png = await running.app.evaluate(async ({ BrowserWindow }, clip) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(clip);
    return image.toPNG().toString("base64");
  }, clip);
  writeFileSync(path.join(OUT, name), Buffer.from(png, "base64"));
  console.log(`docs/screenshots/electron/${name}`);
}

for (const dark of [false, true]) {
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  try {
    running = await start(box, dark);
    const { page } = running;
    // A project, so the top bar shows the project, Playtest and the panel buttons.
    const projectDir = path.join(box.dir, "nettside");
    mkdirSync(projectDir, { recursive: true });
    await apiCall(page, "POST", "/api/projects", { name: "nettside", path: projectDir });
    const kode = page.locator(".sidebar .mode-button", { hasText: "Kode" });
    if ((await kode.count()) && (await kode.getAttribute("aria-pressed")) !== "true") await kode.click();
    await page.locator('.group[data-project="nettside"] .group-title').first().click();
    await page.waitForSelector(".project-label");
    await page.mouse.move(700, 500);
    const theme = dark ? "mork" : "lys";
    await shoot(running, `vindu-${theme}.png`);
    const width = await page.evaluate(() => innerWidth);
    await shoot(running, `toppfelt-${theme}.png`, { x: width - 560, y: 0, width: 560, height: 44 });
    await page.locator('[data-control="close"]').hover();
    await page.locator(".app-tooltip", { hasText: "Lukk" }).waitFor();
    await shoot(running, `vinduskontroller-lukk-${theme}.png`, { x: width - 300, y: 0, width: 300, height: 84 });
    await page.locator('[data-control="maximize"]').focus();
    await page.mouse.move(700, 500);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await shoot(running, `vinduskontroller-fokus-${theme}.png`, { x: width - 300, y: 0, width: 300, height: 84 });

    // The error page, after the server was stopped by its known PID.
    const serverPid = await running.app.evaluate(() => (globalThis as any).__agenticDesktop.serverPid as number);
    killKnown(serverPid, /--type=utility/);
    await page.getByTestId("error-page").waitFor({ timeout: 15_000 });
    await page.mouse.move(700, 600);
    await shoot(running, `feilside-${theme}.png`);
  } finally {
    await closeAll(running);
    box.cleanup();
  }
}

// The page for a data folder the localhost server uses.
{
  const box = sandbox({ tray: "on" });
  let running: Running | undefined;
  const localhost = await startLocalhost(box);
  try {
    running = await start(box, false, false);
    await running.page.getByTestId("busy-page").waitFor({ timeout: 20_000 });
    await shoot(running, "opptatt-lys.png");
  } finally {
    await closeAll(running);
    killKnown(localhost.child.pid!, /server\/src\/index\.ts/, "SIGTERM");
    box.cleanup();
  }
}
