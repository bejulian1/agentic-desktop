import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { mode, scope, settingsOpen } from "./app";
import { gridFor } from "./grid";
import { skillsOpen } from "./skills-workspace";

type PickerAnchor = "composer" | "topbar" | "environment";
const context = () => {
  const key = scope();
  const grid = gridFor(key);
  return { scope: key, mode: mode(), paneId: grid.focused(), threadId: grid.focusedThreadId() };
};
const [picker, setPicker] = createSignal<({ paneKey: string; anchor: PickerAnchor } & ReturnType<typeof context>) | null>(null);

// The origin is part of the request: opening from the top bar must never open a composer menu.
export function openProjectPicker(paneKey: string, anchor: PickerAnchor = "composer"): void {
  if (settingsOpen() || skillsOpen()) return;
  setPicker({ paneKey, anchor, ...context() });
}

export const closeProjectPicker = () => setPicker(null);

export function useProjectPicker(paneKey: Accessor<string | null>, anchor: PickerAnchor) {
  const owns = () => picker()?.anchor === anchor && picker()?.paneKey === paneKey();
  const open = () => owns() && !settingsOpen() && !skillsOpen();
  const close = () => { if (owns()) closeProjectPicker(); };
  createEffect(() => {
    const visit = picker();
    if (!visit || visit.anchor !== anchor || (anchor !== "topbar" && visit.paneKey !== paneKey())) return;
    const now = context();
    if (settingsOpen() || skillsOpen() || visit.paneKey !== paneKey() || visit.scope !== now.scope || visit.mode !== now.mode || visit.paneId !== now.paneId || visit.threadId !== now.threadId) closeProjectPicker();
  });
  onCleanup(close);
  return {
    open,
    close,
    show: () => { const key = paneKey(); if (key) openProjectPicker(key, anchor); },
    toggle: () => { const key = paneKey(); if (open()) close(); else if (key) openProjectPicker(key, anchor); },
  };
}
