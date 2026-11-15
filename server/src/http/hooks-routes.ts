// Routes for Innstillinger → Hooks. Kept apart from api.ts so the feature stays in its own files.
// Same checks as every other route, from Api.handle(): the session cookie, Origin and JSON. This is
// the only way a hook can be created or changed: the model has no tool for it, and nothing is ever
// read from a project.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hooks } from "../hooks.ts";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;

export function hooksRoutes(route: Route, hooks: Hooks): void {
  route("GET", "/api/hooks", () => hooks.state());
  route("POST", "/api/hooks", ({ body }) => hooks.create(body));
  // Before /api/hooks/:id, which would otherwise take "order" and "test" as ids.
  route("PUT", "/api/hooks/order", ({ body }) => hooks.reorder(body.ids));
  route("POST", "/api/hooks/test", ({ body }) => hooks.test(body));
  route("PATCH", "/api/hooks/:id", ({ params, body }) => hooks.update(params.id, body));
  route("DELETE", "/api/hooks/:id", ({ params }) => hooks.remove(params.id));
}
