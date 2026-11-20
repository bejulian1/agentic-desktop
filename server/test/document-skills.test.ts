import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import Excel from "exceljs";
import { sharedSkills } from "./bundled-skill-catalog.ts";
import { discoverSkills, loadSkillBody } from "../src/skills.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir } from "./helpers.ts";

const appSkillsDir = path.resolve(import.meta.dirname, "../../skills");
const names = ["data-files", "excel", "powerpoint", "word"];

test("document skills are discoverable in both modes and bodies stay out of the initial Chat context", async (t) => {
  const h = await startHarness(t, { appSkillsDir });
  const chat = await h.thread(null, "chat");
  const thread = h.app.store.thread(chat.id)!;
  assert.deepEqual(h.app.runner.chatSkills().map((s) => s.name), sharedSkills);
  for (const skill of discoverSkills(null, null, [], appSkillsDir).filter((s) => names.includes(s.name))) {
    assert.equal(skill.mode, undefined);
    assert.ok(loadSkillBody(skill).includes("{{args}}"));
  }
  const layers = h.app.runner.systemLayers(thread, undefined, []);
  const context = layers.map((l) => l.text).join("\n");
  assert.match(context, /use_skill/);
  for (const name of names) assert.match(context, new RegExp(`- ${name}:`));
  assert.doesNotMatch(context, /<skill name=|# Excel|# Word|# PowerPoint/);
  const tools = h.app.runner.toolDefs(thread, undefined, []);
  assert.ok(tools.some((tool) => tool.name === "use_skill"));
  assert.ok(!tools.some((tool) => ["read_file", "write_file", "run_command"].includes(tool.name)));
  const project = await h.project();
  const code = await h.thread(project.id, "code");
  const codeLayers = h.app.runner.systemLayers(h.app.store.thread(code.id)!, h.app.store.project(project.id), h.app.runner.skillsFor(h.app.store.project(project.id)));
  for (const name of names) assert.match(codeLayers.find((l) => l.id === "skills")!.text, new RegExp(`- ${name}:`));
});

test("Chat loads a skill then creates a genuine multi-sheet Excel file with typed cells and formula cache", async (t) => {
  const h = await startHarness(t, { appSkillsDir });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Local", model: "test", contextWindow: 64000 });
  const thread = await h.thread(null, "chat", model.id);
  llm.reply(sse(openaiToolCall("use_skill", { name: "excel" }, "load-excel")));
  llm.reply(sse(openaiToolCall("create_document", { name: "budget.xlsx", sheets: [
    { name: "Budsjett", headers: ["Post", "Beløp"], rows: [["Utstyr", 12], ["Lisens", 30], ["Totalt", { formula: "SUM(B2:B3)", result: 42 }]] },
    { name: "Forutsetninger", headers: ["Valuta", "År"], rows: [["NOK", 2026]] },
  ] }, "create-excel")));
  llm.reply(sse(openaiText("Filen er klar.")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Lag et Excel-budsjett med to ark og summeringsformel." });
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "tool.started").map((e) => e.tool), ["use_skill", "create_document"]);
  const loaded = ofType(events, "tool.finished").find((e) => e.callId === "load-excel")!;
  assert.equal(loaded.status, "done");
  assert.match(loaded.result ?? "", /<skill name="excel">/);
  assert.ok(JSON.stringify(llm.requests[1].body.messages).includes('<skill name=\\"excel\\">'));
  const file = ofType(events, "tool.finished").flatMap((e) => e.files ?? [])[0];
  const data = Buffer.from(await (await fetch(h.origin + file.url, { headers: { cookie: h.cookie } })).arrayBuffer());
  const book = new Excel.Workbook();
  await book.xlsx.load(data as any);
  assert.deepEqual(book.worksheets.map((s) => s.name), ["Budsjett", "Forutsetninger"]);
  assert.equal(book.getWorksheet("Budsjett")!.getCell("B2").value, 12);
  assert.deepEqual(book.getWorksheet("Budsjett")!.getCell("B4").value, { formula: "SUM(B2:B3)", result: 42 });
  assert.equal((await h.raw("GET", file.url)).status, 200);
});

test("Chat projects load built-in skills while excluding user overrides, other projects and Code skills", async (t) => {
  const userSkillsDir = tempDir(t);
  for (const name of ["excel", "private-chat"]) {
    mkdirSync(path.join(userSkillsDir, name));
    writeFileSync(path.join(userSkillsDir, name, "SKILL.md"), `---\nname: ${name}\ndescription: USER_PRIVATE_MARKER\n---\nUSER_PRIVATE_BODY`);
  }
  const h = await startHarness(t, { appSkillsDir, userSkillsDir });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Local", model: "test", contextWindow: 64000 });
  const project = await h.api("POST", "/api/chat-projects", { name: "Rapporter", instructions: "PROJECT_INSTRUCTIONS" });
  const thread = await h.api("POST", "/api/threads", { mode: "chat", modelId: model.id, chatProjectId: project.id });
  llm.reply(sse(openaiToolCall("use_skill", { name: "excel" }, "load")));
  llm.reply(sse(openaiToolCall("use_skill", { name: "debug" }, "blocked")));
  llm.reply(sse(openaiText("Svar")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Lag budsjett." });
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "tool.finished").find((e) => e.callId === "load")!.status, "done");
  assert.equal(ofType(events, "tool.finished").find((e) => e.callId === "blocked")!.status, "error");
  assert.match(llm.requests[0].body.messages[0].content, /PROJECT_INSTRUCTIONS/);
  assert.doesNotMatch(JSON.stringify(llm.requests), /USER_PRIVATE/);
  const menu = await h.api("GET", "/api/commands?mode=chat&scope=project");
  assert.deepEqual(menu.filter((c: any) => c.kind === "skill").map((c: any) => c.name), sharedSkills);
  llm.reply(sse(openaiText("Eksplisitt skill")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Lag et notat", skill: "data-files" });
  await h.finished(thread.id, 2);
  assert.match(llm.requests.at(-1)!.body.messages[0].content, /<skill name="data-files">/);
  assert.equal((await h.raw("POST", `/api/threads/${thread.id}/messages`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x", skill: "private-chat" }) })).status, 400);
});

test("skill loading does not enable disabled document/Python tools and honours disabled skills", async (t) => {
  const h = await startHarness(t, { appSkillsDir });
  const thread = await h.api("POST", "/api/threads", { mode: "chat", chatTools: { documents: false, python: false } });
  const tools = h.app.runner.toolDefs(h.app.store.thread(thread.id)!, undefined, []).map((t) => t.name);
  assert.ok(tools.includes("use_skill"));
  assert.ok(!tools.includes("create_document") && !tools.includes("run_python"));
  h.app.store.updateSettings({ disabledSkills: [path.join(appSkillsDir, "excel")] });
  assert.ok(!h.app.runner.chatSkills().some((s) => s.name === "excel"));
  assert.ok(!(await h.api("GET", "/api/commands?mode=chat")).some((c: any) => c.name === "excel"));
});

test("overrides apply within their own mode before resolving a shared app skill name", (t) => {
  const user = tempDir(t);
  mkdirSync(path.join(user, "excel"));
  writeFileSync(path.join(user, "excel", "SKILL.md"), "---\nname: excel\ndescription: Code override\nmode: code\n---\nCODE-ONLY");
  assert.equal(discoverSkills(null, user, [], appSkillsDir, "chat").find((s) => s.name === "excel")!.source, "app");
  assert.equal(discoverSkills(null, user, [], appSkillsDir, "code").find((s) => s.name === "excel")!.source, "user");
  writeFileSync(path.join(user, "excel", "SKILL.md"), "---\nname: excel\ndescription: Chat override\nmode: chat\n---\nCHAT-ONLY");
  assert.equal(discoverSkills(null, user, [], appSkillsDir, "chat").find((s) => s.name === "excel")!.source, "user");
  assert.equal(discoverSkills(null, user, [], appSkillsDir, "code").find((s) => s.name === "excel")!.source, "app");
});

test("explicit Chat skill selection uses the eligible built-in before a Code-only user override", async (t) => {
  const userSkillsDir = tempDir(t);
  mkdirSync(path.join(userSkillsDir, "excel"));
  writeFileSync(path.join(userSkillsDir, "excel", "SKILL.md"), "---\nname: excel\ndescription: Code override\nmode: code\n---\nCODE-ONLY");
  const h = await startHarness(t, { appSkillsDir, userSkillsDir });
  const thread = await h.thread(null, "chat");
  assert.doesNotThrow(() => h.app.runner.prepareSend(thread.id, { text: "Lag budsjett", skill: "excel" }));
  const project = await h.project();
  writeFileSync(path.join(userSkillsDir, "excel", "SKILL.md"), "---\nname: excel\ndescription: Chat override\nmode: chat\n---\nCHAT-ONLY");
  const commands = await h.api("GET", `/api/projects/${project.id}/commands`);
  assert.equal(commands.find((c: any) => c.name === "excel").source, "app");
});
