// The format the agent loop speaks. Each provider translates to and from it.
import type { ModelConfig, WebSource } from "../../../shared/protocol.ts";

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; signature?: string; field?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown; parseError?: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean; image?: ImageData }
  // An image the user attached. Only in user messages.
  | { type: "image"; image: ImageData; name?: string }
  // Round 13: a block only one provider understands, kept as it came so the history can be sent back
  // (Anthropic's web search call and its results). Other providers leave it out.
  | { type: "provider"; provider: string; data: unknown };

export interface ImageData {
  mime: string;
  base64: string;
}

export interface Message {
  role: "user" | "assistant";
  content: Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ProviderRequest {
  model: ModelConfig;
  system: string;
  messages: Message[];
  tools: ToolDef[];
  signal: AbortSignal;
  purpose?: "chat" | "summary" | "completion";
  webSearch?: boolean; // round 13: use the provider's own web search
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "pause"; // pause: a long server-side tool turn, to be continued

export type StreamPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; field?: string }
  | { type: "thinking_signature"; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_call"; id: string; name: string; input: unknown; parseError?: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedInputTokens: number }
  // Round 13: the provider's own web search, started and done. query may be unknown (OpenAI).
  | { type: "web_search"; id: string; query: string }
  | { type: "web_results"; id: string; query?: string; sources: WebSource[]; error?: string }
  | { type: "provider_block"; provider: string; data: unknown }
  | { type: "stop"; reason: StopReason; detail?: string };

export interface Provider {
  stream(request: ProviderRequest): AsyncIterable<StreamPart>;
  test(signal: AbortSignal): Promise<{ ok: boolean; message: string }>;
}

export class ProviderError extends Error {
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;

  constructor(message: string, options: { status?: number; retryable?: boolean; retryAfterMs?: number } = {}) {
    super(message);
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}
