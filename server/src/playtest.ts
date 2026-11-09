// Playtest: the project's own dev server in a terminal tab, or else a static server. Previews
// always get another port than the app, so another origin, and use the host name localhost while
// the app uses 127.0.0.1, because browsers do not separate cookies by port.
import { createReadStream, readFileSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { PlaytestState, Project } from "../../shared/protocol.ts";
import { guardPath, PathError } from "./paths.ts";
import type { Terminals } from "./terminal.ts";

const START_TIMEOUT_MS = 30_000;
const PORT_POLL_MS = 200;

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

export interface PlaytestOptions {
  dataDir: string;
  appPort: () => number;
  terminals: Terminals;
  publish: (state: PlaytestState) => void;
  openInBrowser: (projectId: string, url: string) => Promise<void>;
}

interface Entry {
  state: PlaytestState;
  server?: http.Server;
  cancel?: () => void;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "localhost" });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export function devCommand(project: Project, dataDir: string): string | null {
  try {
    const { abs } = guardPath(project.path, "package.json", dataDir);
    const scripts = JSON.parse(readFileSync(abs, "utf8")).scripts ?? {};
    if (scripts.dev) return "npm run dev";
    if (scripts.start) return "npm start";
  } catch {
    // No usable package.json.
  }
  return null;
}

export class Playtest {
  private options: PlaytestOptions;
  private entries = new Map<string, Entry>();
  private staticStarting = new Map<string, Promise<string>>();

  constructor(options: PlaytestOptions) {
    this.options = options;
  }

  state(projectId: string): PlaytestState {
    return this.entries.get(projectId)?.state ?? { projectId, status: "stopped" };
  }

  private set(projectId: string, state: Omit<PlaytestState, "projectId">): PlaytestState {
    const entry = this.entries.get(projectId) ?? { state: { projectId, status: "stopped" } };
    entry.state = { projectId, ...state };
    this.entries.set(projectId, entry);
    this.options.publish(entry.state);
    return entry.state;
  }

  async start(project: Project): Promise<PlaytestState> {
    const current = this.state(project.id);
    if (current.status === "running" || current.status === "starting") return current;
    const command = devCommand(project, this.options.dataDir);
    if (command) return this.startDev(project, command);
    const url = await this.startStatic(project);
    void this.options.openInBrowser(project.id, url).catch(() => undefined);
    return this.state(project.id);
  }

  private async startDev(project: Project, command: string): Promise<PlaytestState> {
    const port = await freePort();
    const terminalId = this.options.terminals.spawnCommand(project, "Playtest", command, {
      PORT: String(port),
      HOST: "127.0.0.1",
      BROWSER: "none",
    });
    const state = this.set(project.id, { status: "starting", terminalId });
    void this.watchDev(project.id, terminalId, port);
    return state;
  }

  // The app sets PORT, but many dev servers choose their own and print it.
  private async watchDev(projectId: string, terminalId: string, port: number): Promise<void> {
    const { terminals, appPort } = this.options;
    const entry = this.entries.get(projectId)!;
    let printed: number | undefined;
    const stopListening = terminals.onOutput(terminalId, (text) => {
      const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
      const match = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)/.exec(clean);
      if (match) printed ??= Number(match[1]);
    });
    let cancelled = false;
    entry.cancel = () => (cancelled = true);
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!cancelled) {
      const candidate = printed ?? port;
      if (candidate === appPort()) {
        this.fail(projectId, terminalId, "Prosjektet bruker samme port som appen");
        break;
      }
      if (await portOpen(candidate)) {
        const url = `http://localhost:${candidate}/`;
        if (cancelled) break;
        this.set(projectId, { status: "running", url, terminalId });
        void this.options.openInBrowser(projectId, url).catch(() => undefined);
        break;
      }
      if (terminals.isExited(terminalId)) {
        this.fail(projectId, terminalId, "Kommandoen stoppet før serveren svarte");
        break;
      }
      if (Date.now() > deadline) {
        this.fail(projectId, terminalId, "Serveren svarte ikke innen 30 sekunder");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, PORT_POLL_MS));
    }
    stopListening();
    entry.cancel = undefined;
  }

  private fail(projectId: string, terminalId: string, error: string): void {
    this.set(projectId, { status: "error", error, terminalId });
    void this.options.terminals.close(terminalId);
  }

  private startStatic(project: Project): Promise<string> {
    let starting = this.staticStarting.get(project.id);
    if (!starting) {
      starting = this.listenStatic(project).finally(() => this.staticStarting.delete(project.id));
      this.staticStarting.set(project.id, starting);
    }
    return starting;
  }

  private async listenStatic(project: Project): Promise<string> {
    const server = http.createServer((req, res) => this.serveStatic(project, server, req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as net.AddressInfo;
    const url = `http://localhost:${port}/`;
    this.set(project.id, { status: "running", url });
    this.entries.get(project.id)!.server = server;
    return url;
  }

  private serveStatic(project: Project, server: http.Server, req: http.IncomingMessage, res: http.ServerResponse): void {
    const { port } = server.address() as net.AddressInfo;
    const refuse = (status: number, text: string) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      res.end(text);
    };
    if (req.headers.host !== `localhost:${port}` && req.headers.host !== `127.0.0.1:${port}`) return refuse(403, "Ugyldig Host");
    if (req.method !== "GET" && req.method !== "HEAD") return refuse(405, "Bare lesing");
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://preview").pathname);
    } catch {
      return refuse(400, "Ugyldig adresse");
    }
    // Dotfiles such as .env and .git are never served.
    if (pathname.split("/").some((part) => part.startsWith("."))) return refuse(404, "Ikke funnet");
    try {
      let { abs } = guardPath(project.path, `.${pathname}`, this.options.dataDir);
      if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) abs = path.join(abs, "index.html");
      const info = statSync(abs, { throwIfNoEntry: false });
      if (!info?.isFile()) return refuse(404, "Ikke funnet");
      res.writeHead(200, {
        "content-type": MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
        "content-length": info.size,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (req.method === "HEAD") return void res.end();
      createReadStream(abs).pipe(res);
    } catch (err) {
      refuse(err instanceof PathError ? 403 : 500, "Kan ikke lese filen");
    }
  }

  // Lets the agent open a project path without a server of its own.
  async urlFor(project: Project, target: string): Promise<string> {
    let base = this.state(project.id).status === "running" ? this.state(project.id).url : undefined;
    base ??= await this.startStatic(project);
    return new URL(target.replace(/^\.?\//, ""), base).href;
  }

  async stop(projectId: string): Promise<PlaytestState> {
    const entry = this.entries.get(projectId);
    entry?.cancel?.();
    if (entry?.state.terminalId) await this.options.terminals.close(entry.state.terminalId);
    if (entry?.server) {
      entry.server.closeAllConnections();
      await new Promise((resolve) => entry.server!.close(resolve));
      entry.server = undefined;
    }
    return this.set(projectId, { status: "stopped" });
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
  }
}
