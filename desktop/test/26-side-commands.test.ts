import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { openaiText } from "../../server/test/fake-llm.ts";
import { alive, assertOffScreen, descendants, PACKAGED, sandbox, waitFor } from "./helpers.ts";

test("pakket app kjører transient btw og separat bakgrunn uten å endre kildehistorikken", async () => {
  assertOffScreen();
  const box = sandbox(), env = { ...box.env };
  delete env.AD_WEB_DIST;
  const requests: any[] = [];
  const fake = http.createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => text += chunk);
    req.on("end", () => {
      requests.push(JSON.parse(text));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(openaiText(JSON.stringify(requests.at(-1)).includes("conversationSnapshot") ? "Et kort sidesvar." : "Vanlig svar."));
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
    const info = await api("GET", "/api/bootstrap");
    // The packaged app reports the version and build it was packaged from.
    const packaged = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../version.json"), "utf8"));
    assert.equal(info.build.version, packaged.version);
    assert.equal(info.build.build, packaged.build);
    const catalog = await api("GET", "/api/commands?mode=chat");
    for (const name of ["btw", "background", "queue", "steer"]) assert.ok(catalog.some((c: any) => c.name === name));
    const provider = await api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokalt", baseUrl: `http://127.0.0.1:${(fake.address() as any).port}/v1` });
    const model = await api("POST", "/api/models", { providerId: provider.id, name: "Side-test", model: "fake", contextWindow: 64000 });
    const thread = await api("POST", "/api/threads", { mode: "chat", modelId: model.id });
    await api("POST", `/api/threads/${thread.id}/messages`, { text: "Forklar bakgrunnsarbeid." });
    await waitFor(async () => (await api("GET", `/api/threads/${thread.id}/events`)).some((e: any) => e.event.type === "run.finished"), "kilden ferdig");
    const before = await api("GET", `/api/threads/${thread.id}/events`);
    const side = await page.evaluate(async (id) => {
      const response = await fetch(`/api/threads/${id}/btw`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({question:"Hva betyr uavhengig?",clientId:"packaged-side"})});
      return { status:response.status, cache:response.headers.get("cache-control"), events:(await response.text()).trim().split("\n").map(line=>JSON.parse(line)) };
    }, thread.id);
    assert.equal(side.status, 200); assert.equal(side.cache, "no-store");
    assert.ok(side.events.some((e: any) => e.type === "text" && e.text === "Et kort sidesvar."));
    assert.equal(side.events.at(-1).type, "done");
    const sideRequest = requests.find((r: any) => JSON.stringify(r).includes("conversationSnapshot"));
    assert.ok(sideRequest); assert.equal((sideRequest.tools ?? []).length, 0);
    assert.deepEqual(await api("GET", `/api/threads/${thread.id}/events`), before);
    const result = await api("POST", `/api/threads/${thread.id}/background`, { text: "Gi et eget sammendrag." });
    assert.notEqual(result.thread.id, thread.id); assert.equal(result.thread.forkedFrom.background, true);
    await waitFor(async () => (await api("GET", `/api/threads/${result.thread.id}/events`)).some((e: any) => e.event.type === "run.finished"), "bakgrunn ferdig");
    assert.deepEqual(await api("GET", `/api/threads/${thread.id}/events`), before);

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
