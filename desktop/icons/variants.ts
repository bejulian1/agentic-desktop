// Round 14 (SPEC 30.2): the SVG each app icon is drawn from. The names and the order are in
// shared/protocol.ts (APP_ICONS), so the UI and the app agree on them. «boble» is the default and
// uses the files at the top of this folder, which the package and install-local.ts also use.
import type { AppIconId } from "../../shared/protocol.ts";

export interface IconSources {
  large: string; // 128 × 128, for 32 px and up
  small: string; // 16 × 16 on whole pixels, for 16 and 24 px and the browser tab
  symbolic: string; // one colour, for the status area and GNOME's symbolic icon
}

export const ICON_SOURCES: Record<AppIconId, IconSources> = {
  boble: { large: "agentic-desktop.svg", small: "agentic-desktop-small.svg", symbolic: "agentic-desktop-symbolic.svg" },
  "boble-lys": { large: "varianter/boble-lys.svg", small: "varianter/boble-lys-small.svg", symbolic: "agentic-desktop-symbolic.svg" },
  monogram: { large: "varianter/monogram.svg", small: "varianter/monogram-small.svg", symbolic: "varianter/monogram-symbolic.svg" },
  terminal: { large: "varianter/terminal.svg", small: "varianter/terminal-small.svg", symbolic: "varianter/terminal-symbolic.svg" },
};
