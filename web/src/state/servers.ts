// Servers the app's own processes started, from the server: the list for Oversikt, a note when a new
// one shows up (never twice in a row for the same port), and opening one in the Browser panel.
import { createSignal } from "solid-js";
import type { RunningServer } from "../../../shared/protocol";
import { get, post } from "../lib/api";
import { on, send } from "../lib/socket";
import { app, report, setMode, setProjectId, toast } from "./app";
import { showPanel } from "./panel";

const [servers, setServers] = createSignal<RunningServer[]>([]);
export { servers };

let lastNoted: number | null = null;

export function openServer(server: RunningServer): void {
  if (!app.projects[server.projectId]) return;
  setProjectId(server.projectId);
  setMode("code");
  showPanel("browser");
  send({ type: "browser.navigate", projectId: server.projectId, url: server.url });
}

export async function copyServerUrl(server: RunningServer): Promise<void> {
  try {
    await navigator.clipboard.writeText(server.url);
    toast(`Kopierte ${server.url}.`, "info");
  } catch {
    toast("Nettleseren slapp ikke til utklippstavlen.");
  }
}

export async function stopServer(server: RunningServer): Promise<void> {
  await post(`/api/servers/${server.id}/stop`).catch(report);
}

function update(next: RunningServer[], note: boolean): void {
  const before = new Set(servers().map((s) => s.port));
  setServers(next);
  if (!note) return;
  for (const server of next) {
    if (before.has(server.port) || server.port === lastNoted) continue;
    lastNoted = server.port;
    toast(`Server kjører på localhost:${server.port}`, "info", { label: "Åpne", run: () => openServer(server) });
  }
}

export function wireServers(): () => void {
  get<RunningServer[]>("/api/servers").then((list) => update(list, false)).catch(() => undefined);
  return on("servers.changed", ({ servers: next }) => update(next, true));
}
