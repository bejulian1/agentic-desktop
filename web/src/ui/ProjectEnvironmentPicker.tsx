import { createEffect } from "solid-js";
import type { Project } from "../../../shared/protocol";
import { gitInfo, loadGitInfo } from "../state/home";
import { useProjectPicker } from "../state/project-picker";
import { openEditProject, openGitWorkspace } from "./dialog-state";
import { IconBranch, IconChevron, IconFolder, IconLaptop, IconSettings } from "./icons";
import { Popover } from "./Popover";

export function ProjectEnvironmentPicker(props: { project: Project; paneKey: string }) {
  const menu = useProjectPicker(() => props.paneKey, "environment");
  let trigger: HTMLButtonElement | undefined;
  const info = () => gitInfo(props.project.id);
  const branch = () => {
    const current = info();
    if (!current) return "Leser gren…";
    if (current.detached) return `Frakoblet HEAD · ${current.branch ?? "ukjent commit"}`;
    return current.branch ?? "Ingen Git-gren";
  };
  createEffect(() => { if (menu.open()) loadGitInfo(props.project.id); });
  const closeAndFocus = () => { menu.close(); trigger?.focus({ preventScroll: true }); };
  const edit = (tab: "general" | "agent") => {
    const id = props.project.id;
    menu.close();
    openEditProject(id, tab);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return closeAndFocus();
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelectorAll<HTMLButtonElement>("button") : []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <Popover
      class="project-environment-anchor"
      fixed portal returnFocus
      open={menu.open()}
      onClose={menu.close}
      trigger={<button
        type="button"
        class="context-chip project-environment-button"
        data-testid="project-environment-button"
        ref={trigger}
        aria-label="Konfigurer lokalt miljø"
        title="Konfigurer lokalt miljø"
        aria-haspopup="dialog"
        aria-expanded={menu.open()}
        onPointerDown={(event) => { if (menu.open()) event.preventDefault(); }}
        onClick={(event) => { const closing = menu.open(); menu.toggle(); if (closing) event.currentTarget.focus({ preventScroll: true }); }}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); menu.show(); } }}
      ><IconSettings size={15} /></button>}
    >
      <div
        class="project-environment-menu"
        role="dialog"
        aria-label="Konfigurer lokalt miljø"
        data-testid="project-environment-menu"
        onKeyDown={onKey}
        onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) menu.close(); }}
        ref={(element) => requestAnimationFrame(() => element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }))}
      >
        <div class="menu-heading">Konfigurer lokalt miljø</div>
        <button type="button" class="project-environment-row menu-item" title="Velg gren eller opprett et arbeidstre" onClick={() => { menu.close(); openGitWorkspace(props.project.id); }}><IconBranch size={14} /><span>Gren</span><span class="project-environment-value" data-testid="project-environment-branch">{branch()}</span><IconChevron size={12} /></button>
        <div class="project-environment-row"><IconLaptop size={14} /><span>Miljø</span><span class="project-environment-value">Denne datamaskinen</span></div>
        <button type="button" class="menu-item" onClick={() => { menu.close(); openGitWorkspace(props.project.id, true); }}><IconBranch size={14} /><span class="menu-name">Nytt arbeidstre</span><IconChevron size={12} /></button>
        <div class="menu-sep" role="separator" />
        <button type="button" class="menu-item" onClick={() => edit("general")} title={props.project.path}>
          <IconFolder size={14} /><span class="menu-stack"><span class="menu-name">Prosjektmappe</span><span class="picker-path">{props.project.path}</span></span><IconChevron size={12} />
        </button>
        <button type="button" class="menu-item" onClick={() => edit("agent")}><IconSettings size={14} /><span class="menu-name">Prosjektinnstillinger</span><IconChevron size={12} /></button>
      </div>
    </Popover>
  );
}
