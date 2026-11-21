import { plural, t } from "./i18n.ts";
// The icon in the status area at the top of GNOME (SPEC 29.6). Electron's Tray is a
// StatusNotifierItem on Linux, which GNOME shows through the AppIndicator extension. Without a
// StatusNotifierWatcher on the session bus nobody would show it, so the app then quits on the close
// button as usual and is never left running without an icon.
import { execFile } from "node:child_process";
import path from "node:path";
import { Menu, nativeImage, Tray, type NativeImage } from "electron";

export interface Activity {
  working: number; // threads with a run going on
  waiting: number; // threads waiting for the user to approve something
}

export interface StatusAreaActions {
  show: () => void;
  newThread: () => void;
  quit: () => void;
}

const WATCHER = "org.kde.StatusNotifierWatcher";

// AD_DESKTOP_TRAY=on|off overrides the check. Only the tests set it: under xvfb there is no status
// area, and they must not reach the real session bus either.
function override(): boolean | null {
  const value = process.env.AD_DESKTOP_TRAY;
  return value === "on" ? true : value === "off" ? false : null;
}

export function hasStatusArea(): Promise<boolean> {
  const forced = override();
  if (forced !== null) return Promise.resolve(forced);
  return new Promise((resolve) => {
    execFile(
      "gdbus",
      ["call", "--session", "--timeout", "2", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", WATCHER],
      { timeout: 3000 },
      (err, stdout) => resolve(!err && /\(true,?\)/.test(String(stdout))),
    );
  });
}

export function activityText(activity: Activity): string | null {
  const parts: string[] = [];
  if (activity.working > 0) parts.push(plural(activity.working, "{count} tråd jobber", "{count} tråder jobber"));
  if (activity.waiting > 0) parts.push(plural(activity.waiting, "{count} tråd venter på deg", "{count} tråder venter på deg"));
  return parts.length ? parts.join(" · ") : null;
}

type Look = "idle" | "working" | "waiting";

export class StatusArea {
  private tray: Tray | null = null;
  private images = new Map<Look, NativeImage>();
  private activity: Activity = { working: 0, waiting: 0 };
  private look: Look | null = null;
  available = false;

  private iconDir: string;
  private actions: StatusAreaActions;

  constructor(iconDir: string, actions: StatusAreaActions) {
    this.iconDir = iconDir;
    this.actions = actions;
  }

  // Round 14 (SPEC 30.2): another app icon. The images are read again, and the icon shown changes
  // at once.
  setIconDir(dir: string): void {
    if (dir === this.iconDir) return;
    this.iconDir = dir;
    this.images.clear();
    if (!this.tray) return;
    this.look = null;
    this.render();
  }

  get iconFolder(): string {
    return this.iconDir;
  }

  private image(look: Look): NativeImage {
    let image = this.images.get(look);
    if (!image) {
      // tray-idle.png and tray-idle@2x.png: Electron picks the sharper one for the scale.
      image = nativeImage.createFromPath(path.join(this.iconDir, `tray-${look}.png`));
      this.images.set(look, image);
    }
    return image;
  }

  // Checks for a status area and shows the icon when there is one. Called at start and each time the
  // window comes forward, so an extension switched on later is found.
  async refresh(): Promise<boolean> {
    this.available = await hasStatusArea();
    if (this.available && !this.tray) this.create();
    if (!this.available && this.tray) this.destroy();
    return this.available;
  }

  private create(): void {
    this.tray = new Tray(this.image("idle"));
    this.tray.on("click", () => this.actions.show());
    this.look = null;
    this.render();
  }

  setActivity(activity: Activity): void {
    this.activity = { working: Math.max(0, activity.working | 0), waiting: Math.max(0, activity.waiting | 0) };
    this.render();
  }

  get state(): { available: boolean; shown: boolean; look: Look | null; status: string | null; menu: string[] } {
    return { available: this.available, shown: !!this.tray, look: this.look, status: activityText(this.activity), menu: this.menuLabels() };
  }

  private menuLabels(): string[] {
    const status = activityText(this.activity);
    return [t("Vis Agentic Desktop"), t("Ny tråd"), ...(status ? [status] : []), t("Avslutt")];
  }

  render(): void {
    if (!this.tray) return;
    // Waiting for you comes before working: it is the one that needs you.
    const look: Look = this.activity.waiting > 0 ? "waiting" : this.activity.working > 0 ? "working" : "idle";
    if (look !== this.look) {
      this.tray.setImage(this.image(look));
      this.look = look;
    }
    const status = activityText(this.activity);
    this.tray.setToolTip(status ? t("Agentic Desktop: {status}", { status }) : "Agentic Desktop");
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: t("Vis Agentic Desktop"), click: () => this.actions.show() },
      { label: t("Ny tråd"), click: () => this.actions.newThread() },
    ];
    if (status) template.push({ type: "separator" }, { label: status, enabled: false });
    template.push({ type: "separator" }, { label: t("Avslutt"), click: () => this.actions.quit() });
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
    this.look = null;
  }
}
