// The file tree, read-only. CodeMirror is its own chunk, loaded when the first file opens.
import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { get } from "../lib/api";
import { on } from "../lib/socket";
import type { FileContent, FileEntry } from "../../../shared/protocol";
import { report } from "../state/app";
import { fileRequest, noteRecentFile } from "../state/nav";
import { IconChevron, IconFile, IconFolder } from "../ui/icons";
import type { ReadonlyEditor } from "./editor";
import { openMiniEditor, preloadMiniEditor } from "../ui/MiniEditorHooks";

const treeCache = new Map<string, Map<string, FileEntry[]>>();

function Entry(props: {
  entry: FileEntry;
  depth: number;
  selected: string | null;
  listing: (path: string) => FileEntry[] | undefined;
  expanded: (path: string) => boolean;
  toggle: (path: string) => void;
  open: (entry: FileEntry) => void;
}) {
  const dir = () => props.entry.kind === "dir";
  const open = () => dir() && props.expanded(props.entry.path);
  return (
    <>
      <button
        type="button"
        class="tree-item"
        classList={{ selected: props.selected === props.entry.path }}
        style={`padding-left:${10 + props.depth * 14}px`}
        data-path={props.entry.path}
        aria-expanded={dir() ? open() : undefined}
        onClick={() => (dir() ? props.toggle(props.entry.path) : props.open(props.entry))}
      >
        <span class="fold-chevron" classList={{ open: open(), hidden: !dir() }}><IconChevron size={11} /></span>
        {dir() ? <IconFolder size={14} /> : <IconFile size={14} />}
        <span class="tree-name">{props.entry.name}</span>
      </button>
      <Show when={open()}>
        <For each={props.listing(props.entry.path)}>
          {(child) => <Entry {...props} entry={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </>
  );
}

export default function FilesPanel(props: { projectId: string }) {
  let cache = treeCache.get(props.projectId);
  if (!cache) treeCache.set(props.projectId, (cache = new Map()));
  const dirs = cache;
  const [version, setVersion] = createSignal(0);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = createSignal<string | null>(null);
  const [file, setFile] = createSignal<FileContent | null>(null);
  const [error, setError] = createSignal("");
  let host!: HTMLDivElement;
  let editor: ReadonlyEditor | undefined;

  const loadDir = async (path: string) => {
    try {
      dirs.set(path, await get<FileEntry[]>(`/api/projects/${props.projectId}/tree?path=${encodeURIComponent(path)}`));
      setVersion(version() + 1);
    } catch (err) {
      if (path === ".") report(err);
      dirs.delete(path);
    }
  };

  const openFile = async (path: string) => {
    setSelected(path);
    noteRecentFile(props.projectId, path);
    try {
      const content = await get<FileContent>(`/api/projects/${props.projectId}/file?path=${encodeURIComponent(path)}`);
      if (selected() !== path) return;
      setError("");
      setFile(content);
    } catch (err) {
      setFile(null);
      setError((err as Error).message);
    }
  };

  createEffect(() => {
    const content = file();
    if (!content?.text && content?.text !== "") return;
    void import("./editor").then(({ createReadonlyEditor }) => {
      if (file() !== content) return;
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

  onMount(() => {
    void loadDir(".");
    const stop = on("project.files-changed", ({ projectId, paths }) => {
      if (projectId !== props.projectId) return;
      void loadDir(".");
      for (const path of expanded()) void loadDir(path);
      const current = selected();
      if (current && paths.includes(current)) void openFile(current);
    });
    onCleanup(stop);
  });
  onCleanup(() => editor?.destroy());

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
      <div class="tree" role="tree">
        <For each={listing(".")} fallback={<div class="panel-empty">Mappen er tom</div>}>
          {(entry) => (
            <Entry entry={entry} depth={0} selected={selected()} listing={listing} expanded={(p) => expanded().has(p)} toggle={toggle} open={(e) => openFile(e.path)} />
          )}
        </For>
      </div>
      <div class="file-view" classList={{ open: !!selected() }}>
        <Show when={selected()}>
          <div class="file-path-row">
            <div class="file-path" title={selected()!}><bdo dir="ltr">{selected()}</bdo></div>
            <Show when={file() && !file()!.binary}>
              <button type="button" class="btn btn-small btn-ghost file-edit" title="Åpne i mini-editoren for å søke, se oversikten eller redigere" onPointerEnter={preloadMiniEditor} onClick={(e) => openMiniEditor({ kind: "file", projectId: props.projectId, path: selected()!, source: e.currentTarget })}>Rediger</button>
            </Show>
          </div>
        </Show>
        <Show when={error()}><div class="panel-empty">{error()}</div></Show>
        <Show when={file()?.binary}><div class="panel-empty">Binærfil, {file()!.size} byte. Vises ikke.</div></Show>
        <Show when={file()?.truncated}><div class="file-note">Filen er stor, så bare starten vises.</div></Show>
        <div class="editor-host" ref={host} style={file()?.binary || !selected() ? "display:none" : undefined} data-testid="editor" />
      </div>
    </div>
  );
}
