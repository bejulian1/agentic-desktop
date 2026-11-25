// Round 8, UI fixes for navigation, the sidebars, the top bar, panes and Innstillinger (UI-retter 2):
// the sidebar and panel come back after a narrow window, focus comes back after the palette,
// Innstillinger and the thread menu, a pane never jumps back to a thread opened earlier, temporary
// chats stay out of the lists, Utsett shows in the standard sidebar, the profile menu's week, the
// notifications inside the window, toasts that never cover the message field, Chat and Kode with
// their own lists, Bruk with the statistics, and the limits on downloads and on stopping servers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Downloads, MAX_ACTIVE, MAX_STARTS_PER_MINUTE } from "../../server/src/downloads.ts";
import { startTime } from "../../server/src/servers.ts";
import { flow, openPanel, openProject, send, threadItem, waitFor, openTool, toolShown } from "./harness.ts";

type Page = import("playwright-core").Page;

const idle = (page: Page) => waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig");
const activeLabel = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a && a !== document.body ? a.getAttribute("aria-label") ?? a.textContent?.trim().slice(0, 40) ?? a.tagName : "BODY";
  });

flow("sidefanen og panelet kommer tilbake når vinduet blir bredt igjen, og varsler holder seg inne i vinduet", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.locator(".sidebar").waitFor();
  await openPanel(page);
  // Round 11 (SPEC 24.3): the panel opens on its start page, not on an empty file tree.
  await page.getByTestId("panel-home").waitFor();

  // Snapped to half a screen: the sidebar becomes an overlay and closes, the panel goes away.
  await page.setViewportSize({ width: 700, height: 800 });
  await waitFor(async () => (await page.locator(".sidebar").count()) === 0, "sidefanen lukkes i et smalt vindu");
  await waitFor(async () => (await page.locator(".right-panel").count()) === 0, "panelet lukkes i et smalt vindu");
  // And back: both are where they were.
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.locator(".sidebar").waitFor();
  await page.locator(".right-panel").waitFor();

  // Closed in a wide window stays closed, also through a narrow spell.
  await page.getByRole("button", { name: "Vis eller skjul sidefanen" }).click();
  await page.setViewportSize({ width: 700, height: 800 });
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".sidebar").count(), 0, "sidefanen var lukket med vilje");
  await page.getByRole("navigation", { name: "Snarveier" }).getByRole("button", { name: "Vis sidefanen" }).click();

  // The notifications open inside the window, whatever the sidebar's width.
  await page.getByRole("button", { name: "Varsler" }).click();
  const popover = page.locator(".notifications .popover");
  await popover.getByText("Ingen varsler").waitFor();
  const box = (await popover.boundingBox())!;
  assert.ok(box.x >= 0 && box.x + box.width <= 1360, `varslene er inne i vinduet (${Math.round(box.x)}, ${Math.round(box.width)})`);
  await page.keyboard.press("Escape");
});

flow("fokus går tilbake etter paletten, Innstillinger og trådmenyen, og menyen er en meny", async (h) => {
  const { page } = h;
  const field = page.getByLabel("Melding").first();
  await field.focus();
  await page.keyboard.press("Control+k");
  await page.getByLabel("Søk i paletten").waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await activeLabel(page)) === "Melding", "fokus etter paletten");

  await field.focus();
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Tilbake til appen" }).waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await activeLabel(page)) === "Melding", "fokus etter Innstillinger");

  await send(page, "hei");
  await idle(page);
  const thread = (await h.api("GET", "/api/bootstrap")).threads[0];
  const item = threadItem(page, thread.id);
  await item.hover();
  await item.getByRole("button", { name: "Valg for tråden" }).click();
  const menu = page.getByRole("menu", { name: /Valg for/ });
  await menu.getByRole("menuitem", { name: /Gi nytt navn/ }).waitFor();
  // The arrows move between the rows, and Esc gives focus back to ⋯.
  await page.keyboard.press("ArrowDown");
  assert.match(await activeLabel(page), /^(Løsne|Fest)/);
  await page.keyboard.press("Escape");
  await waitFor(async () => (await menu.count()) === 0, "menyen er lukket");
  assert.equal(await activeLabel(page), "Valg for tråden", "fokus tilbake på ⋯");
});

flow("en rute hopper ikke tilbake til tråden som ble åpnet først, og andre vinduer følger med", async (h) => {
  const { page } = h;
  // v0.19: a new window starts on an empty conversation by default ("Ny, tom samtale"). Windows
  // that share the layout are the "Fortsett der jeg slapp" choice, which this test is about.
  await h.api("PATCH", "/api/settings", { startConversation: "resume" });
  const a = await h.createThread(null);
  const b = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${a.id}`, { title: "Tråd A" });
  await h.api("PATCH", `/api/threads/${b.id}`, { title: "Tråd B" });
  await threadItem(page, a.id).waitFor();
  await threadItem(page, b.id).waitFor();

  // A loads slowly. Clicking A, then B at once, must end on B: the answer for A comes last.
  await page.route(`**/api/threads/${a.id}/events**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue().catch(() => undefined);
  });
  const layouts: string[] = [];
  page.on("request", (r) => { if (r.method() === "PUT" && r.url().endsWith("/layout")) layouts.push(r.postData() ?? ""); });
  await threadItem(page, a.id).locator(".thread-text").click();
  await threadItem(page, b.id).locator(".thread-text").click();
  await page.locator(`.pane-inner.focused[data-thread-id="${b.id}"]`).waitFor();
  await page.waitForTimeout(1500); // A's answer and the layout echoes have come by now.
  assert.equal(await page.locator(".pane-inner.focused").getAttribute("data-thread-id"), b.id, "ruten viser fortsatt B");
  assert.ok(layouts.length > 0 && layouts.every((body) => typeof JSON.parse(body).clientId === "string"), "oppsettet sendes med vinduets id");
  await page.unroute(`**/api/threads/${a.id}/events**`);

  // Another window of the app changes the layout: this one follows.
  const other = await h.context.newPage();
  await other.goto(h.origin);
  await other.waitForSelector(".app");
  await other.locator(`.pane-inner.focused[data-thread-id="${b.id}"]`).waitFor();
  await threadItem(other, a.id).locator(".thread-text").click();
  await other.locator(`.pane-inner.focused[data-thread-id="${a.id}"]`).waitFor();
  await page.locator(`.pane-inner.focused[data-thread-id="${a.id}"]`).waitFor();
  await other.close();
});

flow("midlertidige chatter står ikke i sidefanen, den smarte sidefanen eller paletten", async (h) => {
  const { page } = h;
  const kept = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${kept.id}`, { title: "Vanlig samtale" });
  const temp = await h.api("POST", "/api/threads/temporary", {});
  await h.api("PATCH", `/api/threads/${temp.id}`, { title: "Hemmelig samtale" });
  await threadItem(page, kept.id).waitFor();
  await page.waitForTimeout(200);
  assert.equal(await threadItem(page, temp.id).count(), 0, "ikke i sidefanen");

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Kommandopalett" });
  await palette.getByRole("option", { name: /Vanlig samtale/ }).waitFor();
  assert.equal(await palette.getByRole("option", { name: /Hemmelig samtale/ }).count(), 0, "ikke blant de nylige");
  await page.keyboard.type("samtale");
  await page.waitForTimeout(400);
  assert.equal(await palette.getByRole("option", { name: /Hemmelig samtale/ }).count(), 0, "ikke i søket");
  await page.keyboard.press("Escape");

  await h.api("PATCH", "/api/settings", { sidebarLayout: "smart" });
  const smart = page.getByTestId("smart-sidebar");
  await smart.locator(`[data-smart-card="${kept.id}"]`).waitFor();
  assert.equal(await smart.locator(`[data-smart-card="${temp.id}"]`).count(), 0, "ikke i den smarte sidefanen");
});

flow("Utsett virker i standard sidefane: egen fold med en klokke som henter tråden tilbake", async (h) => {
  const { page } = h;
  const first = await h.createThread(null);
  const second = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${first.id}`, { title: "Den eldste" });
  await h.api("PATCH", `/api/threads/${second.id}`, { title: "Den nyeste" });
  const item = threadItem(page, second.id);
  await item.waitFor();

  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Utsett/ }).hover();
  await page.locator('.context-menu[data-depth="1"]').getByRole("menuitem", { name: "1 time", exact: true }).click();
  const fold = page.locator('[data-inbox-fold="snoozed"]');
  await fold.getByRole("button", { name: /Utsatt/ }).waitFor();
  await item.waitFor({ state: "detached" });
  await fold.getByRole("button", { name: /Utsatt/ }).click();
  await fold.locator(`.thread-item.snoozed[data-thread-item="${second.id}"]`).waitFor();
  const order = await page.locator(".thread-item").evaluateAll((items) => items.map((el) => el.getAttribute("data-thread-item")));
  assert.ok(order.indexOf(second.id) > order.indexOf(first.id), "den utsatte står nederst");

  await item.getByRole("button", { name: /Hent tilbake/ }).click();
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === second.id).snoozedUntil, "hentet tilbake");
  await page.locator(`.thread-item.snoozed[data-thread-item="${second.id}"]`).waitFor({ state: "detached" });
});

flow("Chat og Kode har hver sin liste i sidefanen, og toppfeltet er kort", async (h) => {
  const { page } = h;
  const chat = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${chat.id}`, { title: "En chat" });
  await h.createProject("Demo");
  await threadItem(page, chat.id).waitFor();
  // Chat: Chat's own projects, then the chats (v0.11.3: «Prosjekter står over Chatter»); Kode
  // projects are in Kode.
  const sections = () => page.locator(".sidebar-scroll .section-head").evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
  await waitFor(async () => (await sections()).join() === "projects,chats", "Prosjekter over Chatter i Chat");
  assert.equal(await page.locator('.group[data-project="Demo"]').count(), 0, "Kode-prosjektet står i Kode");
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).waitFor();
  // No project tools in Chat's top bar.
  assert.equal(await page.getByRole("button", { name: "Vis eller skjul panelet" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Legg til sidepanel" }).count(), 0, "Chat har ikke sidepanel (SPEC 24.5)");

  // Kode (round 11, SPEC 24.4): Chatter, with the projects under it. The chats are in Chat.
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await page.locator('.group[data-project="Demo"] .group-title').click();
  await page.waitForSelector(".project-label");
  await waitFor(async () => (await sections()).join() === "chats", "bare Chatter i Kode");
  assert.equal(await threadItem(page, chat.id).count(), 0, "chattene står i Chat");
  // The path is in the tip, not in the bar. VS Code is behind ⋯, and the panels behind +.
  assert.equal(await page.locator(".topbar .project-path").count(), 0);
  await page.getByRole("button", { name: "Flere valg" }).click();
  await page.getByRole("menuitem", { name: "Åpne i VS Code" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Legg til sidepanel" }).click();
  await page.getByRole("menuitemradio", { name: /^Terminal/ }).click();
  await toolShown(page, "Terminal");
});

flow("profilmenyen viser ukens tokens etter en kjøring, og varsler dekker aldri meldingsfeltet", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  const sub = page.getByTestId("profile-menu-sub");
  await waitFor(async () => /ingen bruk siste 7 dager/.test((await sub.textContent()) ?? ""), "ingen bruk ennå");
  await page.keyboard.press("Escape");

  await send(page, "hjelp");
  await idle(page);
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  await waitFor(async () => /[1-9][\d,.]* (k )?tokens siste 7 dager/.test((await sub.textContent()) ?? ""), "tokens etter kjøringen");
  await page.keyboard.press("Escape");

  // A toast sits under the top bar, not over the message field or Send.
  await page.getByRole("button", { name: "Innstillinger" }).click();
  await page.locator(".settings-nav").getByRole("button", { name: "Om", exact: true }).click();
  await page.getByRole("button", { name: "Kopier info" }).click();
  await page.keyboard.press("Escape");
  const toast = page.locator(".toast", { hasText: "Kopiert" });
  await toast.waitFor();
  const field = (await page.getByLabel("Melding").first().boundingBox())!;
  const box = (await toast.boundingBox())!;
  assert.ok(box.y + box.height < field.y, "varselet ligger over meldingsfeltet, ikke oppå det");
  assert.ok(box.y < 120, `varselet er øverst (${Math.round(box.y)})`);
});

flow("Innstillinger: Bruk med statistikken, MCP og Hooks blant de vanlige sidene, og egne nedtrekkslister", async (h) => {
  const { page } = h;
  await send(page, "hjelp");
  await idle(page);
  await page.getByRole("button", { name: "Innstillinger" }).click();
  const nav = page.locator(".settings-nav");
  // MCP-servere and Hooks are real pages now, among the others; nothing is left under «Kommer senere».
  await nav.getByRole("button", { name: "Om", exact: true }).waitFor();
  assert.equal(await nav.getByText("Kommer senere").count(), 0);
  assert.equal(await nav.locator(".nav-later").count(), 0);
  const labels = await nav.locator(".nav-item").evaluateAll((els) => els.map((el) => el.textContent?.trim()));
  for (const label of ["Git", "Hooks", "MCP-servere"]) assert.ok(labels.indexOf(label) > 0 && labels.indexOf(label) < labels.indexOf("Om"), labels.join(", "));
  // No switch for statistics on the start page any more (SPEC 20).
  assert.equal(await page.getByText("Statistikk på startsiden").count(), 0);

  await nav.getByRole("button", { name: "Bruk", exact: true }).click();
  const card = page.locator(".settings-page").getByTestId("stats-card");
  await waitFor(async () => (await card.locator(".stats-tile", { hasText: "Økter" }).locator(".stats-value").textContent()) === "1", "én økt");
  await card.getByRole("button", { name: "7d" }).click();
  await card.getByRole("tab", { name: "Modeller" }).click();
  await card.locator(".stats-model", { hasText: "Demo-modell" }).waitFor();
  await page.getByTestId("usage-cost").getByText("–").waitFor();

  // The app's own select: Esc closes it and gives focus back to the button.
  await nav.getByRole("button", { name: "Generelt", exact: true }).click();
  const choice = page.getByRole("button", { name: "Åpne appen i", exact: true });
  await choice.click();
  await page.getByRole("menu", { name: "Åpne appen i" }).getByRole("menuitemradio", { name: "Sist brukte", checked: true }).waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await activeLabel(page)) === "Åpne appen i", "fokus tilbake på knappen");
  assert.equal(await page.getByRole("region", { name: "Innstillinger" }).count(), 1, "Esc lukket bare menyen");

  // Tillatelser: rows with a check instead of radio buttons.
  await nav.getByRole("button", { name: "Tillatelser", exact: true }).click();
  const group = page.getByRole("radiogroup", { name: "Standard tillatelsesmodus" });
  await group.getByRole("radio", { name: /Godta redigeringer/ }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.defaultPermissionMode === "accept-edits", "lagret");
  await group.getByRole("radio", { name: /Godta redigeringer/, checked: true }).waitFor();
});

// The limits that keep a web page and a stopped server in check, without a browser.
test("nedlastinger: en side får bare noen få om gangen og i minuttet, og den første som stoppes, sier hvorfor", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ad-retter2-nedl-"));
  try {
    const downloads = new Downloads({ dir: () => dir, publish: () => undefined });
    const staging = downloads.stagingDir();
    const start = (project: string, id: string) => downloads.begin(project, id, "http://localhost/f", `${id}.txt`, staging);
    const stopAll = () => {
      for (const item of downloads.list().filter((i) => i.state === "progress")) downloads.remove(item.id, false);
    };
    // A handful at once.
    for (let i = 0; i < MAX_ACTIVE; i++) start("p1", `a-${i}`);
    assert.throws(() => start("p1", "nekt-1"), /For mange nedlastinger/);
    // The first refused one says why in the list; the next ones in the same minute are quiet.
    stopAll();
    for (let i = MAX_ACTIVE; i < MAX_STARTS_PER_MINUTE; i++) start("p1", `a-${i}`);
    assert.throws(() => start("p1", "nekt-2"), /For mange nedlastinger/);
    const refused = downloads.list().filter((i) => i.id.startsWith("nekt"));
    assert.deepEqual(refused.map((i) => i.id), ["nekt-1"], "bare den første vises");
    assert.equal(refused[0].state, "canceled");
    assert.match(refused[0].error ?? "", /mange filer på kort tid/);
    // Another project is not held back by the first one's page.
    stopAll();
    start("p2", "annet");
    assert.ok(downloads.list().some((i) => i.id === "annet" && i.state === "progress"));
    stopAll();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("servere: starttiden skiller en gjenbrukt PID fra prosessen appen startet", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
  try {
    const pid = child.pid!;
    const first = startTime(pid);
    assert.ok(first && /^\d+$/.test(first), "starttiden leses");
    assert.equal(startTime(pid), first, "den samme prosessen har den samme starttiden");
    assert.equal(startTime(2 ** 22 + 7), null, "en PID som ikke finnes, har ingen");
  } finally {
    child.kill("SIGTERM"); // Our own child, by its handle.
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

// Edge cases from agent G (round 8, second pass).
flow("kanttilfeller: panelfanene, hover-kortet, Innstillinger i smalt vindu og terminalfargene", async (h) => {
  const { page } = h;
  await openProject(h);
  const panel = page.locator(".right-panel");
  await openPanel(page);

  // The close button is never cut, at the widths and text sizes that cut it before.
  const closeInside = async (what: string) => {
    const bar = (await panel.locator(".panel-tabs-bar, .panel-toolbar").first().boundingBox())!;
    const close = (await panel.getByRole("button", { name: "Skjul panelet" }).boundingBox())!;
    assert.ok(close.x >= bar.x && close.x + close.width <= bar.x + bar.width + 0.5, `${what}: lukkeknappen er inne (${Math.round(close.x + close.width)} > ${Math.round(bar.x + bar.width)})`);
  };
  for (const [size, width] of [[14, 560], [16, 560], [16, 600], [14, 420]] as const) {
    await h.api("PATCH", "/api/settings", { uiFontSize: size });
    await page.evaluate((w) => {
      const prefs = JSON.parse(localStorage.getItem("ad-ui") ?? "{}");
      localStorage.setItem("ad-ui", JSON.stringify({ ...prefs, panelWidth: w, panelOpen: true }));
    }, width);
    await h.reload();
    await panel.waitFor();
    await waitFor(async () => Math.round((await panel.boundingBox())!.width) === width, `panelet er ${width} px`);
    await closeInside(`${size} px tekst, ${width} px panel`);
  }
  await h.api("PATCH", "/api/settings", { uiFontSize: 14 });

  // The hover card goes when the window narrows and the sidebar goes with it.
  await h.api("POST", "/api/threads", { projectId: (await h.api("GET", "/api/bootstrap")).projects[0].id, mode: "code" });
  const row = page.locator(".group-head").first();
  await row.hover();
  const card = page.getByTestId("hover-card-project");
  await card.waitFor();
  await page.setViewportSize({ width: 420, height: 800 });
  await waitFor(async () => (await card.count()) === 0, "kortet forsvinner når vinduet smalnes");

  // Innstillinger at 420 px: nothing past the edge, and «App» is whole.
  await page.keyboard.press("Control+,");
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `ingen vannrett skrolling (${overflow} px)`);
  const label = (await page.locator(".settings-nav-label", { hasText: "App" }).boundingBox())!;
  assert.ok(label.x >= 0 && label.x + label.width <= 420, "«App» er inne i vinduet");
  const search = (await page.getByLabel("Søk i innstillinger").boundingBox())!;
  assert.ok(search.x + search.width <= 420, "søkefeltet er inne i vinduet");
  await page.keyboard.press("Escape");

  // System: the terminal's colours follow the operating system switching to dark and back.
  await page.setViewportSize({ width: 1360, height: 860 });
  await h.api("PATCH", "/api/settings", { theme: "system" });
  await page.emulateMedia({ colorScheme: "light" });
  await openTool(page, "Terminal");
  await page.locator(".xterm").first().waitFor();
  // xterm draws on a canvas; the style it writes for its own scrollbar carries the theme's text colour.
  const background = () => page.evaluate(() => [...document.querySelectorAll(".xterm style")].map((st) => st.textContent ?? "").join("").match(/\.slider \{\s*background: (#[0-9a-f]+)/i)?.[1] ?? "");
  const light = await background();
  assert.ok(light, "fargen fra terminalen leses");
  await page.emulateMedia({ colorScheme: "dark" });
  await waitFor(async () => (await background()) !== light, "terminalen blir mørk");
  await page.emulateMedia({ colorScheme: "light" });
  await waitFor(async () => (await background()) === light, "og lys igjen");
});

flow("nedtrekkslister: et nytt klikk på knappen lukker menyen, og et valg lukker den", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.getByRole("button", { name: "Generelt", exact: true }).click();
  const button = page.getByRole("button", { name: "Åpne appen i" });
  await button.click();
  await page.locator(".select-menu").waitFor();
  // The press closes the menu, and the click after it must not open it again.
  await button.click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".select-menu").count(), 0, "et nytt klikk lukker menyen");
  await button.click();
  await page.locator(".select-menu .menu-item", { hasText: "Kode" }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".select-menu").count(), 0, "et valg lukker menyen");
  assert.match((await button.textContent()) ?? "", /Kode/);
  await button.click();
  await page.locator(".select-menu").waitFor();
});
