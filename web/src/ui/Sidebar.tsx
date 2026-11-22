import { GitHubNavigation } from "./GitHubNavigation";
import { language, plural, t } from "../lib/i18n.ts";
// The sidebar, from the top: the app name, search, notifications and ⋯ in one calm row; Chat and
// Kode; the navigation (new thread, Artifacts, Skills); Festet, shown only when something is pinned;
// the sections made with ⋯ → Ny seksjon; then the mode's own lists. Kode (round 11, SPEC 24.4):
// Chatter, with the projects and their threads (grouped by project or by date, sorted and folded as
// chosen in ⋯), and Denne datamaskinen for Kode threads without a folder. Chat: Prosjekter
// (Chat projects, a name and no folder), then the chats. The profile and the gear
// are at the bottom; the version is only in Innstillinger (SPEC 21.6). Threads
// have a menu on right-click and ⋯, and threads and projects show a card on hover. Settings can
// switch the middle part to the smart sidebar.
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { del, get, patch } from "../lib/api";
import { relativeTime } from "../lib/format";
import { connection } from "../lib/socket";
import type { ChatProject, Project, Thread } from "../../../shared/protocol";
import {
  app, collapsed, listed, setApp, mode, projectId, renameThread, report, scope, setFolderPickerOpen, setSettingsOpen, setSidebarWidth,
  setSidebarOpen, setMode, setProjectId, settingsOpen, sortedProjects, toast, toggleCollapsed,
} from "../state/app";
import { applyDrop, beginDrag, sectionTarget } from "../state/drag";
import { gridFor } from "../state/grid";
import { newChatIn, newThreadIn, openChatProject, openThread, preloadThread } from "../state/navigate";
import { onNextFrame } from "../lib/frame";
import { confirmDialog } from "./dialogs";
import { editChatProject, newChatProject, removeChatProject } from "./chat-projects";
import {
  IconArtifact, IconBell, IconBranch, IconChevron, IconClose, IconCompose, IconDots, IconHelp, IconPlus, IconPlusCircle, IconSearch,
  IconSettings, IconSpark, IconWarn, IconCheck,
} from "./icons";
import { artifactCount, closeArtifacts, openArtifacts, room } from "../state/artifacts";
import { actions } from "../state/actions";
import { skillsOpen } from "../state/skills-workspace";
import { displayKeys, keysFor } from "../state/shortcuts";
import { clearFinished, finished, gitInfo, loadGitInfo, markSeen, searchOpen, setSearchOpen } from "../state/home";
import { modelProvider, ProviderGlyph } from "./ProviderGlyph";
import { STATE_LABEL, threadState, waitingCount } from "../state/thread-status";
import { Popover } from "./Popover";
import { ProjectGlyph } from "./ProjectGlyph";
import { ChatProjectGlyph } from "./ChatProjectGlyph";
import { ModeSwitch } from "./ModeSwitch";
import { startBackground } from "../state/actions";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "./ContextMenu";
import { threadMenuEntries } from "./ThreadMenu";
import { hideHoverCard, hoverIn, hoverOut, suppressHoverCards } from "./HoverCard";
import { openEditProject } from "./dialog-state";
import { preloadSettings } from "./lazy-views";
import { githubRoom, chatProjectPageId, closeProfile, openProfile, profileOpen } from "../state/nav";
import { IconInfo, IconKeyboard, IconSun, IconTerminal, IconUser, IconPencil as IconEdit, IconPlusCircle as IconAddRun, IconPin as IconPinned, IconTrash as IconRemove } from "./icons";
import { homeStats, loadHomeStats, runsFinished } from "../state/home";
import { formatTokens } from "../lib/format";
import { effectiveProjectOrder, LOCAL_SCOPE, modelName, projectGroup, scopeOf, setAllCollapsed, setProjectGroup, setProjectSort, sortedChatProjects, type ProjectSort } from "../state/app";
import { moveToSection, sectionsFor, setShowPinned, setShowProjects, showPinned, showProjects } from "../state/app";
import type { SidebarSection } from "../../../shared/protocol";
import { deleteSection, newSection, renameSection } from "./sidebar-sections";
import { IconFolderPlus } from "./nav-icons";
import { IconSidebar, IconSort } from "./icons";
import { setInfoDialog } from "./dialogs";
import { SmartSidebar } from "./SmartSidebar";
import { IconSnooze } from "./nav-icons";
import { IconFoldAll, IconMonitor, IconUnfoldAll } from "./icons";
import { setSnoozed } from "../state/thread-actions";
import { forkSourceTitle } from "../state/fork";
import { archiveMany, openArchive } from "../state/archive";
import { IconArchive, IconCopy, IconFolder } from "./icons";
import { showPanel } from "../state/panel";

// Round 14 (SPEC 30.4): a project's threads, live and archived, for its menu.
const liveIn = (key: { projectId?: string; chatProjectId?: string }) =>
  Object.values(app.threads).filter((t) => t && !t.archived && !t.temporary && (key.projectId ? t.projectId === key.projectId : t.chatProjectId === key.chatProjectId && !t.projectId)).length;
const archivedIn = (key: { projectId?: string; chatProjectId?: string }) =>
  Object.values(app.threads).filter((t) => t?.archived && (key.projectId ? t.projectId === key.projectId : t.chatProjectId === key.chatProjectId && !t.projectId)).length;

const narrowSidebar = matchMedia("(max-width: 860px)");
export const DEFAULT_SIDEBAR_WIDTH = 280;
const PROJECTS_SHOWN = 6;
const THREADS_SHOWN = 10;

// The clock for snoozed threads. It moves only when a snooze runs out (one timer, see Sidebar), so
// a snoozed row wakes up by itself and nothing ticks while nothing is snoozed.
const [snoozeNow, setSnoozeNow] = createSignal(Date.now());
export const isSnoozed = (t: Thread, now = snoozeNow()) => !!t.snoozedUntil && t.snoozedUntil > now;
const snoozeLabel = (at: number) =>
  t("Utsatt til {time}", { time: new Date(at).toLocaleString(language(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) });

export function afterPick(): void {
  if (narrowSidebar.matches) setSidebarOpen(false);
}

export function initials(name: string | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return t("Du");
  return words.map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function ThreadItem(props: { thread: Thread; active: boolean; depth?: number; showProject?: boolean }) {
  const { thread } = props;
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  const [renaming, setRenaming] = createSignal(false);
  const [pinBusy, setPinBusy] = createSignal(false);
  const parent = createMemo(() => (thread.parentThreadId ? app.threads[thread.parentThreadId] : undefined));
  let row!: HTMLDivElement;
  // v1.2.0: under the title of a Kode thread, the branch of its project and the kind of model.
  // The branch is read once for the project (home.ts throttles it), never per row.
  const inProject = () => thread.mode === "code" && !!thread.projectId && !!app.projects[thread.projectId];
  createEffect(() => { if (inProject()) loadGitInfo(thread.projectId!); });
  const branch = () => (inProject() ? gitInfo(thread.projectId!)?.branch ?? null : null);
  const provider = createMemo(() => (thread.mode === "code" ? modelProvider(thread.modelId) : null));
  // Done and not looked at yet: «Ferdig» in green, where the age would be.
  const done = () => threadState(thread, false) === "new";

  const open = () => {
    markSeen(thread.id);
    void openThread(thread);
    afterPick();
  };

  const startDrag = (event: PointerEvent) => {
    hideHoverCard();
    if ((event.target as HTMLElement).closest("button.thread-menu, button.thread-pin, button.thread-snooze, input, .popover")) return;
    if (event.button !== 0) return;
    beginDrag(event, {
      source: { kind: "thread", threadId: thread.id, label: thread.title },
      onClick: open,
      onDrop: (source, target) => {
        const key = scope();
        if (!key) return;
        const grid = gridFor(key);
        if (scopeOf(thread) === key) applyDrop(grid, source, target);
        else open(); // A thread only lives in its own project's grid.
      },
      // Round 11: onto a section of its own mode.
      onSection: (id) => {
        const section = app.sections[id];
        if (section && section.mode === thread.mode && thread.sectionId !== id) moveToSection(thread.id, id).catch(report);
      },
    });
  };

  const commit = (input: HTMLInputElement) => {
    setRenaming(false);
    const title = input.value.trim();
    if (title && title !== thread.title) renameThread(thread.id, title).catch(report);
  };

  const showMenu = (anchor: MenuAnchor) => {
    suppressHoverCards(true);
    setMenu(anchor);
  };
  const closeMenu = () => {
    setMenu(null);
    suppressHoverCards(false);
  };
  createEffect(() => { if (settingsOpen()) closeMenu(); });

  const togglePin = async () => {
    if (pinBusy()) return;
    const focus = row.contains(document.activeElement) && document.activeElement?.classList.contains("thread-pin");
    setPinBusy(true);
    try {
      const saved = await patch<Thread>(`/api/threads/${thread.id}`, { pinned: !thread.pinned });
      if (app.threads[thread.id]) setApp("threads", thread.id, "pinned", saved.pinned);
      if (saved.pinned) setShowPinned(true);
      if (focus) requestAnimationFrame(() => {
        const item = document.querySelector<HTMLElement>(`[data-thread-item="${CSS.escape(thread.id)}"]`);
        item?.querySelector<HTMLButtonElement>(".thread-text")?.focus({ preventScroll: true });
        item?.querySelector<HTMLButtonElement>(".thread-pin")?.focus({ preventScroll: true });
      });
    } catch (error) {
      report(error);
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <div
      ref={row}
      class="thread-item"
      classList={{ active: props.active, archived: thread.archived, pinned: thread.pinned, child: (props.depth ?? 0) > 0, "menu-open": !!menu(), snoozed: isSnoozed(thread) }}
      style={props.depth ? `--depth:${props.depth}` : undefined}
      data-thread-item={thread.id}
      onPointerDown={startDrag}
      onPointerEnter={() => {
        preloadThread(thread.id);
        hoverIn("thread", thread.id, row);
      }}
      onPointerLeave={hoverOut}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <StatusDot thread={thread} />
      <Show
        when={!renaming()}
        fallback={
          <input
            class="input rename"
            aria-label={t("Nytt navn")}
            value={thread.title}
            ref={(el) => setTimeout(() => el.select())}
            onBlur={(e) => commit(e.currentTarget)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit(e.currentTarget);
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        }
      >
        {/* The pointer goes through the drag handler above. detail is 0 for Enter and Space. */}
        <button
          type="button"
          class="thread-text"
          aria-current={props.active ? "true" : undefined}
          onClick={(e) => {
            if (e.detail === 0) open();
          }}
        >
          <Show when={props.showProject && thread.projectId ? app.projects[thread.projectId] : undefined}>
            {(p) => <span class="thread-project" title={p().name}><ProjectGlyph project={p()} size={12} /></span>}
          </Show>
          {/* Round 14 (SPEC 30.3): a fork has a small fork mark; the hover card links back. */}
          <Show when={thread.forkedFrom}>
            <span class="thread-fork" title={t("Gaffel av {title}", { title: forkSourceTitle(thread) })} aria-label={t("Gaffel av {title}.", { title: forkSourceTitle(thread) })}><IconBranch size={12} /></span>
          </Show>
          <span class="thread-title">{thread.title}</span>
          <Show when={thread.origin === "agent"}>
            <span class="thread-origin"><IconBranch size={11} />{parent() ? t("Laget av {title}", { title: parent()!.title }) : t("Laget av en agent")}</span>
          </Show>
          <Show when={provider()}>
            {(info) => (
              <span class="thread-meta" data-testid="thread-meta">
                <span class="thread-provider" title={`${info().label} · ${modelName(thread.modelId)}`}><ProviderGlyph family={info().family} size={11} /></span>
                <Show when={branch()}>{(name) => <span class="thread-branch" title={t("Gren: {name}", { name: name() })}><IconBranch size={10} /><span>{name()}</span></span>}</Show>
              </span>
            )}
          </Show>
        </button>
      </Show>
      <Show when={waitingCount(thread) > 0}>
        <span class="badge" title={STATE_LABEL.waiting}><IconWarn size={11} />{waitingCount(thread)}</span>
      </Show>
      <Show
        when={isSnoozed(thread)}
        fallback={<Show when={done()} fallback={<span class="thread-time">{relativeTime(thread.updatedAt)}</span>}><span class="thread-time thread-done" title={t("Ferdig, og du har ikke sett svaret")}>{t("Ferdig")}</span></Show>}
      >
        <button type="button" class="thread-snooze" title={t("{snooze}. Trykk for å hente den tilbake.", { snooze: snoozeLabel(thread.snoozedUntil!) })} aria-label={t("{snooze}. Hent tilbake", { snooze: snoozeLabel(thread.snoozedUntil!) })} onClick={() => setSnoozed(thread, null)}>
          <IconSnooze size={13} />
        </button>
      </Show>
      <button type="button" class="icon-button thread-pin" aria-label={thread.pinned ? t("Løsne tråden") : t("Fest tråden")} aria-pressed={thread.pinned} title={thread.pinned ? t("Løsne fra Festet") : t("Fest øverst i sidefanen")} disabled={pinBusy()} onClick={() => void togglePin()}>
        <IconPinned size={14} />
      </button>
      <button
        type="button"
        class="icon-button thread-menu"
        aria-label={t("Valg for tråden")}
        title={t("Valg for tråden: gi nytt navn, fest, sidechat, kopier og mer")}
        aria-haspopup="menu"
        aria-expanded={!!menu()}
        onClick={(e) => (menu() ? closeMenu() : showMenu({ x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() }))}
      >
        <IconDots size={14} />
      </button>
      <Show when={menu()}>
        {(anchor) => <ContextMenu anchor={anchor()} label={t("Valg for {title}", { title: thread.title })} entries={threadMenuEntries(thread, () => setRenaming(true))} onClose={closeMenu} class="thread-context-menu" />}
      </Show>
    </div>
  );
}

// Running, waiting for an answer, failed or stopped: the dot says which, so background
// instances can be followed from here.
function StatusDot(props: { thread: Thread }) {
  const state = () => threadState(props.thread, false);
  return <span class="thread-dot" classList={{ running: state() === "running" }} data-state={state()} title={STATE_LABEL[state()] || undefined} />;
}

// Instances made by another instance hang under it, so the link to the main one shows. Long
// lists stop at a few threads, but never hide one that is open, running or waiting, or its
// ancestors in this list. Parents placed in Festet or another section keep their own place.
function ThreadTree(props: { threads: Thread[]; activeIds: ReadonlySet<string>; limit?: number }) {
  const [all, setAll] = createSignal(false);
  const tree = createMemo(() => {
    const ids = new Set(props.threads.map((t) => t.id));
    const children = new Map<string, Thread[]>();
    const roots: Thread[] = [];
    for (const thread of props.threads) {
      if (thread.parentThreadId && ids.has(thread.parentThreadId)) {
        const list = children.get(thread.parentThreadId) ?? [];
        list.push(thread);
        children.set(thread.parentThreadId, list);
      } else roots.push(thread);
    }
    const out: Array<{ thread: Thread; depth: number }> = [];
    const walk = (thread: Thread, depth: number) => {
      out.push({ thread, depth: Math.min(depth, 3) });
      for (const child of children.get(thread.id) ?? []) walk(child, depth + 1);
    };
    for (const root of roots) walk(root, 0);
    return out;
  });
  const shown = createMemo(() => {
    const limit = props.limit;
    if (!limit || all() || tree().length <= limit + 2) return tree();
    const entries = tree();
    const byId = new Map(entries.map(({ thread }) => [thread.id, thread]));
    const retained = new Set<string>();
    for (const [i, { thread }] of entries.entries()) {
      if (i >= limit && !props.activeIds.has(thread.id) && !thread.running && thread.pendingApprovals <= 0) continue;
      let ancestor: Thread | undefined = thread;
      while (ancestor && !retained.has(ancestor.id)) {
        retained.add(ancestor.id);
        ancestor = ancestor.parentThreadId ? byId.get(ancestor.parentThreadId) : undefined;
      }
    }
    return entries.filter(({ thread }) => retained.has(thread.id));
  });
  return (
    <>
      <For each={shown()}>{(entry) => <ThreadItem thread={entry.thread} depth={entry.depth} active={props.activeIds.has(entry.thread.id)} />}</For>
      <Show when={shown().length < tree().length || all()}>
        <button type="button" class="show-more" onClick={() => setAll(!all())}>{all() ? t("Vis færre") : t("Vis flere ({count})", { count: tree().length - shown().length })}</button>
      </Show>
    </>
  );
}

// In Chat a project is one row: its threads belong to Kode, and the row takes you there.
function ProjectGroup(props: { project: Project; threads: Thread[]; activeIds: ReadonlySet<string>; headOnly?: boolean }) {
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  const closeMenu = () => { setMenu(null); suppressHoverCards(false); };
  const showMenu = (anchor: MenuAnchor) => { suppressHoverCards(true); setMenu(anchor); };
  onCleanup(() => { if (menu()) suppressHoverCards(false); });
  createEffect(() => { if (settingsOpen()) closeMenu(); });
  const entries = (): MenuEntry[] => [
    { label: props.project.pinned ? t("Løsne prosjektet") : t("Fest prosjektet"), icon: IconPinned, run: () => patch<Project>(`/api/projects/${props.project.id}`, { pinned: !props.project.pinned }).then((project) => { setApp("projects", project.id, project); if (project.pinned) setShowPinned(true); }).catch(report) },
    { label: t("Rediger prosjekt…"), icon: IconEdit, run: () => openEditProject(props.project.id) },
    { label: t("Ny bakgrunnstråd…"), icon: IconAddRun, disabled: !!props.project.folderMissing, run: () => void startBackground(props.project.id) },
    "sep",
    { label: t("Vis prosjektfiler"), icon: IconFolder, disabled: !!props.project.folderMissing, title: t("Åpne prosjektets filer i appens sidepanel"), run: () => { setProjectId(props.project.id); setMode("code"); showPanel("files"); afterPick(); } },
    { label: t("Kopier prosjektsti"), icon: IconCopy, run: () => navigator.clipboard.writeText(props.project.path).then(() => toast(t("Kopierte prosjektstien."), "info")).catch(() => toast(t("Kunne ikke kopiere prosjektstien."), "error")) },
    "sep",
    { label: t("Arkiver alle trådene"), icon: IconArchive, disabled: !liveIn({ projectId: props.project.id }), title: t("Trådene forsvinner fra sidefanen, men ingenting slettes. Du kan angre etterpå."), run: () => void archiveMany({ projectId: props.project.id }, `«${props.project.name}»`) },
    ...(archivedIn({ projectId: props.project.id }) ? [{ label: t("Vis arkiverte ({count})", { count: archivedIn({ projectId: props.project.id }) }), icon: IconArchive, run: () => openArchive({ kind: "project", id: props.project.id }) } as MenuEntry] : []),
    "sep",
    { label: t("Fjern prosjektet…"), icon: IconRemove, danger: true, run: async () => {
      const ok = await confirmDialog({ title: t("Fjerne prosjektet?"), text: t("«{name}» og trådene fjernes fra appen. Mappen på disken røres aldri.", { name: props.project.name }), confirm: t("Fjern"), danger: true });
      if (ok) del(`/api/projects/${props.project.id}`).catch(report);
    } },
  ];
  const isCollapsed = () => props.headOnly || collapsed().includes(props.project.id);
  const pending = () => props.threads.reduce((sum, t) => sum + waitingCount(t), 0);
  const selected = () => mode() === "code" && projectId() === props.project.id && !room() && !skillsOpen() && !githubRoom();
  let head!: HTMLDivElement;
  return (
    <div class="group" data-project={props.project.name}>
      <div
        class="group-head"
        classList={{ active: selected() }}
        ref={(el) => (head = el)}
        onPointerEnter={() => hoverIn("project", props.project.id, head)}
        onPointerLeave={hoverOut}
        onPointerDown={hideHoverCard}
        onContextMenu={(event) => { event.preventDefault(); showMenu({ x: event.clientX, y: event.clientY }); }}
      >
        <Show
          when={!props.headOnly}
          fallback={<span class="group-toggle group-glyph" aria-hidden="true"><ProjectGlyph project={props.project} size={16} /></span>}
        >
          <button type="button" class="group-toggle" aria-expanded={!isCollapsed()} aria-label={isCollapsed() ? t("Vis tråder") : t("Skjul tråder")} title={isCollapsed() ? t("Vis trådene i prosjektet") : t("Skjul trådene i prosjektet")} onClick={() => toggleCollapsed(props.project.id)}>
            <ProjectGlyph project={props.project} size={16} open={!isCollapsed()} />
            <span class="fold-chevron" classList={{ open: !isCollapsed() }}><IconChevron size={12} /></span>
          </button>
        </Show>
        <button
          type="button"
          class="group-title"
          onClick={() => {
            setProjectId(props.project.id);
            setMode("code");
            afterPick();
          }}
        >
          <span>{props.project.name}</span>
        </button>
        <Show when={props.project.folderMissing}>
          <span class="folder-badge" data-testid="folder-badge" title={t("Fant ikke mappen {path}. Åpne en tråd i prosjektet for å velge mappen på nytt.", { path: props.project.path })} aria-label={t("Fant ikke mappen")}><IconWarn size={12} /></span>
        </Show>
        <Show when={isCollapsed() && pending() > 0}><span class="badge" title={t("Venter på godkjenning")}>{pending()}</span></Show>
        <span class="group-actions" classList={{ open: !!menu() }}>
          <button type="button" class="icon-button" aria-label={t("Valg for prosjektet")} title={t("Valg for prosjektet")} aria-haspopup="menu" aria-expanded={!!menu()} onClick={(event) => menu() ? closeMenu() : showMenu({ x: 0, y: 0, rect: event.currentTarget.getBoundingClientRect() })}><IconDots size={14} /></button>
          <Show when={menu()}>{(anchor) => <ContextMenu anchor={anchor()} label={t("Valg for {name}", { name: props.project.name })} entries={entries()} onClose={closeMenu} class="project-context-menu" />}</Show>
          {/* Round 12 (SPEC 26.1): no new threads while the folder is gone; the tip says what to do. */}
          <button
            type="button"
            class="icon-button"
            classList={{ "is-disabled": !!props.project.folderMissing }}
            title={props.project.folderMissing ? t("Mappen mangler. Åpne en tråd i prosjektet og velg mappen på nytt for å lage nye tråder.") : t("Ny tråd i prosjektmappen")}
            aria-label={t("Ny tråd i {name}", { name: props.project.name })}
            aria-disabled={props.project.folderMissing ? "true" : undefined}
            data-testid="project-new-thread"
            onClick={() => {
              if (props.project.folderMissing) return;
              void newThreadIn(props.project.id);
              afterPick();
            }}
          >
            <IconPlus size={14} />
          </button>
        </span>
      </div>
      <Show when={!isCollapsed()}>
        <div class="group-body">
          <Show
            when={props.threads.length}
            fallback={
              <Show when={selected()}>
                <div class="sidebar-empty">
                  <span>{t("Ingen tråder")}</span>
                  {/* Round 14 (SPEC 30.4): the archived ones are a click away. */}
                  <Show when={archivedIn({ projectId: props.project.id })}>
                    <button type="button" class="sidebar-empty-link" onClick={() => openArchive({ kind: "project", id: props.project.id })}>{plural(archivedIn({ projectId: props.project.id }), "{count} arkivert", "{count} arkiverte")}</button>
                  </Show>
                </div>
              </Show>
            }
          >
            <ThreadTree threads={props.threads} activeIds={props.activeIds} limit={THREADS_SHOWN} />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// Approvals that wait, and threads that finished while you looked elsewhere.
export function Notifications(props: { rail?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const waiting = createMemo(() => Object.values(app.threads).filter((t): t is Thread => listed(t) && waitingCount(t) > 0 && !t.archived));
  const done = createMemo(() => finished().map((id) => app.threads[id]).filter(listed));
  const count = () => waiting().length + done().length;
  const go = (thread: Thread) => {
    setOpen(false);
    markSeen(thread.id);
    void openThread(thread);
    afterPick();
  };
  return (
    <Popover
      open={open()}
      onClose={() => setOpen(false)}
      fixed
      below
      class="notifications"
      trigger={
        <button type="button" class="icon-button" classList={{ "rail-button": props.rail }} aria-label={count() ? t("Varsler ({count})", { count: count() }) : t("Varsler")} title={t("Varsler")} aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}>
          <IconBell size={16} />
          <Show when={count()}><span class="notify-dot" data-testid="notify-count">{count()}</span></Show>
        </button>
      }
    >
      <div class="menu-list notify-list" role="list" aria-label={t("Varsler")}>
        <Show when={count()} fallback={<div class="menu-empty">{t("Ingen varsler. Spørsmål, godkjenninger og tråder som blir ferdige, havner her.")}</div>}>
          <Show when={waiting().length}>
            <div class="menu-heading">{t("Venter på deg")}</div>
            <For each={waiting()}>
              {(thread) => (
                <button type="button" class="menu-item notify-item" onClick={() => go(thread)}>
                  <span class="notify-icon waiting"><IconWarn size={13} /></span>
                  <span class="menu-name">{thread.title}</span>
                  <span class="menu-tag">{thread.pendingQuestions
                    ? thread.pendingApprovals
                      ? t("{questions} spørsmål · {approvals} godkjenninger", { questions: thread.pendingQuestions, approvals: thread.pendingApprovals })
                      : t("{count} spørsmål", { count: thread.pendingQuestions })
                    : plural(thread.pendingApprovals, "{count} godkjenning", "{count} godkjenninger")}</span>
                </button>
              )}
            </For>
          </Show>
          <Show when={done().length}>
            <div class="menu-heading">{t("Uleste")}</div>
            <For each={done()}>
              {(thread) => (
                <button type="button" class="menu-item notify-item" onClick={() => go(thread)}>
                  <span class="notify-icon"><IconCheck size={13} /></span>
                  <span class="menu-name">{thread.title}</span>
                  <span class="menu-tag">{relativeTime(thread.updatedAt)}</span>
                </button>
              )}
            </For>
            <button type="button" class="menu-item menu-quiet" onClick={() => { clearFinished(); setOpen(false); }}>{t("Merk alle som sett")}</button>
          </Show>
        </Show>
      </div>
    </Popover>
  );
}

const CONNECTION: Record<string, string> = {
  get connecting() { return t("Kobler til…"); },
  get online() { return t("Tilkoblet"); },
  get offline() { return t("Frakoblet, prøver igjen"); },
  get expired() { return t("Økten er utløpt"); },
};


// The profile at the bottom of the sidebar opens this menu: the profile page, Settings, the
// shortcuts and help.
const THEMES: Array<{ id: "light" | "dark" | "system"; label: string }> = [
  { id: "light", get label() { return t("Lys"); } },
  { id: "dark", get label() { return t("Mørk"); } },
  { id: "system", get label() { return t("System"); } },
];

// rail: only the avatar, in the thin row of icons (SPEC 23.9).
export function ProfileMenu(props: { rail?: boolean }) {
  const [anchor, setAnchor] = createSignal<MenuAnchor | null>(null);
  const profileName = () => app.settings.profileName?.trim() || t("Profil");
  // Under the name: the default model and the last seven days, from the statistics. Fetched again
  // each time the menu opens after a run has ended. A week with runs but no counted tokens (a
  // provider that does not report usage) says how many threads were used, not «0 tokens».
  const subline = () => {
    const week = homeStats("7d");
    const model = modelName(null);
    if (week?.totalTokens) return t("{model} · {tokens} tokens siste 7 dager", { model, tokens: formatTokens(week.totalTokens) });
    if (week?.sessions) return plural(week.sessions, "{model} · {count} tråd siste 7 dager", "{model} · {count} tråder siste 7 dager", { model });
    return week ? t("{model} · ingen bruk siste 7 dager", { model }) : model;
  };
  // While the menu is open, a run that ends updates the line under the name.
  createEffect(on(runsFinished, () => {
    if (untrack(anchor)) loadHomeStats("7d", true);
  }, { defer: true }));
  const entries = (): MenuEntry[] => [
    {
      heading: (
        <div class="profile-menu-head">
          <span class="avatar" aria-hidden="true">{initials(app.settings.profileName)}</span>
          <span class="profile-text"><span class="profile-name">{profileName()}</span><span class="profile-version" data-testid="profile-menu-sub">{subline()}</span></span>
        </div>
      ),
    },
    "sep",
    { label: t("Profil"), icon: IconUser, run: () => { closeArtifacts(); openProfile(); afterPick(); } },
    { label: t("Innstillinger"), icon: IconSettings, keys: "settings.open", run: () => setSettingsOpen("general") },
    { label: t("Versjonslogg"), icon: IconSpark, run: () => setInfoDialog("releases") },
    { label: t("Hurtigtaster"), icon: IconKeyboard, keys: "help.shortcuts", run: actions.shortcuts, title: t("Se hurtigtastene. De endres i Innstillinger → Hurtigtaster.") },
    "sep",
    {
      custom: () => (
        <div class="profile-theme-row" role="group" aria-label={t("Tema")}>
          <IconSun size={15} />
          <span class="menu-name">{t("Tema")}</span>
          <span class="profile-theme-switch">
            <For each={THEMES}>
              {(theme) => (
                <button type="button" class="menu-item profile-theme-option" role="menuitemradio" aria-checked={app.settings.theme === theme.id} onClick={() => actions.theme(theme.id)}>
                  {theme.label}
                </button>
              )}
            </For>
          </span>
        </div>
      ),
    },
    "sep",
    {
      label: t("Hjelp"),
      icon: IconHelp,
      children: [
        { label: t("Kommandoer"), icon: IconTerminal, run: actions.commands },
        { label: t("Hva er nytt"), icon: IconSpark, run: () => setInfoDialog("whatsnew") },
        { label: t("Om Agentic Desktop"), icon: IconInfo, run: actions.about },
      ],
    },
  ];
  return (
    <>
      <button
        type="button"
        class="profile-button"
        classList={{ "rail-button": props.rail, "rail-avatar": props.rail }}
        title={t("Profil, innstillinger og hjelp")}
        aria-label={t("Profil")}
        aria-haspopup="menu"
        aria-expanded={!!anchor()}
        aria-pressed={profileOpen()}
        onClick={(e) => {
          if (anchor()) return setAnchor(null);
          // Always fresh: a run that ended a moment ago may not have been counted yet when the
          // statistics were last fetched, and the menu showed «0 tokens» until the cache ran out.
          loadHomeStats("7d", true);
          // Round 10 (SPEC 23.6): the menu stays inside the sidebar, as wide as it less a margin on
          // each side, so it ends at the edge instead of reaching over the conversation. Hjelp ›
          // still opens to the side.
          const button = e.currentTarget.getBoundingClientRect();
          const side = e.currentTarget.closest(".sidebar")?.getBoundingClientRect();
          const margin = 8;
          const rect = side ? new DOMRect(side.left + margin, button.top, side.width - margin * 2, button.height) : button;
          setAnchor({ x: 0, y: 0, rect, alignLeft: true, above: true, width: side ? side.width - margin * 2 : undefined });
        }}
      >
        <span class="avatar avatar-small" aria-hidden="true">
          {initials(app.settings.profileName)}
          <span class="connection-dot" data-testid="connection" data-state={connection()} title={CONNECTION[connection()]} />
        </span>
        <Show when={!props.rail}>
          <span class="profile-text">
            <span class="profile-name">{profileName()}</span>
          </span>
        </Show>
      </button>
      <Show when={anchor()}>{(a) => <ContextMenu anchor={a()} label={t("Profilmeny")} entries={entries()} onClose={() => setAnchor(null)} class="profile-menu" />}</Show>
    </>
  );
}

// A Chat project (round 9): a name that gathers chats, with no folder. Folds like a Kode project,
// + starts a chat in it, and ⋯ renames, pins or removes it (the chats stay).
function ChatProjectGroup(props: { project: ChatProject; threads: Thread[]; activeIds: ReadonlySet<string> }) {
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  let head!: HTMLDivElement;
  const closeMenu = () => { setMenu(null); suppressHoverCards(false); };
  const showMenu = (anchor: MenuAnchor) => { suppressHoverCards(true); setMenu(anchor); };
  onCleanup(() => { if (menu()) suppressHoverCards(false); });
  createEffect(() => { if (settingsOpen()) closeMenu(); });
  const key = () => `chat:${props.project.id}`;
  const isCollapsed = () => collapsed().includes(key());
  const selected = () => mode() === "chat" && chatProjectPageId() === props.project.id && !room() && !skillsOpen() && !githubRoom() && !profileOpen();
  const open = () => {
    if (isCollapsed()) toggleCollapsed(key());
    openChatProject(props.project.id);
    afterPick();
  };
  const entries = (): MenuEntry[] => [
    { label: t("Åpne prosjektet"), icon: IconFolder, run: open },
    { label: t("Rediger prosjekt…"), icon: IconEdit, run: () => void editChatProject(props.project) },
    { label: props.project.pinned ? t("Løsne prosjektet") : t("Fest prosjektet"), icon: IconPinned, run: () => patch(`/api/chat-projects/${props.project.id}`, { pinned: !props.project.pinned }).catch(report) },
    "sep",
    // Round 14 (SPEC 30.4)
    {
      label: t("Arkiver alle chattene"),
      icon: IconArchive,
      disabled: !liveIn({ chatProjectId: props.project.id }),
      title: t("Chattene forsvinner fra sidefanen, men ingenting slettes. Angre i meldingen som kommer."),
      run: () => void archiveMany({ chatProjectId: props.project.id }, `«${props.project.name}»`, { one: "chat", many: "chatter" }),
    },
    ...(archivedIn({ chatProjectId: props.project.id })
      ? [{ label: t("Vis arkiverte ({count})", { count: archivedIn({ chatProjectId: props.project.id }) }), run: () => openArchive({ kind: "chat-project", id: props.project.id }) } as MenuEntry]
      : []),
    "sep",
    {
      label: t("Fjern prosjektet…"),
      icon: IconRemove,
      danger: true,
      run: () => void removeChatProject(props.project),
    },
  ];
  return (
    <div class="group chat-project" data-chat-project={props.project.name}>
      <div class="group-head" classList={{ active: selected() }} ref={head} onPointerEnter={() => hoverIn("chat-project", props.project.id, head)} onPointerLeave={hoverOut} onPointerDown={hideHoverCard} onContextMenu={(event) => { event.preventDefault(); showMenu({ x: event.clientX, y: event.clientY }); }}>
        <button type="button" class="group-toggle" aria-expanded={!isCollapsed()} aria-label={isCollapsed() ? t("Vis chatter") : t("Skjul chatter")} title={isCollapsed() ? t("Vis chattene i prosjektet") : t("Skjul chattene i prosjektet")} onClick={() => toggleCollapsed(key())}>
          <ChatProjectGlyph project={props.project} size={16} open={!isCollapsed()} />
          <span class="fold-chevron" classList={{ open: !isCollapsed() }}><IconChevron size={12} /></span>
        </button>
        <button type="button" class="group-title" aria-current={selected() ? "page" : undefined} title={t("Åpne {name}", { name: props.project.name })} onClick={open}><span>{props.project.name}</span></button>
        <Show when={isCollapsed() && props.threads.length}><span class="group-count">{props.threads.length}</span></Show>
        <span class="group-actions" classList={{ open: !!menu() }}>
          <button type="button" class="icon-button" aria-label={t("Valg for prosjektet")} title={t("Valg for prosjektet")} aria-haspopup="menu" aria-expanded={!!menu()} onClick={(e) => menu() ? closeMenu() : showMenu({ x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}><IconDots size={14} /></button>
          <button type="button" class="icon-button" title={t("Ny chat i prosjektet")} aria-label={t("Ny chat i {name}", { name: props.project.name })} onClick={() => { void newChatIn(props.project.id); afterPick(); }}><IconPlus size={14} /></button>
        </span>
        <Show when={menu()}>{(anchor) => <ContextMenu anchor={anchor()} label={t("Valg for {name}", { name: props.project.name })} entries={entries()} onClose={closeMenu} class="project-context-menu" />}</Show>
      </div>
      <Show when={!isCollapsed()}>
        <div class="group-body">
          <Show when={props.threads.length} fallback={<div class="sidebar-empty">{t("Ingen chatter ennå")}</div>}>
            <ThreadTree threads={props.threads} activeIds={props.activeIds} limit={THREADS_SHOWN} />
          </Show>
        </div>
      </Show>
    </div>
  );
}


// Denne datamaskinen (round 9): Kode threads that have no project folder, at the bottom in Kode.
function LocalGroup(props: { threads: Thread[]; activeIds: ReadonlySet<string> }) {
  const isCollapsed = () => collapsed().includes(LOCAL_SCOPE);
  const selected = () => mode() === "code" && projectId() === null && !room() && !skillsOpen() && !githubRoom();
  return (
    <div class="group local-group" data-testid="local-group">
      <div class="group-head" classList={{ active: selected() }}>
        <button type="button" class="group-toggle" aria-expanded={!isCollapsed()} aria-label={isCollapsed() ? t("Vis tråder") : t("Skjul tråder")} title={isCollapsed() ? t("Vis trådene") : t("Skjul trådene")} onClick={() => toggleCollapsed(LOCAL_SCOPE)}>
          <span class="project-glyph local-glyph"><IconMonitor size={16} /></span>
          <span class="fold-chevron" classList={{ open: !isCollapsed() }}><IconChevron size={12} /></span>
        </button>
        <button type="button" class="group-title" title={t("Kode uten prosjektmappe. Trådene her har ingen filer eller kommandoer.")} onClick={() => { setProjectId(null); setMode("code"); afterPick(); }}>
          <span>{t("Denne datamaskinen")}</span>
        </button>
        <span class="group-actions">
          <button type="button" class="icon-button" title={t("Ny tråd uten prosjektmappe")} aria-label={t("Ny tråd på Denne datamaskinen")} onClick={() => { void newThreadIn(null, true); afterPick(); }}><IconPlus size={14} /></button>
        </span>
      </div>
      <Show when={!isCollapsed()}>
        <div class="group-body">
          <ThreadTree threads={props.threads} activeIds={props.activeIds} limit={THREADS_SHOWN} />
        </div>
      </Show>
    </div>
  );
}

const SORTS: Array<{ id: ProjectSort; label: string }> = [
  { id: "recent", get label() { return t("Sist oppdatert"); } },
  { id: "created", get label() { return t("Opprettet"); } },
  { id: "name", get label() { return t("Navn"); } },
];

// Round 11 (SPEC 24.6): one ⋯ at the top of the sidebar for what used to be spread out: how the
// sidebar is organised and folded, how the threads are sorted, what is shown, a new project and a
// new section. It stays inside the sidebar like the profile menu; the submenus open to the side.
function SidebarMenu(props: { foldIds: () => string[] }) {
  const [anchor, setAnchor] = createSignal<MenuAnchor | null>(null);
  const inChat = () => mode() === "chat";
  const anyOpen = () => props.foldIds().some((id) => !collapsed().includes(id));
  const anyFolded = () => props.foldIds().some((id) => collapsed().includes(id));
  const entries = (): MenuEntry[] => [
    {
      label: t("Organiser sidepanelet"),
      icon: IconSidebar,
      children: [
        { heading: <span class="menu-heading">{t("Grupper")}</span> },
        { label: t("Etter prosjekt"), chosen: projectGroup() === "project", title: inChat() ? t("Chattene i prosjektene sine, og resten under Chatter") : t("Hvert prosjekt med trådene sine"), run: () => setProjectGroup("project") },
        { label: t("Etter dato"), chosen: projectGroup() === "list", title: t("Én liste med I dag, I går og eldre"), run: () => setProjectGroup("list") },
        "sep",
        { label: t("Fold sammen alle"), icon: IconFoldAll, disabled: !anyOpen(), run: () => setAllCollapsed(props.foldIds(), true) },
        { label: t("Fold ut alle"), icon: IconUnfoldAll, disabled: !anyFolded(), run: () => setAllCollapsed(props.foldIds(), false) },
      ],
    },
    {
      label: t("Sorter samtaler etter"),
      icon: IconSort,
      children: SORTS.map((sort) => ({ label: sort.label, chosen: effectiveProjectOrder() === sort.id, run: () => setProjectSort(sort.id) })),
    },
    "sep",
    { heading: <span class="menu-heading">{t("Vis")}</span> },
    { label: t("Festet"), toggle: showPinned(), title: t("Festede tråder og prosjekter øverst. Av: de står der de ellers hører til."), run: () => setShowPinned(!showPinned()) },
    ...(inChat() ? [{ label: t("Prosjekter"), toggle: showProjects(), title: t("Prosjektene i Chat. Av: chattene deres står under Chatter."), run: () => setShowProjects(!showProjects()) } as MenuEntry] : []),
    "sep",
    inChat()
      ? { label: t("Nytt prosjekt…"), icon: IconFolderPlus, title: t("Et navn som samler chatter"), run: () => void newChatProject() }
      : { label: t("Legg til prosjekt…"), icon: IconFolderPlus, title: t("Velg en mappe på PC-en. Prosjektet kommer under Chatter."), run: () => setFolderPickerOpen(true) },
    { label: t("Ny seksjon"), icon: IconPlus, title: t("En egen seksjon du kan dra tråder inn i"), run: () => void newSection(mode()) },
    "sep",
    { label: t("Arkiverte tråder"), icon: IconArchive, title: t("Tråder du har arkivert. Ingenting er slettet."), run: () => openArchive() },
  ];
  return (
    <>
      <button
        type="button"
        class="icon-button"
        aria-label={t("Valg for sidefanen")}
        title={t("Organiser, sorter og vis")}
        aria-haspopup="menu"
        aria-expanded={!!anchor()}
        data-testid="sidebar-menu"
        onClick={(e) => {
          if (anchor()) return setAnchor(null);
          // Inside the sidebar, as wide as it less a margin, like the profile menu (SPEC 23.6).
          const button = e.currentTarget.getBoundingClientRect();
          const side = e.currentTarget.closest(".sidebar")?.getBoundingClientRect();
          const margin = 8;
          const rect = side ? new DOMRect(side.left + margin, button.top, side.width - margin * 2, button.height) : button;
          setAnchor({ x: 0, y: 0, rect, alignLeft: true, width: side ? Math.min(side.width - margin * 2, 280) : undefined });
        }}
      >
        <IconDots size={16} />
      </button>
      <Show when={anchor()}>{(a) => <ContextMenu anchor={a()} label={t("Valg for sidefanen")} entries={entries()} onClose={() => setAnchor(null)} class="sidebar-menu" />}</Show>
    </>
  );
}

// A section made with Ny seksjon: folds like a project, takes threads dragged onto it, and its ⋯
// renames or deletes it (the threads stay, back where they were).
function SectionGroup(props: { section: SidebarSection; threads: Thread[]; activeIds: ReadonlySet<string> }) {
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  const key = () => `sec:${props.section.id}`;
  const isCollapsed = () => collapsed().includes(key());
  const entries = (): MenuEntry[] => [
    { label: t("Gi nytt navn…"), icon: IconEdit, run: () => void renameSection(props.section) },
    "sep",
    { label: t("Slett seksjonen…"), icon: IconRemove, danger: true, run: () => void deleteSection(props.section) },
  ];
  return (
    <div class="group user-section" classList={{ "drop-over": sectionTarget() === props.section.id }} data-section-id={props.section.id} data-drop-section={props.section.id}>
      <div class="section-head section-head-user">
        <button type="button" class="section-fold" aria-expanded={!isCollapsed()} title={isCollapsed() ? t("Vis trådene i seksjonen") : t("Skjul trådene i seksjonen")} onClick={() => toggleCollapsed(key())}>
          <span class="section-label">{props.section.name}</span>
          <Show when={isCollapsed() && props.threads.length}><span class="section-count">{props.threads.length}</span></Show>
          <span class="fold-chevron" classList={{ open: !isCollapsed() }}><IconChevron size={12} /></span>
        </button>
        <span class="section-tools" classList={{ open: !!menu() }}>
          <button type="button" class="icon-button" aria-label={t("Valg for {name}", { name: props.section.name })} title={t("Valg for seksjonen")} aria-haspopup="menu" aria-expanded={!!menu()} onClick={(e) => setMenu(menu() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}><IconDots size={14} /></button>
        </span>
        <Show when={menu()}>{(anchor) => <ContextMenu anchor={anchor()} label={t("Valg for {name}", { name: props.section.name })} entries={entries()} onClose={() => setMenu(null)} />}</Show>
      </div>
      <Show when={!isCollapsed()}>
        <Show when={props.threads.length} fallback={<div class="sidebar-empty section-empty">{t("Dra tråder hit, eller bruk trådmenyen")}</div>}>
          <ThreadTree threads={props.threads} activeIds={props.activeIds} limit={THREADS_SHOWN} />
        </Show>
      </Show>
    </div>
  );
}

// Etter dato: one list with I dag, I går, Siste 7 dager, Siste 30 dager and Eldre.
const DAY = 86_400_000;
const dateBuckets = [() => t("I dag"), () => t("I går"), () => t("Siste 7 dager"), () => t("Siste 30 dager"), () => t("Eldre")];

function dateBucket(at: number, now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (at >= today) return 0;
  if (at >= today - DAY) return 1;
  if (at >= today - 6 * DAY) return 2;
  if (at >= today - 29 * DAY) return 3;
  return 4;
}

function DateList(props: { threads: Thread[]; activeIds: ReadonlySet<string>; showProject?: boolean }) {
  const [all, setAll] = createSignal(false);
  const LIST_SHOWN = THREADS_SHOWN * 2;
  const shown = () => (all() || props.threads.length <= LIST_SHOWN + 2 ? props.threads : props.threads.filter((t, i) => i < LIST_SHOWN || props.activeIds.has(t.id) || t.running || t.pendingApprovals > 0));
  const groups = createMemo(() => {
    const now = Date.now();
    const at = (t: Thread) => (effectiveProjectOrder() === "created" ? t.createdAt : t.updatedAt);
    const out: Array<{ bucket: number; threads: Thread[] }> = [];
    for (const thread of shown()) {
      const bucket = dateBucket(at(thread), now);
      const group = out.find((g) => g.bucket === bucket);
      if (group) group.threads.push(thread);
      else out.push({ bucket, threads: [thread] });
    }
    return out.sort((a, b) => a.bucket - b.bucket);
  });
  return (
    <>
      <For each={groups()}>
        {(group) => (
          <>
            <div class="date-head" role="presentation">{dateBuckets[group.bucket]()}</div>
            <For each={group.threads}>{(thread) => <ThreadItem thread={thread} active={props.activeIds.has(thread.id)} showProject={props.showProject} />}</For>
          </>
        )}
      </For>
      <Show when={shown().length < props.threads.length || all()}>
        <button type="button" class="show-more" onClick={() => setAll(!all())}>{all() ? t("Vis færre") : t("Vis flere ({count})", { count: props.threads.length - shown().length })}</button>
      </Show>
    </>
  );
}

export function Sidebar() {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<Thread[]>([]);
  const [allProjects, setAllProjects] = createSignal(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchId = 0;
  onCleanup(() => clearTimeout(searchTimer));

  const onSearch = (value: string) => {
    setQuery(value);
    clearTimeout(searchTimer);
    const id = ++searchId;
    if (!value.trim()) return setResults([]);
    searchTimer = setTimeout(() => {
      get<Thread[]>(`/api/threads/search?q=${encodeURIComponent(value.trim())}`)
        .then((found) => {
          if (id === searchId) setResults(found);
        })
        .catch(report);
    }, 120);
  };
  const closeSearch = () => {
    onSearch("");
    setSearchOpen(false);
  };

  const smart = () => app.settings.sidebarLayout === "smart";
  const inChat = () => mode() === "chat";
  // Sorted as chosen in ⋯ → Sorter samtaler etter. Snoozed threads sink to the bottom of their list,
  // dimmed with a clock, until the time is up.
  const order = (a: Thread, b: Thread) =>
    Number(isSnoozed(a)) - Number(isSnoozed(b)) ||
    (effectiveProjectOrder() === "name" ? a.title.localeCompare(b.title, language(), { sensitivity: "base" }) : effectiveProjectOrder() === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  const threads = createMemo(() => Object.values(app.threads).filter(listed));
  const live = createMemo(() => threads().filter((t) => !t.archived).sort(order));
  // ⋯ → Vis → Festet. Pinned threads get their own place under Festet and are not shown twice; with
  // Festet off they stand where they otherwise belong.
  const festet = () => showPinned();
  const pinnedThreads = createMemo(() => (festet() ? live().filter((t) => t.pinned) : []));
  // A thread in a section is shown there only (round 11); Festet comes first.
  const sectionOf = (t: Thread) => (t.sectionId && app.sections[t.sectionId]?.mode === t.mode && !(festet() && t.pinned) ? t.sectionId : null);
  const sections = createMemo(() => sectionsFor(mode()));
  const inSection = (id: string) => live().filter((t) => sectionOf(t) === id);
  const unpinned = createMemo(() => live().filter((t) => !(festet() && t.pinned) && !sectionOf(t)));
  // Chat: ⋯ → Vis → Prosjekter. Off, the chats of the Chat projects are under Chatter.
  const chatProjectsShown = () => showProjects();
  const inChatProject = (t: Thread) => chatProjectsShown() && !!t.chatProjectId && !!app.chatProjects[t.chatProjectId];
  // Chats outside any Chat project, and Kode threads without a folder (Denne datamaskinen).
  const chats = createMemo(() => unpinned().filter((t) => !t.projectId && t.mode !== "code" && !inChatProject(t)));
  const localThreads = createMemo(() => unpinned().filter((t) => !t.projectId && t.mode === "code"));
  const forProject = (id: string) => unpinned().filter((t) => t.projectId === id);
  const forChatProject = (id: string) => unpinned().filter((t) => t.chatProjectId === id && !t.projectId);
  const archivedCount = createMemo(() => threads().filter((t) => t.archived).length);
  // Projects in the order chosen in Innstillinger → Utseende → Sidefane or ⋯.
  const ordered = createMemo(() => sortedProjects());
  // Pinned projects get their own place under Festet and are not shown twice.
  const pinnedProjects = createMemo(() => (festet() ? ordered().filter((p) => p.pinned) : []));
  const otherProjects = createMemo(() => ordered().filter((p) => !(festet() && p.pinned)));
  const pinnedChatProjects = createMemo(() => (festet() && chatProjectsShown() ? sortedChatProjects().filter((p) => p.pinned) : []));
  const chatProjects = createMemo(() => sortedChatProjects().filter((p) => !(festet() && p.pinned)));
  // Etter dato: every Kode thread in a project in one list, with its project's mark.
  const projectThreads = createMemo(() => unpinned().filter((t) => !!t.projectId && !!app.projects[t.projectId]));
  const shownProjects = createMemo(() => {
    const list = otherProjects();
    if (allProjects() || list.length <= PROJECTS_SHOWN + 1) return list;
    return list.filter((p, i) => i < PROJECTS_SHOWN || p.id === projectId() || forProject(p.id).some((t) => t.running || t.pendingApprovals > 0));
  });
  // What Fold sammen alle and Fold ut alle work on.
  const foldIds = () => [
    ...sections().map((section) => `sec:${section.id}`),
    ...(inChat()
      ? (chatProjectsShown() ? sortedChatProjects().map((p) => `chat:${p.id}`) : [])
      : [...(projectGroup() === "project" ? otherProjects().map((p) => p.id) : []), ...pinnedProjects().map((p) => p.id), ...(localThreads().length ? [LOCAL_SCOPE] : [])]),
  ];

  // One timer, for the next snooze that runs out.
  createEffect(() => {
    const now = snoozeNow();
    const next = Math.min(...threads().map((t) => (t.snoozedUntil && t.snoozedUntil > now ? t.snoozedUntil : Infinity)));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setSnoozeNow(Date.now()), Math.min(next - Date.now() + 50, 2 ** 31 - 1));
    onCleanup(() => clearTimeout(timer));
  });
  const anyPinned = () => pinnedThreads().length > 0 || pinnedProjects().length > 0 || (inChat() && pinnedChatProjects().length > 0);

  const activeIds = createMemo<ReadonlySet<string>>(() => {
    const key = scope();
    if (!key || (mode() === "chat" && chatProjectPageId())) return new Set();
    return new Set(gridFor(key).panes().flatMap((p) => p.threadId() ?? []));
  });

  let resizeTarget = 0;
  const applyWidth = () => setSidebarWidth(resizeTarget);
  const startResize = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      resizeTarget = Math.min(Math.max(e.clientX, 220), 460);
      onNextFrame(applyWidth);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
    };
    handle.addEventListener("pointermove", move, { passive: true });
    handle.addEventListener("pointerup", end);
  };

  return (
    <aside class="sidebar" classList={{ "sidebar-smart": smart() }} aria-label={t("Prosjekter og tråder")}>
      <div class="sidebar-head">
        <span class="app-name">Agentic Desktop</span>
        <span class="sidebar-spacer" />
        <Show when={!smart()}>
          <button
            type="button"
            class="icon-button"
            aria-label={t("Søk")}
            title={t("Søk i tråder ({keys})", { keys: displayKeys(keysFor("thread.search")) })}
            aria-pressed={searchOpen()}
            onClick={() => (searchOpen() ? closeSearch() : actions.searchThreads())}
          >
            <IconSearch size={16} />
          </button>
        </Show>
        <Notifications />
        <Show when={!smart()}><SidebarMenu foldIds={foldIds} /></Show>
      </div>
      <Show when={searchOpen() && !smart()}>
        <div class="sidebar-search">
          <IconSearch size={14} />
          <input
            class="search-input"
            type="search"
            placeholder={t("Søk i tråder")}
            aria-label={t("Søk i tråder")}
            value={query()}
            onInput={(e) => onSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
          />
          <button type="button" class="icon-button" aria-label={t("Lukk søket")} onClick={closeSearch}><IconClose size={13} /></button>
        </div>
      </Show>
      <ModeSwitch class="sidebar-mode" />
      <Show when={!smart()} fallback={<SmartSidebar activeIds={activeIds()} />}>
        <nav class="sidebar-nav" aria-label={t("Navigasjon")}>
          <div class="nav-row">
            <button type="button" class="nav-item" aria-label={t("Ny tråd")} title={t("Ny tråd ({keys})", { keys: displayKeys(keysFor("thread.new")) })} onClick={() => { actions.newThread(); afterPick(); }}>
              <IconCompose size={16} /><span>{t("Ny tråd")}</span>
            </button>
            <button type="button" class="icon-button nav-row-extra" title={t("Ny tråd i et nytt prosjekt")} aria-label={t("Ny tråd i et nytt prosjekt")} onClick={() => setFolderPickerOpen(true)}><IconPlusCircle size={16} /></button>
          </div>
          <button
            type="button"
            class="nav-item artifacts-row"
            aria-current={room() ? "page" : undefined}
            title={t("Små programmer i én HTML-fil, med forhåndsvisning")}
            onClick={() => { closeProfile(); openArtifacts(); afterPick(); }}
          >
            <IconArtifact size={16} /><span>{t("Artifacts")}</span><span class="nav-count" aria-label={t("{count} artifacts", { count: artifactCount() })}>{artifactCount()}</span>
          </button>
          <button type="button" class="nav-item" aria-current={skillsOpen() ? "page" : undefined} title={t("Skills som finnes for prosjektet og for deg")} onClick={() => { actions.skills(); afterPick(); }}>
            <IconSpark size={16} /><span>{t("Skills")}</span>
          </button>
        </nav>
        <div class="sidebar-scroll" onScroll={hideHoverCard}>
          <Show
            when={!query().trim()}
            fallback={
              <div class="group">
                <div class="section-head"><span class="section-label">{t("Treff")}</span></div>
                <For each={results()} fallback={<div class="sidebar-empty">{t("Ingen tråder funnet")}</div>}>
                  {(thread) => <ThreadItem thread={app.threads[thread.id] ?? thread} active={activeIds().has(thread.id)} />}
                </For>
              </div>
            }
          >
            {/* Festet (SPEC 21.2): only when something is pinned, in both modes, and ⋯ → Vis → Festet is on. */}
            <Show when={anyPinned()}>
              <div class="section-head" data-section="pinned">
                <span class="section-label">{t("Festet")}</span>
              </div>
              <div class="pinned-projects">
                <For each={pinnedThreads()}>
                  {(thread) => <ThreadItem thread={thread} active={activeIds().has(thread.id)} />}
                </For>
                <For each={pinnedProjects()}>
                  {(project) => <ProjectGroup project={project} threads={forProject(project.id)} activeIds={activeIds()} headOnly={inChat()} />}
                </For>
                <Show when={inChat()}>
                  <For each={pinnedChatProjects()}>
                    {(project) => <ChatProjectGroup project={project} threads={forChatProject(project.id)} activeIds={activeIds()} />}
                  </For>
                </Show>
              </div>
            </Show>
            {/* Round 11 (SPEC 24.6): the sections made with Ny seksjon, for this mode. */}
            <For each={sections()}>
              {(section) => <SectionGroup section={section} threads={inSection(section.id)} activeIds={activeIds()} />}
            </For>
            <Show
              when={!inChat()}
              fallback={
                <>
                  <Show when={chatProjectsShown()}>
                    <div class="section-head" data-section="projects">
                      <span class="section-label">{t("Prosjekter")}</span>
                      <button type="button" class="icon-button" title={t("Nytt prosjekt i Chat: et navn som samler chatter")} aria-label={t("Nytt prosjekt i Chat")} onClick={() => void newChatProject()}><IconPlus size={14} /></button>
                    </div>
                    <For each={chatProjects()} fallback={<Show when={!pinnedChatProjects().length}><div class="sidebar-empty">{t("Samle chatter i et prosjekt med +")}</div></Show>}>
                      {(project) => <ChatProjectGroup project={project} threads={forChatProject(project.id)} activeIds={activeIds()} />}
                    </For>
                  </Show>
                  <div class="section-head" data-section="chats">
                    <span class="section-label">{t("Chatter")}</span>
                    <button type="button" class="icon-button" title={t("Ny tråd i Chat")} aria-label={t("Ny tråd i Chat")} onClick={() => { void newThreadIn(null); afterPick(); }}><IconPlus size={14} /></button>
                  </div>
                  <Show when={chats().length} fallback={<div class="sidebar-empty">{t("Ingen chatter ennå")}</div>}>
                    <Show when={projectGroup() === "list"} fallback={<ThreadTree threads={chats()} activeIds={activeIds()} limit={THREADS_SHOWN} />}>
                      <DateList threads={chats()} activeIds={activeIds()} />
                    </Show>
                  </Show>
                </>
              }
            >
              {/* Round 11 (SPEC 24.4): Kode has Chatter, with no + by it. A project comes into the list
                  by itself when its folder is chosen in the message field or on the start page, and
                  ⋯ → Legg til prosjekt adds one without a thread. */}
              <div class="section-head" data-section="chats">
                <span class="section-label">{t("Chatter")}</span>
              </div>
              <Show
                when={projectGroup() === "project"}
                fallback={
                  <div class="group-body project-list" data-testid="project-list">
                    <Show when={projectThreads().length}>
                      <DateList threads={projectThreads()} activeIds={activeIds()} showProject />
                    </Show>
                  </div>
                }
              >
                <For each={shownProjects()}>
                  {(project) => <ProjectGroup project={project} threads={forProject(project.id)} activeIds={activeIds()} />}
                </For>
                <Show when={shownProjects().length < otherProjects().length || allProjects()}>
                  <button type="button" class="show-more" onClick={() => setAllProjects(!allProjects())}>{allProjects() ? t("Vis færre") : t("Vis flere")}</button>
                </Show>
              </Show>
              {/* Only once there is a thread without a project (SPEC 23.2). */}
              <Show when={localThreads().length}>
                <LocalGroup threads={localThreads()} activeIds={activeIds()} />
              </Show>
            </Show>
            <Show when={archivedCount()}>
              <button type="button" class="show-more archived-link" aria-label={t("Arkiverte ({count})", { count: archivedCount() })} title={t("Arkiverte tråder: ingenting er slettet, og de kan hentes tilbake")} onClick={() => openArchive()}><IconArchive size={14} /><span>{t("Arkiverte")}</span><span class="archived-count">{archivedCount()}</span></button>
            </Show>
          </Show>
        </div>
      </Show>
      <div class="sidebar-foot">
        <ProfileMenu />
        {/* Named by text, not aria-label, so it does not match a search for the label "Sti". The tip
            and the page it opens follow the mode (SPEC 21.2). */}
        <button
          type="button"
          class="icon-button settings-gear"
          data-testid="settings-gear"
          title={t("Innstillinger for {mode} ({keys})", { mode: inChat() ? t("Chat") : t("Kode"), keys: displayKeys(keysFor("settings.open")) })}
          onClick={() => setSettingsOpen(inChat() ? "chat" : "code")}
          onPointerEnter={preloadSettings}
          onFocus={preloadSettings}
        >
          <IconSettings size={16} /><span class="sr-only">{t("Innstillinger for {mode}", { mode: inChat() ? t("Chat") : t("Kode") })}</span>
        </button>
        <GitHubNavigation afterPick={afterPick} />
      </div>
      <div class="sidebar-resize" title={t("Dra for å endre bredden. Dobbeltklikk for standard.")} onPointerDown={startResize} onDblClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)} />
    </aside>
  );
}
