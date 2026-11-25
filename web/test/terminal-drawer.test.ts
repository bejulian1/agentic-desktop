import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Locator, Page } from "playwright-core";
import type { DrawerTerminal, Project } from "../../shared/protocol.ts";
import { flow, openProject, openTool, waitFor } from "./harness.ts";

const terminal = (page: Page) => page.getByTestId("drawer-terminal");
const drawer = (page: Page) => page.getByTestId("terminal-drawer");
const toggle = (page: Page) => page.getByTestId("terminal-drawer-toggle");
const tabs = (page: Page) => drawer(page).getByTestId("terminal-drawer-tab");
const rows = (host: Locator) => host.locator(".xterm-rows > div");

async function focusedTerminal(page: Page): Promise<void> {
  await waitFor(() => terminal(page).locator("textarea:focus").count().then((count) => count === 1), "terminalen har fokus");
}

async function seesLine(host: Locator, expected: string): Promise<void> {
  await waitFor(() => rows(host).evaluateAll((lines, expected) =>
    lines.some((line) => line.textContent?.trim() === expected), expected), `terminalen viser ${expected}`);
}

async function runLine(page: Page, command: string, expected: string): Promise<void> {
  await focusedTerminal(page);
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await seesLine(terminal(page), expected);
}

flow("terminalfeltet åpner under meldingsfeltet og beholder skall og faner", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const projectTerminals = () => h.api<DrawerTerminal[]>("GET", `/api/projects/${project.id}/terminal-drawer`);
  const composer = page.locator(".pane-inner.focused .composer");
  await composer.waitFor();
  assert.equal(await page.locator(".topbar").getByTestId("terminal-drawer-toggle").count(), 1);
  assert.match(await toggle(page).getAttribute("title") ?? "", /Ctrl\+J/);
  await toggle(page).click();
  await terminal(page).waitFor();
  assert.equal(await toggle(page).getAttribute("aria-pressed"), "true");

  const geometry = await drawer(page).evaluate((el) => {
    const main = el.closest(".main")!;
    const composer = main.querySelector(".pane-inner.focused .composer")!.getBoundingClientRect();
    const drawer = el.getBoundingClientRect();
    return { composerBottom: composer.bottom, drawerTop: drawer.top, drawerBottom: drawer.bottom, mainBottom: main.getBoundingClientRect().bottom };
  });
  assert.ok(geometry.composerBottom <= geometry.drawerTop, "terminalfeltet ligger nedenfor meldingsfeltet");
  assert.equal(geometry.drawerBottom, geometry.mainBottom, "terminalfeltet ligger nederst i arbeidsområdet");

  await runLine(page, "pwd; echo drawer-ok; export DRAWER_PROBE=drawer-alive", "drawer-ok");
  await seesLine(terminal(page), h.projectDir);
  const first = await terminal(page).getAttribute("data-terminal-id");

  // The shortcut must reach the app even when xterm owns the keyboard.
  await page.keyboard.press("Control+J");
  await drawer(page).waitFor({ state: "detached" });
  assert.equal(await toggle(page).getAttribute("aria-pressed"), "false");
  assert.equal((await projectTerminals())[0].terminalId, first);
  await composer.locator("textarea").focus();
  await page.keyboard.press("Control+J");
  await terminal(page).waitFor();
  assert.equal(await terminal(page).getAttribute("data-terminal-id"), first);
  await seesLine(terminal(page), "drawer-ok");
  await runLine(page, 'echo "$DRAWER_PROBE"', "drawer-alive");

  await drawer(page).getByRole("button", { name: "Ny terminal" }).click();
  await tabs(page).nth(1).waitFor();
  const second = await waitForNewTerminal(page, first);
  await focusedTerminal(page);
  assert.equal((await projectTerminals()).length, 2);

  const split = drawer(page).getByRole("button", { name: "Del terminalfeltet" });
  await split.click();
  await waitFor(async () => (await terminal(page).count()) === 2, "to terminaler er synlige");
  await terminal(page).first().locator("textarea").focus();
  assert.equal(await tabs(page).first().getAttribute("aria-pressed"), "true");
  await split.click();
  await waitFor(async () => (await terminal(page).count()) === 1, "en terminal er synlig");

  await drawer(page).locator(".terminal-drawer-tab").nth(1).getByRole("button", { name: "Lukk terminalen" }).click();
  await tabs(page).nth(1).waitFor({ state: "detached" });
  assert.deepEqual((await projectTerminals()).map((tab) => tab.terminalId), [first], `PTY ${second} er lukket`);

  await page.keyboard.press("Control+,");
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  await drawer(page).waitFor({ state: "detached" });
  await page.keyboard.press("Control+,");
  await terminal(page).waitFor();
  assert.equal(await terminal(page).getAttribute("data-terminal-id"), first);
  await drawer(page).getByRole("button", { name: "Skjul terminalfeltet" }).click();
  await drawer(page).waitFor({ state: "detached" });
  assert.equal((await projectTerminals()).length, 1);

  await openTool(page, "Terminal");
  const sideTerminal = page.getByTestId("terminal");
  await sideTerminal.waitFor();
  const sideId = await sideTerminal.getAttribute("data-terminal-id");
  assert.notEqual(sideId, first);
  await sideTerminal.locator("textarea").focus();
  await page.keyboard.press("Control+J");
  await terminal(page).waitFor();
  assert.equal(await terminal(page).getAttribute("data-terminal-id"), first);
  const panelSessions = await h.api<Array<{ terminalId: string }>>("GET", `/api/projects/${project.id}/terminals?surface=panel`);
  assert.deepEqual(panelSessions.map((session) => session.terminalId), [sideId]);
}, { env: { SHELL: "/bin/bash" } });

async function waitForNewTerminal(page: Page, previous: string | null): Promise<string> {
  const active = terminal(page);
  await waitFor(async () => {
    if ((await active.count()) !== 1) return false;
    return (await active.getAttribute("data-terminal-id")) !== previous;
  }, "den nye fanen er valgt");
  return (await active.getAttribute("data-terminal-id"))!;
}

async function ptySize(page: Page, tag: string): Promise<number[]> {
  const pattern = new RegExp(`^${tag}:(\\d+) (\\d+)\\s*$`);
  const output = rows(terminal(page)).filter({ hasText: pattern });
  await focusedTerminal(page);
  await page.keyboard.type(`printf '${tag}:%s\\n' "$(stty size)"`);
  await page.keyboard.press("Enter");
  await output.waitFor();
  return (await output.innerText()).match(pattern)!.slice(1).map(Number);
}

flow("terminalfeltet husker høyden og bruker hjemmemappen og arbeidstreet", async (h) => {
  const { page } = h;
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Kommandopalett" });
  await palette.getByRole("textbox").fill("terminalfeltet");
  await palette.getByText("Vis eller skjul terminalfeltet", { exact: true }).click();
  await terminal(page).waitFor();
  await runLine(page, "pwd", h.home);

  const height = async () => Math.round((await drawer(page).boundingBox())!.height);
  const handle = drawer(page).getByRole("separator");
  const start = (await handle.boundingBox())!;
  const point = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  assert.equal(await height(), 240);
  const [rowsBefore, colsBefore] = await ptySize(page, "drawer-before");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y - 90, { steps: 6 });
  await page.mouse.up();
  assert.equal(await height(), 330);
  const [rowsAfter, colsAfter] = await ptySize(page, "drawer-after");
  assert.ok(rowsAfter > rowsBefore);
  assert.equal(colsAfter, colsBefore);
  await page.setViewportSize({ width: 1200, height: 860 });
  const [rowsAfterWindow, colsAfterWindow] = await ptySize(page, "drawer-window");
  assert.equal(rowsAfterWindow, rowsAfter);
  assert.ok(colsAfterWindow < colsAfter);
  await toggle(page).click();
  await drawer(page).waitFor({ state: "detached" });
  await toggle(page).click();
  await terminal(page).waitFor();
  assert.equal(await height(), 330);
  await drawer(page).getByRole("button", { name: "Maksimer" }).click();
  assert.ok(await height() > 330);
  await drawer(page).getByRole("button", { name: "Gjenopprett" }).click();
  assert.equal(await height(), 330);
  await handle.dblclick();
  assert.equal(await height(), 240);

  const project = await openProject(h);
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: h.projectDir,
    env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  git("init", "-q");
  git("-c", "user.name=Drawer Test", "-c", "user.email=drawer@example.invalid", "commit", "-q", "--allow-empty", "-m", "Test");
  const result = await h.api<{ project: Project; worktreePath: string }>(
    "POST", `/api/projects/${project.id}/git/worktrees`, { branch: "drawer-test", path: path.join(h.home, "checkout") },
  );
  await page.locator(`.group[data-project="${result.project.name}"] .group-title`).first().click();
  await waitFor(async () => (await terminal(page).count()) === 1 &&
    (await tabs(page).first().getAttribute("title"))?.endsWith(result.worktreePath) === true, "fanen åpner seg i arbeidstreet");
  await runLine(page, "pwd", result.worktreePath);
}, { env: { SHELL: "/bin/bash" } });
