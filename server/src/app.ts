import {UiMods} from "./ui-mods.ts";
import {ChatWorkspace} from './chat-workspace.ts';
// Wires everything together. startApp() is what index.ts and the tests call.
import { PromptCompletions } from "./prompt-completion.ts";
import { SideQuestions } from "./side-questions.ts";
import type { ModelContextLookup } from "./model-context.ts";
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { ServerMessage } from "../../shared/protocol.ts";
import { localFolder, LOCAL_PANEL } from "./paths.ts";
import { localBrowserAddress } from "./browser-address.ts";
import { EventLog } from "./agent/events.ts";
import { Runner } from "./agent/runner.ts";
import { TaskBoard } from "./agent/tasks.ts";
import { Turns } from "./agent/turns.ts";
import { BrowserManager } from "./browser.ts";
import { WebBrowser } from "./web-browser.ts";
import type { WebTesting } from "./web-guard.ts";
import { ImportedCookies } from "./browser-cookies.ts";
import { chromeConfigHome } from "./chrome-import.ts";
import { defaultDownloadDir, Downloads, STAGING_STALE_MS } from "./downloads.ts";
import { Servers } from "./servers.ts";
import { loadConfig, type Config } from "./config.ts";
import { Store } from "./db.ts";
import { childEnv } from "./env.ts";
import { HttpError } from "./errors.ts";
import { Api } from "./http/api.ts";
import { Security } from "./http/security.ts";
import { serveStatic } from "./http/static.ts";
import { Hub } from "./http/ws.ts";
import { ProjectWatches } from "./project-watch.ts";
import { Playtest } from "./playtest.ts";
import { PreviewServer } from "./preview.ts";
import { PreviewRuntime } from "./preview-runtime.ts";
import { apiKeyFor, createProvider } from "./providers/index.ts";
import { fetchModelList } from "./providers/presets.ts";
import { Secrets } from "./secrets.ts";
import { defaultKeyring, type Keyring } from "./keyring.ts";
import { GitHub, GITHUB_SECRET } from "./github.ts";
import { ThreadInbox } from "./thread-inbox.ts";
import { ConfigDirs, defaultGlobalConfigDir } from "./config-dirs.ts";
import { seedGlobalAgents, upgradeGlobalAgents } from "./agent/harness.ts";
import { Terminals } from "./terminal.ts";
import { claimDataDir, currentShell, sameKey, writeInstance } from "./instance.ts";
import { Hooks } from "./hooks.ts";
import { McpServers } from "./mcp/manager.ts";
import os from "node:os";

export interface AppOptions extends Partial<Config> {
  userSkillsDir?: string;
  appSkillsDir?: string;
  configDir?: string; // the global config folder, default $XDG_CONFIG_HOME/agentic-desktop
  retryBaseMs?: number;
  homeDir?: string; // round 9: where a terminal without a project starts; tests set a temporary one
  localWorkspace?: boolean; // Kode without a project gets tools in the home folder; default true, tests turn it on with a temporary homeDir
  stallMs?: number;
  seedDefaults?: boolean; // round 9b: write the default global AGENTS.md the first time (SPEC 22.2), default true
  // ONLY FOR TESTS (see WebTesting in web-guard.ts): lets web search and web reading reach loopback
  // and stubs DNS. index.ts never sets it, and nothing from the UI or Settings reaches it.
  webTesting?: WebTesting;
  // A localhost server that may be stopped by the Electron app (SPEC 29.1): index.ts passes its own
  // shutdown, the same as Ctrl+C. Without it there is no stop key and no way to stop the server.
  onStopRequest?: () => void;
  // Round 14 (SPEC 30.1): where keys are kept. Default from AD_KEYRING (keyring.ts); the tests pass
  // a MemoryKeyring, so they never reach the user's real keyring.
  keyring?: Keyring;
  modelContextLookup?: ModelContextLookup; // dependency injection for isolated tests
}

export interface App {
  port: number;
  url: string;
  link: string;
  config: Config;
  security: Security;
  store: Store;
  runner: Runner;
  browser: BrowserManager;
  web: WebBrowser;
  terminals: Terminals;
  preview: PreviewServer;
  childEnv: () => Record<string, string>;
  mcp: McpServers; // MCP servers (mcp/manager.ts)
  close: () => Promise<void>;
}

export async function startApp(options: AppOptions = {}): Promise<App> {
  const config = loadConfig(options);
  // Before the database opens: reserve the data folder exclusively for the whole lifetime of the server.
  const claim = await claimDataDir(config.dataDir);
  const cleanups: Array<() => void | Promise<void>> = [];
  let store: Store | undefined;
  try {
    store = new Store(config.dataDir);
    return await startAppWithClaim(config, options, store, claim, (fn) => cleanups.push(fn));
  } catch (err) {
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        await cleanups[i]();
      } catch {
        // Best-effort rollback of partially initialized subsystems.
      }
    }
    store?.close();
    claim.release();
    throw err;
  }
}

async function startAppWithClaim(
  config: Config,
  options: AppOptions,
  store: Store,
  claim: Awaited<ReturnType<typeof claimDataDir>>,
  onFail: (fn: () => void | Promise<void>) => void,
): Promise<App> {
  // The label is what Passord og nøkler (Seahorse) shows for the item.
  const secrets = new Secrets(config.dataDir, options.keyring ?? defaultKeyring(), (id) =>
    id === GITHUB_SECRET ? "Agentic Desktop: GitHub-token" : id.startsWith("mcp:") ? `Agentic Desktop: MCP-hemmelighet (${id.split(":").slice(2).join(" ")})` : `Agentic Desktop: API-nøkkel for ${store.provider(id.split(":")[0])?.name ?? id}`,
  );
  onFail(() => secrets.idle());
  // Normally a tenth of a second. A locked keyring asks for the password; the start does not wait
  // for that, and the keys come in when it is unlocked (keyring.changed).
  const keyringLoaded = secrets.load().catch(() => undefined);
  await Promise.race([keyringLoaded, new Promise((resolve) => setTimeout(resolve, 4000).unref())]);
  const security = new Security(config.dataDir);
  const configDirs = new ConfigDirs(options.configDir ?? defaultGlobalConfigDir(), config.dataDir);

  const env = () => {
    const providers = store.providers();
    return childEnv({
      names: providers.flatMap((p) => (p.apiKeyEnv ? [p.apiKeyEnv] : [])),
      values: [security.token, ...secrets.values(), ...providers.flatMap((p) => apiKeyFor(p, secrets) ?? [])],
    });
  };

  let hub: Hub;
  let api: Api;
  let sideQuestions: SideQuestions | undefined;
  const publish = (message: ServerMessage) => {
    if (message.type === "thread.reset" || message.type === "thread.deleted") sideQuestions?.invalidateThread(message.threadId);
    hub.broadcast(message);
  };
  const threadChanged = (threadId: string) => {
    const thread = store.thread(threadId);
    if (thread) publish({ type: "thread.changed", thread });
  };
  const github = new GitHub(secrets, {
    get: () => store.settings().githubAuth,
    set: (githubAuth) => {
      store.updateSettings({ githubAuth });
      api.settingsChangedFromKeyring();
    },
  });
  const threadInbox = new ThreadInbox(store, threadChanged, ({ repo, number }) => github.pullWatch(repo, number));
  onFail(() => threadInbox.close());
  // Servers the app's own commands, terminals and Playtest start, for the right panel (servers.ts).
  const servers = new Servers({
    publish: (message) => publish(message),
    ignorePorts: () => [port, Number(new URL(preview.origin).port)],
    projectOfThread: (threadId) => store.thread(threadId)?.projectId ?? null,
    stopPlaytest: (projectId) => playtest.stop(projectId),
  });
  onFail(() => servers.close());
  const log = new EventLog(store, (envelope) => {
    hub.publishEvent(envelope);
    servers.onThreadEvent(envelope);
    threadInbox.onEvent(envelope);
  });
  const terminals = new Terminals(env);
  onFail(() => terminals.closeAll());
  terminals.watchers.add((terminal, text) => servers.onTerminalOutput(terminal, text));
  const tasks = new TaskBoard(store, publish);
  const turns = new Turns(store, config.dataDir);

  // Started before the app, so the CSP names its origin from the first request.
  const preview = new PreviewServer({
    appOrigins: () => security.origins,
    artifactSource: (id) => {
      const found = store.artifactHtml(id);
      return found ? { source: found.html, lang: found.lang } : undefined;
    },
    // Round 15 (SPEC 31.2): React and the rest of the React preview, built with the web UI.
    runtime: new PreviewRuntime(path.join(config.webDist, "preview-runtime")),
  });
  await preview.listen();
  onFail(() => preview.close());
  security.setPreviewOrigin(preview.origin);

  const playtest: Playtest = new Playtest({
    dataDir: config.dataDir,
    appPort: () => port,
    terminals,
    publish: (state) => {
      publish({ type: "playtest.state", state });
      servers.onPlaytest(state);
    },
    openInBrowser: async (projectId, url) => void (await browser.navigate(projectId, url)),
  });
  onFail(() => playtest.stopAll());

  // Downloads from the Browser panel, into the folder from Settings or the default one.
  const downloads = new Downloads({
    dir: () => store.settings().downloadDir || defaultDownloadDir(),
    publish: (message) => publish(message),
    cancel: (id) => browser.cancelDownload(id),
    dataDir: config.dataDir,
  });

  // Round 12 (SPEC 26.4): cookies imported from the user's browser, kept with the app's profile.
  const importedCookies = new ImportedCookies(path.join(config.dataDir, "chrome-profile"), config.dataDir);
  const browser = new BrowserManager({
    downloads,
    cookies: importedCookies,
    askSignedIn: () => store.settings().browserAskSignedIn !== false,
    appearance: () => store.settings().browserAppearance ?? "system",
    profileDir: path.join(config.dataDir, "chrome-profile"),
    idleMs: config.browserIdleMs,
    env,
    appOrigins: () => security.origins,
    resolveUrl: async (projectId, url) => {
      if (projectId === LOCAL_PANEL) return localBrowserAddress(url);
      if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/.test(url)) return `http://${url}`;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
      const project = store.project(projectId);
      if (!project) throw new HttpError(404, "Fant ikke prosjektet");
      return playtest.urlFor(project, url);
    },
  });
  onFail(() => browser.dispose());

  // Web search and web reading for the model: their own Chrome without cookies, public addresses only.
  const web = new WebBrowser({
    idleMs: config.browserIdleMs,
    env,
    appOrigins: () => security.origins,
    testing: options.webTesting,
  });
  onFail(() => web.dispose());

  let modBusy=(_id:string)=>false;
  const uiMods=new UiMods(store,config.dataDir,()=>publish({type:"ui-mods.changed",state:uiMods.snapshot()}),id=>modBusy(id));
  onFail(() => uiMods.close());
  const chatWorkspace = new ChatWorkspace(store, config.dataDir);
  onFail(async () => {
    try {
      await chatWorkspace.ready;
    } finally {
      chatWorkspace.close();
    }
  });
  // The user's hooks (Innstillinger → Hooks): only from hooks.json in the data folder, never from a project.
  // MCP servers from Innstillinger → MCP-servere (mcp/manager.ts). Connected in the background below.
  const mcp: McpServers = new McpServers({ store, secrets, env, cwd: options.homeDir ?? os.homedir(), publish: (state) => publish({ type: "mcp.changed", state }) });
  onFail(() => mcp.close());
  const hooks: Hooks = new Hooks({ dataDir: config.dataDir, env, homeDir: options.homeDir, changed: () => publish({ type: "hooks.changed", state: hooks.state() }) });
  onFail(() => hooks.close());
  const runner = new Runner({
    uiMods,
    hooks,
    mcp,
    chatWorkspace,
    store,
    log,
    turns,
    dataDir: config.dataDir,
    browser,
    web, // round 13: web search and pages read by the model, never through the panel's browser
    userSkillsDir: options.userSkillsDir ?? configDirs.skillsDir,
    appSkillsDir: options.appSkillsDir,
    skillsChanged: () => publish({ type: "skills.changed" }),
    config: configDirs,
    tasks,
    commandTimeoutMs: config.commandTimeoutMs,
    retryBaseMs: options.retryBaseMs ?? 1000,
    env,
    provider: (model) => {
      const provider = store.provider(model.providerId);
      if (!provider) throw new HttpError(400, "Fant ikke leverandøren");
      return createProvider(provider, { secrets, mockDelayMs: config.mockDelayMs, stallMs: options.stallMs });
    },
    listModels: (providerId, signal) => {
      const provider = store.provider(providerId);
      if (!provider) return Promise.reject(new Error("Fant ikke leverandøren"));
      return fetchModelList(provider, apiKeyFor(provider, secrets), signal);
    },
    modelsChanged: () => api.settingsChangedFromKeyring(),
    threadChanged,
    filesChanged: (projectId, paths) => {
      api.invalidateFiles(projectId);
      publish({ type: "project.files-changed", projectId, paths });
    },
    usageChanged: (projectId) => publish({ type: "project.usage", projectId, usage: store.projectUsage(projectId) }),
    // Kode without a project works in the home folder, never inside the app's own data folder.
    ...(options.localWorkspace === false ? {} : { localFolder: () => localFolder(config.dataDir, options.homeDir) }),
    projectTouched: (projectId) => {
      const project = store.project(projectId);
      if (project) publish({ type: "project.changed", project });
    },
  });
  onFail(() => runner.shutdown());

  modBusy=id=>runner.isRunning(id);

  // Round 9b: the first time the app starts, a default global AGENTS.md, never over one that is there.
  if (options.seedDefaults !== false) {
    try {
      seedGlobalAgents(configDirs.globalDir, runner.harness);
      // An untouched default from an earlier version follows the app to the current default.
      if (upgradeGlobalAgents(configDirs.globalDir) === "upgraded") console.log("Standard AGENTS.md er oppdatert til den nye standarden. Den gamle ligger i backups.");
    } catch (err) {
      console.error("Kunne ikke lage standard AGENTS.md:", (err as Error).message);
    }
  }

  secrets.onChange = (keyring) => {
    publish({ type: "keyring.changed", keyring });
    api.settingsChangedFromKeyring();
    mcp.keyringChanged();
  };

  const projectWatches = new ProjectWatches(config.dataDir, (id) => api.invalidateFiles(id));
  hub = new Hub({ store, security, terminals, browser, projectWatches, flushThread: (id) => log.flush(id), localFolder: () => localFolder(config.dataDir, options.homeDir) });
  onFail(() => hub.close());
  api = new Api({
    github,
    threadInbox,
    uiMods,
    hooks,
    mcp,
    chatWorkspace,
    promptCompletion: new PromptCompletions(store, (model) => {
      const provider = store.provider(model.providerId);
      if (!provider) throw new HttpError(400, "Fant ikke leverandøren");
      return createProvider(provider, { secrets, mockDelayMs: config.mockDelayMs, stallMs: options.stallMs });
    }, config.dataDir, (id) => runner.isRunning(id)),
    sideQuestions: sideQuestions = new SideQuestions(store, (model) => {
      const provider = store.provider(model.providerId);
      if (!provider) throw new HttpError(400, "Fant ikke leverandøren");
      return createProvider(provider, { secrets, mockDelayMs: config.mockDelayMs, stallMs: options.stallMs });
    }),
    store,
    runner,
    turns,
    terminals,
    playtest,
    secrets,
    security,
    config: configDirs,
    tasks,
    preview,
    dataDir: config.dataDir,
    webDist: config.webDist,
    mockDelayMs: config.mockDelayMs,
    stallMs: options.stallMs,
    env,
    publish,
    threadChanged,
    downloads,
    servers,
    browser,
    viewedAt: (threadId) => hub.viewedAt(threadId),
    chromeConfigHome: chromeConfigHome(options.homeDir),
    homeDir: options.homeDir,
    importedCookies,
    modelContextLookup: options.modelContextLookup,
    cookieBrowser: browser,
  });
  onFail(() => api.close());

  // The key in instance.json that lets the Electron app stop this server (SPEC 29.1).
  const stopKey = options.onStopRequest && currentShell() === "localhost" ? randomBytes(32).toString("base64url") : undefined;
  let stopAsked = false;
  const stopRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const json = (status: number, body: unknown) => void res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
    if (!stopKey) return json(404, { error: "Fant ikke" });
    if (req.method !== "POST") return json(405, { error: "Bare POST" });
    // Only the app's main process asks, and it sends no Origin. A page in a browser always does,
    // and could not read the key anyway.
    if (req.headers.origin !== undefined) return json(403, { error: "Ikke fra en nettside" });
    if (!sameKey(req.headers["x-agentic-stop-key"], stopKey)) return json(403, { error: "Feil nøkkel" });
    json(202, { ok: true, pid: process.pid });
    if (stopAsked) return;
    stopAsked = true;
    console.log("Agentic Desktop-appen ba nettleserversjonen avslutte, så appen kan bruke datamappen. Avslutter …");
    setImmediate(() => options.onStopRequest!());
  };

  const server = http.createServer((req, res) => {
    security.applyHeaders(res);
    if (!security.hostAllowed(req)) return void res.writeHead(403, { "content-type": "text/plain" }).end("Ugyldig Host");
    const url = URL.parse(req.url ?? "/", "http://localhost");
    if (!url) return void res.writeHead(400).end();
    if (url.pathname === "/api/instance/stop") return stopRequest(req, res);
    if (url.pathname.startsWith("/api/")) return void api.handle(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    serveStatic(req, res, config.webDist, url.pathname);
  });
  server.on("upgrade", (req, socket, head) => hub.handleUpgrade(req, socket, head));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  onFail(async () => {
    hub.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address() as AddressInfo;
  security.setPort(port);

  // After listen, so a second server on a busy port cannot touch the first one's runs.
  runner.recover();
  threadInbox.start();
  api.schedules.tick();
  // In the background: a slow or broken MCP server never holds up the start.
  mcp.start();
  security.writeTokenFile();
  onFail(() => security.removeTokenFile());
  writeInstance(config.dataDir, port, stopKey);
  // Half files from a server that stopped in the middle of a download: now, and once more when
  // those from just before the start are old enough to be sure of (downloads.ts).
  downloads.sweepStaging();
  const sweepAgain = setTimeout(() => downloads.sweepStaging(), STAGING_STALE_MS + 1000);
  sweepAgain.unref();
  onFail(() => clearTimeout(sweepAgain));

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      const errors: unknown[] = [];
      const cleanup = async (step: () => void | Promise<void>) => {
        try {
          await step();
        } catch (err) {
          errors.push(err);
        }
      };
      clearTimeout(sweepAgain);
      threadInbox.close();
      await cleanup(() => api.close());
      await cleanup(() => security.removeTokenFile());
      await cleanup(() => servers.close());
      await cleanup(() => hooks.close());
      await cleanup(() => runner.shutdown());
      await cleanup(() => mcp.close());
      await cleanup(() => uiMods.close());
      await cleanup(() => chatWorkspace.ready);
      await cleanup(() => chatWorkspace.close());
      await cleanup(() => playtest.stopAll());
      await cleanup(() => terminals.closeAll());
      await cleanup(() => browser.dispose());
      await cleanup(() => web.dispose());
      await cleanup(() => hub.close());
      await cleanup(() => preview.close());
      await cleanup(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      });
      await cleanup(() => log.flushAll());
      await cleanup(() => secrets.idle());
      await cleanup(() => {
        store.close();
        claim.release();
      });
      if (errors.length) {
        throw new AggregateError(errors, "Kunne ikke avslutte alle deler av Agentic Desktop.");
      }
    })();
    return closing;
  };

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    get link() {
      return security.link;
    },
    config,
    security,
    store,
    runner,
    browser,
    web,
    terminals,
    preview,
    childEnv: env,
    mcp,
    close,
  };
}
