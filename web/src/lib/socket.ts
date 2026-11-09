// The one WebSocket of this window. Each connection needs a fresh ticket, and whoever depends on
// the connection re-sends its subscriptions from onOpen.
import { createSignal } from "solid-js";
import type { ClientMessage, ServerMessage } from "../../../shared/protocol";
import { ApiError, post } from "./api";

export type Connection = "connecting" | "online" | "offline" | "expired";

type ByType<K extends ServerMessage["type"]> = Extract<ServerMessage, { type: K }>;

const [connection, setConnection] = createSignal<Connection>("connecting");
export { connection };

const listeners = new Map<string, Set<(message: any) => void>>();
const openCallbacks = new Set<() => void>();
let socket: WebSocket | undefined;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

export function on<K extends ServerMessage["type"]>(type: K, listener: (message: ByType<K>) => void): () => void {
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(listener);
  return () => set!.delete(listener);
}

// Runs at once if connected, and again after every reconnect.
export function onOpen(callback: () => void): () => void {
  openCallbacks.add(callback);
  if (socket?.readyState === WebSocket.OPEN) callback();
  return () => openCallbacks.delete(callback);
}

export function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function retry(): void {
  if (stopped) return;
  clearTimeout(timer);
  attempt += 1;
  timer = setTimeout(() => void connect(), Math.min(200 * 2 ** Math.min(attempt, 4), 3000));
}

async function connect(): Promise<void> {
  if (stopped) return;
  if (connection() !== "offline") setConnection("connecting");
  let ticket: string;
  try {
    ({ ticket } = await post<{ ticket: string }>("/api/ws-ticket"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return expire();
    setConnection("offline");
    return retry();
  }
  const ws = new WebSocket(`ws://${location.host}/ws?ticket=${ticket}`);
  socket = ws;
  ws.onopen = () => {
    attempt = 0;
    setConnection("online");
    for (const callback of openCallbacks) callback();
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as ServerMessage;
    const set = listeners.get(message.type);
    if (set) for (const listener of set) listener(message);
  };
  ws.onclose = () => {
    if (socket === ws) socket = undefined;
    if (stopped) return;
    setConnection("offline");
    retry();
  };
}

export function expire(): void {
  stopped = true;
  clearTimeout(timer);
  setConnection("expired");
  socket?.close();
}

export function startSocket(): void {
  stopped = false;
  void connect();
}
