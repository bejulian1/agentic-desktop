import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { documentedSkills, sharedSkills } from "./bundled-skill-catalog.ts";
import { copyAppSkills } from "../../scripts/skill-assets.ts";
import { discoverSkills, loadSkillBody, SkillChanges } from "../src/skills.ts";
import { httpError, openaiText, openaiToolCall, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until } from "./helpers.ts";

function skill(root: string, name: string, body: string, extra = ""): string {
  const file = path.join(root, name, "SKILL.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `---\nname: ${name}\ndescription: Gjennomgå ${name}\n${extra}---\n\n${body}\n`);
  return file;
}

async function setup(t: TestContext) {
  const appSkillsDir = tempDir(t);
  const userSkillsDir = tempDir(t);
  const h = await startHarness(t, { appSkillsDir, userSkillsDir });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "fake" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", model.id);
  return { h, llm, project, thread, appSkillsDir, userSkillsDir };
}

test("manual skills require an explicit selection, not a bare name", async (t) => {
  const { h, llm, project, thread } = await setup(t);
  skill(path.join(project.path, "skills"), "manual-check", "MANUAL-BODY", "disable-model-invocation: true\n");
  skill(path.join(project.path, "skills"), "ordinary-check", "ORDINARY-BODY");
  const examples = ["manual-check", "Bruk manual-check skill på denne endringen", "Review this change"];
  for (const [index, text] of examples.entries()) {
    llm.reply(sse(openaiText("OK")));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text });
    await h.finished(thread.id, index + 1);
    const prompt = llm.requests[index].body.messages[0].content;
    assert.equal(prompt.includes("MANUAL-BODY"), index === 1);
    assert.equal(prompt.includes("manual-check: Gjennomgå"), false);
    assert.ok(prompt.includes("ordinary-check: Gjennomgå"));
  }
  llm.reply(sse(openaiToolCall("use_skill", { name: "manual-check" }, "manual-load")));
  llm.reply(sse(openaiText("OK")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Review this change" });
  const attempt = ofType(await h.finished(thread.id, 4), "tool.finished").find((event) => event.callId === "manual-load");
  assert.ok(attempt);
  assert.notEqual(attempt.status, "done");
  assert.doesNotMatch(attempt.result ?? "", /MANUAL-BODY/);
  llm.reply(sse(openaiText("OK")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Review this change", skill: "manual-check" });
  await h.finished(thread.id, 5);
  assert.match(llm.requests.at(-1)!.body.messages[0].content, /MANUAL-BODY/);
});

test("slash skills use raw multiline arguments only in the current turn's system instruction, including retry", async (t) => {
  const { h, llm, project, thread } = await setup(t);
  skill(path.join(project.path, "skills"), "testskill", "ONLY-INSTRUCTION-BEGIN[{{args}}]ONLY-INSTRUCTION-END");
  const args = "  src/a.ts\nTa med src/b.ts og $& $$ $`  \n";
  llm.reply(httpError(500, { error: { message: "temporary" } }));
  llm.reply(sse(openaiText("Ferdig")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: args, skill: "testskill" });
  const events = await h.finished(thread.id);
  assert.equal(llm.requests.length, 2);
  for (const request of llm.requests) {
    const [system, ...history] = request.body.messages;
    assert.equal(system.role, "system");
    assert.ok(system.content.includes(`ONLY-INSTRUCTION-BEGIN[${args}]ONLY-INSTRUCTION-END`));
    assert.ok(!JSON.stringify(history).includes("ONLY-INSTRUCTION"));
    assert.equal(history.at(-1).content, `/testskill ${args}`);
  }
  assert.equal(ofType(events, "user.message")[0].text, `/testskill ${args}`);
  assert.ok(!JSON.stringify(h.app.store.messages(thread.id)).includes("ONLY-INSTRUCTION"));
  assert.ok(!JSON.stringify(events).includes("ONLY-INSTRUCTION"));

  llm.reply(sse(openaiText("Vanlig svar")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Neste tur" });
  await h.finished(thread.id, 2);
  assert.ok(!JSON.stringify(llm.requests.at(-1)!.body).includes("ONLY-INSTRUCTION"));

  llm.reply(sse(openaiText("Et kort sammendrag")));
  await h.api("POST", `/api/threads/${thread.id}/compact`, {});
  await h.finished(thread.id, 3);
  assert.ok(!JSON.stringify(llm.requests.at(-1)!.body).includes("ONLY-INSTRUCTION"));
});

test("steered and queued skills keep instruction snapshots scoped to their own running turn", async (t) => {
  const { h, llm, project, thread } = await setup(t);
  const root = path.join(project.path, "skills");
  skill(root, "steered", "STEER-BODY {{args}}");
  const queuedFile = skill(root, "queued", "QUEUE-BODY {{args}}");
  llm.reply(async (request, response) => {
    assert.ok(!JSON.stringify(request.body).includes("STEER-BODY"));
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "linje1\nlinje2", skill: "steered", steer: true });
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "køargument", skill: "queued", steer: false });
    writeFileSync(queuedFile, "---\nname: queued\ndescription: Endret\n---\nLATER-EDIT");
    await sse(openaiText("Første svar"))(request, response);
  });
  llm.reply(sse(openaiText("Styrt svar")));
  llm.reply(sse(openaiText("Svar fra køen")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Start" });
  const events = await h.finished(thread.id, 2);
  assert.equal(ofType(events, "run.started").length, 2);
  assert.equal(llm.requests.length, 3);
  assert.match(llm.requests[1].body.messages[0].content, /STEER-BODY linje1\nlinje2/);
  assert.ok(!JSON.stringify(llm.requests[1].body).includes("QUEUE-BODY"));
  assert.match(llm.requests[2].body.messages[0].content, /QUEUE-BODY køargument/);
  assert.ok(!JSON.stringify(llm.requests[2].body).includes("STEER-BODY"));
  assert.ok(!JSON.stringify(llm.requests[2].body).includes("LATER-EDIT"));
  assert.ok(!JSON.stringify(h.app.store.messages(thread.id)).includes("-BODY"));
});

test("new app/project skills, file edits, invalid frontmatter and removal refresh open command consumers", async (t) => {
  const { h, project, appSkillsDir, userSkillsDir } = await setup(t);
  skill(appSkillsDir, "review", "APP-REVIEW", 'args: "[område]"\n');
  skill(userSkillsDir, "same", "USER");
  skill(appSkillsDir, "same", "APP");
  const socket = await h.socket();
  const file = skill(path.join(project.path, "skills"), "same", "PROJECT");
  await socket.waitFor((message) => message.type === "skills.changed");
  let commands = await h.api("GET", `/api/projects/${project.id}/commands`);
  assert.equal(commands.find((item: any) => item.name === "same").source, "project");
  assert.deepEqual(commands.find((item: any) => item.name === "review"), { name: "review", description: "Gjennomgå review", kind: "skill", source: "app", args: "[område]" });
  assert.ok(!commands.find((item: any) => item.name === "review-changes").aliases.includes("review"));

  const count = () => socket.received.filter((message) => message.type === "skills.changed").length;
  const before = count();
  writeFileSync(file, "---\nname: same\ndescription: [ugyldig, liste]\n---\nIngen gyldig skill");
  await until(() => count() > before, "changed invalid skill");
  commands = await h.api("GET", `/api/projects/${project.id}/commands`);
  assert.equal(commands.find((item: any) => item.name === "same").source, "user");
  const next = count();
  rmSync(path.join(appSkillsDir, "review"), { recursive: true });
  await until(() => count() > next, "removed skill");
  commands = await h.api("GET", `/api/projects/${project.id}/commands`);
  assert.ok(commands.find((item: any) => item.name === "review-changes").aliases.includes("review"));
});

test("app assets ship as readable skills with read-only settings entries", async (t) => {
  const { h, appSkillsDir } = await setup(t);
  skill(appSkillsDir, "review", "APP-READ-ONLY");
  const { skills: list } = await h.api("GET", "/api/skills");
  const app = list.find((item: any) => item.id === "a:review");
  assert.equal(app.source, "app");
  assert.equal(app.editable, false);
  assert.equal((await h.api("GET", "/api/skills/a%3Areview")).body.trim(), "APP-READ-ONLY");
  await assert.rejects(h.api("PUT", "/api/skills/a%3Areview", { description: "Endre", body: "Endre" }), /403/);
  await assert.rejects(h.api("DELETE", "/api/skills/a%3Areview"), /403/);
  const packaged = tempDir(t);
  copyAppSkills(path.resolve(import.meta.dirname, "../.."), packaged);
  assert.deepEqual(discoverSkills(null, tempDir(t), [], path.join(packaged, "skills")).map((item) => item.name), documentedSkills);
  assert.match(readFileSync(path.join(packaged, "skills/review/SKILL.md"), "utf8"), /\{\{args\}\}/);
});

test("file polling observes same-size body edits and closes without further notifications", async (t) => {
  const root = tempDir(t);
  const file = skill(root, "edit", "AAAA");
  let changes = 0;
  const watcher = new SkillChanges(() => [root], () => { changes++; }, 20);
  t.after(() => watcher.close());
  skill(root, "edit", "BBBB");
  await until(() => changes === 1, "same-size body edit");
  watcher.close();
  writeFileSync(file, "different");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(changes, 1);
});

test("file polling observes a changed suffix after a long UTF-8 instruction prefix", async (t) => {
  const root = tempDir(t);
  const prefix = "界".repeat(100_000);
  skill(root, "unicode", `${prefix}AAAA`);
  let changes = 0;
  const watcher = new SkillChanges(() => [root], () => { changes++; }, 20);
  t.after(() => watcher.close());
  skill(root, "unicode", `${prefix}BBBB`);
  await until(() => changes === 1, "UTF-8 body suffix edit");
  const [loaded] = discoverSkills(null, root);
  assert.equal(loadSkillBody(loaded), `${prefix}BBBB`);
});

test("required frontmatter strings and optional args are validated without crashing discovery", (t) => {
  const root = tempDir(t);
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  skill(root, "valid", "Riktig", 'args: "42"\n');
  skill(root, "boolean", "Feil", "args: true\n");
  skill(root, "empty", "Feil", "args:\n");
  const missing = skill(root, "missing", "Feil");
  writeFileSync(missing, "---\nname: missing\n---\nInnhold");
  const broken = skill(root, "broken", "Feil");
  writeFileSync(broken, "---\nname: broken\ndescription: Ikke lukket frontmatter\nInnhold");
  assert.deepEqual(discoverSkills(null, root).map((item) => [item.name, item.args]), [["valid", "42"]]);
  assert.equal(warnings.length, 4);
});

test("every shipped skill parses, has the intended modes and one args placeholder", (t) => {
  const root = path.resolve(import.meta.dirname, "../../skills");
  const shipped = discoverSkills(null, tempDir(t), [], root);
  assert.equal(shipped.length, 29);
  assert.deepEqual(shipped.filter((item) => item.manual).map((item) => item.name), ["council", "handoff", "interface-recreation", "performance-optimization", "sol-loop"]);
  assert.equal(sharedSkills.length, 7);
  assert.deepEqual(shipped.map((item) => item.name), documentedSkills);
  for (const item of shipped) {
    assert.equal(item.mode, sharedSkills.includes(item.name) ? undefined : "code", `${item.name}: intended mode`);
    assert.ok(item.description.length <= 200, `${item.name}: the description is always in the prompt, keep it short`);
    const body = loadSkillBody(item);
    assert.equal(body.split("{{args}}").length - 1, 1, `${item.name}: exactly one args placeholder`);
  }
});

test("the new bundled skills load in their intended modes, without granting other tools", async (t) => {
  const appSkillsDir = path.resolve(import.meta.dirname, "../../skills");
  const h = await startHarness(t, { appSkillsDir, userSkillsDir: tempDir(t) });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Local", baseUrl: llm.url });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Local", model: "test", contextWindow: 64_000 });
  const chat = await h.api("POST", "/api/threads", { mode: "chat", modelId: model.id, chatTools: { python: false, documents: false } });
  await assert.rejects(h.api("POST", `/api/threads/${chat.id}/messages`, { text: "Undersøk loggen.", skill: "ci-triage" }), /400/);
  const notes = "Lise: Tester på fredag.\nEndring: Fristen er mandag. $&";
  llm.reply(sse(openaiText("Oppgavene er oppsummert.")));
  await h.api("POST", `/api/threads/${chat.id}/messages`, { text: notes, skill: "action-items" });
  await h.finished(chat.id);
  const chatRequest = llm.requests[0].body;
  assert.ok(chatRequest.messages[0].content.includes(`# Extract decisions and commitments\n\n${notes}`));
  assert.ok(!chatRequest.tools.some((tool: { function: { name: string } }) => ["run_python", "create_document", "run_command"].includes(tool.function.name)));

  const project = await h.project();
  const code = await h.thread(project.id, "code", model.id);
  llm.reply(sse(openaiToolCall("use_skill", { name: "ci-triage" }, "load-ci")));
  llm.reply(sse(openaiText("CI-feilen er oppsummert.")));
  await h.api("POST", `/api/threads/${code.id}/messages`, { text: "Hva forklarer den røde CI-jobben?" });
  const loaded = ofType(await h.finished(code.id), "tool.finished").find((event) => event.callId === "load-ci");
  assert.equal(loaded?.status, "done");
  assert.match(loaded?.result ?? "", /# Diagnose a failing CI job/);
});

test("a skill with a mode is listed with it and refused in the other mode", async (t) => {
  const { h, thread, appSkillsDir } = await setup(t);
  skill(appSkillsDir, "kodeskill", "Bruk verktøyene. {{args}}", "mode: code\n");
  skill(appSkillsDir, "begge", "For begge moduser. {{args}}");
  skill(appSkillsDir, "rar", "Ukjent modus gjelder begge. {{args}}", "mode: annet\n");
  const commands = await h.api("GET", "/api/commands");
  const mode = (name: string) => commands.find((c: any) => c.name === name)?.mode;
  assert.deepEqual([mode("kodeskill"), mode("begge"), mode("rar")], ["code", undefined, undefined]);
  const chat = await h.thread(null, "chat");
  await assert.rejects(h.api("POST", `/api/threads/${chat.id}/messages`, { text: "se på dette", skill: "kodeskill" }), /400/);
  // The Kode thread takes it, and a skill without a mode works in a chat as before.
  assert.ok((await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "se på dette", skill: "kodeskill" })).messageId);
  assert.ok((await h.api("POST", `/api/threads/${chat.id}/messages`, { text: "se på dette", skill: "begge" })).messageId);
});
