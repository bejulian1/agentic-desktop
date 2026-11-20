import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { descendants, flow, openPanel, openProject, ROOT, threadItem, waitFor, openTool } from "./harness.ts";

flow("Om viser versjon, byggnummer, byggdato og Code Pro, og menyen i Innstillinger viser det samme", async (h) => {
  const { page } = h;
  const version = JSON.parse(readFileSync(path.join(ROOT, "version.json"), "utf8"));
  const built = JSON.parse(readFileSync(path.join(ROOT, "web/dist/build-info.json"), "utf8"));
  // SPEC 21.6: not under Profil in the sidebar any more, only in Innstillinger.
  await page.locator(".sidebar .profile-button").waitFor();
  assert.equal(await page.getByTestId("version").count(), 0, "ikke i sidefanen");
  assert.equal(await page.locator(".sidebar").getByText(/build|bygg/).count(), 0);

  await page.getByRole("button", { name: "Innstillinger" }).click();
  const line = page.getByRole("region", { name: "Innstillinger" }).getByTestId("version");
  assert.equal((await line.textContent())?.trim(), `v${version.version} · bygg ${built.build}`);
  await page.getByRole("button", { name: "Om", exact: true }).click();
  await page.getByRole("region", { name: "Innstillinger" }).getByText("Agentic Desktop", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("about-version").textContent(), version.version);
  assert.equal(await page.getByTestId("about-build").textContent(), String(built.build));
  assert.match(await page.getByTestId("about-date").textContent() ?? "", new RegExp(String(new Date(built.builtAt).getFullYear())));
  await page.getByText("Code Pro", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Kopier info" }).click();
  await page.locator(".toast", { hasText: "Kopiert" }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), new RegExp(`Agentic Desktop ${version.version} \\(build ${built.build}\\)`));
});

flow("tunge deler lastes først når de brukes", async (h) => {
  const { page } = h;
  const loaded = () => page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name));
  const chrome = () => descendants(h.server.child.pid!).length;
  await openProject(h);
  await openPanel(page);
  await page.getByTestId("panel-home").waitFor();
  const start = await loaded();
  for (const chunk of ["/Terminal-", "/editor-", "/Browser-", "/Changes-", "/addon-webgl-", "/worker-", "/Settings-", "/MiniEditor-", "/GitHubPanel-", "/Nordlys-"]) {
    assert.ok(!start.some((url) => url.includes(chunk)), `${chunk} er ikke lastet ved oppstart`);
  }
  assert.equal(chrome(), 0, "ingen Chrome før noen trenger den");

  await openTool(page, "Terminal");
  await page.getByTestId("terminal").waitFor();
  assert.ok((await loaded()).some((url) => url.includes("/Terminal-")));
  await openTool(page, "Nettleser");
  await page.getByTestId("browser-canvas").waitFor();
  await waitFor(() => chrome() > 0, "Chrome starter når panelet åpnes");
});

flow("tillatelsesmodus styrer om appen spør", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await page.getByRole("button", { name: "Innstillinger" }).click();
  await page.getByRole("button", { name: "Tillatelser", exact: true }).click();
  await page.getByRole("button", { name: "Tillatelser for Demo" }).click();
  await page.getByRole("menuitemradio", { name: "Full tilgang" }).click();
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await page.getByTestId("permission-button").getByText("Full tilgang").waitFor();
  await page.getByLabel("Melding").fill("lag en side");
  await page.getByLabel("Melding").press("Enter");
  await page.getByText("Ferdig. ").waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(".approval-card").count(), 0, "ingen kort i Full tilgang");
  const updated = await h.api("GET", "/api/bootstrap");
  assert.equal(updated.projects.find((p: any) => p.id === project.id).permissionMode, "full");

  // Settings changed in one window reach the others.
  const second = await h.context.newPage();
  await second.goto(h.origin);
  await second.waitForSelector(".app");
  await page.getByTestId("permission-button").click();
  await page.getByRole("menu", { name: "Tillatelser", exact: true }).getByRole("menuitemradio").filter({ has: page.locator(".menu-name", { hasText: /^Be om godkjenning$/ }) }).click();
  await waitFor(async () => (await second.locator(`.group[data-project="Demo"]`).count()) === 1, "prosjektet er i det andre vinduet");
  // An empty thread has no title and is not listed (SPEC 23.8); this one gets a name, as a first message would give it.
  const thread = await h.createThread(project.id);
  await threadItem(second, thread.id).waitFor();
  await second.close();
});

flow("panelet kan skjules og endres i bredde, og sidefanen kan skjules", async (h) => {
  const { page } = h;
  await openProject(h);
  await openPanel(page);
  const panel = page.locator(".right-panel");
  const before = (await panel.boundingBox())!;
  const handle = page.locator(".panel-resize");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 200, { steps: 4 });
  await page.waitForTimeout(40);
  await page.mouse.up();
  await waitFor(async () => (await panel.boundingBox())!.width > before.width + 80, "panelet ble bredere");
  await page.getByRole("button", { name: "Skjul panelet", exact: true }).click();
  assert.equal(await panel.count(), 0);
  await page.getByRole("button", { name: "Vis eller skjul panelet" }).click();
  await panel.waitFor();
  await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
  // Round 10 (SPEC 23.9): the text fades out first, then the thin row of icons takes its place.
  await page.locator(".sidebar").waitFor({ state: "detached" });
  await page.getByRole("navigation", { name: "Snarveier" }).waitFor();
  await page.keyboard.press("Control+b");
  await page.locator(".sidebar").waitFor();
  await h.reload();
  await page.locator(".right-panel").waitFor();
  assert.ok((await page.locator(".right-panel").boundingBox())!.width > before.width + 80, "bredden huskes");
});

flow("små vinduer: ingen vannrett skrolling, og sidefanen legger seg over", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.getByRole("button", { name: "Del til høyre" }).click();
  // The new pane slides in (FLIP), and mid-slide the panes overlap on purpose.
  await waitFor(async () => (await page.evaluate(() => document.getAnimations().length)) === 0, "ruteovergangen er ferdig");
  for (const width of [1000, 800, 420, 340]) {
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(60);
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, x: scrollX }));
    assert.ok(overflow.scroll <= overflow.client, `${width}: ${JSON.stringify(overflow)}`);
    // Nothing may cover the message field. The sidebar is the only overlay, and it closes when
    // the window gets narrow.
    for (const box of await page.locator(".pane-inner:visible textarea").all()) {
      const covered = await box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return "usynlig";
        for (const [x, y] of [[r.left + 4, r.top + r.height / 2], [r.right - 4, r.top + r.height / 2], [r.left + r.width / 2, r.top + 4]]) {
          const hit = document.elementFromPoint(x, y);
          if (hit !== el && !el.contains(hit)) return `${hit?.className ?? hit?.tagName} ved ${Math.round(x)},${Math.round(y)}`;
        }
        return "";
      });
      assert.equal(covered, "", `${width}: meldingsfeltet er dekket`);
    }
  }
  await page.setViewportSize({ width: 420, height: 700 });
  await page.getByRole("tab").first().click().catch(() => undefined);
  await page.locator(".pane-tabs").waitFor();
  assert.equal(await page.locator(".pane-inner:visible").count(), 1, "én rute om gangen");
  if (await page.locator(".sidebar").count() === 0) await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
  await page.getByRole("button", { name: "Lukk sidefanen" }).click({ position: { x: 380, y: 300 } });
  assert.equal(await page.locator(".sidebar").count(), 0);
}, { viewport: { width: 1360, height: 860 } });
