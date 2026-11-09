// Chat (round 7): what a conversation app has besides the conversation. Editing a message in place,
// search in the conversation with marks on the hits, and export to Markdown. Since round 9 (SPEC
// 21.8) Kode edits too, after saying that files are not rolled back, and both modes can select
// several messages and copy them together.
import { createContext, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Thread, ThreadEventEnvelope } from "../../../shared/protocol";
import { api, get, post } from "../lib/api";
import { app, modelName, report, scopeOf, toast } from "../state/app";
import { openThread } from "../state/navigate";
import { peekGrid } from "../state/grid";
import { openWindows } from "../state/windows";
import type { Row, ThreadModel } from "../state/thread-model";
import { IconArrowDown, IconClose, IconSearch } from "./icons";

// Given to the rows of a Chat conversation. Selectors, so a change wakes only the rows it is about.
export interface ChatToolsValue {
  code: boolean; // Kode: the edit says that files stay as they are
  isEditing: (key: string) => boolean;
  isLastAnswer: (key: string) => boolean;
  saveEdit: (key: string, text: string) => Promise<void>;
  cancelEdit: () => void;
  isSelected: (key: string) => boolean;
}

export const ChatTools = createContext<ChatToolsValue>();

const MAX_EDIT_HEIGHT = 320;

// The bubble turned into a field. Enter saves and sends, Shift+Enter is a new line, Esc cancels.
export function UserEdit(props: { text: string; hasAttachments: boolean; code?: boolean; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
  let area!: HTMLTextAreaElement;
  const [busy, setBusy] = createSignal(false);
  const [empty, setEmpty] = createSignal(!props.text.trim());
  const grow = () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight + 2, MAX_EDIT_HEIGHT)}px`;
  };
  onMount(() => {
    area.value = props.text;
    grow();
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  });
  const save = async () => {
    const text = area.value.trim();
    if (busy() || (!text && !props.hasAttachments)) return;
    setBusy(true);
    try {
      await props.onSave(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="user-edit" data-testid="user-edit">
      <textarea
        ref={area}
        class="user-edit-input"
        aria-label="Rediger meldingen"
        rows={1}
        spellcheck={false}
        onInput={() => {
          grow();
          setEmpty(!area.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            props.onCancel();
          } else if (e.key === "Enter" && (app.settings.enterKey === "newline" ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div class="user-edit-foot">
        <span class="user-edit-note">{props.code ? "Alt etter meldingen blir erstattet. Filene rulles ikke tilbake." : "Svaret og alt etter meldingen blir erstattet."} Esc avbryter.</span>
        <button type="button" class="btn btn-small" onClick={props.onCancel}>Avbryt</button>
        <button type="button" class="btn btn-small btn-primary" disabled={busy() || (empty() && !props.hasAttachments)} onClick={() => void save()}>Lagre og send</button>
      </div>
    </div>
  );
}

// Search

const HIT = "chat-search";
const CURRENT = "chat-search-current";
const MAX_MARKS = 4000;
const PAINT_GAP_MS = 200;
const MAX_OLDER_PAGES = 40;

type Searchable = Extract<Row, { kind: "user" | "text" }>;

function clearMarks(): void {
  CSS.highlights?.delete(HIT);
  CSS.highlights?.delete(CURRENT);
}

// Marks every hit in what is on the page, with the Highlight API: no element is added or changed,
// so the text and its layout stay as they are. Hits in the current message get their own mark.
function paintMarks(root: HTMLElement, query: string, current: string | null): Range | null {
  if (!CSS.highlights) return null;
  const all: Range[] = [];
  const mine: Range[] = [];
  const blocks = root.querySelectorAll<HTMLElement>(".user-text, .row-text");
  for (const block of blocks) {
    const key = block.dataset.messageId ?? block.closest<HTMLElement>(".row-user")?.dataset.key;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node && all.length < MAX_MARKS; node = walker.nextNode() as Text | null) {
      const text = node.data.toLowerCase();
      for (let at = text.indexOf(query); at !== -1 && all.length < MAX_MARKS; at = text.indexOf(query, at + query.length)) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + query.length);
        (key === current ? mine : all).push(range);
      }
    }
  }
  CSS.highlights.set(HIT, new Highlight(...all));
  CSS.highlights.set(CURRENT, new Highlight(...mine));
  return mine[0] ?? null;
}

// The search bar over a conversation. It steps through the messages that have a hit, in order, and
// marks the hits in what is shown. Older messages that are not loaded yet can be loaded from here.
export function ConversationSearch(props: { model: ThreadModel; root: () => HTMLElement; jump: (row: Row) => void; onClose: () => void; register: (focus: () => void) => void }) {
  let input!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [index, setIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  let typing: ReturnType<typeof setTimeout> | undefined;

  const matches = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return [] as Searchable[];
    const out: Searchable[] = [];
    for (const chunk of props.model.chunks()) {
      for (const row of chunk.rows()) {
        if ((row.kind === "user" || row.kind === "text") && row.text.toLowerCase().includes(q)) out.push(row);
      }
    }
    return out;
  });
  const current = () => matches()[index()] ?? null;

  // The newest hit first, since a conversation is read from the bottom.
  createEffect(() => setIndex(Math.max(0, matches().length - 1)));

  let painted = 0;
  let pending = false;
  const paint = (scroll: boolean) => {
    const q = query().trim().toLowerCase();
    if (!q) return clearMarks();
    painted = performance.now();
    const first = paintMarks(props.root(), q, current()?.key ?? null);
    if (scroll && first) first.startContainer.parentElement?.scrollIntoView({ block: "center" });
  };
  // Chunks render and drop as the conversation scrolls, so the marks follow, at most a few times a second.
  const later = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      requestAnimationFrame(() => paint(false));
    }, Math.max(0, PAINT_GAP_MS - (performance.now() - painted)));
  };

  createEffect(() => {
    const row = current();
    query();
    if (!row) return clearMarks();
    props.jump(row);
    // The jump renders the chunk on the next frames.
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => paint(true))));
  });

  const step = (delta: number) => {
    const count = matches().length;
    if (count) setIndex((index() + delta + count) % count);
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      for (let page = 0; props.model.hasOlder() && page < MAX_OLDER_PAGES; page++) await props.model.loadOlder();
    } catch (err) {
      report(err);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    const observer = new MutationObserver(later);
    observer.observe(props.root(), { childList: true, subtree: true });
    props.register(() => {
      input.focus();
      input.select();
    });
    requestAnimationFrame(() => input.focus());
    onCleanup(() => {
      observer.disconnect();
      clearTimeout(typing);
      clearMarks();
    });
  });

  return (
    <div class="chat-search" role="search" data-testid="chat-search">
      <IconSearch size={14} />
      <input
        ref={input}
        class="chat-search-input"
        placeholder="Søk i samtalen"
        aria-label="Søk i samtalen"
        onInput={(e) => {
          const value = e.currentTarget.value;
          clearTimeout(typing);
          typing = setTimeout(() => setQuery(value), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            clearTimeout(typing);
            if (query() !== e.currentTarget.value) setQuery(e.currentTarget.value);
            else step(e.shiftKey ? 1 : -1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            props.onClose();
          }
        }}
      />
      <span class="chat-search-count" aria-live="polite" data-testid="chat-search-count">
        <Show when={query().trim()}>{matches().length ? `${index() + 1} av ${matches().length}` : "Ingen treff"}</Show>
      </span>
      <button type="button" class="icon-button" title="Forrige treff (eldre)" aria-label="Forrige treff" disabled={matches().length < 2} onClick={() => step(-1)}>
        <span class="flip"><IconArrowDown size={14} /></span>
      </button>
      <button type="button" class="icon-button" title="Neste treff (nyere)" aria-label="Neste treff" disabled={matches().length < 2} onClick={() => step(1)}>
        <IconArrowDown size={14} />
      </button>
      <Show when={props.model.hasOlder()}>
        <button type="button" class="btn btn-small btn-ghost chat-search-older" disabled={loading()} title="Last inn resten av samtalen og søk der også" onClick={() => void loadAll()}>
          {loading() ? "Laster…" : "Søk i eldre"}
        </button>
      </Show>
      <button type="button" class="icon-button" title="Lukk søket (Esc)" aria-label="Lukk søket" onClick={props.onClose}><IconClose size={14} /></button>
    </div>
  );
}

// Kjør on a shell block of several lines: the whole script is shown, and nothing runs until the
// user says yes. Built on demand, like the image viewer, so no pane has to keep a host mounted.
export function confirmScript(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog script-confirm";
    dialog.setAttribute("aria-label", "Kjør skriptet");
    const title = document.createElement("h2");
    title.textContent = "Kjør hele skriptet?";
    const text = document.createElement("p");
    const lines = script.split("\n").length;
    text.textContent = `Blokken har ${lines} linjer. De kjøres som ett skript i prosjektmappen, med vanlige tillatelser.`;
    const pre = document.createElement("pre");
    pre.className = "script-text";
    pre.textContent = script;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Avbryt";
    const run = document.createElement("button");
    run.type = "button";
    run.className = "btn btn-primary";
    run.textContent = "Kjør skriptet";
    actions.append(cancel, run);
    dialog.append(title, text, pre, actions);
    let answer = false;
    cancel.addEventListener("click", () => dialog.close());
    run.addEventListener("click", () => {
      answer = true;
      dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

// Export

const PAGE = 5000;

function stamp(at: number): string {
  const date = new Date(at);
  return `${date.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })} kl. ${date.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}`;
}

// The conversation as Markdown: what you wrote and what the model answered, with times. Thinking
// and tool output are left out; a line says which tools were used.
export function threadMarkdown(thread: Thread, events: ThreadEventEnvelope[], now = Date.now()): string {
  const out: string[] = [`# ${thread.title}`, "", `Eksportert fra Agentic Desktop ${stamp(now)}.`];
  const answers = new Map<string, number>(); // messageId -> index in out
  let model = "";
  let heading = false; // a "Svar" heading is open for this run
  for (const { at, event } of events) {
    switch (event.type) {
      case "user.message": {
        heading = false;
        out.push("", "---", "", `## Du · ${stamp(at)}`, "", event.text.trim() || "(uten tekst)");
        const names = (event.attachments ?? []).map((a) => a.label);
        if (names.length) out.push("", `*Vedlegg: ${names.join(", ")}*`);
        break;
      }
      case "run.started":
        model = modelName(event.modelId);
        heading = false;
        break;
      case "text.delta": {
        if (!heading) {
          out.push("", `## Svar${model ? ` · ${model}` : ""}`);
          heading = true;
        }
        const at = answers.get(event.messageId);
        if (at === undefined) {
          out.push("", event.text);
          answers.set(event.messageId, out.length - 1);
        } else out[at] += event.text;
        break;
      }
      case "tool.started":
        if (!heading) {
          out.push("", `## Svar${model ? ` · ${model}` : ""}`);
          heading = true;
        }
        out.push("", `> Brukte ${event.tool}${event.summary ? `: ${event.summary}` : ""}`);
        break;
      case "run.finished":
        if (event.status === "error") out.push("", `> Kjøringen feilet${event.error ? `: ${event.error}` : ""}`);
        else if (event.status === "stopped") out.push("", "> Stoppet");
        break;
      default:
        break;
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function markdownFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "chat"}.md`;
}

// Fetches the whole log, not only what is loaded, and hands the browser a .md file.
export async function exportThread(threadId: string): Promise<void> {
  const thread = app.threads[threadId];
  if (!thread) return;
  try {
    const events: ThreadEventEnvelope[] = [];
    for (let after = 0; ; ) {
      const page = await get<ThreadEventEnvelope[]>(`/api/threads/${encodeURIComponent(threadId)}/events?after=${after}&limit=${PAGE}`);
      events.push(...page);
      if (page.length < PAGE) break;
      after = page.at(-1)!.seq;
    }
    const url = URL.createObjectURL(new Blob([threadMarkdown(thread, events)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = markdownFileName(thread.title);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`Lastet ned ${link.download}.`, "info");
  } catch (err) {
    report(err);
  }
}

// Temporary chats

// Starts a chat that is not kept, in the focused pane.
export async function startTemporaryChat(): Promise<void> {
  try {
    const thread = await post<Thread>("/api/threads/temporary", {});
    await openThread(thread);
  } catch (err) {
    report(err);
  }
}

const CLOSE_GRACE_MS = 1500;

// Still open somewhere: in a pane on screen, in a pane of a grid that is only out of view (Kode,
// Innstillinger, the profile page or the Artifacts room is showing), or in a window of its own.
function stillOpen(id: string, scope: string): boolean {
  if (document.querySelector(`[data-thread-id="${CSS.escape(id)}"]`)) return true;
  const grid = peekGrid(scope);
  if (grid?.panes().some((pane) => pane.threadId() === id)) return true;
  if (grid?.detached().some((d) => d.threadId === id)) return true;
  return openWindows().has(id);
}

// Closed for real: the pane was closed or got another thread. A moment later, so moving it between
// panes or loading it again does not count as closing it. Going to Kode and back does not close it.
// A run is stopped first.
function dropTemporary(id: string): void {
  const thread = app.threads[id];
  if (!thread?.temporary || stillOpen(id, scopeOf(thread))) return;
  if (thread.running) {
    void post(`/api/threads/${encodeURIComponent(id)}/stop`).catch(() => undefined);
    setTimeout(() => dropTemporary(id), CLOSE_GRACE_MS);
    return;
  }
  void api("DELETE", `/api/threads/${encodeURIComponent(id)}`).catch(() => undefined);
}

// Called by the views that show a thread. When the one they show is temporary and they stop
// showing it, it is deleted unless another pane still has it.
export function trackTemporary(id: () => string | null | undefined): void {
  createEffect(() => {
    const current = id();
    if (!current || !app.threads[current]?.temporary) return;
    onCleanup(() => setTimeout(() => dropTemporary(current), CLOSE_GRACE_MS));
  });
}
