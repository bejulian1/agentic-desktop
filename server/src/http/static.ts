// Serves the built UI. Project files are never served from the app's own origin.
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { isInside, realDeepest } from "../paths.ts";
import { MIME } from "../playtest.ts";

const NOT_BUILT = `<!doctype html><html lang="no"><meta charset="utf-8"><title>Agentic Desktop</title>
<p>Grensesnittet er ikke bygget ennå. Kjør <code>npm run build</code>.</p></html>`;

export function serveStatic(req: IncomingMessage, res: ServerResponse, webDist: string, pathname: string): void {
  const index = path.join(webDist, "index.html");
  let file: string | undefined;
  try {
    const candidate = realDeepest(path.join(webDist, decodeURIComponent(pathname)));
    if (isInside(realDeepest(webDist), candidate) && statSync(candidate, { throwIfNoEntry: false })?.isFile()) file = candidate;
  } catch {
    res.writeHead(400).end();
    return;
  }
  // Client-side routes fall back to the app; a missing asset is a 404.
  if (!file && path.extname(pathname)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Ikke funnet");
    return;
  }
  file ??= index;
  const info = statSync(file, { throwIfNoEntry: false });
  if (!info) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(NOT_BUILT);
    return;
  }
  const hashed = pathname.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}
