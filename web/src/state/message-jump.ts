// Jumps to a message in the conversation of the pane that shows a thread: for the pinned summary's
// chapters, and for the link from a fork back to the message it came from (round 14). The
// conversation registers itself while it is mounted.
const jumpers = new Map<string, (key: string) => boolean>();

export function registerJumper(threadId: string, jump: (key: string) => boolean): () => void {
  jumpers.set(threadId, jump);
  return () => {
    if (jumpers.get(threadId) === jump) jumpers.delete(threadId);
  };
}

export function jumpToMessage(threadId: string, key: string): boolean {
  return jumpers.get(threadId)?.(key) ?? false;
}

// After a thread was just opened: its conversation mounts and loads, so try for a moment.
export function jumpWhenShown(threadId: string, key: string, tries = 20): void {
  if (jumpToMessage(threadId, key) || tries <= 0) return;
  setTimeout(() => jumpWhenShown(threadId, key, tries - 1), 60);
}
