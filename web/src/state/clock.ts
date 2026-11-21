// One shared second clock for the live timers (the goal, "Jobber…", subagents). It only ticks
// while a mounted timer needs it, so an idle app has no timer at all.
import { createSignal, onCleanup } from "solid-js";
import { t } from "../lib/i18n";

const [now, setNow] = createSignal(Date.now());
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

// Call inside a component or effect. The tick stops when the last user is cleaned up.
export function useClock(): () => number {
  users += 1;
  if (users === 1) {
    setNow(Date.now());
    timer = setInterval(() => setNow(Date.now()), 1000);
  }
  onCleanup(() => {
    users -= 1;
    if (users === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  return now;
}

// "34s", "14m 34s", "2t 5m". Short, like the reference apps.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return t("{hours}t {minutes}m", { hours: h, minutes: m });
  if (m) return t("{minutes}m {seconds}s", { minutes: m, seconds: s });
  return t("{seconds}s", { seconds: s });
}

// How long a goal has run, with the clock standing still while paused.
export function goalElapsed(thread: { goalElapsedMs: number; goalResumedAt: number | null; goalPausedAt: number | null }, at: number): number {
  return thread.goalElapsedMs + (thread.goalPausedAt === null && thread.goalResumedAt !== null ? Math.max(0, at - thread.goalResumedAt) : 0);
}
