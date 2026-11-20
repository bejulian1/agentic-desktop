// One component per row kind. A finished row renders once and has no reactive work left. A live
// row only reacts to its own rev signal.
import { createContext, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, useContext } from "solid-js";
import { cancelFrameTask, frameDeadline, onNextFrame } from "../lib/frame";
import { formatTokens } from "../lib/format";
import { post } from "../lib/api";
import { observeWhile, visibleSignal, whileVisible } from "../lib/visible";
import { motionOff } from "./Motion";
import { MarkdownStream, renderStatic } from "../markdown/stream";
import { disposeArtifactBoxes } from "../markdown/artifact-card";
import { app, report } from "../state/app";
import { formatElapsed, useClock } from "../state/clock";
import { peekPanelActions } from "../state/panel";
import { revertTurn } from "../state/project-actions";
import type {
  AgentsRow, ApprovalRow, ChangesRow, CompactedRow, HookRow, NoticeRow, UnsentRow, RetryState, Row, TextRow, ThinkingRow, UserRow, WorkRow,
} from "../state/thread-model";
import type { AnswerModel, ApprovalDecision, Attachment, Thread } from "../../../shared/protocol";
import {
  IconAgent, IconAt, IconBranch, IconChevron, IconChevronDown, IconClose, IconDiff, IconFile, IconFolder,
  IconEye, IconSend, IconImage, IconPencil, IconThought, IconUndo, IconWarn, IconCopy, IconBookmark, IconReload, IconCheck, IconCpu,
} from "./icons";
import { ChatTools, UserEdit } from "./ChatTools";
import { enter, seconds, StepsView, SummaryView, ToolView } from "./steps";
import { stepSentence } from "./step-words";
import { FileChangeCounts } from "./FileChangeCounts";
import { AnswerModelButton, answerModelInfo } from "./AnswerModel";
import "../styles/hooks.css";
import { UserQuestionSummary } from "./UserQuestion";
export { NowLine } from "./steps";

// The conversation's timeline map learns where the user messages are from this. Rows register
// when they mount and go when they unmount, so it never has to search the DOM.
export const UserRowRegistry = createContext<(element: HTMLElement, key: string) => () => void>();
// The chapter name of a message, from the thread. One memo in the conversation feeds every row.
// Round 10: the thread the rows belong to, for the thinking card in Chat (its model and mode).
export const RowThread = createContext<() => Thread | undefined>(() => undefined);
export const ChapterOf = createContext<(key: string) => string | undefined>(() => undefined);
// Round 14 (SPEC 30.3): in a fork, the first message written after it was made, where a quiet line
// says that the fork starts.
export const ForkStart = createContext<(key: string) => boolean>(() => false);

export function ForkDivider() {
  return <div class="fork-divider" role="separator" aria-label="Gaffelen starter her" data-testid="fork-divider"><span><IconBranch size={11} />Gaffelen starter her</span></div>;
}


const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// One formatter per format, made once. toLocaleTimeString with options builds a new
// Intl.DateTimeFormat on every call, and every message calls these when it mounts: that was half
// of the script time when a chunk of a long thread mounted while scrolling. Same output.
const HH_MM = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const HH_MM_SS = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const DAY_MONTH = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric" });
const LONG_DAY = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// "14:32", "i går 14:32", "3. nov. 14:32", and the year when it is not this one.
export function shortTime(at: number, now = new Date()): string {
  const date = new Date(at);
  const time = HH_MM.format(date);
  if (sameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `i går ${time}`;
  const day = (date.getFullYear() === now.getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(date);
  return `${day} ${time}`;
}

// "tirsdag 4. november 2026 kl. 14:32:07".
export function fullTime(at: number): string {
  const date = new Date(at);
  return `${LONG_DAY.format(date)} kl. ${HH_MM_SS.format(date)}`;
}

// Chat: while messages are selected, the select box shows under every message.
export const Selecting = createContext<() => boolean>(() => false);

// The actions under a message are built the first time the message is hovered or the keyboard comes
// to them (or while messages are selected). Built under every message of a long thread, they were
// most of the DOM a chunk added while scrolling. Until then the toolbar is empty, with the height the
// buttons give it, and is itself the tab stop: focus there builds the buttons and moves on to the
// first one, or to the last one when Shift+Tab came from below, so Tab goes through them as before.
function useActions(): { built: () => boolean; build: (event?: FocusEvent) => void } {
  const selecting = useContext(Selecting);
  const [armed, setArmed] = createSignal(false);
  const built = () => armed() || selecting();
  const build = (event?: FocusEvent) => {
    if (!armed()) setArmed(true);
    const bar = event?.target as HTMLElement | undefined;
    if (!bar?.classList?.contains("msg-actions")) return;
    const buttons = bar.querySelectorAll<HTMLElement>("button");
    const from = event!.relatedTarget;
    const below = from instanceof Node && !!(bar.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING);
    (below ? buttons[buttons.length - 1] : buttons[0])?.focus();
  };
  return { built, build };
}

// Under every message, shown on hover and on focus by CSS. The buttons only carry data: one
// listener on the conversation handles them all, so there is nothing per row to set up.
function MessageActions(props: { rowKey: string; at: number; kind: "user" | "text"; built: () => boolean; model?: AnswerModel }) {
  return (
    <div class="msg-actions" role="toolbar" aria-label="Handlinger" tabindex={props.built() ? undefined : 0}>
      <Show when={props.built()}>
        <ActionButtons rowKey={props.rowKey} at={props.at} kind={props.kind} model={props.model} />
      </Show>
    </div>
  );
}

function ActionButtons(props: { rowKey: string; at: number; kind: "user" | "text"; model?: AnswerModel }) {
  const chapterOf = useContext(ChapterOf);
  const chat = useContext(ChatTools);
  const chapter = () => chapterOf(props.rowKey);
  const selected = () => chat?.isSelected(props.rowKey) ?? false;
  return (
    <>
      {/* Select (SPEC 21.8): several messages copied together. Shift+click selects a range. */}
      <Show when={chat}>
        <button
          type="button"
          class="msg-action msg-select"
          role="checkbox"
          aria-checked={selected()}
          data-msg-action="select"
          data-key={props.rowKey}
          title={selected() ? "Fjern fra utvalget" : "Velg meldingen. Shift+klikk velger alt mellom."}
          aria-label="Ta med i utvalget"
        >
          <span class="msg-check" aria-hidden="true"><IconCheck size={11} /></span>
        </button>
      </Show>
      <button type="button" class="msg-action" data-msg-action="copy" data-key={props.rowKey} title="Kopier som Markdown" aria-label="Kopier">
        <IconCopy size={14} /><span class="copy-ok" aria-hidden="true"><IconCheck size={14} /></span><span class="msg-done" aria-live="polite">Kopiert</span>
      </button>
      <Show when={chat && props.kind === "user"}>
        <button type="button" class="msg-action chat-only" data-msg-action="edit" data-key={props.rowKey} title={chat!.code ? "Rediger meldingen og send den på nytt. Filene rulles ikke tilbake." : "Rediger meldingen og send den på nytt"} aria-label="Rediger">
          <IconPencil size={14} />
        </button>
      </Show>
      <Show when={chat && props.kind === "text" && chat.isLastAnswer(props.rowKey)}>
        <span class="msg-regen chat-only">
          <button type="button" class="msg-action" data-msg-action="regenerate" data-key={props.rowKey} title="Lag svaret på nytt. Det gamle svaret erstattes." aria-label="Lag svaret på nytt">
            <IconReload size={14} />
          </button>
          <button type="button" class="msg-action msg-action-narrow" data-msg-action="regenerate-model" data-key={props.rowKey} title="Lag svaret på nytt med en annen modell" aria-label="Lag svaret på nytt med en annen modell" aria-haspopup="menu">
            <IconChevronDown size={12} />
          </button>
        </span>
      </Show>
      <button type="button" class="msg-action" data-msg-action="fork" data-key={props.rowKey} title="Gaffel herfra: en ny tråd med samtalen til og med denne meldingen" aria-label="Gaffel herfra">
        <IconBranch size={14} />
      </button>
      <button
        type="button"
        class="msg-action"
        classList={{ on: !!chapter() }}
        data-msg-action="chapter"
        data-key={props.rowKey}
        title={chapter() ? `Fjern kapittelet «${chapter()}»` : "Fest som kapittel: gi meldingen et navn i tidslinjen og sammendraget"}
        aria-label={chapter() ? "Fjern kapittel" : "Fest som kapittel"}
        aria-pressed={!!chapter()}
      >
        <IconBookmark size={14} />
      </button>
      <Show when={props.kind === "text"}><AnswerModelButton model={props.model} /></Show>
      <time class="msg-time" dateTime={new Date(props.at).toISOString()} title={fullTime(props.at)}>{shortTime(props.at)}</time>
    </>
  );
}

function ChapterMark(props: { rowKey: string }) {
  const chapterOf = useContext(ChapterOf);
  return (
    <Show when={chapterOf(props.rowKey)}>
      <div class="chapter-mark" data-testid="chapter-mark"><IconBookmark size={12} /><span>{chapterOf(props.rowKey)}</span></div>
    </Show>
  );
}

const HUGE_MESSAGE = 64 * 1024;
const HUGE_SHOWN = 32 * 1024;

export { imageUrl, showImage } from "./image-viewer";
import { imageUrl, showImage } from "./image-viewer";

export function AttachmentChip(props: { attachment: Attachment }) {
  return (
    <span class="chip" title={props.attachment.path ?? props.attachment.label}>
      {props.attachment.kind === "thread" ? <IconAt size={12} /> : props.attachment.kind === "dir" ? <IconFolder size={12} /> : props.attachment.kind === "image" ? <IconImage size={12} /> : <IconFile size={12} />}
      <span class="chip-text">{props.attachment.label}</span>
      <Show when={props.attachment.truncated}><span class="chip-note">utdrag</span></Show>
    </span>
  );
}

function UserView(props: { row: UserRow; onThread: (id: string) => void }) {
  const { row } = props;
  const register = useContext(UserRowRegistry);
  let element!: HTMLDivElement;
  onMount(() => {
    if (register) onCleanup(register(element, row.key));
  });
  const images = row.attachments?.filter((a) => a.kind === "image" && a.imageId) ?? [];
  const others = row.attachments?.filter((a) => a.kind !== "image") ?? [];
  const chat = useContext(ChatTools);
  const forkStart = useContext(ForkStart);
  const editing = () => chat?.isEditing(row.key) ?? false;
  const actions = useActions();
  const receipt = createMemo(() => (row.rev(), row.receipt));
  const code = useContext(RowThread);
  const receiptLabel = () => receipt() === "received" ? "Lest av modellen" : receipt() === "blocked" ? "Stoppet av hook" : receipt() === "unsent" ? "Ikke sendt til modellen" : "Ikke bekreftet lest";
  return (
    <div class="row row-user" data-row="user" data-key={row.key} data-enter={enter(row.at)} data-selected={chat?.isSelected(row.key) ? "" : undefined} ref={element} onPointerOver={() => actions.build()} onFocusIn={actions.build}>
      <Show when={forkStart(row.key)}><ForkDivider /></Show>
      <ChapterMark rowKey={row.key} />
      <Show when={images.length}>
        <div class="user-images" data-testid="user-images">
          <For each={images}>
            {(image) => (
              <button type="button" class="user-image" title={`${image.label}: vis i full størrelse`} aria-label={`Vis ${image.label}`} onClick={() => showImage(imageUrl(image.imageId!), image.label)}>
                <img src={imageUrl(image.imageId!)} alt={image.label} loading="lazy" decoding="async" />
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={row.from}>
        <button type="button" class="from-label" onClick={() => props.onThread(row.from!.threadId)}>
          <IconBranch size={12} /> Fra tråden {row.from!.title}
        </button>
      </Show>
      <Show
        when={!editing()}
        fallback={<UserEdit text={row.text} hasAttachments={!!row.attachments?.length} code={chat!.code} onSave={(text) => chat!.saveEdit(row.key, text)} onCancel={() => chat!.cancelEdit()} />}
      >
        <div class="user-bubble">
          <Show when={others.length}>
            <div class="chips">
              <For each={others}>{(a) => <AttachmentChip attachment={a} />}</For>
            </div>
          </Show>
          <div class="user-text">{row.text}</div>
        </div>
        <Show when={code()?.mode === "code" && receipt()}>
          <span class="message-receipt" data-testid="message-receipt" data-status={receipt()} role="status" aria-label={receiptLabel()} title={receipt() === "received" ? `Modellen har begynt å svare med meldingen i konteksten. ${row.receivedAt ? fullTime(row.receivedAt) : ""}` : receiptLabel()}>
            <Show when={receipt() === "received"} fallback={<IconSend size={12}/>}><IconEye size={12}/></Show>
            <span>{receiptLabel()}</span>
          </span>
        </Show>
        <MessageActions rowKey={row.key} at={row.at} kind="user" built={actions.built} />
      </Show>
    </div>
  );
}

function liveText(row: TextRow, root: HTMLElement): void {
  const stream = new MarkdownStream(root);
  stream.push(row.text);
  row.pending = "";
  const flush = () => {
    if (row.pending) {
      stream.push(row.pending);
      row.pending = "";
    }
    if (stream.flush(frameDeadline())) onNextFrame(flush);
  };
  row.onDelta = () => onNextFrame(flush);
  onNextFrame(flush);
  createEffect(on(row.rev, () => {
    if (!row.done) return;
    row.onDelta = undefined;
    stream.finish();
    onNextFrame(flush);
  }));
  onCleanup(() => {
    row.onDelta = undefined;
    row.pending = "";
    cancelFrameTask(flush);
  });
}

// A finished message of a size that would block a frame goes in over several frames.
function hugeText(row: TextRow, root: HTMLElement): void {
  const stream = new MarkdownStream(root, false);
  stream.push(row.text);
  stream.finish();
  const step = () => {
    if (stream.flush(frameDeadline())) onNextFrame(step);
  };
  onNextFrame(step);
  onCleanup(() => cancelFrameTask(step));
}

// Where to start showing the end of a long text: a blank line, and not inside a code fence.
function tailStart(text: string): number {
  let at = text.indexOf("\n\n", text.length - HUGE_SHOWN);
  while (at !== -1) {
    const fences = text.slice(at).match(/^ {0,3}(```|~~~)/gm)?.length ?? 0;
    if (fences % 2 === 0) return at + 2;
    at = text.indexOf("\n\n", at + 2);
  }
  return text.length - HUGE_SHOWN;
}

function formatSize(chars: number): string {
  return chars < 1024 * 1024 ? `${Math.round(chars / 1024)} kB` : `${(chars / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

// A message of megabytes costs seconds of DOM work to show again and is rarely read in full, so
// only its end renders until someone asks for the rest.
function LongText(props: { row: TextRow }) {
  const { row } = props;
  const [full, setFull] = createSignal(false);
  const root = document.createElement("div");
  root.className = "row-text-body";
  renderStatic(root, row.text.slice(tailStart(row.text)));
  onCleanup(() => disposeArtifactBoxes(root));
  return (
    <div class="row row-text md" data-row="text" data-message-id={row.key}>
      <Show when={!full()}>
        <button type="button" class="btn btn-small long-text" onClick={() => {
          setFull(true);
          root.replaceChildren();
          hugeText(row, root);
        }}>
          Meldingen er {formatSize(row.text.length)}. Vis hele.
        </button>
      </Show>
      {root}
    </div>
  );
}

// The text with its chapter mark above and its actions under, once it is complete. The wrapper is
// display: contents, so the row keeps its own box.
function TextView(props: { row: TextRow }) {
  const { row } = props;
  const chat = useContext(ChatTools);
  const done = createMemo(() => (row.rev(), row.done));
  // In a Kode run, the short texts between the steps are narration; only the answer at the end
  // gets the row of actions, so the run does not fill up with empty space under every line.
  const answer = createMemo(() => !row.work || row.work.lastText() === row);
  const actions = useActions();
  return (
    <div class="msg" data-key={row.key} data-selected={chat?.isSelected(row.key) ? "" : undefined} onPointerOver={() => actions.build()} onFocusIn={actions.build}>
      <ChapterMark rowKey={row.key} />
      <TextBody row={row} />
      <Show when={done() && answer()}><MessageActions rowKey={row.key} at={row.at} kind="text" built={actions.built} model={row.model} /></Show>
    </div>
  );
}

function TextBody(props: { row: TextRow }) {
  const { row } = props;
  if (row.done && row.text.length > HUGE_MESSAGE) return <LongText row={row} />;
  const root = document.createElement("div");
  root.className = "row row-text md";
  root.dataset.row = "text";
  root.dataset.messageId = row.key;
  if (enter(row.at) !== undefined) root.dataset.enter = "";
  onCleanup(() => disposeArtifactBoxes(root));
  if (row.done) renderStatic(root, row.text);
  else liveText(row, root);
  return root;
}


// Round 10 (SPEC 23.11): «Premium» thinking in Chat. A card with «Forespørsel til modell», one line
// of what the model is doing (the latest whole sentence of its summary, or a calm default), a
// progress line that fills slowly and levels out, since the model never says how far it has come,
// and Detaljer for the summary. When the answer comes the line fills, and the card settles: the
// model on top, and «Tenkte i 4m 12s» under it as the button that opens the summary. Only transform and opacity move, only while
// the card is on screen, and nothing moves with reduced motion.
const PREMIUM_DEFAULT = "Tenker gjennom forespørselen…";
const PROGRESS_TAU_S = 9; // fills to about two thirds in 9 s
const PROGRESS_CAP = 0.92;

function latestSentence(text: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  // A line is whole when a newline follows it, or it ends a sentence.
  const whole = lines.filter((line, i) => line && (i < lines.length - 1 || /[.!?…:]$/.test(line)));
  const last = whole.at(-1) ?? "";
  const sentences = last.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const pick = (sentences.at(-1) ?? last).replace(/[.:]$/, "…");
  return pick.length > 90 ? `${pick.slice(0, 88).trimEnd()}…` : pick;
}

function ThinkingCard(props: { row: ThinkingRow; model: string }) {
  const { row } = props;
  const [open, setOpen] = createSignal(false);
  const [visible, watch] = visibleSignal();
  const now = useClock();
  const done = createMemo(() => (row.rev(), row.durationMs !== null));
  // The line fills when the answer comes, and a moment later the card settles into one line.
  const [compact, setCompact] = createSignal(row.durationMs !== null);
  createEffect(on(done, (isDone) => {
    if (!isDone || compact()) return;
    const timer = setTimeout(() => setCompact(true), motionOff() ? 0 : 520);
    onCleanup(() => clearTimeout(timer));
  }));
  const status = createMemo(() => (row.rev(), latestSentence(row.text)) || PREMIUM_DEFAULT);
  // The fill only moves while the card is on screen; a tick a second, eased by a one-second transition.
  let shown = 0.04;
  const progress = createMemo(() => {
    if (done()) return 1;
    if (!visible()) return shown;
    const seconds = Math.max(0, (now() - row.at) / 1000);
    shown = Math.max(shown, Math.min(PROGRESS_CAP, 1 - Math.exp(-seconds / PROGRESS_TAU_S)));
    return shown;
  });
  const summary = () => app.settings.thinkingSummary !== false;
  return (
    <div class="row row-thinking row-premium" data-row="thinking" data-enter={enter(row.at)}>
      <div class="premium-card" classList={{ done: compact(), finishing: done() && !compact(), open: open() }} ref={watch} data-testid="thinking-card" role="group" aria-label={`Forespørsel til ${props.model}`}>
        <div class="premium-main">
          <div class="premium-title">Forespørsel til <span class="premium-model">{props.model}</span></div>
          <Show
            when={!compact()}
            fallback={
              <button type="button" class="premium-meta" aria-expanded={open()} disabled={!summary()} title={summary() ? "Vis tenkesammendraget" : "Tenkesammendraget er slått av i Innstillinger"} onClick={() => setOpen(!open())}>
                <IconThought size={14} />
                <span>{seconds(row.durationMs) ? `Tenkte i ${formatElapsed(row.durationMs!)}` : "Tenkte et øyeblikk"}</span>
                <Show when={summary()}><span class="fold-chevron" classList={{ open: open() }}><IconChevron size={12} /></span></Show>
              </button>
            }
          >
            <div class="premium-status" aria-live="polite">
              <IconThought size={14} />
              <Show when={status()} keyed>{(line) => <span class="premium-line status-text shimmer" ref={whileVisible}>{line}</span>}</Show>
            </div>
            <div class="premium-progress" role="progressbar" aria-label="Tenker" aria-valuetext="Modellen tenker">
              <span class="premium-fill" style={{ transform: `scaleX(${progress()})` }} />
            </div>
          </Show>
        </div>
        {/* While it works: Detaljer. Done, the line «Tenkte i …» is the button (SPEC 23.11). */}
        <Show when={!compact()}>
          <button type="button" class="btn btn-small premium-details" aria-expanded={open()} disabled={!summary()} title={summary() ? undefined : "Tenkesammendraget er slått av i Innstillinger"} onClick={() => setOpen(!open())}>Detaljer</button>
        </Show>
      </div>
      <Show when={open() && summary()}>
        <div class="thinking-text premium-text">{(row.rev(), row.text)}</div>
      </Show>
    </div>
  );
}

function ThinkingView(props: { row: ThinkingRow }) {
  const { row } = props;
  const thread = useContext(RowThread);
  const premium = () => app.settings.thinkingView === "premium" && thread()?.mode !== "code";
  return (
    <Show when={premium()} fallback={<ThinkingFold row={row} />}>
      <ThinkingCard row={row} model={answerModelInfo(row.model).name} />
    </Show>
  );
}

function ThinkingFold(props: { row: ThinkingRow }) {
  const { row } = props;
  const [open, setOpen] = createSignal(false);
  const label = createMemo(() => {
    row.rev();
    if (row.durationMs === null) return "Tenker…";
    return seconds(row.durationMs) ? `Tenkte i ${seconds(row.durationMs)}` : "Tenkte et øyeblikk";
  });
  const summary = () => app.settings.thinkingSummary !== false;
  return (
    <div class="row row-thinking" data-row="thinking" data-enter={enter(row.at)}>
      <button type="button" class="fold" aria-expanded={open()} disabled={!summary()} onClick={() => setOpen(!open())}>
        <Show when={summary()}><span class="fold-chevron" classList={{ open: open() }}><IconChevron size={12} /></span></Show>
        <IconThought size={14} />
        <span class="status-text" classList={{ shimmer: (row.rev(), row.durationMs === null) }} ref={observeWhile(() => (row.rev(), row.durationMs === null))}>{label()}</span>
      </button>
      <Show when={open() && summary()}>
        <div class="thinking-text">{(row.rev(), row.text)}</div>
      </Show>
    </div>
  );
}

function LiveElapsed(props: { since: number }) {
  const now = useClock();
  return <>{formatElapsed(now() - props.since)}</>;
}

// "Jobbet i 14m 34s" over a finished turn, which folds it. While the turn runs, the now-line under
// it says what goes on and for how long (round 13, SPEC 27.1), so the head stays away until then.
function WorkView(props: { row: WorkRow }) {
  const { row } = props;
  const ended = createMemo(() => (row.rev(), row.endedAt));
  return (
    <Show when={row.steps() > 0 && ended() !== null}>
      <div class="row row-work" data-row="work">
        <button type="button" class="work-head" aria-expanded={!row.collapsed()} title={row.collapsed() ? "Vis stegene i turen" : "Fold sammen stegene i turen"} onClick={() => row.setCollapsed(!row.collapsed())}>
          <span class="work-label status-text">{ended()! - row.startedAt < 1000 ? "Jobbet i under ett sekund" : `Jobbet i ${formatElapsed(ended()! - row.startedAt)}`}</span>
          <span class="work-chevron" classList={{ open: !row.collapsed() }}><IconChevron size={12} /></span>
        </button>
      </div>
    </Show>
  );
}

const DECISIONS: Record<ApprovalDecision, string> = { allow: "Tillatt", "allow-always": "Tillatt alltid", deny: "Avslått" };

// The server sends the tool input as JSON. What the user decides on is what is inside it.
function approvalText(detail: string): string {
  try {
    const input = JSON.parse(detail);
    if (typeof input !== "object" || input === null) return detail;
    if (typeof input.command === "string") return `$ ${input.command}`;
    if (typeof input.content === "string") return input.content;
    if (typeof input.old_string === "string") return `- ${input.old_string}\n+ ${input.new_string ?? ""}`;
    return JSON.stringify(input, null, 2);
  } catch {
    return detail;
  }
}

type DiffLine = { kind: "add" | "del"; text: string };

interface ApprovalAsk {
  verb: string; // "Vil skrive", "Vil endre", "Vil kjøre en kommando"
  target?: string; // the file or the address, in bold
  meta?: string; // "26 linjer", "+3 −1"
  lines?: DiffLine[];
  command?: string;
  text?: string; // anything else, as it came
  note?: string; // why it asks, when the server says so (.env, a hook)
}

const textLines = (text: string) => {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
};

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

// The approval in the words of the app: what the agent wants to do, to what, and the change itself.
// Titles the server wrote as a sentence (a loop, a new skill) stay as they are.
export function describeApproval(row: Pick<ApprovalRow, "title" | "detail" | "tool" | "input">): ApprovalAsk {
  const tool = row.tool;
  const input = (typeof row.input === "object" && row.input ? row.input : {}) as Record<string, unknown>;
  if (!tool || !row.title.startsWith(`${tool}:`)) return { verb: row.title, text: row.detail ? approvalText(row.detail) : undefined };
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const note = row.detail && !isJson(row.detail) && !(tool === "run_command" && str(input.command).startsWith(row.detail.slice(0, 200))) ? row.detail : undefined;
  switch (tool) {
    case "write_file": {
      const lines = textLines(str(input.content));
      return { verb: "Vil skrive", target: str(input.path), meta: lines.length === 1 ? "1 linje" : `${lines.length} linjer`, lines: lines.map((text) => ({ kind: "add", text })), note };
    }
    case "edit_file": {
      const del = str(input.old_string) ? textLines(str(input.old_string)) : [];
      const add = str(input.new_string) ? textLines(str(input.new_string)) : [];
      return {
        verb: "Vil endre",
        target: str(input.path),
        meta: `+${add.length} −${del.length}`,
        lines: [...del.map((text) => ({ kind: "del" as const, text })), ...add.map((text) => ({ kind: "add" as const, text }))],
        note,
      };
    }
    case "run_command":
      return { verb: "Vil kjøre en kommando", command: str(input.command) || row.detail, note };
    case "browser_navigate":
      return { verb: "Vil åpne", target: str(input.url), meta: "i nettleseren", note };
    default: {
      const label = stepSentence({ tool, summary: row.title.slice(tool.length + 1).trim() });
      return { verb: `Vil gjøre dette: ${label[0].toLowerCase()}${label.slice(1)}`, text: note ?? (row.detail ? approvalText(row.detail) : undefined) };
    }
  }
}

// The words for the line in the conversation once it is answered: "index.html" or the sentence.
function approvalSubject(row: ApprovalRow): string {
  const ask = describeApproval(row);
  if (ask.command) return ask.command;
  return ask.target ? `${ask.verb.replace(/^Vil /, "").replace(/^./, (c) => c.toUpperCase())} ${ask.target}` : ask.verb;
}

const SHOWN_LINES = 8;
const MAX_LINES = 400;

function splitTarget(path: string): [string, string] {
  const cut = path.lastIndexOf("/");
  return cut === -1 || /^[a-z]+:\/\//i.test(path) ? ["", path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
}

// The card itself sits above the message field (see Pane). In the conversation nothing stands for
// it while it waits: the step has a small mark, and the card is the one place to answer.
export function ApprovalCard(props: { row: ApprovalRow }) {
  const { row } = props;
  const [busy, setBusy] = createSignal(false);
  const [all, setAll] = createSignal(false);
  const ask = describeApproval(row);
  const lines = ask.lines?.slice(0, MAX_LINES) ?? [];
  const hidden = (ask.lines?.length ?? 0) - lines.length;
  let card!: HTMLDivElement;
  let allow!: HTMLButtonElement;
  let returnTo: HTMLElement | null = null;
  const answer = async (decision: ApprovalDecision) => {
    if (busy()) return;
    setBusy(true);
    const hadFocus = card.contains(document.activeElement);
    try {
      await post(`/api/approvals/${row.approvalId}`, { decision });
      if (hadFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    } catch (err) {
      report(err);
      setBusy(false);
    }
  };
  // Asked while the message field of this pane is empty and has the focus: the card takes it, so
  // Enter allows and Esc says no, like in a terminal agent. With text in the field, nothing moves.
  onMount(() => {
    const field = card.closest(".pane-inner")?.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (field && document.activeElement === field && !field.value) {
      returnTo = field;
      allow.focus({ preventScroll: true });
    }
  });
  const [dir, name] = splitTarget(ask.target ?? "");
  return (
    <div
      class="approval-card"
      data-row="approval"
      role="group"
      aria-label="Godkjenning"
      ref={card}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || busy()) return;
        e.preventDefault();
        e.stopPropagation();
        void answer("deny");
      }}
    >
      <div class="approval-title">
        <IconWarn size={15} />
        <span class="approval-what">
          {ask.verb}
          <Show when={ask.target}>{" "}<span class="approval-target" title={ask.target}><span class="approval-dir">{dir}</span><strong>{name}</strong></span></Show>
        </span>
        <Show when={ask.meta}><span class="approval-meta">{ask.meta}</span></Show>
      </div>
      <Show when={ask.note}><p class="approval-note">{ask.note}</p></Show>
      <Show when={ask.command}><pre class="approval-command">{ask.command}</pre></Show>
      <Show when={lines.length}>
        <div class="approval-diff" classList={{ open: all() }} data-testid="approval-diff">
          <pre>{lines.map((line) => <span class={`diff-line ${line.kind}`}>{line.kind === "add" ? "+ " : "− "}{line.text}{"\n"}</span>)}{hidden > 0 ? `… ${hidden} linjer til` : ""}</pre>
        </div>
        <Show when={lines.length > SHOWN_LINES}>
          <button type="button" class="approval-more" aria-expanded={all()} onClick={() => setAll(!all())}>{all() ? "Vis mindre" : `Vis alt (${ask.lines!.length} linjer)`}</button>
        </Show>
      </Show>
      <Show when={ask.text}><pre class="approval-detail">{ask.text}</pre></Show>
      <div class="approval-actions">
        <button type="button" class="btn" disabled={busy()} onClick={() => void answer("deny")}>Avslå<kbd class="approval-key" aria-hidden="true">Esc</kbd></button>
        <span class="approval-spacer" />
        <Show when={row.canAllowAlways}>
          <button type="button" class="btn" disabled={busy()} onClick={() => void answer("allow-always")}>Tillat alltid</button>
        </Show>
        <button type="button" class="btn btn-primary" disabled={busy()} ref={allow} onClick={() => void answer("allow")}>{row.title.startsWith("Slå på mods")?"Slå på":"Tillat"}<kbd class="approval-key" aria-hidden="true">Enter</kbd></button>
      </div>
    </div>
  );
}

function ApprovalView(props: { row: ApprovalRow }) {
  const { row } = props;
  const decision = createMemo(() => (row.rev(), row.decision));
  const closed = createMemo(() => (row.rev(), row.closed));
  return (
    // Waiting: the card above the field is enough. After a plain yes, the tool row says what happened.
    <Show when={(decision() !== null || closed()) && decision() !== "allow"}>
      <div class="row row-decided" data-row="approval-done">
        <span>{decision() ? DECISIONS[decision()!] : "Ikke besvart"}</span>
        <span class="decided-title">{approvalSubject(row)}</span>
      </div>
    </Show>
  );
}

const SHOWN_FILES = 3;

function splitPath(path: string): [string, string] {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? ["", path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
}

// "Endret 9 filer +109 −24", with Angre, Vis endringer and the files under.
function ChangesView(props: { row: ChangesRow }) {
  const { row } = props;
  const reverted = createMemo(() => (row.rev(), row.reverted));
  const [all, setAll] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const files = createMemo(() => (row.rev(), row.files));
  const totals = createMemo(() => ({
    additions: files().reduce((n, f) => n + (f.binary ? 0 : f.additions), 0),
    deletions: files().reduce((n, f) => n + (f.binary ? 0 : f.deletions), 0),
    countsExact: files().every((f) => f.binary || f.countsExact === true),
  }));
  const shown = () => (all() ? files() : files().slice(0, SHOWN_FILES));
  const show = () => peekPanelActions()?.showTurn(row.turnId);
  const undo = async () => {
    setBusy(true);
    await revertTurn(row.turnId);
    setBusy(false);
  };
  return (
    <div class="row row-changes" data-row="changes">
      <div class="changes-card" classList={{ reverted: reverted() }} data-testid="changes-card" data-turn-id={row.turnId}>
        <div class="changes-head">
          <span class="changes-icon"><IconDiff size={16} /></span>
          <span class="changes-title">
            <span>{files().length === 1 ? "Endret 1 fil" : `Endret ${files().length} filer`}</span>
            <Show when={files().some((file) => !file.binary)}><span class="changes-totals"><FileChangeCounts file={totals()} title={totals().countsExact ? "Linjetall for tekstfilene i denne turen" : "Anslåtte linjetall for tekstfilene i denne turen"} /></span></Show>
          </span>
          <Show when={reverted()} fallback={
            <button type="button" class="btn btn-small btn-ghost" disabled={busy()} title="Angre filendringene fra denne turen" onClick={() => void undo()}>Angre<IconUndo size={13} /></button>
          }>
            <span class="changes-reverted">Angret</span>
          </Show>
          <button type="button" class="btn btn-small" onClick={show}>Vis endringer</button>
        </div>
        <Show when={files().some((file) => file.overlapping)}><p class="changes-note">Overlapper annet arbeid. Angre ber om bekreftelse.</p></Show>
        <div class="changes-files">
          <For each={shown()}>
            {(file) => {
              const [dir, name] = splitPath(file.path);
              return (
                <button type="button" class="changes-file" title={file.path} onClick={show}>
                  <span class="changes-path"><span class="changes-dir">{dir}</span><span class="changes-name">{name}</span></span>
                  <FileChangeCounts file={file} />
                </button>
              );
            }}
          </For>
          <Show when={files().length > SHOWN_FILES}>
            <button type="button" class="changes-more" aria-expanded={all()} onClick={() => setAll(!all())}>
              {all() ? "Vis færre" : `Vis ${files().length - SHOWN_FILES} flere`}
              <span class="work-chevron" classList={{ open: all() }}><IconChevronDown size={12} /></span>
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

function CompactedView(props: { row: CompactedRow }) {
  return (
    <div class="row row-line" data-row="compacted">
      Konteksten ble komprimert fra {formatTokens(props.row.beforeTokens)} til {formatTokens(props.row.afterTokens)} tokens
    </div>
  );
}

// A hook that did something worth seeing: one quiet line, like the compaction line, with what it
// said underneath. The name is the user's own, so the reader knows which script it was.
const HOOK_EFFECT: Record<HookRow["effect"], string> = {
  blocked: "stoppet",
  feedback: "ga tilbakemelding til modellen",
  context: "la til kontekst for modellen",
  error: "feilet",
};
const HOOK_EVENT_LABEL: Record<HookRow["event"], string> = {
  PreToolUse: "før verktøykall",
  PostToolUse: "etter verktøykall",
  UserPromptSubmit: "ved melding",
  Stop: "når turen er ferdig",
};

function HookView(props: { row: HookRow }) {
  const { row } = props;
  const what = () => (row.effect === "blocked" ? (row.event === "UserPromptSubmit" ? "stoppet meldingen" : "stoppet verktøykallet") : row.outcome === "timeout" ? "brukte for lang tid" : HOOK_EFFECT[row.effect]);
  return (
    <div class="row row-line" data-row="hook" role={row.effect === "blocked" || row.effect === "error" ? "status" : undefined}>
      <span>Hooken «{row.name}» ({HOOK_EVENT_LABEL[row.event]}) {what()}{row.effect === "error" && row.exitCode !== null ? ` (kode ${row.exitCode})` : ""}</span>
      <Show when={row.message}><div class="muted hook-message">{row.message}</div></Show>
    </div>
  );
}

function UnsentView(props: { row: UnsentRow }) {
  return (
    <div class="row row-line" data-row="unsent" role="status">
      Meldingen ble ikke sendt: {props.row.reason === "restart" ? "appen stoppet før hookene hadde sjekket den" : "sjekken av hookene ble avbrutt"}. Modellen har ikke sett den. Send den på nytt hvis du vil.
    </div>
  );
}

// Threads this run made, as one card: how many, how many are done, and one row per thread.
function AgentsView(props: { row: AgentsRow; onThread: (id: string) => void }) {
  const { row } = props;
  const [open, setOpen] = createSignal(true);
  const threads = createMemo(() => row.items().map((item) => ({ item, thread: app.threads[item.childThreadId] })));
  const running = createMemo(() => threads().filter((t) => t.thread?.running).length);
  const done = createMemo(() => threads().filter((t) => t.thread && !t.thread.running && t.thread.lastStatus === "done").length);
  const failed = createMemo(() => threads().filter((t) => t.thread && !t.thread.running && t.thread.lastStatus && t.thread.lastStatus !== "done").length);
  const status = () => {
    const parts: string[] = [];
    if (done()) parts.push(`${done()} ${done() === 1 ? "ferdig" : "ferdige"}`);
    if (running()) parts.push(`${running()} kjører`);
    if (failed()) parts.push(`${failed()} stoppet`);
    return parts.join(" · ") || "Starter";
  };
  return (
    <div class="row row-spawned row-agents" data-row="agents" data-testid="agents-card">
      <div class="agents-card">
        <button type="button" class="agents-head" aria-expanded={open()} onClick={() => setOpen(!open())}>
          <span class="agents-faces" aria-hidden="true">
            <For each={row.items().slice(0, 3)}>{(_, i) => <span class="agent-face" data-tone={i() % 3}><IconAgent size={14} /></span>}</For>
            <Show when={row.items().length > 3}><span class="agent-face more">+{row.items().length - 3}</span></Show>
          </span>
          <span class="agents-title">
            <strong>{row.items().length === 1 ? "1 underagent" : `${row.items().length} underagenter`}</strong>
            <span class="agents-status">{status()}</span>
          </span>
          <Show when={running()} fallback={<AgentsTime threads={threads().map((t) => t.thread)} />}>
            <LiveAgentsTime threads={threads().map((t) => t.thread)} />
          </Show>
          <span class="work-chevron" classList={{ open: open() }}><IconChevronDown size={12} /></span>
        </button>
        <Show when={open()}>
          <div class="agents-list">
            <For each={threads()}>
              {(entry) => (
                <button type="button" class="agent-row" onClick={() => props.onThread(entry.item.childThreadId)}>
                  <span class="agent-face" data-state={entry.thread?.running ? "running" : entry.thread?.lastStatus ?? "running"}><IconAgent size={14} /></span>
                  <span class="agent-text">
                    <span class="agent-title">{entry.thread?.title ?? entry.item.title}</span>
                    <span class="agent-sub">{entry.thread?.running ? "Kjører…" : agentStatus(entry.thread?.lastStatus ?? null)}</span>
                  </span>
                  <Show when={entry.thread}>
                    <Show when={entry.thread!.running} fallback={<span class="agent-time">{formatElapsed(entry.thread!.updatedAt - entry.thread!.createdAt)}</span>}>
                      <span class="agent-time"><LiveElapsed since={entry.thread!.createdAt} /></span>
                    </Show>
                  </Show>
                  <IconChevron size={12} />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function agentStatus(status: string | null): string {
  if (status === "done") return "Ferdig";
  if (status === "error") return "Feilet";
  if (status === "stopped") return "Stoppet";
  if (status === "interrupted") return "Avbrutt";
  return "Venter";
}

type MaybeThread = { createdAt: number; updatedAt: number; running: boolean } | undefined;

function span(threads: MaybeThread[], now: number): number {
  const known = threads.filter((t): t is NonNullable<MaybeThread> => !!t);
  if (!known.length) return 0;
  const start = Math.min(...known.map((t) => t.createdAt));
  const end = Math.max(...known.map((t) => (t.running ? now : t.updatedAt)));
  return end - start;
}

function AgentsTime(props: { threads: MaybeThread[] }) {
  return <span class="agents-time">{formatElapsed(span(props.threads, Date.now()))}</span>;
}

function LiveAgentsTime(props: { threads: MaybeThread[] }) {
  const now = useClock();
  return <span class="agents-time">{formatElapsed(span(props.threads, now()))}</span>;
}

function NoticeView(props: { row: NoticeRow }) {
  const { row } = props;
  return (
    <Show
      when={row.status === "error"}
      fallback={
        <div class="row row-line" data-row="notice">
          {row.status === "stopped" ? "Stoppet" : "Avbrutt da serveren stoppet. Du kan fortsette tråden."}
        </div>
      }
    >
      <div class="row error-card" data-row="error" role="alert">
        <IconClose size={14} />
        <div>
          <strong>Kjøringen feilet</strong>
          <div class="error-text">{row.error}</div>
        </div>
      </div>
    </Show>
  );
}

function RowKind(props: { row: Row; onThread: (id: string) => void }) {
  const { row } = props;
  switch (row.kind) {
    case "model-change":
      return <div class="row model-change-row" data-row="model-change" role="note"><IconCpu size={12} /><span>Byttet modell: {answerModelInfo(row.from).name} <span aria-hidden="true">→</span><span class="sr-only">til</span> {answerModelInfo(row.to).name}</span></div>;
    case "user":
      return <UserView row={row} onThread={props.onThread} />;
    case "text":
      return <TextView row={row} />;
    case "thinking":
      return <ThinkingView row={row} />;
    case "tool":
      return <ToolView row={row} chat={!row.work} />;
    case "question":
      return <UserQuestionSummary row={row}/>;
    case "approval":
      return <ApprovalView row={row} />;
    case "changes":
      return <ChangesView row={row} />;
    case "compacted":
      return <CompactedView row={row} />;
    case "hook":
      return <HookView row={row} />;
    case "unsent":
      return <UnsentView row={row} />;
    case "spawned":
      return null;
    case "notice":
      return <NoticeView row={row} />;
    case "work":
      return <WorkView row={row} />;
    case "steps":
      return <StepsView row={row} />;
    case "agents":
      return <AgentsView row={row} onThread={props.onThread} />;
    case "summary":
      return <SummaryView row={row} />;
  }
}

// In Kode a folded run hides its steps and the texts between them, and keeps the last answer.
export function RowView(props: { row: Row; onThread: (id: string) => void }) {
  const { row } = props;
  const work = row.work;
  if (!work || (row.kind !== "text" && row.kind !== "steps")) return <RowKind row={row} onThread={props.onThread} />;
  return (
    <Show when={!work.collapsed() || work.lastText() === row}>
      <RowKind row={row} onThread={props.onThread} />
    </Show>
  );
}

// The provider asked for a pause (429, 5xx): a calm line that counts down to the next try. The
// number changes every second, so it is hidden from screen readers; the sentence around it is not.
export function RetryLine(props: { retry: RetryState }) {
  const now = useClock();
  const left = () => Math.max(0, Math.ceil((props.retry.until - now()) / 1000));
  return (
    <div class="retry-line" role="status" data-testid="retry-line" title={props.retry.reason}>
      <span class="spinner" aria-hidden="true" />
      <span class="retry-text">
        <Show when={left() > 0} fallback={<>Prøver igjen nå</>}>
          Venter på leverandøren, prøver igjen <span aria-hidden="true">om <span class="retry-left">{left()}</span> s</span><span class="sr-only">om litt</span>
        </Show>
      </span>
      <span class="retry-attempt">(forsøk {props.retry.attempt} av {props.retry.maxAttempts})</span>
    </div>
  );
}
