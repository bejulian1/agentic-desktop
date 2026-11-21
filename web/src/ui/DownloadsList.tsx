import { Rich } from "./settings/parts";
// The Browser panel's downloads: a list with progress, the reason when one stopped, Kopier stien
// (shows and copies the path; the app never opens a file manager or a file), Fjern fra lista (also
// while it runs: it is stopped first) and, after asking, Slett filen. And the row for the folder in
// Innstillinger → Nettleser.
import { createSignal, For, onMount, Show } from "solid-js";
import type { DownloadItem } from "../../../shared/protocol";
import { patch } from "../lib/api";
import { app, report, setSettingsOpen, toast } from "../state/app";
import { cancelDownload, downloads, folder, formatBytes, loadDownloads, removeDownload } from "../state/downloads";
import { confirmDialog, pickFolder } from "./dialogs";
import { IconClose, IconCopy, IconFile, IconFolder } from "./icons";

import { t } from "../lib/i18n";
// A function, so the labels follow the active language.
const stateLabel = (state: DownloadItem["state"]): string => ({ progress: t("Laster ned"), done: t("Ferdig"), canceled: t("Avbrutt"), error: t("Feilet") })[state];

async function copy(text: string, copied: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(copied, "info");
  } catch {
    toast(t("Nettleseren slapp ikke til utklippstavlen."));
  }
}

function Row(props: { item: DownloadItem }) {
  const [shown, setShown] = createSignal(false);
  const percent = () => (props.item.totalBytes ? Math.min(100, Math.round((props.item.receivedBytes / props.item.totalBytes) * 100)) : null);
  const size = () => {
    const { receivedBytes, totalBytes, state } = props.item;
    if (state === "progress") return totalBytes ? t("{received} av {total}", { received: formatBytes(receivedBytes), total: formatBytes(totalBytes) }) : formatBytes(receivedBytes);
    return formatBytes(totalBytes || receivedBytes);
  };
  const deleteFile = async () => {
    const ok = await confirmDialog({
      title: t("Slette filen?"),
      text: t("«{name}» slettes fra nedlastingsmappen. Dette kan ikke angres.", { name: props.item.filename }),
      confirm: t("Slett filen"),
      danger: true,
    });
    if (ok) await removeDownload(props.item.id, true);
  };
  return (
    <div class="download-row" data-download={props.item.id} data-state={props.item.state}>
      <IconFile size={16} />
      <div class="download-main">
        <div class="download-name" title={props.item.url}>{props.item.filename}</div>
        <div class="download-meta">
          <span class="download-state" data-state={props.item.state}>{stateLabel(props.item.state)}</span>
          <span>{size()}</span>
          <Show when={props.item.state === "progress" && percent() !== null}><span>{percent()} %</span></Show>
        </div>
        <Show when={(props.item.state === "canceled" || props.item.state === "error") && props.item.error}>
          <div class="download-error" data-state={props.item.state}>{props.item.error}</div>
        </Show>
        <Show when={props.item.state === "progress"}>
          <div class="download-bar" role="progressbar" aria-label={t("Fremdrift for {name}", { name: props.item.filename })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent() ?? undefined}>
            <span classList={{ unknown: percent() === null }} style={percent() !== null ? `transform:scaleX(${percent()! / 100})` : undefined} />
          </div>
        </Show>
        <Show when={shown() && props.item.path}>
          <div class="download-path"><bdo dir="ltr">{props.item.path}</bdo></div>
        </Show>
        <div class="download-actions">
          <Show when={props.item.state === "progress"}>
            <button type="button" class="btn btn-small" onClick={() => cancelDownload(props.item.id)}>{t("Avbryt")}</button>
          </Show>
          <Show when={props.item.state === "done" && props.item.path}>
            <button
              type="button"
              class="btn btn-small"
              title={t("Viser hvor filen ligger og kopierer stien. Appen åpner aldri filer eller mapper selv.")}
              onClick={() => {
                setShown(true);
                void copy(props.item.path!, t("Kopierte stien."));
              }}
            >
              <IconCopy size={13} />{t("Kopier stien")}
            </button>
          </Show>
          <button
            type="button"
            class="btn btn-small"
            title={props.item.state === "progress" ? t("Stopper nedlastingen og fjerner den halve filen") : t("Filen blir liggende i mappen")}
            onClick={() => removeDownload(props.item.id)}
          >
            {t("Fjern fra lista")}
          </button>
          <Show when={props.item.state === "done" && props.item.path}>
            <button type="button" class="btn btn-small btn-quiet-danger" onClick={deleteFile}>{t("Slett filen…")}</button>
          </Show>
        </div>
      </div>
    </div>
  );
}

export function DownloadsList(props: { onClose: () => void }) {
  onMount(() => loadDownloads());
  return (
    <div class="browser-downloads" role="region" aria-label={t("Nedlastinger")} data-testid="downloads">
      <div class="browser-downloads-head">
        <strong>{t("Nedlastinger")}</strong>
        <span class="sidebar-spacer" />
        <button type="button" class="icon-button" aria-label={t("Lukk nedlastingene")} title={t("Lukk")} onClick={props.onClose}><IconClose size={14} /></button>
      </div>
      <div class="browser-downloads-folder">
        <IconFolder size={13} />
        <bdo dir="ltr" title={folder()?.dir}>{folder()?.dir ?? "…"}</bdo>
        <button type="button" class="link-button" onClick={() => setSettingsOpen("browser")}>{t("Endre")}</button>
      </div>
      <div class="browser-downloads-list">
        <For each={downloads()} fallback={<p class="newtab-empty">{t("Ingen nedlastinger ennå. Filer du laster ned fra en side, havner i mappen over. Ingenting åpnes eller kjøres av seg selv.")}</p>}>
          {(item) => <Row item={item} />}
        </For>
      </div>
    </div>
  );
}

// Innstillinger → Nettleser: where downloads go.
export function DownloadDirRow() {
  onMount(() => loadDownloads(true));
  const current = () => app.settings.downloadDir || folder()?.defaultDir || "";
  const save = async (dir: string) => {
    try {
      // The server checks the path, and its answer to every window updates the settings.
      await patch("/api/settings", { downloadDir: dir });
      loadDownloads(true);
      toast(dir ? t("Nedlastingsmappen er endret.") : t("Bruker standardmappen for nedlastinger."), "info");
    } catch (err) {
      report(err);
      loadDownloads(true);
    }
  };
  return (
    <div class="setting download-dir-row" data-testid="download-dir">
      <IconFolder size={16} />
      <div class="setting-text">
        <strong>{t("Nedlastingsmappe")}</strong>
        <span class="muted">{t("Filer du laster ned i Nettleser-panelet havner her. Mappen lages ved første nedlasting, og ingenting åpnes eller kjøres av seg selv.")}</span>
        <span class="download-dir-path"><Rich text={app.settings.downloadDir ? "{value}" : t("{value} (standard)")} parts={{ value: <bdo dir="ltr">{current()}</bdo> }} /></span>
      </div>
      <div class="setting-control">
        <button
          type="button"
          class="btn btn-small"
          onClick={async () => {
            // Starts in the home folder: the download folder may not exist yet.
            const dir = await pickFolder(undefined, t("Velg mappe for nedlastinger"));
            if (dir) await save(dir);
          }}
        >
          {t("Velg mappe…")}
        </button>
        <Show when={app.settings.downloadDir}>
          <button type="button" class="btn btn-small" onClick={() => save("")}>{t("Standard")}</button>
        </Show>
      </div>
    </div>
  );
}
