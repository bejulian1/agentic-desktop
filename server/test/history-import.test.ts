import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Bootstrap } from "../../shared/protocol.ts";
import type { HistoryImportResult, HistoryScan } from "../../shared/history-import.ts";
import { rawRequest, startHarness, tempDir } from "./helpers.ts";

const time = "2025-06-01T12:00:00Z";
const later = "2025-06-01T12:05:00Z";

function jsonl(root: string, relative: string, records: unknown[]): string {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, records.map((record) => typeof record === "string" ? record : JSON.stringify(record)).join("\n") + "\n");
  return file;
}

const claudeUser = (cwd: string, id: string, text: string) => ({
  type: "user", cwd, sessionId: id, timestamp: time, message: { role: "user", content: text },
});

const codexMeta = (cwd: string, id: string) => ({
  type: "session_meta", timestamp: time, payload: { id, cwd, timestamp: time },
});

test("scans and imports Claude Code and Codex history once, with local paths and original event times", async (t) => {
  const home = tempDir(t);
  const folder = tempDir(t);
  const otherFolder = tempDir(t);
  const claudeFile = jsonl(home, ".claude/projects/encoded/session-claude.jsonl", [
    "{broken",
    claudeUser(folder, "claude-demo", "Finn oversikten"),
    { type: "summary", summary: "Plan for prosjektet", leafUuid: "record-1" },
    { type: "assistant", cwd: folder, sessionId: "claude-demo", timestamp: later, message: { role: "assistant", content: [
      { type: "text", text: "Oversikten er klar." },
      { type: "tool_use", id: "call-one", name: "Read", input: { file_path: "guide.md" } },
    ] } },
    { type: "user", cwd: folder, sessionId: "claude-demo", timestamp: later, message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "call-one", content: "Kapittel én\nEn linje til" },
    ] } },
  ]);
  jsonl(home, ".claude/projects/missing/missing.jsonl", [claudeUser(path.join(home, "gone"), "missing", "Borte")]);
  const codexFile = jsonl(home, ".codex/sessions/2025/06/01/rollout-one.jsonl", [
    codexMeta(folder, "codex-demo"),
    { type: "response_item", timestamp: time, payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "Ikke en brukermelding" }] } },
    { type: "event_msg", timestamp: time, payload: { type: "user_message", message: "Fortell om prosjektet" } },
    { type: "response_item", timestamp: time, payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fortell om prosjektet" }] } },
    { type: "response_item", timestamp: later, payload: { type: "function_call", name: "exec_command", call_id: "two", arguments: JSON.stringify({ cmd: ["git", "status"] }) } },
    { type: "response_item", timestamp: later, payload: { type: "function_call_output", call_id: "two", output: { output: "Funnet\nEn linje til" } } },
    { type: "event_msg", timestamp: later, payload: { type: "agent_message", message: "Det var alt." } },
  ]);
  jsonl(home, ".codex/sessions/2025/06/01/rollout-two.jsonl", [
    codexMeta(otherFolder, "codex-other"),
    { type: "event_msg", timestamp: time, payload: { type: "user_message", message: "Et annet prosjekt" } },
  ]);
  const large = jsonl(home, ".codex/sessions/2025/06/01/rollout-large.jsonl", []);
  truncateSync(large, 8 * 1024 * 1024 + 1);

  const app = await startHarness(t, { homeDir: home });
  const existing = await app.project(folder, { name: "Eget prosjektnavn" });
  const before = [readFileSync(claudeFile), readFileSync(codexFile)];
  const snapshot = () => app.api<Bootstrap>("GET", "/api/bootstrap");
  assert.deepEqual((await snapshot()).threads, []);
  assert.equal((await rawRequest(app.app.port, "POST", "/api/history-import/scan", { headers: { origin: app.origin } })).status, 401);
  const found = await app.api<HistoryScan>("POST", "/api/history-import/scan");
  assert.equal(found.files, 5);
  assert.equal(found.limited, true);
  assert.equal(found.invalidLines, 1);
  assert.equal(found.skippedFiles, 1);
  assert.equal(found.missingFolders, 1);
  assert.equal(found.projects.length, 2);
  const byFolder = found.projects.find((p) => p.path === folder)!;
  assert.deepEqual(byFolder.threads.map((s) => [s.source, s.title]), [
    ["claude", "Plan for prosjektet"], ["codex", "Fortell om prosjektet"],
  ]);
  assert.equal(byFolder.updatedAt, Date.parse(later));
  assert.deepEqual((await snapshot()).threads, [], "scanning is read-only");

  const payload = { scanId: found.id, threads: found.projects.flatMap((p) => p.threads.map((s) => s.id)) };
  await assert.rejects(app.api("POST", "/api/history-import", { ...payload, threads: [claudeFile] }), { status: 400 });
  assert.deepEqual(await app.api<HistoryImportResult>("POST", "/api/history-import", payload), {
    projectsCreated: 1, projectsReused: 1, threadsImported: 3, threadsSkipped: 0, problems: 0,
  });
  assert.deepEqual(await app.api<HistoryImportResult>("POST", "/api/history-import", payload), {
    projectsCreated: 0, projectsReused: 2, threadsImported: 0, threadsSkipped: 3, problems: 0,
  });
  const second = await app.api<HistoryScan>("POST", "/api/history-import/scan");
  assert.ok(second.projects.every((project) => project.threads.every((thread) => thread.imported)));
  const boot = await snapshot();
  const codex = boot.threads.find((thread) => thread.title === "Fortell om prosjektet")!;
  const claude = boot.threads.find((thread) => thread.importedFrom?.source === "claude")!;
  assert.equal(boot.projects.length, 2);
  assert.equal(boot.threads.length, 3);
  assert.equal(claude.projectId, existing.id);
  assert.equal(codex.projectId, existing.id);
  assert.equal(codex.mode, "code");
  assert.equal(codex.createdAt, Date.parse(time));
  assert.equal(codex.updatedAt, Date.parse(later));
  assert.ok(codex.importedFrom?.importedAt);
  assert.deepEqual((await app.events(claude.id)).map(({ at, event }) => [at, event.type]), [
    [Date.parse(time), "user.message"],
    [Date.parse(later), "history.answer"],
    [Date.parse(later), "history.answer"],
    [Date.parse(later), "history.answer"],
  ]);
  const events = (await app.events(codex.id)).map(({ event }) => event);
  assert.equal(events.length, 4);
  assert.deepEqual(events.filter((event) => event.type === "history.answer").map((event) => event.note), [
    { kind: "call", tool: "exec_command", summary: "git status" },
    { kind: "result", tool: "exec_command", summary: "Funnet En linje til" },
    undefined,
  ]);
  const modelHistory = app.app.store.messages(codex.id);
  assert.deepEqual(modelHistory.map((message) => message.role), ["user", "assistant"]);
  assert.ok(modelHistory.every((message) => message.content.every((block) => block.type === "text")));
  assert.match(JSON.stringify(modelHistory), /Det var alt\./);
  await app.api("POST", `/api/threads/${codex.id}/messages`, { text: "hjelp" });
  const finished = await app.finished(codex.id);
  assert.equal(finished.findLast((event) => event.type === "run.finished")?.status, "done");
  assert.deepEqual([readFileSync(claudeFile), readFileSync(codexFile)], before);
});

test("does not follow symlinks or import a session replaced after review", async (t) => {
  const home = tempDir(t);
  const folder = tempDir(t);
  const outside = tempDir(t);
  const filename = ".claude/projects/example/valid.jsonl";
  const original = jsonl(home, filename, [claudeUser(folder, "original", "Opprinnelig")]);
  const external = jsonl(outside, "other.jsonl", [claudeUser(folder, "outside-home", "Skjult")]);
  symlinkSync(external, path.join(path.dirname(original), "linked.jsonl"));
  symlinkSync(outside, path.join(home, ".claude/projects/linked-folder"));
  const app = await startHarness(t, { homeDir: home });
  const scan = () => app.api<HistoryScan>("POST", "/api/history-import/scan");
  const found = await scan();
  assert.deepEqual(found.projects.flatMap((project) => project.threads.map((thread) => thread.title)), ["Opprinnelig"]);
  assert.equal(found.skippedFiles, 2);
  renameSync(original, original + ".backup");
  symlinkSync(external, original);
  const apply = (preview: HistoryScan) => app.api<HistoryImportResult>("POST", "/api/history-import", {
    scanId: preview.id, threads: [preview.projects[0].threads[0].id],
  });
  assert.equal((await apply(found)).problems, 1);
  const boot = await app.api<Bootstrap>("GET", "/api/bootstrap");
  assert.deepEqual([boot.projects, boot.threads], [[], []]);

  const other = jsonl(home, ".claude/projects/example/changed.jsonl", [claudeUser(folder, "unchanged", "Utkast")]);
  const second = await scan();
  writeFileSync(other, JSON.stringify(claudeUser(folder, "changed", "En annen tråd")));
  assert.equal((await apply(second)).problems, 1);
});

test("imports the active Pi branch and Gemini history, including legacy sessions", async (t) => {
  const home = tempDir(t);
  const folder = tempDir(t);
  jsonl(home, ".pi/agent/sessions/encoded/example.jsonl", [
    { type: "session", id: "pi-session-1", cwd: folder, timestamp: time, version: 3 },
    { type: "message", id: "question", parentId: null, timestamp: time, message: { role: "user", content: "Hvilken gren?" } },
    { type: "message", id: "old", parentId: "question", timestamp: later, message: { role: "assistant", content: [{ type: "text", text: "Gammel gren" }] } },
    { type: "message", id: "new", parentId: "question", timestamp: later, message: { role: "assistant", content: [{ type: "text", text: "Aktiv gren" }] } },
    { type: "context_edit", id: "edit", parentId: "new", timestamp: later, targetId: "new", replacement: { content: "Redigert gren" } },
    { type: "session_info", id: "name", parentId: "edit", timestamp: later, name: "En aktiv Pi-tråd" },
  ]);
  const geminiProject = path.join(home, ".gemini/tmp/example");
  const chats = path.join(geminiProject, "chats");
  mkdirSync(chats, { recursive: true });
  writeFileSync(path.join(geminiProject, ".project_root"), folder + "\n");
  const question = { id: "q", type: "user", timestamp: time, content: [{ text: "Et Gemini-spørsmål" }] };
  jsonl(chats, "session-latest.jsonl", [
    { sessionId: "gemini-session-1", projectHash: "project-id", startTime: time },
    question,
    { id: "abandoned", type: "gemini", timestamp: later, content: [{ text: "Forkastet svar" }] },
    { $rewindTo: "abandoned" },
    { id: "answer", type: "gemini", timestamp: later, content: [{ text: "Før redigering" }] },
    { id: "intro", type: "gemini", timestamp: later, content: [{ text: "Innledning." }] },
    { $patch: { id: "answer", content: [{ text: "Et redigert svar" }], orderIds: ["intro", "answer"] } },
  ]);
  writeFileSync(path.join(chats, "session-legacy.json"), JSON.stringify({
    sessionId: "gemini-session-2", startTime: time, projectHash: "project-id", messages: [{ ...question, content: "Et eldre Gemini-spørsmål" }],
  }, null, 2));
  const h = await startHarness(t, { homeDir: home });
  const preview = await h.api<HistoryScan>("POST", "/api/history-import/scan");
  assert.equal(preview.projects.length, 1);
  const [{ threads }] = preview.projects;
  assert.equal(threads.length, 3);
  const result = await h.api<HistoryImportResult>("POST", "/api/history-import", { scanId: preview.id, threads: threads.map((thread) => thread.id) });
  assert.equal(result.threadsImported, 3);
  const texts = h.app.store.threads().map((thread) => [thread.title, h.app.store.messages(thread.id).flatMap((message) => message.content).map((block) => block.type === "text" ? block.text : "")]);
  assert.deepEqual(Object.fromEntries(texts), {
    "En aktiv Pi-tråd": ["Hvilken gren?", "Redigert gren"],
    "Et Gemini-spørsmål": ["Et Gemini-spørsmål", "Innledning.\n\nEt redigert svar"],
    "Et eldre Gemini-spørsmål": ["Et eldre Gemini-spørsmål"],
  });
});
