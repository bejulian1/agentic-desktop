// Hooks (server/src/hooks.ts) on their own: the matcher, validation, storage, the exit-code and
// stdout contract, timeouts and cancellation. Every hook here only touches a temporary folder.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { matchesTool } from "../../shared/hooks.ts";
import { Hooks, validateHook, type HookCall } from "../src/hooks.ts";
import { tempDir, until } from "./helpers.ts";

function makeHooks(t: Parameters<typeof tempDir>[0], env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" }) {
  const dataDir = tempDir(t, "ad-hooks-data-");
  const home = tempDir(t, "ad-hooks-home-");
  let changes = 0;
  const hooks = new Hooks({ dataDir, env: () => env, homeDir: home, changed: () => void changes++ });
  t.after(() => hooks.close());
  return { hooks, dataDir, home, changes: () => changes };
}

function call(partial: Partial<HookCall> & Pick<HookCall, "event">): HookCall {
  return { mode: "code", threadId: "thread-1", signal: new AbortController().signal, payload: {}, ...partial };
}

const quote = (file: string) => `'${file.replace(/'/g, `'\\''`)}'`;

test("matcher: exact names, | alternatives, * globs, .* from Claude Code, empty and * for all", () => {
  assert.equal(matchesTool("", "run_command"), true);
  assert.equal(matchesTool("*", "mcp__github__create_issue"), true);
  assert.equal(matchesTool("run_command", "run_command"), true);
  assert.equal(matchesTool("run_command", "run_command_x"), false, "the whole name has to match");
  assert.equal(matchesTool("run", "run_command"), false);
  assert.equal(matchesTool("edit_file|write_file", "write_file"), true);
  assert.equal(matchesTool("edit_file | write_file", "edit_file"), true, "spaces around | are ignored");
  assert.equal(matchesTool("edit_file|write_file", "read_file"), false);
  assert.equal(matchesTool("mcp__github__*", "mcp__github__create_issue"), true);
  assert.equal(matchesTool("mcp__github__*", "mcp__gitlab__create_issue"), false);
  assert.equal(matchesTool("mcp__*__search", "mcp__docs__search"), true);
  assert.equal(matchesTool("mcp__github__.*", "mcp__github__list"), true, "Claude Code's regex form");
  assert.equal(matchesTool("Edit", "edit_file"), false, "case matters");
  assert.equal(matchesTool("read.file", "readXfile"), false, "a dot is literal");
  assert.equal(matchesTool("a(b", "a(b"), true, "regex characters are literal");
  assert.equal(matchesTool("|", "run_command"), false, "only empty alternatives match nothing");
});

test("validation refuses bad events, timeouts, fields and commands, and fills in defaults", () => {
  const ok = validateHook({ event: "PreToolUse", command: "true" }, "id1");
  assert.deepEqual(ok, { id: "id1", name: "true", event: "PreToolUse", matcher: "", command: "true", timeoutSeconds: 30, enabled: true, modes: ["chat", "code"] });
  assert.equal(validateHook({ event: "Stop", command: "true", matcher: "run_command" }, "x").matcher, "", "only tool events keep a matcher");
  for (const bad of [
    {},
    { event: "PreToolUse" },
    { event: "PreToolUse", command: "   " },
    { event: "Notification", command: "true" },
    { event: "PreToolUse", command: "true", timeoutSeconds: 0 },
    { event: "PreToolUse", command: "true", timeoutSeconds: 301 },
    { event: "PreToolUse", command: "true", timeoutSeconds: 1.5 },
    { event: "PreToolUse", command: "true", timeoutSeconds: "30" },
    { event: "PreToolUse", command: "true", modes: [] },
    { event: "PreToolUse", command: "true", modes: ["terminal"] },
    { event: "PreToolUse", command: "true", enabled: "yes" },
    { event: "PreToolUse", command: "true", shell: "zsh" },
    { event: "PreToolUse", command: "x".repeat(4001) },
    { event: "PreToolUse", command: "true", matcher: "a\nb" },
  ]) assert.throws(() => validateHook(bad, "id"), (err: any) => err.status === 400, JSON.stringify(bad).slice(0, 80));
});

test("storage: written 0600 to hooks.json, read back on start, ordered, and broken entries skipped", (t) => {
  const { hooks, dataDir, changes } = makeHooks(t);
  hooks.create({ name: "A", event: "PreToolUse", command: "true" });
  hooks.create({ name: "B", event: "Stop", command: "true", modes: ["chat"] });
  const file = path.join(dataDir, "hooks.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(changes() >= 2, "every change is published");
  const [a, b] = hooks.state().hooks;
  hooks.update(a.id, { enabled: false });
  hooks.reorder([b.id, a.id]);
  assert.throws(() => hooks.reorder([a.id]), /400|alle/);
  const again = new Hooks({ dataDir, env: () => ({}), changed: () => undefined });
  t.after(() => again.close());
  assert.deepEqual(again.state().hooks.map((h) => [h.name, h.enabled, h.modes]), [["B", true, ["chat"]], ["A", false, ["chat", "code"]]]);
  hooks.remove(a.id);
  assert.throws(() => hooks.remove(a.id), (err: any) => err.status === 404);

  // A hand-edited file with one bad entry: the rest still load, with a warning.
  writeFileSync(file, JSON.stringify({ version: 1, hooks: [{ id: "good", event: "Stop", command: "true" }, { id: "bad", event: "Nope", command: "true" }] }));
  const edited = new Hooks({ dataDir, env: () => ({}), changed: () => undefined });
  t.after(() => edited.close());
  assert.deepEqual(edited.state().hooks.map((h) => h.id), ["good"]);
  assert.equal(edited.state().warnings.length, 1);
});

test("stdin JSON, cwd and AD_HOOK_* variables; home folder when there is no project", async (t) => {
  const { hooks, home } = makeHooks(t);
  const out = tempDir(t, "ad-hooks-out-");
  hooks.create({ name: "Dump", event: "PreToolUse", matcher: "run_command", command: `cat > ${quote(path.join(out, "stdin.json"))}; pwd > ${quote(path.join(out, "pwd"))}; env > ${quote(path.join(out, "env"))}` });
  const project = tempDir(t, "ad-hooks-project-");
  const batch = await hooks.run(call({ event: "PreToolUse", cwd: project, toolName: "run_command", payload: { tool_name: "run_command", tool_input: { command: "ls" }, tool_use_id: "c1" } }));
  assert.equal(batch.results[0].run.outcome, "ok");
  assert.equal(batch.blocked, undefined);
  const stdin = JSON.parse(readFileSync(path.join(out, "stdin.json"), "utf8"));
  assert.deepEqual(stdin, { hook_event_name: "PreToolUse", session_id: "thread-1", cwd: project, mode: "code", tool_name: "run_command", tool_input: { command: "ls" }, tool_use_id: "c1" });
  assert.equal(readFileSync(path.join(out, "pwd"), "utf8").trim(), project);
  const env = readFileSync(path.join(out, "env"), "utf8");
  for (const line of ["AD_HOOK_EVENT=PreToolUse", "AD_HOOK_TOOL_NAME=run_command", "AD_HOOK_MODE=code", "AD_HOOK_THREAD_ID=thread-1", `CLAUDE_PROJECT_DIR=${project}`]) assert.ok(env.includes(line), line);

  await hooks.run(call({ event: "PreToolUse", mode: "chat", toolName: "run_command", payload: {} }));
  assert.equal(readFileSync(path.join(out, "pwd"), "utf8").trim(), home);
  assert.equal(JSON.parse(readFileSync(path.join(out, "stdin.json"), "utf8")).cwd, home);
  assert.equal(readFileSync(path.join(out, "env"), "utf8").includes("CLAUDE_PROJECT_DIR"), false);
});

test("exit codes: 2 blocks with stderr, JSON can block, other codes are non-blocking errors", async (t) => {
  const { hooks } = makeHooks(t);
  const pre = hooks.create({ name: "Sperre", event: "PreToolUse", command: `echo "nei takk" >&2; exit 2` }).hooks[0];
  let batch = await hooks.run(call({ event: "PreToolUse", toolName: "write_file" }));
  assert.equal(batch.blocked?.block, "nei takk");
  assert.equal(batch.blocked?.run.exitCode, 2);
  assert.equal(hooks.state().hooks[0].lastRun?.outcome, "blocked");

  hooks.update(pre.id, { command: `echo '{"decision":"block","reason":"fra json"}'` });
  batch = await hooks.run(call({ event: "PreToolUse", toolName: "write_file" }));
  assert.equal(batch.blocked?.block, "fra json");

  hooks.update(pre.id, { command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"nyere form"}}'` });
  batch = await hooks.run(call({ event: "PreToolUse", toolName: "write_file" }));
  assert.equal(batch.blocked?.block, "nyere form");

  hooks.update(pre.id, { command: `echo "gikk galt" >&2; exit 3` });
  batch = await hooks.run(call({ event: "PreToolUse", toolName: "write_file" }));
  assert.equal(batch.blocked, undefined);
  assert.equal(batch.results[0].run.outcome, "error");
  assert.match(batch.results[0].message!, /Sperre.*kode 3.*gikk galt/s);

  hooks.update(pre.id, { command: "exit 0" });
  batch = await hooks.run(call({ event: "PreToolUse", toolName: "write_file" }));
  assert.equal(batch.results[0].run.outcome, "ok");
  assert.equal(batch.results[0].message, undefined);
});

test("UserPromptSubmit context, PostToolUse feedback, and the first block wins", async (t) => {
  const { hooks } = makeHooks(t);
  const out = tempDir(t, "ad-hooks-out-");
  hooks.create({ name: "Kontekst", event: "UserPromptSubmit", command: "echo 'Grenen er main'" });
  hooks.create({ name: "Json-kontekst", event: "UserPromptSubmit", command: `echo '{"additionalContext":"Fra JSON"}'` });
  let batch = await hooks.run(call({ event: "UserPromptSubmit", payload: { prompt: "hei" } }));
  assert.deepEqual(batch.results.map((r) => r.context), ["Grenen er main", "Fra JSON"]);

  hooks.create({ name: "Tilbakemelding", event: "PostToolUse", matcher: "edit_file", command: `echo "husk testene" >&2; exit 2` });
  batch = await hooks.run(call({ event: "PostToolUse", toolName: "edit_file" }));
  assert.equal(batch.blocked, undefined, "PostToolUse never blocks: the tool already ran");
  assert.equal(batch.results[0].feedback, "husk testene");
  assert.equal((await hooks.run(call({ event: "PostToolUse", toolName: "read_file" }))).results.length, 0, "matcher");

  const marker = path.join(out, "second-ran");
  hooks.create({ name: "Først", event: "PreToolUse", command: `echo stopp >&2; exit 2` });
  hooks.create({ name: "Etter", event: "PreToolUse", command: `touch ${quote(marker)}` });
  batch = await hooks.run(call({ event: "PreToolUse", toolName: "x" }));
  assert.equal(batch.blocked?.hook.name, "Først");
  assert.equal(batch.results.length, 1);
  assert.equal(existsSync(marker), false, "hooks after a block do not run");
});

test("disabled hooks and hooks for the other mode do not run", async (t) => {
  const { hooks } = makeHooks(t);
  const { id } = hooks.create({ name: "Av", event: "Stop", command: "true", enabled: false }).hooks[0];
  hooks.create({ name: "Bare chat", event: "Stop", command: "true", modes: ["chat"] });
  assert.equal(hooks.has("Stop", "code"), false);
  assert.deepEqual(hooks.matching("Stop", "chat").map((h) => h.name), ["Bare chat"]);
  hooks.update(id, { enabled: true });
  assert.deepEqual(hooks.matching("Stop", "code").map((h) => h.name), ["Av"]);
});

test("a timeout kills the whole process group, and an abort cancels a running hook", async (t) => {
  const { hooks } = makeHooks(t);
  const out = tempDir(t, "ad-hooks-out-");
  const pidFile = path.join(out, "pid");
  hooks.create({ name: "Treg", event: "Stop", timeoutSeconds: 1, command: `sleep 60 & echo $! > ${quote(pidFile)}; sleep 60` });
  const started = Date.now();
  const batch = await hooks.run(call({ event: "Stop" }));
  assert.equal(batch.results[0].run.outcome, "timeout");
  assert.ok(Date.now() - started < 5000, `stopped in time (${Date.now() - started} ms)`);
  assert.match(batch.results[0].message!, /for lang tid/);
  const pid = Number(readFileSync(pidFile, "utf8"));
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, "the background child to be gone", 5000);

  const abort = new AbortController();
  const running = hooks.run(call({ event: "Stop", signal: abort.signal }));
  setTimeout(() => abort.abort(), 150);
  const cancelledAt = Date.now();
  const cancelled = await running;
  assert.equal(cancelled.results[0].run.outcome, "cancelled");
  assert.ok(Date.now() - cancelledAt < 3000);
});

test("«Test» runs a draft or a saved hook once with a sample payload and says what it would do", async (t) => {
  const { hooks } = makeHooks(t);
  const draft = await hooks.test({ event: "PreToolUse", matcher: "run_command", command: `grep -q '"command":"echo hei"' && { echo "sett" >&2; exit 2; }` });
  assert.equal(draft.exitCode, 2);
  assert.equal(draft.stderr.trim(), "sett");
  assert.match(draft.effect, /stoppet verktøykallet/);
  assert.equal(draft.effectKey, "Ville stoppet verktøykallet. Modellen ville fått: {text}");
  assert.deepEqual(draft.effectValues, { text: "sett" });
  assert.equal(hooks.state().hooks.length, 0, "a draft is not saved");
  const saved = hooks.create({ event: "UserPromptSubmit", command: "echo ekstra" }).hooks[0];
  const { lastRun: _lastRun, ...savedDraft } = saved;
  const result = await hooks.test(savedDraft);
  assert.match(result.effect, /kontekst/);
  assert.equal(hooks.state().hooks[0].lastRun?.test, true);
});
