import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import type { Bootstrap } from "../../shared/protocol.ts";
import { fakeGh, GOOD_TOKEN, startFakeGitHub } from "../../server/test/fake-github.ts";
import { flow, send, waitFor, type Harness } from "./harness.ts";

const fake = await startFakeGitHub();
const bin = mkdtempSync(path.join(tmpdir(), "ad-github-cli-"));
const cli = fakeGh(bin, false);
const env = { AD_GITHUB_API: fake.url, GH_CONFIG_DIR: path.join(bin, "config"), PATH: cli.path };
after(async () => {
  await fake.close();
  rmSync(bin, { recursive: true, force: true });
});

function gitProject(dir: string, repo: string) {
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  writeFileSync(path.join(dir, ".git", "config"), `[remote "origin"]\nurl = git@github.com:acme/${repo}.git\n`);
  writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
}

function sidebar(h: Harness) {
  return h.page.locator(".sidebar-foot");
}

async function openSettings(h: Harness) {
  await h.page.getByTestId("settings-gear").click();
  await h.page.getByRole("button", { name: "GitHub", exact: true }).click();
}

flow("GitHub CLI: innlogging, sjekk igjen og frakobling i innstillingene", async h => {
  gitProject(h.projectDir, "rakett");
  await h.createProject("Rakett");
  await sidebar(h).getByRole("button", { name: "Issues" }).click();
  const room = h.page.getByTestId("github-room");
  await room.getByText("Ikke koblet til GitHub", { exact: true }).waitFor();
  await room.getByRole("button", { name: "Åpne GitHub-innstillinger" }).click();
  await h.page.getByText("GitHub CLI (anbefalt)").waitFor();
  await h.page.locator("code", { hasText: /^gh auth login$/ }).waitFor();
  cli.signIn();
  await h.page.getByRole("button", { name: "Sjekk igjen" }).click();
  await h.page.getByText("Logget inn som testbruker").waitFor();
  await h.page.getByRole("button", { name: "Bruk GitHub CLI" }).click();
  await h.page.getByText("Tilkoblet som testbruker").waitFor();
  await h.page.getByRole("button", { name: "Tilbake til appen" }).click();
  await room.getByText("Æ, ø og å i filnavn vises feil", { exact: false }).waitFor();
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.githubAuth, "gh");

  await openSettings(h);
  await h.page.getByRole("button", { name: "Koble fra", exact: true }).click();
  await h.page.getByText("GitHub CLI forblir innlogget i terminalen.").waitFor();
  await h.page.getByRole("dialog").getByRole("button", { name: "Koble fra" }).click();
  await h.page.getByRole("button", { name: "Bruk GitHub CLI" }).waitFor();
  assert.equal((await h.api("GET", "/api/github/cli")).state, "signed-in");
  assert.ok(!(await h.page.content()).includes(GOOD_TOKEN));
}, { env });

flow("GitHub-lister: prosjekt, søk, filtre, sortering, sider, visninger og Kode-utkast", async h => {
  gitProject(h.projectDir, "rakett");
  const rakett = await h.createProject("Rakett");
  const atlas = path.join(h.projectDir, "atlas");
  gitProject(atlas, "atlas");
  const second = await h.api("POST", "/api/projects", { path: atlas, name: "Atlas" });
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });

  const { page } = h;
  await sidebar(h).getByRole("button", { name: "Issues" }).click();
  const room = page.getByTestId("github-room");
  await room.getByText("GitHub · github.com · 2 prosjekter").waitFor();
  const rows = room.locator(".github-room-row");
  await waitFor(async () => (await rows.count()) === 25, "første side");
  await room.getByRole("button", { name: "Last inn flere" }).click();
  await waitFor(async () => (await rows.count()) === 31, "andre side");
  const scope = room.getByLabel("Prosjekt", { exact: true });
  await scope.selectOption(second.id);
  await room.getByText("GitHub · github.com · 1 prosjekt").waitFor();
  await room.getByRole("button", { name: "Sorter" }).click();
  await page.getByRole("button", { name: "Eldste først" }).click();
  await waitFor(async () => (await rows.first().textContent())?.includes("#72") ?? false, "eldste først");

  await scope.selectOption(rakett.id);
  await room.getByRole("button", { name: "Filtre" }).click();
  await page.getByRole("option", { name: "god første oppgave" }).waitFor({ state: "attached" });
  await page.getByLabel("Etikett", { exact: true }).selectOption("god første oppgave");
  await page.getByLabel("Tilstand", { exact: true }).selectOption("all");
  await page.getByLabel("Involvering", { exact: true }).selectOption("assignee");
  await page.keyboard.press("Escape");
  const search = room.getByRole("searchbox");
  await search.fill("#40");
  await waitFor(async () => (await rows.count()) === 1 && (await rows.first().textContent())?.includes("#40") === true, "#40 med filtre");

  await room.getByRole("button", { name: "Visninger" }).click();
  await page.getByRole("button", { name: "Lagre gjeldende visning…" }).click();
  await page.getByRole("textbox", { name: "Navn på visningen" }).fill("Unicode");
  await page.getByRole("dialog").getByRole("button", { name: "Lagre" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.githubViews?.[0].name === "Unicode", "visningen er lagret");

  await rows.first().click();
  await room.locator(".github-detail-body strong").getByText("Unicode").waitFor();
  await room.getByText("Tildelt testbruker").waitFor();
  await room.getByText("Prøv igjen, @testbruker.").waitFor();
  assert.equal(await room.locator(".github-detail-body script").count(), 0);
  assert.equal(await page.locator("body").getAttribute("data-unsafe"), null);
  const popup = page.waitForEvent("popup");
  await room.getByRole("link", { name: "Åpne på GitHub" }).click();
  const github = await popup;
  await github.waitForURL(`${fake.url}/acme/rakett/issues/40`);
  await github.close();
  await room.getByRole("button", { name: "Tilbake til listen" }).click();
  assert.equal(await search.inputValue(), "#40");
  assert.equal(await scope.inputValue(), rakett.id);

  await h.reload();
  await sidebar(h).getByRole("button", { name: "Issues" }).click();
  await room.getByRole("button", { name: "Visninger" }).click();
  await page.getByRole("button", { name: "Unicode", exact: true }).click();
  await waitFor(async () => (await search.inputValue()) === "#40" && (await rows.count()) === 1, "gjenåpnet visning");
  await room.getByRole("button", { name: "Visninger" }).click();
  await page.getByRole("button", { name: "Slett visningen «Unicode»" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Slett" }).click();
  await waitFor(async () => (await h.api("GET", "/api/bootstrap")).settings.githubViews.length === 0, "slettet visning");

  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("Pull requests");
  await page.getByRole("dialog", { name: "Kommandopalett" }).getByRole("option", { name: "Pull requests", exact: true }).click();
  await room.getByRole("heading", { name: "Pull requests" }).waitFor();
  await room.getByRole("button", { name: "Visninger" }).click();
  await page.getByRole("button", { name: "Gjennomgang etterspurt" }).click();
  await waitFor(async () => (await rows.count()) === 1 && (await rows.first().textContent())?.includes("Venter") === true, "PR med ventende CI");
  await rows.first().click();
  await room.getByText("Gjennomgang kreves").waitFor();
  await room.getByText("Typecheck").waitFor();
  await room.locator(".github-detail .segmented").getByText("Filer", { exact: true }).click();
  await room.locator("summary").filter({ hasText: "src/start.ts" }).click();
  await room.locator(".diff-line.diff-add").getByText("etter").waitFor();
  await room.getByRole("button", { name: "Start en Kode-tråd" }).click();
  await waitFor(async () => (await page.getByLabel("Melding").inputValue()).startsWith("#42 Rask oppstart"), "utfylt Kode-utkast");
  assert.match(await page.getByLabel("Melding").inputValue(), /\/acme\/rakett\/pull\/42$/);
  const boot = await h.api<Bootstrap>("GET", "/api/bootstrap");
  const thread = boot.threads.find(thread => thread.projectId === rakett.id && thread.mode === "code");
  assert.ok(thread);
  assert.ok(!(await h.events(thread.id)).some(event => event.event.type === "user.message"), "utkastet er ikke sendt");
}, { env });

flow("GitHub-lenker åpnes i appen som standard og i nettleseren når valget slås av", async h => {
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  const { page } = h;
  const link = "https://github.com/acme/rakett/issues/40";
  await h.context.route("https://github.com/acme/rakett/issues/40", route => route.fulfill({ body: "GitHub", contentType: "text/plain" }));
  await send(page, `Se ${link}`);
  const message = page.locator(".row-user").getByRole("link", { name: link });
  await message.click();
  const room = page.getByTestId("github-room");
  await room.getByRole("heading", { name: /Æ, ø og å/ }).waitFor();
  await room.getByRole("button", { name: "Lukk", exact: true }).click();
  await openSettings(h);
  const toggle = page.getByRole("switch", { name: /^Åpne pull request-lenker i Agentic Desktop/ });
  assert.equal(await toggle.isChecked(), true);
  await toggle.uncheck();
  await page.getByRole("button", { name: "Tilbake til appen" }).click();
  await h.reload();
  const popup = page.waitForEvent("popup");
  await message.click();
  const github = await popup;
  await github.waitForURL(link);
  assert.equal(await room.count(), 0);
  await github.close();
  await page.getByRole("button", { name: "Skjul sidefanen" }).first().click();
  await page.getByTestId("sidebar-rail").getByRole("button", { name: "Issues" }).click();
  await room.getByRole("heading", { name: "Issues", exact: true }).waitFor();
}, { env });

flow("GitHub-siden viser API-grensen og henter listen igjen", async h => {
  gitProject(h.projectDir, "rakett");
  await h.createProject("Rakett");
  await h.api("PUT", "/api/github/token", { token: GOOD_TOKEN });
  await sidebar(h).getByRole("button", { name: "Issues" }).click();
  const room = h.page.getByTestId("github-room");
  const row = room.getByText("Æ, ø og å i filnavn vises feil", { exact: false });
  await row.waitFor();
  h.allow(/status of 429/);
  fake.setMode("rate-limit");
  try {
    await room.getByRole("button", { name: "Hent på nytt" }).click();
    await room.getByRole("alert").getByText("For mange forespørsler").waitFor();
    await room.getByRole("alert").getByText(/nullstilles om \d+ min/).waitFor();
  } finally {
    fake.setMode("ok");
  }
  await room.getByRole("button", { name: "Prøv igjen" }).click();
  await row.waitFor();
}, { env });

flow("GitHub-innstillinger lenker til installasjon når gh mangler", async h => {
  await openSettings(h);
  await h.page.getByText("GitHub CLI er ikke installert.").waitFor();
  const link = h.page.getByRole("link", { name: "Installer GitHub CLI" });
  assert.equal(await link.getAttribute("href"), "https://cli.github.com/");
}, { env: { ...env, PATH: path.join(bin, "empty") } });
