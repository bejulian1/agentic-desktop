// The user's file viewer on Denne datamaskinen. It never selects a project or grants model tools.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { ChangedFile, FileContent, FileEntry } from "../../../shared/protocol";
import { get, post } from "../lib/api";
import { IconBack, IconFolder, IconFolderOpen, IconReload } from "../ui/icons";
import { FileTreeEntry } from "./FileTree";
import type { ReadonlyEditor } from "./editor";
import "../styles/local-files.css";

let rememberedFolder: string | null = null;
const noChanges = new Map<string, ChangedFile>();
const parentOf = (folder: string) => folder.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";

export default function LocalFiles() {
  const [root, setRoot] = createSignal("");
  const [home, setHome] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [busy, setBusy] = createSignal(true);
  const [folderError, setFolderError] = createSignal("");
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [version, setVersion] = createSignal(0);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [content, setContent] = createSignal<FileContent | null>(null);
  const [fileError, setFileError] = createSignal("");
  const [loadingFile, setLoadingFile] = createSignal(false);
  const dirs = new Map<string, FileEntry[]>();
  const requests = new Map<string, number>();
  let alive = true;
  let navigation = 0;
  let fileRequest = 0;
  let host!: HTMLDivElement;
  let editor: ReadonlyEditor | undefined;
  const listing = (path: string) => { version(); return dirs.get(path); };
  const message = (err: unknown) => err instanceof Error ? err.message : "Kunne ikke lese filene.";

  const openFolder = async (folder: string) => {
    const mine = ++navigation;
    ++fileRequest;
    setBusy(true); setFolderError(""); setSelected(null); setContent(null); setFileError(""); setLoadingFile(false);
    try {
      const entries = await get<FileEntry[]>(`/api/local/files/tree?path=${encodeURIComponent(folder)}`);
      if (!alive || navigation !== mine) return;
      dirs.clear(); requests.clear(); dirs.set(folder, entries);
      setRoot(folder); setAddress(folder); setExpanded(new Set<string>()); setVersion((v) => v + 1);
      rememberedFolder = folder;
    } catch (err) {
      if (alive && navigation === mine) { setFolderError(message(err)); setAddress(root()); }
    } finally { if (alive && navigation === mine) setBusy(false); }
  };
  const loadDir = async (folder: string) => {
    const generation = navigation;
    const mine = (requests.get(folder) ?? 0) + 1;
    requests.set(folder, mine);
    try {
      const entries = await get<FileEntry[]>(`/api/local/files/tree?path=${encodeURIComponent(folder)}`);
      if (!alive || navigation !== generation || requests.get(folder) !== mine) return;
      dirs.set(folder, entries); setVersion((v) => v + 1);
    } catch (err) { if (alive && navigation === generation && requests.get(folder) === mine) setFolderError(message(err)); }
  };
  const toggle = (folder: string) => {
    const next = new Set(expanded());
    if (next.has(folder)) next.delete(folder); else { next.add(folder); void loadDir(folder); }
    setExpanded(next);
  };
  const openFile = async (path: string) => {
    const mine = ++fileRequest;
    const generation = navigation;
    setSelected(path); setContent(null); setFileError(""); setLoadingFile(true);
    try {
      const result = await get<FileContent>(`/api/local/files/file?path=${encodeURIComponent(path)}`);
      if (!alive || navigation !== generation || mine !== fileRequest) return;
      setContent(result);
      if (!result.binary && typeof result.text === "string") {
        const { createReadonlyEditor } = await import("./editor");
        if (!alive || navigation !== generation || mine !== fileRequest) return;
        editor ??= createReadonlyEditor(host);
        await editor.show(result.path, result.text);
      }
    } catch (err) { if (alive && navigation === generation && mine === fileRequest) { setContent(null); setFileError(message(err)); } }
    finally { if (alive && navigation === generation && mine === fileRequest) setLoadingFile(false); }
  };
  const chooseFolder = async () => {
    const mine = navigation;
    try {
      const choice = await post<{ path: string | null }>("/api/fs/pick-folder", {});
      if (alive && navigation === mine && choice.path) await openFolder(choice.path);
    } catch { if (alive && navigation === mine) setFolderError("Mappevelgeren er ikke tilgjengelig. Skriv en full mappesti i feltet over."); }
  };
  onMount(() => {
    const mine = navigation;
    void get<{ path: string }>("/api/local/files/root").then((value) => {
      if (!alive) return;
      setHome(value.path);
      if (navigation !== mine) return;
      void openFolder(rememberedFolder ?? value.path);
    }).catch((err) => { if (alive && navigation === mine) { setFolderError(message(err)); setBusy(false); } });
  });
  onCleanup(() => { alive = false; ++navigation; ++fileRequest; editor?.destroy(); });

  return <div class="files-panel local-files-panel" data-testid="files-panel" data-scope="local">
    <form class="local-files-address" onSubmit={(e) => { e.preventDefault(); if (address().trim()) void openFolder(address().trim()); }}>
      <button type="button" class="icon-button" aria-label="Opp ett nivå" title="Opp ett nivå" disabled={!root() || root() === "/" || busy()} onClick={() => void openFolder(parentOf(root()))}><IconBack size={14} /></button>
      <label class="local-files-location"><IconFolder size={14} /><input aria-label="Mappesti" value={address()} onInput={(e) => setAddress(e.currentTarget.value)} placeholder="Skriv en full mappesti" spellcheck={false} /></label>
      <button type="submit" class="btn btn-small" disabled={!address().trim() || busy()}>Åpne</button>
      <button type="button" class="icon-button" aria-label="Åpne mappe" title="Velg mappe" disabled={busy()} onClick={() => void chooseFolder()}><IconFolderOpen size={15} /></button>
    </form>
    <div class="local-files-meta"><button type="button" class="link-button" disabled={!home() || busy()} onClick={() => void openFolder(home())}>Hjem</button><span>Lesemodus</span><button type="button" class="icon-button" aria-label="Last mappen på nytt" title="Last mappen på nytt" disabled={!root() || busy()} onClick={() => void openFolder(root())}><IconReload size={13} /></button></div>
    <Show when={folderError()}><div class="local-files-error" role="alert">{folderError()}</div></Show>
    <div class="local-files-content">
      <div class="tree" role="tree" aria-label="Lokale filer" aria-busy={busy()} inert={busy() || undefined}>
        <Show when={!busy()} fallback={<div class="panel-empty" role="status">Åpner mappe…</div>}>
          <For each={listing(root())} fallback={<div class="panel-empty">{root() ? "Mappen er tom" : "Åpne en mappe for å se filene."}</div>}>
            {(entry) => <FileTreeEntry entry={entry} depth={0} selected={selected()} listing={listing} expanded={(p) => expanded().has(p)} toggle={toggle} open={(e) => void openFile(e.path)} working={null} changes={noChanges} />}
          </For>
        </Show>
      </div>
      <section class="file-view" classList={{ open: !!selected() }} aria-label="Filvisning">
        <Show when={selected()} fallback={<div class="local-file-welcome"><IconFolderOpen size={28} /><strong>Åpne fil</strong><p>Velg en fil i trevisningen for å lese den.</p></div>}>
          <div class="file-path-row"><div class="file-path" title={selected()!}><bdo dir="ltr">{selected()}</bdo></div></div>
        </Show>
        <Show when={loadingFile()}><div class="panel-empty" role="status">Åpner fil…</div></Show>
        <Show when={fileError()}><div class="local-files-error" role="alert">{fileError()}<button type="button" class="btn btn-small" onClick={() => void openFile(selected()!)}>Prøv igjen</button></div></Show>
        <Show when={content()?.binary}><div class="panel-empty">Binærfil, {content()!.size} byte. Vises ikke.</div></Show>
        <Show when={content()?.truncated}><div class="file-note">Filen er stor, så bare starten vises.</div></Show>
        <div class="editor-host" ref={host} hidden={!content() || content()?.binary || loadingFile()} data-testid="editor" />
      </section>
    </div>
  </div>;
}
