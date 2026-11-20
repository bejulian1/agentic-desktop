// A fake MCP server over Streamable HTTP, for the MCP tests. Checks what the spec asks of a client
// (Accept, Mcp-Session-Id, MCP-Protocol-Version) and the Authorization header, and records every
// request. tools/list answers with JSON, tools/call with an event stream that carries a
// notification before the answer. Options make it misbehave the ways the spec allows: close the
// call's stream before the answer (with or without event ids to resume from), keep it open after
// the answer, or answer the GET stream with 404.
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeHttp {
  url: string;
  requests: Array<{ method: string; headers: http.IncomingHttpHeaders; body: any }>;
  expireSession: () => void;
  push: (message: unknown) => number; // a server notification on every open GET stream
  streams: () => number;
  posts: () => number; // POST response streams still open
  dropStreams: () => void; // the server (or a proxy) closes every GET stream
  close: () => Promise<void>;
}

export interface FakeHttpOptions {
  token?: string;
  getStream?: boolean;
  get404?: boolean;
  call?: "normal" | "keep-open" | "close-no-id" | "close-resume";
}

export async function startFakeHttp(options: FakeHttpOptions = {}): Promise<FakeHttp> {
  const requests: FakeHttp["requests"] = [];
  let session = `s-${Math.random().toString(36).slice(2)}`;
  let sessions = 0;
  const streams = new Set<http.ServerResponse>();
  const posts = new Set<http.ServerResponse>();
  const replay = new Map<string, string>(); // Last-Event-ID → the event still to send

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: req.method!, headers: req.headers, body });
      if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "bad credentials" }));
        return;
      }
      if (req.method === "DELETE") return void res.writeHead(200).end();
      if (req.method === "GET") {
        const last = req.headers["last-event-id"];
        if (typeof last === "string" && replay.has(last)) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(`id: ${last}-done\ndata: ${replay.get(last)}\n\n`);
          replay.delete(last);
          return;
        }
        if (options.get404) return void res.writeHead(404).end();
        if (!options.getStream) return void res.writeHead(405).end();
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("id: 0\ndata:\n\n");
        streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      const accept = String(req.headers.accept ?? "");
      if (!accept.includes("application/json") || !accept.includes("text/event-stream")) return void res.writeHead(406).end();
      if (body.method === "initialize") {
        session = `s-${++sessions}-${Math.random().toString(36).slice(2)}`;
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": session });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: body.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "fake-http", version: "2.0.0" } } }));
        return;
      }
      if (req.headers["mcp-session-id"] !== session) return void res.writeHead(404).end();
      if (req.headers["mcp-protocol-version"] !== "2025-11-25") return void res.writeHead(400).end("bad version");
      if (body.id === undefined || body.method === undefined) return void res.writeHead(202).end();
      if (body.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "whoami", description: "Who is signed in", inputSchema: { type: "object", properties: {} } }, { name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } }));
        return;
      }
      if (body.method === "tools/call") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (options.call === "close-no-id") return void res.end(); // no answer, no event id to resume from
        res.write("id: 1\ndata:\n\n"); // priming event without data
        res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "working" } })}\n\n`);
        const text = body.params.name === "whoami" ? `you are octocat (sent ${req.headers.authorization})` : JSON.stringify(body.params.arguments);
        // The answer split over two data: lines, as SSE allows (joined with a newline, which is
        // whitespace between JSON tokens).
        const answer = JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } });
        if (options.call === "close-resume") {
          const id = `call-${body.id}`;
          replay.set(id, answer);
          return void res.end(`id: ${id}\nretry: 50\ndata:\n\n`);
        }
        const cut = answer.indexOf('"result":') + '"result":'.length;
        const event = `data: ${answer.slice(0, cut)}\r\ndata: ${answer.slice(cut)}\r\n\r\n`;
        if (options.call === "keep-open") {
          // A server that leaves the stream open after the answer: the client must close it.
          posts.add(res);
          res.on("close", () => posts.delete(res));
          return void res.write(event);
        }
        res.end(event);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    expireSession: () => (session = "gone"),
    push: (message) => {
      for (const s of streams) s.write(`data: ${JSON.stringify(message)}\n\n`);
      return streams.size;
    },
    streams: () => streams.size,
    posts: () => posts.size,
    dropStreams: () => {
      for (const s of streams) s.end();
    },
    close: async () => {
      for (const s of streams) s.destroy();
      for (const s of posts) s.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
