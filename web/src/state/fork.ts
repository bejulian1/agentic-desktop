// Round 14 (SPEC 30.3): where a fork came from, for the sidebar, the hover card, the top bar and
// the top of the conversation.
import { t } from "../lib/i18n";
import type { Thread } from "../../../shared/protocol";
import { app, toast } from "./app";
import { jumpWhenShown } from "./message-jump";
import { openThread } from "./navigate";

export function forkSource(thread: Thread | undefined): Thread | undefined {
  const id = thread?.forkedFrom?.threadId;
  return id ? app.threads[id] : undefined;
}

// The source's name now, or the one it had when the fork was made if it is deleted since.
export function forkSourceTitle(thread: Thread): string {
  return forkSource(thread)?.title ?? thread.forkedFrom?.title ?? "";
}

export async function openForkSource(thread: Thread): Promise<void> {
  const origin = thread.forkedFrom;
  if (!origin) return;
  const source = forkSource(thread);
  if (!source) return toast(t("«{title}» er slettet.", { title: origin.title }), "info");
  await openThread(source);
  if (origin.messageId) jumpWhenShown(source.id, origin.messageId);
}
