import { constants, lstatSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runProgram } from "./agent/command.ts";
import { guardPath, isSensitiveHomePath } from "./paths.ts";

async function git(args: string[], cwd: string, signal: AbortSignal, extra: Record<string, string> = {}) {
  signal.throwIfAborted();
  const result = await runProgram("git", args, {
    cwd, signal, timeoutMs: 120_000, onOutput: () => {},
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: path.dirname(cwd), ...extra,
    },
  });
  signal.throwIfAborted();
  if (result.exitCode !== 0 || result.timedOut) throw new Error("Git command failed.");
  return result;
}

export function githubCloneTarget(root: string, directory: string, dataDir: string) {
  if (path.isAbsolute(directory) || directory.split(/[\\/]/).some(part => part === ".." || part === ".git") || /[\\\u0000-\u001f\u007f]/.test(directory)) {
    throw new Error("Use a relative clone directory inside the workspace, without '..' or '.git' components.");
  }
  const target = guardPath(root, directory, dataDir);
  if (target.rel === "." || target.rel.split(path.sep).includes(".git") || isSensitiveHomePath(target.rel)) {
    throw new Error("Choose a regular subfolder inside the workspace for the clone.");
  }
  return target;
}

export async function cloneGitHub(repo: string, root: string, directory: string, dataDir: string, token: string, web: string, signal: AbortSignal) {
  const target = githubCloneTarget(root, directory, dataDir);
  if (lstatSync(target.abs, { throwIfNoEntry: false })) throw new Error("The clone directory already exists. Choose a new subfolder.");
  let parent = path.dirname(target.abs);
  while (!lstatSync(parent, { throwIfNoEntry: false })) parent = path.dirname(parent);
  const [leaf, ...missing] = path.relative(parent, target.abs).split(path.sep);
  // On Linux pin the existing parent so replacing a directory with a symlink while Git runs
  // cannot redirect the clone or its installation. Git writes into a private staging directory.
  const handle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    .catch(() => { throw new Error("Could not open the clone directory's parent inside the workspace."); });
  const pinned = process.platform === "linux" ? `/proc/${process.pid}/fd/${handle.fd}` : parent;
  try {
    if (realpathSync(pinned) !== parent || githubCloneTarget(root, directory, dataDir).abs !== target.abs) {
      throw new Error("The clone destination changed. Choose the directory again.");
    }
    const destination = path.join(pinned, leaf);
    if (lstatSync(destination, { throwIfNoEntry: false })) throw new Error("The clone directory already exists. Choose a new subfolder.");
    const stage = await mkdtemp(path.join(pinned, ".ad-github-clone-"));
    try {
      const install = path.join(stage, "checkout");
      const checkout = path.join(install, ...missing);
      if (missing.length) await mkdir(path.dirname(checkout), { recursive: true });
      const url = `https://github.com/${repo}.git`;
      const fake = web !== "https://github.com";
      const origin = new URL(web);
      const login = `${origin.protocol}//x-access-token@${origin.host}`;
      const authDir = await mkdtemp(path.join(tmpdir(), "ad-github-auth-"));
      const askpass = path.join(authDir, "askpass");
      try {
        await writeFile(askpass, `#!/bin/sh
case "$1" in
  "Password for '${login}'"*) printf '%s\\n' "$AD_CLONE_TOKEN" ;;
  *) exit 1 ;;
esac
`, { mode: 0o700, flag: "wx" });
        await git([
          "-c", "credential.helper=", "-c", "credential.username=x-access-token", "-c", "http.followRedirects=false",
          "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
          ...(fake ? ["-c", "protocol.http.allow=always", "-c", `url.${web}/.insteadOf=https://github.com/`] : []),
          "clone", "--template=", "--", url, checkout,
        ], authDir, signal, { GIT_ASKPASS: askpass, AD_CLONE_TOKEN: token });
      } catch {
        throw new Error("Git could not clone this repository. Check that it exists and the connected account has Contents access.");
      } finally {
        await rm(authDir, { recursive: true, force: true });
      }
      signal.throwIfAborted();
      if (realpathSync(pinned) !== parent || githubCloneTarget(root, directory, dataDir).abs !== target.abs) {
        throw new Error("The clone destination changed before the clone completed.");
      }
      // Reserve the final name without replacing any directory created while the clone ran.
      await mkdir(destination).catch(() => { throw new Error("The clone directory already exists. Choose a new subfolder."); });
      try {
        await rename(install, destination);
      } catch {
        await rmdir(destination).catch(() => undefined);
        throw new Error("Git cloned the repository but could not install it in the requested directory.");
      }
      return { directory: target.rel, url };
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } finally {
    await handle.close();
  }
}

export async function checkGitHubConnectFolder(root: string, dataDir: string, signal: AbortSignal) {
  const folder = guardPath(root, ".", dataDir).abs;
  const dotGit = path.join(folder, ".git");
  const metadata = lstatSync(dotGit, { throwIfNoEntry: false });
  if (!metadata) return { folder, initialize: true };
  // Worktree and submodule gitfiles may point to metadata outside the approved folder.
  if (!metadata.isDirectory() || lstatSync(path.join(dotGit, "commondir"), { throwIfNoEntry: false }) ||
      lstatSync(path.join(dotGit, "config"), { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("Connecting this folder requires a regular .git directory with local configuration.");
  }
  let stdout: string;
  try {
    ({ stdout } = await git(["remote"], folder, signal));
  } catch {
    throw new Error("Could not read the project folder's Git remotes.");
  }
  if (stdout.trim()) throw new Error("The project folder already has a Git remote.");
  return { folder, initialize: false };
}

export async function connectGitHubFolder(root: string, dataDir: string, url: string, signal: AbortSignal) {
  const { folder, initialize } = await checkGitHubConnectFolder(root, dataDir, signal);
  try {
    if (initialize) await git(["init", "--template="], folder, signal);
    await git(["remote", "add", "origin", url], folder, signal);
  } catch {
    throw new Error("Could not set origin in the project folder.");
  }
}
