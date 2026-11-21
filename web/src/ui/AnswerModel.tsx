import { t } from "../lib/i18n";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { AnswerModel } from "../../../shared/protocol";
import { app, settingsOpen } from "../state/app";
import { Popover } from "./Popover";
import { IconCpu } from "./icons";

// New answers carry an immutable run snapshot. Older logs can only resolve their own stored
// model id; never guess from the thread's current selection when that model was removed.
export function answerModelInfo(snapshot?: AnswerModel) {
  const model = snapshot && app.models.find(model => model.id === snapshot.modelId);
  const provider = app.providers.find(provider => provider.id === (snapshot?.providerId ?? model?.providerId));
  return {
    name: snapshot?.modelName ?? model?.name ?? t("Ukjent modell"),
    provider: snapshot?.providerName ?? provider?.name,
    model: snapshot?.model ?? model?.model,
    known: !!(snapshot?.modelName || model),
  };
}

export function AnswerModelButton(props: { model?: AnswerModel }) {
  const [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement;
  createEffect(() => { if (open() && settingsOpen()) setOpen(false); });
  createEffect(() => {
    if (!open()) return;
    // Only an open card needs observing. Hidden retained panes/settings must not leave a portal
    // over another conversation; finished rows otherwise have no observer of their own.
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => !entry.isIntersecting)) setOpen(false); });
    observer.observe(trigger);
    onCleanup(() => observer.disconnect());
  });
  const info = () => answerModelInfo(props.model);
  const title = () => info().known
    ? info().provider
      ? t("Svar fra {name} · {provider}", { name: info().name, provider: info().provider! })
      : t("Svar fra {name}", { name: info().name })
    : t("Modellinformasjon er ikke lagret for dette svaret");
  return <Popover open={open()} onClose={() => setOpen(false)} fixed portal stable returnFocus class="answer-model-anchor" panelClass="answer-model-popover"
    trigger={<button ref={trigger} type="button" class="msg-action answer-model-button" title={title()} aria-label={t("Modell som laget svaret")} aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}><IconCpu size={14} /></button>}>
    <section class="answer-model-card" role="dialog" aria-label={t("Modell som laget svaret")} data-testid="answer-model-info">
      <span class="muted small">{t("Dette svaret ble laget av")}</span>
      <strong>{info().name}</strong>
      <Show when={info().provider}>{provider => <span>{provider()}</span>}</Show>
      <Show when={info().model}>{model => <code>{model()}</code>}</Show>
      <Show when={!info().known}><span class="muted small">{t("Den eldre samtaleloggen mangler modellinformasjon.")}</span></Show>
    </section>
  </Popover>;
}
