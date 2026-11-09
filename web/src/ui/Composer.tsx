// The message field. The textarea is uncontrolled, so typing costs what typing costs in a plain
// textarea: nothing reactive runs on a keystroke unless the word under the caret starts with / or @.
import { createEffect, createMemo, createSignal, For, on, onMount, Show, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import { get, patch, post } from "../lib/api";
import type { Attachment, AttachmentRef, BusyMessages, CommandInfo, MentionItem, ModelConfig, PermissionMode, ReasoningEffort, Thread } from "../../../shared/protocol";
import { effortSteps, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_UPLOAD_BYTES, PERSONALITIES } from "../../../shared/protocol";
import { app, LOCAL_SCOPE, modelFor, modelName, report, setMode, mode, setProjectId, setSettingsOpen, sortedProjects, setFolderPickerOpen, toast } from "../state/app";
import { actions, forkThread } from "../state/actions";
import { gridFor } from "../state/grid";
import { createThreadFor, newThreadIn } from "../state/navigate";
import { peekModel } from "../state/thread-model";
import { revertLastTurn, startPlaytest, openVscode } from "../state/project-actions";
import { formatCost, formatTokens } from "../lib/format";
import {
  IconFile, IconFolder, IconBranch, IconSend, IconStop, IconCode, IconSpark, IconClose, IconTerminal, IconChevronDown, IconCheck, IconList, IconPlus,
  IconLaptop, IconMic, IconShieldCheck, IconBolt, IconSearch, IconImage, IconHand, IconPencil, IconAlert, IconReset, IconBack, IconSliders,
  IconNewThread, IconBrain, IconInfo, IconTarget, IconBook, IconArchive, IconHelp, IconChat, IconPlay, IconUndo, IconEye, IconUsers, IconSplitRight,
  IconMonitor, IconChevron, IconWarn,
} from "./icons";
import { GoalLine } from "./Goal";
import { ChatToolButton, ChatToolChips, useChatTools } from "./ChatToolMenu";
import { Popover } from "./Popover";
import { ProjectGlyph } from "./ProjectGlyph";
import { ProviderGlyph } from "./ProviderGlyph";
import { AttachmentChip, imageUrl, showImage } from "./rows";
import { FolderMissingBar } from "./FolderMissingBar";
import { gitInfo, loadGitInfo } from "../state/home";
import { displayKeys } from "../state/shortcuts";

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
  { id: "xhigh", label: "Svært høy" },
  { id: "max", label: "Maks" },
];

// What each placeholder will do when it is built. Shown with a Demo badge, never pretending.
const DEMO_TEXT: Record<string, string> = {
  approve: "Når automatisk gjennomgang av verktøykall finnes, lar denne deg godkjenne ett nytt forsøk etter et avslag. Appen har ingen automatisk gjennomgang ennå, så det er ingenting å godkjenne.",
  "ide-context": "Skal dele åpen fil og markering fra VS Code med tråden, så modellen ser hva du ser på. Krever en utvidelse til editoren, som ikke finnes ennå.",
  local: "Skal flytte en tråd fra skyen til det valgte lokale prosjektet. Alle tråder kjører lokalt i denne appen, så det er ingenting å flytte.",
  mcp: "Skal vise MCP-tjenere som er koblet til, med status og verktøy. MCP er ikke bygget ennå, og ingen tjenere er koblet til.",
  memories: "Minnene er ekte nå: modellen lagrer korte notater med remember og får dem i nye tråder. Se, endre og slett dem i Innstillinger → Personalisering og minner.",
  worktree: "Skal kjøre tråden i et eget Git-worktree, så flere instanser ikke går i beina på hverandre. Ingen git-kommandoer kjøres i denne versjonen.",
};

const CODE_ONLY = new Set(["undo", "playtest", "vscode", "init", "review"]);

// An icon per command, by what it is about: the thread, the model, the project or the agent.
const COMMAND_ICONS: Record<string, (p: { size?: number }) => any> = {
  new: IconNewThread, fork: IconBranch, side: IconSplitRight, task: IconChat, compact: IconArchive, undo: IconUndo, review: IconEye,
  model: IconBolt, reasoning: IconBrain, personality: IconSliders, status: IconInfo,
  project: IconFolder, init: IconFile, playtest: IconPlay, vscode: IconCode,
  goal: IconTarget, plan: IconList, memories: IconBook, storage: IconArchive, help: IconHelp, mode: IconChat,
  mcp: IconUsers, local: IconLaptop, worktree: IconBranch, approve: IconCheck, "ide-context": IconCode,
};

// The arguments as the user can type them, in Norwegian where the app understands both.
const ARG_WORDS: Record<string, string> = { none: "ingen", low: "lav", medium: "middels", high: "høy", xhigh: "svært høy", max: "maks" };
function argsText(args: string): string {
  return args.replace(/[a-z]+/g, (word) => ARG_WORDS[word] ?? word).replace(/\|/g, " | ");
}

function matchScore(command: CommandInfo, query: string): number | null {
  if (!query) return 3;
  const names = [command.name, ...(command.aliases ?? [])].map((n) => n.toLowerCase());
  if (names.includes(query)) return 0;
  if (names.some((n) => n.startsWith(query))) return 1;
  if (names.some((n) => n.includes(query))) return 2;
  return null;
}

type Chip = AttachmentRef & { label: string; key: string };

const drafts = new Map<string, string>();

// Round 11b (SPEC 25.1): images and text handed to a pane's field from outside, by Annoter in the
// Browser panel. The field with that key (the thread's id, or the empty pane's) takes them, now or
// when it mounts. The text goes under what is already typed, and nothing is sent.
export interface ComposerDelivery {
  images: File[];
  text: string;
}
const [deliveries, setDeliveries] = createSignal<Record<string, ComposerDelivery>>({});
export function deliverToComposer(key: string, delivery: ComposerDelivery): void {
  setDeliveries({ ...deliveries(), [key]: delivery });
}

const PERMISSION_LABELS: Record<PermissionMode, string> = { ask: "Spør", "accept-edits": "Godta redigeringer", full: "Godkjenn for meg" };
const PERMISSION_TEXT: Record<PermissionMode, string> = {
  ask: "Spør alltid før filendringer, kommandoer og nettleseren",
  "accept-edits": "Endrer filer i prosjektet uten å spørre. Kommandoer og nettleseren spør",
  full: "Full tilgang uten å spørre. .env og .git/hooks spør likevel",
};
const PERMISSION_ICONS: Record<PermissionMode, (p: { size?: number }) => any> = { ask: IconHand, "accept-edits": IconPencil, full: IconAlert };

// Chat: what each personality does, in the words of the app. The prompts in PERSONALITIES are for the model.
const PERSONALITY_TEXT: Record<string, string> = {
  standard: "Vanlige svar, uten egen stil",
  kort: "Korte svar, med så få ord som oppgaven tillater",
  grundig: "Forklarer resonnementet og avveiningene",
  vennlig: "Varm og oppmuntrende, med enkle ord",
  lærer: "Forklarer hvorfor, og foreslår hva du kan prøve",
};

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

const LOCAL_TEXT = "Tråden kjører på denne maskinen, i prosjektmappen din. Senere skal du kunne velge en annen vert, for eksempel en server over SSH eller en sky-instans. Det finnes ikke ennå, så alt kjører lokalt.";
const MIC_TEXT = "Skal la deg snakke inn meldingen. Ingen lyd tas opp i denne versjonen, og mikrofonen brukes ikke.";

// The project picker opens from the chip above the field, and from the project name on the start
// page of the same pane. One open at a time, so a signal with the pane's key is enough.
const [pickerPane, setPickerPane] = createSignal<string | null>(null);
export const openProjectPicker = (paneKey: string) => setPickerPane(paneKey);

// The picker opened from somewhere without a field of its own (Vis alle prosjekter on the start page).
export const NO_PROJECT_KEY = "no-project";
let carried: string | null = null;

// Picks a project for Kode. What was typed in the field the picker came from goes with it, into a
// new thread in the project.
export function chooseProject(id: string, fromKey: string = NO_PROJECT_KEY): void {
  carried = drafts.get(fromKey) || null;
  drafts.delete(fromKey);
  setPickerPane(null);
  setProjectId(id);
  setMode("code");
}

// Ikke jobb i et prosjekt: Kode on Denne datamaskinen, without a folder and without tools.
export function chooseNoProject(): void {
  setPickerPane(null);
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
function ProjectPicker(props: { current: string | null; paneKey: string; onDone: () => void; onCancel: () => void }) {
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
    if (entry.kind === "project") return entry.project.folderMissing ? undefined : chooseProject(entry.project.id, props.paneKey);
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
    <div class="project-picker" role="dialog" aria-label="Velg prosjekt" data-testid="project-picker-menu">
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
  let list!: HTMLDivElement;
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
  const optionId = (id: string) => `${listId}-${id.replace(/[^a-z0-9_-]/gi, "_")}`;
  const reveal = () => requestAnimationFrame(() => list?.querySelector(".model-option.active")?.scrollIntoView({ block: "nearest" }));
  const move = (step: number) => {
    const ids = flat();
    if (!ids.length) return;
    const at = ids.indexOf(active() ?? "");
    setActive(ids[at < 0 ? 0 : (at + step + ids.length) % ids.length]);
    reveal();
  };
  onMount(() => reveal());
  return (
    <div class="model-menu" data-testid="model-menu">
      <label class="model-search">
        <IconSearch size={14} />
        <input
          ref={(el) => requestAnimationFrame(() => el.focus({ preventScroll: true }))}
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
            } else if (e.key === "Enter") {
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
              <div class="model-group-head" aria-hidden="true"><ProviderGlyph name={group.name} small /><span>{group.name}</span></div>
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

const providerOf = (modelId: string | null | undefined) => {
  const model = modelFor(modelId);
  return model ? app.providers.find((p) => p.id === model.providerId) : undefined;
};

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
  // Where a value sits on the track. xhigh is not a step: it sits between Høy and Maks.
  const positionOf = (value: ReasoningEffort | null): number | null => {
    if (!value) return null;
    const at = props.steps.indexOf(value);
    if (at >= 0) return at;
    const high = props.steps.indexOf("high");
    return value === "xhigh" && high >= 0 ? Math.min(last(), high + 0.5) : null;
  };
  // Nothing chosen and no known standard: the thumb waits, dimmed, in the middle, so it is there
  // from the first moment and slides from there to what is picked.
  const middle = () => {
    const at = props.steps.indexOf("medium");
    return at >= 0 ? at : Math.floor(last() / 2);
  };
  const position = () => preview() ?? positionOf(props.chosen) ?? positionOf(props.modelDefault) ?? middle();
  const standard = () => preview() === null && props.chosen === null;
  // The model's standard is not a known level: the thumb waits dimmed in the middle until one is
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
  const stepAt = (clientX: number) => {
    const box = track.getBoundingClientRect();
    const thumb = 26;
    const x = (clientX - box.left - thumb / 2) / Math.max(1, box.width - thumb);
    return Math.max(0, Math.min(last(), Math.round(x * last())));
  };
  const commit = (index: number) => {
    const value = props.steps[index];
    setPreview(index);
    if (value !== props.chosen) props.onPick(value);
    else setPreview(null);
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
    <div class="effort-pop" data-testid="effort-picker" role="group" aria-label="Innsats">
      <div class="effort-head">
        <button type="button" class="effort-mid" title="Velg en annen modell" onClick={props.onModel}>
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
        aria-valuenow={unset() ? undefined : position()}
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
  autofocus?: boolean;
  registerFill?: (fill: (text: string) => void) => void;
}) {
  let textarea!: HTMLTextAreaElement;
  let projectChip: HTMLButtonElement | undefined;
  const [menu, setMenu] = createSignal<Menu | null>(null);
  const [selected, setSelected] = createSignal(0);
  const [commands, setCommands] = createSignal<CommandInfo[]>([]);
  const [mentions, setMentions] = createSignal<MentionItem[]>([]);
  const [chips, setChips] = createSignal<Chip[]>([]);
  const [uploading, setUploading] = createSignal(0);
  let fileInput!: HTMLInputElement;
  let textInput!: HTMLInputElement;
  let attachMenu: HTMLDivElement | undefined;
  const [attachView, setAttachView] = createSignal<"menu" | "folders">("menu");
  const [skill, setSkill] = createSignal<string | null>(null);
  const [hasText, setHasText] = createSignal(false);
  const [draftModel, setDraftModel] = createSignal<string | null>(null);
  const [modelOpen, setModelOpen] = createSignal(false);
  const [effortOpen, setEffortOpen] = createSignal(false);
  const [permissionOpen, setPermissionOpen] = createSignal(false);
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [attachOpen, setAttachOpen] = createSignal(false);
  // Chosen before the thread exists: applied when the first message creates it.
  const [draftReasoning, setDraftReasoning] = createSignal<ReasoningEffort | null | undefined>(undefined);
  const [draftPersonality, setDraftPersonality] = createSignal<string | null>(null);
  const [personalityOpen, setPersonalityOpen] = createSignal(false);
  const pickerOpen = () => pickerPane() === props.paneKey;
  const [picker, setPicker] = createSignal<Picker | null>(null);
  const [info, setInfo] = createSignal<InfoCard | null>(null);

  const thread = createMemo(() => {
    const id = props.threadId();
    return id ? app.threads[id] : undefined;
  });
  const running = createMemo(() => thread()?.running ?? false);
  const kode = () => !!(props.projectId || props.code);
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
  const draftKey = () => props.threadId() ?? props.paneKey;
  const branchInfo = () => (props.projectId ? gitInfo(props.projectId) : undefined);
  const branch = () => branchInfo()?.branch ?? null;
  const chosenEffort = (): ReasoningEffort | null => {
    const current = thread();
    if (current) return current.reasoning;
    return draftReasoning() ?? null;
  };
  // The steps the model takes (SPEC 21.3). A model that takes none has no effort button.
  const steps = createMemo(() => {
    const model = modelFor(modelId());
    return model ? effortSteps(app.providers.find((p) => p.id === model.providerId)?.kind, model) : [];
  });
  // «Høy», or «Velg innsats» while the model's own standard is used.
  const effortChip = () => effortLabel(chosenEffort()) || "Velg innsats";
  const setEffort = (value: ReasoningEffort | null, close = true) => {
    if (close) setEffortOpen(false);
    const current = props.threadId();
    if (current) patch(`/api/threads/${current}`, { reasoning: value }).catch(report);
    else setDraftReasoning(value);
  };
  const personality = () => {
    const current = thread();
    return (current ? current.personality : draftPersonality()) ?? "standard";
  };
  const setPersonality = (value: string) => {
    setPersonalityOpen(false);
    const current = props.threadId();
    if (current) patch(`/api/threads/${current}`, { personality: value }).catch(report);
    else setDraftPersonality(value);
  };
  // Settings.busyMessages: what a message sent while the agent works does. The switch is in the queue row.
  const busyMode = (): BusyMessages => app.settings.busyMessages ?? "queue";
  const setBusyMode = async (value: BusyMessages) => {
    if (busyMode() === value) return;
    try {
      await patch("/api/settings", { busyMessages: value });
      // What waits already follows the switch, so "Send med en gang" also sends what is in the queue.
      const id = props.threadId();
      const steer = value === "steer";
      if (!id) return;
      for (const q of queued()) {
        if (!!q.steer === steer) continue;
        const done = await patch(`/api/threads/${id}/queue/${encodeURIComponent(q.messageId)}`, { steer }).then(() => true, () => false);
        if (done) peekModel(id)?.setQueuedSteer(q.messageId, steer);
      }
    } catch (err) {
      report(err);
    }
  };
  const steerOne = async (messageId: string) => {
    const id = props.threadId();
    if (!id) return;
    try {
      await patch(`/api/threads/${id}/queue/${encodeURIComponent(messageId)}`, { steer: true });
      peekModel(id)?.setQueuedSteer(messageId, true);
    } catch (err) {
      report(err);
    }
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

  const loadCommands = () => {
    const url = props.projectId ? `/api/projects/${props.projectId}/commands` : "/api/commands";
    get<CommandInfo[]>(url).then(setCommands).catch(() => undefined);
  };

  let mentionRequest = 0;
  const loadMentions = (query: string) => {
    if (!props.projectId) return;
    const id = ++mentionRequest;
    get<MentionItem[]>(`/api/projects/${props.projectId}/mentions?q=${encodeURIComponent(query)}`)
      .then((items) => {
        if (id === mentionRequest) {
          setMentions(items);
          setSelected(0);
        }
      })
      .catch(() => undefined);
  };

  const closeMenu = () => {
    if (menu()) setMenu(null);
  };

  // Runs on input and caret moves: a cheap look at the word under the caret.
  const inspect = () => {
    const value = textarea.value;
    const caret = textarea.selectionStart;
    setHasText(value.length > 0);
    if (value.startsWith("!") && !value.slice(0, caret).includes("\n")) {
      setMenu({ kind: "shell", query: value.slice(1) });
      return;
    }
    const before = value.slice(Math.max(0, caret - 120), caret);
    const match = /(?:^|\s)([/@$])([^\s/@$]*)$/.exec(before);
    if (!match) return closeMenu();
    const query = match[2];
    const start = caret - query.length - 1;
    const kind = match[1] === "/" ? "command" : match[1] === "$" ? "skill" : "mention";
    if (kind === "mention" && !props.projectId) return closeMenu();
    const previous = menu();
    if (!previous || previous.kind !== kind || previous.query !== query) setSelected(0);
    setMenu({ kind, query, start, end: caret });
    if (kind === "mention") loadMentions(query);
    else if (!commands().length) loadCommands();
  };

  const commandItems = createMemo(() => {
    const current = menu();
    if (current?.kind !== "command" && current?.kind !== "skill") return [];
    const query = current.query.toLowerCase();
    const hidden = (c: CommandInfo) => (current.kind === "skill" && c.kind !== "skill") || (!props.projectId && c.kind === "builtin" && CODE_ONLY.has(c.name));
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
        ["Personlighet", PERSONALITIES.find((p) => p.id === (current?.personality ?? "standard"))?.label ?? "Standard"],
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
  };

  const runBuiltin = async (name: string, args = "") => {
    const id = props.threadId();
    const arg = args.trim();
    try {
      switch (name) {
        case "new":
          await newThreadIn(props.projectId, kode());
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
          if (!id) return toast("Tråden har ingen endringer å gjennomgå ennå.", "info");
          await post(`/api/threads/${id}/messages`, { text: arg, review: true });
          break;
        case "storage":
          actions.settings("storage");
          break;
        case "memories":
          actions.settings("personalization");
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

  const findCommand = (word: string) => commands().find((c) => c.name === word || c.aliases?.includes(word));

  const pickCommand = (item: CommandInfo) => {
    const current = menu();
    if (current?.kind !== "command" && current?.kind !== "skill") return;
    setMenu(null);
    if (item.kind === "builtin") {
      // Commands that need text get it typed after them; the rest run at once.
      if (item.args?.startsWith("<")) return replaceWord(current.start, textarea.selectionStart, `/${item.name} `);
      replaceWord(current.start, textarea.selectionStart, "");
      void runBuiltin(item.name);
    } else {
      replaceWord(current.start, textarea.selectionStart, "");
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
      replaceWord(current.start, textarea.selectionStart, "");
      return toast(LIMIT_TEXT, "info");
    }
    const key = item.threadId ?? item.path ?? item.label;
    if (!chips().some((c) => c.key === key)) {
      const chip: Chip = item.kind === "thread"
        ? { kind: "thread", threadId: item.threadId!, label: item.label, key }
        : { kind: item.kind, path: item.path!, label: item.label, key };
      setChips([...chips(), chip]);
    }
    replaceWord(current.start, textarea.selectionStart, "");
  };

  const reset = () => {
    textarea.value = "";
    drafts.delete(draftKey());
    setHasText(false);
    setChips([]);
    setSkill(null);
    setMenu(null);
  };

  // One thread per pane, also when a second message is sent before the first one has made it:
  // the second waits for the same promise instead of making a thread of its own.
  let creating: Promise<string> | null = null;
  const ensureThread = (): Promise<string> => {
    const existing = props.threadId();
    if (existing) return Promise.resolve(existing);
    creating ??= (async () => {
      const created = await createThreadFor(props.projectId, draftModel(), { code: kode(), chatProjectId: props.chatProjectId });
      const reasoning = draftReasoning();
      if (reasoning !== undefined) await patch(`/api/threads/${created.id}`, { reasoning }).catch(report);
      const chosen = draftPersonality();
      if (chosen && !props.projectId) await patch(`/api/threads/${created.id}`, { personality: chosen }).catch(report);
      const tools = chatTools.draft();
      if (tools && !kode()) await patch(`/api/threads/${created.id}`, { chatTools: tools }).catch(report);
      props.onThreadCreated(created);
      return created.id;
    })().finally(() => (creating = null));
    return creating;
  };

  const submit = async () => {
    if (locked()) return;
    const raw = textarea.value;
    const text = raw.trim();
    if (uploading()) return toast("Vent til bildene er lastet opp.", "info");
    const attachments = chips().map(chipRef);
    if (attachments.length > MAX_ATTACHMENTS) return toast(LIMIT_TEXT, "info");
    let usedSkill = skill();
    let body: Record<string, unknown>;

    if (!usedSkill && text.startsWith("!")) {
      const shell = text.slice(1).trim();
      if (!shell) return;
      if (!props.projectId) return toast("! krever Kode-modus og et prosjekt.");
      body = { text: "", shell };
    } else if (!usedSkill && /^[/$]\S+/.test(text)) {
      const [word, ...rest] = text.slice(1).split(/\s+/);
      if (!commands().length) {
        const url = props.projectId ? `/api/projects/${props.projectId}/commands` : "/api/commands";
        setCommands(await get<CommandInfo[]>(url).catch(() => []));
      }
      const known = findCommand(word);
      if (known?.kind === "builtin") {
        reset();
        return runBuiltin(known.name, rest.join(" "));
      }
      if (known?.kind === "skill") {
        usedSkill = known.name;
        body = { text: rest.join(" "), skill: known.name, attachments };
      } else body = { text, attachments };
    } else {
      if (!text && !usedSkill && !attachments.length) return;
      if (!text && attachments.length && !usedSkill) return toast("Skriv en melding til vedleggene.", "info");
      body = { text, attachments, ...(usedSkill ? { skill: usedSkill } : {}) };
    }

    // While the agent works, the setting decides whether the message waits or goes in at once.
    if (running() && !("shell" in body)) body.steer = busyMode() === "steer";
    const restoreChips = chips();
    const restoreSkill = usedSkill;
    reset();
    props.onSent();
    try {
      const id = await ensureThread();
      await post(`/api/threads/${id}/messages`, body);
    } catch (err) {
      textarea.value = raw;
      setHasText(true);
      setChips(restoreChips);
      setSkill(restoreSkill === skill() ? skill() : restoreSkill);
      report(err);
    }
  };

  const stop = () => {
    const id = props.threadId();
    if (id) post(`/api/threads/${id}/stop`).catch(report);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
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
        if (current.kind === "command" || current.kind === "skill") pickCommand(commandItems()[selected()]);
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
    drafts.set(draftKey(), textarea.value);
    inspect();
  };

  const setModel = (id: string) => {
    setModelOpen(false);
    const current = props.threadId();
    setDraftModel(id);
    if (current) patch(`/api/threads/${current}`, { modelId: id }).catch(report);
  };

  const setPermission = (value: PermissionMode) => {
    setPermissionOpen(false);
    if (props.projectId) patch(`/api/projects/${props.projectId}`, { permissionMode: value }).catch(report);
  };

  onMount(() => {
    textarea.value = drafts.get(draftKey()) ?? "";
    if (carried && props.projectId && !props.threadId() && !textarea.value.trim()) {
      textarea.value = carried;
      drafts.set(draftKey(), carried);
      carried = null;
    }
    setHasText(textarea.value.length > 0);
    props.registerFill?.((text) => {
      textarea.value = text;
      drafts.set(draftKey(), text);
      setHasText(true);
      textarea.focus();
    });
    if (props.autofocus && !matchMedia("(pointer: coarse)").matches) textarea.focus({ preventScroll: true });
    loadCommands();
    if (props.projectId) loadGitInfo(props.projectId);
  });

  createEffect(() => {
    const key = draftKey();
    const delivery = deliveries()[key];
    if (!delivery) return;
    untrack(() => {
      const { [key]: _taken, ...rest } = deliveries();
      setDeliveries(rest);
      if (delivery.text) {
        const before = textarea.value.trimEnd();
        textarea.value = before ? `${before}\n\n${delivery.text}` : delivery.text;
        drafts.set(key, textarea.value);
        setHasText(true);
      }
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      void addImages(delivery.images);
    });
  });

  const queued = createMemo(() => {
    const id = props.threadId();
    return id ? (peekModel(id)?.queued() ?? []) : [];
  });

  return (
    <div class="composer-wrap">
      <Show when={queued().length}>
        <div class="queue" data-testid="queue">
          <span class="queue-label">{queued().every((q) => q.steer) ? "Sendes inn i turen" : `${queued().length} i kø`}</span>
          <For each={queued()}>
            {(q) => (
              <span class="queue-entry">
                <span class="queue-item" classList={{ steer: !!q.steer }} title={q.steer ? `Går inn i turen ved neste steg: ${q.text}` : q.text}>{q.text}</span>
                <Show when={!q.steer && !q.from}>
                  <button type="button" class="queue-now" title="Send akkurat denne inn i turen som kjører, ved neste steg" aria-label={`Send «${q.text}» med en gang`} onClick={() => void steerOne(q.messageId)}>
                    <IconSend size={12} />
                  </button>
                </Show>
              </span>
            )}
          </For>
          <span class="queue-spacer" />
          <div class="queue-switch" role="group" aria-label="Meldinger mens agenten jobber" data-testid="busy-switch">
            <button type="button" aria-pressed={busyMode() === "queue"} aria-label="Legg i kø" title="Legg i kø: meldinger venter til turen er ferdig" onClick={() => void setBusyMode("queue")}>Kø</button>
            <button type="button" aria-pressed={busyMode() === "steer"} aria-label="Send med en gang" title="Send med en gang: meldinger går inn i turen som kjører, ved neste steg" onClick={() => void setBusyMode("steer")}>Straks</button>
          </div>
        </div>
      </Show>
      <Show when={kode()}>
      <div class="composer-context">
        <Popover
          class="context-anchor"
          open={pickerOpen()}
          onClose={() => setPickerPane(null)}
          trigger={
            <button type="button" class="context-chip" data-testid="project-picker" ref={projectChip} aria-haspopup="dialog" aria-expanded={pickerOpen()} title={project()?.path ?? "Velg prosjekt"} onClick={() => setPickerPane(pickerOpen() ? null : props.paneKey)}>
              <Show when={project()} fallback={<IconFolder size={15} />}><ProjectGlyph project={project()!} size={15} /></Show>
              <span>{project()?.name ?? "Velg prosjekt"}</span>
            </button>
          }
        >
          <ProjectPicker current={props.projectId} paneKey={props.paneKey} onDone={() => setPickerPane(null)} onCancel={() => { setPickerPane(null); projectChip?.focus(); }} />
        </Popover>
        <button type="button" class="context-chip" title="Kjører på denne maskinen" onClick={() => setInfo({ title: "Lokal", demo: true, text: LOCAL_TEXT })}>
          <IconLaptop size={15} /><span>Lokal</span>
        </button>
        <Show when={project() && branch()}>
          <span class="context-chip static" data-testid="branch" title={branchInfo()?.detached ? "Ingen gren, HEAD peker på en commit. Lest fra .git/HEAD." : "Grenen er lest fra .git/HEAD. Ingen git-kommandoer kjøres."}>
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
          <div class="slash-menu" role="listbox" data-testid="composer-menu">
            <Show when={menu()!.kind === "command" || menu()!.kind === "skill"}>
              <div class="menu-heading">{menu()!.kind === "skill" ? "Skills" : "Kommandoer"}</div>
              <For each={commandItems()} fallback={<div class="menu-empty">{menu()!.kind === "skill" ? "Ingen skills. Legg dem i .agentic/skills/ i prosjektet." : "Ingen treff"}</div>}>
                {(item, index) => (
                  <button
                    type="button"
                    role="option"
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
                    <Show when={item.args && index() === selected()}><span class="menu-args">{argsText(item.args!)}</span></Show>
                    <span class="menu-desc">{item.description}</span>
                    <Show when={item.demo}><span class="demo-badge">Demo</span></Show>
                    <Show when={item.kind === "skill"}><span class="menu-tag">{item.source === "project" ? "prosjekt" : "skill"}</span></Show>
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
          <div class="chips">
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
            disabled={locked()}
            spellcheck={false}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onClick={inspect}
            onPaste={(e) => {
              const files = imagesFrom(e.clipboardData?.files).filter((f) => f.type.startsWith("image/"));
              if (!files.length) return;
              e.preventDefault();
              void addImages(files);
            }}
            onBlur={() => setTimeout(() => {
              // A click in the menu blurs the field for a moment. A blur from before the menu opened
              // (focus went to the + menu and came back) must not close the menu that opened since.
              if (document.activeElement !== textarea) closeMenu();
            }, 120)}
          />
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
                <button type="button" role="menuitem" class="menu-item" title="Åpne listen over /-kommandoer og skills" onClick={() => { closeAttach(); insertTrigger("/"); }}>
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
          <Show when={!kode()}>
            <ChatToolButton state={chatTools} />
          </Show>
          <Show when={!kode()}>
            <Popover
              class="keep"
              open={personalityOpen()}
              onClose={() => setPersonalityOpen(false)}
              trigger={
                <button
                  type="button"
                  class="foot-chip personality-chip"
                  data-testid="personality-button"
                  data-custom={personality() !== "standard" ? "" : undefined}
                  title={personality() === "standard" ? "Personlighet: hvordan modellen svarer i denne chatten" : `Personlighet: ${PERSONALITIES.find((p) => p.id === personality())?.label}`}
                  aria-label="Personlighet"
                  aria-haspopup="menu"
                  aria-expanded={personalityOpen()}
                  onClick={() => setPersonalityOpen(!personalityOpen())}
                >
                  <IconSliders size={15} />
                  <Show when={personality() !== "standard"}><span>{PERSONALITIES.find((p) => p.id === personality())?.label}</span></Show>
                </button>
              }
            >
              <div class="menu-list personality-menu" role="menu" aria-label="Personlighet">
                <div class="menu-heading">Personlighet for denne chatten</div>
                <For each={PERSONALITIES}>
                  {(p) => (
                    <button type="button" role="menuitemradio" aria-checked={personality() === p.id} class="menu-item menu-item-tall" onClick={() => setPersonality(p.id)}>
                      <span class="menu-stack"><span class="menu-name">{p.label}</span><span class="menu-desc">{PERSONALITY_TEXT[p.id] ?? ""}</span></span>
                      <span class="menu-check"><Show when={personality() === p.id}><IconCheck size={14} /></Show></span>
                    </button>
                  )}
                </For>
                <p class="personality-note">Gjelder bare denne chatten. Egne instruksjoner for alle chatter skriver du i Innstillinger → Konfigurasjon.</p>
              </div>
            </Popover>
          </Show>
          <Show when={project()}>
            <Popover
              class="keep"
              open={permissionOpen()}
              onClose={() => setPermissionOpen(false)}
              trigger={
                <button type="button" class="foot-chip" data-testid="permission-button" data-mode={project()!.permissionMode} title="Velg hvordan handlinger godkjennes i prosjektet" onClick={() => setPermissionOpen(!permissionOpen())}>
                  <IconShieldCheck size={15} /><span>{PERMISSION_LABELS[project()!.permissionMode]}</span>
                </button>
              }
            >
              <div class="menu-list permission-menu" role="menu" aria-label="Tillatelser">
                <div class="menu-heading">Hvordan skal handlinger godkjennes?</div>
                <For each={Object.keys(PERMISSION_LABELS) as PermissionMode[]}>
                  {(value) => {
                    const Icon = PERMISSION_ICONS[value];
                    return (
                      <button type="button" role="menuitemradio" aria-checked={project()!.permissionMode === value} class="menu-item menu-item-tall permission-item" data-mode={value} onClick={() => setPermission(value)}>
                        <span class="permission-icon"><Icon size={15} /></span>
                        <span class="menu-stack"><span class="menu-name">{PERMISSION_LABELS[value]}</span><span class="menu-desc">{PERMISSION_TEXT[value]}</span></span>
                        <span class="menu-check"><Show when={project()!.permissionMode === value}><IconCheck size={14} /></Show></span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Popover>
          </Show>
          <Show when={!kode()}>
            <ChatToolChips state={chatTools} />
          </Show>
          <Show when={thread()?.planMode}>
            <button type="button" class="pill pill-accent" title="Planmodus: modellen planlegger uten å endre filer. Trykk for å slå av." onClick={() => void runBuiltin("plan")}><IconList size={12} />Plan</button>
          </Show>
          <span class="composer-spacer" />
          <Show when={steps().length}>
            <Popover
              class="effort-anchor"
              align="right"
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
            trigger={
              <button type="button" class="foot-chip model-button" data-testid="model-button" title={`${modelName(modelId())}: velg modell`} aria-haspopup="listbox" aria-expanded={modelOpen()} onClick={() => { setEffortOpen(false); setModelOpen(!modelOpen()); }}>
                <Show when={providerOf(modelId())} fallback={<IconBolt size={14} />}>{(provider) => <ProviderGlyph name={provider().name} small />}</Show>
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
            <For each={commands()}>
              {(c) => (
                <>
                  <dt>{c.kind === "skill" ? "$" : "/"}{c.name}<Show when={c.demo}> <span class="demo-badge">Demo</span></Show></dt>
                  <dd>{c.description}<Show when={c.aliases?.length}><span class="muted"> · også {c.aliases!.map((a) => `/${a}`).join(", ")}</span></Show></dd>
                </>
              )}
            </For>
            <dt>@</dt><dd>Legg ved filer, mapper og tråder</dd>
            <dt>$</dt><dd>Bruk en skill</dd>
            <dt>!kommando</dt><dd>Kjør en kommando i prosjektmappen</dd>
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
