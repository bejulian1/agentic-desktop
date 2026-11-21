import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, rawRequest, startHarness, tempDir, until } from "./helpers.ts";
import type { ChatMemoryReview, Thread } from "../../shared/protocol.ts";

async function setup(t: TestContext) {
  const h = await startHarness(t, { homeDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Test", baseUrl: `${llm.url}/v1`, apiKey: "test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Test", model: "fake", contextWindow: 50_000 });
  llm.always(sse(openaiText("Notert")));
  return { h, llm, model };
}

const reviewPath = (id: string) => `/api/threads/${id}/memory-proposals`;

test("rettelser overlever omstart, mens selve minnet først endres etter en godkjenning", async (t) => {
  const dataDir = tempDir(t);
  const configDir = path.join(dataDir, "config");
  const first = await startHarness(t, { dataDir, configDir });
  await first.api("PUT", "/api/chat-personal", { memories: true, autoMemory: true });
  await first.api("POST", "/api/chat-personal/memories", { text: "Bruk npm" });
  const thread = await first.thread(null, "chat");
  await first.api("POST", `/api/threads/${thread.id}/messages`, { text: "Nei, bruk pnpm i app.config.js." });
  await first.finished(thread.id);
  assert.equal((await first.api("GET", "/api/chat-personal")).memories[0].text, "Bruk npm");
  await first.app.close();
  const h = await startHarness(t, { dataDir, configDir });
  const { proposals } = await h.api<ChatMemoryReview>("GET", reviewPath(thread.id));
  assert.equal(proposals[0].text, "bruk pnpm i app.config.js");
  assert.equal(proposals[0].previousText, "Bruk npm");
  const url = `${reviewPath(thread.id)}/${proposals[0].id}`;
  const payload = { action: "apply", text: "Bruk pnpm", previousId: proposals[0].previousId, previousText: proposals[0].previousText };
  assert.equal((await rawRequest(h.app.port, "POST", url, { headers: { origin: h.origin } })).status, 401);
  await h.api("POST", url, payload);
  assert.deepEqual((await h.api("GET", "/api/chat-personal")).memories.map((item: any) => item.text), ["Bruk pnpm"]);
  await assert.rejects(h.api("POST", url, payload), { status: 409 });
});

test("Chat-prosjekt avviser overskriving etter en annen redigering og gamle forslag etter områdebytte", async (t) => {
  const { h, model } = await setup(t);
  const project = await h.api("POST", "/api/chat-projects", { name: "Testområde", autoMemory: true });
  const other = await h.api("POST", "/api/chat-projects", { name: "Annet område", autoMemory: true });
  const thread = await h.api<Thread>("POST", "/api/threads", { mode: "chat", chatProjectId: project.id, modelId: model.id });
  const memoryPath = `/api/chat-projects/${project.id}/memories`;
  const old = await h.api("POST", memoryPath, { text: "Bruk npm", memoryMode: "project" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Nei, bruk pnpm." });
  await h.finished(thread.id);
  const proposal = (await h.api<ChatMemoryReview>("GET", reviewPath(thread.id))).proposals[0];
  const changed = await h.api("PUT", `${memoryPath}/${old.id}`, { text: "Bruk yarn", memoryMode: "project" });
  const url = `${reviewPath(thread.id)}/${proposal.id}`;
  await assert.rejects(h.api("POST", url, { action: "apply", text: "Bruk pnpm", previousId: proposal.previousId, previousText: proposal.previousText }), { status: 409 });
  assert.equal((await h.api("GET", `${memoryPath}?memoryMode=project`)).items[0].id, changed.id);
  await h.api("PATCH", `/api/threads/${thread.id}`, { chatProjectId: other.id });
  await h.api("PATCH", `/api/threads/${thread.id}`, { chatProjectId: project.id });
  assert.deepEqual((await h.api<ChatMemoryReview>("GET", reviewPath(thread.id))).proposals, []);
  await assert.rejects(h.api("POST", url, { action: "dismiss" }), { status: 409 });
  assert.deepEqual((await h.api("GET", "/api/chat-personal")).memories, []);
});

test("modellsiterte rettelser forsvinner ved nyere styring, og Stop under en hook lagrer ingenting", async (t) => {
  const { h, llm, model } = await setup(t);
  await h.api("PUT", "/api/chat-personal", { memories: true, autoMemory: true });
  const thread = await h.thread(null, "chat", model.id);
  const messages = `/api/threads/${thread.id}/messages`;
  llm.reply(sse(openaiToolCall("propose_chat_memory", { text: "Bruk JSON", evidence: "Jeg trenger varig JSON" }, "proposal")));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  llm.reply(async (req, res) => { await gate; await sse(openaiText("Notert"))(req, res); });
  await h.api("POST", messages, { text: "Jeg trenger varig JSON" });
  try {
    await until(() => llm.requests.length === 2, "modellen har foreslått et minne");
    await h.api("POST", messages, { text: "Nei, bruk TOML.", steer: true });
  } finally { release(); }
  await h.finished(thread.id);
  const review = await h.api<ChatMemoryReview>("GET", reviewPath(thread.id));
  assert.deepEqual(review.proposals.map(({ text }) => text), ["bruk TOML"]);
  await h.api("POST", `${reviewPath(thread.id)}/${review.proposals[0].id}`, { action: "dismiss" });
  const marker = path.join(tempDir(t), "stop-hook");
  await h.api("POST", "/api/hooks", { event: "Stop", name: "Vent", modes: ["chat"], command: `touch '${marker}'; sleep 10` });
  await h.api("POST", messages, { text: "Nei, bruk XML." });
  await until(() => existsSync(marker), "Stop-hook er startet");
  await h.api("POST", `/api/threads/${thread.id}/stop`);
  const events = await h.finished(thread.id, 2);
  assert.equal(ofType(events, "run.finished").at(-1)?.status, "stopped");
  assert.deepEqual((await h.api<ChatMemoryReview>("GET", reviewPath(thread.id))).proposals, []);
});

for (const action of ["approve", "modify", "disable", "steer"] as const) {
  test(`skill-rettelse med godkjenning i Full tilgang: ${action}`, async (t) => {
    const { h, llm, model } = await setup(t);
    const project = await h.project(undefined, { permissionMode: "full" });
    const skill = await h.api("POST", "/api/skills", { scope: "project", projectId: project.id, name: "kontroll", description: "Utfør prosjektkontroller", body: "Kjør npm test.\nBehold denne linjen." });
    const file = path.join(project.path, ".agentic/skills/kontroll/SKILL.md");
    const earlier = readFileSync(file, "utf8");
    const thread = await h.thread(project.id, "code", model.id);
    const socket = await h.socket();
    socket.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 0 });
    llm.reply(sse(openaiToolCall("propose_skill_edit", { name: "kontroll", before: "Kjør npm test.", after: "Kjør npm run check." }, "edit")));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Rett skillens kontrollkommando" });
    const { envelope } = await socket.waitFor((message) => message.type === "thread.event" && message.envelope.event.type === "approval.requested") as any;
    assert.equal(envelope.event.canAllowAlways, false);
    assert.match(envelope.event.detail, /Før\nKjør npm test\.\n\nEtter\nKjør npm run check\./);
    assert.equal(readFileSync(file, "utf8"), earlier);
    if (action === "modify") await h.api("PUT", `/api/skills/${encodeURIComponent(skill.id)}`, { description: "Utfør prosjektkontroller", body: "Redigert utenfor agenten." });
    if (action === "disable") await h.api("PATCH", "/api/settings", { autoSkills: "off" });
    if (action === "steer") await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Ikke endre skillen", steer: true });
    await h.api("POST", `/api/approvals/${envelope.event.approvalId}`, { decision: "allow" });
    const events = await h.finished(thread.id);
    assert.equal(ofType(events, "tool.finished")[0].status, action === "approve" ? "done" : action === "modify" ? "error" : "denied");
    const after = readFileSync(file, "utf8");
    if (action === "modify") assert.match(after, /Redigert utenfor agenten\./);
    else assert.equal(after, action === "approve" ? earlier.replace("Kjør npm test.", "Kjør npm run check.") : earlier);
  });
}

test("en urelatert kommando kvitterer ikke ut en kjede av mislykkede kontroller", async (t) => {
  const { h, llm, model } = await setup(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "package.json"), JSON.stringify({ scripts: { lint: "exit 0", test: "exit 1" } }));
  const thread = await h.thread(project.id, "code", model.id);
  llm.reply(sse(openaiToolCall("write_file", { path: "sample.js", content: "export const number = 3;\n" }, "write")));
  llm.reply(sse(openaiToolCall("run_command", { command: "npm run lint && npm test" }, "failed")));
  llm.reply(sse(openaiToolCall("run_command", { command: "echo urelatert" }, "unrelated")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Endre og kontroller" });
  await h.finished(thread.id);
  assert.equal(llm.requests.length, 5);
  assert.match(llm.requests.at(-1)!.body.messages.at(-1).content, /Checks still failing: npm run lint && npm test/);
});
