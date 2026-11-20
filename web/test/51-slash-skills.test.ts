import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, threadItem, waitFor } from "./harness.ts";

flow("Slash-skills: fuzzy tastaturvalg, app-demo, rå argumenter og skrivebeskyttet innsyn", async (h) => {
  const { page } = h;
  // The shipped skills are written for Kode with a project, so they are not offered in Chat.
  await openProject(h, "Skillprosjekt");
  const field = page.getByLabel("Melding", { exact: true });
  const menu = page.getByTestId("composer-menu");
  await field.fill("/");
  await menu.getByText("/review", { exact: true }).waitFor();
  assert.match(await menu.innerText(), /Gjennomgå|gjennomgang|kode|review/i);
  await field.fill("/rvw");
  await menu.getByText("/review", { exact: true }).waitFor();
  // In Kode the subsequence also finds the built-in /review-changes; the skill is one of the two.
  const names = async () => (await menu.locator(".menu-name").allInnerTexts()).map((name) => name.trim());
  assert.deepEqual([...(await names())].sort(), ["/review", "/review-changes"]);
  await page.keyboard.press("Escape");
  assert.equal(await menu.count(), 0);
  await field.fill("/rvw");
  await menu.getByText("/review", { exact: true }).waitFor();
  // Arrow keys move the choice: go down to the skill from wherever it is listed, then choose it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  for (let i = 0; i < (await names()).indexOf("/review"); i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.locator(".chip-skill", { hasText: "/review" }).waitFor();
  const args = "  forklar denne koden\n\nbehold  mellomrom  ";
  const sent: any[] = [];
  await page.route("**/api/threads/*/messages", (route) => {
    if (route.request().method() === "POST") sent.push(route.request().postDataJSON());
    return route.continue();
  });
  await field.fill(args);
  await page.keyboard.press("Enter");
  await waitFor(() => sent.length === 1, "skillen er sendt én gang");
  assert.equal(sent[0].skill, "review");
  assert.equal(sent[0].text, args, "chip-baserte argumenter trimmes ikke");
  await page.locator(".row-user", { hasText: "/review" }).waitFor();
  const message = await page.locator(".row-user").first().innerText();
  assert.ok(!message.includes("{{args}}") && !message.includes("<skill"), "instruksjonskroppen er ikke synlig");
  await page.keyboard.press("Control+,");
  await page.locator(".settings-nav").getByRole("button", { name: "Skills", exact: true }).click();
  const demo = page.locator(".skill-row").filter({ has: page.locator(".skill-name", { hasText: /^review$/ }) });
  await demo.getByText("Fra appen", { exact: true }).waitFor();
  assert.equal(await demo.getByRole("switch").isDisabled(), true);
  await demo.getByRole("button", { name: "Vis review", exact: true }).click();
  await page.getByRole("heading", { name: "Vis review", exact: true }).waitFor();
  assert.equal(await page.locator(".skill-form textarea").getAttribute("readonly"), "");
  assert.equal(await page.locator(".skill-form").getByRole("button", { name: "Lagre", exact: true }).count(), 0);
});

flow("Slash-skills: prosjekt overstyrer appen, åpen meny oppdateres og direkte slash bevarer argumenter", async (h) => {
  const { page } = h;
  const folder = path.join(h.projectDir, "skills/review");
  mkdirSync(folder, { recursive: true });
  const write = (description: string) => writeFileSync(path.join(folder, "SKILL.md"), `---\nname: review\ndescription: ${description}\nargs: valgfri tekst\n---\n\nPROSJEKT-SKILL-MARKØR\nOppgave: {{args}}\n`);
  write("Lokal gjennomgang før endring");
  const project = await openProject(h, "Slashprosjekt");
  const field = page.getByLabel("Melding", { exact: true });
  const menu = page.getByTestId("composer-menu");
  await field.fill("/rvw");
  await menu.getByText("Lokal gjennomgang før endring", { exact: true }).waitFor();
  const command = (await h.api("GET", `/api/projects/${project.id}/commands`)).find((c: any) => c.name === "review");
  assert.equal(command.source, "project");
  write("Oppdatert lokal gjennomgang");
  await menu.getByText("Oppdatert lokal gjennomgang", { exact: true }).waitFor();
  const sent: any[] = [];
  await page.route("**/api/threads/*/messages", (route) => {
    if (route.request().method() === "POST") sent.push(route.request().postDataJSON());
    return route.continue();
  });
  const args = "   fil.ts\n\n  flere  ord  ";
  await field.fill(`/review ${args}`);
  await page.keyboard.press("Enter");
  await waitFor(() => sent.length === 1, "direkte slash sendt");
  assert.equal(sent[0].skill, "review");
  assert.equal(sent[0].text, args);
  await page.locator(".row-user", { hasText: "/review" }).waitFor();
  assert.ok(!(await page.locator(".row-user").first().innerText()).includes("PROSJEKT-SKILL-MARKØR"));
  await field.fill("/rvw");
  await menu.getByText("Oppdatert lokal gjennomgang", { exact: true }).waitFor();
  rmSync(folder, { recursive: true });
  await waitFor(async () => !(await menu.innerText()).includes("Oppdatert lokal gjennomgang"), "slettet skill forsvinner fra åpen meny");
  await menu.getByText("/review", { exact: true }).waitFor();
  await menu.locator(".menu-tag", { hasText: /^app$/ }).waitFor();
});

flow("Sending som feiler bevarer tekst skrevet etter Send", async (h) => {
  const { page } = h;
  h.allow(/status of 503/);
  // Use an already mounted thread so this tests the same composer throughout the request.
  const thread = await h.createThread(null);
  await threadItem(page, thread.id).click();
  const field = page.getByLabel("Melding", { exact: true });
  await field.waitFor();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route(`**/api/threads/${thread.id}/messages`, async (route) => {
    requested = true;
    await pending;
    await route.fulfill({ status: 503, json: { error: "Test: sending feilet" } });
  });
  await field.fill("Meldingen som ikke kom fram");
  await page.keyboard.press("Enter");
  await waitFor(() => requested, "forespørselen venter");
  await field.fill("Ny kladd som må beholdes");
  release();
  await page.getByText("Test: sending feilet", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "Ny kladd som må beholdes\n\nMeldingen som ikke kom fram");
});

flow("Tregt første slash-oppslag sender ikke gammel tekst over et nyere utkast", async (h) => {
  const { page } = h;
  await openProject(h, "Tregt oppslag"); // the review skill is a Kode skill
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route(/\/api\/(?:projects\/[^/]+\/)?commands$/, async (route) => {
    requests += 1;
    await pending;
    await route.continue();
  });
  const sent: any[] = [];
  await page.route("**/api/threads/*/messages", (route) => {
    if (route.request().method() === "POST") sent.push(route.request().postDataJSON());
    return route.continue();
  });
  await h.reload();
  const field = page.getByLabel("Melding", { exact: true });
  await field.fill("/review gammel");
  await page.keyboard.press("Enter");
  await waitFor(() => requests >= 2, "initialt oppslag venter");
  await field.fill("/review nyere tekst");
  release();
  await page.waitForTimeout(160);
  assert.equal(await field.inputValue(), "/review nyere tekst");
  assert.equal(sent.length, 0, "det gamle snapshotet sendes ikke");
  await page.keyboard.press("Enter");
  await waitFor(() => sent.length === 1, "nytt utkast kan sendes etterpå");
  assert.equal(sent[0].skill, "review");
  assert.equal(sent[0].text, "nyere tekst");
});
