// Routes for Chat (round 7): edit a message and send it again, or make the last answer again.
// Kept apart from api.ts so the round's agents do not edit the same lines.
//
// Both go back to just before a user message: the events from there on are dropped, the model's
// history is cut to match, and the message is sent again, edited or as it was. In Chat, and since
// round 9 (SPEC 21.8) in Kode too, where files the cut turns changed stay as they are: the app says
// so first, and the request has to say keepFiles: true to show that it did.
import type { Attachment, AttachmentRef, Thread, ThreadEventEnvelope } from "../../../shared/protocol.ts";
import { historyFrom } from "../agent/fork.ts";
import { HttpError } from "../errors.ts";
import type { Message } from "../providers/types.ts";
import type { ApiDeps } from "./api.ts";

type Route = (method: string, spec: string, handler: (ctx: { params: Record<string, string>; body: any }) => unknown) => void;

const MAX_TEXT = 200_000;

// What the message had attached, as the send route takes it.
export function attachmentRef(a: Attachment): AttachmentRef | null {
  if (a.kind === "image" && a.imageId) return { kind: "image", imageId: a.imageId, name: a.label };
  if (a.kind === "upload" && a.uploadId) return { kind: "upload", uploadId: a.uploadId, name: a.label };
  if (a.kind === "thread" && a.threadId) return { kind: "thread", threadId: a.threadId };
  if ((a.kind === "file" || a.kind === "dir") && a.path) return { kind: a.kind, path: a.path };
  return null;
}

// The model's history before the user message at seq. The stored history is kept when its user
// messages line up one to one with those in the log, so images and tool calls stay as they were.
// When they do not (compaction, notes the app added), it is rebuilt from the log as text, as a
// branch from a message is.
export function historyBefore(stored: Message[], events: ThreadEventEnvelope[], seq: number): Message[] {
  const users = events.filter((e) => e.event.type === "user.message");
  const before = users.filter((e) => e.seq < seq).length;
  const compacted = events.some((e) => e.event.type === "context.compacted");
  const starts = stored.flatMap((m, i) => (m.role === "user" && m.content.some((b) => b.type === "text") ? [i] : []));
  if (!compacted && starts.length === users.length) return stored.slice(0, starts[before] ?? stored.length);
  return historyFrom(events.filter((e) => e.seq < seq), undefined, events);
}

// A temporary chat left open in a tab that went away is deleted after this long without use, and
// without a window that shows it.
export const TEMPORARY_IDLE_MS = 2 * 60 * 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;

export function chatRoutes(route: Route, deps: ApiDeps, h: { thread: (id: string) => Thread; assertFolder?: (threadId: string) => void }): void {
  const { store, runner, publish, threadChanged } = deps;

  const sweep = () => {
    const cutoff = Date.now() - TEMPORARY_IDLE_MS;
    for (const id of store.temporaryThreadsIdleSince(cutoff)) {
      if (runner.isRunning(id)) continue;
      const viewed = deps.viewedAt?.(id);
      if (viewed !== undefined && viewed > cutoff) continue;
      store.deleteThread(id);
      deps.chatWorkspace?.remove(id);
      deps.uiMods?.forgetThread(id);
      runner.files.forgetThread(id);
      publish({ type: "thread.deleted", threadId: id });
    }
  };
  // The timer only runs while there is a temporary chat to sweep, so an idle app has nothing ticking.
  let timer: NodeJS.Timeout | undefined;
  const sweepLater = () => {
    timer ??= setInterval(() => {
      // The store can be closed by the time it fires (tests, shutdown), and that must not throw.
      try {
        sweep();
        if (!store.hasTemporaryThreads()) {
          clearInterval(timer);
          timer = undefined;
        }
      } catch {
        // Next time.
      }
    }, SWEEP_MS);
    timer.unref();
  };
  sweep();
  if (store.hasTemporaryThreads()) sweepLater();

  // A chat that is not kept: marked in the app, left out of search, and deleted by the app when it
  // is closed (DELETE /api/threads/:id) or by the sweep above.
  route("POST", "/api/threads/temporary", ({ body }) => {
    if (body.modelId !== undefined && body.modelId !== null && (typeof body.modelId !== "string" || !store.model(body.modelId))) throw new HttpError(400, "Fant ikke modellen");
    if (body.chatProjectId !== undefined && body.chatProjectId !== null && (typeof body.chatProjectId !== "string" || !store.chatProject(body.chatProjectId))) throw new HttpError(400, "Fant ikke Chat-prosjektet");
    const thread = store.createThread(null, "chat", body.modelId ?? null, { title: "Midlertidig chat" });
    if (body.chatProjectId) store.setThreadChatProject(thread.id, body.chatProjectId);
    store.markTemporary(thread.id);
    sweepLater();
    threadChanged(thread.id);
    return store.thread(thread.id)!;
  });

  // messageId is a user message (edit it) or an answer (make it again from the question before).
  // text replaces the message; left out, it is sent as it was. modelId switches the thread's
  // model first, for a new answer from another model.
  route("POST", "/api/threads/:id/rewind", ({ params, body }) => {
    const thread = h.thread(params.id);
    if (thread.mode === "code" && body.keepFiles !== true) throw new HttpError(400, "Filene i prosjektet rulles ikke tilbake. Bekreft det først (keepFiles).");
    if (runner.isRunning(thread.id)) throw new HttpError(409, "Tråden kjører. Stopp den først.");
    h.assertFolder?.(thread.id);
    if (typeof body.messageId !== "string" || !body.messageId) throw new HttpError(400, "messageId mangler");
    if (body.text !== undefined && typeof body.text !== "string") throw new HttpError(400, "Ugyldig tekst");
    if (typeof body.text === "string" && body.text.length > MAX_TEXT) throw new HttpError(413, "Meldingen er for lang");
    if (body.modelId !== undefined && (typeof body.modelId !== "string" || !store.model(body.modelId))) throw new HttpError(400, "Fant ikke modellen");

    const events = store.events(thread.id, 0, Number.MAX_SAFE_INTEGER);
    if (body.latestOnly === true) {
      const latest = events.findLast(({ event }) => event.type === "text.delta" || event.type === "history.answer" || event.type === "user.message")?.event;
      if ((latest?.type !== "text.delta" && latest?.type !== "history.answer") || latest.messageId !== body.messageId) {
        throw new HttpError(409, "Samtalen har endret seg. Prøv igjen med det nyeste svaret.");
      }
    }
    let cut = -1;
    let lastUser = -1;
    for (const { seq, event } of events) {
      if (event.type === "user.message") {
        lastUser = seq;
        if (event.messageId === body.messageId) {
          cut = seq;
          break;
        }
      } else if ((event.type === "text.delta" || event.type === "history.answer") && event.messageId === body.messageId) {
        cut = lastUser;
        break;
      }
    }
    if (cut < 0) throw new HttpError(404, "Fant ikke meldingen");
    const original = events.find((e) => e.seq === cut)!.event;
    if (original.type !== "user.message") throw new HttpError(404, "Fant ikke meldingen");

    const text = typeof body.text === "string" ? body.text.trim() : original.text;
    const attachments = (original.attachments ?? []).map(attachmentRef).filter((a): a is AttachmentRef => a !== null);
    if (!text && !attachments.length) throw new HttpError(400, "Meldingen er tom");
    // A message sent with a skill shows as /name. Sent again, it uses the skill again.
    const word = /^\/(\S+)(?:[ \t\n]([\s\S]*))?$/.exec(text);
    const project = thread.projectId ? store.project(thread.projectId) : undefined;
    const skill = word && (thread.mode === "chat" ? runner.chatSkills(!!thread.chatProjectId) : runner.skillsFor(project, "code"))
      .find((candidate) => candidate.name === word[1]);
    const dispatch = runner.prepareSend(thread.id, {
      text: skill ? (word![2] ?? "") : text,
      attachments: attachments.length ? attachments : undefined,
      skill: skill ? skill.name : undefined,
    }, body.modelId);

    // Chapters on messages that go, go too.
    const gone = new Set<string>();
    for (const { seq, event } of events) {
      if (seq >= cut && (event.type === "user.message" || event.type === "text.delta" || event.type === "history.answer")) gone.add(event.messageId);
    }
    for (const chapter of thread.chapters) {
      if (gone.has(chapter.messageId)) store.updateThread(thread.id, { chapter: { messageId: chapter.messageId, title: null } });
    }
    if (body.modelId) store.updateThread(thread.id, { modelId: body.modelId });

    // Preserve the answering model, which may differ from a later model selection in the thread.
    const oldAnswer = events.find(({ event }) => event.type === "text.delta" && event.messageId === body.messageId)
      ?? events.find(({ seq, event }) => seq > cut && event.type === "text.delta");
    const oldRunId = oldAnswer?.event.type === "text.delta" ? oldAnswer.event.runId : undefined;
    const oldRun = oldRunId ? events.find(({ event }) => event.type === "run.started" && event.runId === oldRunId)?.event : undefined;
    store.rewindThread(thread.id, cut, historyBefore(store.messages(thread.id), events, cut));
    publish({ type: "thread.reset", threadId: thread.id, historyRevision: store.historyRevision(thread.id) });
    runner.recordModelChange(thread.id, thread.modelId, { hadConversation: true, ...(oldRun?.type === "run.started" && oldRun.model ? { from: oldRun.model } : {}) });
    threadChanged(thread.id);
    return dispatch();
  });
}
