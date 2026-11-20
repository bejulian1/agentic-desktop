// A local stand-in for the GitHub API, for server/test/github.test.ts and the UI test 28. It knows
// one token, one repo (acme/rakett), a private repo it pretends not to find, and a few modes for
// the failures the app must handle. Nothing here ever talks to github.com.
import http from "node:http";
import type { AddressInfo } from "node:net";

export const GOOD_TOKEN = "ghp_test0123456789abcdefABCDEF0123456789";
export const OTHER_TOKEN = "github_pat_test_0000000000000000000000";

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
  { number: 40, title: "Æ, ø og å i filnavn vises feil", user: { login: "lise" }, created_at: iso(5000), updated_at: iso(60), comments: 12, labels: [{ name: "feil", color: "d73a4a" }, { name: "god første oppgave", color: "7057ff" }] },
  { number: 42, title: "Rask oppstart", user: { login: "kari" }, created_at: iso(300), updated_at: iso(5), comments: 3, labels: [], pull_request: { url: "x" } },
  { number: 39, title: "Frakobling gir ingen melding", user: null, created_at: iso(9000), updated_at: iso(2000), comments: 1, labels: [{ name: "ux", color: "not-a-colour" }] },
];

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
    if (!url.pathname.startsWith("/user") && !url.pathname.startsWith("/repos/") && url.pathname !== "/graphql") {
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
      if (url.pathname === "/repos/acme/rakett") {
        const etag = '"rakett-v1"';
        if (ifNoneMatch === etag) return send(304, undefined, { etag });
        return send(200, { full_name: "acme/rakett", description: "En rakett av en app ✨", private: false, default_branch: "main", stargazers_count: 1234 }, { etag });
      }
      if (url.pathname === "/repos/acme/rakett/pulls") return send(200, PULLS, { etag: '"pulls-v1"' });
      if (url.pathname === "/repos/acme/rakett/issues") return send(200, ISSUES, { etag: '"issues-v1"' });
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
