// Routes for the v0.5 navigation round: how full a thread's context is, project favicons, and lines
// changed per thread for the smart sidebar. Kept apart from api.ts so the round's agents do not
// edit the same lines.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ContextUsage, Project, Thread } from "../../../shared/protocol.ts";
import { COMPACT_AT, estimateTokens } from "../agent/context.ts";
import { REPO_ROOT } from "../config.ts";
import { HttpError } from "../errors.ts";
import { defaultDownloadDir } from "../downloads.ts";
import { findFavicon, MAX_FAVICON_BYTES } from "../favicon.ts";
import { chromeConfigHome, listChromeProfiles, previewChromeImport, readImported, removeImported, runChromeImport } from "../chrome-import.ts";
import { DEFAULT_CONTEXT_WINDOW } from "../providers/presets.ts";
import { HANDLED, type ApiDeps } from "./api.ts";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;

// About four characters a token, the same rule compaction uses.
const tokensOf = (text: string) => Math.ceil(text.length / 4);

export function navRoutes(route: Route, deps: ApiDeps, h: { project: (id: string) => Project; thread: (id: string) => Thread }): void {
  const { store, runner } = deps;

  // Round 10 (SPEC 23.1): import from Chrome. Only when asked, only Bookmarks and History, and a
  // preview first. See chrome-import.ts for what is and is not read.
  const configHome = () => deps.chromeConfigHome ?? chromeConfigHome();
  route("GET", "/api/browser/chrome-profiles", () => listChromeProfiles(configHome()));
  route("POST", "/api/browser/chrome-import/preview", ({ body }) => previewChromeImport(configHome(), body ?? {}));
  route("POST", "/api/browser/chrome-import", ({ body }) => {
    const imported = runChromeImport(configHome(), deps.dataDir, body ?? {});
    return { bookmarks: imported.bookmarks.length, history: imported.history.length, source: imported.source, importedAt: imported.importedAt };
  });
  route("GET", "/api/browser/imported", () => readImported(deps.dataDir));
  route("DELETE", "/api/browser/imported", () => {
    removeImported(deps.dataDir);
  });

  // The parts are estimated from what the next step would send. When the provider has counted the
  // context, that count is the total and the messages are what is left after the rest.
  route("GET", "/api/threads/:id/context", ({ params }): ContextUsage => {
    const thread = h.thread(params.id);
    const project = thread.projectId ? store.project(thread.projectId) : undefined;
    const skills = thread.mode === "code" ? runner.skillsFor(project) : [];
    // The same prompt and tool list the next step would send (round 6: memories and new tools).
    const system = runner.systemPrompt(thread, project, skills);
    const tools = runner.toolDefs(thread, project, skills);
    const model = store.model(thread.modelId ?? store.settings().defaultModelId ?? "");
    const contextWindow = model?.contextWindow || DEFAULT_CONTEXT_WINDOW;
    const systemTokens = tokensOf(system);
    const toolTokens = tools.length ? tokensOf(JSON.stringify(tools)) : 0;
    const messageTokens = estimateTokens("", store.messages(thread.id));
    const measured = store.usage(thread.id).contextTokens;
    const usedTokens = Math.max(measured, systemTokens + toolTokens + messageTokens);
    const compactBuffer = Math.round(contextWindow * (1 - COMPACT_AT));
    return {
      threadId: thread.id,
      contextWindow,
      usedTokens,
      measured: measured > 0 && measured >= systemTokens + toolTokens + messageTokens,
      parts: {
        messages: Math.max(0, usedTokens - systemTokens - toolTokens),
        system: systemTokens,
        tools: toolTokens,
        compactBuffer: Math.min(compactBuffer, Math.max(0, contextWindow - usedTokens)),
        free: Math.max(0, contextWindow - usedTokens - compactBuffer),
      },
      tools: tools.length,
      skills: skills.length,
    };
  });

  // Which projects have a favicon, with its mtime as the version for the image address.
  route("GET", "/api/favicons", () => {
    const out: Record<string, number> = {};
    for (const project of store.projects()) {
      const found = findFavicon(project.path);
      if (found) out[project.id] = found.mtimeMs;
    }
    return out;
  });

  // Served for an <img> only: its own type, no sniffing, and a policy that lets an SVG run nothing.
  route("GET", "/api/projects/:id/favicon", ({ params, res }) => {
    const found = findFavicon(h.project(params.id).path);
    if (!found) throw new HttpError(404, "Prosjektet har ikke noe favicon");
    const bytes = readFileSync(found.file);
    if (bytes.length > MAX_FAVICON_BYTES) throw new HttpError(404, "Faviconet er for stort");
    res.writeHead(200, {
      "content-type": found.type,
      "content-length": bytes.length,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(bytes);
    return HANDLED;
  });

  route("GET", "/api/thread-stats", () => store.threadDiffStats());

  // Full, bundled history. Rendered as escaped text; never executes markdown/HTML.
  route("GET", "/api/releases", () => {
    try {
      const text = readFileSync(path.join(REPO_ROOT, "docs/PATCHLOG.md"), "utf8");
      return { entries: text.split(/^## /m).slice(1).map(section => {
        const end = section.indexOf("\n");
        return { title: (end < 0 ? section : section.slice(0, end)).trim(), body: end < 0 ? "" : section.slice(end + 1).trim() };
      }) };
    } catch { return { entries: [] }; }
  });

  // Hva er nytt in the profile menu: the newest entries of docs/PATCHLOG.md, read as text.
  route("GET", "/api/whatsnew", () => {
    let text = "";
    try {
      text = readFileSync(path.join(REPO_ROOT, "docs/PATCHLOG.md"), "utf8");
    } catch {
      return { entries: [] };
    }
    const entries: Array<{ title: string; lines: string[] }> = [];
    for (const section of text.split(/^## /m).slice(1, 4)) {
      const [title, ...rest] = section.split("\n");
      const lines = rest.map((l) => l.trim()).filter((l) => l.startsWith("- ") || /^\*\*[^*]+\*\*$/.test(l)).slice(0, 40);
      entries.push({ title: title.trim(), lines: lines.map((l) => l.slice(0, 600)) });
    }
    return { entries };
  });

  // Servers the app's own processes started (v0.6). Stop only reaches a process the app started.
  route("GET", "/api/servers", () => deps.servers?.list() ?? []);
  route("POST", "/api/servers/:id/stop", async ({ params }) => {
    if (!deps.servers) throw new HttpError(404, "Fant ikke serveren");
    await deps.servers.stop(params.id);
  });

  // Downloads from the Browser panel (v0.6). The list lives as long as the server does.
  route("GET", "/api/downloads", () => ({
    dir: deps.downloads?.dir() ?? defaultDownloadDir(),
    defaultDir: defaultDownloadDir(),
    items: deps.downloads?.list() ?? [],
  }));
  route("POST", "/api/downloads/:id/cancel", async ({ params }) => {
    await deps.downloads?.cancel(params.id);
  });
  route("DELETE", "/api/downloads/:id", ({ params, query }) => {
    if (!deps.downloads?.remove(params.id, query.get("file") === "1")) throw new HttpError(404, "Fant ikke nedlastingen, eller den pågår ennå");
  });
}
