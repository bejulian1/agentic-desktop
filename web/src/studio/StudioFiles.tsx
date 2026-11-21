import { t } from "../lib/i18n";
import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { createMutable } from "solid-js/store";
import type { ChangedFile, EditableFile, FileEntry, MentionItem } from "../../../shared/protocol";
import { ApiError, get, post, put } from "../lib/api";
import { on, onOpen, send as socketSend } from "../lib/socket";
import { app, refreshProject } from "../state/app";
import { fileRequest, noteRecentFile, registerOpenedFile } from "../state/nav";
import { currentFileActivity, loadModel, peekModel, retainModel, type ThreadModel } from "../state/thread-model";
import { FileTreeEntry } from "../panels/FileTree";
import { FolderMissingBar } from "../ui/FolderMissingBar";
import { confirmDialog } from "../ui/dialogs";
import { IconClose, IconFile, IconFolder, IconPlus, IconSearch } from "../ui/icons";
import type { StudioEditor, StudioEditorSession, StudioFindResult } from "./editor";
import "./files.css";

interface BufferFile {
  file: EditableFile;
  text: string;
  session?: StudioEditorSession;
  conflict?: EditableFile | "missing";
  conflictKept?: boolean;
  saving: boolean;
  refreshAfterSave?: boolean;
  request: number;
  error?: string;
}

interface ProjectBuffers {
  projectId: string;
  root: string;
  buffers: Map<string, BufferFile>;
  selected: string | null;
  expanded: Set<string>;
  used: number;
}

const projects = new Map<string, ProjectBuffers>();
const MAX_PROJECTS = 8;
const MAX_TABS = 24;
const MAX_BUFFERS = 48;
const normalizeText = (text: string | null) => (text ?? "").replace(/\r\n/g, "\n");
const dirty = (file: BufferFile) => file.text !== normalizeText(file.file.text);
const totalBuffers = () => [...projects.values()].reduce((n, project) => n + project.buffers.size, 0);
const anyDirty = () => [...projects.values()].some((project) => [...project.buffers.values()].some(dirty));

window.addEventListener("beforeunload", (event) => {
  if (anyDirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function projectBuffers(id: string, root: string): ProjectBuffers {
  const key = JSON.stringify([id, root]);
  let cached = projects.get(key);
  if (!cached) {
    if (projects.size >= MAX_PROJECTS) {
      const old = [...projects].filter(([, p]) => ![...p.buffers.values()].some(dirty)).sort((a, b) => a[1].used - b[1].used)[0];
      if (old) projects.delete(old[0]);
    }
    cached = { projectId: id, root, buffers: new Map(), selected: null, expanded: new Set(), used: Date.now() };
    // An empty excess project is not retained; the global buffer cap still applies before opening.
    projects.set(key, cached);
  }
  cached.used = Date.now();
  return cached;
}

interface StudioFilesProps { projectId: string; threadId: () => string | null; active?: () => boolean }

export default function StudioFiles(props: StudioFilesProps) {
  const identity = () => JSON.stringify([props.projectId, app.projects[props.projectId]?.path ?? ""]);
  return (
    <Show when={identity()} keyed>
      {(key) => {
        const [projectId, rootPath] = JSON.parse(key) as [string, string];
        return <StudioFilesRoot projectId={projectId} rootPath={rootPath} threadId={props.threadId} active={props.active} />;
      }}
    </Show>
  );
}

function StudioFilesRoot(props: StudioFilesProps & { rootPath: string }) {
  const cache = projectBuffers(props.projectId, props.rootPath);
  const project = () => app.projects[props.projectId];
  const folderMissing = () => !!project()?.folderMissing;

  const [revision, setRevision] = createSignal(0);
  const [expanded, setExpanded] = createSignal(new Set(cache.expanded));
  const [treeVersion, setTreeVersion] = createSignal(0);
  const [selected, setSelected] = createSignal(cache.selected);
  const [treeOpen, setTreeOpen] = createSignal(matchMedia("(min-width: 900px)").matches);
  const [filter, setFilter] = createSignal("");
  const [found, setFound] = createSignal<MentionItem[]>([]);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [newPath, setNewPath] = createSignal("");
  const [newBusy, setNewBusy] = createSignal(false);
  const [follow, setFollow] = createSignal(true);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [searchResult, setSearchResult] = createSignal<StudioFindResult | null>(null);
  const [cursor, setCursor] = createSignal({ line: 1, column: 1 });
  const [compare, setCompare] = createSignal(false);
  const [savedNote, setSavedNote] = createSignal("");

  const dirs = new Map<string, FileEntry[]>();
  const dirRequests = new Map<string, number>();
  let alive = true;
  let request = 0;
  let searchRequest = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  let host!: HTMLDivElement;
  let tabsEl!: HTMLDivElement;
  let searchInput!: HTMLInputElement;
  let newInput!: HTMLInputElement;
  let newFileButton: HTMLButtonElement | undefined;
  let editor: StudioEditor | undefined;
  let editorPath: string | null = null;
  let editorGeneration = 0;

  const active = () => props.active?.() !== false;
  const touch = () => { if (alive) setRevision((v) => v + 1); };
  const buffers = () => { revision(); return [...cache.buffers.keys()]; };
  const current = createMemo(() => { revision(); return cache.buffers.get(selected() ?? "") ?? null; });

  const [model, setModel] = createSignal<ThreadModel | undefined>();
  createEffect(() => {
    const id = props.threadId();
    const thread = id ? app.threads[id] : undefined;
    let retained: (() => void) | undefined;
    let valid = true;
    setModel(undefined);
    if (active() && id && thread?.mode === "code" && thread.projectId === props.projectId) {
      const accept = (value: ThreadModel) => { if (valid) { retained = retainModel(value); setModel(value); } };
      const ready = peekModel(id);
      if (ready) accept(ready);
      else void loadModel(id, true).then(accept).catch(() => undefined);
    }
    onCleanup(() => { valid = false; retained?.(); });
  });

  const working = createMemo(() => currentFileActivity(model()?.activity() ?? null));
  const workingPath = createMemo(() => {
    const raw = working()?.path;
    if (!raw) return null;
    const root = project()?.path.replace(/\/$/, "");
    if (raw.startsWith("/")) return root && raw.startsWith(root + "/") ? raw.slice(root.length + 1) : null;
    const parts: string[] = [];
    for (const part of raw.split("/")) {
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/") || null;
  });

  // Show the same non-reverted thread diff counts (+N -M) as the Files panel.
  const changes = createMemo(() => {
    const files = new Map<string, ChangedFile>();
    for (const row of model()?.changes() ?? []) {
      row.rev();
      if (!row.reverted) for (const file of row.files) files.set(file.path, file);
    }
    return files;
  });

  const listing = (path: string) => { treeVersion(); return dirs.get(path); };
  async function loadDir(path: string) {
    if (folderMissing()) return;
    const generation = (dirRequests.get(path) ?? 0) + 1;
    dirRequests.set(path, generation);
    try {
      const entries = await get<FileEntry[]>(`/api/projects/${props.projectId}/tree?path=${encodeURIComponent(path)}`);
      if (!alive || dirRequests.get(path) !== generation) return;
      dirs.set(path, entries);
      setTreeVersion((v) => v + 1);
    } catch (err) {
      if (!alive || dirRequests.get(path) !== generation) return;
      if (path === ".") {
        setError((err as Error).message);
        void refreshProject(props.projectId);
      }
      dirs.delete(path);
      setTreeVersion((v) => v + 1);
    }
  }

  function select(path: string) {
    cache.selected = path;
    setSelected(path);
    setCompare(false);
    setSearchOpen(false);
    setSearchResult(null);
  }

  function expandTo(path: string) {
    const next = new Set(expanded());
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      next.add(dir);
      void loadDir(dir);
    }
    cache.expanded = next;
    setExpanded(next);
  }

  async function openFile(path: string, focus = true) {
    if (cache.buffers.has(path)) { if (focus) select(path); return; }
    if (folderMissing()) return;
    if (cache.buffers.size >= MAX_TABS || totalBuffers() >= MAX_BUFFERS) {
      setError(t("Lagre og lukk noen faner før du åpner flere filer."));
      return;
    }
    const generation = focus ? ++request : request;
    if (focus) setLoading(path);
    setError("");
    try {
      const file = await get<EditableFile>(`/api/projects/${props.projectId}/file/edit?path=${encodeURIComponent(path)}`);
      if (!alive || (focus && request !== generation)) return;
      if (!cache.buffers.has(path)) cache.buffers.set(path, createMutable({ file, text: normalizeText(file.text), saving: false, request: 0 }));
      noteRecentFile(props.projectId, path);
      expandTo(path);
      touch();
      if (focus) select(path);
    } catch (err) {
      if (alive && (!focus || request === generation)) setError((err as Error).message);
    } finally {
      if (alive && focus && request === generation) setLoading(null);
    }
  }

  function toggleDir(path: string) {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else { next.add(path); void loadDir(path); }
    cache.expanded = next;
    setExpanded(next);
  }

  async function refreshBuffer(path: string) {
    if (folderMissing()) return;
    const file = cache.buffers.get(path);
    if (!file) return;
    if (file.saving) { file.refreshAfterSave = true; return; }
    const generation = ++file.request;
    try {
      const disk = await get<EditableFile>(`/api/projects/${props.projectId}/file/edit?path=${encodeURIComponent(path)}`);
      if (!alive || cache.buffers.get(path) !== file || file.request !== generation) return;
      if (file.file.hash === disk.hash) {
        file.conflict = undefined;
        file.conflictKept = false;
        file.error = undefined;
        touch();
        return;
      }
      if (dirty(file)) {
        file.conflict = disk;
        file.conflictKept = false;
      } else {
        batch(() => {
          file.text = normalizeText(disk.text);
          file.conflict = undefined;
          file.error = undefined;
          file.session = undefined;
          if (editorPath === path) editor?.replace(file.text);
          file.file = disk;
        });
      }
      touch();
    } catch (err) {
      if (!alive || cache.buffers.get(path) !== file || file.request !== generation) return;
      if (err instanceof ApiError && err.status === 404) {
        file.conflict = "missing";
        file.error = t("Filen finnes ikke lenger på disken. Utkastet ditt er beholdt.");
      } else {
        file.error = (err as Error).message;
      }
      touch();
    }
  }

  function flashSaved(message = t("Lagret")) {
    clearTimeout(savedTimer);
    setSavedNote(message);
    savedTimer = setTimeout(() => { if (alive) setSavedNote(""); }, 1800);
  }

  async function save(path = selected()) {
    const file = path ? cache.buffers.get(path) : undefined;
    if (!path || !file || file.saving || !file.file.editable || !dirty(file)) return;
    if (file.conflict) { file.conflictKept = false; touch(); return; }
    const text = file.text;
    file.request++;
    file.saving = true;
    file.error = undefined;
    touch();
    try {
      const saved = await put<EditableFile>(`/api/projects/${props.projectId}/file`, {
        path,
        projectPath: props.rootPath,
        hash: file.file.hash,
        text: file.file.eol === "crlf" ? text.replace(/\n/g, "\r\n") : text,
      });
      if (normalizeText(saved.text) !== text) {
        file.conflict = saved;
        file.conflictKept = false;
        file.error = t("Filen ble endret på disken mens lagringen ble fullført. Utkastet er beholdt.");
      } else {
        file.file = saved;
        file.conflict = undefined;
        flashSaved();
      }
    } catch (err) {
      file.error = (err as Error).message;
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        file.saving = false;
        await refreshBuffer(path);
      }
    } finally {
      file.saving = false;
      const refresh = file.refreshAfterSave;
      file.refreshAfterSave = false;
      touch();
      if (refresh && alive) void refreshBuffer(path);
    }
  }

  // Recreate a file that was deleted on disk while the user kept edits in the buffer.
  async function recreateDeleted() {
    const path = selected();
    const file = current();
    if (!path || !file || file.saving || file.conflict !== "missing") return;
    const text = file.text;
    file.request++;
    file.saving = true;
    file.error = undefined;
    touch();
    try {
      const created = await post<EditableFile>(`/api/projects/${props.projectId}/file`, {
        path,
        projectPath: props.rootPath,
        text: file.file.eol === "crlf" ? text.replace(/\n/g, "\r\n") : text,
      });
      if (!alive || cache.buffers.get(path) !== file) return;
      file.file = created;
      file.conflict = undefined;
      file.conflictKept = false;
      file.error = undefined;
      flashSaved(t("Lagret på nytt"));
      void loadDir(".");
    } catch (err) {
      if (alive && cache.buffers.get(path) === file) file.error = (err as Error).message;
    } finally {
      file.saving = false;
      touch();
    }
  }

  async function close(path: string, focusNextTab = false) {
    const file = cache.buffers.get(path);
    if (!file || file.saving) return;
    if (dirty(file) && !await confirmDialog({
      title: t("Forkaste endringene i {path}?", { path }),
      text: t("Endringene finnes bare i utkastet. Filen på disken blir ikke endret."),
      confirm: t("Forkast"),
      danger: true,
    })) return;
    if (!alive || cache.buffers.get(path) !== file) return;
    const paths = [...cache.buffers.keys()];
    const at = paths.indexOf(path);
    cache.buffers.delete(path);
    touch();
    if (selected() === path) {
      const next = paths[at + 1] ?? paths[at - 1] ?? null;
      cache.selected = next;
      setSelected(next);
      if (focusNextTab && next) queueMicrotask(() => focusTab(next));
    }
  }

  function focusTab(path: string) {
    const button = [...tabsEl.querySelectorAll<HTMLButtonElement>("[data-studio-tab]")].find((el) => el.dataset.studioTab === path);
    button?.focus({ preventScroll: true });
  }

  function onTabKeyDown(event: KeyboardEvent, path: string) {
    const list = buffers();
    const at = list.indexOf(path);
    if (at < 0) return;
    let next: string | undefined;
    if (event.key === "ArrowRight") next = list[(at + 1) % list.length];
    else if (event.key === "ArrowLeft") next = list[(at - 1 + list.length) % list.length];
    else if (event.key === "Home") next = list[0];
    else if (event.key === "End") next = list.at(-1);
    else if (event.key === "Delete") {
      event.preventDefault();
      void close(path, true);
      return;
    }
    if (!next) return;
    event.preventDefault();
    select(next);
    focusTab(next);
  }

  async function reloadDisk() {
    const path = selected();
    const file = current();
    if (!path || !file) return;
    if (dirty(file) && !await confirmDialog({
      title: t("Erstatte utkastet med diskversjonen?"),
      text: t("Dine ulagrede endringer i denne fanen blir forkastet."),
      confirm: t("Last inn fra disk"),
      danger: true,
    })) return;
    if (!alive || cache.buffers.get(path) !== file) return;
    const draftAtStart = file.text;
    const generation = ++file.request;
    try {
      const disk = await get<EditableFile>(`/api/projects/${props.projectId}/file/edit?path=${encodeURIComponent(path)}`);
      if (!alive || cache.buffers.get(path) !== file || file.request !== generation) return;
      if (file.text !== draftAtStart) {
        file.error = t("Utkastet ble redigert mens diskversjonen ble lastet. Prøv igjen når du er klar.");
        touch();
        return;
      }
      batch(() => {
        file.text = normalizeText(disk.text);
        file.session = undefined;
        file.conflict = undefined;
        file.error = undefined;
        if (editorPath === path) editor?.replace(file.text);
        file.file = disk;
      });
      touch();
    } catch (err) {
      if (!alive || cache.buffers.get(path) !== file || file.request !== generation) return;
      file.error = (err as Error).message;
      touch();
    }
  }

  async function acceptMerged() {
    const file = current();
    if (!file?.conflict || file.conflict === "missing") return;
    const disk = file.conflict;
    if (!await confirmDialog({
      title: t("Bruke det redigerte utkastet som neste versjon?"),
      text: t("Kontroller at du har tatt med diskendringene du vil beholde. Neste lagring erstatter denne diskversjonen med utkastet; nyere diskendringer blir fortsatt avvist."),
      confirm: t("Bruk utkastet"),
    })) return;
    if (!alive || current() !== file || file.conflict !== disk) return;
    file.file = disk;
    file.conflict = undefined;
    file.conflictKept = false;
    file.error = undefined;
    setCompare(false);
    touch();
  }

  async function createFile(event: Event) {
    event.preventDefault();
    const path = newPath().trim();
    if (!path || newBusy()) return;
    setNewBusy(true);
    setError("");
    try {
      await post<EditableFile>(`/api/projects/${props.projectId}/file`, { path, projectPath: props.rootPath, text: "" });
      if (!alive) return;
      setCreating(false);
      setNewPath("");
      await loadDir(".");
      await openFile(path);
      editor?.focus();
    } catch (err) {
      if (alive) setError((err as Error).message);
    } finally {
      if (alive) setNewBusy(false);
    }
  }

  const watchKey = createMemo(() => {
    revision();
    const watched = new Set(["."]);
    for (const path of cache.buffers.keys()) if (path.includes("/")) watched.add(path.slice(0, path.lastIndexOf("/")));
    for (const directory of expanded()) watched.add(directory);
    return [...watched].slice(0, 64);
  }, undefined, { equals: (previous, next) => previous?.length === next.length && previous.every((value, index) => value === next[index]) });

  const subscribe = () => {
    if (active() && !folderMissing()) socketSend({ type: "project.watch", projectId: props.projectId, directories: watchKey() });
  };

  createEffect(() => {
    const visible = active() && !folderMissing();
    const directories = watchKey();
    if (visible) socketSend({ type: "project.watch", projectId: props.projectId, directories });
    else socketSend({ type: "project.unwatch", projectId: props.projectId });
  });

  onCleanup(onOpen(() => {
    subscribe();
    if (active() && !folderMissing()) {
      void loadDir(".");
      for (const path of cache.buffers.keys()) void refreshBuffer(path);
    }
  }));

  const pendingChanges = new Set<string>();
  let refreshAll = false;
  onCleanup(on("project.files-changed", ({ projectId, paths }) => {
    if (projectId !== props.projectId || !active() || folderMissing()) return;
    if (!paths.length) refreshAll = true;
    for (const path of paths) pendingChanges.add(path);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const changesList = refreshAll ? ["."] : [...pendingChanges];
      pendingChanges.clear();
      refreshAll = false;
      void loadDir(".");
      for (const path of expanded()) void loadDir(path);
      for (const path of cache.buffers.keys()) {
        if (changesList.some((changed) => changed === "." || changed === path || path.startsWith(changed + "/"))) void refreshBuffer(path);
      }
      const task = working();
      const path = workingPath();
      if (follow() && path && task && ["write_file", "edit_file"].includes(task.tool ?? "") && changesList.some((p) => p === "." || p === path || path.startsWith(p + "/"))) {
        void openFile(path, !current() || !dirty(current()!));
      }
    }, 80);
  }));

  onCleanup(on("project.watch-state", ({ projectId, watching }) => {
    if (projectId === props.projectId && active() && !watching) void refreshProject(props.projectId);
  }));

  createEffect(() => {
    if (active()) void refreshProject(props.projectId);
  });

  createEffect(() => {
    if (active() && !folderMissing()) {
      setError("");
      void loadDir(".");
      untrack(() => {
        for (const path of expanded()) void loadDir(path);
        for (const path of cache.buffers.keys()) void refreshBuffer(path);
      });
    }
  });

  createEffect(() => {
    const value = filter().trim();
    const generation = ++searchRequest;
    if (!value || folderMissing()) { setFound([]); return; }
    const timer = setTimeout(() => {
      void get<MentionItem[]>(`/api/projects/${props.projectId}/mentions?q=${encodeURIComponent(value)}`).then((items) => {
        if (alive && searchRequest === generation) setFound(items.filter((item) => item.kind === "file"));
      }).catch((err) => { if (alive && searchRequest === generation) setError((err as Error).message); });
    }, 140);
    onCleanup(() => clearTimeout(timer));
  });

  createEffect(() => {
    const req = fileRequest();
    if (active() && req?.projectId === props.projectId) untrack(() => { void openFile(req.path); });
  });

  let followed = "";
  createEffect(() => {
    const task = working();
    const path = workingPath();
    const visible = active();
    const following = follow();
    if (!visible || !following || !task || !path || task.status !== "done" || !["write_file", "edit_file"].includes(task.tool ?? "")) return;
    if (followed === task.id) return;
    followed = task.id;
    untrack(() => { void openFile(path, !current() || !dirty(current()!)); });
  });

  createEffect(() => {
    const file = current();
    const path = selected();
    if (!active() || !file || !path || file.file.binary || file.file.truncated || file.file.text === null) return;
    const threadId = props.threadId();
    onCleanup(registerOpenedFile(props.projectId, threadId, path));
  });

  // Disk metadata (hash/size) changes on every save. Only structural editor changes may
  // replace CodeMirror; replacing it for a fresh hash would steal focus between keystrokes.
  const editorKey = createMemo(() => {
    const path = selected();
    const file = current();
    return JSON.stringify([
      path,
      !!file,
      file ? !file.file.editable : true,
      !!file?.file.binary,
      !!file?.file.truncated,
      typeof file?.file.text === "string",
      app.settings.tabSize ?? 4,
      !!app.settings.wrapCode,
    ]);
  });

  createEffect(() => {
    const key = editorKey();
    untrack(() => {
      const [path, present, readOnly, binary, truncated, textAvailable, tabSize, wrapCode] = JSON.parse(key) as [string | null, boolean, boolean, boolean, boolean, boolean, number, boolean];
      const file = path ? cache.buffers.get(path) : undefined;
      const generation = ++editorGeneration;
      const restoreFocus = !!editor && host.contains(document.activeElement);
      if (editor) {
        editor.destroy();
        const old = cache.buffers.get(editorPath ?? "");
        if (old) old.session = editor.session;
      }
      editor = undefined;
      editorPath = null;
      if (!present || !file || !path || !textAvailable || binary || truncated) return;
      void import("./editor").then(({ createStudioEditor }) => {
        if (!alive || editorGeneration !== generation || selected() !== path) return;
        editor = createStudioEditor(host, {
          path,
          text: file.text,
          readOnly,
          tabSize,
          wrapCode,
          session: file.session,
          onChange: (text) => { file.text = text; if (savedNote()) setSavedNote(""); touch(); },
          onCursor: (line, column) => setCursor({ line, column }),
          onSave: () => void save(path),
          onSearch: () => { setSearchOpen(true); queueMicrotask(() => { searchInput?.focus(); searchInput?.select(); }); },
        });
        file.session = editor.session;
        editorPath = path;
        if (restoreFocus && document.activeElement === document.body) editor.focus();
      }).catch((err) => { if (alive && editorGeneration === generation) setError((err as Error).message); });
    });
  });

  createEffect(() => { if (creating()) queueMicrotask(() => newInput?.focus()); });

  onCleanup(() => {
    alive = false;
    request++;
    searchRequest++;
    editorGeneration++;
    clearTimeout(refreshTimer);
    clearTimeout(savedTimer);
    if (editor) {
      editor.destroy();
      const old = cache.buffers.get(editorPath ?? "");
      if (old) old.session = editor.session;
    }
    socketSend({ type: "project.unwatch", projectId: props.projectId });
    if (!cache.buffers.size) projects.delete(JSON.stringify([props.projectId, props.rootPath]));
  });

  function find(backwards = false) {
    if (!query()) { setSearchResult(null); return; }
    setSearchResult(editor ? editor.find(query(), backwards) : { count: 0, index: 0 });
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchResult(null);
    editor?.focus();
  }

  function cancelCreate() {
    setCreating(false);
    setNewPath("");
    queueMicrotask(() => newFileButton?.focus());
  }

  const title = () => project()?.name ?? t("Prosjekt");
  const oldDrafts = () => {
    revision();
    return [...projects.values()]
      .filter((entry) => entry.projectId === props.projectId && entry.root !== props.rootPath)
      .flatMap((entry) => [...entry.buffers].filter(([, file]) => dirty(file)).map(([path, file]) => ({ root: entry.root, path, file })));
  };

  return (
    <section class="studio-files" classList={{ "studio-tree-hidden": !treeOpen() }} data-testid="studio-files" aria-label={t("Prosjektfiler og editor")}>
      <aside class="studio-explorer" hidden={!treeOpen()} aria-label={t("Filutforsker")}>
        <header class="studio-explorer-head">
          <span><IconFolder size={14} /><strong>{title()}</strong></span>
          <button
            ref={newFileButton}
            type="button"
            class="icon-button"
            aria-label={t("Ny fil")}
            title={t("Ny fil")}
            disabled={folderMissing()}
            onClick={() => { setTreeOpen(true); setCreating(true); }}
          >
            <IconPlus size={15} />
          </button>
        </header>
        <label class="studio-file-filter">
          <IconSearch size={13} />
          <input
            aria-label={t("Filtrer prosjektfiler")}
            placeholder={t("Finn en fil…")}
            value={filter()}
            disabled={folderMissing()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter()) {
                e.preventDefault();
                setFilter("");
              }
            }}
          />
        </label>
        <Show when={creating()}>
          <form
            class="studio-new-file"
            onSubmit={(e) => void createFile(e)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelCreate();
              }
            }}
          >
            <input
              ref={newInput}
              aria-label={t("Navn på ny fil")}
              placeholder={t("fil.ts eller mappe/fil.ts")}
              value={newPath()}
              onInput={(e) => setNewPath(e.currentTarget.value)}
              disabled={newBusy()}
            />
            <div>
              <button class="btn btn-small" type="submit" disabled={!newPath().trim() || newBusy()}>{t("Opprett fil")}</button>
              <button class="icon-button" type="button" aria-label={t("Avbryt ny fil")} onClick={cancelCreate}><IconClose size={13} /></button>
            </div>
            <small>{t("Mapper må finnes fra før.")}</small>
          </form>
        </Show>
        <div class="studio-tree" role="tree" data-testid="studio-tree" aria-label={t("Prosjektfiler")}>
          <Show
            when={!folderMissing()}
            fallback={<p class="studio-tree-empty">{t("Prosjektmappen ble ikke funnet. Koble den til på nytt for å vise filer.")}</p>}
          >
            <Show
              when={filter().trim()}
              fallback={
                <For each={listing(".")} fallback={<p class="studio-tree-empty">{dirs.has(".") ? t("Mappen er tom") : t("Laster filer…")}</p>}>
                  {(entry) => (
                    <FileTreeEntry
                      entry={entry}
                      depth={0}
                      selected={selected()}
                      listing={listing}
                      expanded={(p) => expanded().has(p)}
                      toggle={toggleDir}
                      open={(e) => void openFile(e.path)}
                      working={workingPath()}
                      changes={changes()}
                    />
                  )}
                </For>
              }
            >
              <For each={found()} fallback={<p class="studio-tree-empty">{t("Ingen filer funnet")}</p>}>
                {(entry) => (
                  <button type="button" class="studio-found-file" data-path={entry.path} onClick={() => { if (entry.path) void openFile(entry.path); }} title={entry.path}>
                    <IconFile size={13} />
                    <span>{entry.path}</span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
        <footer class="studio-explorer-foot">
          <button type="button" aria-label={t("Følg agentens filer")} aria-pressed={follow()} classList={{ active: follow() }} onClick={() => setFollow(!follow())}>
            <span class="studio-live-dot" aria-hidden="true" />
            {t("Følg agentens filer")}
          </button>
          <span>{folderMissing() ? t("Overvåking satt på pause") : t("Filer oppdateres fortløpende")}</span>
        </footer>
      </aside>
      <div class="studio-editor-column">
        <Show when={folderMissing() && project()}>
          {(missing) => (
            <div class="studio-folder-missing">
              <FolderMissingBar project={missing()} />
            </div>
          )}
        </Show>
        <Show when={oldDrafts().length}>
          <details class="studio-old-drafts" data-testid="studio-old-drafts">
            <summary>{t("Ulagrede utkast fra tidligere prosjektmappe ({count})", { count: oldDrafts().length })}</summary>
            <p>{t("Prosjektmappen er endret. Disse utkastene holdes adskilt og kan ikke lagres over filer i den nye mappen. Kopier innholdet du vil ta vare på.")}</p>
            <For each={oldDrafts()}>
              {(draft) => (
                <div>
                  <strong>{draft.path}</strong>
                  <small>{draft.root}</small>
                  <pre tabIndex={0} aria-label={t("Tidligere utkast {path}", { path: draft.path })}>{draft.file.text}</pre>
                </div>
              )}
            </For>
          </details>
        </Show>
        <div class="studio-tabbar">
          <button
            type="button"
            class="icon-button studio-tree-toggle"
            aria-label={treeOpen() ? t("Skjul prosjektfiler") : t("Vis prosjektfiler")}
            aria-expanded={treeOpen()}
            title={treeOpen() ? t("Skjul prosjektfiler") : t("Vis prosjektfiler")}
            onClick={() => setTreeOpen(!treeOpen())}
          >
            <IconFolder size={15} />
          </button>
          <div ref={tabsEl} class="studio-file-tabs" role="tablist" aria-label={t("Åpne filer")} data-testid="studio-tabs">
            <For each={buffers()}>
              {(path, index) => {
                const file = cache.buffers.get(path)!;
                const isSelected = () => selected() === path;
                return (
                  <div class="studio-file-tab" classList={{ active: isSelected() }} data-dirty={dirty(file)}>
                    <button
                      type="button"
                      role="tab"
                      id={`studio-tab-${index()}`}
                      data-studio-tab={path}
                      aria-label={path}
                      aria-selected={isSelected()}
                      aria-controls="studio-editor-panel"
                      tabindex={isSelected() || (!selected() && index() === 0) ? 0 : -1}
                      data-dirty={dirty(file)}
                      title={path}
                      onKeyDown={(e) => onTabKeyDown(e, path)}
                      onClick={() => select(path)}
                    >
                      <IconFile size={13} />
                      <span>{path.split("/").at(-1)}</span>
                      <Show when={dirty(file)}><span class="studio-dirty" aria-label={t("Ulagrede endringer")}>●</span></Show>
                    </button>
                    <button type="button" class="studio-tab-close" aria-label={t("Lukk {path}", { path })} title={t("Lukk {path}", { path })} disabled={file.saving} onClick={() => void close(path)}>
                      <IconClose size={12} />
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
        <Show when={error() && !folderMissing()}>
          <div class="studio-error" role="alert">
            <span>{error()}</span>
            <button type="button" aria-label={t("Lukk filfeil")} class="icon-button" onClick={() => setError("")}><IconClose size={12} /></button>
          </div>
        </Show>
        <div id="studio-editor-panel" class="studio-editor-panel" role={current() ? "tabpanel" : undefined} aria-label={selected() ?? undefined}>
          <Show when={current()}>
            {(file) => (
              <>
                <div class="studio-editor-toolbar">
                  <span class="studio-file-breadcrumb" title={selected() ?? ""}>{selected()}</span>
                  <Show when={file().file.reason}><span class="studio-readonly">{t("Skrivebeskyttet")}</span></Show>
                  <button
                    type="button"
                    class="btn btn-small"
                    aria-label={t("Søk i fil")}
                    aria-pressed={searchOpen()}
                    title={t("Søk i fil · Ctrl+F")}
                    onClick={() => {
                      const next = !searchOpen();
                      setSearchOpen(next);
                      if (next) queueMicrotask(() => { searchInput?.focus(); searchInput?.select(); });
                      else { setSearchResult(null); editor?.focus(); }
                    }}
                  >
                    <IconSearch size={13} />
                  </button>
                  <button
                    type="button"
                    class="btn btn-small"
                    aria-label={t("Lagre fil")}
                    title={t("Lagre · Ctrl+S")}
                    disabled={!dirty(file()) || file().saving || !file().file.editable || folderMissing()}
                    onClick={() => void save()}
                  >
                    {file().saving ? t("Lagrer…") : t("Lagre")}
                  </button>
                </div>
                <Show when={searchOpen()}>
                  <form
                    class="studio-search"
                    onSubmit={(e) => { e.preventDefault(); find(); }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
                      else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); find(true); }
                    }}
                  >
                    <input
                      ref={searchInput}
                      aria-label={t("Søk i åpen fil")}
                      placeholder={t("Søk i filen")}
                      value={query()}
                      onInput={(e) => { setQuery(e.currentTarget.value); setSearchResult(null); }}
                    />
                    <Show when={searchResult()}>
                      {(res) => (
                        <span class="studio-search-count" classList={{ miss: res().count === 0 }} aria-live="polite">
                          {res().count === 0 ? t("Ingen treff") : `${res().index} / ${res().count}`}
                        </span>
                      )}
                    </Show>
                    <button class="btn btn-small" type="button" onClick={() => find(true)}>{t("Forrige")}</button>
                    <button class="btn btn-small" type="submit">{t("Neste")}</button>
                    <button class="icon-button" aria-label={t("Lukk filsøk")} title={t("Lukk søk (Esc)")} type="button" onClick={closeSearch}>
                      <IconClose size={13} />
                    </button>
                  </form>
                </Show>
                <Show when={file().conflict}>
                  <div class="studio-conflict" role="status" data-testid="studio-conflict">
                    <strong>{file().conflict === "missing" ? t("Filen er slettet eller flyttet på disken") : t("Filen er endret på disken")}</strong>
                    <p>
                      {file().conflict === "missing"
                        ? t("Utkastet ditt er beholdt i minnet. Du kan lagre det på nytt som en fil eller beholde utkastet åpent.")
                        : file().conflictKept
                          ? t("Utkastet er beholdt. Sammenlign diskversjonen og ta med endringene du vil beholde før ny lagring.")
                          : t("Utkastet ditt er beholdt. Ingenting blir overskrevet automatisk.")}
                    </p>
                    <div>
                      <Show when={file().conflict !== "missing"}>
                        <button type="button" class="btn btn-small" onClick={() => void reloadDisk()}>{t("Last inn fra disk")}</button>
                        <button type="button" class="btn btn-small" onClick={() => setCompare(!compare())}>{compare() ? t("Skjul diskversjon") : t("Vis diskversjon")}</button>
                      </Show>
                      <Show when={file().conflict === "missing" && file().file.editable && !folderMissing()}>
                        <button type="button" class="btn btn-small" disabled={file().saving} onClick={() => void recreateDeleted()}>{t("Lagre på nytt")}</button>
                      </Show>
                      <button type="button" class="btn btn-small" onClick={() => { file().conflictKept = true; touch(); editor?.focus(); }}>{t("Behold utkast")}</button>
                      <Show when={compare() && file().conflict !== "missing"}>
                        <button type="button" class="btn btn-small" onClick={() => void acceptMerged()}>{t("Bruk redigert utkast")}</button>
                      </Show>
                    </div>
                    <Show when={compare() && file().conflict !== "missing"}>
                      <pre aria-label={t("Diskversjon")}>{(file().conflict as EditableFile).text ?? t("Innholdet kan ikke vises")}</pre>
                    </Show>
                  </div>
                </Show>
                <Show when={file().error && !file().conflict}><div class="studio-error" role="alert">{file().error}</div></Show>
                <Show when={file().file.reason}><div class="studio-readonly-reason">{file().file.reason}</div></Show>
              </>
            )}
          </Show>
          <div class="studio-editor-host" data-testid="studio-editor" ref={host} hidden={!current() || current()!.file.text === null || current()!.file.binary || current()!.file.truncated} />
          <Show when={!current()}>
            <div class="studio-editor-empty">
              <span class="studio-empty-icon"><IconFile size={27} /></span>
              <h2>{loading() ? t("Åpner fil…") : t("Prosjektet ditt, i arbeid")}</h2>
              <p>{t("Velg en fil til venstre, eller be agenten lage noe. Nye filer og endringer vises her mens dere jobber.")}</p>
              <button class="btn" type="button" disabled={folderMissing()} onClick={() => { setTreeOpen(true); setCreating(true); }}>{t("Opprett en fil")}</button>
              <span>{t("Ctrl+S lagrer · Ctrl+F søker")}</span>
            </div>
          </Show>
          <Show when={current()?.file.binary || current()?.file.truncated}>
            <div class="studio-editor-empty">
              <span class="studio-empty-icon"><IconFile size={27} /></span>
              <h2>{current()?.file.binary ? t("Binærfil") : t("Filen er for stor for editoren")}</h2>
              <p>{t("Filen er beholdt på disken. Velg en tekstfil for å redigere.")}</p>
            </div>
          </Show>
        </div>
        <footer class="studio-editor-status">
          <span aria-live="polite">
            {savedNote() || (current() ? dirty(current()!) ? t("Ulagret utkast") : t("Lagret på disk") : t("Kode Studio"))}
          </span>
          <span>
            {current() ? t("Linje {line}, kolonne {column} · {eol} · UTF-8", { line: cursor().line, column: cursor().column, eol: current()!.file.eol.toUpperCase() }) : t("Velg en prosjektfil")}
          </span>
        </footer>
      </div>
    </section>
  );
}
