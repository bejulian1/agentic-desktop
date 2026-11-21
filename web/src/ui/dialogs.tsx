import { Scheduled } from './Scheduled';
import { createResource, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import { ApiError, get, post } from "../lib/api";
import { desktop } from "../lib/desktop";
import { ProjectCreationDialog } from "./ProjectCreationDialog";
import type { CommandInfo, FileEntry } from "../../../shared/protocol";
import { app, currentProject, dismissToast, folderPickerOpen, mode, scope, setFolderPickerOpen, setSettingsOpen, toasts } from "../state/app";
import { displayKeys, keysFor, SHORTCUTS } from "../state/shortcuts";
import { HoverCardHost } from "./HoverCard";
import { TooltipHost } from "./Tooltip";
// Its rules stay where they were in the cascade; the dialog itself loads when it opens.
import "../styles/cookies.css";
import { MotionHost, motionOff } from "./Motion";
import { chatProjectDialog, chromeImportOpen, cookieDialog, editing, gitWorkspaceDialog } from "./dialog-state";
import { chatProjectPageId, palette } from "../state/nav";
import { peekGrid } from "../state/grid";
import { visibleCommands } from "../../../shared/slash-commands";
import { CommandList } from "./CommandList";
import { IconClose, IconFolder, IconChevron, IconBack, IconSearch } from "./icons";

interface Confirm {
  title: string;
  text: string;
  confirm: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

const [confirming, setConfirming] = createSignal<Confirm | null>(null);

export function confirmDialog(options: Omit<Confirm, "resolve">): Promise<boolean> {
  return new Promise((resolve) => setConfirming({ ...options, resolve }));
}

function ConfirmHost() {
  const close = (value: boolean) => {
    confirming()?.resolve(value);
    setConfirming(null);
  };
  return (
    <Show when={confirming()}>
      {(c) => {
        let dialog!: HTMLDialogElement;
        onMount(() => dialog.showModal());
        return (
          <dialog ref={dialog} class="dialog" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-text" onCancel={() => close(false)}>
            <h2 id="confirm-dialog-title">{c().title}</h2>
            <p id="confirm-dialog-text">{c().text}</p>
            <div class="dialog-actions">
              <button type="button" class="btn" onClick={() => close(false)}>Avbryt</button>
              <button type="button" class="btn" classList={{ "btn-danger": c().danger, "btn-primary": !c().danger }} onClick={() => close(true)}>{c().confirm}</button>
            </div>
          </dialog>
        );
      }}
    </Show>
  );
}

interface Prompt {
  title: string;
  value: string;
  confirm: string;
  resolve: (value: string | null) => void;
}

const [prompting, setPrompting] = createSignal<Prompt | null>(null);

export function promptDialog(options: Omit<Prompt, "resolve">): Promise<string | null> {
  return new Promise((resolve) => setPrompting({ ...options, resolve }));
}

function PromptHost() {
  return (
    <Show when={prompting()}>
      {(p) => {
        let dialog!: HTMLDialogElement;
        let input!: HTMLInputElement;
        const close = (value: string | null) => {
          p().resolve(value);
          setPrompting(null);
        };
        onMount(() => {
          dialog.showModal();
          input.select();
        });
        return (
          <dialog ref={dialog} class="dialog" aria-label={p().title} onCancel={() => close(null)}>
            <form onSubmit={(e) => { e.preventDefault(); close(input.value); }}>
              <h2>{p().title}</h2>
              <input ref={input} class="input prompt-input" value={p().value} aria-label={p().title} />
              <div class="dialog-actions">
                <button type="button" class="btn" onClick={() => close(null)}>Avbryt</button>
                <button type="submit" class="btn btn-primary">{p().confirm}</button>
              </div>
            </form>
          </dialog>
        );
      }}
    </Show>
  );
}

// Lists that the Hjelp menu opens: shortcuts and commands.
type InfoKind = "shortcuts" | "commands" | "skills" | "scheduled" | "whatsnew" | "releases";
const [infoDialog, setInfoDialog] = createSignal<InfoKind | null>(null);
export { infoDialog, setInfoDialog };

// One grid for the whole list, so the keys line up in one column from the first group to the last.
function ShortcutTable() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <>
      <div class="shortcut-grid">
        <For each={groups}>
          {(group) => (
            <>
              <h3 class="info-group">{group}</h3>
              <For each={SHORTCUTS.filter((s) => s.group === group)}>
                {(s) => <><span class="shortcut-label">{s.label}</span><span class="shortcut-keys"><kbd>{displayKeys(keysFor(s.id))}</kbd></span></>}
              </For>
            </>
          )}
        </For>
      </div>
      <p class="info-foot">
        <button type="button" class="link-button" onClick={() => { setInfoDialog(null); setSettingsOpen("shortcuts"); }}>Endre hurtigtastene i Innstillinger</button>
      </p>
    </>
  );
}

function CommandTable() {
  const code = () => mode() === "code";
  const project = () => code() ? currentProject()?.id : undefined;
  const chatProject = () => {
    if (code()) return false;
    const active = peekGrid(scope())?.focusedThreadId();
    return !!(chatProjectPageId() || (active && app.threads[active]?.chatProjectId));
  };
  const [commands] = createResource(
    () => project() ? `/api/projects/${project()}/commands?includeReserved=1` : `/api/commands?includeReserved=1&mode=${code() ? "code" : "chat"}${chatProject() ? "&scope=project" : ""}`,
    (url) => get<CommandInfo[]>(url).catch(() => null),
  );
  return (
    <Show when={!commands.loading} fallback={<SkeletonLines />}>
      <Show when={commands()} fallback={<p>Kunne ikke hente kommandoene.</p>}>
        {entries => <CommandList commands={visibleCommands(entries(), { code: code(), project: !!project(), chatProject: chatProject(), detached: new URLSearchParams(location.search).has("rute") })} />}
      </Show>
    </Show>
  );
}

// Skills from the sidebar: what exists for the project in Kode, or for you in Chat.
function SkillList() {
  const project = () => (mode() === "code" ? currentProject() : undefined);
  const [commands] = createResource(() => get<CommandInfo[]>(project() ? `/api/projects/${project()!.id}/commands` : "/api/commands"));
  const skills = () => (commands() ?? []).filter((c) => c.kind === "skill");
  return (
    <>
      <p class="info-lead">Skills er mapper med en <code>SKILL.md</code>. Hver skill blir en <code>/kommando</code> og kan brukes med <code>$</code> i meldingsfeltet. {project() ? `Viser skills for ${project()!.name} og dine egne.` : "Viser dine egne. Velg et prosjekt i Kode for å se prosjektets."}</p>
      <Show when={commands()} fallback={<SkeletonLines />}>
        <dl class="key-list commands">
          <For each={skills()} fallback={<><dt class="muted">Ingen skills</dt><dd>Legg dem i <code>.agentic/skills/</code> i prosjektet eller i <code>~/.config/agentic-desktop/skills/</code>.</dd></>}>
            {(c) => <><dt><code>${c.name}</code></dt><dd>{c.description}<span class="muted"> · {c.source === "project" ? "prosjekt" : "global"}</span></dd></>}
          </For>
        </dl>
      </Show>
    </>
  );
}


// Hva er nytt: the newest entries of the patch log, as plain text with `code` kept.
function Inline(props: { text: string }) {
  const parts = () => props.text.replace(/\*\*/g, "").split("`");
  return <For each={parts()}>{(part, i) => (i() % 2 ? <code>{part}</code> : part)}</For>;
}

// Grey lines in the shape of a list while it loads, so the dialog does not jump when it comes.
export function SkeletonLines(props: { count?: number }) {
  return (
    <div class="skeleton-lines" role="status">
      <span class="sr-only">Henter…</span>
      <For each={Array.from({ length: props.count ?? 4 })}>{() => <span class="skeleton skeleton-line" aria-hidden="true" />}</For>
    </div>
  );
}

interface ReleaseBlock { kind: "heading" | "item" | "text"; depth: number; text: string }
interface ReleaseEntry { title: string; version: string | null; name: string; date: string | null; build: string | null; body: string; blocks: ReleaseBlock[] }

// **bold** and `code` from the patch log, as text nodes. Nothing in it is ever parsed as HTML.
function RichText(props: { text: string }) {
  const parts = () => props.text.split("`");
  return (
    <For each={parts()}>
      {(part, i) => (i() % 2 ? <code>{part}</code> : <For each={part.split("**")}>{(bit, j) => (j() % 2 ? <strong>{bit}</strong> : bit)}</For>)}
    </For>
  );
}

const wholeBold = (text: string) => /^\*\*[^*]+\*\*:?$/.test(text);

function ReleaseBody(props: { blocks: ReleaseBlock[] }) {
  return (
    <div class="release-body">
      <For each={props.blocks}>
        {(block) =>
          block.kind === "heading" || (block.kind === "text" && wholeBold(block.text)) ? (
            <h4 class="release-sub">{block.text.replace(/\*\*/g, "").replace(/:$/, "")}</h4>
          ) : block.kind === "item" ? (
            <p class="release-item" style={{ "--depth": block.depth }}><span class="release-dot" aria-hidden="true" /><span><RichText text={block.text} /></span></p>
          ) : (
            <p class="release-text"><RichText text={block.text} /></p>
          )
        }
      </For>
    </div>
  );
}

// The whole history in one list to scroll through: newest at the top, the first round at the
// bottom. Opened from Profil, Innstillinger and Om.
function ReleaseHistory() {
  const [query, setQuery] = createSignal("");
  const [history, { refetch }] = createResource(() => get<{ entries: ReleaseEntry[] }>("/api/releases"));
  const all = () => history()?.entries ?? [];
  const entries = () => {
    const q = query().toLocaleLowerCase().trim();
    return q ? all().filter((entry) => `${entry.title} ${entry.body}`.toLocaleLowerCase().includes(q)) : all();
  };
  const current = () => app.build?.version;
  const first = () => all().at(-1);
  return (
    <div class="release-history">
      <div class="release-search">
        <IconSearch size={14} />
        <input type="search" class="release-search-input" aria-label="Søk i versjonsloggen" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="Søk etter versjon eller funksjon" />
        <Show when={history()}><span class="release-count muted" role="status">{query().trim() ? `${entries().length} av ${all().length}` : `${all().length} versjoner`}</span></Show>
      </div>
      <Show when={history.loading}><SkeletonLines count={8} /></Show>
      <Show when={history.error}>
        <p role="alert">Kunne ikke hente versjonsloggen.</p>
        <button type="button" class="btn" onClick={() => void Promise.resolve(refetch()).catch(() => undefined)}>Prøv igjen</button>
      </Show>
      <Show when={history()}>
        <ol class="release-list" aria-label="Versjoner, nyeste først">
          <For each={entries()} fallback={<li class="muted release-empty">Ingen versjoner passer søket.</li>}>
            {(entry) => {
              // A version can have several entries (0.9.0 had bygg 28–30): only the newest is marked.
              const isCurrent = () => !!entry.version && entry.version === current() && all().find((e) => e.version === entry.version) === entry;
              return (
                <li class="release-entry" data-version={entry.version ?? undefined}>
                  <header class="release-head">
                    <span class="release-version" classList={{ round: !entry.version }}>{entry.version ?? entry.name.split(":")[0]}</span>
                    <Show when={isCurrent()}><span class="release-current">Denne versjonen</span></Show>
                    <span class="release-meta muted">
                      {[entry.date, entry.build ? `bygg ${entry.build}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </header>
                  <h3 class="release-name">{entry.version ? entry.name : entry.name.replace(/^[^:]+:\s*/, "")}</h3>
                  <ReleaseBody blocks={entry.blocks} />
                </li>
              );
            }}
          </For>
        </ol>
        <Show when={!query().trim() && first()}>
          {(f) => <p class="release-end muted">Her begynte det: {f().name.replace(/^[^:]+:\s*/, "")}{f().date ? `, ${f().date}` : ""}.</p>}
        </Show>
      </Show>
    </div>
  );
}

function WhatsNew() {
  const [news] = createResource(() => get<{ entries: Array<{ title: string; lines: string[] }> }>("/api/whatsnew"));
  return (
    <Show when={news()} fallback={<SkeletonLines />}>
      {(n) => (
        <For each={n().entries} fallback={<p class="muted">Fant ingen endringslogg.</p>}>
          {(entry) => (
            <section class="whatsnew-entry">
              <h3 class="info-group">{entry.title}</h3>
              <ul class="whatsnew-list">
                <For each={entry.lines}>{(line) => (line.startsWith("- ") ? <li><Inline text={line.slice(2)} /></li> : <li class="whatsnew-head"><Inline text={line} /></li>)}</For>
              </ul>
            </section>
          )}
        </For>
      )}
    </Show>
  );
}

const INFO_TITLES: Record<InfoKind, string> = { shortcuts: "Hurtigtaster", commands: "Kommandoer", skills: "Skills", scheduled: "Planlagt", whatsnew: "Hva er nytt", releases: "Versjonslogg" };

function InfoHost() {
  return (
    <Show when={infoDialog()} keyed>
      {(kind) => {
        let dialog!: HTMLDialogElement;
        onMount(() => dialog.showModal());
        const title = INFO_TITLES[kind];
        return (
          <dialog ref={dialog} class="dialog info-dialog" classList={{ "release-dialog": kind === "releases" }} aria-label={title} onCancel={() => setInfoDialog(null)} onKeyDown={event => { if (kind === "releases" && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setInfoDialog(null); } }}>
            <div class="dialog-head">
              <h2>{title}</h2>
              <button type="button" class="icon-button" aria-label="Lukk" onClick={() => setInfoDialog(null)}><IconClose size={15} /></button>
            </div>
            <div class="info-body">{kind === "shortcuts" ? <ShortcutTable /> : kind === "commands" ? <CommandTable /> : kind === "skills" ? <SkillList /> : kind === "whatsnew" ? <WhatsNew /> : kind === "releases" ? <ReleaseHistory /> : <Scheduled />}</div>
          </dialog>
        );
      }}
    </Show>
  );
}

// Native folder selection is shared by project creation, moving and relinking. The
// in-app browser is used only when the host explicitly cannot offer a native chooser.
interface FolderRequest {
  resolve: (path: string | null) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}
let folderRequest: FolderRequest | null = null;
const [folderBrowseOpen, setFolderBrowseOpen] = createSignal(false);
const [pickStart, setPickStart] = createSignal<string | undefined>(undefined);
const [pickTitle, setPickTitle] = createSignal<string | undefined>(undefined);

function closePicker(path: string | null): void {
  const request = folderRequest;
  folderRequest = null;
  setFolderBrowseOpen(false);
  request?.cleanup();
  request?.resolve(path);
}

export function pickFolder(start?: string, title?: string, signal?: AbortSignal): Promise<string | null> {
  closePicker(null);
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const abort = () => { if (folderRequest === request) closePicker(null); };
    const request: FolderRequest = { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) };
    folderRequest = request;
    signal?.addEventListener("abort", abort, { once: true });
    setPickStart(start);
    setPickTitle(title);
    void (async () => {
      try {
        const path = desktop?.pickFolder
          ? await desktop.pickFolder(start, title)
          : (await post<{ path: string | null }>("/api/fs/pick-folder", { start, title })).path;
        if (folderRequest === request) closePicker(path);
      } catch (error) {
        if (folderRequest !== request) return;
        if (error instanceof ApiError && error.status === 501) {
          setFolderBrowseOpen(true);
        } else {
          folderRequest = null;
          request.cleanup();
          request.reject(error);
        }
      }
    })();
  });
}

function FolderPicker() {
  let dialog!: HTMLDialogElement;
  const [current, setCurrent] = createSignal("");
  const [parent, setParent] = createSignal<string | null>(null);
  const [dirs, setDirs] = createSignal<FileEntry[]>([]);
  const [typed, setTyped] = createSignal("");
  const [error, setError] = createSignal("");

  // A path typed while the first listing is on its way is kept, so a fast hand is not overwritten.
  let typedByHand = false;
  const browse = async (path?: string, byHand = false) => {
    if (byHand) typedByHand = false;
    setError("");
    try {
      const result = await get<{ path: string; parent: string | null; dirs: FileEntry[] }>(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`);
      setCurrent(result.path);
      if (!typedByHand) setTyped(result.path);
      setParent(result.parent);
      setDirs(result.dirs);
    } catch (err) {
      const missing = "Fant ikke mappen. Velg en mappe som finnes.";
      setError(err instanceof ApiError && err.status === 404 ? missing : (err as Error).message);
      setDirs([]);
    }
  };

  const choose = () => closePicker(typed().trim() || current());

  onMount(() => {
    dialog.showModal();
    void browse(pickStart());
  });

  return (
    <dialog ref={dialog} class="dialog folder-picker" aria-label="Velg mappe" onCancel={(event) => { event.preventDefault(); closePicker(null); }}>
      <div class="dialog-head">
        <h2>{pickTitle() ?? "Velg mappe"}</h2>
        <button type="button" class="icon-button" aria-label="Lukk" onClick={() => closePicker(null)}><IconClose size={15} /></button>
      </div>
      <form class="path-row" onSubmit={(e) => { e.preventDefault(); void browse(typed(), true); }}>
        <button type="button" class="icon-button" aria-label="Opp en mappe" disabled={!parent()} onClick={() => browse(parent()!, true)}><IconBack size={15} /></button>
        <input class="input" aria-label="Sti" value={typed()} spellcheck={false} onFocus={() => { typedByHand = true; }} onInput={(e) => { typedByHand = true; setTyped(e.currentTarget.value); }} />
      </form>
      <div class="folder-list" role="list">
        <For each={dirs()} fallback={<div class="muted folder-empty">Ingen undermapper</div>}>
          {(dir) => (
            <button type="button" class="folder-item" onClick={() => browse(dir.path, true)}>
              <IconFolder size={15} /><span>{dir.name}</span><IconChevron size={12} />
            </button>
          )}
        </For>
      </div>
      <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={() => closePicker(null)}>Avbryt</button>
        <button type="button" class="btn btn-primary" disabled={!typed().trim() && !current()} onClick={choose}>Velg denne mappen</button>
      </div>
    </dialog>
  );
}

// When a toast goes, a copy of it slides out where it was. The copy is inert and hidden from
// assistive tech, and the list itself stays as the state says.
function leave(el: HTMLElement | undefined): void {
  if (!el?.isConnected || motionOff()) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.className = el.classList.contains("error") ? "toast-ghost error" : "toast-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
  document.body.append(ghost);
  ghost.addEventListener("animationend", () => ghost.remove());
  setTimeout(() => ghost.remove(), 600);
}

function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      <For each={toasts()}>
        {(t) => {
          let el: HTMLDivElement | undefined;
          onCleanup(() => leave(el));
          return (
          <div ref={el} class="toast" classList={{ error: t.kind === "error" }}>
            <span>{t.text}</span>
            <Show when={t.action}>
              {(action) => (
                <button type="button" class="btn btn-small toast-action" onClick={() => { dismissToast(t.id); action().run(); }}>{action().label}</button>
              )}
            </Show>
            <button type="button" class="icon-button" aria-label="Lukk" onClick={() => dismissToast(t.id)}><IconClose size={13} /></button>
          </div>
          );
        }}
      </For>
    </div>
  );
}

// The larger dialogs load the first time they open, not at start (SPEC 29.5). Each is mounted only
// while it is open; their state is in dialog-state.ts and state/nav.ts. On this machine a chunk is
// there within a frame or two, and until then nothing is drawn, so nothing flickers.
const GitWorkspaceHost = lazy(() => import("./GitWorkspace").then((m) => ({ default: m.GitWorkspaceHost })));
const EditProjectHost = lazy(() => import("./EditProject").then((m) => ({ default: m.EditProjectHost })));
const ChatProjectDialogHost = lazy(() => import("./ChatProjectDialog").then((m) => ({ default: m.ChatProjectDialogHost })));
const CommandPaletteHost = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPaletteHost })));
const ChromeImportHost = lazy(() => import("./ChromeImport").then((m) => ({ default: m.ChromeImportHost })));
const CookieImportHost = lazy(() => import("./CookieImport").then((m) => ({ default: m.CookieImportHost })));

// The palette opens from the keyboard, and what is typed right after Mod+K must land in it, so it
// is fetched once the app is idle after start.
export function preloadPalette(): void {
  void CommandPaletteHost.preload();
}

export function GlobalLayers() {
  return (
    <>
      <ConfirmHost />
      <Show when={gitWorkspaceDialog()}><Suspense><GitWorkspaceHost /></Suspense></Show>
      <PromptHost />
      <Show when={editing()}><Suspense><EditProjectHost /></Suspense></Show>
      <Show when={chatProjectDialog()}><Suspense><ChatProjectDialogHost /></Suspense></Show>
      <HoverCardHost />
      <Show when={palette()}><Suspense><CommandPaletteHost /></Suspense></Show>
      <TooltipHost />
      <MotionHost />
      <InfoHost />
      <Show when={chromeImportOpen()}><Suspense><ChromeImportHost /></Suspense></Show>
      <Show when={cookieDialog()}><Suspense><CookieImportHost /></Suspense></Show>
      <Show when={folderPickerOpen()}><ProjectCreationDialog pickFolder={pickFolder} onClose={() => setFolderPickerOpen(false)} /></Show>
      <Show when={folderBrowseOpen()}><FolderPicker /></Show>
      <Toasts />
    </>
  );
}

