// Round 14 (SPEC 30.4): archiving several threads at once, always with Angre in the toast, and
// which project the archive page shows when it is opened from a project's menu.
import { createSignal } from "solid-js";
import { post } from "../lib/api";
import { report, setSettingsOpen, toast } from "./app";

export type ArchiveTarget = { ids: string[] } | { projectId: string } | { chatProjectId: string };
export type ArchiveScope = { kind: "project" | "chat-project"; id: string } | null;

const [archiveScope, setArchiveScope] = createSignal<ArchiveScope>(null);
export { archiveScope, setArchiveScope };

// The archive page, all of it or one project's part.
export function openArchive(scope: ArchiveScope = null): void {
  setArchiveScope(scope);
  setSettingsOpen("archived");
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

async function send(target: ArchiveTarget, archived: boolean): Promise<{ ids: string[]; running: number }> {
  return post<{ ids: string[]; running: number }>("/api/threads/archive", { ...target, archived });
}

// Archives, and says what happened: how many, what still runs, and Angre to bring them back.
export async function archiveMany(target: ArchiveTarget, where: string, noun: { one: string; many: string } = { one: "tråd", many: "tråder" }): Promise<string[]> {
  try {
    const { ids, running } = await send(target, true);
    const still = running ? ` ${count(running, noun.one, noun.many)} kjører fortsatt og ble stående.` : "";
    if (!ids.length) {
      toast(running ? `Ingenting arkivert.${still}` : `Ingen ${noun.many} å arkivere.`, "info");
      return ids;
    }
    toast(`Arkiverte ${count(ids.length, noun.one, noun.many)} fra ${where}.${still}`, "info", { label: "Angre", run: () => void restoreMany(ids, true) });
    return ids;
  } catch (err) {
    report(err);
    return [];
  }
}

export async function restoreMany(ids: string[], quiet = false, noun: { one: string; many: string } = { one: "tråd", many: "tråder" }): Promise<void> {
  try {
    const result = await send({ ids }, false);
    if (!quiet) toast(`Gjenopprettet ${count(result.ids.length, noun.one, noun.many)}.`, "info", { label: "Angre", run: () => void send({ ids: result.ids }, true).catch(report) });
  } catch (err) {
    report(err);
  }
}
