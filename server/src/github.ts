// Credentials from gh or the keyring stay on the server. Local GitHub discovery only reads
// .git/config. Approved clones pass credentials to Git through a temporary askpass helper.
//
// AD_GITHUB_API points the client at another API address, for the tests and their local fake
// server. Only a loopback address is accepted, so the variable can never send the token elsewhere.
import { closeSync, lstatSync, openSync, readSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { sourceText } from "../../shared/i18n.ts";
import { validPullReference } from "../../shared/linked-pr.ts";
import type { GitHubCliStatus, GitHubErrorCode, GitHubItem, GitHubProject, GitHubRemote, GitHubStatus, PullWatchStatus, Settings } from "../../shared/protocol.ts";
import { childEnv } from "./env.ts";
import { cloneGitHub } from "./github-git.ts";
import type { Secrets } from "./secrets.ts";

export const GITHUB_SECRET = "integration:github";
const DEFAULT_API = "https://api.github.com";
const WEB = "https://github.com";
const TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;
const MAX_ITEMS = 30;
const MAX_CONFIG = 64 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
const MAX_DIFF = 12_000;
const MAX_LOG = 256 * 1024;
const exec = promisify(execFile);

async function gh(command: "status" | "token") {
  const env = childEnv({ names: ["GH_DEBUG", "GH_HOST", "GH_FORCE_TTY"], values: [] });
  return exec("gh", ["auth", command, "--hostname", "github.com"], {
    env: { ...env, NO_COLOR: "1", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    timeout: command === "status" ? TIMEOUT_MS : 3000,
    maxBuffer: 16 * 1024,
    encoding: "utf8",
  });
}

function cliLogin(output: string, activeOnly = false): string | undefined {
  const accounts = [...output.matchAll(/Logged in to github\.com (?:account )?([a-z\d][a-z\d-]{0,38}(?:\[bot\])?)(?=\s|$)[^\r\n]*(?:\r?\n\s*- Active account: (true|false))?/gi)];
  return accounts.find(account => account[2] === "true")?.[1] ?? (activeOnly ? undefined : accounts.find(account => !account[2])?.[1]);
}

export async function inspectGitHubCli(): Promise<GitHubCliStatus> {
  try {
    const { stdout, stderr } = await gh("status");
    const login = cliLogin(stdout + "\n" + stderr);
    return login ? { state: "signed-in", login } : { state: "unavailable" };
  } catch (err) {
    const { code, stdout, stderr } = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (code === "ENOENT") return { state: "missing" };
    const login = cliLogin(`${stdout ?? ""}\n${stderr ?? ""}`, true);
    if (typeof code === "number" && login) return { state: "signed-in", login };
    if (typeof code === "number" && /not logged|failed to log in|invalid|authenticate|no oauth token/i.test(stderr ?? "")) return { state: "signed-out" };
    return { state: "unavailable" };
  }
}

export class GitHubError extends Error {
  code: GitHubErrorCode;
  status: number;
  resetAt?: number;

  constructor(code: GitHubErrorCode, message: string, status: number, resetAt?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.resetAt = resetAt;
  }
}

// The API base from the environment, when it is a loopback address. Anything else is ignored.
export function apiBase(env: string | undefined = process.env.AD_GITHUB_API): string {
  if (!env) return DEFAULT_API;
  try {
    const url = new URL(env);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (loopback && (url.protocol === "http:" || url.protocol === "https:")) return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    // Not a URL.
  }
  return DEFAULT_API;
}

// Classic tokens (ghp_), fine-grained ones (github_pat_) and the other prefixes GitHub uses. The
// check is loose on purpose: GitHub decides, this only stops a pasted sentence or a line break.
export function plausibleToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_]{20,255}$/.test(token);
}

// 1. .git/config

function readSmall(file: string, max: number): string | null {
  let fd: number | undefined;
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size > max) return null;
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(info.size);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, length).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// .git is a folder, or a file with "gitdir: <path>" in a worktree or submodule. A worktree keeps
// its config in the common folder that "commondir" points to.
function configFile(root: string): string | null {
  const dotGit = path.join(root, ".git");
  let info;
  try {
    info = lstatSync(dotGit);
  } catch {
    return null;
  }
  let dir: string;
  if (info.isDirectory()) dir = dotGit;
  else if (info.isFile()) {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(readSmall(dotGit, 4096) ?? "");
    if (!match) return null;
    dir = path.resolve(root, match[1]);
  } else return null;
  const common = readSmall(path.join(dir, "commondir"), 4096)?.trim();
  if (common) dir = path.resolve(dir, common);
  return path.join(dir, "config");
}

// The remotes in a git config file, in order: [remote "name"] with url = ... under it.
export function parseRemotes(text: string): Array<{ name: string; url: string }> {
  const remotes: Array<{ name: string; url: string }> = [];
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, "");
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
    if (section) {
      current = section[1].toLowerCase() === "remote" && section[2] !== undefined ? section[2].replace(/\\(.)/g, "$1") : null;
      continue;
    }
    if (current === null) continue;
    const entry = /^url\s*=\s*(.*?)\s*$/i.exec(line);
    if (entry && !remotes.some((r) => r.name === current)) remotes.push({ name: current, url: entry[1].replace(/^"(.*)"$/, "$1") });
  }
  return remotes;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

// owner and repo from the forms git accepts: https://github.com/o/r(.git), git@github.com:o/r.git,
// ssh://git@github.com/o/r.git and git://github.com/o/r.git, also with a user or a port.
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  let host = "";
  let rest = "";
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(url);
  if (/^[a-z+]+:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      rest = decodeURIComponent(parsed.pathname);
    } catch {
      return null;
    }
  } else if (scp) {
    host = scp[1];
    rest = scp[2];
  } else return null;
  if (host.toLowerCase() !== "github.com" && host.toLowerCase() !== "www.github.com" && host.toLowerCase() !== "ssh.github.com") return null;
  const parts = rest.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "").split("/");
  if (parts.length !== 2 || !NAME.test(parts[0]) || !NAME.test(parts[1]) || parts[1] === "." || parts[1] === "..") return null;
  return { owner: parts[0], repo: parts[1] };
}

// The project's GitHub repo: origin when it is on GitHub, else the first remote that is.
export function readGitHubRemote(root: string, web = WEB): { remote: GitHubRemote | null; reason?: string } {
  const file = configFile(root);
  if (!file) return { remote: null, reason: sourceText("Prosjektmappen er ikke en git-mappe.") };
  const text = readSmall(file, MAX_CONFIG);
  if (text === null) return { remote: null, reason: sourceText("Fant ikke .git/config, eller filen kunne ikke leses.") };
  const remotes = parseRemotes(text);
  if (!remotes.length) return { remote: null, reason: sourceText("Git-mappen har ingen remote.") };
  const ordered = [...remotes.filter((r) => r.name === "origin"), ...remotes.filter((r) => r.name !== "origin")];
  for (const candidate of ordered) {
    const found = parseGitHubUrl(candidate.url);
    if (found) return { remote: { ...found, remote: candidate.name, url: `${web}/${found.owner}/${found.repo}` } };
  }
  return { remote: null, reason: sourceText("Ingen remote peker til GitHub.") };
}

// 2. The API

interface Cached {
  etag: string | null;
  body: unknown;
  at: number;
}

interface RequestOptions {
  method?: "POST" | "PUT";
  json?: string;
  accept?: string;
  redirect?: RequestRedirect;
  signal?: AbortSignal;
}

export function redactGitHubText(text: string, token?: string): string {
  const safe = token ? text.replaceAll(token, "[redacted]") : text;
  return safe
    .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}/g, "[redacted]")
    .replace(/(https?:\/\/)[^/\s"'<>@]+@(?=(?:www\.)?github\.com(?:[/:\s"'<>]|$))/gi, "$1");
}

export class GitHub {
  private secrets: Secrets;
  private base: string;
  readonly web: string;
  private selection: () => Settings["githubAuth"];
  private select: (method: Settings["githubAuth"]) => void;
  private changes: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private cache = new Map<string, Cached>();
  private cacheIdentity = "";
  private account: GitHubStatus | null = null;
  // Never chosen (githubAuth undefined, no token): a signed-in gh is used without asking, so pull
  // requests and issues show up by themselves. Disconnecting saves null and ends this.
  private autoDetect: boolean;
  private detected: { at: number; cli: GitHubCliStatus } | null = null;
  private detecting: Promise<void> | null = null;

  constructor(secrets: Secrets, auth: { get: () => Settings["githubAuth"]; set: (method: Settings["githubAuth"]) => void }, base = apiBase(), autoDetect?: boolean) {
    this.secrets = secrets;
    this.selection = auth.get;
    this.select = auth.set;
    this.base = base;
    // With a test server for the API, links go to the same server, so a test never opens github.com.
    this.web = base === DEFAULT_API ? WEB : new URL(base).origin;
    // Only against the real API, so a test with a fake API never reads the machine's own gh.
    this.autoDetect = autoDetect ?? (base === DEFAULT_API && process.env.AD_GITHUB_AUTODETECT !== "0");
  }

  private method(): Settings["githubAuth"] {
    const choice = this.selection();
    if (choice === undefined && this.secrets.get(GITHUB_SECRET)) return "token";
    if (choice === undefined && this.autoDetect && this.detected?.cli.state === "signed-in") return "gh";
    return choice;
  }

  private undecided(): boolean {
    return this.autoDetect && this.selection() === undefined && !this.secrets.get(GITHUB_SECRET);
  }

  // Looks once whether gh is installed and signed in, and again a minute later if it was not.
  private async detectCli(): Promise<void> {
    if (!this.undecided()) return;
    if (this.detected && (this.detected.cli.state === "signed-in" || Date.now() - this.detected.at < CACHE_MS)) return;
    this.detecting ??= (async () => {
      const revision = this.revision;
      const cli = await inspectGitHubCli();
      if (revision !== this.revision || !this.undecided()) return;
      this.detected = { at: Date.now(), cli };
      if (cli.state === "signed-in") this.account = this.cliAccount(cli);
    })().finally(() => { this.detecting = null; });
    await this.detecting;
  }

  private async token(): Promise<string | undefined> {
    await this.detectCli();
    const method = this.method();
    if (method === "token") return this.secrets.get(GITHUB_SECRET);
    if (method !== "gh") return;
    const revision = this.revision;
    try {
      const { stdout } = await gh("token");
      const token = stdout.trim();
      if (revision === this.revision && plausibleToken(token)) return token;
    } catch {
      // gh failures can carry credential material in stdout or stderr.
    }
    if (this.revision === revision) this.account = { connected: false, method: "gh" };
  }

  status(): GitHubStatus {
    const method = this.method();
    if (method === "gh") return this.account ?? { connected: false, method };
    if (!method || !this.secrets.get(GITHUB_SECRET)) return { connected: false };
    return this.account ?? { connected: true, method };
  }

  async check(): Promise<GitHubStatus> {
    await this.detectCli();
    if (this.method() === "gh") {
      const revision = this.revision;
      const cli = await inspectGitHubCli();
      if (revision === this.revision) {
        this.account = this.cliAccount(cli);
        // Found by itself and signed out since: back to not chosen, and looked for again later.
        if (this.undecided()) this.detected = { at: Date.now(), cli };
      }
      return this.status();
    }
    const token = await this.token();
    if (token) {
      const identity = this.useCredential(token);
      if (!this.account) await this.loadAccount(token, identity).catch(() => undefined);
    }
    return this.status();
  }

  agentStatus(): GitHubStatus {
    const status = this.status();
    const login = status.login && this.redactForAgent(status.login);
    return { connected: status.connected, ...(login && /^[\w-]{1,39}(?:\[bot\])?$/.test(login) ? { login } : {}) };
  }

  redactForAgent(text: string): string {
    return redactGitHubText(text, this.secrets.get(GITHUB_SECRET));
  }

  get agentCredentialRevision(): number {
    return this.revision;
  }

  connect(token: unknown): Promise<GitHubStatus> {
    return this.change(() => this.connectToken(token));
  }

  private async connectToken(token: unknown): Promise<GitHubStatus> {
    const trimmed = typeof token === "string" ? token.trim() : token;
    if (!plausibleToken(trimmed)) throw new GitHubError("bad-token", "Det ser ikke ut som et GitHub-token. Lim inn hele tokenet, uten mellomrom.", 400);
    const { body, headers } = await this.request("/user", trimmed, false);
    const user = body as { login?: unknown; name?: unknown };
    if (typeof user.login !== "string") throw new GitHubError("other", "GitHub svarte uten et brukernavn.", 502);
    await this.secrets.set(GITHUB_SECRET, trimmed);
    this.changeAccount("token", { connected: true, method: "token", login: user.login, name: typeof user.name === "string" ? user.name : null, scopes: headers.get("x-oauth-scopes") });
    this.cacheIdentity = credentialIdentity(trimmed);
    return this.status();
  }

  useCli(): Promise<GitHubStatus> {
    return this.change(async () => {
      const status = await inspectGitHubCli();
      if (status.state === "missing") throw new GitHubError("not-connected", sourceText("GitHub CLI er ikke installert."), 409);
      await this.secrets.set(GITHUB_SECRET, null);
      this.changeAccount("gh", this.cliAccount(status));
      return this.status();
    });
  }

  disconnect(): Promise<GitHubStatus> {
    return this.change(async () => {
      await this.secrets.set(GITHUB_SECRET, null);
      this.changeAccount(null, null);
      return this.status();
    });
  }

  private cliAccount(cli: GitHubCliStatus): GitHubStatus {
    return cli.state === "signed-in" ? { connected: true, method: "gh", login: cli.login } : { connected: false, method: "gh" };
  }

  private change(work: () => Promise<GitHubStatus>): Promise<GitHubStatus> {
    const result = this.changes.then(work);
    this.changes = result.catch(() => undefined);
    return result;
  }

  private changeAccount(method: Settings["githubAuth"], account: GitHubStatus | null): void {
    this.select(method);
    this.revision++;
    this.cache.clear();
    this.cacheIdentity = "";
    this.account = account;
  }

  async reader(refresh = false) {
    const revision = this.revision;
    const token = await this.token();
    if (!token || revision !== this.revision) throw new GitHubError("not-connected", NOT_CONNECTED, 409);
    const identity = this.useCredential(token);
    const login = this.account?.login ?? (await this.loadAccount(token, identity))?.login;
    return {
      login,
      get: (route: string) => this.cached(route, token, refresh),
      query: (query: string) => this.cached("/graphql", token, refresh, JSON.stringify({ query })),
    };
  }

  async agentClient(signal: AbortSignal, allowed: () => boolean) {
    const revision = this.revision;
    const ready = () => {
      signal.throwIfAborted();
      if (revision !== this.revision || !allowed()) throw new GitHubError("not-connected", "The GitHub connection changed. Retry the tool call.", 409);
    };
    ready();
    const token = await this.token();
    if (!token) throw new GitHubError("not-connected", NOT_CONNECTED, 409);
    ready();
    const redact = (text: string) => redactGitHubText(text, token);
    const json = async (route: string, method?: "POST" | "PUT", payload?: unknown) => {
      ready();
      const { body, headers } = await this.request(route, token, true, undefined, undefined, { method, json: JSON.stringify(payload), signal });
      if (method && route !== "/graphql") this.cache.clear();
      else ready();
      return {
        body: body === null ? null : JSON.parse(redact(JSON.stringify(body))),
        more: /;\s*rel="next"/.test(headers.get("link") ?? ""),
      };
    };
    return {
      login: this.agentStatus().login,
      redact,
      get: async (route: string) => (await json(route)).body,
      page: (route: string) => json(route),
      post: async (route: string, data: unknown) => (await json(route, "POST", data)).body,
      put: async (route: string, data: unknown) => (await json(route, "PUT", data)).body,
      query: async (query: string, variables: Record<string, unknown>) => (await json("/graphql", "POST", { query, variables })).body,
      diff: async (route: string) => {
        ready();
        const response = await this.response(route, token, { accept: "application/vnd.github.diff", signal });
        if (!response.ok) {
          await response.body?.cancel();
          return { diff: null, diffNote: "GitHub did not return a diff for this pull request." };
        }
        const { text, truncated } = await readSample(response, MAX_DIFF + token.length);
        ready();
        const diff = redact(text);
        return { diff: diff.slice(0, MAX_DIFF), diffTruncated: truncated || diff.length > MAX_DIFF };
      },
      logs: async (repo: string, job: number) => {
        ready();
        const result = await this.actionLog(repo, job, token, signal, redact);
        ready();
        return result;
      },
      clone: (repo: string, root: string, directory: string, dataDir: string) => {
        ready();
        return cloneGitHub(repo, root, directory, dataDir, token, this.web, signal);
      },
    };
  }

  private async actionLog(repo: string, job: number, token: string, signal: AbortSignal, redact: (text: string) => string) {
    try {
      let response = await this.response(`/repos/${repo}/actions/jobs/${job}/logs`, token, {
        accept: "text/plain", redirect: "manual", signal,
      });
      if (response.status === 302) {
        await response.body?.cancel();
        const target = new URL(response.headers.get("location") ?? "", this.base);
        const testOrigin = this.base !== DEFAULT_API && target.origin === new URL(this.base).origin;
        const githubStorage = target.protocol === "https:" && !target.port &&
          /\.(?:actions\.githubusercontent\.com|blob\.core\.windows\.net)$/i.test(target.hostname);
        if ((!testOrigin && !githubStorage) || target.username || target.password) return null;
        response = await fetch(target, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
      }
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const { text, truncated } = await readSample(response, MAX_LOG, true);
      return { text: redact(text), truncated };
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }

  private useCredential(token: string): string {
    const identity = credentialIdentity(token);
    if (this.cacheIdentity !== identity) {
      this.cacheIdentity = identity;
      this.cache.clear();
      // Credentials can also change outside the app, for example with gh auth switch.
      this.account = null;
    }
    return identity;
  }

  // Remote, repo, open pull requests and issues. Errors from GitHub are part of the answer, so the
  // panel can still show the repo it found in .git/config.
  async project(root: string, refresh = false): Promise<GitHubProject> {
    const { remote, reason } = readGitHubRemote(root, this.web);
    const out: GitHubProject = { remote, reason, status: this.status() };
    if (!remote) return out;
    const token = await this.token();
    if (!token) {
      out.error = { code: "not-connected", message: NOT_CONNECTED };
      out.status = this.status();
      return out;
    }
    const base = `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}`;
    try {
      const identity = this.useCredential(token);
      if (!this.account?.login) await this.loadAccount(token, identity);
      out.status = this.status();
      const [repo, pulls, issues] = await Promise.all([
        this.cached(base, token, refresh),
        this.cached(`${base}/pulls?state=open&per_page=${MAX_ITEMS}&sort=updated&direction=desc`, token, refresh),
        this.cached(`${base}/issues?state=open&per_page=${MAX_ITEMS}&sort=updated&direction=desc`, token, refresh),
      ]);
      const r = repo as Record<string, any>;
      out.repo = {
        description: typeof r.description === "string" ? r.description : null,
        private: r.private === true,
        defaultBranch: typeof r.default_branch === "string" ? r.default_branch : "main",
        stars: Number(r.stargazers_count) || 0,
        url: remote.url,
      };
      out.pulls = items(pulls, remote, "pull");
      // The issues list holds pull requests too. They are already in the list above.
      out.issues = items(Array.isArray(issues) ? issues.filter((i) => !i?.pull_request) : [], remote, "issues");
      out.fetchedAt = Date.now();
    } catch (err) {
      if (!(err instanceof GitHubError)) throw err;
      out.error = { code: err.code, message: err.message, resetAt: err.resetAt };
      if (err.code === "bad-token") this.account = null;
    }
    return out;
  }

  async pullWatch(repo: string, number: number): Promise<PullWatchStatus> {
    if (!validPullReference(repo, number)) {
      throw new GitHubError("other", "Bruk et gyldig GitHub-repo og PR-nummer.", 400);
    }
    const [owner, name] = repo.split("/");
    const token = await this.token();
    if (!token) throw new GitHubError("not-connected", "Koble til GitHub i Innstillinger for å følge en pull request.", 409);
    const query = `query PullWatch($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          title state isDraft headRefOid reviewDecision statusCheckRollup { state }
        }
      }
    }`;
    const request = JSON.stringify({ query, variables: { owner, name, number } });
    const { body, headers } = await this.request("/graphql", token, true, undefined, request);
    const response = body as { data?: { repository?: { pullRequest?: {
      title?: unknown; state?: unknown; isDraft?: unknown; headRefOid?: unknown;
      reviewDecision?: unknown; statusCheckRollup?: { state?: unknown } | null;
    } | null } | null }; errors?: Array<{ type?: string }> } | null;
    if (response?.errors?.length) {
      if (response.errors.some(error => error.type === "RATE_LIMITED")) {
        const reset = Number(headers.get("x-ratelimit-reset"));
        const resetAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined;
        throw new GitHubError("rate-limit", "GitHub har nådd grensen for antall forespørsler.", 429, resetAt);
      }
      if (response.errors.some(error => error.type === "FORBIDDEN" || error.type === "NOT_FOUND")) {
        throw new GitHubError("not-found", "Fant ikke PR-en, eller GitHub-tokenet mangler lesetilgang til PR, sjekker eller status.", 404);
      }
      throw new GitHubError("other", "GitHub kunne ikke lese status for denne PR-en.", 502);
    }
    const pull = response?.data?.repository?.pullRequest;
    if (!pull) throw new GitHubError("not-found", "Fant ikke PR-en, eller GitHub-tokenet mangler tilgang.", 404);
    const { title, state, headRefOid: head, isDraft: draft, reviewDecision, statusCheckRollup } = pull;
    if (typeof title !== "string" || typeof head !== "string" || typeof draft !== "boolean" ||
        (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED")) {
      throw new GitHubError("other", "GitHub svarte uten full PR-status.", 502);
    }
    const checks = statusCheckRollup?.state;
    if ((checks !== undefined && checks !== "EXPECTED" && checks !== "PENDING" && checks !== "SUCCESS" && checks !== "ERROR" && checks !== "FAILURE") ||
        (reviewDecision !== null && reviewDecision !== "APPROVED" && reviewDecision !== "CHANGES_REQUESTED" && reviewDecision !== "REVIEW_REQUIRED")) {
      throw new GitHubError("other", "GitHub svarte med en ukjent PR-status.", 502);
    }
    return { repo, number, title, url: `${this.web}/${owner}/${name}/pull/${number}`, state, head, draft, checks: checks ?? null, review: reviewDecision };
  }

  private async loadAccount(token: string, identity: string): Promise<GitHubStatus | undefined> {
    const revision = this.revision;
    const method = this.method();
    const { body, headers } = await this.request("/user", token, true);
    const user = body as { login?: unknown; name?: unknown };
    if (!method || typeof user?.login !== "string" || !/^[\w-]+(?:\[bot\])?$/.test(user.login)) return;
    const account: GitHubStatus = { connected: true, method, login: user.login, name: typeof user.name === "string" ? user.name : null, scopes: headers.get("x-oauth-scopes") };
    if (revision === this.revision && identity === this.cacheIdentity) this.account = account;
    return account;
  }

  // A conditional request with the last ETag: GitHub answers 304, which does not count against the
  // rate limit. Within CACHE_MS the cached answer is used without asking at all.
  private async cached(pathAndQuery: string, token: string, refresh: boolean, query?: string): Promise<unknown> {
    const key = query ?? pathAndQuery;
    const revision = this.revision;
    const identity = credentialIdentity(token);
    const hit = identity === this.cacheIdentity ? this.cache.get(key) : undefined;
    if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return hit.body;
    const { body, headers, notModified } = await this.request(pathAndQuery, token, true, hit?.etag ?? undefined, query);
    const value = notModified && hit ? hit.body : body;
    if (revision === this.revision && identity === this.cacheIdentity) {
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { etag: headers.get("etag"), body: value, at: Date.now() });
    }
    return value;
  }

  private async response(pathAndQuery: string, token: string, options: RequestOptions = {}, etag?: string): Promise<Response> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    try {
      return await fetch(this.base + pathAndQuery, {
        method: options.method ?? "GET",
        body: options.json,
        headers: {
          accept: options.accept ?? "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "Agentic-Desktop",
          "x-github-api-version": "2022-11-28",
          ...(etag ? { "if-none-match": etag } : {}),
          ...(options.json === undefined ? {} : { "content-type": "application/json" }),
        },
        redirect: options.redirect ?? "error",
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    } catch {
      options.signal?.throwIfAborted();
      throw new GitHubError("offline", timeout.aborted ? "GitHub svarte ikke innen 10 sekunder. Prøv igjen om litt." : "Fikk ikke kontakt med GitHub. Sjekk nettverket.", 502);
    }
  }

  private async request(pathAndQuery: string, token: string, stored: boolean, etag?: string, query?: string, options?: RequestOptions): Promise<{ body: unknown; headers: Headers; notModified: boolean }> {
    const res = await this.response(pathAndQuery, token, query === undefined ? options : { method: "POST", json: query }, etag);
    if (res.status === 304) return { body: null, headers: res.headers, notModified: true };
    const text = await readLimited(res);
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.ok) {
      if (pathAndQuery === "/graphql" && Array.isArray((body as any)?.errors) && (body as any).errors.some((error: any) => error?.type === "RATE_LIMITED")) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        throw new GitHubError("rate-limit", "GitHub har nådd grensen for antall forespørsler.", 429, reset > 0 ? reset * 1000 : undefined);
      }
      return { body, headers: res.headers, notModified: false };
    }
    const message = typeof (body as any)?.message === "string" ? String((body as any).message).slice(0, 200) : "";
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const retryAfter = Number(res.headers.get("retry-after"));
    if (res.status === 429 || (res.status === 403 && (remaining === "0" || /rate limit/i.test(message)))) {
      const resetAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Number.isFinite(retryAfter) && retryAfter > 0 ? Date.now() + retryAfter * 1000 : undefined;
      throw new GitHubError("rate-limit", "GitHub har nådd grensen for antall forespørsler.", 429, resetAt);
    }
    if (res.status === 401) {
      throw new GitHubError("bad-token", stored ? "GitHub godtar ikke lenger tokenet. Det kan være utløpt eller trukket tilbake." : "GitHub godtok ikke tokenet. Sjekk at det er limt inn helt.", stored ? 502 : 400);
    }
    if (res.status === 404 || res.status === 403) {
      throw new GitHubError("not-found", "Fant ikke repoet på GitHub, eller tokenet har ikke tilgang til det.", 404);
    }
    if (options?.method && pathAndQuery.endsWith("/merge")) {
      if (res.status === 409) throw new GitHubError("other", "The pull request head no longer matches the expected SHA. Read the PR again before merging.", 409);
      if (res.status === 405) throw new GitHubError("other", "GitHub cannot merge this PR. Check conflicts, branch protection, and the requested merge method.", 405);
    }
    if (res.status === 422 && options?.method) throw new GitHubError("other", "GitHub rejected the request. Check the repository, fields, and account permissions.", 422);
    if (res.status === 422) throw new GitHubError("other", sourceText("GitHub kunne ikke utføre søket. Sjekk at du har tilgang til de valgte repoene."), 422);
    throw new GitHubError("other", `GitHub svarte med en feil (${res.status}).`, 502);
  }
}

async function readSample(response: Response, limit: number, tail = false) {
  let sample = Buffer.alloc(0);
  let truncated = false;
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sample = Buffer.concat([sample, value]);
      if (sample.length > limit) {
        truncated = true;
        sample = tail ? sample.subarray(-limit) : sample.subarray(0, limit);
        if (!tail) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  let text = sample.toString("utf8");
  if (tail && truncated) text = text.slice(text.indexOf("\n") + 1);
  return { text, truncated };
}

function credentialIdentity(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readLimited(res: Response): Promise<string> {
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE) {
    await res.body?.cancel().catch(() => undefined);
    throw new GitHubError("other", "Svaret fra GitHub var for stort.", 502);
  }
  const text = await res.text();
  if (text.length > MAX_RESPONSE) throw new GitHubError("other", "Svaret fra GitHub var for stort.", 502);
  return text;
}

// Only the fields the panel shows, and a link that is the repo's own page on GitHub, so nothing
// from the answer can point the browser panel somewhere else.
export const NOT_CONNECTED = sourceText("Koble til GitHub i Innstillinger for å se pull requests og issues.");

export function items(list: unknown, remote: Pick<GitHubRemote, "url">, kind: "pull" | "issues"): GitHubItem[] {
  if (!Array.isArray(list)) return [];
  const out: GitHubItem[] = [];
  for (const raw of list.slice(0, MAX_ITEMS)) {
    const number = Number(raw?.number);
    if (!Number.isInteger(number) || number <= 0) continue;
    out.push({
      number,
      title: typeof raw.title === "string" ? raw.title.slice(0, 300) : `#${number}`,
      url: `${remote.url}/${kind}/${number}`,
      author: typeof raw.user?.login === "string" ? raw.user.login.slice(0, 100) : null,
      createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
      updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : "",
      comments: Number(raw.comments) || 0,
      labels: Array.isArray(raw.labels)
        ? raw.labels.slice(0, 6).flatMap((l: any) => (typeof l?.name === "string" ? [{ name: l.name.slice(0, 50), color: /^[0-9a-f]{6}$/i.test(l.color) ? l.color : "888888" }] : []))
        : [],
      ...(kind === "pull" ? { draft: raw.draft === true, head: typeof raw.head?.ref === "string" ? raw.head.ref.slice(0, 200) : undefined } : {}),
    });
  }
  return out;
}
