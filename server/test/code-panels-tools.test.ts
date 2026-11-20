// The real model/tool loop against a local fake API and local pages only.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, until } from "./helpers.ts";

test("Kode verktøyløkke bruker egen nettleserfane og prosjektfiler, men ikke panelterminalens skall", async (t) => {
  const llm = await startFakeLlm(t);
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "notat.txt"), "før\n");
  mkdirSync(path.join(project.path, "undermappe"));
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: `${llm.url}/v1` });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "fake", contextWindow: 100_000, supportsImages: true });
  const thread = await h.thread(project.id, "code", model.id);
  const panel = await h.socket();
  const site = http.createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(
    `<title>Fane ${req.url}</title><button onclick="this.textContent='Endret ${req.url}'">Bytt</button>`,
  ));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  t.after(() => { site.closeAllConnections(); site.close(); });
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  for (const tabId of ["en", "to"]) {
    panel.send({ type: "browser.open", projectId: project.id, tabId, width: 640, height: 480 });
    await panel.waitFor((m) => m.type === "browser.state" && m.tabId === tabId);
    panel.send({ type: "browser.navigate", projectId: project.id, tabId, url: `${base}/${tabId}` });
    await panel.waitFor((m) => m.type === "browser.state" && m.tabId === tabId && m.state.title === `Fane /${tabId}`);
  }
  // A real panel terminal changes directory and exports a variable. run_command must not inherit either.
  panel.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const terminal = await panel.waitFor((m) => m.type === "terminal.opened");
  assert.equal(terminal.type, "terminal.opened");
  panel.send({ type: "terminal.input", terminalId: terminal.terminalId, data: "export AD_PANEL_PROBE=panelverdi\ncd undermappe\nprintf 'PANEL_%s\\n' KLAR\n" });
  await until(() => panel.received.some((m) => m.type === "terminal.output" && m.data.includes("PANEL_KLAR")), "panelterminalen er klar");

  const calls: Array<[string, Record<string, unknown>]> = [
    ["read_file", { path: "notat.txt" }],
    ["edit_file", { path: "notat.txt", old_string: "før", new_string: "etter" }],
    ["run_command", { command: "printf 'MAPPE=%s\\nVAR=%s\\n' \"$PWD\" \"${AD_PANEL_PROBE-fravaerende}\"" }],
    ["browser_navigate", { url: `${base}/egen` }],
    ["browser_snapshot", {}],
    ["browser_click", { text: "Bytt" }],
    ["browser_snapshot", {}],
    ["browser_screenshot", {}],
  ];
  calls.forEach(([name, input], i) => llm.reply(sse(openaiToolCall(name, input, `panel-${i}`))));
  llm.reply(sse(openaiText("Kontrollert med lokale verktøy.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Kontroller prosjektfilene og åpne en egen fane." });
  const events = await h.finished(thread.id);
  const results = ofType(events, "tool.finished");
  assert.deepEqual(ofType(events, "tool.started").map((e) => e.tool), calls.map(([name]) => name));
  assert.ok(results.every((e) => e.status === "done"), JSON.stringify(results));
  assert.equal(readFileSync(path.join(project.path, "notat.txt"), "utf8"), "etter\n");
  assert.equal(results[2].result, `MAPPE=${project.path}\nVAR=fravaerende\n`);
  assert.match(results[4].result!, /Fane \/egen/);
  assert.match(results[6].result!, /button "Endret \/egen"/);
  assert.equal((await h.app.browser.screenshot(project.id, "en")).url, `${base}/en`, "the inactive panel tab stays on its own page");
  assert.ok(panel.received.some((m) => m.type === "browser.state" && m.tabId === "to" && m.state.title === "Fane /to"));
  const first = llm.requests[0].body;
  assert.ok(["read_file", "edit_file", "run_command", "browser_snapshot", "browser_screenshot"].every((name) => first.tools.some((tool: any) => tool.function.name === name)));
  assert.match(first.messages[0].content, /separate non-interactive bash/);
  assert.match(first.messages[0].content, /thread.*own tab/);
  const last = llm.requests.at(-1)!.body.messages;
  assert.ok(last.some((message: any) => Array.isArray(message.content) && message.content.some((block: any) => block.type === "image_url" && block.image_url.url.startsWith("data:image/png;base64,"))), "screenshot bytes reach the image-capable fake model");
});
