// Round 8 (agent G): GitHub (Beta), read only, and saving from the mini editor. Kept apart from
// api.ts so the round's agents do not edit the same lines.
//
// The GitHub token goes in, and only the account name comes out. Saving a file goes through the
// same path check as everything else (paths.ts), refuses the protected files that always need
// approval (.env*, .git/config, .git/hooks), waits for any write the agent is doing to the same
// file (FileState.exclusive), and refuses when the file changed on disk since it was opened.
import { constants as fsConstants } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EditableFile, Project } from "../../../shared/protocol.ts";
import { hashContent } from "../agent/filestate.ts";
import { HttpError } from "../errors.ts";
import { looksBinary, MAX_TEXT_FILE } from "../files.ts";
import { GitHub, GitHubError, readGitHubRemote } from "../github.ts";
import { guardPath, isProtectedPath } from "../paths.ts";
import type { ApiDeps } from "./api.ts";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;

export function githubRoutes(route: Route, deps: ApiDeps, h: { project: (id: string) => Project; filesChanged: (projectId: string, paths: string[]) => void }): void {
  const github = new GitHub(deps.secrets);

  route("GET", "/api/github", () => github.check());

  route("PUT", "/api/github/token", async ({ body }) => {
    try {
      return await github.connect(body?.token);
    } catch (err) {
      if (err instanceof GitHubError) throw new HttpError(err.code === "bad-token" ? 400 : err.status, err.message, { code: err.code, resetAt: err.resetAt });
      throw err;
    }
  });

  route("DELETE", "/api/github/token", () => github.disconnect());

  route("GET", "/api/projects/:id/github", ({ params, query }) => github.project(h.project(params.id).path, query.get("refresh") === "1"));

  route("GET", "/api/github/pull-watch", async ({ query }) => {
    const number = query.get("number");
    if (!number || !/^[1-9]\d{0,9}$/.test(number)) throw new HttpError(400, "Skriv et gyldig PR-nummer.");
    const projectId = query.get("project");
    let repo = query.get("repo");
    if (projectId && !repo) {
      const { remote, reason } = readGitHubRemote(h.project(projectId).path);
      if (!remote) throw new HttpError(400, reason ?? "Prosjektet har ingen GitHub-tilkobling.");
      repo = `${remote.owner}/${remote.repo}`;
    }
    if (!repo) throw new HttpError(400, "Velg et prosjekt eller oppgi en GitHub-PR-lenke.");
    try {
      return await github.pullWatch(repo, Number(number));
    } catch (err) {
      if (err instanceof GitHubError) throw new HttpError(err.status, err.message, { code: err.code, resetAt: err.resetAt });
      throw err;
    }
  });

  // The mini editor reads a file through here, to get the hash it saves against.
  route("GET", "/api/projects/:id/file/edit", async ({ params, query }) => {
    const project = h.project(params.id);
    return editable(project, String(query.get("path") ?? ""), deps.dataDir);
  });

  route("PUT", "/api/projects/:id/file", async ({ params, body }) => {
    const project = h.project(params.id);
    if (typeof body?.path !== "string" || !body.path) throw new HttpError(400, "path mangler");
    if (typeof body.text !== "string") throw new HttpError(400, "text mangler");
    const { abs, rel } = guardPath(project.path, body.path, deps.dataDir);
    if (isProtectedPath(rel)) throw new HttpError(403, "Denne filen er beskyttet (.env, .git/config eller .git/hooks) og kan ikke lagres fra editoren.");
    const text: string = body.text;
    if (Buffer.byteLength(text) > MAX_TEXT_FILE) throw new HttpError(413, "Filen er for stor til å lagres fra editoren.");
    await deps.runner.files.exclusive(abs, async () => {
      let current: Buffer;
      try {
        current = await readFile(abs);
      } catch {
        throw new HttpError(404, "Filen finnes ikke lenger. Den kan ha blitt flyttet eller slettet.");
      }
      if (looksBinary(current)) throw new HttpError(400, "Binærfiler kan ikke lagres fra editoren.");
      if (body.force !== true && body.hash !== hashContent(current)) {
        throw new HttpError(409, "Filen er endret på disken siden du åpnet den.", { code: "changed" });
      }
      // A byte order mark the file had is kept; the editor never shows it.
      const bom = current[0] === 0xef && current[1] === 0xbb && current[2] === 0xbf ? "﻿" : "";
      await writeNoFollow(abs, bom + text);
    });
    h.filesChanged(project.id, [rel]);
    return editable(project, rel, deps.dataDir);
  });
}

async function editable(project: Project, input: string, dataDir: string): Promise<EditableFile> {
  if (!input) throw new HttpError(400, "path mangler");
  const { abs, rel } = guardPath(project.path, input, dataDir);
  const info = await stat(abs).catch(() => null);
  if (!info) throw new HttpError(404, "Fant ikke filen");
  if (!info.isFile()) throw new HttpError(400, "Ikke en fil");
  const data = info.size > MAX_TEXT_FILE ? null : await readFile(abs);
  const binary = data ? looksBinary(data) : false;
  let text = data && !binary ? new TextDecoder().decode(data) : null;
  const eol: EditableFile["eol"] = text && /\r\n/.test(text.slice(0, 64 * 1024)) ? "crlf" : "lf";
  let reason: string | undefined;
  if (!data) reason = "Filen er for stor til å redigeres her.";
  else if (binary) reason = "Binærfil.";
  else if (isProtectedPath(rel)) reason = "Beskyttet fil. Den kan leses, men ikke lagres herfra.";
  if (text === null && data && !binary) text = "";
  return {
    path: rel,
    text,
    size: info.size,
    binary,
    truncated: !data,
    hash: data ? hashContent(data) : null,
    editable: !reason,
    reason,
    eol,
  };
}

// Like the agent's write_file: the file is opened without following a symlink, and keeps its mode.
async function writeNoFollow(abs: string, content: string): Promise<void> {
  const handle = await open(abs, fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}
