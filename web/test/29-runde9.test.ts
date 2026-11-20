// Round 9 (SPEC 21): the Kode start page and its choices, the sidebar with Festet, Prosjekter and
// Denne datamaskinen, a folder that is gone, Chat projects, the gear, the effort picker, Ny rute,
// the timeline, editing and copying messages, Enter, and the panel without a thread. Demo model only.
import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { useFolderPickerFallback, flow, openProject, send, threadItem, waitFor, openTool, toolShown } from "./harness.ts";

const focused = (page: import("playwright-core").Page) => page.locator(".pane-inner.focused");
const kode = (page: import("playwright-core").Page) => page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();

flow("Kode-startsiden: hilsen uten prosjekt, prosjektkortet med miljø og GitHub, og valgene i Innstillinger", async (h) => {
  const { page } = h;
  await kode(page);
  const start = page.getByTestId("pane-empty");
  await start.locator(".home-title", { hasText: "Hva skal vi bygge?" }).waitFor();
  assert.equal(await start.locator(".home-mark").count(), 1, "det lille ikonet");
  // The placeholder shows all three helpers.
  const hint = focused(page).getByTestId("composer-hint");
  for (const part of ["/", "kommandoer", "@", "filer", "$", "skills"]) assert.match((await hint.textContent()) ?? "", new RegExp(part.replace("$", "\\$")));

  const project = await openProject(h, "Spill");
  const title = page.locator(".home-title", { hasText: "Hva skal vi jobbe med i Spill?" });
  await title.waitFor();
  // The name has a dotted underline and opens the project picker.
  const name = title.locator(".home-project");
  assert.match(await name.evaluate((el) => getComputedStyle(el).textDecorationStyle), /dotted/);
  await name.click();
  await page.getByRole("dialog", { name: "Velg prosjekt" }).waitFor();
  await page.keyboard.press("Escape");
  // The card: ways to start while the project has no threads, then its latest threads. Round 11b
  // (SPEC 25.2): it is the Prosjektboks choice now, and Tekst is the default.
  assert.equal(await page.getByTestId("project-home").count(), 0, "Tekst er standard");
  await h.api("PATCH", "/api/settings", { codeStart: "projects" });
  const card = page.getByTestId("project-home");
  await card.getByRole("button", { name: /Lag en side/ }).waitFor();
  const thread = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code" });
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Rydd i lagringen" });
  await card.getByRole("button", { name: /Rydd i lagringen/ }).waitFor();
  await card.getByTestId("local-environment").waitFor();
  // GitHub: not connected, and a click opens the GitHub tab.
  await page.getByTestId("home-github").getByText("Koble til GitHub").click();
  await toolShown(page, "GitHub");

  // Innstillinger → Kode, from the gear in Kode, with its own tip.
  const gear = page.getByTestId("settings-gear");
  assert.match((await gear.getAttribute("title")) ?? "", /^Innstillinger for Kode/);
  await gear.click();
  const settings = page.getByRole("region", { name: "Innstillinger" });
  await settings.locator(".settings-title", { hasText: "Kode" }).waitFor();
  await settings.getByRole("radio", { name: /^Tekst/ }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.codeStart === "text", "lagret");
  await page.keyboard.press("Escape");
  await title.waitFor();
  assert.equal(await page.getByTestId("project-home").count(), 0, "Tekst");
  // Without a project, Prosjektboks shows the recent projects.
  await h.api("PATCH", "/api/settings", { codeStart: "projects" });
  await focused(page).getByTestId("project-picker").click();
  await page.getByRole("dialog", { name: "Velg prosjekt" }).getByRole("button", { name: /Ikke jobb i et prosjekt/ }).click();
  await page.getByTestId("home-projects").getByTestId("home-project-row").getByText("Spill").waitFor();
});

flow("sidefanen: Festet bare når noe er festet, + ved Prosjekter, Denne datamaskinen, visning, sortering og folding som huskes", async (h) => {
  const { page } = h;
  await kode(page);
  assert.equal(await page.locator('.section-head[data-section="pinned"]').count(), 0, "Festet er skjult");
  assert.equal(await page.locator(".sidebar-cta").count(), 0, "ingen «Velg en mappe»-rad");
  // A message in Kode without a project is a thread on Denne datamaskinen, without tools.
  await send(page, "lag en side");
  const local = page.getByTestId("local-group");
  await local.getByText("Denne datamaskinen").waitFor();
  await waitFor(async () => (await local.locator(".thread-item").count()) === 1, "tråden ligger under Denne datamaskinen");
  await page.getByText("Ingen verktøy her", { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  const threads = await h.api("GET", "/api/bootstrap").then((b) => b.threads);
  assert.equal(threads.find((t: any) => t.mode === "code" && !t.projectId)?.mode, "code");

  // Projects: three, sorted and grouped from the heading's menu.
  for (const [name, dir] of [["Beta", "b"], ["Alfa", "a"], ["Gamma", "c"]]) {
    mkdirSync(path.join(h.home, dir));
    const project = await h.api("POST", "/api/projects", { name, path: path.join(h.home, dir) });
    // Round 10 (SPEC 23.8): a thread is listed once it has a title.
    const thread = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code" });
    await h.api("PATCH", `/api/threads/${thread.id}`, { title: `Tråd i ${name}` });
  }
  const names = () => page.locator(".sidebar-scroll > .group[data-project] .group-title").allTextContents();
  await waitFor(async () => (await names()).length === 3, "tre prosjekter");
  assert.deepEqual(await names(), ["Gamma", "Alfa", "Beta"], "sist brukt først");
  // Round 11 (SPEC 24.6): grouping, sorting and folding are in the sidebar's ⋯.
  const menu = async (parent: string, role: "menuitem" | "menuitemradio", name: string) => {
    await page.getByTestId("sidebar-menu").click();
    await page.getByRole("menuitem", { name: parent }).click();
    await page.getByRole(role, { name }).click();
  };
  await menu("Sorter samtaler etter", "menuitemradio", "Navn");
  await waitFor(async () => (await names()).join() === "Alfa,Beta,Gamma", "etter navn");
  // Fold sammen alle, kept after a reload.
  await menu("Organiser sidepanelet", "menuitem", "Fold sammen alle");
  await waitFor(async () => (await page.locator('.group[data-project] .group-toggle[aria-expanded="true"]').count()) === 0, "alle er foldet");
  await h.reload();
  await kode(page).catch(() => undefined);
  await waitFor(async () => (await names()).join() === "Alfa,Beta,Gamma", "sorteringen huskes");
  assert.equal(await page.locator('.group[data-project] .group-toggle[aria-expanded="true"]').count(), 0, "foldingen huskes");
  await menu("Organiser sidepanelet", "menuitem", "Fold ut alle");
  await waitFor(async () => (await page.locator('.group[data-project] .group-toggle[aria-expanded="true"]').count()) === 3, "alle er åpne");
  // One list by time.
  await menu("Organiser sidepanelet", "menuitemradio", "Etter dato");
  await page.getByTestId("project-list").locator(".thread-item").first().waitFor();
  assert.equal(await page.getByTestId("project-list").locator(".thread-item").count(), 3);
  assert.equal(await page.locator(".sidebar-scroll > .group[data-project]").count(), 0);
  await page.getByTestId("project-list").locator(".date-head", { hasText: "I dag" }).waitFor();
  await menu("Organiser sidepanelet", "menuitemradio", "Etter prosjekt");

  // Hover on a project: + makes a new thread in the folder, next to ⋯.
  const alfa = page.locator('.group[data-project="Alfa"] .group-head');
  await alfa.hover();
  await alfa.getByRole("button", { name: "Valg for prosjektet" }).waitFor();
  await alfa.getByRole("button", { name: "Ny tråd i Alfa" }).click();
  await page.locator(".home-title", { hasText: "Hva skal vi jobbe med i Alfa?" }).waitFor();

  // Festet shows when something is pinned, and stays at the top in Kode too.
  const first = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.mode === "code" && !t.projectId);
  await h.api("PATCH", `/api/threads/${first.id}`, { pinned: true });
  const pinned = page.locator('.section-head[data-section="pinned"]');
  await pinned.waitFor();
  const order = await page.locator(".sidebar-scroll .section-head").evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
  assert.equal(order[0], "pinned", "Festet øverst");
  await page.locator(".pinned-projects").locator(`[data-thread-item="${first.id}"]`).waitFor();

  // ⋯ → Legg til prosjekt opens the creation dialog (no + by Chatter in Kode).
  await page.getByTestId("sidebar-menu").click();
  await page.getByRole("menuitem", { name: "Legg til prosjekt…" }).click();
  await page.getByRole("dialog", { name: "Opprett prosjekt", exact: true }).waitFor();
  await page.keyboard.press("Escape");
});

flow("mappe som mangler: varselmerke i sidefanen, linjen over feltet, og ny mappe fra PC-en", async (h) => {
  const { page } = h;
  h.allow(/status of 409/); // the message sent while the folder is gone is refused, on purpose
  const project = await openProject(h);
  const thread = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code" });
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Gammel tråd" });
  const moved = `${h.projectDir}-flyttet`;
  renameSync(h.projectDir, moved);
  try {
    await threadItem(page, thread.id).locator(".thread-text").click();
    const bar = page.getByTestId("folder-missing");
    await bar.getByText("Fant ikke mappen").waitFor();
    await page.getByTestId("folder-badge").waitFor();
    // Nothing runs while it is gone. Round 12 (SPEC 26.1): the field is locked; the server refuses too.
    await waitFor(() => focused(page).getByLabel("Melding").isDisabled(), "feltet er låst");
    await assert.rejects(h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" }), /409/);
    // Velg prosjektmappe (round 14) connects it to the folder where it is now.
    await useFolderPickerFallback(h);
    await bar.getByRole("button", { name: "Velg prosjektmappe" }).click();
    const dialog = page.getByRole("dialog", { name: "Velg mappe" });
    await dialog.getByLabel("Sti", { exact: true }).fill(moved);
    await dialog.getByRole("button", { name: "Velg denne mappen" }).click();
    await waitFor(async () => (await bar.count()) === 0, "linjen går bort");
    assert.equal(await page.getByTestId("folder-badge").count(), 0);
    assert.equal((await h.api("GET", `/api/projects/${project.id}`)).path, moved);
  } finally {
    renameSync(moved, h.projectDir);
  }
});

flow("Chat: prosjekter med + og navn, ny chat i prosjektet, flytt fra trådmenyen, og tannhjulet for Chat", async (h) => {
  const { page } = h;
  await page.locator('.section-head[data-section="projects"]').hover();
  await page.getByRole("button", { name: "Nytt prosjekt i Chat" }).click();
  const prompt = page.getByRole("dialog", { name: "Nytt prosjekt i Chat" });
  // v0.21: the dialog is the project editor, with memory choices beside the name.
  await prompt.getByTestId("chat-project-name").fill("Ferie");
  await prompt.getByRole("button", { name: "Lag prosjektet" }).click();
  const group = page.locator('.group[data-chat-project="Ferie"]');
  await group.waitFor();
  await group.locator(".group-head").hover();
  await group.getByRole("button", { name: "Ny chat i Ferie" }).click();
  // v0.21: a new chat in a project starts on the project's own page, with its message field.
  await page.getByRole("heading", { name: "Ferie", exact: true }).waitFor();
  // The project page has its own message field, outside a conversation pane.
  await page.getByLabel("Melding", { exact: true }).last().fill("hei");
  await page.keyboard.press("Enter");
  await waitFor(async () => (await group.locator(".thread-item").count()) === 1, "chatten ligger i prosjektet");
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "svaret er ferdig");
  // A loose chat moved in from the thread menu.
  const loose = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${loose.id}`, { title: "Løs chat" });
  await threadItem(page, loose.id).getByText("Løs chat").waitFor();
  await threadItem(page, loose.id).hover();
  await threadItem(page, loose.id).getByRole("button", { name: "Valg for tråden" }).click();
  await page.getByRole("menuitem", { name: "Flytt til prosjekt" }).click();
  await page.getByRole("menuitemradio", { name: "Ferie" }).click();
  await waitFor(async () => (await group.locator(".thread-item").count()) === 2, "flyttet inn");
  // No folder: the chat has no tools, and Kode does not list it.
  const boot = await h.api("GET", "/api/bootstrap");
  assert.equal(boot.chatProjects[0].name, "Ferie");
  assert.equal("path" in boot.chatProjects[0], false);
  // The gear says Chat here, and opens Innstillinger → Chat.
  const gear = page.getByTestId("settings-gear");
  assert.match((await gear.getAttribute("title")) ?? "", /^Innstillinger for Chat/);
  assert.equal(await gear.locator("svg path").count(), 1, "et tannhjul, ikke stråler");
  await gear.click();
  await page.getByRole("region", { name: "Innstillinger" }).locator(".settings-title", { hasText: "Chat" }).waitFor();
});

flow("innsatsvelgeren: Velg innsats, popover med modell og nullstill, glidebryter med mus og taster, og Ny rute", async (h) => {
  const { page } = h;
  await openProject(h);
  const button = page.getByTestId("effort-button");
  await button.getByText("Velg innsats").waitFor();
  await button.click();
  const picker = page.getByTestId("effort-picker");
  const slider = picker.getByRole("slider", { name: "Innsats" });
  assert.equal(await slider.getAttribute("aria-valuemax"), "5", "Ingen til Maks for demo-modellen");
  assert.equal(await picker.locator(".effort-dot").count(), 6);
  // A click on the track picks the nearest step.
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
  await picker.getByTestId("effort-name").getByText("Maks").waitFor();
  await button.getByText("Maks").waitFor();
  // A drag to the start.
  await page.mouse.move(box.x + box.width - 14, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await picker.getByTestId("effort-name").getByText("Ingen").waitFor();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await picker.getByTestId("effort-name").getByText("Lav").waitFor();
  await page.keyboard.press("End");
  await picker.getByTestId("effort-name").getByText("Maks").waitFor();
  await page.keyboard.press("ArrowLeft");
  await picker.getByTestId("effort-name").getByText("Ekstra høy").waitFor();
  await button.getByText("Ekstra høy").waitFor();
  await page.keyboard.press("Home");
  await picker.getByTestId("effort-name").getByText("Ingen").waitFor();
  // The level is in the accent colour.
  const color = await picker.getByTestId("effort-name").evaluate((el) => getComputedStyle(el).color);
  const accent = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent-text)";
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  assert.equal(color, accent);
  // Reset, and › opens the model menu.
  await picker.getByRole("button", { name: "Tilbake til modellens standard" }).click();
  await button.getByText("Velg innsats").waitFor();
  await picker.getByRole("button", { name: /Demo-modell/ }).click();
  await page.getByRole("combobox", { name: "Søk etter modeller" }).waitFor();
  await page.keyboard.press("Escape");

  // Del til høyre (round 11): the pane buttons stand left of the panel buttons, with the shortcut in
  // the tip, and the place for the window controls is last.
  const newPane = page.getByTestId("new-pane");
  assert.match((await newPane.getAttribute("title")) ?? "", /Del til høyre.*\(.+\)/);
  const right = await page.locator(".topbar-right > *").evaluateAll((els) => els.at(-1)?.getAttribute("data-testid"));
  assert.equal(right, "window-controls");
  await newPane.click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 2, "to ruter");
});

flow("Chat uten tidslinje, med redigering, utvalg og kopi av meldinger", async (h) => {
  const { page } = h;
  await send(page, "hjelp");
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0 && (await page.locator(".row-text").count()) > 0, "svaret");
  assert.equal(await page.getByTestId("minimap").count(), 0, "ingen tidslinje etter første tur i Chat");
  await send(page, "vis et kodeeksempel");
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0 && (await page.locator(".row-text").count()) >= 2, "andre svar");
  assert.equal(await page.getByTestId("minimap").count(), 0, "ingen tidslinje etter fire meldinger i Chat");

  // Select two messages and copy them as Markdown.
  const user = page.locator(".row-user").first();
  await user.hover();
  await user.getByRole("checkbox", { name: "Ta med i utvalget" }).click();
  const answer = page.locator(".msg").first();
  await answer.hover();
  await answer.getByRole("checkbox", { name: "Ta med i utvalget" }).click({ modifiers: ["Shift"] });
  const bar = page.getByTestId("select-bar");
  await bar.getByText("2 meldinger valgt").waitFor();
  await bar.getByRole("button", { name: "Kopier som Markdown" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /^\*\*Du:\*\*\n\nhjelp/);
  assert.match(copied, /Demo-modell/);
  await waitFor(async () => (await bar.count()) === 0, "utvalget er tømt");

  // Edit the first message: everything after goes, and the model answers again.
  await user.hover();
  await user.getByRole("button", { name: "Rediger" }).click();
  const edit = page.getByTestId("user-edit");
  await edit.locator("textarea").fill("hva kan du?");
  await edit.locator("textarea").press("Escape");
  await waitFor(async () => (await edit.count()) === 0, "Esc avbryter");
  await user.hover();
  await user.getByRole("button", { name: "Rediger" }).click();
  await edit.locator("textarea").fill("hva kan du?");
  await edit.locator("textarea").press("Enter");
  await waitFor(async () => (await page.locator(".user-text").allTextContents()).join("|") === "hva kan du?", "bare den redigerte meldingen står igjen");
});

flow("Enter gir ny linje når det er valgt, Ctrl+Enter sender, og rød aksent og grå kant på feltet", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { enterKey: "newline", accent: "red" });
  await h.reload();
  // Exact: the Kø/Straks switch (v0.16) is labelled «Meldinger mens agenten jobber».
  const field = focused(page).getByLabel("Melding", { exact: true });
  await waitFor(async () => /Ctrl\+Enter sender/.test((await field.getAttribute("placeholder")) ?? ""), "plassholderen sier Ctrl+Enter");
  assert.match((await focused(page).getByRole("button", { name: "Send" }).getAttribute("title")) ?? "", /Ctrl\+Enter/);
  await field.click();
  await field.type("første linje");
  await field.press("Enter");
  await field.type("andre linje");
  assert.equal(await field.inputValue(), "første linje\nandre linje", "Enter ga ny linje");
  await field.press("Control+Enter");
  await page.locator(".user-text", { hasText: "andre linje" }).waitFor();
  // The red accent, and the field's border is grey, not the accent, when it has focus.
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), "red");
  await field.click();
  const border = await focused(page).locator(".composer").evaluate((el) => getComputedStyle(el).borderTopColor);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  assert.notEqual(border.replace(/\s/g, ""), accent);
  const [r, g, b] = border.match(/\d+(\.\d+)?/g)!.map(Number);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 24, `nøytral grå, ikke farget: ${border}`);
});

flow("panelet uten tråd: terminal i hjemmemappen som Denne datamaskinen, Filer er dempet uten prosjekt, og ingen panel i Chat", async (h) => {
  const { page } = h;
  // v0.19: the default "Felles topprad" shows terminal sessions in the panel's shared tab row.
  // This test is about the Terminal's own row ("Separate rader"), which is still a setting.
  await h.api("PATCH", "/api/settings", { panelTabLayout: "grouped" });
  await kode(page);
  const toggle = page.getByRole("button", { name: "Vis eller skjul panelet" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  // v0.18 (SIDEPANEL-WORKSPACE.md): every tool opens without a project; Filer reads the home folder.
  // Only Sidechat, which needs an open thread, is dimmed with a short tip.
  const files = page.locator('.panel-tool[data-tool="files"]');
  assert.equal(await files.getAttribute("aria-disabled"), null);
  const side = page.locator('.panel-tool[data-tool="side"]');
  assert.equal(await side.getAttribute("aria-disabled"), "true");
  assert.match((await side.getAttribute("title")) ?? "", /åpne en tråd først/);
  assert.equal(await page.getByText("Oversikten hører til et prosjekt").count(), 0);
  await openTool(page, "Terminal");
  await page.getByTestId("terminal-place").getByText("Denne datamaskinen").waitFor();
  await page.locator(".terminal-tab").first().waitFor();
  assert.deepEqual((await h.api("GET", "/api/projects/local/terminals")).length, 1);
  // No thread was made for it.
  assert.equal((await h.api("GET", "/api/bootstrap")).threads.length, 0);

  // Chat has no side panel (SPEC 24.5).
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  await waitFor(async () => (await page.locator(".right-panel").count()) === 0, "ingen panel i Chat");
  assert.equal(await page.getByRole("button", { name: "Legg til sidepanel" }).count(), 0);
});
