import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_TEXT_FILE } from "../src/files.ts";
import { rawRequest, startHarness, tempDir } from "./helpers.ts";

const route = (kind: "tree" | "file", file: string) => `/api/local/files/${kind}?path=${encodeURIComponent(file)}`;

test("lokalt filpanel starter hjemme og leser manuelt valgte mapper uten å opprette prosjekt eller skrive-API", async (t) => {
  const home = tempDir(t, "ad-local-home-");
  const outside = tempDir(t, "ad-local-outside-");
  mkdirSync(path.join(home, "Mappe"));
  writeFileSync(path.join(home, "notat.txt"), "Norsk tekst æøå");
  writeFileSync(path.join(outside, "annen.txt"), "utenfor hjemmemappen");
  const h = await startHarness(t, { homeDir: home });
  assert.deepEqual(await h.api("GET", "/api/local/files/root"), { path: home });
  const entries = await h.api("GET", route("tree", home));
  assert.deepEqual(entries.map((entry: any) => [entry.name, entry.kind, entry.path]), [["Mappe", "dir", path.join(home, "Mappe")], ["notat.txt", "file", path.join(home, "notat.txt")]]);
  assert.deepEqual(await h.api("GET", route("file", path.join(outside, "annen.txt"))), { path: path.join(outside, "annen.txt"), text: "utenfor hjemmemappen", size: Buffer.byteLength("utenfor hjemmemappen"), binary: false, truncated: false });
  assert.ok(Array.isArray(await h.api("GET", route("tree", "/"))), "filsystemets rot kan navigeres manuelt");
  assert.equal((await rawRequest(h.app.port, "GET", route("tree", home))).status, 401);
  assert.equal((await h.raw("PUT", route("file", path.join(home, "notat.txt")), { headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "endre" }) })).status, 404);
  for (const url of ["/api/projects/local/tree", "/api/projects/local/file?path=notat.txt"]) assert.equal((await h.raw("GET", url)).status, 404);
  assert.equal((await h.raw("POST", "/api/threads", { headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "local", mode: "code" }) })).status, 404);
  assert.deepEqual(h.app.store.projects(), []);
});

test("lokale lesinger beskytter appdata og symlenker inn, og avviser relative/ugyldige stier", async (t) => {
  const home = tempDir(t, "ad-local-home-");
  const dataDir = path.join(home, "appdata");
  mkdirSync(dataDir);
  const h = await startHarness(t, { homeDir: home, dataDir });
  writeFileSync(path.join(dataDir, "privat.txt"), "skal aldri leses");
  symlinkSync(dataDir, path.join(home, "appdata-lenke"));
  symlinkSync(path.join(dataDir, "privat.txt"), path.join(home, "privat-lenke"));
  mkdirSync(path.join(home, "vanlig"));
  writeFileSync(path.join(home, "vanlig", "trygg.txt"), "trygg");
  symlinkSync(path.join(home, "vanlig"), path.join(home, "vanlig-lenke"));
  for (const [kind, file] of [["tree", dataDir], ["file", path.join(dataDir, "privat.txt")], ["tree", path.join(home, "appdata-lenke")], ["file", path.join(home, "privat-lenke")], ["file", path.join(home, "appdata-lenke", "privat.txt")]] as const) {
    assert.equal((await h.raw("GET", route(kind, file))).status, 403, file);
  }
  const entries = await h.api("GET", route("tree", home));
  assert.deepEqual(entries.map((entry: any) => entry.name), ["vanlig", "vanlig-lenke"]);
  assert.equal((await h.api("GET", route("file", path.join(home, "vanlig-lenke", "trygg.txt")))).text, "trygg");
  for (const invalid of ["relativ", path.join(home, "x") + "/../vanlig", home + "/\0", "/" + "a".repeat(4096)]) assert.equal((await h.raw("GET", route("tree", invalid))).status, 400, JSON.stringify(invalid));
  assert.equal((await h.raw("GET", route("file", path.join(home, "mangler.txt")))).status, 404);
});

test("lokale filer leses begrenset, binært innhold skjules og FIFO åpnes aldri blokkerende", async (t) => {
  const home = tempDir(t, "ad-local-home-");
  const h = await startHarness(t, { homeDir: home });
  const large = path.join(home, "stor.txt");
  writeFileSync(large, "a".repeat(MAX_TEXT_FILE));
  truncateSync(large, 32 * 1024 * 1024);
  const content = await h.api("GET", route("file", large));
  assert.equal(content.size, 32 * 1024 * 1024);
  assert.equal(content.text.length, MAX_TEXT_FILE);
  assert.equal(content.truncated, true);
  writeFileSync(path.join(home, "binaer"), Buffer.from([0, 1, 2]));
  assert.equal((await h.api("GET", route("file", path.join(home, "binaer")))).text, null);
  const fifo = path.join(home, "fifo");
  execFileSync("mkfifo", [fifo]);
  assert.equal((await h.raw("GET", route("file", fifo))).status, 400);
  assert.equal((await h.raw("GET", route("file", home))).status, 400);
  assert.equal((await h.api("GET", route("tree", home))).some((entry: any) => entry.name === "fifo"), false);
});
