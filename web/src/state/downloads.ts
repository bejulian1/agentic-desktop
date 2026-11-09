// Downloads from the Browser panel: the list from the server, kept up to date by its messages, and
// a small note when one is done. Fetched once, when first needed.
import { createSignal } from "solid-js";
import type { DownloadItem } from "../../../shared/protocol";
import { del, get, post } from "../lib/api";
import { on } from "../lib/socket";
import { report, toast } from "./app";

const [items, setItems] = createSignal<DownloadItem[]>([]);
const [folder, setFolder] = createSignal<{ dir: string; defaultDir: string } | null>(null);
export { folder, items as downloads };

let loaded = false;
export function loadDownloads(force = false): void {
  if (loaded && !force) return;
  loaded = true;
  get<{ dir: string; defaultDir: string; items: DownloadItem[] }>("/api/downloads")
    .then((answer) => {
      setFolder({ dir: answer.dir, defaultDir: answer.defaultDir });
      // Messages that came while the list was on its way are newer: keep them.
      const known = new Map(items().map((i) => [i.id, i]));
      setItems(answer.items.map((i) => known.get(i.id) ?? i).concat(items().filter((i) => !answer.items.some((a) => a.id === i.id))));
    })
    .catch(() => (loaded = false));
}

export function wireDownloads(): () => void {
  const stops = [
    on("download.changed", ({ download }) => {
      const before = items().find((i) => i.id === download.id);
      setItems(before ? items().map((i) => (i.id === download.id ? download : i)) : [download, ...items()]);
      if (download.state === "done" && before?.state !== "done") toast(`Lastet ned «${download.filename}».`, "info");
      if (download.state === "error" && before?.state !== "error") toast(`Nedlastingen av «${download.filename}» feilet: ${download.error ?? "ukjent feil"}`);
    }),
    on("download.removed", ({ id }) => setItems(items().filter((i) => i.id !== id))),
    on("settings.changed", () => {
      if (loaded) loadDownloads(true);
    }),
  ];
  return () => stops.forEach((stop) => stop());
}

export const activeDownloads = () => items().filter((i) => i.state === "progress").length;

export async function cancelDownload(id: string): Promise<void> {
  await post(`/api/downloads/${id}/cancel`).catch(report);
}

// Off the list. The file is deleted only with deleteFile, which the UI confirms first.
export async function removeDownload(id: string, deleteFile = false): Promise<void> {
  try {
    await del(`/api/downloads/${id}${deleteFile ? "?file=1" : ""}`);
    setItems(items().filter((i) => i.id !== id));
  } catch (err) {
    report(err);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1).replace(".", ",") : Math.round(value)} ${units[unit]}`;
}
