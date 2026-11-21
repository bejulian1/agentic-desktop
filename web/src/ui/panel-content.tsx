// What the side panel shows, for the single panel (RightPanel.tsx) and for stacked panels
// (PanelStack.tsx, round 12): the start page with the tools, and each tool's own view.
//
// Each tool is its own chunk, loaded the first time it opens, and leaving it unmounts it so its
// memory goes back.
import { t } from "../lib/i18n";
import { createMemo, For, lazy, Match, Show, Suspense, Switch, type JSX } from "solid-js";
import { send } from "../lib/socket";
import { app, LOCAL_SCOPE, untitled } from "../state/app";
import { focusedThread } from "../state/actions";
import { artifacts } from "../state/artifacts";
import { openThread } from "../state/navigate";
import { consumeStartPage, requestBrowserTab, showPanel, type PanelTab } from "../state/panel";
import { requestTerminalSession, unifiedPanelTabs } from "../state/panel-sessions";
import { openServer, servers } from "../state/servers";
import { sideChat } from "../state/thread-actions";
import { displayKeys, keysFor } from "../state/shortcuts";
import { IconArtifact, IconGamepad, IconGlobe, IconPlusCircle } from "./icons";
import { needsProjectTip, PANEL_TOOLS, toolBlocked, toolTitle, type PanelTool } from "./panel-tools";

const LocalOverview = lazy(() => import("./LocalPanelContext").then((m) => ({ default: m.LocalOverview })));
const ProjectContext = lazy(() => import("./LocalPanelContext").then((m) => ({ default: m.ProjectContext })));

const FilesPanel = lazy(() => import("../panels/Files"));
const ChangesPanel = lazy(() => import("../panels/Changes"));
const TerminalPanel = lazy(() => import("../panels/Terminal"));
const BrowserPanel = lazy(() => import("../panels/Browser"));
const TeamPanel = lazy(() => import("../panels/Team"));
const OverviewPanel = lazy(() => import("../panels/Overview"));
const GitHubPanel = lazy(() => import("./GitHubPanel")); // round 8, agent G
const SessionPanel = lazy(() => import("./SessionPanel").then((m) => ({ default: m.SessionPanel }))); // round 12

interface Suggestion {
  key: string;
  label: string;
  hint: string;
  title: string;
  kind: "playtest" | "server" | "artifact";
  open: () => void;
}

interface Tile {
  id: string;
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  keys?: string;
  blocked: () => boolean;
  tip: () => string;
  run: () => void;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// The start page: Verktøy, and Foreslått when there is something to suggest.
export function PanelHome(props: { projectId: string | null }) {
  // Read once per change of the focused thread's id and title, not on every change to the thread.
  const sidechatThread = createMemo(() => {
    const thread = focusedThread();
    return thread && !untitled(thread) && thread.mode === "code" ? thread.id : null;
  });
  const panelTile = (tool: PanelTool): Tile => ({
    id: tool.id,
    label: tool.label,
    icon: tool.icon,
    keys: tool.keys,
    blocked: () => toolBlocked(tool),
    tip: () => (toolBlocked(tool) ? `${tool.label}: ${needsProjectTip()}` : toolTitle(tool, tool.tip)),
    run: () => { consumeStartPage(); showPanel(tool.id); },
  });
  // Sidechat is not a panel: it starts a thread beside the one that is open.
  const sidechat: Tile = {
    id: "side",
    label: t("Sidechat"),
    icon: IconPlusCircle,
    keys: "thread.side",
    blocked: () => !sidechatThread(),
    tip: () => (sidechatThread() ? t("Sidechat: en ny tråd ved siden av den du har åpen ({keys})", { keys: displayKeys(keysFor("thread.side")) }) : t("Sidechat: åpne en tråd først, så lager den en ny ved siden av.")),
    run: () => {
      const thread = app.threads[sidechatThread() ?? ""];
      if (thread) void sideChat(thread);
    },
  };
  // The same tiles all along; only whether they are dimmed and their tips change. Sidechat stands
  // after Nettleser, before the tools for a team and for GitHub.
  const after = PANEL_TOOLS.findIndex((t) => t.id === "browser") + 1;
  const tiles: Tile[] = [...PANEL_TOOLS.slice(0, after).map(panelTile), sidechat, ...PANEL_TOOLS.slice(after).map(panelTile)];

  // Playtest, the servers the project's commands started and its artifacts, at most a few.
  const suggestions = createMemo<Suggestion[]>(() => {
    const id = props.projectId;
    if (!id) return [];
    const out: Suggestion[] = [];
    const play = app.playtest[id];
    if (play?.status === "running" && play.url) {
      const url = play.url;
      out.push({ key: `p:${url}`, label: t("Playtest"), hint: hostOf(url), title: url, kind: "playtest", open: () => go(id, url) });
    }
    for (const server of servers().filter((s) => s.projectId === id && s.url !== play?.url)) {
      out.push({ key: `s:${server.id}`, label: t("Server · {port}", { port: server.port }), hint: hostOf(server.url), title: `${server.command}\n${server.url}`, kind: "server", open: () => openServer(server) });
    }
    for (const artifact of artifacts().filter((a) => a.projectId === id).slice(0, 6)) {
      out.push({ key: `a:${artifact.id}`, label: artifact.title, hint: t("Artifact"), title: artifact.title, kind: "artifact", open: () => go(id, artifact.previewUrl) });
    }
    return out.slice(0, 6);
  });

  return (
    <div class="panel-home" data-testid="panel-home">
      <Show when={unifiedPanelTabs()}><div class="panel-new-sessions">
        <button type="button" class="btn" onClick={() => { consumeStartPage(); requestBrowserTab(false); showPanel("browser"); }}><IconGlobe size={14} />{t("Ny nettleserfane")}</button>
        <button type="button" class="btn" onClick={() => { consumeStartPage(); requestTerminalSession(props.projectId ?? LOCAL_SCOPE); showPanel("terminal"); }}><IconPlusCircle size={14} />{t("Ny terminal")}</button>
      </div></Show>
      <h3 class="newtab-title">{t("Verktøy")}</h3>
      <div class="panel-tools" role="list" aria-label={t("Verktøy")}>
        <For each={tiles}>
          {(tile) => (
            <button
              type="button"
              role="listitem"
              class="panel-tool"
              data-tool={tile.id}
              aria-disabled={tile.blocked() ? "true" : undefined}
              title={tile.tip()}
              onClick={() => !tile.blocked() && tile.run()}
            >
              <span class="panel-tool-inner">
                <tile.icon size={15} />
                <span class="panel-tool-name">{tile.label}</span>
                <Show when={tile.keys && keysFor(tile.keys)}><kbd class="menu-keys">{displayKeys(keysFor(tile.keys!))}</kbd></Show>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={suggestions().length}>
        <h3 class="newtab-title">{t("Foreslått")}</h3>
        <div class="panel-suggestions">
          <For each={suggestions()}>
            {(s) => (
              <button type="button" class="newtab-site" data-kind={s.kind} title={s.title} onClick={() => { consumeStartPage(); s.open(); }}>
                <span class="newtab-site-icon">{s.kind === "artifact" ? <IconArtifact size={18} /> : s.kind === "playtest" ? <IconGamepad size={18} /> : <IconGlobe size={18} />}</span>
                <span class="newtab-site-label">{s.label}</span>
                <span class="newtab-site-host">{s.hint}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function go(projectId: string, url: string): void {
  showPanel("browser");
  send({ type: "browser.navigate", projectId, url });
}


// One tool's view. head: a stacked panel's top line, where Terminal and Nettleser put their tabs.
export function ToolView(props: { tool: PanelTab; projectId: string | null; threadId: () => string | null; head?: () => HTMLElement | undefined; sharedTabs?: boolean; visible?: boolean }) {
  return (
    <Suspense fallback={<div class="panel-empty" role="status">{t("Åpner verktøy…")}</div>}>
      <Show
        when={props.projectId}
        keyed
        fallback={
          <Switch>
            <Match when={props.tool === "files"}><FilesPanel projectId={LOCAL_SCOPE} threadId={props.threadId} /></Match>
            <Match when={props.tool === "changes"}><ChangesPanel threadId={props.threadId} /></Match>
            <Match when={props.tool === "overview"}><LocalOverview threadId={props.threadId} /></Match>
            <Match when={props.tool === "team" || props.tool === "github"}><ProjectContext tool={props.tool as "team" | "github"} /></Match>
            <Match when={props.tool === "terminal"}><TerminalPanel projectId={LOCAL_SCOPE} place="Denne datamaskinen" head={props.head} sharedTabs={props.sharedTabs} visible={props.visible} /></Match>
            <Match when={props.tool === "browser"}><BrowserPanel projectId={LOCAL_SCOPE} head={props.head} sharedTabs={props.sharedTabs} visible={props.visible} /></Match>
            <Match when={props.tool === "session"}><Session threadId={props.threadId} /></Match>
          </Switch>
        }
      >
        {(projectId) => (
          <Switch>
            <Match when={props.tool === "files"}><FilesPanel projectId={projectId} threadId={props.threadId} /></Match>
            <Match when={props.tool === "changes"}><ChangesPanel threadId={props.threadId} /></Match>
            <Match when={props.tool === "terminal"}><TerminalPanel projectId={projectId} head={props.head} sharedTabs={props.sharedTabs} visible={props.visible} /></Match>
            <Match when={props.tool === "browser"}><BrowserPanel projectId={projectId} head={props.head} sharedTabs={props.sharedTabs} visible={props.visible} /></Match>
            <Match when={props.tool === "team"}><TeamPanel projectId={projectId} /></Match>
            <Match when={props.tool === "overview"}><OverviewPanel projectId={projectId} threadId={props.threadId} /></Match>
            <Match when={props.tool === "github"}><GitHubPanel projectId={projectId} /></Match>
            <Match when={props.tool === "session"}><Session threadId={props.threadId} /></Match>
          </Switch>
        )}
      </Show>
    </Suspense>
  );
}

// Økt shows the thread in focus; without one there is nothing to show yet.
function Session(props: { threadId: () => string | null }) {
  return (
    <Show when={props.threadId()} keyed fallback={<div class="panel-empty okt-none" data-testid="okt-none">{t("Økten hører til en tråd. Skriv en melding, så viser den miljø, kontekst og det som kjører.")}</div>}>
      {(id) => <div class="okt-scroll"><SessionPanel threadId={id} onOpenFiles={() => showPanel("files")} onOpenThread={(threadId) => { const t = app.threads[threadId]; if (t) void openThread(t); }} /></div>}
    </Show>
  );
}
