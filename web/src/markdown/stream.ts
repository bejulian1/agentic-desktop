// Incremental Markdown. Text arrives in pieces, and each frame only looks at what is new:
// finished blocks are lexed once and never touched again, and only the last, unfinished block is
// lexed per frame. An open code fence is cheaper still: new text goes straight into its text node.
// Hermes measured 14 times less CPU from this kind of lexing, and it makes the cost independent
// of how long the message or the conversation is.
import { addRunButton, createCodeBlock, finishedCodeBlock, lex, renderBlocks, renderingLive } from "./render";
import { highlightWhenVisible } from "./highlight";
import { artifactLangOf, looksLikeApp } from "./artifact-detect";
import { createWritingBox, type WritingBox } from "./artifact-card";

const SEGMENT_BLOCKS = 32; // Blocks per content-visibility group, so layout skips long messages.
const MAX_TAIL = 32 * 1024; // A block this long is committed at a line break anyway.
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)([^\n]*)/;
const APP_SNIFF = 4000; // How much of a block is looked at to see whether it is an app.
const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s/;

interface OpenFence {
  marker: string;
  length: number;
  lang: string;
  info: string; // the whole line after the fence
  // Round 15 (SPEC 31.1): a block in HTML, JSX or TSX that looks like a whole app is shown as the
  // artifact box being written, not as code. undefined: not looked at yet; null: not an app.
  app?: WritingBox | null;
  // Offsets into tail: where the code text starts, and how much is already in the text node.
  textStart: number;
  shown: number;
  block?: { root: HTMLElement; code: HTMLElement; text: Text };
}

function closesFence(line: string, fence: OpenFence): boolean {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && trimmed[0] === fence.marker && [...trimmed].every((c) => c === fence.marker);
}

export class MarkdownStream {
  readonly root: HTMLElement;
  private readonly isLive: boolean; // an answer arriving now, not history read back in slices
  private tail = "";
  private scanned = 0; // Everything before this offset in tail has been looked at, line by line.
  private blankEnd = -1; // End of the last blank line in the current block.
  private list = false; // The current block is a list, where blank lines do not end it.
  private fence: OpenFence | null = null;
  private segment: HTMLElement | null = null;
  private segmentBlocks = 0;
  private live: HTMLElement;
  private liveText = ""; // What live currently shows, to skip work when nothing changed.
  private lexCost = 0; // ms of the last tail lex, to back off on very long lines
  private skipFrames = 0;
  private closing = false;

  constructor(root: HTMLElement, live = true) {
    this.root = root;
    this.isLive = live;
    this.live = document.createElement("div");
    this.live.className = "md-live";
    root.appendChild(this.live);
  }

  // New text. Nothing is rendered until flush, which the caller runs once per frame.
  push(text: string): void {
    this.tail += text;
  }

  // The message is complete: the last block is final too, on the next flush that gets there.
  finish(): void {
    this.closing = true;
  }

  // Does what fits before the deadline. True means there is more, for the next frame.
  flush(deadline: number): boolean {
    if (this.scan(deadline)) return true;
    if (this.closing) {
      const rest = this.tail;
      this.tail = "";
      this.scanned = 0;
      this.fence = null;
      this.live.remove();
      this.liveText = "";
      if (rest.trim()) this.commit(rest);
    } else if (this.fence?.block) this.growFence(this.fence);
    else this.renderTail();
    return false;
  }

  private currentSegment(): HTMLElement {
    if (!this.segment || this.segmentBlocks >= SEGMENT_BLOCKS) {
      this.segment = document.createElement("div");
      this.segment.className = "md-segment";
      this.segmentBlocks = 0;
      this.root.insertBefore(this.segment, this.live.parentNode === this.root ? this.live : null);
    }
    return this.segment;
  }

  private commit(source: string): void {
    const segment = this.currentSegment();
    this.segmentBlocks += 1;
    const render = () => renderBlocks(lex(source), segment, false, segment);
    if (this.isLive) renderingLive(render);
    else render();
  }

  private commitUpTo(offset: number): void {
    if (offset <= 0) return;
    const block = this.tail.slice(0, offset);
    this.tail = this.tail.slice(offset);
    this.scanned -= offset;
    this.blankEnd = -1;
    this.list = false;
    this.liveText = "";
    if (block.trim()) this.commit(block);
  }

  private scan(deadline: number): boolean {
    while (true) {
      if (performance.now() > deadline) return true;
      const newline = this.tail.indexOf("\n", this.scanned);
      if (newline === -1) break;
      const start = this.scanned;
      const line = this.tail.slice(start, newline);
      this.scanned = newline + 1;
      this.line(line, start);
    }
    if (!this.fence && this.scanned > MAX_TAIL) this.commitUpTo(this.scanned);
    return false;
  }

  private line(line: string, start: number): void {
    if (this.fence) {
      if (!closesFence(line, this.fence)) return;
      const fence = this.fence;
      this.fence = null;
      if (fence.block) {
        // The element is already showing all of it, so it moves over without being lexed again.
        const text = this.tail.slice(fence.textStart, start).replace(/\n$/, "");
        this.finishFence(fence, text);
        this.tail = this.tail.slice(this.scanned);
        this.scanned = 0;
        this.blankEnd = -1;
      }
      return;
    }

    const blank = !line.trim();
    if (blank) {
      this.blankEnd = this.scanned;
      return;
    }

    if (start === 0) this.list = LIST_ITEM.test(line);

    if (this.blankEnd !== -1) {
      const continues = this.list && (/^\s/.test(line) || LIST_ITEM.test(line));
      if (!continues) {
        const end = this.blankEnd;
        this.commitUpTo(end);
        start -= end;
        this.list = LIST_ITEM.test(line);
      }
      this.blankEnd = -1;
    }

    const opening = FENCE.exec(line);
    if (!opening) return;
    if (this.list) {
      this.fence = { marker: opening[1][0], length: opening[1].length, lang: "", info: "", textStart: 0, shown: 0 };
      return;
    }
    // A fence interrupts a paragraph, so what came before it is a finished block.
    if (start > 0) {
      this.commitUpTo(start);
      start = 0;
    }
    const fence: OpenFence = {
      marker: opening[1][0],
      length: opening[1].length,
      lang: opening[2] ?? "",
      info: `${opening[2] ?? ""}${opening[3] ?? ""}`.trim(),
      textStart: this.scanned,
      shown: this.scanned,
      app: artifactLangOf(opening[2] ?? "") ? undefined : null,
    };
    const block = createCodeBlock(fence.lang, "");
    const text = document.createTextNode("");
    block.code.appendChild(text);
    fence.block = { ...block, text };
    this.fence = fence;
    this.live.replaceChildren(block.root);
    this.liveText = "";
  }

  private growFence(fence: OpenFence): void {
    if (this.tail.length <= fence.shown) return;
    fence.block!.text.appendData(this.tail.slice(fence.shown));
    fence.shown = this.tail.length;
    if (fence.app === null) return;
    // The code so far, up to the last whole line: the closing fence is not part of it.
    const code = this.tail.slice(fence.textStart, this.tail.lastIndexOf("\n") + 1);
    if (fence.app === undefined) {
      if (looksLikeApp(fence.lang, code.slice(0, APP_SNIFF))) {
        fence.app = createWritingBox(fence.lang, fence.info);
        this.live.replaceChildren(fence.app.root);
      } else if (code.length > APP_SNIFF) fence.app = null;
    }
    fence.app?.update(code);
  }

  private finishFence(fence: OpenFence, text: string): void {
    const block = fence.block!;
    if (block.text.data !== text) block.text.data = text;
    const segment = this.currentSegment();
    segment.appendChild(block.root);
    this.segmentBlocks += 1;
    this.live.replaceChildren();
    addRunButton(block.root, fence.lang, text);
    highlightWhenVisible(segment, block.code, fence.lang, text);
    if (this.isLive) renderingLive(() => finishedCodeBlock(segment, fence.lang, text, fence.info));
    else finishedCodeBlock(segment, fence.lang, text, fence.info);
  }

  private renderTail(): void {
    if (this.tail === this.liveText) return;
    // A line with no end in sight is the one case where lexing grows with the text, so slow down.
    if (this.skipFrames > 0) {
      this.skipFrames -= 1;
      return;
    }
    const started = performance.now();
    this.liveText = this.tail;
    const next = document.createDocumentFragment();
    if (this.tail.trim()) renderBlocks(lex(this.tail), next);
    this.live.replaceChildren(next);
    this.lexCost = performance.now() - started;
    this.skipFrames = this.lexCost > 3 ? Math.ceil(this.lexCost / 3) : 0;
  }
}

// A finished message in one go, for history. Only huge ones need the stream's slicing.
export function renderStatic(root: HTMLElement, text: string): void {
  const tokens = lex(text);
  if (tokens.length <= SEGMENT_BLOCKS) {
    renderBlocks(tokens, root, false, root);
    return;
  }
  for (let i = 0; i < tokens.length; i += SEGMENT_BLOCKS) {
    const segment = document.createElement("div");
    segment.className = "md-segment";
    renderBlocks(tokens.slice(i, i + SEGMENT_BLOCKS), segment, false, segment);
    root.appendChild(segment);
  }
}
