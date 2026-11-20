// The packaged app, installed into a temporary HOME and started with the Exec line of its .desktop
// file, the way GNOME does it from the app library (desktop/test/gnome.ts says why the other tests
// did not see the crash of 6 November 2026).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { profileLoaded } from "../sandbox.ts";
import { assertOffScreen, ROOT, sandbox, waitFor, type Sandbox } from "./helpers.ts";
import { assertAllGone, gnomeEnv, install, labelOf, packaged, processesFrom, restricted, startLikeGnome, stopLeftovers, waitForReady, type Installed, type Started } from "./gnome.ts";

const skip = packaged ? false : "dist-desktop/linux-unpacked mangler; kjør npm run dist først";

test("appen starter fra appbiblioteket uten AppArmor-profilen", { skip }, async () => {
  assertOffScreen();
  const box = sandbox();
  let installed: Installed | undefined;
  try {
    installed = install(box);
    const started = startLikeGnome(installed, gnomeEnv(box));
    await waitForReady(started);
    if (restricted()) assert.equal(labelOf(started.pid), "unconfined", "som fra GNOME");
    assert.doesNotMatch(started.output(), /FATAL|SUID sandbox|No usable sandbox/);

    const exited = started.exited;
    process.kill(started.pid, "SIGTERM"); // logging out
    assert.equal((await exited).code, 0);
    await assertAllGone(installed, box, "etter SIGTERM");
  } finally {
    if (installed) stopLeftovers(installed);
    box.cleanup();
  }
});

// The processes of a running app by kind, with what the kernel says about their sandbox.
function kinds(installed: Installed) {
  return processesFrom(installed.opt).map(({ pid, cmd }) => {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const args = ` ${cmd} `;
    return {
      pid,
      type: / --type=([\w-]+)/.exec(args)?.[1] ?? "main",
      noSandbox: args.includes(" --no-sandbox "),
      seccomp: Number(/^Seccomp:\s+(\d)/m.exec(status)?.[1] ?? -1),
    };
  });
}

async function quit(started: Started, installed: Installed, box: Sandbox): Promise<void> {
  const exited = started.exited;
  process.kill(started.pid, "SIGTERM");
  assert.equal((await exited).code, 0);
  await assertAllGone(installed, box, "etter SIGTERM");
}

const status = (installed: Installed, label: string, file = "agentic-desktop") =>
  execFileSync("aa-exec", ["-p", label, "--", path.join(installed.opt, file), "--sandbox-status"], { encoding: "utf8" }).trim();

// Once the user has loaded the profile, this machine no longer has the case (a temporary HOME is
// outside the profile's path, and the app then says that instead).
const noProfile = !restricted() ? "AppArmor-regelen for brukernavnerom er av her" : profileLoaded() ? "AppArmor-profilen er lastet på denne maskinen" : false;

test("uten profilen: uten sandkasse, og nettleserpanelet går til serverens Chrome", { skip: skip || noProfile }, async () => {
  assertOffScreen();
  const box = sandbox();
  let installed: Installed | undefined;
  try {
    installed = install(box);
    assert.equal(status(installed, "unconfined"), "sandkasse: av (AppArmor-profilen for Agentic Desktop mangler)");
    // The Exec line of bygg 29 goes through the same script (bygg 28's is the one above: GNOME Shell
    // kept starting that after the update, straight into Chromium's FATAL, on 8 November 2026).
    assert.equal(status(installed, "unconfined", "agentic-desktop-start"), "sandkasse: av (AppArmor-profilen for Agentic Desktop mangler)");
    assert.match(installed.installOutput, /uten Chromium-sandkassen[\s\S]*sudo install -m 644 .*resources\/apparmor\/agentic-desktop \/etc\/apparmor\.d\/agentic-desktop/);
    const started = startLikeGnome(installed, gnomeEnv(box));
    await waitForReady(started);
    assert.match(started.output(), /Uten Chromium-sandkassen: Chromium-sandkassen er av fordi AppArmor-profilen for Agentic Desktop mangler\./);
    let all: ReturnType<typeof kinds> = [];
    await waitFor(() => (all = kinds(installed!)).some((p) => p.type === "renderer") && all.some((p) => p.type === "utility"), "renderer og server");
    const main = all.find((p) => p.type === "main")!;
    assert.ok(main.noSandbox, "startskriptet la til --no-sandbox");
    for (const renderer of all.filter((p) => p.type === "renderer")) assert.equal(renderer.seccomp, 0, "rendereren er uten sandkasse");
    // The server gets AD_BROWSER_PANEL=chrome: no web page runs in Electron. (A utility process
    // gets its environment after it starts, so /proc/<pid>/environ does not show it; the server says it.)
    assert.match(started.output(), /Nettleserpanelet bruker serverens headless Chrome/);
    await quit(started, installed, box);
  } finally {
    if (installed) stopLeftovers(installed);
    box.cleanup();
  }
});

// No profile can be loaded without root. A label whose profile allows user namespaces stands in for
// it: the script inherits it, as the app would get its own profile, and the sandbox is on as before.
test("med en AppArmor-profil som gir brukernavnerom: sandkassen er på", { skip }, async () => {
  assertOffScreen();
  const box = sandbox();
  let installed: Installed | undefined;
  try {
    installed = install(box);
    assert.match(status(installed, "chrome"), /^sandkasse: på/);
    const started = startLikeGnome(installed, gnomeEnv(box), { label: "chrome" });
    await waitForReady(started);
    assert.doesNotMatch(started.output(), /Uten Chromium-sandkassen/);
    let all: ReturnType<typeof kinds> = [];
    await waitFor(() => (all = kinds(installed!)).some((p) => p.type === "renderer"), "rendereren");
    assert.ok(!all.some((p) => p.noSandbox), "ingen --no-sandbox");
    for (const renderer of all.filter((p) => p.type === "renderer")) assert.equal(renderer.seccomp, 2, "rendereren er i sandkassen (seccomp)");
    assert.doesNotMatch(started.output(), /Nettleserpanelet bruker serverens headless Chrome/, "panelet er i vinduet som før");
    await quit(started, installed, box);
  } finally {
    if (installed) stopLeftovers(installed);
    box.cleanup();
  }
});

// The Chrome the server starts for the Browser panel (browser.ts) and for web search (web-browser.ts):
// channel "chrome" with chromiumSandbox, from a process that is plain "unconfined" like the server is
// when GNOME starts the app. Google Chrome has an AppArmor profile of its own and a setuid helper.
test("serverens Chrome for panelet og nettsøket har sandkasse også uten appens profil", { skip: process.env.AD_SKIP_CHROME ? "AD_SKIP_CHROME" : false }, () => {
  const box = sandbox();
  try {
    const env = { ...box.env };
    delete env.DISPLAY;
    const command = [process.execPath, path.join(ROOT, "desktop/test/chrome-sandbox-probe.ts")];
    const out = restricted() ? execFileSync("aa-exec", ["-p", "unconfined", "--", ...command], { env, encoding: "utf8", timeout: 60_000 }) : execFileSync(command[0], command.slice(1), { env, encoding: "utf8", timeout: 60_000 });
    const result = JSON.parse(out.trim().split("\n").at(-1)!) as { label: string; renderers: Array<{ exe: string; noSandboxSwitch: boolean; seccomp: number; ownUserNamespace: boolean }> };
    if (restricted()) assert.equal(result.label, "unconfined");
    assert.ok(result.renderers.length > 0, "fant renderere");
    for (const renderer of result.renderers) {
      assert.equal(renderer.noSandboxSwitch, false);
      assert.equal(renderer.seccomp, 2, "seccomp-filteret er på");
      assert.ok(renderer.ownUserNamespace, "eget brukernavnerom");
    }
  } finally {
    box.cleanup();
  }
});
