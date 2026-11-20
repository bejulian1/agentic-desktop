// Round 15 (SPEC 31.2): the React preview in the packaged app. The package carries its own copy of
// React and the runtime that turns JSX into JavaScript (resources/app-root/web/dist/preview-runtime),
// and a React artifact from the demo model runs in the artifact panel with no network. The package
// has the Node inspector switched off, so the test reaches the window over the DevTools protocol,
// as scripts/perf-desktop.ts does, and stops the app by its PID.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { alive, assertOffScreen, descendants, PACKAGED, sandbox, waitFor } from "./helpers.ts";

const RUNTIME = path.join(path.dirname(PACKAGED), "resources/app-root/web/dist/preview-runtime");

test("den pakkede appen har React-kjøretiden, og en React-artifact kjører i panelet uten nett", { skip: existsSync(PACKAGED) ? false : "dist-desktop/linux-unpacked mangler; kjør npm run dist først" }, async () => {
  assertOffScreen();
  // What the import map points at, and the chunks they share: all in the package.
  const files = readdirSync(RUNTIME);
  for (const name of ["boot.js", "react.js", "react-dom.js", "react-dom-client.js", "jsx-runtime.js"]) assert.ok(files.includes(name), `${name} er med i pakken`);
  assert.ok(files.every((name) => name.endsWith(".js")), "bare JavaScript");
  for (const name of files) assert.doesNotMatch(readFileSync(path.join(RUNTIME, name), "utf8"), /https?:\/\/(unpkg|cdn|esm\.sh|jsdelivr)/i, `${name} henter ingenting fra nettet`);

  const box = sandbox();
  const env = { ...box.env };
  delete env.AD_WEB_DIST; // the package's own web/dist
  const child = spawn(PACKAGED, ["--ozone-platform=headless", "--ozone-override-screen-size=1600,1000", "--remote-debugging-port=0"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout!.on("data", (chunk) => (out += chunk));
  child.stderr!.on("data", (chunk) => (out += chunk));
  const pid = child.pid!;
  let tree: number[] = [];
  try {
    await waitFor(() => out.includes("Agentic Desktop er klar."), `grensesnittet er lastet:\n${out.slice(-2000)}`, 60_000);
    tree = descendants(pid);
    const instance = JSON.parse(readFileSync(path.join(box.dataDir, "instance.json"), "utf8"));
    const port = Number(readFileSync(path.join(box.dataDir, "electron/DevToolsActivePort"), "utf8").split("\n")[0]);
    // Left open: the app is stopped below by its PID, and the connection goes with it.
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
    {
      const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(`http://127.0.0.1:${instance.port}/`));
      assert.ok(page, "appens vindu");
      const requests: string[] = [];
      page.context().on("request", (request) => requests.push(request.url()));

      await page.locator(".pane-inner.focused textarea").fill("lag en react-artifact");
      await page.locator(".pane-inner.focused textarea").press("Enter");
      const iframe = page.locator(".artifact-panel iframe");
      await iframe.waitFor({ timeout: 30_000 });
      const src = new URL((await iframe.getAttribute("src"))!);
      assert.equal(src.hostname, "localhost");
      assert.notEqual(src.port, String(instance.port), "forhåndsvisningen har sin egen origin");
      assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts allow-modals allow-forms");
      const frame = page.frameLocator(".artifact-panel iframe");
      await frame.locator("#igjen").getByText("2 igjen av 3").waitFor({ timeout: 30_000 });
      await frame.getByLabel("Ny oppgave").fill("Pakke appen");
      await frame.getByRole("button", { name: "Legg til" }).click();
      await frame.locator("#igjen").getByText("3 igjen av 4").waitFor();
      const outside = requests.filter((url) => !/^(http:\/\/(127\.0\.0\.1|localhost):\d+\/|blob:|data:|devtools:|chrome)/.test(url));
      assert.deepEqual(outside, [], "ingen nettkall ut av maskinen");
      assert.ok(requests.some((url) => /\/_rt\/react\.js$/.test(url)), "React kom fra pakken, via forhåndsvisningsserveren");
    }

    const exited = new Promise((resolve) => child.once("exit", resolve));
    process.kill(pid, "SIGTERM");
    await exited;
    const all = [pid, ...tree];
    await waitFor(() => all.every((p) => !alive(p)), "alt er stoppet", 15_000);
  } finally {
    if (alive(pid)) process.kill(pid, "SIGKILL");
    box.cleanup();
  }
});
