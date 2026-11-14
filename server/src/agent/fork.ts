// Forks (gafler, SPEC 26.1 and 30.3). From a message: a new thread with the conversation up to and
// with that message. The events are copied as they are, with their times. The model's history is
// rebuilt from them as plain text (what was said, and a line per tool call), since the stored
// history has no marks that line up with single messages. Every fork is named «‹tittel› (gaffel)»
// and remembers where it came from; a Kode fork stays in its project, and nothing on disk changes.
import type { Attachment, ForkOrigin, Thread, ThreadEvent, ThreadEventEnvelope } from "../../../shared/protocol.ts";
import type { Store } from "../db.ts";
import { HttpError } from "../errors.ts";
import type { Block, Message } from "../providers/types.ts";

const MAX_RESULT = 500;
const MAX_TITLE = 80;
const SUFFIX = / \(gaffel(?: \d+)?\)$/;

// «Plan for appen» → «Plan for appen (gaffel)», then «(gaffel 2)», «(gaffel 3)» … for the next ones,
// also when forking a fork. Never longer than a title may be.
export function forkTitle(source: string, taken: Set<string>): string {
  const base = source.replace(SUFFIX, "").trim() || "Ny tråd";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (gaffel)" : ` (gaffel ${n})`;
    const title = `${base.slice(0, MAX_TITLE - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(title)) return title;
  }
}

// The three kinds of fork, as the route and /fork make them.
export function makeFork(store: Store, source: Thread, how: { messageId?: string; from?: "last" }): Thread {
  const title = forkTitle(source.title, store.threadTitles());
  let fork: Thread;
  let origin: ForkOrigin;
  if (how.messageId) {
    fork = forkAt(store, source, how.messageId, title);
    origin = { threadId: source.id, title: source.title, messageId: how.messageId, from: "message" };
  } else if (how.from === "last") {
    fork = store.forkFromLast(source.id, title);
    origin = { threadId: source.id, title: source.title, messageId: null, from: "last" };
  } else {
    fork = store.forkThread(source.id, title);
    origin = { threadId: source.id, title: source.title, messageId: null, from: "whole" };
  }
  store.setForkedFrom(fork.id, origin);
  return store.thread(fork.id)!;
}

export function historyFrom(events: ThreadEventEnvelope[], restoreAttachments?: (attachments: Attachment[]) => { text: string; images: Block[] }): Message[] {
  const parts: Array<{ role: "user" | "assistant"; text: string; images?: Block[] }> = [];
  const say = (role: "user" | "assistant", text: string, images?: Block[]) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.role === role) {
      last.text += `\n\n${text}`;
      if (images?.length) last.images = [...(last.images ?? []), ...images];
    } else parts.push({ role, text, ...(images?.length ? { images } : {}) });
  };
  const texts = new Map<string, string>();
  const order: Array<{ role: "user" | "assistant"; key?: string; text?: string; images?: Block[] }> = [];
  for (const { event } of events) {
    if (event.type === "user.message") {
      const from = event.from ? `[Melding fra tråden ${JSON.stringify(event.from.title)}]\n\n` : "";
      const attached = event.attachments?.length ? `\n\n[Vedlegg: ${event.attachments.map((a) => a.label).join(", ")}]` : "";
      const restored = event.attachments?.length ? restoreAttachments?.(event.attachments) : undefined;
      order.push({ role: "user", text: `${from}${event.text}${attached}${restored?.text ? `\n\n${restored.text}` : ""}`, ...(restored?.images.length ? { images: restored.images } : {}) });
    } else if (event.type === "text.delta") {
      if (!texts.has(event.messageId)) order.push({ role: "assistant", key: event.messageId });
      texts.set(event.messageId, (texts.get(event.messageId) ?? "") + event.text);
    } else if (event.type === "tool.started") {
      order.push({ role: "assistant", text: `[Brukte ${event.tool}: ${event.summary}]` });
    } else if (event.type === "tool.finished" && event.result) {
      order.push({ role: "assistant", text: `[Resultat: ${event.result.slice(0, MAX_RESULT)}${event.result.length > MAX_RESULT ? " …" : ""}]` });
    }
  }
  for (const item of order) say(item.role, item.key ? (texts.get(item.key) ?? "") : (item.text ?? ""), item.images);
  return parts.map((p) => ({ role: p.role, content: [{ type: "text", text: p.text }, ...(p.images ?? [])] }));
}

export function forkAt(store: Store, source: Thread, messageId: string, title: string): Thread {
  const events = store.events(source.id, 0, Number.MAX_SAFE_INTEGER);
  let cut = -1;
  for (const { seq, event } of events) {
    if ((event.type === "user.message" || event.type === "text.delta") && event.messageId === messageId) cut = seq;
  }
  if (cut < 0) throw new HttpError(404, "Fant ikke meldingen");
  const kept = events.filter((e) => e.seq <= cut);
  let open: string | null = null;
  for (const { event } of kept) {
    if (event.type === "run.started") open = event.runId;
    else if (event.type === "run.finished") open = null;
  }
  const close: ThreadEvent | null = open ? { type: "run.finished", runId: open, status: "done" } : null;
  return store.forkUpTo(source.id, title, cut, historyFrom(kept), close);
}
