import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { flow, openProject, send, waitFor } from "./harness.ts";

function chunk(text: string, finish: "stop" | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`;
}

for (const mode of ["chat", "code"] as const) {
  flow(`Diagram i ${mode}: strømming, tilgjengelige data og gjenåpning`, async (h) => {
    const hostileLabel = '<img src=x onerror="alert(1)">';
    const chart = mode === "chat"
      ? { type: "bar", title: "Endring", unit: "s", data: [
        { label: hostileLabel, value: -4, group: "Før" }, { label: "Tirsdag", value: 2, group: "Etter" },
        { label: "Onsdag", value: 0, group: "Etter" },
      ] }
      : { type: "line", title: "Temperatur", unit: "°C", data: [
        { label: "08", value: 2 }, { label: hostileLabel, value: 2 }, { label: "16", value: 2 },
      ] };
    const json = JSON.stringify(chart);
    const closed = Promise.withResolvers<void>();
    const ended = Promise.withResolvers<void>();
    const fake = createServer((request, response) => {
      request.resume();
      request.on("end", async () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(chunk(`Før diagrammet.\n\n\`\`\`chart\n${json}\n`));
        await closed.promise;
        response.write(chunk("```\n\n"));
        await ended.promise;
        response.end(chunk("Etter diagrammet.\n\n```chart\n{\"type\":\"bar\",\"title\":\"Ugyldig\",\"data\":[{\"label\":\"Uendelig\",\"value\":1e999}]}\n```", "stop") + "data: [DONE]\n\n");
      });
    });
    fake.listen(0, "127.0.0.1");
    await once(fake, "listening");
    try {
      const baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
      const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl });
      const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Diagramtest", model: "local", contextWindow: 100_000 });
      if (mode === "code") await openProject(h, "Diagramtest");
      const { page } = h;
      await page.getByTestId("model-button").click();
      await page.getByRole("option", { name: model.name, exact: true }).click();
      await send(page, "Vis endringen som et diagram.");
      await page.getByText("Tegner diagram …", { exact: true }).waitFor();
      const figure = page.locator(".md-chart");
      assert.equal(await figure.count(), 0);
      closed.resolve();
      await figure.waitFor();
      const check = async () => {
        assert.equal(await figure.locator("figcaption").textContent(), chart.title);
        if (mode === "chat") {
          await figure.getByRole("rowheader", { name: `Før · ${hostileLabel}` }).waitFor();
          await figure.getByRole("cell", { name: "−4 s" }).waitFor();
          const widths = await figure.locator(".chart-bar").evaluateAll((bars) => bars.map((bar) => parseFloat((bar as HTMLElement).style.width)));
          assert.ok(widths[0] > 66 && widths[0] < 67);
          assert.ok(widths[1] > 33 && widths[1] < 34);
          assert.equal(widths[2], 0);
          assert.deepEqual(await figure.locator(".chart-bar").evaluateAll((bars) => bars.map((bar) => (bar as HTMLElement).dataset.color)), ["0", "1", "1"]);
        } else {
          assert.equal(await figure.locator("polyline").getAttribute("points"), "0,50 50,50 100,50");
          const summary = figure.locator("summary");
          await summary.focus();
          await page.keyboard.press("Enter");
          await figure.getByText(hostileLabel, { exact: true }).waitFor();
          assert.deepEqual(await figure.locator("dd").allTextContents(), ["2 °C", "2 °C", "2 °C"]);
        }
        assert.equal(await figure.locator("img").count(), 0);
      };
      await check();
      assert.equal(await page.getByText("Etter diagrammet.", { exact: true }).count(), 0);
      ended.resolve();
      await page.getByText("Etter diagrammet.", { exact: true }).waitFor();
      const invalid = page.locator(".md-code", { hasText: "1e999" });
      await invalid.getByRole("button", { name: /kopier/i }).waitFor();
      const thread = (await h.api("GET", "/api/bootstrap")).threads.find((item: { mode: string }) => item.mode === mode);
      await waitFor(async () => (await h.events(thread.id)).some(({ event }) => event.type === "run.finished"), "svaret er ferdig");
      await h.reload();
      await figure.waitFor();
      await check();
      await invalid.waitFor();
    } finally {
      closed.resolve();
      ended.resolve();
      fake.closeAllConnections();
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });
}
