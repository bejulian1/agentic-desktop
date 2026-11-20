// Local demo tool loop and real temporary files; no external providers or visible browser.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Thread, TurnDiff } from "../../shared/protocol.ts";
import { approveUntil, flow, openProject, openTool, send, waitFor } from "./harness.ts";

flow("Kode knytter filaktivitet, ekte linjetall og ett sluttkort til den valgte tråden, med Angre og omlasting", async (h) => {
  const { page } = h;
  const original = "<!doctype html>\n<title>Før endringen</title>\n<p>Bevar originalen ved Angre</p>\n";
  const file = path.join(h.projectDir, "index.html");
  writeFileSync(file, original);
  writeFileSync(path.join(h.projectDir, "annen.txt"), "Mitt manuelle filvalg\n");
  const project = await openProject(h);
  await openTool(page, "Filer");
  await page.locator('.tree-item[data-path="annen.txt"]').click();
  await page.getByTestId("editor").getByText("Mitt manuelle filvalg", { exact: true }).waitFor();
  await send(page, "lag en side");
  const activity = page.getByTestId("file-activity");
  await activity.filter({ hasText: "Venter på tillatelse" }).waitFor();
  assert.equal(await activity.getAttribute("data-path"), "index.html", "aktiviteten bruker filverktøyets faktiske input.path");
  assert.equal(await activity.getAttribute("data-active"), "true");
  assert.match(await page.locator(".file-path").innerText(), /annen\.txt/, "modellens filbytte overtar ikke brukerens valg");
  assert.equal(await page.getByTestId("changes-card").count(), 0, "en ventende skriving er ingen utført endring");
  assert.equal(await page.locator('.tree-item[data-path="index.html"] .file-change-counts').count(), 0, "ingen oppdiktede linjetall før filen er endret");
  await activity.click();
  await page.locator(".file-path", { hasText: "index.html" }).waitFor();
  await page.getByTestId("editor").getByText("Bevar originalen ved Angre", { exact: false }).waitFor();
  await approveUntil(page, async () => (await page.getByTestId("changes-card").count()) === 1, "filverktøyene er ferdige");
  const id = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  await waitFor(async () => (await h.events(id)).some((event) => event.event.type === "run.finished"), "turen er avsluttet");
  const card = page.getByTestId("changes-card");
  assert.equal(await card.count(), 1);
  assert.notEqual(readFileSync(file, "utf8"), original);
  const turnId = (await card.getAttribute("data-turn-id"))!;
  const recorded = await h.api<TurnDiff>("GET", `/api/turns/${turnId}/diff`);
  assert.equal(recorded.files.length, 1);
  const change = recorded.files[0];
  assert.equal(change.path, "index.html");
  assert.equal(change.countsExact, true);
  assert.ok(change.additions > 0 && change.deletions > 0);
  const expected = `+${change.additions} −${change.deletions}`;
  const countText = async (selector: string) => (await page.locator(selector).innerText()).replace(/\s+/g, " ").trim();
  assert.equal(await countText(".changes-file .file-change-counts"), expected);
  await openTool(page, "Filer"); // The demo also opens the browser panel while working.
  await page.locator('.tree-item[data-path="index.html"]').click();
  await waitFor(async () => (await page.locator(".file-path-row .file-change-counts").count()) === 1, "registrerte linjetall i filhodet");
  assert.equal(await countText(".file-path-row .file-change-counts"), expected);
  assert.equal(await countText('.tree-item[data-path="index.html"] .file-change-counts'), expected);
  const colors = await card.locator(".changes-file").evaluate((el) => ({ add: getComputedStyle(el.querySelector(".diff-add")!).color, del: getComputedStyle(el.querySelector(".diff-del")!).color }));
  assert.notEqual(colors.add, colors.del, "pluss og minus bruker hver sin temafarge");
  await openTool(page, "Oversikt");
  assert.equal(await countText('[aria-label="Utdata"] .file-change-counts'), expected);
  await card.getByRole("button", { name: "Vis endringer", exact: true }).click();
  await page.getByTestId("diff-file").waitFor();
  assert.equal(await countText(".diff-file-head .file-change-counts"), expected);
  assert.match(await page.getByTestId("diff-file").innerText(), /Før endringen/);
  await card.getByRole("button", { name: "Angre", exact: true }).click();
  await card.getByText("Angret", { exact: true }).waitFor();
  assert.equal(readFileSync(file, "utf8"), original);
  await page.getByText("Turen er angret. Diffen viser de opprinnelige endringene.").waitFor();
  await openTool(page, "Oversikt");
  await page.getByText("Ingen filer er endret i denne tråden ennå.", { exact: true }).waitFor();
  await openTool(page, "Filer");
  assert.equal(await page.locator('.tree-item[data-path="index.html"] .file-change-counts').count(), 0);
  await h.reload();
  await card.getByText("Angret", { exact: true }).waitFor();
  assert.equal(await card.count(), 1, "historikk gjenoppretter ett angret kort");
  assert.equal(await card.getByRole("button", { name: "Angre", exact: true }).count(), 0);
  await send(page, "hvem er du?");
  await waitFor(async () => (await h.events(id)).filter((event) => event.event.type === "run.finished").length === 2, "rent tekstsvar er ferdig");
  assert.equal(await card.count(), 1, "senere tekst lager ingen ekstra endringsboks");
  const thread = (await h.api("GET", "/api/bootstrap")).threads.find((item: Thread) => item.id === id);
  assert.equal(thread.projectId, project.id);
}, { mockDelayMs: 4 });

flow("Binærfil viser ingen oppdiktede linjetall og Angre gjenoppretter nøyaktige byte", async (h) => {
  const { page } = h;
  const original = Buffer.from([0, 255, 13, 0, 42]);
  const file = path.join(h.projectDir, "binary.dat");
  writeFileSync(file, original);
  const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: "binary-delete", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (data) => { body += data; });
    req.on("end", () => {
      const request = JSON.parse(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (request.tools?.some((tool: any) => tool.function?.name === "delete_file") && !request.messages.some((message: any) => message.role === "tool")) {
        res.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "delete_binary", type: "function", function: { name: "delete_file", arguments: JSON.stringify({ path: "binary.dat" }) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n");
      } else res.end(chunk({ role: "assistant", content: "Den binære testfilen er slettet." }) + chunk({}, "stop") + "data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal binærtest", baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`, apiKey: "kun-lokal-test" });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal binærtest", model: "binary-delete", contextWindow: 100_000 });
    await h.api("PATCH", "/api/settings", { defaultModelId: model.id });
    await h.reload();
    await openProject(h);
    await send(page, "Slett den binære testfilen");
    await approveUntil(page, async () => (await page.getByTestId("changes-card").count()) === 1, "ekte filverktøy har slettet binærfilen");
    const card = page.getByTestId("changes-card");
    await card.getByText("Binærfil", { exact: true }).waitFor();
    assert.equal(await card.locator(".diff-add, .diff-del").count(), 0, "binærfil har ingen linjetall");
    await card.getByRole("button", { name: "Vis endringer", exact: true }).click();
    await page.getByTestId("diff-file").getByText("Binærfilen er registrert. Innhold og linjetall vises ikke.", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("diff-file").locator(".diff-line").count(), 0, "binære byte dekodes ikke til falske tekstlinjer");
    await card.getByRole("button", { name: "Angre", exact: true }).click();
    await card.getByText("Angret", { exact: true }).waitFor();
    assert.deepEqual(readFileSync(file), original);
  } finally {
    fake.closeAllConnections();
    await new Promise<void>((resolve, reject) => fake.close((error) => error ? reject(error) : resolve()));
  }
});
