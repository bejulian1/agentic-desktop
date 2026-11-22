// v1.4.0: file links and file names that open in the mini editor, thread links that open the
// thread, a coloured mark on every web link, and $skill chips. Only a local test server that
// answers like an OpenAI-compatible API; no real API and no real home folder.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Page } from "playwright-core";
import { flow, openProject, pane, send, waitFor, type Harness } from "./harness.ts";

function chunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] })}\n\n`;
}

// A model that answers every message with reply().
async function fakeModel(h: Harness, reply: () => string): Promise<{ close: () => void; name: string }> {
  const fake = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(chunk(reply()) + "data: [DONE]\n\n");
    });
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  const baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lenketest", model: "local", contextWindow: 100_000 });
  return { close: () => fake.close(), name: model.name };
}

async function chooseModel(page: Page, name: string): Promise<void> {
  await page.getByTestId("model-button").first().click();
  await page.getByRole("option", { name, exact: true }).click();
}

const editor = (page: Page) => page.getByTestId("mini-editor");

async function closeEditor(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await editor(page).waitFor({ state: "detached" });
}

flow("rike lenker i Kode: filer åpnes i mini-editoren, tråder åpnes, og alle nettlenker får et farget merke", async (h) => {
  const { page } = h;
  mkdirSync(path.join(h.projectDir, "server/src/http"), { recursive: true });
  mkdirSync(path.join(h.projectDir, "src/ui"), { recursive: true });
  mkdirSync(path.join(h.projectDir, "docs"), { recursive: true });
  writeFileSync(path.join(h.projectDir, "README.md"), "# Rakett\n\nEn liten app.\n");
  writeFileSync(path.join(h.projectDir, "server/src/http/api.ts"), Array.from({ length: 30 }, (_, i) => `export const linje${i + 1} = ${i + 1};`).join("\n") + "\n");
  writeFileSync(path.join(h.projectDir, "src/ui/Sidebar.tsx"), "export function Sidebar() {\n  return null;\n}\n");
  writeFileSync(path.join(h.projectDir, "docs/notes.md"), "a\nb\nc\nd\ne\n");
  const project = await openProject(h, "Lenker");
  const other = await h.createThread(project.id);
  const model = await fakeModel(h, () => [
    `Se [README.md](README.md), [api.ts:12](server/src/http/api.ts:12) og [notatene](file://${h.projectDir}/docs/notes.md#L3).`,
    "Filen `src/ui/Sidebar.tsx` og `README.md:2` er endret, se også [`api.ts`](server/src/http/api.ts) og [`Sidebar.tsx`](https://github.com/acme/rakett/blob/main/src/ui/Sidebar.tsx).",
    "Farlige: [farlig](javascript:alert(1)), [data](data:text/html,x) og [opp](../hemmelig.md).",
    `Tråder: [Oppgave 1](thread:${other.id}) og [Borte](agentic-thread://finnes-ikke).`,
    "Web: [tekst](https://example.com/a), https://news.ycombinator.com/item?id=1, [Vite](https://vite.dev/guide/), https://github.com/acme/rakett/releases/tag/v1 og <mailto:test@example.com>.",
    "Bruk $frontend-design før du sender, ikke $5.",
    "<img src=x onerror=\"window.__xss=1\">",
  ].join("\n\n"));
  try {
    await chooseModel(page, model.name);
    await send(page, "Vis lenkene.");
    const answer = page.locator(".row-text").last();
    await answer.locator("button.md-file-link").first().waitFor();

    // Filkoblinger: knapper med merke, navn og full sti i verktøytipset.
    const readme = answer.locator("button.md-file-link", { hasText: "README.md" });
    assert.equal(await readme.getAttribute("data-file-path"), "README.md");
    assert.equal(await readme.getAttribute("data-file-badge"), "MD");
    assert.equal(await readme.getAttribute("type"), "button");
    const api = answer.locator("button.md-file-link", { hasText: "api.ts:12" });
    assert.equal(await api.getAttribute("data-file-path"), "server/src/http/api.ts");
    assert.equal(await api.getAttribute("data-file-line"), "12");
    assert.equal(await api.getAttribute("title"), "server/src/http/api.ts:12");
    assert.equal(await api.getAttribute("data-file-ext"), "ts");
    const notes = answer.locator("button.md-file-link", { hasText: "notatene" });
    assert.equal(await notes.getAttribute("data-file-line"), "3");
    assert.notEqual(await readme.evaluate((el) => getComputedStyle(el, "::before").backgroundColor), "rgba(0, 0, 0, 0)", "merket har en farge");
    // En `fil` i lenketeksten er en del av lenken, ikke en egen knapp inni den.
    assert.equal(await answer.locator("button code.md-file-chip, a code.md-file-chip").count(), 2);
    assert.equal(await answer.locator('button [role="button"], a [role="button"], button [tabindex], a [tabindex]').count(), 0);
    // Farlige mål blir ren tekst.
    for (const text of ["farlig", "data", "opp"]) {
      assert.equal(await answer.locator("a, button", { hasText: new RegExp(`^${text}$`) }).count(), 0, text);
      await answer.getByText(text, { exact: false }).first().waitFor();
    }
    assert.equal(await answer.locator('a[href^="javascript:"], a[href^="data:"]').count(), 0);

    // Et klikk åpner filen i mini-editoren, på linjen.
    await api.click();
    await editor(page).locator(".mini-title").getByText("api.ts").waitFor();
    assert.equal(await editor(page).locator(".mini-title").getAttribute("title"), "server/src/http/api.ts");
    await editor(page).getByText("Linje 12, kolonne 1").waitFor();
    await closeEditor(page);
    // En absolutt sti inne i prosjektet åpnes relativt til prosjektet.
    await notes.click();
    await waitFor(async () => (await editor(page).locator(".mini-title").getAttribute("title")) === "docs/notes.md", "docs/notes.md");
    await editor(page).getByText("Linje 3, kolonne 1").waitFor();
    await closeEditor(page);
    // Filnavn i `kode` er klikkbare også, med tastatur.
    const sidebar = answer.locator("code.md-file-chip", { hasText: "src/ui/Sidebar.tsx" });
    assert.equal(await sidebar.getAttribute("role"), "button");
    assert.equal(await sidebar.getAttribute("data-file-badge"), "TSX");
    await sidebar.click();
    await waitFor(async () => (await editor(page).locator(".mini-title").getAttribute("title")) === "src/ui/Sidebar.tsx", "Sidebar.tsx");
    await closeEditor(page);
    await answer.locator("code.md-file-chip", { hasText: "README.md:2" }).focus();
    await page.keyboard.press("Enter");
    await editor(page).getByText("Linje 2, kolonne 1").waitFor();
    await closeEditor(page);

    // Nettlenker: alle får merke, farget tekst og adressen ved hover. Ingen bilder.
    const named = answer.locator('a[href="https://example.com/a"]');
    assert.match((await named.getAttribute("class")) ?? "", /md-link-chip/);
    assert.equal(await named.getAttribute("data-site"), "web");
    assert.equal(await named.locator(".md-link-label").textContent(), "tekst");
    assert.equal(await named.getAttribute("title"), "https://example.com/a");
    assert.equal(await named.locator("svg.md-link-monogram text").textContent(), "E");
    assert.equal(await answer.locator('a[data-site="hackernews"] svg.md-link-icon').count(), 1);
    assert.equal(await answer.locator('a[data-site="vite"] .md-link-label').textContent(), "Vite");
    assert.equal(await answer.locator('a.md-link-github[data-kind="release"]').count(), 1);
    assert.equal(await answer.locator('a[href^="mailto:"]').getAttribute("class"), null, "e-post er en vanlig lenke");
    assert.equal(await answer.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => (window as any).__xss ?? null), null);
    const ink = await named.evaluate((el) => getComputedStyle(el).color);
    assert.notEqual(ink, await answer.evaluate((el) => getComputedStyle(el).color), "lenketeksten er farget");

    // $skill blir en chip, $5 er tekst.
    assert.equal(await answer.locator(".md-skill-chip").count(), 1);
    assert.equal(await answer.locator(".md-skill-chip").textContent(), "frontend-design");

    // Tråd-lenker: en som finnes åpnes, en som er borte gir en rolig melding.
    const gone = answer.locator("button.md-thread-chip", { hasText: "Borte" });
    await gone.click();
    await page.locator(".toast", { hasText: "Fant ikke tråden" }).waitFor();
    const chip = answer.locator("button.md-thread-chip", { hasText: "Oppgave 1" });
    assert.equal(await chip.getAttribute("title"), `Åpne tråd: ${other.title}`);
    await chip.click();
    await pane(page, other.id).first().waitFor();
  } finally {
    model.close();
  }
});

flow("rike lenker på Denne datamaskinen og i Chat: full sti åpnes i Filer, ellers en rolig forklaring", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.home, "les-meg.txt"), "En lokal fil fra en lenke.\n");
  const model = await fakeModel(h, () => `Se [les-meg.txt](file://${h.home}/les-meg.txt) og [relativ](docs/a.md).`);
  try {
    await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
    await chooseModel(page, model.name);
    await send(page, "Hvor er filen?");
    const answer = page.locator(".row-text").last();
    await answer.locator("button.md-file-link", { hasText: "les-meg.txt" }).waitFor();
    await answer.locator("button.md-file-link", { hasText: "relativ" }).click();
    await page.locator(".toast", { hasText: "Uten prosjekt kan bare filer med full sti åpnes." }).waitFor();
    await answer.locator("button.md-file-link", { hasText: "les-meg.txt" }).click();
    const files = page.getByTestId("files-panel");
    await files.getByTestId("editor").getByText("En lokal fil fra en lenke.", { exact: true }).waitFor();
    assert.equal(await files.getByLabel("Mappesti").inputValue(), h.home);

    // Chat uten prosjekt: lenken vises, men et klikk forklarer hvor filer kan åpnes.
    await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
    await send(page, "Og i Chat?");
    const chat = page.locator(".chat-conversation .row-text").last();
    await chat.locator("button.md-file-link", { hasText: "relativ" }).click();
    await page.locator(".toast", { hasText: "Filer åpnes fra Kode eller en chat i et prosjekt." }).waitFor();
    assert.equal(await page.getByTestId("mini-editor").count(), 0);
  } finally {
    model.close();
  }
});
