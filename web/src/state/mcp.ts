// MCP servers in the UI: the masked state from the server (shared/mcp.ts), from the bootstrap and
// from mcp.changed on the socket. Secret values never reach this side; a secret only says if it
// is set.
import { createStore, reconcile } from "solid-js/store";
import type { McpServerInput, McpServerView, McpState } from "../../../shared/mcp";
import { del, get, patch, post } from "../lib/api";
import { on, onOpen } from "../lib/socket";

const empty: McpState = { servers: [], limit: 60, offered: { code: 0, chat: 0 }, capped: { code: false, chat: false } };
// A store, reconciled by id: a change keeps the same server and tool objects, so the cards on the
// settings page are not made anew. Otherwise every mcp.changed would close the open tool list and
// the stderr box, and take the keyboard focus off the switch that was just pressed.
const [store, setStore] = createStore<{ state: McpState }>({ state: empty });
export const mcpState = (): McpState => store.state;
export const setMcpState = (state: McpState): void => setStore("state", reconcile(state, { key: "id" }));

on("mcp.changed", ({ state }) => setMcpState(state));
// After a lost connection the socket may have missed changes.
onOpen(() => void refreshMcp().catch(() => undefined));

export const refreshMcp = () => get<McpState>("/api/mcp").then(setMcpState);

export async function createMcpServer(input: McpServerInput): Promise<McpServerView> {
  const server = await post<McpServerView>("/api/mcp/servers", input);
  await refreshMcp();
  return server;
}

export async function updateMcpServer(id: string, input: Partial<McpServerInput>): Promise<McpServerView> {
  const server = await patch<McpServerView>(`/api/mcp/servers/${id}`, input);
  await refreshMcp();
  return server;
}

export async function removeMcpServer(id: string): Promise<void> {
  setMcpState(await del<McpState>(`/api/mcp/servers/${id}`));
}

export async function reconnectMcpServer(id: string): Promise<void> {
  await post(`/api/mcp/servers/${id}/reconnect`);
  await refreshMcp();
}
