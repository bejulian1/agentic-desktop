// v1.2.0: richer project icons. A wider palette, monogram badges and uploaded images as icons, the
// extra places a project's own favicon is looked for, and the new Utseende settings.
// Only the demo model; no real API is called.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isProjectIcon, MAX_PROJECT_ICON_BYTES, PROJECT_COLORS, suggestMonogram } from "../../shared/protocol.ts";
import { FAVICON_DIRS, FAVICON_NAMES } from "../src/favicon.ts";
import { startHarness, tempDir } from "./helpers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#c8663a"/></svg>';
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(30, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(30, 3)]);
const UUID = "0b2f6a3c-9d1e-4f7a-8c5b-1a2b3c4d5e6f";

const upload = (h: any, id: string, mime: string, bytes: Buffer | string) =>
  h.raw("POST", `/api/projects/${id}/icon`, { headers: JSON_HEADERS, body: JSON.stringify({ mime, data: Buffer.from(bytes).toString("base64") }) });

test("project palette: the eight old ids are unchanged and the new ones are accepted", async (t) => {
  const old = ["orange", "red", "yellow", "green", "teal", "blue", "purple", "gray"];
  assert.deepEqual(PROJECT_COLORS.slice(0, 8).map((c) => c.id), old);
  assert.ok(PROJECT_COLORS.length >= 16 && PROJECT_COLORS.length <= 18, `${PROJECT_COLORS.length} colours`);
  for (const id of ["amber", "lime", "emerald", "cyan", "sky", "indigo", "violet", "fuchsia", "pink", "rose"]) assert.ok(PROJECT_COLORS.some((c) => c.id === id), id);
  assert.equal(new Set(PROJECT_COLORS.map((c) => c.id)).size, PROJECT_COLORS.length, "no id twice");
  assert.equal(new Set(PROJECT_COLORS.map((c) => c.label)).size, PROJECT_COLORS.length, "no name twice");
  const h = await startHarness(t);
  const project = await h.project();
  for (const color of PROJECT_COLORS) assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { color: color.id })).color, color.id);
  const res = await h.raw("PATCH", `/api/projects/${project.id}`, { headers: JSON_HEADERS, body: JSON.stringify({ color: "turkis" }) });
  assert.equal(res.status, 400);
});

test("isProjectIcon: icons, emoji, monograms of one to three characters, and file names", () => {
  for (const ok of ["folder", "rocket", "emoji:🚀", "mono:A", "mono:EM", "mono:AD1", "mono:Øk", "mono:字", `file:${UUID}.png`, `file:${UUID}.svg`, `file:${UUID}.ico`, `file:${UUID}.webp`]) assert.equal(isProjectIcon(ok), true, ok);
  for (const bad of ["mono:", "mono:ABCD", "mono:a b", "mono:<b>", "mono:A-", "mono:💥", "file:", "file:x.png", `file:${UUID}.gif`, `file:${UUID}.png.exe`, `file:../${UUID}.png`, `file:${UUID.toUpperCase()}.png`, "ukjent"]) assert.equal(isProjectIcon(bad), false, bad);
});

test("suggestMonogram: the first letters of the words, or the first two of one word", () => {
  assert.equal(suggestMonogram("Min Nettbutikk"), "MN");
  assert.equal(suggestMonogram("Agentic Desktop App"), "ADA");
  assert.equal(suggestMonogram("Agentic Desktop App Extra"), "ADA");
  assert.equal(suggestMonogram("rakett"), "RA");
  assert.equal(suggestMonogram("æøå-prosjekt"), "ÆP");
  assert.equal(suggestMonogram("  --  "), "");
});

test("project icons: a monogram is saved and checked, an unknown file is not accepted", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { icon: "mono:EM", color: "pink" })).icon, "mono:EM");
  assert.equal((await h.api("GET", "/api/bootstrap")).projects[0].icon, "mono:EM");
  for (const bad of ["mono:EMIL", "mono:<i>", "mono:", `file:${UUID}.png`]) {
    const res = await h.raw("PATCH", `/api/projects/${project.id}`, { headers: JSON_HEADERS, body: JSON.stringify({ icon: bad }) });
    assert.equal(res.status, 400, `icon ${bad}`);
  }
  assert.equal((await h.api("GET", "/api/bootstrap")).projects[0].icon, "mono:EM", "unchanged after the refusals");
});

test("an uploaded icon: stored in the data folder, served safely, replaced and removed with the project", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const folder = path.join(h.app.config.dataDir, "project-icons");

  // Nothing yet.
  assert.equal((await h.raw("GET", `/api/projects/${project.id}/icon`)).status, 404);

  const first = await upload(h, project.id, "image/png", PNG);
  assert.equal(first.status, 200);
  const updated = JSON.parse(first.body);
  assert.match(updated.icon, /^file:[0-9a-f-]{36}\.png$/);
  assert.equal(isProjectIcon(updated.icon), true);
  const file = path.join(folder, updated.icon.slice(5));
  assert.ok(existsSync(file), "kept under project-icons/ in the data folder");

  const served = await h.raw("GET", `/api/projects/${project.id}/icon?v=1`);
  assert.equal(served.status, 200);
  assert.equal(served.headers["content-type"], "image/png");
  assert.equal(served.headers["x-content-type-options"], "nosniff");
  assert.match(String(served.headers["content-security-policy"]), /default-src 'none'/);
  assert.match(String(served.headers["content-security-policy"]), /sandbox/);
  assert.equal(Number(served.headers["content-length"]), PNG.length);

  // A second image replaces the first, and the first file is gone.
  const second = JSON.parse((await upload(h, project.id, "image/svg+xml", SVG)).body);
  assert.match(second.icon, /\.svg$/);
  assert.equal(existsSync(file), false, "the old file is removed");
  const svg = await h.raw("GET", `/api/projects/${project.id}/icon`);
  assert.equal(svg.headers["content-type"], "image/svg+xml");
  assert.equal(svg.body, SVG);
  assert.match(String(svg.headers["content-security-policy"]), /sandbox/);

  // The setting can name that file, and nothing else.
  assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { icon: second.icon })).icon, second.icon);
  const missing = await h.raw("PATCH", `/api/projects/${project.id}`, { headers: JSON_HEADERS, body: JSON.stringify({ icon: `file:${UUID}.png` }) });
  assert.equal(missing.status, 400);

  // Choosing another icon takes the image away.
  const svgFile = path.join(folder, second.icon.slice(5));
  assert.ok(existsSync(svgFile));
  assert.equal((await h.api("PATCH", `/api/projects/${project.id}`, { icon: "mono:AB" })).icon, "mono:AB");
  assert.equal(existsSync(svgFile), false);
  assert.equal((await h.raw("GET", `/api/projects/${project.id}/icon`)).status, 404, "no file icon, nothing to serve");

  // DELETE goes back to the default, and the project's removal cleans up too.
  const ico = JSON.parse((await upload(h, project.id, "image/x-icon", ICO)).body);
  assert.match(ico.icon, /\.ico$/);
  const reset = await h.api("DELETE", `/api/projects/${project.id}/icon`);
  assert.equal(reset.icon, null);
  assert.deepEqual(readdirSync(folder), []);
  const webp = JSON.parse((await upload(h, project.id, "image/webp", WEBP)).body);
  assert.equal(readdirSync(folder).length, 1);
  assert.ok(webp.icon.endsWith(".webp"));
  await h.api("DELETE", `/api/projects/${project.id}`);
  assert.deepEqual(readdirSync(folder), [], "removed with the project");
});

test("an uploaded icon: only small, real images of the four types", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const cases: Array<[string, string, Buffer | string, number]> = [
    ["a GIF", "image/gif", PNG, 415],
    ["a JPEG", "image/jpeg", PNG, 415],
    ["PNG bytes that say SVG", "image/svg+xml", PNG, 415],
    ["SVG text that says PNG", "image/png", SVG, 415],
    ["an SVG with a script", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 415],
    ["an SVG with an event handler", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', 415],
    ["an SVG with a foreignObject", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>', 415],
    ["an empty file", "image/png", Buffer.alloc(0), 400],
    ["too many bytes", "image/png", Buffer.concat([PNG, Buffer.alloc(MAX_PROJECT_ICON_BYTES)]), 413],
  ];
  for (const [name, mime, bytes, status] of cases) assert.equal((await upload(h, project.id, mime, bytes)).status, status, name);
  const noData = await h.raw("POST", `/api/projects/${project.id}/icon`, { headers: JSON_HEADERS, body: JSON.stringify({ mime: "image/png" }) });
  assert.equal(noData.status, 400);
  const noMime = await h.raw("POST", `/api/projects/${project.id}/icon`, { headers: JSON_HEADERS, body: JSON.stringify({ data: PNG.toString("base64") }) });
  assert.equal(noMime.status, 415);
  assert.equal((await upload(h, "finnes-ikke", "image/png", PNG)).status, 404);
  assert.equal((await h.api("GET", "/api/bootstrap")).projects[0].icon, null, "nothing was saved");
  // The biggest allowed file goes through.
  const biggest = Buffer.concat([PNG, Buffer.alloc(MAX_PROJECT_ICON_BYTES - PNG.length, 7)]);
  assert.equal((await upload(h, project.id, "image/png", biggest)).status, 200);
});

test("project favicons: the extra places, and the same safety as before", async (t) => {
  assert.deepEqual(FAVICON_NAMES, ["favicon.ico", "favicon.svg", "favicon.png", "icon.svg", "icon.png", "apple-touch-icon.png", "logo.svg", "logo.png", "pack.png"]);
  assert.deepEqual(FAVICON_DIRS, ["", "public", "static", "assets", "src", "src/assets", "app", "web/public", "web/src/assets", "desktop/build", "resources"]);
  const h = await startHarness(t);
  // Each place and name on its own: found, with the right type.
  const places: Array<[string, string]> = [["web/public", "favicon.ico"], ["web/src/assets", "icon.png"], ["desktop/build", "icon.png"], ["resources", "apple-touch-icon.png"], ["src/assets", "logo.svg"], ["", "pack.png"], ["public", "logo.png"]];
  for (const [dir, name] of places) {
    const root = tempDir(t);
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, name), name.endsWith(".svg") ? SVG : name.endsWith(".ico") ? ICO : PNG);
    const project = await h.project(root);
    const list = await h.api("GET", "/api/favicons");
    assert.equal(typeof list[project.id], "number", `${dir}/${name}`);
    const res = await h.raw("GET", `/api/projects/${project.id}/favicon`);
    assert.equal(res.status, 200, `${dir}/${name}`);
    assert.equal(res.headers["content-type"], name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".ico") ? "image/x-icon" : "image/png");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(String(res.headers["content-security-policy"]), /sandbox/);
  }
  // The folder itself goes before the deeper ones.
  const both = tempDir(t);
  mkdirSync(path.join(both, "resources"));
  writeFileSync(path.join(both, "resources/favicon.svg"), SVG);
  writeFileSync(path.join(both, "pack.png"), PNG);
  const project = await h.project(both);
  assert.equal((await h.raw("GET", `/api/projects/${project.id}/favicon`)).headers["content-type"], "image/png");
  // A link out of the folder is still not followed, in the new places too.
  const outside = tempDir(t);
  writeFileSync(path.join(outside, "hemmelig.png"), "hemmelig");
  const linked = tempDir(t);
  mkdirSync(path.join(linked, "web/public"), { recursive: true });
  symlinkSync(path.join(outside, "hemmelig.png"), path.join(linked, "web/public/favicon.png"));
  const linkedProject = await h.project(linked);
  assert.equal((await h.raw("GET", `/api/projects/${linkedProject.id}/favicon`)).status, 404);
});

test("Utseende: contrast, chat width and formulas are saved, checked and reset", async (t) => {
  const h = await startHarness(t);
  const saved = await h.api("PATCH", "/api/settings", { uiContrast: 110, chatWidth: "wide", renderMath: false });
  assert.deepEqual([saved.uiContrast, saved.chatWidth, saved.renderMath], [110, "wide", false]);
  assert.deepEqual([(await h.api("GET", "/api/bootstrap")).settings.chatWidth, (await h.api("GET", "/api/bootstrap")).settings.renderMath], ["wide", false]);
  for (const body of [{ uiContrast: 112 }, { uiContrast: 70 }, { uiContrast: "100" }, { chatWidth: "enorm" }, { renderMath: "ja" }]) {
    const res = await h.raw("PATCH", "/api/settings", { headers: JSON_HEADERS, body: JSON.stringify(body) });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const reset = await h.api("PATCH", "/api/settings", { uiContrast: null, chatWidth: null, renderMath: null });
  assert.deepEqual([reset.uiContrast, reset.chatWidth, reset.renderMath], [undefined, undefined, undefined]);
  for (const preset of ["ocean", "rosa", "skog", "glod", "iris"]) assert.equal((await h.api("PATCH", "/api/settings", { themePreset: preset })).themePreset, preset);
});
