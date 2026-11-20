// GitHub, read only (round 8, Beta). A personal access token is kept in the keyring next to the
// provider keys (secrets.ts), is sent only to the GitHub API, and never goes back to the browser.
// The repo comes from .git/config, read as a file: no git command is ever run.
//
// AD_GITHUB_API points the client at another API address, for the tests and their local fake
// server. Only a loopback address is accepted, so the variable can never send the token elsewhere.
import { closeSync, lstatSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import type { GitHubErrorCode, GitHubItem, GitHubProject, GitHubRemote, GitHubStatus, PullWatchStatus } from "../../shared/protocol.ts";
import type { Secrets } from "./secrets.ts";

export const GITHUB_SECRET = "integration:github";
const DEFAULT_API = "https://api.github.com";
const WEB = "https://github.com";
const TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;
const MAX_ITEMS = 30;
const MAX_CONFIG = 64 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;

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
  if (!file) return { remote: null, reason: "Prosjektmappen er ikke en git-mappe." };
  const text = readSmall(file, MAX_CONFIG);
  if (text === null) return { remote: null, reason: "Fant ikke .git/config, eller filen kunne ikke leses." };
  const remotes = parseRemotes(text);
  if (!remotes.length) return { remote: null, reason: "Git-mappen har ingen remote." };
  const ordered = [...remotes.filter((r) => r.name === "origin"), ...remotes.filter((r) => r.name !== "origin")];
  for (const candidate of ordered) {
    const found = parseGitHubUrl(candidate.url);
    if (found) return { remote: { ...found, remote: candidate.name, url: `${web}/${found.owner}/${found.repo}` } };
  }
  return { remote: null, reason: "Ingen remote peker til GitHub." };
}

// 2. The API

interface Cached {
  etag: string | null;
  body: unknown;
  at: number;
}

export class GitHub {
  private secrets: Secrets;
  private base: string;
  private web: string;
  private cache = new Map<string, Cached>();
  private account: GitHubStatus | null = null;

  constructor(secrets: Secrets, base = apiBase()) {
    this.secrets = secrets;
    this.base = base;
    // With a test server for the API, links go to the same server, so a test never opens github.com.
    this.web = base === DEFAULT_API ? WEB : new URL(base).origin;
  }

  private token(): string | undefined {
    return this.secrets.get(GITHUB_SECRET);
  }

  // Connected means a token is stored. The account name comes from the last successful check.
  status(): GitHubStatus {
    if (!this.token()) return { connected: false };
    return this.account ?? { connected: true };
  }

  // After a restart the account name is not known yet: ask GitHub once. A failure is not an error
  // here; the panel says what is wrong when it loads the repo.
  async check(): Promise<GitHubStatus> {
    const token = this.token();
    if (token && !this.account) await this.loadAccount(token).catch(() => undefined);
    return this.status();
  }

  async connect(token: unknown): Promise<GitHubStatus> {
    const trimmed = typeof token === "string" ? token.trim() : token;
    if (!plausibleToken(trimmed)) throw new GitHubError("bad-token", "Det ser ikke ut som et GitHub-token. Lim inn hele tokenet, uten mellomrom.", 400);
    const { body, headers } = await this.request("/user", trimmed, false);
    const user = body as { login?: unknown; name?: unknown };
    if (typeof user.login !== "string") throw new GitHubError("other", "GitHub svarte uten et brukernavn.", 502);
    await this.secrets.set(GITHUB_SECRET, trimmed);
    this.cache.clear();
    this.account = { connected: true, login: user.login, name: typeof user.name === "string" ? user.name : null, scopes: headers.get("x-oauth-scopes") };
    return this.account;
  }

  async disconnect(): Promise<GitHubStatus> {
    await this.secrets.set(GITHUB_SECRET, null);
    this.cache.clear();
    this.account = null;
    return { connected: false };
  }

  // Remote, repo, open pull requests and issues. Errors from GitHub are part of the answer, so the
  // panel can still show the repo it found in .git/config.
  async project(root: string, refresh = false): Promise<GitHubProject> {
    const { remote, reason } = readGitHubRemote(root, this.web);
    const out: GitHubProject = { remote, reason, status: this.status() };
    if (!remote) return out;
    const token = this.token();
    if (!token) {
      out.error = { code: "not-connected", message: "Koble til GitHub i Innstillinger for å se pull requests og issues." };
      return out;
    }
    const base = `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}`;
    try {
      if (!this.account) await this.loadAccount(token);
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
    const [owner, name, extra] = repo.split("/");
    if (extra !== undefined || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(owner) ||
        !NAME.test(name ?? "") || name === "." || name === ".." ||
        !Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) {
      throw new GitHubError("other", "Bruk et gyldig GitHub-repo og PR-nummer.", 400);
    }
    const token = this.token();
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

  private async loadAccount(token: string): Promise<void> {
    const { body, headers } = await this.request("/user", token, true);
    const user = body as { login?: unknown; name?: unknown };
    if (typeof user.login === "string") this.account = { connected: true, login: user.login, name: typeof user.name === "string" ? user.name : null, scopes: headers.get("x-oauth-scopes") };
  }

  // A conditional request with the last ETag: GitHub answers 304, which does not count against the
  // rate limit. Within CACHE_MS the cached answer is used without asking at all.
  private async cached(pathAndQuery: string, token: string, refresh: boolean): Promise<unknown> {
    const hit = this.cache.get(pathAndQuery);
    if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return hit.body;
    const { body, headers, notModified } = await this.request(pathAndQuery, token, true, hit?.etag ?? undefined);
    const value = notModified && hit ? hit.body : body;
    this.cache.set(pathAndQuery, { etag: headers.get("etag"), body: value, at: Date.now() });
    return value;
  }

  private async request(pathAndQuery: string, token: string, stored: boolean, etag?: string, query?: string): Promise<{ body: unknown; headers: Headers; notModified: boolean }> {
    let res: Response;
    try {
      res = await fetch(this.base + pathAndQuery, {
        ...(query === undefined ? {} : { method: "POST", body: query }),
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "Agentic-Desktop",
          "x-github-api-version": "2022-11-28",
          ...(etag ? { "if-none-match": etag } : {}),
          ...(query === undefined ? {} : { "content-type": "application/json" }),
        },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = (err as Error).name === "TimeoutError";
      throw new GitHubError("offline", timeout ? "GitHub svarte ikke innen 10 sekunder. Prøv igjen om litt." : "Fikk ikke kontakt med GitHub. Sjekk nettverket.", 502);
    }
    if (res.status === 304) return { body: null, headers: res.headers, notModified: true };
    const text = await readLimited(res);
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.ok) return { body, headers: res.headers, notModified: false };
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
    throw new GitHubError("other", `GitHub svarte med en feil (${res.status}).`, 502);
  }
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
function items(list: unknown, remote: GitHubRemote, kind: "pull" | "issues"): GitHubItem[] {
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
