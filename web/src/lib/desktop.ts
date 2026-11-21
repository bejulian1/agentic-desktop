// The Electron app's bridge (desktop/preload.ts), when the UI runs there. In a browser it is not
// there, and nothing in this file does anything.
import { createEffect, createRoot } from "solid-js";
import { app } from "../state/app";
import { actions } from "../state/actions";
import { reopenFreshView } from "../state/startup";
import { waitingCount } from "../state/thread-status";

export type CloseBehavior = "tray" | "quit";
export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
}

// SPEC 29.2: Chromium's sandbox in the app. Off only when Ubuntu's AppArmor rule would stop it.
export interface SandboxInfo {
  on: boolean;
  reason: string | null;
  command: string | null;
}

interface DesktopBridge {
  setLanguage?: (setting: import("../../../shared/i18n.ts").LanguageSetting) => Promise<string | null>;
  shell: "electron";
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    state: () => Promise<WindowState | null>;
    onState: (callback: (state: WindowState) => void) => () => void;
  };
  closeBehavior: (value?: CloseBehavior) => Promise<{ value: CloseBehavior; statusArea: boolean } | null>;
  sandbox?: () => Promise<SandboxInfo | null>;
  pickFolder?: (start?: string, title?: string) => Promise<string | null>;
  // Round 14 (SPEC 30.2). launcher: whether the app library's icon followed.
  appIcon?: (value?: string) => Promise<{ value: string; launcher: "updated" | "same" | "not-installed" | "failed" } | null>;
  reportActivity: (working: number, waiting: number) => void;
  onCommand: (callback: (command: "new-thread" | "reopen") => void) => () => void;
}

export const desktop: DesktopBridge | undefined = (globalThis as { agenticDesktop?: DesktopBridge }).agenticDesktop;

let connected = false;

// Once, from the window controls in the top bar: marks the page for the shell's CSS (the top bar
// moves the window), follows the status area's Ny tråd, and tells it how many threads work or wait.
export function connectDesktop(): void {
  if (!desktop || connected) return;
  connected = true;
  document.documentElement.dataset.shell = "electron";
  desktop.onCommand((command) => {
    if (command === "new-thread") actions.newThread();
    if (command === "reopen") reopenFreshView();
  });
  createRoot(() => {
    let last = "";
    createEffect(() => {
      let working = 0;
      let waiting = 0;
      for (const thread of Object.values(app.threads)) {
        if (!thread || thread.archived) continue;
        if (thread.running) working += 1;
        if (waitingCount(thread) > 0) waiting += 1;
      }
      const key = `${working}/${waiting}`;
      if (key === last) return;
      last = key;
      desktop.reportActivity(working, waiting);
    });
  });
}
