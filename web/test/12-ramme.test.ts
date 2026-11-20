import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

flow("menyikonet med undermenyer, Chat og Kode i sidefanen, tilbake og frem, og festet sammendrag", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  const first = await h.createThread(project.id);
  await h.api("PATCH", `/api/threads/${first.id}`, { title: "Første" });
  const second = await h.createThread(project.id);
  await h.api("PATCH", `/api/threads/${second.id}`, { title: "Andre" });

  await threadItem(page, first.id).click();
  await page.locator(`.pane-inner.focused[data-thread-id="${first.id}"]`).waitFor();
  await threadItem(page, second.id).click();
  await page.locator(`.pane-inner.focused[data-thread-id="${second.id}"]`).waitFor();
  await page.getByRole("button", { name: "Forrige tråd" }).click();
  await page.locator(`.pane-inner.focused[data-thread-id="${first.id}"]`).waitFor();
  await page.keyboard.press("Alt+ArrowRight");
  await page.locator(`.pane-inner.focused[data-thread-id="${second.id}"]`).waitFor();

  // The menu icon: Vis opens on hover, and Mørkt tema is a real action.
  await page.getByRole("button", { name: "Meny" }).click();
  await page.getByRole("menuitem", { name: "Vis", exact: true }).hover();
  await page.getByRole("menu", { name: "Vis" }).getByRole("menuitemcheckbox", { name: "Mørkt tema" }).click();
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "mørkt tema");
  assert.equal(await page.getByRole("menu", { name: "Meny" }).count(), 0, "menyen lukkes");
  // Hjelp → Hurtigtaster lists the keys.
  await page.getByRole("button", { name: "Meny" }).click();
  await page.getByRole("menuitem", { name: "Hjelp", exact: true }).hover();
  await page.getByRole("menu", { name: "Hjelp" }).getByRole("menuitemcheckbox", { name: "Hurtigtaster" }).click();
  await page.getByRole("dialog", { name: "Hurtigtaster" }).getByText("Ny rute").waitFor();
  await page.keyboard.press("Escape");

  // Chat and Kode sit at the top of the sidebar, and in the thin row of icons when it is closed
  // (round 10, SPEC 23.9; in a narrow window they move to the top bar).
  await page.locator(".sidebar-mode").getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
  await page.getByRole("navigation", { name: "Snarveier" }).getByRole("button", { name: "Kode" }).click();
  await page.getByRole("button", { name: "Kode", exact: true, pressed: true }).waitFor();
  // Round 11 (SPEC 24.1): the row has its own button, so the top bar has none while the row shows.
  assert.equal(await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).count(), 0, "ikke to knapper for sidefanen");
  await page.getByRole("navigation", { name: "Snarveier" }).getByRole("button", { name: "Vis sidefanen" }).click();
  await page.locator(`.pane-inner.focused[data-thread-id="${second.id}"]`).waitFor();

  // /goal fills the pinned summary, and the sidebar switch hides it.
  await send(page, "/goal Lag en kalkulator");
  await page.getByTestId("goal-composer").getByText("Lag en kalkulator").waitFor();
  await page.getByTestId("pinned-summary").waitFor();
  // Round 11: the switch is in ⋯ Flere valg in the top bar.
  const summary = async () => {
    await page.getByRole("button", { name: "Flere valg" }).click();
    await page.getByRole("menuitemcheckbox", { name: /^Festet sammendrag/ }).click();
  };
  await summary();
  await waitFor(async () => (await page.getByTestId("pinned-summary").count()) === 0, "sammendraget er skjult");
  await summary();
  await page.getByTestId("pinned-summary").waitFor();
});

flow("nye kommandoer: /plan, /status, /fork, /side, $skill og en Demo", async (h) => {
  const { page } = h;
  mkdirSync(path.join(h.projectDir, ".agentic/skills/hils"), { recursive: true });
  writeFileSync(path.join(h.projectDir, ".agentic/skills/hils/SKILL.md"), "---\nname: hils\ndescription: Hilser pent\n---\nSi hei.\n");
  await openProject(h);
  const box = page.getByLabel("Melding");

  await send(page, "/plan");
  await page.locator(".composer .pill", { hasText: "Plan" }).waitFor();
  await send(page, "lag en side");
  await page.getByTestId("pinned-summary").click();
  await page.getByRole("dialog", { name: "Festet sammendrag", exact: true }).locator("summary").click();
  await page.locator(".pinned-plan", { hasText: "Plan" }).waitFor();
  const threadId = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  const events = await h.events(threadId);
  assert.ok(!events.some((e) => e.event.type === "tool.started" && e.event.tool === "write_file"), "planmodus skriver ingen filer");

  await send(page, "/status");
  await page.getByTestId("info-card").getByText(threadId).waitFor();
  await page.keyboard.press("Escape");

  await box.click();
  await page.keyboard.type("$");
  await page.getByTestId("composer-menu").getByText("$hils").waitFor();
  assert.equal(await page.getByTestId("composer-menu").locator(".menu-item").count(), await page.getByTestId("composer-menu").locator(".menu-tag").count(), "$ viser bare skills, inkludert appens demo");
  await page.keyboard.press("Escape");
  await box.fill("");

  // /mcp opens Innstillinger → MCP-servere, a real page now, and Esc goes back.
  await send(page, "/mcp");
  await page.locator(".settings-page .settings-title", { hasText: "MCP-servere" }).waitFor();
  assert.equal(await page.locator(".settings-title .demo-badge").count(), 0);
  await page.keyboard.press("Escape");
  await page.locator(".settings-page").waitFor({ state: "detached" });

  await send(page, "/fork");
  await page.locator(".pane-title", { hasText: "(gaffel)" }).waitFor();
  await send(page, "/side");
  await page.locator(".pane-title", { hasText: "Sidesamtale" }).waitFor();
  assert.equal(await page.locator(".pane-inner").count(), 3);
});
