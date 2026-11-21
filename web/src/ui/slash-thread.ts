import { t } from "../lib/i18n";
import type { Thread } from "../../../shared/protocol";
import { THREAD_SLASH_COMMANDS } from "../../../shared/slash-thread";
import { renameThread, toast } from "../state/app";
import { archiveMany, restoreMany } from "../state/archive";
import { copyThread, forkFromLast, openInWindow, setPinned, setSnoozed, snoozeTimes, threadEventPages } from "../state/thread-actions";
import { exportThread } from "./ChatTools";
import { promptDialog } from "./dialogs";

type ThreadAction = (thread: Thread, arg: string) => void | Promise<void>;
type ThreadContext = { thread: Thread | undefined; arg: string };

function switchValue(arg: string, fallback: boolean): boolean | undefined {
  switch (arg.toLowerCase()) {
    case "": return fallback;
    case "on": case "på": return true;
    case "off": case "av": return false;
  }
}

const operations: Record<string, ThreadAction> = {
  async title(thread, arg) {
    const name = (arg || await promptDialog({ title: t("Gi tråden nytt navn"), value: thread.title, confirm: t("Lagre") }))?.trim();
    if (name && name !== thread.title) await renameThread(thread.id, name);
  },
  copy(thread, arg) {
    switch (arg.toLowerCase()) {
      case "": case "text": case "tekst": return copyThread(thread, "text");
      case "md": case "markdown": return copyThread(thread, "markdown");
      case "last": case "siste": return copyThread(thread, "last");
      case "id": return copyThread(thread, "id");
      default: return toast(t("Velg /copy text, /copy markdown, /copy last eller /copy id."), "info");
    }
  },
  save(thread) {
    return exportThread(thread.id);
  },
  pin(thread, arg) {
    const pinned = switchValue(arg, !thread.pinned);
    if (pinned === undefined) return toast(t("Bruk /pin, /pin on eller /pin off."), "info");
    return setPinned(thread, pinned);
  },
  async archive(thread, arg) {
    const archive = switchValue(arg, true);
    if (archive === undefined) return toast(t("Bruk /archive for å arkivere eller /archive off for å gjenopprette."), "info");
    if (thread.archived === archive) return toast(archive ? t("Tråden er allerede arkivert.") : t("Tråden ligger allerede i sidefanen."), "info");
    if (archive) await archiveMany({ ids: [thread.id] }, t("denne ruten"));
    else await restoreMany([thread.id]);
  },
  async "fork-last"(thread) {
    if (thread.running) return toast(t("Vent til den aktive turen er ferdig før du lager en gaffel fra siste melding."), "info");
    // Older forks can have a full conversation and no lastStatus of their own.
    if (!thread.lastStatus) {
      let hasUserMessage = false;
      for await (const page of threadEventPages(thread.id)) {
        hasUserMessage = page.some(({ event }) => event.type === "user.message");
        if (hasUserMessage) break;
      }
      if (!hasUserMessage) return toast(t("Tråden har ingen melding å lage en gaffel fra ennå."), "info");
    }
    await forkFromLast(thread);
  },
  window(thread) {
    if (new URLSearchParams(window.location.search).get("rute") === thread.id) return toast(t("Tråden er allerede åpen i et eget vindu."), "info");
    return openInWindow(thread);
  },
  snooze(thread, arg) {
    const choice = arg.toLowerCase();
    if (choice === "off" || choice === "av") return setSnoozed(thread, null);
    const time = snoozeTimes().find((item) => item.id === choice || item.label.toLowerCase() === choice);
    if (!time) return toast(t("Velg /snooze 1h, /snooze tomorrow, /snooze week eller /snooze off."), "info");
    return setSnoozed(thread, time.at);
  },
};

const sidebarActions = new Set(["pin", "archive", "snooze"]);

export const threadSlashActions: Readonly<Record<string, (context: ThreadContext) => void | Promise<void>>> =
  Object.fromEntries(THREAD_SLASH_COMMANDS.map(({ name, args }) => [name, ({ thread, arg }: ThreadContext) => {
    if (!thread) return toast(t("Start en samtale før du bruker /{name}.", { name }), "info");
    if (thread.temporary && sidebarActions.has(name)) return toast(t("Midlertidige chatter ligger utenfor sidefanen og arkivet."), "info");
    const value = arg.trim();
    if (value && !args) return toast(t("/{name} brukes uten argumenter.", { name }), "info");
    return operations[name](thread, value);
  }]));
