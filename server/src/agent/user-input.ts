import { randomUUID } from "node:crypto";
import type { UserAnswer, UserInputCloseReason, UserInputResult, UserQuestion } from "../../../shared/user-input.ts";
import { HttpError } from "../errors.ts";
import type { EventLog } from "./events.ts";
import type { Tool } from "./tools.ts";

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, name: string, max: number, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) throw new HttpError(400, `${name} må være tekst med ${optional ? "0" : "1"}–${max} tegn.`);
  return value.trim();
}
export function userQuestions(input: unknown): UserQuestion[] {
  if (!object(input) || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 3) throw new HttpError(400, "Send 1–3 spørsmål i questions.");
  const ids = new Set<string>();
  return input.questions.map((raw: unknown) => {
    if (!object(raw)) throw new HttpError(400, "Spørsmålet må være et objekt.");
    const id = text(raw.id, "Spørsmåls-ID", 80);
    if (ids.has(id)) throw new HttpError(400, "Spørsmålene trenger ulike ID-er.");
    ids.add(id);
    const question: UserQuestion = { id, question: text(raw.question, "Spørsmålet", 2000) };
    if (raw.header !== undefined) question.header = text(raw.header, "Overskrift", 80);
    if (raw.multiSelect !== undefined && typeof raw.multiSelect !== "boolean") throw new HttpError(400, "multiSelect må være true eller false.");
    if (raw.multiSelect === true) question.multiSelect = true;
    if (raw.options !== undefined) {
      if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > 8) throw new HttpError(400, "Bruk 1–8 alternativer, eller utelat options for fritekst.");
      const labels = new Set<string>();
      question.options = raw.options.map((option: unknown) => {
        if (!object(option)) throw new HttpError(400, "Hvert alternativ trenger en label.");
        const label = text(option.label, "Alternativet", 200);
        if (labels.has(label)) throw new HttpError(400, "Alternativene må ha ulike navn.");
        labels.add(label);
        return { label, ...(option.description !== undefined ? { description: text(option.description, "Beskrivelsen", 500, true) } : {}) };
      });
    }
    return question;
  });
}
function userAnswers(body: unknown, questions: UserQuestion[]): UserInputResult {
  if (!object(body) || (body.cancelled !== undefined && typeof body.cancelled !== "boolean")) throw new HttpError(400, "Ugyldig svar.");
  if (body.cancelled === true) {
    if (body.answers !== undefined && (!Array.isArray(body.answers) || body.answers.length)) throw new HttpError(400, "Et avbrutt spørsmål kan ikke ha svar.");
    return { cancelled: true, answers: [] };
  }
  if (!Array.isArray(body.answers) || body.answers.length !== questions.length) throw new HttpError(400, "Svar på alle spørsmålene, eller avbryt.");
  const seen = new Set<string>();
  const answers = body.answers.map((answer: unknown): UserAnswer => {
    if (!object(answer) || typeof answer.questionId !== "string") throw new HttpError(400, "Svaret mangler spørsmåls-ID.");
    const question = questions.find((q) => q.id === answer.questionId);
    if (!question || seen.has(question.id)) throw new HttpError(400, "Ukjent eller gjentatt spørsmåls-ID.");
    seen.add(question.id);
    if (!Array.isArray(answer.selectedOptions) || answer.selectedOptions.some((label: unknown) => typeof label !== "string" || !question.options?.some((option) => option.label === label))) throw new HttpError(400, "Velg bare blant alternativene i spørsmålet.");
    if (new Set(answer.selectedOptions).size !== answer.selectedOptions.length || (!question.multiSelect && answer.selectedOptions.length > 1)) throw new HttpError(400, "Ugyldig antall valgte alternativer.");
    const ownText = text(answer.text, "Fritekst", 8000, true);
    if (!answer.selectedOptions.length && !ownText) throw new HttpError(400, "Velg et alternativ eller skriv et eget svar.");
    return { questionId: question.id, selectedOptions: [...answer.selectedOptions], text: ownText };
  });
  return { cancelled: false, answers: questions.map((q) => answers.find((a) => a.questionId === q.id)!) };
}
interface InputScope { threadId: string; runId: string; callId: string; signal: AbortSignal; assertCurrent: () => void }
interface Pending { scope: InputScope; questions: UserQuestion[]; settle: (result: UserInputResult, reason?: UserInputCloseReason) => void }
export class UserInputs {
  private pending = new Map<string, Pending>();
  private log: EventLog;
  private changed: (threadId: string) => void;
  constructor(log: EventLog, changed: (threadId: string) => void) { this.log = log; this.changed = changed; }
  count(threadId: string): number { return [...this.pending.values()].filter((p) => p.scope.threadId === threadId).length; }
  cancelForSteering(threadId: string): void {
    for (const pending of this.pending.values()) if (pending.scope.threadId === threadId) pending.settle({ cancelled: true, answers: [] }, "steered");
  }
  ask(scope: InputScope, input: unknown): Promise<UserInputResult> {
    const questions = userQuestions(input);
    scope.signal.throwIfAborted();
    scope.assertCurrent();
    const requestId = randomUUID();
    return new Promise((resolve) => {
      let closed = false;
      const settle: Pending["settle"] = (result, reason) => {
        if (closed) return;
        closed = true;
        scope.signal.removeEventListener("abort", abort);
        this.pending.delete(requestId);
        this.log.append(scope.threadId, { type: "question.resolved", runId: scope.runId, requestId, ...result, ...(reason ? { reason } : {}) });
        this.changed(scope.threadId);
        resolve(result);
      };
      const abort = () => settle({ cancelled: true, answers: [] }, "stopped");
      this.pending.set(requestId, { scope, questions, settle });
      scope.signal.addEventListener("abort", abort, { once: true });
      this.log.append(scope.threadId, { type: "question.requested", threadId: scope.threadId, runId: scope.runId, requestId, callId: scope.callId, questions });
      this.changed(scope.threadId);
    });
  }
  answer(threadId: string, requestId: string, body: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.scope.threadId !== threadId) throw new HttpError(404, "Spørsmålet venter ikke lenger i denne samtalen.");
    if (!object(body) || body.runId !== pending.scope.runId) throw new HttpError(409, "Svaret tilhører en annen kjøring.");
    try { pending.scope.signal.throwIfAborted(); pending.scope.assertCurrent(); }
    catch { pending.settle({ cancelled: true, answers: [] }, "scope-changed"); throw new HttpError(409, "Samtalen er endret. Spørsmålet er lukket."); }
    const result = userAnswers(body, pending.questions);
    pending.settle(result, result.cancelled ? "user" : undefined);
  }
}
export const requestUserInputTool: Tool = {
  def: {
    name: "request_user_input",
    description: "Ask the user 1–3 clear questions when a decision or missing information is needed. The app displays selectable options (checkboxes when multiSelect is true) and always offers free text. Waits for the user's answer in this exact conversation and run. Not for permissions or secrets. Ask together only questions that can be answered independently; do not ask about facts you can inspect yourself. Cancellation returns cancelled:true; respect it instead of repeatedly asking.",
    parameters: { type: "object", properties: { questions: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", properties: {
      id: { type: "string", description: "Unique stable question id", maxLength: 80 },
      header: { type: "string", description: "Optional short heading", maxLength: 80 },
      question: { type: "string", description: "Self-contained question", maxLength: 2000 },
      multiSelect: { type: "boolean", description: "True allows several options; default false" },
      options: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { label: { type: "string", maxLength: 200 }, description: { type: "string", maxLength: 500 } }, required: ["label"], additionalProperties: false } },
    }, required: ["id", "question"], additionalProperties: false } } }, required: ["questions"], additionalProperties: false },
  },
  kind: "read", can: "ask the user clear questions with choices and free text",
  summary: () => "Spør brukeren",
  async run(input, ctx) {
    if (!ctx.requestUserInput) return { text: "Spørsmål er ikke tilgjengelig i denne kjøringen.", isError: true };
    return { text: JSON.stringify(await ctx.requestUserInput(input)) };
  },
};
