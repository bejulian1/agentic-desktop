import { lookupMessage, t } from "./i18n.ts";
import type { BrowserWindow, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue } from "electron";
import { folderOptions } from "../server/src/native-folder.ts";

// Dependencies are explicit so authorization and cancellation can be tested without a window.
export function folderPicker(deps: {
  trusted: (event: IpcMainInvokeEvent) => boolean;
  window: () => BrowserWindow | undefined;
  show: (window: BrowserWindow, options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
}): (event: IpcMainInvokeEvent, start?: unknown, title?: unknown) => Promise<string | null> {
  let active = false;
  return async (event, start, title) => {
    const win = deps.window();
    if (!deps.trusted(event) || !win) return null;
    const options = folderOptions(start, title);
    if (active) throw new Error(t("Mappevelgeren er allerede åpen"));
    active = true;
    try {
      const result = await deps.show(win, { title: options.title ? lookupMessage(options.title) : t("Velg prosjektmappe"), ...(options.start ? { defaultPath: options.start } : {}), properties: ["openDirectory"] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    } finally {
      active = false;
    }
  };
}
