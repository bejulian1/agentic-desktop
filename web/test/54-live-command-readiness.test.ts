// A local fake provider calls the real command tool. Browser, provider and app use only tempdata.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { flow, openProject, openTool, pane, send, threadItem, waitFor } from "./harness.ts";

const command = 'node -e "setTimeout(() => console.log(\'første-levende-linje\'), 1500); setInterval(() => console.log(\'kommandoen-lever\'), 2000)"';
const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: "local-command", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

flow("Første levende kommando-utdata vises i steget og Økt, isoleres mellom tråder og stopper med turen", async (h) => {
  const { page } = h;
  let toolRequests = 0;
  const fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (data) => { body += data; });
    req.on("end", () => {
      const request = JSON.parse(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (request.tools?.some((tool: any) => tool.function?.name === "run_command") && !request.messages.some((message: any) => message.role === "tool")) {
        toolRequests++;
        res.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "live_command_call", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command }) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n");
      } else res.end(chunk({ role: "assistant", content: "Lokal test er ferdig." }) + chunk({}, "stop") + "data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  let runningThread: string | undefined;
  try {
    const project = await openProject(h);
    await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal kommandotest", baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`, apiKey: "kun-lokal-test" });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal kommandotest", model: "local-command", contextWindow: 100_000 });
    await h.api("PATCH", "/api/settings", { defaultModelId: model.id, expandShell: true });
    const active = await h.createThread(project.id);
    const other = await h.createThread(project.id);
    runningThread = active.id;
    await h.reload();
    await threadItem(page, active.id).locator(".thread-text").click();
    await openTool(page, "Økt");
    await send(page, "Vis kommandoens utdata mens den kjører", pane(page, active.id));
    const tool = pane(page, active.id).locator('.row-tool[data-tool="run_command"]');
    await tool.locator('.tool-head[aria-expanded="true"]').waitFor();
    const live = page.getByTestId("okt-command");
    await live.waitFor();
    assert.equal(await live.locator(".okt-command-input").innerText(), command);
    await tool.locator(".tool-output", { hasText: "første-levende-linje" }).waitFor();
    await page.getByTestId("okt-command-output").filter({ hasText: "første-levende-linje" }).waitFor();
    assert.equal(await tool.getAttribute("data-status"), "running", "første utdata er synlig før verktøyet avsluttes");
    const beforeStop = await h.events(active.id);
    assert.ok(beforeStop.some((event) => event.event.type === "tool.output" && event.event.text.includes("første-levende-linje")));
    assert.ok(!beforeStop.some((event) => event.event.type === "run.finished"));
    assert.equal(await page.getByTestId("changes-card").count(), 0);
    await threadItem(page, other.id).locator(".thread-text").click();
    await pane(page, other.id).waitFor();
    await waitFor(async () => (await live.count()) === 0, "annen tråd viser ikke den første trådens kjørende kommando");
    assert.equal(await page.getByTestId("okt-command-output").count(), 0);
    await threadItem(page, active.id).locator(".thread-text").click();
    await live.waitFor();
    await page.getByTestId("okt-command-output").filter({ hasText: "første-levende-linje" }).waitFor();
    await live.getByRole("button", { name: "Stopp turen og kommandoen", exact: true }).click();
    await waitFor(async () => (await h.events(active.id)).some((event) => event.event.type === "run.finished" && event.event.status === "stopped"), "Stopp avsluttet den faktiske turen");
    await waitFor(async () => (await live.count()) === 0, "avsluttet kommando forsvinner fra Kjører nå");
    assert.equal(await tool.getAttribute("data-status"), "cancelled");
    assert.equal(await page.getByTestId("changes-card").count(), 0, "ren kommando-utdata lager ingen endringsboks");
    const events = await h.events(active.id);
    assert.ok(events.every((event) => event.event.type !== "turn.changes" || event.event.files.length === 0));
    assert.equal(toolRequests, 1, "verktøyet ble kalt av den lokale falske modellen");
  } finally {
    if (runningThread) await h.api("POST", `/api/threads/${runningThread}/stop`).catch(() => undefined);
    fake.closeAllConnections();
    await new Promise<void>((resolve, reject) => fake.close((error) => error ? reject(error) : resolve()));
  }
});
