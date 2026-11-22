import { language, plural, t } from "../lib/i18n.ts";
// A small card beside a thread or project in the sidebar, after the pointer has rested on it a
// moment. Nothing runs per pointer move: entering starts one timer and leaving starts another.
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { ChatProject, Project, Thread } from "../../../shared/protocol";
import { relativeTime } from "../lib/format";
import { app, modelName, scope, settingsOpen, sidebarOpen } from "../state/app";
import { peekModel, type ThreadModel } from "../state/thread-model";
import { gitInfo, loadGitInfo } from "../state/home";
import { modelProvider, ProviderGlyph } from "./ProviderGlyph";
import { STATE_LABEL, threadState } from "../state/thread-status";
import { openChatProject, openThread } from "../state/navigate";
import { IconBranch, IconChat, IconClock, IconCode, IconMonitor, IconFolder, IconPin, IconSettings } from "./icons";
import { forkSource, forkSourceTitle, openForkSource } from "../state/fork";
import { IconSnooze } from "./nav-icons";
import { ProjectGlyph } from "./ProjectGlyph";
import { ChatProjectGlyph } from "./ChatProjectGlyph";
import { openEditProject } from "./dialog-state";
import { editChatProject } from "./chat-projects";

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
  return model.hasOlder()
    ? plural(n, "minst {count} melding", "minst {count} meldinger")
    : plural(n, "{count} melding", "{count} meldinger");
}

function ThreadCard(props: { thread: Thread }) {
  const project = createMemo(() => (props.thread.projectId ? app.projects[props.thread.projectId] : undefined));
  const chatProject = createMemo(() => props.thread.chatProjectId ? app.chatProjects[props.thread.chatProjectId] : undefined);
  const parent = createMemo(() => (props.thread.parentThreadId ? app.threads[props.thread.parentThreadId] : undefined));
  // The model is loaded when the pointer reaches the row (preloadThread), so this is usually known.
  const model = () => peekModel(props.thread.id);
  const snoozed = () => (props.thread.snoozedUntil && props.thread.snoozedUntil > Date.now() ? props.thread.snoozedUntil : null);
  // v1.2.0: the branch of the project, for Kode threads; the coloured mark of the model's company
  // or service for every thread, Chat too.
  createEffect(() => { if (props.thread.projectId && app.projects[props.thread.projectId]) loadGitInfo(props.thread.projectId); });
  const git = () => (props.thread.projectId && app.projects[props.thread.projectId] ? gitInfo(props.thread.projectId) : undefined);
  const provider = () => modelProvider(props.thread.modelId);
  const state = () => threadState(props.thread, false);
  return (
    <>
      <div class="hover-card-head">
        <span class="hover-card-title">{props.thread.title}</span>
        <span class="hover-card-age">{relativeTime(props.thread.updatedAt)}</span>
      </div>
      <div class="hover-card-row">
        <Show when={project()} fallback={<>{props.thread.mode === "code" ? <IconMonitor size={14} /> : <IconChat size={14} />}<span>{props.thread.mode === "code" ? t("Kode · Denne datamaskinen") : chatProject() ? t("Chat · {name}", { name: chatProject()!.name }) : t("Chat uten prosjekt")}</span></>}>
          {(p) => <><ProjectGlyph project={p()} size={14} /><span>{p().name}</span><span class="hover-card-mode">{t("Kode")}</span></>}
        </Show>
      </div>
      <Show when={git()?.branch}>
        {(branch) => <div class="hover-card-row hover-card-branch" data-testid="hover-card-branch"><IconBranch size={14} /><span>{branch()}</span><Show when={git()?.detached}><span class="hover-card-mode">{t("frakoblet HEAD")}</span></Show></div>}
      </Show>
      <div class="hover-card-row muted hover-card-facts" data-testid="hover-card-model">
        <span class="hover-card-provider" title={provider().label}><ProviderGlyph family={provider().family} size={14} /></span>
        <span>{modelName(props.thread.modelId)}</span>
        <Show when={model()}>{(m) => <span class="hover-card-count">{messageCount(m())}</span>}</Show>
      </div>
      <div class="hover-card-row muted">
        <IconClock size={14} />
        <span>{t("Sist aktiv {updated}, laget {created}", { updated: relativeTime(props.thread.updatedAt), created: new Date(props.thread.createdAt).toLocaleDateString(language(), { day: "numeric", month: "short" }) })}</span>
      </div>
      <Show when={threadStatus(props.thread)}>{(status) => <div class="hover-card-row muted hover-card-status"><span class="hover-card-state" data-state={state()} aria-hidden="true" /><span>{status()}</span></div>}</Show>
      <Show when={snoozed()}>
        {(until) => <div class="hover-card-row muted"><IconSnooze size={14} />{t("Utsatt til {time}", { time: new Date(until()).toLocaleString(language(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) })}</div>}
      </Show>
      <Show when={parent()}>
        {(p) => (
          <button type="button" class="hover-card-link" onClick={() => { hideHoverCard(); void openThread(p()); }}>
            {props.thread.origin === "agent" ? t("Laget av {title}", { title: p().title }) : t("Sidechat fra {title}", { title: p().title })}
          </button>
        )}
      </Show>
      {/* Round 14 (SPEC 30.3) */}
      <Show when={props.thread.forkedFrom}>
        <Show
          when={forkSource(props.thread)}
          fallback={<div class="hover-card-row muted"><IconBranch size={14} /><span>{t("Gaffel av {title} (slettet)", { title: props.thread.forkedFrom!.title })}</span></div>}
        >
          <button type="button" class="hover-card-link hover-card-fork" onClick={() => { hideHoverCard(); void openForkSource(props.thread); }}>
            <IconBranch size={13} /><span>{t("Gaffel av {title}", { title: forkSourceTitle(props.thread) })}</span>
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
        <Show when={props.project.pinned}><span class="hover-card-age" title={t("Festet")}><IconPin size={13} /></span></Show>
      </div>
      <div class="hover-card-row"><IconCode size={14} /><span>{plural(count(), "{count} tråd i Kode", "{count} tråder i Kode")}</span></div>
      <div class="hover-card-sep" />
      <div class="hover-card-row path"><IconFolder size={14} /><bdo dir="ltr">{props.project.path}</bdo></div>
      <div class="hover-card-sep" />
      <button type="button" class="hover-card-action" onClick={() => { hideHoverCard(); openEditProject(props.project.id); }}>
        <IconSettings size={14} />{t("Rediger prosjekt")}
      </button>
    </>
  );
}

function ChatProjectCard(props: { project: ChatProject }) {
  const count = createMemo(() => Object.values(app.threads).filter((thread) => thread && !thread.archived && !thread.temporary && thread.mode === "chat" && !thread.projectId && thread.chatProjectId === props.project.id).length);
  const edit = async () => {
    hideHoverCard();
    await editChatProject(props.project);
  };
  return <>
    <div class="hover-card-head"><ChatProjectGlyph project={props.project} size={15} /><span class="hover-card-title">{props.project.name}</span><Show when={props.project.pinned}><span class="hover-card-age" title={t("Festet")}><IconPin size={13} /></span></Show></div>
    <div class="hover-card-row"><IconChat size={14} /><span>{plural(count(), "{count} chat i Chat", "{count} chatter i Chat")}</span></div>
    <div class="hover-card-row muted hover-card-note"><span>{props.project.memoryMode === "shared" ? t("Egne instruksjoner og delte globale Chat-minner.") : t("Egne instruksjoner og minner for dette prosjektet.")}</span></div>
    <div class="hover-card-sep" />
    <button type="button" class="hover-card-action" onClick={() => { hideHoverCard(); openChatProject(props.project.id); }}><IconFolder size={14} />{t("Åpne prosjektet")}</button>
    <button type="button" class="hover-card-action" onClick={() => void edit()}><IconSettings size={14} />{t("Rediger prosjekt")}</button>
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
              aria-label={thread ? t("Om tråden") : t("Om prosjektet")}
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
