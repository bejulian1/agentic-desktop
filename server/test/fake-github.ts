// A local stand-in for the GitHub API, for server/test/github.test.ts and the UI test 28. It knows
// one token, one repo (acme/rakett), a private repo it pretends not to find, and a few modes for
// the failures the app must handle. Nothing here ever talks to github.com.
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

export const GOOD_TOKEN = "ghp_" + "test0123456789abcdefABCDEF0123456789";
export const OTHER_TOKEN = "github_" + "pat_test_0000000000000000000000";

export function fakeGh(dir: string, signedIn = true): { path: string; signIn: () => void } {
  mkdirSync(dir, { recursive: true });
  const signIn = () => writeFileSync(path.join(dir, "signed-in"), "");
  if (signedIn) signIn();
  writeFileSync(path.join(dir, "gh"), `#!/bin/sh
case "$*" in
  'auth status --hostname github.com')
    if [ ! -f "${"$"}{0%/*}/signed-in" ]; then
      printf 'You are not logged into any GitHub hosts.\n' >&2
      exit 1
    fi
    printf 'github.com\n  Logged in to github.com account testbruker (test)\n  - Active account: true\n' >&2
    ;;
  'auth token --hostname github.com')
    [ -f "${"$"}{0%/*}/signed-in" ] || exit 1
    printf '%s%s\n' 'ghp_' 'test0123456789abcdefABCDEF0123456789'
    ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });
  return { path: `${dir}:${process.env.PATH}`, signIn };
}

export type FakeMode = "ok" | "rate-limit" | "offline" | "revoked" | "slow";

export interface FakeGitHub {
  url: string;
  requests: Array<{ path: string; auth: string | undefined; ifNoneMatch: string | undefined }>;
  setMode: (mode: FakeMode) => void;
  close: () => Promise<void>;
}

const now = Date.parse("2026-11-04T10:00:00Z");
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const PULLS = [
  { number: 42, title: "Rask oppstart: last CodeMirror først når editoren åpnes 🚀", user: { login: "kari" }, created_at: iso(300), updated_at: iso(5), comments: 3, draft: false, head: { ref: "rask-oppstart" }, labels: [{ name: "ytelse", color: "0e8a16" }], html_url: "https://evil.example/phish" },
  { number: 41, title: "Utkast: tema med høy kontrast og en svært lang tittel som ikke får plass på én linje i et smalt panel i det hele tatt", user: { login: "ola" }, created_at: iso(3000), updated_at: iso(600), comments: 0, draft: true, head: { ref: "tema" }, labels: [] },
];

const ISSUES = [
  { number: 40, title: "Æ, ø og å i filnavn vises feil", body: "**Unicode** i filnavn.\n\n<script>document.body.dataset.unsafe = true</script>", user: { login: "lise", id: 123 }, assignees: [{ login: "testbruker" }], created_at: iso(5000), updated_at: iso(60), comments: 12, labels: [{ name: "feil", color: "d73a4a" }, { name: "god første oppgave", color: "7057ff" }] },
  { number: 42, title: "Rask oppstart", user: { login: "kari" }, created_at: iso(300), updated_at: iso(5), comments: 3, labels: [], pull_request: { url: "x" } },
  { number: 39, title: "Frakobling gir ingen melding", user: null, created_at: iso(9000), updated_at: iso(2000), comments: 1, labels: [{ name: "ux", color: "not-a-colour" }] },
];

const ATLAS_ISSUES = Array.from({ length: 29 }, (_, i) => ({
  number: 100 - i, title: `Kartoppgave ${100 - i}`, body: "", user: { login: "testbruker" },
  created_at: iso(10_000 + i), updated_at: iso(100 + i), comments: 0, labels: [],
}));

const CHECKS = { state: "PENDING", contexts: { nodes: [{ name: "Typecheck", status: "COMPLETED", conclusion: "SUCCESS" }, { context: "UI", state: "PENDING" }] } };

export async function startFakeGitHub(): Promise<FakeGitHub> {
  let mode: FakeMode = "ok";
  const requests: FakeGitHub["requests"] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const auth = req.headers.authorization;
    const ifNoneMatch = req.headers["if-none-match"] as string | undefined;
    requests.push({ path: url.pathname + url.search, auth, ifNoneMatch });
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };

    // The pages the links point to, so a test that clicks one stays on this server.
    if (url.pathname === "/u/123") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1H0AAAAASUVORK5CYII=", "base64"));
      return;
    }
    if (!url.pathname.startsWith("/user") && !url.pathname.startsWith("/repos/") && !["/graphql", "/search/issues"].includes(url.pathname)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Falsk GitHub</title><h1>Falsk side: ${url.pathname.replace(/[<>&]/g, "")}</h1>`);
      return;
    }
    if (mode === "offline") return void req.socket.destroy();
    if (mode === "rate-limit") {
      return send(403, { message: "API rate limit exceeded for user." }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 25 * 60) });
    }
    const good = auth === `Bearer ${GOOD_TOKEN}` || auth === `Bearer ${OTHER_TOKEN}`;
    if (!good || mode === "revoked") return send(401, { message: "Bad credentials" });
    if (req.method === "POST" && url.pathname === "/graphql") {
      let payload = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { payload += chunk; });
      req.on("end", () => {
        const { query, variables } = JSON.parse(payload);
        if (query.startsWith("query PullList")) {
          const pulls = Object.fromEntries([...query.matchAll(/(p\d+):pullRequest\(number:(\d+)\)/g)].map(([, alias, number]) => [
            alias, { merged: number === "38", isDraft: number === "41", statusCheckRollup: number === "42" ? CHECKS : null },
          ]));
          return send(200, { data: { r0: pulls } });
        }
        if (query.startsWith("query PullDetail")) return send(200, { data: { repository: { pullRequest: { reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: CHECKS } } } });
        if (!query.startsWith("query PullWatch(") || variables.owner !== "acme" || variables.name !== "rakett") {
          return send(200, { errors: [{ type: "NOT_FOUND" }] });
        }
        if (variables.number === 44) return send(200, { errors: [{ type: "RATE_LIMITED" }] }, { "x-ratelimit-reset": "2000000000" });
        const pullRequest = variables.number === 42 ? {
          title: PULLS[0].title, state: "OPEN", isDraft: false, headRefOid: "a".repeat(40),
          reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: { state: "PENDING" },
        } : null;
        send(200, { data: { repository: { pullRequest } } });
      });
      return;
    }
    const reply = () => {
      if (url.pathname === "/user") return send(200, { login: auth === `Bearer ${GOOD_TOKEN}` ? "testbruker" : "annen", name: "Test Brukersen" }, { "x-oauth-scopes": "repo, read:org" });
      if (url.pathname === "/search/issues") {
        const q = url.searchParams.get("q") ?? "";
        const isPull = q.includes("is:pr");
        const groups = [...q.matchAll(/repo:(\S+)/g)].map(match => match[1]);
        const query = q.replace(/(?:repo|is|in|author|assignee|mentions|review-requested):\S+/g, "").replace(/label:"[^"]+"/g, "").replace(/"/g, "").trim();
        const label = /label:"([^"]+)"/.exec(q)?.[1];
        const merged = { ...PULLS[0], number: 38, title: "Slått sammen", state: "closed", pull_request: { merged_at: iso(60) } };
        const rows = groups.flatMap(repo => {
          const all = repo === "acme/atlas" ? (isPull ? [] : ATLAS_ISSUES) : repo === "acme/rakett" ? (isPull ? [...PULLS, merged] : ISSUES.filter(issue => !issue.pull_request)) : [];
          return all.map(item => ({ state: "open", ...item, repository_url: `https://api.github.com/repos/${repo}` }));
        }).filter((item: any) => (
          (!q.includes("is:open") || item.state === "open") &&
          (!q.includes("is:closed") || item.state === "closed") &&
          (!q.includes("is:merged") || item.pull_request?.merged_at) &&
          (!q.includes("is:unmerged") || !item.pull_request?.merged_at) &&
          (!q.includes("assignee:") || item.assignees?.some((user: any) => user.login === "testbruker")) &&
          (!q.includes("author:") || item.user?.login === "testbruker") &&
          (!q.includes("mentions:") || item.number === 40) &&
          (!q.includes("review-requested:") || item.number === 42) &&
          (!label || item.labels.some((l: any) => l.name === label)) &&
          (!query || query.split(/\s+/).every(word => `${item.title} ${item.body ?? ""}`.toLowerCase().includes(word.toLowerCase())))
        ));
        const sort = url.searchParams.get("sort");
        rows.sort((a, b) => sort === "comments" ? b.comments - a.comments : sort === "created"
          ? a.created_at.localeCompare(b.created_at) * (url.searchParams.get("order") === "asc" ? 1 : -1)
          : b.updated_at.localeCompare(a.updated_at));
        const size = Number(url.searchParams.get("per_page"));
        const start = (Number(url.searchParams.get("page")) - 1) * size;
        return send(200, { total_count: rows.length, items: rows.slice(start, start + size) });
      }
      if (url.pathname === "/repos/acme/rakett") {
        const etag = '"rakett-v1"';
        if (ifNoneMatch === etag) return send(304, undefined, { etag });
        return send(200, { full_name: "acme/rakett", description: "En rakett av en app ✨", private: false, default_branch: "main", stargazers_count: 1234 }, { etag });
      }
      if (url.pathname === "/repos/acme/rakett/pulls") return send(200, PULLS, { etag: '"pulls-v1"' });
      if (url.pathname === "/repos/acme/rakett/issues") return send(200, ISSUES, { etag: '"issues-v1"' });
      if (url.pathname === "/repos/acme/rakett/labels") return send(200, [...PULLS[0].labels, ...ISSUES[0].labels]);
      if (url.pathname === "/repos/acme/atlas/labels") return send(200, []);
      if (url.pathname === "/repos/acme/rakett/pulls/42") return send(200, {
        ...PULLS[0], state: "open", base: { ref: "main" }, body: "Detaljer om **oppstarten**.",
        requested_reviewers: [{ login: "testbruker" }],
      });
      if (url.pathname === "/repos/acme/rakett/issues/40") return send(200, { ...ISSUES[0], state: "open" });
      if (/^\/repos\/acme\/rakett\/issues\/(40|42)\/comments$/.test(url.pathname)) {
        return send(200, [{ id: 1, body: "Prøv igjen, @testbruker.", user: { login: "lise" }, created_at: iso(40) }]);
      }
      if (url.pathname === "/repos/acme/rakett/pulls/42/reviews") return send(200, [{ id: 2, body: "Denne delen ser bra ut.", user: { login: "reviewer" }, state: "COMMENTED", submitted_at: iso(25) }]);
      if (url.pathname === "/repos/acme/rakett/pulls/42/comments") return send(200, [{ id: 3, path: "src/start.ts", body: "En kommentar på linjen.", user: { login: "reviewer" }, created_at: iso(15) }]);
      if (url.pathname === "/repos/acme/rakett/pulls/42/files") return send(200, [{ filename: "src/start.ts", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-før\n+etter" }]);
      if (url.pathname === "/repos/acme/tom") return send(200, { description: null, private: true, default_branch: "trunk", stargazers_count: 0 });
      if (url.pathname === "/repos/acme/tom/pulls" || url.pathname === "/repos/acme/tom/issues") return send(200, []);
      return send(404, { message: "Not Found" });
    };
    if (mode === "slow") setTimeout(reply, 1500);
    else reply();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setMode: (next) => (mode = next),
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
