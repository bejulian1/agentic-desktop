// The thread event log. Deltas are coalesced before they reach SQLite and the UI, so a fast model
// does not mean one row or one WebSocket frame per token.
import type { ThreadEvent, ThreadEventEnvelope } from "../../../shared/protocol.ts";
import type { Store } from "../db.ts";

const COALESCE_MS = 24;

type DeltaEvent = Extract<ThreadEvent, { type: "text.delta" | "thinking.delta" | "tool.output" }>;

interface Pending {
  event: DeltaEvent;
  timer: NodeJS.Timeout;
}

export class EventLog {
  private pending = new Map<string, Pending>();
  private store: Store;
  private publish: (envelope: ThreadEventEnvelope) => void;

  constructor(store: Store, publish: (envelope: ThreadEventEnvelope) => void) {
    this.store = store;
    this.publish = publish;
  }

  append(threadId: string, event: ThreadEvent): ThreadEventEnvelope {
    this.flush(threadId);
    return this.write(threadId, event);
  }

  delta(threadId: string, event: DeltaEvent): void {
    const pending = this.pending.get(threadId);
    if (pending && sameStream(pending.event, event)) {
      pending.event.text += event.text;
      return;
    }
    this.flush(threadId);
    const timer = setTimeout(() => this.flush(threadId), COALESCE_MS);
    this.pending.set(threadId, { event: { ...event }, timer });
  }

  flush(threadId: string): void {
    const pending = this.pending.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(threadId);
    this.write(threadId, pending.event);
  }

  flushAll(): void {
    for (const threadId of [...this.pending.keys()]) this.flush(threadId);
  }

  private write(threadId: string, event: ThreadEvent): ThreadEventEnvelope {
    const envelope = this.store.appendEvent(threadId, event);
    this.publish(envelope);
    return envelope;
  }
}

function sameStream(a: DeltaEvent, b: DeltaEvent): boolean {
  if (a.type !== b.type || a.runId !== b.runId) return false;
  if (a.type === "text.delta") return a.messageId === (b as typeof a).messageId;
  if (a.type === "thinking.delta") return a.blockId === (b as typeof a).blockId;
  return a.callId === (b as typeof a).callId;
}
