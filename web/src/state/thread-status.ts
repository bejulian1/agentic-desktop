// Round 13 (SPEC 27.1): one set of words for what a thread is doing, used by the sidebar, the
// smart sidebar, the hover card, the pane head and the window title, so it reads the same
// everywhere: «Jobber…» while it runs, «Venter på deg» while an approval waits.
import { t } from "../lib/i18n";
import type { Thread } from "../../../shared/protocol";
import { finished } from "./home";

export type ThreadState = "waiting" | "running" | "error" | "stopped" | "new" | "idle";

export const STATE_LABEL: Record<ThreadState, string> = {
  get waiting() { return t("Venter på deg"); },
  get running() { return t("Jobber…"); },
  get error() { return t("Feilet"); },
  get stopped() { return t("Stoppet"); },
  get new() { return t("Ulest"); },
  idle: "",
};

export const waitingCount = (thread: Thread): number => thread.pendingApprovals + (thread.pendingQuestions ?? 0);

export function threadState(thread: Thread, seen = true): ThreadState {
  if (waitingCount(thread) > 0) return "waiting";
  if (thread.running) return "running";
  if (thread.lastStatus === "error") return "error";
  if (thread.lastStatus === "stopped" || thread.lastStatus === "interrupted") return "stopped";
  if (!seen && finished().includes(thread.id)) return "new";
  return "idle";
}

// The window's title: the thread, and what it does when it needs a look.
export function windowTitle(thread: Thread | undefined, untitled: boolean): string {
  if (!thread || untitled) return "Agentic Desktop";
  const state = threadState(thread);
  return state === "running" || state === "waiting" ? t("{status} · {title}", { status: STATE_LABEL[state], title: thread.title }) : thread.title;
}
