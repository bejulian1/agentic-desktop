// What the Electron app remembers between starts, in desktop-state.json in its own folder: the size
// of the window, the port the server had last time, what the close button does, and whether the
// note about the status area has been shown.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_APP_ICON, isAppIcon, type AppIconId } from "../shared/protocol.ts";

export type CloseBehavior = "tray" | "quit";

export interface Bounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface DesktopState {
  bounds: Bounds;
  maximized: boolean;
  // The UI keeps its look and layout in localStorage, which belongs to the page's origin. The server
  // gets a random port the first time and tries the same one later, so the origin, and with it the
  // layout, stays the same. If the port is taken, it gets a new random one.
  port: number | null;
  closeBehavior: CloseBehavior;
  trayNoticeShown: boolean;
  // Round 14 (SPEC 30.2): the icon chosen in Innstillinger → Utseende, so the window and the status
  // area have it from the start, before the UI has loaded.
  appIcon: AppIconId;
}

export const DEFAULT_STATE: DesktopState = {
  bounds: { width: 1280, height: 820 },
  maximized: false,
  port: null,
  closeBehavior: "tray",
  trayNoticeShown: false,
  appIcon: DEFAULT_APP_ICON,
};

const num = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : undefined;

export class StateFile {
  readonly file: string;
  private state: DesktopState;
  private timer: NodeJS.Timeout | undefined;

  constructor(dir: string) {
    this.file = path.join(dir, "desktop-state.json");
    this.state = this.read();
  }

  private read(): DesktopState {
    let raw: Record<string, any> = {};
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
    const bounds: Bounds = {
      width: num(raw.bounds?.width, 640, 10000) ?? DEFAULT_STATE.bounds.width,
      height: num(raw.bounds?.height, 420, 10000) ?? DEFAULT_STATE.bounds.height,
    };
    const x = num(raw.bounds?.x, -10000, 10000);
    const y = num(raw.bounds?.y, -10000, 10000);
    if (x !== undefined && y !== undefined) Object.assign(bounds, { x, y });
    const port = num(raw.port, 1024, 65535);
    return {
      bounds,
      maximized: raw.maximized === true,
      port: port ?? null,
      closeBehavior: raw.closeBehavior === "quit" ? "quit" : "tray",
      trayNoticeShown: raw.trayNoticeShown === true,
      appIcon: isAppIcon(raw.appIcon) ? raw.appIcon : DEFAULT_APP_ICON,
    };
  }

  get(): Readonly<DesktopState> {
    return this.state;
  }

  set(patch: Partial<DesktopState>, now = false): void {
    this.state = { ...this.state, ...patch };
    clearTimeout(this.timer);
    if (now) this.flush();
    else this.timer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    clearTimeout(this.timer);
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, this.file);
    } catch (err) {
      console.error("Kunne ikke lagre vindustilstanden:", (err as Error).message);
    }
  }
}
