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
    toast(pinned ? "Festet tråden." : "Løsnet tråden.", "info");
  } catch (err) {
    report(err);
  }
}

export async function setSnoozed(thread: Thread, until: number | null): Promise<void> {
  try {
    await patch(`/api/threads/${thread.id}`, { snoozedUntil: until });
    toast(until ? `Utsatt til ${new Date(until).toLocaleString("nb-NO", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "Hentet tilbake.", "info");
  } catch (err) {
    report(err);
  }
}

// The snooze choices: an hour, tomorrow morning and next Monday morning, in local time.
export function snoozeTimes(now = new Date()): Array<{ label: string; at: number }> {
  const morning = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(8, 0, 0, 0);
    return d.getTime();
  };
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    { label: "Om 1 time", at: now.getTime() + 3_600_000 },
    { label: "I morgen", at: morning(1) },
    { label: "Neste uke", at: morning(toMonday) },
  ];
}

// The copy or the side chat opens beside the original, so both stay in view.
async function openBeside(originalId: string, thread: Thread): Promise<void> {
  const grid = gridFor(scopeOf(thread));
  await grid.loaded;
  const pane = grid.paneWith(originalId);
  if (!pane || !grid.split(pane.id, "right", thread.id)) await openThread(thread);
}

export async function sideChat(thread: Thread): Promise<void> {
  try {
    const side = await post<Thread>("/api/threads", { projectId: thread.projectId, mode: thread.mode, sideOf: thread.id });
    await openBeside(thread.id, side);
  } catch (err) {
    report(err);
  }
}

export async function forkFromLast(thread: Thread): Promise<void> {
  try {
    const branch = await post<Thread>(`/api/threads/${thread.id}/fork`, { from: "last" });
    await openBeside(thread.id, branch);
    toast(`Laget «${branch.title}» fra siste melding.`, "info");
  } catch (err) {
    report(err);
  }
}

export const forkWhole = (thread: Thread) => forkThread(thread.id);

// The conversation as plain text or Markdown: what was said, without tool details.
async function transcript(thread: Thread, markdown: boolean): Promise<string> {
  const events = await get<ThreadEventEnvelope[]>(`/api/threads/${thread.id}/events?limit=20000`);
  const parts: Array<{ who: "user" | "model"; text: string }> = [];
  for (const { event } of events) {
    if (event.type === "user.message") parts.push({ who: "user", text: event.text });
    else if (event.type === "text.delta") {
      const last = parts.at(-1);
      if (last?.who === "model") last.text += event.text;
      else parts.push({ who: "model", text: event.text });
    } else if (event.type === "run.started") {
      // A new run starts a new answer, even if the last one had no user message after it.
      if (parts.at(-1)?.who === "model") parts.push({ who: "model", text: "" });
    }
  }
  const shown = parts.filter((p) => p.text.trim());
  if (markdown) return [`# ${thread.title}`, ...shown.map((p) => `## ${p.who === "user" ? "Du" : "Assistent"}\n\n${p.text.trim()}`)].join("\n\n") + "\n";
  return shown.map((p) => `${p.who === "user" ? "Du" : "Assistent"}: ${p.text.trim()}`).join("\n\n") + "\n";
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Kopierte ${what}.`, "info");
  } catch {
    toast("Nettleseren slapp ikke til utklippstavlen.");
  }
}

export async function copyThread(thread: Thread, as: "text" | "markdown" | "id"): Promise<void> {
  try {
    if (as === "id") return await copy(thread.id, "tråd-ID-en");
    await copy(await transcript(thread, as === "markdown"), as === "markdown" ? "tråden som Markdown" : "tråden som tekst");
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
    toast(archived ? `Arkiverte «${thread.title}».` : `Gjenopprettet «${thread.title}».`, "info", {
      label: "Angre",
      run: () => void archiveThread(thread.id, !archived).catch(report),
    });
  } catch (err) {
    report(err);
  }
}

export function threadById(id: string | null | undefined): Thread | undefined {
  return id ? app.threads[id] : undefined;
}
