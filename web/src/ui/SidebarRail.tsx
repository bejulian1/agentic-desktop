import { t } from "../lib/i18n";
import { studioOpen } from "../state/studio";
// Round 10 (SPEC 23.9): the sidebar, hidden, as a thin row of icons about 48 px wide. From the top:
// Vis sidefanen, Chat and Kode, Ny tråd, Søk, Artifacts and Skills; in Kode, pinned threads and the
// projects as small marks or favicons; at the bottom Varsler, the gear and the avatar. Every icon
// has a tip with its name and keys (the app's one tooltip reads title and data-keys), and the mode,
// the open project and the focused thread are marked. Not shown below 860 px, where the sidebar lies
// over the content as before, nor when Innstillinger → Utseende says the hidden sidebar is gone.
import { createMemo, For, Show } from "solid-js";
import type { Thread } from "../../../shared/protocol";
import { app, listed, mode, projectId, setMode, setProjectId, setSettingsOpen, setSidebarOpen, sortedChatProjects, sortedProjects } from "../state/app";
import { actions, focusedThread } from "../state/actions";
import { skillsOpen } from "../state/skills-workspace";
import { openArtifacts, room } from "../state/artifacts";
import { chatProjectPageId, closeProfile } from "../state/nav";
import { openChatProject, openThread } from "../state/navigate";
import { displayKeys, keysFor } from "../state/shortcuts";
import { enterMode, enterStudio } from "./ModeSwitch";
import { ProjectGlyph } from "./ProjectGlyph";
import { ChatProjectGlyph } from "./ChatProjectGlyph";
import { preloadSettings } from "./lazy-views";
import { Notifications, ProfileMenu } from "./Sidebar";
import { IconArtifact, IconChat, IconCode, IconCompose, IconPin, IconSearch, IconSettings, IconSidebar, IconSpark, IconStudio } from "./icons";

const tip = (name: string, keys?: string) => (keys && keysFor(keys) ? `${name} (${displayKeys(keysFor(keys))})` : name);

export function SidebarRail() {
  const code = () => mode() === "code";
  const pinned = createMemo(() => Object.values(app.threads).filter((t): t is Thread => listed(t) && !!t.pinned && !t.archived && (code() ? t.mode === "code" : t.mode !== "code")).slice(0, 6));
  // Pinned projects first, the way the sidebar shows them under Festet.
  const projects = createMemo(() => {
    const list = sortedProjects();
    return [...list.filter((p) => p.pinned), ...list.filter((p) => !p.pinned)];
  });
  const openProject = (id: string) => {
    closeProfile();
    setProjectId(id);
    setMode("code");
  };
  return (
    <nav class="sidebar-rail" aria-label={t("Snarveier")} data-testid="sidebar-rail">
      <div class="rail-group">
        <button type="button" class="icon-button rail-button" aria-label={t("Vis sidefanen")} title={tip(t("Vis sidefanen"), "view.sidebar")} onClick={() => setSidebarOpen(true)}><IconSidebar size={16} /></button>
        <div class="rail-modes" role="group" aria-label={t("Modus")}>
          <button type="button" class="icon-button rail-button" aria-label={t("Chat")} title={tip(t("Chat"), "view.mode")} aria-pressed={!code()} onClick={() => enterMode("chat")}><IconChat size={16} /></button>
          <button type="button" class="icon-button rail-button" aria-label={t("Kode")} title={tip(t("Kode"), "view.mode")} aria-pressed={code() && !studioOpen()} onClick={() => enterMode("code")}><IconCode size={16} /></button>
          <button type="button" class="icon-button rail-button" aria-label={t("Studio")} title={tip(t("Kode Studio"), "view.mode")} aria-pressed={code() && studioOpen()} onClick={enterStudio}><IconStudio size={16} /></button>
        </div>
        <button type="button" class="icon-button rail-button" aria-label={t("Ny tråd")} title={tip(t("Ny tråd"), "thread.new")} onClick={() => actions.newThread()}><IconCompose size={16} /></button>
        <button type="button" class="icon-button rail-button" aria-label={t("Søk i tråder")} title={tip(t("Søk i tråder"), "thread.search")} onClick={() => actions.searchThreads()}><IconSearch size={16} /></button>
        <button type="button" class="icon-button rail-button" aria-label={t("Artifacts")} title={t("Artifacts")} aria-current={room() ? "page" : undefined} onClick={() => { closeProfile(); openArtifacts(); }}><IconArtifact size={16} /></button>
        <button type="button" class="icon-button rail-button" aria-label={t("Skills")} title={t("Skills")} aria-current={skillsOpen() ? "page" : undefined} onClick={() => actions.skills()}><IconSpark size={16} /></button>
      </div>
      <div class="rail-scroll">
        <Show when={pinned().length}>
          <span class="rail-sep" aria-hidden="true" />
          <For each={pinned()}>
            {(thread) => (
              <button
                type="button"
                class="icon-button rail-button rail-thread"
                aria-label={t("Festet: {title}", { title: thread.title })}
                title={t("Festet: {title}", { title: thread.title })}
                aria-current={focusedThread()?.id === thread.id ? "true" : undefined}
                onClick={() => { closeProfile(); void openThread(thread); }}
              >
                <IconPin size={15} />
              </button>
            )}
          </For>
        </Show>
        <Show when={!code() && sortedChatProjects().length}>
          <span class="rail-sep" aria-hidden="true" />
          <For each={sortedChatProjects()}>
            {(project) => (
              <button
                type="button"
                class="icon-button rail-button rail-project"
                aria-label={t("Prosjekt: {name}", { name: project.name })}
                title={project.pinned ? t("{name} (festet)", { name: project.name }) : project.name}
                aria-current={chatProjectPageId() === project.id && !room() && !skillsOpen() ? "page" : undefined}
                onClick={() => openChatProject(project.id)}
              >
                <ChatProjectGlyph project={project} size={16} />
              </button>
            )}
          </For>
        </Show>
        <Show when={code() && projects().length}>
          <span class="rail-sep" aria-hidden="true" />
          <For each={projects()}>
            {(project) => (
              <button
                type="button"
                class="icon-button rail-button rail-project"
                aria-label={t("Prosjekt: {name}", { name: project.name })}
                title={project.pinned ? t("{name} (festet)", { name: project.name }) : project.name}
                aria-current={code() && projectId() === project.id && !room() && !skillsOpen() ? "page" : undefined}
                onClick={() => openProject(project.id)}
              >
                <ProjectGlyph project={project} size={16} />
              </button>
            )}
          </For>
        </Show>
      </div>
      <div class="rail-group rail-foot">
        <Notifications rail />
        <button type="button" class="icon-button rail-button" aria-label={t("Innstillinger")} title={tip(t("Innstillinger for {mode}", { mode: code() ? t("Kode") : t("Chat") }), "settings.open")} onClick={() => setSettingsOpen(code() ? "code" : "chat")} onPointerEnter={preloadSettings} onFocus={preloadSettings}><IconSettings size={16} /></button>
        <ProfileMenu rail />
      </div>
    </nav>
  );
}
