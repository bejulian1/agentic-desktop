// Denne datamaskinen: Kode without a project works in the user's home folder, with file and
// command tools, the usual approvals, and the places where keys and logins live protected.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isProtectedCommand, isProtectedPath } from "../src/paths.ts";
import { openaiText, openaiToolCall, sse, startFakeLlm, type FakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, tempDir, type Harness } from "./helpers.ts";

function toolThenText(llm: FakeLlm, name: string, input: unknown, answer = "Ferdig.") {
  llm.always((req, res) => {
    const last = req.body.messages.at(-1);
    return sse(last?.role === "tool" ? openaiText(answer) : openaiToolCall(name, input, "call-1"))(req, res);
  });
}

async function setup(t: Parameters<typeof startHarness>[0]) {
  const home = tempDir(t, "ad-home-");
  mkdirSync(path.join(home, "prosjekter/prism"), { recursive: true });
  writeFileSync(path.join(home, "prosjekter/prism/README.md"), "# Prism\nEn liten app.\n");
  mkdirSync(path.join(home, ".ssh"));
  writeFileSync(path.join(home, ".ssh/id_ed25519"), "HEMMELIG-NOKKEL-MARKOR\n");
  const h = await startHarness(t, { localWorkspace: true, homeDir: home });
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "fake" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake", model: "fake", contextWindow: 100_000 });
  const thread = await h.thread(null, "code", model.id);
  return { h, llm, home, thread };
}

const toolResult = (events: Awaited<ReturnType<Harness["finished"]>>) => ofType(events, "tool.finished").at(-1)!;

test("Kode without a project has file and command tools in the home folder, and says so", async (t) => {
  const { h, llm, home } = await setup(t);
  const preview = await h.api("GET", "/api/harness/preview?mode=code");
  for (const name of ["read_file", "write_file", "edit_file", "list_dir", "search", "glob", "run_command"]) assert.ok(preview.tools.includes(name), `${name} is offered`);
  // What needs a stored project is left out.
  for (const name of ["thread_create", "task_add", "browser_navigate"]) assert.equal(preview.tools.includes(name), false, `${name} needs a project`);
  const base = preview.layers.find((l: any) => l.id === "base").text as string;
  assert.match(base, new RegExp(`your working folder is their home folder ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(base, /Here you can read, search and explain the code, write and change code, fix bugs and refactor, run commands, tests and builds/);
  assert.match(base, /never search or list the entire home folder in one call/);
  assert.doesNotMatch(base, /the file, command and browser tools are not offered yet/);
  const env = preview.layers.find((l: any) => l.id === "env").text as string;
  assert.match(env, /Project: none selected; working in the user's home folder/);
  assert.match(env, /Top level of the folder: .*prosjekter\//);
  assert.equal(llm.requests.length, 0);
});

test("a turn on Denne datamaskinen reads files and runs commands, with the usual approvals", async (t) => {
  const { h, llm, home, thread } = await setup(t);
  // Reading does not ask.
  toolThenText(llm, "read_file", { path: "prosjekter/prism/README.md" });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hva er Prism?" });
  let events = await h.finished(thread.id, 1);
  assert.equal(toolResult(events).status, "done");
  assert.match(toolResult(events).result ?? "", /En liten app/);
  assert.equal(ofType(events, "approval.requested").length, 0);
  assert.match(llm.requests[0].body.messages[0].content, /working directly on the user's machine/);

  // A command asks in the default mode, runs in the home folder after a yes, and "allow always" sticks.
  toolThenText(llm, "run_command", { command: "pwd && ls prosjekter" });
  const stop = h.approveAll(thread.id, "allow-always");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Hva ligger i prosjekter?" });
  events = await h.finished(thread.id, 2);
  stop();
  assert.equal(ofType(events, "approval.requested").length, 1);
  assert.equal(toolResult(events).status, "done");
  assert.match(toolResult(events).result ?? "", new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\nprism`));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "En gang til." });
  events = await h.finished(thread.id, 3);
  assert.equal(ofType(events, "approval.requested").length, 1, "the same command is allowed from now on");

  // Writing a file asks, then lands in the home folder.
  toolThenText(llm, "write_file", { path: "prosjekter/prism/notat.md", content: "Hei\n" });
  const stopWrite = h.approveAll(thread.id);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Lag et notat." });
  events = await h.finished(thread.id, 4);
  stopWrite();
  assert.equal(readFileSync(path.join(home, "prosjekter/prism/notat.md"), "utf8"), "Hei\n");
  assert.equal(ofType(events, "turn.changes").at(-1)!.files[0].path, "prosjekter/prism/notat.md");
});

test("keys and logins under the home folder always ask, and search leaves them out", async (t) => {
  const { h, llm, thread } = await setup(t);
  // A protected file is not read without a yes, even though reading normally never asks.
  toolThenText(llm, "read_file", { path: ".ssh/id_ed25519" });
  const stop = h.approveAll(thread.id, "deny");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Les nøkkelen min." });
  let events = await h.finished(thread.id, 1);
  stop();
  assert.equal(ofType(events, "approval.requested").length, 1);
  assert.equal(ofType(events, "approval.requested")[0].canAllowAlways, false);
  assert.equal(toolResult(events).status, "denied");
  assert.doesNotMatch(JSON.stringify(llm.requests.map((r) => r.body)), /HEMMELIG-NOKKEL-MARKOR/);

  // Searching the home folder does not go into it either.
  toolThenText(llm, "search", { pattern: "MARKOR|liten app", path: "." });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Søk." });
  events = await h.finished(thread.id, 2);
  assert.match(toolResult(events).result ?? "", /README\.md/);
  assert.doesNotMatch(toolResult(events).result ?? "", /HEMMELIG|id_ed25519/);

  // The app's own data is out of reach for the file tools.
  toolThenText(llm, "list_dir", { path: path.relative(await h.api("GET", "/api/local/files/root").then((r: any) => r.path), h.app.config.dataDir) || "." });
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "List appens data." });
  events = await h.finished(thread.id, 3);
  assert.notEqual(toolResult(events).status, "done");

  for (const rel of [".ssh/id_rsa", ".aws/credentials", ".config/gh/hosts.yml", ".mozilla/firefox/x/cookies.sqlite", ".config/agentic-desktop/AGENTS.md", ".netrc"]) assert.equal(isProtectedPath(rel), true, rel);
  for (const rel of ["prosjekter/prism/README.md", ".config/Code/settings.json", "Dokumenter/ssh-notater.md"]) assert.equal(isProtectedPath(rel), false, rel);
  assert.equal(isProtectedCommand("cat ~/.ssh/id_ed25519", "/tmp/x"), true);
  assert.equal(isProtectedCommand("ls ~/prosjekter", "/tmp/x"), false);
});

test("without the home folder as a workspace, Kode without a project answers with text as before", async (t) => {
  const h = await startHarness(t);
  const preview = await h.api("GET", "/api/harness/preview?mode=code");
  assert.deepEqual(preview.tools, ["ui_mod"]);
  assert.match(preview.layers.find((l: any) => l.id === "base").text, /no project is selected, so the file, command and browser tools are not offered yet/);
  assert.equal(existsSync(path.join(h.app.config.dataDir, "prosjekter")), false);
});
