import { createResource, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import { ApiError, get } from "../lib/api";
import type { CommandInfo, FileEntry } from "../../../shared/protocol";
import { createProject, currentProject, dismissToast, folderPickerOpen, mode, setFolderPickerOpen, setMode, setProjectId, setSettingsOpen, toasts } from "../state/app";
import { displayKeys, keysFor, SHORTCUTS } from "../state/shortcuts";
import { HoverCardHost } from "./HoverCard";
import { TooltipHost } from "./Tooltip";
// Its rules stay where they were in the cascade; the dialog itself loads when it opens.
import "../styles/cookies.css";
import { MotionHost, motionOff } from "./Motion";
import { chromeImportOpen, cookieDialog, editing } from "./dialog-state";
import { palette } from "../state/nav";
import { IconClose, IconFolder, IconChevron, IconBack } from "./icons";
import { gridFor } from "../state/grid";

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
          <dialog ref={dialog} class="dialog" onCancel={() => close(false)}>
            <h2>{c().title}</h2>
            <p>{c().text}</p>
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
type InfoKind = "shortcuts" | "commands" | "skills" | "scheduled" | "whatsnew";
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
  const [commands] = createResource(() => {
    const project = mode() === "code" ? currentProject() : undefined;
    return get<CommandInfo[]>(project ? `/api/projects/${project.id}/commands` : "/api/commands");
  });
  return (
    <dl class="key-list commands">
      <For each={commands() ?? []}>
        {(c) => (
          <>
            <dt><code>{c.kind === "skill" ? "$" : "/"}{c.name}</code><Show when={c.demo}> <span class="demo-badge">Demo</span></Show></dt>
            <dd>{c.description}<Show when={c.aliases?.length}><span class="muted"> · også {c.aliases!.map((a) => `/${a}`).join(", ")}</span></Show></dd>
          </>
        )}
      </For>
      <dt><code>@</code></dt><dd>Legg ved filer, mapper og tråder</dd>
      <dt><code>$</code></dt><dd>Bruk en skill</dd>
      <dt><code>!kommando</code></dt><dd>Kjør en kommando i prosjektmappen</dd>
    </dl>
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

function Scheduled() {
  return (
    <div class="info-lead">
      <p><span class="demo-badge">Demo</span> Planlagte oppgaver skal starte en tråd til faste tider, for eksempel en daglig gjennomgang av endringene i et prosjekt eller en ukentlig opprydding.</p>
      <p class="muted">Ingenting er planlagt, og appen starter ingenting av seg selv i denne versjonen. Den gjør ikke noe arbeid når den står i ro.</p>
    </div>
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

const INFO_TITLES: Record<InfoKind, string> = { shortcuts: "Hurtigtaster", commands: "Kommandoer", skills: "Skills", scheduled: "Planlagt", whatsnew: "Hva er nytt" };

function InfoHost() {
  return (
    <Show when={infoDialog()} keyed>
      {(kind) => {
        let dialog!: HTMLDialogElement;
        onMount(() => dialog.showModal());
        const title = INFO_TITLES[kind];
        return (
          <dialog ref={dialog} class="dialog info-dialog" aria-label={title} onCancel={() => setInfoDialog(null)}>
            <div class="dialog-head">
              <h2>{title}</h2>
              <button type="button" class="icon-button" aria-label="Lukk" onClick={() => setInfoDialog(null)}><IconClose size={15} /></button>
            </div>
            <div class="info-body">{kind === "shortcuts" ? <ShortcutTable /> : kind === "commands" ? <CommandTable /> : kind === "skills" ? <SkillList /> : kind === "whatsnew" ? <WhatsNew /> : <Scheduled />}</div>
          </dialog>
        );
      }}
    </Show>
  );
}

// The folder picker in "just tell me the path" mode, for moving a project.
let pickResolve: ((path: string | null) => void) | null = null;
const [pickStart, setPickStart] = createSignal<string | undefined>(undefined);
const [pickTitle, setPickTitle] = createSignal<string | undefined>(undefined);

export function pickFolder(start?: string, title?: string): Promise<string | null> {
  pickResolve?.(null);
  return new Promise((resolve) => {
    pickResolve = resolve;
    setPickStart(start);
    setPickTitle(title);
    setFolderPickerOpen(true);
  });
}

function closePicker(path: string | null): void {
  const resolve = pickResolve;
  pickResolve = null;
  setFolderPickerOpen(false);
  resolve?.(path);
}

function FolderPicker() {
  let dialog!: HTMLDialogElement;
  const [current, setCurrent] = createSignal("");
  const [parent, setParent] = createSignal<string | null>(null);
  const [dirs, setDirs] = createSignal<FileEntry[]>([]);
  const [typed, setTyped] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

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
      const missing = pickResolve ? "Fant ikke mappen. Velg en mappe som finnes." : "Mappen finnes ikke ennå. Den lages når du velger den.";
      setError(err instanceof ApiError && err.status === 404 ? missing : (err as Error).message);
      setDirs([]);
    }
  };

  const choose = async () => {
    if (pickResolve) return closePicker(typed().trim() || current());
    setBusy(true);
    try {
      const project = await createProject(typed().trim() || current());
      setProjectId(project.id);
      setMode("code");
      gridFor(project.id);
      setFolderPickerOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  onMount(() => {
    dialog.showModal();
    void browse(pickResolve ? pickStart() : undefined);
  });

  return (
    <dialog ref={dialog} class="dialog folder-picker" aria-label="Velg mappe" onCancel={() => closePicker(null)}>
      <div class="dialog-head">
        <h2>{pickResolve ? pickTitle() ?? "Velg ny mappe for prosjektet" : "Velg en prosjektmappe"}</h2>
        <button type="button" class="icon-button" aria-label="Lukk" onClick={() => closePicker(null)}><IconClose size={15} /></button>
      </div>
      <form class="path-row" onSubmit={(e) => { e.preventDefault(); void browse(typed(), true); }}>
        <button type="button" class="icon-button" aria-label="Opp en mappe" disabled={!parent()} onClick={() => browse(parent()!, true)}><IconBack size={15} /></button>
        <input class="input" aria-label="Sti" value={typed()} spellcheck={false} onInput={(e) => { typedByHand = true; setTyped(e.currentTarget.value); }} />
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
        <button type="button" class="btn btn-primary" disabled={busy()} onClick={choose}>Velg denne mappen</button>
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
const EditProjectHost = lazy(() => import("./EditProject").then((m) => ({ default: m.EditProjectHost })));
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
      <PromptHost />
      <Show when={editing()}><Suspense><EditProjectHost /></Suspense></Show>
      <HoverCardHost />
      <Show when={palette()}><Suspense><CommandPaletteHost /></Suspense></Show>
      <TooltipHost />
      <MotionHost />
      <InfoHost />
      <Show when={chromeImportOpen()}><Suspense><ChromeImportHost /></Suspense></Show>
      <Show when={cookieDialog()}><Suspense><CookieImportHost /></Suspense></Show>
      <Show when={folderPickerOpen()}><FolderPicker /></Show>
      <Toasts />
    </>
  );
}

