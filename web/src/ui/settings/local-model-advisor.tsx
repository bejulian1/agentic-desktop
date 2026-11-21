import { localizedFormat, t } from "../../lib/i18n.ts";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import {
  LOCAL_MODEL_CONTEXT_OPTIONS,
  LOCAL_MODEL_RAM_RESERVE_GIB,
  type LocalModelRecommendations,
  type LocalModelSuggestion,
  type Mode,
} from "../../../../shared/protocol";
import { post } from "../../lib/api";
import { formatTokens } from "../../lib/format";
import { Choice, Row } from "./parts";

const decimal = localizedFormat(locale => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }));
const gib = (value: number) => `${decimal.format(value)} GiB`;
const contextLabel = (tokens: number) => t("{tokens} tokens", { tokens: formatTokens(tokens) });

function RecommendationCard(props: { suggestion: LocalModelSuggestion; recommended: boolean }) {
  const model = () => props.suggestion;
  return (
    <li class="local-model-suggestion" classList={{ "local-model-recommended": props.recommended }}>
      <div class="card-title">
        <strong>{model().name}</strong>
        <span class="muted">
          {model().placement === "gpu"
            ? t("Anslått {gpu} GPU-minne + {ram} RAM", { gpu: gib(model().estimatedGpuGiB!), ram: gib(model().estimatedRamGiB) })
            : t("Anslått {ram} RAM · kan gå tregere på CPU", { ram: gib(model().estimatedRamGiB) })}
        </span>
      </div>
      <Show when={props.recommended}><span class="tag">{t("Anbefalt")}</span></Show>
      <div class="local-model-sources">
        <a href={`https://ollama.com/library/${model().ollamaId}`} target="_blank" rel="noreferrer">Ollama · <code>{model().ollamaId}</code></a>
        <a href={model().ggufUrl} target="_blank" rel="noreferrer">GGUF · {model().ggufQuantization}</a>
        <Show when={model().supportsTools}><span class="muted">{t("Verktøystøtte*")}</span></Show>
      </div>
    </li>
  );
}

export function LocalModelAdvisor(props: { active?: boolean }) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [source, setSource] = createSignal<"host" | "manual">("host");
  const [mode, setMode] = createSignal<Mode>("chat");
  const [contextTokens, setContextTokens] = createSignal(8_192);
  const [ram, setRam] = createSignal("");
  const [gpu, setGpu] = createSignal("");
  const [result, setResult] = createSignal<LocalModelRecommendations>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const reset = () => { setResult(undefined); setError(""); };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy()) return;
    reset();
    const toNumber = (value: string) => /^\d+(?:[,.]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(",", ".")) : NaN;
    const availableRamGiB = source() === "manual" ? toNumber(ram()) : undefined;
    const freeGpuGiB = source() === "manual" && gpu().trim() ? toNumber(gpu()) : undefined;
    if ([availableRamGiB, freeGpuGiB].some((value) => value !== undefined && (!Number.isFinite(value) || value > 65_536))) {
      setError(t("Skriv inn tilgjengelig RAM og eventuelt GPU-minne som tall fra 0 til 65 536 GiB."));
      return;
    }
    setBusy(true);
    try {
      setResult(await post<LocalModelRecommendations>("/api/providers/local/recommend", {
        source: source(), mode: mode(), contextTokens: contextTokens(), availableRamGiB, freeGpuGiB,
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row label={t("Modellanbefaling")} text={t("Finn en modell som kan passe maskinvaren og konteksten du trenger.")}>
        <button type="button" class="btn btn-small" aria-expanded={open()} aria-controls={id} onClick={() => setOpen(!open())}>
          {open() ? t("Lukk anbefaling") : t("Anbefal modell")}
        </button>
      </Row>
      <Show when={open()}>
        <div id={id} class="local-model-advisor">
          <form class="form" aria-label={t("Anbefal lokal modell")} onSubmit={submit}>
            <fieldset disabled={busy()} class="local-model-inputs">
              <Row label={t("Maskinvare")}>
                <Choice<"host" | "manual"> active={props.active} label={t("Maskinvare")} value={source()}
                  options={[{ value: "host", label: t("Denne maskinen") }, { value: "manual", label: t("Oppgi minne selv") }]}
                  onChange={(value) => { setSource(value); reset(); }} />
              </Row>
              <Show when={source() === "manual"}>
                <p class="muted">{t("Bruk målingene fra maskinen som skal kjøre modellen. Oppgi GPU-minnet for ett kort.")}</p>
                <div class="field-row">
                  <label class="field"><span>{t("Tilgjengelig RAM (GiB)")}</span>
                    <input class="input" inputmode="decimal" required value={ram()} onInput={(e) => { setRam(e.currentTarget.value); reset(); }} />
                  </label>
                  <label class="field"><span>{t("Ledig GPU-minne (GiB, valgfritt)")}</span>
                    <input class="input" inputmode="decimal" value={gpu()} onInput={(e) => { setGpu(e.currentTarget.value); reset(); }} />
                  </label>
                </div>
              </Show>
              <Row label={t("Bruk")}>
                <Choice<Mode> active={props.active} label={t("Bruk")} value={mode()}
                  options={[{ value: "chat", label: t("Chat") }, { value: "code", label: t("Kode") }]}
                  onChange={(value) => { setMode(value); setContextTokens(value === "code" ? 16_384 : 8_192); reset(); }} />
              </Row>
              <Row label={t("Kontekst")}>
                <Choice<number> active={props.active} label={t("Kontekst")} value={contextTokens()}
                  options={LOCAL_MODEL_CONTEXT_OPTIONS.map((tokens) => ({ value: tokens, label: contextLabel(tokens) }))}
                  onChange={(value) => { setContextTokens(value); reset(); }} />
              </Row>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? t("Beregner…") : t("Vis anbefaling")}</button>
              </div>
            </fieldset>
          </form>
          <Show when={error()}><p role="alert" class="test-result bad">{error()}</p></Show>
          <Show when={result()}>{(value) => (
            <div class="local-model-advice" aria-live="polite">
              <p class="muted">
                {[
                  source() === "host" ? t("Målt nå") : t("Oppgitt minne"),
                  t("{ram} tilgjengelig RAM", { ram: gib(value().hardware.availableRamGiB) }),
                  value().hardware.freeGpuGiB === undefined ? t("Ledig GPU-minne ukjent") : t("{gpu} ledig GPU-minne", { gpu: gib(value().hardware.freeGpuGiB!) }),
                ].join(" · ")}
              </p>
              <Show when={value().suggestions.length} fallback={
                <p>{t("Ingen av modellene i katalogen er anslått å få plass ved {context} med {reserve} GiB RAM i reserve.", { context: contextLabel(value().contextTokens), reserve: LOCAL_MODEL_RAM_RESERVE_GIB })}</p>
              }>
                <ol aria-label={t("Anbefalte lokale modeller")}>
                  <For each={value().suggestions}>{(suggestion, index) => (
                    <RecommendationCard suggestion={suggestion} recommended={index() === 0} />
                  )}</For>
                </ol>
                <p class="muted">
                  {t("Anslag ved {context} og {reserve} GiB RAM i reserve. Sett konteksten på modellserveren. *Verktøykall avhenger av serverens oppsett.", { context: contextLabel(value().contextTokens), reserve: LOCAL_MODEL_RAM_RESERVE_GIB })}
                </p>
              </Show>
            </div>
          )}</Show>
        </div>
      </Show>
    </>
  );
}
