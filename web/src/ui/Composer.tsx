// The message field. The textarea is uncontrolled, so typing costs what typing costs in a plain
// textarea: nothing reactive runs on a keystroke unless the word under the caret starts with / or @.
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import { ApiError, del, get, patch, post } from "../lib/api";
import { on as onSocket, onOpen } from "../lib/socket";
import type { Attachment, AttachmentRef, BusyMessages, CommandInfo, MentionItem, ModelConfig, ReasoningEffort, Thread } from "../../../shared/protocol";
import { effortSteps, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_UPLOAD_BYTES, PERSONALITIES } from "../../../shared/protocol";
import { app, scopeOf, LOCAL_SCOPE, modelFor, modelName, report, setApp, setMode, mode, projectId as selectedProjectId, setProjectId, setSettingsOpen, sortedProjects, setFolderPickerOpen, settingsOpen, toast } from "../state/app";
import { actions, forkThread } from "../state/actions";
import { gridFor } from "../state/grid";
import { createThreadFor, newChatIn, newThreadIn, openThread } from "../state/navigate";
import { peekModel } from "../state/thread-model";
import { revertLastTurn, startPlaytest, openVscode } from "../state/project-actions";
import { formatCost, formatTokens } from "../lib/format";
import {
  IconFile, IconFolder, IconBranch, IconSend, IconStop, IconCode, IconSpark, IconClose, IconTerminal, IconChevronDown, IconCheck, IconList, IconPlus,
  IconLaptop, IconMic, IconBolt, IconSearch, IconImage, IconReset, IconBack, IconSliders,
  IconNewThread, IconBrain, IconInfo, IconTarget, IconBook, IconArchive, IconHelp, IconChat, IconPlay, IconUndo, IconEye, IconUsers, IconSplitRight,
  IconMonitor, IconChevron, IconWarn, IconDots, IconPencil, IconTrash,
} from "./icons";
import { GoalLine } from "./Goal";
import { ChatToolButton, useChatTools } from "./ChatToolMenu";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "./ContextMenu";
import "../styles/queue.css";
import { Popover } from "./Popover";
import { PermissionPicker } from "./PermissionPicker";
import "../styles/permissions.css";
import { ProjectGlyph } from "./ProjectGlyph";
import { AttachmentChip, imageUrl, showImage } from "./rows";
import { FolderMissingBar } from "./FolderMissingBar";
import { gitInfo, loadGitInfo } from "../state/home";
import { displayKeys } from "../state/shortcuts";
import { registerChatPersonality } from "../state/chat-personality";
import { composerDeliveries, deliverToComposer, setComposerDeliveries } from "../state/composer-delivery";
import { chatProjectPageId, openedFileContext } from "../state/nav";
import { closeProjectPicker, useProjectPicker } from "../state/project-picker";
import { openGitWorkspace } from "./dialog-state";
import { ProjectEnvironmentPicker } from "./ProjectEnvironmentPicker";
import { editChatProject } from "./chat-projects";
import "../styles/project-picker.css";
export { deliverToComposer, type ComposerDelivery } from "../state/composer-delivery";
export { openProjectPicker } from "../state/project-picker";

type Menu =
  | { kind: "command"; query: string; start: number; end: number }
  | { kind: "skill"; query: string; start: number; end: number }
  | { kind: "mention"; query: string; start: number; end: number }
  | { kind: "shell"; query: string };

interface Picker {
  title: string;
  items: Array<{ id: string; label: string; detail?: string; selected?: boolean }>;
  pick: (id: string) => void;
}

interface InfoCard {
  title: string;
  demo?: boolean;
  rows?: Array<[string, string]>;
  text?: string;
}

export const EFFORTS: Array<{ id: ReasoningEffort; label: string }> = [
  { id: "none", label: "Ingen" },
  { id: "low", label: "Lav" },
  { id: "medium", label: "Middels" },
  { id: "high", label: "Høy" },
  { id: "xhigh", label: "Ekstra høy" },
  { id: "max", label: "Maks" },
];

// What each placeholder will do when it is built. Shown with a Demo badge, never pretending.
const DEMO_TEXT: Record<string, string> = {
  approve: "Når automatisk gjennomgang av verktøykall finnes, lar denne deg godkjenne ett nytt forsøk etter et avslag. Appen har ingen automatisk gjennomgang ennå, så det er ingenting å godkjenne.",
  "ide-context": "Skal dele åpen fil og markering fra VS Code med tråden, så modellen ser hva du ser på. Krever en utvidelse til editoren, som ikke finnes ennå.",
  local: "Skal flytte en tråd fra skyen til det valgte lokale prosjektet. Alle tråder kjører lokalt i denne appen, så det er ingenting å flytte.",
  memories: "Minnene er ekte nå: modellen lagrer korte notater med remember og får dem i nye tråder. Se, endre og slett dem i Innstillinger → Personalisering og minner.",
};

const CODE_ONLY = new Set(["undo", "playtest", "vscode", "init", "review", "review-changes", "worktree"]);
const CODE_MODE_ONLY = new Set(["goal", "plan"]);

// An icon per command, by what it is about: the thread, the model, the project or the agent.
const COMMAND_ICONS: Record<string, (p: { size?: number }) => any> = {
  new: IconNewThread, fork: IconBranch, side: IconSplitRight, task: IconChat, compact: IconArchive, undo: IconUndo, review: IconEye,
  model: IconBolt, reasoning: IconBrain, personality: IconSliders, status: IconInfo,
  project: IconFolder, init: IconFile, playtest: IconPlay, vscode: IconCode,
  goal: IconTarget, plan: IconList, memories: IconBook, storage: IconArchive, help: IconHelp, mode: IconChat,
  mcp: IconUsers, local: IconLaptop, worktree: IconBranch, approve: IconCheck, "ide-context": IconCode,
};

// The arguments as the user can type them, in Norwegian where the app understands both.
const ARG_WORDS: Record<string, string> = { none: "ingen", low: "lav", medium: "middels", high: "høy", xhigh: "ekstra høy", max: "maks" };
function argsText(args: string): string {
  return args.replace(/[a-z]+/g, (word) => ARG_WORDS[word] ?? word).replace(/\|/g, " | ");
}

function matchScore(command: CommandInfo, query: string): number | null {
  if (!query) return 3;
  const names = [command.name, ...(command.aliases ?? [])].map((n) => n.toLowerCase());
  if (names.includes(query)) return 0;
  if (names.some((n) => n.startsWith(query))) return 1;
  if (names.some((n) => n.includes(query))) return 2;
  // Subsequence matches let /rvw find /review without weakening exact/prefix matches.
  const scores = names.flatMap((name) => {
    let at = -1;
    let gaps = 0;
    for (const char of query) {
      const next = name.indexOf(char, at + 1);
      if (next < 0) return [];
      gaps += next - at - 1;
      at = next;
    }
    return [3 + gaps / Math.max(1, name.length)];
  });
  return scores.length ? Math.min(...scores) : null;
}

type Chip = AttachmentRef & { label: string; key: string };

const drafts = new Map<string, string>();
const draftParts = new Map<string, { chips: Chip[]; skill: string | null }>();
const draftOwners = new Map<string, symbol>();

// Round 11b (SPEC 25.1): images and text handed to a pane's field from outside, by Annoter in the
// Browser panel. The field with that key (the thread's id, or the empty pane's) takes them, now or
// when it mounts. The text goes under what is already typed, and nothing is sent.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const LIMIT_TEXT = `Du kan legge ved maks ${MAX_ATTACHMENTS} bilder og filer per melding.`;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Kunne ikke lese filen"));
    reader.readAsDataURL(file);
  });
}

const LOCAL_TEXT = "Appen og verktøyene kjører på denne maskinen, i prosjektmappen når du har valgt en. Modellforespørsler går til den valgte leverandøren eller endepunktet. Du kan ikke velge en annen vert over SSH eller i skyen ennå.";
const MIC_TEXT = "Skal la deg snakke inn meldingen. Ingen lyd tas opp i denne versjonen, og mikrofonen brukes ikke.";

// The picker opened from somewhere without a field of its own (Vis alle prosjekter on the start page).
export const NO_PROJECT_KEY = "no-project";
let carried: string | null = null;

// Picks a project for Kode. What was typed in the field the picker came from goes with it, into a
// new thread in the project.
export function chooseProject(id: string, fromKey: string = NO_PROJECT_KEY): void {
  closeProjectPicker();
  if (mode() === "code" && selectedProjectId() === id) return;
  carried = drafts.get(fromKey) || null;
  drafts.delete(fromKey);
  setProjectId(id);
  setMode("code");
}

// Ikke jobb i et prosjekt: Kode on Denne datamaskinen, without a folder and without tools.
export function chooseNoProject(): void {
  closeProjectPicker();
  setProjectId(null);
  setMode("code");
}

// "~/kode/agentic-desktop", and the start and the end of a long path: "~/…/klient/web".
export function shortPath(path: string, max = 42): string {
  const home = path.replace(/^\/home\/[^/]+(?=\/|$)/, "~").replace(/^\/root(?=\/|$)/, "~");
  if (home.length <= max) return home;
  const parts = home.split("/");
  const head = parts[0] === "" ? `/${parts[1]}` : parts[0];
  let tail = parts.at(-1)!;
  for (let i = parts.length - 2; i > 1; i--) {
    if (`${head}/…/${parts[i]}/${tail}`.length > max) break;
    tail = `${parts[i]}/${tail}`;
  }
  return `${head}/…/${tail}`;
}

const nb = (text: string) => text.toLocaleLowerCase("nb");

// Lower is better: the name starts with it, a word in the name does, the name has it, the path has it.
function projectScore(project: { name: string; path: string }, query: string): number | null {
  const name = nb(project.name);
  if (name.startsWith(query)) return 0;
  if (name.split(/[\s\-_.]+/).some((word) => word.startsWith(query))) return 1;
  if (name.includes(query)) return 2;
  if (nb(project.path).includes(query)) return 3;
  return null;
}

// With this many projects or more, Nylige shows the latest few and Alle prosjekter all of them.
const PICKER_SECTIONS_FROM = 5;
const PICKER_RECENT = 3;

type PickerEntry = { kind: "project"; project: ReturnType<typeof sortedProjects>[number] } | { kind: "new" } | { kind: "none" };

// The project picker: search at the top, Nylige and Alle prosjekter below, and Nytt prosjekt and
// Ikke jobb i et prosjekt at the bottom. The focus stays in the search field; the arrow keys move a
// marker through every row, Enter picks it and Esc closes.
export function ProjectPicker(props: { current: string | null; paneKey: string; onDone: () => void; onCancel: () => void }) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let list: HTMLDivElement | undefined;
  const q = () => nb(query().trim());
  const sections = createMemo(() => {
    const all = sortedProjects();
    if (q()) {
      const hits = all.flatMap((project) => {
        const score = projectScore(project, q());
        return score === null ? [] : [{ project, score }];
      });
      hits.sort((a, b) => a.score - b.score || b.project.lastUsedAt - a.project.lastUsedAt);
      return [{ title: hits.length === 1 ? "1 treff" : `${hits.length} treff`, projects: hits.map((h) => h.project) }];
    }
    if (all.length < PICKER_SECTIONS_FROM) return all.length ? [{ title: "Nylige", projects: all }] : [];
    const byName = [...all].sort((a, b) => a.name.localeCompare(b.name, "nb", { sensitivity: "base" }));
    return [{ title: "Nylige", projects: all.slice(0, PICKER_RECENT) }, { title: "Alle prosjekter", projects: byName }];
  });
  const entries = createMemo<PickerEntry[]>(() => [
    ...sections().flatMap((s) => s.projects.map((project) => ({ kind: "project" as const, project }))),
    { kind: "new" },
    { kind: "none" },
  ]);
  // Where each section starts in the flat list, so a row knows its own index.
  const offsets = createMemo(() => {
    let at = 0;
    return sections().map((s) => {
      const start = at;
      at += s.projects.length;
      return start;
    });
  });
  const optionId = (index: number) => `project-option-${props.paneKey}-${index}`;
  createEffect(on(query, () => setSelected(0), { defer: true }));
  createEffect(() => {
    const index = selected();
    list?.querySelector(`#${CSS.escape(optionId(index))}`)?.scrollIntoView({ block: "nearest" });
  });
  const run = (entry: PickerEntry | undefined) => {
    if (!entry) return;
    // Round 12 (SPEC 26.1): no new threads in a project whose folder is gone.
    if (entry.kind === "project") {
      if (entry.project.folderMissing) return;
      if (entry.project.id === props.current) return props.onCancel();
      props.onDone();
      return chooseProject(entry.project.id, props.paneKey);
    }
    props.onDone();
    if (entry.kind === "new") setFolderPickerOpen(true);
    else chooseNoProject();
  };
  const onKey = (event: KeyboardEvent) => {
    const count = entries().length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((selected() + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if ((event.key === "Home" || event.key === "End") && !query()) {
      event.preventDefault();
      setSelected(event.key === "Home" ? 0 : count - 1);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      run(entries()[selected()]);
    } else if (event.key === "Escape") {
      // Before the popover's own listener, so the focus can go back to the chip.
      event.preventDefault();
      event.stopPropagation();
      props.onCancel();
    }
  };
  const hover = (index: number) => {
    if (selected() !== index) setSelected(index);
  };
  return (
    <div class="project-picker" role="dialog" aria-label="Velg prosjekt" data-testid="project-picker-menu" onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onDone(); }}>
      <label class="picker-search">
        <IconSearch size={14} />
        <input
          class="search-input"
          placeholder="Søk på navn eller sti"
          aria-label="Søk i prosjekter"
          role="combobox"
          aria-expanded="true"
          aria-controls={`project-list-${props.paneKey}`}
          aria-activedescendant={optionId(selected())}
          autocomplete="off"
          spellcheck={false}
          value={query()}
          ref={(el) => requestAnimationFrame(() => el.focus())}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKey}
        />
      </label>
      <div class="menu-list picker-list" role="listbox" id={`project-list-${props.paneKey}`} aria-label="Prosjekter" ref={list}>
        <Show
          when={sections().length && sections()[0].projects.length}
          fallback={
            <div class="menu-empty picker-empty">
              <Show when={q()} fallback={<>Ingen prosjekter ennå. Velg en mappe med Nytt prosjekt.</>}>
                Ingen prosjekter med «{query().trim()}» i navnet eller stien.
              </Show>
            </div>
          }
        >
          <For each={sections()}>
            {(section, s) => (
              <div role="group" aria-label={section.title} class="picker-group">
                <div class="menu-heading" aria-hidden="true">{section.title}</div>
                <For each={section.projects}>
                  {(project, i) => {
                    const index = () => offsets()[s()] + i();
                    return (
                      <button
                        type="button"
                        role="option"
                        class="menu-item picker-project"
                        tabindex="-1"
                        aria-selected={project.id === props.current}
                        aria-disabled={project.folderMissing ? "true" : undefined}
                        title={project.folderMissing ? `Fant ikke ${project.path}. Åpne en tråd i prosjektet for å velge mappen på nytt.` : project.path}
                        id={optionId(index())}
                        classList={{ selected: selected() === index(), missing: !!project.folderMissing }}
                        onPointerMove={() => hover(index())}
                        onClick={() => run({ kind: "project", project })}
                      >
                        <ProjectGlyph project={project} size={16} />
                        <span class="menu-stack">
                          <span class="menu-name">{project.name}</span>
                          <Show when={project.folderMissing} fallback={<span class="picker-path">{shortPath(project.path)}</span>}>
                            <span class="picker-path picker-missing" data-testid="picker-missing"><IconWarn size={12} />Mappen mangler</span>
                          </Show>
                        </span>
                        <span class="menu-check"><Show when={project.id === props.current}><IconCheck size={14} /></Show></span>
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="menu-sep" role="separator" />
      <button type="button" class="menu-item" tabindex="-1" id={optionId(entries().length - 2)} classList={{ selected: selected() === entries().length - 2 }} onPointerMove={() => hover(entries().length - 2)} onClick={() => run({ kind: "new" })}>
        <IconPlus size={14} /><span class="menu-name">Nytt prosjekt</span>
      </button>
      <button type="button" class="menu-item" tabindex="-1" id={optionId(entries().length - 1)} classList={{ selected: selected() === entries().length - 1 }} onPointerMove={() => hover(entries().length - 1)} onClick={() => run({ kind: "none" })}>
        <IconMonitor size={14} /><span class="menu-stack"><span class="menu-name">Ikke jobb i et prosjekt</span><span class="picker-path">Denne datamaskinen, uten mappe og verktøy</span></span>
        <span class="menu-check"><Show when={!props.current}><IconCheck size={14} /></Show></span>
      </button>
    </div>
  );
}

// Context use as a small ring, with the numbers on hover: the thread's context, tokens and cost,
// and the project's total in Kode. The status bar had these before.
function ContextRing(props: { threadId: () => string | null; modelId: Accessor<string | null>; projectId: string | null }) {
  const usage = createMemo(() => {
    const id = props.threadId();
    return id ? (peekModel(id)?.usage() ?? null) : null;
  });
  const window_ = createMemo(() => modelFor(props.modelId())?.contextWindow ?? 0);
  const percent = createMemo(() => {
    const u = usage();
    return u && window_() ? Math.min(100, Math.round((u.contextTokens / window_()) * 100)) : 0;
  });
  const projectUsage = () => (props.projectId ? app.projectUsage[props.projectId] : undefined);
  const R = 7;
  const C = 2 * Math.PI * R;
  // An empty thread has used nothing, and an open grey ring there reads as loading.
  return (
    <Show when={usage()}>
    <span class="context-ring" tabindex="0" role="img" aria-label={`Kontekst ${percent()} % brukt`} data-testid="context-ring" data-level={percent() >= 85 ? "high" : percent() >= 60 ? "mid" : "low"}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={R} class="ring-track" />
        <circle cx="9" cy="9" r={R} class="ring-fill" stroke-dasharray={`${(percent() / 100) * C} ${C}`} transform="rotate(-90 9 9)" />
      </svg>
      <span class="ring-pop" role="tooltip">
        <strong>Kontekst {percent()} %</strong>
        <span>{usage() ? `${formatTokens(usage()!.contextTokens)} av ${formatTokens(window_())} tokens` : `0 av ${formatTokens(window_())} tokens`}</span>
        <Show when={usage()}>
          <span>{formatTokens(usage()!.inputTokens)} inn, {formatTokens(usage()!.outputTokens)} ut</span>
          <Show when={usage()!.costUsd !== null}><span>Kostnad {formatCost(usage()!.costUsd!)}</span></Show>
        </Show>
        <Show when={projectUsage()}>
          <span class="ring-project" data-testid="project-usage">
            Prosjekt: {formatTokens(projectUsage()!.inputTokens + projectUsage()!.outputTokens)} tokens
            <Show when={projectUsage()!.costUsd !== null}>, {formatCost(projectUsage()!.costUsd!)}</Show>
          </span>
        </Show>
      </span>
    </span>
    </Show>
  );
}

// Legg til mappe: the project's folders from the mentions endpoint, with search and arrow keys.
function FolderPicker(props: { projectId: string; onPick: (item: MentionItem) => void; onBack: () => void }) {
  const [query, setQuery] = createSignal("");
  const [items, setItems] = createSignal<MentionItem[]>([]);
  const [selected, setSelected] = createSignal(0);
  let request = 0;
  createEffect(() => {
    const q = query().trim();
    const id = ++request;
    get<MentionItem[]>(`/api/projects/${props.projectId}/mentions?kind=dir&q=${encodeURIComponent(q)}`)
      .then((found) => {
        if (id !== request) return;
        setItems(q ? found : [{ kind: "dir", label: "./", path: "." }, ...found]);
        setSelected(0);
      })
      .catch(report);
  });
  const onKey = (e: KeyboardEvent) => {
    const count = items().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (count) setSelected((selected() + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items()[selected()];
      if (item) props.onPick(item);
    } else if (e.key === "Backspace" && !query()) props.onBack();
  };
  return (
    <div class="attach-folders" role="dialog" aria-label="Legg til mappe">
      <div class="folder-head">
        <button type="button" class="icon-button" title="Tilbake til menyen" aria-label="Tilbake" onClick={props.onBack}><IconBack size={14} /></button>
        <span>Legg til mappe</span>
      </div>
      <label class="picker-search">
        <IconSearch size={14} />
        <input class="search-input" placeholder="Søk i mapper" aria-label="Søk i mapper" ref={(el) => requestAnimationFrame(() => el.focus())} onInput={(e) => setQuery(e.currentTarget.value)} onKeyDown={onKey} />
      </label>
      <div class="menu-list" role="listbox" aria-label="Mapper">
        <For each={items()} fallback={<div class="menu-empty">Ingen mapper{query() ? " med det navnet" : ""}</div>}>
          {(item, index) => (
            <button type="button" role="option" class="menu-item" classList={{ selected: index() === selected() }} aria-selected={index() === selected()} title={`Legg ved en oversikt over ${item.label}`} onClick={() => props.onPick(item)}>
              <IconFolder size={14} /><span class="menu-name">{item.label}</span>
            </button>
          )}
        </For>
      </div>
      <p class="folder-note">Modellen får en oversikt over mappen, ikke innholdet i filene.</p>
    </div>
  );
}

// Round 10 (SPEC 23.3): the model list. A search field on top, the models grouped under a heading per
// provider, a check on the chosen one and «Administrer modeller» at the bottom. The keyboard stays in
// the search field: ↑ and ↓ move the marked row (aria-activedescendant), Enter picks it, Esc closes.
// The list scrolls on its own between the field and the bottom row.
let modelMenuSeq = 0;
function ModelMenu(props: { chosen: string | null; onPick: (id: string) => void; onManage: () => void }) {
  const listId = `model-list-${++modelMenuSeq}`;
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal<string | null>(props.chosen);
  let search!: HTMLInputElement;
  let list!: HTMLDivElement;
  let frame = 0;
  const groups = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out: Array<{ id: string; name: string; models: ModelConfig[] }> = [];
    for (const provider of app.providers) {
      const models = app.models.filter((m) => {
        if (m.providerId !== provider.id) return false;
        const hay = `${m.name} ${m.model} ${provider.name}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      if (models.length) out.push({ id: provider.id, name: provider.name, models });
    }
    return out;
  });
  const flat = createMemo(() => groups().flatMap((g) => g.models.map((m) => m.id)));
  // The marked row follows the filter: it stays when it is still there, else the first.
  createEffect(on(flat, (ids) => {
    if (!ids.includes(active() ?? "")) setActive(ids[0] ?? null);
  }));
  const optionId = (id: string) => `${listId}-${encodeURIComponent(id)}`;
  const reveal = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const row = list?.querySelector<HTMLElement>(".model-option.active");
      if (!row) return;
      const box = list.getBoundingClientRect();
      const item = row.getBoundingClientRect();
      // Scroll only the model list. scrollIntoView can also move the surrounding pane.
      if (item.top < box.top) list.scrollTop -= box.top - item.top;
      else if (item.bottom > box.bottom) list.scrollTop += item.bottom - box.bottom;
    });
  };
  const move = (step: number) => {
    const ids = flat();
    if (!ids.length) return;
    const at = ids.indexOf(active() ?? "");
    setActive(ids[at < 0 ? 0 : (at + step + ids.length) % ids.length]);
    reveal();
  };
  onMount(() => {
    search.focus({ preventScroll: true });
    reveal();
  });
  onCleanup(() => cancelAnimationFrame(frame));
  createEffect(on(query, reveal, { defer: true }));
  return (
    <div class="model-menu" data-testid="model-menu">
      <div class="model-heading">Velg modell</div>
      <label class="model-search">
        <IconSearch size={14} />
        <input
          ref={search}
          type="text"
          role="combobox"
          aria-label="Søk etter modeller"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active() ? optionId(active()!) : undefined}
          placeholder="Søk etter modeller"
          spellcheck={false}
          autocomplete="off"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              move(e.key === "ArrowDown" ? 1 : -1);
            } else if (e.key === "Home" && !query()) {
              e.preventDefault();
              setActive(flat()[0] ?? null);
              reveal();
            } else if (e.key === "End" && !query()) {
              e.preventDefault();
              setActive(flat().at(-1) ?? null);
              reveal();
            } else if (e.key === "Enter" && !e.isComposing) {
              e.preventDefault();
              const id = active();
              if (id) props.onPick(id);
            }
          }}
        />
      </label>
      <div class="model-list" role="listbox" aria-label="Modeller" id={listId} ref={list}>
        <For each={groups()} fallback={<p class="model-none">Ingen modeller passer «{query().trim()}».</p>}>
          {(group) => (
            <div role="group" aria-label={group.name} class="model-group">
              <div class="model-group-head" aria-hidden="true"><span>{group.name}</span></div>
              <For each={group.models}>
                {(model) => (
                  <button
                    type="button"
                    role="option"
                    tabindex="-1"
                    id={optionId(model.id)}
                    class="menu-item model-option"
                    classList={{ active: active() === model.id }}
                    aria-selected={props.chosen === model.id}
                    title={model.model === "mock" ? model.name : `${model.name} (${model.model})`}
                    onPointerMove={() => active() !== model.id && setActive(model.id)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => props.onPick(model.id)}
                  >
                    <span class="menu-name">{model.name}</span>
                    <span class="menu-check"><Show when={props.chosen === model.id}><IconCheck size={14} /></Show></span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
      <div class="model-foot">
        <button type="button" class="menu-item model-manage" onMouseDown={(e) => e.preventDefault()} onClick={props.onManage}><IconSliders size={15} /><span class="menu-name">Administrer modeller</span></button>
      </div>
    </div>
  );
}

const effortLabel = (value: ReasoningEffort | null | undefined) => EFFORTS.find((e) => e.id === value)?.label ?? "";

// Innsats (SPEC 21.3, 23.4): a popover over the field. In the middle, straight on the popover, the level in the
// accent colour and the model's name, with › to the model menu; a reset on the right; and under them
// a slider with a dot per step the model takes, from Ingen to Maks. Mouse, drag, the arrow keys and
// Home/End all move it. A drag shows the level as it goes and is saved when it is let go.
function EffortPicker(props: {
  steps: ReasoningEffort[];
  chosen: ReasoningEffort | null;
  modelDefault: ReasoningEffort | null;
  modelName: string;
  onPick: (value: ReasoningEffort | null) => void;
  onModel: () => void;
}) {
  const [preview, setPreview] = createSignal<number | null>(null);
  // The dragged value stands until the choice has come back, so the thumb never jumps back.
  createEffect(on(() => props.chosen, () => setPreview(null), { defer: true }));
  const last = () => props.steps.length - 1;
  // Legacy/custom values outside this provider's scale still get a stable position.
  const positionOf = (value: ReasoningEffort | null): number | null => {
    if (!value) return null;
    const at = props.steps.indexOf(value);
    if (at >= 0) return at;
    const high = props.steps.indexOf("high");
    return value === "xhigh" && high >= 0 ? Math.min(last(), high + 0.5) : null;
  };
  // Nothing chosen and no known standard: the thumb waits in the middle, so it is there
  // from the first moment and slides from there to what is picked.
  const middle = () => {
    const at = props.steps.indexOf("medium");
    return at >= 0 ? at : Math.floor(last() / 2);
  };
  const position = () => preview() ?? positionOf(props.chosen) ?? positionOf(props.modelDefault) ?? middle();
  const standard = () => preview() === null && props.chosen === null;
  // The model's standard is not a known level: the thumb waits in the middle until one is
  // chosen, and the arrows start from there.
  const unset = () => standard() && positionOf(props.modelDefault) === null;
  const name = () => {
    const p = preview();
    if (p !== null) return effortLabel(props.steps[p]);
    if (props.chosen) return effortLabel(props.chosen);
    const fallback = effortLabel(props.modelDefault);
    return fallback ? `Standard (${fallback.toLowerCase()})` : "Modellens standard";
  };
  const fraction = () => (last() > 0 ? position() / last() : 0);
  let track!: HTMLDivElement;
  onMount(() => track.focus({ preventScroll: true }));
  const stepAt = (clientX: number) => {
    const rail = track.querySelector<HTMLElement>(".effort-rail")!.getBoundingClientRect();
    const x = (clientX - rail.left) / Math.max(1, rail.width);
    return Math.max(0, Math.min(last(), Math.round(x * last())));
  };
  const commit = (index: number) => {
    const value = props.steps[index];
    // The parent keeps the optimistic choice while persistence is pending. Always commit,
    // including a return to the stored level while an earlier choice is still being saved.
    props.onPick(value);
    setPreview(null);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    setPreview(stepAt(event.clientX));
    const move = (e: PointerEvent) => setPreview(stepAt(e.clientX));
    const end = (e: PointerEvent) => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
      if (e.type === "pointercancel") return setPreview(null);
      commit(stepAt(e.clientX));
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const now = Math.round(position());
    if (unset() && /^Arrow/.test(event.key)) {
      event.preventDefault();
      const middle = props.steps.indexOf("medium");
      return commit(middle >= 0 ? middle : Math.floor(last() / 2));
    }
    const next =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? Math.min(last(), Math.floor(position()) + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? Math.max(0, Math.ceil(position()) - 1)
      : event.key === "Home" || event.key === "PageDown" ? 0
      : event.key === "End" || event.key === "PageUp" ? last()
      : null;
    if (next === null) return;
    event.preventDefault();
    if (next !== now || standard() || position() % 1) commit(next);
  };
  return (
    <div class="effort-pop" data-testid="effort-picker" role="dialog" aria-label="Innsats">
      <div class="effort-head">
        <button type="button" class="effort-mid" title="Velg en annen modell" aria-label={`Velg modell. Nåværende modell: ${props.modelName}`} onClick={props.onModel}>
          <span class="effort-level" data-testid="effort-name" classList={{ standard: standard() }}>{name()}</span>
          <span class="effort-model"><span class="effort-model-name">{props.modelName}</span><IconChevron size={12} /></span>
        </button>
        <button type="button" class="icon-button effort-reset" title="Tilbake til modellens standard" aria-label="Tilbake til modellens standard" disabled={props.chosen === null} onClick={() => { setPreview(null); props.onPick(null); }}>
          <IconReset size={15} />
        </button>
      </div>
      <div
        ref={track}
        class="effort-slider"
        classList={{ dragging: preview() !== null, standard: standard(), unset: unset() }}
        role="slider"
        tabindex="0"
        aria-label="Innsats"
        aria-valuemin={0}
        aria-valuemax={last()}
        aria-valuenow={position()}
        aria-valuetext={name()}
        data-testid="effort-slider"
        style={{ "--pos": fraction(), "--steps": last() }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div class="effort-track" aria-hidden="true">
          <div class="effort-rail"><span class="effort-fill" /></div>
          <For each={props.steps}>
            {(_, i) => <span class="effort-dot" classList={{ on: i() <= position() }} style={{ "--at": last() > 0 ? i() / last() : 0 }} />}
          </For>
        </div>
        <div class="effort-rail effort-thumb-rail" aria-hidden="true"><span class="effort-thumb" /></div>
      </div>
      <div class="effort-scale" aria-hidden="true"><span>{effortLabel(props.steps[0])}</span><span>{effortLabel(props.steps[last()])}</span></div>
    </div>
  );
}

function chipAttachment(chip: Chip): Attachment {
  if (chip.kind === "thread") return { kind: "thread", label: chip.label, threadId: chip.threadId };
  if (chip.kind === "image") return { kind: "image", label: chip.label, imageId: chip.imageId };
  if (chip.kind === "upload") return { kind: "upload", label: chip.label, uploadId: chip.uploadId };
  return { kind: chip.kind, label: chip.label, path: chip.path };
}

function chipRef(chip: Chip): AttachmentRef {
  if (chip.kind === "thread") return { kind: "thread", threadId: chip.threadId };
  if (chip.kind === "image") return { kind: "image", imageId: chip.imageId, name: chip.label };
  if (chip.kind === "upload") return { kind: "upload", uploadId: chip.uploadId, name: chip.label };
  return { kind: chip.kind, path: chip.path };
}

export function Composer(props: {
  paneKey: string;
  threadId: () => string | null;
  projectId: string | null;
  // Kode without a project (Denne datamaskinen): the project row shows, and a message makes a Kode
  // thread with no folder and no tools.
  code?: boolean;
  // Chat: a new thread goes into this Chat project (round 9).
  chatProjectId?: string | null;
  onThreadCreated: (thread: Thread) => void;
  onSent: () => void;
  // Navigation from a project landing happens only after the server accepted its first message.
  onAccepted?: (threadId: string) => void;
  autofocus?: boolean;
  registerFill?: (fill: (text: string) => void) => void;
}) {
  let textarea!: HTMLTextAreaElement;
  const draftOwner = Symbol("composer-draft");
  let draftRevision = 0;
  let projectChip: HTMLButtonElement | undefined;
  const [menu, setMenu] = createSignal<Menu | null>(null);
  const menuId = `composer-suggestions-${props.paneKey}`;
  const optionId = (index: number) => `${menuId}-${index}`;
  let composing = false;
  const completionClientId = crypto.randomUUID();
  const [completion, setCompletion] = createSignal("");
  const [completionPrefix, setCompletionPrefix] = createSignal("");
  const [completionRevision, setCompletionRevision] = createSignal(0);
  const [completionFocused, setCompletionFocused] = createSignal(false);
  let completionDismissed = false;
  let completionRequest = 0;
  let completionOverlay: HTMLDivElement | undefined;
  let completionFrame = 0;
  const [selected, setSelected] = createSignal(0);
  const [commands, setCommands] = createSignal<CommandInfo[]>([]);
  const [resolvingCommand, setResolvingCommand] = createSignal(false);
  const [mentions, setMentions] = createSignal<MentionItem[]>([]);
  const [chips, setChips] = createSignal<Chip[]>([]);
  const [uploading, setUploading] = createSignal(0);
  const [acceptedThread, setAcceptedThread] = createSignal<string | null>(null);
  createEffect(() => {
    const id = acceptedThread();
    if (!id || uploading()) return;
    setAcceptedThread(null);
    untrack(() => props.onAccepted?.(id));
  });
  let fileInput!: HTMLInputElement;
  let textInput!: HTMLInputElement;
  let attachMenu: HTMLDivElement | undefined;
  const [attachView, setAttachView] = createSignal<"menu" | "folders">("menu");
  const [skill, setSkill] = createSignal<string | null>(null);
  const [hasText, setHasText] = createSignal(false);
  const [draftModel, setDraftModel] = createSignal<string | null>(null);
  const [modelOpen, setModelOpen] = createSignal(false);
  const [effortOpen, setEffortOpen] = createSignal(false);
  let modelButton!: HTMLButtonElement;
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [attachOpen, setAttachOpen] = createSignal(false);
  // Chosen before the thread exists: applied when the first message creates it.
  const [draftReasoning, setDraftReasoning] = createSignal<ReasoningEffort | null | undefined>(undefined);
  const [draftPersonality, setDraftPersonality] = createSignal<string | null>(null);
  const projectPicker = useProjectPicker(() => props.paneKey, "composer");
  const pickerOpen = projectPicker.open;
  const [picker, setPicker] = createSignal<Picker | null>(null);
  const [info, setInfo] = createSignal<InfoCard | null>(null);

  const thread = createMemo(() => {
    const id = props.threadId();
    return id ? app.threads[id] : undefined;
  });
  const running = createMemo(() => thread()?.running ?? false);
  const kode = () => !!(props.projectId || props.code);
  const chatProject = createMemo(() => {
    const id = thread()?.chatProjectId ?? props.chatProjectId;
    return !kode() && id ? app.chatProjects[id] : undefined;
  });
  const inChatProject = () => !kode() && !!(thread()?.chatProjectId ?? props.chatProjectId);
  const enterNewline = () => app.settings.enterKey === "newline";
  const sendKeys = () => (enterNewline() ? "Mod+Enter" : "Enter");
  const project = createMemo(() => (props.projectId ? app.projects[props.projectId] : undefined));
  // Round 12 (SPEC 26.1): the folder is gone. The thread can be read, but nothing is sent until the
  // folder is chosen again (the line above the field); then it opens again by itself.
  const locked = () => !!project()?.folderMissing;
  // When the folder is chosen again, the field is back and ready to write in.
  createEffect(on(locked, (now, before) => {
    if (before && !now) requestAnimationFrame(() => textarea?.focus({ preventScroll: true }));
  }));
  const modelId = createMemo(() => thread()?.modelId ?? draftModel());
  // Round 13 (SPEC 27.2): the tools of this chat, or the ones chosen before it exists.
  const chatTools = useChatTools(props.threadId, modelId);
  const draftKey = () => props.threadId() ?? (props.chatProjectId ? `${props.paneKey}:chat-project:${props.chatProjectId}` : props.paneKey);
  const branchInfo = () => (props.projectId ? gitInfo(props.projectId) : undefined);
  const branch = () => branchInfo()?.branch ?? null;
  const [pendingEffort, setPendingEffort] = createSignal<Record<string, ReasoningEffort | null>>({});
  const effortWrites = new Map<string, { value: ReasoningEffort | null; revision: number; done: Promise<unknown> }>();
  const chosenEffort = (): ReasoningEffort | null => {
    const current = thread();
    if (current) {
      const pending = pendingEffort();
      return Object.hasOwn(pending, current.id) ? pending[current.id] : current.reasoning;
    }
    return draftReasoning() ?? null;
  };
  // The steps the model takes (SPEC 21.3). A model that takes none has no effort button.
  const steps = createMemo(() => {
    const model = modelFor(modelId());
    const provider = app.providers.find((p) => p.id === model?.providerId);
    return model ? effortSteps(provider?.kind, model, provider?.baseUrl) : [];
  });
  // «Høy», or «Velg innsats» while the model's own standard is used.
  const effortChip = () => effortLabel(chosenEffort()) || "Velg innsats";
  const setEffort = (value: ReasoningEffort | null, close = true) => {
    if (close) setEffortOpen(false);
    const id = props.threadId();
    if (!id) return setDraftReasoning(value);
    setPendingEffort((pending) => ({ ...pending, [id]: value }));
    const active = effortWrites.get(id);
    if (active) {
      active.value = value;
      active.revision += 1;
      return;
    }
    const write = { value, revision: 0, done: Promise.resolve<unknown>(undefined) };
    effortWrites.set(id, write);
    // One PATCH at a time per thread. Coalesce further slider/reset choices and save the
    // newest one after this response, so an older request can never arrive last.
    write.done = (async () => {
      while (effortWrites.get(id) === write) {
        const revision = write.revision;
        let failure: unknown;
        try {
          const saved: Thread = await patch<Thread>(`/api/threads/${id}`, { reasoning: write.value });
          if (saved.id === id && app.threads[id]) setApp("threads", id, "reasoning", saved.reasoning);
        } catch (error) {
          failure = error;
          report(error);
        }
        if (revision !== write.revision) continue;
        effortWrites.delete(id);
        setPendingEffort((pending) => {
          const next = { ...pending };
          delete next[id];
          return next;
        });
        return failure;
      }
    })();
  };
  const personality = () => {
    const current = thread();
    return (current ? current.personality : draftPersonality()) ?? "standard";
  };
  const setPersonality = async (value: string): Promise<void> => {
    const current = props.threadId();
    if (!current) {
      setDraftPersonality(value);
      return;
    }
    const saved = await patch<Thread>(`/api/threads/${current}`, { personality: value });
    // Apply only the saved field to the original chat; a delayed response must not recreate a
    // deleted thread or overwrite another pane's choice (or newer unrelated thread fields).
    if (saved.id === current && app.threads[current]) setApp("threads", current, "personality", saved.personality);
  };
  // Settings stays beside the mounted app, so this also preserves the pre-first-message choice.
  // Autofocus follows the pane selection, rather than DOM focus inside the Settings page.
  createEffect(() => {
    if (kode() || inChatProject() || chatProjectPageId() || !props.autofocus) return;
    onCleanup(registerChatPersonality({
      threadId: props.threadId,
      title: () => thread()?.title,
      personality,
      setPersonality,
    }));
  });
  // The global default applies to Chat and Code. Capture this queue before awaiting a
  // settings write, so navigating to another pane cannot retarget messages already waiting.
  const busyMode = (): BusyMessages => app.settings.busyMessages ?? "queue";
  const [busySaving, setBusySaving] = createSignal(false);
  const [queueAction, setQueueAction] = createSignal<string | null>(null);
  const [queueMenu, setQueueMenu] = createSignal<{ threadId: string; messageId: string; anchor: MenuAnchor } | null>(null);
  const [queueEdit, setQueueEdit] = createSignal<{ threadId: string; messageId: string; text: string } | null>(null);
  createEffect(on(() => props.threadId(), () => { setQueueMenu(null); setQueueEdit(null); }));
  createEffect(() => { if (settingsOpen()) setQueueMenu(null); });
  const setBusyMode = async (value: BusyMessages) => {
    if (busySaving() || busyMode() === value) return;
    const id = props.threadId();
    const waiting = queued().filter((q) => !q.from && q.steerable !== false).map((q) => ({ ...q }));
    setBusySaving(true);
    try {
      await patch("/api/settings", { busyMessages: value });
      setApp("settings", "busyMessages", value);
      const steer = value === "steer";
      if (!id) return;
      for (const q of waiting) {
        if (!!q.steer === steer) continue;
        try {
          await patch(`/api/threads/${id}/queue/${encodeURIComponent(q.messageId)}`, { steer });
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) toast("En melding forlot køen før valget kunne endres.", "info");
          else throw error;
        }
      }
    } catch (error) {
      report(error);
    } finally {
      setBusySaving(false);
    }
  };
  const steerOne = async (messageId: string) => {
    const id = props.threadId();
    if (!id || queueAction()) return;
    setQueueAction(messageId);
    try { await patch(`/api/threads/${id}/queue/${encodeURIComponent(messageId)}`, { steer: true }); }
    catch (error) { report(error); }
    finally { setQueueAction(null); }
  };
  const removeOne = async (id: string, messageId: string) => {
    if (queueAction()) return;
    setQueueAction(messageId);
    try { await del(`/api/threads/${id}/queue/${encodeURIComponent(messageId)}`); }
    catch (error) { report(error); }
    finally { setQueueAction(null); }
  };
  const saveQueueEdit = async () => {
    const edit = queueEdit();
    if (!edit || queueAction()) return;
    setQueueAction(edit.messageId);
    try {
      await patch(`/api/threads/${edit.threadId}/queue/${encodeURIComponent(edit.messageId)}`, { text: edit.text });
      if (queueEdit() === edit) setQueueEdit(null);
    } catch (error) { report(error); }
    finally { setQueueAction(null); }
  };
  const moveToSide = async (id: string, messageId: string) => {
    if (queueAction()) return;
    setQueueAction(messageId);
    try {
      const moved = await post<{ thread: Thread; text: string; attachments?: Attachment[] }>(`/api/threads/${id}/queue/${encodeURIComponent(messageId)}/side-draft`);
      deliverToComposer(moved.thread.id, { text: moved.text, images: [], attachments: moved.attachments });
      const targetGrid = gridFor(scopeOf(moved.thread));
      await targetGrid.loaded;
      const original = targetGrid.paneWith(id);
      if (!original || !targetGrid.split(original.id, "right", moved.thread.id)) await openThread(moved.thread);
      toast("Meldingen er flyttet fra køen til et utkast i sidesamtalen.", "info");
    } catch (error) { report(error); }
    finally { setQueueAction(null); }
  };
  const queueEntries = (): MenuEntry[] => {
    const menu = queueMenu();
    const item = menu && queued().find((q) => q.messageId === menu.messageId);
    if (!menu || !item) return [];
    const disabled = !!queueAction();
    return [
      { label: "Rediger melding", icon: IconPencil, disabled: disabled || item.editable === false, title: item.editable === false ? "Flytt skills, gjennomganger og skallkommandoer til en sidesamtale for å redigere dem" : "Endre teksten uten å endre plassen i køen", run: () => { setQueueEdit({ threadId: menu.threadId, messageId: menu.messageId, text: item.text }); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".queue-editor textarea")?.focus()); } },
      { label: "Flytt til sidesamtale", icon: IconSplitRight, disabled, title: "Ta meldingen ut av køen og legg tekst og vedlegg i et usendt utkast i en ny sidesamtale", run: () => moveToSide(menu.threadId, menu.messageId) },
      { label: "Fjern fra køen", icon: IconTrash, disabled, run: () => removeOne(menu.threadId, menu.messageId) },
      "sep",
      { label: busyMode() === "queue" ? "Slå av kø" : "Slå på kø", icon: IconSend, disabled: busySaving(), title: "Gjelder nye meldinger i Chat og Kode og dine ventende meldinger i denne tråden", run: () => setBusyMode(busyMode() === "queue" ? "steer" : "queue") },
    ];
  };
  const insertTrigger = (char: string) => {
    setAttachOpen(false);
    textarea.focus();
    const before = textarea.value.slice(0, textarea.selectionStart);
    const text = char === "!" ? "!" : before && !/\s$/.test(before) ? ` ${char}` : char;
    if (char === "!") textarea.setRangeText("!", 0, 0, "end");
    else textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
    onInput();
  };

  let commandRequest = 0;
  let commandsAlive = true;
  onCleanup(() => { commandsAlive = false; commandRequest += 1; });
  const loadCommands = async () => {
    const request = ++commandRequest;
    const url = props.projectId ? `/api/projects/${props.projectId}/commands` : "/api/commands";
    try {
      const found = await get<CommandInfo[]>(url);
      if (commandsAlive && request === commandRequest) setCommands(found);
      return found;
    } catch { return null; /* Keep the last working menu. */ }
  };

  let mentionRequest = 0;
  onCleanup(() => { mentionRequest += 1; });
  const loadMentions = (query: string) => {
    if (!props.projectId) return;
    const id = ++mentionRequest;
    get<MentionItem[]>(`/api/projects/${props.projectId}/mentions?q=${encodeURIComponent(query)}`)
      .then((items) => {
        if (id === mentionRequest && menu()?.kind === "mention" && menu()?.query === query) {
          setMentions(items);
          setSelected(0);
        }
      })
      .catch(() => undefined);
  };

  const closeMenu = () => {
    mentionRequest += 1;
    if (menu()) setMenu(null);
  };

  // Runs on input and caret moves: a cheap look at the word under the caret.
  const inspect = () => {
    const value = textarea.value;
    const caret = textarea.selectionStart;
    setHasText(value.length > 0);
    if (composing || caret !== textarea.selectionEnd) return closeMenu();
    if (kode() && value.startsWith("!") && !value.slice(0, caret).includes("\n")) {
      setMenu({ kind: "shell", query: value.slice(1) });
      return;
    }
    const before = value.slice(0, caret);
    const match = /(?:^|\s)([/@$])([^\s@$]*)$/.exec(before);
    if (!match) return closeMenu();
    const query = match[2];
    const start = caret - query.length - 1;
    const kind = match[1] === "/" ? "command" : match[1] === "$" ? "skill" : "mention";
    if (kind !== "mention" && query.includes("/")) return closeMenu();
    if (kind === "command" && value.slice(0, start).trim()) return closeMenu();
    if (kind === "mention" && !props.projectId) return closeMenu();
    if (kind === "skill" && inChatProject()) return closeMenu();
    const previous = menu();
    const changed = !previous || previous.kind !== kind || previous.query !== query || previous.start !== start;
    if (changed) setSelected(0);
    let end = caret;
    const tokenChar = kind === "mention" ? /[^\s@$]/ : /[^\s/@$]/;
    while (end < value.length && tokenChar.test(value[end])) end += 1;
    setMenu({ kind, query, start, end });
    if (kind === "mention" && changed) {
      setMentions([]);
      loadMentions(query);
    }
    else if (kind !== "mention") mentionRequest += 1;
    if (kind !== "mention" && !commands().length) loadCommands();
  };

  const commandItems = createMemo(() => {
    const current = menu();
    if (current?.kind !== "command" && current?.kind !== "skill") return [];
    const query = current.query.toLowerCase();
    const hidden = (c: CommandInfo) => c.demo || (inChatProject() && (c.kind === "skill" || c.name === "personality")) || (current.kind === "skill" && c.kind !== "skill") || (c.kind === "builtin" && ((!props.projectId && CODE_ONLY.has(c.name)) || (!kode() && CODE_MODE_ONLY.has(c.name))));
    return commands()
      .flatMap((c) => {
        const score = hidden(c) ? null : matchScore(c, query);
        return score === null ? [] : [{ c, score }];
      })
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c);
  });

  const itemCount = () => {
    const current = menu();
    if (current?.kind === "command" || current?.kind === "skill") return commandItems().length;
    if (current?.kind === "mention") return mentions().length;
    return 0;
  };
  const hasSuggestions = () => !!menu() && menu()?.kind !== "shell";

  // The preview shares the textarea's exact width and typography, including wrapped lines.
  // Only the suffix is visible; the existing draft remains the native textarea's text.
  const syncCompletionLayout = () => {
    if (!completionOverlay) return;
    const style = getComputedStyle(textarea);
    completionOverlay.style.width = `${textarea.clientWidth}px`;
    for (const property of ["font", "line-height", "letter-spacing", "word-spacing", "text-indent", "tab-size", "padding", "box-sizing"]) {
      completionOverlay.style.setProperty(property, style.getPropertyValue(property));
    }
    textarea.style.minHeight = `${Math.max(26, Math.min(completionOverlay.scrollHeight, innerHeight * 0.38))}px`;
    completionOverlay.scrollTop = textarea.scrollTop;
    completionOverlay.scrollLeft = textarea.scrollLeft;
  };
  createEffect(() => {
    completion(); completionPrefix();
    cancelAnimationFrame(completionFrame);
    if (!completion()) {
      if (textarea) textarea.style.removeProperty("min-height");
      return;
    }
    completionFrame = requestAnimationFrame(syncCompletionLayout);
  });
  onCleanup(() => cancelAnimationFrame(completionFrame));

  createEffect(() => {
    completionRevision();
    const enabled = app.settings.promptAutocomplete;
    const focused = completionFocused() && props.autofocus;
    const threadId = props.threadId();
    const projectId = props.projectId;
    const selectedModel = app.settings.promptAutocompleteModelId ?? modelId();
    const filePath = kode() && projectId ? openedFileContext(projectId, threadId) : undefined;
    // Persisted completed turns decide readiness; loaded/partial timeline rows cannot.
    const blocked = menu() || running() || locked() || thread()?.promptHistoryReady !== true || !enabled || !focused || composing || completionDismissed;
    const request = ++completionRequest;
    setCompletion("");
    if (blocked || !textarea) return;
    const text = textarea.value;
    if (text.trim().length < 3 || text.length > 4000 || textarea.selectionStart !== text.length || textarea.selectionEnd !== text.length) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/prompt-completion", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({ clientId: completionClientId, threadId: threadId ?? undefined, projectId: projectId ?? undefined, mode: kode() ? "code" : "chat", modelId: selectedModel ?? undefined, text, filePath }),
        });
        if (!response.ok) return;
        const result = await response.json();
        if (request !== completionRequest || controller.signal.aborted || textarea.value !== text || document.activeElement !== textarea || textarea.selectionStart !== text.length || textarea.selectionEnd !== text.length) return;
        if (typeof result.completion !== "string" || !result.completion || result.completion.length > 400) return;
        setCompletionPrefix(text);
        setCompletion(result.completion);
      } catch { /* Suggestions are optional; failed requests never change the draft. */ }
    }, 650);
    onCleanup(() => { clearTimeout(timer); controller.abort(); });
  });

  let slashMenu: HTMLDivElement | undefined;
  let slashFrame = 0;
  onCleanup(() => cancelAnimationFrame(slashFrame));
  createEffect(() => {
    const count = itemCount();
    setSelected((index) => count ? Math.min(index, count - 1) : 0);
  });
  createEffect(() => {
    menu(); selected(); commandItems();
    cancelAnimationFrame(slashFrame);
    slashFrame = requestAnimationFrame(() => {
      const row = slashMenu?.querySelector<HTMLElement>(".menu-item.selected");
      if (!slashMenu || !row) return;
      const list = slashMenu.getBoundingClientRect();
      const item = row.getBoundingClientRect();
      if (item.top < list.top) slashMenu.scrollTop -= list.top - item.top;
      else if (item.bottom > list.bottom) slashMenu.scrollTop += item.bottom - list.bottom;
    });
  });

  const replaceWord = (start: number, end: number, text: string) => {
    textarea.setRangeText(text, start, end, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  };

  const patchThread = async (body: Record<string, unknown>): Promise<Thread> => {
    const id = await ensureThread();
    return patch<Thread>(`/api/threads/${id}`, body);
  };

  const showStatus = () => {
    const current = thread();
    const usage = current ? peekModel(current.id)?.usage() : null;
    const model = modelFor(modelId());
    const window_ = model?.contextWindow ?? 0;
    const provider = app.providers.find((p) => p.id === model?.providerId);
    setInfo({
      title: "Status",
      rows: [
        ["Tråd-ID", current?.id ?? "Ingen ennå. Den lages når du sender første melding."],
        ["Modell", `${model?.name ?? "Ingen"}${provider ? ` (${provider.name})` : ""}`],
        ["Kontekst", usage && window_ ? `${formatTokens(usage.contextTokens)} av ${formatTokens(window_)} tokens (${Math.round((usage.contextTokens / window_) * 100)} %)` : `0 av ${formatTokens(window_)} tokens`],
        ["Tokens", usage ? `${formatTokens(usage.inputTokens)} inn, ${formatTokens(usage.outputTokens)} ut` : "Ingen ennå"],
        ["Kostnad", usage?.costUsd != null ? formatCost(usage.costUsd) : "Ingen pris satt"],
        ["Tenkning", EFFORTS.find((e) => e.id === current?.reasoning)?.label ?? "Modellens standard"],
        [inChatProject() ? "Instruksjoner" : "Personlighet", inChatProject() ? "Prosjektets egne instruksjoner" : PERSONALITIES.find((p) => p.id === (current?.personality ?? "standard"))?.label ?? "Standard"],
        ["Planmodus", current?.planMode ? "På" : "Av"],
        ["Grenser", provider?.kind === "mock" ? "Demo-modellen har ingen grenser" : "Leverandøren rapporterer ikke grenser til appen ennå"],
      ],
    });
  };

  const openSide = async () => {
    const grid = gridFor(props.projectId ?? (kode() ? LOCAL_SCOPE : "chat"));
    await grid.loaded;
    const created = await createThreadFor(props.projectId, draftModel() ?? thread()?.modelId ?? null, { code: kode(), chatProjectId: thread()?.chatProjectId ?? props.chatProjectId });
    await patch(`/api/threads/${created.id}`, { title: "Sidesamtale" });
    const current = props.threadId();
    const pane = (current && grid.paneWith(current)?.id) || grid.focused();
    if (!grid.split(pane, "right", created.id)) {
      toast("Det er ikke plass til flere ruter. Sidesamtalen ligger i sidefanen.", "info");
    }
    if (chatProjectPageId() && inChatProject()) await openThread(created);
  };

  const runBuiltin = async (name: string, args = "") => {
    if (inChatProject() && name === "personality") return toast("Dette prosjektet bruker sine egne instruksjoner. Endre dem i Rediger prosjekt.", "info");
    if (CODE_ONLY.has(name) && (!kode() || !props.projectId)) return toast(`/${name} krever Kode-modus og et prosjekt.`, "info");
    if (!kode() && CODE_MODE_ONLY.has(name)) return toast(`/${name} er bare tilgjengelig i Kode.`, "info");
    const id = props.threadId();
    const arg = args.trim();
    try {
      switch (name) {
        case "new":
          if (inChatProject()) await newChatIn(thread()?.chatProjectId ?? props.chatProjectId ?? null);
          else await newThreadIn(props.projectId, kode());
          break;
        case "mode":
          setMode(mode() === "code" ? "chat" : "code");
          break;
        case "model": {
          const found = arg && app.models.find((m) => m.name.toLowerCase().includes(arg.toLowerCase()) || m.model.toLowerCase() === arg.toLowerCase());
          if (found) setModel(found.id);
          else {
            if (arg) toast(`Fant ingen modell som heter «${arg}».`, "info");
            setModelOpen(true);
          }
          break;
        }
        case "reasoning": {
          const level = EFFORTS.find((e) => e.id === arg.toLowerCase() || e.label.toLowerCase() === arg.toLowerCase());
          const apply = async (value: ReasoningEffort | null) => {
            await patchThread({ reasoning: value });
            toast(value ? `Tenkning: ${EFFORTS.find((e) => e.id === value)!.label}.` : "Tenkning: modellens standard.", "info");
          };
          if (level) await apply(level.id);
          else {
            setPicker({
              title: "Tenkning",
              items: [{ id: "", label: "Modellens standard", selected: !thread()?.reasoning }, ...EFFORTS.map((e) => ({ id: e.id, label: e.label, detail: e.id, selected: thread()?.reasoning === e.id }))],
              pick: (value) => void apply((value || null) as ReasoningEffort | null).catch(report),
            });
          }
          break;
        }
        case "status":
          showStatus();
          break;
        case "compact":
          if (!id) return toast("Tråden er tom.", "info");
          await post(`/api/threads/${id}/compact`);
          break;
        case "fork":
          if (!id) return toast("Tråden er tom.", "info");
          await forkThread(id);
          break;
        case "goal":
          if (arg) {
            await patchThread({ goal: arg });
            toast("Målet er satt.", "info");
          } else if (thread()?.goal) setInfo({ title: "Mål", text: `${thread()!.goal}\n\nSkriv /goal med en ny tekst for å bytte det, eller fjern det i det festede sammendraget.` });
          else toast("Skriv målet etter kommandoen, for eksempel /goal Lag en kalkulator.", "info");
          break;
        case "plan": {
          const next = !thread()?.planMode;
          await patchThread({ planMode: next });
          toast(next ? "Planmodus er på. Modellen planlegger uten å endre filer." : "Planmodus er av.", "info");
          break;
        }
        case "worktree":
          if (props.projectId) openGitWorkspace(props.projectId, true);
          break;
        case "init":
          await actions.init();
          break;
        case "project":
          setPicker({
            title: "Prosjekt for nye tråder",
            items: [...sortedProjects().map((p) => ({ id: p.id, label: p.name, detail: p.path, selected: p.id === props.projectId })), { id: "", label: "Velg en mappe…" }],
            pick: (value) => {
              if (!value) return setFolderPickerOpen(true);
              setProjectId(value);
              void newThreadIn(value);
            },
          });
          break;
        case "task":
          await newThreadIn(null);
          break;
        case "side":
          await openSide();
          break;
        case "personality": {
          const found = PERSONALITIES.find((p) => p.id === arg.toLowerCase() || p.label.toLowerCase() === arg.toLowerCase());
          const apply = async (value: string) => {
            await patchThread({ personality: value });
            toast(`Personlighet: ${PERSONALITIES.find((p) => p.id === value)!.label}.`, "info");
          };
          if (found) await apply(found.id);
          else {
            setPicker({
              title: "Personlighet",
              items: PERSONALITIES.map((p) => ({ id: p.id, label: p.label, detail: p.prompt || "Ingen ekstra stil", selected: (thread()?.personality ?? "standard") === p.id })),
              pick: (value) => void apply(value).catch(report),
            });
          }
          break;
        }
        case "undo":
          await revertLastTurn(id);
          break;
        case "playtest":
          if (props.projectId) await startPlaytest(props.projectId);
          break;
        case "vscode":
          if (props.projectId) await openVscode(props.projectId);
          break;
        case "review":
        case "review-changes":
          if (!id) return toast("Tråden har ingen endringer å gjennomgå ennå.", "info");
          await post(`/api/threads/${id}/messages`, { text: arg, review: true });
          break;
        case "storage":
          actions.settings("storage");
          break;
        case "mcp":
          actions.settings("mcp");
          break;
        case "memories":
          if (chatProject()) await editChatProject(chatProject()!);
          else actions.settings("personalization");
          break;
        case "help":
          setHelpOpen(true);
          if (!commands().length) loadCommands();
          break;
        default: {
          const command = commands().find((c) => c.name === name);
          if (command?.demo) setInfo({ title: `/${name}`, demo: true, text: DEMO_TEXT[name] ?? command.description });
        }
      }
    } catch (err) {
      report(err);
    }
  };

  const findCommand = (word: string, entries = commands()) => entries.find((c) => c.name === word || c.aliases?.includes(word));

  const pickCommand = (item: CommandInfo) => {
    const current = menu();
    if (current?.kind !== "command" && current?.kind !== "skill") return;
    setMenu(null);
    if (item.kind === "builtin") {
      // Commands that need text get it typed after them; the rest run at once.
      if (item.args?.startsWith("<")) return replaceWord(current.start, current.end, `/${item.name} `);
      replaceWord(current.start, current.end, "");
      void runBuiltin(item.name);
    } else {
      replaceWord(current.start, current.end, "");
      setSkill(item.name);
    }
  };

  const atLimit = () => chips().length + uploading() >= MAX_ATTACHMENTS;

  // Images from the disk, a paste or a drop. Each is uploaded on its own and becomes a chip.
  const addImages = async (files: File[]) => {
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) {
        toast(`${file.name || "Filen"} er ikke et bilde. Bare PNG, JPEG, WebP og GIF lastes opp her. Filer i prosjektet legger du ved med @.`, "info");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast(`${file.name || "Bildet"} er for stort. Maks ${MAX_IMAGE_BYTES / 1024 / 1024} MB per bilde.`, "info");
        continue;
      }
      if (atLimit()) return toast(LIMIT_TEXT, "info");
      setUploading((n) => n + 1);
      try {
        const data = await readBase64(file);
        const { id } = await post<{ id: string }>("/api/images", { name: file.name, mime: file.type, data });
        const label = file.name || "bilde";
        setChips([...chips(), { kind: "image", imageId: id, name: label, label, key: id }]);
      } catch (err) {
        report(err);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const imagesFrom = (list: FileList | null | undefined) => [...(list ?? [])];

  // Text files from the disk: read here, checked for binary, and uploaded as text. Images that
  // come this way go to the image upload instead.
  const addTextFiles = async (files: File[]) => {
    for (const file of files) {
      if (IMAGE_TYPES.includes(file.type)) {
        await addImages([file]);
        continue;
      }
      const name = file.name || "fil";
      if (file.size > MAX_TEXT_UPLOAD_BYTES) {
        toast(`${name} er for stor. Maks ${MAX_TEXT_UPLOAD_BYTES / 1024} kB per tekstfil.`, "info");
        continue;
      }
      if (atLimit()) return toast(LIMIT_TEXT, "info");
      setUploading((n) => n + 1);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let text: string;
        try {
          if (bytes.subarray(0, 8192).includes(0)) throw new Error("binær");
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          toast(`${name} er ikke en tekstfil, så den ble ikke lagt ved. Bilder legger du ved med Bilder.`, "info");
          continue;
        }
        const { id } = await post<{ id: string }>("/api/uploads", { name, text });
        setChips([...chips(), { kind: "upload", uploadId: id, name, label: name, key: id }]);
      } catch (err) {
        report(err);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const addFolder = (item: MentionItem) => {
    closeAttach();
    textarea.focus();
    if (chips().some((c) => c.key === item.path)) return;
    if (atLimit()) return toast(LIMIT_TEXT, "info");
    setChips([...chips(), { kind: "dir", path: item.path!, label: item.label, key: item.path! }]);
  };

  const closeAttach = () => {
    setAttachOpen(false);
    setAttachView("menu");
  };

  // The + menu with the arrow keys: up and down, Home and End, and focus starts on the first row.
  const menuKeys = (event: KeyboardEvent) => {
    const items = [...(attachMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length
      : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : -1;
    if (next === -1) return;
    event.preventDefault();
    items[next].focus();
  };

  const pickMention = (item: MentionItem) => {
    const current = menu();
    if (current?.kind !== "mention") return;
    setMenu(null);
    if (atLimit()) {
      replaceWord(current.start, current.end, "");
      return toast(LIMIT_TEXT, "info");
    }
    const key = item.threadId ?? item.path ?? item.label;
    if (!chips().some((c) => c.key === key)) {
      const chip: Chip = item.kind === "thread"
        ? { kind: "thread", threadId: item.threadId!, label: item.label, key }
        : { kind: item.kind, path: item.path!, label: item.label, key };
      setChips([...chips(), chip]);
    }
    replaceWord(current.start, current.end, "");
  };

  const reset = () => {
    draftRevision++;
    setCompletion("");
    textarea.value = "";
    setCompletionRevision((revision) => revision + 1);
    drafts.delete(draftKey());
    setHasText(false);
    setChips([]);
    setSkill(null);
    setMenu(null);
  };

  // One thread per pane, also when a second message is sent before the first one has made it:
  // the second waits for the same promise instead of making a thread of its own.
  let creating: Promise<string> | null = null;
  let createdHere: string | null = null;
  const ensureThread = (): Promise<string> => {
    const existing = props.threadId();
    if (existing) return Promise.resolve(existing);
    creating ??= (async () => {
      const created = await createThreadFor(props.projectId, draftModel(), { code: kode(), chatProjectId: props.chatProjectId });
      const reasoning = draftReasoning();
      if (reasoning !== undefined) await patch(`/api/threads/${created.id}`, { reasoning }).catch(report);
      const chosen = draftPersonality();
      if (chosen && !props.projectId && !inChatProject()) await patch(`/api/threads/${created.id}`, { personality: chosen }).catch(report);
      const tools = chatTools.draft();
      if (tools && !kode()) await patch(`/api/threads/${created.id}`, { chatTools: tools }).catch(report);
      // Text or attachments entered while creation was pending belong to this new thread.
      // Transfer them before the parent changes threadId and mounts the thread's composer.
      const before = draftKey();
      createdHere = created.id;
      if (textarea.value) drafts.set(created.id, textarea.value);
      draftParts.set(created.id, { chips: chips().map(chip => ({ ...chip })), skill: skill() });
      draftOwners.set(created.id, draftOwner);
      if (before !== created.id && draftOwners.get(before) === draftOwner) { drafts.delete(before); draftParts.delete(before); draftOwners.delete(before); }
      props.onThreadCreated(created);
      return created.id;
    })().finally(() => (creating = null));
    return creating;
  };

  const submit = async () => {
    if (locked() || resolvingCommand()) return;
    const raw = textarea.value;
    const text = raw.trim();
    if (inChatProject() && /^[/$](?:personality|personlighet)(?=\s|$)/i.test(text)) return toast("Dette prosjektet bruker sine egne instruksjoner. Endre dem i Rediger prosjekt. Utkastet er beholdt.", "info");
    if (uploading()) return toast("Vent til bildene er lastet opp.", "info");
    const startingChips = chips();
    const startingSkill = skill();
    const attachments = startingChips.map(chipRef);
    if (attachments.length > MAX_ATTACHMENTS) return toast(LIMIT_TEXT, "info");
    let usedSkill = skill();
    if (inChatProject() && usedSkill) return toast("Skills brukes ikke i Chat-prosjekter. Fjern skillen og bruk prosjektets egne instruksjoner.", "info");
    let body: Record<string, unknown>;

    if (kode() && !usedSkill && text.startsWith("!")) {
      const shell = text.slice(1).trim();
      if (!shell) return;
      if (!props.projectId) return toast("! krever Kode-modus og et prosjekt.");
      body = { text: "", shell };
    } else if (!usedSkill && /^[/$]\S+/.test(text)) {
      // Consume the command and one separator, retaining the user's remaining spaces/newlines.
      const invocation = /^[/$]([^\s/$]+)(?:[ \t]([\s\S]*)|\r?\n([\s\S]*))?$/.exec(raw.trimStart());
      const word = invocation?.[1] ?? "";
      const args = invocation?.[2] ?? invocation?.[3] ?? "";
      // Hot reload keeps populated menus fresh; the server validates the skill again at send.
      // When initial loading is slow, do not send/reset an older snapshot over newer typing.
      let available = commands();
      if (!available.length) {
        setResolvingCommand(true);
        let found: CommandInfo[] | null;
        try { found = await loadCommands(); } finally { setResolvingCommand(false); }
        if (textarea.value !== raw || chips() !== startingChips || skill() !== startingSkill) return;
        if (!found) return toast("Kunne ikke hente kommandoene. Utkastet er beholdt.");
        available = found;
      }
      const known = findCommand(word, available);
      if (known?.kind === "builtin") {
        reset();
        return runBuiltin(known.name, args);
      }
      if (known?.kind === "skill") {
        if (inChatProject()) return toast("Skills brukes ikke i Chat-prosjekter. Bruk prosjektets egne instruksjoner.", "info");
        usedSkill = known.name;
        body = { text: args, skill: known.name, attachments };
      } else body = { text, attachments };
    } else {
      if (!text && !usedSkill && !attachments.length) return;
      if (!text && attachments.length && !usedSkill) return toast("Skriv en melding til vedleggene.", "info");
      body = { text: usedSkill ? raw : text, attachments, ...(usedSkill ? { skill: usedSkill } : {}) };
    }

    // While the agent works, the setting decides whether the message waits or goes in at once.
    if (running() && !("shell" in body)) body.steer = busyMode() === "steer";
    const restoreChips = chips();
    const restoreSkill = usedSkill;
    reset();
    props.onSent();
    let effortSaveFailed = false;
    let accepted: string | null = null;
    try {
      const id = await ensureThread();
      // The run must see the effort level already shown in the composer. A failed save
      // follows the regular send-failure path below, which preserves the unsent draft.
      let pendingWrite = effortWrites.get(id);
      while (pendingWrite) {
        const failure = await pendingWrite.done;
        if (failure) { effortSaveFailed = true; throw failure; }
        pendingWrite = effortWrites.get(id);
      }
      await post(`/api/threads/${id}/messages`, body);
      accepted = id;
    } catch (err) {
      const current = textarea.value;
      const currentChips = chips();
      const pristine = !current && !currentChips.length && !skill();
      // A failed request must not overwrite text or attachments added after Send.
      const failed = restoreSkill && !/^[/$]/.test(raw.trimStart()) ? `/${restoreSkill}${raw ? ` ${raw}` : ""}` : raw;
      textarea.value = pristine ? raw : [current, failed].filter(Boolean).join("\n\n");
      drafts.set(draftKey(), textarea.value);
      setHasText(true);
      setChips(pristine ? restoreChips : [...currentChips, ...restoreChips.filter((chip) => !currentChips.some((current) => current.key === chip.key))]);
      if (pristine) setSkill(restoreSkill);
      else toast("Meldingen ble ikke sendt. Ny tekst er bevart, og den usendte teksten er lagt under utkastet.", "info");
      if (!effortSaveFailed) report(err);
    }
    // Keep a landing composer alive until attachments added during the request finish uploading.
    // Its cleanup can then hand the complete next draft to the opened thread.
    if (accepted && props.onAccepted) setAcceptedThread(accepted);
  };

  const stop = () => {
    const id = props.threadId();
    if (id) post(`/api/threads/${id}/stop`).catch(report);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    // Modified Tab always keeps the browser's normal focus navigation.
    if (event.key === "Tab" && (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)) return;
    if (event.key === "Escape" && app.settings.promptAutocomplete) {
      const visible = !!completion();
      completionDismissed = true;
      setCompletion("");
      setCompletionRevision((revision) => revision + 1);
      if (visible) { event.preventDefault(); return; }
    }
    if (event.key === "Tab" && completion() && textarea.value === completionPrefix() && textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length) {
      event.preventDefault();
      const suffix = completion();
      setCompletion("");
      textarea.setRangeText(suffix, textarea.value.length, textarea.value.length, "end");
      onInput();
      return;
    }
    const current = menu();
    if (current && current.kind !== "shell" && itemCount() > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelected((selected() + delta + itemCount()) % itemCount());
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (event.key === "Tab" && (current.kind === "command" || current.kind === "skill")) {
          const item = commandItems()[selected()];
          const prefix = current.kind === "skill" ? "$" : "/";
          const separator = /\s/.test(textarea.value[current.end] ?? "") ? "" : " ";
          replaceWord(current.start, current.end, `${prefix}${item.name}${separator}`);
          // A pre-existing separator is retained, and the caret moves past it.
          if (!separator) textarea.setSelectionRange(textarea.selectionStart + 1, textarea.selectionStart + 1);
          closeMenu();
        }
        else if (current.kind === "command" || current.kind === "skill") pickCommand(commandItems()[selected()]);
        else pickMention(mentions()[selected()]);
        return;
      }
    }
    if (event.key === "Escape" && (current || picker() || info())) {
      event.preventDefault();
      setMenu(null);
      setPicker(null);
      setInfo(null);
      return;
    }
    if (event.key === "Backspace" && !textarea.value) {
      if (skill()) setSkill(null);
      else if (chips().length) setChips(chips().slice(0, -1));
      return;
    }
    // Enter sends, or with «Enter gir ny linje» Ctrl+Enter does (SPEC 21.8). Shift+Enter is a new line.
    if (event.key === "Enter" && !event.isComposing && (enterNewline() ? event.ctrlKey || event.metaKey : !event.shiftKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const onInput = () => {
    draftRevision++;
    completionDismissed = false;
    setCompletionRevision((revision) => revision + 1);
    drafts.set(draftKey(), textarea.value);
    draftOwners.set(draftKey(), draftOwner);
    inspect();
  };

  const setModel = (id: string) => {
    setModelOpen(false);
    modelButton.focus({ preventScroll: true });
    const current = props.threadId();
    setDraftModel(id);
    if (current) patch(`/api/threads/${current}`, { modelId: id }).catch(report);
  };

  onMount(() => {
    // Cleanup must retain this composer's original key even after the focused thread changes.
    const mountedDraftKey = draftKey();
    draftOwners.set(mountedDraftKey, draftOwner);
    const parts = draftParts.get(mountedDraftKey);
    if (parts) { setChips(parts.chips.map((chip) => ({ ...chip }))); setSkill(inChatProject() ? null : parts.skill); }
    onCleanup(() => {
      const owner = createdHere ?? mountedDraftKey;
      if (!draftOwners.has(owner) || draftOwners.get(owner) === draftOwner) draftParts.set(owner, { chips: chips().map((chip) => ({ ...chip })), skill: skill() });
      if (createdHere && owner !== mountedDraftKey && draftOwners.get(mountedDraftKey) === draftOwner) { drafts.delete(mountedDraftKey); draftParts.delete(mountedDraftKey); draftOwners.delete(mountedDraftKey); }
    });
    const completionResize = new ResizeObserver(syncCompletionLayout);
    completionResize.observe(textarea);
    onCleanup(() => completionResize.disconnect());
    textarea.value = drafts.get(draftKey()) ?? "";
    if (carried && props.projectId && !props.threadId() && !textarea.value.trim()) {
      textarea.value = carried;
      drafts.set(draftKey(), carried);
      carried = null;
    }
    setHasText(textarea.value.length > 0);
    props.registerFill?.((text) => {
      textarea.value = text;
      textarea.focus();
      onInput();
    });
    if (props.autofocus && !matchMedia("(pointer: coarse)").matches) textarea.focus({ preventScroll: true });
    void loadCommands();
    const subscriptions = [onSocket("skills.changed", () => void loadCommands()), onOpen(() => void loadCommands())];
    onCleanup(() => subscriptions.forEach((stop) => stop()));
    if (props.projectId) loadGitInfo(props.projectId);
  });

  createEffect(() => {
    const key = props.threadId() ?? props.paneKey;
    const delivery = composerDeliveries()[key];
    if (!delivery) return;
    untrack(() => {
      draftRevision++;
      const { [key]: _taken, ...rest } = composerDeliveries();
      setComposerDeliveries(rest);
      if (delivery.text) {
        const before = textarea.value;
        textarea.value = before ? `${before}\n\n${delivery.text}` : delivery.text;
      }
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      if (delivery.text) onInput();
      if (delivery.attachments?.length) {
        const incoming: Chip[] = [];
        for (const item of delivery.attachments) {
          const ref: AttachmentRef | undefined = item.kind === "image" && item.imageId ? { kind: "image", imageId: item.imageId, name: item.label }
            : item.kind === "upload" && item.uploadId ? { kind: "upload", uploadId: item.uploadId, name: item.label }
            : item.kind === "thread" && item.threadId ? { kind: "thread", threadId: item.threadId }
            : (item.kind === "file" || item.kind === "dir") && item.path ? { kind: item.kind, path: item.path } : undefined;
          if (ref) incoming.push({ ...ref, label: item.label, key: item.imageId ?? item.uploadId ?? item.threadId ?? item.path ?? item.label });
        }
        setChips([...chips(), ...incoming.filter((item) => !chips().some((current) => current.key === item.key))]);
      }
      void addImages(delivery.images);
    });
  });

  createEffect(on([chips, skill], () => { draftRevision++; }, { defer: true }));

  // A moved queue message is recoverable even if its original move response was lost.
  // Local typing/deliveries win; the stored snapshot clears only when a message is accepted.
  createEffect(() => {
    const id = props.threadId();
    if (!id) return;
    let current = true;
    const revision = draftRevision;
    const off = onSocket("thread.event", ({ envelope }) => {
      if (envelope.threadId === id && envelope.event.type === "user.message" && !envelope.event.from) current = false;
    });
    void get<{ draft: { text: string; attachments?: Attachment[] } | null }>(`/api/threads/${id}/queued-draft`).then(({ draft }) => {
      if (!current || revision !== draftRevision || !draft || composerDeliveries()[id] || drafts.has(id) || draftParts.has(id) || textarea.value || chips().length || uploading()) return;
      deliverToComposer(id, { text: draft.text, images: [], attachments: draft.attachments });
    }).catch(report);
    onCleanup(() => { current = false; off(); });
  });

  const queued = createMemo(() => {
    const id = props.threadId();
    return id ? (peekModel(id)?.queued() ?? []) : [];
  });
  createEffect(() => {
    const menu = queueMenu();
    if (menu && !queued().some((item) => item.messageId === menu.messageId)) setQueueMenu(null);
  });

  return (
    <div class="composer-wrap">
      <Show when={queued().length || running() || queueEdit()}>
        <div class="queue" data-testid="queue">
          <div class="queue-header">
            <span class="queue-label">{queued().length ? queued().every((q) => q.steer) ? "Sendes inn i turen" : `${queued().length} i kø` : "Nye meldinger"}</span>
            <div class="queue-switch" role="group" aria-label="Meldinger mens agenten jobber" data-testid="busy-switch">
              <button type="button" disabled={busySaving()} aria-pressed={busyMode() === "queue"} aria-label="Legg i kø" title="Legg i kø: meldinger venter til turen er ferdig" onClick={() => void setBusyMode("queue")}>Kø</button>
              <button type="button" disabled={busySaving()} aria-pressed={busyMode() === "steer"} aria-label="Send med en gang" title="Send med en gang: ved neste steg mellom verktøykall" onClick={() => void setBusyMode("steer")}>Straks</button>
            </div>
          </div>
          <For each={queued()}>{(q) => <div class="queue-entry" data-message-id={q.messageId}>
            <span class="queue-item" classList={{ steer: !!q.steer }} title={q.steer ? `Går inn i turen ved neste steg: ${q.text}` : q.text}>{q.text}<Show when={q.attachments?.length}><span class="queue-attachments"> · {q.attachments!.length} vedlegg</span></Show></span>
            <Show when={!q.from}>
              <Show when={!q.steer && q.steerable !== false}><button type="button" class="queue-now" disabled={!!queueAction()} title="Send akkurat denne inn i turen som kjører, ved neste steg" aria-label={`Send «${q.text}» med en gang`} onClick={() => void steerOne(q.messageId)}><IconSend size={12} /></button></Show>
              <button type="button" class="queue-now" disabled={!!queueAction()} aria-label={`Fjern «${q.text}» fra køen`} title="Fjern fra køen" onClick={() => { const id = props.threadId(); if (id) void removeOne(id, q.messageId); }}><IconTrash size={12} /></button>
              <button type="button" class="queue-now" disabled={!!queueAction()} aria-label={`Valg for kømeldingen «${q.text}»`} aria-haspopup="menu" aria-expanded={queueMenu()?.messageId === q.messageId} onClick={(event) => { const id = props.threadId(); if (id) setQueueMenu({ threadId: id, messageId: q.messageId, anchor: { x: 0, y: 0, rect: event.currentTarget.getBoundingClientRect() } }); }}><IconDots size={14} /></button>
            </Show>
          </div>}</For>
          <Show when={queueEdit()}>{(edit) => <div class="queue-editor">
            <label>Rediger kømelding<textarea aria-label="Rediger kømelding" value={edit().text} maxLength={200000} disabled={!!queueAction()} onInput={(event) => setQueueEdit({ ...edit(), text: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQueueEdit(null); } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveQueueEdit(); } }} /></label>
            <div><button type="button" class="btn btn-small" disabled={!!queueAction() || !edit().text.trim()} onClick={() => void saveQueueEdit()}>Lagre melding</button><button type="button" class="btn btn-small" disabled={!!queueAction()} onClick={() => setQueueEdit(null)}>Avbryt</button></div>
          </div>}</Show>
        </div>
      </Show>
      <Show when={!settingsOpen() && queueMenu()}>{(menu) => <ContextMenu anchor={menu().anchor} label="Kømelding" entries={queueEntries()} onClose={() => setQueueMenu(null)} />}</Show>
      <Show when={kode()}>
      <div class="composer-context">
        <Popover
          class="context-anchor"
          fixed portal returnFocus
          open={pickerOpen()}
          onClose={projectPicker.close}
          trigger={
            <button type="button" class="context-chip" data-testid="project-picker" ref={projectChip} aria-haspopup="dialog" aria-expanded={pickerOpen()} title={project()?.path ?? "Velg prosjekt"} onPointerDown={(event) => { if (pickerOpen()) event.preventDefault(); }} onClick={(event) => { const closing = pickerOpen(); projectPicker.toggle(); if (closing) event.currentTarget.focus({ preventScroll: true }); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); projectPicker.show(); } }}>
              <Show when={project()} fallback={<IconFolder size={15} />}><ProjectGlyph project={project()!} size={15} /></Show>
              <span>{project()?.name ?? "Velg prosjekt"}</span>
            </button>
          }
        >
          <ProjectPicker current={props.projectId} paneKey={props.paneKey} onDone={projectPicker.close} onCancel={() => { projectPicker.close(); projectChip?.focus({ preventScroll: true }); }} />
        </Popover>
        <Show when={project()}>{(current) => <ProjectEnvironmentPicker project={current()} paneKey={props.paneKey} />}</Show>
        <button type="button" class="context-chip" title="Kjører på denne maskinen" onClick={() => setInfo({ title: "Lokal", demo: true, text: LOCAL_TEXT })}>
          <IconLaptop size={15} /><span>Lokal</span>
        </button>
        <Show when={project() && branch()}>
          <span class="context-chip static" data-testid="branch" title={branchInfo()?.detached ? "Ingen gren, HEAD peker på en commit. Lest fra .git/HEAD." : "Gjeldende gren. Bruk prosjektets tannhjul for grener og arbeidstrær."}>
            <IconBranch size={15} /><span>{branch()}</span>
          </span>
        </Show>
        <Show when={thread()?.goal}>
          <GoalLine thread={thread()!} variant="composer" />
        </Show>
      </div>
      </Show>
      {/* Round 14 (SPEC 30.5): the folder is gone, so a bar takes the field's place. The form stays,
          hidden and locked, so its state and the draft are there again when the folder is back. */}
      <Show when={locked() ? project() : undefined}>{(p) => <FolderMissingBar project={p()} />}</Show>
      <form
        class="composer"
        classList={{ busy: running(), locked: locked() }}
        data-locked={locked() ? "true" : undefined}
        hidden={locked()}
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = imagesFrom(e.dataTransfer?.files);
          if (!files.length) return;
          e.preventDefault();
          void addTextFiles(files);
        }}
      >
        <Show when={menu()}>
          <div ref={slashMenu} id={menuId} class="slash-menu" role={hasSuggestions() ? "listbox" : undefined} aria-label="Kommandoer, skills og vedlegg" data-testid="composer-menu">
            <Show when={hasSuggestions() && itemCount() > 0}>
              <div class="menu-heading" aria-hidden="true"><kbd>Tab</kbd> fullfører · <kbd>↑↓</kbd> velger · <kbd>Esc</kbd> lukker</div>
            </Show>
            <Show when={menu()!.kind === "command" || menu()!.kind === "skill"}>
              <div class="menu-heading">{menu()!.kind === "skill" ? "Skills" : "Kommandoer"}</div>
              <For each={commandItems()} fallback={<div class="menu-empty">{menu()!.kind === "skill" ? "Ingen skills. Legg dem i skills/ i prosjektet." : "Ingen treff"}</div>}>
                {(item, index) => (
                  <button
                    type="button"
                    role="option"
                    id={optionId(index())}
                    tabindex="-1"
                    class="menu-item command-item"
                    classList={{ selected: index() === selected() }}
                    aria-selected={index() === selected()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pickCommand(item)}
                  >
                    {(() => {
                      const Icon = item.kind === "skill" ? IconSpark : COMMAND_ICONS[item.name] ?? IconCode;
                      return <Icon size={14} />;
                    })()}
                    <span class="menu-name">{menu()!.kind === "skill" ? "$" : "/"}{item.name}</span>
                    <Show when={item.args && index() === selected()}><span class="menu-args">{item.kind === "skill" ? item.args : argsText(item.args!)}</span></Show>
                    <span class="menu-desc">{item.description}</span>
                    <Show when={item.demo}><span class="demo-badge">Demo</span></Show>
                    <Show when={item.kind === "skill"}><span class="menu-tag">{item.source === "project" ? "prosjekt" : item.source === "app" ? "app" : "skill"}</span></Show>
                  </button>
                )}
              </For>
            </Show>
            <Show when={menu()!.kind === "mention"}>
              <For each={mentions()} fallback={<div class="menu-empty">Ingen treff</div>}>
                {(item, index) => (
                  <button
                    type="button"
                    role="option"
                    id={optionId(index())}
                    tabindex="-1"
                    class="menu-item"
                    classList={{ selected: index() === selected() }}
                    aria-selected={index() === selected()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pickMention(item)}
                  >
                    {item.kind === "thread" ? <IconBranch size={14} /> : item.kind === "dir" ? <IconFolder size={14} /> : <IconFile size={14} />}
                    <span class="menu-name">{item.label}</span>
                    <Show when={item.kind === "thread"}><span class="menu-tag">{item.running ? "kjører" : "tråd"}</span></Show>
                  </button>
                )}
              </For>
            </Show>
            <Show when={menu()!.kind === "shell"}>
              <div class="menu-item static">
                <IconTerminal size={14} />
                <span class="menu-desc">{props.projectId ? "Kjør kommandoen i prosjektmappen, med vanlige tillatelser" : "! krever Kode-modus og et prosjekt"}</span>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={chips().length || skill() || uploading()}>
          <div class="chips composer-attachments" role="region" aria-label="Vedleggsrad" tabindex="0" data-testid="attachment-strip" title="Rull bortover for å se alle vedlegg"
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const row = event.currentTarget;
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); row.scrollLeft += event.key === "ArrowRight" ? 120 : -120; }
              else if (event.key === "Home" || event.key === "End") { event.preventDefault(); row.scrollLeft = event.key === "Home" ? 0 : row.scrollWidth; }
            }}
            on:wheel={{ passive: false, handleEvent: (event: WheelEvent) => {
              const row = event.currentTarget as HTMLDivElement;
              if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > 0 || row.scrollWidth <= row.clientWidth) return;
              const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? row.clientWidth : 1);
              const next = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + delta));
              if (next !== row.scrollLeft) { event.preventDefault(); row.scrollLeft = next; }
            } }}>
            <Show when={skill()}>
              <span class="chip chip-skill"><IconSpark size={12} />/{skill()}
                <button type="button" class="chip-x" title="Fjern skillen" aria-label="Fjern skill" onClick={() => setSkill(null)}><IconClose size={11} /></button>
              </span>
            </Show>
            <For each={chips()}>
              {(chip) => (
                <Show
                  when={chip.kind === "image" && chip}
                  keyed
                  fallback={
                    <span class="chip-wrap">
                      <AttachmentChip attachment={chipAttachment(chip)} />
                      <button type="button" class="chip-x" title="Fjern vedlegget" aria-label="Fjern vedlegg" onClick={() => setChips(chips().filter((c) => c.key !== chip.key))}><IconClose size={11} /></button>
                    </span>
                  }
                >
                  {(image) => (
                    <span class="chip-image" data-testid="image-chip" title={image.label}>
                      <button type="button" class="chip-image-view" title={`Vis ${image.label} i full størrelse`} aria-label={`Vis ${image.label}`} onClick={() => showImage(imageUrl(image.imageId), image.label)}>
                        <img src={imageUrl(image.imageId)} alt={image.label} />
                      </button>
                      <button type="button" class="chip-image-x" title="Fjern bildet fra meldingen" aria-label="Fjern bildet" onClick={() => setChips(chips().filter((c) => c.key !== chip.key))}><IconClose size={10} /></button>
                    </span>
                  )}
                </Show>
              )}
            </For>
            <Show when={uploading()}>
              <span class="chip chip-uploading"><span class="spinner" />Laster opp {uploading() === 1 ? "1 vedlegg" : `${uploading()} vedlegg`}</span>
            </Show>
          </div>
        </Show>
        <Show when={chips().length >= MAX_ATTACHMENTS}>
          <div class="attach-limit" role="status" data-testid="attach-limit">{LIMIT_TEXT} Fjern et vedlegg for å legge til et nytt.</div>
        </Show>
        <div class="composer-input">
          <textarea
            ref={textarea}
            rows={1}
            placeholder={locked() ? "Mappen mangler. Velg mappen på nytt for å skrive her." : kode() ? "" : enterNewline() ? `Spør om hva som helst (${displayKeys("Mod+Enter")} sender)` : "Spør om hva som helst"}
            aria-placeholder={locked() ? undefined : kode() ? `Spør om hva som helst. / for kommandoer, @ for filer, $ for skills.${enterNewline() ? ` ${displayKeys("Mod+Enter")} sender.` : ""}` : undefined}
            aria-label="Melding"
            aria-autocomplete="list"
            aria-describedby={completion() ? `${menuId}-completion-status` : undefined}
            aria-controls={hasSuggestions() ? menuId : undefined}
            aria-activedescendant={hasSuggestions() && itemCount() > 0 ? optionId(selected()) : undefined}
            disabled={locked()}
            spellcheck={false}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onKeyUp={(event) => {
              if (!event.isComposing && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) inspect();
                setCompletionRevision((revision) => revision + 1);
              }
            }}
            onSelect={() => { if (textarea.selectionStart !== textarea.selectionEnd) { closeMenu(); setCompletionRevision((revision) => revision + 1); } }}
            onCompositionStart={() => { composing = true; closeMenu(); setCompletionRevision((revision) => revision + 1); }}
            onCompositionEnd={() => { composing = false; onInput(); }}
            onClick={() => { inspect(); setCompletionRevision((revision) => revision + 1); }}
            onFocus={() => setCompletionFocused(true)}
            onScroll={syncCompletionLayout}
            onPaste={(e) => {
              const files = imagesFrom(e.clipboardData?.files).filter((f) => f.type.startsWith("image/"));
              if (!files.length) return;
              e.preventDefault();
              void addImages(files);
            }}
            onBlur={() => { setCompletionFocused(false); setTimeout(() => {
              // A click in the menu blurs the field for a moment. A blur from before the menu opened
              // (focus went to the + menu and came back) must not close the menu that opened since.
              if (document.activeElement !== textarea) closeMenu();
            }, 120); }}
          />
          <Show when={completion()}>
            <div ref={completionOverlay} class="composer-completion" aria-hidden="true" data-testid="prompt-completion"><span class="composer-completion-prefix">{completionPrefix()}</span><span data-testid="prompt-completion-suffix">{completion()}</span></div>
            <span id={`${menuId}-completion-status`} class="sr-only" role="status">Forslag: {completion()}. Trykk Tab for å sette inn, eller Escape for å avvise.</span>
          </Show>
          {/* The three helpers and what they do (SPEC 21.1). In a narrow pane the words go first,
              then the keys, so the line never wraps. */}
          <Show when={kode() && !hasText() && !locked()}>
            <div class="composer-hint" aria-hidden="true" data-testid="composer-hint">
              <span class="hint-main">Spør om hva som helst</span>
              <span class="hint-key"><kbd>/</kbd><span class="hint-word">kommandoer</span></span>
              <span class="hint-key"><kbd>@</kbd><span class="hint-word">filer</span></span>
              <span class="hint-key"><kbd>$</kbd><span class="hint-word">skills</span></span>
              <Show when={enterNewline()}>
                <span class="hint-key hint-send"><kbd>{displayKeys("Mod+Enter")}</kbd><span class="hint-word">sender</span></span>
              </Show>
            </div>
          </Show>
        </div>
        <input
          ref={fileInput}
          type="file"
          class="composer-file"
          tabindex="-1"
          aria-hidden="true"
          data-testid="image-input"
          accept={IMAGE_TYPES.join(",")}
          multiple
          onChange={(e) => {
            const files = imagesFrom(e.currentTarget.files);
            e.currentTarget.value = "";
            void addImages(files);
          }}
        />
        <input
          ref={textInput}
          type="file"
          class="composer-file"
          tabindex="-1"
          aria-hidden="true"
          data-testid="text-file-input"
          multiple
          onChange={(e) => {
            const files = imagesFrom(e.currentTarget.files);
            e.currentTarget.value = "";
            void addTextFiles(files);
          }}
        />
        <div class="composer-foot">
          <Popover
            open={attachOpen()}
            onClose={closeAttach}
            trigger={
              <button
                type="button"
                class="foot-icon"
                title={`Legg til kommandoer, en mappe, filer eller bilder (maks ${MAX_ATTACHMENTS} vedlegg)`}
                aria-label="Legg ved"
                aria-haspopup="menu"
                aria-expanded={attachOpen()}
                onClick={() => (attachOpen() ? closeAttach() : setAttachOpen(true))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setAttachOpen(true);
                  }
                }}
              >
                <IconPlus size={18} />
              </button>
            }
          >
            <Show
              when={attachView() === "menu"}
              fallback={<FolderPicker projectId={props.projectId!} onPick={addFolder} onBack={() => setAttachView("menu")} />}
            >
              <div
                class="menu-list attach-menu"
                role="menu"
                aria-label="Legg ved"
                ref={(el) => {
                  attachMenu = el;
                  requestAnimationFrame(() => el.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
                }}
                onKeyDown={menuKeys}
              >
                <button type="button" role="menuitem" class="menu-item" title={inChatProject() ? "Åpne listen over /-kommandoer" : "Åpne listen over /-kommandoer og skills"} onClick={() => { closeAttach(); insertTrigger("/"); }}>
                  <IconCode size={15} /><span class="menu-name">Skråstrekkommandoer</span><kbd class="menu-keys">/</kbd>
                </button>
                <Show when={kode()}>
                  <button type="button" role="menuitem" class="menu-item" disabled={!props.projectId || atLimit()} title={!props.projectId ? "Krever et prosjekt" : atLimit() ? LIMIT_TEXT : "Gi modellen en oversikt over en mappe i prosjektet"} onClick={() => setAttachView("folders")}>
                    <IconFolder size={15} /><span class="menu-name">Legg til mappe</span><kbd class="menu-keys">@</kbd>
                  </button>
                </Show>
                <button type="button" role="menuitem" class="menu-item" disabled={atLimit()} title={atLimit() ? LIMIT_TEXT : `Tekstfiler fra maskinen, maks ${MAX_TEXT_UPLOAD_BYTES / 1024} kB per fil`} onClick={() => { closeAttach(); textInput.click(); }}>
                  <IconFile size={15} /><span class="menu-name">Legg til filer</span>
                </button>
                <button type="button" role="menuitem" class="menu-item" disabled={atLimit()} title={atLimit() ? LIMIT_TEXT : "PNG, JPEG, WebP eller GIF, maks 3 MB per bilde"} onClick={() => { closeAttach(); fileInput.click(); }}>
                  <IconImage size={15} /><span class="menu-name">Bilder</span>
                </button>
                <div class="menu-foot">{chips().length} av {MAX_ATTACHMENTS} vedlegg</div>
              </div>
            </Show>
          </Popover>
          <Show when={kode()}>
            <PermissionPicker project={project()} cap={thread()?.permissionCap} />
          </Show>
          <Show when={!kode()}>
            <ChatToolButton state={chatTools} chatProject={chatProject()} />
          </Show>
          <Show when={kode() && thread()?.planMode}>
            <button type="button" class="pill pill-accent" title="Planmodus: modellen planlegger uten å endre filer. Trykk for å slå av." onClick={() => void runBuiltin("plan")}><IconList size={12} />Plan</button>
          </Show>
          <span class="composer-spacer" />
          <Show when={steps().length}>
            <Popover
              class="effort-anchor"
              stable
              align="right"
              fixed
              portal
              returnFocus
              open={effortOpen()}
              onClose={() => setEffortOpen(false)}
              trigger={
                <button
                  type="button"
                  class="foot-chip effort-chip"
                  data-testid="effort-button"
                  data-chosen={chosenEffort() ? "" : undefined}
                  title="Innsats: hvor mye modellen tenker før den svarer"
                  aria-haspopup="dialog"
                  aria-expanded={effortOpen()}
                  onClick={() => { setModelOpen(false); setEffortOpen(!effortOpen()); }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                    event.preventDefault();
                    setModelOpen(false);
                    setEffortOpen(true);
                  }}
                >
                  <span class="effort-chip-label"><Show when={effortLabel(chosenEffort())} fallback={<><span class="effort-chip-verb">Velg </span><span class="effort-chip-noun">innsats</span></>}>{effortChip()}</Show></span><IconChevronDown size={12} />
                </button>
              }
            >
              <EffortPicker
                steps={steps()}
                chosen={chosenEffort()}
                modelDefault={modelFor(modelId())?.effort ?? null}
                modelName={modelName(modelId())}
                onPick={(value) => setEffort(value, false)}
                onModel={() => { setEffortOpen(false); setModelOpen(true); }}
              />
            </Popover>
          </Show>
          <Popover
            open={modelOpen()}
            onClose={() => setModelOpen(false)}
            align="right"
            class="model-anchor"
            fixed
            portal
            returnFocus
            trigger={
              <button type="button" ref={modelButton} class="foot-chip model-button" data-testid="model-button" title={`${modelName(modelId())}: velg modell`} aria-label={`Velg modell: ${modelName(modelId())}`} aria-haspopup="listbox" aria-expanded={modelOpen()} onClick={() => { setEffortOpen(false); setModelOpen(!modelOpen()); }} onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                setEffortOpen(false);
                setModelOpen(true);
              }}>
                <span class="model-label">{modelName(modelId())}</span><IconChevronDown size={12} />
              </button>
            }
          >
            <ModelMenu
              chosen={modelId() ?? app.settings.defaultModelId}
              onPick={setModel}
              onManage={() => { setModelOpen(false); setSettingsOpen("models"); }}
            />
          </Popover>
          <ContextRing threadId={props.threadId} modelId={modelId} projectId={props.projectId} />
          <button type="button" class="foot-icon hide-tight" title="Diktering: snakk inn meldingen (Demo)" aria-label="Diktering" onClick={() => setInfo({ title: "Diktering", demo: true, text: MIC_TEXT })}><IconMic size={16} /></button>
          <Show when={running()}>
            <button type="button" class="send-button stop" title="Stopp kjøringen" aria-label="Stopp" onClick={stop}><IconStop size={14} /></button>
          </Show>
          <Show when={!running() || hasText()}>
            <button type="submit" class="send-button" title={`Send meldingen (${displayKeys(sendKeys())})`} data-keys={displayKeys(sendKeys())} aria-label="Send" disabled={locked() || (!hasText() && !skill())}><IconSend /></button>
          </Show>
        </div>
      </form>
      <Show when={helpOpen()}>
        <div class="help-card" role="dialog" aria-label="Hjelp">
          <div class="help-head"><strong>Kommandoer</strong>
            <button type="button" class="icon-button" title="Lukk" aria-label="Lukk" onClick={() => setHelpOpen(false)}><IconClose size={14} /></button>
          </div>
          <dl>
            <For each={commands().filter((command) => !(inChatProject() && (command.kind === "skill" || command.name === "personality")) && (command.kind === "skill" || ((!CODE_ONLY.has(command.name) || (kode() && !!props.projectId)) && (kode() || !CODE_MODE_ONLY.has(command.name)))))}>
              {(c) => (
                <>
                  <dt>{c.kind === "skill" ? "$" : "/"}{c.name}<Show when={c.demo}> <span class="demo-badge">Demo</span></Show></dt>
                  <dd>{c.description}<Show when={c.aliases?.length}><span class="muted"> · også {c.aliases!.map((a) => `/${a}`).join(", ")}</span></Show></dd>
                </>
              )}
            </For>
            <dt>@</dt><dd>Legg ved filer, mapper og tråder</dd>
            <Show when={!inChatProject()}><dt>$</dt><dd>Bruk en skill</dd></Show>
            <Show when={kode() && props.projectId}><dt>!kommando</dt><dd>Kjør en kommando i prosjektmappen</dd></Show>
          </dl>
        </div>
      </Show>
      <Show when={picker()} keyed>
        {(current) => (
          <div class="help-card picker-card" role="dialog" aria-label={current.title}>
            <div class="help-head"><strong>{current.title}</strong>
              <button type="button" class="icon-button" title="Lukk" aria-label="Lukk" onClick={() => setPicker(null)}><IconClose size={14} /></button>
            </div>
            <div class="menu-list" role="listbox" aria-label={current.title}>
              <For each={current.items}>
                {(item) => (
                  <button type="button" role="option" class="menu-item" aria-selected={item.selected ?? false} onClick={() => { setPicker(null); current.pick(item.id); textarea.focus(); }}>
                    <span class="menu-check">{item.selected ? <IconCheck size={13} /> : null}</span>
                    <span class="menu-name">{item.label}</span>
                    <Show when={item.detail}><span class="menu-desc">{item.detail}</span></Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
      <Show when={info()} keyed>
        {(card) => (
          <div class="help-card info-card" role="dialog" aria-label={card.title} data-testid="info-card">
            <div class="help-head">
              <strong>{card.title}<Show when={card.demo}> <span class="demo-badge">Demo</span></Show></strong>
              <button type="button" class="icon-button" title="Lukk" aria-label="Lukk" onClick={() => setInfo(null)}><IconClose size={14} /></button>
            </div>
            <Show when={card.text}><p class="info-text">{card.text}</p></Show>
            <Show when={card.rows}>
              <dl>
                <For each={card.rows}>{([k, v]) => <><dt class="plain">{k}</dt><dd>{v}</dd></>}</For>
              </dl>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
