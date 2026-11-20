// The user's own text for a built-in prompt layer (Forhåndsvisning): placeholders keep the live
// parts live, the model really gets the saved text, and Tilbakestill brings the built-in one back.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fromTemplate, overlay, skillLines, toTemplate } from "../src/agent/prompt-overrides.ts";
import { openaiText, sse, startFakeLlm } from "./fake-llm.ts";
import { startHarness } from "./helpers.ts";

test("placeholders stand in for the live parts, longest first, and are filled in again", () => {
  const vars = { project_path: "/home/kari/api", project: "api", abilities: "read the code, run commands" };
  const text = "You work in /home/kari/api. Project: api. The api-server and rapid things stay. Here you can read the code, run commands.";
  const template = toTemplate(text, vars);
  assert.equal(template, "You work in {{project_path}}. Project: {{project}}. The api-server and rapid things stay. Here you can {{abilities}}.");
  assert.equal(fromTemplate(template, vars), text);
  assert.equal(fromTemplate("Hei {{project}} og {{ukjent}}", vars), "Hei api og {{ukjent}}");
  assert.equal(skillLines("# Skills\nIntro\n- debug: Finn feil\n- tdd: Test først\nLearning: x"), "- debug: Finn feil\n- tdd: Test først");
  const layers = [{ id: "base", title: "Grunn", source: "Innebygd", text }, { id: "env", title: "Miljø", source: "Appen", text: "- Mode: Kode" }];
  const plain = overlay(layers, {}, "code/project", { base: vars });
  assert.deepEqual(plain.map((l) => [l.editable, l.overridden]), [[true, false], [false, false]]);
  assert.equal(plain[0].template, template);
  const own = overlay(layers, { "code/project/base": "Du jobber i {{project}}.", "code/none/base": "ikke denne" }, "code/project", { base: vars });
  assert.equal(own[0].text, "Du jobber i api.");
  assert.equal(own[0].overridden, true);
  assert.equal(own[0].template, "Du jobber i {{project}}.");
});

test("a saved layer text is what the model gets, per mode and variant, until it is reset", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "fake" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  llm.always(sse(openaiText("Ok.")));
  const project = await h.project(undefined, { name: "Butikk" });
  const preview = async (query: string) => (await h.api("GET", `/api/harness/preview?${query}`)).layers as any[];
  const code = `mode=code&projectId=${project.id}`;

  // The built-in base is editable and comes with its live parts as placeholders.
  const base = (await preview(code)).find((l) => l.id === "base");
  assert.equal(base.editable, true);
  assert.equal(base.overridden, false);
  assert.match(base.template, /working in the project folder \{\{project_path\}\}/);
  assert.match(base.template, /Here you can \{\{abilities\}\}/);
  assert.match(base.template, /Kode can \{\{kode_abilities\}\}/);
  assert.match(base.text, /fenced Markdown block with the language chart/);
  assert.equal((await preview(code)).find((l) => l.id === "env").editable, false);

  // Save an own text for Kode with a project.
  await h.api("PUT", "/api/harness/overrides", { mode: "code", projectId: project.id, layer: "base", text: "EGEN-GRUNN for {{project}} i {{project_path}}.\nDu kan {{abilities}}." });
  const mine = (await preview(code)).find((l) => l.id === "base");
  assert.equal(mine.overridden, true);
  assert.match(mine.text, new RegExp(`^EGEN-GRUNN for Butikk i ${project.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\nDu kan read, search and explain the code`));
  assert.equal(mine.template, "EGEN-GRUNN for {{project}} i {{project_path}}.\nDu kan {{abilities}}.");
  // Kode without a project and Chat keep their built-in text.
  assert.match((await preview("mode=code")).find((l) => l.id === "base").text, /^You are the coding agent/);
  assert.match((await preview("mode=chat")).find((l) => l.id === "chat-base").text, /^You are the chat assistant/);

  // A real turn in that project sends the saved text, with the other layers as before.
  const thread = await h.thread(project.id, "code", model.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "hei" });
  await h.finished(thread.id);
  const system = llm.requests.at(-1)!.body.messages[0].content as string;
  assert.match(system, /^EGEN-GRUNN for Butikk/);
  assert.doesNotMatch(system, /You are the coding agent in Agentic Desktop/);
  assert.doesNotMatch(system, /fenced Markdown block with the language chart/);
  assert.match(system, /# Environment/);

  // Chat's base keeps the environment and the tool lines live through placeholders.
  const chatBase = (await preview("mode=chat")).find((l) => l.id === "chat-base");
  assert.match(chatBase.template, /\{\{environment\}\}/);
  assert.match(chatBase.text, /fenced Markdown block with the language chart/);
  await h.api("PUT", "/api/harness/overrides", { mode: "chat", layer: "chat-base", text: "MIN CHAT.\n{{environment}}" });
  assert.match((await preview("mode=chat")).find((l) => l.id === "chat-base").text, /^MIN CHAT\.\n# Environment\n- Mode: Chat/);

  // Refused: a layer that is live state, an unknown layer, an empty text, a secret.
  await assert.rejects(h.api("PUT", "/api/harness/overrides", { mode: "code", projectId: project.id, layer: "env", text: "x" }), /400/);
  await assert.rejects(h.api("PUT", "/api/harness/overrides", { mode: "code", projectId: project.id, layer: "base", text: "   " }), /400/);
  await assert.rejects(h.api("PUT", "/api/harness/overrides", { mode: "code", projectId: project.id, layer: "base", text: "api_key = sk-abcdefghijklmnopqrstuvwxyz0123456789" }), /400/);
  await assert.rejects(h.api("PUT", "/api/harness/overrides", { mode: "chat", layer: "base", text: "x" }), /404/);

  // Tilbakestill one layer, then everything for a mode.
  await h.api("DELETE", `/api/harness/overrides?${code}&layer=base`);
  assert.match((await preview(code)).find((l) => l.id === "base").text, /^You are the coding agent/);
  await h.api("DELETE", "/api/harness/overrides?mode=chat");
  assert.match((await preview("mode=chat")).find((l) => l.id === "chat-base").text, /^You are the chat assistant/);
});
