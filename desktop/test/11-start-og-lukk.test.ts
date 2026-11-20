// Start and close the packaged app again and again, the way the user does it from the app library
// (SPEC 29.2): Ctrl+Q, the close button without and with the status area, a second start while it
// runs, and SIGKILL followed by a new start. After every run nothing of the app may run any more and
// no lock may be left. The app is installed once into a temporary HOME and started with the Exec
// line of its .desktop file, as plain "unconfined" like GNOME does (desktop/test/gnome.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { alive, assertOffScreen, killKnown, sandbox, waitFor, type Sandbox } from "./helpers.ts";
import {
  assertAllGone,
  closeWindow,
  gnomeEnv,
  install,
  leftovers,
  packaged,
  pressKeys,
  processesFrom,
  restricted,
  shownWindows,
  startLikeGnome,
  stopLeftovers,
  waitForReady,
  type Installed,
  type Started,
  appWindows,
} from "./gnome.ts";

const skip = packaged ? false : "dist-desktop/linux-unpacked mangler; kjør npm run dist først";

async function windowShown(started: Started): Promise<number> {
  let id = 0;
  await waitFor(() => {
    const shown = shownWindows(started.pid);
    if (shown.length === 1) id = shown[0].id;
    return shown.length === 1;
  }, "ett vindu vises", 30_000);
  return id;
}

async function exitsCleanly(started: Started, what: string): Promise<void> {
  const result = await Promise.race([started.exited, new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000))]);
  assert.ok(result, `${what}: appen avsluttet ikke`);
  assert.equal(result.code, 0, `${what}: avslutningskode\n${started.output().slice(-2000)}`);
}

// A start from the app library while the app runs: it hands over to the running one and ends.
async function secondStart(installed: Installed, env: Record<string, string>): Promise<void> {
  const second = startLikeGnome(installed, env);
  await exitsCleanly(second, "den andre starten");
  assert.ok(!second.output().includes("Agentic Desktop er klar."), "den andre starten laget ikke noe eget");
}

let runs = 0;
let starts = 0;

test("start og lukk den pakkede appen igjen og igjen", { skip, timeout: 15 * 60_000 }, async (t) => {
  assertOffScreen();
  const box: Sandbox = sandbox();
  const installed = install(box);
  const plain = gnomeEnv(box); // no AD_DESKTOP_TRAY: the app checks the session bus, which leads nowhere
  const tray = gnomeEnv(box, { AD_DESKTOP_TRAY: "on" });
  const start = (env: Record<string, string>) => {
    starts += 1;
    return startLikeGnome(installed, env);
  };
  const ready = async (env: Record<string, string>) => {
    const started = start(env);
    await waitForReady(started);
    if (restricted()) assert.match(started.output(), /Uten Chromium-sandkassen/, "uten profilen startet appen uten sandkassen");
    return started;
  };
  const finish = async (what: string) => {
    runs += 1;
    await assertAllGone(installed, box, what);
  };

  try {
    await t.test("Ctrl+Q avslutter", async () => {
      for (let i = 1; i <= 4; i++) {
        const app = await ready(plain);
        pressKeys(await windowShown(app), "ctrl+q");
        await exitsCleanly(app, `Ctrl+Q ${i}`);
        await finish(`Ctrl+Q ${i}`);
      }
    });

    await t.test("X uten statusfelt avslutter", async () => {
      for (let i = 1; i <= 4; i++) {
        const app = await ready(plain);
        closeWindow(await windowShown(app));
        await exitsCleanly(app, `X ${i}`);
        await finish(`X uten statusfelt ${i}`);
      }
    });

    await t.test("X med statusfelt skjuler, og en ny start fra appbiblioteket viser vinduet igjen", async () => {
      for (let i = 1; i <= 3; i++) {
        const app = await ready(tray);
        const id = await windowShown(app);
        const before = processesFrom(installed.opt).map((p) => p.pid).sort();
        closeWindow(id);
        await waitFor(() => shownWindows(app.pid).length === 0, "vinduet er skjult", 10_000);
        assert.ok(alive(app.pid), "appen kjører videre i statusfeltet");
        starts += 1;
        await secondStart(installed, tray);
        assert.equal(await windowShown(app), id, "det samme vinduet kommer tilbake");
        assert.equal(appWindows(app.pid).length, 1, "ett vindu");
        assert.deepEqual(processesFrom(installed.opt).map((p) => p.pid).sort(), before, "ingen ny prosess");
        pressKeys(id, "ctrl+q");
        await exitsCleanly(app, `statusfelt ${i}`);
        await finish(`X med statusfelt ${i}`);
      }
    });

    await t.test("en start mens appen kjører gir ett vindu og ingen ny prosess", async () => {
      for (let i = 1; i <= 2; i++) {
        const app = await ready(plain);
        const id = await windowShown(app);
        const before = processesFrom(installed.opt).map((p) => p.pid).sort();
        starts += 1;
        await secondStart(installed, plain);
        assert.equal(shownWindows(app.pid).length, 1, "fortsatt ett vindu");
        assert.deepEqual(processesFrom(installed.opt).map((p) => p.pid).sort(), before, "ingen ny prosess");
        pressKeys(id, "ctrl+q");
        await exitsCleanly(app, `andre start ${i}`);
        await finish(`andre start ${i}`);
      }
    });

    await t.test("SIGKILL av hovedprosessen, og neste start virker", async () => {
      for (let i = 1; i <= 2; i++) {
        const app = await ready(plain);
        await windowShown(app);
        killKnown(app.pid, new RegExp(`^${installed.opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/agentic-desktop-bin `));
        assert.equal((await app.exited).signal, "SIGKILL");
        // What the app had started ends by itself without its parent.
        await waitFor(() => processesFrom(installed.opt).length === 0, `ingen prosesser igjen etter SIGKILL (${processesFrom(installed.opt).map((p) => p.cmd.slice(0, 100)).join("; ")})`, 20_000);
        assert.ok(leftovers(box).includes("instance.json"), "instance.json ble liggende, som etter et krasj");
        runs += 1;

        // The next start is not stopped by what the killed one left behind.
        const next = await ready(plain);
        pressKeys(await windowShown(next), "ctrl+q");
        await exitsCleanly(next, `start etter SIGKILL ${i}`);
        await finish(`etter SIGKILL ${i}`);
      }
    });
  } finally {
    stopLeftovers(installed);
    console.log(`Kjøringer: ${runs}, starter: ${starts}`);
    box.cleanup();
  }
  assert.ok(runs >= 15, `minst 15 kjøringer (${runs})`);
});
