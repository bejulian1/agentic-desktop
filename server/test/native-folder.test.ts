import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NativeFolderPicker } from "../src/native-folder.ts";
import { rawRequest, startHarness, tempDir } from "./helpers.ts";

test("systemets mappevelger gir valgt mappe med sikre argumenter og oppretter ingenting", async (t) => {
  const dir = tempDir(t);
  const selected = path.join(dir, "Valgt mappe – æøå");
  mkdirSync(selected);
  const script = path.join(dir, "picker.cjs");
  const log = path.join(dir, "args.json");
  writeFileSync(script, `require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(4))); console.log(process.argv[3]);`);
  const picker = new NativeFolderPicker({ executable: process.execPath, prefix: [script, log, selected] });
  const start = path.join(dir, "finnes ikke; $(touch uventet)");
  assert.equal(await picker.pick(start, "Velg \"mappe\"; $(touch uventet)"), selected);
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), ["--file-selection", "--directory", '--title=Velg "mappe"; $(touch uventet)', `--filename=${start}/`]);
  assert.equal(await picker.pick(), selected, "låsen frigjøres etter valg");
});

test("Avbryt gir null, feil forklares, og tidsavbrudd frigjør låsen", async (t) => {
  const dir = tempDir(t);
  const fixture = (name: string, text: string) => {
    const file = path.join(dir, name + ".cjs");
    writeFileSync(file, text);
    return file;
  };
  const cancel = new NativeFolderPicker({ executable: process.execPath, prefix: [fixture("cancel", "process.exit(1)")] });
  assert.equal(await cancel.pick(), null);
  assert.equal(await cancel.pick(), null);
  const missing = new NativeFolderPicker({ executable: path.join(dir, "mangler") });
  await assert.rejects(missing.pick(), { status: 501, message: /zenity mangler/ });
  const failed = new NativeFolderPicker({ executable: process.execPath, prefix: [fixture("failed", "process.exit(2)")] });
  await assert.rejects(failed.pick(), { status: 503 });
  const display = new NativeFolderPicker({ executable: process.execPath, prefix: [fixture("display", "console.error('cannot open display'); process.exit(1)")] });
  await assert.rejects(display.pick(), { status: 501 });
  const stalled = new NativeFolderPicker({ executable: process.execPath, prefix: [fixture("stalled", "setTimeout(() => {}, 10000)")], timeoutMs: 60 });
  const first = stalled.pick();
  await assert.rejects(stalled.pick(), { status: 409 });
  await assert.rejects(first, { status: 504 });
  await assert.rejects(stalled.pick(), { status: 504 }, "låsen frigjøres etter tidsavbrudd");
  await assert.rejects(cancel.pick("sti\0feil"), { status: 400 });
  await assert.rejects(cancel.pick(undefined, "x".repeat(201)), { status: 400 });
  const invalid = new NativeFolderPicker({ executable: process.execPath, prefix: [fixture("invalid", "console.log('relativ/sti')")] });
  await assert.rejects(invalid.pick(), { status: 503 });
  const file = new NativeFolderPicker({ executable: process.execPath, prefix: [fixture("file", `console.log(${JSON.stringify(path.join(dir, "cancel.cjs"))})`)] });
  await assert.rejects(file.pick(), { status: 400 }, "en fil kan ikke bli valgt mappe");
});

test("HTTP-mappevelger krever innlogging, Origin og JSON og registrerer ikke prosjektet", async (t) => {
  const h = await startHarness(t);
  const selected = tempDir(t, "ad-selected-");
  const calls: unknown[][] = [];
  t.mock.method(NativeFolderPicker.prototype, "pick", async (...args: unknown[]) => {
    calls.push(args);
    return calls.length === 1 ? selected : null;
  });
  const route = "/api/fs/pick-folder";
  assert.equal((await rawRequest(h.app.port, "POST", route, { headers: { origin: h.origin } })).status, 401);
  assert.equal((await h.raw("POST", route, { headers: { origin: "https://uventet.example" } })).status, 403);
  assert.equal((await h.raw("POST", route, { headers: { "content-type": "text/plain" }, body: "{}" })).status, 415);
  assert.equal(calls.length, 0, "uautoriserte forespørsler starter ingen prosess");
  assert.deepEqual(await h.api("POST", route, { start: selected, title: "Velg mappe" }), { path: selected });
  assert.deepEqual(calls, [[selected, "Velg mappe"]]);
  assert.deepEqual(await h.api("POST", route, {}), { path: null });
  assert.deepEqual(h.app.store.projects(), [], "valg alene legger ikke til et prosjekt");
});

test("zenity arver bare nødvendige miljøvariabler og avbrytes når serveren stopper", async (t) => {
  const dir = tempDir(t);
  const script = path.join(dir, "env.cjs");
  const log = path.join(dir, "env.json");
  writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.env)); console.log(${JSON.stringify(dir)});`);
  const picker = new NativeFolderPicker({ executable: process.execPath, prefix: [script], env: () => ({ HOME: dir, DISPLAY: ":fiktiv", LANG: "nb_NO.UTF-8", FAKE_API_KEY: "hemmelig", OTHER_CONFIG: "privat" }) });
  assert.equal(await picker.pick(), dir);
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), { HOME: dir, DISPLAY: ":fiktiv", LANG: "nb_NO.UTF-8" });

  const stalled = path.join(dir, "stalled.cjs");
  writeFileSync(stalled, "setTimeout(() => {}, 10000)");
  const closing = new NativeFolderPicker({ executable: process.execPath, prefix: [stalled] });
  const pending = closing.pick();
  closing.close();
  await assert.rejects(pending, { status: 503, message: /serveren stopper/ });
  await assert.rejects(closing.pick(), { status: 503, message: /avsluttet/ });
});
