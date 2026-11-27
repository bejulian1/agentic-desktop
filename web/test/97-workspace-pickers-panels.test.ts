import assert from "node:assert/strict";
import { hostname } from "node:os";
import path from "node:path";
import type { Thread } from "../../shared/protocol.ts";
import { approveUntil, flow, openProject, openTool, pane, send, threadItem, waitFor } from "./harness.ts";

flow("Ny tråd velger prosjekt i full, enkel, smart og skjult sidefane", async (h) => {
  const { page } = h;
  const alpha = await openProject(h, "Alpha");
  const beta = await h.api("POST", "/api/projects", { name: "Beta", path: path.join(h.projectDir, "beta") });
  const chat = await h.api("POST", "/api/chat-projects", { name: "Ferie" });
  const picker = page.getByTestId("new-thread-project-picker");
  const newThread = (container: string) => page.locator(container).getByRole("button", { name: "Ny tråd", exact: true });
  await newThread(".sidebar-nav").click();
  const search = picker.getByRole("combobox");
  await waitFor(() => search.evaluate((el) => el === document.activeElement), "søkefeltet får fokus");
  await picker.getByRole("option", { name: /Ferie/ }).locator(".project-glyph").waitFor();
  await picker.getByRole("option", { name: /Beta/ }).getByText(beta.path, { exact: true }).waitFor();
  await search.fill("bet");
  await search.press("ArrowDown");
  await search.press("Enter");
  await picker.waitFor({ state: "detached" });
  const lookup = async (predicate: (thread: Thread) => boolean) =>
    (await h.api("GET", "/api/bootstrap")).threads.find(predicate);
  const betaThread = await lookup((thread) => thread.projectId === beta.id);
  assert.ok(betaThread, "valg oppretter en tråd i prosjektet");
  await pane(page, betaThread.id).waitFor();
  await h.api("PATCH", `/api/threads/${betaThread.id}`, { title: "Beta-arbeid" });
  await threadItem(page, betaThread.id).getByTestId("thread-meta").getByText(hostname(), { exact: true }).waitFor();

  await page.keyboard.press("Control+Alt+n");
  await pane(page, betaThread.id).waitFor({ state: "detached" });
  assert.equal(await picker.count(), 0, "snarveien starter et utkast direkte");
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, 1);

  await page.locator(".sidebar-nav .nav-row-extra").click();
  const projects = page.getByTestId("sidebar-project-list");
  await projects.getByRole("option", { name: /Beta/ }).click();
  await pane(page, betaThread.id).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, 1, "prosjektlisten åpner eksisterende tråd");
  await page.locator(".sidebar-nav .nav-row-extra").click();
  await projects.getByRole("button", { name: "Legg til nytt prosjekt…" }).click();
  const addProject = page.getByRole("dialog", { name: "Opprett prosjekt" });
  await addProject.waitFor();
  await page.keyboard.press("Escape");

  await h.api("PATCH", "/api/settings", { sidebarSimple: true });
  await page.getByTestId("sidebar-quick").getByRole("button", { name: "Prosjekter" }).click();
  await projects.getByRole("option", { name: /Alpha/ }).click();
  await page.locator(".home-project").getByText(alpha.name, { exact: true }).waitFor();
  await newThread(".sidebar-quick").click();
  await picker.getByRole("option", { name: "Ny chat uten prosjekt" }).waitFor();
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "detached" });
  assert.equal(await newThread(".sidebar-quick").evaluate((el) => el === document.activeElement), true);

  await h.api("PATCH", "/api/settings", { sidebarSimple: false, sidebarLayout: "smart" });
  await newThread(".smart-sidebar").click();
  await picker.getByRole("option", { name: /Ferie/ }).click();
  const chatThread = await lookup((thread) => thread.chatProjectId === chat.id);
  assert.ok(chatThread);
  await pane(page, chatThread.id).waitFor();
  const rail = page.getByTestId("sidebar-rail");
  if (!await rail.isVisible()) await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).first().click();
  await newThread(".sidebar-rail").click();
  await picker.getByRole("option", { name: "Ny chat uten prosjekt" }).click();
  await pane(page, chatThread.id).waitFor({ state: "detached" });
});

flow("Diff, Pull requests, Agenter og tilknyttede PR-er fungerer samlet og stablet", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", "/api/settings", { autoOpenAgentThreads: false, panelTabLayout: "grouped" });
  const parent = await h.createThread(project.id);
  await threadItem(page, parent.id).locator(".thread-text").click();
  await pane(page, parent.id).waitFor();

  await openTool(page, "Diff");
  await page.locator('[data-panel-tab="changes"], [data-tool="changes"]').first().waitFor();
  await openTool(page, "Pull requests");
  await page.getByTestId("github-panel").waitFor();
  await openTool(page, "Agenter");
  const agents = page.getByTestId("agents-panel");
  await agents.getByText(/Ingen agenter/).waitFor();
  await send(page, "samarbeid om en oversikt");
  await approveUntil(page, async () => (await page.getByText("Samarbeidet er ferdig").count()) > 0, "hjelpetråden fullfører");
  const child = (await h.api("GET", "/api/bootstrap")).threads.find((thread: Thread) => thread.parentThreadId === parent.id);
  assert.ok(child);
  const agent = agents.locator(".agent-panel-row").filter({ hasText: child.title });
  await agent.getByText("Ferdig", { exact: true }).waitFor();
  await agent.getByText(/Team-agent · Demo-modell/).waitFor();
  assert.ok((await agent.locator(".thread-panel-preview").innerText()).trim().length > 0, "oppgaven vises i agentraden");
  await agent.click();
  await pane(page, child.id).waitFor();
  await threadItem(page, parent.id).locator(".thread-text").click();
  await pane(page, parent.id).waitFor();

  let refreshes = 0;
  await page.route("**/api/github/detail/pull?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("refresh") === "1") refreshes++;
    await route.fulfill({ json: { title: "Oppdater eksemplene", state: "open", head: "docs/examples", pull: { head: "docs/examples" } } });
  });
  await openTool(page, "Tilknyttede pull requests");
  const linked = page.getByTestId("linked-pull-requests-panel");
  await linked.getByText("Ingen pull request er knyttet til denne tråden.").waitFor();
  await linked.getByRole("button", { name: "Knytt til GitHub-PR…" }).click();
  const linkDialog = page.getByRole("dialog", { name: "Lenke til GitHub-PR" });
  await linkDialog.getByRole("textbox").fill("https://github.com/example/demo/pull/12");
  await linkDialog.getByRole("button", { name: "Lagre" }).click();
  await linked.getByText("example/demo #12").waitFor();
  await linked.getByText("Oppdater eksemplene").waitFor();
  await linked.getByText("Åpen", { exact: true }).waitFor();
  await linked.getByText("docs/examples", { exact: true }).waitFor();
  await linked.getByRole("button", { name: "Hent på nytt" }).click();
  await waitFor(() => refreshes === 1, "oppdatering tvinger ny GitHub-henting");

  await h.api("PATCH", "/api/settings", { panelButtons: "separate" });
  await page.getByTestId("panel-stack").waitFor();
  await page.getByTestId("stack-panel-linked-prs").getByText("Oppdater eksemplene").waitFor();
  await openTool(page, "Agenter");
  await page.getByTestId("stack-panel-agents").getByText(child.title, { exact: true }).waitFor();
  await linked.getByRole("button", { name: "Fjern PR-tilknytning" }).click();
  await linked.getByText(/Ingen pull request/).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.find((thread: Thread) => thread.id === parent.id).linkedPr, null);
});
