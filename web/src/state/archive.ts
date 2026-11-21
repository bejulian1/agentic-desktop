// Round 14 (SPEC 30.4): archiving several threads at once, always with Angre in the toast, and
// which project the archive page shows when it is opened from a project's menu.
import { createSignal } from "solid-js";
import { post } from "../lib/api";
import { plural, t } from "../lib/i18n";
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

async function send(target: ArchiveTarget, archived: boolean): Promise<{ ids: string[]; running: number }> {
  return post<{ ids: string[]; running: number }>("/api/threads/archive", { ...target, archived });
}

// Archives, and says what happened: how many, what still runs, and Angre to bring them back.
export async function archiveMany(target: ArchiveTarget, where: string, noun: { one: string; many: string } = { one: "tråd", many: "tråder" }): Promise<string[]> {
  try {
    const { ids, running } = await send(target, true);
    const chats = noun.one === "chat";
    const still = !running ? "" : chats
      ? plural(running, "{count} chat kjører fortsatt og ble stående.", "{count} chatter kjører fortsatt og ble stående.")
      : plural(running, "{count} tråd kjører fortsatt og ble stående.", "{count} tråder kjører fortsatt og ble stående.");
    if (!ids.length) {
      toast(running ? t("Ingenting arkivert. {still}", { still }) : chats ? t("Ingen chatter å arkivere.") : t("Ingen tråder å arkivere."), "info");
      return ids;
    }
    const archived = chats
      ? plural(ids.length, "Arkiverte {count} chat fra {where}.", "Arkiverte {count} chatter fra {where}.", { where })
      : plural(ids.length, "Arkiverte {count} tråd fra {where}.", "Arkiverte {count} tråder fra {where}.", { where });
    toast(still ? t("{archived} {still}", { archived, still }) : archived, "info", { label: t("Angre"), run: () => void restoreMany(ids, true) });
    return ids;
  } catch (err) {
    report(err);
    return [];
  }
}

export async function restoreMany(ids: string[], quiet = false, noun: { one: string; many: string } = { one: "tråd", many: "tråder" }): Promise<void> {
  try {
    const result = await send({ ids }, false);
    if (!quiet) toast(noun.one === "chat"
      ? plural(result.ids.length, "Gjenopprettet {count} chat.", "Gjenopprettet {count} chatter.")
      : plural(result.ids.length, "Gjenopprettet {count} tråd.", "Gjenopprettet {count} tråder."), "info", { label: t("Angre"), run: () => void send({ ids: result.ids }, true).catch(report) });
  } catch (err) {
    report(err);
  }
}
