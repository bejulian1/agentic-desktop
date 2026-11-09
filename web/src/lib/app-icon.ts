// Round 14 (SPEC 30.2): the app icon chosen in Innstillinger → Utseende. In a browser it is the
// tab's icon (favicon); in the Electron app also the window's, the status area's and, when the app
// is installed with install-local, the app library's. public/theme.js puts the stored one on the
// tab before anything else loads, so the tab does not flash the default first.
import { DEFAULT_APP_ICON, isAppIcon, type AppIconId } from "../../../shared/protocol";
import { desktop } from "./desktop";

const STORED = "ad-app-icon";
let shown: AppIconId | null = null;

export const appIconUrl = (id: AppIconId) => `/app-icons/${id}.svg`;
export const appIconTabUrl = (id: AppIconId) => `/app-icons/${id}-tab.svg`;

export function applyAppIcon(value: unknown): void {
  const id = isAppIcon(value) ? value : DEFAULT_APP_ICON;
  if (id === shown) return;
  shown = id;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.append(link);
  }
  link.href = appIconTabUrl(id);
  try {
    localStorage.setItem(STORED, id);
  } catch {
    // Only the first paint of the next start uses it.
  }
  // The Electron app keeps its own copy, so the window has it before the page loads next time.
  void desktop?.appIcon?.(id).catch(() => undefined);
}
