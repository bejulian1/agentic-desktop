// v1.4.0, Innstillinger → Utseende → Arbeidsflate: how much chrome the window shows. Full is every
// button as before; Enkel (Kode-fokus) is the calm, T3-like look. Each part is its own setting, so
// these read them with the defaults filled in. The same Sidebar, TopBar and Composer are used
// either way; the settings only gate their extra buttons.
import { createSignal } from "solid-js";
import { isFullWorkspace, isSimpleWorkspace, SIMPLE_WORKSPACE, type Settings } from "../../../shared/protocol";
import { patch } from "../lib/api";
import { app, mode, saveSettings, setApp, setMode } from "./app";

export const topbarMinimal = () => app.settings.topbarLayout === "minimal";
// The split-pane buttons: always in the full top bar, a choice in the minimal one.
export const topbarPanes = () => !topbarMinimal() || app.settings.topbarShowPanes !== false;
export const sidebarSimple = () => app.settings.sidebarSimple === true;
export const composerSimple = () => app.settings.composerSimple === true;
// v1.4.1: Meldingsfelt-stil Romslig (T3-stil): a taller field with a paperclip and one model menu.
export const composerLarge = () => app.settings.composerStyle === "large";

export type WorkspacePreset = "full" | "simple" | "custom";
export function workspacePreset(): WorkspacePreset {
  return isSimpleWorkspace(app.settings) ? "simple" : isFullWorkspace(app.settings) ? "full" : "custom";
}

const RESET: Record<keyof typeof SIMPLE_WORKSPACE, null> = { topbarLayout: null, topbarShowPanes: null, sidebarSimple: null, composerSimple: null, composerStyle: null };

// Enkel turns every part on and goes to Kode, which is what the look is made for; Full clears them.
export async function applyWorkspacePreset(preset: "full" | "simple"): Promise<void> {
  if (preset === "simple") {
    await saveSettings({ ...SIMPLE_WORKSPACE } as Partial<Settings>);
    if (mode() === "chat") setMode("code");
  } else {
    // Left out means the default, so the keys are cleared here and null clears them on the server.
    for (const key of Object.keys(RESET) as Array<keyof typeof RESET>) setApp("settings", key, undefined!);
    await patch("/api/settings", RESET);
  }
}

// Where the sidebar's search, notifications and ⋯ go in the top bar while the sidebar is open in a
// wide window: the top bar sets it, the sidebar renders into it.
export const [sidebarToolsSlot, setSidebarToolsSlot] = createSignal<HTMLElement | null>(null);
