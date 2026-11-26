// Explicit manual Git actions. No shell interpolation, network, commits, forced checkouts,
// automatic stashes or deletion. Hooks/fsmonitor and credential prompts are disabled.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { GitWorkspaceState, Project } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";
import { guardProjectRoot, isInside } from "./paths.ts";

export class GitWorkspace {
  busy = false;
  private closed = false;
  private children = new Set<ChildProcess>();
  private hardStops = new Map<ChildProcess, ReturnType<typeof setTimeout>>();
  constructor(privateOptions: { dataDir: string; env: () => Record<string, string>; activeProjects: () => Project[] }) { this.options = privateOptions; }
  private options: { dataDir: string; env: () => Record<string, string>; activeProjects: () => Project[] };
  async close(): Promise<void> {
    this.closed = true;
    const waiting = [...this.children].map((child) => new Promise<void>((resolve) => { child.once("close", () => resolve()); this.stop(child); }));
    await Promise.all(waiting);
  }
  private stop(child: ChildProcess): void {
    if (!child.pid) return;
    try { process.kill(-child.pid, "SIGTERM"); } catch { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); }
    if (!this.hardStops.has(child)) this.hardStops.set(child, setTimeout(() => {
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }
    }, 2000));
  }
  private clearStop(child: ChildProcess): void { clearTimeout(this.hardStops.get(child)); this.hardStops.delete(child); }
  private git(root: string, args: string[], optional = false): Promise<string | null> {
    if (this.closed) return Promise.reject(new HttpError(503, "Git-arbeidsområdet avsluttes"));
    const env = { ...this.options.env() };
    for (const name of Object.keys(env)) if (/^GIT_/i.test(name)) delete env[name];
    Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" });
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", root, ...args], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      this.children.add(child);
      const out: Buffer[] = [], err: Buffer[] = []; let bytes = 0, failure: Error | null = null;
      const timer = setTimeout(() => { failure = new HttpError(504, "Git brukte for lang tid. Kontroller arbeidsområdet før du prøver igjen."); this.stop(child); }, 30_000);
      const collect = (list: Buffer[]) => (data: Buffer) => {
        bytes += data.length;
        if (bytes > 2 * 1024 * 1024) { failure = new HttpError(413, "Git-resultatet er for stort"); this.stop(child); }
        else list.push(data);
      };
      child.stdout!.on("data", collect(out)); child.stderr!.on("data", collect(err));
      child.once("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer); this.clearStop(child); this.children.delete(child);
        reject(new HttpError(503, error.code === "ENOENT" ? "Git er ikke installert eller finnes ikke i PATH" : "Kunne ikke starte Git"));
      });
      child.once("close", (code) => {
        clearTimeout(timer); this.clearStop(child); this.children.delete(child);
        if (failure) return reject(failure);
        if (this.closed) return reject(new HttpError(503, "Git-arbeidsområdet avsluttes"));
        if (code === 0) return resolve(Buffer.concat(out).toString("utf8"));
        if (optional) return resolve(null);
        const detail = Buffer.concat(err).toString("utf8").replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 1200);
        reject(new HttpError(409, `Git kunne ikke fullføre handlingen${detail ? `: ${detail}` : "."}`));
      });
    });
  }
  async status(project: Project): Promise<GitWorkspaceState> {
    if (!existsSync(project.path) || !statSync(project.path).isDirectory()) throw new HttpError(404, "Prosjektmappen finnes ikke");
    const empty: GitWorkspaceState = { repository: false, root: project.path, commonDir: null, branch: null, detached: false, hasCommits: false, dirty: false, branches: [], worktrees: [], suggestedParent: path.join(path.dirname(project.path), ".agentic-worktrees") };
    const rootText = await this.git(project.path, ["rev-parse", "--show-toplevel"], true);
    if (!rootText) return { ...empty, message: "Mappen er ikke et Git-arbeidsområde. Initialiser og lag første commit i Git for å bruke grener og arbeidstrær." };
    const root = guardProjectRoot(rootText.replace(/\r?\n$/, ""), this.options.dataDir);
    const common = (await this.git(root, ["rev-parse", "--git-common-dir"]))!.replace(/\r?\n$/, "");
    const commonDir = guardProjectRoot(realpathSync(path.resolve(root, common)), this.options.dataDir);
    const branch = (await this.git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true))?.trim() ?? null;
    const hasCommits = (await this.git(root, ["rev-parse", "--verify", "HEAD"], true)) !== null;
    const branches = (await this.git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]))!.split("\n").filter(Boolean);
    const dirty = !!(await this.git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]))?.length;
    const worktrees: GitWorkspaceState["worktrees"] = [];
    const raw = (await this.git(root, ["worktree", "list", "--porcelain", "-z"]))!;
    for (const block of raw.split("\0\0")) {
      const fields = block.split("\0"), folder = fields.find((field) => field.startsWith("worktree "))?.slice(9);
      if (!folder) continue;
      worktrees.push({ path: folder, branch: fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18) ?? null, detached: fields.includes("detached"), locked: fields.some((field) => field === "locked" || field.startsWith("locked ")), prunable: fields.some((field) => field === "prunable" || field.startsWith("prunable ")) });
    }
    return { ...empty, repository: true, root, commonDir, branch, detached: hasCommits && !branch, hasCommits, branches, dirty, worktrees, suggestedParent: path.join(path.dirname(root), ".agentic-worktrees") };
  }
  private async name(root: string, value: unknown): Promise<string> {
    if (typeof value !== "string" || !/^[^-\s\x00-\x1f\x7f][^\s\x00-\x1f\x7f]{0,119}$/u.test(value)) throw new HttpError(400, "Bruk et grennavn på 1–120 tegn uten mellomrom eller kontrolltegn");
    if ((await this.git(root, ["check-ref-format", "--branch", value], true))?.trim() !== value) throw new HttpError(400, "Ugyldig Git-grennavn");
    return value;
  }
  private async mutation<T>(project: Project, work: (state: GitWorkspaceState) => Promise<T>, newAgentWorktree = false): Promise<T> {
    if (this.busy) throw new HttpError(409, "En Git-handling pågår. Vent til den er ferdig.");
    this.busy = true;
    try {
      const state = await this.status(project);
      if (!state.repository || !state.hasCommits) throw new HttpError(409, "Prosjektet må være et Git-repo med minst én commit");
      for (const active of newAgentWorktree ? [] : this.options.activeProjects()) {
        const other = active.id === project.id ? state : await this.status(active);
        if (other.commonDir === state.commonDir) throw new HttpError(409, "En modell jobber i dette repoet. Stopp eller vent til arbeidet er ferdig.");
      }
      return await work(state);
    } finally { this.busy = false; }
  }
  switchBranch(project: Project, input: { branch: unknown; create?: boolean; base?: unknown }): Promise<GitWorkspaceState> {
    return this.mutation(project, async (state) => {
      const branch = await this.name(state.root, input.branch);
      if (state.dirty) throw new HttpError(409, "Arbeidsmappen har lokale endringer. Commit eller flytt endringene før grenbytte; appen sletter eller stasher dem ikke.");
      if (input.create) {
        if (state.branches.includes(branch)) throw new HttpError(409, "Grenen finnes allerede");
        const base = input.base === undefined || input.base === "HEAD" ? "HEAD" : typeof input.base === "string" && state.branches.includes(input.base) ? input.base : null;
        if (!base) throw new HttpError(400, "Startgrenen finnes ikke. Oppfrisk grenlisten.");
        await this.git(state.root, ["switch", "--no-guess", "-c", branch, base]);
      } else {
        if (!state.branches.includes(branch)) throw new HttpError(400, "Velg en lokal gren fra listen");
        await this.git(state.root, ["switch", "--no-guess", branch]);
      }
      return this.status(project);
    });
  }
  private async addWorktree(state: GitWorkspaceState, input: { branch: unknown; path?: unknown; base?: unknown; existing?: boolean }): Promise<string> {
    const branch = await this.name(state.root, input.branch);
    if (input.existing ? !state.branches.includes(branch) : state.branches.includes(branch)) throw new HttpError(409, input.existing ? "Grenen finnes ikke" : "Grenen finnes allerede. Velg en ny gren eller bruk en eksisterende.");
    if (state.worktrees.some((tree) => tree.branch === branch)) throw new HttpError(409, "Grenen er allerede åpen i et arbeidstre");
    const fallback = path.join(state.suggestedParent, `${path.basename(state.root)}-${branch.replaceAll("/", "-")}-${Date.now().toString(36)}`);
    if (input.path !== undefined && typeof input.path !== "string") throw new HttpError(400, "Ugyldig sti for arbeidstreet");
    const target = guardProjectRoot(typeof input.path === "string" && input.path.trim() ? input.path.trim() : fallback, this.options.dataDir);
    if (isInside(state.root, target) || isInside(target, state.root) || existsSync(target)) throw new HttpError(409, "Velg en ny mappe utenfor repoet. Eksisterende mapper blir ikke overskrevet.");
    const base = input.base === undefined || input.base === "HEAD" ? "HEAD" : typeof input.base === "string" && state.branches.includes(input.base) ? input.base : null;
    if (!base) throw new HttpError(400, "Startgrenen finnes ikke. Oppfrisk grenlisten.");
    await this.git(state.root, ["worktree", "add", ...(input.existing ? [] : ["--no-track", "-b", branch]), "--", target, input.existing ? branch : base]);
    return realpathSync(target);
  }
  createWorktree(project: Project, input: { branch: unknown; path?: unknown; base?: unknown; existing?: boolean }): Promise<{ path: string; state: GitWorkspaceState }> {
    return this.mutation(project, async (state) => ({ path: await this.addWorktree(state, input), state: await this.status(project) }));
  }
  createAgentWorktree<T>(project: Project, branch: string, start: (worktreePath: string) => T, signal: AbortSignal): Promise<T> {
    // Adding a new worktree at HEAD leaves active checkouts and their branches alone.
    return this.mutation(project, async (state) => {
      const relative = path.relative(state.root, realpathSync(project.path));
      if (relative && (await this.git(state.root, ["cat-file", "-t", `HEAD:${relative}`], true))?.trim() !== "tree") {
        throw new HttpError(409, "Prosjektmappen må finnes i Git-commiten for å lage et isolert arbeidstre.");
      }
      signal.throwIfAborted();
      const root = await this.addWorktree(state, { branch });
      try {
        signal.throwIfAborted();
        return start(path.join(root, relative));
      } catch (error) {
        // Only remove our newly created worktree if it is still clean.
        if (await this.git(state.root, ["worktree", "remove", "--", root], true) !== null) {
          await this.git(state.root, ["branch", "-d", "--", branch], true);
        }
        throw error;
      }
    }, true);
  }
}
