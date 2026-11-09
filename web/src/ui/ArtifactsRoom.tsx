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
  return new Date(at).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
        <span class="artifact-tile-meta" title={`Endret ${formatDate(props.artifact.updatedAt)}, laget ${formatDate(props.artifact.createdAt)}`}>
          Endret {relativeTime(props.artifact.updatedAt)}
        </span>
        <Show when={props.artifact.threadTitle}>
          <span class="artifact-tile-meta">Fra tråden «{props.artifact.threadTitle}»</span>
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
      title: (a, b) => a.title.localeCompare(b.title, "nb"),
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
          <h1>Artifacts</h1>
          <span class="artifacts-count">{artifacts().length}</span>
        </div>
        <span class="spacer" />
        <button type="button" class="btn btn-primary btn-small" onClick={() => void create()}><IconPlus size={14} />Ny artifact</button>
        <button type="button" class="icon-button" title="Lukk Artifacts" aria-label="Lukk Artifacts" onClick={closeArtifacts}><IconClose size={15} /></button>
      </header>
      <div class="artifacts-tools">
        <label class="artifacts-search">
          <IconSearch size={14} />
          <input class="search-input" type="search" placeholder="Søk i artifacts" aria-label="Søk i artifacts" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <Select<Sort>
          label="Sortering"
          class="artifacts-sort"
          value={sort()}
          options={[{ value: "updated", label: "Sist endret" }, { value: "created", label: "Sist laget" }, { value: "title", label: "Navn" }]}
          onChange={setSort}
        />
      </div>
      <Show
        when={artifacts().length}
        fallback={
          <div class="artifacts-empty">
            <IconArtifact size={28} />
            <h2>Ingen artifacts ennå</h2>
            <p class="muted">Artifacts er små apper i én fil, i HTML eller React. Be modellen om en, for eksempel «lag et html-spill», åpne boksen i svaret og trykk <strong>Lagre som artifact</strong>. Eller lag en selv.</p>
            <button type="button" class="btn btn-primary" onClick={() => void create()}>Ny artifact</button>
          </div>
        }
      >
        <div class="artifact-grid">
          <For each={shown()} fallback={<p class="muted artifacts-none">Ingen treff</p>}>{(artifact) => <Tile artifact={artifact} />}</For>
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
    return url ? `${url}?r=${run()}${lang() === "html" ? "" : `#tema=${isDark() ? "mork" : "lys"}`}` : undefined;
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
    const next = await promptDialog({ title: "Gi nytt navn", value: title(), confirm: "Lagre" });
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
    const ok = await confirmDialog({ title: "Gå tilbake til forrige versjon?", text: "Den lagrede versjonen og den forrige bytter plass, så du kan gå frem igjen på samme måte.", confirm: "Bytt" });
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
    const ok = await confirmDialog({ title: "Slette artifacten?", text: `«${title()}» slettes for godt. Tråden den kom fra røres ikke.`, confirm: "Slett", danger: true });
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
    send({ type: "browser.navigate", projectId: project.id, url });
    toast(`Åpnet i Nettleser-panelet i ${project.name}`, "info");
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
    { label: "Gi nytt navn", icon: IconPencil, run: rename },
    { label: "Dupliser", icon: IconCopy, run: duplicate },
    { label: `Last ned .${lang()}`, icon: IconDownload, run: download, title: dirty() ? "Laster ned det som er lagret" : undefined },
    { label: "Åpne i Nettleser-panelet", icon: IconGlobe, run: openInBrowser, disabled: !browserProject() },
    ...(summary()?.hasPrevious ? [{ label: "Forrige versjon", icon: IconUndo, run: restore } as MenuEntry] : []),
  ];

  const back = async () => {
    if (dirty() && !(await confirmDialog({ title: "Forkaste endringene?", text: "Koden har endringer som ikke er lagret.", confirm: "Forkast", danger: true }))) return;
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
        <button type="button" class="icon-button" title="Alle artifacts" aria-label="Alle artifacts" onClick={() => void back()}><IconBack size={15} /></button>
        <div class="artifact-bar-title">
          <h1 title={title()}>{title()}</h1>
          <span class="artifact-save-state" data-state={saving() ? "saving" : dirty() ? "dirty" : "saved"}>
            {saving() ? "Lagrer…" : dirty() ? "Ikke lagret" : "Lagret"}
          </span>
        </div>
        <span class="spacer" />
        <div class="segmented" role="group" aria-label="Visning">
          <button type="button" class="segment" aria-pressed={view() === "split"} onClick={() => setView("split")}>Delt</button>
          <button type="button" class="segment" aria-pressed={view() === "code"} onClick={() => setView("code")}>Kode</button>
          <button type="button" class="segment" aria-pressed={view() === "preview"} onClick={() => setView("preview")}>Forhåndsvisning</button>
        </div>
        <button type="button" class="btn btn-primary btn-small" disabled={!dirty() || saving()} title="Lagre (Ctrl+S)" onClick={() => void save()}>Lagre</button>
        <button type="button" class="btn btn-small" onClick={() => setRun(run() + 1)}><IconReload size={14} />Kjør på nytt</button>
        <button type="button" class="icon-button" title="Lukk Artifacts" aria-label="Lukk Artifacts" onClick={closeArtifacts}><IconClose size={15} /></button>
      </header>
      {/* In a narrow window the secondary actions fold into ⋯, so the row is one line. */}
      <div class="artifact-actions">
        <button type="button" class="icon-button artifact-more" aria-label="Mer for artifacten" title="Gi nytt navn, dupliser, last ned og mer" aria-haspopup="menu" aria-expanded={!!more()} onClick={(e) => setMore(more() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}><IconDots size={15} /></button>
        <Show when={more()}>{(a) => <ContextMenu anchor={a()} label="Mer for artifacten" entries={moreEntries()} onClose={() => setMore(null)} />}</Show>
        <button type="button" class="btn btn-small artifact-secondary" onClick={() => void rename()}>Gi nytt navn</button>
        <button type="button" class="btn btn-small artifact-secondary" onClick={() => void duplicate()}><IconCopy size={14} />Dupliser</button>
        <a class="btn btn-small artifact-secondary" href={downloadUrl()} download="" title={dirty() ? "Laster ned det som er lagret" : undefined}><IconDownload size={14} />Last ned .{lang()}</a>
        <button
          type="button"
          class="btn btn-small artifact-secondary"
          disabled={!browserProject()}
          title={browserProject() ? `Åpnes i ${browserProject()!.name}` : "Nettleser-panelet hører til et prosjekt. Velg en mappe først."}
          onClick={openInBrowser}
        >
          <IconGlobe size={14} />Åpne i Nettleser-panelet
        </button>
        <Show when={summary()?.hasPrevious}>
          <button type="button" class="btn btn-small artifact-secondary" onClick={() => void restore()}>Forrige versjon</button>
        </Show>
        <span class="spacer" />
        <span class="artifact-meta">
          <Show when={summary()?.threadTitle}>Fra «{summary()!.threadTitle}» · </Show>
          Laget {summary() ? formatDate(summary()!.createdAt) : ""}
        </span>
        <button type="button" class="btn btn-small btn-danger" onClick={() => void remove()}><IconTrash size={14} />Slett</button>
      </div>
      <div class="artifact-split">
        <div class="artifact-code" ref={editorHost} data-testid="artifact-editor" />
        <div class="artifact-preview">
          <Show when={previewSrc()} keyed>
            {(src) => (
              <iframe
                class="artifact-iframe"
                title={`Forhåndsvisning: ${title()}`}
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
    <section class="artifacts-room" aria-label="Artifacts">
      <Show when={room()?.id} keyed fallback={<Gallery />}>
        {(id) => <ArtifactView id={id} />}
      </Show>
    </section>
  );
}
