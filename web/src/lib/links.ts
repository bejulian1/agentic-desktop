// Opens links from chat/Kode messages and the terminal according to Settings.openLinksIn.
// Ctrl/Cmd+click always opens in the system browser; normal click obeys the setting.
import { app, mode, setMode } from "../state/app";
import { requestBrowserUrl, showPanel } from "../state/panel";

export function parseHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.origin === location.origin) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Reuses the existing external-open path: Electron intercepts window.open -> shell.openExternal,
// while localhost mode opens a normal browser tab.
export function openExternalUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

// Returns true when this helper handled the click (preventing native anchor navigation).
export function openLink(raw: string, event?: MouseEvent, fromAnchor = false): boolean {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  const forceExternal = !!event && (event.ctrlKey || event.metaKey);
  if (forceExternal || app.settings.openLinksIn !== "app") {
    if (!fromAnchor) {
      event?.preventDefault();
      openExternalUrl(parsed.href);
      return true;
    }
    if (forceExternal) {
      event?.preventDefault();
      openExternalUrl(parsed.href);
      return true;
    }
    return false;
  }
  event?.preventDefault();
  if (mode() !== "code") setMode("code");
  requestBrowserUrl(parsed.href);
  showPanel("browser");
  return true;
}
