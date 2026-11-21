import { language, t } from "../lib/i18n.ts";
// What the thread menu does, shared by the sidebar, the smart sidebar and the shortcuts: pin,
// side chat, branches, copy, snooze, a new window and archive.
import type { Thread, ThreadEventEnvelope } from "../../../shared/protocol";
import { get, patch, post } from "../lib/api";
import { app, archiveThread, report, scopeOf, toast } from "./app";
import { forkThread } from "./actions";
import { gridFor } from "./grid";
import { openThread } from "./navigate";
import { openDetachedWindow } from "./windows";

export async function setPinned(thread: Thread, pinned: boolean): Promise<void> {
  try {
    await patch(`/api/threads/${thread.id}`, { pinned });
    toast(pinned ? t("Festet tråden.") : t("Løsnet tråden."), "info");
  } catch (err) {
    report(err);
  }
}

export async function setSnoozed(thread: Thread, until: number | null): Promise<void> {
  try {
    await patch(`/api/threads/${thread.id}`, { snoozedUntil: until });
    toast(until ? t("Utsatt til {time}.", { time: new Date(until).toLocaleString(language(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : t("Hentet tilbake."), "info");
  } catch (err) {
    report(err);
  }
}

// The snooze choices: an hour, tomorrow morning and next Monday morning, in local time.
export function snoozeTimes(now = new Date()): Array<{ id: "1h" | "tomorrow" | "week"; label: string; at: number }> {
  const morning = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(8, 0, 0, 0);
    return d.getTime();
  };
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    { id: "1h", label: t("Om 1 time"), at: now.getTime() + 3_600_000 },
    { id: "tomorrow", label: t("I morgen"), at: morning(1) },
    { id: "week", label: t("Neste uke"), at: morning(toMonday) },
  ];
}

// The copy or the side chat opens beside the original, so both stay in view.
async function openBeside(originalId: string, thread: Thread): Promise<void> {
  const grid = gridFor(scopeOf(thread));
  await grid.loaded;
  const pane = grid.paneWith(originalId);
  if (!pane || !grid.split(pane.id, "right", thread.id)) await openThread(thread);
}

export async function sideChat(thread: Thread, onCreated?: (side: Thread) => void): Promise<void> {
  try {
    const side = await post<Thread>("/api/threads", { projectId: thread.projectId, mode: thread.mode, sideOf: thread.id });
    onCreated?.(side);
    await openBeside(thread.id, side);
  } catch (err) {
    report(err);
  }
}

export async function forkFromLast(thread: Thread): Promise<void> {
  try {
    const branch = await post<Thread>(`/api/threads/${thread.id}/fork`, { from: "last" });
    await openBeside(thread.id, branch);
    toast(t("Laget «{title}» fra siste melding.", { title: branch.title }), "info");
  } catch (err) {
    report(err);
  }
}

export const forkWhole = (thread: Thread) => forkThread(thread.id);

// Event pages are ordered oldest first. Each request starts after the last event already read.
export async function* threadEventPages(threadId: string): AsyncGenerator<ThreadEventEnvelope[]> {
  const size = 5000;
  let after = 0;
  for (;;) {
    const page = await get<ThreadEventEnvelope[]>(`/api/threads/${encodeURIComponent(threadId)}/events?after=${after}&limit=${size}`);
    if (page.length) yield page;
    if (page.length < size) return;
    after = page[page.length - 1].seq;
  }
}

// The conversation as plain text or Markdown: what was said, without tool details.
async function transcript(thread: Thread, format: "text" | "markdown" | "last"): Promise<string> {
  const parts: Array<{ who: "user" | "model"; text: string }> = [];
  const answers = new Map<string, { text: string }>();
  for await (const page of threadEventPages(thread.id)) {
    for (const { event } of page) {
      if (event.type === "user.message") parts.push({ who: "user", text: event.text });
      else if (event.type === "text.delta" || event.type === "history.answer") {
        const answer = answers.get(event.messageId);
        if (answer) answer.text += event.text;
        else {
          const part = { who: "model" as const, text: event.text };
          answers.set(event.messageId, part);
          parts.push(part);
        }
      }
    }
  }
  const shown = parts.filter((p) => p.text.trim());
  if (format === "last") return shown.findLast((p) => p.who === "model")?.text.trim() ?? "";
  if (format === "markdown") return [`# ${thread.title}`, ...shown.map((p) => `## ${p.who === "user" ? t("Du") : t("Assistent")}\n\n${p.text.trim()}`)].join("\n\n") + "\n";
  return shown.map((p) => `${p.who === "user" ? t("Du") : t("Assistent")}: ${p.text.trim()}`).join("\n\n") + "\n";
}

async function copy(text: string, success: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(success, "info");
  } catch {
    toast(t("Nettleseren slapp ikke til utklippstavlen."));
  }
}

export async function copyThread(thread: Thread, as: "text" | "markdown" | "last" | "id"): Promise<void> {
  try {
    if (as === "id") return await copy(thread.id, t("Kopierte tråd-ID-en."));
    const text = await transcript(thread, as);
    if (as === "last" && !text) return toast(t("Tråden har ingen svar å kopiere ennå."), "info");
    const labels = { text: t("Kopierte tråden som tekst."), markdown: t("Kopierte tråden som Markdown."), last: t("Kopierte siste svar.") };
    await copy(text, labels[as]);
  } catch (err) {
    report(err);
  }
}

// The same detaching as Løsriv on a pane. A thread that is in no pane gets one first.
export async function openInWindow(thread: Thread): Promise<void> {
  const grid = gridFor(scopeOf(thread));
  await grid.loaded;
  let paneId = grid.paneWith(thread.id)?.id ?? null;
  if (!paneId) paneId = grid.addPane(thread.id, false);
  const entry = paneId ? grid.detach(paneId) : null;
  openDetachedWindow(entry ?? { id: `solo-${thread.id}`, threadId: thread.id });
}

export async function openInPane(thread: Thread): Promise<void> {
  const grid = gridFor(scopeOf(thread));
  await grid.loaded;
  if (!grid.paneWith(thread.id)) grid.addPane(thread.id);
  await openThread(thread);
}

// Round 14 (SPEC 30.4): the toast says what happened and can undo it.
export async function toggleArchived(thread: Thread): Promise<void> {
  const archived = !thread.archived;
  try {
    await archiveThread(thread.id, archived);
    toast(archived ? t("Arkiverte «{title}».", { title: thread.title }) : t("Gjenopprettet «{title}».", { title: thread.title }), "info", {
      label: t("Angre"),
      run: () => void archiveThread(thread.id, !archived).catch(report),
    });
  } catch (err) {
    report(err);
  }
}

export function threadById(id: string | null | undefined): Thread | undefined {
  return id ? app.threads[id] : undefined;
}
