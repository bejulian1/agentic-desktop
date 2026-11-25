import { t } from "../lib/i18n";
import {GlobalWallpaper} from './GlobalWallpaper';
import {UiModRoot} from "./UiModRoot";
import {modsOpen} from "../state/ui-mods";
import { windowTitle } from "../state/thread-status";
import { createEffect, createMemo, createSignal, lazy, on as track, onCleanup, Show, Suspense, untrack } from "solid-js";
import { connection, onOpen } from "../lib/socket";
import { applyBootstrap, app, currentProject, projectId, projectOfScope, refreshProject, dismissToast, loadPlaytest, loadProjectUsage, mode, panelOpen, panelWidth, scope, settingsOpen, setSidebarOpen, sidebarOpen, sidebarWidth, toasts, untitled, railEnabled } from "../state/app";
import { get } from "../lib/api";
import type { Bootstrap } from "../../../shared/protocol";
import { gridFor } from "../state/grid";
import { handleShortcut } from "../state/actions";
import { chatProjectVisit, recordVisit } from "../state/history";
import { askWhoIsOpen, registerSoloWindow } from "../state/windows";
import { GlobalLayers } from "./dialogs";
import { GridView } from "./GridView";
import { Pane } from "./Pane";
import { RightPanel } from "./RightPanel";
import { panelFull, setPanelFull } from "../state/panel";
import { Sidebar } from "./Sidebar";
import { SidebarRail } from "./SidebarRail";
import { onQuietWord } from "../lib/sequence";
import { TopBar } from "./TopBar";
import { TerminalDrawer } from "./TerminalDrawer";
import { markSeen, setVisibleCheck } from "../state/home";
import type { PaneState } from "../state/grid";
import { room } from "../state/artifacts";
import { artifactBig, artifactPanel, artifactWidth, closeArtifactPanel } from "../state/artifact-panel";
import { chatProjectPageId, closeChatProjectPage, closeGitHubRoom, closeProfile, githubRoom, loadFavicons, profileOpen } from "../state/nav";
import { followGitHubMessageLink } from "../state/github";
import { wireDownloads } from "../state/downloads";
import { wireServers } from "../state/servers";
import { on } from "../lib/socket";
import { SettingsView } from "./lazy-views";
import { closeSkills, skillsOpen } from "../state/skills-workspace";
import { studioOpen } from "../state/studio";
import StudioWorkspace from "../studio/StudioWorkspace";
import { openWelcome, welcomeView } from "../state/welcome";

const UiModsDialogHost=lazy(()=>import("./UiModsDialog"));
const ArtifactsRoom = lazy(() => import("./ArtifactsRoom"));
const ArtifactPanel = lazy(() => import("./ArtifactPanel")); // round 15, the first time a box is opened
const ProfilePage = lazy(() => import("./ProfilePage"));
const SkillsRoom = lazy(() => import("./SkillsRoom"));
const ChatProjectPage = lazy(() => import("./ChatProjectPage"));
const GitHubRoom = lazy(() => import("./GitHubRoom"));
const Welcome = lazy(() => import("./Welcome"));

export function ExpiredScreen() {
  return (
    <div class="expired" role="alertdialog" aria-label={t("Økten er utløpt")}>
      <div class="expired-card">
        <h1>{t("Åpne lenken fra terminalen")}</h1>
        <p>{t("Serveren har startet på nytt, eller så er du ikke logget inn. Lenken er ny for hver kjøring, og den står i terminalen der du startet appen. Trådene dine er lagret.")}</p>
      </div>
    </div>
  );
}

function OfflineBanner() {
  return (
    <Show when={connection() === "offline"}>
      <div class="banner" role="status" data-testid="offline-banner">{t("Mistet kontakten med serveren. Prøver igjen…")}</div>
    </Show>
  );
}

// Loaded only when it is asked for.
const Nordlys = lazy(() => import("./Nordlys"));

function Shortcuts() {
  const [quiet, setQuiet] = createSignal(false);
  const onKey = (event: KeyboardEvent) => {
    if (welcomeView()) return;
    handleShortcut(event);
    if (!quiet()) onQuietWord(event, () => setQuiet(true));
  };
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));
  return (
    <Show when={quiet()}>
      <Suspense><Nordlys onClose={() => setQuiet(false)} /></Suspense>
    </Show>
  );
}

export function App() {
  document.addEventListener("click", followGitHubMessageLink);
  onCleanup(() => document.removeEventListener("click", followGitHubMessageLink));
  const [skillsVisited, setSkillsVisited] = createSignal(false);
  createEffect(() => { if (skillsOpen()) setSkillsVisited(true); });
  const chatProjectPage = createMemo(() => mode() === "chat" ? app.chatProjects[chatProjectPageId() ?? ""] : undefined);
  createEffect(() => {
    const id = chatProjectPageId();
    if (id && (mode() !== "chat" || !app.chatProjects[id])) closeChatProjectPage();
  });
  const threadId = createMemo(() => {
    if (chatProjectPage()) return null;
    const key = scope();
    return key ? gridFor(key).focusedThreadId() : null;
  });

  createEffect(() => {
    recordVisit(chatProjectPage() ? chatProjectVisit(chatProjectPage()!.id) : threadId());
    markSeen(threadId());
  });
  // Round 13 (SPEC 27.1): the window's title says what the thread in focus does, in the same words
  // as the sidebar: «Jobber… · tittel», «Venter på deg · tittel».
  createEffect(() => {
    const id = threadId();
    const thread = id ? app.threads[id] : undefined;
    document.title = chatProjectPage() ? `${chatProjectPage()!.name} · Agentic Desktop` : windowTitle(thread, untitled(thread));
  });
  // A thread that finishes in a pane on screen is not news.
  setVisibleCheck((id) => {
    const key = scope();
    return !!key && !chatProjectPage() && !room() && !profileOpen() && !skillsOpen() && !githubRoom() && !settingsOpen() && gridFor(key).panes().some((p) => p.threadId() === id);
  });

  // A project that is opened is read again, so a folder moved or deleted since shows (SPEC 21.2).
  createEffect(track(() => (mode() === "code" ? projectId() : null), (id) => {
    if (id) void refreshProject(id);
  }));

  createEffect(() => {
    const project = currentProject();
    if (project && mode() === "code") {
      void loadProjectUsage(project.id);
      void loadPlaytest(project.id);
    }
  });

  // The Artifacts room and the profile page share the middle: opening one closes the other.
  createEffect(() => {
    if (room()) closeProfile();
    if (room() || profileOpen()) closeSkills();
  });
  const away = () => !!room() || profileOpen() || skillsOpen() || !!githubRoom();
  // Round 15 (SPEC 31.1): an open artifact has the right side, in Chat and in Kode. In Kode the tool
  // panel steps aside while it is open and comes back when it closes.
  const artifactShown = () => !away() && !chatProjectPage() && !!artifactPanel();
  // It belongs to its thread: going to another thread closes it.
  createEffect(track(threadId, (id) => {
    const open = untrack(artifactPanel);
    if (open?.threadId && id !== open.threadId) closeArtifactPanel();
  }, { defer: true }));
  // Kode: the panel, with or without a project (SPEC 21.9). Chat has none (SPEC 24.5).
  const panelShown = () => !away() && mode() === "code" && !studioOpen() && panelOpen() && !artifactShown();
  // Full view (round 10) ends with the panel.
  createEffect(() => {
    if (!panelShown()) setPanelFull(false);
  });
  // When the banner says the connection is gone, a toast that says the same goes.
  createEffect(() => {
    if (connection() !== "offline") return;
    const offline = t("Får ikke kontakt med serveren");
    for (const item of untrack(toasts)) if (item.text === offline || item.text === "Får ikke kontakt med serveren") dismissToast(item.id);
  });
  // Toasts sit at the top right of the conversation, left of the panel when it is open, so they
  // never cover the panel's tabs or a message field (styles/nav.css reads this).
  // In full view, and below 860 px where the panel lies above the conversation, the panel has the top
  // right itself: the toasts come down past its head, tabs and address row instead (SPEC 28, D2).
  const narrowWindow = matchMedia("(max-width: 860px)");
  const [narrow, setNarrow] = createSignal(narrowWindow.matches);
  const onNarrow = () => setNarrow(narrowWindow.matches);
  narrowWindow.addEventListener("change", onNarrow);
  onCleanup(() => narrowWindow.removeEventListener("change", onNarrow));
  // With more than one pane, each pane has a head of its own with Lukk at its right end, so they come
  // down past that too.
  createEffect(() => {
    const artifact = artifactShown();
    const open = panelShown() || artifact;
    const over = open && ((artifact ? artifactBig() : panelFull()) || narrow());
    const key = scope();
    const panes = !away() && !chatProjectPage() && key ? gridFor(key).count() : 1;
    const studio = studioOpen() && mode() === "code" && !away();
    const root = document.documentElement.style;
    root.setProperty("--toasts-panel", open && !over ? `${artifact ? artifactWidth() : panelWidth()}px` : "0px");
    root.setProperty("--toasts-down", over ? "124px" : studio ? "50px" : panes > 1 ? "40px" : "0px");
  });

  // Project favicons: at start, and when a project is added, moved or changed.
  loadFavicons();
  // A note when a download from the Browser panel is done, wherever you are.
  onCleanup(wireDownloads());
  // Servers the app's own commands start, with a note when a new one is up.
  onCleanup(wireServers());
  onCleanup(on("project.changed", () => loadFavicons(300)));

  let first = true;
  onCleanup(onOpen(() => {
    askWhoIsOpen();
    if (first) {
      first = false;
      return;
    }
    // Back after a dropped connection: anything could have changed meanwhile.
    get<Bootstrap>("/api/bootstrap").then(applyBootstrap).catch(() => undefined);
  }));

  return (
    <div
      class="app"
      classList={{ "sidebar-open": sidebarOpen(), "rail-open": !sidebarOpen() && railEnabled(), "panel-open": panelShown(), "panel-full": panelShown() && panelFull(), "artifact-open": artifactShown(), "artifact-big": artifactShown() && artifactBig() }}
      style={`--sidebar-w:${sidebarWidth()}px;--panel-w:${panelWidth()}px;--artifact-w:${artifactWidth()}px`}
      inert={!!(settingsOpen() || welcomeView()) || undefined}
    >
      <UiModRoot threadId={threadId} mode={mode}/>
      <TopBar />
      {/* Round 10 (SPEC 23.9): hidden, the sidebar is a thin row of icons in a wide window. */}
      <Show when={!sidebarOpen() && railEnabled()}>
        <SidebarRail />
      </Show>
      <Show when={sidebarOpen()}>
        <Sidebar />
        <button type="button" class="scrim" aria-label={t("Lukk sidefanen")} onClick={() => setSidebarOpen(false)} />
      </Show>
      <main class="main">
        <OfflineBanner />
        {/* The panes stay mounted under the Artifacts room, so drafts and scroll survive a visit. */}
        <div class="main-panes" hidden={away() || !!chatProjectPage()}>
          <StudioWorkspace active={() => studioOpen() && mode() === "code" && !away()} project={currentProject()} threadId={threadId}>
          {/* Kode without a project is a grid of its own, Denne datamaskinen (round 9). */}
          <Show when={scope()} keyed>
            {(key) => <GridView grid={gridFor(key)} projectId={projectOfScope(key)} code={key !== "chat"} />}
          </Show>
          </StudioWorkspace>
          <TerminalDrawer />
        </div>
        <Show when={chatProjectPage() && !away() ? chatProjectPageId() : null} keyed>
          {(id) => <Suspense><ChatProjectPage project={app.chatProjects[id]} /></Suspense>}
        </Show>
        <Show when={room()}>
          <Suspense><ArtifactsRoom /></Suspense>
        </Show>
        <Show when={skillsVisited()}>
          <div class="skills-room-host" hidden={!skillsOpen()} style={{ height: "100%", "min-height": "0", flex: "1" }}>
            <Suspense><SkillsRoom /></Suspense>
          </div>
        </Show>
        <Show when={profileOpen() && !room()}>
          <Suspense><ProfilePage /></Suspense>
        </Show>
        <Show when={githubRoom()?.kind} keyed>
          {kind => <Suspense><GitHubRoom kind={kind} /></Suspense>}
        </Show>
      </main>
      <Show when={panelShown()}>
        <RightPanel projectId={currentProject()?.id ?? null} threadId={threadId} />
      </Show>
      <Show when={artifactShown()}>
        <Suspense fallback={<aside class="artifact-panel" aria-busy="true" />}><ArtifactPanel /></Suspense>
      </Show>
      <Shortcuts />
    </div>
  );
}

// Settings replace the whole window, so they sit beside the app rather than inside it. The app
// stays mounted underneath, inert, so drafts and scroll positions are there when you come back.
export function Shell() {
  if (!app.settings.welcomeDone && !app.providers.some((provider) => provider.kind !== "mock") && !Object.keys(app.threads).length) {
    openWelcome("welcome");
  }
  return (
    <>
      <GlobalWallpaper/>
      <App />
      <SettingsAndWelcome />
      <Show when={modsOpen()}><Suspense><UiModsDialogHost/></Suspense></Show>
      <GlobalLayers />
    </>
  );
}

// A detached pane in its own window: the same Pane, without the rest of the app.
export function SoloApp(props: { threadId: string }) {
  registerSoloWindow(props.threadId);
  document.addEventListener("click", followGitHubMessageLink);
  onCleanup(() => document.removeEventListener("click", followGitHubMessageLink));
  const [threadId, setThreadId] = createSignal<string | null>(props.threadId);
  const pane: PaneState = { id: `solo-${props.threadId}`, threadId, setThreadId };
  const thread = createMemo(() => app.threads[threadId() ?? ""]);
  createEffect(() => {
    document.title = windowTitle(thread(), untitled(thread()));
  });
  // Round 15: a box in a detached pane opens the artifact panel beside it, in this window.
  return (
    <>
    <GlobalWallpaper/>
    <UiModRoot threadId={threadId} mode={()=>thread()?.mode??"chat"}/>
    <div class="app solo" classList={{ "artifact-open": !githubRoom() && !!artifactPanel(), "artifact-big": !githubRoom() && !!artifactPanel() && artifactBig() }} style={`--artifact-w:${artifactWidth()}px`} inert={!!(settingsOpen() || welcomeView()) || undefined}>
      <main class="main">
        <OfflineBanner />
        <div class="grid-area" hidden={!!githubRoom()}>
          <div class="grid-surface">
            <div class="pane" style="left:0;top:0;width:100%;height:100%">
              <Pane pane={pane} grid={null} projectId={thread()?.projectId ?? null} focused solo />
            </div>
          </div>
        </div>
        <Show when={githubRoom()?.kind} keyed>
          {kind => <Suspense><GitHubRoom kind={kind} onStart={next => {
            closeGitHubRoom();
            setThreadId(next.id);
            registerSoloWindow(next.id);
            history.replaceState(null, "", `/?rute=${encodeURIComponent(next.id)}`);
          }} /></Suspense>}
        </Show>
      </main>
      <Show when={!githubRoom() && artifactPanel()}>
        <Suspense fallback={<aside class="artifact-panel" aria-busy="true" />}><ArtifactPanel /></Suspense>
      </Show>
    </div>
    <SettingsAndWelcome />
    <Show when={modsOpen()}><Suspense><UiModsDialogHost/></Suspense></Show>
    <GlobalLayers />
    </>
  );
}

function SettingsAndWelcome() {
  return <>
    <Show when={settingsOpen()}>
      <div hidden={!!welcomeView()}>
        <Suspense><SettingsView /></Suspense>
      </div>
    </Show>
    <Show when={welcomeView()} keyed>
      {(view) => <Suspense fallback={<div class="welcome-window" aria-busy="true" />}><Welcome importOnly={view === "import"} /></Suspense>}
    </Show>
  </>;
}

