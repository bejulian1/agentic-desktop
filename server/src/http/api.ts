import { languages } from "../../../shared/i18n.ts";
import { BUILTIN_COMMANDS } from "../../../shared/slash-commands.ts";
import { transcribe } from '../dictation.ts';
import { Schedules } from '../schedules.ts';
import type {UiMods} from "../ui-mods.ts";
import type {ChatWorkspace} from '../chat-workspace.ts';
// REST, as described in shared/protocol.ts.
import type { PromptCompletions } from "../prompt-completion.ts";
import { cleanContextText, lookupModelContextLocation, modelContextPatch, type ModelContextLookup } from "../model-context.ts";
import { GitWorkspace } from "../git-workspace.ts";
import { gitWorkspaceRoutes } from "./git-workspace-routes.ts";
import { cleanName } from "../names.ts";
import { NativeFolderPicker } from "../native-folder.ts";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import type {
  Bootstrap,
  BrowserAnnotationSnapshot,
  CommandInfo,
  LocalModelHardware,
  MentionItem,
  ModelConfig,
  PermissionMode,
  Project,
  ProviderConfig,
  ProviderKind,
  ReasoningEffort,
  ServerMessage,
  Settings,
  StatsRange,
  ThemeSetting,
  Thread,
} from "../../../shared/protocol.ts";
import { CHAT_WIDTHS, UI_CONTRASTS, BROWSER_ZOOMS, modelContextOf, chatToolsOf, DEFAULT_CHAT_TOOLS, ARTIFACT_LANGS, MAX_ARTIFACT_HTML, chatPersonalityId, PERSONALITIES, PROJECT_COLORS, THEME_PRESETS, isAppIcon, isProjectIcon, isMaxStepsPerTurn, MIN_STEPS_PER_TURN, MAX_STEPS_PER_TURN, threadNotificationsOf, type ProjectConfig } from "../../../shared/protocol.ts";
import { DEFAULT_LOCAL_CONTEXT_WINDOW, LOCAL_MODEL_CONTEXT_OPTIONS, type AllowRule } from "../../../shared/protocol.ts";
import { parseLocalRule, readLocalRules, ruleLabel, writeLocalRules } from "../agent/permissions.ts";
import { navRoutes } from "./nav-routes.ts";
import { harnessRoutes } from "./harness-routes.ts";
import { hooksRoutes } from "./hooks-routes.ts";
import type { Hooks } from "../hooks.ts";
import { mcpRoutes } from "./mcp-routes.ts";
import type { McpServers } from "../mcp/manager.ts";
import { chatRoutes } from "./chat-routes.ts";
import { chatProjectRoutes } from "./chat-project-routes.ts";
import { githubRoutes } from "./github-routes.ts";
import type { GitHub } from "../github.ts";
import { runde12Routes, runde12Settings } from "./runde12-routes.ts";
import { chatToolsFromBody, runde13Settings } from "./runde13-routes.ts";
import { Storage, storageRoutes } from "../storage.ts";
import { defaultDownloadDir } from "../downloads.ts";
import { checkDownloadDir, type Downloads } from "../downloads.ts";
import type { Servers } from "../servers.ts";
import type { Runner } from "../agent/runner.ts";
import { TurnConflict, type Turns } from "../agent/turns.ts";
import { loadBuildInfo } from "../build-info.ts";
import { readGitHead } from "../git-head.ts";
import { MOCK_MODEL_ID, MOCK_PROVIDER_ID, type Store, type ThreadPatch } from "../db.ts";
import { HttpError } from "../errors.ts";
import { fuzzyScore, listAllFiles, listDir, readFileContent } from "../files.ts";
import { listLocalDir, readLocalFile } from "../local-files.ts";
import { localFolder } from "../paths.ts";
import { assertOutsideDataDir, guardPath, guardProjectRoot, LOCAL_PANEL, PathError, realDeepest } from "../paths.ts";
import type { Playtest } from "../playtest.ts";
import { apiKeyFor, createProvider } from "../providers/index.ts";
import { testProviderModel } from "../providers/local.ts";
import { readLocalModelHardware } from "../providers/local-hardware.ts";
import { recommendLocalModels } from "../providers/local-recommendations.ts";
import { normalizeProviderBaseUrl, redact } from "../providers/http.ts";
import type { Secrets } from "../secrets.ts";
import type { ConfigDirs } from "../config-dirs.ts";
import type { TaskBoard } from "../agent/tasks.ts";
import { detectLocalProviders, fetchModelList, localKindFor, providerPreset, PROVIDER_PRESETS, tableContext, DEFAULT_CONTEXT_WINDOW } from "../providers/presets.ts";
import type { Terminals } from "../terminal.ts";
import type { Security } from "./security.ts";
import { Artifacts, downloadName } from "../artifacts.ts";
import type { PreviewServer } from "../preview.ts";
import { findImage, saveImage } from "../images.ts";
import { projectIconExists, removeProjectIcon } from "../project-icons.ts";
import { saveTextUpload } from "../uploads.ts";
import { makeFork } from "../agent/fork.ts";
import { HistoryImporter } from "../history-import/index.ts";
import { startBackgroundSession } from "../background-session.ts";
import type { SideQuestions } from "../side-questions.ts";
import type { ImportedCookies } from "../browser-cookies.ts";

const MAX_BODY = 5 * 1024 * 1024;
const MAX_LAYOUT = 64 * 1024;
const MAX_EVENTS = 20_000;
const MENTION_LIMIT = 30;
const FILE_CACHE_MS = 10_000;
const PERMISSION_MODES: PermissionMode[] = ["ask", "accept-edits", "full"];
const THEMES: ThemeSetting[] = ["light", "dark", "system"];
const STATS_RANGES: StatsRange[] = ["all", "30d", "7d"];
const PROVIDER_KINDS: ProviderKind[] = ["openai-compatible", "anthropic"];

export { BUILTIN_COMMANDS };

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export const HANDLED = Symbol("handled");

export interface ApiDeps {
  github: GitHub;
  uiMods?:UiMods;
  hooks?: Hooks; // Innstillinger → Hooks (hooks-routes.ts)
  mcp?: McpServers; // Innstillinger → MCP-servere (mcp-routes.ts)
  chatWorkspace?: ChatWorkspace;
  promptCompletion?: PromptCompletions;
  sideQuestions?: SideQuestions;
  store: Store;
  modelContextLookup?: ModelContextLookup;
  runner: Runner;
  turns: Turns;
  terminals: Terminals;
  playtest: Playtest;
  secrets: Secrets;
  security: Security;
  config: ConfigDirs;
  tasks: TaskBoard;
  preview: PreviewServer;
  dataDir: string;
  webDist: string;
  mockDelayMs: number;
  stallMs?: number;
  env: () => Record<string, string>;
  publish: (message: ServerMessage) => void;
  threadChanged: (threadId: string) => void;
  downloads?: Downloads; // the Browser panel's downloads, v0.6
  servers?: Servers; // servers the app's own processes started, v0.6
  browser?: { running: boolean; close: () => Promise<void>; setAppearance?: (mode: ThemeSetting) => Promise<void>; annotationSnapshot?: (projectId: string, tabId: string) => Promise<BrowserAnnotationSnapshot>; screenshot?: (projectId: string, tabId?: string) => Promise<{ png: Buffer; url: string }> }; // Lagring closes Chrome before it cleans the profile; Annoter freezes a tab (round 11b)
  viewedAt?: (threadId: string) => number | undefined; // when a window last showed the thread (ws.ts)
  chromeConfigHome?: string; // round 10: where Chrome profiles are looked for; tests give a temporary home
  homeDir?: string; // round 12: the home folder Firefox profiles are looked for in; tests give a temporary one
  importedCookies?: ImportedCookies; // round 12: cookies imported into the app's browser (SPEC 26.4)
  cookieBrowser?: { syncCookies: () => Promise<{ added: number; refused: number } | null>; dropSignedInGrants: (site?: string) => void }; // round 12
}

function json(res: ServerResponse, status: number, body: unknown): void {
  jsonText(res, JSON.stringify(body), status);
}

function jsonText(res: ServerResponse, text: string, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Forespørselen er for stor"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${name} mangler`);
  return value;
}

export class Api {
  private deps: ApiDeps;
  private routes: Route[] = [];
  private fileCache = new Map<string, { at: number; files: string[] }>();
  private artifacts: Artifacts;
  private folderPicker: NativeFolderPicker;
  private gitWorkspaces: GitWorkspace;
  readonly schedules: Schedules;

  constructor(deps: ApiDeps) {
    this.deps = deps;
    this.schedules = new Schedules(deps.store, item => {
      const project = item.projectId ? this.project(item.projectId) : undefined;
      if (project?.folderMissing) throw new HttpError(409, 'Prosjektmappen mangler.');
      const thread = deps.store.createThread(item.projectId, project ? 'code' : 'chat', item.modelId, { title: item.name });
      try {
        deps.store.setScheduleNotice(thread.id, true);
        deps.runner.send(thread.id, { text: item.prompt });
      } catch (error) { deps.store.deleteThread(thread.id); throw error; }
      deps.threadChanged(thread.id);
    });
    this.gitWorkspaces = new GitWorkspace({ dataDir: deps.dataDir, env: deps.env, activeProjects: () => deps.store.projects().filter((project) => deps.store.projectThreads(project.id).some((thread) => thread.running)) });
    this.folderPicker = new NativeFolderPicker({ env: deps.env });
    this.artifacts = new Artifacts(deps.store, deps.preview, deps.publish);
    this.registerRoutes();
  }

  async close(): Promise<void> {
    this.schedules.close();
    this.folderPicker.close();
    await this.gitWorkspaces.close();
    this.deps.promptCompletion?.close();
    this.deps.sideQuestions?.close();
  }

  private route(method: string, spec: string, handler: Handler): void {
    const keys: string[] = [];
    const source = spec.replace(/:(\w+)/g, (_match, key) => {
      keys.push(key);
      return "([^/]+)";
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const { security } = this.deps;
    const method = req.method ?? "GET";
    const mutating = method !== "GET" && method !== "HEAD";
    try {
      if (!security.originAllowed(req, mutating)) throw new HttpError(403, "Ugyldig Origin");
      const exchange = url.pathname === "/api/auth/exchange";
      if (!exchange && !security.authenticated(req)) throw new HttpError(401, "Ikke logget inn");

      let matched: { route: Route; match: RegExpExecArray } | undefined;
      for (const route of this.routes) {
        const match = route.method === method ? route.pattern.exec(url.pathname) : null;
        if (match) {
          matched = { route, match };
          break;
        }
      }
      if (!matched) throw new HttpError(404, "Fant ikke ressursen");

      let body: any = {};
      if (mutating) {
        const raw = await readBody(req);
        if (raw) {
          // A cross-site form cannot send this content type without a preflight.
          if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "Forventer JSON");
          try {
            body = JSON.parse(raw);
          } catch {
            throw new HttpError(400, "Ugyldig JSON");
          }
          // The handlers read body.x, so null, a number or a list would end as a 500.
          if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Forventer et JSON-objekt");
        }
      }
      const params: Record<string, string> = {};
      try {
        matched.route.keys.forEach((key, i) => (params[key] = decodeURIComponent(matched.match[i + 1])));
      } catch {
        throw new HttpError(400, "Ugyldig adresse");
      }
      const result = await matched.route.handler({ req, res, params, query: url.searchParams, body });
      if (result !== HANDLED) json(res, 200, result ?? { ok: true });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private sendError(res: ServerResponse, err: unknown): void {
    if (res.headersSent) return void res.destroy();
    if (err instanceof TurnConflict) return json(res, 409, { error: err.message, conflicts: err.conflicts });
    if (err instanceof HttpError) return json(res, err.status, { error: err.message, ...err.extra });
    if (err instanceof PathError) return json(res, err.status, { error: err.message });
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") return json(res, 403, { error: "Du har ikke tilgang til denne stien" });
    if (code === "ENOENT") return json(res, 404, { error: "Fant ikke filen" });
    if (["ENOTDIR", "EISDIR", "ELOOP", "ENAMETOOLONG", "ENXIO", "ENODEV"].includes(code ?? "")) return json(res, 400, { error: "Ugyldig sti" });
    const status = (err as { status?: number }).status;
    if (status) return json(res, status, { error: (err as Error).message });
    console.error("API-feil:", (err as Error).message);
    json(res, 500, { error: "Intern feil" });
  }

  private project(id: string): Project {
    const project = this.deps.store.project(id);
    if (!project) throw new HttpError(404, "Fant ikke prosjektet");
    return project;
  }

  private thread(id: string): Thread {
    const thread = this.deps.store.thread(id);
    if (!thread) throw new HttpError(404, "Fant ikke tråden");
    return thread;
  }

  // Round 9: a project whose folder is gone runs nothing until it is connected to a folder again.
  assertFolder(threadId: string): void {
    if (this.gitWorkspaces.busy && this.thread(threadId).projectId) throw new HttpError(409, "En Git-handling pågår. Vent før du starter modellarbeid.");
    const projectId = this.deps.store.thread(threadId)?.projectId;
    const project = projectId ? this.deps.store.project(projectId) : undefined;
    if (project?.folderMissing) throw new HttpError(409, `Fant ikke mappen ${project.path}. Velg mappen på nytt for å fortsette.`);
  }

  // settings.json names a model by id, name or model string.
  private findModel(wanted: string | undefined): string | undefined {
    if (!wanted) return undefined;
    const lower = wanted.toLowerCase();
    return this.deps.store.models().find((m) => m.id === wanted || m.name.toLowerCase() === lower || m.model.toLowerCase() === lower)?.id;
  }

  private providerConfigs(): ProviderConfig[] {
    const { store, secrets } = this.deps;
    return store.providers().map((p) => ({ ...p, localKind: localKindFor(p), hasKey: apiKeyFor(p, secrets) !== undefined }));
  }

  // The keyring answered after the start, or changed: hasKey may be different now.
  settingsChangedFromKeyring(): void {
    this.settingsChanged();
  }

  private allowRules(): AllowRule[] {
    const { store } = this.deps;
    const local = [...readLocalRules(store)].flatMap((entry) => {
      const rule = parseLocalRule(entry);
      return rule ? [{ projectId: LOCAL_PANEL, ...rule }] : [];
    });
    return [...store.allowRules(), ...local].map((rule) => ({ ...rule, label: ruleLabel(rule) }));
  }

  private settingsChanged(): void {
    const { store, publish } = this.deps;
    publish({ type: "settings.changed", settings: store.settings(), providers: this.providerConfigs(), models: store.models() });
  }

  invalidateFiles(projectId: string): void {
    this.fileCache.delete(projectId);
  }

  private async cachedFiles(project: Project): Promise<string[]> {
    const cached = this.fileCache.get(project.id);
    if (cached && Date.now() - cached.at < FILE_CACHE_MS) return cached.files;
    const files = await listAllFiles(project.path);
    this.fileCache.set(project.id, { at: Date.now(), files });
    return files;
  }

  // only: "dir" lists folders alone, for Legg til mappe in the + menu.
  private async mentions(project: Project, query: string, only: string | null = null): Promise<MentionItem[]> {
    const scored: Array<{ score: number; item: MentionItem }> = [];
    const files = await this.cachedFiles(project);
    const dirs = new Set<string>();
    for (const file of files) {
      for (let dir = path.dirname(file); dir !== "."; dir = path.dirname(dir)) {
        if (dirs.has(dir)) break;
        dirs.add(dir);
      }
    }
    for (const file of only === "dir" ? [] : files) {
      const score = fuzzyScore(query, file);
      if (score !== null) scored.push({ score, item: { kind: "file", label: file, path: file } });
    }
    for (const dir of dirs) {
      const score = fuzzyScore(query, dir);
      if (score !== null) scored.push({ score, item: { kind: "dir", label: `${dir}/`, path: dir } });
    }
    for (const thread of this.deps.store.projectThreads(project.id)) {
      if (thread.archived || only === "dir") continue;
      const score = fuzzyScore(query, thread.title);
      if (score !== null) scored.push({ score, item: { kind: "thread", label: thread.title, threadId: thread.id, running: thread.running } });
    }
    return scored.sort((a, b) => a.score - b.score).slice(0, MENTION_LIMIT).map((s) => s.item);
  }

  private commands(project: Project | undefined, chat = false, chatProject = false, includeReserved = false): CommandInfo[] {
    const discovered = chat ? this.deps.runner.chatSkills(chatProject) : this.deps.runner.skillsFor(project, "code");
    const reviewSkill = discovered.some((skill) => skill.name === "review");
    const skills = discovered.map((skill): CommandInfo => ({ name: skill.name, description: skill.description, kind: "skill", source: skill.source, ...(skill.args !== undefined ? { args: skill.args } : {}), ...(skill.mode ? { mode: skill.mode } : {}) }));
    const builtins = BUILTIN_COMMANDS.map((command) => command.name === "review-changes" && reviewSkill
      ? { ...command, aliases: command.aliases?.filter((alias) => alias !== "review") } : command);
    const reserved = new Set(builtins.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
    return [...builtins, ...skills.flatMap((skill) => {
      if (!reserved.has(skill.name)) return [skill];
      return includeReserved ? [{ ...skill, slashReserved: true }] : [];
    })];
  }

  private openVscode(project: Project): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("code", [project.path], { detached: true, stdio: "ignore", env: this.deps.env() });
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      child.once("error", (err) => {
        const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
        reject(new HttpError(502, missing ? "Fant ikke kommandoen code. Er VS Code installert?" : err.message));
      });
    });
  }

  private registerRoutes(): void {
    const { store, runner, turns, terminals, playtest, secrets, security, dataDir, publish, threadChanged } = this.deps;
    this.route('GET', '/api/schedules', () => this.schedules.list());
    this.route('POST', '/api/schedules', ({ body }) => this.schedules.save(body));
    this.route('PUT', '/api/schedules/:id', ({ body, params }) => this.schedules.save(body, params.id));
    this.route('PATCH', '/api/schedules/:id', ({ body, params }) => this.schedules.pause(params.id, body.paused));
    this.route('POST', '/api/schedules/:id/run', ({ params }) => this.schedules.run(params.id));
    this.route('DELETE', '/api/schedules/:id', ({ params }) => this.schedules.remove(params.id));
    this.route('POST', '/api/threads/:id/schedule-seen', ({ params }) => { const thread = this.thread(params.id); if (thread.scheduleNotice && !thread.running && thread.lastStatus) { store.setScheduleNotice(thread.id, false); threadChanged(thread.id); } });
    this.route('POST', '/api/dictation', async ({ body, res }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.once('close', abort);
      try { return await transcribe(store, secrets, body, controller.signal); }
      finally { res.off('close', abort); }
    });

    this.route("POST", "/api/auth/exchange", ({ res, body }) => {
      if (!security.exchange(res, body.token)) throw new HttpError(401, "Ugyldig token");
    });

    this.route("POST","/api/appearance/wallpaper",({body})=>this.deps.uiMods?.setWallpaper(body));
    this.route("DELETE","/api/appearance/wallpaper",()=>this.deps.uiMods?.clearWallpaper());
    this.route("GET","/api/appearance/wallpaper/:id",({res,params})=>{const image=this.deps.uiMods?.wallpaperImage(params.id);if(!image)throw new HttpError(404,"Fant ikke bakgrunnsbildet.");res.writeHead(200,{"content-type":image.mime,"cache-control":"private, no-store","x-content-type-options":"nosniff"});res.end(image.bytes);return HANDLED;});
    this.route("GET","/api/ui-mods",()=>this.deps.uiMods?.snapshot());
    this.route("PUT","/api/ui-mods/preferences",({body})=>this.deps.uiMods?.preferences(body));
    this.route("PUT","/api/ui-mods/library/:id",({body,params})=>{if(params.id!==body.id)throw new HttpError(400,"ID må stemme med adressen.");return this.deps.uiMods?.save(body);});
    this.route("DELETE","/api/ui-mods/library/:id",({params})=>this.deps.uiMods?.remove(params.id));
    this.route("POST","/api/ui-mods/threads/:id/consent",({params,body})=>{if(typeof body.allowed!=="boolean")throw new HttpError(400,"Bruk true/false.");this.deps.uiMods?.consent(params.id,body.allowed);return this.deps.uiMods?.snapshot();});
    this.route("PUT","/api/ui-mods/threads/:id",({params,body})=>{if(body.modId!==null&&typeof body.modId!=="string")throw new HttpError(400,"Velg et tema eller standard.");return this.deps.uiMods?.select(params.id,body.modId);});
    if (this.deps.mcp) mcpRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps.mcp);
    if (this.deps.hooks) hooksRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps.hooks);
    this.route("GET", "/api/chat-workspace/status", () => this.deps.chatWorkspace?.status() ?? {available:false, reason:"Python er ikke tilgjengelig."});
    this.route("GET", "/api/chat-files/:threadId", ({params}) => ({files:this.deps.chatWorkspace?.list(params.threadId) ?? []}));
    this.route("GET", "/api/chat-files/:threadId/:fileId/download", ({params,res}) => {
      if (!this.deps.chatWorkspace) throw new HttpError(404,"Fant ikke filen.");
      const {file,data}=this.deps.chatWorkspace.download(params.threadId,params.fileId);
      res.writeHead(200,{"content-type":file.mime,"content-length":data.length,"content-disposition":`attachment; filename="download.${file.name.split('.').pop()}"; filename*=UTF-8''${encodeRfc5987(file.name)}`,"cache-control":"no-store","x-content-type-options":"nosniff","content-security-policy":"sandbox; default-src 'none'"});
      res.end(data);return HANDLED;
    });

    this.route("GET", "/api/bootstrap", (): Bootstrap => ({
      uiMods:this.deps.uiMods?.snapshot(),
      mcp: this.deps.mcp?.snapshot(),
      build: loadBuildInfo(this.deps.webDist),
      settings: store.settings(),
      projects: store.projects(),
      threads: store.threads(),
      providers: this.providerConfigs(),
      models: store.models(),
      artifacts: this.artifacts.list(),
      chatProjects: store.chatProjects(),
      sections: store.sections(),
      keyring: secrets.status(),
    }));

    const history = new HistoryImporter({
      home: this.deps.homeDir ?? homedir(), dataDir, store, config: this.deps.config, threadChanged,
      findModel: (name) => this.findModel(name),
      projectChanged: (project) => publish({ type: "project.changed", project }),
    });
    this.route("POST", "/api/history-import/scan", () => history.scan());
    this.route("POST", "/api/history-import", ({ body }) => history.apply(body.scanId, body.threads));

    // Round 14 (SPEC 30.1): where the keys are kept, and a new try after the keyring was locked or
    // missing. A locked keyring shows the system's own unlock dialog.
    this.route("GET", "/api/keyring", () => secrets.status());
    this.route("POST", "/api/keyring/retry", () => secrets.load());

    this.route("POST", "/api/ws-ticket", () => ({ ticket: security.issueTicket() }));

    gitWorkspaceRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps, this.gitWorkspaces, (id) => this.project(id), (id) => this.invalidateFiles(id));

    // Projects

    this.route("POST", "/api/projects", ({ body }) => {
      const root = guardProjectRoot(requireString(body.path, "path"), dataDir);
      mkdirSync(root, { recursive: true });
      if (!statSync(root).isDirectory()) throw new HttpError(400, "Stien er ikke en mappe");
      const existing = store.projectByPath(root);
      if (existing) return existing;
      const name = (typeof body.name === "string" && cleanName(body.name)) || cleanName(path.basename(root)) || path.basename(root);
      // .agentic/settings.json, then the global settings.json, then the app's default.
      const folder = this.deps.config.effective({ path: root } as Project);
      const project = store.createProject(name, root, folder.permissionMode ?? store.settings().defaultPermissionMode);
      publish({ type: "project.changed", project });
      return project;
    });

    this.route("PATCH", "/api/projects/:id", async ({ params, body }) => {
      const current = this.project(params.id);
      if (body.permissionMode !== undefined && !PERMISSION_MODES.includes(body.permissionMode)) throw new HttpError(400, "Ugyldig tillatelsesmodus");
      if (body.name !== undefined && (typeof body.name !== "string" || !cleanName(body.name))) throw new HttpError(400, "Navnet er tomt");
      if (body.color !== undefined && body.color !== null && !PROJECT_COLORS.some((c) => c.id === body.color)) throw new HttpError(400, "Ukjent farge");
      if (body.icon !== undefined && body.icon !== null && (typeof body.icon !== "string" || !isProjectIcon(body.icon))) throw new HttpError(400, "Ukjent ikon");
      // An uploaded icon is made with POST /api/projects/:id/icon; here it can only be one that is there.
      if (typeof body.icon === "string" && body.icon.startsWith("file:") && !projectIconExists(dataDir, body.icon)) throw new HttpError(400, "Fant ikke ikonfilen");
      if (body.defaultModelId && !store.model(body.defaultModelId)) throw new HttpError(400, "Fant ikke modellen");
      if (body.pinned !== undefined && typeof body.pinned !== "boolean") throw new HttpError(400, "pinned må være sann eller usann");
      if (body.agentBrowserAccess !== undefined && body.agentBrowserAccess !== null && typeof body.agentBrowserAccess !== "boolean") {
        throw new HttpError(400, "Ugyldig verdi for agentBrowserAccess");
      }
      let newPath: string | undefined;
      if (body.path !== undefined) {
        // Same rules as a new project. Running threads, terminals and the preview use the old
        // folder, so they must be stopped first.
        newPath = guardProjectRoot(requireString(body.path, "path"), dataDir);
        if (newPath !== current.path) {
          if (store.projectThreads(params.id).some((t) => t.running)) throw new HttpError(409, "En tråd kjører i prosjektet");
          if (store.projectByPath(newPath)) throw new HttpError(409, "Mappen er allerede et prosjekt");
          mkdirSync(newPath, { recursive: true });
          if (!statSync(newPath).isDirectory()) throw new HttpError(400, "Stien er ikke en mappe");
          await playtest.stop(params.id);
          for (const terminal of terminals.list(params.id)) await terminals.close(terminal.terminalId);
          this.invalidateFiles(params.id);
        } else newPath = undefined;
      }
      store.updateProject(params.id, {
        name: typeof body.name === "string" ? cleanName(body.name) : undefined,
        permissionMode: body.permissionMode,
        color: body.color,
        icon: body.icon,
        defaultModelId: body.defaultModelId === undefined ? undefined : body.defaultModelId || null,
        path: newPath,
        pinned: body.pinned,
        agentBrowserAccess: body.agentBrowserAccess,
      });
      const project = this.project(params.id);
      // The uploaded image goes when the project no longer uses it.
      if (body.icon !== undefined && current.icon !== project.icon) removeProjectIcon(dataDir, current.icon);
      publish({ type: "project.changed", project });
      if (newPath) publish({ type: "project.files-changed", projectId: project.id, paths: ["."] });
      return project;
    });

    // Innstillinger → Tillatelser: one mode for every project at once, after the default changed.
    this.route("POST", "/api/projects/apply-permission-mode", ({ body }) => {
      if (!PERMISSION_MODES.includes(body.permissionMode)) throw new HttpError(400, "Ugyldig tillatelsesmodus");
      const changed: Project[] = [];
      for (const project of store.projects()) {
        if (project.permissionMode === body.permissionMode) continue;
        store.updateProject(project.id, { permissionMode: body.permissionMode });
        const fresh = store.project(project.id)!;
        changed.push(fresh);
        publish({ type: "project.changed", project: fresh });
      }
      return { changed: changed.length, projects: store.projects() };
    });

    // Saved "Tillat alltid" answers, for every project and Denne datamaskinen, and taking them back.
    this.route("GET", "/api/permissions/rules", (): AllowRule[] => this.allowRules());
    this.route("POST", "/api/permissions/rules/remove", ({ body }) => {
      const projectId = requireString(body.projectId, "projectId");
      const kind = requireString(body.kind, "kind");
      const value = typeof body.value === "string" ? body.value : "";
      if (projectId === LOCAL_PANEL) {
        const rules = readLocalRules(store);
        if (!rules.delete(`${kind}:${value}`)) throw new HttpError(404, "Fant ikke regelen");
        writeLocalRules(store, rules);
      } else if (!store.removeAllowRule(projectId, kind, value)) throw new HttpError(404, "Fant ikke regelen");
      return this.allowRules();
    });
    this.route("POST", "/api/permissions/rules/clear", ({ body }) => {
      const projectId = body.projectId === undefined ? undefined : requireString(body.projectId, "projectId");
      if (projectId === undefined || projectId === LOCAL_PANEL) writeLocalRules(store, []);
      if (projectId !== LOCAL_PANEL) store.clearAllowRules(projectId);
      return this.allowRules();
    });

    // Round 9: read again, so the folder is checked now (Project.folderMissing).
    this.route("GET", "/api/projects/:id", ({ params }) => this.project(params.id));

    // Round 9: connects a project whose folder moved to a folder that exists. The same checks as a
    // new project (absolute, real path, not the root, not the data folder), and the folder must
    // already be there: this never creates one.
    this.route("POST", "/api/projects/:id/relink", async ({ params, body }) => {
      this.project(params.id);
      const root = guardProjectRoot(requireString(body.path, "path"), dataDir);
      let isDir = false;
      try {
        isDir = statSync(root).isDirectory();
      } catch {
        // missing: said below
      }
      if (!isDir) throw new HttpError(400, "Fant ikke mappen. Velg en mappe som finnes.");
      const other = store.projectByPath(root);
      if (other && other.id !== params.id) throw new HttpError(409, "Mappen er allerede et prosjekt");
      if (store.projectThreads(params.id).some((t) => t.running)) throw new HttpError(409, "En tråd kjører i prosjektet");
      await playtest.stop(params.id);
      for (const terminal of terminals.list(params.id)) await terminals.close(terminal.terminalId);
      this.invalidateFiles(params.id);
      store.updateProject(params.id, { path: root });
      store.touchProject(params.id);
      const project = this.project(params.id);
      publish({ type: "project.changed", project });
      publish({ type: "project.files-changed", projectId: project.id, paths: ["."] });
      return project;
    });

    chatProjectRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps);

    // Round 11 (SPEC 24.6): sections in the sidebar.
    this.route("POST", "/api/sections", ({ body }) => {
      const name = typeof body.name === "string" ? cleanName(body.name) : "";
      if (!name) throw new HttpError(400, "Navnet er tomt");
      if (body.mode !== "chat" && body.mode !== "code") throw new HttpError(400, "Ukjent modus");
      const section = store.createSection(name, body.mode);
      publish({ type: "section.changed", section });
      return section;
    });
    this.route("PATCH", "/api/sections/:id", ({ params, body }) => {
      if (!store.section(params.id)) throw new HttpError(404, "Fant ikke seksjonen");
      const name = typeof body.name === "string" ? cleanName(body.name) : "";
      if (!name) throw new HttpError(400, "Navnet er tomt");
      store.renameSection(params.id, name);
      const section = store.section(params.id)!;
      publish({ type: "section.changed", section });
      return section;
    });
    this.route("DELETE", "/api/sections/:id", ({ params }) => {
      if (!store.section(params.id)) throw new HttpError(404, "Fant ikke seksjonen");
      const moved = store.deleteSection(params.id);
      publish({ type: "section.deleted", sectionId: params.id });
      for (const id of moved) threadChanged(id);
    });

    this.route("GET", "/api/projects/:id/config", ({ params }): ProjectConfig => {
      const project = this.project(params.id);
      const { config } = this.deps;
      const layer = config.project(project);
      const instructionFiles = ["AGENTS.md", "CLAUDE.md"].filter((name) => existsSync(path.join(project.path, name))).slice(0, 1);
      if (layer.agentsMd !== null) instructionFiles.push(".agentic/AGENTS.md");
      const global = config.global();
      if (global.agentsMd !== null) instructionFiles.unshift(path.join(global.dir, "AGENTS.md"));
      return { global, project: layer, effective: config.effective(project), instructionFiles };
    });

    this.route("PUT", "/api/projects/:id/instructions", ({ params, body }) => {
      const project = this.project(params.id);
      if (typeof body.text !== "string") throw new HttpError(400, "text mangler");
      this.deps.config.writeProjectAgents(project, body.text);
      this.invalidateFiles(project.id);
      publish({ type: "project.files-changed", projectId: project.id, paths: [".agentic/AGENTS.md"] });
    });

    this.route("DELETE", "/api/projects/:id", async ({ params }) => {
      const removed = this.project(params.id);
      if (store.projectThreads(params.id).some((t) => t.running)) throw new HttpError(409, "En tråd kjører i prosjektet");
      await playtest.stop(params.id);
      for (const terminal of terminals.list(params.id)) await terminals.close(terminal.terminalId);
      store.deleteProject(params.id);
      removeProjectIcon(dataDir, removed.icon);
      publish({ type: "project.deleted", projectId: params.id });
    });

    this.route("POST", "/api/fs/pick-folder", async ({ body }) => {
      const selected = await this.folderPicker.pick(body.start, body.title);
      if (selected) assertOutsideDataDir(realDeepest(selected), dataDir);
      return { path: selected };
    });

    this.route("GET", "/api/fs/browse", ({ query }) => {
      const target = realDeepest(path.resolve(query.get("path") || homedir()));
      assertOutsideDataDir(target, dataDir);
      if (!existsSync(target) || !statSync(target).isDirectory()) throw new HttpError(404, "Fant ikke mappen");
      const dirs = readdirSync(target, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => ({ name: d.name, path: path.join(target, d.name), kind: "dir" as const }))
        .sort((a, b) => a.name.localeCompare(b.name, "nb"));
      const parent = path.dirname(target);
      return { path: target, parent: parent === target ? null : parent, dirs };
    });

    this.route("POST", "/api/projects/:id/stop-all", ({ params }) => {
      this.project(params.id);
      return { stopped: runner.stopProject(params.id) };
    });

    // The branch chip: read from .git/HEAD in the project folder. No git command is run.
    this.route("GET", "/api/projects/:id/git", ({ params }) => readGitHead(this.project(params.id).path));

    this.route("GET", "/api/projects/:id/usage", ({ params }) => {
      this.project(params.id);
      return store.projectUsage(params.id);
    });

    this.route("GET", "/api/commands", ({ query }) => this.commands(undefined, query.get("mode") === "chat", query.get("scope") === "project", query.get("includeReserved") === "1"));
    this.route("GET", "/api/projects/:id/commands", ({ params, query }) => this.commands(this.project(params.id), false, false, query.get("includeReserved") === "1"));
    this.route("GET", "/api/projects/:id/mentions", ({ params, query }) => this.mentions(this.project(params.id), query.get("q") ?? "", query.get("kind")));

    const layoutKey = (id: string) => {
      if (id !== "chat" && id !== "local") this.project(id);
      return id;
    };
    this.route("GET", "/api/projects/:id/layout", ({ params }) => ({ layout: store.layout(layoutKey(params.id)) }));
    this.route("PUT", "/api/projects/:id/layout", ({ params, body }) => {
      const key = layoutKey(params.id);
      if (JSON.stringify(body.layout ?? null).length > MAX_LAYOUT) throw new HttpError(413, "Oppsettet er for stort");
      store.setLayout(key, body.layout ?? null);
      // The window that saved it skips its own echo, so a slow echo cannot undo a newer change there.
      const clientId = typeof body.clientId === "string" && body.clientId.length <= 64 ? body.clientId : undefined;
      publish({ type: "project.layout", projectId: key, layout: body.layout ?? null, ...(clientId ? { clientId } : {}) });
    });

    this.route("GET", "/api/projects/:id/tree", ({ params, query }) => {
      return listDir(this.project(params.id).path, query.get("path") || ".", dataDir, { respectIgnore: true });
    });
    // Explicit manual reads for Denne datamaskinen. No local project or agent capability is created.
    this.route("GET", "/api/local/files/root", () => ({ path: localFolder(dataDir, this.deps.homeDir) }));
    this.route("GET", "/api/local/files/tree", ({ query }) => listLocalDir(requireString(query.get("path"), "path"), dataDir));
    this.route("GET", "/api/local/files/file", ({ query }) => readLocalFile(requireString(query.get("path"), "path"), dataDir));
    this.route("GET", "/api/projects/:id/file", ({ params, query }) => {
      return readFileContent(this.project(params.id).path, requireString(query.get("path"), "path"), dataDir);
    });
    this.route("POST", "/api/projects/:id/init", ({ params }) => {
      const project = this.project(params.id);
      const { abs } = guardPath(project.path, "AGENTS.md", dataDir);
      if (existsSync(abs)) throw new HttpError(409, "AGENTS.md finnes allerede");
      writeFileSync(abs, agentsTemplate(project.name), { flag: "wx" });
      this.invalidateFiles(project.id);
      publish({ type: "project.files-changed", projectId: project.id, paths: ["AGENTS.md"] });
      return { path: "AGENTS.md" };
    });

    // Round 9: "local" is the terminal on Denne datamaskinen, opened from a start page (SPEC 21.9).
    this.route("GET", "/api/projects/:id/terminals", ({ params }) => terminals.list(params.id === LOCAL_PANEL ? LOCAL_PANEL : this.project(params.id).id));
    this.route("POST", "/api/projects/:id/open-vscode", async ({ params }) => {
      await this.openVscode(this.project(params.id));
    });
    this.route("GET", "/api/projects/:id/playtest", ({ params }) => playtest.state(this.project(params.id).id));
    this.route("POST", "/api/projects/:id/playtest/start", ({ params }) => playtest.start(this.project(params.id)));
    this.route("POST", "/api/projects/:id/playtest/stop", ({ params }) => playtest.stop(this.project(params.id).id));

    // Threads

    this.route("POST", "/api/threads", ({ body }) => {
      const title = typeof body.title === "string" ? cleanName(body.title) : undefined;
      if (body.title !== undefined && !title) throw new HttpError(400, "Tittelen er tom");
      const projectId: string | null = body.projectId ?? null;
      const mode = body.mode ?? (projectId ? "code" : "chat");
      if (mode !== "chat" && mode !== "code") throw new HttpError(400, "Ugyldig modus");
      if (projectId) this.project(projectId);
      // Kode without a project is Denne datamaskinen: the agent works in the home folder (Runner.localProject).
      if (body.chatProjectId !== undefined && body.chatProjectId !== null && (typeof body.chatProjectId !== "string" || !body.chatProjectId)) throw new HttpError(400, "Ugyldig Chat-prosjekt");
      if (body.sideOf !== undefined && body.sideOf !== null && (typeof body.sideOf !== "string" || !body.sideOf)) throw new HttpError(400, "Ugyldig sidechat");
      const chatProjectId: string | null = body.chatProjectId ?? null;
      if (chatProjectId && (mode !== "chat" || projectId || !store.chatProject(chatProjectId))) throw new HttpError(400, "Fant ikke Chat-prosjektet");
      if (body.modelId && !store.model(body.modelId)) throw new HttpError(400, "Fant ikke modellen");
      const project = projectId ? this.project(projectId) : undefined;
      // Round 12 (SPEC 26.1): the old threads can be read, but no new ones until the folder is back.
      if (project?.folderMissing) throw new HttpError(409, `Fant ikke mappen ${project.path}. Velg mappen på nytt for å lage nye tråder i prosjektet.`);
      const folder = this.deps.config.effective(project);
      const modelId = body.modelId ?? project?.defaultModelId ?? this.findModel(folder.model) ?? null;
      // A side chat: a new thread in the same project that links back to the one it came from.
      const side = typeof body.sideOf === "string" ? this.thread(body.sideOf) : undefined;
      if (side && (side.projectId !== projectId || side.mode !== mode || (chatProjectId && side.chatProjectId !== chatProjectId))) throw new HttpError(400, "En sidechat hører til samme prosjekt og modus");
      const thread = side
        ? store.createThread(projectId, mode, modelId, { title: title ?? `Sidechat: ${side.title}`.slice(0, 80), parentThreadId: side.id, origin: "user" })
        : store.createThread(projectId, mode, modelId, { title });
      const inChatProject = chatProjectId ?? side?.chatProjectId ?? null;
      if (inChatProject) {
        store.setThreadChatProject(thread.id, inChatProject);
        store.touchChatProject(inChatProject);
        publish({ type: "chat-project.changed", project: store.chatProject(inChatProject)! });
      }
      if (side?.temporary) store.markTemporary(thread.id);
      // settings.json names one of Kode's personalities; a chat follows Chat-personalisering.
      if (mode === "code" && folder.personality && folder.personality !== "standard") store.updateThread(thread.id, { personality: folder.personality });
      // Round 13 (SPEC 27.2): tools chosen on the start page, before the chat existed.
      if (body.chatTools !== undefined && body.chatTools !== null && mode === "chat" && !projectId) {
        store.updateThread(thread.id, { chatTools: chatToolsFromBody(body.chatTools, chatToolsOf(undefined, store.settings())) });
      }
      threadChanged(thread.id);
      // A new thread in a project is using it: «sist brukt» moves, for the start page and the picker.
      if (projectId) {
        store.touchProject(projectId);
        const touched = store.project(projectId);
        if (touched) publish({ type: "project.changed", project: touched });
      }
      return store.thread(thread.id)!;
    });

    this.route("GET", "/api/threads/search", ({ query }) => store.searchThreads(query.get("q") ?? ""));
    this.route("GET", "/api/threads/archived", () => store.archivedThreads());

    this.route("PATCH", "/api/threads/:id", ({ params, body }) => {
      const current = this.thread(params.id);
      if (body.chatProjectId !== undefined) {
        // Only chats move between Chat projects. A Kode thread has a folder, or is Denne datamaskinen.
        if (current.mode !== "chat" || current.projectId) throw new HttpError(400, "Bare chatter kan ligge i et Chat-prosjekt");
        if (body.chatProjectId !== null && (typeof body.chatProjectId !== "string" || !store.chatProject(body.chatProjectId))) throw new HttpError(400, "Fant ikke Chat-prosjektet");
        if ((current.chatProjectId ?? null) !== body.chatProjectId) runner.assertThreadContextIdle(params.id);
        store.setThreadChatProject(params.id, body.chatProjectId);
        if (body.chatProjectId) {
          store.touchChatProject(body.chatProjectId);
          publish({ type: "chat-project.changed", project: store.chatProject(body.chatProjectId)! });
        }
      }
      if (body.sectionId !== undefined) {
        // A section holds threads of its own mode only.
        if (body.sectionId !== null) {
          const section = typeof body.sectionId === "string" ? store.section(body.sectionId) : undefined;
          if (!section) throw new HttpError(400, "Fant ikke seksjonen");
          if (section.mode !== current.mode) throw new HttpError(400, "Seksjonen hører til den andre modusen");
        }
        store.setThreadSection(params.id, body.sectionId);
      }
      if (body.modelId !== undefined && body.modelId !== null && (typeof body.modelId !== "string" || !store.model(body.modelId))) throw new HttpError(400, "Fant ikke modellen");
      if (body.title !== undefined && (typeof body.title !== "string" || !cleanName(body.title))) throw new HttpError(400, "Tittelen er tom");
      // Round 13 (SPEC 27.2): the tools of a chat, for this thread. null follows the defaults again.
      if (body.chatTools !== undefined) {
        if (current.mode !== "chat" || current.projectId) throw new HttpError(400, "Bare chatter har verktøyvalg");
        store.updateThread(params.id, { chatTools: body.chatTools === null ? null : chatToolsFromBody(body.chatTools, chatToolsOf(current, store.settings())) });
      }
      const changes = threadPatch(body, current.mode);
      if (changes.archived === true && (!current.running || current.pendingQuestions)) runner.stop(current.id);
      store.updateThread(params.id, changes);
      if (body.modelId !== undefined) runner.recordModelChange(params.id, current.modelId);
      threadChanged(params.id);
      return this.thread(params.id);
    });

    this.route("POST", "/api/threads/:id/fork", ({ params, body }) => {
      const source = this.thread(params.id);
      // Round 12 (SPEC 26.1): a fork is a new thread in the same project.
      const sourceProject = source.projectId ? store.project(source.projectId) : undefined;
      if (sourceProject?.folderMissing) throw new HttpError(409, `Fant ikke mappen ${sourceProject.path}. Velg mappen på nytt for å lage nye tråder i prosjektet.`);
      // Round 14 (SPEC 30.3): «‹tittel› (gaffel)», with a link back to where it came from.
      const fork = makeFork(store, source, { messageId: typeof body.messageId === "string" ? body.messageId : undefined, from: body.from === "last" ? "last" : undefined });
      threadChanged(fork.id);
      return fork;
    });

    // Round 14 (SPEC 30.4 and 30.5): archive or bring back several threads at once: the ones named,
    // or all in a project (Kode) or a Chat project. A thread that runs is not archived; the answer
    // says how many were left, so the toast can say so. The ids that changed come back for Angre.
    this.route("POST", "/api/threads/archive", ({ body }) => {
      const archived = body.archived !== false;
      let list: Thread[];
      if (Array.isArray(body.ids)) {
        list = body.ids.flatMap((id: unknown) => (typeof id === "string" && store.thread(id) ? [store.thread(id)!] : []));
      } else if (typeof body.projectId === "string") {
        if (!store.project(body.projectId)) throw new HttpError(404, "Fant ikke prosjektet");
        list = store.projectThreads(body.projectId);
      } else if (typeof body.chatProjectId === "string") {
        if (!store.chatProject(body.chatProjectId)) throw new HttpError(404, "Fant ikke prosjektet");
        list = store.threads().filter((t) => t.chatProjectId === body.chatProjectId && !t.projectId);
      } else throw new HttpError(400, "Si hvilke tråder");
      const candidates = list.filter((t) => t.archived !== archived && !t.temporary);
      const running = archived ? candidates.filter((t) => t.running && !t.pendingQuestions) : [];
      const changed = candidates.filter((t) => !(archived && t.running && !t.pendingQuestions));
      for (const thread of changed) {
        if (archived) runner.stop(thread.id);
        store.updateThread(thread.id, { archived });
        threadChanged(thread.id);
      }
      return { ids: changed.map((t) => t.id), running: running.length };
    });

    this.route("DELETE", "/api/threads/:id", ({ params }) => {
      if (this.thread(params.id).running) throw new HttpError(409, "Tråden kjører");
      runner.stop(params.id); // also release waiters for an idle queue before deleting it
      store.deleteThread(params.id);
      this.deps.chatWorkspace?.remove(params.id);
      this.deps.uiMods?.forgetThread(params.id);
      runner.files.forgetThread(params.id);
      publish({ type: "thread.deleted", threadId: params.id });
    });

    this.route("GET", "/api/threads/:id/run-watch", ({ params, query }) => {
      this.thread(params.id);
      const run = query.get("run");
      const status = store.runWatchStatus(params.id, run);
      if (run && !status) throw new HttpError(404, "Fant ikke den overvåkede kjøringen.");
      return { run: status };
    });

    this.route("GET", "/api/threads/:id/queue", ({ params, res }) => {
      this.thread(params.id);
      res.setHeader("x-thread-history-revision", String(store.historyRevision(params.id)));
      return runner.queuedSnapshot(params.id);
    });

    this.route("GET", "/api/threads/:id/summary-changes", ({ params }) => {
      if (this.thread(params.id).mode !== "code") throw new HttpError(400, "Endringssammendraget gjelder Kode");
      return store.summaryChanges(params.id);
    });

    // Sent as the stored JSON text, without parsing each event (db.ts, eventsJson).
    this.route("GET", "/api/threads/:id/events", ({ res, params, query }) => {
      this.thread(params.id);
      const limit = Math.min(Number(query.get("limit") ?? 5000) || 5000, MAX_EVENTS);
      const tail = Number(query.get("tail"));
      const rows = tail > 0
        ? store.eventsTailJson(params.id, Math.min(tail, MAX_EVENTS))
        : store.eventsJson(params.id, Number(query.get("after") ?? 0) || 0, limit);
      res.setHeader("x-thread-history-revision", String(store.historyRevision(params.id)));
      jsonText(res, `[${rows.join(",")}]`);
      return HANDLED;
    });

    this.route("POST", "/api/prompt-completion", async ({ req, res, body }) => {
      const cancelled = new AbortController();
      const abort = () => { if (!res.writableEnded) cancelled.abort(); };
      req.once("aborted", abort);
      res.once("close", abort);
      try { return await this.deps.promptCompletion?.generate(body, cancelled.signal) ?? { completion: "" }; }
      finally { req.off("aborted", abort); res.off("close", abort); }
    });

    this.route("POST", "/api/threads/:id/messages", ({ params, body }) => {
      this.assertFolder(params.id);
      return runner.send(params.id, {
        text: typeof body.text === "string" ? body.text : "",
        attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
        skill: typeof body.skill === "string" ? body.skill : undefined,
        shell: typeof body.shell === "string" ? body.shell : undefined,
        review: body.review === true,
        steer: typeof body.steer === "boolean" ? body.steer : undefined,
      });
    });

    this.route("POST", "/api/threads/:id/background", ({ params, body }) => {
      this.assertFolder(params.id);
      return startBackgroundSession(store, runner, params.id, body, threadChanged);
    });

    this.route("POST", "/api/threads/:id/btw", async ({ params, body, req, res }) => {
      this.thread(params.id);
      if (!this.deps.sideQuestions) throw new HttpError(503, "Sidespørsmål er ikke tilgjengelig");
      const disconnected = new AbortController();
      const abort = () => { if (!res.writableEnded) disconnected.abort(); };
      req.once("aborted", abort); res.once("close", abort);
      let started = false;
      try {
        await this.deps.sideQuestions.answer(params.id, body, disconnected.signal, (event) => {
          if (disconnected.signal.aborted || res.destroyed) return;
          if (!started) { res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); started = true; }
          res.write(JSON.stringify(event) + "\n");
        });
        if (!started && !res.destroyed) res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
        res.end();
        return HANDLED;
      } finally { req.off("aborted", abort); res.off("close", abort); }
    });

    // The inline card of a helper thread: one line from its latest answer, nothing else.
    this.route("GET", "/api/threads/:id/latest-reply", ({ params }) => {
      this.thread(params.id);
      const text = runner.collab.finalAnswer(params.id).replace(/\s+/g, " ").trim();
      return { text: text ? (text.length > 240 ? `${text.slice(0, 239)}…` : text) : null };
    });

    this.route("POST", "/api/threads/:id/stop", ({ params }) => {
      this.thread(params.id);
      return { stopped: runner.stop(params.id) };
    });

    this.route("POST", "/api/threads/:id/compact", ({ params }) => runner.compact(params.id));

    this.route("POST", "/api/threads/:id/questions/:requestId", ({ params, body }) => {
      this.thread(params.id);
      runner.userInputs.answer(params.id, params.requestId, body);
      return { accepted: true };
    });

    this.route("POST", "/api/approvals/:id", ({ params, body }) => {
      if (!["allow", "allow-always", "deny"].includes(body.decision)) throw new HttpError(400, "Ugyldig svar");
      runner.resolveApproval(params.id, body.decision);
    });

    this.route("GET", "/api/turns/:id/diff", ({ params, query }) => {
      if (!store.turnThread(params.id)) throw new HttpError(404, "Fant ikke turen");
      return turns.diff(params.id, query.get("ignoreWhitespace") === "1");
    });
    this.route("POST", "/api/turns/:id/revert", ({ params, body }) => runner.revertTurn(params.id, body.force === true));

    // Round 11b (SPEC 25.1): Annoter in the Browser panel freezes the tab on screen as a PNG. Nothing
    // is saved; the panel sends the finished picture as an ordinary image upload.
    this.route("GET", "/api/browser/annotation", async ({ query }) => {
      const projectId = query.get("projectId") ?? "";
      if (projectId !== LOCAL_PANEL) this.project(projectId);
      const tab = query.get("tabId") ?? "";
      if (tab && !/^[a-z0-9-]{1,40}$/i.test(tab)) throw new HttpError(400, "Ugyldig nettleserfane");
      const browser = this.deps.browser;
      if (!browser?.annotationSnapshot) throw new HttpError(404, "Elementvalg er ikke tilgjengelig");
      return browser.annotationSnapshot(projectId, tab);
    });

    this.route("GET", "/api/browser/screenshot", async ({ res, query }) => {
      const projectId = query.get("projectId") ?? "";
      if (projectId !== LOCAL_PANEL) this.project(projectId);
      const browser = this.deps.browser;
      if (!browser?.screenshot) throw new HttpError(404, "Nettleseren er ikke tilgjengelig");
      const tab = query.get("tabId") ?? "";
      const { png } = await browser.screenshot(projectId, /^[a-z0-9-]{1,40}$/i.test(tab) ? tab : "");
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(png);
      return HANDLED;
    });

    this.route("GET", "/api/screenshots/:id", ({ res, params }) => {
      if (!/^[0-9a-f-]{36}$/.test(params.id)) throw new HttpError(404, "Fant ikke bildet");
      const file = path.join(dataDir, "screenshots", `${params.id}.png`);
      if (!existsSync(file)) throw new HttpError(404, "Fant ikke bildet");
      res.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=3600" });
      createReadStream(file).pipe(res);
      return HANDLED;
    });

    this.route("POST", "/api/images", ({ body }) => ({ id: saveImage(dataDir, body.mime, body.data) }));
    this.route("POST", "/api/uploads", ({ body }) => ({ id: saveTextUpload(dataDir, body.name, body.text) }));

    this.route("GET", "/api/images/:id", ({ res, params }) => {
      const found = findImage(dataDir, params.id);
      if (!found) throw new HttpError(404, "Fant ikke bildet");
      res.writeHead(200, { "content-type": found.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
      createReadStream(found.file).pipe(res);
      return HANDLED;
    });

    // Settings, providers and models

    this.route("PATCH", "/api/settings", ({ body }) => {
      const patch: Partial<Settings> = {};
      if (body.githubOpenLinks !== undefined) {
        if (typeof body.githubOpenLinks !== "boolean") throw new HttpError(400, "Velg om GitHub-lenker skal åpnes i appen.");
        patch.githubOpenLinks = body.githubOpenLinks;
      }
      if (body.welcomeDone !== undefined) {
        if (typeof body.welcomeDone !== "boolean") throw new HttpError(400, "Bruk true/false.");
        patch.welcomeDone = body.welcomeDone;
      }
      if (body.dictation !== undefined) {
        const choice = body.dictation;
        if (choice !== null && (typeof choice?.providerId !== 'string' || store.provider(choice.providerId)?.kind !== 'openai-compatible' || typeof choice.model !== 'string' || !choice.model.trim() || choice.model.length > 200)) throw new HttpError(400, 'Velg en kompatibel leverandør og en talemodell.');
        patch.dictation = choice && { providerId: choice.providerId, model: choice.model.trim() };
      }
      if (body.autoCompact !== undefined) {
        if (typeof body.autoCompact !== "boolean") throw new HttpError(400, "Komprimering må være av eller på");
        patch.autoCompact = body.autoCompact;
      }
      if (body.maxStepsPerTurn !== undefined) {
        if (!isMaxStepsPerTurn(body.maxStepsPerTurn)) throw new HttpError(400, `Steg per tur må være et heltall fra ${MIN_STEPS_PER_TURN} til ${MAX_STEPS_PER_TURN}`);
        patch.maxStepsPerTurn = body.maxStepsPerTurn;
      }
      if (body.theme !== undefined) {
        if (!THEMES.includes(body.theme)) throw new HttpError(400, "Ugyldig tema");
        patch.theme = body.theme;
      }
      if (body.defaultPermissionMode !== undefined) {
        if (!PERMISSION_MODES.includes(body.defaultPermissionMode)) throw new HttpError(400, "Ugyldig tillatelsesmodus");
        patch.defaultPermissionMode = body.defaultPermissionMode;
      }
      if (body.defaultModelId !== undefined) {
        if (!store.model(body.defaultModelId)) throw new HttpError(400, "Fant ikke modellen");
        patch.defaultModelId = body.defaultModelId;
      }
      if (body.autoOpenAgentThreads !== undefined) patch.autoOpenAgentThreads = body.autoOpenAgentThreads === true;
      if (body.memories !== undefined) patch.memories = body.memories === true;
      if (body.alwaysOnTop !== undefined) patch.alwaysOnTop = body.alwaysOnTop === true;
      if (body.artifactPreview !== undefined) patch.artifactPreview = body.artifactPreview === true;
      if (body.homeStats !== undefined) patch.homeStats = body.homeStats === true;
      if (body.sidebarCollapsed !== undefined) {
        if (body.sidebarCollapsed !== "rail" && body.sidebarCollapsed !== "hidden") throw new HttpError(400, "Ugyldig valg for skjult sidefane");
        patch.sidebarCollapsed = body.sidebarCollapsed;
      }
      if (body.panelButtons !== undefined) {
        if (body.panelButtons !== "together" && body.panelButtons !== "separate") throw new HttpError(400, "Ugyldig valg for panelknapper");
        patch.panelButtons = body.panelButtons;
      }
      // Round 14 (SPEC 30.2)
      if (body.appIcon !== undefined) {
        if (!isAppIcon(body.appIcon)) throw new HttpError(400, "Ukjent appikon");
        patch.appIcon = body.appIcon;
      }
      if (body.panelStart !== undefined) {
        if (body.panelStart !== "tools" && body.panelStart !== "tabs") throw new HttpError(400, "Ugyldig valg for sidepanelet");
        patch.panelStart = body.panelStart;
      }
      if (body.startConversation !== undefined) {
        if (body.startConversation !== "new" && body.startConversation !== "resume") throw new HttpError(400, "Ugyldig samtalevalg ved oppstart");
        patch.startConversation = body.startConversation;
      }
      if (body.panelTabLayout !== undefined) {
        if (body.panelTabLayout !== "unified" && body.panelTabLayout !== "grouped") throw new HttpError(400, "Ugyldig faneoppsett");
        patch.panelTabLayout = body.panelTabLayout;
      }
      if (body.panelNewTab !== undefined) {
        if (body.panelNewTab !== "tools" && body.panelNewTab !== "browser") throw new HttpError(400, "Ugyldig valg for ny sidepanelfane");
        patch.panelNewTab = body.panelNewTab;
      }
      if (body.codeFontCustom !== undefined) {
        if (typeof body.codeFontCustom !== "string" || body.codeFontCustom.length > 120 || /[\u0000-\u001f\u007f]/.test(body.codeFontCustom)) throw new HttpError(400, "Ugyldig skriftnavn");
        patch.codeFontCustom = body.codeFontCustom.trim();
      }
      if (body.sidebarLayout !== undefined) {
        if (body.sidebarLayout !== "standard" && body.sidebarLayout !== "smart") throw new HttpError(400, "Ugyldig sidefane");
        patch.sidebarLayout = body.sidebarLayout;
      }
      if (body.downloadDir !== undefined) {
        try {
          patch.downloadDir = checkDownloadDir(body.downloadDir, dataDir);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (body.thinkingSummary !== undefined) patch.thinkingSummary = body.thinkingSummary === true;
      if (body.thinkingView !== undefined) {
        if (body.thinkingView !== "standard" && body.thinkingView !== "premium") throw new HttpError(400, "Ugyldig tenkevisning");
        patch.thinkingView = body.thinkingView;
      }
      if (body.expandShell !== undefined) patch.expandShell = body.expandShell === true;
      if (body.profileName !== undefined) {
        if (typeof body.profileName !== "string") throw new HttpError(400, "Ugyldig navn");
        patch.profileName = body.profileName.trim().slice(0, 60);
      }
      if (body.shortcuts !== undefined) patch.shortcuts = validShortcuts(body.shortcuts);
      if (body.autoSkills !== undefined) {
        if (body.autoSkills !== null && !["ask", "auto", "off"].includes(body.autoSkills)) throw new HttpError(400, "Ugyldig verdi for autoSkills");
        patch.autoSkills = body.autoSkills ?? undefined;
      }
      if (body.busyMessages !== undefined) {
        if (body.busyMessages !== null && body.busyMessages !== "queue" && body.busyMessages !== "steer") throw new HttpError(400, "Ugyldig verdi for busyMessages");
        patch.busyMessages = body.busyMessages ?? undefined;
      }
      if (body.modelContext !== undefined) patch.modelContext = modelContextPatch(body.modelContext, store.settings());
      if (body.promptAutocompleteModelId !== undefined) {
        if (body.promptAutocompleteModelId !== null && (typeof body.promptAutocompleteModelId !== "string" || !store.model(body.promptAutocompleteModelId))) throw new HttpError(400, "Fant ikke modellen til autofullføring");
        patch.promptAutocompleteModelId = body.promptAutocompleteModelId;
      }
      if (body.promptAutocomplete !== undefined) {
        if (body.promptAutocomplete !== null && typeof body.promptAutocomplete !== "boolean") throw new HttpError(400, "Ugyldig verdi for promptAutocomplete");
        patch.promptAutocomplete = body.promptAutocomplete === true;
      }
      Object.assign(patch, round5Settings(body));
      Object.assign(patch, runde12Settings(body)); // round 12: imported cookies (SPEC 26.4)
      Object.assign(patch, runde13Settings(body, store.settings(), DEFAULT_CHAT_TOOLS)); // round 13: Chat tools and web search (SPEC 27.2)
      // Keep threadNotifications and legacy notifyOnDone/soundOnDone synchronized.
      if (body.threadNotifications !== undefined) {
        if (body.threadNotifications === null) {
          patch.threadNotifications = undefined;
          if (body.notifyOnDone === undefined) patch.notifyOnDone = undefined;
          if (body.soundOnDone === undefined) patch.soundOnDone = undefined;
        } else {
          if (body.notifyOnDone === undefined) {
            patch.notifyOnDone = body.threadNotifications === "off" ? "off" : (store.settings().notifyOnDone === "always" ? "always" : "unfocused");
          }
          if (body.soundOnDone === undefined) patch.soundOnDone = body.threadNotifications === "sound";
        }
      } else if (body.notifyOnDone !== undefined || body.soundOnDone !== undefined) {
        const merged = { ...store.settings(), ...patch };
        patch.threadNotifications = threadNotificationsOf({ notifyOnDone: merged.notifyOnDone, soundOnDone: merged.soundOnDone });
      }
      // Round 11b (SPEC 25.2): a client that still sets the old Kode start choices gets the new one
      // they stand for (migrateCodeStart reads it from them again).
      if ((body.codeStartEmpty !== undefined || body.codeStartProject !== undefined) && body.codeStart === undefined) patch.codeStart = undefined;
      const settings = store.updateSettings(patch);
      if (body.browserAppearance !== undefined) void this.deps.browser?.setAppearance?.(settings.browserAppearance ?? "system");
      if (patch.promptAutocomplete === false || body.promptAutocompleteModelId !== undefined) this.deps.promptCompletion?.clear();
      this.settingsChanged();
      return settings;
    });

    this.route("POST", "/api/model-context/location", async ({ body }) => {
      const mode = body.mode;
      if (mode !== "chat" && mode !== "code") throw new HttpError(400, "Velg Chat eller Kode");
      const before = modelContextOf(store.settings(), mode);
      if (!before.location) throw new HttpError(400, "Slå på sted før du henter det");
      const snapshot = JSON.stringify(before);
      let found: Awaited<ReturnType<ModelContextLookup>>;
      try { found = await (this.deps.modelContextLookup ?? lookupModelContextLocation)(); }
      catch { throw new HttpError(502, "Kunne ikke hente omtrentlig sted. Prøv igjen eller skriv stedet selv."); }
      const current = modelContextOf(store.settings(), mode);
      if (!current.location || JSON.stringify(current) !== snapshot) throw new HttpError(409, "Stedsinnstillingen ble endret under oppslaget. Prøv igjen.");
      const city = cleanContextText(found.city, 70);
      const country = cleanContextText(found.country, 70);
      if (!city || !country) throw new HttpError(502, "Fant ikke et omtrentlig sted");
      const settings = store.updateSettings({ modelContext: { [mode]: { ...current, locationText: `${city}, ${country}`, locationSource: "ip", locationUpdatedAt: new Date().toISOString() } } });
      this.settingsChanged();
      return settings;
    });

    this.route("GET", "/api/provider-presets", () => PROVIDER_PRESETS);

    this.route("POST", "/api/providers/local/detect", () => detectLocalProviders());

    this.route("POST", "/api/providers/local/recommend", async ({ body }) => {
      if (body.mode !== "chat" && body.mode !== "code") throw new HttpError(400, "Velg Chat eller Kode.");
      const contextTokens = LOCAL_MODEL_CONTEXT_OPTIONS.find((tokens) => tokens === body.contextTokens);
      if (contextTokens === undefined) throw new HttpError(400, "Velg en av de tilgjengelige kontekstlengdene.");
      let hardware: LocalModelHardware;
      if (body.source === "manual") {
        hardware = {
          availableRamGiB: modelMemoryGiB(body.availableRamGiB, "tilgjengelig RAM"),
          freeGpuGiB: body.freeGpuGiB === undefined ? undefined : modelMemoryGiB(body.freeGpuGiB, "ledig GPU-minne"),
        };
      } else if (body.source === "host") {
        hardware = await readLocalModelHardware().catch((err: Error) => { throw new HttpError(503, err.message); });
      } else {
        throw new HttpError(400, "Velg denne maskinen eller oppgi minne selv.");
      }
      return recommendLocalModels(hardware, body.mode, contextTokens);
    });

    this.route("POST", "/api/providers", async ({ body }) => {
      const preset = providerPreset(body.preset);
      if (body.preset !== undefined && !preset) throw new HttpError(400, "Ukjent leverandør");
      const kind = preset?.kind ?? body.kind;
      if (!PROVIDER_KINDS.includes(kind)) throw new HttpError(400, "Ugyldig leverandørtype");
      const defaultAddress = preset?.baseUrl || undefined;
      const address = body.baseUrl ?? defaultAddress;
      const baseUrl = providerAddress(address, kind, preset?.id);
      const apiKey = providerKey(body.apiKey);
      const apiKeyEnv = providerKeyEnv(body.apiKeyEnv === undefined && baseUrl === defaultAddress && !apiKey ? preset?.apiKeyEnv : body.apiKeyEnv);
      const provider = store.createProvider({
        kind,
        name: requireString(body.name || preset?.name, "name"),
        presetId: preset?.id,
        baseUrl,
        apiKeyEnv: apiKeyEnv || undefined,
      });
      if (apiKey) await secrets.set(provider.id, apiKey);
      this.settingsChanged();
      return this.providerConfigs().find((p) => p.id === provider.id);
    });

    this.route("PATCH", "/api/providers/:id", async ({ params, body }) => {
      if (params.id === MOCK_PROVIDER_ID) throw new HttpError(400, "Demo-leverandøren kan ikke endres");
      const current = store.provider(params.id);
      if (!current) throw new HttpError(404, "Fant ikke leverandøren");
      const baseUrl = body.baseUrl === undefined ? undefined : providerAddress(body.baseUrl, current.kind, current.presetId) ?? "";
      const addressChanged = baseUrl !== undefined && baseUrl !== (current.baseUrl?.replace(/\/+$/, "") ?? "");
      const name = body.name === undefined ? undefined : requireString(body.name, "name");
      const apiKey = providerKey(body.apiKey);
      const requestedEnv = providerKeyEnv(body.apiKeyEnv);
      const apiKeyEnv = addressChanged && (requestedEnv === undefined || requestedEnv === current.apiKeyEnv) ? "" : requestedEnv;
      const previousCredential = current.credentialId ?? current.id;
      const credentialId = addressChanged ? `${current.id}:${crypto.randomUUID()}` : previousCredential;
      store.updateProvider(params.id, { name, baseUrl, apiKeyEnv, credentialId });
      const cleanup = addressChanged ? secrets.set(previousCredential, null) : undefined;
      const save = apiKey !== undefined ? secrets.set(credentialId, apiKey || null) : undefined;
      await Promise.all([cleanup, save]);
      this.settingsChanged();
      return this.providerConfigs().find((p) => p.id === params.id);
    });

    this.route("DELETE", "/api/providers/:id", async ({ params }) => {
      if (params.id === MOCK_PROVIDER_ID) throw new HttpError(400, "Demo-leverandøren kan ikke slettes");
      const current = store.provider(params.id);
      if (!current) throw new HttpError(404, "Fant ikke leverandøren");
      store.deleteProvider(params.id);
      this.deps.promptCompletion?.clear();
      await secrets.set(current.credentialId ?? current.id, null);
      this.settingsChanged();
    });

    this.route("POST", "/api/providers/:id/test", async ({ params, body }) => {
      const provider = store.provider(params.id);
      if (!provider) throw new HttpError(404, "Fant ikke leverandøren");
      const model = typeof body.modelId === "string" ? store.model(body.modelId) : undefined;
      if (body.modelId !== undefined && model?.providerId !== provider.id) throw new HttpError(404, "Fant ikke modellen hos denne leverandøren");
      if (!model && providerPreset(provider.presetId)?.modelDiscovery === "manual") {
        return { ok: false, message: "Legg til en modell-ID og velg Test modell for å teste med et kort svar." };
      }
      try {
        const client = createProvider(provider, { secrets, mockDelayMs: this.deps.mockDelayMs, stallMs: this.deps.stallMs });
        if (!model) return await client.test(AbortSignal.timeout(10_000));
        return await testProviderModel(client, model, !!localKindFor(provider), AbortSignal.timeout(30_000));
      } catch (err) {
        if ((err as Error).name === "TimeoutError") return { ok: false, message: "Serveren brukte for lang tid på å svare." };
        return { ok: false, message: redact((err as Error).message, apiKeyFor(provider, secrets)) };
      }
    });

    this.route("POST", "/api/providers/:id/models/fetch", async ({ params }) => {
      const provider = store.provider(params.id);
      if (!provider) throw new HttpError(404, "Fant ikke leverandøren");
      try {
        return await fetchModelList(provider, apiKeyFor(provider, secrets), AbortSignal.timeout(15_000));
      } catch (err) {
        // The message is already redacted. 502: the provider failed, not this server.
        throw new HttpError(502, (err as Error).message || "Kunne ikke hente modellene");
      }
    });

    this.route("POST", "/api/providers/:id/models", ({ params, body }) => {
      const provider = store.provider(params.id);
      if (!provider) throw new HttpError(404, "Fant ikke leverandøren");
      const local = !!localKindFor(provider);
      if (!Array.isArray(body.models) || !body.models.length || body.models.length > 200) throw new HttpError(400, "models må være en liste med 1 til 200 modeller");
      const existing = new Set(store.models().filter((m) => m.providerId === params.id).map((m) => m.model));
      const added: ModelConfig[] = [];
      for (const item of body.models) {
        const modelId = requireString(item?.model, "model");
        if (existing.has(modelId)) continue;
        existing.add(modelId);
        const contextWindow = item.contextWindow ?? (local ? DEFAULT_LOCAL_CONTEXT_WINDOW : tableContext(modelId) ?? DEFAULT_CONTEXT_WINDOW);
        added.push(modelFromBody(crypto.randomUUID(), {
          providerId: params.id, name: item.name || modelId, model: modelId, contextWindow,
          supportsTools: item.supportsTools, supportsImages: item.supportsImages ?? (imagesOnByDefault(provider) ? true : undefined),
        }));
      }
      for (const model of added) store.saveModel(model);
      this.settingsChanged();
      return added;
    });

    // Agent Teams

    this.route("GET", "/api/projects/:id/tasks", ({ params }) => this.deps.tasks.list(this.project(params.id).id));
    this.route("POST", "/api/projects/:id/tasks", ({ params, body }) => this.deps.tasks.add(this.project(params.id).id, body.title, null, body.ownerThreadId || null));
    this.route("PATCH", "/api/tasks/:id", ({ params, body }) => this.deps.tasks.update(params.id, body));
    this.route("DELETE", "/api/tasks/:id", ({ params }) => this.deps.tasks.remove(params.id));

    // Artifacts. Same checks as every other route: cookie, Origin and JSON.

    const artifacts = this.artifacts;
    this.route("GET", "/api/artifacts", () => artifacts.list());
    this.route("POST", "/api/artifacts", ({ body }) => artifacts.create(body));
    this.route("GET", "/api/artifacts/:id", ({ params }) => artifacts.get(params.id));
    this.route("PATCH", "/api/artifacts/:id", ({ params, body }) => artifacts.update(params.id, body));
    this.route("POST", "/api/artifacts/:id/duplicate", ({ params }) => artifacts.duplicate(params.id));
    this.route("POST", "/api/artifacts/:id/restore", ({ params }) => artifacts.restore(params.id));
    this.route("DELETE", "/api/artifacts/:id", ({ params }) => artifacts.remove(params.id));
    this.route("GET", "/api/artifacts/:id/download", ({ res, params }) => {
      const artifact = artifacts.get(params.id);
      const body = Buffer.from(artifact.html, "utf8");
      const name = downloadName(artifact.title, artifact.lang);
      res.writeHead(200, {
        // React source is text to save, never a page.
        "content-type": artifact.lang === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        "content-length": body.length,
        "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeRfc5987(artifact.title.replace(/\.(html?|jsx|tsx)$/i, "") + `.${artifact.lang}`)}`,
        "cache-control": "no-store",
        // Never rendered here, even if a browser ignored the attachment.
        "content-security-policy": "sandbox; default-src 'none'",
      });
      res.end(body);
      return HANDLED;
    });
    this.route("POST", "/api/previews", ({ body }) => {
      if (typeof body.html !== "string") throw new HttpError(400, "html mangler");
      if (body.html.length > MAX_ARTIFACT_HTML) throw new HttpError(413, "Koden er for stor (maks 2 MB)");
      const lang = body.lang ?? "html";
      if (!ARTIFACT_LANGS.includes(lang)) throw new HttpError(400, "Ugyldig type, bare html, jsx og tsx");
      return { url: this.deps.preview.snapshot(body.html, lang) };
    });

    // Profile and the global config folder

    this.route("GET", "/api/profile", () => store.profileStats());
    this.route("GET", "/api/stats", ({ query }) => {
      const range = query.get("range") ?? "all";
      if (!STATS_RANGES.includes(range as StatsRange)) throw new HttpError(400, "Ugyldig periode");
      return store.homeStats(range as StatsRange);
    });

    this.route("GET", "/api/config", () => this.deps.config.global());
    this.route("PUT", "/api/config/agents-md", ({ body }) => {
      if (typeof body.text !== "string") throw new HttpError(400, "text mangler");
      this.deps.config.writeGlobalAgents(body.text);
      return this.deps.config.global();
    });

    this.route("POST", "/api/models", ({ body }) => {
      const provider = store.provider(body.providerId);
      if (!provider) throw new HttpError(400, "Fant ikke leverandøren");
      const imagesByDefault = body.supportsImages === undefined && imagesOnByDefault(provider);
      const model = store.saveModel(modelFromBody(crypto.randomUUID(), imagesByDefault ? { ...body, supportsImages: true } : body));
      this.settingsChanged();
      return model;
    });

    this.route("PATCH", "/api/models/:id", ({ params, body }) => {
      if (params.id === MOCK_MODEL_ID) throw new HttpError(400, "Demo-modellen kan ikke endres");
      const current = store.model(params.id);
      if (!current) throw new HttpError(404, "Fant ikke modellen");
      const model = store.saveModel(modelFromBody(params.id, { ...current, ...body }));
      this.settingsChanged();
      return model;
    });

    this.route("DELETE", "/api/models/:id", ({ params }) => {
      if (params.id === MOCK_MODEL_ID) throw new HttpError(400, "Demo-modellen kan ikke slettes");
      if (!store.model(params.id)) throw new HttpError(404, "Fant ikke modellen");
      store.deleteModel(params.id);
      this.deps.promptCompletion?.clear();
      this.settingsChanged();
    });

    // v0.5: the navigation round. Context use, project favicons and line counts per thread.
    navRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps, {
      project: (id) => this.project(id),
      thread: (id) => this.thread(id),
    });

    // Round 6: memories, skills and steered messages.
    harnessRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps, {
      project: (id) => this.project(id),
      thread: (id) => this.thread(id),
    });

    // Round 12, part A: cookies from the user's browser (SPEC 26.4) and Økt (26.2).
    runde12Routes((method, spec, handler) => this.route(method, spec, handler), this.deps, { thread: (id) => this.thread(id) });

    // Round 7: Chat. Edit a message and send it again, or make the last answer again.
    chatRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps, { thread: (id) => this.thread(id), assertFolder: (id) => this.assertFolder(id) });

    // Round 8: GitHub (read only) and saving from the mini editor.
    githubRoutes((method, spec, handler) => this.route(method, spec, handler), this.deps, {
      project: (id) => this.project(id),
      settingsChanged: () => this.settingsChanged(),
      filesChanged: (projectId, paths) => {
        this.invalidateFiles(projectId);
        this.deps.publish({ type: "project.files-changed", projectId, paths });
      },
    });

    // Lagring: sizes of the data folder, and cleaning up in it (storage.ts).
    storageRoutes((method, spec, handler) => this.route(method, spec, handler), new Storage({
      dataDir,
      store,
      browser: this.deps.browser,
      downloadDir: () => this.deps.downloads?.dir() ?? (store.settings().downloadDir || defaultDownloadDir()),
      deleteThread: (thread) => {
        store.deleteThread(thread.id);
        this.deps.chatWorkspace?.remove(thread.id);
        this.deps.uiMods?.forgetThread(thread.id);
        runner.files.forgetThread(thread.id);
        publish({ type: "thread.deleted", threadId: thread.id });
      },
    }));
  }
}

const EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
const SHORTCUT_IDS = new Set(["thread.new", "thread.back", "thread.forward", "thread.search", "pane.new", "folder.open", "settings.open", "view.sidebar", "view.panel", "view.summary", "view.details", "view.mode", "help.shortcuts",
  "palette.open", "thread.rename", "thread.pin", "thread.unread", "thread.side", "thread.archive",
  "panel.files", "panel.changes", "panel.terminal", "panel.browser", "panel.team", "panel.overview",
  "browser.annotate", // round 11b
  "browser.newTab", "browser.newTabFull", // round 10, missing until round 12
  "panel.session"]); // round 12 (SPEC 26.2)

// The settings added in round 5 (Innstillinger). Choices must be one of the listed values and
// numbers whole and in range; null resets a field to its default, which is to leave it out.
const ROUND5_CHOICES: Record<string, readonly string[]> = {
  language: ["system", ...Object.keys(languages)],
  codeThemeLight: ["app", "clear", "warm", "contrast"],
  codeThemeDark: ["app", "clear", "warm", "contrast"],
  codeTranscriptView: ["normal", "thinking", "detailed"],
  startMode: ["last", "chat", "code"],
  notifyOnDone: ["off", "unfocused", "always"],
  accent: ["blue", "violet", "green", "orange", "pink", "red", "graphite"],
  density: ["compact", "normal", "comfortable"],
  codeFont: ["system", "jetbrains", "fira", "cascadia", "dejavu", "ubuntu"],
  themePreset: THEME_PRESETS, // round 8
  codeStartEmpty: ["greeting", "cards"], // round 9
  codeStartProject: ["cards", "greeting"],
  codeStart: ["text", "tokens", "projects"], // round 11b, SPEC 25.2
  codeStartSize: ["small", "medium", "large"],
  enterKey: ["send", "newline"], // round 9, SPEC 21.8
  diffLayout: ["stacked", "split"],
  diffFileState: ["expanded", "collapsed"],
  diffColors: ["red-green", "blue-orange"],
  openLinksIn: ["app", "system"],
  browserAppearance: ["system", "light", "dark"],
  threadNotifications: ["off", "notify", "sound"],
  chatWidth: CHAT_WIDTHS, // v1.2.0
  projectOrder: ["recent", "created", "name"],
};
const ROUND5_NUMBERS: Record<string, readonly number[]> = {
  uiFontSize: [13, 14, 15, 16],
  uiContrast: UI_CONTRASTS, // v1.2.0
  codeFontSize: [11, 12, 13, 14, 15, 16, 17, 18],
  tabSize: [2, 4, 8],
  browserDefaultZoom: BROWSER_ZOOMS,
};
const ROUND5_FLAGS = ["soundOnDone", "confirmQuit", "reduceMotion", "wrapCode", "diffIgnoreWhitespace", "agentBrowserAccess", "inAppNotifications"];

function round5Settings(body: any): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(ROUND5_CHOICES)) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && !allowed.includes(body[key])) throw new HttpError(400, `Ugyldig verdi for ${key}`);
    out[key] = body[key] ?? undefined;
  }
  for (const [key, allowed] of Object.entries(ROUND5_NUMBERS)) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && !allowed.includes(body[key])) throw new HttpError(400, `Ugyldig verdi for ${key}`);
    out[key] = body[key] ?? undefined;
  }
  for (const key of ROUND5_FLAGS) if (body[key] !== undefined) out[key] = body[key] === true;
  // v1.2.0: on by default, so null (reset) leaves it out and false is kept.
  if (body.renderMath !== undefined) {
    if (body.renderMath !== null && typeof body.renderMath !== "boolean") throw new HttpError(400, "Ugyldig verdi for renderMath");
    out.renderMath = body.renderMath ?? undefined;
  }
  return out as Partial<Settings>;
}

function validShortcuts(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Ugyldige hurtigtaster");
  const out: Record<string, string> = {};
  for (const [id, keys] of Object.entries(value)) {
    if (!SHORTCUT_IDS.has(id)) throw new HttpError(400, `Ukjent hurtigtast: ${id}`);
    // An empty string removes the shortcut from that action.
    if (typeof keys !== "string" || (keys !== "" && !/^((Mod|Alt|Shift)\+){0,3}[^+\s]{1,12}$/.test(keys))) throw new HttpError(400, `Ugyldig tastekombinasjon: ${String(keys)}`);
    out[id] = keys;
  }
  return out;
}
const MAX_GOAL = 2000;
const MAX_CHAPTER = 80;

function threadPatch(body: any, mode: Thread["mode"]): ThreadPatch {
  const patch: ThreadPatch = { title: typeof body.title === "string" ? cleanName(body.title) : body.title, archived: body.archived, modelId: body.modelId };
  if (body.goal !== undefined) {
    if (body.goal !== null && typeof body.goal !== "string") throw new HttpError(400, "Ugyldig mål");
    patch.goal = body.goal?.trim().slice(0, MAX_GOAL) || null;
  }
  if (body.goalPaused !== undefined) patch.goalPaused = body.goalPaused === true;
  if (body.chapter !== undefined) {
    const { messageId, title } = body.chapter ?? {};
    if (typeof messageId !== "string" || !messageId || messageId.length > 200) throw new HttpError(400, "Ugyldig kapittel");
    if (title !== null && typeof title !== "string") throw new HttpError(400, "Ugyldig kapittelnavn");
    patch.chapter = { messageId, title: title?.trim().slice(0, MAX_CHAPTER) || null };
  }
  if (body.planMode !== undefined) patch.planMode = body.planMode === true;
  if (body.reasoning !== undefined) {
    if (body.reasoning !== null && !EFFORTS.includes(body.reasoning)) throw new HttpError(400, "Ugyldig tenkenivå");
    patch.reasoning = body.reasoning;
  }
  if (body.personality !== undefined) {
    // A chat chooses among Chat's personalities (older names are mapped); Kode among its own.
    const id = body.personality === null ? null : mode === "chat" ? chatPersonalityId(body.personality) : PERSONALITIES.some((p) => p.id === body.personality) ? (body.personality as string) : undefined;
    if (id === undefined || (id === null && body.personality !== null)) throw new HttpError(400, "Ukjent personlighet");
    patch.personality = id === "standard" ? null : id;
  }
  if (body.pinned !== undefined) patch.pinned = body.pinned === true;
  if (body.snoozedUntil !== undefined) {
    if (body.snoozedUntil !== null && (typeof body.snoozedUntil !== "number" || !Number.isFinite(body.snoozedUntil))) throw new HttpError(400, "Ugyldig tidspunkt");
    patch.snoozedUntil = body.snoozedUntil;
  }
  return patch;
}

export function agentsTemplate(name: string): string {
  return `# ${name}

Instruksjoner til agenten for dette prosjektet. Agentic Desktop leser denne filen i hver tråd.

## Om prosjektet

- Hva prosjektet er, og hvem det er for.

## Slik jobber du her

- Kjør testene før du sier at noe er ferdig.
- Hold endringene små, og forklar hvorfor.

## Kommandoer

- Bygg:
- Test:

## Ikke gjør dette

- Ikke rør filer utenfor prosjektmappen.
`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function providerAddress(value: unknown, kind: ProviderKind, presetId?: string): string | undefined {
  if (kind === "anthropic" && (value === undefined || value === "")) return;
  try {
    const preset = providerPreset(presetId);
    const local = preset?.category === "local";
    const rootPath = local ? (preset.baseUrl ? new URL(preset.baseUrl).pathname.replace(/\/+$/, "") : "/v1") : "";
    const base = normalizeProviderBaseUrl(value, rootPath);
    return local ? base.replace(/\/v1\/(?:chat\/completions|models)$/, "/v1") : base;
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
}

function providerKey(value: unknown): string | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > 16_384 || /[^\x20-\x7e\xa0-\xff]/.test(value) || value.trim() !== value) {
    throw new HttpError(400, "Skriv inn en gyldig API-nøkkel uten linjeskift eller ekstra mellomrom.");
  }
  return value;
}

function providerKeyEnv(value: unknown): string | undefined {
  if (value === undefined) return;
  if (value === null || value === "") return "";
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) throw new HttpError(400, "Skriv navnet på miljøvariabelen, ikke nøkkelen.");
  return value;
}

function modelMemoryGiB(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 65_536) throw new HttpError(400, `Oppgi ${label} som et tall fra 0 til 65 536 GiB.`);
  return value;
}

// Models added to a cloud OpenAI-compatible API get images (pasted or attached) unless the user
// turns them off. Local servers say what their model takes; Anthropic always takes images.
function imagesOnByDefault(provider: { kind: string; baseUrl?: string; presetId?: string; localKind?: unknown }): boolean {
  return provider.kind === "openai-compatible" && !localKindFor(provider as Parameters<typeof localKindFor>[0]);
}

function modelFromBody(id: string, body: any): ModelConfig {
  const contextWindow = Number(body.contextWindow);
  if (!Number.isFinite(contextWindow) || contextWindow < 1000) throw new HttpError(400, "contextWindow må være minst 1000");
  const model: ModelConfig = {
    id,
    providerId: body.providerId,
    name: requireString(body.name, "name"),
    model: requireString(body.model, "model"),
    contextWindow,
  };
  for (const key of ["inputPricePerMTok", "outputPricePerMTok", "maxOutputTokens"] as const) {
    if (body[key] !== undefined && body[key] !== null) model[key] = Number(body[key]);
  }
  if (body.supportsImages !== undefined) model.supportsImages = body.supportsImages === true;
  if (typeof body.supportsTools === "boolean") model.supportsTools = body.supportsTools;
  if (body.thinking !== undefined) model.thinking = body.thinking === true;
  if (body.webSearch !== undefined && body.webSearch !== null) model.webSearch = body.webSearch === true;
  if (body.effort) model.effort = body.effort;
  return model;
}
