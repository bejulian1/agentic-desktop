import { sourceText } from "../../shared/i18n.ts";
import type {
  GitHubComment, GitHubDetail, GitHubFile, GitHubFilters, GitHubItem, GitHubKind, GitHubPage,
  GitHubReference, GitHubRow, GitHubScope, GitHubView, Project,
} from "../../shared/protocol.ts";
import { GitHub, GitHubError, items, readGitHubRemote } from "./github.ts";

const PER_PAGE = 25;
const REPOS_PER_SEARCH = 8;
const REPO = /^[a-z\d][a-z\d-]{0,38}\/(?!\.{1,2}$)[a-z\d_.-]{1,100}$/i;
const DEFAULTS: GitHubFilters = { search: "", sort: "updated", state: "open", involvement: "any", label: "", projectId: "" };
const SORT = { updated: "updated", newest: "created", oldest: "created", comments: "comments" } as const;
const QUALIFIER = { author: "author", assignee: "assignee", mentions: "mentions", "review-requested": "review-requested" } as const;
type Reader = Awaited<ReturnType<GitHub["reader"]>>;

function invalid(): never {
  throw new GitHubError("other", sourceText("Ugyldige GitHub-filtre eller sidevalg."), 400);
}

function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return invalid();
  return value as T;
}

function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) return invalid();
  return value.trim();
}

export function githubFilters(input: unknown, kind: GitHubKind): GitHubFilters {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const f = { ...DEFAULTS, ...input };
  return {
    sort: choice(f.sort, ["updated", "newest", "oldest", "comments"]),
    state: choice(f.state, kind === "pull" ? ["open", "closed", "merged", "all"] : ["open", "closed", "all"]),
    involvement: choice(f.involvement, kind === "pull" ? ["any", "author", "assignee", "mentions", "review-requested"] : ["any", "author", "assignee", "mentions"]),
    search: string(f.search, 200),
    label: string(f.label, 50),
    projectId: string(f.projectId, 100),
  };
}

export function githubViews(input: unknown): GitHubView[] {
  if (!Array.isArray(input) || input.length > 50) return invalid();
  const ids = new Set<string>();
  return input.map(view => {
    if (!view || typeof view !== "object") return invalid();
    const kind = githubKind(view.kind);
    const id = string(view.id, 100);
    const name = string(view.name, 80);
    if (!id || !name || ids.has(id)) return invalid();
    ids.add(id);
    return { id, name, kind, filters: githubFilters(view.filters, kind) };
  });
}

export function githubKind(kind: unknown): GitHubKind {
  return choice(kind, ["pull", "issues"]);
}

export function githubReference(kind: unknown, repo: string | null, n: string | null): GitHubReference {
  const number = Number(n);
  if (!repo || !REPO.test(repo) || !n || !/^[1-9]\d{0,9}$/.test(n) || number > 2_147_483_647) {
    throw new GitHubError("other", sourceText("Bruk et gyldig GitHub-repo og nummer."), 400);
  }
  return { repo, number, kind: githubKind(kind) };
}

export function githubScopes(projects: Project[], web: string): GitHubScope[] {
  return projects.flatMap(project => {
    const { remote } = readGitHubRemote(project.path, web);
    if (!remote) return [];
    const repo = `${remote.owner}/${remote.repo}`.toLowerCase();
    return REPO.test(repo) ? [{ id: project.id, name: project.name, repo }] : [];
  });
}

function projectRepos(scopes: GitHubScope[], projectId: string): string[] {
  return [...new Set(scopes.filter(project => !projectId || project.id === projectId).map(project => project.repo))].sort();
}

function sourceGroups<T>(inputs: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let at = 0; at < inputs.length; at += size) groups.push(inputs.slice(at, at + size));
  return groups;
}

// Each offset counts rows consumed in one sorted source. When a source runs out of rows,
// refill it before choosing the next result so the order is global across all repos.
async function mergePage<T>(
  count: number, cursor: string | null, compare: (a: T, b: T) => number,
  fetch: (source: number, page: number) => Promise<{ rows: T[]; more: boolean }>,
): Promise<GitHubPage<T>> {
  const offsets = cursor === null ? Array<number>(count).fill(0) : cursor.split(",").map(part => /^-?\d{1,6}$/.test(part) ? Number(part) : NaN);
  if (offsets.length !== count || offsets.some(n => !Number.isInteger(n) || n < -1)) return invalid();
  const pages: Array<{ rows: T[]; more: boolean }> = [];
  for (let index = 0; index < count; index++) {
    const offset = offsets[index];
    pages.push(offset === -1 ? { rows: [], more: false } : await fetch(index, Math.floor(offset / PER_PAGE) + 1));
  }
  const rows: T[] = [];
  while (rows.length < PER_PAGE) {
    let next: T | undefined;
    let from = -1;
    for (let index = 0; index < pages.length; index++) {
      if (offsets[index] === -1) continue;
      const page = pages[index];
      const row = page.rows[offsets[index] % PER_PAGE];
      if (!row) {
        offsets[index] = -1;
        continue;
      }
      if (from === -1 || compare(row, next!) < 0) {
        next = row;
        from = index;
      }
    }
    if (from < 0) break;
    rows.push(next!);
    const offset = ++offsets[from];
    if ((offset - 1) % PER_PAGE + 1 === pages[from].rows.length) {
      if (!pages[from].more) offsets[from] = -1;
      else if (rows.length < PER_PAGE) pages[from] = await fetch(from, offset / PER_PAGE + 1);
    }
  }
  return { items: rows, next: offsets.some(n => n !== -1) ? offsets.join(",") : null };
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, limit = 64 * 1024): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function avatar(raw: any): number | null {
  const id = raw?.id;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function row(raw: any, repo: string, kind: GitHubKind, web: string): GitHubRow | undefined {
  const [item] = items([raw], { url: `${web}/${repo}` }, kind);
  if (!item) return;
  const state = raw.merged_at || raw.pull_request?.merged_at ? "merged" : raw.state === "closed" ? "closed" : raw.draft ? "draft" : "open";
  return { ...item, labels: labels(raw.labels), repo, kind, state, avatarId: avatar(raw.user), checks: null };
}

function compareRows(sort: GitHubFilters["sort"]) {
  return (a: GitHubRow, b: GitHubRow): number => {
    if (sort === "comments") return b.comments - a.comments;
    if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
    const order = a.createdAt.localeCompare(b.createdAt);
    return sort === "oldest" ? order : -order;
  };
}

function quote(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

function labels(raw: unknown): GitHubItem["labels"] {
  return asArray(raw).flatMap(label => typeof label?.name === "string"
    ? [{ name: label.name.slice(0, 50), color: /^[0-9a-f]{6}$/i.test(label.color) ? label.color : "888888" }]
    : []);
}

const ROLLUP = "isDraft merged statusCheckRollup { state }";
const CHECKS = `reviewDecision statusCheckRollup {
  state contexts(first: 100) { nodes {
    ... on CheckRun { name status conclusion }
    ... on StatusContext { context state }
  } }
}`;

function checkState(value: unknown): GitHubRow["checks"] {
  switch (value) {
    case "SUCCESS": case "PENDING": case "EXPECTED": case "FAILURE": case "ERROR": return value;
    default: return null;
  }
}

function reviewState(value: unknown): NonNullable<GitHubDetail["pull"]>["review"] {
  return value === "APPROVED" || value === "CHANGES_REQUESTED" || value === "REVIEW_REQUIRED" ? value : null;
}

async function graphql(reader: Reader, query: string): Promise<Record<string, any>> {
  const body = await reader.query(query) as any;
  return body?.data ?? {};
}

async function hydratePulls(reader: Reader, rows: GitHubRow[]): Promise<void> {
  if (!rows.length) return;
  const byRepo = new Map<string, number[]>();
  rows.forEach(({ repo }, i) => {
    const indices = byRepo.get(repo) ?? [];
    indices.push(i);
    byRepo.set(repo, indices);
  });
  const repos = [...byRepo.entries()];
  const fields = repos.map(([repo, indices], i) => {
    const [owner, name] = repo.split("/");
    return `r${i}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
      ${indices.map(index => `p${index}:pullRequest(number:${rows[index].number}) { ${ROLLUP} }`).join("\n")}
    }`;
  });
  const result = await graphql(reader, `query PullList { ${fields.join("\n")} }`);
  repos.forEach(([, indices], i) => indices.forEach(index => {
    const pull = result[`r${i}`]?.[`p${index}`];
    if (!pull) return;
    const item = rows[index];
    item.checks = checkState(pull.statusCheckRollup?.state);
    item.state = pull.merged ? "merged" : item.state === "closed" ? "closed" : pull.isDraft ? "draft" : "open";
  }));
}

function missing(error: unknown): boolean {
  return error instanceof GitHubError && error.code === "not-found";
}

function requiredData(raw: any, repo: string, kind: GitHubKind, web: string): GitHubRow {
  const item = row(raw, repo, kind, web);
  if (!item || (kind === "issues" && raw.pull_request)) {
    throw new GitHubError("not-found", sourceText("Fant ikke denne pull requesten eller issuen på GitHub."), 404);
  }
  return item;
}

// Search does not index the item number as a qualifier. For an exact #number, read that
// endpoint in each requested repo and apply the same filters before sorting.
async function numbered(reader: Reader, repo: string, kind: GitHubKind, number: number, filters: GitHubFilters, web: string) {
  const base = `/repos/${repo}`;
  const raw = await reader.get(`${base}/${kind === "pull" ? "pulls" : "issues"}/${number}`).catch(error => {
    if (!missing(error)) throw error;
  }) as any;
  if (!raw || (kind === "issues" && raw.pull_request)) return;
  const item = row(raw, repo, kind, web);
  if (!item) return;
  if (filters.state === "open" && !["open", "draft"].includes(item.state)) return;
  if (filters.state === "closed" && item.state !== "closed") return;
  if (filters.state === "merged" && item.state !== "merged") return;
  if (filters.label && !item.labels.some(label => label.name.toLowerCase() === filters.label.toLowerCase())) return;
  const login = reader.login?.toLowerCase();
  const byMe = (user: any) => login && text(user?.login, 100).toLowerCase() === login;
  if (filters.involvement === "author" && !byMe(raw.user)) return;
  if (filters.involvement === "assignee" && !asArray(raw.assignees).some(byMe)) return;
  if (filters.involvement === "review-requested" && !asArray(raw.requested_reviewers).some(byMe)) return;
  if (filters.involvement === "mentions") {
    if (!login) return;
    const mention = (body: unknown) => [...text(body).matchAll(/(?:^|[^\w@])@([\w-]+)/g)].some(match => match[1].toLowerCase() === login);
    let seen = mention(raw.body);
    for (let page = 1; !seen && page <= Math.ceil(item.comments / 100); page++) {
      const comments = asArray(await reader.get(`${base}/issues/${number}/comments?per_page=100&page=${page}`));
      seen = comments.some(comment => mention(comment.body));
    }
    if (!seen) return;
  }
  return item;
}

export async function githubList(github: GitHub, scopes: GitHubScope[], kind: GitHubKind, filters: GitHubFilters, cursor: string | null, refresh: boolean): Promise<GitHubPage<GitHubRow>> {
  const repos = projectRepos(scopes, filters.projectId);
  if (!repos.length) return { items: [], next: null };
  const reader = await github.reader(refresh);
  const number = /^#?([1-9]\d{0,9})$/.exec(filters.search)?.[1];
  if (number && Number(number) <= 2_147_483_647) {
    const matches: GitHubRow[] = [];
    for (const group of sourceGroups(repos, REPOS_PER_SEARCH)) {
      const rows = await Promise.all(group.map(repo => numbered(reader, repo, kind, Number(number), filters, github.web)));
      for (const item of rows) if (item) matches.push(item);
    }
    matches.sort(compareRows(filters.sort));
    const page = await mergePage(1, cursor, compareRows(filters.sort), async (_, page) => ({
      rows: matches.slice((page - 1) * PER_PAGE, page * PER_PAGE),
      more: matches.length > page * PER_PAGE,
    }));
    if (kind === "pull") await hydratePulls(reader, page.items);
    return page;
  }

  const groups = sourceGroups(repos, REPOS_PER_SEARCH);
  const parts = [kind === "pull" ? "is:pr" : "is:issue"];
  if (filters.state !== "all") parts.push(`is:${filters.state}`);
  if (kind === "pull" && filters.state === "closed") parts.push("is:unmerged");
  if (filters.label) parts.push(`label:${quote(filters.label)}`);
  if (filters.involvement !== "any") {
    if (!reader.login) return { items: [], next: null };
    parts.push(`${QUALIFIER[filters.involvement]}:${reader.login}`);
  }
  if (filters.search) {
    // Quote literal words individually so arbitrary input cannot inject GitHub qualifiers.
    parts.push(...filters.search.split(/\s+/u).map(quote), "in:title,body");
  }
  const page = await mergePage(groups.length, cursor, compareRows(filters.sort), async (source, page) => {
    if ((page - 1) * PER_PAGE >= 1000) return { rows: [], more: false };
    const group = groups[source];
    const params = new URLSearchParams({
      q: [...parts, ...group.map(repo => `repo:${repo}`)].join(" "),
      sort: SORT[filters.sort], order: filters.sort === "oldest" ? "asc" : "desc",
      per_page: String(PER_PAGE), page: String(page),
    });
    const result = await reader.get(`/search/issues?${params}`) as any;
    const rows = asArray(result?.items).map(raw => {
      const repo = /\/repos\/([^/]+\/[^/]+)$/.exec(text(raw.repository_url, 500))?.[1].toLowerCase();
      if (!repo || !group.includes(repo)) throw new GitHubError("other", sourceText("GitHub svarte med et uventet søkeresultat."), 502);
      return requiredData(raw, repo, kind, github.web);
    });
    return { rows, more: rows.length === PER_PAGE && Math.min(Number(result?.total_count), 1000) > page * PER_PAGE };
  });
  if (kind === "pull") await hydratePulls(reader, page.items);
  return page;
}

export async function githubLabels(github: GitHub, scopes: GitHubScope[], projectId: string, refresh: boolean): Promise<GitHubItem["labels"]> {
  const repos = projectRepos(scopes, projectId);
  if (!repos.length) return [];
  const reader = await github.reader(refresh);
  const result = new Map<string, GitHubItem["labels"][number]>();
  for (const group of sourceGroups(repos, REPOS_PER_SEARCH)) {
    const all = await Promise.all(group.map(async repo => {
      const out: GitHubItem["labels"] = [];
      for (let page = 1; ; page++) {
        const raw = asArray(await reader.get(`/repos/${repo}/labels?per_page=100&page=${page}`).catch(error => {
          if (!missing(error)) throw error;
        }));
        out.push(...labels(raw));
        if (raw.length < 100) return out;
      }
    }));
    for (const label of all.flat()) result.set(label.name.toLowerCase(), label);
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function githubDetail(github: GitHub, ref: GitHubReference, scopes: GitHubScope[], refresh: boolean): Promise<GitHubDetail> {
  const reader = await github.reader(refresh);
  const { repo, kind, number } = ref;
  const raw = await reader.get(`/repos/${repo}/${kind === "pull" ? "pulls" : "issues"}/${number}`) as any;
  const item = requiredData(raw, repo, kind, github.web);
  const detail: GitHubDetail = {
    ...item, projectIds: scopes.filter(scope => scope.repo === repo.toLowerCase()).map(scope => scope.id),
    assignees: asArray(raw.assignees).map(user => text(user?.login, 100)).filter(Boolean), body: text(raw.body),
  };
  if (kind === "pull") {
    const [owner, name] = repo.split("/");
    const result = await graphql(reader, `query PullDetail {
      repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
        pullRequest(number:${number}) { ${CHECKS} }
      }
    }`);
    const pull = result.repository?.pullRequest;
    detail.checks = checkState(pull?.statusCheckRollup?.state);
    detail.pull = {
      base: text(raw.base?.ref, 255), head: text(raw.head?.ref, 255), review: reviewState(pull?.reviewDecision),
      checks: asArray(pull?.statusCheckRollup?.contexts?.nodes).flatMap(check => {
        const name = text(check?.name ?? check?.context, 255);
        const status = text(check?.conclusion || check?.status || check?.state, 50);
        return name && status ? [{ name, status }] : [];
      }),
    };
  }
  return detail;
}

export async function githubComments(github: GitHub, ref: GitHubReference, cursor: string | null, refresh: boolean): Promise<GitHubPage<GitHubComment>> {
  const reader = await github.reader(refresh);
  const base = `/repos/${ref.repo}`;
  const paths = [`${base}/issues/${ref.number}/comments`];
  if (ref.kind === "pull") paths.push(`${base}/pulls/${ref.number}/reviews`, `${base}/pulls/${ref.number}/comments`);
  return mergePage(paths.length, cursor, (a, b) => a.createdAt.localeCompare(b.createdAt), async (source, page) => {
    const raw = asArray(await reader.get(`${paths[source]}?per_page=${PER_PAGE}&page=${page}`));
    return {
      rows: raw.map(comment => ({
        id: `${source}:${comment.id}`, author: text(comment.user?.login, 100) || null, avatarId: avatar(comment.user),
        createdAt: text(comment.submitted_at ?? comment.created_at, 50), body: text(comment.body),
        ...(comment.state ? { review: text(comment.state, 50) } : {}), ...(comment.path ? { path: text(comment.path, 1024) } : {}),
      })),
      more: raw.length === PER_PAGE,
    };
  });
}

export async function githubFiles(github: GitHub, ref: GitHubReference, cursor: string | null, refresh: boolean): Promise<GitHubPage<GitHubFile>> {
  if (ref.kind !== "pull") return invalid();
  const reader = await github.reader(refresh);
  const page = cursor === null ? 1 : Number(cursor);
  if (!Number.isInteger(page) || page < 1 || page > 120) return invalid();
  const raw = asArray(await reader.get(`/repos/${ref.repo}/pulls/${ref.number}/files?per_page=${PER_PAGE}&page=${page}`));
  return {
    items: raw.map(file => ({
      name: text(file.filename, 1024), previousName: text(file.previous_filename, 1024) || undefined,
      additions: Number(file.additions) || 0, deletions: Number(file.deletions) || 0,
      patch: text(file.patch, 100_000) || null,
    })),
    next: page < 120 && raw.length === PER_PAGE ? String(page + 1) : null,
  };
}
