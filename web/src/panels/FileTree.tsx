import { t } from "../lib/i18n";
import { For, Show } from "solid-js";
import type { ChangedFile, FileEntry } from "../../../shared/protocol";
import { FileChangeCounts } from "../ui/FileChangeCounts";
import { IconChevron, IconFile, IconFolder } from "../ui/icons";

export function FileTreeEntry(props: {
  entry: FileEntry;
  depth: number;
  selected: string | null;
  listing: (path: string) => FileEntry[] | undefined;
  expanded: (path: string) => boolean;
  toggle: (path: string) => void;
  open: (entry: FileEntry) => void;
  working: string | null;
  changes: ReadonlyMap<string, ChangedFile>;
}) {
  const dir = () => props.entry.kind === "dir";
  const open = () => dir() && props.expanded(props.entry.path);
  return (
    <>
      <button
        type="button"
        class="tree-item"
        classList={{ selected: props.selected === props.entry.path, working: props.working === props.entry.path }}
        style={`padding-left:${10 + props.depth * 14}px`}
        data-path={props.entry.path}
        aria-expanded={dir() ? open() : undefined}
        onClick={() => (dir() ? props.toggle(props.entry.path) : props.open(props.entry))}
      >
        <span class="fold-chevron" classList={{ open: open(), hidden: !dir() }}><IconChevron size={11} /></span>
        {dir() ? <IconFolder size={14} /> : <IconFile size={14} />}
        <span class="tree-name">{props.entry.name}</span>
        <Show when={props.changes.get(props.entry.path)}>{(change) => <FileChangeCounts file={change()} />}</Show>
        <Show when={props.working === props.entry.path}><span class="file-working-dot" title={t("Modellens siste filverktøy")} /></Show>
      </button>
      <Show when={open()}>
        <For each={props.listing(props.entry.path)}>
          {(child) => <FileTreeEntry {...props} entry={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </>
  );
}
