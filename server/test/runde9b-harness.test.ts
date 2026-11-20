// Round 9b (SPEC 22): the standard harness for Kode in layers, the default global AGENTS.md and
// «Gjenopprett standard», the preview, the memory upgrade, Chat's own personalisation, import of
// many skills, and the demo model answering «hei» from the system prompt it actually got.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_AGENTS_MD, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, lineDiff } from "../src/agent/harness.ts";
import { parseModelOps, proposeByRules, shorten } from "../src/agent/memory-upgrade.ts";
import { captureMemories, memoryId } from "../src/memory.ts";
import { identityIntent } from "../src/providers/mock.ts";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir, textOf, type Harness } from "./helpers.ts";

const json = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const send = (h: Harness, threadId: string, text: string) => h.api("POST", `/api/threads/${threadId}/messages`, { text });
const items = (...texts: string[]) => texts.map((text) => ({ id: memoryId(text), text }));

test("the default global AGENTS.md is written the first time only, and never over a file that is there", async (t) => {
  const data = tempDir(t, "ad-data-");
  const config = path.join(tempDir(t, "ad-config-"), "agentic-desktop");
  const file = path.join(config, "AGENTS.md");
  {
    const h = await startHarness(t, { dataDir: data, configDir: config, seedDefaults: true });
    assert.equal(readFileSync(file, "utf8"), DEFAULT_AGENTS_MD);
    const info = await h.api("GET", "/api/harness");
    assert.equal(info.agents.isDefault, true);
    assert.equal(info.agents.file, file);
    await h.app.close();
  }
  // Deleted by the user: it does not come back on the next start.
  rmSync(file);
  {
    const h = await startHarness(t, { dataDir: data, configDir: config, seedDefaults: true });
    assert.equal(existsSync(file), false);
    await h.app.close();
  }
  // A file that was there before the first start is kept as it is.
  const other = path.join(tempDir(t, "ad-config-"), "agentic-desktop");
  mkdirSync(other, { recursive: true });
  writeFileSync(path.join(other, "AGENTS.md"), "Mine egne regler.");
  const h = await startHarness(t, { configDir: other, seedDefaults: true });
  assert.equal(readFileSync(path.join(other, "AGENTS.md"), "utf8"), "Mine egne regler.");
  assert.equal((await h.api("GET", "/api/harness")).agents.isDefault, false);
});

test("«Gjenopprett standard» shows the difference first, refuses a stale view and keeps a backup", async (t) => {
  const config = path.join(tempDir(t, "ad-config-"), "agentic-desktop");
  const h = await startHarness(t, { configDir: config, seedDefaults: true });
  await h.api("PUT", "/api/config/agents-md", { text: "# Mine instruksjoner\n\nSvar alltid på nynorsk.\n" });
  const preview = await h.api("GET", "/api/harness/agents-md/default");
  assert.equal(preview.text, DEFAULT_AGENTS_MD);
  assert.ok(preview.diff.some((l: any) => l.kind === "del" && l.text === "Svar alltid på nynorsk."));
  assert.ok(preview.diff.some((l: any) => l.kind === "add" && l.text === "## Svar"));
  assert.ok(preview.diff.some((l: any) => l.kind === "same" && l.text === "# Mine instruksjoner"));

  // Changed in an editor after the diff was shown: nothing is written.
  await h.api("PUT", "/api/config/agents-md", { text: "Endret i mellomtiden." });
  const stale = await h.raw("POST", "/api/harness/restore", json({ agents: preview.hash }));
  assert.equal(stale.status, 409);
  assert.equal(readFileSync(path.join(config, "AGENTS.md"), "utf8"), "Endret i mellomtiden.");

  const fresh = await h.api("GET", "/api/harness/agents-md/default");
  const done = await h.api("POST", "/api/harness/restore", { agents: fresh.hash });
  assert.equal(readFileSync(path.join(config, "AGENTS.md"), "utf8"), DEFAULT_AGENTS_MD);
  assert.equal(readFileSync(done.backup, "utf8"), "Endret i mellomtiden.");
  assert.ok(done.backup.startsWith(path.join(config, "backups")));
  assert.equal(done.harness.agents.isDefault, true);
  assert.equal(done.harness.agents.backups.length, 1);
  // Restoring the default over the default makes no new backup.
  await h.api("POST", "/api/harness/restore", { agents: done.harness.agents.hash });
  assert.equal(readdirSync(path.join(config, "backups")).length, 1);

  assert.deepEqual(lineDiff("a\nb\n", "a\nc\n").map((l) => `${l.kind}:${l.text}`), ["same:a", "del:b", "add:c"]);
});

test("harness parts switch on and off, identity and safety stay on, and the preview shows every layer", async (t) => {
  const config = path.join(tempDir(t, "ad-config-"), "agentic-desktop");
  const h = await startHarness(t, { configDir: config, seedDefaults: true });
  const project = await h.project();
  mkdirSync(path.join(project.path, ".git"));
  writeFileSync(path.join(project.path, ".git/HEAD"), "ref: refs/heads/hovedgren\n");
  writeFileSync(path.join(project.path, "AGENTS.md"), "PROSJEKT-REGEL");
  writeFileSync(path.join(project.path, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await h.api("POST", "/api/memories", { scope: "global", text: "Brukeren heter Kari" });

  let preview = await h.api("GET", `/api/harness/preview?mode=code&projectId=${project.id}`);
  assert.deepEqual(preview.layers.map((l: any) => l.id), ["base", "env", "memories", "global", "project", "ui-mods"]);
  assert.ok(preview.layers.every((l: any) => l.tokens > 0 && l.source));
  assert.equal(preview.tokens, Math.ceil(preview.layers.map((l: any) => l.text).join("\n\n").length / 4));
  const base = preview.layers[0].text;
  assert.match(base, /^You are the coding agent in Agentic Desktop/);
  assert.match(base, /write and change code, fix bugs and refactor, run commands, tests and builds/);
  assert.match(base, /# About you and this app/);
  assert.match(base, /When the user greets you, or asks who you are/);
  assert.match(base, /# How to work/);
  assert.doesNotMatch(base, /wait for the user's yes/, "Spør før store endringer is off by default");
  const env = preview.layers[1].text;
  assert.match(env, /Git repository: yes, branch hovedgren/);
  assert.match(env, /Tools on: read_file, .*run_command/);
  assert.match(env, /Checks: `npm test`/);
  assert.match(preview.layers[3].text, /Svar på språket jeg skriver på/);
  assert.match(preview.layers[4].text, /PROSJEKT-REGEL[\s\S]*the project wins/);
  assert.ok(preview.tools.includes("edit_file"));

  // Spør før store endringer on, Kjør tester etter endringer off.
  let info = await h.api("PATCH", "/api/harness", { parts: { askFirst: true, verify: false } });
  assert.equal(info.partsAreDefault, false);
  preview = await h.api("GET", `/api/harness/preview?mode=code&projectId=${project.id}`);
  assert.match(preview.layers[0].text, /wait for the user's yes/);
  assert.doesNotMatch(preview.layers[0].text, /After you change code, check it/);
  assert.equal((await h.raw("PATCH", "/api/harness", json({ parts: { identity: false } }))).status, 400);
  assert.equal((await h.raw("PATCH", "/api/harness", json({ parts: { nope: true } }))).status, 400);
  info = (await h.api("POST", "/api/harness/restore", { parts: true })).harness;
  assert.equal(info.partsAreDefault, true);
  assert.equal(info.parts.find((p: any) => p.id === "verify").on, true);

  // Chat never gets the Kode harness, the global AGENTS.md or the Kode memories.
  const chat = await h.api("GET", "/api/harness/preview?mode=chat");
  assert.deepEqual(chat.layers.map((l: any) => l.id), ["chat-base", "chat-personal", "ui-mods"]);
  assert.match(chat.layers[0].text, /chat assistant in Agentic Desktop/);
  assert.doesNotMatch(JSON.stringify(chat), /Kari|Svar på språket jeg skriver på|How to work/);
  assert.deepEqual(chat.tools, ["ui_mod","create_document","list_chat_files"]);
});

test("Chat has its own personalisation and memories, and can update them by itself", async (t) => {
  const h = await startHarness(t);
  const empty = await h.api("GET", "/api/chat-personal");
  assert.deepEqual(empty.personal, { instructions: DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, about: "", tone: "standard", traits: { warm: 0, enthusiastic: 0, structure: 0, emoji: 0 }, autoMemory: false, memories: true });
  await h.api("PUT", "/api/chat-personal", { instructions: "Bruk eksempler fra fotball.", about: "Jeg er lærer i Bergen.", tone: "kort" });
  assert.equal((await h.raw("PUT", "/api/chat-personal", json({ about: "API-nøkkelen min er sk-ant-api03-abcdefghijklmnopqrstuvwx" }))).status, 400);
  assert.equal((await h.raw("PUT", "/api/chat-personal", json({ tone: "sur" }))).status, 400);
  assert.equal((await h.raw("PUT", "/api/chat-personal", json({ instructions: "ord ".repeat(10_001) }))).status, 400);
  await h.api("POST", "/api/chat-personal/memories", { text: "Brukeren har en hund som heter Luna" });

  const chat = await h.api("GET", "/api/harness/preview?mode=chat");
  const text = chat.layers.map((l: any) => l.text).join("\n");
  assert.match(text, /Personality \(Effektiv\): Be as brief as the task allows/);
  assert.match(text, /Jeg er lærer i Bergen/);
  assert.match(text, /Bruk eksempler fra fotball/);
  assert.match(text, /hund som heter Luna/);
  const project = await h.project();
  const code = await h.api("GET", `/api/harness/preview?mode=code&projectId=${project.id}`);
  assert.doesNotMatch(JSON.stringify(code), /Luna|fotball|Bergen/, "Kode never sees Chat's personalisation");

  // «Oppdater minnet av seg selv»: off, nothing is saved; on, what the user plainly asked for is.
  const thread = await h.thread(null, "chat");
  await send(h, thread.id, "Husk at jeg liker korte svar.");
  await h.finished(thread.id);
  assert.equal((await h.api("GET", "/api/chat-personal")).memories.length, 1);
  await h.api("PUT", "/api/chat-personal", { autoMemory: true });
  await send(h, thread.id, "Husk at jeg liker korte svar.");
  await h.finished(thread.id, 2);
  const after = await h.api("GET", "/api/chat-personal");
  assert.deepEqual(after.memories.map((m: any) => m.text), ["Brukeren har en hund som heter Luna", "Jeg liker korte svar"]);
  assert.match(after.file, /chat[/\\]MEMORY\.md$/);
  assert.equal((await h.api("GET", "/api/memories")).global.items.length, 0, "the Kode memories are untouched");

  assert.deepEqual(captureMemories("Jeg heter Ola Nordmann, og jeg foretrekker svar på nynorsk."), ["Brukeren heter Ola Nordmann", "Brukeren foretrekker svar på nynorsk"]);
  assert.deepEqual(captureMemories("husk at passordet er Solsikke2024"), [], "never a secret");
  assert.deepEqual(captureMemories("Hva er hovedstaden i Norge?"), []);

  await h.api("POST", "/api/chat-personal/reset");
  assert.equal((await h.api("GET", "/api/chat-personal")).personal.about, "");
});

test("the memory upgrade merges, removes what is out of date and trims, and only writes what was chosen", async (t) => {
  // The rules on their own.
  const project = tempDir(t, "ad-project-");
  mkdirSync(path.join(project, "src"));
  writeFileSync(path.join(project, "src/app.ts"), "");
  const ops = proposeByRules(
    items(
      "Testene kjøres med npm test",
      "Brukeren vil ha svar på norsk",
      "Husk at bygget ligger i dist/",
      "brukeren vil ha svar på norsk.",
      "Konfigurasjonen ligger i src/gammel.ts",
      "Inngangen er src/app.ts",
      "Brukeren vil ha svar på norsk og korte forklaringer",
      "Testene kjøres med pnpm test",
    ),
    { projectPath: project },
  );
  const by = (kind: string) => ops.filter((o) => o.kind === kind);
  assert.equal(by("merge").length, 1);
  assert.deepEqual(by("merge")[0].result, "Brukeren vil ha svar på norsk og korte forklaringer");
  assert.equal(by("merge")[0].ids.length, 3);
  assert.deepEqual(by("remove").map((o) => o.texts[0]).sort(), ["Konfigurasjonen ligger i src/gammel.ts", "Testene kjøres med npm test"]);
  assert.match(by("remove").find((o) => o.texts[0].includes("gammel"))!.reason, /src\/gammel\.ts finnes ikke lenger/);
  assert.match(by("remove").find((o) => o.texts[0].includes("npm test"))!.reason, /nyere minne.*pnpm test/);
  assert.deepEqual(by("shorten").map((o) => o.result), ["Bygget ligger i dist/"]);
  assert.ok(!ops.some((o) => o.texts.includes("Inngangen er src/app.ts")), "a file that is there is fine");
  assert.equal(shorten("Kort og godt."), null);

  // Over the API, for the global file.
  const h = await startHarness(t);
  for (const text of ["Brukeren liker TypeScript", "Brukeren liker TypeScript.", "Merk: brukeren bruker Linux"]) await h.api("POST", "/api/memories", { scope: "global", text });
  const proposal = await h.api("POST", "/api/memories/upgrade", { scope: "global", useModel: true });
  assert.equal(proposal.source, "regler");
  assert.match(proposal.note, /Demo-modellen/);
  assert.deepEqual(proposal.ops.map((o: any) => o.kind), ["merge", "shorten"]);
  // Only the merge is chosen: the shortening is left.
  await h.api("POST", "/api/memories/upgrade/apply", { proposal, selected: [0] });
  assert.deepEqual((await h.api("GET", "/api/memories")).global.items.map((i: any) => i.text), ["Brukeren liker TypeScript.", "Merk: brukeren bruker Linux"]);
  // The same proposal again is stale now.
  assert.equal((await h.raw("POST", "/api/memories/upgrade/apply", json({ proposal, selected: [0] }))).status, 409);

  // The project's own file, and Chat's.
  const p = await h.project();
  await h.api("POST", "/api/memories", { scope: "project", projectId: p.id, text: "Husk: kjør npm test" });
  const projectProposal = await h.api("POST", "/api/memories/upgrade", { scope: "project", projectId: p.id });
  assert.deepEqual(projectProposal.ops.map((o: any) => o.result), ["Kjør npm test"]);
  await h.api("POST", "/api/memories/upgrade/apply", { proposal: projectProposal });
  assert.match(readFileSync(path.join(p.path, ".agentic/MEMORY.md"), "utf8"), /^- Kjør npm test$/m);
});

test("a real model can make the upgrade proposal, and a bad answer falls back to the rules", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  await h.api("PATCH", "/api/settings", { defaultModelId: model.id });
  const a = await h.api("POST", "/api/memories", { scope: "global", text: "Bruker vim" });
  const b = await h.api("POST", "/api/memories", { scope: "global", text: "Brukeren skriver i vim" });
  llm.reply(sse(openaiText("```json\n" + JSON.stringify({ ops: [{ kind: "merge", ids: [a.id, b.id], result: "Brukeren skriver i vim", reason: "Samme ting" }] }) + "\n```")));
  const proposal = await h.api("POST", "/api/memories/upgrade", { scope: "global", useModel: true });
  assert.equal(proposal.source, "modell");
  assert.deepEqual(proposal.ops[0].texts, ["Bruker vim", "Brukeren skriver i vim"]);
  assert.match(llm.requests[0].body.messages[1].content, new RegExp(`\\[${a.id}\\] Bruker vim`));
  assert.equal((await h.api("GET", "/api/memories")).global.items.length, 2, "nothing is written before it is applied");

  llm.reply(sse(openaiText(JSON.stringify({ ops: [{ kind: "remove", ids: ["finnes-ikke"] }] }))));
  const fallback = await h.api("POST", "/api/memories/upgrade", { scope: "global", useModel: true });
  assert.equal(fallback.source, "regler");
  assert.match(fallback.note, /Fake ga ikke et gyldig forslag/);

  assert.throws(() => parseModelOps('{"ops":[{"kind":"merge","ids":["x"],"result":"y"}]}', [{ id: "x", text: "y" }]));
  assert.throws(() => parseModelOps('{"ops":[{"kind":"shorten","ids":["x"],"result":"token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}]}', [{ id: "x", text: "y" }]));
});

test("many skills at once: frontmatter is checked per file, and a taken name asks", async (t) => {
  const h = await startHarness(t);
  await h.api("POST", "/api/skills", { scope: "user", name: "kjor-tester", description: "Kjører testene", body: "Gammel" });
  const skill = (name: string, description: string, body = "Steg 1") => `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\n---\n\n${body}\n`;
  const files = [
    { name: "kjor-tester.md", text: skill("kjor-tester", "Kjører testene og leser feilene", "Ny") },
    { name: "SKILL.md", path: "mine/lag-release/SKILL.md", text: skill("lag-release", "Lager en release") },
    { name: "notater.md", path: "mine/lag-release/notater.md", text: "bare notater" },
    { name: "Gjennomgang Av Kode.md", text: "---\ndescription: Ser over en diff\n---\nLes diffen." },
    { name: "uten.md", text: "# Bare en overskrift" },
    { name: "Feil_Navn.md", text: skill("Feil_Navn", "x") },
    { name: "tom.md", text: "---\nname: tom\n---\nInnhold" },
    { name: "bilde.png", text: "x" },
    { name: "kopi.md", text: skill("lag-release", "En annen release-skill") },
  ];
  const { rows } = await h.api("POST", "/api/skills/import/preview", { files, scope: "user" });
  const status = Object.fromEntries(rows.map((r: any) => [r.file, r.status]));
  assert.deepEqual(status, {
    "kjor-tester.md": "conflict",
    "mine/lag-release/SKILL.md": "ok",
    "mine/lag-release/notater.md": "ignored",
    "Gjennomgang Av Kode.md": "ok",
    "uten.md": "invalid",
    "Feil_Navn.md": "invalid",
    "tom.md": "invalid",
    "bilde.png": "invalid",
    "kopi.md": "conflict",
  });
  const row = (file: string) => rows.find((r: any) => r.file === file);
  assert.equal(row("Gjennomgang Av Kode.md").name, "gjennomgang-av-kode");
  assert.match(row("uten.md").error, /Mangler frontmatter/);
  assert.match(row("Feil_Navn.md").error, /Navnet «Feil_Navn» er ugyldig/);
  assert.match(row("tom.md").error, /Mangler description/);
  assert.match(row("bilde.png").error, /Ikke en \.md-fil/);
  assert.equal(row("kjor-tester.md").conflictWith, "Dine skills");
  assert.equal(row("kjor-tester.md").suggested, "kjor-tester-2");
  assert.match(row("kopi.md").conflictWith, /En annen fil i importen/);

  // Replace the old one, keep both for the copy, and import the release skill switched off.
  const { results } = await h.api("POST", "/api/skills/import", {
    files,
    scope: "user",
    decisions: { [row("kjor-tester.md").key]: "replace", [row("kopi.md").key]: "both" },
    enabled: { [row("mine/lag-release/SKILL.md").key]: false },
  });
  const result = Object.fromEntries(results.map((r: any) => [r.file, r.status]));
  assert.equal(result["kjor-tester.md"], "replaced");
  assert.equal(result["mine/lag-release/SKILL.md"], "created");
  assert.equal(result["kopi.md"], "created");
  assert.equal(results.find((r: any) => r.file === "kopi.md").name, "lag-release-2");
  assert.equal(result["uten.md"], "error");
  const list = (await h.api("GET", "/api/skills")).skills;
  const named = (name: string) => list.find((s: any) => s.name === name);
  assert.equal(named("kjor-tester").description, "Kjører testene og leser feilene");
  assert.equal(named("lag-release").enabled, false);
  assert.ok(named("lag-release-2") && named("gjennomgang-av-kode"));
  assert.match(readFileSync(path.join(named("lag-release-2").path, "SKILL.md"), "utf8"), /^name: lag-release-2\n[\s\S]*license: MIT/m);

  // Without a decision a taken name is skipped, never replaced.
  const again = await h.api("POST", "/api/skills/import", { files: [files[0]], scope: "user" });
  assert.equal(again.results[0].status, "skipped");
  assert.equal((await h.raw("POST", "/api/skills/import/preview", json({ files: [], scope: "user" }))).status, 400);
});

test("the demo model answers «hei», «hvem er du» and «hva kan du» from the system prompt it got", async (t) => {
  const config = path.join(tempDir(t, "ad-config-"), "agentic-desktop");
  const h = await startHarness(t, { configDir: config, seedDefaults: true });
  const project = await h.project(undefined, { permissionMode: "full" });
  mkdirSync(path.join(project.path, ".git"));
  writeFileSync(path.join(project.path, ".git/HEAD"), "ref: refs/heads/main\n");
  const thread = await h.thread(project.id, "code");
  await send(h, thread.id, "hei");
  const hello = textOf(await h.finished(thread.id));
  assert.match(hello, /^Hei! Jeg er kodeagenten i Agentic Desktop, og jobber i \*\*/);
  assert.match(hello, new RegExp(`${path.basename(project.path)}\\*\\* \\(\`${project.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`\\) på grenen \`main\``));
  assert.match(hello, /Verktøy som er på \(28\):\*\*\n {2}- Filer og søk: `read_file`/);
  assert.match(hello, /Minner:\*\* ingen ennå/, "the global AGENTS.md lines are not counted as memories");
  assert.match(hello, /`edit_file`/);
  assert.match(hello, /din globale `AGENTS.md`/);
  assert.match(hello, /Hva vil du jobbe med\?/);

  // Switching a part off shows in the answer, because it is read from the prompt.
  await h.api("PATCH", "/api/harness", { parts: { askFirst: true } });
  const second = await h.thread(project.id, "code");
  await send(h, second.id, "hva kan du?");
  const can = textOf(await h.finished(second.id));
  assert.match(can, /^Jeg er kodeagenten i Agentic Desktop\. Her kan jeg lese, søke i og forklare koden, skrive og endre kode/);
  assert.match(can, /Jeg spør før store endringer/);

  // «husk at …» goes through remember.
  await send(h, second.id, "husk at testene kjøres med npm test");
  await h.finished(second.id, 2);
  assert.match(readFileSync(path.join(project.path, ".agentic/MEMORY.md"), "utf8"), /- Testene kjøres med npm test\./);

  // Chat: who it is from the Chat base; a bare «hei» keeps the old demo answer.
  const chat = await h.thread(null, "chat");
  await send(h, chat.id, "Hvem er du?");
  assert.match(textOf(await h.finished(chat.id)), /^Jeg er chat-assistenten i Agentic Desktop/);
  await send(h, chat.id, "hei");
  const events = await h.finished(chat.id, 2);
  assert.match(textOf(events), /En funksjon i TypeScript/);

  assert.equal(identityIntent("Hei!"), "greet");
  assert.equal(identityIntent("hei, kan du lage en side?"), null);
  assert.equal(identityIntent("Hva kan du gjøre?"), "what");
});

test("now and then a proposal is made by itself after a turn, and it waits to be seen", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const texts = ["Brukeren liker TypeScript", "Brukeren liker TypeScript.", "Prosjektet bruker Vite", "Brukeren skriver bokmål", "Testene ligger i test/", "Brukeren bruker Linux", "Koden formateres med Prettier", "Brukeren liker korte svar"];
  for (const text of texts) await h.api("POST", "/api/memories", { scope: "global", text });
  const thread = await h.thread(project.id, "code");
  await send(h, thread.id, "hei");
  await h.finished(thread.id);
  const info = await h.api("GET", "/api/harness");
  assert.equal(info.pending.length, 1);
  assert.equal(info.pending[0].scope, "global");
  assert.equal(info.pending[0].ops[0].kind, "merge");
  assert.ok(info.lastUpgradeAt > 0);
  assert.equal((await h.api("GET", "/api/memories")).global.items.length, 8, "nothing is written by itself");
  // Not again the same day.
  await send(h, thread.id, "hei");
  await h.finished(thread.id, 2);
  assert.equal((await h.api("GET", "/api/harness")).pending.length, 1);
  const after = await h.api("POST", "/api/memories/upgrade/dismiss", { scope: "global" });
  assert.equal(after.pending.length, 0);
  // Off: no proposals at all.
  assert.equal((await h.api("PATCH", "/api/harness", { autoUpgrade: false })).autoUpgrade, false);
});
