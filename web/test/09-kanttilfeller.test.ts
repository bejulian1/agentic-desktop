import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { WebSocketRoute } from "playwright-core";
import { flow, send, startServer, waitFor, openTool } from "./harness.ts";

flow("tom tilstand", async (h) => {
  const { page } = h;
  await page.getByTestId("pane-empty").getByText("Hva skjer nå?").waitFor();
  await page.getByTestId("examples").getByRole("button", { name: /Hva kan du\?/ }).click();
  assert.equal(await page.getByRole("textbox", { name: "Melding", exact: true }).inputValue(), "hjelp");
  // Kode without a project (SPEC 21.1): the mark and «Hva skal vi bygge?», no big empty state, and
  // the field with the project row. Prosjektboks is a choice in Innstillinger → Kode (SPEC 25.2).
  await page.getByRole("button", { name: "Kode", exact: true }).click();
  const none = page.getByTestId("pane-empty");
  await none.locator(".home-title", { hasText: "Hva skal vi bygge?" }).waitFor();
  assert.equal(await page.getByText("Kode jobber i en mappe").count(), 0, "den store tomtilstanden er borte");
  assert.equal(await page.getByTestId("stats-card").count(), 0, "ingen statistikk");
  const field = page.locator(".pane-inner.focused");
  await field.getByTestId("project-picker").getByText("Velg prosjekt").waitFor();
  await h.createProject("Demo");
  assert.equal(await page.getByTestId("home-projects").count(), 0, "Tekst er standard");
  await h.api("PATCH", "/api/settings", { codeStart: "projects" });
  await page.getByTestId("home-projects").getByTestId("home-project-row").getByText("Demo").waitFor();
  await field.getByLabel("Melding").fill("lag en side");
  await field.getByTestId("project-picker").click();
  await page.getByRole("dialog", { name: "Velg prosjekt" }).getByRole("option", { name: "Demo" }).click();
  await page.getByTestId("pane-empty").locator(".home-title", { hasText: "Hva skal vi jobbe med i Demo?" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Melding", exact: true }).inputValue(), "lag en side", "teksten ble med");
  await page.getByRole("textbox", { name: "Melding", exact: true }).fill("");
  await openTool(page, "Diff");
  await page.getByText("Ingen filendringer i denne tråden ennå.").waitFor();
  await openTool(page, "Filer");
  await page.getByText("Mappen er tom").waitFor();
});

flow("feil fra modellen vises i tråden, med en leverandør lagt inn i Innstillinger", async (h) => {
  const { page } = h;
  const llm = http.createServer((req, res) => {
    if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [] }));
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Ugyldig nøkkel fra testserveren" } }));
  });
  await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(llm.address() as AddressInfo).port}/v1`;
  try {
    await page.getByRole("button", { name: "Innstillinger" }).click();
    await page.getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
    await page.getByRole("button", { name: "Test tilkobling" }).click();
    await page.getByText("Demo-modellen er alltid tilgjengelig").first().waitFor(); // the intro, and the test result says it too

    await page.getByRole("button", { name: "Modeller og leverandører", exact: true }).click();
    await page.getByRole("button", { name: /^Egendefinert/ }).click();
    const form = page.getByRole("form", { name: "Koble til Egendefinert" });
    await form.getByLabel("Navn").fill("Lokal test");
    await form.getByLabel("API-adresse").fill(url);
    await form.getByLabel("Nøkkel", { exact: true }).fill("test-nokkel");
    await form.getByRole("button", { name: "Fortsett" }).click();
    await page.getByRole("region", { name: "Koble til Egendefinert" }).getByRole("button", { name: "Ferdig", exact: true }).click();
    const card = page.locator('.card[data-provider="Lokal test"]');
    await card.getByText("API-nøkkel").waitFor();
    await card.getByRole("button", { name: "Legg til modell" }).click();
    const modelForm = page.getByRole("form", { name: "Modell" });
    await modelForm.getByLabel("Navn").fill("Testmodell");
    await modelForm.getByLabel("Modell-ID").fill("test-1");
    await modelForm.getByLabel("Pris inn").fill("3");
    await modelForm.getByLabel("Pris ut").fill("15");
    await modelForm.getByRole("button", { name: "Lagre" }).click();
    await card.getByText("Testmodell").waitFor();
    await page.getByRole("button", { name: "Tilbake til appen" }).click();

    await page.getByTestId("model-button").click();
    await page.getByRole("option", { name: "Testmodell" }).click();
    await page.getByTestId("model-button").getByText("Testmodell").waitFor();
    await send(page, "hei");
    const error = page.locator(".error-card");
    await error.waitFor({ timeout: 30_000 });
    assert.match(await error.textContent() ?? "", /Kjøringen feilet/);
    const key = await page.evaluate(() => document.body.innerText.includes("test-nokkel"));
    assert.equal(key, false, "nøkkelen vises aldri");

    // The thread can go on with another model.
    await page.getByTestId("model-button").click();
    await page.getByRole("option", { name: "Demo-modell" }).click();
    await send(page, "hjelp");
    await page.getByText("Dette er demo-modellen").first().waitFor(); // the timeline's hover card may quote it too
  } finally {
    llm.closeAllConnections();
    await new Promise((resolve) => llm.close(resolve));
  }
});

flow("serveren går ned og kommer tilbake", async (h) => {
  const { page } = h;
  // Everything a dead server makes the browser log is expected here.
  h.allow(/ERR_CONNECTION_REFUSED|WebSocket connection|Failed to load resource|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/);
  const replies = page.locator('.pane-inner.focused .row-text').filter({ hasText: "Dette er demo-modellen" });
  await send(page, "hjelp");
  await replies.waitFor();
  const threadId = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");

  await page.getByRole("textbox", { name: "Melding", exact: true }).fill("et utkast som ikke må gå tapt");
  const port = h.server.port;
  await h.server.stop();
  await page.getByTestId("offline-banner").waitFor();
  await page.locator('[data-testid="connection"][data-state="offline"]').waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Melding", exact: true }).inputValue(), "et utkast som ikke må gå tapt", "utkastet er der fortsatt");
  assert.ok(await replies.isVisible(), "samtalen står");

  // Sending while down keeps the text. The banner says what happened; no toast repeats it over
  // the panel (round 8).
  await page.getByRole("textbox", { name: "Melding", exact: true }).press("Enter");
  await waitFor(async () => (await page.getByRole("textbox", { name: "Melding", exact: true }).inputValue()) === "et utkast som ikke må gå tapt", "teksten kommer tilbake");
  await page.waitForTimeout(1800);
  assert.equal(await page.locator(".toast", { hasText: "Får ikke kontakt" }).count(), 0, "ingen varsel mens banneret vises");
  assert.ok(await page.getByTestId("offline-banner").isVisible(), "banneret står");

  // A new run of the server has a new token, so the UI has to say so.
  const again = await startServer(h.dataDir, { port, home: h.home });
  h.server = again;
  await page.getByRole("alertdialog", { name: "Økten er utløpt" }).waitFor({ timeout: 20_000 });
  await page.getByText("Åpne lenken fra terminalen").waitFor();

  // Pasting the new link into the same tab is enough.
  await page.evaluate((hash) => { location.hash = hash; }, new URL(again.link).hash);
  await page.waitForSelector(".app");
  await page.locator(`[data-thread-id="${threadId}"] .row-text`).filter({ hasText: "Dette er demo-modellen" }).waitFor();
  await page.locator('[data-testid="connection"][data-state="online"]').waitFor();
  await send(page, "hjelp");
  await waitFor(async () => (await replies.count()) === 2, "appen virker igjen");
}, { port: 0 });

flow("tilkoblingen faller ut og kommer tilbake uten tap", async (h) => {
  const { page } = h;
  h.allow(/WebSocket/);
  // A proxy between the page and the server, so the test can cut this socket and no other.
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\?ticket=/, (socket) => {
    socket.connectToServer();
    sockets.push(socket);
  });
  await h.reload();
  await page.locator('[data-testid="connection"][data-state="online"]').waitFor();
  await send(page, "lang strøm 4000 rolig");
  await page.locator(".row-text h3", { hasText: "Del 1" }).first().waitFor();
  const threadId = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
  await sockets.at(-1)!.close();
  await page.locator('[data-testid="connection"][data-state="offline"], [data-testid="connection"][data-state="connecting"]').waitFor({ timeout: 5000 }).catch(() => undefined);
  await waitFor(() => sockets.length === 2, "siden koblet til på nytt");
  await page.locator('[data-testid="connection"][data-state="online"]').waitFor({ timeout: 15_000 });
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "kjøringen er ferdig", 30_000);
  const events = await h.events(threadId!);
  const full = events.filter((e) => e.event.type === "text.delta").map((e) => (e.event as any).text).join("");
  await waitFor(async () => {
    const shown = await page.locator(".row-text").first().evaluate((el) => (el.textContent ?? "").length);
    return shown > full.length * 0.7;
  }, "teksten er komplett etter gjenkobling");
  const sections = (full.match(/## Del/g) ?? []).length;
  assert.equal(await page.locator(".row-text h3").count(), sections, "ingen deler mangler eller er dobbelt");
});
