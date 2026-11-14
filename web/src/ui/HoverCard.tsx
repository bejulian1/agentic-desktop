// A small card beside a thread or project in the sidebar, after the pointer has rested on it a
// moment. Nothing runs per pointer move: entering starts one timer and leaving starts another.
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { ChatProject, Project, Thread } from "../../../shared/protocol";
import { relativeTime } from "../lib/format";
import { app, modelName, scope, settingsOpen, sidebarOpen } from "../state/app";
import { peekModel, type ThreadModel } from "../state/thread-model";
import { STATE_LABEL, threadState } from "../state/thread-status";
import { openThread } from "../state/navigate";
import { IconBranch, IconChat, IconClock, IconCode, IconCpu, IconMonitor, IconFolder, IconPin, IconSettings } from "./icons";
import { forkSource, forkSourceTitle, openForkSource } from "../state/fork";
import { IconSnooze } from "./nav-icons";
import { ProjectGlyph } from "./ProjectGlyph";
import { openEditProject } from "./dialog-state";
import { renameChatProject } from "./chat-projects";

type Target = { kind: "thread" | "project" | "chat-project"; id: string; rect: DOMRect; anchor: HTMLElement };

const [card, setCard] = createSignal<Target | null>(null);
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let suppressed = false;

export function hoverIn(kind: Target["kind"], id: string, el: HTMLElement): void {
  if (suppressed) return;
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  // Moving from one row to the next while a card shows is quick; the first card waits long enough
  // that passing over the list on the way to the conversation does not flash one.
  showTimer = setTimeout(() => {
    if (el.isConnected) setCard({ kind, id, rect: el.getBoundingClientRect(), anchor: el });
  }, card() ? 90 : 600);
}

export function hoverOut(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => setCard(null), 140);
}

export function hideHoverCard(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (card()) setCard(null);
}

// While a menu is open or something is dragged, no card.
export function suppressHoverCards(on: boolean): void {
  suppressed = on;
  if (on) hideHoverCard();
}

function threadStatus(t: Thread): string {
  return STATE_LABEL[threadState(t, false)];
}

function messageCount(model: ThreadModel): string {
  let n = 0;
  for (const chunk of model.chunks()) for (const row of chunk.rows()) if (row.kind === "user") n++;
  const text = `${n} ${n === 1 ? "melding" : "meldinger"}`;
  return model.hasOlder() ? `minst ${text}` : text;
}

function ThreadCard(props: { thread: Thread }) {
  const project = createMemo(() => (props.thread.projectId ? app.projects[props.thread.projectId] : undefined));
  const chatProject = createMemo(() => props.thread.chatProjectId ? app.chatProjects[props.thread.chatProjectId] : undefined);
  const parent = createMemo(() => (props.thread.parentThreadId ? app.threads[props.thread.parentThreadId] : undefined));
  // The model is loaded when the pointer reaches the row (preloadThread), so this is usually known.
  const model = () => peekModel(props.thread.id);
  const snoozed = () => (props.thread.snoozedUntil && props.thread.snoozedUntil > Date.now() ? props.thread.snoozedUntil : null);
  return (
    <>
      <div class="hover-card-head">
        <span class="hover-card-title">{props.thread.title}</span>
        <span class="hover-card-age">{relativeTime(props.thread.updatedAt)}</span>
      </div>
      <div class="hover-card-row">
        <Show when={project()} fallback={<>{props.thread.mode === "code" ? <IconMonitor size={14} /> : <IconChat size={14} />}<span>{props.thread.mode === "code" ? "Kode · Denne datamaskinen" : chatProject() ? `Chat · ${chatProject()!.name}` : "Chat uten prosjekt"}</span></>}>
          {(p) => <><ProjectGlyph project={p()} size={14} /><span>{p().name}</span><span class="hover-card-mode">Kode</span></>}
        </Show>
      </div>
      <div class="hover-card-row muted hover-card-facts">
        <IconCpu size={14} />
        <span>{modelName(props.thread.modelId)}</span>
        <Show when={model()}>{(m) => <span class="hover-card-count">{messageCount(m())}</span>}</Show>
      </div>
      <div class="hover-card-row muted">
        <IconClock size={14} />
        <span>Sist aktiv {relativeTime(props.thread.updatedAt)}, laget {new Date(props.thread.createdAt).toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}</span>
      </div>
      <Show when={threadStatus(props.thread)}>{(status) => <div class="hover-card-row muted">{status()}</div>}</Show>
      <Show when={snoozed()}>
        {(until) => <div class="hover-card-row muted"><IconSnooze size={14} />Utsatt til {new Date(until()).toLocaleString("nb-NO", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>}
      </Show>
      <Show when={parent()}>
        {(p) => (
          <button type="button" class="hover-card-link" onClick={() => { hideHoverCard(); void openThread(p()); }}>
            {props.thread.origin === "agent" ? "Laget av" : "Sidechat fra"} {p().title}
          </button>
        )}
      </Show>
      {/* Round 14 (SPEC 30.3) */}
      <Show when={props.thread.forkedFrom}>
        <Show
          when={forkSource(props.thread)}
          fallback={<div class="hover-card-row muted"><IconBranch size={14} /><span>Gaffel av {props.thread.forkedFrom!.title} (slettet)</span></div>}
        >
          <button type="button" class="hover-card-link hover-card-fork" onClick={() => { hideHoverCard(); void openForkSource(props.thread); }}>
            <IconBranch size={13} /><span>Gaffel av {forkSourceTitle(props.thread)}</span>
          </button>
        </Show>
      </Show>
    </>
  );
}

function ProjectCard(props: { project: Project }) {
  const count = createMemo(() => Object.values(app.threads).filter((t) => t && !t.archived && t.projectId === props.project.id).length);
  return (
    <>
      <div class="hover-card-head">
        <ProjectGlyph project={props.project} size={15} />
        <span class="hover-card-title">{props.project.name}</span>
        <Show when={props.project.pinned}><span class="hover-card-age" title="Festet"><IconPin size={13} /></span></Show>
      </div>
      <div class="hover-card-row"><IconCode size={14} /><span>{count()} {count() === 1 ? "tråd" : "tråder"} i Kode</span></div>
      <div class="hover-card-sep" />
      <div class="hover-card-row path"><IconFolder size={14} /><bdo dir="ltr">{props.project.path}</bdo></div>
      <div class="hover-card-sep" />
      <button type="button" class="hover-card-action" onClick={() => { hideHoverCard(); openEditProject(props.project.id); }}>
        <IconSettings size={14} />Rediger prosjekt
      </button>
    </>
  );
}

function ChatProjectCard(props: { project: ChatProject }) {
  const count = createMemo(() => Object.values(app.threads).filter((thread) => thread && !thread.archived && !thread.temporary && thread.mode === "chat" && !thread.projectId && thread.chatProjectId === props.project.id).length);
  const rename = async () => {
    hideHoverCard();
    await renameChatProject(props.project);
  };
  return <>
    <div class="hover-card-head"><ProjectGlyph project={props.project} size={15} /><span class="hover-card-title">{props.project.name}</span><Show when={props.project.pinned}><span class="hover-card-age" title="Festet"><IconPin size={13} /></span></Show></div>
    <div class="hover-card-row"><IconChat size={14} /><span>{count()} {count() === 1 ? "chat" : "chatter"} i Chat</span></div>
    <div class="hover-card-row muted hover-card-note"><span>Samler samtaler, uten prosjektmappe på disken.</span></div>
    <div class="hover-card-sep" />
    <button type="button" class="hover-card-action" onClick={() => void rename()}><IconSettings size={14} />Gi prosjektet nytt navn</button>
  </>;
}

export function HoverCardHost() {
  // The card belongs to a row in the sidebar. When the window changes size, or the sidebar closes
  // and takes the row with it, the card goes too, instead of hanging where the row was.
  createEffect(() => {
    const target = card();
    if (!target) return;
    const hide = () => hideHoverCard();
    const observe = new MutationObserver(() => { if (!target.anchor.isConnected) hide(); });
    observe.observe(document.querySelector(".sidebar") ?? document.body, { childList: true, subtree: true });
    addEventListener("resize", hide);
    addEventListener("scroll", hide, true);
    onCleanup(() => { removeEventListener("resize", hide); removeEventListener("scroll", hide, true); observe.disconnect(); });
  });
  createEffect(() => {
    if (!sidebarOpen() || settingsOpen()) hideHoverCard();
  });
  createEffect(on(scope, hideHoverCard, { defer: true }));
  const place = (el: HTMLElement) => {
    const target = card();
    if (!target) return;
    requestAnimationFrame(() => {
      if (!target.anchor.isConnected) return hideHoverCard();
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      // Beside the row when there is room, else inside the window with 8 px to spare.
      const x = Math.max(8, Math.min(target.rect.right + 8, innerWidth - w - 8));
      const y = Math.max(8, Math.min(Math.max(8, target.rect.top - 4), innerHeight - h - 8));
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      el.style.visibility = "visible";
    });
  };
  return (
    <Show when={card()} keyed>
      {(target) => {
        const thread = target.kind === "thread" ? app.threads[target.id] : undefined;
        const project = target.kind === "project" ? app.projects[target.id] : undefined;
        const chatProject = target.kind === "chat-project" ? app.chatProjects[target.id] : undefined;
        if (!thread && !project && !chatProject) return null;
        return (
          <Portal>
            <div
              ref={place}
              class="popover hover-card"
              role="group"
              aria-label={thread ? "Om tråden" : "Om prosjektet"}
              data-testid={`hover-card-${target.kind}`}
              onPointerEnter={() => clearTimeout(hideTimer)}
              onPointerLeave={hoverOut}
            >
              {thread ? <ThreadCard thread={thread} /> : project ? <ProjectCard project={project} /> : <ChatProjectCard project={chatProject!} />}
            </div>
          </Portal>
        );
      }}
    </Show>
  );
}
