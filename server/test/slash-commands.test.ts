import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { CommandInfo } from "../../shared/protocol.ts";
import { visibleCommands } from "../../shared/slash-commands.ts";
import { hang, openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until } from "./helpers.ts";

test("the command catalog has unique names and aliases, with reserved skills still available", async (t) => {
  const userSkillsDir = tempDir(t);
  const dir = path.join(userSkillsDir, "help");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "SKILL.md"), "---\nname: help\ndescription: Tilpasset hjelp\n---\n{{args}}\n");
  const h = await startHarness(t, { userSkillsDir });
  const commands: CommandInfo[] = await h.api("GET", "/api/commands?mode=chat&includeReserved=1");
  const builtins = commands.filter((command) => command.kind === "builtin");
  const names = builtins.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
  assert.equal(new Set(names).size, names.length);
  for (const name of ["approve", "ide-context", "local"]) assert.ok(!names.includes(name));
  const scope = { code: false, project: false, chatProject: false };
  assert.equal(visibleCommands(builtins, scope).length, 45);
  assert.equal(visibleCommands(builtins, { ...scope, code: true }).length, 50);
  assert.equal(visibleCommands(builtins, { ...scope, code: true, project: true }).length, 62);
  assert.deepEqual(commands.filter((command) => command.name === "help").map((command) => [command.kind, command.slashReserved]), [
    ["builtin", undefined], ["skill", true],
  ]);
  const regular: CommandInfo[] = await h.api("GET", "/api/commands?mode=chat");
  assert.ok(!regular.some((command) => command.kind === "skill" && command.name === "help"));
  const thread = await h.api("POST", "/api/threads", { mode: "chat", title: "  Navngitt tråd  " });
  assert.equal(thread.title, "Navngitt tråd");
  assert.ok((await h.api("GET", "/api/bootstrap")).threads.some((entry: { id: string }) => entry.id === thread.id));
  await assert.rejects(h.api("POST", "/api/threads", { mode: "chat", title: "   " }), /400/);
});

test("run watch keeps returning the same run after the next queued message starts", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Local", model: "test", contextWindow: 64_000 });
  const thread = await h.thread(null, "chat", model.id);
  const base = `/api/threads/${thread.id}`;
  assert.deepEqual(await h.api("GET", `${base}/run-watch`), { run: null });
  const release = Promise.withResolvers<void>();
  t.after(() => release.resolve());
  llm.reply(async (request, response) => {
    await release.promise;
    await sse(openaiText("Første svar"))(request, response);
  });
  llm.reply(hang());
  await h.api("POST", `${base}/messages`, { text: "Første melding" });
  const { run: first } = await h.api("GET", `${base}/run-watch`);
  assert.equal(first.status, "running");
  await h.api("POST", `${base}/messages`, { text: "Neste melding", steer: false });
  release.resolve();
  await until(() => llm.requests.length === 2, "next queued model turn");
  const { run: second } = await h.api("GET", `${base}/run-watch`);
  assert.equal(second.status, "running");
  assert.notEqual(second.id, first.id);
  assert.deepEqual(await h.api("GET", `${base}/run-watch?run=${first.id}`), { run: { id: first.id, status: "done" } });
  const other = await h.thread(null, "chat");
  await assert.rejects(h.api("GET", `/api/threads/${other.id}/run-watch?run=${first.id}`), /404/);
  await h.api("POST", `${base}/stop`);
  assert.equal((await h.finished(thread.id, 2)).filter((event) => event.type === "run.finished").length, 2);
});

test("latest-only retry rejects a stale answer and keeps the selected Chat skill and raw arguments", async (t) => {
  const h = await startHarness(t, { appSkillsDir: path.resolve(import.meta.dirname, "../../skills") });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Local", model: "test", contextWindow: 64_000 });
  const thread = await h.thread(null, "chat", model.id);
  const base = `/api/threads/${thread.id}`;
  llm.reply(sse(openaiText("Første svar")));
  await h.api("POST", `${base}/messages`, { text: "Første melding" });
  const stale = ofType(await h.finished(thread.id), "text.delta")[0].messageId;
  const args = "  kilde A\n  kilde B $&";
  llm.reply(sse(openaiText("Andre svar")));
  await h.api("POST", `${base}/messages`, { text: args, skill: "source-brief" });
  const latest = ofType(await h.finished(thread.id, 2), "text.delta").at(-1)!.messageId;
  const before = await h.events(thread.id);
  await assert.rejects(h.api("POST", `${base}/rewind`, { messageId: stale, latestOnly: true }), /409/);
  assert.deepEqual(await h.events(thread.id), before);
  assert.equal(llm.requests.length, 2);
  llm.reply(sse(openaiText("Nytt svar")));
  await h.api("POST", `${base}/rewind`, { messageId: latest, latestOnly: true });
  const events = await h.finished(thread.id, 2);
  assert.deepEqual(ofType(events, "text.delta").map((event) => event.text), ["Første svar", "Nytt svar"]);
  assert.ok(llm.requests.at(-1)!.body.messages[0].content.includes(`# Answer a question from sources\n\n${args}`));
});
