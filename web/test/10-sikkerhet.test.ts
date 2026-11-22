import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { flow, openProject, send, threadItem, openTool } from "./harness.ts";
import { OPENAI_DONE, openaiChunk, openaiUsage } from "../../server/test/fake-llm.ts";

const EVIL = [
  "# Tittel <script>window.__pwned = 1</script>",
  "",
  "<script>window.__pwned = 2</script>",
  "",
  '<img src="x" onerror="window.__pwned = 3">',
  "",
  '<iframe srcdoc="<script>parent.__pwned = 4</script>"></iframe>',
  "",
  '<svg onload="window.__pwned = 5"></svg>',
  "",
  "<style>body { display: none }</style>",
  "",
  "[lenke](javascript:window.__pwned=6) og [data](data:text/html,<script>parent.__pwned=7</script>)",
  "",
  '![bilde](http://127.0.0.1:9/lekk.png "x")',
  "",
  "<a href=\"javascript:window.__pwned=8\">inline</a> <b onclick=\"window.__pwned=9\">fet</b>",
  "",
  "```html",
  "</code></pre><script>window.__pwned = 10</script>",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  '| <img src=x onerror="window.__pwned=11"> | `<script>` |',
  "",
  "- [ ] <script>window.__pwned = 12</script>",
  "",
  "&lt;script&gt;window.__pwned = 13&lt;/script&gt;",
  "",
  "[bra lenke](https://example.com)",
].join("\n");

function fakeModel(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (let i = 0; i < EVIL.length; i += 23) res.write(openaiChunk({ role: "assistant", content: EVIL.slice(i, i + 23) }));
      res.end(openaiChunk({}, "stop") + openaiUsage(10, 5) + OPENAI_DONE);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      close: async () => {
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
      },
    }));
  });
}

flow("ondsinnet Markdown og HTML i agentutdata kjører ikke og bryter ikke CSP", async (h) => {
  const { page } = h;
  const llm = await fakeModel();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  try {
    const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Ond test", baseUrl: llm.url, apiKey: "test" });
    const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Ond", model: "ond-1", contextWindow: 100000, inputPricePerMTok: 3, outputPricePerMTok: 15 });
    await h.api("PATCH", "/api/settings", { defaultModelId: model.id });
    writeFileSync(path.join(h.projectDir, '<img src=x onerror="window.__pwned=20">.html'), "<script>window.__pwned = 21</script>");
    await openProject(h);

    await send(page, "<script>window.__pwned = 30</script><b>hei</b>");
    const answer = page.locator(".row-text").first();
    await answer.getByText("bra lenke").waitFor();
    await page.waitForTimeout(150);
    await page.locator(".pane-inner.focused").getByTestId("context-ring").hover();
    await page.locator(".ring-pop", { hasText: "$0.0001" }).waitFor(); // A model with a price shows its cost.

    assert.equal(await page.evaluate(() => (window as any).__pwned), undefined, "ingen skript kjørte");
    for (const selector of ["script", "svg", "img", "style", "[onerror]", "[onclick]", "[onload]", 'a[href^="javascript"]', 'a[href^="data"]']) {
      // The artifact box's own icons are the app's, made with createElementNS, not the model's, and
      // so is the coloured mark in a link chip (v1.4.0, markdown/render.ts).
      const found = await answer.locator(selector).evaluateAll((els) => els.filter((el) => !el.closest(".artifact-box") && !el.closest("a.md-link-chip > svg.md-link-icon")).length);
      assert.equal(found, 0, `${selector} finnes ikke i svaret`);
    }
    // Since round 15 an html block with <script> is an artifact box (SPEC 31.1): no iframe in the
    // answer at all. Opened, its script runs only in the panel's sandboxed iframe on the preview
    // server's origin, never in the app, and the Kode tab shows it as text.
    assert.equal(await answer.locator("iframe").count(), 0, "ingen iframe i svaret");
    const box = answer.locator(".artifact-box");
    assert.equal(await box.count(), 1, "html-blokken med <script> er en artifact-boks");
    assert.equal(await box.locator("svg").evaluateAll((els) => els.every((el) => el.closest(".artifact-box-icon, .artifact-box-go"))), true);
    assert.equal(await answer.locator("a").count(), 1, "bare den trygge lenken ble en lenke");
    assert.equal(await answer.locator("a").getAttribute("href"), "https://example.com");
    assert.equal(await answer.locator("a").getAttribute("rel"), "noopener noreferrer");
    // The safe link's mark is the app's monogram: one svg with a letter, nothing from the answer.
    assert.equal(await answer.locator("a svg").count(), 1);
    assert.equal(await answer.locator("a svg.md-link-monogram text").textContent(), "E");
    assert.ok(!requests.some((url) => url.includes("lekk.png")), "bildet ble aldri hentet");
    const text = await answer.textContent() ?? "";
    assert.match(text, /window\.__pwned = 2/, "rå HTML vises som tekst");
    await box.getByRole("button").click();
    const panel = page.getByTestId("artifact-panel");
    const frame = panel.locator("iframe");
    await frame.waitFor();
    assert.equal(await frame.getAttribute("sandbox"), "allow-scripts allow-modals");
    assert.equal(await frame.getAttribute("srcdoc"), null);
    const src = new URL((await frame.getAttribute("src"))!);
    assert.match(src.href, /^http:\/\/localhost:\d+\/s\//);
    assert.notEqual(src.port, String(h.server.port));
    await panel.getByRole("tab", { name: "Kode" }).click();
    await panel.getByTestId("artifact-source").getByText("</code></pre><script>window.__pwned = 10</script>").waitFor();
    assert.equal(await panel.locator("script").count(), 0, "koden vises som tekst");
    assert.equal(await page.evaluate(() => (window as any).__pwned), undefined);
    await panel.getByRole("button", { name: "Lukk artifacten" }).click();
    await panel.waitFor({ state: "detached" });
    assert.equal(await page.locator(".user-text").textContent(), "<script>window.__pwned = 30</script><b>hei</b>");
    assert.equal(await page.locator(".thread-title b").count(), 0, "tittelen er tekst");

    // Bad file names in the file tree, and bad file contents in the editor.
    await openTool(page, "Filer");
    const file = page.locator(".tree-item").first();
    await file.click();
    await page.locator(".cm-content", { hasText: "window.__pwned = 21" }).waitFor();
    assert.equal(await page.evaluate(() => (window as any).__pwned), undefined);
    assert.equal(await page.locator(".right-panel img, .right-panel script").count(), 0);

    // Reloading replays the same content from the log: history takes the same safe path.
    await h.reload();
    await page.locator(".row-text").first().getByText("bra lenke").waitFor();
    assert.equal(await page.evaluate(() => (window as any).__pwned), undefined);
    assert.equal(await page.locator(".row-text img, .row-text script").count(), 0);
    await threadItem(page, await page.locator(".pane-inner.focused").getAttribute("data-thread-id") as string).waitFor();
  } finally {
    await llm.close();
  }
});

flow("tokenet forsvinner fra adressen og finnes ikke i siden", async (h) => {
  const { page } = h;
  assert.equal(page.url().includes("token"), false);
  const token = new URL(h.server.link).hash.slice("#token=".length);
  const html = await page.content();
  assert.equal(html.includes(token), false);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
  assert.equal(stored.includes(token), false);
  assert.equal(await page.evaluate(() => document.cookie), "", "cookien er HttpOnly");
});
