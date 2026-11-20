// Round 6, agent E: memories (MEMORY.md, global and per project), skills in Innstillinger and
// propose_skill. Every folder is temporary; the user's ~/.config is never touched.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { looksSecret, Memories } from "../src/memory.ts";
import { OPENAI_DONE, openaiChunk, openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, until, type Harness } from "./helpers.ts";

async function fakeModel(h: Harness, llm: FakeLlm): Promise<string> {
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  return (await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 })).id;
}

const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });

test("secrets are recognised, ordinary notes are not", () => {
  for (const secret of [
    "Nøkkelen er sk-or-v1-0123456789abcdef0123456789abcdef",
    "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx",
    "ghp_0123456789abcdefghijABCDEFGHIJ",
    "AKIAIOSFODNN7EXAMPLE",
    "passord: Hunter2!",
    "api_key=abc123def456",
    "postgres://bruker:hemmelig@localhost/db",
    "Bearer abcdefghijklmnop1234",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "token Xq7vL2pR9sT4uW6yZ8aB1cD3eF5gH7jK0mN",
  ]) assert.ok(looksSecret(secret), secret);
  for (const note of [
    "Brukeren foretrekker norsk bokmål og korte svar",
    "Testene kjøres med npm test, og typecheck med npm run typecheck",
    "API-nøkkelen ligger i keys.json, aldri i koden",
    "Prosjektet bruker Solid og Vite, ikke React",
    "server/src/agent/runner.ts har agentløkka",
  ]) assert.ok(!looksSecret(note), note);
});

test("memory files: add, update, forget and clear only touch the list lines", (t) => {
  const config = tempDir(t);
  const memories = new Memories(config, tempDir(t));
  assert.equal(memories.add("global", undefined, "Brukeren heter Julian").existed, false);
  assert.equal(memories.add("global", undefined, "brukeren heter julian").existed, true, "the same note twice is kept once");
  const file = path.join(config, "MEMORY.md");
  writeFileSync(file, readFileSync(file, "utf8") + "\nEgen tekst som skal stå.\n");
  memories.add("global", undefined, "Liker korte svar");
  const [first, second] = memories.list("global");
  assert.equal(second.text, "Liker korte svar");
  memories.update("global", undefined, first.id, "Brukeren heter Julian og skriver norsk");
  assert.match(readFileSync(file, "utf8"), /# Minner[\s\S]*- Brukeren heter Julian og skriver norsk\n- Liker korte svar[\s\S]*Egen tekst som skal stå\./);
  assert.throws(() => memories.add("global", undefined, "passord: Hunter2!"), /nøkkel, et token eller et passord/);
  assert.throws(() => memories.add("global", undefined, "x".repeat(301)), /for langt/);
  assert.throws(() => memories.forget("global", undefined, "e"), /2 minner passer/);
  assert.equal(memories.forget("global", undefined, "korte"), "Liker korte svar");
  // A secret written into the file by hand is shown as flagged and never given to the model.
  writeFileSync(file, readFileSync(file, "utf8") + "- token: Xq7vL2pR9sT4uW6yZ8aB1cD3eF5gH7jK0mN\n");
  assert.equal(memories.list("global").find((i) => i.text.startsWith("token"))?.flagged, true);
  assert.ok(!memories.forPrompt(undefined).includes("Xq7v"));
  assert.match(memories.forPrompt(undefined), /About the user[\s\S]*- Brukeren heter Julian/);
  assert.equal(memories.clear("global"), 2);
  assert.match(readFileSync(file, "utf8"), /Egen tekst som skal stå/);
});

test("REST: list, add, edit, delete and clear memories, globally and per project", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const global = await h.api("POST", "/api/memories", { scope: "global", text: "Liker tabeller" });
  const local = await h.api("POST", "/api/memories", { scope: "project", projectId: project.id, text: "Bruker pnpm" });
  assert.equal(local.projectId, project.id);
  await assert.rejects(h.api("POST", "/api/memories", { scope: "global", text: "nøkkel: sk-proj-abcdefghij0123456789" }), /400/);
  await assert.rejects(h.api("POST", "/api/memories", { scope: "project", projectId: "finnes-ikke", text: "x" }), /404/);
  let list = await h.api("GET", "/api/memories");
  assert.equal(list.enabled, true, "on by default");
  assert.deepEqual(list.global.items.map((i: any) => i.text), ["Liker tabeller"]);
  const mine = list.projects.find((p: any) => p.projectId === project.id);
  assert.equal(mine.file, path.join(project.path, ".agentic/MEMORY.md"));
  assert.deepEqual(mine.items.map((i: any) => i.text), ["Bruker pnpm"]);
  const edited = await h.api("PUT", `/api/memories/${global.id}`, { scope: "global", text: "Liker tabeller og lister" });
  assert.notEqual(edited.id, global.id, "the id follows the text");
  await h.api("DELETE", `/api/memories/${local.id}?scope=project&projectId=${project.id}`);
  await assert.rejects(h.api("DELETE", `/api/memories/${local.id}?scope=project&projectId=${project.id}`), /404/);
  await h.api("POST", "/api/memories", { scope: "project", projectId: project.id, text: "Bruker npm" });
  assert.deepEqual(await h.api("POST", "/api/memories/clear", {}), { removed: 2 });
  list = await h.api("GET", "/api/memories");
  assert.equal(list.global.items.length + list.projects[0].items.length, 0);
});

test("remember saves for later threads; with memories off nothing is offered, saved or loaded", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "ask" });
  const first = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("remember", { text: "Testene kjøres med npm test" }, "m1")));
  llm.reply(sse(openaiToolCall("remember", { text: "Brukeren vil ha svar på nynorsk", scope: "global" }, "m2")));
  llm.reply(sse(openaiToolCall("remember", { text: "Nøkkelen er sk-or-v1-0123456789abcdef0123456789" }, "m3")));
  llm.reply(sse(openaiText("Notert.")));
  const stop = h.approveAll(first.id);
  await send(h, first.id, "husk dette");
  const events = await h.finished(first.id);
  stop();
  // In Ask, a project memory asks like a file edit, and a global one asks too. The card says
  // which it is and shows the text. A secret is refused before anything is asked.
  const asked = ofType(events, "approval.requested");
  assert.equal(asked.length, 2);
  assert.match(asked[0].title, /Lagre et minne \(prosjektet\)/);
  assert.match(asked[0].detail, /\.agentic\/MEMORY\.md[\s\S]*«Testene kjøres med npm test»/);
  assert.match(asked[1].title, /Lagre et minne \(globalt\)/);
  assert.match(asked[1].detail, /alle prosjekter[\s\S]*«Brukeren vil ha svar på nynorsk»/);
  assert.ok(asked.every((a) => !a.canAllowAlways));
  assert.deepEqual(ofType(events, "tool.finished").map((r) => r.status), ["done", "done", "error"]);
  assert.match(readFileSync(path.join(project.path, ".agentic/MEMORY.md"), "utf8"), /- Testene kjøres med npm test/);
  assert.ok(!JSON.stringify(await h.api("GET", "/api/memories")).includes("sk-or-v1"));

  // A new thread gets both, the project's first. Chat has its own memories since round 9b (SPEC
  // 22.4), so it gets neither.
  const second = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiText("Hei.")));
  await send(h, second.id, "hei");
  await h.finished(second.id);
  const system = llm.requests.at(-1)!.body.messages[0].content as string;
  assert.match(system, /# Memories from earlier threads[\s\S]*This project:\n- Testene kjøres med npm test\nAbout the user, for every project:\n- Brukeren vil ha svar på nynorsk/);
  const chat = await h.thread(null, "chat", modelId);
  llm.reply(sse(openaiText("Hei.")));
  await send(h, chat.id, "hei");
  await h.finished(chat.id);
  const chatSystem = llm.requests.at(-1)!.body.messages[0].content as string;
  assert.doesNotMatch(chatSystem, /nynorsk/);
  assert.ok(!chatSystem.includes("npm test"));

  await h.api("PATCH", "/api/settings", { memories: false });
  const third = await h.thread(project.id, "code", modelId);
  llm.reply(sse(openaiToolCall("remember", { text: "Skal ikke lagres" }, "m4")));
  llm.reply(sse(openaiText("ok")));
  await send(h, third.id, "husk");
  const off = await h.finished(third.id);
  const body = llm.requests.at(-2)!.body;
  assert.ok(!body.tools.some((x: any) => x.function.name === "remember"));
  assert.ok(!(body.messages[0].content as string).includes("npm test"), "nothing is loaded");
  assert.match(ofType(off, "tool.finished")[0].result!, /Ukjent verktøy: remember/);
  assert.ok(!readFileSync(path.join(project.path, ".agentic/MEMORY.md"), "utf8").includes("Skal ikke lagres"));
});

function skillFile(dir: string, name: string, description: string, body = "Kropp"): void {
  mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
}

test("skills in Innstillinger: list, create, edit, switch off and remove, with strict paths", async (t) => {
  const userSkills = tempDir(t, "ad-user-skills-");
  const h = await startHarness(t, { userSkillsDir: userSkills });
  const project = await h.project();
  skillFile(path.join(project.path, ".claude/skills"), "rydd", "Rydd i koden");
  skillFile(userSkills, "rydd", "Brukerens rydd");
  const outside = tempDir(t);
  skillFile(outside, "lenket", "Ligger utenfor");
  symlinkSync(path.join(outside, "lenket"), path.join(userSkills, "lenket"));

  let { skills, userDir } = await h.api("GET", "/api/skills");
  assert.equal(userDir, userSkills);
  const user = skills.find((s: any) => s.source === "user" && s.name === "rydd");
  assert.equal(user.shadowed, true, "the project's rydd wins in that project");
  assert.equal(skills.find((s: any) => s.name === "lenket").editable, false);
  const fromProject = skills.find((s: any) => s.source === "project");
  assert.equal(fromProject.id, `p:${project.id}:1:rydd`);
  assert.equal(fromProject.projectName, project.name);

  const made = await h.api("POST", "/api/skills", { scope: "user", name: "skriv-tester", description: 'Skriv tester: "først"', body: "1. Finn testmappen\n2. Skriv testen" });
  assert.equal(made.id, "u:skriv-tester");
  assert.equal(made.description, 'Skriv tester: "først"', "quotes survive the frontmatter");
  assert.equal(made.createdByAgent, false);
  assert.match(made.body, /1\. Finn testmappen/);
  await assert.rejects(h.api("POST", "/api/skills", { scope: "user", name: "skriv-tester", description: "x", body: "y" }), /409/);
  for (const name of ["../ut", "Stor", "a b", "-a", "x".repeat(65)]) {
    await assert.rejects(h.api("POST", "/api/skills", { scope: "user", name, description: "x", body: "y" }), /400/, name);
  }
  await assert.rejects(h.api("POST", "/api/skills", { scope: "user", name: "lekk", description: "x", body: "token: ghp_0123456789abcdefghijABCDEFGHIJ" }), /400/);
  const local = await h.api("POST", "/api/skills", { scope: "project", projectId: project.id, name: "bygg", description: "Bygg prosjektet", body: "npm run build" });
  assert.ok(existsSync(path.join(project.path, ".agentic/skills/bygg/SKILL.md")));

  const updated = await h.api("PUT", `/api/skills/${encodeURIComponent(local.id)}`, { description: "Bygg alt", body: "npm run build && npm test" });
  assert.equal(updated.description, "Bygg alt");
  assert.match(readFileSync(path.join(project.path, ".agentic/skills/bygg/SKILL.md"), "utf8"), /^---\nname: bygg\ndescription: "Bygg alt"\n---\n\nnpm run build && npm test\n$/);

  // Off: the agent and the command list stop seeing it.
  const commands = async () => (await h.api("GET", `/api/projects/${project.id}/commands`)).filter((c: any) => c.kind === "skill").map((c: any) => c.name);
  assert.ok((await commands()).includes("bygg"));
  assert.equal((await h.api("PATCH", `/api/skills/${encodeURIComponent(local.id)}`, { enabled: false })).enabled, false);
  assert.ok(!(await commands()).includes("bygg"));
  await h.api("PATCH", `/api/skills/${encodeURIComponent(local.id)}`, { enabled: true });

  for (const id of ["u:..", "u:../x", "x:y", `p:${project.id}:9:bygg`, `p:${project.id}:0:../../etc`, "u:a/b"]) {
    await assert.rejects(h.api("GET", `/api/skills/${encodeURIComponent(id)}`), /40[034]/, id);
  }
  await assert.rejects(h.api("PUT", "/api/skills/u%3Alenket", { description: "x", body: "y" }), /403/);
  await assert.rejects(h.api("DELETE", "/api/skills/u%3Alenket"), /403/);
  assert.ok(existsSync(path.join(outside, "lenket/SKILL.md")), "nothing outside the skills folder is touched");

  await h.api("DELETE", `/api/skills/${encodeURIComponent(local.id)}`);
  assert.ok(!existsSync(path.join(project.path, ".agentic/skills/bygg")));
  ({ skills } = await h.api("GET", "/api/skills"));
  assert.ok(!skills.some((s: any) => s.name === "bygg"));
});

test("propose_skill asks by default, even in full access; auto saves at once; off hides it", async (t) => {
  const userSkills = tempDir(t, "ad-user-skills-");
  const h = await startHarness(t, { userSkillsDir: userSkills });
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const propose = (name: string, id: string) =>
    sse(openaiToolCall("propose_skill", { name, description: "Kjør e2e-testene og les feilene", instructions: "1. npm run e2e\n2. Les loggen" }, id));

  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(propose("kjor-e2e", "p1"));
  llm.reply(propose("avslatt", "p2"));
  llm.always(sse(openaiText("ok")));
  await send(h, thread.id, "lag en skill");
  // The first is allowed, the second denied.
  await until(async () => ofType((await h.events(thread.id)).map((e) => e.event), "approval.requested").length === 1, "first approval");
  let asks = ofType((await h.events(thread.id)).map((e) => e.event), "approval.requested");
  assert.equal(asks[0].title, "Ny skill fra agenten: kjor-e2e (alle prosjekter)");
  assert.equal(asks[0].canAllowAlways, false);
  assert.match(asks[0].detail, /^---\nname: kjor-e2e\ndescription: "Kjør e2e-testene og les feilene"\ncreated-by: agent\n---\n\n1\. npm run e2e/);
  await h.api("POST", `/api/approvals/${asks[0].approvalId}`, { decision: "allow" });
  await until(async () => ofType((await h.events(thread.id)).map((e) => e.event), "approval.requested").length === 2, "second approval");
  asks = ofType((await h.events(thread.id)).map((e) => e.event), "approval.requested");
  await h.api("POST", `/api/approvals/${asks[1].approvalId}`, { decision: "deny" });
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "tool.finished").map((r) => r.status), ["done", "denied"]);
  assert.match(readFileSync(path.join(userSkills, "kjor-e2e/SKILL.md"), "utf8"), /created-by: agent/);
  assert.ok(!existsSync(path.join(userSkills, "avslatt")));
  const listed = (await h.api("GET", "/api/skills")).skills.find((s: any) => s.name === "kjor-e2e");
  assert.equal(listed.createdByAgent, true);

  await h.api("PATCH", "/api/settings", { autoSkills: "auto" });
  const auto = await h.thread(project.id, "code", modelId);
  llm.reply(propose("auto-skill", "p3"));
  await send(h, auto.id, "lag");
  const autoEvents = await h.finished(auto.id);
  assert.equal(ofType(autoEvents, "approval.requested").length, 0);
  assert.ok(existsSync(path.join(userSkills, "auto-skill/SKILL.md")));

  await h.api("PATCH", "/api/settings", { autoSkills: "off" });
  await assert.rejects(h.api("PATCH", "/api/settings", { autoSkills: "kanskje" }), /400/);
  const off = await h.thread(project.id, "code", modelId);
  await send(h, off.id, "hei");
  await h.finished(off.id);
  assert.ok(!llm.requests.at(-1)!.body.tools.some((x: any) => x.function.name === "propose_skill"));
  assert.ok(!(llm.requests.at(-1)!.body.messages[0].content as string).includes("propose_skill"));
});

test("a broken tool call stream still leaves every call answered", async (t) => {
  // Two calls where the second has broken JSON: the first runs, the second is an error, and the
  // history stays valid for the next request.
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const modelId = await fakeModel(h, llm);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code", modelId);
  llm.reply(sse(
    openaiChunk({ role: "assistant", tool_calls: [
      { index: 0, id: "a", type: "function", function: { name: "list_dir", arguments: '{"path":"."}' } },
      { index: 1, id: "b", type: "function", function: { name: "remember", arguments: '{"text": "uferdig' } },
    ] }) + openaiChunk({}, "tool_calls") + OPENAI_DONE,
  ));
  llm.always(sse(openaiText("ok")));
  await send(h, thread.id, "se");
  const events = await h.finished(thread.id);
  assert.deepEqual(ofType(events, "tool.finished").map((r) => r.status), ["done", "error"]);
  const last = llm.requests.at(-1)!.body.messages as any[];
  assert.deepEqual(last.filter((m) => m.role === "tool").map((m) => m.tool_call_id), ["a", "b"]);
});
