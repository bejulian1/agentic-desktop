// Round 8 (agent G): colour themes, GitHub against a local fake server, and the mini editor.
// No request goes to github.com: AD_GITHUB_API points the server at the fake one, and the links
// it builds point there too.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after } from "node:test";
import { GOOD_TOKEN, startFakeGitHub } from "../../server/test/fake-github.ts";
import { flow, openProject, send, waitFor, openTool, toolShown } from "./harness.ts";

type Page = import("playwright-core").Page;

const fake = await startFakeGitHub();
after(() => fake.close());

const css = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const hex = (value: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : value.toLowerCase();
};
const editor = (page: Page) => page.getByTestId("mini-editor");
const loaded = (page: Page) => page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name));

flow("fargetemaer: forhåndsvisningen stemmer med temaet, hele appen følger med, og ingenting blinker ved oppstart", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.getByRole("button", { name: "Utseende", exact: true }).click();
  const cards = page.getByRole("radiogroup", { name: "Fargetema" }).getByRole("radio");
  assert.equal(await cards.count(), 6);
  assert.deepEqual(await cards.locator(".theme-card-name").allTextContents(), ["Standard", "Høy kontrast", "Varm", "Kald", "Fjord", "Solbleket"]);
  await page.locator('.theme-card[data-theme-id="standard"][aria-checked="true"]').waitFor();

  // Each preview is drawn with the theme's own tokens, in the light and the dark variant.
  for (const mode of ["Lys", "Mørk"]) {
    await page.getByRole("group", { name: "Tema", exact: true }).getByRole("button", { name: mode }).click();
    for (let i = 0; i < 6; i++) {
      const card = cards.nth(i);
      await card.click();
      await waitFor(async () => (await card.getAttribute("aria-checked")) === "true", "temaet er valgt");
      const preview = await card.locator(".theme-preview").evaluate((el) => {
        const s = getComputedStyle(el);
        return ["--p-bg", "--p-side", "--p-text", "--p-accent", "--p-kw"].map((n) => s.getPropertyValue(n).trim().toLowerCase());
      });
      const tokens = await Promise.all(["--bg", "--bg-sidebar", "--text", "--accent", "--tok-keyword"].map(async (n) => hex(await css(page, n))));
      assert.deepEqual(preview, tokens, `${mode}: ${await card.locator(".theme-card-name").textContent()}`);
    }
  }

  // The arrow keys move the choice, like any radio group.
  await page.getByRole("group", { name: "Tema", exact: true }).getByRole("button", { name: "Lys" }).click();
  await cards.nth(4).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), "fjord");
  await cards.nth(4).press("ArrowRight");
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.palette)) === "solbleket", "piltast velger neste");
  await page.keyboard.press("ArrowLeft");
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.palette)) === "fjord", "og forrige");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-theme-id")), "fjord", "fokus følger valget");
  assert.equal(hex(await css(page, "--bg")), "#eceff4");

  // An accent chosen in Innstillinger wins over the theme's own.
  await page.getByRole("radio", { name: "Fiolett", exact: true }).click();
  await waitFor(async () => hex(await css(page, "--accent")) === "#7247d6", "aksenten går foran temaet");
  await page.getByRole("radio", { name: "Blå", exact: true }).click();
  await waitFor(async () => hex(await css(page, "--accent")) === "#4c6e98", "temaets aksent igjen");
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.themePreset, "fjord");

  // No flash: the theme is on <html> and the colours are right on the very first frame.
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      (window as any).__first = { palette: document.documentElement.getAttribute("data-palette"), bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() };
    });
  });
  await h.reload();
  const first = await page.evaluate(() => (window as any).__first);
  assert.deepEqual(first, { palette: "fjord", bg: "#eceff4" });

  // The editors and the conversation use the same tokens: a code block's keyword colour follows.
  const reset = await h.api("PATCH", "/api/settings", { themePreset: "standard" });
  assert.equal(reset.themePreset, "standard");
  await waitFor(async () => (await page.evaluate(() => document.documentElement.hasAttribute("data-palette"))) === false, "standard fjerner temaet");
  h.allow(/status of 400/);
  const bad = await h.api("PATCH", "/api/settings", { themePreset: "lilla" }).catch((err: Error) => err.message);
  assert.match(String(bad), /400/);
});

flow("GitHub: koble til med token, se pull requests og issues, og tåle feil", async (h) => {
  const { page } = h;
  mkdirSync(path.join(h.projectDir, ".git"), { recursive: true });
  writeFileSync(path.join(h.projectDir, ".git/HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(h.projectDir, ".git/config"), `[remote "origin"]\n\turl = git@github.com:acme/rakett.git\n`);
  await openProject(h);
  const panel = page.getByTestId("github-panel");
  await openTool(page, "GitHub");
  await panel.getByText("acme/rakett").waitFor();
  await panel.getByText("Ikke koblet til GitHub").waitFor();
  assert.equal(await panel.getByText("Beta", { exact: true }).count(), 0);
  assert.ok(!(await loaded(page)).some((u) => u.includes("/MiniEditor-")), "editoren er ikke lastet");

  // Koble til opens Innstillinger → GitHub. A wrong token is refused with a clear message (a 400).
  h.allow(/status of 400/);
  await panel.getByRole("button", { name: "Koble til…" }).click();
  const field = page.getByLabel("GitHub-token");
  await field.fill("ghp_" + "feil000000000000000000000000000000");
  await page.getByRole("button", { name: "Koble til", exact: true }).click();
  await page.getByText("GitHub godtok ikke tokenet").waitFor();
  await field.fill(GOOD_TOKEN);
  await page.getByRole("button", { name: "Koble til", exact: true }).click();
  await page.getByText("Tilkoblet som").waitFor();
  await page.getByText("testbruker", { exact: true }).waitFor();
  assert.ok(!(await page.content()).includes(GOOD_TOKEN), "tokenet finnes ikke i siden");
  assert.ok(!JSON.stringify(await h.api("GET", "/api/github")).includes(GOOD_TOKEN));
  await page.getByRole("button", { name: "Tilbake til appen" }).click();

  // The lists, newest first, with drafts, labels and comments.
  await openTool(page, "GitHub");
  await panel.getByRole("button", { name: "Hent på nytt" }).click();
  const items = panel.locator(".github-item");
  await waitFor(async () => (await items.count()) === 2, "to pull requests");
  await panel.getByText("Rask oppstart: last CodeMirror først når editoren åpnes 🚀").waitFor();
  await panel.getByText("Utkast", { exact: true }).waitFor();
  await panel.getByRole("button", { name: /Issues/ }).click();
  await panel.getByText("Æ, ø og å i filnavn vises feil").waitFor();
  assert.equal(await items.count(), 2, "pull requests er ikke med blant issues");
  await panel.getByText("god første oppgave").waitFor();

  // Failures say what happened, and the repo still shows.
  fake.setMode("rate-limit");
  await panel.getByRole("button", { name: "Hent på nytt" }).click();
  await panel.getByText("For mange forespørsler").waitFor();
  await panel.getByText(/nullstilles om \d+ min/).waitFor();
  fake.setMode("offline");
  await panel.getByRole("button", { name: "Prøv igjen" }).click();
  await panel.getByText("Ingen kontakt med GitHub").waitFor();
  fake.setMode("revoked");
  await panel.getByRole("button", { name: "Prøv igjen" }).click();
  await panel.getByText("Tokenet virker ikke lenger").waitFor();
  await panel.getByRole("button", { name: "Nytt token…" }).waitFor();
  fake.setMode("ok");
  await panel.getByRole("button", { name: "Prøv igjen" }).click();
  await waitFor(async () => (await items.count()) === 2, "listen er tilbake");

  // A link opens in the Nettleser panel, on the fake server.
  await panel.getByRole("button", { name: /Pull requests/ }).click();
  await items.first().click();
  await toolShown(page, "Nettleser");
  await waitFor(() => fake.requests.some((r) => r.path === "/acme/rakett/pull/42"), "siden ble åpnet i nettleserpanelet", 30_000);

  await openTool(page, "GitHub");
  await panel.getByRole("button", { name: "Vis i appen" }).click();
  const room = page.getByTestId("github-room");
  await room.getByRole("heading", { name: "Pull requests" }).waitFor();
  assert.equal(await room.getByLabel("Prosjekt", { exact: true }).locator("option:checked").textContent(), "Demo");

  // Not a GitHub repo.
  writeFileSync(path.join(h.projectDir, ".git/config"), `[remote "origin"]\n\turl = https://gitlab.com/acme/rakett.git\n`);
  await room.getByRole("button", { name: "Lukk", exact: true }).click();
  await openTool(page, "GitHub");
  await page.getByTestId("github-panel").getByText("Ikke et GitHub-repo").waitFor();
  await page.getByTestId("github-panel").getByText("Ingen remote peker til GitHub.").waitFor();
}, { env: { AD_GITHUB_API: fake.url } });

flow("mini-editoren: fra verktøyrad, kodeblokk og Filer, med endringer, søk, oversikt, lagring og Spør om dette", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.projectDir, "index.html"), "<!doctype html>\n<h1>Hei fra demo-modellen</h1>\n");
  mkdirSync(path.join(h.projectDir, "src"));
  writeFileSync(path.join(h.projectDir, "src/plan.ts"), "export interface Økt {\n  navn: string;\n}\n\nexport class Plan {\n  leggTil(økt: Økt): void {\n    console.log(økt);\n  }\n}\n\nexport function lagPlan(): Plan {\n  return new Plan();\n}\n");
  writeFileSync(path.join(h.projectDir, ".env"), "HEMMELIG=1\n");
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await send(page, "rediger");
  await page.getByText("Overskriften er endret.").waitFor({ timeout: 30_000 });
  assert.ok(!(await loaded(page)).some((u) => u.includes("/MiniEditor-")), "CodeMirror lastes ikke før editoren åpnes");

  // From the tool row: the file, with what the thread changed in the gutter and in Endringer.
  await page.locator(".tool-file", { hasText: "index.html" }).click();
  await editor(page).locator(".cm-content").waitFor();
  assert.ok((await loaded(page)).some((u) => u.includes("/MiniEditor-")));
  await editor(page).locator(".mini-change.mod").waitFor();
  await editor(page).getByText("+1").waitFor();
  await editor(page).getByRole("button", { name: "Endringer" }).click();
  await editor(page).locator(".mini-diff-del", { hasText: "Hei fra demo-modellen" }).waitFor();
  await editor(page).locator(".mini-diff-add", { hasText: "Hei igjen fra demo-modellen" }).waitFor();
  await editor(page).getByRole("button", { name: "Fil", exact: true }).click();

  // Search and go to line.
  await editor(page).locator(".cm-content").click();
  await page.keyboard.press("Control+f");
  await page.keyboard.type("demo");
  await editor(page).getByText("1 av 1").waitFor();
  await page.keyboard.press("Escape");
  await waitFor(async () => (await editor(page).locator(".mini-find").count()) === 0, "søket lukkes med Esc, editoren står");
  await page.keyboard.press("Control+g");
  await page.keyboard.type("2:5");
  await page.keyboard.press("Enter");
  await editor(page).getByText("Linje 2, kolonne 5").waitFor();

  // Edit and save; the file on disk changes, and Escape asks before throwing away unsaved text.
  await page.keyboard.press("End");
  await page.keyboard.type(" <!-- ok -->");
  await editor(page).locator(".mini-dirty").waitFor();
  await page.keyboard.press("Control+s");
  await editor(page).getByText("Lagret").waitFor();
  assert.match(readFileSync(path.join(h.projectDir, "index.html"), "utf8"), /<\/h1> <!-- ok -->/);

  // Changed on disk behind the editor's back: refused (a 409), then loaded again.
  h.allow(/status of 409/);
  writeFileSync(path.join(h.projectDir, "index.html"), "<p>Endret utenfra</p>\n");
  await page.keyboard.type("x");
  await page.keyboard.press("Control+s");
  await editor(page).getByText("Filen er endret på disken siden du åpnet den.").waitFor();
  await editor(page).getByRole("button", { name: "Last inn på nytt" }).click();
  await editor(page).locator(".cm-content", { hasText: "Endret utenfra" }).waitFor();
  await page.keyboard.type("y");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: /Forkaste endringene/ }).or(page.getByText("Forkaste endringene i index.html?")).first().waitFor();
  await page.getByRole("button", { name: "Avbryt" }).click();
  await editor(page).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Forkast" }).click();
  await waitFor(async () => (await editor(page).count()) === 0, "editoren er lukket");
  assert.equal(readFileSync(path.join(h.projectDir, "index.html"), "utf8"), "<p>Endret utenfra</p>\n");

  // From Filer: the outline, a jump to a method, and Spør om dette with the selection as a quote.
  await openTool(page, "Filer");
  await page.locator('.tree-item[data-path="src"]').click();
  await page.locator('.tree-item[data-path="src/plan.ts"]').click();
  await page.locator(".file-edit").click();
  await editor(page).locator(".mini-symbol", { hasText: "Økt" }).waitFor();
  assert.deepEqual(await editor(page).locator(".mini-symbol-name").allTextContents(), ["Økt", "Plan", "leggTil", "lagPlan"]);
  await editor(page).locator(".mini-symbol", { hasText: "leggTil" }).click();
  await editor(page).getByText("Linje 6, kolonne 1").waitFor();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await editor(page).getByRole("button", { name: "Spør om dette" }).click();
  await waitFor(async () => (await editor(page).count()) === 0, "editoren lukkes");
  const message = await page.getByLabel("Melding").inputValue();
  assert.match(message, /^Om `src\/plan\.ts`, linje 6–7:\n\n```ts\n  leggTil\(økt: Økt\): void \{\n    console\.log\(økt\);\n```\n\n$/);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Melding", "fokus i meldingsfeltet");
  await page.getByLabel("Melding").fill("");

  // A protected file opens read only, without Lagre.
  await page.locator('.tree-item[data-path=".env"]').click();
  await page.locator(".file-edit").click();
  await editor(page).getByText("Bare lesing").waitFor();
  assert.equal(await editor(page).getByRole("button", { name: "Lagre" }).count(), 0);
  await page.keyboard.press("Escape");
  await waitFor(async () => (await editor(page).count()) === 0, "lukket");

  // A code block from the conversation: read only, Kopier copies it.
  await send(page, "kommandoblokk");
  await page.locator(".md-open").first().click();
  await editor(page).getByText("Bare lesing").waitFor();
  await editor(page).getByRole("button", { name: /Kopier/ }).click();
  await editor(page).getByText("Kopiert").waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "$ echo hei-fra-blokken");

  // 420 px: the editor fills the window and nothing spills sideways.
  await page.setViewportSize({ width: 420, height: 760 });
  await page.waitForTimeout(100);
  const box = await editor(page).evaluate((el) => ({ width: el.getBoundingClientRect().width, spill: el.scrollWidth - el.clientWidth, head: el.querySelector(".mini-head")!.scrollWidth - el.querySelector(".mini-head")!.clientWidth }));
  assert.ok(box.width <= 420 && box.spill <= 0 && box.head <= 0, JSON.stringify(box));
  await page.keyboard.press("Escape");
});
