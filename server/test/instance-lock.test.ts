// Issue #8: the data folder is reserved exclusively from before SQLite opens until after SQLite closes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { startApp } from "../src/app.ts";
import { claimDataDir, DataDirInUse, INSTANCE_FILE, INSTANCE_LOCK_FILE, liveInstance } from "../src/instance.ts";
import { MemoryKeyring } from "../src/keyring.ts";
import { tempDir } from "./helpers.ts";

function isolatedAppOptions(t: TestContext, dataDir: string, extra: Record<string, unknown> = {}) {
  const root = tempDir(t, "ad-iso-");
  return {
    dataDir,
    port: 0,
    keyring: new MemoryKeyring(),
    mockDelayMs: 0,
    configDir: path.join(root, "config"),
    userSkillsDir: path.join(root, "user-skills"),
    appSkillsDir: path.join(root, "app-skills"),
    homeDir: path.join(root, "home"),
    localWorkspace: false,
    seedDefaults: false,
    ...extra,
  };
}

function spawnStartAttempt(dataDir: string, shell: "electron" | "localhost", extraEnv: Record<string, string> = {}) {
  const script = `
    import { startApp } from "./server/src/app.ts";
    import { MemoryKeyring } from "./server/src/keyring.ts";
    import path from "node:path";
    const dataDir = process.env.TEST_DATA_DIR;
    const iso = process.env.TEST_ISO_DIR;
    try {
      const app = await startApp({
        dataDir,
        port: 0,
        keyring: new MemoryKeyring(),
        mockDelayMs: 0,
        configDir: path.join(iso, "config"),
        userSkillsDir: path.join(iso, "user-skills"),
        appSkillsDir: path.join(iso, "app-skills"),
        homeDir: path.join(iso, "home"),
        localWorkspace: false,
        seedDefaults: false,
      });
      process.stdout.write(JSON.stringify({ ok: true, port: app.port, pid: process.pid }) + "\\n");
      process.on("SIGTERM", async () => {
        await app.close();
        process.exit(0);
      });
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, code: err?.code ?? null, message: err?.message ?? String(err) }) + "\\n");
      process.exit(2);
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AD_SHELL: shell,
      AD_KEYRING: "memory",
      TEST_DATA_DIR: dataDir,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let errOut = "";
  const firstLine = new Promise<{ ok: boolean; port?: number; pid?: number; code?: string | null; message?: string }>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
      const nl = out.indexOf("\n");
      if (nl !== -1) {
        try {
          resolve(JSON.parse(out.slice(0, nl)));
        } catch (err) {
          reject(new Error(`Invalid JSON from child: ${out}\nstderr: ${errOut}`));
        }
      }
    });
    child.stderr.on("data", (chunk) => (errOut += chunk.toString()));
    child.once("exit", (code) => {
      if (!out.includes("\n")) reject(new Error(`Child exited (${code}) without output. stderr: ${errOut}`));
    });
  });
  return { child, firstLine };
}

test("samtidig oppstart i skrivebords- og localhost-modus slipper bare én server inn i datamappen", async (t) => {
  const dataDir = tempDir(t, "ad-lock-race-");
  const isoA = tempDir(t, "ad-iso-a-");
  const isoB = tempDir(t, "ad-iso-b-");
  const a = spawnStartAttempt(dataDir, "electron", { TEST_ISO_DIR: isoA });
  const b = spawnStartAttempt(dataDir, "localhost", { TEST_ISO_DIR: isoB });
  t.after(async () => {
    for (const proc of [a.child, b.child]) {
      if (proc.exitCode === null && proc.pid) {
        const done = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
        proc.kill("SIGTERM");
        await Promise.race([done, new Promise((r) => setTimeout(r, 5000))]);
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }
    }
  });

  const [resA, resB] = await Promise.all([a.firstLine, b.firstLine]);
  const winners = [resA, resB].filter((r) => r.ok);
  const losers = [resA, resB].filter((r) => !r.ok);
  assert.equal(winners.length, 1, `nøyaktig én server skal vinne, fikk: ${JSON.stringify([resA, resB])}`);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].code, "EDATAINUSE");
  assert.ok(existsSync(path.join(dataDir, INSTANCE_LOCK_FILE)));
  const live = await liveInstance(dataDir);
  assert.equal(live?.pid, winners[0].pid);
});

test("samtidig startApp i samme prosess slipper bare én server inn", async (t) => {
  const dataDir = tempDir(t, "ad-lock-sameproc-");
  const alias = path.join(tempDir(t, "ad-lock-alias-"), "data");
  symlinkSync(dataDir, alias);
  const optsA = isolatedAppOptions(t, dataDir);
  const optsB = isolatedAppOptions(t, alias);
  const [a, b] = await Promise.allSettled([startApp(optsA), startApp(optsB)]);
  const fulfilled = [a, b].filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof startApp>>> => r.status === "fulfilled");
  const rejected = [a, b].filter((r): r is PromiseRejectedResult => r.status === "rejected");
  t.after(async () => {
    for (const r of fulfilled) await r.value.close();
  });
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof DataDirInUse);
  assert.equal((rejected[0].reason as DataDirInUse).code, "EDATAINUSE");
});

test("datamappen forblir reservert under hele avslutningen til etter at databasen er lukket", async (t) => {
  const dataDir = tempDir(t, "ad-lock-shutdown-");
  const app = await startApp(isolatedAppOptions(t, dataDir));
  const origShutdown = app.runner.shutdown.bind(app.runner);
  const origStoreClose = app.store.close.bind(app.store);
  let enteredShutdown!: () => void;
  let releaseShutdown!: () => void;
  const shutdownStarted = new Promise<void>((resolve) => (enteredShutdown = resolve));
  const shutdownGate = new Promise<void>((resolve) => (releaseShutdown = resolve));

  app.runner.shutdown = async () => {
    enteredShutdown();
    await shutdownGate;
    await origShutdown();
  };
  app.store.close = () => {
    const probe = new DatabaseSync(path.join(dataDir, INSTANCE_LOCK_FILE));
    try {
      assert.throws(() => probe.exec("BEGIN EXCLUSIVE"), { errcode: 5 });
    } finally {
      probe.close();
      origStoreClose();
    }
  };

  const closePromise = app.close();
  await shutdownStarted;

  try {
    assert.ok(existsSync(path.join(dataDir, INSTANCE_FILE)), "instance.json ligger fremdeles under avslutning");
    await assert.rejects(claimDataDir(dataDir), DataDirInUse);
  } finally {
    releaseShutdown();
  }
  await closePromise;

  assert.equal(existsSync(path.join(dataDir, INSTANCE_FILE)), false, "instance.json er fjernet etter avslutning");

  const next = await startApp(isolatedAppOptions(t, dataDir));
  t.after(() => next.close());
  assert.ok(next.port > 0);
});

test("feil før serveren lytter frigir reservasjonen så neste oppstart lykkes", async (t) => {
  const dataDir = tempDir(t, "ad-lock-fail-");
  const blocker = net.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const busyPort = (blocker.address() as net.AddressInfo).port;
  t.after(() => new Promise<void>((resolve) => blocker.close(() => resolve())));

  await assert.rejects(startApp(isolatedAppOptions(t, dataDir, { port: busyPort })), (err: NodeJS.ErrnoException) => err.code === "EADDRINUSE");
  assert.equal(existsSync(path.join(dataDir, INSTANCE_FILE)), false, "instance.json ble ikke liggende");

  const app = await startApp(isolatedAppOptions(t, dataDir));
  t.after(() => app.close());
  assert.ok(app.port > 0);
});

test("en krasjet server slipper låsen selv om PID og port i metadata er gjenbrukt", async (t) => {
  const dataDir = tempDir(t, "ad-lock-stale-");
  const crash = spawnStartAttempt(dataDir, "electron", { TEST_ISO_DIR: tempDir(t, "ad-crash-iso-") });
  const exited = once(crash.child, "exit");
  t.after(async () => {
    if (crash.child.exitCode === null && crash.child.signalCode === null) crash.child.kill("SIGKILL");
    await exited;
  });
  assert.equal((await crash.firstLine).ok, true);
  assert.equal(await liveInstance(dataDir).then((owner) => owner?.pid), crash.child.pid);
  crash.child.kill("SIGKILL");
  await exited;
  assert.ok(existsSync(path.join(dataDir, INSTANCE_FILE)));
  assert.equal(await liveInstance(dataDir), null);

  const unrelated = net.createServer();
  await new Promise<void>((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => unrelated.close(() => resolve())));
  writeFileSync(
    path.join(dataDir, INSTANCE_FILE),
    `${JSON.stringify({ pid: process.ppid, port: (unrelated.address() as net.AddressInfo).port, shell: "electron", locked: true })}\n`,
    { mode: 0o600 },
  );
  assert.equal(await liveInstance(dataDir), null);

  const app = await startApp(isolatedAppOptions(t, dataDir));
  t.after(() => app.close());
  assert.ok(app.port > 0);
});

test("låsen slippes først etter at databasen er lukket selv om en opprydding feiler", async (t) => {
  const dataDir = tempDir(t, "ad-lock-close-error-");
  const app = await startApp(isolatedAppOptions(t, dataDir));
  const shutdown = app.runner.shutdown.bind(app.runner);
  app.runner.shutdown = async () => {
    await shutdown();
    throw new Error("testfeil under avslutning");
  };
  await assert.rejects(app.close(), { name: "AggregateError" });
  assert.throws(() => app.store.projects(), { code: "ERR_INVALID_STATE" });
  const next = await startApp(isolatedAppOptions(t, dataDir));
  t.after(() => next.close());
  assert.ok(next.port > 0);
});

test("en eldre server som fortsatt lytter beholder datamappen", async (t) => {
  const dataDir = tempDir(t, "ad-lock-legacy-");
  const legacy = net.createServer();
  await new Promise<void>((resolve) => legacy.listen(0, "127.0.0.1", resolve));
  const port = (legacy.address() as net.AddressInfo).port;
  t.after(() => new Promise<void>((resolve) => legacy.close(() => resolve())));
  writeFileSync(path.join(dataDir, INSTANCE_FILE), JSON.stringify({ pid: process.ppid, port, shell: "localhost" }));
  await assert.rejects(startApp(isolatedAppOptions(t, dataDir)), DataDirInUse);
  assert.equal((await liveInstance(dataDir))?.port, port);
});
