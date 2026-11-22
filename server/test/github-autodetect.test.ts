// 1.2.0: a GitHub CLI that is installed and signed in is used without setup, until the user
// chooses something else. The client never talks to github.com here: only gh is asked, and gh is
// the fake from fake-github.ts on PATH.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { Settings } from "../../shared/protocol.ts";
import { GitHub } from "../src/github.ts";
import { GITHUB_SECRET } from "../src/github.ts";
import { fakeGh } from "./fake-github.ts";
import { tempDir } from "./helpers.ts";

function secrets(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { get: (key: string) => values.get(key), set: async (key: string, value: string | null) => { if (value === null) values.delete(key); else values.set(key, value); }, values: () => [...values.values()] } as any;
}

function withPath<T>(dir: string, signedIn: boolean, run: (cli: ReturnType<typeof fakeGh>) => Promise<T>): Promise<T> {
  const cli = fakeGh(dir, signedIn);
  const before = { PATH: process.env.PATH, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR };
  process.env.PATH = cli.path;
  process.env.GH_CONFIG_DIR = path.join(dir, "config");
  return run(cli).finally(() => { process.env.PATH = before.PATH; process.env.GH_CONFIG_DIR = before.GH_CONFIG_DIR; });
}

test("never chosen: a signed-in gh is used by itself", async (t) => {
  await withPath(tempDir(t), true, async () => {
    let choice: Settings["githubAuth"] = undefined;
    const github = new GitHub(secrets(), { get: () => choice, set: (value) => { choice = value; } }, "https://api.github.com", true);
    const status = await github.check();
    assert.deepEqual(status, { connected: true, method: "gh", login: "testbruker" });
    assert.equal(choice, undefined, "nothing is saved: it stays the app's own guess");
  });
});

test("gh signed out, a saved token, or an explicit disconnect: no automatic gh", async (t) => {
  const dir = tempDir(t);
  await withPath(dir, false, async (cli) => {
    let choice: Settings["githubAuth"] = undefined;
    const github = new GitHub(secrets(), { get: () => choice, set: (value) => { choice = value; } }, "https://api.github.com", true);
    assert.deepEqual(await github.check(), { connected: false });
    cli.signIn();
    // Disconnected explicitly: never connected again by itself.
    await github.disconnect();
    assert.equal(choice, null);
    assert.deepEqual(await github.check(), { connected: false });
  });
  await withPath(tempDir(t), true, async () => {
    const github = new GitHub(secrets({ [GITHUB_SECRET]: "ghp_" + "x".repeat(36) }), { get: () => undefined, set: () => undefined }, "https://api.github.com", true);
    assert.equal(github.status().method, "token");
  });
  await withPath(tempDir(t), true, async () => {
    // A fake API address (the tests) never looks at gh by itself.
    const github = new GitHub(secrets(), { get: () => undefined, set: () => undefined }, "http://127.0.0.1:9");
    assert.deepEqual(await github.check(), { connected: false });
  });
});
