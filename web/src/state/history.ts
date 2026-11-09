// Back and forward through the threads you have looked at, like a browser. Only the focused
// thread of the visible grid counts, and moving through the history does not add to it.
import { createSignal, untrack } from "solid-js";
import { app } from "./app";

const MAX = 100;
const [entries, setEntries] = createSignal<string[]>([]);
const [index, setIndex] = createSignal(-1);
let moving = false;

// Called from an effect: only threadId is tracked, never the history itself.
export function recordVisit(threadId: string | null): void {
  if (!threadId || moving) return;
  untrack(() => push(threadId));
}

function push(threadId: string): void {
  const list = entries().slice(0, index() + 1);
  if (list.at(-1) === threadId) return;
  list.push(threadId);
  const trimmed = list.slice(-MAX);
  setEntries(trimmed);
  setIndex(trimmed.length - 1);
}

function step(delta: number): string | null {
  for (let i = index() + delta; i >= 0 && i < entries().length; i += delta) {
    const id = entries()[i];
    if (app.threads[id]) {
      setIndex(i);
      return id;
    }
  }
  return null;
}

export const canGoBack = () => entries().slice(0, Math.max(0, index())).some((id) => app.threads[id]);
export const canGoForward = () => entries().slice(index() + 1).some((id) => app.threads[id]);

export async function goHistory(delta: -1 | 1, open: (threadId: string) => Promise<void>): Promise<void> {
  moving = true;
  const id = step(delta);
  if (!id) {
    moving = false;
    return;
  }
  try {
    await open(id);
  } finally {
    // The focus change lands after the grid has opened the thread.
    queueMicrotask(() => (moving = false));
  }
}
