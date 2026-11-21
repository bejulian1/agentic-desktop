import { t } from "../lib/i18n";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ApiError, post } from "../lib/api";
import type { QuestionRow } from "../state/thread-model";
import type { UserAnswer } from "../../../shared/user-input";
import { IconThought } from "./icons";
import "../styles/user-question.css";

// Unsaved answers survive changing panes or conversations while this model stays cached.
const drafts = new WeakMap<QuestionRow, UserAnswer[]>();
export function UserQuestionCard(props: { row: QuestionRow }) {
  const row = props.row;
  const [answers, setAnswers] = createSignal<UserAnswer[]>(drafts.get(row) ?? row.questions.map((q) => ({ questionId: q.id, selectedOptions: [], text: "" })));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [expired, setExpired] = createSignal(false);
  const closed = createMemo(() => (row.rev(), row.closed || expired()));
  const ready = () => answers().every((a) => a.selectedOptions.length > 0 || a.text.trim());
  const change = (id: string, patch: Partial<UserAnswer>) => {
    const next = answers().map((answer) => answer.questionId === id ? { ...answer, ...patch } : answer);
    setAnswers(next); drafts.set(row, next); setError("");
  };
  const answer = async (cancelled: boolean) => {
    if (busy() || closed()) return;
    setBusy(true); setError("");
    try {
      await post(`/api/threads/${encodeURIComponent(row.threadId)}/questions/${encodeURIComponent(row.requestId)}`, { runId: row.runId, cancelled, answers: cancelled ? [] : answers() });
      drafts.delete(row);
      // Do not let a second click race the durable event over the socket.
      setExpired(true);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && [404, 409].includes(err.status)) setExpired(true);
    } finally { setBusy(false); }
  };
  return <section class="user-question" aria-label={t("Spørsmål fra modellen")} data-testid="user-question-card" data-request-id={row.requestId} data-question-thread-id={row.threadId}>
    <div class="user-question-heading"><IconThought size={17}/><strong>{t("Spørsmål fra modellen")}</strong><span>{row.questions.length > 1 ? t("{count} spørsmål", { count: row.questions.length }) : t("Venter på svaret ditt")}</span></div>
    <Show when={!closed()} fallback={<p role="status">{error() || t("Spørsmålet er lukket.")}</p>}>
      <form onSubmit={(event) => { event.preventDefault(); if (ready()) void answer(false); }}>
        <div class="user-question-fields">
          <For each={row.questions}>{(question, index) => {
            const value = () => answers().find((a) => a.questionId === question.id)!;
            return <fieldset disabled={busy()}>
              <legend><Show when={question.header}><span class="user-question-kicker">{question.header}</span></Show>{question.question}</legend>
              <Show when={question.multiSelect && question.options?.length}><p class="user-question-hint">{t("Du kan velge flere.")}</p></Show>
              <For each={question.options}>{(option) => <label class="user-question-option" classList={{ selected: value().selectedOptions.includes(option.label) }}>
                <input type={question.multiSelect ? "checkbox" : "radio"} name={`${row.requestId}-${question.id}`} checked={value().selectedOptions.includes(option.label)} onChange={(event) => change(question.id, { selectedOptions: question.multiSelect ? (event.currentTarget.checked ? [...value().selectedOptions, option.label] : value().selectedOptions.filter((label) => label !== option.label)) : [option.label] })}/>
                <span><strong>{option.label}</strong><Show when={option.description}><small>{option.description}</small></Show></span>
              </label>}</For>
              <label class="user-question-own"><span>{question.options?.length ? t("Eget svar eller tillegg") : t("Ditt svar")}</span>
                <textarea rows={2} maxLength={8000} aria-label={t("Eget svar: {question}", { question: question.header || index() + 1 })} placeholder={t("Skriv med egne ord …")} value={value().text} onInput={(event) => change(question.id, { text: event.currentTarget.value })}/>
              </label>
            </fieldset>;
          }}</For>
        </div>
        <Show when={error()}><p class="user-question-error" role="alert">{error()}</p></Show>
        <div class="user-question-actions"><button type="button" class="btn" disabled={busy()} onClick={() => void answer(true)}>{t("Hopp over")}</button><span>{t("Svaret sendes til denne samtalen.")}</span><button type="submit" class="btn btn-primary" disabled={busy() || !ready()}>{busy() ? t("Sender …") : t("Send svar")}</button></div>
      </form>
    </Show>
  </section>;
}
export function UserQuestionSummary(props: { row: QuestionRow }) {
  const row = props.row;
  const closed = createMemo(() => (row.rev(), row.closed));
  return <Show when={closed()}><details class="row user-question-summary" data-row="question-done">
    <summary><IconThought size={14}/>{row.result && !row.result.cancelled ? t("Du svarte på modellens spørsmål") : t("Spørsmålet ble ikke besvart")}</summary>
    <dl><For each={row.questions}>{(question) => <><dt>{question.question}</dt><dd>{(() => { const answer = row.result?.answers.find((a) => a.questionId === question.id); return answer ? [...answer.selectedOptions, answer.text].filter(Boolean).join(" · ") : t("Hoppet over eller avbrutt"); })()}</dd></>}</For></dl>
  </details></Show>;
}
