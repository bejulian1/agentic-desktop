// Innstillinger → Hooks, end to end with the demo model. Every hook command only reads stdin and
// writes to a temporary folder of the test's own.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator, Page } from "playwright-core";
import { flow, openProject, send, waitFor, type Harness } from "./harness.ts";

const quote = (file: string) => `'${file.replace(/'/g, `'\\''`)}'`;
const idle = (h: Harness) => waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.running), "turen er ferdig", 30_000);
const hookRow = (page: Page, name: string) => page.locator(".hook-row", { has: page.locator(".skill-name", { hasText: name }) });

async function openHooks(page: Page): Promise<Locator> {
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: "Hooks", exact: true }).click();
  const settings = page.locator(".settings-page");
  await settings.locator(".settings-title", { hasText: "Hooks" }).waitFor();
  return settings;
}

async function newHook(page: Page, settings: Locator, hook: { name: string; event?: string; matcher?: string; command: string }): Promise<Locator> {
  await settings.getByRole("button", { name: "Ny hook", exact: true }).click();
  const form = settings.locator("form.hook-form");
  await form.waitFor();
  await form.getByRole("textbox", { name: "Navn", exact: true }).fill(hook.name);
  if (hook.event) {
    await form.getByRole("button", { name: "Hendelse", exact: true }).click();
    await page.getByRole("menu", { name: "Hendelse" }).getByRole("menuitemradio", { name: new RegExp(`\\(${hook.event}\\)`) }).click();
  }
  if (hook.matcher !== undefined) await form.getByRole("textbox", { name: "Verktøy", exact: true }).fill(hook.matcher);
  await form.getByRole("textbox", { name: "Kommando (bash)", exact: true }).fill(hook.command);
  return form;
}

flow("Hooks: eksempler, Test, blokkering i Kode, tilbakemelding, stoppet melding, av og slett", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { theme: "dark" });
  const out = mkdtempSync(path.join(tmpdir(), "ad-ui-hooks-"));
  try {
    const settings = await openHooks(page);
    assert.equal(await page.locator(".settings-title .demo-badge").count(), 0, "ikke Demo");
    await settings.getByText("Ingen hooks ennå").waitFor();
    assert.ok(await settings.getByText(/hooks\.json/).first().isVisible(), "filen er nevnt");
    await page.screenshot({ path: "/tmp/ad-025-hooks-empty-dark.png" });

    // Each ready-made example opens in the form, and nothing is saved before «Lag hook».
    const examples: Array<[string, string, RegExp, string]> = [
      ["Formater etter filendringer", "Formater med Prettier", /prettier --write/, "Etter verktøykall (PostToolUse)"],
      ["Skrivebordsvarsel når turen er ferdig", "Varsel når ferdig", /notify-send/, "Når turen er ferdig (Stop)"],
      ["Stopp rm -rf i kommandoer", "Ingen rm -rf", /exit 2/, "Før verktøykall (PreToolUse)"],
    ];
    for (const [title, name, command, event] of examples) {
      await settings.getByRole("button", { name: "Eksempler", exact: true }).click();
      const menu = page.getByRole("menu", { name: "Eksempler på hooks" });
      const item = menu.getByRole("menuitem", { name: new RegExp(`^${title}`) });
      await item.waitFor();
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
      // A plain left-aligned menu row: the title, then its description, from the same left edge.
      const [nameBox, descBox] = [await item.locator(".menu-name").boundingBox(), await item.locator(".menu-desc").boundingBox()];
      assert.ok(nameBox && descBox && Math.abs(nameBox.x - descBox.x) < 1 && descBox.y >= nameBox.y + nameBox.height - 1, `${title}: tittel og beskrivelse står under hverandre fra venstre`);
      assert.equal(await item.locator(".menu-name").evaluate((el) => getComputedStyle(el).textAlign), "left");
      if (title === examples[0][0]) await page.screenshot({ path: "/tmp/ad-025-hooks-examples-dark.png" });
      await item.click();
      const form = settings.locator("form.hook-form");
      await form.waitFor();
      assert.equal(await form.getByRole("textbox", { name: "Navn", exact: true }).inputValue(), name);
      assert.match(await form.getByRole("textbox", { name: "Kommando (bash)", exact: true }).inputValue(), command);
      assert.match(await form.getByRole("button", { name: "Hendelse", exact: true }).innerText(), new RegExp(event.replace(/[()]/g, "\\$&")));
      await form.getByRole("button", { name: "Avbryt", exact: true }).click();
      await form.waitFor({ state: "detached" });
    }
    assert.equal((await h.api("GET", "/api/hooks")).hooks.length, 0, "eksemplene lagrer ingenting");

    // PreToolUse that stops run_command. «Test» runs it once and says what it would have done.
    const pre = await newHook(page, settings, { name: "Ingen kommandoer", matcher: "run_command", command: `cat > ${quote(path.join(out, "pre.json"))}; echo "Kommandoer er sperret i testen" >&2; exit 2` });
    for (const name of ["Navn", "Verktøy", "Kommando (bash)"]) await pre.getByRole("textbox", { name, exact: true }).waitFor();
    await pre.getByRole("spinbutton", { name: "Tidsgrense (sekunder)", exact: true }).waitFor();
    await pre.getByRole("button", { name: "Test", exact: true }).click();
    const result = pre.locator(".hook-test");
    await result.waitFor();
    assert.match(await result.innerText(), /Stoppet, avslutningskode 2/);
    assert.match(await result.innerText(), /Ville stoppet verktøykallet\. Modellen ville fått: Kommandoer er sperret i testen/);
    assert.match(await result.locator("pre").last().innerText(), /Kommandoer er sperret i testen/);
    assert.ok(existsSync(path.join(out, "pre.json")), "testen kjørte kommandoen");
    await page.screenshot({ path: "/tmp/ad-025-hooks-form-dark.png" });
    await pre.getByRole("button", { name: "Lag hook", exact: true }).click();
    await hookRow(page, "Ingen kommandoer").waitFor();
    rmSync(path.join(out, "pre.json"));

    // PostToolUse that adds feedback after edit_file.
    const post = await newHook(page, settings, { name: "Påminnelse", event: "PostToolUse", matcher: "edit_file", command: `echo "Husk testene" >&2; exit 2` });
    await post.getByRole("button", { name: "Test", exact: true }).click();
    await post.locator(".hook-test").getByText(/Ville lagt dette til i verktøyresultatet: Husk testene/).waitFor();
    await post.getByRole("button", { name: "Lag hook", exact: true }).click();
    await hookRow(page, "Påminnelse").waitFor();

    // UserPromptSubmit that keeps a message with a password from the model. No tool filter.
    const prompt = await newHook(page, settings, { name: "Passordvakt", event: "UserPromptSubmit", command: `if grep -q passord; then echo "Ikke send passord" >&2; exit 2; fi` });
    assert.equal(await prompt.getByRole("textbox", { name: "Verktøy", exact: true }).count(), 0, "ingen verktøyfilter for meldinger");
    await prompt.getByRole("button", { name: "Lag hook", exact: true }).click();
    await hookRow(page, "Passordvakt").waitFor();
    assert.equal(await settings.locator(".hook-row").count(), 3);
    // «Test» before the hook was saved does not count as its last run.
    await hookRow(page, "Ingen kommandoer").getByText("Ikke kjørt siden appen startet").waitFor();
    await page.screenshot({ path: "/tmp/ad-025-hooks-list-dark.png" });

    // A Kode turn with the demo model: the command is stopped, the conversation says by which hook.
    await page.locator(".settings-nav").getByRole("button", { name: "Tilbake til appen", exact: true }).click();
    const project = await openProject(h, "Hookprøve");
    await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
    writeFileSync(path.join(h.projectDir, "index.html"), "<h1>Hei fra demo-modellen</h1>\n");
    await send(page, "lang kommando");
    const rows = page.locator('[data-row="hook"]');
    await rows.first().waitFor();
    await idle(h);
    assert.match(await rows.first().innerText(), /Hooken «Ingen kommandoer» \(før verktøykall\) stoppet verktøykallet/);
    assert.match(await rows.first().locator(".hook-message").innerText(), /Kommandoer er sperret i testen/);
    assert.equal(await rows.first().getAttribute("role"), "status");
    assert.equal(JSON.parse(readFileSync(path.join(out, "pre.json"), "utf8")).tool_input.command.startsWith("for i in"), true, "hooken fikk kommandoen på stdin");

    // PostToolUse: the edit goes through, and the feedback shows.
    await send(page, "rediger overskriften");
    await waitFor(async () => (await rows.count()) === 2, "rad for tilbakemeldingen");
    await idle(h);
    assert.match(await rows.nth(1).innerText(), /Hooken «Påminnelse» \(etter verktøykall\) ga tilbakemelding til modellen/);
    assert.match(readFileSync(path.join(h.projectDir, "index.html"), "utf8"), /Hei igjen fra demo-modellen/, "endringen ble gjort");

    // UserPromptSubmit: the message is stopped, and the user sees why.
    await send(page, "mitt passord er hunter2");
    await waitFor(async () => (await rows.count()) === 3, "rad for den stoppede meldingen");
    await idle(h);
    assert.match(await rows.nth(2).innerText(), /Hooken «Passordvakt» \(ved melding\) stoppet meldingen/);
    assert.match(await rows.nth(2).innerText(), /Ikke send passord/);
    await page.screenshot({ path: "/tmp/ad-025-hooks-conversation-dark.png" });

    // Stop while a slow UserPromptSubmit hook still checks the message: it was never sent, and the
    // conversation says so.
    const slow = (await h.api("POST", "/api/hooks", { name: "Treg sjekk", event: "UserPromptSubmit", command: "sleep 20", modes: ["code", "chat"] })).hooks.at(-1).id;
    await send(page, "vent på hooken");
    await waitFor(async () => (await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.running), "turen venter på hooken");
    await page.locator(".pane-inner.focused .composer").getByRole("button", { name: "Stopp", exact: true }).click();
    const unsent = page.locator('[data-row="unsent"]');
    await unsent.waitFor();
    await idle(h);
    assert.match(await unsent.innerText(), /^Meldingen ble ikke sendt: sjekken av hookene ble avbrutt\. Modellen har ikke sett den\./);
    assert.equal(await unsent.getAttribute("role"), "status");
    assert.equal(await rows.count(), 3, "et avbrudd er ikke en hook-rad");
    await page.screenshot({ path: "/tmp/ad-025-hooks-unsent-dark.png" });
    await h.api("DELETE", `/api/hooks/${slow}`);

    // The last runs reached Innstillinger over the socket. The switch turns the hook off, and the
    // focus stays on it.
    await openHooks(page);
    // Its last run was the message stopped with «Stopp», which it let through.
    await hookRow(page, "Passordvakt").getByText(/OK · kode 0/).waitFor();
    await hookRow(page, "Påminnelse").getByText(/Stoppet · kode 2/).waitFor();
    const toggle = hookRow(page, "Passordvakt").getByRole("switch", { name: "Slå Passordvakt av eller på" });
    await toggle.uncheck();
    await hookRow(page, "Passordvakt").locator(".pill", { hasText: "Av" }).waitFor();
    assert.equal((await h.api("GET", "/api/hooks")).hooks.find((x: any) => x.name === "Passordvakt").enabled, false);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Slå Passordvakt av eller på", "fokus blir på bryteren");

    await page.locator(".settings-nav").getByRole("button", { name: "Tilbake til appen", exact: true }).click();
    await send(page, "passord igjen");
    await waitFor(async () => (await page.getByText("passord igjen", { exact: true }).count()) > 0, "meldingen er sendt");
    await idle(h);
    assert.equal(await rows.count(), 3, "hooken som er av, kjører ikke");

    // Delete, after a confirmation.
    await openHooks(page);
    await hookRow(page, "Påminnelse").getByRole("button", { name: "Slett Påminnelse" }).click();
    // The confirmation dialog has no accessible name (dialogs.tsx), so it is found by its heading.
    const confirm = page.locator("dialog[open]", { has: page.getByRole("heading", { name: "Slette hooken Påminnelse?" }) });
    await confirm.getByRole("button", { name: "Avbryt", exact: true }).click();
    assert.equal((await h.api("GET", "/api/hooks")).hooks.length, 3, "Avbryt sletter ikke");
    await hookRow(page, "Påminnelse").getByRole("button", { name: "Slett Påminnelse" }).click();
    await confirm.getByRole("button", { name: "Slett", exact: true }).click();
    await hookRow(page, "Påminnelse").waitFor({ state: "detached" });
    assert.deepEqual((await h.api("GET", "/api/hooks")).hooks.map((x: any) => x.name), ["Ingen kommandoer", "Passordvakt"]);

    // Chat, with a background theme: the same hook row, readable over the scene.
    await toggle.check();
    await page.locator(".settings-nav").getByRole("button", { name: "Tilbake til appen", exact: true }).click();
    await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
    await send(page, "mitt passord i chat");
    const chatRow = page.locator('.pane-inner [data-row="hook"]').filter({ visible: true }).last();
    await chatRow.waitFor();
    await idle(h);
    assert.match(await chatRow.innerText(), /Hooken «Passordvakt» \(ved melding\) stoppet meldingen[\s\S]*Ikke send passord/);
    await page.getByTestId("chat-tools-button").click();
    await page.getByRole("menuitem", { name: /Tema og bakgrunn/ }).click();
    const mods = page.getByRole("dialog", { name: "Tema og mods", exact: true });
    await mods.locator("[data-mod-id=nordlys] .ui-mod-pick").click();
    await mods.getByRole("button", { name: "Lukk tema og mods", exact: true }).click();
    await page.locator(".ui-mod-scene").waitFor();
    // The line has its own colour, not one that disappears into the scene.
    const colors = await chatRow.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).opacity, getComputedStyle(el).visibility]);
    assert.notEqual(colors[0], "rgba(0, 0, 0, 0)");
    assert.equal(colors[2], "visible");
    await page.screenshot({ path: "/tmp/ad-025-hooks-chat-theme-dark.png" });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, { viewport: { width: 1360, height: 900 } });

flow("Hooks i lyst tema: skjemaet sier fra om feil før noe lagres", async (h) => {
  const { page } = h;
  const settings = await openHooks(page);
  await settings.getByRole("button", { name: "Ny hook", exact: true }).click();
  const form = settings.locator("form.hook-form");
  await form.getByRole("button", { name: "Lag hook", exact: true }).click();
  await form.getByRole("alert").getByText("Skriv kommandoen som skal kjøres.").waitFor();
  await form.getByRole("textbox", { name: "Kommando (bash)", exact: true }).fill("true");
  for (const mode of ["Kode", "Chat"]) await form.getByRole("checkbox", { name: mode, exact: true }).uncheck();
  await form.getByRole("button", { name: "Lag hook", exact: true }).click();
  await form.getByRole("alert").getByText("Velg Kode, Chat eller begge.").waitFor();
  await page.screenshot({ path: "/tmp/ad-025-hooks-form-light.png" });
  assert.equal((await h.api("GET", "/api/hooks")).hooks.length, 0);
  await form.getByRole("checkbox", { name: "Kode", exact: true }).check();
  await form.getByRole("textbox", { name: "Navn", exact: true }).fill("Alltid OK");
  await form.getByRole("button", { name: "Lag hook", exact: true }).click();
  await hookRow(page, "Alltid OK").waitFor();
  await hookRow(page, "Alltid OK").getByText("Bare Kode").waitFor();
  await page.screenshot({ path: "/tmp/ad-025-hooks-list-light.png" });
});
