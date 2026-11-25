import { sourceText } from "../../../shared/i18n.ts";
import { pullWatchVersion } from "../../../shared/linked-pr.ts";
// Round 8 (agent G): GitHub, read only, and saving from the mini editor. Kept apart from
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
import { GitHubError, inspectGitHubCli, readGitHubRemote } from "../github.ts";
import { githubComments, githubDetail, githubFiles, githubFilters, githubKind, githubLabels, githubList, githubReference, githubScopes, githubViews } from "../github-pages.ts";
import { guardPath, isProtectedPath } from "../paths.ts";
import { HANDLED, type ApiDeps } from "./api.ts";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;

export function githubRoutes(route: Route, deps: ApiDeps, h: { project: (id: string) => Project; filesChanged: (projectId: string, paths: string[]) => void; settingsChanged: () => void }): void {
  const { github, store } = deps;
  const scopes = () => githubScopes(store.projects(), github.web);
  const run = async <T>(work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      if (err instanceof GitHubError) throw new HttpError(err.status, err.message, { code: err.code, resetAt: err.resetAt });
      throw err;
    }
  };

  route("GET", "/api/github", () => github.check());
  route("GET", "/api/github/cli", () => inspectGitHubCli());
  route("GET", "/api/github/projects", () => scopes());

  route("PUT", "/api/github/token", ({ body }) => run(() => github.connect(body?.token)));
  route("PUT", "/api/github/cli", () => run(() => github.useCli()));

  route("DELETE", "/api/github/token", () => github.disconnect());
  route("DELETE", "/api/github", () => github.disconnect());

  route("GET", "/api/github/list/:kind", ({ params, query }) => run(() => {
    const kind = githubKind(params.kind);
    return githubList(github, scopes(), kind, githubFilters(Object.fromEntries(query), kind), query.get("cursor"), query.get("refresh") === "1");
  }));
  route("GET", "/api/github/labels", ({ query }) => run(() => githubLabels(github, scopes(), query.get("projectId") ?? "", query.get("refresh") === "1")));

  const reference = (params: Ctx["params"], query: URLSearchParams) => githubReference(params.kind, query.get("repo"), query.get("number"));
  route("GET", "/api/github/detail/:kind", ({ params, query }) => run(() => githubDetail(github, reference(params, query), scopes(), query.get("refresh") === "1")));
  route("GET", "/api/github/comments/:kind", ({ params, query }) => run(() => githubComments(github, reference(params, query), query.get("cursor"), query.get("refresh") === "1")));
  route("GET", "/api/github/files/:kind", ({ params, query }) => run(() => githubFiles(github, reference(params, query), query.get("cursor"), query.get("refresh") === "1")));

  route("POST", "/api/github/views", ({ body }) => run(() => {
    const settings = store.settings();
    const next = store.updateSettings({ githubViews: githubViews([...(settings.githubViews ?? []), body]) });
    h.settingsChanged();
    return next.githubViews;
  }));
  route("DELETE", "/api/github/views/:id", ({ params }) => {
    const next = store.updateSettings({ githubViews: (store.settings().githubViews ?? []).filter(view => view.id !== params.id) });
    h.settingsChanged();
    return next.githubViews;
  });

  // Keep the app's image CSP intact. The proxy takes only a numeric GitHub user ID and
  // requests a small public avatar from a fixed origin, without any credentials.
  route("GET", "/api/github/avatar/:id", async ({ params, res }) => {
    if (!/^[1-9]\d{0,15}$/.test(params.id)) throw new HttpError(404, sourceText("Fant ikke profilbildet."));
    const base = github.web === "https://github.com" ? "https://avatars.githubusercontent.com" : github.web;
    const avatar = await fetch(`${base}/u/${params.id}?s=40`, { redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => null);
    const type = avatar?.headers.get("content-type") ?? "";
    if (!avatar?.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) {
      await avatar?.body?.cancel().catch(() => undefined);
      res.writeHead(204).end();
      return HANDLED;
    }
    const image = await avatar.arrayBuffer().catch(() => null);
    if (!image || image.byteLength > 256 * 1024) res.writeHead(204).end();
    else res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=86400" }).end(Buffer.from(image));
    return HANDLED;
  });

  route("GET", "/api/projects/:id/github", ({ params, query }) => github.project(h.project(params.id).path, query.get("refresh") === "1"));

  const readPullWatch = (number: unknown, repo: unknown, projectId: unknown) => run(async () => {
    if (typeof number !== "string" || !/^[1-9]\d{0,9}$/.test(number)) throw new HttpError(400, "Skriv et gyldig PR-nummer.");
    if (projectId && !repo) {
      if (typeof projectId !== "string") throw new HttpError(400, "Velg et gyldig prosjekt.");
      const { remote, reason } = readGitHubRemote(h.project(projectId).path);
      if (!remote) throw new HttpError(400, reason ?? "Prosjektet har ingen GitHub-tilkobling.");
      repo = `${remote.owner}/${remote.repo}`;
    }
    if (typeof repo !== "string" || !repo) throw new HttpError(400, "Velg et prosjekt eller oppgi en GitHub-PR-lenke.");
    return github.pullWatch(repo, Number(number));
  });
  route("GET", "/api/github/pull-watch", ({ query }) => readPullWatch(query.get("number"), query.get("repo"), query.get("project")));
  route("POST", "/api/github/pull-watch", async ({ body }) => {
    const thread = typeof body.threadId === "string" ? store.thread(body.threadId) : undefined;
    if (!thread || thread.temporary) throw new HttpError(404, "Fant ikke tråden");
    const pull = await readPullWatch(body.number, body.repo, body.projectId);
    const activity = typeof body.previous === "string" && body.previous !== pullWatchVersion(pull);
    deps.threadInbox.onWatchedPull(thread.id, pull, body.link === true, activity);
    return pull;
  });

  // The mini editor reads a file through here, to get the hash it saves against.
  route("GET", "/api/projects/:id/file/edit", async ({ params, query }) => {
    const project = h.project(params.id);
    return editable(project, String(query.get("path") ?? ""), deps.dataDir);
  });

  // Studio creates a new ordinary text file only; existing files use the hash-checked PUT.
  route("POST", "/api/projects/:id/file", async ({ params, body }) => {
    const project = h.project(params.id);
    assertExpectedProjectPath(body?.projectPath, project);
    if (project.folderMissing) throw new HttpError(409, "Prosjektmappen mangler. Velg mappen på nytt.");
    if (typeof body?.path !== "string" || !body.path) throw new HttpError(400, "path mangler");
    if (typeof body.text !== "string") throw new HttpError(400, "text mangler");
    if (Buffer.byteLength(body.text) > MAX_TEXT_FILE) throw new HttpError(413, "Filen er for stor til å opprettes fra editoren.");
    if (looksBinary(Buffer.from(body.text))) throw new HttpError(400, "Opprett en vanlig tekstfil.");
    const { abs, rel } = guardPath(project.path, body.path, deps.dataDir);
    if (rel === "." || rel.split(/[\\/]/).some((part) => part === ".git" || part === "node_modules") || isProtectedPath(rel)) {
      throw new HttpError(403, "Denne filen kan ikke opprettes fra editoren.");
    }
    await deps.runner.files.exclusive(abs, async () => {
      assertExpectedProjectPath(project.path, h.project(project.id));
      // Revalidate after waiting for a model write. O_EXCL is the final no-overwrite gate,
      // including an existing symlink or a file created by another window in the meantime.
      if (guardPath(project.path, body.path, deps.dataDir).abs !== abs) throw new HttpError(409, "Filstien er endret. Åpne mappen på nytt.");
      let handle;
      try {
        handle = await open(abs, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o666);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EEXIST") throw new HttpError(409, "Filen finnes allerede. Åpne den i stedet.");
        if (code === "ENOENT") throw new HttpError(400, "Foreldremappen finnes ikke. Opprett mappen først.");
        if (code === "EISDIR") throw new HttpError(400, "Stien er en mappe, ikke en fil.");
        if (code === "ENOTDIR") throw new HttpError(400, "En del av stien er ikke en mappe.");
        throw err;
      }
      try { await handle.writeFile(body.text, "utf8"); }
      finally { await handle.close(); }
    });
    h.filesChanged(project.id, [rel]);
    return editable(project, rel, deps.dataDir);
  });

  route("PUT", "/api/projects/:id/file", async ({ params, body }) => {
    const project = h.project(params.id);
    assertExpectedProjectPath(body?.projectPath, project);
    if (typeof body?.path !== "string" || !body.path) throw new HttpError(400, "path mangler");
    if (typeof body.text !== "string") throw new HttpError(400, "text mangler");
    const { abs, rel } = guardPath(project.path, body.path, deps.dataDir);
    if (isProtectedPath(rel)) throw new HttpError(403, "Denne filen er beskyttet (.env, .git/config eller .git/hooks) og kan ikke lagres fra editoren.");
    const text: string = body.text;
    if (Buffer.byteLength(text) > MAX_TEXT_FILE) throw new HttpError(413, "Filen er for stor til å lagres fra editoren.");
    await deps.runner.files.exclusive(abs, async () => {
      assertExpectedProjectPath(project.path, h.project(project.id));
      if (guardPath(project.path, body.path, deps.dataDir).abs !== abs) throw new HttpError(409, "Filstien er endret. Åpne filen på nytt.");
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
  if (!data) reason = sourceText("Filen er for stor til å redigeres her.");
  else if (binary) reason = sourceText("Binærfil.");
  else if (isProtectedPath(rel)) reason = sourceText("Beskyttet fil. Den kan leses, men ikke lagres herfra.");
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


function assertExpectedProjectPath(expected: unknown, project: Project): void {
  if (expected === undefined) return; // Older mini-editor callers do not bind a workspace root.
  if (typeof expected !== "string") throw new HttpError(400, "projectPath må være en sti.");
  if (expected !== project.path) throw new HttpError(409, "Prosjektmappen er endret. Åpne filen fra den nye mappen før du lagrer.", { code: "project-moved" });
}
