// Live controls owned by mounted tools. Removing an old owner cannot clear a newer mount.
import { createSignal } from "solid-js";
import { app } from "./app";
export type SessionTool = "browser" | "terminal";
export interface PanelSession { id: string; title: string; active: boolean; select: () => void; close: () => void }
interface Controls { owner: object; tabs: PanelSession[]; create: () => void }
const [sessions, setSessions] = createSignal<Record<string, Controls | undefined>>({});
const keyOf = (scope: string, tool: SessionTool) => `${scope}:${tool}`;
export const unifiedPanelTabs = () => app.settings.panelTabLayout !== "grouped";
export const panelSessions = (scope: string, tool: SessionTool) => sessions()[keyOf(scope, tool)];
export function publishPanelSessions(scope: string, tool: SessionTool, controls: Controls): void {
  setSessions((all) => ({ ...all, [keyOf(scope, tool)]: controls }));
}
export function releasePanelSessions(scope: string, tool: SessionTool, owner: object): void {
  setSessions((all) => all[keyOf(scope, tool)]?.owner === owner ? { ...all, [keyOf(scope, tool)]: undefined } : all);
}
const [terminalRequest, setTerminalRequest] = createSignal<string | null>(null);
export { terminalRequest };
export function requestTerminalSession(scope: string): void { setTerminalRequest(scope); }
export function takeTerminalRequest(scope: string): boolean {
  if (terminalRequest() !== scope) return false;
  setTerminalRequest(null);
  return true;
}
