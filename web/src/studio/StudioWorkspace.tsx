import { createEffect, createSignal, For, lazy, onCleanup, Show, Suspense, type Accessor, type JSX } from "solid-js";
import { app, mode, setFolderPickerOpen, setMode, setProjectId, settingsOpen, sortedProjects } from "../state/app";
import { studioOpen, setStudioOpen, studioTool, setStudioTool, studioAgentOpen, setStudioAgentOpen, studioMobileView, setStudioMobileView, type StudioTool } from "../state/studio";
import type { Project } from "../../../shared/protocol";
import { IconAgent, IconClose, IconDiff, IconFolderOpen, IconGlobe, IconStudio, IconTerminal } from "../ui/icons";
import { ProjectGlyph } from "../ui/ProjectGlyph";
import "./workspace.css";

const StudioFiles = lazy(() => import("./StudioFiles"));
const Terminal = lazy(() => import("../panels/Terminal"));
const Browser = lazy(() => import("../panels/Browser"));
const Changes = lazy(() => import("../panels/Changes"));

const DEFAULT_AGENT_WIDTH = 390;

export default function StudioWorkspace(props: { active: Accessor<boolean>; project?: Project; threadId: Accessor<string | null>; children: JSX.Element }) {
  const [visited, setVisited] = createSignal(false);
  const [agentWidth, setAgentWidth] = createSignal(DEFAULT_AGENT_WIDTH);
  const [resizing, setResizing] = createSignal(false);
  const projectId = () => props.project?.id;
  const visible = () => props.active() && !settingsOpen();

  createEffect(() => { if (props.active()) setVisited(true); });
  createEffect(() => { if (mode() === "chat" && studioOpen()) setStudioOpen(false); });
  // Match RightPanel: if Playtest fails while Studio is active, open Terminal to show the output.
  createEffect(() => {
    const id = projectId();
    if (visible() && id && app.playtest[id]?.status === "error") setStudioTool("terminal");
  });

  const openTool = (tool: StudioTool) => setStudioTool(studioTool() === tool ? null : tool);
  const selectProject = (id: string) => { setProjectId(id); setMode("code"); };

  let surface!: HTMLDivElement;
  let drag: { x: number; width: number } | null = null;
  const maxWidth = () => Math.max(300, Math.round((surface?.clientWidth || 1200) * 0.52));
  const clamp = (width: number) => Math.max(300, Math.min(width, maxWidth()));
  const resize = (event: PointerEvent) => {
    if (!drag) return;
    setAgentWidth(clamp(drag.width + drag.x - event.clientX));
  };
  const finish = () => { drag = null; setResizing(false); };
  onCleanup(finish);

  return (
    <div
      ref={surface}
      class="studio-workspace"
      classList={{
        "studio-active": props.active(),
        "studio-has-project": !!props.project,
        "studio-agent-hidden": !studioAgentOpen(),
        "studio-mobile-agent": studioMobileView() === "agent",
        "studio-resizing": resizing(),
      }}
      data-testid={props.active() ? "code-studio" : undefined}
      style={{ "--studio-agent-width": `${agentWidth()}px` }}
    >
      <Show when={props.active()}>
        <header class="studio-toolbar">
          <div class="studio-identity">
            <IconStudio size={17} />
            <strong>Kode Studio</strong>
            <Show when={props.project}>
              <span class="studio-project-name" title={props.project?.path}>{props.project?.name}</span>
            </Show>
          </div>
          <div class="studio-toolbar-actions">
            <Show when={props.project}>
              <div class="studio-mobile-switch" role="group" aria-label="Studio-visning">
                <button type="button" aria-pressed={studioMobileView() === "files"} onClick={() => setStudioMobileView("files")}>Filer og editor</button>
                <button type="button" aria-pressed={studioMobileView() === "agent"} onClick={() => { setStudioMobileView("agent"); setStudioAgentOpen(true); }}>Kodeagent</button>
              </div>
              <button type="button" class="studio-tool-button" aria-label="Terminal" aria-pressed={studioTool() === "terminal"} aria-controls="studio-dock" onClick={() => openTool("terminal")}>
                <IconTerminal size={14} /><span>Terminal</span>
              </button>
              <button type="button" class="studio-tool-button" aria-label="Forhåndsvisning" aria-pressed={studioTool() === "browser"} aria-controls="studio-dock" onClick={() => openTool("browser")}>
                <IconGlobe size={14} /><span>Forhåndsvisning</span>
              </button>
              <button type="button" class="studio-tool-button" aria-label="Endringer" aria-pressed={studioTool() === "changes"} aria-controls="studio-dock" onClick={() => openTool("changes")}>
                <IconDiff size={14} /><span>Endringer</span>
              </button>
              <button type="button" class="studio-tool-button studio-agent-toggle" aria-label="Agent" aria-pressed={studioAgentOpen()} onClick={() => setStudioAgentOpen(!studioAgentOpen())}>
                <IconAgent size={14} /><span>Agent</span>
              </button>
            </Show>
            <button type="button" class="studio-tool-button" aria-label="Åpne prosjektmappe" title="Åpne prosjektmappe" onClick={() => setFolderPickerOpen(true)}>
              <IconFolderOpen size={15} />
            </button>
          </div>
        </header>
        <Show when={!props.project}>
          <section class="studio-landing" data-testid="studio-landing" aria-label="Velg prosjekt for Kode Studio">
            <div class="studio-landing-mark"><IconStudio size={30} /></div>
            <h1>Prosjektet ditt, mens det blir til</h1>
            <p>Åpne filer i faner, rediger kode og jobb sammen med agenten på samme arbeidsflate. Nye filer og lagrede endringer dukker opp fortløpende.</p>
            <button type="button" class="btn primary" onClick={() => setFolderPickerOpen(true)}>
              <IconFolderOpen size={16} />Åpne prosjektmappe
            </button>
            <Show when={sortedProjects().length}>
              <div class="studio-projects">
                <h2>Dine prosjekter</h2>
                <For each={sortedProjects()}>
                  {(project) => (
                    <button type="button" class="studio-project-card" aria-label={project.name} title={project.path} onClick={() => selectProject(project.id)}>
                      <ProjectGlyph project={project} size={20} />
                      <span>
                        <strong>{project.name}</strong>
                        <small>{project.path}</small>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <small class="studio-landing-note">Bruker Kodes modeller, verktøy og godkjenninger. Chat og vanlig Kode er fortsatt tilgjengelig.</small>
          </section>
        </Show>
      </Show>
      <Show when={visited() && projectId()} keyed>
        {(id) => (
          <section class="studio-canvas" hidden={!props.active()}>
            <div class="studio-file-surface">
              <Suspense fallback={<div class="studio-loading" role="status">Åpner arbeidsflaten…</div>}>
                <StudioFiles projectId={id} threadId={props.threadId} active={visible} />
              </Suspense>
            </div>
            <Show when={props.active() && studioTool()}>
              {(tool) => (
                <section id="studio-dock" class="studio-dock" data-testid="studio-dock" aria-label="Studio-verktøy">
                  <header>
                    <strong>{tool() === "terminal" ? "Terminal" : tool() === "browser" ? "Forhåndsvisning" : "Endringer"}</strong>
                    <button type="button" class="icon-button" aria-label="Lukk Studio-verktøy" title="Lukk verktøyet" onClick={() => setStudioTool(null)}>
                      <IconClose size={14} />
                    </button>
                  </header>
                  <div class="studio-dock-content">
                    <Suspense fallback={<div class="studio-loading" role="status">Laster verktøy…</div>}>
                      <Show when={tool() === "terminal"}><Terminal projectId={id} visible={visible()} /></Show>
                      <Show when={tool() === "browser"}><Browser projectId={id} visible={visible()} /></Show>
                      <Show when={tool() === "changes"}><Changes threadId={props.threadId} /></Show>
                    </Suspense>
                  </div>
                </section>
              )}
            </Show>
          </section>
        )}
      </Show>
      <Show when={props.active() && !!props.project && studioAgentOpen()}>
        <div
          class="studio-divider"
          role="separator"
          aria-label="Bredde på kodeagent"
          aria-orientation="vertical"
          aria-valuemin={300}
          aria-valuemax={maxWidth()}
          aria-valuenow={Math.round(agentWidth())}
          title="Dra for å endre bredden. Dobbeltklikk for standard."
          tabindex="0"
          onPointerDown={(event) => {
            drag = { x: event.clientX, width: agentWidth() };
            setResizing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={resize}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onDblClick={() => setAgentWidth(DEFAULT_AGENT_WIDTH)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setAgentWidth(clamp(agentWidth() + (event.key === "ArrowLeft" ? 24 : -24)));
            } else if (event.key === "Home") {
              event.preventDefault();
              setAgentWidth(DEFAULT_AGENT_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setAgentWidth(maxWidth());
            }
          }}
        />
      </Show>
      <section class="studio-agent" hidden={props.active() && (!props.project || !studioAgentOpen())} aria-label={props.active() ? "Kodeagent" : undefined}>
        <Show when={props.active()}>
          <header class="studio-agent-heading">
            <IconAgent size={14} />
            <span>Kodeagent</span>
            <small>Samme samtale som i Kode</small>
          </header>
        </Show>
        {props.children}
      </section>
    </div>
  );
}
