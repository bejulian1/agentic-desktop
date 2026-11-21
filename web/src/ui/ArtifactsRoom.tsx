import { language, t } from "../lib/i18n.ts";
// The Artifacts room in the middle of the window: a gallery, and an open artifact with its code
// and a live preview. Loaded the first time the room opens, CodeMirror with it. Since round 15 an
// artifact can be React in JSX or TSX as well as HTML: the editor follows, and the preview server
// renders it.
//
// The preview is an iframe on the preview server's origin, sandboxed without allow-same-origin.
// It shows what is saved, so it changes when you save or press Kjør på nytt.
import { Select } from "./Select";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "./ContextMenu";
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { Artifact, ArtifactSummary } from "../../../shared/protocol";
import { get } from "../lib/api";
import { relativeTime } from "../lib/format";
import { isDark } from "../lib/theme";
import { send } from "../lib/socket";
import { createHtmlEditor, type HtmlEditor } from "../panels/html-editor";
import { app, currentProject, report, setMode, setProjectId, sortedProjects, toast } from "../state/app";
import {
  artifacts, closeArtifacts, createArtifact, deleteArtifact, duplicateArtifact, openArtifacts, restoreArtifact, room, updateArtifact,
} from "../state/artifacts";
import { showPanel } from "../state/panel";
import { confirmDialog, promptDialog } from "./dialogs";
import { IconArtifact, IconBack, IconClose, IconCopy, IconDots, IconDownload, IconGlobe, IconPencil, IconPlus, IconReload, IconSearch, IconTrash, IconUndo } from "./icons";
import { ProjectGlyph } from "./ProjectGlyph";

type Sort = "updated" | "created" | "title";
type View = "split" | "code" | "preview";

const VIEW_KEY = "ad-artifact-view";

function loadView(): View {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return value === "code" || value === "preview" ? value : "split";
  } catch {
    return "split";
  }
}

function formatDate(at: number): string {
  return new Date(at).toLocaleString(language(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Tile(props: { artifact: ArtifactSummary }) {
  const project = () => (props.artifact.projectId ? app.projects[props.artifact.projectId] : undefined);
  return (
    <button type="button" class="artifact-tile" data-artifact={props.artifact.id} onClick={() => openArtifacts(props.artifact.id)}>
      <span class="artifact-thumb" aria-hidden="true">
        <IconArtifact size={22} />
        <span class="artifact-thumb-kind">{props.artifact.lang === "html" ? "HTML" : "React"}</span>
        <span class="artifact-thumb-size">{props.artifact.size < 1024 ? `${props.artifact.size} B` : `${Math.round(props.artifact.size / 1024)} kB`}</span>
      </span>
      <span class="artifact-tile-text">
        <span class="artifact-tile-title">{props.artifact.title}</span>
        <span class="artifact-tile-meta" title={t("Endret {updated}, laget {created}", { updated: formatDate(props.artifact.updatedAt), created: formatDate(props.artifact.createdAt) })}>
          {t("Endret {time}", { time: relativeTime(props.artifact.updatedAt) })}
        </span>
        <Show when={props.artifact.threadTitle}>
          <span class="artifact-tile-meta">{t("Fra tråden «{title}»", { title: props.artifact.threadTitle! })}</span>
        </Show>
        <Show when={project()}>
          {(p) => <span class="artifact-tile-project"><ProjectGlyph project={p()} size={12} />{p().name}</span>}
        </Show>
      </span>
    </button>
  );
}

function Gallery() {
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("updated");
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    const found = artifacts().filter((a) => !q || a.title.toLowerCase().includes(q) || (a.threadTitle ?? "").toLowerCase().includes(q));
    const by: Record<Sort, (a: ArtifactSummary, b: ArtifactSummary) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, language()),
    };
    return [...found].sort(by[sort()]);
  });

  const create = async () => {
    try {
      openArtifacts((await createArtifact({})).id);
    } catch (err) {
      report(err);
    }
  };

  return (
    <div class="artifacts-gallery">
      <header class="artifacts-head">
        <div class="artifacts-heading">
          <h1>{t("Artifacts")}</h1>
          <span class="artifacts-count">{artifacts().length}</span>
        </div>
        <span class="spacer" />
        <button type="button" class="btn btn-primary btn-small" onClick={() => void create()}><IconPlus size={14} />{t("Ny artifact")}</button>
        <button type="button" class="icon-button" title={t("Lukk Artifacts")} aria-label={t("Lukk Artifacts")} onClick={closeArtifacts}><IconClose size={15} /></button>
      </header>
      <div class="artifacts-tools">
        <label class="artifacts-search">
          <IconSearch size={14} />
          <input class="search-input" type="search" placeholder={t("Søk i artifacts")} aria-label={t("Søk i artifacts")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <Select<Sort>
          label={t("Sortering")}
          class="artifacts-sort"
          value={sort()}
          options={[{ value: "updated", label: t("Sist endret") }, { value: "created", label: t("Sist laget") }, { value: "title", label: t("Navn") }]}
          onChange={setSort}
        />
      </div>
      <Show
        when={artifacts().length}
        fallback={
          <div class="artifacts-empty">
            <IconArtifact size={28} />
            <h2>{t("Ingen artifacts ennå")}</h2>
            <p class="muted">{t("Artifacts er små apper i én fil, i HTML eller React. Be modellen om en, for eksempel «lag et html-spill», åpne boksen i svaret og trykk {save}. Eller lag en selv.")
              .split(/(\{save\})/).map(part => part === "{save}" ? <strong>{t("Lagre som artifact")}</strong> : part)}</p>
            <button type="button" class="btn btn-primary" onClick={() => void create()}>{t("Ny artifact")}</button>
          </div>
        }
      >
        <div class="artifact-grid">
          <For each={shown()} fallback={<p class="muted artifacts-none">{t("Ingen treff")}</p>}>{(artifact) => <Tile artifact={artifact} />}</For>
        </div>
      </Show>
    </div>
  );
}

function ArtifactView(props: { id: string }) {
  const [loaded, { refetch }] = createResource(() => props.id, (id) => get<Artifact>(`/api/artifacts/${id}`));
  const summary = createMemo(() => artifacts().find((a) => a.id === props.id));
  const [draft, setDraft] = createSignal<string | null>(null);
  const [savedHtml, setSavedHtml] = createSignal<string | null>(null);
  const [view, setViewSignal] = createSignal<View>(loadView());
  const [run, setRun] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const dirty = createMemo(() => draft() !== null && draft() !== savedHtml());
  let editorHost!: HTMLDivElement;
  let editor: HtmlEditor | undefined;

  const setView = (next: View) => {
    setViewSignal(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Only remembered when storage works.
    }
  };

  // The editor is made once, when the artifact first arrives.
  createEffect(on(loaded, (artifact) => {
    if (!artifact) return;
    setSavedHtml(artifact.html);
    if (!editor) {
      setDraft(artifact.html);
      editor = createHtmlEditor(editorHost, artifact.html, { onChange: setDraft, onSave: () => void save() }, artifact.lang);
    } else if (!dirty()) {
      editor.set(artifact.html);
      setDraft(artifact.html);
    }
  }));
  onCleanup(() => editor?.destroy());

  // Changed in another window: take it in, unless there are edits here.
  createEffect(on(() => summary()?.updatedAt, (updated, before) => {
    if (before !== undefined && updated !== undefined && updated !== loaded()?.updatedAt && !dirty() && !saving()) void refetch();
  }));

  // Deleted, here or in another window.
  createEffect(() => {
    if (!loaded.loading && loaded() && !summary()) openArtifacts(null);
  });
  createEffect(() => {
    if (loaded.error) {
      report(loaded.error);
      openArtifacts(null);
    }
  });

  const title = () => summary()?.title ?? loaded()?.title ?? "";
  const lang = () => summary()?.lang ?? loaded()?.lang ?? "html";
  const previewSrc = () => {
    const url = summary()?.previewUrl ?? loaded()?.previewUrl;
    // React draws its own messages, in the app's light or dark look (round 15).
    return url ? `${url}?r=${run()}${lang() === "html" ? "" : `#tema=${isDark() ? "mork" : "lys"}&lang=${language()}`}` : undefined;
  };

  async function save(): Promise<void> {
    const text = editor?.text();
    if (text === undefined || text === savedHtml() || saving()) return;
    setSaving(true);
    try {
      const artifact = await updateArtifact(props.id, { html: text });
      setSavedHtml(artifact.html);
      setRun(run() + 1);
    } catch (err) {
      report(err);
    } finally {
      setSaving(false);
    }
  }

  const rename = async () => {
    const next = await promptDialog({ title: t("Gi nytt navn"), value: title(), confirm: t("Lagre") });
    if (next?.trim() && next.trim() !== title()) updateArtifact(props.id, { title: next.trim() }).catch(report);
  };

  const duplicate = async () => {
    try {
      openArtifacts((await duplicateArtifact(props.id)).id);
    } catch (err) {
      report(err);
    }
  };

  const restore = async () => {
    const ok = await confirmDialog({ title: t("Gå tilbake til forrige versjon?"), text: t("Den lagrede versjonen og den forrige bytter plass, så du kan gå frem igjen på samme måte."), confirm: t("Bytt") });
    if (!ok) return;
    try {
      const artifact = await restoreArtifact(props.id);
      editor?.set(artifact.html);
      setDraft(artifact.html);
      setSavedHtml(artifact.html);
      setRun(run() + 1);
    } catch (err) {
      report(err);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: t("Slette artifacten?"), text: t("«{title}» slettes for godt. Tråden den kom fra røres ikke.", { title: title() }), confirm: t("Slett"), danger: true });
    if (!ok) return;
    try {
      await deleteArtifact(props.id);
      openArtifacts(null);
    } catch (err) {
      report(err);
    }
  };

  // The Browser panel belongs to a project: the current one, else the artifact's, else the newest.
  const browserProject = createMemo(() => currentProject() ?? (summary()?.projectId ? app.projects[summary()!.projectId!] : undefined) ?? sortedProjects()[0]);
  const openInBrowser = () => {
    const project = browserProject();
    const url = summary()?.previewUrl;
    if (!project || !url) return;
    setProjectId(project.id);
    setMode("code"); // leaves the room
    showPanel("browser");
    send({ type: "browser.navigate", projectId: project.id, url: lang() === "html" ? url : `${url}#lang=${language()}` });
    toast(t("Åpnet i Nettleser-panelet i {project}", { project: project.name }), "info");
  };

  const [more, setMore] = createSignal<MenuAnchor | null>(null);
  const downloadUrl = () => `/api/artifacts/${encodeURIComponent(props.id)}/download`;
  const download = () => {
    const link = document.createElement("a");
    link.href = downloadUrl();
    link.download = "";
    link.click();
  };
  const moreEntries = (): MenuEntry[] => [
    { label: t("Gi nytt navn"), icon: IconPencil, run: rename },
    { label: t("Dupliser"), icon: IconCopy, run: duplicate },
    { label: t("Last ned .{extension}", { extension: lang() }), icon: IconDownload, run: download, title: dirty() ? t("Laster ned det som er lagret") : undefined },
    { label: t("Åpne i Nettleser-panelet"), icon: IconGlobe, run: openInBrowser, disabled: !browserProject() },
    ...(summary()?.hasPrevious ? [{ label: t("Forrige versjon"), icon: IconUndo, run: restore } as MenuEntry] : []),
  ];

  const back = async () => {
    if (dirty() && !(await confirmDialog({ title: t("Forkaste endringene?"), text: t("Koden har endringer som ikke er lagret."), confirm: t("Forkast"), danger: true }))) return;
    openArtifacts(null);
  };

  onMount(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty()) event.preventDefault();
    };
    addEventListener("beforeunload", beforeUnload);
    onCleanup(() => removeEventListener("beforeunload", beforeUnload));
  });

  return (
    <div class="artifact-view" data-view={view()} data-artifact-open={props.id}>
      <header class="artifact-bar">
        <button type="button" class="icon-button" title={t("Alle artifacts")} aria-label={t("Alle artifacts")} onClick={() => void back()}><IconBack size={15} /></button>
        <div class="artifact-bar-title">
          <h1 title={title()}>{title()}</h1>
          <span class="artifact-save-state" data-state={saving() ? "saving" : dirty() ? "dirty" : "saved"}>
            {saving() ? t("Lagrer…") : dirty() ? t("Ikke lagret") : t("Lagret")}
          </span>
        </div>
        <span class="spacer" />
        <div class="segmented" role="group" aria-label={t("Visning")}>
          <button type="button" class="segment" aria-pressed={view() === "split"} onClick={() => setView("split")}>{t("Delt")}</button>
          <button type="button" class="segment" aria-pressed={view() === "code"} onClick={() => setView("code")}>{t("Kode")}</button>
          <button type="button" class="segment" aria-pressed={view() === "preview"} onClick={() => setView("preview")}>{t("Forhåndsvisning")}</button>
        </div>
        <button type="button" class="btn btn-primary btn-small" disabled={!dirty() || saving()} title={t("Lagre (Ctrl+S)")} onClick={() => void save()}>{t("Lagre")}</button>
        <button type="button" class="btn btn-small" onClick={() => setRun(run() + 1)}><IconReload size={14} />{t("Kjør på nytt")}</button>
        <button type="button" class="icon-button" title={t("Lukk Artifacts")} aria-label={t("Lukk Artifacts")} onClick={closeArtifacts}><IconClose size={15} /></button>
      </header>
      {/* In a narrow window the secondary actions fold into ⋯, so the row is one line. */}
      <div class="artifact-actions">
        <button type="button" class="icon-button artifact-more" aria-label={t("Mer for artifacten")} title={t("Gi nytt navn, dupliser, last ned og mer")} aria-haspopup="menu" aria-expanded={!!more()} onClick={(e) => setMore(more() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}><IconDots size={15} /></button>
        <Show when={more()}>{(a) => <ContextMenu anchor={a()} label={t("Mer for artifacten")} entries={moreEntries()} onClose={() => setMore(null)} />}</Show>
        <button type="button" class="btn btn-small artifact-secondary" onClick={() => void rename()}>{t("Gi nytt navn")}</button>
        <button type="button" class="btn btn-small artifact-secondary" onClick={() => void duplicate()}><IconCopy size={14} />{t("Dupliser")}</button>
        <a class="btn btn-small artifact-secondary" href={downloadUrl()} download="" title={dirty() ? t("Laster ned det som er lagret") : undefined}><IconDownload size={14} />{t("Last ned .{extension}", { extension: lang() })}</a>
        <button
          type="button"
          class="btn btn-small artifact-secondary"
          disabled={!browserProject()}
          title={browserProject() ? t("Åpnes i {project}", { project: browserProject()!.name }) : t("Nettleser-panelet hører til et prosjekt. Velg en mappe først.")}
          onClick={openInBrowser}
        >
          <IconGlobe size={14} />{t("Åpne i Nettleser-panelet")}
        </button>
        <Show when={summary()?.hasPrevious}>
          <button type="button" class="btn btn-small artifact-secondary" onClick={() => void restore()}>{t("Forrige versjon")}</button>
        </Show>
        <span class="spacer" />
        <span class="artifact-meta">
          {summary()?.threadTitle
            ? t("Fra «{title}» · Laget {date}", { title: summary()!.threadTitle!, date: formatDate(summary()!.createdAt) })
            : t("Laget {date}", { date: summary() ? formatDate(summary()!.createdAt) : "" })}
        </span>
        <button type="button" class="btn btn-small btn-danger" onClick={() => void remove()}><IconTrash size={14} />{t("Slett")}</button>
      </div>
      <div class="artifact-split">
        <div class="artifact-code" ref={editorHost} data-testid="artifact-editor" />
        <div class="artifact-preview">
          <Show when={previewSrc()} keyed>
            {(src) => (
              <iframe
                class="artifact-iframe"
                title={t("Forhåndsvisning: {title}", { title: title() })}
                sandbox={lang() === "html" ? "allow-scripts allow-modals" : "allow-scripts allow-modals allow-forms"}
                referrerpolicy="no-referrer"
                allow=""
                src={src}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

export default function ArtifactsRoom() {
  return (
    <section class="artifacts-room" aria-label={t("Artifacts")}>
      <Show when={room()?.id} keyed fallback={<Gallery />}>
        {(id) => <ArtifactView id={id} />}
      </Show>
    </section>
  );
}
