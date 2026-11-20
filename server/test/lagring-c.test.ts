// Lagring: sizes of the data folder and cleaning up in it. A temporary data folder with known
// files and sizes, symlinks that point out of it, and a downloads folder that is only counted.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { startHarness, tempDir } from "./helpers.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const OLD = new Date(Date.now() - 40 * 24 * 60 * 60_000);
const uuid = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const put = (file: string, bytes: number, old = true) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x".repeat(bytes));
  if (old) utimesSync(file, OLD, OLD);
};
const cat = (report: any, id: string) => report.categories.find((c: any) => c.id === id);
const act = (report: any, id: string) => report.actions.find((a: any) => a.id === id);

async function setup(t: import("node:test").TestContext) {
  const dataDir = tempDir(t, "ad-lagring-data-");
  const outside = tempDir(t, "ad-lagring-ute-");
  const downloads = tempDir(t, "ad-lagring-nedlast-");
  const h = await startHarness(t, { dataDir });
  await h.api("PATCH", "/api/settings", { downloadDir: downloads });

  // An image in use: uploaded and sent with a message, so the log names it.
  const { id: used } = await h.api("POST", "/api/images", { name: "i-bruk.png", mime: "image/png", data: PNG });
  const thread = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Se på bildet", attachments: [{ kind: "image", imageId: used, name: "i-bruk.png" }] });
  await h.finished(thread.id);
  const usedFile = path.join(dataDir, "images", `${used}.png`);
  utimesSync(usedFile, OLD, OLD);

  put(path.join(dataDir, "images", `${uuid(1)}.png`), 1000); // orphan
  put(path.join(dataDir, "uploads", `${uuid(2)}.txt`), 2000); // orphan
  put(path.join(dataDir, "screenshots", `${uuid(3)}.png`), 3000); // orphan
  put(path.join(dataDir, "images", `${uuid(4)}.png`), 400, false); // orphan, but new: it may wait in the message field
  put(path.join(dataDir, "chrome-profile", "Default", "Cache", "data_0"), 5000);
  put(path.join(dataDir, "chrome-profile", "Default", "Cookies"), 300);
  put(path.join(dataDir, "logs", "gammel.log"), 700);
  put(path.join(dataDir, "logs", "ny.log"), 50, false);
  put(path.join(downloads, "fil.zip"), 1234);

  // Links that point out of the data folder. Neither is counted, followed or emptied.
  put(path.join(outside, "hemmelig.png"), 9000);
  put(path.join(outside, "mappe", "viktig.txt"), 8000);
  symlinkSync(path.join(outside, "hemmelig.png"), path.join(dataDir, "images", `${uuid(5)}.png`));
  symlinkSync(path.join(outside, "mappe"), path.join(dataDir, "chrome-profile", "Default", "Cache", "lenke"));
  symlinkSync(path.join(outside, "mappe"), path.join(dataDir, "screenshots", "lenke"));
  return { h, dataDir, outside, downloads, usedFile, thread };
}

test("the report counts each category from known files, and the downloads apart from the total", async (t) => {
  const { h, dataDir, downloads } = await setup(t);
  const report = await h.api("GET", "/api/storage");
  assert.equal(report.dataDir, dataDir);
  assert.equal(cat(report, "images").bytes, readFileSync(path.join(dataDir, "images", `${uuid(1)}.png`)).length + 400 + 70, "two orphans and the 70-byte PNG, no link");
  assert.equal(cat(report, "uploads").bytes, 2000);
  assert.equal(cat(report, "screenshots").bytes, 3000, "the link to a folder outside is not counted");
  assert.equal(cat(report, "browser").bytes, 5300);
  assert.equal(cat(report, "logs").bytes, 750);
  assert.ok(cat(report, "database").bytes > 0);
  assert.equal(report.total, report.categories.reduce((n: number, c: any) => n + c.bytes, 0));
  assert.deepEqual([report.downloads.dir, report.downloads.bytes, report.downloads.files], [downloads, 1234, 1]);
  assert.ok(!report.categories.some((c: any) => c.id === "downloads"), "downloads are not a category");

  assert.deepEqual([act(report, "orphans").count, act(report, "orphans").bytes], [3, 6000]);
  assert.equal(act(report, "browser-cache").bytes, 5000);
  assert.equal(act(report, "browser-all").bytes, 5300);
  assert.deepEqual([act(report, "logs").count, act(report, "logs").bytes], [1, 700]);
  assert.equal(act(report, "vacuum").available, true);
});

test("cleaning removes orphans, caches and old logs, and nothing outside the data folder", async (t) => {
  const { h, dataDir, outside, downloads, usedFile } = await setup(t);
  const result = await h.api("POST", "/api/storage/clean", { actions: ["orphans", "browser-cache", "logs"] });
  assert.deepEqual(result.done.map((d: any) => [d.id, d.error ?? null]), [["browser-cache", null], ["orphans", null], ["logs", null]]);
  assert.ok(result.freed >= 6000 + 5000 + 700, `frigjort ${result.freed}`);

  assert.ok(existsSync(usedFile), "the image a message uses is kept");
  assert.ok(existsSync(path.join(dataDir, "images", `${uuid(4)}.png`)), "a new attachment is kept");
  for (const gone of [`images/${uuid(1)}.png`, `uploads/${uuid(2)}.txt`, `screenshots/${uuid(3)}.png`, "chrome-profile/Default/Cache", "logs/gammel.log"]) {
    assert.ok(!existsSync(path.join(dataDir, gone)), `${gone} er borte`);
  }
  assert.ok(existsSync(path.join(dataDir, "chrome-profile", "Default", "Cookies")), "logins stay unless asked");
  assert.ok(existsSync(path.join(dataDir, "logs", "ny.log")), "a new log stays");
  // Outside: untouched, also where a link inside pointed.
  assert.equal(readFileSync(path.join(outside, "hemmelig.png")).length, 9000);
  assert.equal(readFileSync(path.join(outside, "mappe", "viktig.txt")).length, 8000);
  assert.ok(existsSync(path.join(dataDir, "images", `${uuid(5)}.png`)), "a link with an attachment's name is not an orphan");
  assert.ok(existsSync(path.join(downloads, "fil.zip")), "downloads are never cleaned");

  const after = result.report;
  assert.equal(act(after, "orphans").count, 0);
  assert.equal(cat(after, "uploads").bytes, 0);
});

test("the whole browser profile goes only when asked, and a symlinked profile is never emptied", async (t) => {
  const { h, dataDir } = await setup(t);
  await h.api("POST", "/api/storage/clean", { actions: ["browser-all"] });
  assert.ok(!existsSync(path.join(dataDir, "chrome-profile")));

  const dataDir2 = tempDir(t, "ad-lagring-data2-");
  const outside = tempDir(t, "ad-lagring-profil-");
  put(path.join(outside, "Default", "Cache", "data_0"), 4000);
  put(path.join(outside, "Default", "Cookies"), 100);
  symlinkSync(outside, path.join(dataDir2, "chrome-profile"));
  const h2 = await startHarness(t, { dataDir: dataDir2 });
  const report = await h2.api("GET", "/api/storage");
  assert.equal(cat(report, "browser").bytes, 0, "a linked profile is not ours to count");
  const result = await h2.api("POST", "/api/storage/clean", { actions: ["browser-all", "browser-cache"] });
  assert.ok(result.done.some((d: any) => d.id === "browser-all" && d.error), "refused");
  assert.equal(readFileSync(path.join(outside, "Default", "Cache", "data_0")).length, 4000);
  assert.ok(existsSync(path.join(outside, "Default", "Cookies")));
});

test("old archived threads are deleted with the database compacted after, newer ones stay", async (t) => {
  const { h, thread } = await setup(t);
  const recent = await h.thread(null, "chat");
  await h.api("PATCH", `/api/threads/${thread.id}`, { archived: true });
  await h.api("PATCH", `/api/threads/${recent.id}`, { archived: true });
  // Make the first one old, through the store, since the API always stamps now.
  (h.app.store as any).db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(OLD.getTime(), thread.id);
  const report = await h.api("GET", "/api/storage?days=30");
  assert.equal(act(report, "archived").count, 1);
  assert.ok(act(report, "archived").bytes > 0);
  const result = await h.api("POST", "/api/storage/clean", { actions: ["archived"], archivedDays: 30 });
  assert.deepEqual(result.done.map((d: any) => [d.id, d.count, d.error ?? null]), [["archived", 1, null], ["vacuum", 1, null]]);
  const archived = await h.api("GET", "/api/threads/archived");
  assert.deepEqual(archived.map((x: any) => x.id), [recent.id]);
});

test("wrong requests are refused, and the command is listed", async (t) => {
  const h = await startHarness(t);
  for (const body of [{}, { actions: [] }, { actions: ["rm -rf"] }, { actions: "orphans" }, { actions: ["archived"], archivedDays: -1 }, { actions: ["archived"], archivedDays: 1.5 }]) {
    await assert.rejects(h.api("POST", "/api/storage/clean", body), /400/, JSON.stringify(body));
  }
  await assert.rejects(h.api("GET", "/api/storage?days=abc"), /400/);
  const commands = await h.api("GET", "/api/commands");
  const storage = commands.find((c: any) => c.name === "storage");
  assert.deepEqual(storage.aliases, ["lagring"]);
});
