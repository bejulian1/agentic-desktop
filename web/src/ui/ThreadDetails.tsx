// The Tråddetaljer button in the top bar (Kode) and the card it opens below itself: three groups.
// Prosjekt (where the thread works, VS Code, the project's settings), Git og endringer (the
// branch, the Git workspace and what the thread changed), and Underagenter (the threads other
// agents made from this one, listed in the card so the sidebar need not open).
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { Thread } from "../../../shared/protocol";
import { plural, t } from "../lib/i18n";
import { relativeTime } from "../lib/format";
import { app, currentProject, mode, modelName, setSettingsOpen } from "../state/app";
import { actions, focusedThread } from "../state/actions";
import { gitInfo, loadGitInfo } from "../state/home";
import { openThread } from "../state/navigate";
import { chatProjectPageId, diffStats, loadDiffStats, profileOpen } from "../state/nav";
import { showPanel } from "../state/panel";
import { openVscode } from "../state/project-actions";
import { room } from "../state/artifacts";
import { skillsOpen } from "../state/skills-workspace";
import { studioOpen } from "../state/studio";
import { displayKeys, keysFor } from "../state/shortcuts";
import { STATE_LABEL, threadState } from "../state/thread-status";
import { setThreadDetailsOpen, threadDetailsOpen } from "../state/thread-details";
import { openGitWorkspace } from "./dialog-state";
import { IconBranch, IconChevron, IconDiff, IconFolder, IconInfo, IconMonitor, IconSettings, IconVsCode } from "./icons";
import { Popover } from "./Popover";
import { ProjectGlyph } from "./ProjectGlyph";
import { modelProvider, ProviderGlyph } from "./ProviderGlyph";

const away = () => !!room() || profileOpen() || skillsOpen() || (mode() === "chat" && !!chatProjectPageId());
const available = () => mode() === "code" && !away() && !studioOpen();

function Row(props: { icon: JSX.Element; label: JSX.Element; hint?: JSX.Element; onClick: () => void; testid?: string; expanded?: boolean; title?: string }) {
  return (
    <button type="button" class="details-row" data-testid={props.testid} aria-expanded={props.expanded} title={props.title} onClick={props.onClick}>
      <span class="details-row-icon">{props.icon}</span>
      <span class="details-row-label">{props.label}</span>
      <Show when={props.hint !== undefined}><span class="details-row-hint">{props.hint}</span></Show>
    </button>
  );
}

function Card(props: { close: () => void }) {
  const project = () => currentProject();
  const thread = () => focusedThread();
  const run = (fn: () => unknown) => {
    props.close();
    void fn();
  };
  createEffect(() => {
    const p = project();
    if (p) loadGitInfo(p.id);
  });
  loadDiffStats();
  const branch = () => (project() ? gitInfo(project()!.id) : undefined);
  const stat = () => (thread() ? diffStats()[thread()!.id] : undefined);
  // The threads made from this one, or else the project's other agent threads.
  const own = createMemo(() => Object.values(app.threads).filter((x): x is Thread => !!x && !x.archived && !!thread() && x.parentThreadId === thread()!.id));
  const projectAgents = createMemo(() => Object.values(app.threads).filter((x): x is Thread => !!x && !x.archived && x.origin === "agent" && !!project() && x.projectId === project()!.id && x.id !== thread()?.id));
  const subagents = () => (own().length ? own() : projectAgents());
  const subTitle = () => (own().length ? t("Underagenter") : t("Tidligere agenter"));
  const [list, setList] = createSignal(false);
  const sorted = createMemo(() => [...subagents()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8));
  return (
    <div class="details-card" role="dialog" aria-label={t("Tråddetaljer")} data-testid="thread-details-card" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); props.close(); } }}>
      <div class="details-group" data-group="project">
        <div class="details-project">
          <span class="details-project-glyph" aria-hidden="true"><Show when={project()} fallback={<IconMonitor size={16} />}>{(p) => <ProjectGlyph project={p()} size={16} />}</Show></span>
          <span class="details-project-text">
            <strong>{project() ? project()!.name : t("Denne datamaskinen")}</strong>
            <Show when={project()}>{(p) => <bdo dir="ltr" class="details-path" title={p().path}>{p().path}</bdo>}</Show>
          </span>
          <Show when={project()}>
            <button type="button" class="icon-button" data-testid="details-open-files" title={t("Åpne Filer")} aria-label={t("Åpne Filer")} onClick={() => run(() => showPanel("files"))}><IconFolder size={14} /></button>
          </Show>
        </div>
        <Show when={thread()}>
          {(item) => {
            const provider = () => modelProvider(item().modelId);
            return (
              <div class="details-model" data-testid="details-model" title={provider().label}>
                <span class="details-row-icon"><ProviderGlyph family={provider().family} size={15} /></span>
                <span class="details-model-name">{modelName(item().modelId)}</span>
              </div>
            );
          }}
        </Show>
        <Show
          when={project()}
          fallback={<Row icon={<IconFolder size={15} />} label={t("Åpne mappe…")} onClick={() => run(actions.openFolder)} />}
        >
          {(p) => (
            <>
              <Row icon={<IconVsCode size={15} />} label={t("Åpne i VS Code")} title={t("Åpne prosjektmappen i VS Code")} testid="details-vscode" onClick={() => run(() => openVscode(p().id))} />
              <Row icon={<IconSettings size={15} />} label={t("Prosjektinnstillinger")} title={t("Navn, ikon, standardvalg og instruksjoner for prosjektet")} testid="details-project-settings" onClick={() => run(() => setSettingsOpen("projects"))} />
            </>
          )}
        </Show>
      </div>
      <Show when={project()}>
        {(p) => (
          <div class="details-group" data-group="git">
            <Show when={branch()?.branch}>
              {(name) => <Row icon={<IconBranch size={15} />} label={<span class="details-branch">{name()}</span>} hint={branch()?.detached ? t("frakoblet HEAD") : undefined} title={t("Gren: {name}", { name: name() })} testid="details-branch" onClick={() => run(() => openGitWorkspace(p().id))} />}
            </Show>
            <Row icon={<IconBranch size={15} />} label={t("Git-arbeidsområde")} title={t("Grener og arbeidstrær for prosjektet")} testid="details-git" onClick={() => run(() => openGitWorkspace(p().id, true))} />
            <Row
              icon={<IconDiff size={15} />}
              label={t("Endringer")}
              testid="details-changes"
              hint={stat() && (stat()!.additions || stat()!.deletions) ? <span class="details-counts"><span class="diff-add">+{stat()!.additions}</span> <span class="diff-del">−{stat()!.deletions}</span></span> : undefined}
              onClick={() => run(() => showPanel("changes"))}
            />
          </div>
        )}
      </Show>
      <div class="details-group" data-group="agents">
        <Row
          icon={<span class="details-chevron" classList={{ open: list() }}><IconChevron size={14} /></span>}
          label={subTitle()}
          hint={<span class="details-count" data-testid="details-agent-count" title={plural(subagents().length, "{count} tråd", "{count} tråder")}>{subagents().length}</span>}
          expanded={list()}
          testid="details-agents"
          onClick={() => setList(!list())}
        />
        <Show when={list()}>
          <ul class="details-agent-list" aria-label={subTitle()}>
            <For each={sorted()} fallback={<li class="details-empty">{t("Ingen ennå. Agenter som tråden starter, står her.")}</li>}>
              {(agent) => (
                <li>
                  <button type="button" class="details-agent" data-testid="details-agent" onClick={() => run(() => openThread(agent))}>
                    <span class="thread-dot" data-state={threadState(agent, false)} title={STATE_LABEL[threadState(agent, false)] || undefined} />
                    <span class="details-agent-title">{agent.title}</span>
                    <span class="details-agent-age">{relativeTime(agent.updatedAt)}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}

export function ThreadDetailsButton() {
  // The card goes with the thread, the mode and the page: it is for the thread on show.
  createEffect(() => { if (!available()) setThreadDetailsOpen(false); });
  createEffect(() => { focusedThread()?.id; currentProject()?.id; setThreadDetailsOpen(false); });
  let trigger: HTMLButtonElement | undefined;
  const close = () => setThreadDetailsOpen(false);
  return (
    <Show when={available()}>
      <Popover
        open={threadDetailsOpen()}
        onClose={close}
        align="right" below fixed portal stable gap={4} returnFocus
        panelClass="thread-details-popover"
        class="thread-details-anchor"
        trigger={
          <button
            ref={trigger}
            type="button"
            class="icon-button"
            data-testid="thread-details-button"
            title={t("Vis/skjul tråddetaljer ({keys})", { keys: displayKeys(keysFor("view.details")) })}
            aria-label={t("Vis/skjul tråddetaljer")}
            aria-haspopup="dialog"
            aria-expanded={threadDetailsOpen()}
            onClick={() => setThreadDetailsOpen(!threadDetailsOpen())}
          >
            <IconInfo />
          </button>
        }
      >
        <Card close={() => { close(); trigger?.focus({ preventScroll: true }); }} />
      </Popover>
    </Show>
  );
}
