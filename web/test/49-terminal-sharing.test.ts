// Ekte temp-PTY og xterms egen musemarkering. Ingen modellkall eller automatisk sending.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { flow, openProject, openTool, pane, threadItem, waitFor } from "./harness.ts";
import { formatTerminalShare, TERMINAL_SHARE_CHARS } from "../src/lib/terminal-share.ts";

const buffer = (page: Page) => page.getByTestId("terminal").evaluate((el) => (el as any).readBuffer() as string);
const share = (page: Page) => page.getByTestId("terminal-share");

test("Terminalutdrag begrenser store utvalg og holder Markdown-gjerder inne i tekstblokken", () => {
  const selected = formatTerminalShare(`start\n\`\`\`\`\`\n${"x".repeat(TERMINAL_SHARE_CHARS)}slutt`, true)!;
  assert.equal(selected.truncated, true);
  assert.match(selected.text, /viser starten av utvalget/);
  assert.match(selected.text, /\n`{6}text\nstart\n`{5}\n/);
  assert.ok(!selected.text.includes("slutt"));
  const recent = formatTerminalShare(`start${"x".repeat(TERMINAL_SHARE_CHARS)}slutt`, false)!;
  assert.ok(recent.text.endsWith("slutt\n```"));
  assert.ok(!recent.text.includes("start"));
  assert.equal(formatTerminalShare(" \r\n ", false), null);
});

flow("Terminal deler markert ekte PTY-tekst til riktig utkast uten sending og bevarer replay", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Terminaldeling");
  await openTool(page, "Terminal");
  await page.getByTestId("terminal").waitFor();
  assert.equal(await share(page).getByRole("button", { name: "Del siste utdata", exact: true }).isDisabled(), true, "tom kodefane oppretter ingen tråd ved deling");
  await share(page).getByText("Åpne en kodetråd i dette prosjektet for å dele til utkastet.").waitFor();
  const first = await h.createThread(project.id);
  await threadItem(page, first.id).click();
  const firstDraft = pane(page, first.id).getByLabel("Melding", { exact: true });
  await firstDraft.fill("Eksisterende kladd");
  await waitFor(async () => (await buffer(page)).trim().length > 0, "temp-skallet er klart");
  const terminalId = await page.getByTestId("terminal").getAttribute("data-terminal-id");
  await page.getByTestId("terminal").click();
  await page.keyboard.type("printf '\\033c\\033[31mresultat-%s\\033[0m\\n' 42\n");
  await waitFor(async () => (await buffer(page)).split("\n").includes("resultat-42"), "farget resultat er tolket av ekte xterm");
  const before = await h.events(first.id);
  assert.equal(await firstDraft.inputValue(), "Eksisterende kladd", "utdata deles aldri automatisk");

  // Før scrollback: bufferlengden er antall synlige rader. Trippelklikk velger en linje
  // gjennom xterms vanlige musehåndtering, også med WebGL-rendereren.
  const lines = (await buffer(page)).split("\n");
  const row = lines.indexOf("resultat-42");
  const screen = (await page.locator(".xterm-screen").boundingBox())!;
  await page.mouse.click(screen.x + 20, screen.y + (row + 0.5) * screen.height / lines.length, { clickCount: 3 });
  await waitFor(async () => await share(page).getByRole("button", { name: "Del utvalg", exact: true }).isEnabled(), "xterm-utvalget er klart");
  await share(page).getByRole("button", { name: "Del utvalg", exact: true }).click();
  await waitFor(async () => (await firstDraft.inputValue()).includes("\nresultat-42\n"), "utvalget er lagt i korrekt utkast");
  const selectedDraft = await firstDraft.inputValue();
  assert.match(selectedDraft, /^Eksisterende kladd\n\nUtvalg fra terminalen/);
  assert.ok(!selectedDraft.includes("printf"), "bare valgt utdata deles");
  assert.ok(!selectedDraft.includes("\u001b"), "ANSI-koder følger ikke med");
  assert.deepEqual(await h.events(first.id), before, "deling sender ingen melding eller modellkall");

  const second = await h.createThread(project.id);
  await page.getByRole("button", { name: "Del til høyre", exact: true }).click();
  await threadItem(page, second.id).click();
  const secondDraft = pane(page, second.id).getByLabel("Melding", { exact: true });
  await secondDraft.fill("Andre kladd");
  await share(page).getByRole("button", { name: "Del siste utdata", exact: true }).click();
  await waitFor(async () => (await secondDraft.inputValue()).includes("resultat-42"), "ny fokusert rute mottar utdata");
  assert.equal(await firstDraft.inputValue(), selectedDraft, "første rute endres ikke når den andre har fokus");
  assert.deepEqual(await h.events(second.id), [], "ingen automatisk sending til andre tråd");

  const secondSaved = await secondDraft.inputValue();
  await openTool(page, "Filer");
  await openTool(page, "Terminal");
  await waitFor(async () => (await buffer(page)).includes("resultat-42"), "samme PTY replayes");
  assert.equal(await page.getByTestId("terminal").getAttribute("data-terminal-id"), terminalId);
  assert.equal(await secondDraft.inputValue(), secondSaved, "replay deler ikke på nytt etter unmount");

  const otherDir = path.join(h.home, "annet-terminalprosjekt");
  mkdirSync(otherDir);
  const other = await h.api("POST", "/api/projects", { name: "Annen terminal", path: otherDir });
  const otherThread = await h.createThread(other.id);
  await page.locator('.group[data-project="Annen terminal"] .group-title').first().click();
  await threadItem(page, otherThread.id).click();
  await openTool(page, "Terminal");
  await waitFor(async () => (await page.getByTestId("terminal").getAttribute("data-terminal-id")) !== terminalId && (await buffer(page)).trim().length > 0, "egen PTY i annet prosjekt");
  assert.ok(!(await buffer(page)).includes("resultat-42"));
  await share(page).getByRole("button", { name: "Del siste utdata", exact: true }).click();
  const otherDraft = pane(page, otherThread.id).getByLabel("Melding", { exact: true });
  await waitFor(async () => (await otherDraft.inputValue()).includes("Siste utdata fra terminalen"), "det andre prosjektets egen tråd mottar utdata");
  assert.ok(!(await otherDraft.inputValue()).includes("resultat-42"), "ingen terminaltekst fra feil prosjekt");
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  assert.equal(await page.getByTestId("terminal-share").count(), 0, "Chat har ingen terminaldeling");
  assert.deepEqual(await h.events(first.id), before);
});

flow("Lokal terminal deler bare til kodetråd i Denne datamaskinen og viser avkorting", async (h) => {
  const { page } = h;
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await openTool(page, "Terminal");
  await page.getByTestId("terminal").waitFor();
  assert.equal(await share(page).getByRole("button", { name: "Del siste utdata", exact: true }).isDisabled(), true);
  const local = await h.api("POST", "/api/threads", { projectId: null, mode: "code" });
  await h.api("PATCH", `/api/threads/${local.id}`, { title: "Lokal kodetråd" });
  await threadItem(page, local.id).click();
  await waitFor(async () => (await buffer(page)).trim().length > 0, "lokalt tempskall klart");
  await page.getByTestId("terminal").click();
  await page.keyboard.type("for i in $(seq 1 240); do printf 'linje-%s\\n' $i; done\n");
  await waitFor(async () => (await buffer(page)).includes("linje-240"), "lang ekte PTY-utdata er klar");
  const before = await h.events(local.id);
  await share(page).getByRole("button", { name: "Del siste utdata", exact: true }).click();
  const draft = pane(page, local.id).getByLabel("Melding", { exact: true });
  await waitFor(async () => (await draft.inputValue()).includes("linje-240"), "slutten legges i lokalt utkast");
  assert.match(await draft.inputValue(), /Avkortet: viser slutten/);
  assert.ok(!(await draft.inputValue()).includes("linje-1\n"), "eldste linjer er avkortet");
  assert.deepEqual(await h.events(local.id), before, "lokal deling starter ingen modell");
});
