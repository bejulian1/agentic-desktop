import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { approveUntil, openProject, flow, send, waitFor } from "./harness.ts";

flow("/, @ og ! i meldingsfeltet, med en skill", async (h) => {
  const { page } = h;
  mkdirSync(path.join(h.projectDir, ".agentic/skills/hils"), { recursive: true });
  writeFileSync(path.join(h.projectDir, ".agentic/skills/hils/SKILL.md"), "---\nname: hils\ndescription: Hilser pent på brukeren\n---\nSi hei.\n");
  mkdirSync(path.join(h.projectDir, "dokumenter"));
  writeFileSync(path.join(h.projectDir, "notater.txt"), "Viktige notater\n");
  writeFileSync(path.join(h.projectDir, "dokumenter/plan.md"), "# Plan\n");
  const project = await openProject(h);
  const other = await h.createThread(project.id);
  await h.api("PATCH", `/api/threads/${other.id}`, { title: "Annen tråd" });

  const box = page.getByLabel("Melding");
  const menu = page.getByTestId("composer-menu");

  // /
  await box.click();
  await page.keyboard.type("/");
  await menu.waitFor();
  // The English names; the Norwegian aliases are not shown, but typing them still finds the command.
  for (const name of ["/new", "/mode", "/model", "/compact", "/undo", "/playtest", "/vscode", "/help", "/hils"]) {
    await menu.getByText(name, { exact: true }).waitFor();
  }
  await page.keyboard.type("hils");
  await waitFor(async () => (await menu.locator(".menu-item").count()) === 1, "menyen filtreres mens du skriver");
  await page.keyboard.press("Escape");
  await waitFor(async () => (await menu.count()) === 0, "Escape lukker menyen");

  await box.fill("");
  await page.keyboard.type("/hj");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Hjelp" }).waitFor();
  await page.getByRole("dialog", { name: "Hjelp" }).getByRole("button", { name: "Lukk" }).click();

  // Arrow keys and a skill.
  await box.click();
  await page.keyboard.type("/hils");
  await menu.locator(".menu-item.selected", { hasText: "/hils" }).waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".chip-skill", { hasText: "/hils" }).waitFor();
  await page.keyboard.type("verden");
  await page.keyboard.press("Enter");
  await page.locator(".user-text", { hasText: "/hils verden" }).waitFor();
  const threadId = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
  assert.ok(threadId);
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");

  // @ with a file, a folder and a thread.
  await box.click();
  await page.keyboard.type("se på @not");
  await menu.getByText("notater.txt").waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".composer .chip", { hasText: "notater.txt" }).waitFor();
  assert.equal(await box.inputValue(), "se på ");
  await page.keyboard.type("@dok");
  await menu.getByText("dokumenter/", { exact: true }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await menu.locator(".menu-item.selected", { hasText: "dokumenter/" }).waitFor();
  await page.keyboard.press("Enter");
  await page.keyboard.type("@Annen");
  await menu.getByText("Annen tråd").waitFor();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".composer .chip").count(), 3);
  await page.keyboard.press("Enter");
  const sent = page.locator(".row-user").last();
  await sent.locator(".chip", { hasText: "notater.txt" }).waitFor();
  await sent.locator(".chip", { hasText: "dokumenter" }).waitFor();
  await sent.locator(".chip", { hasText: "Annen tråd" }).waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");

  // !
  await box.click();
  await page.keyboard.type("!echo hallo-fra-shell");
  await menu.getByText("Kjør kommandoen i prosjektmappen").waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".user-text", { hasText: "!echo hallo-fra-shell" }).waitFor();
  await page.getByRole("button", { name: "Tillat", exact: true }).click();
  const tool = page.locator('.row-tool[data-tool="run_command"]').last();
  await waitFor(async () => (await tool.getAttribute("data-status")) === "done", "kommandoen er ferdig");
  await tool.locator(".tool-head").click();
  await tool.locator(".tool-output", { hasText: "hallo-fra-shell" }).waitFor();

  // Built-in commands.
  await box.click();
  await page.keyboard.type("/modus");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await page.getByRole("button", { name: "Kode", exact: true }).click();

  await page.getByLabel("Melding").click();
  await page.keyboard.type("/modell");
  await page.keyboard.press("Enter");
  await page.getByRole("listbox", { name: "Modeller" }).waitFor();
  await page.keyboard.press("Escape");

  await page.getByLabel("Melding").click();
  await page.keyboard.type("/ny");
  await page.keyboard.press("Enter");
  await page.getByTestId("pane-empty").waitFor();
});

flow("/angre og /komprimer virker fra meldingsfeltet", async (h) => {
  const { page } = h;
  await openProject(h);
  await send(page, "lag en side");
  await approveUntil(page, async () => (await page.getByText("Ferdig. ").count()) > 0, "siden er laget");
  await page.getByLabel("Melding").click();
  await page.keyboard.type("/angre");
  await page.keyboard.press("Enter");
  await page.locator(".row-changes .changes-reverted").waitFor();
  await page.getByLabel("Melding").click();
  await page.keyboard.type("/komprimer");
  await page.keyboard.press("Enter");
  await page.locator(".row-line", { hasText: "Konteksten ble komprimert" }).waitFor({ timeout: 10_000 });
});
