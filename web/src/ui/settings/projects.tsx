// Innstillinger → Prosjekter (v1.2.0): everything about one project in one place. A picker at the
// top says which project the page is about; below it Generelt (name, icon, pin, folder), Nye tråder
// (default model, permissions, the browser), Instruksjoner (.agentic/AGENTS.md) and Faresone. Every
// choice is saved as soon as it is made, except the name and the instructions, which have a Lagre.
import { createEffect, createMemo, createResource, createSignal, on, Show } from "solid-js";
import { reconcile } from "solid-js/store";
import { MAX_PROJECT_ICON_BYTES, type PermissionMode, type Project, type ProjectConfig } from "../../../../shared/protocol";
import { del, get, patch, post, put } from "../../lib/api";
import { t } from "../../lib/i18n";
import { app, currentProject, report, setApp, setFolderPickerOpen, sortedProjects, toast } from "../../state/app";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "../ContextMenu";
import { confirmDialog, pickFolder } from "../dialogs";
import { IconChevronDown, IconFolder, IconImage, IconPin } from "../icons";
import { IconPicker } from "../EditProject";
import { ProjectGlyph } from "../ProjectGlyph";
import { Select } from "../Select";
import { Group, Page, Row, Toggle } from "./parts";

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

export function ProjectsPage() {
  const [chosen, setChosen] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  const project = (): Project | undefined => (chosen() ? app.projects[chosen()!] : undefined) ?? currentProject() ?? sortedProjects()[0];
  const entries = (): MenuEntry[] =>
    sortedProjects().map((p) => ({
      label: p.name,
      icon: (props: { size?: number }) => <ProjectGlyph project={p} size={props.size ?? 15} />,
      chosen: p.id === project()?.id,
      run: () => setChosen(p.id),
    }));
  let trigger!: HTMLButtonElement;
  return (
    <Page title={t("Prosjekter")} intro={t("Valg som gjelder ett prosjekt: navn, ikon, hva nye tråder starter med og instruksjonene agenten leser.")} class="projects-page">
      <Show
        when={project()}
        fallback={
          <Group>
            <div class="setting setting-block projects-empty" data-testid="projects-empty">
              <div class="setting-text">
                <strong>{t("Ingen prosjekter ennå")}</strong>
                <span class="muted">{t("Et prosjekt er en mappe på maskinen din. Åpne en mappe i Kode, så kan du stille inn alt om den her.")}</span>
              </div>
              <button type="button" class="btn btn-small" onClick={() => setFolderPickerOpen(true)}>{t("Åpne mappe…")}</button>
            </div>
          </Group>
        }
      >
        {(current) => (
          <>
            <div class="projects-scope" data-testid="projects-scope">
              <span class="projects-scope-label" id="projects-scope-label">{t("Gjelder for")}</span>
              <button
                ref={trigger}
                type="button"
                class="btn btn-small select-button projects-scope-button"
                aria-labelledby="projects-scope-label projects-scope-value"
                aria-haspopup="menu"
                aria-expanded={!!menu()}
                onClick={(e) => setMenu(menu() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}
              >
                <ProjectGlyph project={current()} size={15} />
                <span class="select-value" id="projects-scope-value">{current().name}</span>
                <IconChevronDown size={13} />
              </button>
              <Show when={menu()}>{(anchor) => <ContextMenu anchor={anchor()} label={t("Prosjekt")} class="select-menu" onClose={() => setMenu(null)} entries={entries()} />}</Show>
            </div>
            <ProjectSections project={current()} />
          </>
        )}
      </Show>
    </Page>
  );
}

function ProjectSections(props: { project: Project }) {
  // The project can be replaced by the one chosen above, so everything reads it through this.
  const project = () => app.projects[props.project.id] ?? props.project;
  const [name, setName] = createSignal(props.project.name);
  const [picking, setPicking] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [config, { refetch }] = createResource(() => props.project.id, (id) => get<ProjectConfig>(`/api/projects/${id}/config`));
  const [draft, setDraft] = createSignal<string | null>(null); // null: not edited
  let fileInput!: HTMLInputElement;

  // A different project: its own name, and a closed picker.
  createEffect(on(() => props.project.id, () => {
    setName(project().name);
    setPicking(false);
    setDraft(null);
  }, { defer: true }));

  const apply = (next: Project) => setApp("projects", next.id, reconcile(next));
  const change = async (body: Partial<Project>, done?: string) => {
    try {
      apply(await patch<Project>(`/api/projects/${props.project.id}`, body));
      if (done) toast(done, "info");
    } catch (err) {
      report(err);
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
      setPicking(false);
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
  };

  const saveInstructions = async () => {
    const text = draft();
    if (text === null) return;
    try {
      await put(`/api/projects/${props.project.id}/instructions`, { text });
      await refetch();
      setDraft(null);
      toast(t("Lagret .agentic/AGENTS.md."), "info");
    } catch (err) {
      report(err);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: t("Fjerne prosjektet?"), text: t("«{name}» og trådene fjernes fra appen. Mappen og filene på disken røres aldri.", { name: project().name }), confirm: t("Fjern"), danger: true });
    if (!ok) return;
    try {
      await del(`/api/projects/${props.project.id}`);
    } catch (err) {
      report(err);
    }
  };

  const browserValue = () => (project().agentBrowserAccess == null ? "inherit" : project().agentBrowserAccess ? "allow" : "block");
  const browserOptions = () => [
    { value: "inherit", label: app.settings.agentBrowserAccess === false ? t("Følg global (av)") : t("Følg global (på)") },
    { value: "allow", label: t("Tillat") },
    { value: "block", label: t("Av") },
  ];
  const text = createMemo(() => draft() ?? config()?.project.agentsMd ?? "");

  return (
    <>
      <Group title={t("Generelt")}>
        <Row label={t("Navn")} text={t("Vises i sidefanen og overalt ellers i appen. Mappen på disken får ikke nytt navn.")}>
          <form class="projects-name" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
            <input class="input" aria-label={t("Navn")} value={name()} maxlength={80} onInput={(e) => setName(e.currentTarget.value)} />
            <button type="submit" class="btn btn-small" disabled={!name().trim() || name().trim() === project().name}>{t("Lagre")}</button>
          </form>
        </Row>
        <div class="setting projects-icon-row" data-testid="project-icon-row">
          <span class="projects-icon-preview" aria-hidden="true"><ProjectGlyph project={project()} size={26} /></span>
          <div class="setting-text">
            <strong>{t("Prosjektikon")}</strong>
            <span class="muted">{t("Et ikon, en emoji, et monogram eller et eget bilde. Uten valg brukes prosjektets favicon, ellers en mappe.")}</span>
          </div>
          <div class="setting-control projects-icon-actions">
            <button type="button" class="btn btn-small" aria-expanded={picking()} onClick={() => setPicking(!picking())}>{t("Velg ikon")}</button>
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
          <div class="setting setting-block projects-picker">
            <IconPicker
              icon={project().icon}
              color={project().color}
              name={project().name}
              onIcon={(icon) => void change({ icon })}
              onColor={(color) => void change({ color })}
            />
          </div>
        </Show>
        <Toggle label={t("Fest prosjekt")} text={t("Festede prosjekter står øverst i sidefanen.")} icon={IconPin} checked={project().pinned} onChange={(pinned) => void change({ pinned })} />
        <Row label={t("Kildemappe")} text={<bdo dir="ltr" class="projects-path">{project().path}</bdo>} icon={IconFolder}>
          <button type="button" class="btn btn-small" onClick={() => void move()}>{t("Bytt mappe…")}</button>
        </Row>
      </Group>

      <Group title={t("Nye tråder")}>
        <Row label={t("Standardmodell")} text={t("Nye tråder i prosjektet bruker denne.")}>
          <Select<string | null>
            label={t("Standardmodell")}
            value={project().defaultModelId ?? null}
            options={[{ value: null, label: t("Appens standard") }, ...app.models.map((m) => ({ value: m.id as string | null, label: m.name }))]}
            onChange={(defaultModelId) => void change({ defaultModelId })}
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

      <Group title={t("Instruksjoner")}>
        <div class="setting setting-block">
          <div class="setting-text">
            <strong>{t("Instruksjoner for prosjektet")}</strong>
            <span class="muted">{t("Gjelder bare dette prosjektet, og går foran de globale instruksjonene. Ligger i .agentic/AGENTS.md i prosjektmappen.")}</span>
          </div>
          <textarea
            class="input code-area projects-instructions"
            rows={9}
            spellcheck={false}
            aria-label={t("Instruksjoner for prosjektet")}
            placeholder={t("Gjelder bare dette prosjektet, og går foran de globale instruksjonene.")}
            value={text()}
            onInput={(e) => setDraft(e.currentTarget.value)}
          />
          <div class="projects-instructions-actions">
            <button type="button" class="btn btn-small" disabled={draft() === null || draft() === (config()?.project.agentsMd ?? "")} onClick={() => void saveInstructions()}>{t("Lagre instruksjoner")}</button>
          </div>
        </div>
      </Group>

      <Group title={t("Faresone")}>
        <Row label={t("Fjern prosjektet")} text={t("Prosjektet og trådene fjernes fra appen. Mappen og filene på disken røres aldri.")}>
          <button type="button" class="btn btn-small btn-quiet-danger" onClick={() => void remove()}>{t("Fjern prosjektet…")}</button>
        </Row>
      </Group>
    </>
  );
}
