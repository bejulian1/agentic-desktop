import assert from "node:assert/strict";
import http from "node:http";
import { flow, openProject, pane, send, threadItem, waitFor } from "./harness.ts";
import { openaiText } from "../../server/test/fake-llm.ts";

flow("Kode: lesestatus venter på modellrespons, beholdes ved reload og følger ikke kømeldingen", async (h) => {
  const gates: Array<() => void> = [];
  const requests: any[] = [];
  const fake = http.createServer((req, res) => {
    let text = ""; req.on("data", (chunk) => { text += chunk; });
    req.on("end", async () => {
      requests.push(JSON.parse(text));
      await new Promise<void>((resolve) => gates.push(resolve));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(openaiText("Modellen har svart."));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  try {
    await openProject(h, "Lesekvittering");
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal kvitteringstest", baseUrl: `http://127.0.0.1:${(fake.address() as any).port}/v1` });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Kvitteringsmodell", model: "local", contextWindow: 64000 });
    await h.page.getByTestId("model-button").click();
    await h.page.getByRole("option", { name: model.name, exact: true }).click();
    await send(h.page, "Første melding");
    await waitFor(() => requests.length === 1, "første modellkall starter");
    const pending = h.page.getByTestId("message-receipt").first();
    await pending.filter({ hasText: "Ikke bekreftet lest" }).waitFor();
    const thread = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.mode === "code")!;
    await send(h.page, "/queue Oppfølging");
    assert.equal(await h.page.getByTestId("message-receipt").count(), 1);
    gates[0]();
    await waitFor(() => requests.length === 2, "kømeldingen starter en egen tur");
    await pending.filter({ hasText: "Lest av modellen" }).waitFor();
    await h.page.getByTestId("message-receipt").nth(1).filter({ hasText: "Ikke bekreftet lest" }).waitFor();
    gates[1]();
    await waitFor(async () => (await h.events(thread.id)).filter((e) => e.event.type === "run.finished").length === 2, "begge turer er ferdige");
    await h.reload();
    await threadItem(h.page, thread.id).locator(".thread-text").click();
    const receipts = pane(h.page, thread.id).getByTestId("message-receipt");
    await waitFor(async () => await receipts.count() === 2, "kvitteringene gjenopprettes");
    assert.deepEqual(await receipts.allTextContents(), ["Lest av modellen", "Lest av modellen"]);
    await h.page.screenshot({ path: "/tmp/ad-message-receipts.png" });
  } finally {
    gates.forEach((release) => release()); fake.closeAllConnections();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  }
});

flow("Nye slash-snarveier åpner ekte prosjektpaneler og kontekst uten nye modellturer", async (h) => {
  await openProject(h, "Kommandoflyt");
  await send(h.page, "Hei");
  const thread = (await h.api("GET", "/api/bootstrap")).threads.find((t: any) => t.mode === "code")!;
  await waitFor(async () => (await h.events(thread.id)).some((e) => e.event.type === "run.finished"), "demo ferdig");
  const before = (await h.events(thread.id)).filter((e) => e.event.type === "run.started").length;
  await send(h.page, "/context");
  await h.page.getByRole("dialog").filter({ hasText: "Komprimeringsreserve" }).waitFor();
  await h.page.keyboard.press("Escape");
  await send(h.page, "/agents");
  await h.page.getByRole("tab", { name: /Team/ }).waitFor();
  await send(h.page, "/diff");
  await h.page.getByRole("tab", { name: /Endringer/ }).waitFor();
  await send(h.page, "/stop");
  assert.equal((await h.events(thread.id)).filter((e) => e.event.type === "run.started").length, before);
});
