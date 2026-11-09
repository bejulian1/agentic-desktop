// Round 13 (SPEC 27.1): one set of words for what a thread is doing, used by the sidebar, the
// smart sidebar, the hover card, the pane head and the window title, so it reads the same
// everywhere: «Jobber…» while it runs, «Venter på deg» while an approval waits.
import type { Thread } from "../../../shared/protocol";
import { finished } from "./home";

export type ThreadState = "waiting" | "running" | "error" | "stopped" | "new" | "idle";

export const STATE_LABEL: Record<ThreadState, string> = {
  waiting: "Venter på deg",
  running: "Jobber…",
  error: "Feilet",
  stopped: "Stoppet",
  new: "Ferdig, ikke sett",
  idle: "",
};

export function threadState(thread: Thread, seen = true): ThreadState {
  if (thread.pendingApprovals > 0) return "waiting";
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
  return state === "running" || state === "waiting" ? `${STATE_LABEL[state]} · ${thread.title}` : thread.title;
}
