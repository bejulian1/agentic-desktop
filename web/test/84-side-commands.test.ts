// Real app/server and a loopback fake provider. No real keys, model calls or user data.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { openaiChunk, openaiText, openaiToolCall } from "../../server/test/fake-llm.ts";
import { flow, pane, send, threadItem, waitFor, type Harness } from "./harness.ts";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function provider(h: Harness, reply: (body: any, res: http.ServerResponse) => Promise<void>) {
  const requests: any[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (part) => { body += part; });
    req.on("end", () => {
      const input = JSON.parse(body); requests.push(input);
      res.writeHead(200, { "content-type": "text/event-stream" });
      void reply(input, res).catch(() => { res.destroy(); });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const p = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Isolert lokal slash-test", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: "kun-lokal-test" });
  const model = await h.api("POST", "/api/models", { providerId: p.id, name: "Lokal slashmodell", model: "local-slash", contextWindow: 64000 });
  await h.api("PATCH", "/api/settings", { defaultModelId: model.id });
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { modelId: model.id });
  await h.reload();
  await threadItem(h.page, thread.id).locator(".thread-text").click();
  return {
    model, thread, requests,
    close: async () => {
      await h.api("POST", `/api/threads/${thread.id}/stop`).catch(() => undefined);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const lastUser = (body: any) => JSON.stringify(body.messages?.findLast((m: any) => m.role === "user")?.content);
const finished = async (h: Harness, id: string) => (await h.events(id)).some((e) => e.event.type === "run.finished");

flow("/btw strømmer separat mens hovedturen fortsetter, beholder nytt utkast og lagrer aldri sidespørsmålet", async (h) => {
  const main = gate(), side = gate();
  const fake = await provider(h, async (body, res) => {
    if (lastUser(body).includes("SIDE-PRIVATE-QUESTION")) {
      res.write(openaiChunk({ role: "assistant", content: "SIDE-ANSWER-TRANSIENT" }));
      await side.promise; res.end(openaiText(" ferdig"));
    } else {
      res.write(openaiChunk({ role: "assistant", content: "MAIN-ANSWER-CONTEXT" }));
      await main.promise; res.end(openaiText(" ferdig"));
    }
  });
  try {
    const source = pane(h.page, fake.thread.id);
    await send(h.page, "MAIN-QUESTION-CONTEXT", source);
    await source.getByText("MAIN-ANSWER-CONTEXT", { exact: true }).waitFor();
    await send(h.page, "/btw SIDE-PRIVATE-QUESTION", source);
    const panel = h.page.getByTestId("btw-panel");
    await panel.getByTestId("btw-answer").filter({ hasText: "SIDE-ANSWER-TRANSIENT" }).waitFor();
    await h.page.screenshot({ path: "/tmp/ad-side-btw.png" });
    const sideRequest = fake.requests.find((body) => lastUser(body).includes("SIDE-PRIVATE-QUESTION"));
    assert.equal(sideRequest.tools?.length ?? 0, 0, "sidesvaret har ingen verktøy");
    assert.match(JSON.stringify(sideRequest.messages), /MAIN-QUESTION-CONTEXT/);
    assert.match(JSON.stringify(sideRequest.messages), /MAIN-ANSWER-CONTEXT/);
    await source.getByRole("textbox", { name: "Melding", exact: true }).fill("MAIN-UNSENT-DRAFT");
    main.release();
    await waitFor(() => finished(h, fake.thread.id), "hovedturen fullføres mens sidesvaret fortsatt strømmer");
    assert.equal(await panel.getByRole("status").innerText(), "Svarer…");
    side.release();
    await panel.getByText("Svar ferdig", { exact: true }).waitFor();
    assert.equal(await source.getByRole("textbox", { name: "Melding", exact: true }).inputValue(), "MAIN-UNSENT-DRAFT");
    assert.doesNotMatch(JSON.stringify(await h.events(fake.thread.id)), /SIDE-PRIVATE-QUESTION|SIDE-ANSWER-TRANSIENT/);
    assert.deepEqual((await h.api("GET", `/api/threads/${fake.thread.id}/queue`)).items, []);
    await panel.getByRole("button", { name: "Lukk sidespørsmål", exact: true }).click();
    await panel.waitFor({ state: "detached" });
    await h.reload();
    await threadItem(h.page, fake.thread.id).locator(".thread-text").click();
    assert.equal(await h.page.getByTestId("btw-panel").count(), 0);
    assert.doesNotMatch(await pane(h.page, fake.thread.id).innerText(), /SIDE-PRIVATE-QUESTION|SIDE-ANSWER-TRANSIENT/);
  } finally { main.release(); side.release(); await fake.close(); }
});

flow("Slashfeil og manglende argumenter beholder utkast; kontekstbytte fjerner et levende sidesvar", async (h) => {
  const side = gate();
  const fake = await provider(h, async (_body, res) => {
    res.write(openaiChunk({ role: "assistant", content: "SENSITIVE-SIDE-PARTIAL" }));
    await side.promise; res.end(openaiText(" ferdig"));
  });
  try {
    const source = pane(h.page, fake.thread.id);
    const box = source.getByRole("textbox", { name: "Melding", exact: true });
    for (const command of ["btw", "background", "queue", "steer"]) {
      await send(h.page, `/${command} `, source);
      assert.equal(await box.inputValue(), `/${command} `, `/${command} uten argument beholder utkast`);
    }
    assert.equal(fake.requests.length, 0);
    await h.page.route(`**/api/threads/${fake.thread.id}/btw`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Isolert midlertidig feil" }) }));
    h.allow(/503/);
    await send(h.page, "/btw behold dette spørsmålet", source);
    await h.page.getByTestId("btw-panel").getByRole("alert").filter({ hasText: "Isolert midlertidig feil" }).waitFor();
    assert.equal(await box.inputValue(), "/btw behold dette spørsmålet");
    await h.page.unroute(`**/api/threads/${fake.thread.id}/btw`);
    await send(h.page, "/btw nytt kontekstavhengig spørsmål", source);
    await h.page.getByTestId("btw-answer").filter({ hasText: "SENSITIVE-SIDE-PARTIAL" }).waitFor();
    const other = await h.createThread(null);
    await threadItem(h.page, other.id).locator(".thread-text").click();
    await h.page.getByTestId("btw-panel").waitFor({ state: "detached" });
    await threadItem(h.page, fake.thread.id).locator(".thread-text").click();
    assert.equal(await h.page.getByTestId("btw-panel").count(), 0);
    assert.doesNotMatch(JSON.stringify(await h.events(fake.thread.id)), /kontekstavhengig|SENSITIVE-SIDE-PARTIAL|behold dette/);
  } finally { side.release(); await fake.close(); }
});

flow("/background starter parallelt med arvet kontekst og flytter fokus først når kortet åpnes", async (h) => {
  const main = gate(), child = gate();
  const fake = await provider(h, async (body, res) => {
    if (lastUser(body).includes("BACKGROUND-JOB")) {
      res.write(openaiChunk({ role: "assistant", content: "BACKGROUND-ANSWER" }));
      await child.promise; res.end(openaiText(" ferdig"));
    } else {
      res.write(openaiChunk({ role: "assistant", content: "MAIN-BACKGROUND-CONTEXT" }));
      await main.promise; res.end(openaiText(" ferdig"));
    }
  });
  try {
    const source = pane(h.page, fake.thread.id);
    await send(h.page, "MAIN-BACKGROUND-QUESTION", source);
    await source.getByText("MAIN-BACKGROUND-CONTEXT", { exact: true }).waitFor();
    await send(h.page, "/background BACKGROUND-JOB", source);
    const cards = h.page.getByTestId("background-sessions");
    await cards.waitFor();
    await waitFor(() => fake.requests.some((r) => lastUser(r).includes("BACKGROUND-JOB")), "egen modellforespørsel for bakgrunnsøkten");
    const bootstrap = await h.api("GET", "/api/bootstrap");
    const background = bootstrap.threads.find((t: any) => t.forkedFrom?.threadId === fake.thread.id && t.forkedFrom?.background);
    assert.ok(background, "egen navngitt bakgrunnstråd er opprettet");
    assert.equal(background.modelId, fake.model.id);
    assert.equal(await source.isVisible(), true, "hovedsamtalen beholder fokus");
    assert.equal(await pane(h.page, background.id).count(), 0);
    assert.equal(await finished(h, fake.thread.id), false, "hovedturen ble ikke stoppet");
    assert.doesNotMatch(JSON.stringify(await h.events(fake.thread.id)), /BACKGROUND-JOB|BACKGROUND-ANSWER/);
    const request = fake.requests.find((r) => lastUser(r).includes("BACKGROUND-JOB"));
    assert.match(JSON.stringify(request.messages), /MAIN-BACKGROUND-QUESTION/);
    child.release();
    await waitFor(() => finished(h, background.id), "bakgrunnsøkten fullføres selvstendig");
    await cards.getByRole("button", { name: /^Åpne bakgrunnsøkt:/ }).click();
    await pane(h.page, background.id).waitFor();
    assert.equal(await finished(h, fake.thread.id), false);
    main.release();
    await waitFor(() => finished(h, fake.thread.id), "hovedturen fullføres separat");
  } finally { main.release(); child.release(); await fake.close(); }
});

flow("Feil etter at /btw startet gjenoppretter bare urørt utkast og overskriver aldri ny hovedmelding", async (h) => {
  const first = gate(), second = gate();
  let calls = 0;
  const fake = await provider(h, async (_body, res) => {
    const turn = ++calls;
    res.write(openaiChunk({ role: "assistant", content: `Midlertidig sidesvar ${turn}` }));
    await (turn === 1 ? first.promise : second.promise);
    // A provider returning a tool despite tools=[] is rejected by the real BTW tool gate.
    res.end(openaiToolCall("write_file", { path: "forbidden.txt", text: "not executed" }));
  });
  try {
    const source = pane(h.page, fake.thread.id);
    const box = source.getByRole("textbox", { name: "Melding", exact: true });
    await send(h.page, "/btw feil uten nytt utkast", source);
    await h.page.getByTestId("btw-answer").filter({ hasText: "Midlertidig sidesvar 1" }).waitFor();
    assert.equal(await box.inputValue(), "", "start kvitterer og rydder den innsendte kommandoen");
    first.release();
    await h.page.getByTestId("btw-panel").getByRole("alert").waitFor();
    assert.equal(await box.inputValue(), "/btw feil uten nytt utkast");
    await send(h.page, "/btw feil med nyere hovedutkast", source);
    await h.page.getByTestId("btw-answer").filter({ hasText: "Midlertidig sidesvar 2" }).waitFor();
    await box.fill("Ny hovedmelding som ikke skal erstattes");
    second.release();
    await h.page.getByTestId("btw-panel").getByRole("alert").waitFor();
    assert.equal(await box.inputValue(), "Ny hovedmelding som ikke skal erstattes");
    assert.equal(await h.page.getByTestId("btw-answer").count(), 0, "delvis svar forkastes ved leverandørfeil");
    assert.doesNotMatch(JSON.stringify(await h.events(fake.thread.id)), /Midlertidig sidesvar|feil uten nytt|feil med nyere/);
  } finally { first.release(); second.release(); await fake.close(); }
});

flow("Samme modell og tråd: ekte omsending fjerner både levende og ferdige sidesvar", async (h) => {
  const side = gate();
  const fake = await provider(h, async (body, res) => {
    if (lastUser(body).includes("RESET-SIDE-LIVE")) {
      res.write(openaiChunk({ role: "assistant", content: "GAMMELT-LEVENDE-SIDESVAR" }));
      await side.promise; res.end(openaiText(" ferdig"));
    } else if (lastUser(body).includes("RESET-SIDE-DONE")) res.end(openaiText("GAMMELT-FERDIG-SIDESVAR"));
    else res.end(openaiText("Hovedsvaret er ferdig."));
  });
  try {
    const source = pane(h.page, fake.thread.id);
    await send(h.page, "Spørsmålet som skal sendes om igjen", source);
    await waitFor(() => finished(h, fake.thread.id), "første hovedtur er ferdig");
    const event = (await h.events(fake.thread.id)).find((entry) => entry.event.type === "user.message")!.event;
    assert.equal(event.type, "user.message");
    if (event.type !== "user.message") throw new Error("Brukermeldingen mangler");
    await send(h.page, "/btw RESET-SIDE-LIVE", source);
    await h.page.getByTestId("btw-answer").filter({ hasText: "GAMMELT-LEVENDE-SIDESVAR" }).waitFor();
    await h.api("POST", `/api/threads/${fake.thread.id}/rewind`, { messageId: event.messageId });
    await h.page.getByTestId("btw-panel").waitFor({ state: "detached" });
    side.release();
    await waitFor(() => finished(h, fake.thread.id), "omsendt hovedtur er ferdig");
    await send(h.page, "/btw RESET-SIDE-DONE", source);
    await h.page.getByTestId("btw-panel").getByText("Svar ferdig", { exact: true }).waitFor();
    const current = (await h.events(fake.thread.id)).find((entry) => entry.event.type === "user.message")!.event;
    if (current.type !== "user.message") throw new Error("Omsendt brukermelding mangler");
    await h.api("POST", `/api/threads/${fake.thread.id}/rewind`, { messageId: current.messageId });
    await h.page.getByTestId("btw-panel").waitFor({ state: "detached" });
    assert.doesNotMatch(JSON.stringify(await h.events(fake.thread.id)), /RESET-SIDE|GAMMELT-.*SIDESVAR/);
  } finally { side.release(); await fake.close(); }
});

flow("/btw nekter ny forespørsel uten levende synkronisering og forkaster panelet ved reconnect", async (h) => {
  const reconnect = gate();
  const fake = await provider(h, async (_body, res) => { res.end(openaiText("Dette skal ikke bestilles.")); });
  try {
    await h.page.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          (window as any).__isolatedTestSocket = this;
        }
      };
    });
    await h.reload();
    await threadItem(h.page, fake.thread.id).locator(".thread-text").click();
    let waiting = false;
    await h.page.route("**/api/ws-ticket", async (route) => { waiting = true; await reconnect.promise; await route.continue(); });
    await h.page.evaluate(() => (window as any).__isolatedTestSocket.close());
    await waitFor(() => waiting, "ny socket venter på et isolert testgjerde");
    const source = pane(h.page, fake.thread.id);
    await send(h.page, "/btw behold offline-utkast", source);
    const panel = h.page.getByTestId("btw-panel");
    await panel.getByRole("alert").filter({ hasText: "Vent til appen er tilkoblet" }).waitFor();
    assert.equal(fake.requests.length, 0, "HTTP-tilgang alene starter ikke en usynkronisert sidesamtale");
    assert.equal(await source.getByRole("textbox", { name: "Melding", exact: true }).inputValue(), "/btw behold offline-utkast");
    reconnect.release();
    await panel.waitFor({ state: "detached" });
    assert.equal(await source.getByRole("textbox", { name: "Melding", exact: true }).inputValue(), "/btw behold offline-utkast");
  } finally { reconnect.release(); await fake.close(); }
});

flow("/queue og /steer overstyrer bare én sending og beholder den globale opptatt-innstillingen", async (h) => {
  const main = gate();
  let first = true;
  const fake = await provider(h, async (_body, res) => {
    if (first) { first = false; res.write(openaiChunk({ role: "assistant", content: "HOVEDTUR-VENTER" })); await main.promise; }
    res.end(openaiText("Svaret er ferdig."));
  });
  try {
    const source = pane(h.page, fake.thread.id);
    await send(h.page, "Start ventende hovedtur", source);
    await source.getByText("HOVEDTUR-VENTER", { exact: true }).waitFor();
    const delivered: any[] = [];
    await h.page.route(`**/api/threads/${fake.thread.id}/messages`, async (route) => { delivered.push(route.request().postDataJSON()); await route.continue(); });
    await h.api("PATCH", "/api/settings", { busyMessages: "steer" });
    await send(h.page, "/queue QUEUE-PAYLOAD", source);
    await waitFor(async () => (await h.api("GET", `/api/threads/${fake.thread.id}/queue`)).items.some((x: any) => x.text === "QUEUE-PAYLOAD"), "kømeldingen er lagt til");
    await h.api("PATCH", "/api/settings", { busyMessages: "queue" });
    await send(h.page, "/steer STEER-PAYLOAD", source);
    await waitFor(() => delivered.length === 2, "begge eksplisitte leveringer er sendt");
    assert.equal(delivered[0].text, "QUEUE-PAYLOAD"); assert.equal(delivered[0].steer, false);
    assert.equal(delivered[1].text, "STEER-PAYLOAD"); assert.equal(delivered[1].steer, true);
    const waiting = (await h.api("GET", `/api/threads/${fake.thread.id}/queue`)).items;
    assert.equal(waiting.find((x: any) => x.text === "QUEUE-PAYLOAD")?.steer, false);
    assert.equal(waiting.find((x: any) => x.text === "STEER-PAYLOAD")?.steer, true);
    assert.equal((await h.api("GET", "/api/bootstrap")).settings.busyMessages, "queue");
    main.release();
    await waitFor(async () => (await h.api("GET", `/api/threads/${fake.thread.id}/queue`)).items.length === 0 && (await h.events(fake.thread.id)).filter((e) => e.event.type === "run.finished").length >= 2, "kø og styring er faktisk levert");
  } finally { main.release(); await fake.close(); }
});
