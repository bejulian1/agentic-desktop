// v1.2.0: richer project icons. A wider palette, monogram badges and uploaded images as icons, the
// extra places a project's own favicon is looked for, and the new Utseende settings.
// v1.3.0: Innstillinger → Prosjekter as in T3 Code (archive, effort and workspace for new threads,
// project actions) and the Typografi settings.
// Only the demo model; no real API is called.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cleanProjectActions, isProjectIcon, MAX_PROJECT_ACTIONS, MAX_PROJECT_ICON_BYTES, PROJECT_COLORS, suggestMonogram } from "../../shared/protocol.ts";
import { FAVICON_DIRS, FAVICON_NAMES } from "../src/favicon.ts";
import { startHarness, tempDir, until } from "./helpers.ts";

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

const refused = async (h: any, method: string, url: string, body: unknown) => (await h.raw(method, url, { headers: JSON_HEADERS, body: JSON.stringify(body) })).status;
const action = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Handling ${id}`, command: `echo ${id}`, ...extra });

test("Prosjekter: archive, effort and workspace for new threads are saved, checked and sent with every project", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  // The defaults, always present.
  assert.equal(project.archived, false);
  assert.equal(project.defaultReasoningEffort, null);
  assert.equal(project.defaultWorkspaceMode, "local");
  assert.deepEqual(project.actions, []);

  const updated = await h.api("PATCH", `/api/projects/${project.id}`, { archived: true, defaultReasoningEffort: "high", defaultWorkspaceMode: "worktree" });
  assert.deepEqual([updated.archived, updated.defaultReasoningEffort, updated.defaultWorkspaceMode], [true, "high", "worktree"]);
  const listed = (await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.id === project.id);
  assert.deepEqual([listed.archived, listed.defaultReasoningEffort, listed.defaultWorkspaceMode], [true, "high", "worktree"], "kept, and archived projects are still listed");
  // An archived project keeps its threads and can be restored.
  const thread = await h.thread(project.id);
  assert.ok((await h.api("GET", "/api/bootstrap")).threads.some((x: any) => x.id === thread.id));
  const restored = await h.api("PATCH", `/api/projects/${project.id}`, { archived: false, defaultReasoningEffort: null, defaultWorkspaceMode: "local" });
  assert.deepEqual([restored.archived, restored.defaultReasoningEffort, restored.defaultWorkspaceMode], [false, null, "local"]);

  for (const body of [{ archived: "ja" }, { archived: null }, { defaultReasoningEffort: "ultra" }, { defaultReasoningEffort: 3 }, { defaultWorkspaceMode: "sky" }, { defaultWorkspaceMode: null }]) {
    assert.equal(await refused(h, "PATCH", `/api/projects/${project.id}`, body), 400, JSON.stringify(body));
  }
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.id === project.id).archived, false, "unchanged after the refusals");
});

test("Prosjekter: new Kode threads start with the project's effort, or else the app's default", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { defaultReasoningEffort: "max" });
  assert.equal((await h.thread(project.id)).reasoning, "max");
  // The app's default reaches projects without their own, and Denne datamaskinen.
  await h.api("PATCH", "/api/settings", { defaultReasoningEffort: "low" });
  const plain = await h.project();
  assert.equal((await h.thread(plain.id)).reasoning, "low");
  assert.equal((await h.thread(null, "code")).reasoning, "low");
  assert.equal((await h.thread(project.id)).reasoning, "max", "the project's own goes first");
  // Chat is not Kode.
  assert.equal((await h.thread(null, "chat")).reasoning, null);
  // Reset: the model's own effort again.
  assert.equal((await h.api("PATCH", "/api/settings", { defaultReasoningEffort: null })).defaultReasoningEffort, undefined);
  assert.equal((await h.thread(plain.id)).reasoning, null);
  assert.equal(await refused(h, "PATCH", "/api/settings", { defaultReasoningEffort: "enorm" }), 400);
});

test("project actions: validation of names, commands, ids and shortcuts", () => {
  assert.deepEqual(cleanProjectActions([]), []);
  assert.deepEqual(
    cleanProjectActions([{ id: "a1", name: "  Test ", command: "npm test\r\n", shortcut: "Mod+Shift+T", runOnWorktreeCreate: true }, { id: "b2", name: "Bygg", command: "npm run build", shortcut: "", runOnWorktreeCreate: false }]),
    [{ id: "a1", name: "Test", command: "npm test", shortcut: "Mod+Shift+T", runOnWorktreeCreate: true }, { id: "b2", name: "Bygg", command: "npm run build" }],
    "trimmed, and empty or false fields left out",
  );
  const bad: unknown[] = [
    "ikke en liste",
    [null],
    [{ id: "", name: "x", command: "y" }],
    [{ id: "a b", name: "x", command: "y" }],
    [action("a"), action("a")],
    [{ id: "a", name: " ", command: "y" }],
    [{ id: "a", name: "x".repeat(61), command: "y" }],
    [{ id: "a", name: "x\u0007", command: "y" }],
    [{ id: "a", name: "x", command: "" }],
    [{ id: "a", name: "x", command: "y".repeat(4001) }],
    [action("a", { shortcut: "T" })],
    [action("a", { shortcut: "Mod+" })],
    [action("a", { shortcut: 5 })],
    [action("a", { shortcut: "Mod+T" }), action("b", { shortcut: "Mod+T" })],
    [action("a", { runOnWorktreeCreate: "ja" })],
    Array.from({ length: MAX_PROJECT_ACTIONS + 1 }, (_, i) => action(`a${i}`)),
  ];
  for (const value of bad) assert.equal(typeof cleanProjectActions(value), "string", JSON.stringify(value).slice(0, 80));
});

test("project actions: saved, changed and removed per project, and refused when invalid", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const saved = await h.api("PATCH", `/api/projects/${project.id}`, { actions: [action("test", { shortcut: "Mod+Shift+T" }), action("build", { runOnWorktreeCreate: true })] });
  assert.deepEqual(saved.actions.map((a: any) => a.id), ["test", "build"]);
  assert.equal(saved.actions[0].shortcut, "Mod+Shift+T");
  assert.equal(saved.actions[1].runOnWorktreeCreate, true);
  // Change one, remove the other.
  const changed = await h.api("PATCH", `/api/projects/${project.id}`, { actions: [{ ...saved.actions[0], name: "Kjør testene", command: "npm test -- --watch=false" }] });
  assert.deepEqual(changed.actions, [{ id: "test", name: "Kjør testene", command: "npm test -- --watch=false", shortcut: "Mod+Shift+T" }]);
  assert.deepEqual((await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.id === project.id).actions, changed.actions);
  for (const actions of [[action("x"), action("x")], [{ id: "x", name: "", command: "ls" }], "ls", [action("x", { shortcut: "Q" })]]) {
    assert.equal(await refused(h, "PATCH", `/api/projects/${project.id}`, { actions }), 400, JSON.stringify(actions));
  }
  assert.deepEqual((await h.api("PATCH", `/api/projects/${project.id}`, { actions: [] })).actions, []);
  // Another project has its own.
  const other = await h.project();
  assert.deepEqual(other.actions, []);
});

test("project actions run only as saved, in a new terminal tab in the project folder", async (t) => {
  const home = tempDir(t, "ad-home-");
  const h = await startHarness(t, { homeDir: home });
  const socket = await h.socket();
  const project = await h.project(undefined, { actions: [{ id: "write", name: "Skriv fil", command: "printf 'svar-%s' $((40+2)) > action-ut.txt" }] });
  const started = await h.api("POST", `/api/projects/${project.id}/actions/write/run`);
  assert.equal(started.title, "Skriv fil");
  await until(() => existsSync(path.join(project.path, "action-ut.txt")) && readFileSync(path.join(project.path, "action-ut.txt"), "utf8") === "svar-42", "the command ran in the project folder");
  const message = await socket.waitFor((m) => m.type === "terminal.started" && m.terminalId === started.terminalId);
  assert.equal((message as any).projectId, project.id);
  assert.ok((await h.api("GET", `/api/projects/${project.id}/terminals`)).some((x: any) => x.terminalId === started.terminalId && x.title === "Skriv fil"));
  // Only a saved action, never a command from the request.
  assert.equal(await refused(h, "POST", `/api/projects/${project.id}/actions/missing/run`, { command: "touch nei" }), 404);
  assert.equal(existsSync(path.join(project.path, "nei")), false);

  // Denne datamaskinen: actions in the settings, run in the home folder.
  const settings = await h.api("PATCH", "/api/settings", { localActions: [{ id: "home", name: "Hjem", command: "touch hjemme.txt" }] });
  assert.equal(settings.localActions.length, 1);
  await h.api("POST", "/api/projects/local/actions/home/run");
  await until(() => existsSync(path.join(home, "hjemme.txt")), "the local action ran in the home folder");
  assert.equal(await refused(h, "PATCH", "/api/settings", { localActions: [{ id: "x", name: "", command: "ls" }] }), 400);
  assert.equal((await h.api("PATCH", "/api/settings", { localActions: [] })).localActions, undefined, "an empty list is left out");
});

test("a new worktree gets the project's actions, and runs the ones marked for new worktrees", async (t) => {
  const root = tempDir(t, "ad-git-actions-");
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  for (const name of Object.keys(env)) if (/^GIT_/i.test(name) && !["GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT"].includes(name)) delete env[name as keyof typeof env];
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-b", "main");
  writeFileSync(path.join(repo, "README.md"), "hei\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "initial");

  const h = await startHarness(t);
  const project = await h.project(repo, {
    defaultReasoningEffort: "high",
    defaultWorkspaceMode: "worktree",
    actions: [{ id: "setup", name: "Oppsett", command: "touch oppsett-kjort.txt", runOnWorktreeCreate: true }, { id: "test", name: "Test", command: "touch test-kjort.txt" }],
  });
  const result = await h.api("POST", `/api/projects/${project.id}/git/worktrees`, { branch: "funksjon", path: path.join(root, "funksjon") });
  assert.deepEqual(result.project.actions.map((a: any) => a.id), ["setup", "test"]);
  assert.equal(result.project.defaultReasoningEffort, "high");
  assert.equal(result.project.defaultWorkspaceMode, "local", "a worktree starts its own threads where it is");
  assert.equal(result.actionsStarted, 1);
  await until(() => existsSync(path.join(result.project.path, "oppsett-kjort.txt")), "the setup action ran in the new worktree");
  assert.equal(existsSync(path.join(result.project.path, "test-kjort.txt")), false, "only the marked action runs");
  assert.equal(existsSync(path.join(repo, "oppsett-kjort.txt")), false, "and not in the source checkout");
});

test("Typografi: the interface font and the code fonts are checked and reset", async (t) => {
  const h = await startHarness(t);
  for (const uiFont of ["inter", "ubuntu", "noto", "system"]) assert.equal((await h.api("PATCH", "/api/settings", { uiFont })).uiFont, uiFont);
  assert.equal((await h.api("PATCH", "/api/settings", { codeFont: "liberation" })).codeFont, "liberation");
  for (const body of [{ uiFont: "comic" }, { uiFont: 1 }, { codeFont: "papyrus" }]) assert.equal(await refused(h, "PATCH", "/api/settings", body), 400, JSON.stringify(body));
  const reset = await h.api("PATCH", "/api/settings", { uiFont: null, codeFont: null });
  assert.deepEqual([reset.uiFont, reset.codeFont], [undefined, undefined]);
});
