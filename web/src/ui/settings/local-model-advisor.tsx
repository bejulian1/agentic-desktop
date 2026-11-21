import { localizedFormat } from "../../lib/i18n.ts";
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
const contextLabel = (tokens: number) => `${formatTokens(tokens)} tokens`;

function RecommendationCard(props: { suggestion: LocalModelSuggestion; recommended: boolean }) {
  const model = () => props.suggestion;
  return (
    <li class="local-model-suggestion" classList={{ "local-model-recommended": props.recommended }}>
      <div class="card-title">
        <strong>{model().name}</strong>
        <span class="muted">
          {model().placement === "gpu"
            ? `Anslått ${gib(model().estimatedGpuGiB!)} GPU-minne + ${gib(model().estimatedRamGiB)} RAM`
            : `Anslått ${gib(model().estimatedRamGiB)} RAM · kan gå tregere på CPU`}
        </span>
      </div>
      <Show when={props.recommended}><span class="tag">Anbefalt</span></Show>
      <div class="local-model-sources">
        <a href={`https://ollama.com/library/${model().ollamaId}`} target="_blank" rel="noreferrer">Ollama · <code>{model().ollamaId}</code></a>
        <a href={model().ggufUrl} target="_blank" rel="noreferrer">GGUF · {model().ggufQuantization}</a>
        <Show when={model().supportsTools}><span class="muted">Verktøystøtte*</span></Show>
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
      setError("Skriv inn tilgjengelig RAM og eventuelt GPU-minne som tall fra 0 til 65 536 GiB.");
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
      <Row label="Modellanbefaling" text="Finn en modell som kan passe maskinvaren og konteksten du trenger.">
        <button type="button" class="btn btn-small" aria-expanded={open()} aria-controls={id} onClick={() => setOpen(!open())}>
          {open() ? "Lukk anbefaling" : "Anbefal modell"}
        </button>
      </Row>
      <Show when={open()}>
        <div id={id} class="local-model-advisor">
          <form class="form" aria-label="Anbefal lokal modell" onSubmit={submit}>
            <fieldset disabled={busy()} class="local-model-inputs">
              <Row label="Maskinvare">
                <Choice<"host" | "manual"> active={props.active} label="Maskinvare" value={source()}
                  options={[{ value: "host", label: "Denne maskinen" }, { value: "manual", label: "Oppgi minne selv" }]}
                  onChange={(value) => { setSource(value); reset(); }} />
              </Row>
              <Show when={source() === "manual"}>
                <p class="muted">Bruk målingene fra maskinen som skal kjøre modellen. Oppgi GPU-minnet for ett kort.</p>
                <div class="field-row">
                  <label class="field"><span>Tilgjengelig RAM (GiB)</span>
                    <input class="input" inputmode="decimal" required value={ram()} onInput={(e) => { setRam(e.currentTarget.value); reset(); }} />
                  </label>
                  <label class="field"><span>Ledig GPU-minne (GiB, valgfritt)</span>
                    <input class="input" inputmode="decimal" value={gpu()} onInput={(e) => { setGpu(e.currentTarget.value); reset(); }} />
                  </label>
                </div>
              </Show>
              <Row label="Bruk">
                <Choice<Mode> active={props.active} label="Bruk" value={mode()}
                  options={[{ value: "chat", label: "Chat" }, { value: "code", label: "Kode" }]}
                  onChange={(value) => { setMode(value); setContextTokens(value === "code" ? 16_384 : 8_192); reset(); }} />
              </Row>
              <Row label="Kontekst">
                <Choice<number> active={props.active} label="Kontekst" value={contextTokens()}
                  options={LOCAL_MODEL_CONTEXT_OPTIONS.map((tokens) => ({ value: tokens, label: contextLabel(tokens) }))}
                  onChange={(value) => { setContextTokens(value); reset(); }} />
              </Row>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? "Beregner…" : "Vis anbefaling"}</button>
              </div>
            </fieldset>
          </form>
          <Show when={error()}><p role="alert" class="test-result bad">{error()}</p></Show>
          <Show when={result()}>{(value) => (
            <div class="local-model-advice" aria-live="polite">
              <p class="muted">
                {source() === "host" ? "Målt nå" : "Oppgitt minne"} · {gib(value().hardware.availableRamGiB)} tilgjengelig RAM
                {value().hardware.freeGpuGiB === undefined ? " · Ledig GPU-minne ukjent" : ` · ${gib(value().hardware.freeGpuGiB!)} ledig GPU-minne`}
              </p>
              <Show when={value().suggestions.length} fallback={
                <p>Ingen av modellene i katalogen er anslått å få plass ved {contextLabel(value().contextTokens)} med {LOCAL_MODEL_RAM_RESERVE_GIB} GiB RAM i reserve.</p>
              }>
                <ol aria-label="Anbefalte lokale modeller">
                  <For each={value().suggestions}>{(suggestion, index) => (
                    <RecommendationCard suggestion={suggestion} recommended={index() === 0} />
                  )}</For>
                </ol>
                <p class="muted">
                  Anslag ved {contextLabel(value().contextTokens)} og {LOCAL_MODEL_RAM_RESERVE_GIB} GiB RAM i reserve. Sett konteksten på modellserveren.
                  *Verktøykall avhenger av serverens oppsett.
                </p>
              </Show>
            </div>
          )}</Show>
        </div>
      </Show>
    </>
  );
}
