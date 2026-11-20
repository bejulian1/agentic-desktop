// Round 3 of the wish list: the global folder and .agentic/ in the project, project settings,
// and moving a project to another folder. XDG_CONFIG_HOME is never the user's own.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness, tempDir } from "./helpers.ts";

test("the project's .agentic/ wins over the global folder: settings, instructions and skills", async (t) => {
  const config = path.join(tempDir(t, "ad-config-"), "agentic-desktop");
  const userSkills = path.join(config, "skills");
  mkdirSync(path.join(userSkills, "felles"), { recursive: true });
  writeFileSync(path.join(userSkills, "felles/SKILL.md"), "---\nname: felles\ndescription: Fra den globale mappen\n---\nx");
  writeFileSync(path.join(config, "AGENTS.md"), "GLOBAL-REGEL");
  writeFileSync(path.join(config, "settings.json"), JSON.stringify({ model: "Fake global", permissionMode: "full", personality: "grundig" }));
  const h = await startHarness(t, { configDir: config, userSkillsDir: userSkills });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "k" });
  const global = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake global", model: "fake-g", contextWindow: 100_000 });
  const local = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake lokal", model: "fake-l", contextWindow: 100_000 });

  const dir = tempDir(t, "ad-project-");
  mkdirSync(path.join(dir, ".agentic/skills/egen"), { recursive: true });
  writeFileSync(path.join(dir, ".agentic/skills/egen/SKILL.md"), "---\nname: egen\ndescription: Fra prosjektet\n---\nx");
  writeFileSync(path.join(dir, ".agentic/settings.json"), JSON.stringify({ model: "fake-l", personality: "kort", ukjent: 1 }));
  writeFileSync(path.join(dir, "AGENTS.md"), "PROSJEKT-REGEL");

  const project = await h.api("POST", "/api/projects", { name: "Lag", path: dir });
  assert.equal(project.permissionMode, "full", "from the global settings.json, since the project has none");
  const cfg = await h.api("GET", `/api/projects/${project.id}/config`);
  assert.deepEqual(cfg.effective, { model: "fake-l", permissionMode: "full", personality: "kort" });
  assert.deepEqual(cfg.instructionFiles, [path.join(config, "AGENTS.md"), "AGENTS.md"]);

  const thread = await h.api("POST", "/api/threads", { projectId: project.id, mode: "code" });
  assert.equal(thread.modelId, local.id, "the project's settings.json picks the model");
  assert.equal(thread.personality, "kort");
  const chat = await h.api("POST", "/api/threads", { projectId: null, mode: "chat" });
  assert.equal(chat.modelId, global.id, "outside a project, the global one applies");

  await h.api("PUT", `/api/projects/${project.id}/instructions`, { text: "AGENTIC-REGEL" });
  assert.equal(readFileSync(path.join(dir, ".agentic/AGENTS.md"), "utf8"), "AGENTIC-REGEL");
  llm.reply(sse(openaiText("ok")));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hei" });
  await h.finished(thread.id);
  const system: string = llm.requests[0].body.messages[0].content;
  const order = ["GLOBAL-REGEL", "PROSJEKT-REGEL", "AGENTIC-REGEL", "the project wins"].map((x) => system.indexOf(x));
  assert.ok(order.every((at) => at >= 0), system);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "global first, the project's own last");
  assert.match(system, /egen: Fra prosjektet/);
  assert.match(system, /felles: Fra den globale mappen/);

  // The project's default model beats its settings.json.
  await h.api("PATCH", `/api/projects/${project.id}`, { defaultModelId: global.id });
  assert.equal((await h.api("POST", "/api/threads", { projectId: project.id, mode: "code" })).modelId, global.id);
});

test("project settings: colour, icon and default model are checked, and the folder can move", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const socket = await h.socket();
  const changed = await h.api("PATCH", `/api/projects/${project.id}`, { name: " Nytt navn ", color: "green", icon: "game", defaultModelId: "mock-demo" });
  assert.deepEqual([changed.name, changed.color, changed.icon, changed.defaultModelId], ["Nytt navn", "green", "game", "mock-demo"]);
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { color: "rosa" }), /400/);
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { icon: "<svg>" }), /400/);
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { name: "" }), /400/);
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { defaultModelId: "finnes-ikke" }), /400/);

  const target = path.join(tempDir(t, "ad-move-"), "ny-mappe");
  const moved = await h.api("PATCH", `/api/projects/${project.id}`, { path: target });
  assert.equal(moved.path, target);
  assert.ok(existsSync(target), "the folder is made if missing");
  await socket.waitFor((m) => m.type === "project.changed" && m.project.path === target);
  const thread = await h.thread(project.id, "code");
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "lag en side" });
  await h.finished(thread.id);
  assert.ok(existsSync(path.join(target, "index.html")), "the agent works in the new folder");

  // The same guard as a new project.
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { path: "/" }), /403/);
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { path: "relativ/sti" }), /403/);
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { path: h.app.config.dataDir }), /403/);
  const other = await h.project();
  await assert.rejects(h.api("PATCH", `/api/projects/${project.id}`, { path: other.path }), /409/);
});

test("instructions in .agentic/ go through the path guard", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const outside = tempDir(t, "ad-outside-");
  const { symlinkSync } = await import("node:fs");
  symlinkSync(outside, path.join(project.path, ".agentic"));
  await assert.rejects(h.api("PUT", `/api/projects/${project.id}/instructions`, { text: "x" }), /403/);
  assert.equal(existsSync(path.join(outside, "AGENTS.md")), false);
});
