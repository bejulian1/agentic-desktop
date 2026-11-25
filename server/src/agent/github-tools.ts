import { validPullReference } from "../../../shared/linked-pr.ts";
import { GitHub, GitHubError, parseGitHubUrl, readGitHubRemote } from "../github.ts";
import { checkGitHubConnectFolder, connectGitHubFolder, githubCloneTarget } from "../github-git.ts";
import { LOCAL_PANEL } from "../paths.ts";
import { effectiveMode } from "./permissions.ts";
import type { Tool, ToolContext } from "./tools.ts";

type Client = Awaited<ReturnType<GitHub["agentClient"]>>;
type Input = Record<string, unknown>;
type Property = { type: string; description?: string; enum?: readonly string[]; minimum?: number; maximum?: number; items?: Property };

const str = { type: "string" };
const bool = { type: "boolean" };
const repoField = { ...str, description: "GitHub owner/repo. Defaults to the project's GitHub remote." };
const numberField = { type: "integer", minimum: 1, maximum: 2_147_483_647 };
const limitField = { type: "integer", minimum: 1, maximum: 50, description: "Default 20." };
const pullStates = ["open", "closed", "merged", "all"] as const;
const issueStates = ["open", "closed", "all"] as const;
const methods = ["merge", "squash", "rebase"] as const;
const shaPattern = /^[0-9a-f]{40}$/i;

function text(value: unknown, field: string, max: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new Error(`Provide a valid ${field} of up to ${max} characters.`);
  }
  return value;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  return value === undefined || value === "" ? undefined : text(value, field, max);
}

function flag(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${field} must be true or false.`);
  return value;
}

function integer(value: unknown, field: string, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) throw new Error(`${field} must be an integer between 1 and ${max}.`);
  return value;
}

function choice<T extends string>(value: unknown, field: string, options: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !options.includes(value as T)) throw new Error(`${field} must be one of: ${options.join(", ")}.`);
  return value as T;
}

export function projectGitHubRepo(project: ToolContext["project"] | undefined): string | undefined {
  if (!project || project.id === LOCAL_PANEL) return;
  const { remote } = readGitHubRemote(project.path);
  const repo = remote && `${remote.owner}/${remote.repo}`;
  return repo && validPullReference(repo, 1) ? repo : undefined;
}

function repository(value: unknown, ctx: ToolContext, account = false): string {
  const repo = value === undefined ? projectGitHubRepo(ctx.project) ?? (account ? "@me" : undefined) : value;
  if (account && repo === "@me") return "@me";
  if (typeof repo !== "string" || !validPullReference(repo, 1)) throw new Error("Provide a GitHub repository as owner/repo when the project has no GitHub remote.");
  return repo;
}

function reference(input: Input, ctx: ToolContext) {
  return { repo: repository(input.repo, ctx), number: integer(input.number, "number", 2_147_483_647) };
}

function cloneRepo(value: unknown): string {
  const input = text(value, "repo", 300).trim();
  if (validPullReference(input, 1)) return input;
  const url = parseGitHubUrl(input);
  const repo = url && `${url.owner}/${url.repo}`;
  if (!repo || !validPullReference(repo, 1)) throw new Error("Provide a GitHub repository as owner/repo or a GitHub clone URL.");
  return repo;
}

function branch(value: unknown, field: string): string {
  const ref = text(value, field, 255);
  const branchName = field === "head" ? ref.replace(/^[a-z\d][a-z\d-]{0,38}:/i, "") : ref;
  if (/[\s\u0000-\u001f\u007f~^:?*\[\\]|\.\.|@\{/.test(branchName) || branchName === "@" ||
      branchName.startsWith("-") || branchName.endsWith(".") ||
      branchName.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    throw new Error(`Provide a valid GitHub branch name for ${field}.`);
  }
  return ref;
}

function resultText(value: unknown, client: Client, budget = 30_000): string {
  const json = client.redact(JSON.stringify(value));
  if (json.length <= budget) return json;
  // Keep the result valid JSON when a provider has a small context window. Details and lists
  // preserve their fields, while very large text fields or arrays can be sampled.
  const shrink = (data: unknown, ratio: number): unknown => {
    if (typeof data === "string" && data.length > 160) return data.slice(0, Math.max(120, Math.floor(data.length * ratio))) + "…";
    if (Array.isArray(data)) return data.slice(0, Math.max(1, Math.floor(data.length * ratio))).map(item => shrink(item, ratio));
    if (data && typeof data === "object") return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, shrink(item, ratio)]));
    return data;
  };
  const sample = client.redact(JSON.stringify({ truncated: true, data: shrink(value, budget / (json.length * 1.5)) }));
  return sample.length <= budget ? sample : JSON.stringify({ truncated: true, preview: json.slice(0, Math.max(0, Math.floor((budget - 50) / 3))) });
}

function tool<T extends Input>(name: string, description: string, properties: Record<string, Property>, required: string[],
  prepare: (input: Input, ctx: ToolContext) => T, summary: (input: T) => string,
  run: (input: T, ctx: ToolContext, client: Client) => Promise<unknown>, kind: Tool["kind"] = "read"): Tool {
  return {
    def: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
    kind,
    can: kind === "read" ? "inspect GitHub repositories, pull requests, issues and CI" : "create, clone, comment and merge through GitHub",
    prepare(input, ctx) {
      if (Object.keys(input).some(key => !(Object.hasOwn(properties, key)))) throw new Error("Remove fields that are outside the GitHub tool's schema.");
      return prepare(input, ctx);
    },
    summary: input => summary(input),
    ...(kind === "read" ? {} : {
      confirm: (input: T, ctx: ToolContext) => effectiveMode(ctx.project, ctx.thread) === "full" ? undefined : {
        title: summary(input),
        detail: JSON.stringify(input, null, 2),
      },
    }),
    async run(input: T, ctx) {
      const client = await ctx.github!.agentClient(ctx.signal, ctx.githubAllowed!);
      if (client.redact(JSON.stringify(input)) !== JSON.stringify(input)) throw new Error("Remove credentials from the GitHub tool arguments.");
      return { text: resultText(await run(input, ctx, client), client, ctx.maxResultChars) };
    },
  };
}

function rows(value: unknown): any[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
}

function string(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function repoResult(raw: any, web: string) {
  if (!validPullReference(raw?.full_name, 1)) throw new Error("GitHub did not return a valid repository name.");
  return {
    fullName: raw.full_name as string, private: raw.private === true, defaultBranch: string(raw.default_branch, 255),
    description: string(raw.description, 350), url: `${web}/${raw.full_name}`, updatedAt: string(raw.updated_at, 50),
  };
}

function itemResult(raw: any, repo: string, kind: "pull" | "issue", web: string) {
  if (!validPullReference(repo, raw?.number)) throw new Error("GitHub did not return a valid issue or pull request number.");
  return {
    repo, number: raw.number as number, title: string(raw.title, 256), author: string(raw.user?.login, 100),
    state: raw.merged_at || raw.pull_request?.merged_at || raw.merged === true ? "merged" : raw.state === "closed" ? "closed" : "open",
    url: `${web}/${repo}/${kind === "pull" ? "pull" : "issues"}/${raw.number}`, updatedAt: string(raw.updated_at, 50),
    ...(kind === "pull" && typeof raw.draft === "boolean" ? { draft: raw.draft } : {}),
  };
}

function comment(raw: any) {
  return { id: raw.id, author: string(raw.user?.login, 100), body: string(raw.body, 2000),
    createdAt: string(raw.submitted_at ?? raw.created_at, 50),
    ...(raw.state ? { state: string(raw.state, 50) } : {}),
    ...(raw.path ? { path: string(raw.path, 500), line: raw.line ?? raw.original_line ?? null, inReplyTo: raw.in_reply_to_id ?? null } : {}),
  };
}

const CHECKS_UNAVAILABLE = "GitHub did not provide check runs. Check the account's Checks read permission and whether this PR has a head commit.";
const failed = (conclusion: string | null) => ["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(conclusion ?? "");

async function checks(client: Client, repo: string, sha: string | null) {
  if (!sha || !shaPattern.test(sha)) return { total: null, runs: [], note: CHECKS_UNAVAILABLE };
  try {
    const checkData = await client.get(`/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100`);
    const runs = rows(checkData?.check_runs).map(run => {
      const url = string(run.details_url, 400);
      const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:actions\/runs\/\d+\/job|runs)\/([1-9]\d*)\/?(?:[?#].*)?$/i.exec(url ?? "");
      const id = Number(match?.[2]);
      return {
        name: string(run.name, 255), status: string(run.status, 50), conclusion: string(run.conclusion, 50),
        startedAt: string(run.started_at, 50), completedAt: string(run.completed_at, 50),
        jobId: run.app?.slug === "github-actions" && match?.[1].toLowerCase() === repo.toLowerCase() && Number.isSafeInteger(id) ? id : null,
      };
    });
    return { total: typeof checkData?.total_count === "number" ? checkData.total_count : runs.length, runs };
  } catch (error) {
    if (!(error instanceof GitHubError) || error.code !== "not-found") throw error;
    return { total: null, runs: [], note: CHECKS_UNAVAILABLE };
  }
}

const PR_THREADS = `query AgentPullThreads($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 20) {
        pageInfo { hasNextPage }
        nodes {
          path line isResolved isOutdated
          comments(first: 10) {
            pageInfo { hasNextPage }
            nodes { databaseId author { login } body createdAt }
          }
        }
      }
    }
  }
}`;

async function pullComments(client: Client, repo: string, number: number) {
  const base = `/repos/${repo}`;
  const [owner, name] = repo.split("/");
  const [comments, reviews, reviewData] = await Promise.all([
    client.get(`${base}/issues/${number}/comments?per_page=20`),
    client.get(`${base}/pulls/${number}/reviews?per_page=20`),
    client.query(PR_THREADS, { owner, name, number }).catch(error => {
      if (!(error instanceof GitHubError) || error.code !== "not-found") throw error;
      return null;
    }),
  ]);
  const threads = reviewData?.data?.repository?.pullRequest?.reviewThreads;
  const common = { comments: rows(comments).map(comment), reviews: rows(reviews).map(comment) };
  if (threads?.nodes) {
    return { ...common, reviewThreads: rows(threads.nodes).map(thread => ({
      path: string(thread.path, 500), line: thread.line, resolved: thread.isResolved, outdated: thread.isOutdated,
      comments: rows(thread.comments?.nodes).map(raw => comment({ ...raw, id: raw.databaseId, user: raw.author, created_at: raw.createdAt })),
      moreComments: thread.comments?.pageInfo?.hasNextPage === true,
    })), moreReviewThreads: threads.pageInfo?.hasNextPage === true };
  }
  const inline = rows(await client.get(`${base}/pulls/${number}/comments?per_page=20`)).map(comment);
  const grouped = new Map<number, ReturnType<typeof comment>[]>();
  for (const entry of inline) {
    const id = entry.inReplyTo ?? entry.id;
    const thread = grouped.get(id) ?? [];
    thread.push(entry);
    grouped.set(id, thread);
  }
  return { ...common, reviewThreads: [...grouped.values()].map(comments => ({
    path: comments[0].path, line: comments[0].line, resolved: null, comments,
  })) };
}

function list(kind: "pull" | "issue") {
  const states = kind === "pull" ? pullStates : issueStates;
  return tool(kind === "pull" ? "github_pr_list" : "github_issue_list",
    `List GitHub ${kind === "pull" ? "pull requests" : "issues"}. Use @me to list items involving the connected account across repositories.`,
    { repo: { ...repoField, description: "GitHub owner/repo or @me. Defaults to the project's remote, then @me." },
      state: { ...str, enum: states }, limit: limitField }, [],
    (input, ctx) => ({ repo: repository(input.repo, ctx, true), state: choice(input.state, "state", states, "open"), limit: integer(input.limit, "limit", 50, 20) }),
    ({ repo, state }) => `List ${state} GitHub ${kind === "pull" ? "pull requests" : "issues"} in ${repo}`,
    async ({ repo, state, limit }, ctx, client) => {
      const web = ctx.github!.web;
      if (repo !== "@me") {
        const endpoint = kind === "pull" ? "pulls" : "issues";
        const apiState = state === "merged" ? "closed" : state;
        const items = [];
        for (let page = 1; ; page++) {
          const result = await client.page(`/repos/${repo}/${endpoint}?state=${apiState}&sort=updated&direction=desc&per_page=100&page=${page}`);
          for (const raw of rows(result.body)) {
            if (kind === "issue" && raw.pull_request) continue;
            const item = itemResult(raw, repo, kind, web);
            if (state !== "all" && item.state !== state) continue;
            items.push(item);
            if (items.length === limit) return items;
          }
          if (!result.more) return items;
        }
      }
      const q = [kind === "pull" ? "is:pr" : "is:issue",
        `involves:${client.login ?? "@me"}`,
        ...(state === "all" ? [] : [`is:${state}`]),
        ...(kind === "pull" && state === "closed" ? ["is:unmerged"] : []),
      ].join(" ");
      const params = new URLSearchParams({ q, sort: "updated", order: "desc", per_page: String(limit), page: "1" });
      const result = await client.get(`/search/issues?${params}`);
      return rows(result?.items).slice(0, limit).map(raw => {
        const target = /\/repos\/([^/]+\/[^/]+)$/.exec(raw.repository_url ?? "")?.[1];
        if (!target) throw new Error("GitHub did not identify a repository for a search result.");
        return itemResult(raw, target, kind, web);
      });
    });
}

const repos = tool("github_repos", "List repositories the connected GitHub account can access. Optionally filter by name or description.",
  { query: str, limit: limitField }, [],
  input => ({ query: optionalText(input.query, "query", 200)?.trim().toLowerCase(), limit: integer(input.limit, "limit", 50, 20) }),
  () => "List GitHub repositories",
  async ({ query, limit }, ctx, client) => {
    const found = [];
    const pageSize = query ? 100 : limit;
    for (let page = 1; ; page++) {
      const result = await client.page(`/user/repos?sort=updated&direction=desc&per_page=${pageSize}&page=${page}`);
      for (const raw of rows(result.body)) {
        if (!query || `${raw.full_name} ${raw.description ?? ""}`.toLowerCase().includes(query)) found.push(repoResult(raw, ctx.github!.web));
        if (found.length === limit) return found;
      }
      if (!result.more) return found;
    }
  });

const readPr = tool("github_pr_read", "Read a pull request and its check runs. Optionally include the diff, comments and review threads.",
  { repo: repoField, number: numberField, includeDiff: bool, includeComments: bool }, ["number"],
  (input, ctx) => ({ ...reference(input, ctx), includeDiff: flag(input.includeDiff, "includeDiff"), includeComments: flag(input.includeComments, "includeComments") }),
  ({ repo, number }) => `Read pull request ${repo}#${number}`,
  async ({ repo, number, includeDiff, includeComments }, ctx, client) => {
    const route = `/repos/${repo}/pulls/${number}`;
    const raw = await client.get(route);
    const item = itemResult(raw, repo, "pull", ctx.github!.web);
    const headSha = string(raw.head?.sha, 64);
    const [status, discussion, diff] = await Promise.all([
      checks(client, repo, headSha), includeComments ? pullComments(client, repo, number) : {},
      includeDiff ? client.diff(route) : {},
    ]);
    return { ...item, body: string(raw.body, 6000), head: string(raw.head?.ref, 255), base: string(raw.base?.ref, 255), headSha,
      draft: raw.draft === true, mergeable: typeof raw.mergeable === "boolean" ? raw.mergeable : null,
      checks: { ...status, failed: status.runs.filter(run => failed(run.conclusion)).length,
        pending: status.runs.filter(run => run.status !== "completed").length,
        successful: status.runs.filter(run => run.conclusion === "success").length }, ...discussion, ...diff };
  });

const readIssue = tool("github_issue_read", "Read an issue, including its labels, assignees and comments.", { repo: repoField, number: numberField }, ["number"],
  reference, ({ repo, number }) => `Read issue ${repo}#${number}`,
  async ({ repo, number }, ctx, client) => {
    const route = `/repos/${repo}/issues/${number}`;
    const raw = await client.get(route);
    if (raw?.pull_request) throw new Error("This number is a pull request. Use github_pr_read.");
    return { ...itemResult(raw, repo, "issue", ctx.github!.web), body: string(raw.body, 6000),
      labels: rows(raw.labels).map(label => string(label.name, 100)), assignees: rows(raw.assignees).map(user => string(user.login, 100)),
      comments: rows(await client.get(`${route}/comments?per_page=20`)).map(comment) };
  });

const ciLogs = tool("github_ci_logs", "Read check statuses and tails of available GitHub Actions job logs for a pull request. Defaults to failed jobs, then the latest jobs.",
  { repo: repoField, number: numberField, check: str, tailLines: { type: "integer", minimum: 1, maximum: 200 } }, ["number"],
  (input, ctx) => ({ ...reference(input, ctx), check: optionalText(input.check, "check", 255)?.trim(), tailLines: integer(input.tailLines, "tailLines", 200, 50) }),
  ({ repo, number }) => `Read CI logs for ${repo}#${number}`,
  async ({ repo, number, check, tailLines }, _ctx, client) => {
    const pr = await client.get(`/repos/${repo}/pulls/${number}`);
    const headSha = string(pr?.head?.sha, 64);
    const status = await checks(client, repo, headSha);
    const latest = [...status.runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    const failures = latest.filter(run => failed(run.conclusion));
    const selected = check ? latest.filter(run => run.name?.toLowerCase() === check.toLowerCase()) : failures.length ? failures : latest;
    const logs = await Promise.all(selected.slice(0, 3).map(async run => {
      const log = run.jobId ? await client.logs(repo, run.jobId) : null;
      if (!log) return { check: run.name, log: null, note: "GitHub Actions logs are unavailable, expired, restricted, or hosted by a different CI provider." };
      const lines = log.text.trimEnd().split(/\r?\n/);
      const tail = lines.slice(-tailLines).join("\n");
      return { check: run.name, log: tail.slice(-6000), truncated: log.truncated || lines.length > tailLines || tail.length > 6000 };
    }));
    return { repo, number, headSha, checks: status.runs, totalChecks: status.total, logs,
      note: status.note ?? (!selected.length ? (check ? "No check with that name was found." : "No check runs were found for this commit.") : undefined) };
  });

const createRepo = tool("github_repo_create", "Create a GitHub repository owned by the connected account. Repositories are private by default.",
  { name: str, description: str, private: bool, connectCurrentFolder: bool }, ["name"],
  (input, ctx) => {
    const name = text(input.name, "name", 100);
    if (!validPullReference(`owner/${name}`, 1)) throw new Error("Use a valid GitHub repository name.");
    const connectCurrentFolder = flag(input.connectCurrentFolder, "connectCurrentFolder");
    if (connectCurrentFolder && ctx.project.id === LOCAL_PANEL) throw new Error("Select a project before connecting its folder to GitHub.");
    return { name, description: optionalText(input.description, "description", 350), private: flag(input.private, "private", true), connectCurrentFolder };
  },
  input => `Create ${input.private ? "private" : "public"} GitHub repository ${input.name}${input.connectCurrentFolder ? " and connect the project folder" : ""}`,
  async ({ name, description, private: isPrivate, connectCurrentFolder }, ctx, client) => {
    if (connectCurrentFolder) await checkGitHubConnectFolder(ctx.project.path, ctx.dataDir, ctx.signal);
    const raw = await client.post("/user/repos", { name, description, private: isPrivate });
    const created = repoResult(raw, ctx.github!.web);
    if (!connectCurrentFolder) return created;
    try {
      await connectGitHubFolder(ctx.project.path, ctx.dataDir, `https://github.com/${created.fullName}.git`, ctx.signal);
    } catch (error) {
      return { ...created, connected: false, connectionError: (error as Error).message };
    }
    ctx.filesChanged([".git/config"]);
    return { ...created, connected: true };
  }, "exec");

const cloneRepoTool: Tool = {
  ...tool("github_repo_clone", "Clone a GitHub repository into a new subfolder of the workspace.",
    { repo: { ...str, description: "GitHub owner/repo or clone URL." }, directory: str }, ["repo"],
    (input, ctx) => {
      const repo = cloneRepo(input.repo);
      const directory = text(input.directory, "directory", 1000, repo.split("/")[1]);
      return { repo, directory: githubCloneTarget(ctx.project.path, directory, ctx.dataDir).rel };
    },
    ({ repo, directory }) => `Clone ${repo} into ${directory}`,
    async ({ repo, directory }, ctx, client) => {
      const result = await client.clone(repo, ctx.project.path, directory, ctx.dataDir);
      ctx.filesChanged([result.directory]);
      return result;
    }, "exec"),
  path: input => input.directory,
};

const createPr = tool("github_pr_create", "Create a pull request from a branch already pushed to GitHub. The base defaults to the repository's default branch.",
  { repo: repoField, title: str, body: str, head: str, base: str, draft: bool }, ["title", "head"],
  (input, ctx) => ({
    repo: repository(input.repo, ctx), title: text(input.title, "title", 256), body: optionalText(input.body, "body", 65_536),
    head: branch(input.head, "head"), base: input.base === undefined ? undefined : branch(input.base, "base"), draft: flag(input.draft, "draft"),
  }),
  ({ repo, title, head, base, draft }) => `Open ${draft ? "a draft" : "a"} pull request in ${repo} from ${head} to ${base ?? "the default branch"} · ${title}`,
  async ({ repo, base, ...input }, ctx, client) => {
    const target = base ?? string((await client.get(`/repos/${repo}`))?.default_branch, 255);
    if (!target) throw new Error("GitHub did not return a default branch. Specify base explicitly.");
    const item = itemResult(await client.post(`/repos/${repo}/pulls`, { ...input, base: target }), repo, "pull", ctx.github!.web);
    const linked = ctx.linkPull?.({ repo, number: item.number, url: `https://github.com/${repo}/pull/${item.number}` }) ?? false;
    return { ...item, linked };
  }, "exec");

function postComment(kind: "pull" | "issue") {
  return tool(kind === "pull" ? "github_pr_comment" : "github_issue_comment", `Post a comment on a GitHub ${kind === "pull" ? "pull request" : "issue"}.`,
    { repo: repoField, number: numberField, body: str }, ["number", "body"],
    (input, ctx) => ({ ...reference(input, ctx), body: text(input.body, "body", 65_536) }),
    ({ repo, number }) => `Comment on ${kind === "pull" ? "pull request" : "issue"} ${repo}#${number}`,
    async ({ repo, number, body }, _ctx, client) => {
      const route = `/repos/${repo}/issues/${number}`;
      const target = await client.get(kind === "pull" ? `/repos/${repo}/pulls/${number}` : route);
      if (!validPullReference(repo, target?.number) || (kind === "issue" && target.pull_request)) {
        throw new Error(kind === "issue" ? "This number is a pull request. Use github_pr_comment." : "GitHub did not return a valid pull request.");
      }
      return { repo, number, comment: comment(await client.post(`${route}/comments`, { body })) };
    }, "exec");
}

const mergePr = tool("github_pr_merge", "Merge a pull request. Pass the reviewed head SHA to prevent merging a newer revision.",
  { repo: repoField, number: numberField, method: { ...str, enum: methods }, expectedHeadSha: str }, ["number"],
  (input, ctx) => {
    const expectedHeadSha = optionalText(input.expectedHeadSha, "expectedHeadSha", 40);
    if (input.expectedHeadSha !== undefined && (!expectedHeadSha || !shaPattern.test(expectedHeadSha))) throw new Error("expectedHeadSha must be a full 40-character commit SHA.");
    return { ...reference(input, ctx), method: choice(input.method, "method", methods, "merge"), expectedHeadSha };
  },
  ({ repo, number, method }) => `Merge pull request ${repo}#${number} using ${method}`,
  async ({ repo, number, method, expectedHeadSha }, _ctx, client) => {
    const raw = await client.put(`/repos/${repo}/pulls/${number}/merge`, { merge_method: method, sha: expectedHeadSha });
    return { repo, number, merged: raw?.merged === true, sha: string(raw?.sha, 64) };
  }, "exec");

const createIssue = tool("github_issue_create", "Create an issue in a GitHub repository.",
  { repo: repoField, title: str, body: str, labels: { type: "array", items: str } }, ["title"],
  (input, ctx) => {
    if (input.labels !== undefined && (!Array.isArray(input.labels) || input.labels.length > 50)) throw new Error("Provide up to 50 label names.");
    return { repo: repository(input.repo, ctx), title: text(input.title, "title", 256), body: optionalText(input.body, "body", 65_536),
      labels: (input.labels as unknown[] | undefined)?.map(label => text(label, "label", 100)) };
  },
  ({ repo, title }) => `Create issue in ${repo} · ${title}`,
  async ({ repo, ...input }, ctx, client) =>
    itemResult(await client.post(`/repos/${repo}/issues`, input), repo, "issue", ctx.github!.web), "exec");

export const GITHUB_TOOLS = [repos, list("pull"), readPr, list("issue"), readIssue, ciLogs,
  createRepo, cloneRepoTool, createPr, postComment("pull"), mergePr, createIssue, postComment("issue")];

export const GITHUB_TOOL_NAMES = new Set(GITHUB_TOOLS.map(tool => tool.def.name));
