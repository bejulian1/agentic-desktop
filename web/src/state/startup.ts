import { app, mode, scope, setMode, setPanelOpen, setSettingsOpen } from "./app";
import { closeArtifactPanel } from "./artifact-panel";
import { gridFor, prepareFreshGrid } from "./grid";
import { cancelPendingThreadOpen } from "./navigate";
import { closeChatProjectPage } from "./nav";

export function prepareStartup(): void {
  if (new URLSearchParams(location.search).has("rute")) { closeChatProjectPage(); return; }
  if (app.settings.startConversation === "resume") return;
  if (performance.getEntriesByType("navigation").some((entry) => (entry as PerformanceNavigationTiming).type === "reload")) return;
  closeChatProjectPage();
  prepareFreshGrid(scope());
  setPanelOpen(false);
}

export function reopenFreshView(): void {
  if (app.settings.startConversation === "resume") return;
  cancelPendingThreadOpen();
  setMode(mode());
  closeArtifactPanel();
  gridFor(scope()).freshView();
  setSettingsOpen(null);
  setPanelOpen(false);
}
