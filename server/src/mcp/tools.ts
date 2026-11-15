// MCP tools as the model sees them: names, descriptions, schemas and results.
//
// Names are mcp__<server>__<tool>, with only [a-zA-Z0-9_-] (what the providers accept) and at most
// 64 characters. A tool name that is too long is cut and gets a short hash of the original, and
// two tools that end up with the same name get _2, _3 …, so no tool ever hides another.
//
// Everything that comes from a server (descriptions, results) is external data. Descriptions are
// clipped, and results go through the same size limit as the app's own tools.
import { createHash } from "node:crypto";
import { clip, MAX_RESULT_CHARS, type ToolResult } from "../agent/tools.ts";
import type { McpCallResult } from "./client.ts";

export const MAX_NAME = 64;
const MAX_DESCRIPTION = 600;
const MAX_IMAGE_BASE64 = 2 * 1024 * 1024; // about 1.5 MB of image
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// The server part of the name: short, lower case, and without the "__" that separates the parts.
export function serverSlug(name: string): string {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20).replace(/_+$/, "");
  return slug || "server";
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 6);
}

// One name, unique among `taken` (which it is added to).
export function exposedName(slug: string, tool: string, taken: Set<string>): string {
  const part = tool.replace(/[^a-zA-Z0-9_-]/g, "_") || "tool";
  let name = `mcp__${slug}__${part}`;
  if (name.length > MAX_NAME) {
    // Cut: a hash of the real name keeps two long names that start the same apart.
    const suffix = `_${hash(tool)}`;
    name = `${name.slice(0, MAX_NAME - suffix.length)}${suffix}`;
  }
  let unique = name;
  for (let n = 2; taken.has(unique); n++) unique = `${name.slice(0, MAX_NAME - String(n).length - 1)}_${n}`;
  taken.add(unique);
  return unique;
}

// A slug for a new or renamed server, unique among the slugs already taken. It is stored with the
// server and never renumbered, so "allow always" rules, Chat permissions and hook matchers for
// mcp__<slug>__… keep meaning the same server when others are added, removed or reordered.
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = serverSlug(name);
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base.slice(0, 20 - String(n).length)}${n}`;
  return slug;
}

// A slug as stored: the same rules as serverSlug produces.
export function validSlug(slug: unknown): slug is string {
  return typeof slug === "string" && /^[a-z0-9](?:[a-z0-9_]{0,18}[a-z0-9])?$/.test(slug) && !slug.includes("__");
}

export function describe(serverName: string, title: string | undefined, description: string | undefined): string {
  const text = `[MCP-server ${serverName}] ${title && title !== description ? `${title}. ` : ""}${(description ?? "").replace(/\s+/g, " ").trim()}`;
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

// The model needs an object schema with properties and required. What the server sends is kept,
// apart from $schema, which some providers refuse.
export function toolSchema(input: unknown): Record<string, unknown> {
  const schema = input && typeof input === "object" && !Array.isArray(input) ? structuredClone(input as Record<string, unknown>) : {};
  delete schema.$schema;
  schema.type = "object";
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) schema.properties = {};
  schema.required = Array.isArray(schema.required) ? schema.required.filter((r) => typeof r === "string") : [];
  return schema;
}

// Hides every secret value of the server in a text from it (an error that echoes a token).
export function redactor(secrets: string[]): (text: string) => string {
  const values = [...new Set(secrets.flatMap((s) => [s, s.replace(/^bearer\s+/i, "")]).filter((s) => s.length >= 6))].sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const value of values) out = out.split(value).join("[skjult]");
    return out;
  };
}

// A tools/call result as a tool result: text as text, one image attached when it fits, a short
// note for everything else.
export function toToolResult(result: McpCallResult, redact: (text: string) => string): ToolResult {
  const parts: string[] = [];
  let image: ToolResult["image"];
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    switch (item.type) {
      case "text":
        parts.push(String(item.text ?? ""));
        break;
      case "image": {
        const mime = String(item.mimeType ?? "");
        const data = typeof item.data === "string" ? item.data : "";
        if (!image && IMAGE_TYPES.has(mime) && data && data.length <= MAX_IMAGE_BASE64) {
          image = { mime, base64: data };
          parts.push(`[Bilde (${mime}) lagt ved]`);
        } else {
          parts.push(`[Bilde (${mime.slice(0, 40) || "ukjent type"}, ${Math.round((data.length * 3) / 4 / 1024)} kB) ble ikke vist${image ? ": bare det første bildet legges ved" : ""}]`);
        }
        break;
      }
      case "audio":
        parts.push(`[Lyd (${String(item.mimeType ?? "ukjent type").slice(0, 40)}) støttes ikke og ble utelatt]`);
        break;
      case "resource_link":
        parts.push(`[Ressurslenke: ${String(item.name ?? "").slice(0, 200)} ${String(item.uri ?? "").slice(0, 500)}]`);
        break;
      case "resource": {
        const resource = item.resource ?? {};
        if (typeof resource.text === "string") parts.push(`[Ressurs ${String(resource.uri ?? "").slice(0, 500)}]\n${resource.text}`);
        else parts.push(`[Ressurs ${String(resource.uri ?? "").slice(0, 500)} (${String(resource.mimeType ?? "binær").slice(0, 40)}) ble ikke vist]`);
        break;
      }
      default:
        parts.push(`[Innhold av typen ${String(item.type).slice(0, 40)} støttes ikke og ble utelatt]`);
    }
  }
  // Structured output only when there is no text: servers that send both repeat it in the text.
  if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2));
  const text = redact(parts.join("\n\n").trim()) || (result?.isError ? "Verktøyet feilet uten melding." : "(tomt svar)");
  return { text: clip(text, MAX_RESULT_CHARS), ...(result?.isError ? { isError: true } : {}), ...(image ? { image } : {}) };
}
