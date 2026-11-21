import {setModsOpen} from "../state/ui-mods";
import {IconPalette} from "./icons";
import {studioOpen} from "../state/studio";
// The top of the window. Left: the menu, the sidebar button, and back and forward, small and
// quiet, in the column they belong to: past the row of icons when the sidebar is that row, and with
// no sidebar button then, since the row has its own (SPEC 24.1). Middle: Chat and Kode, only when the
// sidebar is out of sight, and the focused thread's name. Right, in a fixed order so nothing jumps:
// in Kode the project's name, Stopp alt only while something runs, Playtest and the changes chip;
// then the pane buttons (Del til høyre, Del nedover, and Lukk ruten only with more than one pane
// where the panes have no head of their own); then the panel buttons in the style chosen in
// Innstillinger → Utseende (SPEC 24.2), and last an empty place for the window controls of the
// Electron version, which takes no width in a browser.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { ReasoningEffort } from "../../../shared/protocol";
import { formatCost, formatTokens } from "../lib/format";
import { app, currentProject, mode, modelFor, modelName, panelOpen, pinnedSummary, railEnabled, renameThread, report, scope, setPanelOpen, setPinnedSummary, setSidebarOpen, settingsOpen, sidebarOpen, untitled } from "../state/app";
import { actions, focusedThread, focusedThreadId, forkThread } from "../state/actions";
import { chatProjectPageId, openPalette, profileOpen } from "../state/nav";
import { openThread } from "../state/navigate";
import { peekModel } from "../state/thread-model";
import { openInWindow, setPinned, toggleArchived } from "../state/thread-actions";
import { forkSource, forkSourceTitle, openForkSource } from "../state/fork";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "./ContextMenu";
import { IconFullView, IconWindow } from "./nav-icons";
import { Popover } from "./Popover";
import { gridFor, MAX_PANES } from "../state/grid";
import { openDetachedWindow } from "../state/windows";
import { openVscode, runningInProject, startPlaytest, stopAll, stopPlaytest } from "../state/project-actions";
import { onPanelHome, panelFull, setPanelFull, showPanel, showPanelHome, togglePanel } from "../state/panel";
import { artifactPanel } from "../state/artifact-panel";
import { room } from "../state/artifacts";
import { displayKeys, keysFor } from "../state/shortcuts";
import {
  IconArchive, IconBack, IconBranch, IconChat, IconChevron, IconChevronDown, IconClose, IconCode, IconLaptop, IconDetach, IconDots, IconDownload, IconForward, IconKeyboard, IconPanel, IconPanelAdd,
  IconPin, IconPlay, IconSearch, IconSidebar, IconSplitDown, IconSplitRight, IconStop, IconStudio, IconTerminal,
} from "./icons";
import { MainMenu } from "./MenuBar";
import { WindowControls } from "./WindowControls";
import { ProjectPicker } from "./Composer";
import { useProjectPicker } from "../state/project-picker";
import { skillsOpen } from "../state/skills-workspace";
import { ModeSwitch } from "./ModeSwitch";
import { PinnedSummary } from "./PinnedSummary";
import { ProjectGlyph } from "./ProjectGlyph";
import { paneTools } from "./Pane";
import { PANEL_TOOLS, NEEDS_PROJECT_TIP, shownTool, toggleTool, toolBlocked, toolById, toolOpen, toolTitle } from "./panel-tools";
import { inStack, placement, setPlacement, stacking, stackTools } from "../state/stack";

const EFFORT_LABELS: Record<ReasoningEffort, string> = { none: "Ingen", low: "Lav", medium: "Middels", high: "Høy", xhigh: "Ekstra høy", max: "Maks" };
const PERMISSION_LABELS: Record<string, string> = { ask: "Spør", "accept-edits": "Godta redigeringer", full: "Full tilgang" };

// Rename directly in the title bar. The adjacent arrow keeps details and thread actions separate.
function ThreadTitle() {
  const [open, setOpen] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [editWidth, setEditWidth] = createSignal(240);
  let editRevision = 0;
  let editThreadId: string | null = null;
  const thread = createMemo(() => (room() || profileOpen() || skillsOpen() ? undefined : focusedThread()));
  const model = createMemo(() => (thread() ? peekModel(thread()!.id) : undefined));
  let input!: HTMLInputElement;
  let trigger: HTMLButtonElement | undefined;

  let more: HTMLButtonElement | undefined;
  const close = (returnFocus = false) => {
    editRevision++;
    editThreadId = null;
    setOpen(false);
    setEditing(false);
    setSaving(false);
    if (returnFocus) queueMicrotask(() => trigger?.focus({ preventScroll: true }));
  };
  createEffect(() => { thread()?.id; settingsOpen(); close(); });
  const edit = () => {
    editRevision++;
    setEditWidth(trigger?.getBoundingClientRect().width ?? 240);
    editThreadId = thread()?.id ?? null;
    setDraft(thread()?.title ?? "");
    setOpen(false);
    setEditing(true);
    const revision = editRevision;
    requestAnimationFrame(() => { if (revision === editRevision && editing()) { input?.focus({ preventScroll: true }); input?.select(); } });
  };
  const save = async (returnFocus = false) => {
    if (!editing() || saving()) return;
    const t = thread(), title = draft().trim(), revision = editRevision;
    if (!t || t.id !== editThreadId) return close();
    const finish = () => {
      editRevision++; editThreadId = null; setEditing(false); setSaving(false);
      if (returnFocus) { setOpen(false); queueMicrotask(() => trigger?.focus({ preventScroll: true })); }
    };
    if (!title || title === t.title) return finish();
    setSaving(true);
    try {
      await renameThread(t.id, title);
      if (revision === editRevision && thread()?.id === t.id) finish();
    } catch (err) { report(err); }
    finally { if (revision === editRevision) setSaving(false); }
  };
  const messages = () => {
    let n = 0;
    for (const chunk of model()?.chunks() ?? []) for (const row of chunk.rows()) if (row.kind === "user") n++;
    return n;
  };
  const effort = () => {
    const t = thread();
    const value = t?.reasoning ?? modelFor(t?.modelId)?.effort;
    return value ? EFFORT_LABELS[value] : "Standard";
  };
  const usage = () => model()?.usage();
  const run = (fn: () => unknown) => {
    close();
    void fn();
  };

  return (
    <Show when={!untitled(thread()) && thread()}>
      {(t) => (
        <Popover
          open={open()}
          onClose={() => setOpen(false)}
          below fixed portal stable gap={2}
          panelClass="title-popover"
          class="topbar-title"
          trigger={<>
            <Show when={editing()} fallback={<button type="button" ref={trigger} class="topbar-title-button" data-testid="topbar-title" title={`${t().title}: klikk for å endre navn`} aria-label={`Endre samtalenavn: ${t().title}`} onClick={edit}>{t().title}</button>}>
              <input ref={input} class="topbar-title-input" aria-label="Gi nytt navn" value={draft()} style={{ width: `${editWidth()}px` }} readonly={saving()} aria-busy={saving()} onInput={e => setDraft(e.currentTarget.value)} onBlur={() => void save()} onKeyDown={e => {
                if (e.isComposing) return;
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void save(true); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
              }} />
            </Show>
            <button type="button" ref={more} class="icon-button topbar-title-more" aria-label="Samtaledetaljer" title="Samtaledetaljer" aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}><IconChevronDown size={13} /></button>
          </>}
        >
          <div class="title-card" role="dialog" aria-label="Tråden" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); more?.focus({ preventScroll: true }); } }}>
              <dl class="title-card-facts" data-testid="title-details">
                <dt>Modell</dt><dd>{modelName(t().modelId)} · {effort()}</dd>
                <Show when={t().mode === "code" && t().projectId}>
                  <dt>Tillatelser</dt><dd>{PERMISSION_LABELS[app.projects[t().projectId!]?.permissionMode ?? "ask"]}{t().permissionCap ? ` (høyst ${PERMISSION_LABELS[t().permissionCap!]})` : ""}</dd>
                </Show>
                <dt>Prosjekt</dt><dd>{t().projectId ? app.projects[t().projectId!]?.name ?? "–" : t().chatProjectId ? app.chatProjects[t().chatProjectId!]?.name ?? "–" : "Ingen (Chat)"}</dd>
                <Show when={t().forkedFrom}>
                  <dt>Gaffel av</dt>
                  <dd>
                    <Show when={forkSource(t())} fallback={<>{t().forkedFrom!.title} (slettet)</>}>
                      <button type="button" class="link-button title-card-link" onClick={() => run(() => openForkSource(t()))}>{forkSourceTitle(t())}</button>
                    </Show>
                  </dd>
                </Show>
                <dt>Opprettet</dt><dd>{new Date(t().createdAt).toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" })}</dd>
                <dt>Meldinger</dt><dd>{model()?.hasOlder() ? `minst ${messages()}` : messages()}</dd>
                <dt>Tokens</dt><dd>{usage() ? `${formatTokens(usage()!.inputTokens + usage()!.outputTokens)}${usage()!.costUsd !== null ? ` · ${formatCost(usage()!.costUsd!)}` : ""}` : "0"}</dd>
                <dt>Festet sammendrag</dt>
                <dd><label class="title-card-switch"><input type="checkbox" class="switch" checked={pinnedSummary()} onChange={(e) => setPinnedSummary(e.currentTarget.checked)} aria-label="Festet sammendrag" />{pinnedSummary() ? "På" : "Av"}</label></dd>
              </dl>
              <div class="title-card-actions">
                <button type="button" class="btn btn-small" onClick={() => run(() => setPinned(t(), !t().pinned))}><IconPin size={13} />{t().pinned ? "Løsne" : "Fest"}</button>
                <button type="button" class="btn btn-small" title="En ny tråd med hele historikken. Tråden her er som før." onClick={() => run(() => forkThread(t().id))}><IconBranch size={13} />Lag gaffel</button>
                <button type="button" class="btn btn-small" onClick={() => run(() => openInWindow(t()))}><IconWindow size={13} />Åpne i nytt vindu</button>
                <button type="button" class="btn btn-small" onClick={() => run(() => toggleArchived(t()))}><IconArchive size={13} />{t().archived ? "Gjenopprett" : "Arkiver"}</button>
              </div>
          </div>
        </Popover>
      )}
    </Show>
  );
}

const narrowPanes = matchMedia("(max-width: 720px)");
const [panesAsTabs, setPanesAsTabs] = createSignal(narrowPanes.matches);
narrowPanes.addEventListener("change", () => setPanesAsTabs(narrowPanes.matches));
const narrowWindow = matchMedia("(max-width: 860px)");
const [narrow, setNarrow] = createSignal(narrowWindow.matches);
narrowWindow.addEventListener("change", () => setNarrow(narrowWindow.matches));

const away = () => !!room() || profileOpen() || skillsOpen() || (mode() === "chat" && !!chatProjectPageId());
const grid = () => {
  const key = scope();
  return key ? gridFor(key) : null;
};

// Del til høyre, Del nedover, and Lukk ruten for the pane with focus. Always in the same place; they
// are dimmed rather than gone in the Artifacts room. Lukk ruten is here only when there is more than
// one pane and the panes have no head of their own (as tabs in a narrow window); in a wide window
// each pane's head has its own (SPEC 24.1).
function PaneButtons() {
  const count = () => grid()?.count() ?? 1;
  const full = () => count() >= MAX_PANES;
  const split = (side: "right" | "bottom") => {
    const g = grid();
    if (!g || away()) return;
    g.split(g.focused(), side); // At six it says so in a toast.
  };
  const tip = (name: string, keys?: string) => (away() ? `${name}: gå tilbake til trådene først` : full() ? `${name}: høyst ${MAX_PANES} ruter` : keys ? `${name} (${keys})` : name);
  return (
    <div class="topbar-group pane-buttons" role="group" aria-label="Ruter">
      <button
        type="button"
        class="icon-button"
        classList={{ "is-disabled": away() || full() }}
        data-testid="new-pane"
        title={tip("Del til høyre: ny rute ved siden av", displayKeys(keysFor("pane.new")))}
        aria-label="Del til høyre"
        aria-disabled={away() ? "true" : undefined}
        onClick={() => split("right")}
      >
        <IconSplitRight />
      </button>
      <button
        type="button"
        class="icon-button"
        classList={{ "is-disabled": away() || full() }}
        title={tip("Del nedover: ny rute under")}
        aria-label="Del nedover"
        aria-disabled={away() ? "true" : undefined}
        onClick={() => split("bottom")}
      >
        <IconSplitDown />
      </button>
      <Show when={count() > 1 && panesAsTabs() && !away()}>
        <button type="button" class="icon-button" title="Lukk ruten" aria-label="Lukk ruten" onClick={() => grid()?.close(grid()!.focused())}><IconClose /></button>
      </Show>
    </div>
  );
}

// ⋯ Flere valg: what used to stand on the pane's own row, for the pane with focus, and the project's
// less used tools. Never empty: the command palette and the shortcuts are always there.
function MoreMenu() {
  const [anchor, setAnchor] = createSignal<MenuAnchor | null>(null);
  createEffect(() => { if (away()) setAnchor(null); });
  const entries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    const project = mode() === "code" && !away() ? currentProject() : undefined;
    const thread = away() ? undefined : focusedThread();
    const model = thread ? peekModel(thread.id) : undefined;
    const rows = !!model && (model.chunks().length > 0 || model.hasOlder());
    const g = grid();
    const paneId = g?.focused();
    if (rows && paneId) {
      out.push(
        { label: "Søk i samtalen", icon: IconSearch, hint: displayKeys("Mod+F"), run: () => paneTools.get(paneId)?.search() },
        { label: "Eksporter til Markdown", icon: IconDownload, title: "Lagrer samtalen som en .md-fil", run: () => paneTools.get(paneId)?.exportMarkdown() },
      );
    }
    if (thread?.mode === "code") out.push({ label: "Festet sammendrag", icon: IconPin, toggle: pinnedSummary(), keys: "view.summary", title: "Mål, plan og resultater øverst til høyre i Kode", run: () => setPinnedSummary(!pinnedSummary()) });
    if (g && paneId && thread && !untitled(thread)) {
      out.push({
        label: "Løsriv ruten til eget vindu",
        icon: IconDetach,
        run: () => {
          const entry = g.detach(paneId);
          if (entry) openDetachedWindow(entry);
        },
      });
    }
    if (project) {
      if (out.length) out.push("sep");
      out.push({ label: "Åpne i VS Code", icon: IconCode, title: "Åpne prosjektmappen i VS Code", run: () => openVscode(project.id) });
    }
    if (out.length) out.push("sep");
    out.push(
      { label: "Kommandopalett", icon: IconTerminal, keys: "palette.open", run: () => openPalette() },
      { label: "Hurtigtaster", icon: IconKeyboard, keys: "help.shortcuts", run: actions.shortcuts },
    );
    return out;
  };
  return (
    <>
      <button
        type="button"
        class="icon-button"
        aria-label="Flere valg"
        title="Flere valg"
        aria-haspopup="menu"
        aria-expanded={!!anchor()}
        data-testid="more-options"
        onClick={(e) => setAnchor(anchor() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}
      >
        <IconDots />
      </button>
      <Show when={anchor()}>{(a) => <ContextMenu anchor={a()} label="Flere valg" entries={entries()} onClose={() => setAnchor(null)} class="more-options-menu" />}</Show>
    </>
  );
}

// + Legg til sidepanel: every panel there is, and where it stands. One place to steer the panels from.
function AddPanelMenu() {
  const [anchor, setAnchor] = createSignal<MenuAnchor | null>(null);
  const place = (full: boolean, where?: "right" | "below") => {
    setPanelFull(full);
    if (where) setPlacement(where);
    if (!panelOpen()) setPanelOpen(true);
  };
  // Round 12 (SPEC 26.3): stacked, a tool joins the panels that are open, where Plassering says:
  // in a new column to the right, or under the panel used last. Under is there once a panel is open.
  const stacked = () => stacking();
  const anyOpen = () => stacked() && panelOpen() && stackTools().length > 0;
  const entries = (): MenuEntry[] => [
    { heading: <span class="menu-heading">Sidepanel</span> },
    { label: "Startside", icon: IconPanel, chosen: panelOpen() && onPanelHome(), title: "Åpne verktøyvelgeren", run: showPanelHome },
    ...PANEL_TOOLS.map((tool) => ({
      label: tool.label,
      icon: tool.icon,
      keys: tool.keys,
      chosen: stacked() ? panelOpen() && inStack(tool.id) : shownTool() === tool.id,
      disabled: toolBlocked(tool),
      title: toolBlocked(tool) ? NEEDS_PROJECT_TIP : tool.tip,
      run: () => showPanel(tool.id),
    })),
    "sep",
    { heading: <span class="menu-heading">Plassering</span> },
    {
      label: "Til høyre",
      icon: IconPanel,
      chosen: panelOpen() && !panelFull() && (!anyOpen() || placement() === "right"),
      title: anyOpen() ? "Neste panel får en egen kolonne til høyre" : "Ved siden av samtalen. Under 860 px legger panelet seg over samtalen.",
      run: () => place(false, stacked() ? "right" : undefined),
    },
    ...(anyOpen()
      ? [{ label: "Under", icon: IconSplitDown, chosen: !panelFull() && placement() === "below", title: "Neste panel legger seg under det du brukte sist", run: () => place(false, "below") } as MenuEntry]
      : []),
    { label: "Fullvisning", icon: IconFullView, chosen: panelOpen() && panelFull(), title: "Over hele bredden ved siden av sidefanen", run: () => place(true) },
  ];
  return (
    <>
      <button
        type="button"
        class="icon-button"
        aria-label="Legg til sidepanel"
        title="Legg til sidepanel"
        aria-haspopup="menu"
        aria-expanded={!!anchor()}
        data-testid="add-panel"
        onClick={(e) => setAnchor(anchor() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}
      >
        <IconPanelAdd />
      </button>
      <Show when={anchor()}>{(a) => <ContextMenu anchor={a()} label="Legg til sidepanel" entries={entries()} onClose={() => setAnchor(null)} class="add-panel-menu" />}</Show>
    </>
  );
}

// The separate buttons (Hver for seg): Økt (round 12, SPEC 26.2), then Terminal, Endringer, Nettleser
// and Filer, each on and off. Oversikt is on the start page and in +. Stacked (SPEC 26.3), each
// button opens and closes its own panel beside the others.
const SEPARATE: Array<{ id: "session" | "terminal" | "changes" | "browser" | "files"; on: string; off: string }> = [
  { id: "session", on: "Skjul øktpanel", off: "Vis øktpanel" },
  { id: "terminal", on: "Skjul Terminal", off: "Terminal" },
  { id: "changes", on: "Skjul Endringer", off: "Endringer" },
  { id: "browser", on: "Skjul Nettleser", off: "Nettleser" },
  { id: "files", on: "Skjul Filer", off: "Filer" },
];

// Round 11 (SPEC 24.2): Samlet is ⋯, the panel on and off, a thin line and +. Hver for seg is ⋯ and one
// button per panel, then the line and +. Chat has no panels (SPEC 24.5), so only ⋯ is left there. In
// a narrow window Hver for seg takes too much room, so it is Samlet there.
function PanelButtons() {
  const separate = () => app.settings.panelButtons === "separate" && !narrow();
  const code = () => mode() === "code" && !studioOpen();
  return (
    <div class="topbar-group panel-buttons" role="group" aria-label="Panelknapper" data-style={separate() ? "separate" : "together"}>
      <MoreMenu />
      <Show when={code()}>
        <Show
          when={separate()}
          fallback={
            <button
              type="button"
              class="icon-button panel-toggle"
              classList={{ "is-disabled": away() }}
              title={`Vis eller skjul panelet (${displayKeys(keysFor("view.panel"))})`}
              aria-label="Vis eller skjul panelet"
              aria-pressed={panelOpen() && !away() && !artifactPanel()}
              aria-disabled={away() ? "true" : undefined}
              onClick={() => !away() && togglePanel()}
            >
              <IconPanel />
            </button>
          }
        >
          <For each={SEPARATE}>
            {(item) => {
              const tool = toolById(item.id);
              const on = () => toolOpen(item.id) && !away();
              const blocked = () => toolBlocked(tool);
              return (
                <button
                  type="button"
                  class="icon-button panel-toggle"
                  classList={{ "is-disabled": away() || blocked() }}
                  data-tool={item.id}
                  title={blocked() ? `${tool.label}: ${NEEDS_PROJECT_TIP}` : toolTitle(tool, on() ? item.on : item.off)}
                  aria-label={item.id === "session" ? "Øktpanel" : tool.label}
                  aria-pressed={on()}
                  aria-disabled={away() || blocked() ? "true" : undefined}
                  onClick={() => !away() && !blocked() && toggleTool(item.id)}
                >
                  <tool.icon />
                </button>
              );
            }}
          </For>
        </Show>
        <span class="topbar-divider" aria-hidden="true" />
        <AddPanelMenu />
      </Show>
    </div>
  );
}

export function TopBar() {
  const project = currentProject;
  const running = createMemo(() => {
    const p = project();
    return p && mode() === "code" ? runningInProject(p.id) : 0;
  });
  const playtest = createMemo(() => {
    const p = project();
    return p ? app.playtest[p.id] : undefined;
  });
  const playing = () => playtest()?.status === "running" || playtest()?.status === "starting";
  // The row of icons has its own Vis sidefanen (SPEC 24.1), so it is not here as well. Below 860 px
  // there is no row, and the button is back.
  const railShown = () => !sidebarOpen() && railEnabled() && !narrow();

  return (
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-nav">
          <MainMenu />
          <Show when={!railShown()}>
            <button type="button" class="icon-button" title={`Sidefane (${displayKeys(keysFor("view.sidebar"))})`} aria-label="Vis eller skjul sidefanen" aria-pressed={sidebarOpen()} onClick={() => setSidebarOpen(!sidebarOpen())}><IconSidebar /></button>
          </Show>
          <button type="button" class="icon-button" title={`Tilbake (${displayKeys(keysFor("thread.back"))})`} aria-label="Forrige tråd" disabled={!actions.canGoBack()} onClick={actions.back}><IconBack /></button>
          <button type="button" class="icon-button" title={`Frem (${displayKeys(keysFor("thread.forward"))})`} aria-label="Neste tråd" disabled={!actions.canGoForward()} onClick={actions.forward}><IconForward /></button>
        </div>
        <Show when={!sidebarOpen()}><StartCrumb /></Show>
      </div>
      <div class="topbar-mid">
        {/* With the sidebar open the left column is only as wide as the sidebar, so the crumb stands
            where the main area starts instead, with room for the project's whole name. */}
        <Show when={sidebarOpen()}><StartCrumb /></Show>
        <ModeSwitch class="topbar-mode" />
        <Show when={skillsOpen()}><span class="topbar-title-button" data-testid="topbar-workspace-title">Skills</span></Show>
        <ThreadTitle />
        <OriginTag />
      </div>
      <div class="topbar-right">
        <button type="button" class="icon-button" title="Tema og mods" aria-label="Tema og mods" data-testid="ui-mods-button" onClick={()=>setModsOpen(true)}><IconPalette size={16}/></button>
        <Show when={mode() === "code" && project()}>
          <div class="project-label" title={project()!.path}>
            <ProjectGlyph project={project()!} size={14} /><span class="project-name">{project()!.name}</span>
          </div>
          <Show when={running() > 0}>
            <button type="button" class="top-chip danger" data-testid="stop-all" title="Stopper alle tråder i prosjektet" aria-label={`Stopp alt (${running()})`} onClick={() => stopAll(project()!.id).catch(report)}>
              <IconStop size={12} /><span class="hide-small">Stopp alt</span><span class="count">{running()}</span>
            </button>
          </Show>
          <Show
            when={!playing()}
            fallback={
              <button
                type="button"
                class="top-chip playtest-chip"
                data-state={playtest()?.status}
                title={playtest()?.status === "starting" ? "Playtest starter. Trykk for å stoppe." : `Playtest kjører${playtest()?.url ? ` på ${playtest()!.url}` : ""}. Trykk for å stoppe.`}
                aria-label="Stopp playtest"
                onClick={() => stopPlaytest(project()!.id)}
              >
                <span class="playtest-dot" aria-hidden="true" /><span class="playtest-label">Playtest</span><span class="playtest-stop" aria-hidden="true"><IconStop size={11} />Stopp</span>
              </button>
            }
          >
            <button type="button" class="icon-button" title="Playtest: start prosjektet og åpne det i Nettleser-panelet" aria-label="Playtest" onClick={() => startPlaytest(project()!.id)}><IconPlay /></button>
          </Show>
        </Show>
        <Show when={mode() === "code" && !away() && pinnedSummary()}><PinnedSummary thread={focusedThread()} /></Show>
        <PaneButtons />
        <span class="topbar-divider" aria-hidden="true" />
        <PanelButtons />
        {/* The window controls of the Electron version (minimise, maximise, close), right of the panel
            buttons. Empty and without width in a browser (WindowControls.tsx). */}
        <WindowControls />
      </div>
    </header>
  );
}

// On a start page, where the thread has no name yet, the left of the top bar says where you are:
// Kode › the project (or Denne datamaskinen), and a click on the project opens the project picker
// beside this trigger, for the focused pane. In Chat it is just Chat. With a named thread the name
// in the middle says it.
function StartCrumb() {
  const show = () => !away() && untitled(focusedThread());
  const paneKey = () => focusedThreadId() ?? grid()?.focused() ?? null;
  const project = () => (mode() === "code" ? currentProject() : undefined);
  const picker = useProjectPicker(paneKey, "topbar");
  let trigger: HTMLButtonElement | undefined;
  createEffect(() => { if (!show() || narrow()) picker.close(); });
  return (
    <Show when={show()}>
      <nav class="topbar-crumb" aria-label="Hvor du er" data-testid="topbar-crumb">
        <span class="crumb-mode">
          <Show when={mode() === "code"} fallback={<><IconChat size={14} />Chat</>}>
            <Show when={studioOpen()} fallback={<><IconCode size={14} />Kode</>}><IconStudio size={14} />Kode Studio</Show>
          </Show>
        </span>
        <Show when={mode() === "code"}>
          <span class="crumb-sep" aria-hidden="true"><IconChevron size={11} /></span>
          <Popover
            class="crumb-project-anchor"
            fixed portal below returnFocus
            open={picker.open()}
            onClose={picker.close}
            trigger={<button
            type="button"
            class="crumb-project"
            data-testid="topbar-project-picker"
            ref={trigger}
            aria-haspopup="dialog"
            aria-expanded={picker.open()}
            title={project() ? `${project()!.path}: bytt prosjekt` : "Velg prosjekt"}
            onPointerDown={(event) => { if (picker.open()) event.preventDefault(); }}
            onClick={(event) => { const closing = picker.open(); picker.toggle(); if (closing) event.currentTarget.focus({ preventScroll: true }); }}
            onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); picker.show(); } }}
          >
            <Show when={project()} fallback={<><IconLaptop size={13} /><span>Denne datamaskinen</span></>}>
              {(p) => <><ProjectGlyph project={p()} size={13} /><span>{p().name}</span></>}
            </Show>
            <IconChevronDown size={11} />
          </button>}
          >
            <ProjectPicker current={project()?.id ?? null} paneKey={paneKey()!} onDone={picker.close} onCancel={() => { picker.close(); trigger?.focus({ preventScroll: true }); }} />
          </Popover>
        </Show>
      </nav>
    </Show>
  );
}

// With one pane its head is gone (SPEC 24.1), so «Laget av …» stands beside the name up here.
// Round 14 (SPEC 30.3): a fork shows where it came from the same way.
function OriginTag() {
  const solo = () => {
    const g = grid();
    return !!g && g.count() <= 1 && !away();
  };
  const parent = createMemo(() => {
    if (!solo()) return undefined;
    const id = focusedThread()?.parentThreadId;
    return id ? app.threads[id] : undefined;
  });
  const fork = createMemo(() => (solo() && !parent() && forkSource(focusedThread()) ? focusedThread() : undefined));
  return (
    <>
      <Show when={parent()}>
        {(p) => (
          <button type="button" class="origin-tag topbar-origin" title={`Laget av ${p().title}`} onClick={() => void openThread(p())}>
            <IconBranch size={12} /><span>{p().title}</span>
          </button>
        )}
      </Show>
      <Show when={fork()}>
        {(t) => (
          <button type="button" class="origin-tag topbar-origin" data-testid="fork-origin" title={`Gaffel av ${forkSourceTitle(t())}. Trykk for å åpne den.`} onClick={() => void openForkSource(t())}>
            <IconBranch size={12} /><span>{forkSourceTitle(t())}</span>
          </button>
        )}
      </Show>
    </>
  );
}
