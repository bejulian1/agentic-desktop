// One requestAnimationFrame for the whole app. Work queued here runs at most once per frame.
// Work that can be split gets about a third of a frame, and style, layout and paint the rest. The
// frame length is measured, so it is 1.5 ms at 240 Hz and 5 ms at 60 Hz. The perf tool sets
// __adFrameMs, since headless Chrome stops at 60 Hz and would otherwise test the wrong budget.
const BUDGET_SHARE = 0.35;
const forced = (window as { __adFrameMs?: number }).__adFrameMs;

const tasks = new Set<() => void>();
let scheduled = false;
let share = 2;
let frameMs = forced ?? 1000 / 60;
let lastFrame = 0;

function run(now: number): void {
  scheduled = false;
  // Only consecutive frames say anything about the display.
  const gap = now - lastFrame;
  if (!forced && gap > 1 && gap < 34) frameMs += (gap - frameMs) * 0.1;
  lastFrame = now;
  const batch = [...tasks];
  tasks.clear();
  share = Math.max(0.4, frameBudget() / batch.length);
  for (const task of batch) task();
}

export function frameBudget(): number {
  return frameMs * BUDGET_SHARE;
}

// A task that can stop and go on in the next frame stops at this time. Sharing the budget is what
// lets several panes stream at once without any of them taking the frame.
export function frameDeadline(): number {
  return performance.now() + share;
}

export function onNextFrame(task: () => void): void {
  tasks.add(task);
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(run);
  }
}

export function cancelFrameTask(task: () => void): void {
  tasks.delete(task);
}
