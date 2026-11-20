import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserWindow, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue } from "electron";
import { folderPicker } from "../folder-picker.ts";

test("mappevelgeren krever betrodd IPC og bruker bare openDirectory", async () => {
  const win = {} as BrowserWindow;
  const trusted = {} as IpcMainInvokeEvent;
  const calls: OpenDialogOptions[] = [];
  const pick = folderPicker({
    trusted: (event) => event === trusted,
    window: () => win,
    show: async (parent, options) => {
      assert.equal(parent, win);
      calls.push(options);
      return { canceled: false, filePaths: ["/tmp/prosjekt med mellomrom"] };
    },
  });
  assert.equal(await pick({} as IpcMainInvokeEvent), null);
  assert.equal(calls.length, 0, "avvist IPC åpner ingen dialog");
  assert.equal(await pick(trusted, "/tmp/start", "Prosjektmappe"), "/tmp/prosjekt med mellomrom");
  assert.deepEqual(calls, [{ title: "Prosjektmappe", defaultPath: "/tmp/start", properties: ["openDirectory"] }]);
  await assert.rejects(pick(trusted, {}, "Tittel"), { status: 400 });
  assert.equal(calls.length, 1);
});

test("mappevelgeren håndterer Avbryt, parallelle kall og feil uten å beholde låsen", async () => {
  const event = {} as IpcMainInvokeEvent;
  let finish!: (value: OpenDialogReturnValue) => void;
  let fail = false;
  const pick = folderPicker({
    trusted: () => true,
    window: () => ({} as BrowserWindow),
    show: async () => {
      if (fail) throw new Error("dialogfeil");
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  const first = pick(event);
  await assert.rejects(pick(event), /allerede åpen/);
  finish({ canceled: true, filePaths: [] });
  assert.equal(await first, null);
  fail = true;
  await assert.rejects(pick(event), /dialogfeil/);
  fail = false;
  const last = pick(event);
  finish({ canceled: false, filePaths: ["/tmp/valgt"] });
  assert.equal(await last, "/tmp/valgt");
});
