// The conversation. The scroller is a column-reverse flex box, which gives three things without a
// line of scroll code: it opens at the bottom on the first frame, it stays pinned there while text
// grows, and loading older messages above does not move what is on screen. Nothing listens to
// scroll events. Position is read by an IntersectionObserver.
import { createEffect, createMemo, createSelector, createSignal, createUniqueId, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { frameBudget } from "../lib/frame";
import { motionOff } from "./Motion";
import { observeResize } from "../lib/resize";
import { handleCopyClick, shellCommand } from "../markdown/render";
import type { Chunk, Row, TextRow, ThreadModel, UserRow } from "../state/thread-model";
import { IconArrowDown, IconBranch, IconCheck, IconClock, IconClose } from "./icons";
import { ChatTools, confirmScript, ConversationSearch, exportThread, trackTemporary, type ChatToolsValue } from "./ChatTools";
import { ChapterOf, ForkDivider, ForkStart, NowLine, RetryLine, RowThread, RowView, Selecting, UserRowRegistry } from "./rows";
import { forkSource, forkSourceTitle, openForkSource } from "../state/fork";
import { app, modelName, report, toast } from "../state/app";
import { patch, post } from "../lib/api";
import { openThread } from "../state/navigate";
import { registerJumper } from "../state/message-jump";
import { confirmDialog, promptDialog } from "./dialogs";
import type { Thread } from "../../../shared/protocol";
import { ResponseSelection } from "./ResponseSelection";

// The pinned summary jumps to a chapter in the conversation of its pane (state/message-jump.ts).
export { jumpToMessage } from "../state/message-jump";

const MAX_TICKS = 80;
const MIN_TIMELINE_MARKS = 4;

// Markdown as plain text, for Kopier som tekst: the words without the marks around them.
export function plainText(markdown: string): string {
  return markdown
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .trim();
}

function shorten(text: string, max: number): string {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

// One mark in the timeline: a message of yours, or the start of the model's answer to it.
interface Mark {
  kind: "user" | "answer";
  row: UserRow | TextRow;
  question: UserRow; // the question the mark belongs to, for what is in view
  answer?: TextRow; // the latest answer text in this turn, for the paired preview
  n: number; // which question, from 1
}

// Kode's quiet left-edge timeline: one tick per question and answer. Hover and keyboard focus
// show the question with its answer; clicking still jumps to the individual message.
function Timeline(props: { marks: Mark[]; current: string | null; jump: (row: Row) => void; chapter: (row: UserRow) => string | undefined }) {
  const [hover, setHover] = createSignal<{ key: string; top: number } | null>(null);
  const tooltipId = createUniqueId();
  const hovered = createMemo(() => {
    const shown = hover();
    const mark = shown && props.marks.find((mark) => mark.row.key === shown.key);
    return shown && mark ? { ...shown, mark } : null;
  });
  const buckets = createMemo(() => {
    const marks = props.marks;
    if (marks.length <= MAX_TICKS) return marks.map((mark) => [mark]);
    // A long thread: the questions alone, in groups, so the line keeps its rhythm.
    const users = marks.filter((m) => m.kind === "user");
    const size = Math.ceil(users.length / MAX_TICKS);
    const out: Mark[][] = [];
    for (let i = 0; i < users.length; i += size) out.push(users.slice(i, i + size));
    return out;
  });
  const currentIndex = createMemo(() => buckets().findIndex((bucket) => bucket[0].kind === "user" && bucket.some((m) => m.question.key === props.current)));
  // Counted once per change of the marks. Each mark used to count them itself, twice, every time the
  // mark in view changed: some 800 000 steps per change in a thread of 5 000 messages.
  const questions = createMemo(() => props.marks.reduce((n, m) => n + (m.kind === "user" ? 1 : 0), 0));
  const answerText = (mark: Mark) => {
    mark.answer?.rev(); // The open preview refreshes when the answer completes.
    return shorten(mark.answer?.text ?? "", 360) || "Venter på svar …";
  };
  return (
    <nav
      class="minimap"
      aria-label="Tidslinje"
      data-testid="minimap"
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => { if (e.key === "Escape") setHover(null); }}
    >
      <For each={buckets()}>
        {(bucket, index) => {
          const mark = bucket[0];
          // Not «melding» in the name: tests and assistive tech find the field by «Melding».
          const label = () => (mark.kind === "user" ? `Spørsmål ${mark.n} av ${questions()}` : "Svar");
          return (
            <button
              type="button"
              class="minimap-tick"
              data-kind={mark.kind}
              classList={{ current: index() === currentIndex(), chapter: mark.kind === "user" && bucket.some((m) => m.kind === "user" && props.chapter(m.row as UserRow)) }}
              title={mark.kind === "user" && props.chapter(mark.row as UserRow) ? `Gå til kapittelet «${props.chapter(mark.row as UserRow)}»` : "Gå til meldingen"}
              aria-label={`${label()}: ${shorten(mark.row.text, 60)}`}
              aria-current={index() === currentIndex() ? "true" : undefined}
              aria-describedby={hovered()?.mark.row.key === mark.row.key ? tooltipId : undefined}
              onPointerEnter={(e) => setHover({ key: mark.row.key, top: e.currentTarget.offsetTop + e.currentTarget.offsetHeight / 2 })}
              onFocus={(e) => setHover({ key: mark.row.key, top: e.currentTarget.offsetTop + e.currentTarget.offsetHeight / 2 })}
              onBlur={() => setHover(null)}
              onClick={() => props.jump(mark.row)}
            />
          );
        }}
      </For>
      <Show when={hovered()} keyed>
        {(shown) => (
          <div id={tooltipId} class="minimap-card" role="tooltip" style={{ top: `${shown.top}px` }} data-testid="minimap-card">
            <Show when={props.chapter(shown.mark.question)}>{(name) => <div class="minimap-chapter">{name()}</div>}</Show>
            <div class="minimap-question">{shorten(shown.mark.question.text, 160) || "(vedlegg)"}</div>
            <div class="minimap-answer">{answerText(shown.mark)}</div>
          </div>
        )}
      </Show>
    </nav>
  );
}

class ChunkScheduler {
  private queue: Array<{ chunk: Chunk; order: number }> = [];
  private running = false;

  add(chunk: Chunk, order: number): void {
    if (this.queue.some((q) => q.chunk === chunk)) return;
    this.queue.push({ chunk, order });
    this.queue.sort((a, b) => b.order - a.order);
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.run());
    }
  }

  drop(chunk: Chunk): void {
    this.queue = this.queue.filter((q) => q.chunk !== chunk);
  }

  private run(): void {
    if (!this.queue.length) {
      this.running = false;
      return;
    }
    const start = performance.now();
    // At least one per frame, and more only while they fit, so scrolling never waits for this.
    const budget = frameBudget();
    do this.queue.shift()!.chunk.setNear(true);
    while (this.queue.length && performance.now() - start < budget);
    if (this.queue.length) requestAnimationFrame(() => this.run());
    else this.running = false;
  }
}

function ChunkView(props: { chunk: Chunk; observe: (element: HTMLElement, chunk: Chunk) => () => void; onThread: (id: string) => void }) {
  const { chunk } = props;
  let element!: HTMLElement;
  onMount(() => onCleanup(props.observe(element, chunk)));

  // The measured height stands in for the content when the chunk is dropped.
  createEffect(() => {
    if (!chunk.near()) return;
    const stop = observeResize(element, (entry) => {
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (height > 0) chunk.height = height;
    });
    onCleanup(stop);
  });

  return (
    <section ref={element} class="chunk" style={chunk.near() ? undefined : `height:${chunk.height}px`}>
      <Show when={chunk.near()}>
        <For each={chunk.rows()}>{(row: Row) => <RowView row={row} onThread={props.onThread} />}</For>
      </Show>
    </section>
  );
}

// Chat: search and export live in the pane's top line, which calls these.
export interface ConversationTools {
  threadId: string;
  search: () => void;
  retryLast: () => Promise<void>;
  exportMarkdown: () => void;
}

export function Conversation(props: { model: ThreadModel; onThread: (id: string) => void; jump?: (scrollToBottom: () => void) => void; tools?: (tools: ConversationTools) => () => void }) {
  const [atBottom, setAtBottom] = createSignal(true);
  let root!: HTMLDivElement;
  let scroller!: HTMLDivElement;
  let bottom!: HTMLDivElement;
  let top!: HTMLDivElement;
  const scheduler = new ChunkScheduler();
  const chunkOf = new WeakMap<Element, Chunk>();
  const chunkElement = new Map<Chunk, HTMLElement>();
  const userElements = new Map<string, HTMLElement>();
  const userState = new Map<string, "in" | "above" | "below">();
  const [current, setCurrent] = createSignal<string | null>(null);
  let userObserver: IntersectionObserver | undefined;

  // A thread of 5 000 rows rebuilds this
  // when a row is added, never per token or per scroll.
  const users = createMemo(() => props.model.chunks().flatMap((chunk) => chunk.rows().filter((row): row is UserRow => row.kind === "user")));
  // The timeline's marks: each question, and the first text of the answer after it. Built when rows
  // come, never per token: the text is read only when the card shows.
  const marks = createMemo(() => {
    const out: Mark[] = [];
    let question: UserRow | null = null;
    let questionMark: Mark | undefined;
    let answerMark: Mark | undefined;
    let n = 0;
    for (const chunk of props.model.chunks()) {
      for (const row of chunk.rows()) {
        if (row.kind === "user") {
          question = row;
          answerMark = undefined;
          questionMark = { kind: "user", row, question, n: ++n };
          out.push(questionMark);
        } else if (row.kind === "text" && question && questionMark) {
          questionMark.answer = row;
          if (!answerMark) {
            answerMark = { kind: "answer", row, question, n };
            out.push(answerMark);
          }
          answerMark.answer = row;
        }
      }
    }
    return out;
  });

  // Chapters by message key. Compared by content, so a thread change that leaves them alone
  // wakes no row.
  const chapters = createMemo(() => new Map((app.threads[props.model.id]?.chapters ?? []).map((c) => [c.messageId, c.title])), undefined, {
    equals: (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v),
  });
  const chapterOf = (key: string) => chapters().get(key);
  // A chapter on an answer marks the question before it in the map.
  const turnChapters = createMemo(() => {
    const out = new Map<string, string>();
    if (!chapters().size) return out;
    let question: string | null = null;
    for (const chunk of props.model.chunks()) {
      for (const row of chunk.rows()) {
        if (row.kind === "user") question = row.key;
        const name = chapters().get(row.key);
        if (name && question && !out.has(question)) out.set(question, name);
      }
    }
    return out;
  });

  // Round 13 (SPEC 27.1): in Kode, one line under the turn while it runs, with what the agent does
  // now. It also stays while subagents it started are still at work.
  const nowLine = createMemo(() => {
    const activity = props.model.activity();
    if (!props.model.code || !activity) return null;
    const agentsBusy = activity.tasks.some((t) => t.kind === "agent" && app.threads[t.threadId!]?.running);
    return activity.running || agentsBusy ? activity : null;
  });

  const rowByKey = (key: string): Row | undefined => {
    for (const chunk of props.model.chunks()) for (const row of chunk.rows()) if (row.key === key) return row;
    return undefined;
  };

  // Chat: edit a message in place, make the last answer again, search and export.
  const chat = !props.model.code;
  const thread = () => app.threads[props.model.id];
  const running = createMemo(() => thread()?.running ?? false);
  const [editing, setEditing] = createSignal<string | null>(null);
  const isEditing = createSelector(editing);
  // The last answer, the one that can be made again. Looked for when rows come or a run ends.
  const lastAnswer = createMemo(() => {
    if (!chat || running()) return null;
    const chunks = props.model.chunks();
    for (let c = chunks.length - 1; c >= 0; c--) {
      const rows = chunks[c].rows();
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].kind === "text") return rows[i].key;
        if (rows[i].kind === "user") return null;
      }
    }
    return null;
  });
  const isLastAnswer = createSelector(lastAnswer);
  // Round 14 (SPEC 30.3): the first message after the fork was made. The copied events keep their
  // own times, which are all older than the fork.
  const forkStart = createMemo(() => {
    const made = thread()?.forkedFrom ? thread()!.createdAt : null;
    if (made === null) return null;
    for (const chunk of props.model.chunks()) for (const row of chunk.rows()) if (row.kind === "user" && row.at >= made) return row.key;
    return null;
  });
  const isForkStart = createSelector(forkStart);
  const [regen, setRegen] = createSignal<{ key: string; left: number; bottom: number } | null>(null);
  const [searching, setSearching] = createSignal(false);
  let focusSearch: (() => void) | undefined;
  const openSearch = () => (searching() ? focusSearch?.() : setSearching(true));
  trackTemporary(() => props.model.id);

  // The server cuts the log back and sends the message again. The model is loaded again from the
  // thread.reset that follows, so nothing here has to undo rows.
  // One at a time: a second click while the first is on its way would only meet a busy thread.
  let rewinding: Promise<unknown> | null = null;
  // Kode: files are not rolled back, which the server wants confirmed with keepFiles.
  const rewind = (key: string, body: { text?: string; modelId?: string; latestOnly?: boolean } = {}) => {
    rewinding ??= post(`/api/threads/${props.model.id}/rewind`, { messageId: key, ...body, ...(chat ? {} : { keepFiles: true }) }).finally(() => (rewinding = null));
    return rewinding;
  };
  const retryLast = async () => {
    if (running() || rewinding) {
      toast("Vent til svaret er ferdig, eller stopp det først.", "info");
      return;
    }
    const key = lastAnswer();
    if (!key || !users().length) {
      toast("Det finnes ikke et svar å prøve på nytt.", "info");
      return;
    }
    const ok = await confirmDialog({ title: "Lag siste svar på nytt?", text: "Det siste svaret erstattes ved et nytt modellkall.", confirm: "Lag svaret på nytt" });
    if (!ok) return;
    if (!root.isConnected || lastAnswer() !== key || rewinding) {
      toast("Samtalen har endret seg. Skriv /retry igjen hvis du vil prøve det nye svaret på nytt.", "info");
      return;
    }
    await rewind(key, { latestOnly: true });
  };
  const unregisterTools = props.tools?.({ threadId: props.model.id, search: openSearch, retryLast, exportMarkdown: () => void exportThread(props.model.id) });
  if (unregisterTools) onCleanup(unregisterTools);
  // What goes when a message is sent again fades out first, calmly, so the cut is seen (SPEC 21.8).
  const fadeAfter = async (key: string): Promise<() => void> => {
    const rowEl = scroller.querySelector<HTMLElement>(`.row-user[data-key="${CSS.escape(key)}"]`);
    if (!rowEl || motionOff()) return () => {};
    const gone: HTMLElement[] = [];
    for (const el of scroller.querySelectorAll<HTMLElement>(".row, .msg-actions, .chapter-mark, .now-line")) {
      if (rowEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !rowEl.contains(el)) gone.push(el);
    }
    if (!gone.length) return () => {};
    const animations = gone.map((el) => el.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(4px)" }], { duration: 280, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }));
    await Promise.all(animations.map((a) => a.finished.catch(() => undefined)));
    return () => animations.forEach((animation) => animation.cancel());
  };
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const selecting = createMemo(() => selected().size > 0);
  let anchor: string | null = null;
  const chatTools: ChatToolsValue = {
    code: !chat,
    isEditing,
    isLastAnswer,
    saveEdit: async (key, text) => {
      try {
        // Kode with changed files: say first that they stay as they are. Esc cancels.
        if (!chat && props.model.changes().length) {
          const ok = await confirmDialog({
            title: "Sende meldingen på nytt?",
            text: "Svarene etter meldingen blir borte, men filene som er endret i prosjektet, rulles ikke tilbake. Bruk Angre i Endringer om du vil ha dem tilbake.",
            confirm: "Send på nytt",
          });
          if (!ok) return;
        }
        const restore = await fadeAfter(key);
        try { await rewind(key, { text }); }
        catch (err) { restore(); throw err; }
        setEditing(null);
      } catch (err) {
        report(err);
      }
    },
    cancelEdit: () => setEditing(null),
    isSelected: (key) => selected().has(key),
  };

  // Several messages, copied together (SPEC 21.8): in the order they stand, with who said what.
  const selectable = () => props.model.chunks().flatMap((chunk) => chunk.rows().filter((row): row is UserRow | TextRow => row.kind === "user" || (row.kind === "text" && !!(row as TextRow).text.trim())));
  const toggleSelect = (key: string, range: boolean) => {
    const next = new Set(selected());
    if (range && anchor && anchor !== key) {
      const keys = selectable().map((r) => r.key);
      const [a, b] = [keys.indexOf(anchor), keys.indexOf(key)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) for (const k of keys.slice(a, b + 1)) next.add(k);
    } else if (next.has(key)) next.delete(key);
    else next.add(key);
    anchor = key;
    setSelected(next);
  };
  const clearSelection = () => {
    anchor = null;
    setSelected(new Set<string>());
  };
  const copySelected = async (format: "text" | "markdown") => {
    const who = modelName(thread()?.modelId);
    const rows = selectable().filter((r) => selected().has(r.key));
    const parts = rows.map((r) => {
      const name = r.kind === "user" ? "Du" : who;
      return format === "markdown" ? `**${name}:**\n\n${r.text.trim()}` : `${name}:\n${plainText(r.text)}`;
    });
    try {
      await navigator.clipboard.writeText(parts.join(format === "markdown" ? "\n\n---\n\n" : "\n\n"));
      toast(rows.length === 1 ? "Kopierte 1 melding." : `Kopierte ${rows.length} meldinger.`, "info");
      clearSelection();
    } catch (err) {
      report(err);
    }
  };

  // Kjør on a shell block: the same way as ! in the message field, so approvals work as usual.
  const onRun = async (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(".md-run");
    if (!button || !scroller.contains(button)) return;
    const block = button.closest<HTMLElement>(".md-code");
    if (!block) return;
    if (block.closest(".md-live")) return toast("Vent til svaret er ferdig.", "info");
    if (!props.model.code || !thread()?.projectId) return;
    const command = shellCommand(block.querySelector("code")?.textContent ?? "");
    if (!command) return;
    if (command.includes("\n") && !(await confirmScript(command))) return;
    try {
      const sent = await post<{ queued: boolean }>(`/api/threads/${props.model.id}/messages`, { text: "", shell: command });
      if (sent.queued) toast("Kommandoen står i kø til turen er ferdig.", "info");
    } catch (err) {
      report(err);
    }
  };

  // Esc lets go of the selection, unless something on top wants it first.
  createEffect(() => {
    if (!selected().size) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], .popover")) return;
      clearSelection();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  // Shift+click on a message selects everything between it and the last one chosen.
  const onShiftClick = (event: MouseEvent) => {
    if (!event.shiftKey || (event.target as HTMLElement).closest("button, a, input, textarea, [data-msg-action]")) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>(".row-user[data-key], .msg[data-key], .row-text[data-message-id]");
    const key = row?.dataset.key ?? row?.dataset.messageId;
    if (!key || !selectable().some((r) => r.key === key)) return;
    window.getSelection()?.removeAllRanges();
    toggleSelect(key, true);
  };

  // One listener for the actions under every message.
  const onAction = async (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-msg-action]");
    if (!button || !scroller.contains(button)) return;
    const key = button.dataset.key!;
    const row = rowByKey(key);
    if (!row || (row.kind !== "user" && row.kind !== "text")) return;
    try {
      switch (button.dataset.msgAction) {
        case "select":
          toggleSelect(key, event.shiftKey);
          break;
        case "copy":
          await navigator.clipboard.writeText(row.text);
          button.dataset.done = "1";
          setTimeout(() => delete button.dataset.done, 1500);
          break;
        case "fork": {
          const copy = await post<Thread>(`/api/threads/${props.model.id}/fork`, { messageId: key });
          await openThread(copy);
          toast(`Laget «${copy.title}» med samtalen til og med meldingen.`, "info");
          break;
        }
        case "edit":
          if (running()) return toast("Vent til svaret er ferdig, eller stopp det først.", "info");
          setEditing(key);
          break;
        case "regenerate":
          if (rewinding) return;
          button.setAttribute("aria-disabled", "true");
          await rewind(key).finally(() => button.removeAttribute("aria-disabled"));
          break;
        case "regenerate-model": {
          if (regen()?.key === key) return setRegen(null);
          const box = root.getBoundingClientRect();
          const at = button.getBoundingClientRect();
          setRegen({ key, left: Math.max(8, Math.min(at.left - box.left, box.width - 268)), bottom: box.bottom - at.top + 4 });
          break;
        }
        case "chapter": {
          if (chapterOf(key)) {
            await patch(`/api/threads/${props.model.id}`, { chapter: { messageId: key, title: null } });
            break;
          }
          const start = row.text.replace(/\s+/g, " ").trim().slice(0, 60);
          const title = await promptDialog({ title: "Fest som kapittel", value: start || "Kapittel", confirm: "Fest" });
          if (title?.trim()) await patch(`/api/threads/${props.model.id}`, { chapter: { messageId: key, title } });
          break;
        }
      }
    } catch (err) {
      report(err);
    }
  };

  const pickCurrent = () => {
    const list = untrack(users);
    let below: number | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const state = userState.get(list[i].key);
      if (state === "in" || state === "above") return setCurrent(list[i].key);
      if (state === "below") below = i;
    }
    setCurrent(below !== null && below > 0 ? list[below - 1].key : (list.at(-1)?.key ?? null));
  };

  const registerUser = (element: HTMLElement, key: string) => {
    userElements.set(key, element);
    userObserver?.observe(element);
    return () => {
      userObserver?.unobserve(element);
      if (userElements.get(key) === element) userElements.delete(key);
      userState.delete(key);
    };
  };

  const jump = (row: Row) => {
    const chunk = props.model.chunks().find((c) => c.rows().includes(row));
    if (!chunk) return;
    chunkElement.get(chunk)?.scrollIntoView({ block: "start" });
    if (!chunk.near()) chunk.setNear(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = userElements.get(row.key) ?? scroller.querySelector(`[data-key="${CSS.escape(row.key)}"] > .row, [data-message-id="${CSS.escape(row.key)}"]`);
      element?.scrollIntoView({ block: "start" });
      if (row.kind === "user") setCurrent(row.key);
    }));
  };
  onCleanup(registerJumper(props.model.id, (key) => {
    const row = rowByKey(key);
    if (row) jump(row);
    return !!row;
  }));
  let chunkObserver: IntersectionObserver;
  const dropTimers = new Map<Chunk, ReturnType<typeof setTimeout>>();
  // Dropping a chunk removes some 400 elements and took 5–35 ms (npm run perf). Straight from the
  // timer it landed in the middle of the next scroll, so it waits for a gap of at least 10 ms
  // between frames, one chunk per gap. A chunk that comes back into view leaves the queue.
  const dropQueue = new Set<Chunk>();
  let dropIdle = 0;
  const dropWhenIdle = () => {
    if (dropIdle || !dropQueue.size) return;
    dropIdle = requestIdleCallback((deadline) => {
      dropIdle = 0;
      // The queue can be empty by now: a chunk that came back into view left it after this was asked for.
      const chunk = dropQueue.values().next().value;
      if (chunk && (deadline.timeRemaining() >= 10 || deadline.didTimeout)) {
        dropQueue.delete(chunk);
        chunk.setNear(false);
      }
      dropWhenIdle();
    }, { timeout: 10_000 });
  };

  const orderOf = (chunk: Chunk) => untrack(() => props.model.chunks().indexOf(chunk));

  const observeChunk = (element: HTMLElement, chunk: Chunk) => {
    chunkOf.set(element, chunk);
    chunkElement.set(chunk, element);
    chunkObserver.observe(element);
    return () => {
      chunkObserver.unobserve(element);
      if (chunkElement.get(chunk) === element) chunkElement.delete(chunk);
      scheduler.drop(chunk);
    };
  };

  onMount(() => {
    // Rows that registered before this ran are picked up here; later ones observe themselves.
    userObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.key;
        if (!key) continue;
        const root = entry.rootBounds;
        userState.set(key, entry.isIntersecting ? "in" : root && entry.boundingClientRect.bottom <= root.top ? "above" : "below");
      }
      pickCurrent();
    }, { root: scroller });
    for (const element of userElements.values()) userObserver.observe(element);

    chunkObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const chunk = chunkOf.get(entry.target);
        if (!chunk) continue;
        const timer = dropTimers.get(chunk);
        if (entry.isIntersecting) {
          if (timer) {
            clearTimeout(timer);
            dropTimers.delete(chunk);
          }
          dropQueue.delete(chunk);
          if (!chunk.near()) scheduler.add(chunk, orderOf(chunk));
        } else if (chunk.near() && chunk !== props.model.chunks().at(-1)) {
          scheduler.drop(chunk);
          // Later, in case the user turns around. Dropping is what keeps the DOM small.
          dropTimers.set(chunk, setTimeout(() => {
            dropTimers.delete(chunk);
            dropQueue.add(chunk);
            dropWhenIdle();
          }, 3000));
        }
      }
    }, { root: scroller, rootMargin: "150% 0px" });

    const edges = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === bottom) setAtBottom(entry.isIntersecting);
        else if (entry.isIntersecting) void props.model.loadOlder();
      }
    }, { root: scroller, rootMargin: "120% 0px 2px 0px" });
    edges.observe(bottom);
    edges.observe(top);

    // A page that loaded while the top is still in view needs the observer to look again.
    createEffect(() => {
      props.model.chunks();
      if (props.model.hasOlder()) {
        edges.unobserve(top);
        edges.observe(top);
      }
    });

    props.jump?.(() => (scroller.scrollTop = 0));
    scroller.addEventListener("click", handleCopyClick);
    scroller.addEventListener("click", onAction);
    scroller.addEventListener("click", onShiftClick);
    scroller.addEventListener("click", onRun);
    // Ctrl+F searches the conversation of the pane that has focus.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return;
      const pane = root.closest(".pane-inner") ?? root;
      const active = document.activeElement;
      if (!pane.contains(active) && !((!active || active === document.body) && pane.classList.contains("focused"))) return;
      event.preventDefault();
      openSearch();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      chunkObserver.disconnect();
      edges.disconnect();
      userObserver?.disconnect();
      for (const timer of dropTimers.values()) clearTimeout(timer);
      if (dropIdle) cancelIdleCallback(dropIdle);
      dropQueue.clear();
    });
  });

  createEffect(() => {
    if (!regen()) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".regen-menu") && !target.closest('[data-msg-action="regenerate-model"]')) setRegen(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRegen(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onEscape);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onEscape);
    });
  });

  return (
    <div class="conversation" ref={root} classList={{ "chat-conversation": chat, busy: running(), "can-run": props.model.code && !!thread()?.projectId, selecting: selecting() }}>
      <ResponseSelection root={() => root} thread={thread} selecting={selecting} />
      <Show when={selecting()}>
        <div
          class="select-bar"
          role="toolbar"
          aria-label="Utvalg"
          data-testid="select-bar"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              clearSelection();
            }
          }}
        >
          <span class="select-count">{selected().size === 1 ? "1 melding valgt" : `${selected().size} meldinger valgt`}</span>
          <button type="button" class="btn btn-small" onClick={() => void copySelected("text")}>Kopier som tekst</button>
          <button type="button" class="btn btn-small" onClick={() => void copySelected("markdown")}>Kopier som Markdown</button>
          <button type="button" class="icon-button" title="Fjern utvalget (Esc)" aria-label="Fjern utvalget" onClick={clearSelection}><IconClose size={14} /></button>
        </div>
      </Show>
      <Show when={searching()}>
        <ConversationSearch model={props.model} root={() => scroller} jump={jump} onClose={() => setSearching(false)} register={(focus) => (focusSearch = focus)} />
      </Show>
      <Show when={thread()?.temporary}>
        <div class="temp-banner" data-testid="temp-banner"><IconClock size={12} />Midlertidig chat. Vises ikke i historikken, og slettes når du lukker den.</div>
      </Show>
      <Show when={regen()} keyed>
        {(menu) => (
          <div class="popover regen-menu" role="menu" aria-label="Lag svaret på nytt med" style={{ left: `${menu.left}px`, bottom: `${menu.bottom}px` }} data-testid="regen-menu">
            <div class="menu-heading">Lag svaret på nytt med</div>
            <For each={app.models}>
              {(model) => {
                const current = () => (thread()?.modelId ?? app.settings.defaultModelId) === model.id;
                return (
                  <button
                    type="button"
                    role="menuitem"
                    class="menu-item"
                    title={current() ? `Samme modell: ${model.name}` : `Bytt chatten til ${model.name} og lag svaret på nytt`}
                    onClick={() => {
                      setRegen(null);
                      rewind(menu.key, current() ? {} : { modelId: model.id }).then(
                        () => !current() && toast(`Nytt svar fra ${modelName(model.id)}.`, "info"),
                        report,
                      );
                    }}
                  >
                    <span class="menu-name">{model.name}</span>
                    <span class="menu-check"><Show when={current()}><IconCheck size={14} /></Show></span>
                  </button>
                );
              }}
            </For>
          </div>
        )}
      </Show>
      <div class="scroller" ref={scroller} tabindex="-1" data-testid="scroller">
        <div class="scroll-list">
          <div ref={top} class="scroll-top" />
          <Show when={thread()?.forkedFrom && !props.model.hasOlder() ? thread() : undefined}>{(t) => <ForkBanner thread={t()} />}</Show>
          <ForkStart.Provider value={isForkStart}>
          <RowThread.Provider value={thread}>
          <UserRowRegistry.Provider value={registerUser}>
            <ChapterOf.Provider value={chapterOf}>
              <ChatTools.Provider value={chatTools}>
                <Selecting.Provider value={selecting}>
                  <For each={props.model.chunks()}>{(chunk) => <ChunkView chunk={chunk} observe={observeChunk} onThread={props.onThread} />}</For>
                </Selecting.Provider>
              </ChatTools.Provider>
            </ChapterOf.Provider>
          </UserRowRegistry.Provider>
          </RowThread.Provider>
          </ForkStart.Provider>
          <Show when={thread()?.forkedFrom && !forkStart() && props.model.chunks().length}><div class="row fork-end"><ForkDivider /></div></Show>
          <Show when={nowLine()}>{(activity) => <NowLine activity={activity()} onThread={props.onThread} />}</Show>
          <Show when={props.model.retry()} keyed>{(retry) => <RetryLine retry={retry} />}</Show>
          <div ref={bottom} class="scroll-bottom" />
        </div>
      </div>
      {/* From the fourth conversation message in Kode; tool and status rows do not count. */}
      <Show when={props.model.code && marks().length >= MIN_TIMELINE_MARKS}>
        <Timeline marks={marks()} current={current()} jump={jump} chapter={(row) => chapterOf(row.key) ?? turnChapters().get(row.key)} />
      </Show>
      <Show when={!atBottom()}>
        <button type="button" class="to-bottom" title="Til bunnen" aria-label="Til bunnen" onClick={() => (scroller.scrollTop = 0)}>
          <IconArrowDown />
        </button>
      </Show>
    </div>
  );
}

// Round 14 (SPEC 30.3): at the top of a fork, where it came from, with a link back to that thread
// (and to the message, when it was forked from one).
function ForkBanner(props: { thread: Thread }) {
  const origin = () => props.thread.forkedFrom!;
  const gone = () => !forkSource(props.thread);
  const what = () => {
    const from = origin().from;
    const copied = from === "message" ? "Samtalen til og med meldingen er kopiert herfra" : from === "last" ? "Den siste meldingen og svaret er kopiert herfra" : "Hele samtalen er kopiert herfra";
    return props.thread.mode === "code" && props.thread.projectId ? `${copied}. Filene i prosjektet er de samme.` : `${copied}.`;
  };
  return (
    <div class="fork-banner" data-testid="fork-banner">
      <span class="fork-banner-line">
        <IconBranch size={13} />
        <span>Gaffel av</span>
        <Show when={!gone()} fallback={<span class="fork-banner-gone" title="Tråden er slettet">{origin().title}</span>}>
          <button type="button" class="fork-banner-link" title={origin().messageId ? "Åpne tråden ved meldingen gaffelen kom fra" : "Åpne tråden gaffelen kom fra"} onClick={() => void openForkSource(props.thread)}>{forkSourceTitle(props.thread)}</button>
        </Show>
      </span>
      <span class="fork-banner-note">{what()}</span>
    </div>
  );
}
