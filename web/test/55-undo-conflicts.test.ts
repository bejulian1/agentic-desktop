// Two local model-backed tool loops share an actual temp file, in the order A/B/A.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { TurnDiff } from "../../shared/protocol.ts";
import { flow, openProject, pane, send, threadItem, waitFor } from "./harness.ts";

const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: "local-overlap", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

flow("Overlappende filverktøy krever eksplisitt Overskriv, mens aktivt prosjekt bare gir feil uten tvangsvalg", async (h) => {
  const { page } = h;
  const shared = path.join(h.projectDir, "shared.txt");
  let releaseA: (() => void) | undefined;
  let waitingA = false;
  const called: string[] = [];
  const fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (data) => { body += data; });
    req.on("end", () => {
      const request = JSON.parse(body);
      const tool = (name: string, input: object) => {
        called.push(name);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: `overlap_${called.length}`, type: "function", function: { name, arguments: JSON.stringify(input) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n");
      };
      const done = () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(chunk({ role: "assistant", content: "Filverktøyene er ferdige." }) + chunk({}, "stop") + "data: [DONE]\n\n");
      };
      if (!request.tools?.length) return done();
      const results = request.messages.filter((message: any) => message.role === "tool").length;
      if (JSON.stringify(request.messages).includes("A-OVERLAP")) {
        if (!results) return tool("write_file", { path: "shared.txt", content: "A1\n" });
        if (results === 1) {
          waitingA = true;
          releaseA = () => { releaseA = undefined; tool("read_file", { path: "shared.txt" }); };
          return;
        }
        if (results === 2) return tool("edit_file", { path: "shared.txt", old_string: "A1\n", new_string: "A1\nA2\n" });
        return done();
      }
      if (JSON.stringify(request.messages).includes("B-OVERLAP")) {
        if (!results) return tool("read_file", { path: "shared.txt" });
        if (results === 1) return tool("edit_file", { path: "shared.txt", old_string: "A1\n", new_string: "A1\nB1\n" });
      }
      done();
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const threads: string[] = [];
  try {
    const project = await openProject(h);
    await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal overlappstest", baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`, apiKey: "kun-lokal-test" });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal overlappstest", model: "local-overlap", contextWindow: 100_000 });
    await h.api("PATCH", "/api/settings", { defaultModelId: model.id });
    const a = await h.createThread(project.id);
    const b = await h.createThread(project.id);
    threads.push(a.id, b.id);
    await h.reload();
    await threadItem(page, a.id).locator(".thread-text").click();
    await send(page, "A-OVERLAP opprett og fortsett etter den andre tråden", pane(page, a.id));
    await waitFor(() => waitingA, "A har skrevet og venter på neste lokale modellsvar");
    assert.equal(readFileSync(shared, "utf8"), "A1\n");
    await h.api("POST", `/api/threads/${b.id}/messages`, { text: "B-OVERLAP bevar A og legg til B" });
    await waitFor(async () => (await h.events(b.id)).some((event) => event.event.type === "run.finished"), "B har endret samme fil og avsluttet");
    assert.equal(readFileSync(shared, "utf8"), "A1\nB1\n");
    await threadItem(page, b.id).locator(".thread-text").click();
    const bCard = pane(page, b.id).getByTestId("changes-card");
    await bCard.waitFor();
    const bTurn = (await bCard.getAttribute("data-turn-id"))!;
    h.allow(/status of 409/);
    const activeConflict = page.waitForResponse((response) => response.url().endsWith(`/api/turns/${bTurn}/revert`));
    await bCard.getByRole("button", { name: "Angre", exact: true }).click();
    const activeResponse = await activeConflict;
    assert.equal(activeResponse.status(), 409);
    assert.ok(!(await activeResponse.json()).conflicts?.length, "aktivt prosjekt er ingen filkonflikt som kan tvinges");
    await page.locator(".toast.error", { hasText: "Vent til trådene i prosjektet er ferdige før du angrer" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Overskriv", exact: true }).count(), 0);
    assert.equal(readFileSync(shared, "utf8"), "A1\nB1\n");
    assert.equal(await bCard.getByRole("button", { name: "Angre", exact: true }).isDisabled(), false);

    releaseA!();
    await waitFor(async () => (await h.events(a.id)).some((event) => event.event.type === "run.finished"), "A har lest B sitt resultat og fullført redigeringen");
    const combined = "A1\nA2\nB1\n";
    assert.equal(readFileSync(shared, "utf8"), combined);
    assert.deepEqual(called, ["write_file", "read_file", "edit_file", "read_file", "edit_file"]);
    await threadItem(page, a.id).locator(".thread-text").click();
    const card = pane(page, a.id).getByTestId("changes-card");
    await card.getByText("Overlapper annet arbeid. Angre ber om bekreftelse.", { exact: true }).waitFor();
    const turnId = (await card.getAttribute("data-turn-id"))!;
    const diff = await h.api<TurnDiff>("GET", `/api/turns/${turnId}/diff`);
    assert.equal(diff.files[0].overlapping, true);
    await card.getByRole("button", { name: "Vis endringer", exact: true }).click();
    await page.getByTestId("diff-file").getByText("Denne turen overlapper annet arbeid i filen. Angre krever bekreftelse før noe overskrives.", { exact: true }).waitFor();
    const undoBodies: unknown[] = [];
    page.on("request", (request) => { if (request.url().endsWith(`/api/turns/${turnId}/revert`)) undoBodies.push(request.postDataJSON()); });
    const dialog = page.locator("dialog").filter({ has: page.getByRole("heading", { name: "Angre kan overskrive annet arbeid", exact: true }) });
    await card.getByRole("button", { name: "Angre", exact: true }).click();
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /shared\.txt/);
    assert.equal(readFileSync(shared, "utf8"), combined, "ingen bytes endres før et eksplisitt valg");
    await dialog.getByRole("button", { name: "Avbryt", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(readFileSync(shared, "utf8"), combined, "Avbryt bevarer både B og A");
    assert.deepEqual(undoBodies, [{}], "Avbryt sender ingen tvungen Angre");
    await card.getByRole("button", { name: "Angre", exact: true }).click();
    await dialog.waitFor();
    assert.equal(readFileSync(shared, "utf8"), combined);
    await dialog.getByRole("button", { name: "Overskriv", exact: true }).click();
    await card.getByText("Angret", { exact: true }).waitFor();
    assert.deepEqual(undoBodies, [{}, {}, { force: true }]);
    assert.equal(existsSync(shared), false, "kun det eksplisitte Overskriv-valget gjenoppretter tilstanden før A opprettet filen");
  } finally {
    for (const id of threads) await h.api("POST", `/api/threads/${id}/stop`).catch(() => undefined);
    fake.closeAllConnections();
    await new Promise<void>((resolve, reject) => fake.close((error) => error ? reject(error) : resolve()));
  }
});
