// Round 14 (SPEC 30): key fields with an eye and the line about the keyring, the app icon in
// Utseende, forks with a link back, the archive, and the bar that takes the message field's place
// when the project folder is gone.
import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import type { Page } from "playwright-core";
import { useFolderPickerFallback, flow, openProject, send, threadItem, waitFor } from "./harness.ts";

const focused = (page: Page) => page.locator(".pane-inner.focused");

async function openSettings(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByText(name, { exact: true }).click();
}

// The things every key field must be: dots, no autofill or spell checking, and an eye.
async function checkSecretField(page: Page, label: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true });
  await field.fill("sk-hemmelig-123");
  assert.equal(await field.getAttribute("type"), "password");
  assert.equal(await field.getAttribute("autocomplete"), "off");
  assert.equal(await field.getAttribute("spellcheck"), "false");
  const eye = field.locator("xpath=following-sibling::button[1]");
  assert.equal(await eye.getAttribute("aria-label"), "Vis teksten");
  await eye.click();
  assert.equal(await field.getAttribute("type"), "text");
  assert.equal(await eye.getAttribute("aria-pressed"), "true");
  assert.equal(await eye.getAttribute("aria-label"), "Skjul teksten");
  assert.ok(await field.evaluate((el) => el === document.activeElement), "fokuset blir i feltet");
  await eye.click();
  assert.equal(await field.getAttribute("type"), "password");
}

flow("30.1: nøkkelfeltene viser prikker med et øye, og uten nøkkelring sier Leverandører det i én linje", async (h) => {
  const { page } = h;
  await openSettings(page, "Modeller og leverandører");
  // The keyring works here (a keyring in memory for the tests): no line.
  assert.equal(await page.getByTestId("keyring-note").count(), 0);
  await page.getByRole("button", { name: "Koble til OpenRouter" }).click();
  await checkSecretField(page, "OpenRouter-API-nøkkel");
  await page.getByText("Nøkkelen lagres kryptert i systemets nøkkelring").waitFor();
  await page.getByRole("button", { name: "Tilbake til leverandørene" }).click();
  // Egendefinert has the same field.
  await page.getByRole("button", { name: "Egendefinert (OpenAI-kompatibel adresse)" }).click();
  await checkSecretField(page, "Nøkkel");
  await page.locator(".settings-nav").getByText("GitHub", { exact: true }).click();
  await checkSecretField(page, "GitHub-token");
  await page.getByText("Tokenet lagres kryptert i systemets nøkkelring").waitFor();

  // A key saved: the field is emptied and shows dots again.
  await page.locator(".settings-nav").getByText("Modeller og leverandører", { exact: true }).click();
  await page.getByRole("button", { name: "Koble til Anthropic" }).click();
  // A port where nothing answers, so no real API is called when the model list is fetched.
  h.allow(/status of 502/);
  const view = page.getByRole("region", { name: "Koble til Anthropic" });
  await view.locator("summary", { hasText: "Adresse" }).click();
  await view.getByLabel("Adresse").fill("http://127.0.0.1:9");
  const key = page.getByLabel("Anthropic-API-nøkkel", { exact: true });
  await key.fill("sk-ant-test");
  await key.locator("xpath=following-sibling::button[1]").click();
  assert.equal(await key.getAttribute("type"), "text");
  await page.getByRole("button", { name: "Fortsett" }).click();
  await page.getByText("Anthropic er koblet til").waitFor();
  const providers = (await h.api("GET", "/api/bootstrap")).providers;
  assert.ok(providers.some((p: any) => p.name === "Anthropic" && p.hasKey));
  assert.ok(!JSON.stringify(providers).includes("sk-ant-test"));
});

flow("30.1: uten nøkkelring: én rolig linje, Prøv igjen, og teksten i Personvern", async (h) => {
  const { page } = h;
  await openSettings(page, "Modeller og leverandører");
  const note = page.getByTestId("keyring-note");
  await note.getByText("Fant ingen nøkkelring på maskinen, så nye nøkler gjelder bare til appen lukkes.").waitFor();
  assert.equal(await note.getAttribute("role"), "status");
  await note.getByRole("button", { name: "Prøv igjen" }).click();
  await note.getByText("Fant ingen nøkkelring").waitFor();
  // v0.20: the page states where keys are kept now, and that no plain-text copy is written.
  await page.getByTestId("key-storage-status").getByText("Kun denne økten", { exact: true }).waitFor();
  await page.getByText("Nye nøkler lagres ikke i en klartekstfil av appen").waitFor();
  await page.locator(".settings-nav").getByText("Personvern og data", { exact: true }).click();
  await page.getByText("Bare i minnet til appen lukkes").waitFor();
}, { env: { AD_KEYRING: "none" } });

flow("30.2: Appikon i Utseende bytter fanens ikon med en gang, og valget huskes", async (h) => {
  const { page } = h;
  // The default from the start: the speech bubble.
  assert.equal(await page.locator('link[rel="icon"]').getAttribute("href"), "/app-icons/boble-tab.svg");
  const res = await page.evaluate(async () => {
    const r = await fetch("/app-icons/terminal.svg");
    return { status: r.status, type: r.headers.get("content-type"), text: await r.text() };
  });
  assert.equal(res.status, 200);
  assert.match(res.type ?? "", /image\/svg\+xml/);
  assert.match(res.text, /^<svg/);

  await openSettings(page, "Utseende");
  const cards = page.getByTestId("app-icon-cards");
  assert.deepEqual(await cards.getByRole("radio").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["Snakkeboble", "Snakkeboble, lys", "Monogram", "Terminal"]);
  assert.equal(await cards.getByRole("radio", { name: "Snakkeboble", exact: true }).getAttribute("aria-checked"), "true");
  await page.getByTestId("app-icon-scope").getByText("Gjelder fanen i nettleseren").waitFor();
  // Every preview has its picture.
  for (const img of await cards.locator("img").all()) assert.ok(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), await img.getAttribute("src") ?? "");

  await cards.getByRole("radio", { name: "Terminal" }).click();
  await waitFor(async () => (await page.locator('link[rel="icon"]').getAttribute("href")) === "/app-icons/terminal-tab.svg", "fanens ikon");
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.appIcon === "terminal", "lagret");
  // Arrow keys move the choice.
  await cards.getByRole("radio", { name: "Terminal" }).focus();
  await page.keyboard.press("ArrowLeft");
  await waitFor(async () => (await cards.getByRole("radio", { name: "Monogram" }).getAttribute("aria-checked")) === "true", "piltast");
  await waitFor(async () => (await page.locator('link[rel="icon"]').getAttribute("href")) === "/app-icons/monogram-tab.svg", "fanens ikon følger");

  // After a reload the tab has it before the app has started (public/theme.js).
  await page.reload();
  assert.equal(await page.locator('link[rel="icon"]').getAttribute("href"), "/app-icons/monogram-tab.svg");
  await page.waitForSelector(".app");
  await h.api("PATCH", "/api/settings", { appIcon: "boble-lys" });
  await waitFor(async () => (await page.locator('link[rel="icon"]').getAttribute("href")) === "/app-icons/boble-lys-tab.svg", "et annet vindu får valget");
  h.allow(/status of 400/);
  await assert.rejects(h.api("PATCH", "/api/settings", { appIcon: "finnes-ikke" }), /400/);
});

flow("30.3: gaffel fra en melding, med lenke tilbake øverst og i sidefanen, og en strek der gaffelen starter", async (h) => {
  const { page } = h;
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title: "Reiseplan" });
  for (const [i, text] of ["første spørsmål", "andre spørsmål"].entries()) {
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text });
    await waitFor(async () => (await h.events(thread.id)).filter((e: any) => e.event.type === "run.finished").length === i + 1, `svar ${i + 1}`);
  }
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  await threadItem(page, thread.id).locator(".thread-text").click();
  await waitFor(async () => (await focused(page).getAttribute("data-thread-id")) === thread.id, "tråden er åpen");

  const first = focused(page).locator(".row-user", { hasText: "første spørsmål" });
  await first.hover();
  await first.getByRole("button", { name: "Gaffel herfra" }).click();
  await page.locator(".toast", { hasText: "Laget «Reiseplan (gaffel)»" }).waitFor();
  const forkId = await waitFor(async () => (await focused(page).getAttribute("data-thread-id")) !== thread.id, "gaffelen er åpnet").then(() => focused(page).getAttribute("data-thread-id"));
  const fork = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === forkId);
  assert.equal(fork.title, "Reiseplan (gaffel)");
  assert.equal(fork.forkedFrom.threadId, thread.id);

  // At the top: where it came from, and a link back.
  const banner = focused(page).getByTestId("fork-banner");
  await banner.getByText("Samtalen til og med meldingen er kopiert herfra.").waitFor();
  // In the top bar, and with a small fork in the sidebar.
  await page.getByTestId("fork-origin").getByText("Reiseplan", { exact: true }).waitFor();
  assert.equal(await threadItem(page, forkId!).locator(".thread-fork").getAttribute("title"), "Gaffel av Reiseplan");
  // The line where the fork starts: at the end now, before the first new message later.
  await focused(page).locator(".fork-end").getByTestId("fork-divider").waitFor();
  await send(page, "et nytt spor");
  await focused(page).locator(".row-user", { hasText: "et nytt spor" }).getByTestId("fork-divider").waitFor();
  assert.equal(await focused(page).locator(".fork-end").count(), 0);
  assert.equal(await focused(page).getByTestId("fork-divider").count(), 1);

  // The hover card links back too.
  await threadItem(page, forkId!).hover();
  await page.locator(".hover-card-fork", { hasText: "Gaffel av Reiseplan" }).waitFor();
  await page.mouse.move(700, 400);

  // The link opens the original.
  await banner.getByRole("button", { name: "Reiseplan" }).click();
  await waitFor(async () => (await focused(page).getAttribute("data-thread-id")) === thread.id, "originalen er åpnet");
  // Lag gaffel › Av hele tråden in the thread menu, named (gaffel 2).
  await threadItem(page, thread.id).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Lag gaffel/ }).hover();
  await page.locator('.context-menu[data-depth="1"]').getByRole("menuitem", { name: "Av hele tråden" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.title === "Reiseplan (gaffel 2)"), "den andre gaffelen");
});

flow("30.4: arkiver alle trådene i et prosjekt med Angre, og hent dem tilbake fra arkivet", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Butikk");
  const ids: string[] = [];
  for (const title of ["Handlekurv", "Betaling"]) {
    const t = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code" });
    await h.api("PATCH", `/api/threads/${t.id}`, { title });
    ids.push(t.id);
  }
  await threadItem(page, ids[0]).waitFor();
  const group = page.locator('.group[data-project="Butikk"]');
  const menu = async () => {
    await group.locator(".group-head").hover();
    await group.getByRole("button", { name: "Valg for prosjektet" }).click();
  };
  await menu();
  await page.getByRole("menuitem", { name: "Arkiver alle trådene" }).click();
  const toast = page.locator(".toast", { hasText: "Arkiverte 2 tråder fra «Butikk»." });
  await toast.waitFor();
  await waitFor(async () => (await threadItem(page, ids[0]).count()) === 0, "borte fra sidefanen");
  // Angre brings them back.
  await toast.getByRole("button", { name: "Angre" }).click();
  await threadItem(page, ids[0]).waitFor();
  await threadItem(page, ids[1]).waitFor();

  // Archived again; the project's menu and the empty project lead to the archive, which shows this project.
  await menu();
  await page.getByRole("menuitem", { name: "Arkiver alle trådene" }).click();
  await waitFor(async () => (await threadItem(page, ids[1]).count()) === 0, "arkivert igjen");
  await group.locator(".sidebar-empty-link", { hasText: "2 arkiverte" }).click();
  await page.getByText("Viser bare «Butikk».").waitFor();
  await page.locator(`.setting[data-archived="${ids[0]}"]`).waitFor();
  // Gjenopprett alle for the project.
  await page.getByRole("button", { name: "Gjenopprett alle (2)" }).click();
  await page.getByText("Ingen arkiverte tråder.").waitFor();
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await threadItem(page, ids[0]).waitFor();

  // One thread: Arkiver in its menu, with Angre in the toast.
  await threadItem(page, ids[0]).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Arkiver" }).click();
  await page.locator(".toast", { hasText: "Arkiverte «Handlekurv»." }).getByRole("button", { name: "Angre" }).click();
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === ids[0]).archived, "angret");
  // The archive is in the sidebar's ⋯ too.
  await page.getByTestId("sidebar-menu").click();
  await page.getByRole("menuitem", { name: "Arkiverte tråder" }).click();
  await page.locator(".settings-title", { hasText: "Arkiverte tråder" }).waitFor();
});

flow("30.5: mappen mangler: en bar i meldingsfeltets sted, Arkiver chattene, og feltet tilbake etter nytt navn", async (h) => {
  const { page } = h;
  h.allow(/status of 409/);
  const project = await openProject(h, "Appen");
  const thread = await h.createThread(project.id);
  await threadItem(page, thread.id).locator(".thread-text").click();
  await waitFor(async () => (await focused(page).getAttribute("data-thread-id")) === thread.id, "tråden er åpen");
  const form = focused(page).locator("form.composer");
  await form.locator("textarea").waitFor();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  let before = await form.boundingBox();
  await waitFor(async () => !!(before = await form.boundingBox()), "meldingsfeltet har en størrelse");

  const moved = `${h.projectDir}-nytt-navn`;
  renameSync(h.projectDir, moved);
  try {
    await h.reload();
    await threadItem(page, thread.id).locator(".thread-text").click();
    const bar = focused(page).getByTestId("folder-missing");
    await bar.waitFor();
    await bar.getByText("Den er flyttet, har fått nytt navn eller er slettet.").waitFor();
    assert.match((await bar.innerText()).replace(/\s+/g, " "), /^Fant ikke mappen \S+\. Den er flyttet, har fått nytt navn eller er slettet\./);
    assert.equal(await bar.locator(".folder-bar-path").getAttribute("title"), h.projectDir);
    // The field is gone, and the bar has its place: the same width and shape, and the height of the
    // field with the text on one line, or one line more where it wraps.
    assert.equal(await form.isVisible(), false);
    const box = (await bar.boundingBox())!;
    assert.ok(Math.abs(box.width - before!.width) <= 1, `samme bredde (${box.width} / ${before!.width})`);
    assert.ok([0, 21].some((extra) => Math.abs(box.height - before!.height - extra) <= 1.5), `høyden (${box.height} / ${before!.height})`);
    assert.equal(await bar.evaluate((el) => getComputedStyle(el).borderRadius), await form.evaluate((el) => getComputedStyle(el).borderRadius));

    // Arkiver chattene, with Angre.
    await bar.getByRole("button", { name: "Arkiver chattene" }).click();
    const toast = page.locator(".toast", { hasText: "Arkiverte 1 chat fra «Appen»." });
    await toast.waitFor();
    await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id).archived, "arkivert");
    assert.equal(await bar.getByRole("button", { name: "Arkiver chattene" }).isDisabled(), true, "ingenting mer å arkivere");
    await toast.getByRole("button", { name: "Angre" }).click();
    await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.id === thread.id).archived, "angret");

    // Velg prosjektmappe: the folder with its new name. The same project and thread go on, and
    // the field is back at once, ready to write in.
    await useFolderPickerFallback(h);
    await bar.getByRole("button", { name: "Velg prosjektmappe" }).click();
    const dialog = page.getByRole("dialog", { name: "Velg mappe" });
    await dialog.getByLabel("Sti", { exact: true }).fill(moved);
    await dialog.getByRole("button", { name: "Velg denne mappen" }).click();
    await bar.waitFor({ state: "detached" });
    await form.locator("textarea").waitFor();
    await waitFor(() => form.locator("textarea").evaluate((el) => el === document.activeElement), "feltet har fokus");
    assert.equal((await h.api("GET", `/api/projects/${project.id}`)).path, moved);
    assert.equal(await focused(page).getAttribute("data-thread-id"), thread.id);
  } finally {
    renameSync(moved, h.projectDir);
    mkdirSync(h.projectDir, { recursive: true });
  }
});

flow("30.5: baren i mørkt tema og i en smal rute", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Smal");
  const thread = await h.createThread(project.id);
  const moved = `${h.projectDir}-borte`;
  renameSync(h.projectDir, moved);
  try {
    await h.reload();
    await threadItem(page, thread.id).locator(".thread-text").click();
    const bar = focused(page).getByTestId("folder-missing");
    await bar.waitFor();
    await page.setViewportSize({ width: 480, height: 800 });
    // Both buttons fit, side by side or under each other, and nothing spills out of the bar.
    const box = (await bar.boundingBox())!;
    for (const name of ["Arkiver chattene", "Velg prosjektmappe"]) {
      const button = (await bar.getByRole("button", { name }).boundingBox())!;
      assert.ok(button.x >= box.x && button.x + button.width <= box.x + box.width + 0.5, name);
    }
  } finally {
    renameSync(moved, h.projectDir);
  }
}, { theme: "dark" });
