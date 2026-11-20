// A local server that plays back provider streams the way the real APIs send them, including
// awkward chunk boundaries, errors and dropped connections. No real API is ever called.
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";

export type Reply = (req: CapturedRequest, res: http.ServerResponse) => void | Promise<void>;

export interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export interface FakeLlm {
  url: string;
  requests: CapturedRequest[];
  reply: (next: Reply) => void;
  always: (next: Reply) => void;
}

export async function startFakeLlm(t: TestContext): Promise<FakeLlm> {
  const queue: Reply[] = [];
  let fallback: Reply | undefined;
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const captured = { method: req.method!, url: req.url!, headers: req.headers, body: text ? JSON.parse(text) : undefined };
      requests.push(captured);
      const reply = queue.shift() ?? fallback;
      if (!reply) return void res.writeHead(500).end("no reply queued");
      await reply(captured, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    reply: (next) => void queue.push(next),
    always: (next) => void (fallback = next),
  };
}

// Sends bytes in the given chunk size, so UTF-8 sequences and SSE lines get split.
export function sse(body: string, chunkSize = Infinity): Reply {
  return async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const bytes = Buffer.from(body, "utf8");
    for (let i = 0; i < bytes.length; i += Math.min(chunkSize, bytes.length)) {
      res.write(bytes.subarray(i, i + Math.min(chunkSize, bytes.length)));
      if (chunkSize !== Infinity) await new Promise((resolve) => setImmediate(resolve));
    }
    res.end();
  };
}

export function httpError(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
}

// Stream that never finishes, until the client goes away.
export function hang(prefix = ""): Reply {
  return (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (prefix) res.write(prefix);
  };
}

export const openaiChunk = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

export const openaiUsage = (prompt: number, completion: number, cached = 0) =>
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, prompt_tokens_details: { cached_tokens: cached } } })}\n\n`;

export const OPENAI_DONE = "data: [DONE]\n\n";

export function openaiText(text: string): string {
  return openaiChunk({ role: "assistant", content: text }) + openaiChunk({}, "stop") + openaiUsage(10, 5) + OPENAI_DONE;
}

export function openaiToolCall(name: string, input: unknown, id = "call_1"): string {
  return (
    openaiChunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(input) } }] }) +
    openaiChunk({}, "tool_calls") + openaiUsage(10, 5) + OPENAI_DONE
  );
}

export function anthropicEvents(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}
