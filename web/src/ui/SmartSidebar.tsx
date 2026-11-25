// The smart sidebar, chosen in Settings: cards for the threads that need you now (an approval
// waits, finished and not seen, recently active), and below them three groups that fold: Jobber
// (running, out of the way until they need you), Utsatt (snoozed until a time) and Avsluttet.
// It reads the same threads as the standard sidebar and does no work while nothing changes: one
// timer at most, for the next snooze that runs out.
import { t } from "../lib/i18n";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Thread } from "../../../shared/protocol";
import { get } from "../lib/api";
import { relativeTime } from "../lib/format";
import { on } from "../lib/socket";
import { app, listed, renameThread, report, scope, scopeOf, setFolderPickerOpen, setSettingsOpen } from "../state/app";
import { actions } from "../state/actions";
import { applyDrop, beginDrag } from "../state/drag";
import { gridFor } from "../state/grid";
import { finished, gitInfo, loadGitInfo, markSeen } from "../state/home";
import { STATE_LABEL, threadState, waitingCount } from "../state/thread-status";
import { inboxOrder, nextWake, snoozedAt, splitInbox } from "../state/thread-inbox";
import { newThreadIn, openThread, preloadThread } from "../state/navigate";
import { diffStats, loadDiffStats, openProfile } from "../state/nav";
import { setSnoozed } from "../state/thread-actions";
import { openArchive } from "../state/archive";
import { closeArtifacts, openArtifacts } from "../state/artifacts";
import { ContextMenu, type MenuAnchor } from "./ContextMenu";
import { promptDialog } from "./dialogs";
import { hideHoverCard, hoverIn, hoverOut, suppressHoverCards } from "./HoverCard";
import { IconArchive, IconArtifact, IconBranch, IconChat, IconCheck, IconChevron, IconCompose, IconDiff, IconDots, IconSearch, IconSliders, IconPin, IconWarn } from "./icons";
import { IconChart, IconFilter, IconFolderPlus } from "./nav-icons";
import { ProjectGlyph } from "./ProjectGlyph";
import { ChatProjectGlyph } from "./ChatProjectGlyph";
import { afterPick } from "./Sidebar";
import { threadMenuEntries } from "./ThreadMenu";

const RECENT_MS = 3 * 24 * 3_600_000;
const FILTER_KEY = "ad-smart-filter";
const OPEN_KEY = "ad-smart-groups";
type Filter = "all" | "code" | "chat";

function stored<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept this time.
  }
}

function rename(thread: Thread): void {
  void promptDialog({ title: t("Gi tråden nytt navn"), value: thread.title, confirm: t("Lagre") }).then((title) => {
    if (title?.trim() && title.trim() !== thread.title) renameThread(thread.id, title.trim()).catch(report);
  });
}

// The smart sidebar groups by these; a stopped thread is just idle here.
function state(thread: Thread): "waiting" | "running" | "error" | "new" | "idle" {
  const s = threadState(thread, false);
  return s === "stopped" ? "idle" : s;
}

function ThreadCard(props: { thread: Thread; active: boolean; compact?: boolean; now: number; showProject?: boolean }) {
  const thread = () => props.thread;
  const project = createMemo(() => (thread().projectId ? app.projects[thread().projectId!] : undefined));
  const chatProject = () => props.showProject && thread().chatProjectId ? app.chatProjects[thread().chatProjectId!] : undefined;
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  const stat = () => diffStats()[thread().id];
  const branch = () => (project() ? gitInfo(project()!.id)?.branch : null);
  const snoozed = () => snoozedAt(thread(), props.now);
  let el!: HTMLDivElement;
  createEffect(() => {
    const p = project();
    if (p) loadGitInfo(p.id);
  });

  const open = () => {
    markSeen(thread().id);
    void openThread(thread());
    afterPick();
  };
  const showMenu = (anchor: MenuAnchor) => {
    suppressHoverCards(true);
    setMenu(anchor);
  };
  const closeMenu = () => {
    setMenu(null);
    suppressHoverCards(false);
  };
  const startDrag = (event: PointerEvent) => {
    hideHoverCard();
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    beginDrag(event, {
      source: { kind: "thread", threadId: thread().id, label: thread().title },
      onClick: open,
      onDrop: (source, target) => {
        const key = scope();
        if (key && scopeOf(thread()) === key) applyDrop(gridFor(key), source, target);
        else open();
      },
    });
  };

  return (
    <div
      ref={el}
      class="smart-card"
      classList={{ active: props.active, compact: props.compact }}
      data-smart-card={thread().id}
      data-state={state(thread())}
      role="button"
      tabindex="0"
      aria-label={thread().title}
      onPointerDown={startDrag}
      onPointerEnter={() => {
        preloadThread(thread().id);
        hoverIn("thread", thread().id, el);
      }}
      onPointerLeave={hoverOut}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <Show when={!props.compact || props.showProject}>
        <div class="smart-card-top">
          <Show when={project()} fallback={<Show when={chatProject()} fallback={<IconChat size={13} />}>{(p) => <ChatProjectGlyph project={p()} size={13} />}</Show>}>
            {(p) => <ProjectGlyph project={p()} size={13} />}
          </Show>
          <Show when={thread().pinned}><span class="smart-pin" title={t("Festet")}><IconPin size={12} /></span></Show>
          <span class="smart-project">{project()?.name ?? chatProject()?.name ?? (props.showProject && thread().mode === "code" ? t("Denne datamaskinen") : t("Chat"))}</span>
          <span class="smart-age">{relativeTime(thread().updatedAt, props.now)}</span>
        </div>
      </Show>
      <div class="smart-card-title">{thread().title}</div>
      <div class="smart-card-bottom">
        {/* The branch only when there is one: «Ingen gren» on every card was noise. */}
        <Show when={!props.compact && branch()}>
          <span class="smart-branch" title={t("Gren: {branch}", { branch: branch()! })}>
            <IconBranch size={12} /><bdo dir="ltr">{branch()}</bdo>
          </span>
        </Show>
        <span class="sidebar-spacer" />
        <Show when={stat() && (stat()!.additions || stat()!.deletions)}>
          <span class="smart-diff" title={t("Linjer lagt til og fjernet i tråden")}><span class="add">+{stat()!.additions}</span> <span class="del">−{stat()!.deletions}</span></span>
        </Show>
        <Show when={snoozed()}>
          <button type="button" class="btn btn-small smart-wake" onClick={() => setSnoozed(thread(), null)}>{t("Hent tilbake")}</button>
        </Show>
        <span class="smart-state" data-state={state(thread())} title={STATE_LABEL[state(thread())]}>
          <Show when={state(thread()) === "waiting"}><IconWarn size={12} /></Show>
          <Show when={state(thread()) === "new"}><IconCheck size={12} /></Show>
        </span>
        <button type="button" class="icon-button smart-menu" aria-label={t("Valg for tråden")} title={t("Valg for tråden")} aria-haspopup="menu" aria-expanded={!!menu()} onClick={(e) => (menu() ? closeMenu() : showMenu({ x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() }))}>
          <IconDots size={14} />
        </button>
      </div>
      <Show when={menu()}>
        {(anchor) => <ContextMenu anchor={anchor()} label={t("Valg for {title}", { title: thread().title })} entries={threadMenuEntries(thread(), () => rename(thread()))} onClose={closeMenu} />}
      </Show>
    </div>
  );
}

function Group(props: { id: string; label: string; threads: Thread[]; open: boolean; onToggle: () => void; activeIds: ReadonlySet<string>; now: number; empty: string; showProject?: boolean; workingIndicator?: boolean }) {
  return (
    <div class="smart-group" data-group={props.id}>
      <button type="button" class="smart-group-head" aria-expanded={props.open} onClick={props.onToggle}>
        <Show when={props.workingIndicator && props.threads.length}><span class="smart-state" data-state="running" aria-hidden="true" /></Show>
        <span>{props.label}</span>
        <span class="sidebar-spacer" />
        <span class="smart-count">{props.threads.length}</span>
        <span class="fold-chevron" classList={{ open: props.open }}><IconChevron size={12} /></span>
      </button>
      <Show when={props.open}>
        <div class="smart-group-body">
          <For each={props.threads} fallback={<div class="sidebar-empty">{props.empty}</div>}>
            {(thread) => <ThreadCard thread={thread} active={props.activeIds.has(thread.id)} compact now={props.now} showProject={props.showProject} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function SmartSidebar(props: { activeIds: ReadonlySet<string> }) {
  const [now, setNow] = createSignal(Date.now());
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<Thread[] | null>(null);
  const [filter, setFilterSignal] = createSignal<Filter>(stored<Filter>(FILTER_KEY, "all"));
  const [filterMenu, setFilterMenu] = createSignal<MenuAnchor | null>(null);
  const archivedCount = createMemo(() => Object.values(app.threads).filter((t) => t?.archived).length);
  const [groups, setGroups] = createSignal<Record<string, boolean>>(stored(OPEN_KEY, { working: true }));
  const setFilter = (next: Filter) => {
    setFilterSignal(next);
    store(FILTER_KEY, next);
  };
  const toggle = (id: string) => {
    const next = { ...groups(), [id]: !groups()[id] };
    setGroups(next);
    store(OPEN_KEY, next);
  };

  // Line counts: at start, and again when a run has ended.
  onMount(() => {
    loadDiffStats();
    const stop = on("thread.changed", ({ thread }) => {
      if (!thread.running) loadDiffStats(600);
    });
    onCleanup(stop);
  });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchId = 0;
  onCleanup(() => clearTimeout(searchTimer));
  const onSearch = (value: string) => {
    setQuery(value);
    clearTimeout(searchTimer);
    const id = ++searchId;
    if (!value.trim()) return setResults(null);
    searchTimer = setTimeout(() => {
      get<Thread[]>(`/api/threads/search?q=${encodeURIComponent(value.trim())}`)
        .then((found) => id === searchId && setResults(found))
        .catch(report);
    }, 120);
  };

  const all = createMemo(() => {
    const f = filter();
    return Object.values(app.threads)
      .filter((t): t is Thread => listed(t) && !t.archived && (f === "all" || (f === "code" ? t.mode === "code" : t.mode !== "code")))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });
  const inbox = () => app.settings.sidebarGroupBy === "inbox";
  const hideWorking = () => app.settings.hideWorkingThreads === true;
  const workingGroup = () => hideWorking() ? "hiddenWorking" : "working";
  const legacyWorking = (t: Thread) => t.running && !waitingCount(t);
  const unread = createMemo(() => new Set(finished()));
  const split = createMemo(() => splitInbox(all(), now(), hideWorking(), unread(), props.activeIds, true));
  const working = createMemo(() => hideWorking() || inbox() ? split().working : split().active.filter(legacyWorking));
  const needsYou = (t: Thread) => waitingCount(t) > 0 || unread().has(t.id) || t.pinned ||
    (hideWorking() && (t.running || t.lastStatus === "error")) || now() - t.updatedAt < RECENT_MS || props.activeIds.has(t.id);
  const cards = createMemo(() => {
    if (inbox()) return [...split().active].sort(inboxOrder(unread()));
    const rank = (t: Thread) => (waitingCount(t) > 0 ? 0 : unread().has(t.id) ? 1 : t.pinned ? 2 : 3);
    return split().active
      .filter((t) => (hideWorking() || !legacyWorking(t)) && needsYou(t))
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  });
  const [allInboxCards, setAllInboxCards] = createSignal(false);
  const INBOX_CARD_LIMIT = 20;
  const shownInboxCards = createMemo(() => {
    const list = cards();
    if (allInboxCards() || list.length <= INBOX_CARD_LIMIT + 2) return list;
    return list.filter((t, i) => i < INBOX_CARD_LIMIT || props.activeIds.has(t.id) || t.running || waitingCount(t) > 0);
  });
  const settled = createMemo(() => split().active.filter((t) => !t.running && !needsYou(t)));
  // «Trenger deg» on top: approvals that wait. They are not in Jobber, so the count there and
  // Stopp alt in the top bar no longer seem to disagree.
  const waiting = createMemo(() => cards().filter((t) => waitingCount(t) > 0));
  const recent = createMemo(() => cards().filter((t) => !waitingCount(t)));
  const renderCard = (thread: Thread) => <ThreadCard thread={thread} active={props.activeIds.has(thread.id)} now={now()} showProject={inbox()} />;

  // One timer, for the next snooze that runs out, so the thread comes back by itself.
  createEffect(() => {
    const next = nextWake(all(), now());
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - Date.now() + 50, 2 ** 31 - 1));
    onCleanup(() => clearTimeout(timer));
  });

  const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: "all", get label() { return t("Alle tråder"); } },
    { id: "code", get label() { return t("Bare prosjekter"); } },
    { id: "chat", get label() { return t("Bare chatter"); } },
  ];

  return (
    <div class="smart-sidebar" data-testid="smart-sidebar">
      <div class="smart-top">
        <label class="smart-search">
          <IconSearch size={15} />
          <input class="search-input" type="search" placeholder={t("Søk")} aria-label={t("Søk i tråder")} value={query()} onInput={(e) => onSearch(e.currentTarget.value)} onKeyDown={(e) => e.key === "Escape" && onSearch("")} />
        </label>
        <button
          type="button"
          class="icon-button"
          classList={{ on: filter() !== "all" }}
          title={t("Filter")}
          aria-label={t("Filter")}
          aria-haspopup="menu"
          onClick={(e) => setFilterMenu(filterMenu() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}
        >
          <IconFilter size={16} />
        </button>
        <button type="button" class="icon-button" title={t("Nytt prosjekt")} aria-label={t("Nytt prosjekt")} onClick={() => setFolderPickerOpen(true)}><IconFolderPlus size={16} /></button>
        <button type="button" class="icon-button" title={t("Ny tråd")} aria-label={t("Ny tråd")} onClick={() => { actions.newThread(); afterPick(); }}><IconCompose size={16} /></button>
        <Show when={filterMenu()}>
          {(anchor) => (
            <ContextMenu
              anchor={anchor()}
              label={t("Filter")}
              onClose={() => setFilterMenu(null)}
              entries={FILTERS.map((f) => ({ label: f.label, checked: filter() === f.id, run: () => setFilter(f.id) }))}
            />
          )}
        </Show>
      </div>
      <div class="smart-scroll" onScroll={hideHoverCard}>
        <Show
          when={results() === null}
          fallback={
            <For each={results()} fallback={<div class="sidebar-empty">{t("Ingen tråder funnet")}</div>}>
              {(t) => <ThreadCard thread={app.threads[t.id] ?? t} active={props.activeIds.has(t.id)} now={now()} />}
            </For>
          }
        >
          <Show when={!inbox()} fallback={<div data-testid="sidebar-inbox">
            <For each={shownInboxCards()} fallback={<div class="sidebar-empty">{t("Innboksen er tom")}</div>}>{renderCard}</For>
            <Show when={shownInboxCards().length < cards().length || allInboxCards()}>
              <button type="button" class="show-more" onClick={() => setAllInboxCards(!allInboxCards())}>{allInboxCards() ? t("Vis færre") : t("Vis flere ({count})", { count: cards().length - shownInboxCards().length })}</button>
            </Show>
          </div>}>
          <Show
            when={cards().length}
            fallback={
              <div class="smart-empty">
                <p>{t("Ingenting trenger deg nå.")}</p>
                <button type="button" class="btn btn-small" onClick={() => { void newThreadIn(null); afterPick(); }}>{t("Ny tråd")}</button>
              </div>
            }
          >
            <Show when={waiting().length}>
              <div class="smart-heading" data-heading="waiting"><span>{t("Trenger deg")}</span><span class="smart-count">{waiting().length}</span></div>
              <For each={waiting()}>{renderCard}</For>
              <Show when={recent().length}><div class="smart-heading"><span>{t("Nylig")}</span></div></Show>
            </Show>
            <For each={recent()}>{renderCard}</For>
          </Show>
          </Show>
        </Show>
      </div>
      <div class="smart-groups">
        <Show when={!inbox() || working().length}>
          <Group id="working" label={t("Jobber")} threads={working()} open={!!groups()[workingGroup()]} onToggle={() => toggle(workingGroup())}
            activeIds={props.activeIds} now={now()} empty={t("Ingen tråder jobber nå")} showProject={inbox()} workingIndicator={hideWorking()} />
        </Show>
        <Show when={!inbox() || split().snoozed.length}>
          <Group id="snoozed" label={t("Utsatt")} threads={split().snoozed} open={!!groups().snoozed} onToggle={() => toggle("snoozed")}
            activeIds={props.activeIds} now={now()} empty={t("Ingenting er utsatt")} showProject={inbox()} />
        </Show>
        <Show when={!inbox()}>
          <Group id="settled" label={t("Avsluttet")} threads={settled()} open={!!groups().settled} onToggle={() => toggle("settled")}
            activeIds={props.activeIds} now={now()} empty={t("Ingen eldre tråder")} />
        </Show>
      </div>
      {/* With text, not bare icons: what they do should not need a tooltip. */}
      <div class="smart-tools">
        <button type="button" class="smart-tool" title={t("Endringer i tråden, i panelet")} aria-label={t("Endringer")} onClick={() => actions.showTab("changes")}><IconDiff size={14} /><span>{t("Endringer")}</span></button>
        <button type="button" class="smart-tool" title={t("Statistikk på profilsiden")} aria-label={t("Statistikk")} onClick={() => { closeArtifacts(); openProfile(); afterPick(); }}><IconChart size={14} /><span>{t("Statistikk")}</span></button>
        <button type="button" class="smart-tool" title={t("Små programmer i én HTML-fil")} aria-label={t("Artifacts")} onClick={() => { openArtifacts(); afterPick(); }}><IconArtifact size={14} /><span>{t("Artifacts")}</span></button>
        <span class="sidebar-spacer" />
        {/* Round 14 (SPEC 30.4): the archive, also from the smart sidebar. */}
        <button type="button" class="icon-button smart-archive" title={archivedCount() ? t("Arkiverte tråder ({count})", { count: archivedCount() }) : t("Arkiverte tråder")} aria-label={t("Arkiverte ({count})", { count: archivedCount() })} onClick={() => { openArchive(); afterPick(); }}><IconArchive size={16} /></button>
        <button type="button" class="icon-button" title={t("Velg sidefane i Innstillinger → Utseende")} aria-label={t("Velg sidefane")} onClick={() => setSettingsOpen("appearance")}><IconSliders size={16} /></button>
      </div>
    </div>
  );
}
