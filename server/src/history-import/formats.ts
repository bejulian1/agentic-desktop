import type { HistorySource, ImportedToolNote } from "../../../shared/history-import.ts";
import { sourceText } from "../../../shared/i18n.ts";
import { cleanName } from "../names.ts";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const oneLine = (value: string): string => value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
const short = (value: string, limit: number): string => value.length > limit ? value.slice(0, limit - 1).trimEnd() + "…" : value;
const timestamp = (value: unknown): number | undefined => {
  const date = typeof value === "number" ? new Date(value) : new Date(string(value));
  return Number.isFinite(date.getTime()) ? date.getTime() : undefined;
};

type Role = "user" | "assistant";
export interface HistoricalMessage {
  role: Role;
  text: string;
  at: number;
  note?: ImportedToolNote;
}

export interface HistoricalSession {
  source: HistorySource;
  sessionId: string;
  cwd: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: HistoricalMessage[];
}

function parseObject(value: unknown): Json {
  try { return object(JSON.parse(string(value))); }
  catch { return {}; }
}

function textParts(value: unknown): string {
  if (typeof value === "string") return value;
  return array(value).map((part) => {
    const block = object(part);
    return !block.type || ["text", "input_text", "output_text"].includes(string(block.type)) ? string(block.text) : "";
  }).filter(Boolean).join("\n");
}

function toolSummary(input: unknown): string {
  const data = typeof input === "string" ? parseObject(input) : object(input);
  const candidate = ["command", "cmd", "file_path", "path", "pattern", "query", "description"]
    .map((key) => Array.isArray(data[key]) ? array(data[key]).map(string).join(" ") : string(data[key])).find(Boolean);
  return candidate ?? (typeof input === "string" && !input.trimStart().startsWith("{") ? input : "");
}

function toolOutput(content: unknown): string {
  const text = textParts(content);
  if (text) return text;
  for (const item of Array.isArray(content) ? content : [content]) {
    const entry = object(item);
    const response = object(object(entry.functionResponse).response);
    const output = [response, entry].flatMap((data) => ["output", "text", "message", "error", "fileName"].map((key) => string(data[key]))).find(Boolean);
    if (output) return output;
  }
  return "";
}

export function parseSession(source: HistorySource, fallbackId: string, modifiedAt: number, projectMarker?: string) {
  let sessionId = source === "claude" ? fallbackId : "";
  let cwd = projectMarker ?? "";
  let title = "";
  let started: number | undefined;
  let updated: number | undefined;
  type OrderedMessage = HistoricalMessage & { order: number };
  const messages: OrderedMessage[] = [];
  const codexEvents: OrderedMessage[] = [];
  const tools = new Map<string, string>();
  const entries = new Map<string, Json>();
  const gemini = new Map<string, Json>();
  let leaf = "";
  let geminiSubagent = false;
  let order = 0;

  const say = (role: Role, text: string, at: number, output = messages) => {
    if (text.trim()) output.push({ role, text, at, order });
  };
  const note = (kind: ImportedToolNote["kind"], tool: string, value: string, at: number) => {
    const name = short(oneLine(tool), 70);
    const summary = short(oneLine(value), 150);
    const label = kind === "call" ? sourceText("Verktøykall") : sourceText("Verktøyresultat");
    const text = `[${label}${name ? ` · ${name}` : ""}${summary ? ` · ${summary}` : ""}]`;
    messages.push({ role: "assistant", at, text, order, note: { kind, tool: name, ...(summary ? { summary } : {}) } });
  };
  const call = (id: string, tool: string, input: unknown, at: number) => {
    if (id && tool) tools.set(id, tool);
    note("call", tool, toolSummary(input), at);
  };
  const result = (id: string, tool: string, content: unknown, failed: boolean, at: number) => {
    note("result", tool || tools.get(id) || "", toolOutput(content) || (failed ? sourceText("Feil") : ""), at);
  };
  const content = (role: Role, value: unknown, at: number) => {
    if (typeof value === "string") {
      say(role, value, at);
      return;
    }
    let text: string[] = [];
    const flush = () => {
      say(role, text.join("\n"), at);
      text = [];
    };
    for (const item of array(value)) {
      const block = object(item);
      if (["text", "input_text", "output_text"].includes(string(block.type))) text.push(string(block.text));
      else if (block.type === "tool_use" || block.type === "toolCall") {
        flush();
        call(string(block.id), string(block.name), block.input ?? block.arguments, at);
      } else if (block.type === "tool_result") {
        flush();
        result(string(block.tool_use_id), "", block.content, block.is_error === true, at);
      }
    }
    flush();
  };

  function readClaude(row: Json, at: number) {
    if (row.isSidechain || row.isMeta || row.isCompactSummary) return;
    if (row.type === "summary") title = string(row.summary) || title;
    if (row.type !== "user" && row.type !== "assistant") return;
    cwd ||= string(row.cwd);
    if (sessionId === fallbackId) sessionId = string(row.sessionId) || sessionId;
    const message = object(row.message);
    if (message.role === row.type) content(row.type, message.content, at);
  }

  function readCodex(row: Json, at: number) {
    const item = object(row.payload);
    if (row.type === "session_meta") {
      cwd ||= string(item.cwd);
      sessionId ||= string(item.id);
      started ??= timestamp(item.timestamp) ?? timestamp(row.timestamp);
    } else if (row.type === "event_msg") {
      if (item.type === "user_message") say("user", string(item.message), at, codexEvents);
      if (item.type === "agent_message") say("assistant", string(item.message), at, codexEvents);
    } else if (row.type === "response_item") {
      if (item.type === "message" && (item.role === "user" || item.role === "assistant")) {
        const text = textParts(item.content);
        if (item.role === "user" && /^(?:<environment_context>|<permissions instructions>|# AGENTS\.md instructions for )/.test(text.trimStart())) return;
        say(item.role, text, at);
      } else if (item.type === "function_call" || item.type === "custom_tool_call") {
        call(string(item.call_id), string(item.name), item.arguments ?? item.input, at);
      } else if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
        result(string(item.call_id), "", item.output, false, at);
      }
    }
  }

  function readPi(row: Json, at: number) {
    if (row.type === "session") {
      cwd ||= string(row.cwd);
      sessionId ||= string(row.id);
      started ??= timestamp(row.timestamp);
    } else {
      const id = string(row.id);
      if (id) {
        entries.set(id, row);
        leaf = id;
      } else if (row.type === "message") {
        // Version 1 didn't attach branch IDs to messages.
        piMessage(row, at);
      }
    }
  }

  function piMessage(row: Json, at: number, edit?: Json) {
    const message = object(row.message);
    if (row.type === "session_info") title = string(row.name) || title;
    if (row.type !== "message" || edit?.replacement === null) return;
    const { role } = message;
    const value = object(edit?.replacement).content ?? message.content;
    if (role === "user" || role === "assistant") content(role, value, at);
    else if (role === "toolResult") result(string(message.toolCallId), string(message.toolName), value, message.isError === true, at);
    else if (role === "bashExecution") {
      const command = string(message.command);
      const output = string(message.output);
      note("call", "bash", command, at);
      note("result", "bash", output, at);
    }
  }

  function geminiMetadata(row: Json) {
    sessionId = string(row.sessionId) || sessionId;
    if (typeof row.summary === "string") title = row.summary;
    started ??= timestamp(row.startTime);
    updated = timestamp(row.lastUpdated) ?? updated;
    if (row.kind) geminiSubagent = row.kind === "subagent";
    if (Array.isArray(row.messages)) {
      gemini.clear();
      for (const item of row.messages) {
        const message = object(item);
        if (typeof message.id === "string") gemini.set(message.id, message);
      }
    }
  }

  function patchGemini(value: unknown) {
    const patch = object(value);
    for (const item of [patch, ...array(patch.updates).map(object)]) {
      const message = gemini.get(string(item.id));
      if (!message) continue;
      if (Object.hasOwn(item, "content")) message.content = item.content;
      const byId = new Map(array(message.toolCalls).map((call) => [object(call).id, object(call)]));
      for (const tool of array(item.toolCalls).map(object)) {
        const existing = byId.get(tool.id);
        if (existing && Object.hasOwn(tool, "result")) existing.result = tool.result;
      }
    }
    for (const id of array(patch.removeIds)) gemini.delete(string(id));
    const order = array(patch.orderIds);
    if (order.length) {
      const ordered = new Map<string, Json>();
      for (const id of order.map(string)) {
        const message = gemini.get(id);
        if (message) ordered.set(id, message);
      }
      for (const id of ordered.keys()) gemini.delete(id);
      for (const [id, message] of ordered) gemini.set(id, message);
    }
  }

  function readGemini(row: Json) {
    if (row.$set) geminiMetadata(object(row.$set));
    else if (row.$patch) patchGemini(row.$patch);
    else if (typeof row.$rewindTo === "string") {
      if (!gemini.has(row.$rewindTo)) {
        gemini.clear();
        return;
      }
      let discard = false;
      for (const id of gemini.keys()) {
        if (id === row.$rewindTo) discard = true;
        if (discard) gemini.delete(id);
      }
    } else if (typeof row.sessionId === "string") geminiMetadata(row);
    else if (typeof row.id === "string" && ["user", "gemini", "info", "error", "warning"].includes(string(row.type))) gemini.set(row.id, row);
  }

  return {
    read(value: unknown) {
      order++;
      const row = object(value);
      const at = timestamp(row.timestamp) ?? started ?? modifiedAt;
      if (source === "claude") readClaude(row, at);
      else if (source === "codex") readCodex(row, at);
      else if (source === "pi") readPi(row, at);
      else readGemini(row);
    },
    finish(): HistoricalSession | undefined {
      if (source === "codex") {
        // The rollout often records the same turn as both an event and a model response item.
        // Prefer the response item and retain event-only turns, including older rollout formats.
        const seen = new Map<string, number>();
        const key = (message: HistoricalMessage) => `${message.role}\0${message.text.trim()}`;
        for (const message of messages) if (!message.note) seen.set(key(message), (seen.get(key(message)) ?? 0) + 1);
        let usedEvents = false;
        for (const message of codexEvents) {
          const id = key(message);
          const copies = seen.get(id) ?? 0;
          if (copies) seen.set(id, copies - 1);
          else {
            usedEvents = true;
            messages.push(message);
          }
        }
        if (usedEvents) messages.sort((a, b) => a.order - b.order);
      } else if (source === "pi") {
        const branch: Json[] = [];
        while (leaf) {
          const entry = entries.get(leaf);
          if (!entry) break;
          entries.delete(leaf);
          branch.push(entry);
          leaf = string(entry.parentId);
        }
        branch.reverse();
        const edits = new Map<string, Json>();
        for (const row of branch) if (row.type === "context_edit") edits.set(string(row.targetId), row);
        for (const row of branch) piMessage(row, timestamp(row.timestamp) ?? started ?? modifiedAt, edits.get(string(row.id)));
      } else if (source === "gemini") {
        if (geminiSubagent) return;
        for (const row of gemini.values()) {
          const at = timestamp(row.timestamp) ?? started ?? modifiedAt;
          if (row.type === "user") say("user", textParts(row.displayContent ?? row.content), at);
          if (row.type === "gemini") {
            say("assistant", textParts(row.content), at);
            for (const tool of array(row.toolCalls).map(object)) {
              const toolAt = timestamp(tool.timestamp) ?? at;
              call(string(tool.id), string(tool.name), tool.args, toolAt);
              if (tool.result || tool.status) result(string(tool.id), string(tool.name), toolOutput(tool.resultDisplay) || toolOutput(tool.result) || tool.status, false, toolAt);
            }
          }
        }
      }
      const firstUser = messages.find((m) => m.role === "user");
      if (!sessionId || sessionId.length > 250 || !cwd || !firstUser) return;
      const createdAt = started ?? messages[0].at;
      const updatedAt = messages.reduce((latest, m) => Math.max(latest, m.at), Math.max(createdAt, updated ?? createdAt));
      const name = cleanName(oneLine(title || firstUser.text)) || sourceText("Ny tråd");
      return { source, sessionId, cwd, title: short(name, 80), createdAt, updatedAt, messages };
    },
  };
}
