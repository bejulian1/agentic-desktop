// A fake MCP server over stdio, for the MCP tests. Run with `node mcp-fake-stdio.ts`.
// Behaviour from the environment:
//   FAKE_LOG        file that gets one JSON line per message received (for assertions)
//   FAKE_PIDFILE    file that gets this process's pid (and the grandchild's, with FAKE_GRANDCHILD)
//   FAKE_EXTRA      number of extra tools (extra_0 …) for the tool limit
//   FAKE_VERSION    protocol version to answer with (default: the one asked for)
//   FAKE_GRANDCHILD start a long-lived child process, to check that the whole group is stopped
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const log = (entry: unknown) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(entry)}\n`);
const send = (message: unknown): void => void process.stdout.write(`${JSON.stringify(message)}\n`);

const pids = [process.pid];
if (process.env.FAKE_GRANDCHILD) {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore" });
  pids.push(child.pid!);
}
if (process.env.FAKE_PIDFILE) writeFileSync(process.env.FAKE_PIDFILE, pids.join("\n"));
process.stderr.write(`fake server started, token=${process.env.FAKE_TOKEN ?? "none"}\n`);

const schema = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };
let added = false;
function tools() {
  const list: any[] = [
    { name: "echo", title: "Echo", description: "Echoes the arguments back as JSON.", inputSchema: schema, annotations: { readOnlyHint: true } },
    { name: "fail", description: "Always fails with isError.", inputSchema: { type: "object", properties: {} } },
    { name: "slow", description: "Waits ten seconds.", inputSchema: { type: "object" } },
    { name: "image", description: "Returns a tiny PNG and other content types.", inputSchema: { type: "object", properties: {} } },
    { name: "env", description: "Reports parts of its environment.", inputSchema: { type: "object", properties: {} } },
    { name: "change", description: "Adds a tool and says the list changed.", inputSchema: { type: "object", properties: {} } },
    { name: "crash", description: "Exits at once.", inputSchema: { type: "object", properties: {} } },
    { name: "dotted.name", description: "A name with a dot.", inputSchema: { type: "object", properties: {} } },
  ];
  if (added) list.push({ name: "added", description: "Added later.", inputSchema: { type: "object", properties: {} } });
  for (let i = 0; i < Number(process.env.FAKE_EXTRA ?? 0); i++) list.push({ name: `extra_${i}`, description: `Extra ${i}`, inputSchema: { type: "object", properties: {} } });
  return list;
}

const slow = new Map<unknown, NodeJS.Timeout>();

function handle(message: any): void {
  log(message);
  if (message.method === "notifications/cancelled") {
    clearTimeout(slow.get(message.params?.requestId));
    slow.delete(message.params?.requestId);
    return;
  }
  if (message.id === undefined) return;
  const reply = (result: unknown) => send({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({ protocolVersion: process.env.FAKE_VERSION ?? message.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "fake-stdio", version: "1.0.0" } });
    case "tools/list": {
      // Two pages: the first three tools, then the rest.
      const all = tools();
      return message.params?.cursor === "p2" ? reply({ tools: all.slice(3) }) : reply({ tools: all.slice(0, 3), nextCursor: "p2" });
    }
    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (name === "echo") return reply({ content: [{ type: "text", text: JSON.stringify(args) }] });
      if (name === "fail") return reply({ content: [{ type: "text", text: "it broke" }], isError: true });
      if (name === "slow") return void slow.set(message.id, setTimeout(() => reply({ content: [{ type: "text", text: "slow done" }] }), 10_000));
      if (name === "image") return reply({ content: [{ type: "image", data: PNG, mimeType: "image/png" }, { type: "audio", data: "AAAA", mimeType: "audio/wav" }, { type: "resource_link", uri: "file:///x", name: "x" }, { type: "text", text: "with pictures" }] });
      if (name === "env") return reply({ content: [{ type: "text", text: `token=${process.env.FAKE_TOKEN ?? "none"} plain=${process.env.FAKE_PLAIN ?? "none"} leak=${process.env.MCP_TEST_PARENT_API_KEY ?? "none"}` }] });
      if (name === "change") {
        added = true;
        send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
        return reply({ content: [{ type: "text", text: "changed" }] });
      }
      if (name === "crash") process.exit(3);
      if (name === "dotted.name") return reply({ content: [{ type: "text", text: "dotted ok" }] });
      return send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
    }
    default:
      return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline: number;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
// The client closes stdin to stop the server (spec): exit then.
process.stdin.on("end", () => process.exit(0));
