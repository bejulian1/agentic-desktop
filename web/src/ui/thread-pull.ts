import type { LinkedPr, Thread } from "../../../shared/protocol";
import { parsePullUrl, pullUrl } from "../../../shared/linked-pr";
import { patch } from "../lib/api";
import { t } from "../lib/i18n";
import { report } from "../state/app";
import { promptDialog } from "./dialogs";

export function updateThreadPull(threadId: string, linkedPr: LinkedPr | null) {
  return patch(`/api/threads/${threadId}`, { linkedPr }).catch(report);
}

export async function editThreadPull(thread: Thread): Promise<void> {
  const linked = thread.linkedPr;
  const value = await promptDialog({
    title: t("Lenke til GitHub-PR"),
    value: linked ? linked.url ?? pullUrl(linked) : "",
    confirm: t("Lagre"),
    validate: (value) => parsePullUrl(value) ? undefined : t("Lim inn en gyldig lenke til en GitHub-PR."),
  });
  const pull = value && parsePullUrl(value);
  if (pull) await updateThreadPull(thread.id, pull);
}
