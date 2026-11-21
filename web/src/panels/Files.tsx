// The file tree and preview. Editing opens the mini editor; CodeMirror loads on demand.
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { get } from "../lib/api";
import { on } from "../lib/socket";
import type { FileContent, FileEntry } from "../../../shared/protocol";
import { app, LOCAL_SCOPE, report } from "../state/app";
import { currentFileActivity, peekModel } from "../state/thread-model";
import { FileChangeCounts } from "../ui/FileChangeCounts";
import type { ChangedFile } from "../../../shared/protocol";
import { fileRequest, noteRecentFile, registerOpenedFile, requestFile } from "../state/nav";
import { FileTreeEntry } from "./FileTree";
import LocalFiles from "./LocalFiles";
import type { ReadonlyEditor } from "./editor";
import { openMiniEditor, preloadMiniEditor } from "../ui/MiniEditorHooks";
import { enterStudio } from "../ui/ModeSwitch";

const treeCache = new Map<string, Map<string, FileEntry[]>>();


function ProjectFilesPanel(props: { projectId: string; threadId: () => string | null }) {
  const model = createMemo(() => {
    const id = props.threadId();
    const thread = id ? app.threads[id] : undefined;
    return id && thread?.mode === "code" && thread.projectId === props.projectId ? peekModel(id) : undefined;
  });
  const working = createMemo(() => currentFileActivity(model()?.activity() ?? null));
  const workingPath = createMemo(() => {
    const path = working()?.path;
    if (!path) return null;
    const root = app.projects[props.projectId]?.path?.replace(/\/$/, "");
    if (path.startsWith("/")) return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/") || null;
  });
  const workingNow = () => model()?.activity()?.running && ["running", "pending", "awaiting-approval"].includes(working()?.status ?? "");
  // Counts are the latest recorded, non-reverted turn per file, never guessed from text/tool input.
  const changes = createMemo(() => {
    const files = new Map<string, ChangedFile>();
    for (const row of model()?.changes() ?? []) {
      row.rev();
      if (!row.reverted) for (const file of row.files) files.set(file.path, file);
    }
    return files;
  });
  let cache = treeCache.get(props.projectId);
  if (!cache) treeCache.set(props.projectId, (cache = new Map()));
  const dirs = cache;
  const [version, setVersion] = createSignal(0);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = createSignal<string | null>(null);
  const [file, setFile] = createSignal<FileContent | null>(null);
  const [fileThreadId, setFileThreadId] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");
  let host!: HTMLDivElement;
  let editor: ReadonlyEditor | undefined;
  let alive = true;
  let fileRequestId = 0;
  const dirRequests = new Map<string, number>();

  const loadDir = async (path: string) => {
    const requestId = (dirRequests.get(path) ?? 0) + 1;
    dirRequests.set(path, requestId);
    try {
      const entries = await get<FileEntry[]>(`/api/projects/${props.projectId}/tree?path=${encodeURIComponent(path)}`);
      if (!alive || dirRequests.get(path) !== requestId) return;
      dirs.set(path, entries);
      setVersion((v) => v + 1);
    } catch (err) {
      if (!alive || dirRequests.get(path) !== requestId) return;
      if (path === ".") report(err);
      dirs.delete(path);
      setVersion((v) => v + 1);
    }
  };

  const openFile = async (path: string) => {
    const requestId = ++fileRequestId;
    const threadId = props.threadId();
    setSelected(path);
    setFile(null);
    setError("");
    noteRecentFile(props.projectId, path);
    try {
      const content = await get<FileContent>(`/api/projects/${props.projectId}/file?path=${encodeURIComponent(path)}`);
      if (!alive || fileRequestId !== requestId) return;
      setError("");
      setFileThreadId(threadId);
      setFile(content);
    } catch (err) {
      if (!alive || fileRequestId !== requestId) return;
      setFile(null);
      setError((err as Error).message);
    }
  };

  createEffect(() => {
    const content = file();
    const threadId = props.threadId();
    if (!content || content.binary || content.truncated || typeof content.text !== "string" || fileThreadId() !== threadId) return;
    onCleanup(registerOpenedFile(props.projectId, threadId, content.path));
  });

  createEffect(() => {
    const content = file();
    if (!content?.text && content?.text !== "") return;
    void import("./editor").then(({ createReadonlyEditor }) => {
      if (!alive || file() !== content) return;
      editor ??= createReadonlyEditor(host);
      void editor.show(content.path, content.text ?? "");
    });
  });

  // A file asked for from the palette or the Utdata list: open its folders and show it.
  createEffect(() => {
    const request = fileRequest();
    if (!request || request.projectId !== props.projectId) return;
    untrack(() => show(request.path));
  });
  function show(path: string): void {
    const parts = path.split("/");
    const next = new Set(expanded());
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!next.has(dir)) {
        next.add(dir);
        void loadDir(dir);
      }
    }
    setExpanded(next);
    void openFile(path);
  }

  // The file the thread last worked on opens by itself, but only while it is still there: after
  // Angre tur (or a delete) the activity still names it, and asking for it would just be a 404.
  const showIfPresent = async (path: string) => {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    // A fresh listing of its folder: the cached one may be from before the file went away.
    const entries = await get<FileEntry[]>(`/api/projects/${props.projectId}/tree?path=${encodeURIComponent(parent)}`).catch(() => null);
    if (!alive || selected() || workingPath() !== path) return;
    if (entries?.some((entry) => entry.path === path && entry.kind === "file")) show(path);
  };
  createEffect(() => {
    const path = workingPath();
    if (path) untrack(() => { if (!selected()) void showIfPresent(path); });
  });

  onMount(() => {
    void loadDir(".");
    const stop = on("project.files-changed", ({ projectId, paths }) => {
      if (projectId !== props.projectId) return;
      void loadDir(".");
      for (const path of expanded()) void loadDir(path);
      const current = selected();
      if (current && (paths.includes(current) || paths.includes("."))) void openFile(current);
    });
    onCleanup(stop);
  });
  onCleanup(() => {
    alive = false;
    editor?.destroy();
  });

  const toggle = (path: string) => {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      void loadDir(path);
    }
    setExpanded(next);
  };

  const listing = (path: string) => {
    version();
    return dirs.get(path);
  };

  return (
    <div class="files-panel" data-testid="files-panel">
      <Show when={workingPath()}>
        {(path) => <button type="button" class="file-activity" data-testid="file-activity" data-path={path()} data-active={!!workingNow()} onClick={() => show(path())} title={`Vis ${path()}`}>
          <span>{workingNow() ? working()?.status === "awaiting-approval" ? "Venter på tillatelse" : working()?.tool === "read_file" ? "Leser" : working()?.tool === "delete_file" ? "Sletter" : "Redigerer" : working()?.status === "error" ? "Filverktøyet feilet" : working()?.status === "cancelled" ? "Filverktøyet ble avbrutt" : "Siste filverktøy"}</span>
          <bdo dir="ltr">{path()}</bdo>
          <span class="file-activity-open">Vis fil</span>
        </button>}
      </Show>
      <div class="tree" role="tree">
        <For each={listing(".")} fallback={<div class="panel-empty">Mappen er tom</div>}>
          {(entry) => (
            <FileTreeEntry entry={entry} depth={0} selected={selected()} listing={listing} expanded={(p) => expanded().has(p)} toggle={toggle} open={(e) => openFile(e.path)} working={workingPath()} changes={changes()} />
          )}
        </For>
      </div>
      <div class="file-view" classList={{ open: !!selected() }}>
        <Show when={selected()}>
          <div class="file-path-row">
            <div class="file-path" title={selected()!}><bdo dir="ltr">{selected()}</bdo></div>
            <Show when={changes().get(selected()!)}>{(change) => <FileChangeCounts file={change()} />}</Show>
            <Show when={file() && !file()!.binary}>
              <button type="button" class="btn btn-small btn-ghost file-edit" title="Åpne i mini-editoren for å søke, se oversikten eller redigere" onPointerEnter={preloadMiniEditor} onClick={(e) => openMiniEditor({ kind: "file", projectId: props.projectId, path: selected()!, source: e.currentTarget })}>Rediger</button>
              <button type="button" class="btn btn-small btn-ghost file-studio" title="Åpne denne filen i Kode Studio" onClick={() => { const path = selected()!; enterStudio(); requestFile(props.projectId, path); }}>Studio</button>
            </Show>
          </div>
        </Show>
        <Show when={error()}><div class="panel-empty">{error()}</div></Show>
        <Show when={file()?.binary}><div class="panel-empty">Binærfil, {file()!.size} byte. Vises ikke.</div></Show>
        <Show when={file()?.truncated}><div class="file-note">Filen er stor, så bare starten vises.</div></Show>
        <div class="editor-host" ref={host} style={!file() || file()?.binary ? "display:none" : undefined} data-testid="editor" />
      </div>
    </div>
  );
}

export default function FilesPanel(props: { projectId: string; threadId: () => string | null }) {
  return <Show when={props.projectId !== LOCAL_SCOPE} fallback={<LocalFiles />}>
    <ProjectFilesPanel {...props} />
  </Show>;
}
