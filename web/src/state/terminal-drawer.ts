import { createSignal, onCleanup, onMount } from "solid-js";
import type { DrawerTerminal } from "../../../shared/protocol";
import { del, get, post } from "../lib/api";
import { rememberFocus } from "../lib/focus";
import { on } from "../lib/socket";
import { mode, panelOpen, report, settingsOpen } from "./app";
import { artifactBig, artifactPanel } from "./artifact-panel";
import { room } from "./artifacts";
import { githubRoom, profileOpen } from "./nav";
import { panelFull } from "./panel";
import { skillsOpen } from "./skills-workspace";
import { studioOpen } from "./studio";
import { welcomeView } from "./welcome";

const HEIGHT_KEY = "ad.terminalDrawer.height";
export const DEFAULT_DRAWER_HEIGHT = 240;
export const MIN_DRAWER_HEIGHT = 140;
export const maxDrawerHeight = () => Math.floor(window.innerHeight * 0.6);

export function clampDrawerHeight(value: number): number {
  const max = maxDrawerHeight();
  return Math.min(max, Math.max(MIN_DRAWER_HEIGHT, Math.round(value)));
}

function readHeight(): number {
  try {
    const height = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(height) && height >= MIN_DRAWER_HEIGHT) return height;
  } catch {
    // Storage can be unavailable to this window.
  }
  return DEFAULT_DRAWER_HEIGHT;
}

const [height, setHeight] = createSignal(readHeight());
export const terminalDrawerHeight = height;
export function saveTerminalDrawerHeight(value: number): void {
  const next = clampDrawerHeight(value);
  setHeight(next);
  try { localStorage.setItem(HEIGHT_KEY, String(next)); } catch { /* Keep the current window's height. */ }
}

const [open, setOpen] = createSignal(false);
let restoreFocus: (() => void) | undefined;
export const terminalDrawerOpen = open;
export const terminalDrawerAvailable = () => mode() === "code" && !studioOpen() && !settingsOpen() && !welcomeView()
  && !room() && !profileOpen() && !skillsOpen() && !githubRoom()
  && !(artifactPanel() ? artifactBig() : panelOpen() && panelFull());

export function openTerminalDrawer(): void {
  if (!terminalDrawerAvailable() || open()) return;
  restoreFocus = rememberFocus();
  setOpen(true);
}

export function closeTerminalDrawer(): void {
  setOpen(false);
  restoreFocus?.();
  restoreFocus = undefined;
}

export function toggleTerminalDrawer(): void {
  if (open()) closeTerminalDrawer();
  else openTerminalDrawer();
}

const activeByProject = new Map<string, string>();

export function createTerminalDrawerTabs(projectId: string) {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/terminal-drawer`;
  const [tabs, setTabs] = createSignal<DrawerTerminal[]>([]);
  const [active, setActive] = createSignal<string>();
  const [busy, setBusy] = createSignal(true);
  let mounted = true;

  const select = (id: string | undefined) => {
    setActive(id);
    if (id) activeByProject.set(projectId, id);
    else activeByProject.delete(projectId);
  };

  const remove = (id: string) => {
    const remaining = tabs().filter((tab) => tab.terminalId !== id);
    setTabs(remaining);
    if (active() === id) select(remaining.at(-1)?.terminalId);
  };

  async function load() {
    try {
      let list = await get<DrawerTerminal[]>(endpoint);
      if (!mounted) return;
      // A second window opening this drawer at the same time can reuse the first shell.
      if (!list.length) list = [await post<DrawerTerminal>(`${endpoint}?ensure=1`)];
      if (!mounted) return;
      setTabs(list);
      const remembered = activeByProject.get(projectId);
      select(list.find((tab) => tab.terminalId === remembered)?.terminalId ?? list.at(-1)?.terminalId);
    } catch (err) {
      if (mounted) report(err);
    } finally {
      if (mounted) setBusy(false);
    }
  }

  async function create(): Promise<string | undefined> {
    if (busy()) return;
    setBusy(true);
    try {
      const tab = await post<DrawerTerminal>(endpoint);
      if (!mounted) return;
      setTabs((list) => [...list, tab]);
      return tab.terminalId;
    } catch (err) {
      if (mounted) report(err);
    } finally {
      if (mounted) setBusy(false);
    }
  }

  async function close(id: string): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      await del(`${endpoint}/${encodeURIComponent(id)}`);
      if (mounted && tabs().some((tab) => tab.terminalId === id)) remove(id);
    } catch (err) {
      if (mounted) report(err);
    } finally {
      if (mounted) setBusy(false);
    }
  }

  onMount(() => {
    onCleanup(on("terminal.closed", ({ terminalId }) => {
      if (tabs().some((tab) => tab.terminalId === terminalId)) remove(terminalId);
    }));
    onCleanup(on("terminal.exit", ({ terminalId }) => {
      setTabs((list) => list.map((tab) => tab.terminalId === terminalId ? { ...tab, exited: true } : tab));
    }));
    void load();
  });
  onCleanup(() => { mounted = false; });

  return { tabs, active, busy, select, create, close };
}
