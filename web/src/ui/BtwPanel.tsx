import { createEffect, createSignal, on, onCleanup, Show, type Accessor } from "solid-js";
import { connection, on as onSocket } from "../lib/socket";
import { IconChat, IconClose, IconStop } from "./icons";
import "../styles/side-questions.css";

interface BtwState {
  question: string;
  answer: string;
  status: "asking" | "done" | "cancelled" | "error";
  model?: string;
  error?: string;
}

export interface BtwController {
  state: Accessor<BtwState | null>;
  ask(threadId: string, question: string, accepted: () => void, failed: () => void): Promise<void>;
  cancel(): void;
  close(): void;
}

// This state belongs to the mounted composer. It never enters the conversation model, draft
// storage or event log, and reconnect/navigation discards it instead of replaying a request.
export function createBtwController(scope: Accessor<string>): BtwController {
  const [state, setState] = createSignal<BtwState | null>(null);
  const clientId = crypto.randomUUID();
  let generation = 0;
  let active: AbortController | null = null;
  let boundThreadId: string | null = null;
  const close = () => { generation++; active?.abort(); active = null; boundThreadId = null; setState(null); };
  const cancel = () => {
    generation++; active?.abort(); active = null;
    setState((current) => current ? { ...current, status: "cancelled" } : null);
  };
  createEffect(on(scope, close));
  createEffect(on(connection, (now, before) => { if (before !== undefined && now !== before) close(); }));
  onCleanup(onSocket("thread.reset", (message) => { if (message.threadId === boundThreadId) close(); }));
  onCleanup(onSocket("thread.deleted", (message) => { if (message.threadId === boundThreadId) close(); }));
  onCleanup(close);

  const ask = async (threadId: string, question: string, accepted: () => void, failed: () => void) => {
    if (connection() !== "online") {
      close();
      setState({ question, answer: "", status: "error", error: "Vent til appen er tilkoblet før du sender et sidespørsmål. Utkastet er beholdt." });
      return;
    }
    active?.abort();
    const controller = new AbortController();
    active = controller;
    boundThreadId = threadId;
    const mine = ++generation;
    const current = () => generation === mine && !controller.signal.aborted;
    setState({ question, answer: "", status: "asking" });
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let started = false;
    let finished = false;
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/btw`, {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ question, clientId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : `Kunne ikke starte sidespørsmålet (${response.status}).`);
      }
      if (!response.body) throw new Error("Serveren sendte ikke et svar.");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const take = (line: string) => {
        if (!line.trim() || !current()) return;
        const part = JSON.parse(line);
        if (part.type === "start") {
          if (started) return;
          started = true;
          const name = part.model?.modelName;
          const provider = part.model?.providerName;
          const model = [name, provider].filter((value): value is string => typeof value === "string" && !!value).join(" · ");
          setState((value) => value ? { ...value, model } : null);
          accepted();
        } else if (part.type === "text" && started && typeof part.text === "string") {
          setState((value) => {
            if (!value) return null;
            if (value.answer.length + part.text.length > 64_000) throw new Error("Sidesvaret ble for langt.");
            return { ...value, answer: value.answer + part.text };
          });
        } else if (part.type === "done" && started) {
          finished = true;
          setState((value) => value ? { ...value, status: "done" } : null);
        } else if (part.type === "error") {
          finished = true;
          if (part.code === "scope_changed") { close(); return; }
          failed();
          setState((value) => value ? { ...value, answer: "", status: "error", error: typeof part.message === "string" ? part.message : "Sidespørsmålet kunne ikke fullføres." } : null);
        }
      };
      while (current() && !finished) {
        const chunk = await reader.read();
        if (!current()) return;
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        if (pending.length > 128_000) throw new Error("Serveren sendte et ugyldig sidesvar.");
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          take(pending.slice(0, end));
          pending = pending.slice(end + 1);
          if (finished || !current()) break;
        }
        if (chunk.done) {
          if (pending.trim() && !finished) take(pending);
          break;
        }
      }
      if (current() && !finished) throw new Error("Forbindelsen ble brutt før sidesvaret var ferdig.");
    } catch (error) {
      if (generation === mine) {
        failed();
        setState((value) => value ? {
          ...value, answer: "", status: "error",
          error: controller.signal.aborted ? "Sidespørsmålet tok for lang tid. Prøv igjen når du er klar." : (error as Error).message || "Kunne ikke hente sidesvaret.",
        } : null);
      }
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => undefined);
      if (active === controller) active = null;
    }
  };
  return { state, ask, cancel, close };
}

export function BtwPanel(props: { controller: BtwController }) {
  return <Show when={props.controller.state()}>{(state) =>
    <aside class="btw-panel" aria-label="Sidespørsmål" data-testid="btw-panel">
      <header class="btw-head"><IconChat size={14}/><strong>Sidespørsmål</strong><span class="btw-command">/btw</span><span class="btw-head-spacer"/>
        <Show when={state().status === "asking"}><button type="button" class="icon-button" aria-label="Avbryt sidespørsmål" title="Avbryt bare sidespørsmålet" onClick={props.controller.cancel}><IconStop size={12}/></button></Show>
        <button type="button" class="icon-button" aria-label="Lukk sidespørsmål" title="Lukk og fjern sidespørsmålet" onClick={props.controller.close}><IconClose size={14}/></button>
      </header>
      <div class="btw-content"><p class="btw-question" data-testid="btw-question">{state().question}</p>
        <Show when={state().answer}><div class="btw-answer" data-testid="btw-answer">{state().answer}</div></Show>
        <Show when={state().error}><p class="btw-error" role="alert">{state().error}</p></Show>
      </div>
      <footer><span role="status">{state().status === "asking" ? "Svarer…" : state().status === "cancelled" ? "Avbrutt" : state().status === "error" ? "Kunne ikke fullføre" : "Svar ferdig"}</span><Show when={state().model}><span class="btw-model">{state().model}</span></Show><small>Uten verktøy · lagres ikke i samtalehistorikken</small></footer>
    </aside>
  }</Show>;
}
