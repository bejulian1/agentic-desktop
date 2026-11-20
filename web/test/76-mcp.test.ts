// Innstillinger → MCP-servere, end to end against the fake stdio MCP server from the server tests
// (server/test/mcp-fake-stdio.ts). No network, no npx, no real credentials.
import assert from "node:assert/strict";
import path from "node:path";
import type { Page } from "playwright-core";
import { DatabaseSync } from "node:sqlite";
import { approveUntil, flow, openProject, ROOT, send, startServer, waitFor, type Harness } from "./harness.ts";

const FAKE = path.join(ROOT, "server/test/mcp-fake-stdio.ts");
const TOKEN = "fake_token_value_ui_0123456789";

const mcpState = (h: Harness) => h.api("GET", "/api/mcp");
const card = (page: Page, name: string) => page.locator(".mcp-server", { has: page.locator(".card-title strong", { hasText: new RegExp(`^${name}$`) }) });

// Nothing on the page may hold the secret: text, attributes or the value of any field.
async function assertNoSecret(page: Page, what: string): Promise<void> {
  const found = await page.evaluate((token) => {
    if (document.documentElement.outerHTML.includes(token)) return "html";
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) if (el.value.includes(token)) return `felt ${el.getAttribute("aria-label")}`;
    return "";
  }, TOKEN);
  assert.equal(found, "", `hemmeligheten vises ikke (${what})`);
}

flow("MCP-servere: forhåndsvalg, ekte stdio-server, skjult hemmelighet, verktøy, av og på, slett og kall fra Kode", async (h) => {
  const { page } = h;
  await h.api("PATCH", "/api/settings", { theme: "dark" });

  // /mcp opens the page; it is a regular page now, not a demo.
  await send(page, "/mcp");
  const settings = page.locator(".settings-page");
  await settings.locator(".settings-title", { hasText: "MCP-servere" }).waitFor();
  assert.equal(await page.locator(".settings-title .demo-badge").count(), 0, "ikke Demo");
  await settings.getByText("Ingen MCP-servere ennå").waitFor();
  await page.screenshot({ path: "/tmp/ad-025-mcp-empty-dark.png" });

  // GitHub: an HTTP address and a secret Authorization header, nothing saved or connected.
  await settings.getByRole("button", { name: "GitHub", exact: true }).click();
  const form = page.getByRole("form", { name: "MCP-server" });
  await form.waitFor();
  assert.equal(await form.getByLabel("Navn", { exact: true }).inputValue(), "GitHub");
  assert.equal(await form.getByRole("button", { name: "Adresse (HTTP)" }).getAttribute("aria-pressed"), "true");
  assert.equal(await form.getByLabel("Adresse", { exact: true }).inputValue(), "https://api.githubcopilot.com/mcp/");
  // The address is stored in plain text, and the form says so.
  assert.equal(await form.getByLabel("Adresse", { exact: true }).getAttribute("aria-describedby") !== null, true);
  await form.getByText("Legg hemmeligheter i en hemmelig header, ikke i adressen. Adressen lagres og vises i klartekst.", { exact: true }).waitFor();
  assert.equal(await form.getByLabel("Navn på header", { exact: true }).inputValue(), "Authorization");
  const auth = form.getByLabel("Verdi for Authorization", { exact: true });
  assert.equal(await auth.getAttribute("type"), "password");
  assert.equal(await auth.inputValue(), "");
  assert.ok(await form.getByRole("checkbox", { name: "Hemmelig" }).isChecked());
  await form.getByText(/personlig tilgangstoken/).waitFor();
  await page.screenshot({ path: "/tmp/ad-025-mcp-form-github-dark.png" });

  // Playwright, chosen while the GitHub form is open, replaces it: a command and its arguments.
  await settings.getByRole("button", { name: "Playwright", exact: true }).click();
  await waitFor(async () => (await form.getByLabel("Navn", { exact: true }).inputValue()) === "Playwright", "skjemaet fylles med Playwright");
  assert.equal(await form.getByRole("button", { name: "Kommando (stdio)" }).getAttribute("aria-pressed"), "true");
  assert.equal(await form.getByLabel("Kommando", { exact: true }).inputValue(), "npx");
  assert.equal(await form.getByLabel("Argumenter, ett per linje").inputValue(), "-y\n@playwright/mcp@latest\n--headless\n--isolated");
  assert.equal((await mcpState(h)).servers.length, 0, "forhåndsvalg kobler ikke til noe");
  // Every field is named by its visible label, not its placeholder, and the four arguments fit.
  for (const name of ["Navn", "Kommando", "Argumenter, ett per linje", "Tidsgrense per kall (sekunder)"]) await form.getByRole("textbox", { name, exact: true }).waitFor();
  const args = form.getByRole("textbox", { name: "Argumenter, ett per linje", exact: true });
  assert.ok(await args.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), "alle fire argumentlinjene synes uten rulling");
  await page.screenshot({ path: "/tmp/ad-025-mcp-form-playwright-dark.png" });
  await form.getByRole("button", { name: "Avbryt" }).click();
  await form.waitFor({ state: "detached" });

  // A server of our own: the fake stdio server, with one secret and one plain variable.
  await settings.getByRole("button", { name: "Egen server", exact: true }).click();
  await form.getByLabel("Navn", { exact: true }).fill("Fake");
  await form.getByLabel("Kommando", { exact: true }).fill(process.execPath);
  await form.getByLabel("Argumenter, ett per linje").fill(FAKE);
  await form.getByRole("button", { name: "Legg til variabel" }).click();
  await form.getByLabel("Navn på miljøvariabel", { exact: true }).last().fill("FAKE_TOKEN");
  await form.getByRole("checkbox", { name: "Hemmelig" }).last().check();
  await form.getByLabel("Verdi for FAKE_TOKEN", { exact: true }).fill(TOKEN);
  await form.getByRole("button", { name: "Legg til variabel" }).click();
  await form.getByLabel("Navn på miljøvariabel", { exact: true }).last().fill("FAKE_PLAIN");
  await form.getByLabel("Verdi for FAKE_PLAIN", { exact: true }).fill("synlig");
  await page.screenshot({ path: "/tmp/ad-025-mcp-form-dark.png" });
  await form.getByRole("button", { name: "Lagre og koble til" }).click();
  await form.waitFor({ state: "detached" });

  // Connected, live over the socket, with the tools listed.
  const fake = card(page, "Fake");
  await waitFor(async () => (await fake.getAttribute("data-status")) === "connected", "tilkoblet", 20_000);
  await fake.getByRole("img", { name: "Tilkoblet" }).waitFor();
  await fake.getByText(/stdio · 8 verktøy · Kode/).waitFor();
  // The stable short name, as tool names and hook matchers use it.
  assert.equal((await mcpState(h)).servers[0].slug, "fake");
  assert.match(await fake.locator(".mcp-slug").innerText(), /^Kortnavn: fake · i hooks: mcp__fake__\*$/);
  await fake.locator("summary", { hasText: "Verktøy (8 av 8 på)" }).click();
  const tools = fake.getByRole("list", { name: "Verktøy fra Fake" });
  await tools.getByText("mcp__fake__echo", { exact: true }).waitFor();
  assert.equal(await tools.getByRole("listitem").count(), 8);
  await tools.getByText("mcp__fake__dotted_name", { exact: true }).waitFor();
  // The server printed the token to stderr; the page shows it hidden.
  await fake.locator("summary", { hasText: "Utdata fra serveren" }).click();
  await fake.getByText(/token=\[skjult\]/).waitFor();
  await assertNoSecret(page, "etter lagring");
  await page.screenshot({ path: "/tmp/ad-025-mcp-list-dark.png" });

  // Editing: the secret is stored, the field is empty and says so.
  await fake.getByRole("button", { name: "Rediger" }).click();
  const edit = fake.getByRole("form", { name: "MCP-server" });
  const secret = edit.getByLabel("Verdi for FAKE_TOKEN", { exact: true });
  assert.equal(await secret.inputValue(), "");
  assert.equal(await secret.getAttribute("placeholder"), "Lagret. Skriv for å bytte.");
  assert.equal(await edit.getByLabel("Verdi for FAKE_PLAIN", { exact: true }).inputValue(), "synlig");
  await edit.getByRole("button", { name: "Vis teksten" }).first().click();
  await assertNoSecret(page, "i redigeringen, med øyet på");
  // Saving without touching the secret keeps it.
  await edit.getByRole("button", { name: "Lagre", exact: true }).click();
  await edit.waitFor({ state: "detached" });
  await waitFor(async () => (await mcpState(h)).servers[0].env.find((p: any) => p.name === "FAKE_TOKEN")?.set === true, "hemmeligheten er beholdt");
  await assertNoSecret(page, "etter ny lagring");

  // One tool off with its own switch, and back on.
  const echo = tools.getByRole("switch", { name: /^Echo/ });
  await echo.uncheck();
  await waitFor(async () => (await mcpState(h)).servers[0].disabledTools.includes("echo"), "echo av");
  await fake.locator("summary", { hasText: "Verktøy (7 av 8 på)" }).waitFor();
  // The card is kept when the state changes: the tool list stays open, and the focus stays on the switch.
  assert.ok(await echo.evaluate((el) => el === document.activeElement), "fokus blir på bryteren");
  // A change made elsewhere (another window) reaches this page over the socket.
  await h.api("PATCH", `/api/mcp/servers/${(await mcpState(h)).servers[0].id}`, { disabledTools: ["fail"] });
  await fake.locator("summary", { hasText: "Verktøy (7 av 8 på)" }).waitFor();
  await waitFor(async () => (await echo.isChecked()) && !(await tools.getByRole("switch", { name: /^fail/ }).isChecked()), "bryterne følger endringen fra et annet vindu");
  await tools.getByRole("switch", { name: /^fail/ }).check();
  await fake.locator("summary", { hasText: "Verktøy (8 av 8 på)" }).waitFor();

  // The whole server off and on.
  const use = fake.getByRole("switch", { name: "Bruk Fake" });
  await use.uncheck();
  await waitFor(async () => (await fake.getAttribute("data-status")) === "disabled", "av");
  await fake.getByRole("img", { name: "Av" }).waitFor();
  assert.equal(await fake.getByRole("button", { name: "Koble til på nytt" }).count(), 0);
  await use.check();
  await waitFor(async () => (await fake.getAttribute("data-status")) === "connected", "på igjen", 20_000);

  // Reconnect.
  await fake.getByRole("button", { name: "Koble til på nytt" }).click();
  await waitFor(async () => (await fake.getAttribute("data-status")) === "connected" && await fake.getByRole("button", { name: "Koble til på nytt" }).isEnabled(), "koblet til på nytt", 20_000);
  await fake.getByText(/stdio · 8 verktøy/).waitFor();

  // In Kode, with the demo model: the call asks first, and the result is in the conversation.
  await page.locator(".settings-nav").getByRole("button", { name: "Tilbake til appen", exact: true }).click();
  await openProject(h, "MCP-prøve");
  await send(page, 'mcp-kall mcp__fake__echo {"text":"hei fra testen"}');
  await page.locator('[data-row="approval"]').waitFor();
  await page.locator('[data-row="approval"]').getByText(/mcp__fake__echo/).first().waitFor();
  await approveUntil(page, async () => (await page.getByText('MCP-svar: {"text":"hei fra testen"}').count()) > 0, "svaret fra MCP-verktøyet");
  await waitFor(async () => !(await h.api("GET", "/api/bootstrap")).threads.some((t: any) => t.running), "turen er ferdig");
  await assertNoSecret(page, "i samtalen");

  // Delete, after a confirmation.
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: "MCP-servere", exact: true }).click();
  await card(page, "Fake").getByRole("button", { name: "Slett Fake" }).click();
  // The confirmation dialog has no accessible name (dialogs.tsx), so it is found by its heading.
  const confirm = page.locator("dialog[open]", { has: page.getByRole("heading", { name: "Slette Fake?" }) });
  await confirm.waitFor();
  await confirm.getByRole("button", { name: "Avbryt" }).click();
  assert.equal((await mcpState(h)).servers.length, 1, "Avbryt sletter ikke");
  await card(page, "Fake").getByRole("button", { name: "Slett Fake" }).click();
  await confirm.getByRole("button", { name: "Slett", exact: true }).click();
  await settings.getByText("Ingen MCP-servere ennå").waitFor();
  assert.equal((await mcpState(h)).servers.length, 0);
}, { viewport: { width: 1360, height: 900 } });

flow("MCP-servere i lyst tema og med en server som ikke starter", async (h) => {
  const { page } = h;
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: "MCP-servere", exact: true }).click();
  const settings = page.locator(".settings-page");
  await settings.getByRole("button", { name: "Egen server", exact: true }).click();
  const form = page.getByRole("form", { name: "MCP-server" });
  // An empty command is refused by the server, and the form says why.
  await form.getByLabel("Navn", { exact: true }).fill("Tom");
  await form.getByRole("button", { name: "Lagre og koble til" }).click();
  await form.getByRole("alert").waitFor();
  h.allow(/status of 400/);
  // A command that does not exist: saved, but the card shows the error.
  await form.getByLabel("Kommando", { exact: true }).fill(path.join(h.home, "finnes-ikke"));
  await form.getByRole("button", { name: "Lagre og koble til" }).click();
  await form.waitFor({ state: "detached" });
  const broken = card(page, "Tom");
  await waitFor(async () => (await broken.getAttribute("data-status")) === "error", "feil", 20_000);
  await broken.getByRole("alert").waitFor();
  assert.notEqual((await broken.getByRole("alert").innerText()).trim(), "", "feilen er forklart");
  await page.screenshot({ path: "/tmp/ad-025-mcp-list-light.png" });
  await settings.getByRole("button", { name: "GitHub", exact: true }).click();
  await page.getByRole("form", { name: "MCP-server" }).waitFor();
  await page.screenshot({ path: "/tmp/ad-025-mcp-form-light.png" });
});

flow("MCP-servere: en lagret server som ikke kan leses, kan rettes eller slettes", async (h) => {
  const { page } = h;
  // A stored entry the server cannot read (an unknown transport), written while the app is stopped.
  h.allow(/ERR_CONNECTION_REFUSED/); // the old page tries the stopped server before it is reloaded
  await h.server.stop();
  const db = new DatabaseSync(path.join(h.dataDir, "agentic-desktop.db"));
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run("app:mcp-servers", JSON.stringify([{ id: "odelagt", name: "Ødelagt", slug: "odelagt", transport: "ftp", url: "ftp://localhost/" }, { id: "ogsa", name: "Også ødelagt", transport: "ftp" }]));
  db.close();
  h.server = await startServer(h.dataDir, { home: h.home });
  await page.goto(h.server.link);
  await page.waitForSelector(".app");
  await page.keyboard.press("Control+Comma");
  await page.locator(".settings-nav").getByRole("button", { name: "MCP-servere", exact: true }).click();
  const broken = card(page, "Ødelagt");
  await broken.waitFor();
  assert.equal(await broken.getAttribute("data-status"), "error");
  await broken.getByRole("alert").getByText(/^Innstillingene kunne ikke leses: /).waitFor();
  // Nothing to switch on or reconnect (the server answers 409 for it); Rediger and Slett are there.
  assert.equal(await broken.getByRole("switch").count(), 0);
  assert.equal(await broken.getByRole("button", { name: "Koble til på nytt" }).count(), 0);
  await page.screenshot({ path: "/tmp/ad-025-mcp-broken-light.png" });

  // Saved again from the form, it is a normal server: the fake stdio server, connected.
  await broken.getByRole("button", { name: "Rediger" }).click();
  const form = broken.getByRole("form", { name: "MCP-server" });
  await form.getByRole("button", { name: "Kommando (stdio)" }).click();
  await form.getByLabel("Kommando", { exact: true }).fill(process.execPath);
  await form.getByLabel("Argumenter, ett per linje").fill(FAKE);
  await form.getByRole("button", { name: "Lagre", exact: true }).click();
  await waitFor(async () => (await broken.getAttribute("data-status")) === "connected", "rettet og tilkoblet", 20_000);
  await broken.getByRole("switch", { name: "Bruk Ødelagt" }).waitFor();
  assert.equal((await mcpState(h)).servers.find((s: any) => s.id === "odelagt").slug, "odelagt", "kortnavnet er beholdt");

  // The other one is deleted.
  await card(page, "Også ødelagt").getByRole("button", { name: "Slett Også ødelagt" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Slett", exact: true }).click();
  await card(page, "Også ødelagt").waitFor({ state: "detached" });
  assert.deepEqual((await mcpState(h)).servers.map((s: any) => s.name), ["Ødelagt"]);
});
