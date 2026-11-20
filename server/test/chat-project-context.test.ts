// All stores, configuration, providers and keys in these tests are isolated temporary fixtures.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CHAT_PROJECT_ICONS, MAX_CHAT_WORDS, PERSONALITIES } from "../../shared/protocol.ts";
import { Store } from "../src/db.ts";
import { hang, openaiText, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir, until, type Harness } from "./helpers.ts";

async function modelFor(h: Harness, llm: FakeLlm, supportsImages = false): Promise<string> {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Lokal test", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  return (await h.api("POST", "/api/models", { providerId: provider.id, name: "Lokal test", model: "test", contextWindow: 100_000, supportsImages })).id;
}
const projectFor = (h: Harness, patch: object = {}) => h.api("POST", "/api/chat-projects", { name: "Prosjekt", ...patch });
const threadFor = (h: Harness, chatProjectId: string, modelId?: string) => h.api("POST", "/api/threads", { mode: "chat", chatProjectId, ...(modelId ? { modelId } : {}) });
const memories = (h: Harness, id: string) => h.api("GET", `/api/chat-projects/${id}/memories`);
const send = (h: Harness, id: string, text: string) => h.api("POST", `/api/threads/${id}/messages`, { text });

async function answer(h: Harness, llm: FakeLlm, id: string, text = "Hei", count = 1): Promise<string> {
  llm.reply(sse(openaiText("Synlig svar")));
  await send(h, id, text);
  await h.finished(id, count);
  return llm.requests.at(-1)!.body.messages[0].content;
}

test("Chat-prosjekt migrerer gamle grupper uten å importere globale innstillinger eller minner", (t) => {
  const dir = tempDir(t);
  const legacy = new DatabaseSync(path.join(dir, "agentic-desktop.db"));
  legacy.exec("CREATE TABLE chat_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, icon TEXT, pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL)");
  legacy.prepare("INSERT INTO chat_projects VALUES ('gammel', 'Gammelt prosjekt', 'blue', 'emoji:🌷', 1, 1, 2)").run();
  legacy.close();
  const store = new Store(dir);
  const project = store.chatProject("gammel")!;
  assert.deepEqual([project.instructions, project.memoryMode, project.autoMemory, project.icon, project.pinned], ["", "project", false, "emoji:🌷", true]);
  store.putChatProjectMemory(project.id, { id: "notat", text: "Privat prosjektminne" });
  const thread = store.createThread(null, "chat", null);
  store.setThreadChatProject(thread.id, project.id);
  store.close();
  const reopened = new Store(dir);
  assert.equal(reopened.thread(thread.id)?.chatProjectId, project.id);
  assert.equal(reopened.chatProjectMemories(project.id)[0].text, "Privat prosjektminne");
  reopened.deleteChatProject(project.id);
  assert.equal(reopened.thread(thread.id)?.chatProjectId, undefined);
  assert.deepEqual(reopened.chatProjectMemories(project.id), []);
  reopened.close();
});

test("Chat-prosjekt har nøyaktig 15 ikoner, validerte farger og 10000 ord med instruksjoner", async (t) => {
  const h = await startHarness(t);
  assert.equal(CHAT_PROJECT_ICONS.length, 15);
  assert.equal(new Set(CHAT_PROJECT_ICONS).size, 15);
  const project = await projectFor(h);
  assert.deepEqual([project.instructions, project.memoryMode, project.autoMemory], ["", "project", false]);
  for (const icon of CHAT_PROJECT_ICONS) assert.equal((await h.api("PATCH", `/api/chat-projects/${project.id}`, { icon })).icon, icon);
  for (const patch of [{ icon: "terminal" }, { icon: "emoji:🦊" }, { color: "ultrafiolett" }, { memoryMode: "code" }, { autoMemory: "ja" }, { instructions: 2 }]) {
    await assert.rejects(h.api("PATCH", `/api/chat-projects/${project.id}`, patch), /400/);
  }
  const instructions = Array(MAX_CHAT_WORDS).fill("ord").join(" ");
  assert.equal((await h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions, memoryMode: "shared", autoMemory: true, color: "blue" })).instructions, instructions);
  await assert.rejects(h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions: instructions + " ett" }), /400/);
  await assert.rejects(h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions: "passord: Hunter2!" }), /400/);
  const before = (await h.api("GET", "/api/chat-projects")).length;
  await assert.rejects(projectFor(h, { icon: "ukjent" }), /400/);
  assert.equal((await h.api("GET", "/api/chat-projects")).length, before, "avvist opprettelse lager ingen halvferdig gruppe");
});

test("modellens faktiske prosjektprompt utelater global Chat-personalisering, posisjon, Kode og andre prosjektminner", async (t) => {
  const configDir = tempDir(t);
  const h = await startHarness(t, { configDir });
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  await h.api("PUT", "/api/chat-personal", { instructions: "GLOBAL_CHAT_INSTRUKS", about: "GLOBAL_OM_DEG", tone: "formell", memories: false, autoMemory: true });
  await h.api("POST", "/api/chat-personal/memories", { text: "GLOBAL_CHAT_MINNE" });
  await h.api("POST", "/api/memories", { scope: "global", text: "KODE_GLOBALT_MINNE" });
  writeFileSync(path.join(configDir, "AGENTS.md"), "KODE_GLOBAL_INSTRUKS");
  const code = await h.project();
  await h.api("POST", "/api/memories", { scope: "project", projectId: code.id, text: "KODE_PROSJEKT_MINNE" });
  const project = await projectFor(h, { instructions: "BARE_PROSJEKT_INSTRUKS" });
  const other = await projectFor(h, { name: "Andre" });
  await h.api("POST", `/api/chat-projects/${project.id}/memories`, { text: "BARE_PROSJEKT_MINNE" });
  await h.api("POST", `/api/chat-projects/${other.id}/memories`, { text: "ANNET_PROSJEKT_MINNE" });
  const settings = h.app.store.settings();
  h.app.store.updateSettings({ modelContext: { ...settings.modelContext, chat: { ...settings.modelContext?.chat, model: true, dateTime: true, location: true, locationText: "PRIVAT_GLOBAL_POSISJON", locationSource: "manual" } } });
  const thread = await threadFor(h, project.id, modelId);
  const personality = PERSONALITIES.find((p) => p.prompt)!;
  await h.api("PATCH", `/api/threads/${thread.id}`, { personality: personality.id });
  const system = await answer(h, llm, thread.id);
  assert.match(system, /BARE_PROSJEKT_INSTRUKS/);
  assert.match(system, /BARE_PROSJEKT_MINNE/);
  assert.match(system, /Current local date and time/);
  for (const absent of ["GLOBAL_CHAT_INSTRUKS", "GLOBAL_OM_DEG", "GLOBAL_CHAT_MINNE", "KODE_GLOBALT_MINNE", "KODE_PROSJEKT_MINNE", "KODE_GLOBAL_INSTRUKS", "ANNET_PROSJEKT_MINNE", "PRIVAT_GLOBAL_POSISJON", personality.prompt!, "Tone: Write in a formal"]) assert.ok(!system.includes(absent), absent);
  assert.deepEqual((await memories(h, project.id)).items.map((i: any) => i.text), ["BARE_PROSJEKT_MINNE"], "global autoMemory endrer ikke prosjektet");
});

test("prosjektminner og bevisst delte CHAT-minner har full CRUD og riktig automatisk skriveruting", async (t) => {
  const h = await startHarness(t);
  await h.api("PUT", "/api/chat-personal", { memories: false, autoMemory: false, instructions: "GLOBALT_SKAL_IKKE_ARVES" });
  const own = await projectFor(h, { autoMemory: true });
  const other = await projectFor(h, { name: "Andre" });
  const item = await h.api("POST", `/api/chat-projects/${own.id}/memories`, { text: "Lokalt notat", memoryMode: "project" });
  const edited = await h.api("PUT", `/api/chat-projects/${own.id}/memories/${item.id}`, { text: "Redigert notat", memoryMode: "project" });
  assert.notEqual(item.id, edited.id);
  await assert.rejects(h.api("POST", `/api/chat-projects/${own.id}/memories`, { text: "passord: Hunter2!" }), /400/);
  assert.deepEqual((await memories(h, other.id)).items, []);
  const thread = await threadFor(h, own.id);
  await send(h, thread.id, "Husk at prosjektet bruker norske faguttrykk");
  await h.finished(thread.id);
  assert.ok((await memories(h, own.id)).items.some((i: any) => /norske faguttrykk/.test(i.text)));
  assert.equal((await h.api("GET", "/api/chat-personal")).memories.length, 0);
  await h.api("PATCH", `/api/chat-projects/${own.id}`, { memoryMode: "shared" });
  await assert.rejects(h.api("PUT", `/api/chat-projects/${own.id}/memories/${edited.id}`, { text: "Stale", memoryMode: "project" }), /409/);
  const shared = await h.api("POST", `/api/chat-projects/${own.id}/memories`, { text: "Felles Chat-notat", memoryMode: "shared" });
  assert.equal((await h.api("GET", "/api/chat-personal")).memories[0].text, "Felles Chat-notat");
  await send(h, thread.id, "Husk at brukeren liker fjellturer");
  await h.finished(thread.id, 2);
  assert.ok((await h.api("GET", "/api/chat-personal")).memories.some((i: any) => /fjellturer/.test(i.text)));
  assert.deepEqual((await h.api("GET", "/api/memories")).global.items, [], "delte CHAT-minner skrives aldri til Kode");
  const sharedEdited = await h.api("PUT", `/api/chat-projects/${own.id}/memories/${shared.id}`, { text: "Endret felles Chat-notat", memoryMode: "shared" });
  await h.api("DELETE", `/api/chat-projects/${own.id}/memories/${sharedEdited.id}?memoryMode=shared`);
  await h.api("PATCH", `/api/chat-projects/${own.id}`, { memoryMode: "project" });
  assert.ok((await memories(h, own.id)).items.some((i: any) => i.id === edited.id), "lokale minner beholdes ved modusbytte");
  await h.api("DELETE", `/api/chat-projects/${own.id}/memories/${edited.id}?memoryMode=project`);
  assert.equal((await h.api("POST", `/api/chat-projects/${own.id}/memories/clear`, { memoryMode: "project" })).removed, 1);
  assert.deepEqual((await memories(h, own.id)).items, []);
});

test("delt minnevalg tar bare inn CHAT-minner og midlertidige prosjektchatter verken leser eller skriver dem", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  await h.api("PUT", "/api/chat-personal", { instructions: "GLOBAL_INSTRUKS_NEI", about: "GLOBAL_ABOUT_NEI", tone: "formell", memories: false, autoMemory: true });
  await h.api("POST", "/api/chat-personal/memories", { text: "GLOBAL_CHAT_JA" });
  const project = await projectFor(h, { instructions: "LOKAL_INSTRUKS_JA", memoryMode: "shared", autoMemory: true });
  const thread = await threadFor(h, project.id, modelId);
  const system = await answer(h, llm, thread.id);
  assert.match(system, /GLOBAL_CHAT_JA/);
  assert.match(system, /LOKAL_INSTRUKS_JA/);
  assert.doesNotMatch(system, /GLOBAL_INSTRUKS_NEI|GLOBAL_ABOUT_NEI|Tone:/);
  const temporary = await h.api("POST", "/api/threads/temporary", { chatProjectId: project.id, modelId });
  const temporarySystem = await answer(h, llm, temporary.id, "Husk at dette skal ikke lagres");
  assert.match(temporarySystem, /LOKAL_INSTRUKS_JA/);
  assert.doesNotMatch(temporarySystem, /GLOBAL_CHAT_JA/);
  assert.deepEqual((await memories(h, project.id)).items.map((i: any) => i.text), ["GLOBAL_CHAT_JA"]);
  const fork = await h.api("POST", `/api/threads/${temporary.id}/fork`, {});
  const side = await h.api("POST", "/api/threads", { mode: "chat", sideOf: temporary.id });
  assert.equal(fork.temporary, true);
  assert.equal(side.temporary, true);
  assert.equal(fork.chatProjectId, project.id);
  assert.equal(side.chatProjectId, project.id);
});

test("flytting og instruksjonsbytte kaster gamle sammendrag og provider-state men beholder synlig samtale", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  const first = await projectFor(h, { instructions: "FORSTE_INSTRUKS" });
  const second = await projectFor(h, { instructions: "ANDRE_INSTRUKS" });
  const thread = await threadFor(h, first.id, modelId);
  await answer(h, llm, thread.id, "Synlig spørsmål");
  h.app.store.replaceMessages(thread.id, [{ role: "user", content: [{ type: "text", text: "GAMMELT_SKJULT_SAMMENDRAG" }] }]);
  const revision = h.app.store.chatContextRevision(thread.id);
  await h.api("PATCH", `/api/threads/${thread.id}`, { chatProjectId: second.id });
  assert.ok(h.app.store.chatContextRevision(thread.id) > revision);
  const system = await answer(h, llm, thread.id, "Fortsett", 2);
  assert.match(system, /ANDRE_INSTRUKS/);
  assert.doesNotMatch(system, /FORSTE_INSTRUKS/);
  const actual = JSON.stringify(llm.requests.at(-1)!.body);
  assert.ok(actual.includes("Synlig spørsmål"));
  assert.ok(!actual.includes("GAMMELT_SKJULT_SAMMENDRAG"));
  h.app.store.replaceMessages(thread.id, [{ role: "user", content: [{ type: "text", text: "SKJULT_FORRIGE_INSTRUKS" }] }]);
  await h.api("PATCH", `/api/chat-projects/${second.id}`, { instructions: "TREDJE_INSTRUKS" });
  assert.match(await answer(h, llm, thread.id, "Videre", 3), /TREDJE_INSTRUKS/);
  assert.ok(!JSON.stringify(llm.requests.at(-1)!.body).includes("SKJULT_FORRIGE_INSTRUKS"));
});

test("aktive/kølagte turer låser omfanget og utdaterte forberedte meldinger avvises", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  const project = await projectFor(h);
  const thread = await threadFor(h, project.id, modelId);
  const dispatch = h.app.runner.prepareSend(thread.id, { text: "Gammelt utkast" });
  h.app.store.updateChatProject(project.id, { instructions: "NY_KONTEKST" });
  assert.throws(dispatch, /konteksten er endret/);
  const staleMove = h.app.runner.prepareSend(thread.id, { text: "Før flytting" });
  h.app.store.setThreadChatProject(thread.id, null);
  h.app.store.setThreadChatProject(thread.id, project.id);
  assert.throws(staleMove, /konteksten er endret/, "A til B til A ugyldiggjør også gamle meldinger");
  llm.reply(hang());
  await send(h, thread.id, "Vent");
  await until(() => llm.requests.length === 1, "lokalt modellkall");
  await send(h, thread.id, "Vent også");
  await assert.rejects(h.api("PATCH", `/api/chat-projects/${project.id}`, { memoryMode: "shared" }), /409/);
  await assert.rejects(h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions: "IKKE_ENDA" }), /409/);
  await assert.rejects(h.api("PATCH", `/api/threads/${thread.id}`, { chatProjectId: null }), /409/);
  await assert.rejects(h.api("DELETE", `/api/chat-projects/${project.id}`), /409/);
  await h.api("PATCH", `/api/chat-projects/${project.id}`, { name: "Trygt navnebytte", color: "green" });
  h.app.runner.stop(thread.id);
  await h.finished(thread.id);
});

test("prosjekt-Chat avviser ambient Kode-skills og sidechatter kan ikke krysse prosjekter", async (t) => {
  const userSkillsDir = tempDir(t);
  mkdirSync(path.join(userSkillsDir, "kode-regler"));
  writeFileSync(path.join(userSkillsDir, "kode-regler", "SKILL.md"), "---\nname: kode-regler\ndescription: Kode\n---\nGLOBAL_KODE_SKILL");
  const h = await startHarness(t, { userSkillsDir });
  const project = await projectFor(h);
  const other = await projectFor(h, { name: "Andre" });
  const thread = await threadFor(h, project.id);
  await assert.rejects(h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei", skill: "kode-regler" }), /400/);
  await assert.rejects(h.api("POST", "/api/threads", { mode: "chat", chatProjectId: other.id, sideOf: thread.id }), /400/);
  assert.equal((await h.api("POST", "/api/threads", { mode: "chat", sideOf: thread.id })).chatProjectId, project.id);
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`, {});
  assert.equal(fork.chatProjectId, project.id);
});

test("komprimering bruker bare samtalen og bytte av minnemodus fjerner det avledede sammendraget", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  await h.api("PUT", "/api/chat-personal", { instructions: "GLOBAL_KOMPAKT_NEI", about: "GLOBAL_ABOUT_KOMPAKT_NEI" });
  const project = await projectFor(h, { instructions: "PROSJEKT_KOMPAKT_JA" });
  const thread = await threadFor(h, project.id, modelId);
  await answer(h, llm, thread.id, "Synlig prosjektspørsmål");
  llm.reply(sse(openaiText("AVLEDET_PROSJEKT_SAMMENDRAG")));
  await h.api("POST", `/api/threads/${thread.id}/compact`, {});
  await h.finished(thread.id, 2);
  assert.ok(JSON.stringify(h.app.store.messages(thread.id)).includes("AVLEDET_PROSJEKT_SAMMENDRAG"));
  const summaryRequest = JSON.stringify(llm.requests.at(-1)!.body);
  assert.ok(summaryRequest.includes("Synlig prosjektspørsmål"));
  assert.doesNotMatch(summaryRequest, /GLOBAL_KOMPAKT_NEI|GLOBAL_ABOUT_KOMPAKT_NEI/);
  await h.api("PATCH", `/api/chat-projects/${project.id}`, { memoryMode: "shared" });
  await answer(h, llm, thread.id, "Etter minnebyttet", 3);
  assert.ok(!JSON.stringify(llm.requests.at(-1)!.body).includes("AVLEDET_PROSJEKT_SAMMENDRAG"));
});

test("runtime nekter å skrive svar eller minner når konteksten endres utenom HTTP-låsen", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  const project = await projectFor(h, { autoMemory: true });
  const thread = await threadFor(h, project.id, modelId);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  llm.reply(async (req, res) => { await pending; await sse(openaiText("Utdatert svar"))(req, res); });
  await send(h, thread.id, "Husk at dette tilhører det opprinnelige prosjektet");
  await until(() => llm.requests.length === 1, "pågående isolert modellforespørsel");
  h.app.store.updateChatProject(project.id, { memoryMode: "shared" });
  release();
  const events = await h.finished(thread.id);
  assert.equal(events.find((event) => event.type === "run.finished")?.type, "run.finished");
  assert.ok(events.some((event) => event.type === "run.finished" && event.status === "error" && /konteksten er endret/.test(event.error ?? "")));
  assert.ok(!JSON.stringify(h.app.store.messages(thread.id)).includes("Utdatert svar"));
  assert.deepEqual((await h.api("GET", "/api/chat-personal")).memories, []);
  assert.deepEqual(h.app.store.chatProjectMemories(project.id), []);
});

test("utdatert prosjektdialog kan ikke overskrive nyere instruksjoner og minnemodus", async (t) => {
  const h = await startHarness(t);
  const project = await projectFor(h, { instructions: "Opprinnelig", memoryMode: "project" });
  const expected = { name: project.name, icon: project.icon, color: project.color, instructions: project.instructions, memoryMode: project.memoryMode, autoMemory: project.autoMemory };
  await h.api("PATCH", `/api/chat-projects/${project.id}`, { instructions: "Nyere instruksjon", memoryMode: "shared", autoMemory: true });
  await assert.rejects(h.api("PATCH", `/api/chat-projects/${project.id}`, { ...expected, name: "Gammelt vindu gir nytt navn", expected }), /409/);
  const current = await h.api("GET", `/api/chat-projects/${project.id}`);
  assert.deepEqual([current.name, current.instructions, current.memoryMode, current.autoMemory], [project.name, "Nyere instruksjon", "shared", true]);
  const refreshed = { name: current.name, icon: current.icon, color: current.color, instructions: current.instructions, memoryMode: current.memoryMode, autoMemory: current.autoMemory };
  h.app.store.touchChatProject(project.id);
  assert.equal((await h.api("PATCH", `/api/chat-projects/${project.id}`, { name: "Nytt navn", expected: refreshed })).name, "Nytt navn", "sist brukt er ikke en redigeringskonflikt");
  await assert.rejects(h.api("POST", "/api/threads", { mode: "chat", chatProjectId: 123 }), /400/);
  await assert.rejects(h.api("POST", "/api/threads", { mode: "chat", chatProjectId: "" }), /400/);
});

test("synlige bilde- og tekstvedlegg gjenopprettes til modellen etter instruksjonsbytte, minnebytte og flytting", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm, true);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const image = await h.api("POST", "/api/images", { name: "skisse.png", mime: "image/png", data: png });
  const upload = await h.api("POST", "/api/uploads", { name: "notat.txt", text: "SYNLIG_OPPLASTET_FAGTEKST" });
  const project = await projectFor(h, { instructions: "Første instruksjon" });
  const other = await projectFor(h, { name: "Et annet prosjekt" });
  const thread = await threadFor(h, project.id, modelId);
  llm.reply(sse(openaiText("Jeg har fått vedleggene")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Les disse vedleggene", attachments: [{ kind: "image", imageId: image.id, name: "skisse.png" }, { kind: "upload", uploadId: upload.id, name: "notat.txt" }] });
  await h.finished(thread.id);
  const assertVisibleUploads = () => {
    const request = JSON.stringify(llm.requests.at(-1)!.body);
    assert.ok(request.includes("SYNLIG_OPPLASTET_FAGTEKST"), "innholdet fra brukerens tekstvedlegg er beholdt");
    assert.ok(request.includes(`data:image/png;base64,${png}`), "bildet fra brukerens synlige melding er beholdt");
    assert.ok(!request.includes("SKJULT_PROVIDER_ELLER_SAMMENDRAG"), "skjult kontekst er fjernet");
  };
  assertVisibleUploads();
  for (const [i, patch] of [{ instructions: "Andre instruksjon" }, { memoryMode: "shared" }].entries()) {
    h.app.store.replaceMessages(thread.id, [{ role: "user", content: [{ type: "text", text: "SKJULT_PROVIDER_ELLER_SAMMENDRAG" }] }]);
    await h.api("PATCH", `/api/chat-projects/${project.id}`, patch);
    await answer(h, llm, thread.id, "Bruk vedleggene videre", i + 2);
    assertVisibleUploads();
  }
  await h.api("PATCH", `/api/threads/${thread.id}`, { chatProjectId: other.id });
  await answer(h, llm, thread.id, "Vedleggene følger den synlige samtalen", 4);
  assertVisibleUploads();
  const fork = await h.api("POST", `/api/threads/${thread.id}/fork`, {});
  await answer(h, llm, fork.id, "Fortsett i gaffelen", 5); // copied event log already contains four finished turns
  assertVisibleUploads();
});

test("minne slått av for tråden hindrer både lesing og automatisk skriving i begge prosjektmoduser", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  for (const memoryMode of ["project", "shared"] as const) {
    const project = await projectFor(h, { memoryMode, autoMemory: true });
    await h.api("POST", `/api/chat-projects/${project.id}/memories`, { text: "MINNE_SOM_ER_AV_I_TRADEN", memoryMode });
    const thread = await threadFor(h, project.id, modelId);
    await h.api("PATCH", `/api/threads/${thread.id}`, { chatTools: { memory: false } });
    const system = await answer(h, llm, thread.id, "Husk at dette ikke skal lagres når minne er slått av");
    assert.ok(!system.includes("MINNE_SOM_ER_AV_I_TRADEN"));
    assert.deepEqual((await memories(h, project.id)).items.map((i: any) => i.text), ["MINNE_SOM_ER_AV_I_TRADEN"]);
  }
});

test("lett kontekstidentitet er stabil for kosmetiske/idempotente endringer og avviser instruksjoner A til B til A", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  const instructions = "Opprinnelig instruksjon";
  const project = await projectFor(h, { instructions, autoMemory: true });
  const thread = await threadFor(h, project.id, modelId);
  const identity = h.app.store.chatContextIdentity(thread.id);
  h.app.store.updateChatProject(project.id, { name: "Nytt navn", icon: "brain", color: "green", pinned: true, instructions, memoryMode: "project", autoMemory: true });
  assert.equal(h.app.store.chatContextIdentity(thread.id), identity, "kosmetikk og identiske kontekstfelt bytter ikke scope");
  const dispatch = h.app.runner.prepareSend(thread.id, { text: "Forberedt før instruksjonsbytte" });
  h.app.store.updateChatProject(project.id, { instructions: "Mellomliggende instruksjon" });
  h.app.store.updateChatProject(project.id, { instructions });
  assert.notEqual(h.app.store.chatContextIdentity(thread.id), identity, "monoton revisjon oppdager instruksjonsbytte selv når teksten er tilbake til A");
  assert.throws(dispatch, /konteksten er endret/);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  llm.reply(async (req, res) => { await pending; await sse(openaiText("Utdatert svar etter A B A"))(req, res); });
  await send(h, thread.id, "Husk at denne turen ikke skal skrive minner etter et scopebytte");
  await until(() => llm.requests.length === 1, "pågående modellforespørsel før A B A");
  h.app.store.updateChatProject(project.id, { instructions: "En annen mellomliggende instruksjon" });
  h.app.store.updateChatProject(project.id, { instructions });
  release();
  const events = await h.finished(thread.id);
  assert.ok(events.some((event) => event.type === "run.finished" && event.status === "error" && /konteksten er endret/.test(event.error ?? "")));
  assert.ok(!events.some((event) => event.type === "text.delta" && /Utdatert svar/.test(event.text)), "utdatert svar sendes ikke til samtalen");
  assert.deepEqual(h.app.store.chatProjectMemories(project.id), []);
});

test("bare faktisk konsumerte styringsmeldinger lagres som minner etter vellykket Chat-tur", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await modelFor(h, llm);
  await h.api("PUT", "/api/chat-personal", { autoMemory: true });
  for (const scope of ["global", "project", "shared"] as const) {
    await h.api("POST", "/api/chat-personal/memories/clear", {});
    const project = scope === "global" ? undefined : await projectFor(h, { memoryMode: scope, autoMemory: true });
    const thread = project ? await threadFor(h, project.id, modelId) : await h.thread(null, "chat", modelId);
    const list = async () => project ? (await memories(h, project.id)).items : (await h.api("GET", "/api/chat-personal")).memories;
    let releaseInitial!: () => void;
    let releaseSteered!: () => void;
    const initial = new Promise<void>((resolve) => { releaseInitial = resolve; });
    const steered = new Promise<void>((resolve) => { releaseSteered = resolve; });
    llm.reply(async (req, res) => { await initial; await sse(openaiText("Første svar"))(req, res); });
    llm.reply(async (req, res) => { await steered; await sse(openaiText("Svar på faktisk konsumert styring"))(req, res); });
    const before = llm.requests.length;
    await send(h, thread.id, "Forklar et lite eksempel");
    await until(() => llm.requests.length === before + 1, "første lokale svar venter");
    const removed = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Husk at dette fjernede minnet aldri skal lagres", steer: true });
    assert.equal(removed.queued, true);
    await h.api("DELETE", `/api/threads/${thread.id}/queue/${removed.messageId}`);
    const accepted = await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Husk at prosjektet benytter norske faguttrykk", steer: true });
    assert.equal(accepted.steer, true);
    assert.deepEqual(await list(), [], "melding i kø har ennå ikke oppdatert minnet");
    releaseInitial();
    await until(() => llm.requests.length === before + 2, "modellen mottar den konsumerte styringsmeldingen");
    const actual = JSON.stringify(llm.requests.at(-1)!.body);
    assert.ok(actual.includes("prosjektet benytter norske faguttrykk"));
    assert.ok(!actual.includes("dette fjernede minnet"));
    assert.deepEqual(await list(), [], "minnet lagres først etter vellykket fullføring");
    releaseSteered();
    const events = await h.finished(thread.id);
    assert.equal(events.filter((event) => event.type === "run.started").length, 1, "styringsmeldingen ble konsumert i samme tur");
    assert.deepEqual((await list()).map((item: any) => item.text), ["Prosjektet benytter norske faguttrykk"]);
    if (scope === "project") assert.deepEqual((await h.api("GET", "/api/chat-personal")).memories, [], "isolert styring skriver ikke globalt");
  }
});
