// The pinned box above a conversation: the goal from /goal with its clock, the plan from /plan,
// the files the thread made or changed, the threads it started, and what was attached. It reacts
// to chunks and thread changes, never to single tokens.
import { createMemo, createSignal, For, Show } from "solid-js";
import type { Attachment, Thread } from "../../../shared/protocol";
import { app, report } from "../state/app";
import { openThread } from "../state/navigate";
import { peekPanelActions } from "../state/panel";
import type { ThreadModel } from "../state/thread-model";
import { GoalLine } from "./Goal";
import { IconAgent, IconAt, IconBookmark, IconChevron, IconClose, IconFile, IconFolder, IconImage, IconList } from "./icons";
import { imageUrl, showImage } from "./rows";
import { jumpToMessage } from "./Conversation";
import { patch } from "../lib/api";

function excerpt(text: string, max = 160): string {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|-]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

const SHOWN = 5;

// Folded by default: one line that stays out of the way. Shared by all panes in this window.
const [open, setOpen] = createSignal(false);

function Section(props: { title: string; testid: string; children: any }) {
  return (
    <section class="pinned-section" data-testid={props.testid}>
      <h3 class="pinned-label">{props.title}</h3>
      {props.children}
    </section>
  );
}

export function PinnedSummary(props: { thread: Thread; model: ThreadModel | null }) {
  const rows = createMemo(() => {
    void props.thread.updatedAt; // Recount when a run ends.
    return props.model?.chunks().flatMap((chunk) => chunk.rows()) ?? [];
  });
  const stats = createMemo(() => {
    let messages = 0;
    let tools = 0;
    let last = "";
    const sources = new Map<string, Attachment>();
    for (const row of rows()) {
      if (row.kind === "user") {
        messages += 1;
        for (const a of row.attachments ?? []) sources.set(a.imageId ?? a.threadId ?? a.path ?? a.label, a);
      } else if (row.kind === "steps") tools += row.items().filter((i) => i.kind === "tool").length;
      else if (row.kind === "tool") tools += 1;
      else if (row.kind === "text" && row.text.trim()) last = row.text;
    }
    return { messages, tools, last: excerpt(last), sources: [...sources.values()] };
  });
  // The last change to each file, newest first. Reverted turns do not count.
  const results = createMemo(() => {
    const files = new Map<string, { path: string; change: string; additions: number; deletions: number; turnId: string }>();
    for (const turn of props.model?.changes() ?? []) {
      if (turn.reverted) continue;
      for (const file of turn.files) {
        const seen = files.get(file.path);
        files.delete(file.path);
        files.set(file.path, {
          path: file.path,
          change: seen?.change === "added" && file.change !== "deleted" ? "added" : file.change,
          additions: (seen?.additions ?? 0) + file.additions,
          deletions: (seen?.deletions ?? 0) + file.deletions,
          turnId: turn.turnId,
        });
      }
    }
    return [...files.values()].reverse();
  });
  const children = createMemo(() => Object.values(app.threads).filter((t) => t && t.parentThreadId === props.thread.id).sort((a, b) => a.createdAt - b.createdAt));
  const childStatus = () => {
    const done = children().filter((t) => !t.running && t.lastStatus === "done").length;
    const running = children().filter((t) => t.running).length;
    return [done ? `${done} ${done === 1 ? "ferdig" : "ferdige"}` : "", running ? `${running} kjører` : ""].filter(Boolean).join(" · ") || "Venter";
  };
  // Only what there is: "3 verktøy · 2 filer · 1 kapittel". The goal stands in the project row.
  const counts = () => {
    const parts: string[] = [];
    if (stats().tools) parts.push(`${stats().tools} verktøy`);
    if (results().length) parts.push(results().length === 1 ? "1 fil" : `${results().length} filer`);
    if (props.thread.chapters.length) parts.push(props.thread.chapters.length === 1 ? "1 kapittel" : `${props.thread.chapters.length} kapitler`);
    if (children().length) parts.push(children().length === 1 ? "1 tråd" : `${children().length} tråder`);
    return parts.join(" · ");
  };
  const [allFiles, setAllFiles] = createSignal(false);
  const [allSources, setAllSources] = createSignal(false);

  return (
    <section class="pinned" data-testid="pinned-summary" aria-label="Festet sammendrag">
      <button type="button" class="pinned-head" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <span class="fold-chevron" classList={{ open: open() }}><IconChevron size={12} /></span>
        <IconList size={13} />
        <span class="pinned-goal">Sammendrag</span>
        <Show when={props.thread.planMode}><span class="pill pill-accent">Planmodus</span></Show>
        <span class="pinned-count">{counts()}</span>
      </button>
      <Show when={open()}>
        <div class="pinned-body">
          <Section title="Mål" testid="pinned-goal-section">
            <Show when={props.thread.goal} fallback={<p class="pinned-empty">Ingen mål ennå. Skriv /goal og målet i meldingsfeltet.</p>}>
              <GoalLine thread={props.thread} variant="pinned" />
            </Show>
          </Section>
          <Show when={props.thread.plan}>
            <div class="pinned-plan">
              <span class="pinned-label"><IconList size={12} />Plan</span>
              <p>{excerpt(props.thread.plan!, 400)}</p>
            </div>
          </Show>
          <Show when={props.thread.chapters.length}>
            <Section title="Kapitler" testid="pinned-chapters">
              <ul class="pinned-list">
                <For each={props.thread.chapters}>
                  {(chapter) => (
                    <li class="pinned-chapter">
                      <button type="button" class="pinned-item" title="Gå til kapittelet" onClick={() => jumpToMessage(props.thread.id, chapter.messageId)}>
                        <IconBookmark size={14} />
                        <span class="pinned-item-text">{chapter.title}</span>
                      </button>
                      <button
                        type="button"
                        class="goal-button"
                        title={`Fjern kapittelet «${chapter.title}»`}
                        aria-label={`Fjern kapittelet ${chapter.title}`}
                        onClick={() => patch(`/api/threads/${props.thread.id}`, { chapter: { messageId: chapter.messageId, title: null } }).catch(report)}
                      >
                        <IconClose size={12} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Section>
          </Show>
          <Section title="Resultater" testid="pinned-results">
            <Show when={results().length} fallback={<p class="pinned-empty">Ingen filer laget eller endret ennå.</p>}>
              <ul class="pinned-list">
                <For each={allFiles() ? results() : results().slice(0, SHOWN)}>
                  {(file) => (
                    <li>
                      <button type="button" class="pinned-item" title={file.path} onClick={() => peekPanelActions()?.showTurn(file.turnId)}>
                        <IconFile size={14} />
                        <span class="pinned-item-text">{file.path}</span>
                        <span class="pinned-item-meta">{file.change === "added" ? "ny" : file.change === "deleted" ? "slettet" : ""}</span>
                        <span class="diff-add">+{file.additions}</span>
                        <span class="diff-del">−{file.deletions}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={results().length > SHOWN}>
                <button type="button" class="pinned-more" onClick={() => setAllFiles(!allFiles())}>{allFiles() ? "Vis færre" : `Vis alle ${results().length}`}</button>
              </Show>
            </Show>
          </Section>
          <Show when={children().length}>
            <Section title="Underagenter" testid="pinned-agents">
              <p class="pinned-agents-line">
                <span class="agents-faces" aria-hidden="true">
                  <For each={children().slice(0, 4)}>{(_, i) => <span class="agent-face" data-tone={i() % 3}><IconAgent size={13} /></span>}</For>
                </span>
                {children().length === 1 ? "1 tråd" : `${children().length} tråder`} · {childStatus()}
              </p>
              <ul class="pinned-list">
                <For each={children()}>
                  {(child) => (
                    <li>
                      <button type="button" class="pinned-item" onClick={() => void openThread(child)}>
                        <IconAgent size={14} />
                        <span class="pinned-item-text">{child.title}</span>
                        <span class="pinned-item-meta">{child.running ? "kjører" : child.lastStatus === "done" ? "ferdig" : child.lastStatus === "error" ? "feilet" : child.lastStatus ? "stoppet" : "venter"}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Section>
          </Show>
          <Section title="Kilder" testid="pinned-sources">
            <Show when={stats().sources.length} fallback={<p class="pinned-empty">Ingen vedlegg ennå. Legg ved bilder med + eller filer med @.</p>}>
              <ul class="pinned-list">
                <For each={allSources() ? stats().sources : stats().sources.slice(0, SHOWN)}>
                  {(source) => (
                    <li>
                      <Show
                        when={source.kind === "image" && source.imageId}
                        fallback={
                          <span class="pinned-item static" title={source.path ?? source.label}>
                            {source.kind === "thread" ? <IconAt size={14} /> : source.kind === "dir" ? <IconFolder size={14} /> : <IconFile size={14} />}
                            <span class="pinned-item-text">{source.label}</span>
                          </span>
                        }
                      >
                        <button type="button" class="pinned-item" onClick={() => showImage(imageUrl(source.imageId!), source.label)}>
                          <IconImage size={14} />
                          <span class="pinned-item-text">{source.label}</span>
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={stats().sources.length > SHOWN}>
                <button type="button" class="pinned-more" onClick={() => setAllSources(!allSources())}>{allSources() ? "Vis færre" : `Vis alle ${stats().sources.length}`}</button>
              </Show>
            </Show>
          </Section>
          <p class="pinned-stats">
            {stats().messages} {stats().messages === 1 ? "melding" : "meldinger"} · {stats().tools} verktøykall · {results().length} {results().length === 1 ? "fil" : "filer"} endret
          </p>
          <Show when={stats().last}><p class="pinned-last"><span class="pinned-label">Siste svar</span> {stats().last}</p></Show>
        </div>
      </Show>
    </section>
  );
}
