import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { copySystemInstructions } from "../../scripts/system-instructions.ts";
import { DEFAULT_AGENTS_MD, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, MAX_CHAT_FIELD } from "../src/agent/harness.ts";
import { REPO_ROOT } from "../src/config.ts";
import { tempDir } from "./helpers.ts";

test("shipped defaults come from the reviewable Markdown sources", () => {
  assert.equal(DEFAULT_AGENTS_MD, readFileSync(path.join(REPO_ROOT, "docs/system-instructions/code.md"), "utf8"));
  assert.equal(DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, readFileSync(path.join(REPO_ROOT, "docs/system-instructions/chat.md"), "utf8").trim());
  assert.ok(DEFAULT_CHAT_SYSTEM_INSTRUCTIONS.length <= MAX_CHAT_FIELD);
});

test("packaging copies the instruction assets and the server loads them from AD_APP_ROOT", (t) => {
  const appRoot = tempDir(t, "ad-instructions-package-");
  copySystemInstructions(REPO_ROOT, appRoot);
  const docs = path.join(appRoot, "docs/system-instructions");
  assert.equal(readFileSync(path.join(docs, "code.md"), "utf8"), DEFAULT_AGENTS_MD);
  assert.equal(readFileSync(path.join(docs, "chat.md"), "utf8").trim(), DEFAULT_CHAT_SYSTEM_INSTRUCTIONS);
  assert.match(readFileSync(path.join(docs, "README.md"), "utf8"), /redigerbare standardene/);

  // Distinct content proves the loader uses the packaged app root, with no accidental fallback
  // to the checkout or to the bundled server's location. No model requests are made.
  const code = "# Pakket Kode-standard\n\nBruk appens faktiske verktøy.\n";
  const chat = "Svar kort fra den pakkede Chat-standarden.";
  writeFileSync(path.join(docs, "code.md"), code);
  writeFileSync(path.join(docs, "chat.md"), `${chat}\n`);
  const moduleUrl = new URL("../src/agent/harness.ts", import.meta.url).href;
  const script = `
    const { DEFAULT_AGENTS_MD, DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, HarnessStore } = await import(${JSON.stringify(moduleUrl)});
    const store = new HarnessStore(process.env.AD_DATA_DIR);
    store.setChat({ instructions: "Egen tekst", about: "Egen profil" });
    const reset = store.resetChatInstructions();
    console.log(JSON.stringify({ code: DEFAULT_AGENTS_MD, chat: DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, reset }));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, AD_APP_ROOT: appRoot, AD_DATA_DIR: appRoot },
    encoding: "utf8",
  });
  const loaded = JSON.parse(output);
  assert.equal(loaded.code, code);
  assert.equal(loaded.chat, chat);
  assert.equal(loaded.reset.instructions, chat);
  assert.equal(loaded.reset.about, "Egen profil");
});
