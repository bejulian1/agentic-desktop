// v1.4.0: a project's own app icon is found without the user picking one. Declared icons (an
// index.html <link rel="icon">, a web manifest, package.json build.icon) go first, then the table
// of usual places, now with app icon folders such as desktop/icons. Only temp folders; nothing
// outside them is read.
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cleanIconHref, FAVICON_DIRS, FAVICON_NAMES, findFavicon, forgetFavicon, htmlIconHrefs, manifestIconSrcs, MAX_FAVICON_BYTES, packageIconPaths } from "../src/favicon.ts";
import { tempDir } from "./helpers.ts";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#3b6fc4"/></svg>';

function put(root: string, rel: string, data: string | Buffer): string {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

// Each call looks again: the 30 second cache is keyed by path, so every test uses a fresh time.
let clock = 1_000_000_000;
function find(root: string) {
  forgetFavicon(root);
  clock += 60_000;
  return findFavicon(root, clock);
}

test("favicon table: the old places keep their order and the app icon places are added after", () => {
  assert.deepEqual(FAVICON_NAMES.slice(0, 9), ["favicon.ico", "favicon.svg", "favicon.png", "icon.svg", "icon.png", "apple-touch-icon.png", "logo.svg", "logo.png", "pack.png"]);
  assert.deepEqual(FAVICON_DIRS.slice(0, 11), ["", "public", "static", "assets", "src", "src/assets", "app", "web/public", "web/src/assets", "desktop/build", "resources"]);
  for (const dir of ["desktop/icons", "desktop/icons/png", "src-tauri/icons", "build", "icons", "assets/icons", "images", "img", "web/dist", "client/public", "frontend/public"]) assert.ok(FAVICON_DIRS.includes(dir), dir);
  for (const name of ["app-icon.svg", "app-icon.png", "app.svg", "app.png", "agentic-desktop.svg", "app-128.png", "app-64.png", "app-32.png", "icon-192.png", "icon-512.png", "favicon.webp", "icon.webp", "logo.webp"]) assert.ok(FAVICON_NAMES.includes(name), name);
  assert.equal(new Set(FAVICON_DIRS).size, FAVICON_DIRS.length, "no folder twice");
  assert.equal(new Set(FAVICON_NAMES).size, FAVICON_NAMES.length, "no name twice");
});

test("favicon: an app icon in desktop/icons and a webp icon are found with their type", (t) => {
  const root = tempDir(t);
  const file = put(root, "desktop/icons/agentic-desktop.svg", SVG);
  const found = find(root);
  assert.equal(found?.file, file);
  assert.equal(found?.type, "image/svg+xml");

  const tauri = tempDir(t);
  put(tauri, "src-tauri/icons/app-128.png", PNG);
  assert.equal(find(tauri)?.type, "image/png");

  const webp = tempDir(t);
  put(webp, "images/logo.webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]));
  assert.equal(find(webp)?.type, "image/webp");
});

test("favicon: index.html <link rel=icon> wins over the table, and / resolves to public/", (t) => {
  const root = tempDir(t);
  put(root, "favicon.ico", PNG); // in the table, but not the one the page declares
  put(root, "index.html", '<!doctype html><html><head><link rel="apple-touch-icon" href="/apple.png"><link href="/brand/mark.svg?v=3" rel="icon" type="image/svg+xml"></head></html>');
  const declared = put(root, "public/brand/mark.svg", SVG);
  put(root, "public/apple.png", PNG);
  assert.equal(find(root)?.file, declared, "rel=icon goes before apple-touch-icon and the table");

  // A page in web/ with a relative href, and the Create React App placeholder.
  const web = tempDir(t);
  put(web, "web/index.html", "<link rel='shortcut icon' href='%PUBLIC_URL%/app.png'>");
  const app = put(web, "web/public/app.png", PNG);
  assert.equal(find(web)?.file, app);

  // When the declared file is missing, the table still answers.
  const missing = tempDir(t);
  put(missing, "index.html", '<link rel="icon" href="/nowhere.svg">');
  const fallback = put(missing, "assets/icons/icon.png", PNG);
  assert.equal(find(missing)?.file, fallback);
});

test("favicon: web manifest icons (largest first) and package.json build.icon", (t) => {
  const root = tempDir(t);
  put(root, "public/manifest.json", JSON.stringify({ icons: [{ src: "icons/small.png", sizes: "48x48" }, { src: "icons/big.png", sizes: "512x512" }] }));
  put(root, "public/icons/small.png", PNG);
  const big = put(root, "public/icons/big.png", PNG);
  assert.equal(find(root)?.file, big);

  const pkg = tempDir(t);
  put(pkg, "package.json", JSON.stringify({ name: "x", build: { icon: "art/appicon" } }));
  const icon = put(pkg, "art/appicon.png", PNG);
  assert.equal(find(pkg)?.file, icon, "an icon without its extension");

  const dir = tempDir(t);
  put(dir, "package.json", JSON.stringify({ build: { linux: { icon: "art/linux" } } }));
  const sized = put(dir, "art/linux/256x256.png", PNG);
  assert.equal(find(dir)?.file, sized, "a folder of sizes");
});

test("favicon: declared paths and links never leave the project, and big files are skipped", (t) => {
  const outside = tempDir(t);
  const secret = put(outside, "secret.png", PNG);

  // A ../ path in index.html, an absolute file URL, and a remote address are all ignored.
  const climb = tempDir(t);
  put(climb, "index.html", `<link rel="icon" href="../${path.basename(outside)}/secret.png"><link rel="icon" href="file://${secret}"><link rel="icon" href="https://example.invalid/x.png">`);
  put(climb, "package.json", JSON.stringify({ build: { icon: `../${path.basename(outside)}/secret.png` } }));
  put(climb, "manifest.json", JSON.stringify({ icons: [{ src: `../${path.basename(outside)}/secret.png` }] }));
  assert.equal(find(climb), null);

  // A symlink in desktop/icons that leads out is skipped.
  const linked = tempDir(t);
  mkdirSync(path.join(linked, "desktop/icons"), { recursive: true });
  symlinkSync(secret, path.join(linked, "desktop/icons/app-icon.png"));
  assert.equal(find(linked), null);

  // A declared icon that is a symlink out is skipped too, and the table is used.
  const declaredLink = tempDir(t);
  put(declaredLink, "index.html", '<link rel="icon" href="/linked.png">');
  symlinkSync(secret, path.join(declaredLink, "linked.png"));
  assert.equal(find(declaredLink), null);

  // An index.html that is itself a symlink out of the project is not read.
  const htmlLink = tempDir(t);
  put(outside, "index.html", '<link rel="icon" href="inside.png">');
  symlinkSync(path.join(outside, "index.html"), path.join(htmlLink, "index.html"));
  put(htmlLink, "inside.png", PNG);
  assert.equal(find(htmlLink), null, "inside.png is not in the table, and the outside page is never read");

  // Over the cap: skipped, wherever it is.
  const big = tempDir(t);
  put(big, "index.html", '<link rel="icon" href="/huge.png">');
  put(big, "huge.png", Buffer.alloc(MAX_FAVICON_BYTES + 1, 1));
  put(big, "desktop/icons/app-icon.png", Buffer.alloc(MAX_FAVICON_BYTES + 1, 1));
  assert.equal(find(big), null);
  // Exactly the cap is fine.
  const edge = tempDir(t);
  put(edge, "icons/icon.png", Buffer.alloc(MAX_FAVICON_BYTES, 1));
  assert.equal(find(edge)?.size, MAX_FAVICON_BYTES);
});

test("favicon: the lookup is cached for 30 seconds", (t) => {
  const root = tempDir(t);
  const now = 5_000_000_000;
  forgetFavicon(root);
  assert.equal(findFavicon(root, now), null);
  put(root, "icons/icon.svg", SVG);
  assert.equal(findFavicon(root, now + 10_000), null, "still the cached answer");
  assert.equal(findFavicon(root, now + 31_000)?.type, "image/svg+xml", "looked up again");
});

test("favicon parsers: hrefs, manifests and package.json", () => {
  assert.deepEqual(htmlIconHrefs('<LINK REL="Shortcut Icon" HREF="a.ico"><link rel=icon href=b.svg><link rel="stylesheet" href="c.css"><link rel="apple-touch-icon" href="d.png">'), ["b.svg", "a.ico", "d.png"]);
  assert.deepEqual(manifestIconSrcs('{"icons":[{"src":"a.png","sizes":"16x16"},{"src":"b.svg"},{"src":"c.png","sizes":"192x192"},{"nope":1}]}'), ["b.svg", "c.png", "a.png"]);
  assert.deepEqual(manifestIconSrcs("not json"), []);
  assert.deepEqual(packageIconPaths('{"build":{"icon":"build/icon.png","mac":{"icon":"build/icon.icns"}}}'), ["build/icon.png", "build/icon.icns"]);
  assert.deepEqual(packageIconPaths('{"name":"x"}'), []);
  for (const bad of ["https://x/y.png", "//cdn/x.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "file:///etc/passwd", ""]) assert.equal(cleanIconHref(bad), null, bad);
  assert.equal(cleanIconHref("/favicon.svg?v=2#x"), "/favicon.svg");
  assert.equal(cleanIconHref("%PUBLIC_URL%/favicon.ico"), "/favicon.ico");
  assert.equal(cleanIconHref("icons/my%20icon.png"), "icons/my icon.png");
});
