// Threads share the project folder. This tracks what each thread last saw of a file, and queues
// writes to the same file so they happen one at a time.
import { createHash } from "node:crypto";

export function hashContent(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class FileState {
  private seen = new Map<string, Map<string, string>>();
  private tails = new Map<string, Promise<unknown>>();

  remember(threadId: string, abs: string, data: Uint8Array): void {
    let files = this.seen.get(threadId);
    if (!files) this.seen.set(threadId, (files = new Map()));
    files.set(abs, hashContent(data));
  }

  lastSeen(threadId: string, abs: string): string | undefined {
    return this.seen.get(threadId)?.get(abs);
  }

  forgetThread(threadId: string): void {
    this.seen.delete(threadId);
  }

  // Runs fn after every earlier write to the same path has finished.
  async exclusive<T>(abs: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(abs) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.tails.set(abs, tail);
    try {
      return await run;
    } finally {
      if (this.tails.get(abs) === tail) this.tails.delete(abs);
    }
  }
}
