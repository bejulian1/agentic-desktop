import assert from "node:assert/strict";
import { test } from "node:test";
import { closeAll, launch, sandbox, type Running } from "./helpers.ts";

test("den ekte preload-broen velger mappe, mens fremmed avsender og underframe avvises", async () => {
  const box = sandbox();
  let running: Running | undefined;
  try {
    running = await launch(box);
    // Stub before invoking: this test must never show a native file chooser, even under xvfb.
    await running.app.evaluate(({ dialog }) => {
      const state = { calls: [] as unknown[], canceled: false };
      (globalThis as any).__folderPickerTest = state;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        state.calls.push(args[1]);
        return { canceled: state.canceled, filePaths: state.canceled ? [] : ["/tmp/valgt prosjekt"] };
      }) as any;
    });
    assert.equal(await running.page.evaluate(() => (window as any).agenticDesktop.pickFolder("/tmp/start", "Velg prosjektmappe")), "/tmp/valgt prosjekt");
    const report = await running.app.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const handler = (ipcMain as any)._invokeHandlers.get("desktop:pick-folder");
      const state = (globalThis as any).__folderPickerTest;
      const foreign = await handler({ sender: {}, senderFrame: contents.mainFrame });
      const subframe = await handler({ sender: contents, senderFrame: { url: contents.mainFrame.url } });
      state.canceled = true;
      return { foreign, subframe, calls: state.calls };
    });
    assert.equal(report.foreign, null);
    assert.equal(report.subframe, null);
    assert.deepEqual(report.calls, [{ title: "Velg prosjektmappe", defaultPath: "/tmp/start", properties: ["openDirectory"] }]);
    assert.equal(await running.page.evaluate(() => (window as any).agenticDesktop.pickFolder()), null);
  } finally {
    await closeAll(running);
    box.cleanup();
  }
});
