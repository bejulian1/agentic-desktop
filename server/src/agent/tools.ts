import { requestUserInputTool } from "./user-input.ts";
// The tools the model can call. Every path goes through guardPath, and permissions are checked by
// the loop before run() is reached.
//
// The descriptions and error texts are written for models that are weaker than the ones Claude
// Code and Codex use: each error says what went wrong and what to do instead, and every result
// has a size limit with a note on how to get the rest (see docs/research/harness.md).
import type { TaskBoard } from "./tasks.ts";
import { spawn } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { AutoSkills, ChatFile, Project, Thread, WebSource } from "../../../shared/protocol.ts";
import { listDir, looksBinary } from "../files.ts";
import { cleanMemory, type Memories } from "../memory.ts";
import { guardPath, PathError, SENSITIVE_HOME_PATHS } from "../paths.ts";
import type { ImageData, ToolDef } from "../providers/types.ts";
import type { Skill, SkillStore } from "../skills.ts";
import { checkSkillInput, renderSkill, renderSkillFile } from "../skills.ts";
import { runCommand } from "./command.ts";
import { findEdit } from "./edit.ts";
import { effectiveMode } from "./permissions.ts";
import { hashContent, type FileState } from "./filestate.ts";
import { countChanges, type Turns } from "./turns.ts";
import { webFetchTool, webSearchTool, type WebAccess } from "./web.ts";

export const MAX_RESULT_CHARS = 30_000;
const MAX_LINE_CHARS = 2000;
const MAX_READ_BYTES = 10 * 1024 * 1024;
const DEFAULT_READ_LINES = 2000;
const DEFAULT_SEARCH_RESULTS = 100;
const MAX_SEARCH_RESULTS = 500;
const DEFAULT_GLOB_RESULTS = 100;
const MAX_GLOB_STAT = 5000;
const MAX_COMMAND_TIMEOUT_MS = 10 * 60_000;
const MAX_PLAN_ITEMS = 30;

export type ToolKind = "read" | "edit" | "exec";

export interface ToolResult {
  text: string;
  isError?: boolean;
  image?: ImageData;
  screenshotId?: string;
  files?: ChatFile[];
  sources?: WebSource[]; // round 13: what a web search found, or the page that was read
}

export interface BrowserTools {
  // Optional for older embedders; the server binds all model calls to the actual thread.
  forThread?(projectId: string, threadId: string): BrowserTools;
  navigate(projectId: string, url: string): Promise<string>;
  snapshot(projectId: string): Promise<string>;
  click(projectId: string, target: { ref?: string; text?: string }): Promise<string>;
  type(projectId: string, target: { ref?: string; text?: string }, value: string, submit: boolean): Promise<string>;
  screenshot(projectId: string): Promise<{ png: Buffer; url: string }>;
  console(projectId: string): Promise<string>;
  // Round 12 (SPEC 26.4): a site the user is signed in to with imported cookies, when they want to
  // be asked before the agent uses it. With a url, that address; without, the page shown now.
  signedInSite?(projectId: string, threadId: string, url?: string): string | null;
  grantSignedIn?(threadId: string, site: string): void;
}

export interface CollabTools {
  list(thread: Thread): string;
  models(query?: unknown, offset?: unknown, maxChars?: number, options?: { modelId?: string; available?: unknown; signal?: AbortSignal }): ToolResult | Promise<ToolResult>;
  create(thread: Thread, runId: string, parentModelId: string, input: { title: string; task: string; model: string }): ToolResult;
  send(thread: Thread, runId: string, input: { threadId: string; text: string }): ToolResult;
  read(thread: Thread, input: { threadId: string; limit?: number }): ToolResult;
  wait(thread: Thread, input: { threadId: string; timeoutSeconds?: number }, signal: AbortSignal): Promise<ToolResult>;
}

export interface ToolContext {
  requestUserInput?: (input: unknown) => Promise<import("../../../shared/user-input.ts").UserInputResult>;
  thread: Thread;
  project: Project;
  runId: string;
  modelId?: string;
  turnId: string;
  signal: AbortSignal;
  dataDir: string;
  turns: Turns;
  files: FileState;
  browser: BrowserTools;
  collab: CollabTools;
  tasks: TaskBoard;
  env: () => Record<string, string>;
  commandTimeoutMs: number;
  skills: () => Skill[];
  output: (text: string) => void;
  filesChanged: (paths: string[]) => void;
  saveScreenshot: (png: Buffer) => string;
  // Round 6: memories, skills from the agent and the plan.
  memories?: Memories;
  skillStore?: SkillStore;
  autoSkills?: AutoSkills;
  applySkillEdit?: () => void;
  suggestMemory?: (text: unknown, evidence: unknown, previous: unknown) => void;
  setPlan?: (text: string) => void;
  maxResultChars?: number; // smaller than MAX_RESULT_CHARS for models with a small context window
  web?: WebAccess; // round 13: web search and pages, when the thread has a way to search
}

export interface Tool {
  def: ToolDef;
  // What the tool lets the agent do, in plain words, as it reads after "you can": the agent's
  // picture of itself is built from the tools a thread is actually offered (abilities below), so a
  // new tool shows up there by being registered. Tools that belong together share one phrase.
  can: string;
  kind: ToolKind;
  path?: (input: any) => string | undefined; // for the protected-path check
  summary: (input: any, ctx: ToolContext) => string;
  run: (input: any, ctx: ToolContext) => Promise<ToolResult>;
  // Asks the user whatever the permission mode, without "allow always". For things that are not
  // file edits or commands but still need a yes, such as a new skill from the agent.
  confirm?: (input: any, ctx: ToolContext) => { title: string; detail: string } | undefined;
}

function cutLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [linjen er kuttet, ${line.length - MAX_LINE_CHARS} tegn til]` : line;
}

// Keeps whole lines from the start and the end, and says how many were left out in between.
// headShare is how much of the room the start gets; command output keeps more of the end, since
// that is where errors are.
export function clip(text: string, max = MAX_RESULT_CHARS, headShare = 0.5): string {
  if (text.length <= max) return text;
  const lines = text.split("\n").map(cutLine);
  const headBudget = Math.floor(max * headShare);
  const tailBudget = max - headBudget;
  let headSize = 0;
  let head = 0;
  while (head < lines.length && headSize + lines[head].length + 1 <= headBudget) headSize += lines[head++].length + 1;
  let tailSize = 0;
  let tail = 0;
  while (tail < lines.length - head && tailSize + lines[lines.length - 1 - tail].length + 1 <= tailBudget) tailSize += lines[lines.length - 1 - tail++].length + 1;
  const omitted = lines.length - head - tail;
  if (omitted <= 0) return lines.join("\n").slice(0, max);
  if (head + tail === 0) {
    // One enormous line: characters, not lines.
    const half = Math.floor(max / 2);
    return `${text.slice(0, half)}\n\n[… ${text.length - max} tegn utelatt …]\n\n${text.slice(-half)}`;
  }
  return [...lines.slice(0, head), "", `[… ${omitted} linjer utelatt …]`, "", ...lines.slice(lines.length - tail)].join("\n");
}

function fail(text: string): ToolResult {
  return { text, isError: true };
}

function schema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });

async function readIfExists(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// O_NOFOLLOW closes the gap between the path check and the write.
async function writeNoFollow(abs: string, content: string): Promise<void> {
  await mkdir(path.dirname(abs), { recursive: true });
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW;
  const handle = await open(abs, flags, 0o644);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}

function fileSummary(rel: string, before: string, after: string): string {
  const { additions, deletions } = countChanges(before, after);
  return `${rel} +${additions} -${deletions}`;
}

// Lines start..end (1-based, inclusive) with their numbers, the way read_file shows them.
export function numbered(lines: string[], start: number, end: number): string {
  const out: string[] = [];
  for (let n = Math.max(1, start); n <= Math.min(lines.length, end); n++) out.push(`${n}\t${cutLine(lines[n - 1])}`);
  return out.join("\n");
}

const readFileTool: Tool = {
  kind: "read",
  can: "read, search and explain the code", def: {
    name: "read_file",
    description:
      "Read a text file in the project. Each line starts with its line number and a tab; that prefix is not part of the file, so leave it out of edit_file's old_string. " +
      "Returns up to 2000 lines; use offset and limit for long files. A file must be read before write_file may overwrite it.",
    parameters: schema(
      {
        path: str("Path relative to the project root"),
        offset: int("Line number to start at, 1 is the first line. Default 1"),
        limit: int("Maximum number of lines, default 2000"),
      },
      ["path"],
    ),
  },
  path: (input) => input.path,
  summary: (input) => String(input.path ?? ""),
  async run(input, ctx) {
    const { abs, rel } = guardPath(ctx.project.path, input.path, ctx.dataDir);
    const info = await stat(abs).catch(() => null);
    if (!info) return fail(`Filen finnes ikke: ${rel}. Bruk glob eller list_dir for å finne riktig sti.`);
    if (!info.isFile()) return fail(`Ikke en fil: ${rel}. Bruk list_dir for mapper.`);
    if (info.size > MAX_READ_BYTES) return fail(`Filen er for stor: ${info.size} byte. Bruk search for å finne det du trenger.`);
    const data = await readFile(abs);
    if (looksBinary(data)) return fail(`Binærfil, ${data.length} byte: ${rel}`);
    ctx.files.remember(ctx.thread.id, abs, data);
    const text = data.toString("utf8");
    if (!text) return { text: "(tom fil)" };
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop(); // the newline at the end is not a line of its own
    const start = Math.max(1, Math.trunc(Number(input.offset) || 1));
    if (start > lines.length) return fail(`${rel} har bare ${lines.length} linjer, så offset ${start} er etter slutten.`);
    const limit = Math.max(1, Math.trunc(Number(input.limit) || DEFAULT_READ_LINES));
    let end = Math.min(lines.length, start + limit - 1);
    // Whole lines within the size limit, so the note below is always right.
    let size = 0;
    const budget = Math.min(MAX_RESULT_CHARS, ctx.maxResultChars ?? MAX_RESULT_CHARS);
    for (let n = start; n <= end; n++) {
      size += Math.min(lines[n - 1].length, MAX_LINE_CHARS) + 8;
      if (size > budget && n > start) {
        end = n - 1;
        break;
      }
    }
    const body = numbered(lines, start, end);
    const note = end < lines.length ? `\n\n[Viser linje ${start}–${end} av ${lines.length}. Les videre med offset: ${end + 1}.]` : "";
    return { text: body + note };
  },
};

const writeFileTool: Tool = {
  kind: "edit",
  can: "write and change code, fix bugs and refactor", def: {
    name: "write_file",
    description:
      "Create a file, or replace all of an existing one. An existing file must have been read with read_file first and be unchanged since. " +
      "To change part of a file, use edit_file instead.",
    parameters: schema({ path: str("Path relative to the project root"), content: str("The full new content") }, ["path", "content"]),
  },
  path: (input) => input.path,
  summary(input, ctx) {
    try {
      const { abs, rel } = guardPath(ctx.project.path, input.path, ctx.dataDir);
      // Round 13: « (ny)» when the file is not there yet, so the step can say «Oppretter».
      return `${rel} +${String(input.content ?? "").split("\n").length}${existsSync(abs) ? "" : " (ny)"}`;
    } catch {
      return String(input.path ?? "");
    }
  },
  async run(input, ctx) {
    if (typeof input.content !== "string") return fail("content må være tekst");
    const { abs, rel } = guardPath(ctx.project.path, input.path, ctx.dataDir);
    return ctx.files.exclusive(abs, async () => {
      const current = await readIfExists(abs);
      if (current) {
        const seen = ctx.files.lastSeen(ctx.thread.id, abs);
        if (!seen) return fail(`${rel} finnes allerede. Les filen med read_file før du overskriver den, eller bruk edit_file for å endre en del av den.`);
        if (seen !== hashContent(current)) return fail(`${rel} er endret siden du leste den. Les den på nytt før du skriver.`);
      }
      ctx.turns.capture(ctx.turnId, rel, current);
      await writeNoFollow(abs, input.content);
      ctx.turns.recordAfter(ctx.turnId, rel, Buffer.from(input.content));
      ctx.files.remember(ctx.thread.id, abs, Buffer.from(input.content));
      ctx.filesChanged([rel]);
      // Round 13: a new file says so, so the step reads «Opprettet» and not «Endret».
      return { text: `${fileSummary(rel, current?.toString("utf8") ?? "", input.content)}${current ? "" : " (ny fil)"}` };
    });
  },
};

// Round 13 (SPEC 27.1): deleting is its own step, with its own icon. The old content is kept in the
// turn, so Angre brings the file back.
const deleteFileTool: Tool = {
  kind: "edit",
  can: "write and change code, fix bugs and refactor", def: {
    name: "delete_file",
    description: "Delete a file in the project. The file can be brought back with Angre in the app. Folders cannot be deleted with this tool.",
    parameters: schema({ path: str("Path relative to the project root") }, ["path"]),
  },
  path: (input) => input.path,
  summary: (input) => String(input.path ?? ""),
  async run(input, ctx) {
    const { abs, rel } = guardPath(ctx.project.path, input.path, ctx.dataDir);
    return ctx.files.exclusive(abs, async () => {
      const info = await lstat(abs).catch(() => null);
      if (!info) return fail(`Filen finnes ikke: ${rel}`);
      if (!info.isFile()) return fail(`Ikke en fil: ${rel}. Bare filer kan slettes med delete_file.`);
      const current = await readFile(abs);
      ctx.turns.capture(ctx.turnId, rel, current);
      await unlink(abs);
      ctx.turns.recordAfter(ctx.turnId, rel, null);
      ctx.filesChanged([rel]);
      const lines = looksBinary(current) ? 0 : countChanges(current.toString("utf8"), "").deletions;
      return { text: `${rel} +0 -${lines} (slettet)` };
    });
  },
};

const editFileTool: Tool = {
  kind: "edit",
  can: "write and change code, fix bugs and refactor", def: {
    name: "edit_file",
    description:
      "Replace a piece of text in a file. old_string must match the file exactly, including indentation, and appear only once; " +
      "copy it from read_file output without the line numbers, with a few lines of context if needed to make it unique. " +
      "Set replace_all to change every occurrence. Small differences in whitespace are tolerated when the match is still unique.",
    parameters: schema(
      {
        path: str("Path relative to the project root"),
        old_string: str("The exact text to replace"),
        new_string: str("The replacement text, different from old_string"),
        replace_all: bool("Replace every occurrence, default false"),
      },
      ["path", "old_string", "new_string"],
    ),
  },
  path: (input) => input.path,
  summary: (input) => String(input.path ?? ""),
  async run(input, ctx) {
    if (typeof input.old_string !== "string" || !input.old_string) return fail("old_string kan ikke være tom. Bruk write_file for å lage en ny fil.");
    if (typeof input.new_string !== "string") return fail("new_string må være tekst");
    if (input.old_string === input.new_string) return fail("old_string og new_string er like, så ingenting ville endret seg.");
    const { abs, rel } = guardPath(ctx.project.path, input.path, ctx.dataDir);
    return ctx.files.exclusive(abs, async () => {
      const current = await readIfExists(abs);
      if (!current) return fail(`Filen finnes ikke: ${rel}. Bruk write_file for å lage den.`);
      if (looksBinary(current)) return fail(`Binærfil kan ikke redigeres: ${rel}`);
      const before = current.toString("utf8");
      const found = findEdit(before, input.old_string, input.new_string, input.replace_all === true, rel);
      if ("error" in found) return fail(found.error);
      const { after, firstLine, lastLine, note } = found;
      ctx.turns.capture(ctx.turnId, rel, current);
      await writeNoFollow(abs, after);
      ctx.turns.recordAfter(ctx.turnId, rel, Buffer.from(after));
      ctx.files.remember(ctx.thread.id, abs, Buffer.from(after));
      ctx.filesChanged([rel]);
      // The changed lines with a little context, so the model can see the result without reading again.
      const lines = after.split("\n");
      const from = Math.max(1, firstLine - 3);
      const to = Math.min(lines.length, Math.min(lastLine + 3, from + 24));
      return { text: `${fileSummary(rel, before, after)}${note ? `\n${note}` : ""}\n\nSlik ser det ut nå (linje ${from}–${to}):\n${numbered(lines, from, to)}` };
    });
  },
};

const listDirTool: Tool = {
  kind: "read",
  can: "read, search and explain the code", def: {
    name: "list_dir",
    description: "List one folder in the project, to see what is in it. Folders end with a slash. Skips .git and node_modules. Use glob to find files by name across folders, and search to find text inside files.",
    parameters: schema({ path: str("Path relative to the project root, . for the root") }, ["path"]),
  },
  path: (input) => input.path,
  summary: (input) => String(input.path ?? "."),
  async run(input, ctx) {
    const entries = listDir(ctx.project.path, input.path ?? ".", ctx.dataDir, { respectIgnore: false });
    return { text: entries.map((e) => (e.kind === "dir" ? `${e.name}/` : e.name)).join("\n") || "(tom mappe)" };
  },
};

function ripgrep(args: string[], ctx: ToolContext): Promise<{ code: number | null; out: string; err: string } | ToolResult> {
  return new Promise((resolve) => {
    const child = spawn("rg", args, { cwd: ctx.project.path, env: ctx.env(), stdio: ["ignore", "pipe", "pipe"], signal: ctx.signal });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      if (out.length < 8 * 1024 * 1024) out += chunk;
    });
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", (e) => {
      const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
      resolve(fail(missing ? "ripgrep (rg) er ikke installert" : e.message));
    });
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

const HIDDEN_GLOBS = ["--glob", "!.git", "--glob", "!node_modules", "--glob", "!.env*", ...SENSITIVE_HOME_PATHS.flatMap((entry) => ["--glob", `!${entry}`]), "--glob", "!.cache", "--glob", "!.local/share/Trash"];
// rg says this, with exit code 2, when every file was filtered out. That is no hits, not an error.
const NOTHING_SEARCHED = /No files were searched/;
const dropDotSlash = (line: string) => line.replace(/^\.\//, "");

const searchTool: Tool = {
  kind: "read",
  can: "read, search and explain the code", def: {
    name: "search",
    description:
      "Search file contents in the project with ripgrep (a grep). Use it to find where a name, a text or an error message occurs before you read or change code. Honours .gitignore and skips .env files. " +
      "output: content (matching lines with line numbers, the default), files (only file names) or count (matches per file).",
    parameters: schema(
      {
        pattern: str("Regular expression, ripgrep syntax. Escape special characters like ( and . to match them literally"),
        path: str("Folder or file to search, default the project root"),
        glob: str("Only search files matching this glob, for example *.ts or src/**/*.py"),
        ignore_case: bool("Case-insensitive search, default false"),
        output: { type: "string", enum: ["content", "files", "count"], description: "What to return, default content" },
        context: int("Lines of context before and after each match, 0 to 10, default 0"),
        max_results: int("Maximum lines of output, default 100, at most 500"),
      },
      ["pattern"],
    ),
  },
  path: (input) => input.path,
  summary: (input) => String(input.pattern ?? ""),
  async run(input, ctx) {
    if (typeof input.pattern !== "string" || !input.pattern) return fail("pattern mangler");
    const { abs } = guardPath(ctx.project.path, input.path ?? ".", ctx.dataDir);
    const mode = input.output === "files" || input.output === "count" ? input.output : "content";
    const args = ["--no-config", "--color", "never", "--max-columns", "300", "--hidden", ...HIDDEN_GLOBS];
    if (mode === "content") args.push("--line-number", "--no-heading");
    if (mode === "files") args.push("--files-with-matches");
    if (mode === "count") args.push("--count");
    if (input.ignore_case === true) args.push("-i");
    const context = Math.min(10, Math.max(0, Math.trunc(Number(input.context) || 0)));
    if (context && mode === "content") args.push("-C", String(context));
    if (input.glob) args.push("--glob", String(input.glob));
    args.push("-e", input.pattern, "--", path.relative(ctx.project.path, abs) || ".");
    const result = await ripgrep(args, ctx);
    if (!("code" in result)) return result;
    if (result.code === 1 || !result.out.trim() || NOTHING_SEARCHED.test(result.err)) return { text: "Ingen treff" };
    if (result.code === 2) return fail(`Søket feilet: ${result.err.trim() || "ukjent feil"}. Er mønsteret et gyldig regulært uttrykk? Bruk \\ foran spesialtegn.`);
    const max = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(Number(input.max_results) || DEFAULT_SEARCH_RESULTS)));
    const lines = result.out.trimEnd().split("\n").map(dropDotSlash);
    const note = lines.length > max ? `\n\n[Viser ${max} av ${lines.length} linjer. Snevre inn med path, glob eller et mer presist mønster.]` : "";
    return { text: clip(lines.slice(0, max).join("\n")) + note };
  },
};

const globTool: Tool = {
  kind: "read",
  can: "read, search and explain the code", def: {
    name: "glob",
    description: "Find files by name pattern, like **/*.ts or src/components/*.tsx. Use it when you know part of a file name or its extension. Newest first. Honours .gitignore and skips .git, node_modules and .env files.",
    parameters: schema(
      {
        pattern: str("Glob pattern. A pattern without a slash matches file names in every folder"),
        path: str("Folder to search in, default the project root"),
        max_results: int("Maximum number of files, default 100, at most 500"),
      },
      ["pattern"],
    ),
  },
  path: (input) => input.path,
  summary: (input) => String(input.pattern ?? ""),
  async run(input, ctx) {
    if (typeof input.pattern !== "string" || !input.pattern.trim()) return fail("pattern mangler");
    const { abs } = guardPath(ctx.project.path, input.path ?? ".", ctx.dataDir);
    const base = path.relative(ctx.project.path, abs) || ".";
    const pattern = input.pattern.trim().replace(/^\.\//, "");
    const args = ["--no-config", "--files", "--hidden", ...HIDDEN_GLOBS, "--glob", pattern, "--", base];
    const result = await ripgrep(args, ctx);
    if (!("code" in result)) return result;
    if (result.code === 2 && !NOTHING_SEARCHED.test(result.err)) return fail(`Søket feilet: ${result.err.trim() || "ukjent feil"}`);
    const files = result.out.split("\n").filter(Boolean).map(dropDotSlash);
    if (!files.length) return { text: `Ingen filer passer til ${pattern}` };
    const dated = await Promise.all(
      files.slice(0, MAX_GLOB_STAT).map(async (file) => ({ file: path.normalize(file), at: (await stat(path.join(ctx.project.path, file)).catch(() => null))?.mtimeMs ?? 0 })),
    );
    dated.sort((a, b) => b.at - a.at || a.file.localeCompare(b.file));
    const max = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(Number(input.max_results) || DEFAULT_GLOB_RESULTS)));
    const note = files.length > max ? `\n\n[Viser ${max} av ${files.length} filer. Bruk et mer presist mønster eller path.]` : "";
    return { text: dated.slice(0, max).map((d) => d.file).join("\n") + note };
  },
};

const runCommandTool: Tool = {
  kind: "exec",
  can: "run commands, tests and builds", def: {
    name: "run_command",
    description:
      "Run a shell command (bash) with the project folder as working directory, for tests, builds, type checks, git status and the like. " +
      "Prefer read_file, search and glob over cat, grep and find. Long output is shortened in the middle, so pipe through tail or grep when you only need part of it. " +
      "Use file tools for intentional source edits: shell writes are not reliably tracked in the changes card or undo. " +
      "The project is the working directory, not an OS filesystem sandbox; follow the current task scope and permission policy. " +
      "Background jobs are stopped when the command ends, and nothing interactive works.",
    parameters: schema({ command: str("The command"), timeoutSeconds: int("Time limit, default 120, maximum 600") }, ["command"]),
  },
  summary: (input) => String(input.command ?? ""),
  async run(input, ctx) {
    if (typeof input.command !== "string" || !input.command.trim()) return fail("command mangler");
    const requested = Number(input.timeoutSeconds) * 1000;
    const timeoutMs = requested > 0 ? Math.min(requested, MAX_COMMAND_TIMEOUT_MS) : ctx.commandTimeoutMs;
    const result = await runCommand({
      command: input.command,
      cwd: ctx.project.path,
      env: ctx.env(),
      timeoutMs,
      signal: ctx.signal,
      onOutput: ctx.output,
    });
    ctx.filesChanged([]); // Unknown which files a command touched.
    const output = clip(result.output, MAX_RESULT_CHARS, 0.3);
    if (result.cancelled) return { text: `${output}\n[Avbrutt]`, isError: true };
    if (result.timedOut) return fail(`${output}\n[Tidsavbrudd etter ${Math.round(timeoutMs / 1000)} s. Bruk timeoutSeconds for en lengre grense, eller del opp kommandoen.]`);
    const body = output || "(ingen utdata)";
    return { text: result.exitCode === 0 ? body : `${body}\n[Avslutningskode ${result.exitCode}]`, isError: result.exitCode !== 0 };
  },
};

const target = { ref: str("Element ref from browser_snapshot, like e5"), text: str("Visible text, used when there is no ref") };

// Thread ownership comes from the server context, never model-supplied arguments.
const threadBrowser = (ctx: ToolContext): BrowserTools => ctx.browser.forThread?.(ctx.project.id, ctx.thread.id) ?? ctx.browser;

// Round 12 (SPEC 26.4): Spør før agenter bruker innloggede nettsteder. A browser tool on a site with
// imported cookies asks first, in every mode. A yes holds for that site for the rest of the thread.
function navigateTarget(raw: unknown): string | undefined {
  const url = String(raw ?? "").trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/.test(url)) return `http://${url}`;
  return undefined; // a path in the project, served by the app on its own port
}

function signedInSite(ctx: ToolContext, input: any, navigate: boolean): string | null {
  if (navigate) {
    const url = navigateTarget(input.url);
    return url ? (threadBrowser(ctx).signedInSite?.(ctx.project.id, ctx.thread.id, url) ?? null) : null;
  }
  return threadBrowser(ctx).signedInSite?.(ctx.project.id, ctx.thread.id) ?? null;
}

function signedInConfirm(what: string, navigate = false): Tool["confirm"] {
  return (input, ctx) => {
    const site = signedInSite(ctx, input, navigate);
    if (!site) return undefined;
    return {
      title: `Bruke innloggingen din på ${site}`,
      detail: `Agenten vil ${what} på ${site}, der du er logget inn med informasjonskapsler du har importert. Svarer du ja, gjelder det ${site} resten av denne tråden.`,
    };
  };
}

// Reached only after a yes (or when nothing needed asking): the site is let through for the thread.
function grantSignedIn(ctx: ToolContext, input: any, navigate = false): void {
  const site = signedInSite(ctx, input, navigate);
  if (site) threadBrowser(ctx).grantSignedIn?.(ctx.thread.id, site);
}

const browserTools: Tool[] = [
  {
    kind: "exec",
    can: "open, operate and inspect pages in the app's browser", def: {
      name: "browser_navigate",
      description: "Open a page in this thread's own browser tab, which the user can inspect in the browser panel. Takes an http(s) URL, or a path in the project such as index.html, which is served on its own port.",
      parameters: schema({ url: str("URL or project path") }, ["url"]),
    },
    summary: (input) => String(input.url ?? ""),
    confirm: signedInConfirm("åpne en side", true),
    async run(input, ctx) {
      grantSignedIn(ctx, input, true);
      return { text: await threadBrowser(ctx).navigate(ctx.project.id, String(input.url ?? "")) };
    },
  },
  {
    kind: "exec",
    can: "open, operate and inspect pages in the app's browser", def: {
      name: "browser_snapshot",
      description: "Read the current page as an accessibility tree: its text, structure and interactive elements, with refs for browser_click and browser_type. Call it after browser_navigate and again after every action, and act on what it shows, not on what you expect.",
      parameters: schema({}, []),
    },
    summary: () => "Tilgjengelighetstre",
    confirm: signedInConfirm("lese siden"),
    async run(_input, ctx) {
      grantSignedIn(ctx, _input);
      return { text: clip(await threadBrowser(ctx).snapshot(ctx.project.id)) };
    },
  },
  {
    kind: "exec",
    can: "open, operate and inspect pages in the app's browser", def: { name: "browser_click", description: "Click a link, button or other element on the current page. Give the ref from the latest browser_snapshot; use text only when the element has no ref. Take a new browser_snapshot afterwards to see what changed.", parameters: schema(target, []) },
    summary: (input) => String(input.ref ?? input.text ?? ""),
    confirm: signedInConfirm("klikke"),
    async run(input, ctx) {
      grantSignedIn(ctx, input);
      return { text: await threadBrowser(ctx).click(ctx.project.id, input) };
    },
  },
  {
    kind: "exec",
    can: "open, operate and inspect pages in the app's browser", def: {
      name: "browser_type",
      description: "Type into a text field on the current page, replacing its content. Give the ref from the latest browser_snapshot. Set submit to press Enter afterwards, for search fields and simple forms.",
      parameters: schema({ ...target, value: str("The text to type"), submit: bool("Press Enter afterwards") }, ["value"]),
    },
    summary: (input) => String(input.ref ?? input.text ?? ""),
    confirm: signedInConfirm("skrive inn tekst"),
    async run(input, ctx) {
      grantSignedIn(ctx, input);
      return { text: await threadBrowser(ctx).type(ctx.project.id, input, String(input.value ?? ""), input.submit === true) };
    },
  },
  {
    kind: "exec",
    can: "take screenshots of the current browser page", def: { name: "browser_screenshot", description: "Take a screenshot of the current page, to judge layout, spacing, colours and other visual problems. To read text or find elements, use browser_snapshot instead.", parameters: schema({}, []) },
    summary: () => "Skjermbilde",
    confirm: signedInConfirm("ta et skjermbilde"),
    async run(_input, ctx) {
      grantSignedIn(ctx, _input);
      const { png, url } = await threadBrowser(ctx).screenshot(ctx.project.id);
      const screenshotId = ctx.saveScreenshot(png);
      return { text: `Skjermbilde av ${url}`, screenshotId, image: { mime: "image/png", base64: png.toString("base64") } };
    },
  },
  {
    kind: "exec",
    can: "open, operate and inspect pages in the app's browser", def: { name: "browser_console", description: "Read recent console messages and page errors from the current page. Check it after a page has loaded and after an action that should have worked; errors here explain most broken pages.", parameters: schema({}, []) },
    summary: () => "Konsoll",
    confirm: signedInConfirm("lese konsollen"),
    async run(_input, ctx) {
      grantSignedIn(ctx, _input);
      return { text: clip(await threadBrowser(ctx).console(ctx.project.id)) };
    },
  },
];

const threadId = str("Thread id from thread_list or thread_create");

const threadTools: Tool[] = [
  {
    kind: "read",
    can: "discover configured models for helper threads", def: {
      name: "thread_models",
      description: "Find models for thread_create. Lists the configured models across providers (sameProvider marks the ones on the provider you run on). With available: true it also lists the models your current provider offers on its own model list, marked configured or not; any of those can be passed to thread_create by its API model name and the helper runs on the same provider. Search by display name, provider or API model name. Configuration does not guarantee endpoint availability or tool support.",
      parameters: schema({ query: str("Optional model or provider search"), offset: int("Next page offset from the previous result"), available: bool("Also list the models the current provider offers (asks its model list, cached for a few minutes)") }, []),
    },
    summary: input => String(input.query ?? "").slice(0, 100),
    async run(input, ctx) {
      return ctx.collab.models(input.query, input.offset, ctx.maxResultChars, { modelId: ctx.modelId, available: input.available, signal: ctx.signal });
    },
  },
  {
    kind: "read",
    can: "start and follow helper threads that work in parallel", def: { name: "thread_list", description: "List the threads in this project with title and status.", parameters: schema({}, []) },
    summary: () => "Tråder i prosjektet",
    async run(_input, ctx) {
      return { text: ctx.collab.list(ctx.thread) };
    },
  },
  {
    kind: "exec",
    can: "start and follow helper threads that work in parallel", def: {
      name: "thread_create",
      description: "Start a helper thread (subagent) in this project with its own task. It works in parallel in the same folder and cannot see this conversation, so the task must stand on its own: the goal, the files or area, what done looks like and which files it may change. Start several for independent parts that can run at the same time. Use it for an independent part of a large task or for an independent review; do small things yourself. By default it runs on your own model; pass model to choose another one. Get its answer with thread_wait.",
      parameters: schema({ title: str("Short title"), task: str("What the thread should do"), model: str("Omit to inherit the running model. Otherwise a configured model id from thread_models, an unambiguous exact display/API name, or the API model ID of another model on your current provider (it then runs on the same provider and is added to the user's models). A configured model on another provider asks the user first") }, ["title", "task"]),
    },
    summary: (input) => String(input.title ?? ""),
    async run(input, ctx) {
      return ctx.collab.create(ctx.thread, ctx.runId, ctx.modelId!, input);
    },
  },
  {
    kind: "exec",
    can: "start and follow helper threads that work in parallel", def: {
      name: "thread_send",
      description: "Send a message to another thread in this project, for a follow-up or a correction to a helper thread. It is queued if the thread is working. Replies from a child to its active ancestor enter at the next step and release an ongoing thread_wait so the ancestor can read the message. Use thread_list to find parent IDs.",
      parameters: schema({ threadId, text: str("The message") }, ["threadId", "text"]),
    },
    summary: (input) => String(input.text ?? "").slice(0, 80),
    async run(input, ctx) {
      return ctx.collab.send(ctx.thread, ctx.runId, input);
    },
  },
  {
    kind: "read",
    can: "start and follow helper threads that work in parallel", def: {
      name: "thread_read",
      description: "Read the latest messages in another thread, without tool details. Use it to check on a helper thread without waiting for it.",
      parameters: schema({ threadId, limit: int("Number of messages, default 10") }, ["threadId"]),
    },
    summary: (input) => String(input.threadId ?? ""),
    async run(input, ctx) {
      return ctx.collab.read(ctx.thread, input);
    },
  },
  {
    kind: "read",
    can: "start and follow helper threads that work in parallel", def: {
      name: "thread_wait",
      description: "Wait until another thread has finished and return its final answer. The answer is that thread's report: check it against the files before you rely on it.",
      parameters: schema({ threadId, timeoutSeconds: int("Time limit, default 120, maximum 600") }, ["threadId"]),
    },
    summary: (input) => String(input.threadId ?? ""),
    async run(input, ctx) {
      return ctx.collab.wait(ctx.thread, input, ctx.signal);
    },
  },
];

// Agent Teams: the shared task list. App state only, so no approval is needed.
const taskTools: Tool[] = [
  {
    kind: "read",
    can: "keep a shared task list for the threads in the project", def: { name: "task_list", description: "List the project's shared task list for the team, with ids, status and owners.", parameters: schema({}, []) },
    summary: () => "Oppgavelisten",
    async run(_input, ctx) {
      return { text: ctx.tasks.render(ctx.project.id) };
    },
  },
  {
    kind: "read",
    can: "keep a shared task list for the threads in the project", def: {
      name: "task_add",
      description: "Add a task to the shared task list. Give it to a thread with owner, or leave it open.",
      parameters: schema({ title: str("What needs doing"), owner: str("Thread id of the owner, optional") }, ["title"]),
    },
    summary: (input) => String(input.title ?? "").slice(0, 80),
    async run(input, ctx) {
      try {
        const task = ctx.tasks.add(ctx.project.id, input.title, ctx.thread.id, input.owner || null);
        return { text: `La til oppgaven. Oppgave-id: ${task.id}` };
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
  {
    kind: "read",
    can: "keep a shared task list for the threads in the project", def: {
      name: "task_update",
      description: "Change a task's status (todo, doing, done) or owner.",
      parameters: schema({ id: str("Task id from task_list or task_add"), status: str("todo, doing or done"), owner: str("Thread id of the new owner, optional") }, ["id"]),
    },
    summary: (input) => `${String(input.id ?? "")} ${String(input.status ?? "")}`.trim(),
    async run(input, ctx) {
      try {
        const task = ctx.tasks.update(String(input.id), { status: input.status, ...(input.owner !== undefined ? { ownerThreadId: input.owner } : {}) }, ctx.project.id);
        return { text: `Oppgaven «${task.title}» er nå ${task.status}.` };
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  },
];

export const useSkillTool: Tool = {
  kind: "read",
  can: "follow saved skills", def: {
    name: "use_skill",
    description: "Load the full instructions of a skill listed in the system prompt. Do this before a task the skill describes.",
    parameters: schema({ name: str("The skill name") }, ["name"]),
  },
  summary: (input) => String(input.name ?? ""),
  async run(input, ctx) {
    const skill = ctx.skills().find((s) => s.name === input.name);
    if (!skill) return fail(`Fant ikke skillen ${input.name}. Skills som finnes: ${ctx.skills().map((s) => s.name).join(", ") || "ingen"}.`);
    return { text: renderSkill(skill) };
  },
};

// The plan: a short checklist the model keeps up to date. It is stored as the thread's plan, so
// the pinned summary shows it.
const PLAN_MARK: Record<string, string> = { pending: "[ ]", in_progress: "[>]", completed: "[x]" };

const updatePlanTool: Tool = {
  kind: "read",
  can: "keep a visible plan for longer tasks", def: {
    name: "update_plan",
    description:
      "Keep a short step-by-step plan for a task with several steps; the user sees it. Send the whole list every time, " +
      "with exactly one step in_progress while you work, and mark steps completed as you finish them. Skip this for simple tasks.",
    parameters: schema(
      {
        steps: {
          type: "array",
          description: "The whole plan, in order",
          items: {
            type: "object",
            properties: { step: str("What to do, a few words"), status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "pending, in_progress or completed" } },
            required: ["step", "status"],
          },
        },
      },
      ["steps"],
    ),
  },
  summary: (input) => `${Array.isArray(input.steps) ? input.steps.length : 0} steg`,
  async run(input, ctx) {
    if (!Array.isArray(input.steps) || !input.steps.length) return fail("steps må være en liste med minst ett steg: [{\"step\": \"…\", \"status\": \"pending\"}]");
    if (input.steps.length > MAX_PLAN_ITEMS) return fail(`Planen har for mange steg, maks ${MAX_PLAN_ITEMS}. Slå sammen steg.`);
    const steps: Array<{ step: string; status: string }> = [];
    for (const item of input.steps) {
      const step = typeof item === "string" ? item : String(item?.step ?? item?.content ?? item?.title ?? "").trim();
      const status = typeof item === "string" ? "pending" : String(item?.status ?? "pending").toLowerCase().replace(/[\s-]/g, "_");
      if (!step) return fail("Hvert steg trenger tekst i step");
      if (!PLAN_MARK[status]) return fail(`Ugyldig status «${status}». Bruk pending, in_progress eller completed.`);
      steps.push({ step: step.slice(0, 200), status });
    }
    if (steps.filter((s) => s.status === "in_progress").length > 1) return fail("Bare ett steg kan være in_progress om gangen.");
    const text = steps.map((s, i) => `${i + 1}. ${PLAN_MARK[s.status]} ${s.step}`).join("\n");
    ctx.setPlan?.(text);
    const done = steps.filter((s) => s.status === "completed").length;
    return { text: `Planen er oppdatert (${done} av ${steps.length} ferdig):\n${text}` };
  },
};

const scopeOf = (value: unknown): "global" | "project" => (value === "global" || value === "user" ? "global" : "project");

// Memories follow the rules for file edits: a project memory (.agentic/MEMORY.md) asks in Ask. A
// global one goes into every later thread in every project, so it asks in every mode but Full
// access. The card says which it is and shows the text.
function memoryApproval(ctx: ToolContext, scope: "global" | "project", title: string, text: string): { title: string; detail: string } | undefined {
  const mode = effectiveMode(ctx.project, ctx.thread);
  if (mode === "full" || (scope === "project" && mode === "accept-edits")) return undefined;
  const where = scope === "global"
    ? "Globalt minne. Det gjelder alle prosjekter og settes inn i nye Kode-tråder."
    : `Minne for prosjektet ${ctx.project.name}, i .agentic/MEMORY.md.`;
  return { title: `${title} (${scope === "global" ? "globalt" : "prosjektet"})`, detail: `${where}\n\n«${text}»` };
}

// Which memory forget would remove: in the scope it names, or the project first, then global.
function forgetTarget(input: any, ctx: ToolContext): { scope: "global" | "project"; text: string } {
  const memories = ctx.memories!;
  const scopes: Array<"global" | "project"> = input.scope ? [scopeOf(input.scope)] : ["project", "global"];
  let last: unknown;
  for (const scope of scopes) {
    try {
      return { scope, text: memories.find(scope, ctx.project, String(input.text ?? "")).text };
    } catch (err) {
      last = err;
      if ((err as { status?: number }).status !== 404) break;
    }
  }
  throw last;
}

const rememberTool: Tool = {
  kind: "read", // asks through confirm below, by scope and permission mode; never secrets
  can: "remember lasting facts between threads", def: {
    name: "remember",
    description:
      "Save a short memory for later threads: a lasting preference or fact about the user (scope global), or something true about this project that would save time later (scope project), " +
      "such as how to run its tests. One short sentence. Do not save secrets, passwords, keys or tokens, and nothing that only matters for this task.",
    parameters: schema(
      {
        text: str("The memory, one sentence, at most 300 characters"),
        scope: { type: "string", enum: ["project", "global"], description: "project (default) or global for facts about the user" },
      },
      ["text"],
    ),
  },
  summary: (input) => String(input.text ?? "").slice(0, 80),
  confirm(input, ctx) {
    if (!ctx.memories) return undefined;
    try {
      return memoryApproval(ctx, scopeOf(input.scope), "Lagre et minne", cleanMemory(input.text));
    } catch {
      return undefined; // run() reports what is wrong, with nothing to approve
    }
  },
  async run(input, ctx) {
    if (!ctx.memories) return fail("Minner er slått av i Innstillinger.");
    const scope = scopeOf(input.scope);
    try {
      const { existed } = ctx.memories.add(scope, ctx.project, input.text);
      return { text: existed ? "Dette er allerede lagret." : `Lagret som ${scope === "global" ? "globalt minne" : "minne for prosjektet"}.` };
    } catch (err) {
      return fail((err as Error).message);
    }
  },
};

const forgetTool: Tool = {
  kind: "read", // asks through confirm below, like remember
  can: "remember lasting facts between threads", def: {
    name: "forget",
    description: "Delete a memory that is wrong or no longer true. Give its text, or a part of it that only that memory has.",
    parameters: schema(
      {
        text: str("The memory, or a unique part of it"),
        scope: { type: "string", enum: ["project", "global"], description: "Where it is; default looks in the project first, then global" },
      },
      ["text"],
    ),
  },
  summary: (input) => String(input.text ?? "").slice(0, 80),
  confirm(input, ctx) {
    if (!ctx.memories) return undefined;
    try {
      const target = forgetTarget(input, ctx);
      return memoryApproval(ctx, target.scope, "Glemme et minne", target.text);
    } catch {
      return undefined; // run() reports what is wrong, with nothing to approve
    }
  },
  async run(input, ctx) {
    if (!ctx.memories) return fail("Minner er slått av i Innstillinger.");
    try {
      const target = forgetTarget(input, ctx);
      const text = ctx.memories.forget(target.scope, ctx.project, target.text);
      return { text: `Glemte «${text}».` };
    } catch (err) {
      return fail((err as Error).message || "Fant ikke noe minne med den teksten.");
    }
  },
};

function proposedSkill(input: any): { name: string; description: string; body: string; scope: "user" | "project" } {
  const { name, description, body } = checkSkillInput({ name: input.name, description: input.description, body: input.instructions });
  return { name, description, body, scope: input.scope === "project" ? "project" : "user" };
}

export const proposeChatMemory: Tool = {
  kind: "read",
  can: "suggest a lasting correction for the user to review",
  def: {
    name: "propose_chat_memory",
    description: "Suggest one durable correction or convention the user taught you this turn. Quote their exact words as evidence. For a correction, copy the old saved note into previous. The user can edit, approve or dismiss after the turn. Skip one-off requests, logs, attachments and secrets.",
    parameters: schema({ text: str("One short updated fact"), evidence: str("Exact quote from the user's current message"), previous: str("Exact old memory when replacing it") }, ["text", "evidence"]),
  },
  summary: () => "Foreslå et Chat-minne",
  async run(input, ctx) {
    if (!ctx.suggestMemory) return fail("Minneforslag er slått av.");
    ctx.suggestMemory(input.text, input.evidence, input.previous);
    return { text: "Forslaget vises for brukeren etter fullført tur. Det er ikke godkjent ennå." };
  },
};

const editSkillTool: Tool = {
  kind: "read",
  can: "propose a targeted correction to a saved skill",
  def: {
    name: "propose_skill_edit",
    description: "After checking a correction to an existing procedure, propose replacing one exact passage of an editable skill. Load the skill first. The user reviews the before/after change.",
    parameters: schema({ name: str("Skill name"), before: str("Unique existing body passage"), after: str("Replacement passage") }, ["name","before","after"]),
  },
  summary: input => String(input.name ?? ""),
  confirm(input, ctx) {
    const skill = ctx.skills().find(item => item.name === input.name);
    if (!skill || !ctx.skillStore || ctx.autoSkills === "off") return;
    try {
      ctx.applySkillEdit = ctx.skillStore.prepareEdit(skill, ctx.project.id, input.before, input.after);
      const scope = skill.source === "user" ? "Brukerskill" : "Prosjektskill";
      return { title: `Endre skillen ${skill.name}?`, detail: `${scope}: ${clip(skill.file, 350)}\n\nFør\n${input.before}\n\nEtter\n${input.after}` };
    } catch (err) {
      ctx.applySkillEdit = () => { throw err; };
    }
  },
  async run(_input, ctx) {
    if (!ctx.applySkillEdit) return fail("Fant ingen redigerbar skill i denne tråden.");
    ctx.applySkillEdit();
    return { text: "Den godkjente endringen er lagret i SKILL.md." };
  },
};

const proposeSkillTool: Tool = {
  kind: "read",
  can: "save a reusable procedure as a new skill", def: {
    name: "propose_skill",
    description:
      "Save a reusable skill after you solved something non-trivial that is likely to come up again: a workflow, a fix for a tricky error, or a procedure the user taught you. " +
      "The instructions should be general steps another agent can follow, not a log of this task. The user may be asked to approve it.",
    parameters: schema(
      {
        name: str("Short name: lowercase letters, digits and hyphens, like run-e2e-tests"),
        description: str("One sentence: what the skill does and when to use it"),
        instructions: str("The skill's instructions in Markdown"),
        scope: { type: "string", enum: ["user", "project"], description: "user (default) for every project, or project for this one" },
      },
      ["name", "description", "instructions"],
    ),
  },
  summary: (input) => String(input.name ?? ""),
  confirm(input, ctx) {
    if (ctx.autoSkills === "auto") return undefined;
    try {
      const skill = proposedSkill(input);
      return {
        title: `Ny skill fra agenten: ${skill.name} (${skill.scope === "project" ? "prosjektet" : "alle prosjekter"})`,
        detail: renderSkillFile({ name: skill.name, description: skill.description, createdByAgent: true }, skill.body),
      };
    } catch {
      return undefined; // run() reports what is wrong, with nothing to approve
    }
  },
  async run(input, ctx) {
    if (!ctx.skillStore || ctx.autoSkills === "off") return fail("Skills fra agenten er slått av i Innstillinger.");
    try {
      const skill = proposedSkill(input);
      const made = ctx.skillStore.create({ scope: skill.scope, projectId: ctx.project.id, name: skill.name, description: skill.description, body: skill.body }, true);
      return { text: `Skillen ${made.name} er lagret i ${made.path}. Den kan brukes med use_skill fra neste tråd, og endres i Innstillinger → Skills.` };
    } catch (err) {
      return fail((err as Error).message);
    }
  },
};

export const CODE_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  listDirTool,
  searchTool,
  globTool,
  runCommandTool,
  webSearchTool, // offered only when the thread has a way to search (Runner.toolDefs)
  webFetchTool, // offered whenever the headless web reader is available (Runner.toolDefs)
  ...browserTools,
  ...threadTools,
  ...taskTools,
  useSkillTool,
  updatePlanTool,
  rememberTool,
  forgetTool,
  proposeSkillTool,
  requestUserInputTool,
  editSkillTool,
];

export const TOOLS_BY_NAME = new Map(CODE_TOOLS.map((tool) => [tool.def.name, tool]));

// The plain-words abilities of a set of tools, in their order, each phrase once.
export function abilities(tools: Tool[]): string[] {
  return [...new Set(tools.map((tool) => tool.can).filter(Boolean))];
}

// Names models trained on other harnesses tend to use, for tools that take the same arguments.
export const TOOL_ALIASES: Record<string, string> = {
  ask_user: "request_user_input",
  grep: "search",
  rg: "search",
  search_files: "search",
  find_files: "glob",
  cat: "read_file",
  view: "read_file",
  ls: "list_dir",
  list_files: "list_dir",
  bash: "run_command",
  shell: "run_command",
  execute_command: "run_command",
  str_replace: "edit_file",
  replace_in_file: "edit_file",
  create_file: "write_file",
  remove_file: "delete_file",
  delete: "delete_file",
  todo_write: "update_plan",
};

export function isPathError(err: unknown): err is PathError {
  return err instanceof PathError;
}
