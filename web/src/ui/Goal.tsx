// The goal from /goal: its text, how long it has run, and Rediger, Sett på pause and Slett. Shown
// in the project row above the message field and in the pinned summary. The time is kept on the
// server, so it survives a restart, and it stands still while the goal is paused.
import { createSignal, Show } from "solid-js";
import type { Thread } from "../../../shared/protocol";
import { patch } from "../lib/api";
import { report } from "../state/app";
import { formatElapsed, goalElapsed, useClock } from "../state/clock";
import { IconPause, IconPencil, IconPlay, IconTarget, IconTrash } from "./icons";

function LiveTime(props: { thread: Thread }) {
  const now = useClock();
  return <>{formatElapsed(goalElapsed(props.thread, now()))}</>;
}

export function GoalTime(props: { thread: Thread }) {
  return (
    <span class="goal-time" data-testid="goal-time" title={props.thread.goalPausedAt !== null ? "Målet er satt på pause" : "Hvor lenge målet har kjørt"}>
      <Show when={props.thread.goalPausedAt === null} fallback={formatElapsed(goalElapsed(props.thread, Date.now()))}>
        <LiveTime thread={props.thread} />
      </Show>
    </span>
  );
}

export function GoalLine(props: { thread: Thread; variant: "composer" | "pinned" }) {
  const [editing, setEditing] = createSignal(false);
  const paused = () => props.thread.goalPausedAt !== null;
  // Each edit ends once: Enter and a click elsewhere save, Esc leaves the goal as it was. Taking the
  // field out of the page blurs it, and that blur must not save a second time, or save after Esc.
  let ended = false;
  const finish = (text: string | null) => {
    if (ended) return;
    ended = true;
    setEditing(false);
    const next = text?.trim();
    if (next && next !== props.thread.goal) patch(`/api/threads/${props.thread.id}`, { goal: next }).catch(report);
  };
  const edit = () => {
    ended = false;
    setEditing(true);
  };
  return (
    <div class={`goal-line goal-${props.variant}`} classList={{ paused: paused() }} data-testid={`goal-${props.variant}`}>
      <IconTarget size={14} />
      <Show
        when={!editing()}
        fallback={
          <input
            class="goal-input"
            aria-label="Mål"
            value={props.thread.goal ?? ""}
            maxLength={2000}
            ref={(el) => requestAnimationFrame(() => el.select())}
            onBlur={(e) => finish(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.isComposing) {
                e.preventDefault();
                finish(e.currentTarget.value);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finish(null);
              }
            }}
          />
        }
      >
        <span class="goal-text" title={props.thread.goal ?? ""}>{props.thread.goal}</span>
      </Show>
      <GoalTime thread={props.thread} />
      <span class="goal-actions">
        <button type="button" class="goal-button" title="Rediger mål" aria-label="Rediger mål" onClick={edit}><IconPencil size={13} /></button>
        <button
          type="button"
          class="goal-button"
          title={paused() ? "Gjenoppta mål" : "Sett på pause"}
          aria-label={paused() ? "Gjenoppta mål" : "Sett på pause"}
          onClick={() => patch(`/api/threads/${props.thread.id}`, { goalPaused: !paused() }).catch(report)}
        >
          {paused() ? <IconPlay size={13} /> : <IconPause size={13} />}
        </button>
        <button type="button" class="goal-button" title="Slett mål" aria-label="Slett mål" onClick={() => patch(`/api/threads/${props.thread.id}`, { goal: null }).catch(report)}><IconTrash size={13} /></button>
      </span>
    </div>
  );
}
