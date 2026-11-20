// The command palette (Ctrl+K): one field for actions, chats, files in the project and the text of
// messages. Tabs narrow it down, and Tab moves between them. The arrows pick, Enter runs and Esc
// closes. Chats and text use the thread search, files the same list as @ in the message field.
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
import { openChromeImport, openCookieImport } from "./dialog-state";
import { displayKeys, keysFor } from "../state/shortcuts";
import { IconArchive, IconArtifact, IconChat, IconCode, IconCompose, IconFile, IconFolder, IconHelp, IconInfo, IconKeyboard, IconPanel, IconSearch, IconSettings, IconSidebar, IconSpark, IconSplitRight, IconSun, IconUser, IconClock, IconPin, IconBranch, IconGlobe, IconBookmark } from "./icons";
import { IconCookie, IconPencil } from "./nav-icons";
import { ProjectGlyph } from "./ProjectGlyph";

const TABS: Array<{ id: PaletteTab; label: string }> = [
  { id: "all", label: "Alle" },
  { id: "actions", label: "Handlinger" },
  { id: "chats", label: "Tråder" },
  { id: "files", label: "Filer" },
  { id: "text", label: "Tekst" },
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
  { label: "Ny tråd", icon: IconCompose, keys: "thread.new", quick: true, run: actions.newThread },
  { label: "Ny tråd i Chat", words: "chat uten prosjekt", icon: IconChat, run: actions.newChat },
  { label: "Åpne mappe", words: "prosjekt", icon: IconFolder, keys: "folder.open", quick: true, run: actions.openFolder },
  { label: "Innstillinger", icon: IconSettings, keys: "settings.open", quick: true, run: () => actions.settings() },
  { label: mode() === "code" ? "Bytt til Chat" : "Bytt til Kode", words: "modus chat kode", icon: mode() === "code" ? IconChat : IconCode, keys: "view.mode", quick: true, run: actions.toggleMode },
  { label: "Ny rute", icon: IconSplitRight, keys: "pane.new", run: actions.newPane },
  { label: "Søk i tråder", icon: IconSearch, keys: "thread.search", run: actions.searchThreads },
  { label: "Vis eller skjul sidefanen", icon: IconSidebar, keys: "view.sidebar", run: actions.toggleSidebar },
  { label: "Vis eller skjul panelet", icon: IconPanel, keys: "view.panel", run: actions.togglePanel },
  { label: "Festet sammendrag", icon: IconPin, keys: "view.summary", run: actions.toggleSummary },
  { label: "Ny fane i nettleseren", words: "nettleser fane browser", icon: IconGlobe, keys: "browser.newTab", run: () => { actions.showTab("browser"); requestBrowserTab(false); } },
  { label: "Importer bokmerker fra Chrome", words: "nettleser chrome chromium bokmerker historikk import", icon: IconBookmark, run: openChromeImport },
  { label: "Importer informasjonskapsler", words: "nettleser cookies innlogget logg inn chrome chromium firefox import", icon: IconCookie, run: openCookieImport }, // round 12
  { label: "Gi tråden nytt navn", icon: IconPencil, keys: "thread.rename", when: () => !!focusedThread(), run: actions.rename },
  { label: "Lag gaffel av tråden", words: "gaffel forgrening forgren fork kopier", icon: IconBranch, when: () => !!focusedThread(), run: actions.fork },
  { label: "Profil", words: "statistikk tokens", icon: IconUser, run: () => { closeArtifacts(); openProfile(); } },
  { label: "Artifacts", icon: IconArtifact, run: () => openArtifacts() },
  { label: "Skills", icon: IconSpark, run: actions.skills },
  { label: "Planlagte oppgaver", words: "planlagt", icon: IconClock, run: actions.scheduled },
  { label: "Arkiverte tråder", icon: IconArchive, run: () => setSettingsOpen("archived") },
  { label: "Lyst tema", words: "tema", icon: IconSun, run: () => actions.theme("light") },
  { label: "Mørkt tema", words: "tema", icon: IconSun, run: () => actions.theme("dark") },
  { label: "Følg systemets tema", words: "tema", icon: IconSun, run: () => actions.theme("system") },
  {
    label: app.settings.sidebarLayout === "smart" ? "Bruk vanlig sidefane" : "Bruk smart sidefane",
    words: "sidefane layout",
    icon: IconSidebar,
    run: () => saveSettings({ sidebarLayout: app.settings.sidebarLayout === "smart" ? "standard" : "smart" }).catch(report),
  },
  { label: "Hurtigtaster", icon: IconKeyboard, keys: "help.shortcuts", run: actions.shortcuts },
  { label: "Kommandoer", icon: IconHelp, run: actions.commands },
  { label: "Om Agentic Desktop", icon: IconInfo, run: actions.about },
];

const norm = (s: string) => s.toLocaleLowerCase("nb");
function matches(text: string, query: string): boolean {
  const hay = norm(text);
  return norm(query).split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

const basename = (p: string) => p.split("/").pop() || p;

function projectName(thread: Thread): string {
  return thread.projectId ? app.projects[thread.projectId]?.name ?? "" : "Chat";
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

  const actionItems = (defs: ActionDef[]): Item[] =>
    defs.map((a) => ({ key: `a:${a.label}`, icon: icon(a.icon), label: a.label, keys: a.keys, run: a.run }));

  const sections = createMemo<Section[]>(() => {
    const q = query().trim();
    const t = tab();
    const defs = ACTIONS().filter((a) => !a.when || a.when());
    const matchedActions = q ? defs.filter((a) => matches(`${a.label} ${a.words ?? ""}`, q)) : defs;
    const project = fileProject();
    const recent = recentFiles()
      .filter((f) => app.projects[f.projectId])
      .slice(0, 5)
      .map((f) => fileItem(app.projects[f.projectId], f.path));
    const serverThreads = found()?.query === q ? found()!.threads : [];
    const fileHits = files()?.query === q && project ? files()!.items.map((i) => fileItem(project, i.path!)) : [];

    if (t === "actions") return [{ title: "Handlinger", items: actionItems(matchedActions), note: matchedActions.length ? undefined : "Ingen handlinger passer" }];
    if (t === "chats") {
      if (!q) return [{ title: "Nylige tråder", items: recentThreads().slice(0, 30).map((th) => threadItem(th)) }];
      return [{ title: "Tråder", items: serverThreads.map((th) => threadItem(th)), note: found()?.query === q && !serverThreads.length ? "Ingen tråder funnet" : undefined }];
    }
    if (t === "files") {
      if (!project) return [{ title: "Filer", items: [], note: "Åpne et prosjekt for å søke i filene" }];
      const shown = q ? fileHits : [...recent.filter((r) => r.key.startsWith(`f:${project.id}:`)), ...fileHits.filter((f) => !recent.some((r) => r.key === f.key))];
      return [{ title: `Filer i ${project.name}`, items: shown.slice(0, 40), note: files() && !shown.length ? "Ingen filer funnet" : undefined }];
    }
    if (t === "text") {
      if (!q) return [{ title: "Tekst", items: [], note: "Skriv for å søke i teksten i alle tråder" }];
      // The search matches titles and messages. Here only those found by their text count.
      const byText = serverThreads.filter((th) => !matches(th.title, q));
      const list = (byText.length ? byText : serverThreads).map((th) => threadItem(th, `Treff i meldingene · ${relativeTime(th.updatedAt)}`));
      return [{ title: "Treff i meldingene", items: list, note: found()?.query === q && !list.length ? "Ingen treff" : undefined }];
    }
    // Alle
    if (!q) {
      return [
        { title: "Hurtighandlinger", items: actionItems(defs.filter((a) => a.quick)) },
        { title: "Nylige tråder", items: recentThreads().slice(0, 5).map((th) => threadItem(th)) },
        { title: "Nylig åpnet", items: recent },
      ].filter((s) => s.items.length);
    }
    const localThreads = recentThreads().filter((th) => matches(th.title, q));
    const threads = [...localThreads, ...serverThreads.filter((th) => !localThreads.some((l) => l.id === th.id))].slice(0, 8);
    const out = [
      { title: "Handlinger", items: actionItems(matchedActions.slice(0, 6)) },
      { title: "Tråder", items: threads.map((th) => threadItem(th)) },
      { title: "Filer", items: fileHits.slice(0, 6) },
    ].filter((s) => s.items.length);
    return out.length ? out : [{ title: "Ingen treff", items: [], note: "Prøv en annen fane, eller et annet ord" }];
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
    <dialog ref={dialog} class="dialog palette" aria-label="Kommandopalett" onCancel={closePalette} onKeyDown={onKey} onClick={(e) => e.target === dialog && closePalette()}>
      <div class="palette-tabs" role="tablist" aria-label="Hva du søker i">
        <For each={TABS}>
          {(x) => (
            <button type="button" role="tab" class="palette-tab" aria-selected={tab() === x.id} tabindex="-1" onClick={() => { setTab(x.id); input.focus(); }}>{x.label}</button>
          )}
        </For>
        <kbd class="palette-tab-hint" title="Tab bytter fane">Tab</kbd>
      </div>
      <input
        ref={input}
        class="palette-input"
        placeholder={tab() === "files" ? "Søk etter filer" : tab() === "actions" ? "Søk etter en handling" : tab() === "text" ? "Søk i meldingene" : "Søk i tråder eller kjør en kommando"}
        aria-label="Søk i paletten"
        aria-controls="palette-list"
        aria-activedescendant={flat().length ? `palette-item-${selected()}` : undefined}
        spellcheck={false}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <div ref={list} class="palette-list" id="palette-list" role="listbox" aria-label="Treff">
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
