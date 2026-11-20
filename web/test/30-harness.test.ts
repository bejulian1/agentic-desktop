// Round 9b (SPEC 22): Innstillinger → Kode-harness (parts, the global AGENTS.md with «Gjenopprett
// standard» and the preview), Chat-personalisering, the memory upgrade, import of many skills, and
// «hei» in a new Kode thread answered from the system prompt.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { flow, openProject, send, threadItem, waitFor } from "./harness.ts";

const openSettings = async (page: Page, section: string) => {
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
  await page.locator(".settings-title", { hasText: section }).waitFor();
};

flow("Kode-harness: deler av og på, global AGENTS.md med forskjell og sikkerhetskopi, og forhåndsvisning lag for lag", async (h) => {
  const { page } = h;
  const config = path.join(h.home, ".config/agentic-desktop");
  const file = path.join(config, "AGENTS.md");
  const original = readFileSync(file, "utf8");
  assert.match(original, /^# Mine instruksjoner/, "standardfila ble laget ved første start");
  await h.createProject("Demo");
  await openSettings(page, "Konfigurasjon");

  assert.equal(await page.locator(".settings-nav").getByRole("button", { name: "Kode-harness", exact: true }).count(), 0);
  await page.getByLabel("Global AGENTS.md i Kode-harness", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Global AGENTS.md i Kode-harness", { exact: true }).count(), 1);
  await page.getByRole("heading", { name: "Global settings.json", exact: true }).waitFor();

  // A part on, then back to the defaults after seeing what changes.
  const ask = page.getByRole("switch", { name: /Spør før store endringer/ });
  assert.equal(await ask.isChecked(), false);
  await ask.check();
  await waitFor(async () => (await h.api("GET", "/api/harness")).parts.find((p: any) => p.id === "askFirst").on === true, "lagret");
  assert.equal(await page.getByRole("switch", { name: /Identitet/ }).isDisabled(), true, "identiteten er alltid på");

  // Edit the global file, then restore the default: the diff first, then a backup.
  const area = page.getByLabel("Global AGENTS.md i Kode-harness", { exact: true });
  await area.fill(`${original}\nSvar alltid på nynorsk.\n`);
  await page.locator(".settings-group", { hasText: "Global AGENTS.md" }).getByRole("button", { name: "Lagre", exact: true }).click();
  await page.locator(".toast", { hasText: "Lagret AGENTS.md" }).waitFor();
  assert.match(readFileSync(file, "utf8"), /Svar alltid på nynorsk/);
  await page.getByRole("button", { name: "Gjenopprett standard…" }).click();
  const review = page.getByTestId("agents-review");
  await review.locator(".diff-del", { hasText: "Svar alltid på nynorsk." }).waitFor();
  assert.match(await review.locator(".harness-diff-stats").textContent() ?? "", /\+0\s+−2/, "en tom linje og regelen");
  assert.ok(await review.locator(".diff-fold").count(), "like linjer er brettet sammen");
  await review.getByRole("button", { name: "Gjenopprett standard" }).click();
  await page.locator(".toast", { hasText: "Standard er gjenopprettet" }).waitFor();
  assert.equal(readFileSync(file, "utf8"), original);
  const backups = readdirSync(path.join(config, "backups"));
  assert.equal(backups.length, 1);
  assert.match(readFileSync(path.join(config, "backups", backups[0]), "utf8"), /Svar alltid på nynorsk/);

  // The parts: «Gjenopprett standard» lists what goes back.
  await page.locator(".settings-group", { hasText: "Grunn-harness" }).getByRole("button", { name: "Gjenopprett standard" }).click();
  await page.getByTestId("parts-review").getByText("Spør før store endringer").waitFor();
  await page.getByTestId("parts-review").getByRole("button", { name: "Gjenopprett" }).click();
  await waitFor(async () => !(await ask.isChecked()), "tilbake til av");

  // The preview: every layer with tokens, and the text when one is opened.
  const layers = page.locator(".harness-layer");
  await waitFor(async () => (await layers.count()) >= 3, "lagene i Kode");
  assert.deepEqual((await layers.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.layer))).slice(0, 4), ["base", "env", "skills", "global"]);
  await page.locator('.harness-layer[data-layer="base"] summary').click();
  await page.locator('.harness-layer[data-layer="base"] .harness-layer-text', { hasText: "You are the coding agent in Agentic Desktop" }).waitFor();
  assert.match(await page.getByTestId("prompt-total").textContent() ?? "", /tokens i \d lag.*verktøy på/);
  await page.getByRole("group", { name: "Forhåndsvis modus" }).getByRole("button", { name: "Chat" }).click();
  // v0.27: Chat also lists its document skills.
  await waitFor(async () => (await layers.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.layer))).sort().join() === "chat-base,chat-personal,skills,ui-mods", "Chat-grunnen, standardinstruksen, skills og Tema og mods");
});

flow("Chat-personalisering er egen, og «hei» i en ny Kode-tråd kjenner seg selv", async (h) => {
  const { page } = h;
  await openSettings(page, "Personalisering og minner");
  assert.equal(await page.locator(".settings-nav").getByRole("button", { name: "Chat-personalisering", exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Lagrede minner", exact: true, includeHidden: true }).count(), 1);
  await page.getByRole("group", { name: "Personalisering for", exact: true }).getByRole("button", { name: "Chat", exact: true }).click();
  const defaults = (await h.api("GET", "/api/chat-personal")).defaults;
  assert.ok(defaults.instructions.length > 0);
  assert.equal(await page.getByLabel("Systeminstruks", { exact: true }).inputValue(), defaults.instructions);
  await page.getByLabel("Systeminstruks", { exact: true }).fill("Bruk eksempler fra fotball.");
  await page.getByLabel("Om deg", { exact: true }).fill("Jeg er lærer i Bergen.");
  await page.locator(".chat-count").first().getByText("4 / 10 000 ord").waitFor();
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await page.locator(".toast", { hasText: "Nye svar i Chat bruker det" }).waitFor();
  await page.getByRole("switch", { name: /Oppdater minnet av seg selv/ }).check();
  await waitFor(async () => (await h.api("GET", "/api/chat-personal")).personal.autoMemory === true, "lagret");
  const chat = await h.api("GET", "/api/harness/preview?mode=chat");
  const chatText = chat.layers.map((l: any) => l.text).join("\n");
  assert.match(chatText, /fotball/);
  assert.match(chatText, /Bergen/);
  await page.getByRole("button", { name: "Gjenopprett standard", exact: true }).click();
  const resetDialog = page.getByRole("dialog");
  await resetDialog.getByRole("button", { name: "Gjenopprett standard", exact: true }).click();
  await waitFor(async () => (await page.getByLabel("Systeminstruks", { exact: true }).inputValue()) === defaults.instructions, "standardinstruksen tilbake");
  const restored = (await h.api("GET", "/api/chat-personal")).personal;
  assert.equal(restored.about, "Jeg er lærer i Bergen.");
  assert.equal(restored.autoMemory, true);
  assert.equal(await page.getByLabel("Om deg", { exact: true }).inputValue(), "Jeg er lærer i Bergen.");
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  await openProject(h);
  await send(page, "hei");
  const answer = page.locator(".row-text").first();
  await answer.getByText(/Jeg er kodeagenten i Agentic Desktop/).first().waitFor();
  await answer.locator("code", { hasText: "read_file" }).first().waitFor();
  await answer.getByText("din globale").first().waitFor();
  assert.doesNotMatch(await answer.textContent() ?? "", /fotball|Bergen/, "Kode får ikke Chat-personaliseringen");
});

flow("sammenslått personalisering: 10 000 ord og separate Chat- og Kode-minner", async (h) => {
  const { page } = h;
  await h.api("POST", "/api/memories", { scope: "global", text: "Kode bruker bare kodeverktøy." });
  await h.api("POST", "/api/chat-personal/memories", { text: "Chat bruker mine hverdagseksempler." });
  await openSettings(page, "Personalisering og minner");
  const chat = page.locator('section[aria-label="Chat-personalisering"]');
  const code = page.locator('section[aria-label="Kode-minner"]');
  assert.equal(await page.locator(".settings-title").count(), 1);
  await chat.getByText("Chat bruker mine hverdagseksempler.", { exact: true }).waitFor();
  const modes = page.getByRole("group", { name: "Personalisering for", exact: true });
  await modes.getByRole("button", { name: "Kode", exact: true }).click();
  await code.getByText("Kode bruker bare kodeverktøy.", { exact: true }).waitFor();
  await modes.getByRole("button", { name: "Chat", exact: true }).click();

  const longText = Array.from({ length: 10_000 }, () => "ord").join(" ");
  await chat.getByLabel("Systeminstruks", { exact: true }).fill(longText);
  await chat.getByLabel("Om deg", { exact: true }).fill(longText);
  await modes.getByRole("button", { name: "Kode", exact: true }).click();
  await modes.getByRole("button", { name: "Chat", exact: true }).click();
  assert.equal(await chat.getByLabel("Om deg", { exact: true }).inputValue(), longText, "uskrevne endringer beholdes ved modusbytte");
  const save = chat.getByRole("button", { name: "Lagre", exact: true });
  assert.equal(await save.isEnabled(), true);
  await save.click();
  await waitFor(async () => (await h.api("GET", "/api/chat-personal")).personal.about === longText, "10 000 ord lagret uten avkutting");
  assert.equal((await h.api("GET", "/api/chat-personal")).personal.instructions, longText);
  await chat.getByLabel("Om deg", { exact: true }).fill(`${longText} ekstra`);
  assert.equal(await save.isDisabled(), true);
  assert.equal(await chat.getByLabel("Om deg", { exact: true }).inputValue(), `${longText} ekstra`, "utkastet beholdes mens det er over grensen");
  await chat.getByRole("alert").getByText(/10 000 ord/).waitFor();
  await chat.getByLabel("Om deg", { exact: true }).fill("Min profil");
  await save.click();
  await waitFor(async () => (await h.api("GET", "/api/chat-personal")).personal.about === "Min profil", "retting kan lagres");

  // Both delete actions are on one page, and each stays within its own data scope.
  await modes.getByRole("button", { name: "Kode", exact: true }).click();
  await code.getByRole("button", { name: "Slett alle", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Slett alle", exact: true }).click();
  await waitFor(async () => (await h.api("GET", "/api/memories")).global.items.length === 0, "Kode-minner slettet");
  assert.equal((await h.api("GET", "/api/chat-personal")).memories.length, 1, "Chat-minnet beholdes");
  await modes.getByRole("button", { name: "Chat", exact: true }).click();
  await chat.getByText("Chat bruker mine hverdagseksempler.", { exact: true }).waitFor();
  const codePrompt = (await h.api("GET", "/api/harness/preview?mode=code")).layers.map((l: any) => l.text).join("\n");
  assert.doesNotMatch(codePrompt, /Min profil|Chat bruker mine hverdagseksempler/);
  await page.getByLabel("Søk i innstillinger").fill("rydd i minnene nå");
  await page.locator(".search-result", { hasText: "Rydd i minnene nå" }).click();
  await code.getByRole("button", { name: "Lag forslag", exact: true }).waitFor();
  await page.getByLabel("Søk i innstillinger").fill("systeminstruks");
  await page.locator(".search-result", { hasText: "Systeminstruks" }).click();
  await chat.getByLabel("Systeminstruks", { exact: true }).waitFor();
});

flow("minneoppgradering: forslaget vises først, og bare det som er valgt lagres", async (h) => {
  const { page } = h;
  for (const text of ["Brukeren liker TypeScript", "Brukeren liker TypeScript.", "Husk at brukeren bruker Linux"]) await h.api("POST", "/api/memories", { scope: "global", text });
  await openSettings(page, "Personalisering og minner");
  await page.getByRole("group", { name: "Personalisering for", exact: true }).getByRole("button", { name: "Kode", exact: true }).click();
  await page.getByRole("button", { name: "Lag forslag" }).click();
  const view = page.getByTestId("memory-upgrade");
  await view.locator(".upgrade-op").nth(1).waitFor();
  assert.match(await view.textContent() ?? "", /2 endringer, laget av faste regler/);
  await view.locator(".upgrade-new", { hasText: "Brukeren bruker Linux" }).waitFor();
  // Leave the shortening out.
  await view.locator(".upgrade-op", { hasText: "Kort ned" }).getByRole("checkbox").uncheck();
  await view.getByRole("button", { name: "Lagre valgte (1)" }).click();
  await page.locator(".toast", { hasText: "Minnene er ryddet" }).waitFor();
  await waitFor(async () => (await page.locator(".memory-row").count()) === 2, "to minner igjen");
  assert.deepEqual((await h.api("GET", "/api/memories")).global.items.map((i: any) => i.text), ["Brukeren liker TypeScript.", "Husk at brukeren bruker Linux"]);
});

flow("skills: importer mange filer, med navnekollisjon og feil per fil, og ved å dra inn", async (h) => {
  const { page } = h;
  await h.api("POST", "/api/skills", { scope: "user", name: "kjor-tester", description: "Kjører testene", body: "Gammel" });
  const dir = path.join(h.dataDir, "import");
  mkdirSync(dir, { recursive: true });
  const write = (name: string, text: string) => {
    writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  };
  const files = [
    write("kjor-tester.md", "---\nname: kjor-tester\ndescription: Kjører testene og leser feilene\n---\nNy"),
    write("lag-release.md", "---\nname: lag-release\ndescription: Lager en release\n---\n1. Bump versjonen"),
    write("uten.md", "# Bare en overskrift"),
  ];
  await openSettings(page, "Skills");
  await page.getByTestId("skill-files").setInputFiles(files);
  const panel = page.getByTestId("skill-import");
  await panel.locator(".import-row").nth(2).waitFor();
  assert.match(await panel.locator(".skill-import-head").textContent() ?? "", /1 klare · 1 med navn som er tatt · 1 ugyldige/);
  await panel.locator('.import-row[data-file="uten.md"]').getByText(/Mangler frontmatter/).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Importer 1 skill" }).count(), 1, "kollisjonen hoppes over til du velger");
  await panel.getByRole("button", { name: "Hva skal skje med kjor-tester" }).click();
  await page.getByRole("menuitemradio", { name: "Behold begge (kjor-tester-2)" }).click();
  await panel.getByRole("switch", { name: "Slå på lag-release etter import" }).uncheck();
  await panel.getByRole("button", { name: "Importer 2 skills" }).click();
  await page.locator(".toast", { hasText: "2 skills er importert" }).waitFor();
  await page.locator(".skill-row", { hasText: "kjor-tester-2" }).waitFor();
  const skills = (await h.api("GET", "/api/skills")).skills;
  assert.equal(skills.find((s: any) => s.name === "lag-release").enabled, false);
  assert.equal(skills.find((s: any) => s.name === "kjor-tester").description, "Kjører testene", "den gamle er urørt");

  // Dropped on the page.
  await page.locator(".skills-drop").evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(["---\nname: dratt-inn\ndescription: Kom med dra og slipp\n---\nSteg"], "dratt-inn.md", { type: "text/markdown" }));
    el.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await page.getByTestId("skill-import").getByRole("button", { name: "Importer 1 skill" }).click();
  await page.locator(".skill-row", { hasText: "dratt-inn" }).waitFor();
  assert.ok(existsSync(path.join(h.home, ".config/agentic-desktop/skills/dratt-inn/SKILL.md")));
});

flow("innstillingsredigering beskytter bakgrunnstråden mot dokumentsnarveier", async (h) => {
  const { page } = h;
  const thread = await h.createThread(null);
  await threadItem(page, thread.id).locator(".thread-text").click();
  const focused = page.locator(`.pane-inner.focused[data-thread-id="${thread.id}"]`);
  await focused.waitFor();
  await openSettings(page, "Personalisering og minner");
  await page.getByRole("group", { name: "Personalisering for", exact: true }).getByRole("button", { name: "Chat", exact: true }).click();
  const field = page.getByLabel("Om deg", { exact: true });
  await field.fill("Ulagret profiltekst");
  await field.focus();
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PATCH", "DELETE"].includes(request.method()) && /\/api\/threads(?:\/|$)/.test(new URL(request.url()).pathname)) mutations.push(request.url());
  });
  await page.keyboard.press("Control+Shift+A");
  await page.keyboard.press("Control+J");
  await page.keyboard.press("Control+Alt+P");
  await page.keyboard.press("Control+Shift+M");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const bootstrap = await h.api("GET", "/api/bootstrap");
  assert.equal(bootstrap.threads.find((item: any) => item.id === thread.id)?.archived, false);
  assert.equal(!!bootstrap.threads.find((item: any) => item.id === thread.id)?.pinned, false);
  assert.deepEqual(mutations, [], "snarveiene endrer ingen tråder bak innstillingene");
  assert.equal(await focused.count(), 1, "den aktive bakgrunnstråden beholdes");
  assert.equal(await field.inputValue(), "Ulagret profiltekst");
  await page.keyboard.press("Control+,");
  await page.getByRole("region", { name: "Innstillinger", exact: true }).waitFor({ state: "detached" });
  await page.keyboard.press("Control+,");
  await page.getByRole("region", { name: "Innstillinger", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Innstillinger", exact: true }).waitFor({ state: "detached" });
});
