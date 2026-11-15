// Routes for Innstillinger → MCP-servere. Kept apart from api.ts so the feature stays in its own
// files. Same checks as every other route, from Api.handle(): the session cookie, Origin and JSON.
// This is the only way an MCP server can be added or changed: the model has no tool for it. Every
// answer is the masked view from mcp/manager.ts, without secret values.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServers } from "../mcp/manager.ts";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;

export function mcpRoutes(route: Route, mcp: McpServers): void {
  route("GET", "/api/mcp", () => mcp.snapshot());
  route("POST", "/api/mcp/servers", ({ body }) => mcp.create(body));
  route("PATCH", "/api/mcp/servers/:id", ({ params, body }) => mcp.update(params.id, body));
  route("DELETE", "/api/mcp/servers/:id", async ({ params }) => {
    await mcp.remove(params.id);
    return mcp.snapshot();
  });
  route("POST", "/api/mcp/servers/:id/reconnect", ({ params }) => mcp.reconnect(params.id));
}
