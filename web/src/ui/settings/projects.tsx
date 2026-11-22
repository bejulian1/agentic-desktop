// Innstillinger → Prosjekter (v1.3.0, as in T3 Code): «Gjelder for» at the top says what the page is
// about, and is always there, also with no projects: Ingen prosjekt (Denne datamaskinen), a Kode
// project (archived ones too, so they can be restored) or a Chat project. Every choice is saved as
// soon as it is made, except names and instructions, which have a Lagre.
import { createEffect, createMemo, createResource, createSignal, on, Show } from "solid-js";
import { reconcile } from "solid-js/store";
import {
  MAX_PROJECT_ICON_BYTES,
  type ChatProject, type GlobalConfig, type PermissionMode, type Project, type ProjectAction, type ProjectConfig, type ReasoningEffort, type WorkspaceMode,
} from "../../../../shared/protocol";
import { del, get, patch, post, put } from "../../lib/api";
import { t } from "../../lib/i18n";
import { allProjects, app, currentProject, LOCAL_SCOPE, report, setApp, setFolderPickerOpen, sortedChatProjects, toast } from "../../state/app";
import { gitInfo, loadGitInfo } from "../../state/home";
import { actionsEditorRequest, runProjectAction, takeActionsEditorRequest } from "../../state/project-actions";
import { removeChatProject } from "../chat-projects";
import { ChatProjectGlyph } from "../ChatProjectGlyph";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "../ContextMenu";
import { confirmDialog, pickFolder } from "../dialogs";
import { IconArchive, IconBranch, IconChevronDown, IconFolder, IconImage, IconInfo, IconMonitor, IconPlus, IconTrash } from "../icons";
import { ProjectGlyph } from "../ProjectGlyph";
import { Select } from "../Select";
import { Group, Page, reset, Row, save, Segmented, Toggle } from "./parts";
import { ActionsCard, ChatIconDialog, InstructionsEditor, ModelEffortPicker, ProjectIconDialog } from "./project-parts";
import "../../styles/projects-settings.css";

const UPLOAD_TYPES: Record<string, string> = { png: "image/png", svg: "image/svg+xml", ico: "image/x-icon", webp: "image/webp" };

const permissionOptions = (): Array<{ value: PermissionMode; label: string }> => [
  { value: "ask", label: t("Spør") },
  { value: "accept-edits", label: t("Godta redigeringer") },
  { value: "full", label: t("Full tilgang") },
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The type the server expects for a picked file, from what the browser says or else the ending.
function iconType(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byName = UPLOAD_TYPES[ext];
  if (byName) return byName;
  return Object.values(UPLOAD_TYPES).includes(file.type) ? file.type : null;
}

// What the page is about: "local", "code:<id>" or "chat:<id>".
type Scope = string;
const codeScope = (id: string): Scope => `code:${id}`;
const chatScope = (id: string): Scope => `chat:${id}`;

export function ProjectsPage() {
  // Opened from Tråddetaljer with a scope, from a project's settings, or else the project on show.
  const initial = (): Scope => {
    const asked = actionsEditorRequest();
    if (asked === LOCAL_SCOPE) return "local";
    if (asked && app.projects[asked]) return codeScope(asked);
    const current = currentProject();
    return current ? codeScope(current.id) : "local";
  };
  const [chosen, setChosen] = createSignal<Scope>(initial());
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  // Tråddetaljer → Legg til prosjektskript while this page is open already.
  createEffect(on(actionsEditorRequest, (asked) => {
    if (asked === LOCAL_SCOPE) setChosen("local");
    else if (asked && app.projects[asked]) setChosen(codeScope(asked));
  }, { defer: true }));
  // A project removed elsewhere, or here, leaves the page on Ingen prosjekt.
  const scope = createMemo((): Scope => {
    const value = chosen();
    if (value.startsWith("code:") && !app.projects[value.slice(5)]) return "local";
    if (value.startsWith("chat:") && !app.chatProjects[value.slice(5)]) return "local";
    return value;
  });
  const codeProject = () => (scope().startsWith("code:") ? app.projects[scope().slice(5)] : undefined);
  const chatProject = () => (scope().startsWith("chat:") ? app.chatProjects[scope().slice(5)] : undefined);
  const archived = () => allProjects().filter((p) => p.archived);
  const active = () => allProjects().filter((p) => !p.archived);

  const entries = (): MenuEntry[] => {
    const list: MenuEntry[] = [
      { label: t("Ingen prosjekt (Denne datamaskinen)"), icon: IconMonitor, chosen: scope() === "local", run: () => setChosen("local") },
    ];
    const code = (p: Project): MenuEntry => ({ label: p.name, icon: (props) => <ProjectGlyph project={p} size={props.size ?? 15} />, chosen: scope() === codeScope(p.id), hint: p.archived ? t("arkivert") : undefined, run: () => setChosen(codeScope(p.id)) });
    if (active().length) list.push({ heading: t("Kode-prosjekter") }, ...active().map(code));
    if (archived().length) list.push({ heading: t("Arkiverte") }, ...archived().map(code));
    const chats = sortedChatProjects();
    if (chats.length) list.push({ heading: t("Chat-prosjekter") }, ...chats.map((p): MenuEntry => ({ label: p.name, icon: (props) => <ChatProjectGlyph project={p} size={props.size ?? 15} />, chosen: scope() === chatScope(p.id), run: () => setChosen(chatScope(p.id)) })));
    return list;
  };

  return (
    <Page title={t("Prosjekter")} intro={t("Valg som gjelder ett prosjekt, eller tråder uten prosjekt: hva nye tråder starter med, handlinger, instruksjoner og mer.")} class="projects-page">
      <div class="projects-scope" data-testid="projects-scope">
        <span class="projects-scope-label" id="projects-scope-label">{t("Gjelder for")}</span>
        <button
          type="button"
          class="btn btn-small select-button projects-scope-button"
          aria-labelledby="projects-scope-label projects-scope-value"
          aria-haspopup="menu"
          aria-expanded={!!menu()}
          onClick={(e) => setMenu(menu() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}
        >
          <Show when={codeProject()} fallback={<Show when={chatProject()} fallback={<IconMonitor size={15} />}>{(p) => <ChatProjectGlyph project={p()} size={15} />}</Show>}>
            {(p) => <ProjectGlyph project={p()} size={15} />}
          </Show>
          <span class="select-value" id="projects-scope-value">{codeProject()?.name ?? chatProject()?.name ?? t("Ingen prosjekt (Denne datamaskinen)")}</span>
          <IconChevronDown size={13} />
        </button>
        <Show when={menu()}>{(anchor) => <ContextMenu anchor={anchor()} label={t("Prosjekt")} class="select-menu projects-scope-menu" onClose={() => setMenu(null)} entries={entries()} />}</Show>
        <button type="button" class="btn btn-small btn-quiet projects-open-folder" onClick={() => setFolderPickerOpen(true)}><IconPlus size={13} />{t("Åpne mappe…")}</button>
      </div>
      <Show when={!codeProject()?.archived}>
        <p class="projects-callout" role="note" data-testid="projects-callout">
          <IconInfo size={15} />
          <span>{t("Finner du ikke en innstilling? Hold prosjektet valgt over, eller åpne en mappe for prosjektspesifikke valg.")}</span>
        </p>
      </Show>
      <Show when={codeProject()} keyed fallback={<Show when={chatProject()} keyed fallback={<LocalSections />}>{(p) => <ChatSections project={p} />}</Show>}>
        {(p) => <ProjectSections project={p} onRemoved={() => setChosen("local")} />}
      </Show>
    </Page>
  );
}

// Ingen prosjekt: Kode threads on Denne datamaskinen, with the app's own defaults and the global
// AGENTS.md. The choices here are the same as in Konfigurasjon and Modeller.
function LocalSections() {
  const [config, { refetch }] = createResource(() => get<GlobalConfig>("/api/config"));
  const saveActions = async (localActions: ProjectAction[]): Promise<boolean> => {
    try {
      const settings = await patch<typeof app.settings>("/api/settings", { localActions });
      setApp("settings", "localActions", settings.localActions);
      return true;
    } catch (err) {
      report(err);
      return false;
    }
  };
  const browser = () => (app.settings.agentBrowserAccess === false ? "block" : "allow");
  return (
    <>
      <Group title={t("Nye tråder")}>
        <Row label={t("Modell")} text={t("Modellen og tenkeinnsatsen nye tråder starter med, når prosjektet ikke har egne valg.")}>
          <ModelEffortPicker
            model={app.settings.defaultModelId}
            effort={app.settings.defaultReasoningEffort ?? null}
            onModel={(id) => id && save({ defaultModelId: id })}
            onEffort={(effort) => (effort ? save({ defaultReasoningEffort: effort }) : reset("defaultReasoningEffort"))}
          />
        </Row>
        <Row label={t("Standard tillatelsesmodus")} text={t("Hva agenten får gjøre uten å spørre, i nye prosjekter og på Denne datamaskinen.")}>
          <Select<PermissionMode> label={t("Standard tillatelsesmodus")} value={app.settings.defaultPermissionMode} options={permissionOptions()} onChange={(defaultPermissionMode) => save({ defaultPermissionMode })} />
        </Row>
        <Row label={t("Agenttilgang til nettleseren")} text={t("Om agenter kan bruke den delte nettleseren. Et prosjekt kan overstyre dette.")}>
          <Select<string> label={t("Agenttilgang til nettleseren")} value={browser()} options={[{ value: "allow", label: t("Tillat") }, { value: "block", label: t("Av") }]} onChange={(v) => save({ agentBrowserAccess: v === "allow" })} />
        </Row>
      </Group>
      <Group title={t("Handlinger")}>
        <ActionsCard
          actions={app.settings.localActions ?? []}
          text={t("Kommandoer som kjøres i hjemmemappen på Denne datamaskinen, med valgfri hurtigtast. Finnes også i Tråddetaljer.")}
          worktrees={false}
          openNew={actionsEditorRequest() === LOCAL_SCOPE}
          onOpened={() => takeActionsEditorRequest(LOCAL_SCOPE)}
          onChange={saveActions}
          onRun={(action) => runProjectAction(LOCAL_SCOPE, action)}
        />
      </Group>
      <Group title={t("Instruksjoner")}>
        <InstructionsEditor
          label={t("Globale instruksjoner")}
          text={t("AGENTS.md i appens konfigurasjonsmappe. Gjelder alle Kode-tråder; et prosjekts egne instruksjoner går foran.")}
          saved={config.loading && !config() ? null : config()?.agentsMd ?? ""}
          placeholder={t("For eksempel: Svar på norsk. Kjør testene før du sier at noe er ferdig.")}
          testid="global-instructions"
          onSave={async (text) => {
            try {
              await put("/api/config/agents-md", { text });
              await refetch();
              toast(t("Lagret AGENTS.md."), "info");
            } catch (err) {
              report(err);
            }
          }}
        />
      </Group>
      <Group title={t("Prosjektmapper")}>
        <Row label={t("Åpne en mappe")} text={t("En mappe på maskinen blir et Kode-prosjekt med egne valg, handlinger og instruksjoner.")} icon={IconFolder}>
          <button type="button" class="btn btn-small" onClick={() => setFolderPickerOpen(true)}>{t("Åpne mappe…")}</button>
        </Row>
      </Group>
    </>
  );
}

function ProjectSections(props: { project: Project; onRemoved: () => void }) {
  // The project in the store follows every change from the server.
  const project = () => app.projects[props.project.id] ?? props.project;
  const [name, setName] = createSignal(props.project.name);
  const [picking, setPicking] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [config, { refetch }] = createResource(() => props.project.id, (id) => get<ProjectConfig>(`/api/projects/${id}/config`));
  let fileInput!: HTMLInputElement;

  createEffect(on(() => project().name, (next) => setName(next), { defer: true }));
  createEffect(() => loadGitInfo(props.project.id));

  const apply = (next: Project) => setApp("projects", next.id, reconcile(next));
  const change = async (body: Partial<Project>, done?: string): Promise<boolean> => {
    try {
      apply(await patch<Project>(`/api/projects/${props.project.id}`, body));
      if (done) toast(done, "info");
      return true;
    } catch (err) {
      report(err);
      return false;
    }
  };

  const saveName = () => {
    const next = name().trim();
    if (!next) return toast(t("Navnet kan ikke være tomt."));
    if (next !== project().name) void change({ name: next });
  };

  const uploadIcon = async (file: File) => {
    const mime = iconType(file);
    if (!mime) return toast(t("Velg et PNG-, SVG-, ICO- eller WebP-bilde."));
    if (file.size > MAX_PROJECT_ICON_BYTES) return toast(t("Bildet er for stort. Velg et på høyst {size} KB.", { size: MAX_PROJECT_ICON_BYTES / 1024 }));
    setBusy(true);
    try {
      const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      apply(await post<Project>(`/api/projects/${props.project.id}/icon`, { mime, data }));
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const useFavicon = async () => {
    if (!project().icon) return;
    try {
      apply(await del<Project>(`/api/projects/${props.project.id}/icon`));
    } catch (err) {
      report(err);
    }
  };

  const move = async () => {
    const folder = await pickFolder(project().path);
    if (!folder || folder === project().path) return;
    await change({ path: folder }, t("Prosjektmappen er byttet."));
    void refetch();
    loadGitInfo(props.project.id);
  };

  const archive = async () => {
    const next = !project().archived;
    await change({ archived: next }, next ? t("«{name}» er arkivert. Trådene og filene er beholdt.", { name: project().name }) : t("«{name}» er gjenopprettet.", { name: project().name }));
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: t("Fjerne prosjektet?"), text: t("«{name}» og trådene fjernes fra appen. Mappen og filene på disken røres aldri.", { name: project().name }), confirm: t("Fjern"), danger: true });
    if (!ok) return;
    try {
      await del(`/api/projects/${props.project.id}`);
      props.onRemoved();
    } catch (err) {
      report(err);
    }
  };

  const iconText = () => {
    const icon = project().icon;
    if (!icon) return t("Prosjektets favicon, ellers en mappe");
    if (icon.startsWith("file:")) return t("Eget bilde");
    if (icon.startsWith("emoji:")) return t("Emoji {emoji}", { emoji: icon.slice(6) });
    if (icon.startsWith("mono:")) return t("Monogram {text}", { text: icon.slice(5) });
    return icon;
  };
  const browserValue = () => (project().agentBrowserAccess == null ? "inherit" : project().agentBrowserAccess ? "allow" : "block");
  const browserOptions = () => [
    { value: "inherit", label: app.settings.agentBrowserAccess === false ? t("Følg global (av)") : t("Følg global (på)") },
    { value: "allow", label: t("Tillat") },
    { value: "block", label: t("Av") },
  ];
  const branch = () => gitInfo(props.project.id);

  return (
    <>
      <Show when={project().archived}>
        <p class="projects-callout projects-archived-note" role="status" data-testid="project-archived-note">
          <IconArchive size={15} />
          <span>{t("Prosjektet er arkivert og vises ikke i sidefanen eller prosjektvelgerne. Trådene og filene er beholdt.")}</span>
        </p>
      </Show>
      <Group title={t("Generelt")}>
        <Row label={t("Navn")} text={t("Vises i sidefanen og overalt ellers i appen. Mappen på disken får ikke nytt navn.")}>
          <form class="projects-name" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
            <input class="input" aria-label={t("Navn")} value={name()} maxlength={80} onInput={(e) => setName(e.currentTarget.value)} onBlur={() => { if (name().trim() && name().trim() !== project().name) saveName(); }} />
            <button type="submit" class="btn btn-small" disabled={!name().trim() || name().trim() === project().name}>{t("Lagre")}</button>
          </form>
        </Row>
        <div class="setting projects-icon-row" data-testid="project-icon-row">
          <div class="setting-text">
            <strong>{t("Prosjektikon")}</strong>
            <span class="muted">{iconText()}</span>
          </div>
          <div class="setting-control projects-icon-actions">
            <span class="projects-icon-preview" aria-hidden="true"><ProjectGlyph project={project()} size={24} /></span>
            <button type="button" class="btn btn-small" aria-haspopup="dialog" onClick={() => setPicking(true)}>{t("Velg ikon")}</button>
            <input
              ref={fileInput}
              type="file"
              class="sr-only"
              tabindex={-1}
              accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp,.png,.svg,.ico,.webp"
              aria-label={t("Last opp ikon")}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void uploadIcon(file);
              }}
            />
            <button type="button" class="btn btn-small" disabled={busy()} onClick={() => fileInput.click()}><IconImage size={14} />{t("Velg fil")}</button>
            <button type="button" class="btn btn-small btn-quiet" disabled={!project().icon} title={t("Bruk prosjektets favicon hvis det har et, ellers en mappe")} onClick={() => void useFavicon()}>{t("Bruk favicon")}</button>
          </div>
        </div>
        <Show when={picking()}>
          <ProjectIconDialog
            icon={project().icon}
            color={project().color}
            name={project().name}
            onClose={() => setPicking(false)}
            onSave={async (icon, color) => {
              const body: Partial<Project> = {};
              if (icon !== project().icon) body.icon = icon;
              if (color !== project().color) body.color = color;
              if (!Object.keys(body).length || (await change(body))) setPicking(false);
            }}
          />
        </Show>
        <Toggle label={t("Fest prosjekt")} text={t("Festede prosjekter står først i sidefanen og prosjektvelgerne.")} checked={project().pinned} onChange={(pinned) => void change({ pinned })} />
        <Row label={t("Arkiver prosjekt")} text={t("Skjuler prosjektet i sidefanen og prosjektvelgerne. Trådene og filene beholdes.")}>
          <button type="button" class="btn btn-small" data-testid="project-archive" onClick={() => void archive()}>{project().archived ? t("Gjenopprett") : t("Arkiver")}</button>
        </Row>
      </Group>

      <Group title={t("Nye tråder")}>
        <Row label={t("Modell")} text={t("Modellen og tenkeinnsatsen nye tråder i prosjektet starter med.")}>
          <ModelEffortPicker
            model={project().defaultModelId ?? null}
            effort={project().defaultReasoningEffort ?? null}
            inheritLabel={t("Appens standard")}
            onModel={(defaultModelId) => void change({ defaultModelId })}
            onEffort={(defaultReasoningEffort: ReasoningEffort | null) => void change({ defaultReasoningEffort })}
          />
        </Row>
        <Row label={t("Arbeidsområde")} text={t("Hvor nye tråder i prosjektet starter. Nytt arbeidstre spør etter en gren og åpner en egen Git-mappe først.")}>
          <Segmented<WorkspaceMode>
            label={t("Arbeidsområde")}
            value={project().defaultWorkspaceMode ?? "local"}
            options={[{ value: "local", label: t("Gjeldende mappe") }, { value: "worktree", label: t("Nytt arbeidstre") }]}
            onChange={(defaultWorkspaceMode) => void change({ defaultWorkspaceMode })}
          />
        </Row>
        <Row label={t("Tillatelsesmodus")} text={t("Hva agenten får gjøre uten å spørre i dette prosjektet.")}>
          <Select<PermissionMode> label={t("Tillatelsesmodus")} value={project().permissionMode} options={permissionOptions()} onChange={(permissionMode) => void change({ permissionMode })} />
        </Row>
        <Row label={t("Agenttilgang til nettleseren")} text={t("Overstyrer den globale innstillingen for dette prosjektet.")}>
          <Select<string>
            label={t("Agenttilgang til nettleseren")}
            value={browserValue()}
            options={browserOptions()}
            onChange={(v) => void change({ agentBrowserAccess: v === "inherit" ? null : v === "allow" })}
          />
        </Row>
      </Group>

      <Group title={t("Handlinger")}>
        <ActionsCard
          actions={project().actions ?? []}
          text={t("Kommandoer som kjøres i prosjektmappen eller et arbeidstre av den, med valgfri hurtigtast. Finnes også i Tråddetaljer.")}
          worktrees
          openNew={actionsEditorRequest() === props.project.id}
          onOpened={() => takeActionsEditorRequest(props.project.id)}
          onChange={(actions) => change({ actions })}
          onRun={(action) => runProjectAction(props.project.id, action)}
        />
      </Group>

      <Group title={t("Utsjekkinger")}>
        <div class="setting projects-checkout" data-testid="project-checkout">
          <IconFolder size={16} />
          <div class="setting-text">
            <strong>
              {project().name}
              <Show when={branch()?.branch}>{(name) => <span class="projects-branch" data-testid="project-branch" title={branch()?.detached ? t("frakoblet HEAD") : t("Gren: {name}", { name: name() })}><IconBranch size={12} />{name()}</span>}</Show>
            </strong>
            <bdo dir="ltr" class="projects-path">{project().path}</bdo>
            <Show when={project().folderMissing}><span class="field-error">{t("Fant ikke mappen. Velg den på nytt.")}</span></Show>
          </div>
          <div class="setting-control">
            <button type="button" class="btn btn-small" onClick={() => void move()}>{t("Bytt mappe…")}</button>
          </div>
        </div>
      </Group>

      <Group title={t("Instruksjoner")}>
        <InstructionsEditor
          label={t("Instruksjoner for prosjektet")}
          text={t("Gjelder bare dette prosjektet, og går foran de globale instruksjonene. Ligger i .agentic/AGENTS.md i prosjektmappen.")}
          saved={config.loading && !config() ? null : config()?.project.agentsMd ?? ""}
          placeholder={t("Gjelder bare dette prosjektet, og går foran de globale instruksjonene.")}
          onSave={async (text) => {
            try {
              await put(`/api/projects/${props.project.id}/instructions`, { text });
              await refetch();
              toast(t("Lagret .agentic/AGENTS.md."), "info");
            } catch (err) {
              report(err);
            }
          }}
        />
      </Group>

      <Group title={t("Faresone")}>
        <Row label={t("Fjern prosjektet")} text={t("Prosjektet og trådene fjernes fra appen. Mappen og filene på disken røres aldri.")}>
          <button type="button" class="btn btn-small btn-quiet-danger projects-danger" onClick={() => void remove()}><IconTrash size={13} />{t("Fjern prosjektet…")}</button>
        </Row>
      </Group>
    </>
  );
}

// A Chat project: a name to gather chats under, with its own instructions and memory.
function ChatSections(props: { project: ChatProject }) {
  const project = () => app.chatProjects[props.project.id] ?? props.project;
  const [name, setName] = createSignal(props.project.name);
  const [picking, setPicking] = createSignal(false);
  createEffect(on(() => project().name, (next) => setName(next), { defer: true }));
  const change = async (body: Partial<ChatProject>, done?: string): Promise<boolean> => {
    try {
      const next = await patch<ChatProject>(`/api/chat-projects/${encodeURIComponent(props.project.id)}`, body);
      setApp("chatProjects", next.id, reconcile(next));
      if (done) toast(done, "info");
      return true;
    } catch (err) {
      report(err);
      return false;
    }
  };
  const saveName = () => {
    const next = name().trim();
    if (!next) return toast(t("Navnet kan ikke være tomt."));
    if (next !== project().name) void change({ name: next });
  };
  return (
    <>
      <Group title={t("Generelt")}>
        <Row label={t("Navn")} text={t("Vises i sidefanen i Chat.")}>
          <form class="projects-name" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
            <input class="input" aria-label={t("Navn")} value={name()} maxlength={200} onInput={(e) => setName(e.currentTarget.value)} />
            <button type="submit" class="btn btn-small" disabled={!name().trim() || name().trim() === project().name}>{t("Lagre")}</button>
          </form>
        </Row>
        <div class="setting projects-icon-row" data-testid="chat-icon-row">
          <div class="setting-text">
            <strong>{t("Prosjektikon")}</strong>
            <span class="muted">{t("Et av ikonene for Chat-prosjekter, i en farge.")}</span>
          </div>
          <div class="setting-control projects-icon-actions">
            <span class="projects-icon-preview" aria-hidden="true"><ChatProjectGlyph project={project()} size={24} /></span>
            <button type="button" class="btn btn-small" aria-haspopup="dialog" onClick={() => setPicking(true)}>{t("Velg ikon")}</button>
          </div>
        </div>
        <Show when={picking()}>
          <ChatIconDialog
            icon={project().icon}
            color={project().color}
            onClose={() => setPicking(false)}
            onSave={async (icon, color) => { if (await change({ icon, color })) setPicking(false); }}
          />
        </Show>
        <Toggle label={t("Fest prosjekt")} text={t("Festede prosjekter står først i Chat.")} checked={project().pinned} onChange={(pinned) => void change({ pinned })} />
      </Group>
      <Group title={t("Minne")}>
        <Row label={t("Minner")} text={t("Eget minne holder prosjektets minner for seg. Delt minne bruker de samme minnene som vanlig Chat.")}>
          <Segmented<"project" | "shared">
            label={t("Minner")}
            value={project().memoryMode}
            options={[{ value: "project", label: t("Eget minne") }, { value: "shared", label: t("Delt minne") }]}
            onChange={(memoryMode) => void change({ memoryMode })}
          />
        </Row>
        <Toggle label={t("La modellen lagre nye minner")} text={t("Gjelder bare dette prosjektet og den valgte minnetypen.")} checked={project().autoMemory} onChange={(autoMemory) => void change({ autoMemory })} />
      </Group>
      <Group title={t("Instruksjoner")}>
        <InstructionsEditor
          label={t("Instruksjoner for Chat-prosjektet")}
          text={t("Fortell hvordan modellen skal svare i chattene i prosjektet. Brukes i stedet for Chat-personaliseringen.")}
          saved={project().instructions}
          placeholder={t("For eksempel: Svar på norsk. Bruk kildene og begrepene vi har avtalt i prosjektet.")}
          onSave={async (instructions) => { await change({ instructions }, t("Instruksjonene er lagret.")); }}
        />
      </Group>
      <Group title={t("Faresone")}>
        <Row label={t("Fjern Chat-prosjektet")} text={t("Prosjektets instruksjoner og egne minner slettes. Chattene beholdes under Chatter.")} icon={IconTrash}>
          <button type="button" class="btn btn-small btn-quiet-danger projects-danger" onClick={() => void removeChatProject(project())}><IconTrash size={13} />{t("Fjern prosjektet…")}</button>
        </Row>
      </Group>
    </>
  );
}
