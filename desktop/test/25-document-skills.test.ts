import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { openaiText, openaiToolCall } from "../../server/test/fake-llm.ts";
import { alive, assertOffScreen, descendants, PACKAGED, sandbox, waitFor } from "./helpers.ts";

test("pakket Chat laster innebygd Excel-skill og lager nedlastbar Office-fil", async () => {
  assertOffScreen();
  const box = sandbox(), env = { ...box.env };
  delete env.AD_WEB_DIST;
  let count = 0;
  const requests: any[] = [];
  const fake = http.createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => text += chunk);
    req.on("end", () => {
      requests.push(JSON.parse(text));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(count++ === 0 ? openaiToolCall("use_skill", { name: "excel" }, "skill")
        : count === 2 ? openaiToolCall("create_document", { name: "pakket.xlsx", sheets: [{ name: "Data", headers: ["Verdi"], rows: [[42]] }] }, "file")
        : openaiText("Regnearket er klart."));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const child = spawn(PACKAGED, ["--ozone-platform=headless", "--ozone-override-screen-size=1600,1000", "--remote-debugging-port=0"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", tree: number[] = [];
  child.stdout!.on("data", (chunk) => out += chunk);
  child.stderr!.on("data", (chunk) => out += chunk);
  const pid = child.pid!;
  try {
    await waitFor(() => out.includes("Agentic Desktop er klar."), "pakket app lastet", 60000);
    tree = descendants(pid);
    const instance = JSON.parse(readFileSync(path.join(box.dataDir, "instance.json"), "utf8"));
    const port = Number(readFileSync(path.join(box.dataDir, "electron/DevToolsActivePort"), "utf8").split("\n")[0]);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(`http://127.0.0.1:${instance.port}/`))!;
    const api = (method: string, url: string, body?: unknown) => page.evaluate(async ({ method, url, body }) => {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    }, { method, url, body });
    const catalog = await api("GET", "/api/commands?mode=chat");
    assert.deepEqual(catalog.filter((c: any) => c.kind === "skill").map((c: any) => c.name), ["action-items", "analyze-data", "data-files", "excel", "powerpoint", "source-brief", "word"]);
    const provider = await api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokalt", baseUrl: `http://127.0.0.1:${(fake.address() as any).port}/v1` });
    const model = await api("POST", "/api/models", { providerId: provider.id, name: "Skill-test", model: "fake", contextWindow: 64000 });
    const thread = await api("POST", "/api/threads", { mode: "chat", modelId: model.id });
    await api("POST", `/api/threads/${thread.id}/messages`, { text: "Lag et Excel-regneark." });
    await waitFor(async () => (await api("GET", `/api/threads/${thread.id}/events`)).some((e: any) => e.event.type === "run.finished"), "skill og fil ferdig");
    assert.match(requests[0].messages[0].content, /- excel:/);
    assert.ok(requests[0].tools.some((t: any) => t.function.name === "use_skill"));
    assert.ok(JSON.stringify(requests[1].messages).includes('<skill name=\\"excel\\">'));
    const { files } = await api("GET", `/api/chat-files/${thread.id}`);
    assert.equal(files[0].name, "pakket.xlsx");
    const result = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer()).slice(0, 2)) };
    }, files[0].url);
    assert.deepEqual(result, { status: 200, bytes: [80, 75] });
  } finally {
    fake.closeAllConnections();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
    if (alive(pid)) {
      tree = [...new Set([...tree, ...descendants(pid)])];
      const exited = new Promise((resolve) => child.once("exit", resolve));
      process.kill(pid, "SIGTERM");
      await exited;
      await waitFor(() => [pid, ...tree].every((p) => !alive(p)), "pakket app stoppet", 15000);
    }
    box.cleanup();
  }
});
