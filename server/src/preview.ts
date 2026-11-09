// The preview server for artifacts. Artifact HTML is untrusted, like a page the agent visits, so
// it never runs on the app's origin: this is its own server on another port, reached as localhost
// while the app is 127.0.0.1 (browsers do not separate cookies by port), and every response
// carries a CSP sandbox, so even opened on its own the page gets an opaque origin.
//
// It serves nothing but HTML it is handed: no file system access at all. Each URL carries a key
// that only this run of the server knows. Saved artifacts are signed with an HMAC of their id, and
// chat previews of unsaved blocks are snapshots behind a random token.
//
// Round 15 (SPEC 31.2): an artifact can also be a React component in JSX or TSX. Its URL gives a
// small page with an import map, the file as data, and boot.js, which turns the file into
// JavaScript and renders it in the frame. React and the rest come from /_rt/, the runtime built
// with the web UI (preview-runtime.ts reads it, not this file). That page has a stricter CSP than
// HTML artifacts: scripts only from /_rt/ and the module boot.js makes, no connections, no images
// or fonts from anywhere but data: and blob:, so a React artifact makes no network calls at all.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ArtifactLang } from "../../shared/protocol.ts";
import type { RuntimeFile } from "./preview-runtime.ts";

const MAX_SNAPSHOTS = 64;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

export interface PreviewOptions {
  appOrigins: () => string[];
  artifactSource: (id: string) => { source: string; lang: ArtifactLang } | undefined;
  runtime?: { available: boolean; file(name: string): RuntimeFile | undefined };
}

interface Snapshot {
  source: string;
  lang: ArtifactLang;
  hash: string;
}

// What the import map offers a React artifact. Anything else it imports, boot.js names in a
// message instead of trying.
const IMPORTS: Record<string, string> = {
  react: "/_rt/react.js",
  "react-dom": "/_rt/react-dom.js",
  "react-dom/client": "/_rt/react-dom-client.js",
  "react/jsx-runtime": "/_rt/jsx-runtime.js",
};

// JSON inside a script element: nothing in it can close the element or start a comment.
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function reactPage(source: string, lang: ArtifactLang, nonce: string, available: boolean): string {
  const head = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>React-forhåndsvisning</title>`;
  if (!available) {
    // A checkout without a web build. Plain HTML, no script.
    return `${head}
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:13px/1.5 system-ui,sans-serif;color:#4f4f49;padding:24px;box-sizing:border-box}</style>
</head>
<body><p>React-forhåndsvisningen er ikke bygget i denne kopien av appen. Bygg web-delen, så virker den.</p></body>
</html>`;
  }
  return `${head}
<script type="importmap" nonce="${nonce}">${scriptJson({ imports: IMPORTS })}</script>
<script type="application/json" id="ad-kilde">${scriptJson({ lang, code: source })}</script>
<script type="module" src="/_rt/boot.js"></script>
</head>
<body>
<div id="root"></div>
</body>
</html>`;
}

export class PreviewServer {
  private readonly key = randomBytes(32);
  private server: http.Server;
  private port = 0;
  private options: PreviewOptions;
  // token -> source, oldest first. hashes finds the token for a source already shown.
  private snapshots = new Map<string, Snapshot>();
  private hashes = new Map<string, string>();
  private snapshotBytes = 0;

  constructor(options: PreviewOptions) {
    this.options = options;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  get origin(): string {
    return `http://localhost:${this.port}`;
  }

  get listeningPort(): number {
    return this.port;
  }

  private sign(id: string): string {
    return createHmac("sha256", this.key).update(`artifact:${id}`).digest("base64url");
  }

  artifactUrl(id: string): string {
    return `${this.origin}/a/${encodeURIComponent(id)}/${this.sign(id)}`;
  }

  // The same source gets the same URL while it is kept, so a box that is opened again does not
  // fill the memory with copies.
  snapshot(source: string, lang: ArtifactLang = "html"): string {
    const hash = createHash("sha256").update(`${lang}\0${source}`).digest("base64url");
    let token = this.hashes.get(hash);
    if (token) {
      const entry = this.snapshots.get(token)!;
      this.snapshots.delete(token);
      this.snapshots.set(token, entry);
    } else {
      token = randomBytes(32).toString("base64url");
      this.snapshots.set(token, { source, lang, hash });
      this.hashes.set(hash, token);
      this.snapshotBytes += source.length;
      for (const [old, entry] of this.snapshots) {
        if (this.snapshots.size <= MAX_SNAPSHOTS && this.snapshotBytes <= MAX_SNAPSHOT_BYTES) break;
        if (old === token) break;
        this.snapshots.delete(old);
        this.hashes.delete(entry.hash);
        this.snapshotBytes -= entry.source.length;
      }
    }
    return `${this.origin}/s/${token}`;
  }

  private lookup(pathname: string): { source: string; lang: ArtifactLang } | undefined {
    const parts = pathname.split("/");
    if (parts.length === 4 && parts[0] === "" && parts[1] === "a") {
      let id: string;
      try {
        id = decodeURIComponent(parts[2]);
      } catch {
        return undefined;
      }
      const given = Buffer.from(parts[3]);
      const real = Buffer.from(this.sign(id));
      if (given.length !== real.length || !timingSafeEqual(given, real)) return undefined;
      return this.options.artifactSource(id);
    }
    if (parts.length === 3 && parts[0] === "" && parts[1] === "s") return this.snapshots.get(parts[2]);
    return undefined;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const refuse = (status: number, text: string) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(text);
    };
    if (req.headers.host !== `localhost:${this.port}` && req.headers.host !== `127.0.0.1:${this.port}`) return refuse(403, "Ugyldig Host");
    if (req.method !== "GET" && req.method !== "HEAD") return refuse(405, "Bare lesing");
    const url = URL.parse(req.url ?? "/", "http://preview");
    if (url?.pathname.startsWith("/_rt/")) return this.runtimeFile(req, res, url.pathname.slice(5), refuse);
    const found = url ? this.lookup(url.pathname) : undefined;
    // A wrong key looks exactly like a missing artifact.
    if (found === undefined) return refuse(404, "Ikke funnet");
    const ancestors = `frame-ancestors ${this.options.appOrigins().join(" ")}`;
    let body: Buffer;
    let csp: string;
    if (found.lang === "html") {
      body = Buffer.from(found.source, "utf8");
      // Opaque origin even outside the iframe, and only the app may frame it.
      csp = `sandbox allow-scripts allow-modals; ${ancestors}`;
    } else {
      const nonce = randomBytes(16).toString("base64url");
      body = Buffer.from(reactPage(found.source, found.lang, nonce, this.options.runtime?.available ?? false), "utf8");
      // The app's code runs as a blob: module made by boot.js. 'unsafe-eval' only reaches the
      // frame's own opaque origin; a calculator made with eval() is common enough to allow it.
      // allow-forms, because a sandbox without it never fires submit, and React apps use onSubmit;
      // form-action 'none' still stops every submission from leaving the frame.
      csp = [
        "sandbox allow-scripts allow-modals allow-forms",
        "default-src 'none'",
        `script-src 'nonce-${nonce}' ${this.origin}/_rt/ blob: 'unsafe-eval'`,
        `style-src 'unsafe-inline'`,
        "img-src data: blob:",
        "font-src data:",
        "media-src data: blob:",
        "connect-src 'none'",
        "worker-src blob:",
        "frame-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        ancestors,
      ].join("; ");
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": csp,
    });
    if (req.method === "HEAD") return void res.end();
    res.end(body);
  }

  // The runtime's files. The page that loads them has an opaque origin, and module scripts are
  // fetched with CORS, so they say any origin may read them: they are the same public React and
  // Sucrase for everyone, with nothing of the user's in them.
  private runtimeFile(req: http.IncomingMessage, res: http.ServerResponse, name: string, refuse: (status: number, text: string) => void): void {
    const file = this.options.runtime?.file(name);
    if (!file) return refuse(404, "Ikke funnet");
    const headers = {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      etag: file.etag,
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    };
    if (req.headers["if-none-match"] === file.etag) {
      res.writeHead(304, headers);
      return void res.end();
    }
    res.writeHead(200, { ...headers, "content-length": file.body.length });
    if (req.method === "HEAD") return void res.end();
    res.end(file.body);
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }
}
