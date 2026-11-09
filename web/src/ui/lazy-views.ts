// Innstillinger replaces the whole window and is not part of the first view, so it loads when it
// is opened (SPEC 29.5). The gear buttons fetch it when the pointer or focus comes to them, so it
// is usually there before the click.
import { lazy } from "solid-js";

export const SettingsView = lazy(() => import("./Settings"));

export function preloadSettings(): void {
  void SettingsView.preload();
}
