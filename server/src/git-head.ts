// The branch name for the chip above the message field, read from .git/HEAD. No git command is
// ever run: this module only reads two small files, and it has no way to start a process.
import { closeSync, lstatSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import type { GitInfo } from "../../shared/protocol.ts";

const MAX_READ = 4096; // HEAD and a .git file are a line each. Anything bigger is not what we want.

function readSmall(file: string): string | null {
  let fd: number | undefined;
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size > MAX_READ) return null;
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(info.size, MAX_READ));
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, length).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// .git is a folder in a normal checkout, and a file with "gitdir: <path>" in a worktree or a
// submodule. The path in that file may be relative to the project.
function gitDir(root: string): string | null {
  const dotGit = path.join(root, ".git");
  let info;
  try {
    info = lstatSync(dotGit);
  } catch {
    return null;
  }
  if (info.isDirectory()) return dotGit;
  if (!info.isFile()) return null;
  const text = readSmall(dotGit);
  const match = text ? /^gitdir:\s*(.+?)\s*$/m.exec(text) : null;
  return match ? path.resolve(root, match[1]) : null;
}

const NAME = /^[^\0\n\r]{1,200}$/;

export function readGitHead(root: string): GitInfo {
  const dir = gitDir(root);
  if (!dir) return { branch: null, detached: false };
  const head = readSmall(path.join(dir, "HEAD"))?.trim();
  if (!head) return { branch: null, detached: false };
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  if (ref && NAME.test(ref[1])) return { branch: ref[1], detached: false };
  if (/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)) return { branch: head.slice(0, 7), detached: true };
  return { branch: null, detached: false };
}
