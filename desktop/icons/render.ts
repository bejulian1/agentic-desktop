// Draws the app icons' PNG files from the SVG sources, and the sheet with the choices
// (docs/screenshots/electron/ikoner.png). Run with `node desktop/icons/render.ts` after changing an
// SVG; the files are kept with the sources, so a normal build needs no browser for this.
// Headless Chrome draws them, with a temporary profile, so nothing shows on the screen.
//
// Round 14 (SPEC 30.2): every icon in variants.ts gets a folder png/<id>/ with app-<size>.png, the
// status area's tray-*.png, app.svg and symbolic.svg (what the app copies into ~/.local/share/icons
// when it is installed with install-local). The default («boble») is also at the top of png/, for
// the package. The browser tab's icons go to web/public/app-icons/, and the default to favicon.svg.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { APP_ICONS, DEFAULT_APP_ICON, type AppIconId } from "../../shared/protocol.ts";
import { ICON_SOURCES } from "./variants.ts";

const ICONS = import.meta.dirname;
const ROOT = path.resolve(ICONS, "../..");
const OUT = path.join(ICONS, "png");
const WEB = path.join(ROOT, "web/public");
const SHEET = path.join(ROOT, "docs/screenshots/electron/ikoner.png");

export const APP_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

const svg = (name: string) => readFileSync(path.join(ICONS, name), "utf8");
const dataUrl = (text: string) => `data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}`;

async function draw(page: Page, source: string, size: number, file: string): Promise<void> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${dataUrl(source)}">`);
  await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// The status area icon: white like GNOME's own icons on the dark top bar, and a dark copy for a light
// one. A dot in the corner says that something works (the accent) or waits for you (amber), with a
// ring cut out around it so it reads apart from the letter.
function trayIcon(color: string, dot: string | null, source = "agentic-desktop-symbolic.svg"): string {
  const base = svg(source).replace(/fill="#2e3436"/g, `fill="${color}"`).replace(/stroke="#2e3436"/g, `stroke="${color}"`);
  if (!dot) return base;
  return base
    .replace("<g id=\"mark\"", '<mask id="cut"><rect width="16" height="16" fill="#fff"/><circle cx="12.5" cy="12.5" r="4" fill="#000"/></mask><g id="mark" mask="url(#cut)"')
    .replace("</svg>", `<circle cx="12.5" cy="12.5" r="2.75" fill="${dot}"/></svg>`);
}

async function sheet(page: Page): Promise<void> {
  const sizes = [16, 24, 32, 48, 64, 128];
  const at = (id: AppIconId, size: number) => svg(size <= 24 ? ICON_SOURCES[id].small : ICON_SOURCES[id].large);
  const row = (id: AppIconId, bg: string) => `
    <div class="row" style="background:${bg}">
      ${sizes.map((s) => `<img src="${dataUrl(at(id, s))}" width="${s}" height="${s}">`).join("")}
    </div>`;
  const tray = (id: AppIconId, color: string, bg: string) => `
    <div class="row tray" style="background:${bg}">
      ${[null, "#5b95f5", "#f5b83d"].map((dot) => `<img src="${dataUrl(trayIcon(color, dot, ICON_SOURCES[id].symbolic))}" width="16" height="16"><img src="${dataUrl(trayIcon(color, dot, ICON_SOURCES[id].symbolic))}" width="32" height="32">`).join('<span class="gap"></span>')}
    </div>`;
  await page.setViewportSize({ width: 1180, height: 400 });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; padding: 32px; font: 14px/1.4 system-ui, sans-serif; color: #1b1b1a; background: #f4f4f2; }
    h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; } p.lead { margin: 0 0 24px; color: #555; }
    .grid { display: grid; grid-template-columns: 220px 1fr 1fr; gap: 12px 16px; align-items: center; }
    .label strong { display: block; font-size: 15px; } .label span { color: #555; font-size: 13px; }
    .chosen strong::after { content: "Standard"; margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: #2f6fe4; color: #fff; font-size: 11px; vertical-align: 2px; }
    .row { display: flex; align-items: center; gap: 18px; padding: 14px 18px; border-radius: 12px; min-height: 128px; }
    .row.tray { min-height: 0; gap: 10px; } .gap { width: 22px; }
    .head { color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  </style></head><body>
    <h1>App-ikoner for Agentic Desktop</h1>
    <p class="lead">Valgene i Innstillinger → Utseende, i 16, 24, 32, 48, 64 og 128 px på lys og mørk bakgrunn, og under hvert ikonet i statusfeltet: uten prikk, når noe jobber, og når noe venter på deg.</p>
    <div class="grid">
      <div></div><div class="head">Lys bakgrunn</div><div class="head">Mørk bakgrunn</div>
      ${APP_ICONS.map((icon) => `
        <div class="label${icon.id === DEFAULT_APP_ICON ? " chosen" : ""}"><strong>${icon.name}</strong><span>${icon.note}</span></div>${row(icon.id, "#ffffff")}${row(icon.id, "#1b1b1b")}
        <div class="label"><span>Statusfeltet</span></div>${tray(icon.id, "#1b1b1a", "#ffffff")}${tray(icon.id, "#ffffff", "#1b1b1b")}`).join("")}
    </div>
  </body></html>`);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1180, height });
  mkdirSync(path.dirname(SHEET), { recursive: true });
  await page.screenshot({ path: SHEET, fullPage: true });
}

// One icon's files: the app icon in every size, the status area's icons, and the SVG files the
// installed app copies into the icon theme.
async function drawIcon(page: Page, id: AppIconId, dir: string): Promise<void> {
  const sources = ICON_SOURCES[id];
  mkdirSync(dir, { recursive: true });
  for (const size of APP_SIZES) {
    // 16 and 24 px have their own drawing with thicker lines on whole pixels.
    await draw(page, svg(size <= 24 ? sources.small : sources.large), size, path.join(dir, `app-${size}.png`));
  }
  for (const [look, dot] of [["idle", null], ["working", "#5b95f5"], ["waiting", "#f5b83d"]] as const) {
    await draw(page, trayIcon("#ffffff", dot, sources.symbolic), 24, path.join(dir, `tray-${look}.png`));
    await draw(page, trayIcon("#ffffff", dot, sources.symbolic), 48, path.join(dir, `tray-${look}@2x.png`));
    await draw(page, trayIcon("#1b1b1a", dot, sources.symbolic), 24, path.join(dir, `tray-${look}-dark.png`));
    await draw(page, trayIcon("#1b1b1a", dot, sources.symbolic), 48, path.join(dir, `tray-${look}-dark@2x.png`));
  }
  cpSync(path.join(ICONS, sources.large), path.join(dir, "app.svg"));
  cpSync(path.join(ICONS, sources.symbolic), path.join(dir, "symbolic.svg"));
}

if (import.meta.main) {
  const profile = mkdtempSync(path.join(tmpdir(), "ad-icons-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: [`--user-data-dir=${profile}`] }).catch(() => chromium.launch({ channel: "chrome", headless: true }));
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    mkdirSync(OUT, { recursive: true });
    for (const icon of APP_ICONS) await drawIcon(page, icon.id, path.join(OUT, icon.id));
    // The default once more at the top of png/, for the package and for install-local.ts.
    await drawIcon(page, DEFAULT_APP_ICON, OUT);
    rmSync(path.join(OUT, "app.svg"));
    rmSync(path.join(OUT, "symbolic.svg"));
    // The browser tab (localhost): the small drawing, and the large one for the choice in Utseende.
    mkdirSync(path.join(WEB, "app-icons"), { recursive: true });
    for (const icon of APP_ICONS) {
      writeFileSync(path.join(WEB, "app-icons", `${icon.id}.svg`), svg(ICON_SOURCES[icon.id].large));
      writeFileSync(path.join(WEB, "app-icons", `${icon.id}-tab.svg`), svg(ICON_SOURCES[icon.id].small));
    }
    writeFileSync(path.join(WEB, "favicon.svg"), svg(ICON_SOURCES[DEFAULT_APP_ICON].small));
    await sheet(page);
    console.log(`Tegnet ${APP_ICONS.length} ikoner i ${APP_SIZES.length} størrelser, statusfelt-ikonene, ikonene til nettleserfanen og ${path.relative(ROOT, SHEET)}.`);
  } finally {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
