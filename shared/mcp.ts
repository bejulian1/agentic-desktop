// MCP servers (Model Context Protocol): what the server and the web UI share. The server keeps the
// configuration and the connections (server/src/mcp/); the UI only ever sees the masked view below.
// Secret values (a GitHub token, an Authorization header) never appear here: a secret pair has an
// empty value and `set` says whether a value is stored in the keyring.

export type McpTransport = "stdio" | "http";
export type McpApproval = "ask" | "auto";
export type McpStatus = "disabled" | "connecting" | "connected" | "error";

// How many MCP tools one turn may be offered in total, across all servers. The app targets models
// with small context windows, and some servers (GitHub) expose far more tools than that.
export const MCP_TOOL_LIMIT = 60;

// One environment variable (stdio) or HTTP header (Streamable HTTP), as the UI sees it.
export interface McpPairView {
  name: string;
  secret: boolean;
  value: string; // always "" for a secret
  set: boolean; // a value is stored (for a secret: in the keyring)
}

// One environment variable or header as the UI sends it. A secret with an empty or missing value
// keeps the value already stored under that name.
export interface McpPairInput {
  name: string;
  secret: boolean;
  value?: string;
}

export interface McpToolView {
  name: string; // the server's own name for the tool
  exposed: string; // the name the model sees: mcp__<server>__<tool>
  title?: string;
  description: string;
  enabled: boolean; // the user's switch for this tool
  offered: { code: boolean; chat: boolean }; // enabled and within MCP_TOOL_LIMIT for that mode
}

export interface McpServerView {
  id: string;
  name: string;
  // The <server> part of the tool names (mcp__<slug>__<tool>), also what hook matchers use. Set
  // when the server is added or renamed; it never changes because other servers come and go.
  slug: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: McpPairView[];
  url: string;
  headers: McpPairView[];
  enabled: boolean;
  code: boolean; // offered in Kode
  chat: boolean; // offered in Chat
  approval: McpApproval;
  timeoutSeconds: number;
  disabledTools: string[];
  status: McpStatus;
  message: string; // a short Norwegian explanation of the status
  stderr: string; // the last lines a stdio server wrote to stderr, with secrets hidden
  tools: McpToolView[];
  serverName?: string; // serverInfo from initialize
  serverVersion?: string;
  protocolVersion?: string;
}

export interface McpState {
  servers: McpServerView[];
  limit: number;
  // How many MCP tools a turn is offered now, and whether the limit left any out.
  offered: { code: number; chat: number };
  capped: { code: boolean; chat: boolean };
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: McpPairInput[];
  url?: string;
  headers?: McpPairInput[];
  enabled?: boolean;
  code?: boolean;
  chat?: boolean;
  approval?: McpApproval;
  timeoutSeconds?: number;
  disabledTools?: string[];
}

// Presets only fill in the form. Nothing connects until the user saves.
export interface McpPreset {
  id: "github" | "playwright" | "custom";
  label: string;
  hint: string;
  server: McpServerInput;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "github",
    label: "GitHub",
    hint: "GitHubs egen MCP-server på nett. Lim inn et personlig tilgangstoken (PAT) i Authorization. «Bearer » legges til hvis det mangler. Legg til readonly i adressen for bare lesing.",
    server: {
      name: "GitHub",
      transport: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: [{ name: "Authorization", secret: true }],
      code: true,
      chat: false,
      approval: "ask",
    },
  },
  {
    id: "playwright",
    label: "Playwright",
    hint: "Styrer en nettleser gjennom Playwright. Startes med npx, som laster ned pakken første gang.",
    server: {
      name: "Playwright",
      transport: "stdio",
      command: "npx",
      // Headless, so no window opens on the user's screen; isolated, so the profile stays in memory.
      args: ["-y", "@playwright/mcp@latest", "--headless", "--isolated"],
      code: true,
      chat: false,
      approval: "ask",
    },
  },
  {
    id: "custom",
    label: "Egen server",
    hint: "En kommando som snakker MCP over stdin og stdout, eller en adresse med Streamable HTTP.",
    server: { name: "", transport: "stdio", command: "", args: [], code: true, chat: false, approval: "ask" },
  },
];
