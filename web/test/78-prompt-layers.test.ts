// Innstillinger → Konfigurasjon → Forhåndsvisning: a built-in layer of the system prompt can be
// replaced by the user's own text and brought back with Tilbakestill, per previewed mode.
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { flow, openProject, waitFor } from "./harness.ts";

const openSettings = async (page: Page, section: string) => {
  await page.getByRole("button", { name: "Innstillinger" }).first().click();
  await page.getByRole("region", { name: "Innstillinger" }).waitFor();
  await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
};

flow("Forhåndsvisning: rediger et lag med plassholdere, lagre, se at modellen får teksten, og tilbakestill", async (h) => {
  const { page } = h;
  const project = await openProject(h, "Lagprosjekt");
  await openSettings(page, "Konfigurasjon");
  const layer = (id: string) => page.locator(`.harness-layer[data-layer="${id}"]`);
  await layer("base").locator("summary").click();
  // Miljø is live state: readable, not editable.
  await layer("env").locator("summary").click();
  assert.equal(await layer("env").getByRole("button", { name: "Rediger" }).count(), 0);
  await layer("env").getByText("Miljøet er levende tilstand").waitFor();

  // The editor starts from the built-in text with the live parts as placeholders.
  await layer("base").getByRole("button", { name: "Rediger" }).click();
  const editor = layer("base").getByLabel("Egen tekst for Grunn-harness");
  const template = await editor.inputValue();
  assert.match(template, /working in the project folder \{\{project_path\}\}/);
  assert.match(template, /Here you can \{\{abilities\}\}/);
  await editor.fill(`EGEN-LINJE for {{project}}.\n${template}`);
  await layer("base").getByRole("button", { name: "Lagre for Kode med prosjekt" }).click();
  await layer("base").locator(".layer-own", { hasText: "Endret" }).waitFor();
  // The layer stays open, shows the text with the live parts filled in, and can be reset.
  await layer("base").locator(".harness-layer-text", { hasText: "EGEN-LINJE for Lagprosjekt." }).waitFor();
  assert.match(await layer("base").locator(".harness-layer-text").innerText(), new RegExp(project.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const served = (await h.api("GET", `/api/harness/preview?mode=code&projectId=${project.id}`)).layers.find((l: any) => l.id === "base");
  assert.equal(served.overridden, true);
  assert.match(served.text, /^EGEN-LINJE for Lagprosjekt\./);
  // Chat is another variant: its base is untouched, and switching keeps the page where it is.
  await page.getByRole("group", { name: "Forhåndsvis modus" }).getByRole("button", { name: "Chat" }).click();
  await layer("chat-base").waitFor();
  assert.equal(await layer("chat-base").locator(".layer-own").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Tilbakestill alle" }).count(), 0);
  await page.getByRole("group", { name: "Forhåndsvis modus" }).getByRole("button", { name: "Kode" }).click();
  await layer("base").locator(".layer-own").waitFor();

  // Tilbakestill asks first, and brings the built-in text back.
  await page.getByRole("button", { name: "Tilbakestill alle" }).click();
  const confirm = page.getByRole("dialog", { name: "Tilbakestille alle lagene?" });
  await confirm.getByRole("button", { name: "Avbryt" }).click();
  await layer("base").locator(".layer-own").waitFor();
  await layer("base").getByRole("button", { name: "Tilbakestill", exact: true }).click();
  await page.getByRole("dialog", { name: "Tilbakestille «Grunn-harness»?" }).getByRole("button", { name: "Tilbakestill", exact: true }).click();
  await waitFor(async () => (await layer("base").locator(".layer-own").count()) === 0, "merket er borte");
  await layer("base").locator(".harness-layer-text", { hasText: "You are the coding agent in Agentic Desktop" }).waitFor();
  assert.equal((await h.api("GET", `/api/harness/preview?mode=code&projectId=${project.id}`)).layers.find((l: any) => l.id === "base").overridden, false);
});
