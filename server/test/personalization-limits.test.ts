import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { countChatWords, effortSteps, MAX_CHAT_WORDS } from "../../shared/protocol.ts";
import { HarnessStore } from "../src/agent/harness.ts";
import { reasoningOptions } from "../src/providers/openai-compatible.ts";
import { startHarness } from "./helpers.ts";

test("10 000 words per personal field persist and reach Chat without leaking to Code", async (t) => {
  const h = await startHarness(t);
  const instructions = Array.from({ length: MAX_CHAT_WORDS }, (_, i) => `regel${i}`).join(" ");
  const about = Array.from({ length: MAX_CHAT_WORDS }, (_, i) => `fakta${i}`).join("\n");
  const saved = await h.api("PUT", "/api/chat-personal", { instructions, about });
  assert.equal(saved.instructions, instructions);
  assert.equal(saved.about, about);
  const initial = await h.api("GET", "/api/chat-personal");
  assert.equal(initial.defaults.maxWords, 10_000);
  const config = JSON.parse(readFileSync(path.join(h.app.config.dataDir, "harness.json"), "utf8"));
  assert.equal(config.chat.about, about);
  const reopened = new HarnessStore(h.app.config.dataDir);
  assert.equal(reopened.state().chat.instructions, instructions);
  const chat = await h.api("GET", "/api/harness/preview?mode=chat");
  assert.match(chat.layers.map((l: any) => l.text).join("\n"), /regel9999/);
  assert.match(chat.layers.map((l: any) => l.text).join("\n"), /fakta9999/);
  const code = await h.api("GET", "/api/harness/preview?mode=code");
  assert.doesNotMatch(code.layers.map((l: any) => l.text).join("\n"), /regel9999|fakta9999/);
  for (const field of ["instructions", "about"]) {
    await assert.rejects(h.api("PUT", "/api/chat-personal", { [field]: `${instructions} ekstra` }), /10000 ord/);
  }
  assert.equal((await h.api("GET", "/api/chat-personal")).personal.instructions, instructions);
  assert.equal(countChatWords("  en\tto\n\ntre\u00a0fire  "), 4);
});

test("Ekstra høy is a real step before Maks and reaches OpenRouter without being reduced to high", () => {
  assert.deepEqual(effortSteps("openai-compatible", {}, "https://openrouter.ai/api/v1"), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(reasoningOptions("https://openrouter.ai/api/v1", "xhigh"), { reasoning: { effort: "xhigh" } });
  assert.deepEqual(reasoningOptions("https://openrouter.ai/api/v1", "max"), { reasoning: { effort: "max" } });
  assert.deepEqual(reasoningOptions("https://openrouter.ai/api/v1", "none"), { reasoning: { effort: "none" } });
  assert.deepEqual(reasoningOptions("http://localhost:1234/v1", "xhigh"), { reasoning_effort: "high" });
  assert.deepEqual(effortSteps("openai-compatible", {}, "https://openrouter.ai.example/api/v1"), ["low", "medium", "high"]);
});
