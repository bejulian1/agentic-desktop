// Studio is a workspace over Code threads; it never adds a model mode or changes permissions.
import { createSignal } from "solid-js";
let restored = false;
try { restored = sessionStorage.getItem("ad-studio-workspace") === "1"; } catch { /* Window-local state is enough. */ }
const [studioOpen, open] = createSignal(restored);
export { studioOpen };
export function setStudioOpen(value: boolean): void {
  open(value);
  try { if (value) sessionStorage.setItem("ad-studio-workspace", "1"); else sessionStorage.removeItem("ad-studio-workspace"); } catch { /* Keep working without storage. */ }
}
export type StudioTool = "terminal" | "browser" | "changes";
export const [studioTool, setStudioTool] = createSignal<StudioTool | null>(null);
export const [studioAgentOpen, setStudioAgentOpen] = createSignal(true);
export const [studioMobileView, setStudioMobileView] = createSignal<"files" | "agent">("files");
