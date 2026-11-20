// Round 6, agent E: the harness. Argument repair, forgiving edits, output limits, the new tools,
// the system prompt and the reminder to verify, against fake OpenAI-compatible and Anthropic servers.
import assert from "node:assert/strict";
import { readFileSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ThreadEvent } from "../../shared/protocol.ts";
import { coerceArgs, repairJson, resolveToolName } from "../src/agent/args.ts";
import { findEdit } from "../src/agent/edit.ts";
import { clip } from "../src/agent/tools.ts";
import { parseToolInput } from "../src/providers/http.ts";
import { anthropicEvents, OPENAI_DONE, openaiChunk, openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, until, type Harness } from "./helpers.ts";

async function fakeModel(h: Harness, llm: FakeLlm, options: Record<string, unknown> = {}): Promise<string> {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000, ...options });
  return model.id;
}

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });

// A tool call with raw argument text, the way a sloppy model sends it.
const rawCall = (name: string, args: string, id = "r1") =>
  openaiChunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }] }) + openaiChunk({}, "tool_calls") + OPENAI_DONE;

test("JSON repair: the usual mistakes are fixed, and broken JSON is still refused", () => {
  assert.deepEqual(repairJson('```json\n{"path": "a.txt"}\n```'), { path: "a.txt" });
  assert.deepEqual(repairJson('{"path": "a.txt",}'), { path: "a.txt" });
  assert.deepEqual(repairJson("{'path': 'a.txt', 'replace_all': True}"), { path: "a.txt", replace_all: true });
  assert.deepEqual(repairJson('{path: "a.txt", limit: 5, x: None}'), { path: "a.txt", limit: 5, x: null });
  assert.deepEqual(repairJson(JSON.stringify(JSON.stringify({ path: "a.txt" }))), { path: "a.txt" });
  assert.deepEqual(repairJson('Here you go: {"path": "a.txt"} hope it helps'), { path: "a.txt" });
  assert.deepEqual(repairJson('{"content": "linje 1\nlinje 2"}'), { content: "linje 1\nlinje 2" }, "a raw newline inside a string");
  assert.deepEqual(repairJson(`{'text': 'han sa "hei"'}`), { text: 'han sa "hei"' });
  assert.equal(repairJson('{"pa'), undefined);
  assert.equal(repairJson("[1, 2]"), undefined);
  assert.match(parseToolInput('{"pa').parseError!, /ikke gyldig JSON.*Du sendte: \{"pa/);
  assert.deepEqual(parseToolInput("{'path': 'x',}"), { input: { path: "x" } });
});

test("argument types follow the schema, and tool names are forgiven", () => {
  const schema = {
    properties: { offset: { type: "integer" }, all: { type: "boolean" }, name: { type: "string" }, steps: { type: "array", items: { type: "object", properties: { n: { type: "integer" } } } } },
  };
  assert.deepEqual(coerceArgs({ offset: "10", all: "true", name: 5, steps: '[{"n": "2"}]' }, schema), { offset: 10, all: true, name: "5", steps: [{ n: 2 }] });
  assert.deepEqual(coerceArgs({ offset: "ti" }, schema), { offset: "ti" }, "not a number: left for the tool to refuse");
  const names = ["read_file", "edit_file"];
  assert.equal(resolveToolName("functions.read_file", names), "read_file");
  assert.equal(resolveToolName("Read-File", names), "read_file");
  assert.equal(resolveToolName("write", names), undefined);
});

test("edit matching: exact, unique, and forgiving about line numbers, indentation and line endings", () => {
  const file = "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 1;\n}\n";
  const twice = findEdit(file, "  return 1;", "  return 2;", false, "f.ts");
  assert.ok("error" in twice && /2 ganger.*linje 2, 6.*replace_all/s.test(twice.error), JSON.stringify(twice));
  const all = findEdit(file, "  return 1;", "  return 2;", true, "f.ts");
  assert.ok(!("error" in all) && all.after.split("return 2").length === 3);

  const numbered = findEdit(file, "5\tfunction b() {\n6\t  return 1;", "5\tfunction b() {\n6\t  return 3;", false, "f.ts");
  assert.ok(!("error" in numbered), JSON.stringify(numbered));
  assert.match(numbered.after, /function b\(\) \{\n  return 3;/);
  assert.match(numbered.note!, /Linjenumrene/);

  const indented = findEdit(file, "function b() {\nreturn 1;\n}", "function b() {\nreturn 4;\n}", false, "f.ts");
  assert.ok(!("error" in indented), JSON.stringify(indented));
  assert.match(indented.after, /function b\(\) \{\n {2}return 4;\n\}/, "new_string gets the file's indentation");

  const crlf = findEdit("a\r\nb\r\nc\r\n", "a\nb", "a\nB", false, "w.txt");
  assert.ok(!("error" in crlf));
  assert.equal(crlf.after, "a\r\nB\r\nc\r\n");

  const missing = findEdit(file, "function c() {\n  return 1;\n}", "x", false, "f.ts");
  assert.ok("error" in missing);
  assert.match(missing.error, /finnes ikke lenger i f\.ts/);
  assert.match(missing.error, /Mest lik tekst i filen \(linje \d+–\d+\):\n\d+\tfunction [ab]\(\)/);
});

test("long output keeps whole lines from both ends and says how many were left out", () => {
  const text = Array.from({ length: 5000 }, (_, i) => `linje ${i + 1}`).join("\n");
  const clipped = clip(text, 2000, 0.3);
  assert.ok(clipped.length <= 2100, `${clipped.length}`);
  assert.match(clipped, /^linje 1\n/);
  assert.match(clipped, /linje 5000$/);
  const omitted = Number(/\[… (\d+) linjer utelatt …\]/.exec(clipped)![1]);
  const kept = clipped.split("\n").filter((l) => l.startsWith("linje")).length;
  assert.equal(omitted + kept, 5000);
  assert.match(clip("x".repeat(100_000), 1000), /tegn utelatt/, "one enormous line is cut by characters");
});

test("bad JSON is repaired, names and types are forgiven, and invalid calls come back with what was expected", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "a.txt"), "en\nto\ntre\n");
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(rawCall("read_file", "{'path': 'a.txt', 'offset': '2',}", "a"))); // repaired, offset coerced
  llm.reply(sse(rawCall("functions.Read_File", '{"path": "a.txt"}', "b"))); // name forgiven
  llm.reply(sse(rawCall("grep", '{"pattern": "to"}', "c"))); // alias for search
  llm.reply(sse(openaiToolCall("finnes_ikke", {}, "d")));
  llm.reply(sse(rawCall("edit_file", '{"path": "a.txt"', "e"))); // cut off: not repairable
  llm.reply(sse(openaiToolCall("edit_file", { path: "a.txt" }, "f")));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "prøv");
  const events = await h.finished(thread.id);
  const done = ofType(events, "tool.finished");
  assert.deepEqual(done.map((r) => r.status), ["done", "done", "done", "error", "error", "error"]);
  assert.equal(done[0].result, "2\tto\n3\ttre");
  assert.equal(ofType(events, "tool.started")[1].tool, "read_file", "the UI sees the real name");
  assert.match(done[2].result!, /a\.txt:2:to/);
  assert.match(done[3].result!, /Ukjent verktøy: finnes_ikke\. Verktøyene du har: read_file, write_file/);
  assert.match(done[4].result!, /ikke gyldig JSON[\s\S]*Forventet for edit_file: \{ path: string, old_string: string, new_string: string, replace_all\?: boolean \}/);
  assert.match(done[5].result!, /Mangler påkrevde felt: old_string, new_string/);
  assert.match(done[5].result!, /3\. ugyldige verktøykall på rad/, "the third invalid call in a row says to step back");
  assert.equal(ofType(events, "run.finished")[0].status, "done");
});

test("Anthropic: tool input with a trailing comma is repaired and the tool runs", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "anthropic", name: "Fake A", baseUrl: llm.url, apiKey: "sk-ant-test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake A", model: "claude-fake", contextWindow: 100_000, thinking: false });
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "b.txt"), "hei\n");
  const thread = await h.thread(project.id, "code", model.id);
  llm.reply(sse(anthropicEvents([
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path": "b.txt",}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ])));
  llm.always(sse(anthropicEvents([
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ])));
  await send(h, thread.id, "les");
  const events = await h.finished(thread.id);
  const [result] = ofType(events, "tool.finished");
  assert.equal(result.status, "done");
  assert.equal(result.result, "1\thei");
  // The repaired input is what goes back to the API, as valid JSON.
  const second = llm.requests[1].body.messages as any[];
  assert.deepEqual(second.find((m) => m.role === "assistant").content.find((b: any) => b.type === "tool_use").input, { path: "b.txt" });
});

test("tool output is capped by lines, and to a share of a small context window", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const big = await fakeModel(h, llm);
  const small = await fakeModel(h, llm, { contextWindow: 8000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "lang.txt"), Array.from({ length: 6000 }, (_, i) => `rad ${i + 1}`).join("\n"));
  const command = "for i in $(seq 1 8000); do echo \"utdata $i\"; done";
  for (const [modelId, limit] of [[big, 30_100], [small, 6500]] as const) {
    const thread = await h.thread(project.id, "code", modelId);
    llm.reply(sse(openaiToolCall("run_command", { command }, "k")));
    llm.reply(sse(openaiToolCall("read_file", { path: "lang.txt" }, "l")));
    llm.reply(sse(openaiText("ferdig")));
    await send(h, thread.id, "kjør");
    const [run, read] = ofType(await h.finished(thread.id), "tool.finished");
    assert.ok(run.result!.length <= limit, `${run.result!.length} > ${limit}`);
    assert.match(run.result!, /\[… \d+ linjer utelatt …\]/);
    assert.match(run.result!, /utdata 8000/, "the end of command output is kept");
    assert.ok(read.result!.length <= limit, `${read.result!.length}`);
    assert.match(read.result!, /\[Viser linje 1–\d+ av 6000\. Les videre med offset: \d+\.\]$/);
  }
});

test("glob lists newest first, search has a files mode, update_plan fills the pinned plan, and reads run in parallel", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "ask" });
  mkdirSync(path.join(project.path, "src/deep"), { recursive: true });
  for (const [file, age] of [["src/gammel.ts", 3000], ["src/deep/ny.ts", 10], ["src/midt.ts", 1000], ["notat.md", 5]] as const) {
    writeFileSync(path.join(project.path, file), "export const x = 1;\n");
    const at = Date.now() / 1000 - age;
    utimesSync(path.join(project.path, file), at, at);
  }
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("glob", { pattern: "**/*.ts" }, "g")));
  llm.reply(sse(openaiToolCall("search", { pattern: "export", output: "files", glob: "*.ts" }, "s")));
  llm.reply(sse(openaiToolCall("update_plan", { steps: [{ step: "Les koden", status: "completed" }, { step: "Endre", status: "in_progress" }, { step: "Test", status: "pending" }] }, "p")));
  llm.reply(sse(openaiToolCall("update_plan", { steps: [{ step: "A", status: "in_progress" }, { step: "B", status: "in_progress" }] }, "p2")));
  // Two reads in one step.
  llm.reply(sse(
    openaiChunk({ role: "assistant", tool_calls: [
      { index: 0, id: "r1", type: "function", function: { name: "read_file", arguments: '{"path":"src/midt.ts"}' } },
      { index: 1, id: "r2", type: "function", function: { name: "read_file", arguments: '{"path":"notat.md"}' } },
    ] }) + openaiChunk({}, "tool_calls") + OPENAI_DONE,
  ));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "se");
  const events = await h.finished(thread.id);
  const done = ofType(events, "tool.finished");
  assert.equal(ofType(events, "approval.requested").length, 0, "all of these only read, so Spør asks nothing");
  assert.equal(done[0].result, ["src/deep/ny.ts", "src/midt.ts", "src/gammel.ts"].join("\n"));
  assert.deepEqual(done[1].result!.split("\n").sort(), ["src/deep/ny.ts", "src/gammel.ts", "src/midt.ts"]);
  assert.match(done[2].result!, /1 av 3 ferdig/);
  assert.match(done[3].result!, /Bare ett steg kan være in_progress/);
  assert.equal(done[3].status, "error");
  const after = (await h.api("GET", "/api/bootstrap")).threads.find((x: any) => x.id === thread.id);
  assert.equal(after.plan, "1. [x] Les koden\n2. [>] Endre\n3. [ ] Test");
  // Both results come back, in the order of the calls.
  const last = llm.requests.at(-1)!.body.messages as any[];
  const tools = last.filter((m) => m.role === "tool").slice(-2);
  assert.deepEqual(tools.map((m) => m.tool_call_id), ["r1", "r2"]);
  assert.equal(tools[0].content, "1\texport const x = 1;");
});

test("the system prompt has working rules, the project's checks and the top of the folder", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project();
  writeFileSync(path.join(project.path, "package.json"), JSON.stringify({ scripts: { test: "node --test", typecheck: "tsc", start: "node ." } }));
  mkdirSync(path.join(project.path, "src"));
  const thread = await h.thread(project.id, "code", modelId);
  llm.always(sse(openaiText("ok")));
  await send(h, thread.id, "hei");
  await h.finished(thread.id);
  const system = llm.requests[0].body.messages[0].content as string;
  assert.match(system, /# How to work/);
  assert.match(system, /Copy old_string exactly from read_file output/);
  assert.match(system, /Checks: `npm test`, `npm run typecheck`/);
  assert.match(system, /Top level of the folder: src\/ {2}package\.json/);
  const names = llm.requests[0].body.tools.map((x: any) => x.function.name);
  for (const name of ["glob", "update_plan", "remember", "forget", "propose_skill"]) assert.ok(names.includes(name), name);
});

test("after code changes with no check run, the model is reminded once to verify", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  writeFileSync(path.join(project.path, "package.json"), JSON.stringify({ scripts: { test: "node -e 0" } }));
  writeFileSync(path.join(project.path, "app.js"), "const x = 1;\n");
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("edit_file", { path: "app.js", old_string: "const x = 1;", new_string: "const x = 2;" }, "e")));
  llm.reply(sse(openaiText("Ferdig, x er 2.")));
  llm.reply(sse(openaiToolCall("run_command", { command: "npm test" }, "t")));
  llm.always(sse(openaiText("Testene går.")));
  await send(h, thread.id, "sett x til 2");
  const events = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  const reminder = JSON.stringify(llm.requests[2].body.messages.at(-1));
  assert.match(reminder, /Automatic reminder.*app\.js.*npm test/);
  assert.equal(llm.requests.length, 4, "one reminder, then the run ends");
  assert.equal(readFileSync(path.join(project.path, "app.js"), "utf8"), "const x = 2;\n");

  // Prose only, or a check already run: no reminder.
  writeFileSync(path.join(project.path, "LESMEG.md"), "# Hei\n");
  llm.reply(sse(openaiToolCall("edit_file", { path: "LESMEG.md", old_string: "# Hei", new_string: "# Hallo" }, "m")));
  llm.reply(sse(openaiText("Endret overskriften.")));
  const before = llm.requests.length;
  await send(h, thread.id, "endre overskriften");
  await h.finished(thread.id, 2);
  assert.equal(llm.requests.length - before, 2);
});

test("a tool call cut off by the output limit is not run, and the model gets another go", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiChunk({ role: "assistant", tool_calls: [{ index: 0, id: "w", type: "function", function: { name: "write_file", arguments: '{"path":"x.txt","content":"aaa' } }] }) + openaiChunk({}, "length") + OPENAI_DONE));
  llm.reply(sse(openaiToolCall("write_file", { path: "x.txt", content: "kort" }, "w2")));
  llm.always(sse(openaiText("ferdig")));
  await send(h, thread.id, "skriv");
  const events: ThreadEvent[] = await h.finished(thread.id);
  assert.equal(ofType(events, "run.finished")[0].status, "done");
  assert.match(JSON.stringify(llm.requests[1].body.messages), /grensen for utdata.*mindre biter/);
  await until(() => readFileSync(path.join(project.path, "x.txt"), "utf8") === "kort", "the second write");
});
