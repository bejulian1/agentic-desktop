// The only bridge between the page and the Electron app. It runs sandboxed, with context isolation,
// and gives the page a few named calls and nothing else: no ipcRenderer, no Node. main.ts checks
// on its side that a message comes from the main frame of the app's own window.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type WindowState = { maximized: boolean; fullscreen: boolean };
type CloseBehavior = "tray" | "quit";

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("agenticDesktop", {
  shell: "electron",
  setLanguage: (setting: string): Promise<string | null> => ipcRenderer.invoke("desktop:language", setting),
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    state: (): Promise<WindowState | null> => ipcRenderer.invoke("window:state"),
    onState: (callback: (state: WindowState) => void) => subscribe("window:state", callback),
  },
  closeBehavior: (value?: CloseBehavior): Promise<{ value: CloseBehavior; statusArea: boolean } | null> =>
    ipcRenderer.invoke("desktop:close-behavior", value === "tray" || value === "quit" ? value : undefined),
  // SPEC 29.2: whether Chromium's sandbox is on, and if not why, for Innstillinger -> Om.
  sandbox: (): Promise<{ on: boolean; reason: string | null; command: string | null } | null> => ipcRenderer.invoke("desktop:sandbox"),
  pickFolder: (start?: string, title?: string): Promise<string | null> => ipcRenderer.invoke("desktop:pick-folder", start, title),
  // Round 14 (SPEC 30.2): the app icon for the window, the status area and (installed) the app library.
  appIcon: (value?: string): Promise<{ value: string; launcher: "updated" | "same" | "not-installed" | "failed" } | null> =>
    ipcRenderer.invoke("desktop:app-icon", typeof value === "string" ? value : undefined),
  reportActivity: (working: number, waiting: number) => ipcRenderer.send("desktop:activity", { working: Number(working) || 0, waiting: Number(waiting) || 0 }),
  onCommand: (callback: (command: "new-thread" | "reopen") => void) => subscribe("desktop:command", callback),
  // SPEC 29.3: where the Browser panel's page shows in the window (null hides it), and a picture of
  // it to show while a menu covers the panel.
  browserPanel: {
    place: (projectId: string, tabId: string, rect: { x: number; y: number; width: number; height: number } | null, zoom = 1) =>
      ipcRenderer.send("browser-panel:place", { projectId: String(projectId), tabId: String(tabId), rect: rect ? { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) } : null, zoom: Number(zoom) || 1 }),
    freeze: (projectId: string, tabId: string): Promise<string | null> => ipcRenderer.invoke("browser-panel:freeze", { projectId: String(projectId), tabId: String(tabId) }),
  },
  // Only on the app's own error page.
  restartServer: () => ipcRenderer.send("shell:restart"),
  quit: () => ipcRenderer.send("shell:quit"),
  // Only on the busy page: asks the browser version to stop, then starts the app's own server.
  stopOtherServer: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("shell:stop-other"),
});
