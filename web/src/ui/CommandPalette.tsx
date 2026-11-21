import { IconPullRequest } from "./GitHubShared";
import { openGitHubRoom } from "../state/github";
// The command palette (Ctrl+K): one field for actions, chats, files in the project and the text of
// messages. Tabs narrow it down, and Tab moves between them. The arrows pick, Enter runs and Esc
// closes. Chats and text use the thread search, files the same list as @ in the message field.
import { language, t } from "../lib/i18n";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { MentionItem, Project, Thread } from "../../../shared/protocol";
import { get } from "../lib/api";
import { rememberFocus } from "../lib/focus";
import { relativeTime } from "../lib/format";
import { app, currentProject, listed, mode, report, saveSettings, setMode, setProjectId, setSettingsOpen, sortedProjects } from "../state/app";
import { actions, focusedThread } from "../state/actions";
import { openArtifacts, closeArtifacts } from "../state/artifacts";
import { closePalette, openProfile, palette, recentFiles, requestFile, type PaletteTab } from "../state/nav";
import { openThread } from "../state/navigate";
import { requestBrowserTab, showPanel } from "../state/panel";
import { studioOpen } from "../state/studio";
import { enterMode, enterStudio } from "./ModeSwitch";
import { openChromeImport, openCookieImport } from "./dialog-state";
import { displayKeys, keysFor } from "../state/shortcuts";
import { IconArchive, IconArtifact, IconChat, IconCode, IconCompose, IconFile, IconFolder, IconHelp, IconInfo, IconIssue, IconKeyboard, IconPanel, IconSearch, IconSettings, IconSidebar, IconSpark, IconSplitRight, IconStudio, IconSun, IconUser, IconClock, IconPin, IconBranch, IconGlobe, IconBookmark } from "./icons";
import { IconCookie, IconPencil } from "./nav-icons";
import { ProjectGlyph } from "./ProjectGlyph";

const TABS: Array<{ id: PaletteTab; label: string }> = [
  { id: "all", get label() { return t("Alle"); } },
  { id: "actions", get label() { return t("Handlinger"); } },
  { id: "chats", get label() { return t("Tråder"); } },
  { id: "files", get label() { return t("Filer"); } },
  { id: "text", get label() { return t("Tekst"); } },
];

interface Item {
  key: string;
  icon: () => JSX.Element;
  label: string;
  detail?: string;
  keys?: string;
  run: () => unknown;
}

interface Section {
  title: string;
  items: Item[];
  note?: string;
}

type Icon = (p: { size?: number }) => JSX.Element;
const icon = (I: Icon) => () => <I size={15} />;

interface ActionDef {
  label: string;
  words?: string;
  icon: Icon;
  keys?: string;
  quick?: boolean;
  when?: () => boolean;
  run: () => unknown;
}

const ACTIONS = (): ActionDef[] => [
  { label: t("Ny tråd"), icon: IconCompose, keys: "thread.new", quick: true, run: actions.newThread },
  { label: t("Ny tråd i Chat"), words: t("chat uten prosjekt"), icon: IconChat, run: actions.newChat },
  { label: t("Åpne mappe"), words: "prosjekt", icon: IconFolder, keys: "folder.open", quick: true, run: actions.openFolder },
  { label: t("Innstillinger"), icon: IconSettings, keys: "settings.open", quick: true, run: () => actions.settings() },
  { label: mode() === "chat" ? t("Bytt til Kode") : studioOpen() ? t("Bytt til Chat") : t("Bytt til Kode Studio"), words: t("modus chat kode studio"), icon: mode() === "chat" ? IconCode : studioOpen() ? IconChat : IconStudio, keys: "view.mode", quick: true, run: actions.toggleMode },
  { label: t("Åpne Kode Studio"), words: t("studio editor arbeidsflate filer"), icon: IconStudio, when: () => !(mode() === "code" && studioOpen()), run: enterStudio },
  { label: t("Bytt til vanlig Kode"), words: t("kode samtale panel"), icon: IconCode, when: () => mode() === "code" && studioOpen(), run: () => enterMode("code") },
  { label: t("Ny rute"), icon: IconSplitRight, keys: "pane.new", run: actions.newPane },
  { label: t("Søk i tråder"), icon: IconSearch, keys: "thread.search", run: actions.searchThreads },
  { label: t("Vis eller skjul sidefanen"), icon: IconSidebar, keys: "view.sidebar", run: actions.toggleSidebar },
  { label: t("Vis eller skjul panelet"), icon: IconPanel, keys: "view.panel", run: actions.togglePanel },
  { label: t("Festet sammendrag"), icon: IconPin, keys: "view.summary", run: actions.toggleSummary },
  { label: t("Ny fane i nettleseren"), words: t("nettleser fane browser"), icon: IconGlobe, keys: "browser.newTab", run: () => { actions.showTab("browser"); requestBrowserTab(false); } },
  { label: t("Importer bokmerker fra Chrome"), words: t("nettleser chrome chromium bokmerker historikk import"), icon: IconBookmark, run: openChromeImport },
  { label: t("Importer informasjonskapsler"), words: t("nettleser cookies innlogget logg inn chrome chromium firefox import"), icon: IconCookie, run: openCookieImport }, // round 12
  { label: t("Gi tråden nytt navn"), icon: IconPencil, keys: "thread.rename", when: () => !!focusedThread(), run: actions.rename },
  { label: t("Lag gaffel av tråden"), words: t("gaffel forgrening forgren fork kopier"), icon: IconBranch, when: () => !!focusedThread(), run: actions.fork },
  { label: t("Profil"), words: t("statistikk tokens"), icon: IconUser, run: () => { closeArtifacts(); openProfile(); } },
  { label: t("Pull requests"), icon: IconPullRequest, run: () => openGitHubRoom("pull") },
  { label: t("Issues"), icon: IconIssue, run: () => openGitHubRoom("issues") },
  { label: t("Artifacts"), icon: IconArtifact, run: () => openArtifacts() },
  { label: t("Skills"), icon: IconSpark, run: actions.skills },
  { label: t("Planlagte oppgaver"), words: "planlagt", icon: IconClock, run: actions.scheduled },
  { label: t("Arkiverte tråder"), icon: IconArchive, run: () => setSettingsOpen("archived") },
  { label: t("Lyst tema"), words: "tema", icon: IconSun, run: () => actions.theme("light") },
  { label: t("Mørkt tema"), words: "tema", icon: IconSun, run: () => actions.theme("dark") },
  { label: t("Følg systemets tema"), words: "tema", icon: IconSun, run: () => actions.theme("system") },
  {
    label: app.settings.sidebarLayout === "smart" ? t("Bruk vanlig sidefane") : t("Bruk smart sidefane"),
    words: t("sidefane layout"),
    icon: IconSidebar,
    run: () => saveSettings({ sidebarLayout: app.settings.sidebarLayout === "smart" ? "standard" : "smart" }).catch(report),
  },
  { label: t("Hurtigtaster"), icon: IconKeyboard, keys: "help.shortcuts", run: actions.shortcuts },
  { label: t("Kommandoer"), icon: IconHelp, run: actions.commands },
  { label: t("Om Agentic Desktop"), icon: IconInfo, run: actions.about },
];

const norm = (s: string) => s.toLocaleLowerCase(language());
function matches(text: string, query: string): boolean {
  const hay = norm(text);
  return norm(query).split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

const basename = (p: string) => p.split("/").pop() || p;

function projectName(thread: Thread): string {
  return thread.projectId ? app.projects[thread.projectId]?.name ?? "" : t("Chat");
}

function threadItem(thread: Thread, detail?: string): Item {
  return {
    key: `t:${thread.id}`,
    icon: () => (thread.projectId && app.projects[thread.projectId] ? <ProjectGlyph project={app.projects[thread.projectId]} size={15} /> : <IconChat size={15} />),
    label: thread.title,
    detail: detail ?? projectName(thread),
    run: () => openThread(app.threads[thread.id] ?? thread),
  };
}

function projectItem(project: Project): Item {
  return {
    key: `p:${project.id}`,
    icon: () => <ProjectGlyph project={project} size={15} />,
    label: project.name,
    detail: project.path,
    run: () => {
      setProjectId(project.id);
      setMode("code");
    },
  };
}

function openFile(project: Project, path: string): void {
  setProjectId(project.id);
  setMode("code");
  showPanel("files");
  requestFile(project.id, path);
}

function fileItem(project: Project, path: string): Item {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return { key: `f:${project.id}:${path}`, icon: icon(IconFile), label: basename(path), detail: dir ? `${project.name}/${dir}` : project.name, run: () => openFile(project, path) };
}

function Palette(props: { initial: PaletteTab; initialQuery: string }) {
  let dialog!: HTMLDialogElement;
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;
  const [tab, setTab] = createSignal<PaletteTab>(props.initial);
  const [query, setQuery] = createSignal(props.initialQuery);
  const [selected, setSelected] = createSignal(0);
  const [found, setFound] = createSignal<{ query: string; threads: Thread[] } | null>(null);
  const [files, setFiles] = createSignal<{ query: string; items: MentionItem[] } | null>(null);

  // Files are searched in the project in view, or the last one used.
  const fileProject = createMemo(() => (mode() === "code" ? currentProject() : undefined) ?? sortedProjects()[0]);

  // Esc, or an action that leaves focus nowhere, gives it back to where it was.
  onCleanup(rememberFocus());
  onMount(() => {
    dialog.showModal();
    input.focus();
  });

  // The thread search and the file list, a moment after typing stops. The last answer wins.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  onCleanup(() => clearTimeout(timer));
  createEffect(() => {
    const q = query().trim();
    const t = tab();
    const project = fileProject();
    clearTimeout(timer);
    const id = ++seq;
    const wantThreads = q && (t === "all" || t === "chats" || t === "text");
    const wantFiles = project && (t === "files" || (t === "all" && q));
    if (!wantThreads && !wantFiles) return;
    timer = setTimeout(() => {
      if (wantThreads) {
        get<Thread[]>(`/api/threads/search?q=${encodeURIComponent(q)}`)
          .then((threads) => id === seq && setFound({ query: q, threads: threads.filter((th) => listed(th) && !th.archived) }))
          .catch(() => undefined);
      }
      if (wantFiles) {
        get<MentionItem[]>(`/api/projects/${project!.id}/mentions?q=${encodeURIComponent(q)}`)
          .then((items) => id === seq && setFiles({ query: q, items: items.filter((i) => i.kind === "file") }))
          .catch(() => undefined);
      }
    }, 110);
  });

  const recentThreads = createMemo(() =>
    Object.values(app.threads)
      .filter((t): t is Thread => listed(t) && !t.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );

  const actionItems = (defs: Array<ActionDef & { index: number }>): Item[] =>
    defs.map((a) => ({ key: `a:${a.index}`, icon: icon(a.icon), label: a.label, keys: a.keys, run: a.run }));

  const sections = createMemo<Section[]>(() => {
    const q = query().trim();
    const selectedTab = tab();
    const defs = ACTIONS().map((action, index) => ({ ...action, index })).filter((a) => !a.when || a.when());
    const matchedActions = q ? defs.filter((a) => matches(`${a.label} ${a.words ?? ""}`, q)) : defs;
    const project = fileProject();
    const recent = recentFiles()
      .filter((f) => app.projects[f.projectId])
      .slice(0, 5)
      .map((f) => fileItem(app.projects[f.projectId], f.path));
    const serverThreads = found()?.query === q ? found()!.threads : [];
    const fileHits = files()?.query === q && project ? files()!.items.map((i) => fileItem(project, i.path!)) : [];

    if (selectedTab === "actions") return [{ title: t("Handlinger"), items: actionItems(matchedActions), note: matchedActions.length ? undefined : t("Ingen handlinger passer") }];
    if (selectedTab === "chats") {
      if (!q) return [{ title: t("Nylige tråder"), items: recentThreads().slice(0, 30).map((th) => threadItem(th)) }];
      return [{ title: t("Tråder"), items: serverThreads.map((th) => threadItem(th)), note: found()?.query === q && !serverThreads.length ? t("Ingen tråder funnet") : undefined }];
    }
    if (selectedTab === "files") {
      if (!project) return [{ title: t("Filer"), items: [], note: t("Åpne et prosjekt for å søke i filene") }];
      const shown = q ? fileHits : [...recent.filter((r) => r.key.startsWith(`f:${project.id}:`)), ...fileHits.filter((f) => !recent.some((r) => r.key === f.key))];
      return [{ title: t("Filer i {name}", { name: project.name }), items: shown.slice(0, 40), note: files() && !shown.length ? t("Ingen filer funnet") : undefined }];
    }
    if (selectedTab === "text") {
      if (!q) return [{ title: t("Tekst"), items: [], note: t("Skriv for å søke i teksten i alle tråder") }];
      // The search matches titles and messages. Here only those found by their text count.
      const byText = serverThreads.filter((th) => !matches(th.title, q));
      const list = (byText.length ? byText : serverThreads).map((th) => threadItem(th, t("Treff i meldingene · {time}", { time: relativeTime(th.updatedAt) })));
      return [{ title: t("Treff i meldingene"), items: list, note: found()?.query === q && !list.length ? t("Ingen treff") : undefined }];
    }
    const projects = sortedProjects();
    const matchedProjects = q ? projects.filter((p) => matches(`${p.name} ${p.path}`, q)) : projects;
    // Alle
    if (!q) {
      return [
        { title: t("Hurtighandlinger"), items: actionItems(defs.filter((a) => a.quick)) },
        { title: t("Prosjekter"), items: matchedProjects.slice(0, 8).map(projectItem) },
        { title: t("Nylige tråder"), items: recentThreads().slice(0, 5).map((th) => threadItem(th)) },
        { title: t("Nylig åpnet"), items: recent },
      ].filter((s) => s.items.length);
    }
    const localThreads = recentThreads().filter((th) => matches(th.title, q));
    const threads = [...localThreads, ...serverThreads.filter((th) => !localThreads.some((l) => l.id === th.id))].slice(0, 8);
    const out = [
      { title: t("Handlinger"), items: actionItems(matchedActions.slice(0, 6)) },
      { title: t("Prosjekter"), items: matchedProjects.slice(0, 6).map(projectItem) },
      { title: t("Tråder"), items: threads.map((th) => threadItem(th)) },
      { title: t("Filer"), items: fileHits.slice(0, 6) },
    ].filter((s) => s.items.length);
    return out.length ? out : [{ title: t("Ingen treff"), items: [], note: t("Prøv en annen fane, eller et annet ord") }];
  });

  const flat = createMemo(() => sections().flatMap((s) => s.items));
  createEffect(() => {
    flat();
    setSelected(0);
  });
  createEffect(() => {
    const index = selected();
    list?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  });

  const run = (item: Item | undefined) => {
    if (!item) return;
    closePalette();
    void item.run();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const at = TABS.findIndex((x) => x.id === tab());
      setTab(TABS[(at + (event.shiftKey ? -1 : 1) + TABS.length) % TABS.length].id);
      input.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const n = flat().length;
      if (n) setSelected((selected() + (event.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      run(flat()[selected()]);
    }
  };

  return (
    <dialog ref={dialog} class="dialog palette" aria-label={t("Kommandopalett")} onCancel={closePalette} onKeyDown={onKey} onClick={(e) => e.target === dialog && closePalette()}>
      <div class="palette-tabs" role="tablist" aria-label={t("Hva du søker i")}>
        <For each={TABS}>
          {(x) => (
            <button type="button" role="tab" class="palette-tab" aria-selected={tab() === x.id} tabindex="-1" onClick={() => { setTab(x.id); input.focus(); }}>{x.label}</button>
          )}
        </For>
        <kbd class="palette-tab-hint" title={t("Tab bytter fane")}>Tab</kbd>
      </div>
      <input
        ref={input}
        class="palette-input"
        placeholder={tab() === "files" ? t("Søk etter filer") : tab() === "actions" ? t("Søk etter en handling") : tab() === "text" ? t("Søk i meldingene") : t("Søk i tråder eller kjør en kommando")}
        aria-label={t("Søk i paletten")}
        aria-controls="palette-list"
        aria-activedescendant={flat().length ? `palette-item-${selected()}` : undefined}
        spellcheck={false}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <div ref={list} class="palette-list" id="palette-list" role="listbox" aria-label={t("Treff")}>
        <For each={sections()}>
          {(section) => (
            <div class="palette-section" role="group" aria-label={section.title}>
              <div class="palette-heading">{section.title}</div>
              <For each={section.items}>
                {(item) => {
                  const i = flat().indexOf(item);
                  return (
                    <div
                      id={`palette-item-${i}`}
                      class="palette-item"
                      role="option"
                      data-index={i}
                      aria-selected={selected() === i}
                      onPointerMove={() => selected() !== i && setSelected(i)}
                      onClick={() => run(item)}
                    >
                      <span class="palette-icon">{item.icon()}</span>
                      <span class="palette-label">{item.label}</span>
                      <Show when={item.detail}><span class="palette-detail">{item.detail}</span></Show>
                      <Show when={item.keys && keysFor(item.keys)}><kbd class="menu-keys">{displayKeys(keysFor(item.keys!))}</kbd></Show>
                    </div>
                  );
                }}
              </For>
              <Show when={section.note}><div class="palette-note">{section.note}</div></Show>
            </div>
          )}
        </For>
      </div>
    </dialog>
  );
}

export function CommandPaletteHost() {
  return (
    <Show when={palette()} keyed>
      {(initial) => <Palette initial={initial.tab} initialQuery={initial.query} />}
    </Show>
  );
}
