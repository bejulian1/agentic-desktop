// Modeller and Leverandører. Leverandører connects a provider with an API key, in a short view
// like OpenCode's; Modeller holds the default model and the model list for each provider. Keys go
// to the server once and are never sent back, so no field here ever shows one. Round 14 (SPEC
// 30.1): the server keeps them in the system keyring; KeyringNote says so when it cannot.
import { createEffect, createMemo, createResource, createSignal, createUniqueId, For, onCleanup, onMount, Show, Suspense } from "solid-js";
import { DictationSettings } from '../Dictation';
import { del, get, patch, post } from "../../lib/api";
import { formatTokens } from "../../lib/format";
import type { DetectedLocalProvider, ListedModel, ModelConfig, ProviderConfig, ProviderPreset } from "../../../../shared/protocol";
import { app, report, saveSettings, setApp, toast } from "../../state/app";
import { agentSettingsOf, isMaxStepsPerTurn, MIN_STEPS_PER_TURN, MAX_STEPS_PER_TURN } from "../../../../shared/protocol";
import { DEFAULT_LOCAL_CONTEXT_WINDOW, modelAllowsTools } from "../../../../shared/protocol";
import type { KeyringStatus } from "../../../../shared/protocol";
import { SecretInput } from "../SecretInput";
import { confirmDialog } from "../dialogs";
import { IconBack, IconClose, IconInfo, IconPlus, IconSearch } from "../icons";
import { Choice, Group, Page, Row, Segmented, Toggle, save } from "./parts";
import { Select } from "../Select";
import { LocalModelAdvisor } from "./local-model-advisor";

import { plural, t } from "../../lib/i18n";
const MOCK_PROVIDER = (p: ProviderConfig) => p.kind === "mock";

const disconnect = async (provider: ProviderConfig) => {
  if (await confirmDialog({ title: t("Koble fra {name}?", { name: provider.name }), text: t("Nøkkelen og modellene herfra fjernes fra appen. Tråder som brukte en av modellene, bytter til standardmodellen."), confirm: t("Koble fra"), danger: true })) {
    del(`/api/providers/${provider.id}`).catch(report);
  }
};

function ProviderForm(props: { provider: ProviderConfig; onDone: () => void }) {
  const [name, setName] = createSignal(props.provider.name);
  const [baseUrl, setBaseUrl] = createSignal(props.provider.baseUrl ?? "");
  const [apiKeyEnv, setApiKeyEnv] = createSignal(props.provider.apiKeyEnv ?? "");
  const [apiKey, setApiKey] = createSignal("");
  const [clearKey, setClearKey] = createSignal(false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = { name: name(), baseUrl: baseUrl().trim(), apiKeyEnv: apiKeyEnv().trim() };
    if (clearKey()) Object.assign(body, { apiKey: "", apiKeyEnv: "" });
    else if (apiKey().trim()) body.apiKey = apiKey().trim();
    try {
      await patch(`/api/providers/${props.provider.id}`, body);
      setApiKey("");
      props.onDone();
    } catch (err) {
      setError((err as Error).message);
      report(err);
    } finally { setBusy(false); }
  };
  return (
    <form class="form" onSubmit={submit} aria-label={t("Leverandør")}>
      <label class="field"><span>{t("Navn")}</span><input class="input" required value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder={t("Min server")} /></label>
      <label class="field"><span>{t("Adresse (baseUrl)")}</span><input class="input" type="url" required={props.provider.kind === "openai-compatible"} value={baseUrl()} onInput={(e) => setBaseUrl(e.currentTarget.value)} placeholder={props.provider.kind === "anthropic" ? t("Standard") : "http://127.0.0.1:8080/v1"} spellcheck={false} /></label>
      <Show when={props.provider.hasKey && baseUrl().trim() !== (props.provider.baseUrl ?? "")}><p class="provider-model-hint">{t("Den lagrede nøkkelen følger ikke med til en ny adresse. Skriv inn nøkkelen for den nye adressen hvis den krever det.")}</p></Show>
      <label class="field"><span>{t("Miljøvariabel for nøkkel")}</span><input class="input" value={apiKeyEnv()} onInput={(e) => { setApiKeyEnv(e.currentTarget.value); setClearKey(false); }} placeholder={t("MIN_API_KEY")} spellcheck={false} /></label>
      <label class="field"><span>{t("Nøkkel")}</span><SecretInput label={t("Nøkkel")} value={apiKey()} onInput={(value) => { setApiKey(value); setClearKey(false); }} placeholder={clearKey() ? t("Fjernes når du lagrer") : props.provider.hasKey ? t("Satt. Skriv for å bytte.") : t("Lagres i nøkkelringen")} /></label>
      <Show when={props.provider.hasKey || props.provider.apiKeyEnv}>
        <label class="field-check"><input type="checkbox" checked={clearKey()} onChange={(e) => { setClearKey(e.currentTarget.checked); if (clearKey()) setApiKey(""); }} /><span>{t("Fjern nøkkelen fra dette oppsettet")}</span></label>
      </Show>
      <Show when={error()}><p class="test-result bad" role="alert">{error()}</p></Show>
      <div class="form-actions">
        <button type="button" class="btn" onClick={props.onDone}>{t("Avbryt")}</button>
        <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? t("Lagrer…") : t("Lagre")}</button>
      </div>
    </form>
  );
}

function ModelForm(props: { model?: ModelConfig; providerId: string; onDone: () => void }) {
  const m = props.model;
  const [name, setName] = createSignal(m?.name ?? "");
  const [model, setModel] = createSignal(m?.model ?? "");
  const provider = () => app.providers.find((p) => p.id === props.providerId);
  const [contextWindow, setContextWindow] = createSignal(String(m?.contextWindow ?? (provider()?.localKind ? DEFAULT_LOCAL_CONTEXT_WINDOW : 200_000)));
  const [input, setInput] = createSignal(m?.inputPricePerMTok === undefined ? "" : String(m.inputPricePerMTok));
  const [output, setOutput] = createSignal(m?.outputPricePerMTok === undefined ? "" : String(m.outputPricePerMTok));
  // Round 13 (SPEC 27.2): the provider's own web search. On for Anthropic unless turned off, off for
  // OpenAI-compatible servers unless the model is known to have it.
  const kind = () => provider()?.kind;
  const [webSearch, setWebSearch] = createSignal(m?.webSearch ?? kind() === "anthropic");
  const [supportsTools, setSupportsTools] = createSignal(modelAllowsTools(m, provider()?.localKind));
  const [supportsImages, setSupportsImages] = createSignal(m?.supportsImages ?? false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      providerId: props.providerId,
      name: name(),
      model: model(),
      contextWindow: Number(contextWindow()),
      inputPricePerMTok: input() === "" ? null : Number(input().replace(",", ".")),
      outputPricePerMTok: output() === "" ? null : Number(output().replace(",", ".")),
      webSearch: webSearch(),
      supportsTools: supportsTools(),
      ...(kind() === "openai-compatible" ? { supportsImages: supportsImages() } : {}),
    };
    try {
      if (m) await patch(`/api/models/${m.id}`, body);
      else await post("/api/models", body);
      props.onDone();
    } catch (err) {
      setError((err as Error).message);
      report(err);
    } finally { setBusy(false); }
  };
  return (
    <form class="form" onSubmit={submit} aria-label={t("Modell")}>
      <label class="field"><span>{t("Navn")}</span><input class="input" required value={name()} onInput={(e) => setName(e.currentTarget.value)} /></label>
      <label class="field"><span>{t("Modell-ID")}</span><input class="input" required value={model()} onInput={(e) => setModel(e.currentTarget.value)} spellcheck={false} /></label>
      <label class="field"><span>{t("Kontekstvindu (tokens)")}</span><input class="input" inputmode="numeric" value={contextWindow()} onInput={(e) => setContextWindow(e.currentTarget.value)} /></label>
      <div class="field-row">
        <label class="field"><span>{t("Pris inn per million ($)")}</span><input class="input" inputmode="decimal" value={input()} onInput={(e) => setInput(e.currentTarget.value)} /></label>
        <label class="field"><span>{t("Pris ut per million ($)")}</span><input class="input" inputmode="decimal" value={output()} onInput={(e) => setOutput(e.currentTarget.value)} /></label>
      </div>
      <label class="field-check">
        <input type="checkbox" role="switch" class="switch" checked={supportsTools()} onChange={(e) => setSupportsTools(e.currentTarget.checked)} />
        <span class="field-check-text">
          <span>{t("Verktøykall")}</span>
          <span class="muted">{t("Slå av for modeller som bare skal svare med tekst. Da kan modellen verken bruke filer, kjøre kommandoer eller styre nettleseren.")}</span>
        </span>
      </label>
      <Show when={kind() === "openai-compatible"}>
        <label class="field-check">
          <input type="checkbox" role="switch" class="switch" checked={supportsImages()} onChange={(e) => setSupportsImages(e.currentTarget.checked)} />
          <span class="field-check-text"><span>{t("Bildestøtte")}</span><span class="muted">{t("Slå på hvis modellserveren støtter bildevedlegg for denne modellen.")}</span></span>
        </label>
      </Show>
      <Show when={!provider()?.localKind}><label class="field-check">
        <input type="checkbox" role="switch" class="switch" checked={supportsTools() && webSearch()} disabled={!supportsTools()} onChange={(e) => setWebSearch(e.currentTarget.checked)} />
        <span class="field-check-text">
          <span>{t("Eget nettsøk hos leverandøren")}</span>
          <span class="muted">{t("Brukes av Nettsøk i Chat. Slå av hvis modellen ikke har det; da søker appens nettleser i stedet, når en søkeside er satt opp.")}</span>
        </span>
      </label></Show>
      <Show when={error()}><p class="test-result bad" role="alert">{error()}</p></Show>
      <div class="form-actions">
        <button type="button" class="btn" onClick={props.onDone}>{t("Avbryt")}</button>
        <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? t("Lagrer…") : t("Lagre")}</button>
      </div>
    </form>
  );
}

function ProviderCard(props: { provider: ProviderConfig; preset?: ProviderPreset }) {
  const provider = () => props.provider;
  const [editing, setEditing] = createSignal(false);
  const [modelForm, setModelForm] = createSignal<ModelConfig | "new" | null>(null);
  const [fetching, setFetching] = createSignal(false);
  const [testing, setTesting] = createSignal<string | null>(null);
  const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null);
  const models = () => app.models.filter((m) => m.providerId === provider().id);
  const mock = () => MOCK_PROVIDER(provider());
  const manual = () => props.preset?.modelDiscovery === "manual";
  const local = () => !!provider().localKind;
  const costNoteId = createUniqueId();
  const test = async (model?: ModelConfig) => {
    if (testing()) return;
    setTesting(model?.id ?? provider().id);
    setTestResult(null);
    try {
      const result = await post<{ ok: boolean; message: string }>(`/api/providers/${provider().id}/test`, model ? { modelId: model.id } : undefined);
      setTestResult({ ok: result.ok, message: model ? `${model.name} · ${result.message}` : result.message });
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally { setTesting(null); }
  };
  return (
    <div class="card provider-row" data-provider={provider().name} id={`provider-card-${provider().id}`} tabindex="-1" role="group" aria-label={provider().name}>
      <div class="card-head">
        <div class="card-title">
          <strong>{provider().name}</strong>
          <span class="muted">{mock() ? t("Innebygd · uten nettverk") : `${plural(models().length, "{count} modell", "{count} modeller")} · ${provider().baseUrl ? provider().baseUrl!.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : t("standardadresse")}`}</span>
          <Show when={!mock()}><span class="key-tag">{provider().hasKey ? t("API-nøkkel") : local() || props.preset?.keyRequired === false ? t("Valgfri nøkkel") : t("Ingen nøkkel satt")}</span></Show>
        </div>
        <div class="provider-actions">
          <Show when={!manual()}><button type="button" class="btn btn-small" disabled={!!testing()} aria-label={t("Test tilkobling")} onClick={() => void test()}>{testing() ? t("Tester…") : t("Test tilkobling")}</button></Show>
          <Show when={!mock()}>
            <button type="button" class="btn btn-small btn-quiet" aria-label={t("Rediger {name}", { name: provider().name })} aria-expanded={editing()} onClick={() => setEditing(!editing())}>{t("Rediger leverandør")}</button>
            <button type="button" class="btn btn-small btn-quiet" aria-label={t("Koble fra {name}", { name: provider().name })} onClick={() => disconnect(provider())}>{t("Koble fra")}</button>
          </Show>
        </div>
      </div>
      <Show when={testResult()}><p class="test-result" classList={{ bad: !testResult()!.ok }} role="status">{testResult()!.message}</p></Show>
      <Show when={editing()}>
        <div class="provider-edit"><ProviderForm provider={provider()} onDone={() => setEditing(false)} /></div>
      </Show>
      <Show when={(manual() || local()) && models().length > 0}><p class="provider-model-hint" id={costNoteId}>{local() ? t("«Test modell» sender en kort melding. Med verktøy på sjekkes også et testkall uten å utføre det.") : t("«Test modell» sender en kort melding til modellen og kan koste penger.")}</p></Show>
      <ul class="model-list" aria-label={t("Modeller fra {name}", { name: provider().name })}>
        <For each={models()}>
          {(model) => (
            <li class="model-row">
              <div class="card-title">
                <span>{model.name}</span>
                {/* The provider's own id in mono, for when you set it up; the demo model has none worth showing. */}
                <Show when={!mock()} fallback={<span class="muted">{t("Svarer lokalt, uten nettverk")}</span>}>
                  <span class="muted"><code class="model-id">{model.model}</code>{model.inputPricePerMTok !== undefined ? t(", ${input} inn og ${output} ut per million", { input: model.inputPricePerMTok, output: model.outputPricePerMTok ?? 0 }) : ""}</span>
                </Show>
                <Show when={local()}><span class="muted">{modelAllowsTools(model, provider().localKind) ? t("Verktøy på") : t("Verktøy av")}</span></Show>
              </div>
              <Show when={app.settings.defaultModelId === model.id} fallback={<button type="button" class="btn btn-small" onClick={() => save({ defaultModelId: model.id })}>{t("Bruk som standard")}</button>}>
                <span class="tag">{t("Standard")}</span>
              </Show>
              <Show when={!mock()}>
                <Show when={manual() || local()}><button type="button" class="btn btn-small" disabled={!!testing()} aria-describedby={costNoteId} aria-label={t("Test modell {name}", { name: model.name })} onClick={() => void test(model)}>{testing() === model.id ? t("Tester…") : t("Test modell")}</button></Show>
                <button type="button" class="btn btn-small" onClick={() => setModelForm(model)}>{t("Rediger")}</button>
                <button type="button" class="btn btn-small" onClick={() => del(`/api/models/${model.id}`).catch(report)}>{t("Slett")}</button>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={modelForm()} keyed>
        {(form) => <ModelForm model={form === "new" ? undefined : form} providerId={provider().id} onDone={() => setModelForm(null)} />}
      </Show>
      <Show when={fetching()}><ModelFetcher provider={provider()} onDone={() => setFetching(false)} onManual={() => { setFetching(false); setModelForm("new"); }} /></Show>
      <Show when={!mock() && !modelForm() && !fetching()}>
        <div class="card-actions">
          <Show when={!manual()}><button type="button" class="btn btn-small btn-primary" onClick={() => setFetching(true)}>{t("Hent modeller")}</button></Show>
          <button type="button" class="btn btn-small" classList={{ "btn-primary": manual() }} onClick={() => setModelForm("new")}>{t("Legg til modell")}</button>
        </div>
      </Show>
    </div>
  );
}

function ModelFetcher(props: { provider: ProviderConfig; onDone: () => void; onManual: () => void; closeLabel?: string }) {
  const [models, setModels] = createSignal<ListedModel[] | null>(null);
  const [picked, setPicked] = createSignal<Set<string>>(new Set());
  const [error, setError] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [busy, setBusy] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const known = () => new Set(app.models.filter((m) => m.providerId === props.provider.id).map((m) => m.model));
  onMount(async () => {
    try {
      setModels(await post<ListedModel[]>(`/api/providers/${props.provider.id}/models/fetch`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  });
  const toggle = (id: string) => {
    const next = new Set(picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const shown = () => (models() ?? []).filter((m) => !filter() || m.id.toLowerCase().includes(filter().toLowerCase()));
  const add = async () => {
    if (saving()) return;
    const chosen = (models() ?? []).filter((m) => picked().has(m.id));
    setSaving(true);
    try {
      await post(`/api/providers/${props.provider.id}/models`, { models: chosen.map((m) => ({ model: m.id, name: m.name, contextWindow: m.contextWindow, supportsTools: m.supportsTools, supportsImages: m.supportsImages })) });
      toast(plural(chosen.length, "La til {count} modell.", "La til {count} modeller."), "info");
      props.onDone();
    } catch (err) {
      report(err);
    } finally { setSaving(false); }
  };
  return (
    <div class="fetcher" aria-label={t("Modeller fra leverandøren")}>
      <Show when={!busy()} fallback={<p class="muted" role="status">{t("Henter modeller fra {name}…", { name: props.provider.name })}</p>}>
        <Show when={!error()} fallback={<p class="test-result bad" role="alert">{error()}</p>}>
          <input class="input" placeholder={t("Filtrer modeller")} aria-label={t("Filtrer modeller")} value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          <ul class="fetch-list">
            <For each={shown()} fallback={<li class="muted">{t("Ingen modeller")}</li>}>
              {(m) => (
                <li>
                  <label class="fetch-row">
                    <input type="checkbox" checked={picked().has(m.id) || known().has(m.id)} disabled={known().has(m.id) || (picked().size >= 200 && !picked().has(m.id))} onChange={() => toggle(m.id)} />
                    <span class="fetch-id">{m.id}</span>
                    <span class="muted" title={m.contextSource === "api" ? t("Fra leverandøren") : m.contextSource === "table" ? t("Fra en innebygd tabell") : t("Standardverdi, kan endres")}>
                      {formatTokens(m.contextWindow)}{m.contextSource === "default" ? t(" (standard)") : ""}
                    </span>
                    <Show when={props.provider.localKind}><span class="muted fetch-tools">{m.supportsTools ? t("Verktøy på") : t("Verktøy av")}</span></Show>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <div class="form-actions model-fetch-actions">
        <button type="button" class="link-button" disabled={saving()} onClick={props.onManual}>{t("Skriv inn modell-ID")}</button>
        <button type="button" class="btn" disabled={saving()} onClick={props.onDone}>{props.closeLabel ?? t("Lukk")}</button>
        <button type="button" class="btn btn-primary" disabled={saving() || !picked().size} onClick={add}>{t("Legg til valgte ({count})", { count: picked().size })}</button>
      </div>
    </div>
  );
}

function StepBudget() {
  const savedSteps = () => agentSettingsOf({ maxStepsPerTurn: app.settings.maxStepsPerTurn }).maxStepsPerTurn;
  const [draft, setDraft] = createSignal(String(savedSteps()));
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  createEffect(() => setDraft(String(savedSteps())));
  const submit = async (event: Event) => {
    event.preventDefault();
    const value = draft().trim() ? Number(draft()) : NaN;
    if (!isMaxStepsPerTurn(value)) {
      setError(t("Velg et heltall fra {min} til {max}.", { min: MIN_STEPS_PER_TURN, max: MAX_STEPS_PER_TURN }));
      return;
    }
    setError("");
    setSaving(true);
    try { await saveSettings({ maxStepsPerTurn: value }); }
    catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <form class="form" onSubmit={submit} noValidate aria-label={t("Steggrense")}>
      <div class="form-actions">
        <input class="input" type="number" aria-label={t("Steg per tur")} aria-invalid={!!error()} aria-describedby={error() ? "step-budget-error" : undefined}
          min={MIN_STEPS_PER_TURN} max={MAX_STEPS_PER_TURN} step="1" style={{ width: "6rem" }} value={draft()}
          onInput={(event) => { setDraft(event.currentTarget.value); setError(""); }} />
        <button type="submit" class="btn btn-small" disabled={saving()}>{t("Lagre steggrense")}</button>
      </div>
      <Show when={error()}><span id="step-budget-error" role="alert">{error()}</span></Show>
    </form>
  );
}

function ModelDefaults(props: { active?: boolean }) {
  const options = () =>
    app.providers.flatMap((provider) =>
      app.models.filter((m) => m.providerId === provider.id).map((m) => ({ value: m.id, label: MOCK_PROVIDER(provider) ? m.name : `${m.name} (${provider.name})` })),
    );
  return (
    <>
      <Group title={t("Standard")}>
        <Row label={t("Standardmodell")} text={t("Brukes i nye tråder. Hver tråd kan bytte modell i meldingsfeltet.")}>
          <Choice active={props.active} label={t("Standardmodell")} value={app.settings.defaultModelId ?? ""} options={options()} onChange={(id) => save({ defaultModelId: id })} />
        </Row>
      </Group>
      <Group title={t("Agenten")}>
        <Toggle label={t("Komprimering")} text={t("Når dette er på, kortes gamle verktøyresultater og bilder ned ved 80 % av kontekstvinduet, og eldre samtale oppsummeres ved behov. Av beholder historikken til leverandørens kontekstgrense; bruk /compact ved behov. Gjelder nye turer.")}
          checked={agentSettingsOf(app.settings).autoCompact} onChange={(autoCompact) => save({ autoCompact })} />
        <Row label={t("Steg per tur")} text={t("Agenten stopper etter maksimalt {steps} modellsteg i én tur. Ett steg kan inneholde flere verktøykall. Velg {min}–{max}; grensen gjelder nye turer.", { steps: agentSettingsOf(app.settings).maxStepsPerTurn, min: MIN_STEPS_PER_TURN, max: MAX_STEPS_PER_TURN })}>
          <StepBudget />
        </Row>
      </Group>
    </>
  );
}

function ManualModelEntry(props: { provider: ProviderConfig; onDone: () => void }) {
  const [modelId, setModelId] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const hintId = createUniqueId();
  let input!: HTMLInputElement;
  onMount(() => { if (!input.closest("[hidden]")) input.focus(); });
  const add = async (event: Event) => {
    event.preventDefault();
    const model = modelId().trim();
    if (!model || busy()) return;
    setBusy(true);
    setError("");
    try {
      await post(`/api/providers/${props.provider.id}/models`, { models: [{ model }] });
      toast(t("Modellen {model} er tilgjengelig.", { model }), "info");
      props.onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <form class="connect-form" onSubmit={add} aria-label={t("Legg til modell")}>
      <label class="field"><span class="connect-label">{t("Modell-ID")}</span>
        <input ref={input} class="input" spellcheck={false} autocomplete="off" required aria-describedby={hintId} value={modelId()} onInput={(e) => setModelId(e.currentTarget.value)} />
      </label>
      <p id={hintId} class="provider-model-hint">{t("Bruk modell-ID-en fra leverandøren, eller navnet på distribusjonen hvis tjenesten bruker det.")}</p>
      <Show when={error()}><p class="test-result bad" role="alert">{error()}</p></Show>
      <div class="form-actions">
        <button type="button" class="btn" disabled={busy()} onClick={props.onDone}>{t("Legg til senere")}</button>
        <button type="submit" class="btn btn-primary" disabled={!modelId().trim() || busy()}>{busy() ? t("Lagrer…") : t("Legg til modell")}</button>
      </div>
    </form>
  );
}

type CustomType = "openai-compatible" | "local" | "anthropic";
// A function, so the labels follow the active language.
const customTypes = (): Array<{ value: CustomType; label: string }> => [
  { value: "openai-compatible", label: t("OpenAI-kompatibel") },
  { value: "local", label: t("Lokal modellserver") },
  { value: "anthropic", label: "Anthropic" },
];

function ConnectView(props: { preset: ProviderPreset; active?: boolean; onClose: () => void }) {
  const custom = props.preset.id === "custom";
  const [customType, setCustomType] = createSignal<CustomType>("openai-compatible");
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [address, setAddress] = createSignal(props.preset.baseUrl);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [manual, setManual] = createSignal(props.preset.modelDiscovery === "manual");
  const [provider, setProvider] = createSignal<ProviderConfig | null>(null);
  const local = () => props.preset.category === "local" || (custom && customType() === "local");
  const showAddress = !props.preset.baseUrl || props.preset.category === "local";
  const addressRequired = () => !custom || customType() !== "anthropic";
  const canSubmit = () => !busy() && (!custom || !!name().trim()) && (!addressRequired() || !!address().trim()) && (!props.preset.keyRequired || !!key().trim());
  let keyInput!: HTMLInputElement;
  let addressInput!: HTMLInputElement;
  let nameInput!: HTMLInputElement;
  let view!: HTMLElement;
  const close = () => { if (view.isConnected) props.onClose(); };
  onMount(() => {
    (custom ? nameInput : showAddress ? addressInput : keyInput).focus();
    // Esc goes back to the list, not out of Innstillinger. Capture runs before the page's handler.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy() || document.querySelector("dialog[open]") || view.closest("[hidden]") || view.querySelector(".field-select[aria-expanded='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });
  const submit = async (event: Event) => {
    event.preventDefault();
    if (!canSubmit()) return;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = custom
      ? { name: name().trim(), ...(local() ? { preset: "custom-local" } : { kind: customType() }) }
      : { preset: props.preset.id };
    if (key().trim()) body.apiKey = key().trim();
    if (address().trim() !== props.preset.baseUrl) body.baseUrl = address().trim();
    try {
      const created = await post<ProviderConfig>("/api/providers", body);
      setKey("");
      setProvider(created);
      if (!manual() && !view.closest("[hidden]")) view.querySelector<HTMLElement>(".connect-model-status")?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const label = () => (custom ? t("Nøkkel") : t("{name}-API-nøkkel", { name: props.preset.name }));
  const optionalLabel = () => (custom ? t("Nøkkel (valgfri)") : t("{name}-API-nøkkel (valgfri)", { name: props.preset.name }));
  const addressField = (
    <label class="field"><span class="connect-label">{t("API-adresse")}</span>
      <input ref={addressInput} class="input" type="url" required={addressRequired()} spellcheck={false} autocomplete="off" value={address()} placeholder={local() ? "http://127.0.0.1:8080/v1" : !addressRequired() ? t("Standardadresse (valgfri)") : undefined} onInput={(e) => setAddress(e.currentTarget.value)} />
    </label>
  );
  return (
    <section class="connect-view" ref={view} aria-label={t("Koble til {name}", { name: props.preset.name })}>
      <div class="connect-bar">
        <button type="button" class="icon-button" aria-label={t("Tilbake til leverandørene")} title={t("Tilbake (Esc)")} disabled={busy()} onClick={props.onClose}><IconBack size={16} /></button>
      </div>
      <h1 class="connect-title"><span>{t("Koble til {name}", { name: props.preset.name })}</span></h1>
      <Show
        when={provider()}
        fallback={
          <form class="connect-form" onSubmit={submit} aria-label={t("Koble til {name}", { name: props.preset.name })}>
            <Show when={props.preset.note}><p class="connect-text">{props.preset.note}</p></Show>
            <Show when={props.preset.docsUrl}><a class="provider-docs-link" href={props.preset.docsUrl} target="_blank" rel="noreferrer noopener">{t("Dokumentasjon for {name}", { name: props.preset.name })}</a></Show>
            <Show when={custom}>
              <label class="field"><span class="connect-label">{t("Navn")}</span><input ref={nameInput} class="input" required value={name()} onInput={(e) => setName(e.currentTarget.value)} /></label>
              <div class="field"><span class="connect-label">{t("Type")}</span><Select<CustomType> active={props.active} label={t("Type")} class="field-select" value={customType()} options={customTypes()} onChange={setCustomType} /></div>
            </Show>
            <Show when={showAddress}>{addressField}</Show>
            <Show when={local()}><p class="provider-model-hint">{t("Start serveren først. For en annen maskin, bruk dens adresse. Bruk HTTPS hvis nøkkelen eller innholdet må krypteres på nettverket.")}</p></Show>
            <label class="field"><span class="connect-label">{props.preset.keyRequired ? label() : optionalLabel()}</span>
              <SecretInput ref={(el) => (keyInput = el)} label={custom || props.preset.keyRequired ? label() : optionalLabel()} placeholder={t("API-nøkkel")} value={key()} onInput={setKey} />
            </label>
            <p class="provider-model-hint">{app.keyring?.store === "session" ? t("Nøkkelen beholdes i minnet til du lukker appen.") : app.keyring?.store === "keyring" ? t("Nøkkelen lagres i systemets nøkkelring.") : t("Hvis nøkkelringen er utilgjengelig, beholdes nøkkelen bare i denne økten.")}</p>
            <Show when={!showAddress}><details class="connect-advanced"><summary>{t("Adresse")}</summary>{addressField}</details></Show>
            <Show when={error()}><p class="test-result bad" role="alert">{error()}</p></Show>
            <div><button type="submit" class="btn btn-primary" disabled={!canSubmit()}>{busy() ? t("Lagrer…") : t("Fortsett")}</button></div>
          </form>
        }
      >
        <p class="connect-text connect-model-status" tabindex="-1">{manual() ? t("{name} er lagret. Legg til en modell nå eller senere.", { name: provider()!.name }) : t("{name} er lagret. Velg modellene du vil bruke fra leverandørens liste.", { name: provider()!.name })}</p>
        <Show when={manual()} fallback={<ModelFetcher provider={provider()!} onManual={() => setManual(true)} onDone={close} closeLabel={t("Ferdig")} />}>
          <ManualModelEntry provider={provider()!} onDone={close} />
        </Show>
      </Show>
    </section>
  );
}

// Kept as an export for callers that still import the old model page.
export function Models() { return <Providers />; }

type CatalogCategory = NonNullable<ProviderPreset["category"]> | "all";
// Functions, so the labels follow the active language.
const categories = (): { value: CatalogCategory; label: string }[] => [
  { value: "all", label: t("Alle") }, { value: "cloud", label: t("Sky") },
  { value: "gateway", label: t("Gatewayer") }, { value: "local", label: t("Lokal drift") },
];
const categoryLabel = (category: Exclude<CatalogCategory, "all">): string => ({ cloud: t("Sky"), gateway: t("Gateway"), local: t("Lokal drift") })[category];
const CATALOG_PAGE_SIZE = 8;

// Older connections have no saved preset ID. Prefer the provider's name when multiple
// installations share a URL (common with local servers), otherwise match only a unique URL.
function savedPreset(provider: ProviderConfig, presets: ProviderPreset[]): ProviderPreset | undefined {
  if (provider.presetId) return presets.find((preset) => preset.id === provider.presetId);
  const candidates = presets.filter((preset) => preset.id !== "custom" && preset.kind === provider.kind);
  const named = candidates.find((preset) => preset.name === provider.name);
  if (named) return named;
  const matches = candidates.filter((preset) => !!preset.baseUrl && preset.baseUrl === provider.baseUrl);
  return matches.length === 1 ? matches[0] : undefined;
}

function ProviderCatalog(props: {
  presets: ProviderPreset[];
  custom?: ProviderPreset;
  active?: boolean;
  saved: Map<string, ProviderConfig>;
  searchRef: (input: HTMLInputElement) => void;
  onConnect: (preset: ProviderPreset, button: HTMLButtonElement) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [category, setCategory] = createSignal<CatalogCategory>("all");
  const [limit, setLimit] = createSignal(CATALOG_PAGE_SIZE);
  const [detected, setDetected] = createSignal<DetectedLocalProvider[]>([]);
  const [detecting, setDetecting] = createSignal(false);
  const [detectStatus, setDetectStatus] = createSignal("");
  const [detectError, setDetectError] = createSignal(false);
  const detectedById = createMemo(() => new Map(detected().map((match) => [match.presetId, match])));
  const categoryOf = (preset: ProviderPreset) => preset.category ?? (preset.local ? "local" : "cloud");
  const filtered = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/);
    return props.presets.filter((preset) => {
      const group = categoryOf(preset);
      if (category() !== "all" && group !== category()) return false;
      const text = [preset.name, preset.id, preset.baseUrl, preset.note, categoryLabel(group)].join(" ").toLowerCase();
      return words.every((word) => text.includes(word));
    }).sort((left, right) => Number(detectedById().has(right.id)) - Number(detectedById().has(left.id)));
  });
  let search!: HTMLInputElement;
  let list!: HTMLUListElement;
  const updateQuery = (value: string) => { setQuery(value); setLimit(CATALOG_PAGE_SIZE); };
  const clearSearch = () => { updateQuery(""); search.focus(); };
  const showMore = () => {
    const firstNew = limit();
    setLimit(firstNew + CATALOG_PAGE_SIZE);
    list.children[firstNew]?.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const detect = async () => {
    if (detecting()) return;
    setDetecting(true);
    setDetectError(false);
    setDetectStatus("");
    setDetected([]);
    try {
      const matches = await post<DetectedLocalProvider[]>("/api/providers/local/detect");
      setDetected(matches);
      if (matches.length) {
        setCategory("local");
        updateQuery("");
      }
      setDetectStatus(matches.length ? plural(matches.length, "{count} API svarte på denne maskinen.", "{count} API-er svarte på denne maskinen.") : t("Fant ingen åpne modellister på standardadressene. Velg en leverandør for å oppgi adresse eller nøkkel selv."));
    } catch (err) {
      setDetectError(true);
      setDetectStatus(t("Kunne ikke sjekke standardadressene: {message}", { message: (err as Error).message }));
    } finally {
      setDetecting(false);
    }
  };
  return (
    <Group title={t("Leverandørkatalog")} action={<span class="provider-count" role="status">{plural(filtered().length, "{count} leverandør", "{count} leverandører")}</span>}>
      <div class="provider-catalog-tools">
        <div class="settings-search">
          <IconSearch size={14} />
          <input ref={(el) => { search = el; props.searchRef(el); }} class="settings-search-input" type="search" aria-label={t("Søk etter leverandør")} placeholder={t("Søk etter leverandør")} spellcheck={false} value={query()} onInput={(e) => updateQuery(e.currentTarget.value)}
            on:keydown={(e) => { if (e.key === "Escape" && query()) { e.preventDefault(); e.stopPropagation(); clearSearch(); } }} />
          <Show when={query()}><button type="button" class="settings-search-clear" aria-label={t("Tøm leverandørsøket")} onClick={clearSearch}><IconClose size={12} /></button></Show>
        </div>
        <Segmented<CatalogCategory> label={t("Leverandørtype")} options={categories()} value={category()} onChange={(value) => { setCategory(value); setLimit(CATALOG_PAGE_SIZE); }} />
      </div>
      <Show when={category() === "all" || category() === "local"}>
        <Row label={t("Lokale modellservere")} text={t("Sjekk standardadressene for Ollama, LM Studio, llama.cpp og vLLM på denne maskinen.")}>
          <button type="button" class="btn btn-small" aria-disabled={detecting()} onClick={() => void detect()}>{detecting() ? t("Ser etter servere…") : t("Finn lokale servere")}</button>
        </Row>
        <p class="provider-detect-status" classList={{ muted: !detectError() }} role={detectError() ? "alert" : "status"}>{detectStatus()}</p>
        <LocalModelAdvisor active={props.active} />
      </Show>
      <ul class="provider-catalog-list" ref={list} aria-label={t("Leverandører i katalogen")}>
        <For each={filtered().slice(0, limit())} fallback={<li class="provider-catalog-empty">{t("Ingen leverandører passer søket og filteret.")}</li>}>
          {(preset) => {
            const connected = () => props.saved.get(preset.id);
            const detectedText = () => {
              const match = detectedById().get(preset.id);
              if (!match) return "";
              return plural(match.modelCount, "Svarte på standardadressen ({count} modell)", "Svarte på standardadressen ({count} modeller)");
            };
            const open = (button: HTMLButtonElement) => {
              const saved = connected();
              if (saved) document.getElementById(`provider-card-${saved.id}`)?.focus();
              else props.onConnect(preset, button);
            };
            return (
              <li>
                <Row label={preset.name} text={[categoryLabel(categoryOf(preset)), preset.note, detectedText()].filter(Boolean).join(" · ")}>
                  <button type="button" class="btn btn-small" aria-label={connected() ? t("Vis oppsett for {name}", { name: preset.name }) : t("Koble til {name}", { name: preset.name })} onClick={(e) => open(e.currentTarget)}>
                    <Show when={connected()} fallback={<><IconPlus size={14} /> {t("Koble til")}</>}>{t("Vis oppsett")}</Show>
                  </button>
                  <Show when={connected() && categoryOf(preset) === "local"}>
                    <button type="button" class="btn btn-small" aria-label={t("Legg til en annen server med {name}", { name: preset.name })} onClick={(e) => props.onConnect(preset, e.currentTarget)}>{t("Legg til en til")}</button>
                  </Show>
                </Row>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={filtered().length > limit()}>
        <button type="button" class="provider-catalog-more link-button" onClick={showMore}>{t("Vis flere leverandører ({shown} av {total})", { shown: limit(), total: filtered().length })}</button>
      </Show>
      <Show when={props.custom}>{(custom) => <button type="button" class="provider-catalog-more link-button" onClick={(e) => props.onConnect(custom(), e.currentTarget)}>{t("Egendefinert oppsett")}</button>}</Show>
    </Group>
  );
}

export function Providers(props: { active?: boolean } = {}) {
  // Read the asynchronous list inside its own Suspense boundary: connected models and drafts
  // stay visible and usable while the catalogue is loading.
  const [catalogError, setCatalogError] = createSignal("");
  const [presets, { refetch }] = createResource(async () => {
    setCatalogError("");
    try { return await get<ProviderPreset[]>("/api/provider-presets"); }
    catch (err) { setCatalogError((err as Error).message); return []; }
  });
  const [connecting, setConnecting] = createSignal<ProviderPreset | null>(null);
  const named = () => (presets() ?? []).filter((p) => p.id !== "custom");
  const presetFor = (provider: ProviderConfig) => savedPreset(provider, presets.loading ? [] : presets.latest ?? []);
  const saved = createMemo(() => {
    const byPreset = new Map<string, ProviderConfig>();
    for (const provider of app.providers) {
      const preset = presetFor(provider);
      if (preset && !byPreset.has(preset.id)) byPreset.set(preset.id, provider);
    }
    return byPreset;
  });
  let catalogSearch: HTMLInputElement | undefined;
  let opener: HTMLButtonElement | undefined;
  const connect = (preset: ProviderPreset, button: HTMLButtonElement) => { opener = button; setConnecting(preset); };
  const close = () => {
    setConnecting(null);
    if (props.active !== false) (opener?.isConnected ? opener : catalogSearch)?.focus();
  };
  return (
    <>
      <div hidden={!!connecting()}>
        <Page title={t("Modeller og leverandører")} intro={t("Velg standardmodell, administrer modellene dine og koble til leverandører på samme sted. Demo-modellen er alltid tilgjengelig uten nettverk.")}>
          <KeyringNote />
          <DictationSettings />
          <Row label={t("Nøkkellagring")} text={app.keyring?.legacy ? t("En nøkkelfil fra en eldre versjon finnes fortsatt. Se statusmeldingen under for flytting til nøkkelringen.") : app.keyring?.store === "keyring" && !app.keyring.legacy ? t("Nøklene oppbevares i operativsystemets nøkkelring. Appen lagrer ingen egen klartekstkopi.") : app.keyring?.store === "session" ? t("Nye nøkler beholdes bare i minnet til appen avsluttes. Se statusmeldingen for nøkkelringen.") : t("Kontrollerer nøkkelring og eventuell eldre nøkkellagring.")}><span data-testid="key-storage-status">{app.keyring?.legacy ? t("Eldre nøkkelfil finnes") : app.keyring?.store === "keyring" && !app.keyring.legacy ? t("Systemnøkkelring") : app.keyring?.store === "session" ? t("Kun denne økten") : t("Venter på nøkkelringen")}</span></Row>
          <p class="provider-key-note">{t("Nye nøkler lagres ikke i en klartekstfil av appen, og sendes aldri tilbake til grensesnittet.")}</p>
          <ModelDefaults active={props.active !== false && !connecting()} />
          <div class="settings-group provider-cards">
            <div class="settings-group-head"><h2>{t("Tilkoblede leverandører")}</h2><button type="button" class="btn btn-small" disabled={presets.loading || !!catalogError()} onClick={() => catalogSearch?.focus()}><IconPlus size={14} /> {t("Koble til leverandør")}</button></div>
            <For each={app.providers.map((p) => p.id)}>{(id) => {
              const provider = () => app.providers.find((p) => p.id === id)!;
              return <ProviderCard provider={provider()} preset={presetFor(provider())} />;
            }}</For>
          </div>
          <Suspense fallback={<p class="muted" role="status">{t("Henter leverandører…")}</p>}>
            <Show when={catalogError()}>
              <div class="provider-catalog-error" role="alert"><span>{t("Kunne ikke hente leverandører: {message}", { message: catalogError() })}</span><button type="button" class="btn btn-small" onClick={() => void refetch()}>{t("Prøv igjen")}</button></div>
            </Show>
            <Show when={named().length}><ProviderCatalog presets={named()} custom={presets()?.find((preset) => preset.id === "custom")} saved={saved()} active={props.active !== false && !connecting()} searchRef={(input) => { catalogSearch = input; }} onConnect={connect} /></Show>
          </Suspense>
        </Page>
      </div>
      <Show when={connecting()} keyed>{(preset) => <ConnectView preset={preset} active={props.active} onClose={close} />}</Show>
    </>
  );
}

// Round 14 (SPEC 30.1): one calm line when keys cannot go in the keyring, or when keys.json from an
// older version is still in the data folder. Nothing shows when all is as it should be.
// Functions, so the texts follow the active language.
const sessionText = (reason: NonNullable<KeyringStatus["reason"]>): string => ({
  "no-service": t("Fant ingen nøkkelring på maskinen, så nye nøkler gjelder bare til appen lukkes."),
  locked: t("Nøkkelringen er låst, så nye nøkler gjelder bare til appen lukkes."),
  error: t("Nøkkelringen svarte ikke som ventet, så nye nøkler gjelder bare til appen lukkes."),
})[reason];
const legacyText = (reason: NonNullable<KeyringStatus["legacy"]>["reason"]): string => ({
  "no-service": t("Nøklene i keys.json fra en eldre versjon brukes fortsatt, og flyttes til nøkkelringen når den er tilgjengelig."),
  locked: t("Nøklene i keys.json fra en eldre versjon brukes fortsatt, og flyttes til nøkkelringen når den er låst opp."),
  error: t("Nøklene i keys.json fra en eldre versjon brukes fortsatt, og flyttes til nøkkelringen når den svarer."),
  pending: t("Nøklene i keys.json fra en eldre versjon flyttes til nøkkelringen."),
  readback: t("keys.json fra en eldre versjon er ikke slettet, fordi nøklene ikke kunne leses likt tilbake fra nøkkelringen."),
  unreadable: t("keys.json i datamappen kunne ikke leses, så den er ikke rørt. Legg inn nøklene på nytt, og slett fila selv."),
  delete: t("Nøklene er flyttet til nøkkelringen, men keys.json kunne ikke slettes. Slett fila i datamappen selv."),
})[reason];

export function KeyringNote() {
  const [busy, setBusy] = createSignal(false);
  const status = () => app.keyring;
  const text = () => {
    const k = status();
    if (!k) return null;
    if (k.store === "pending") return t("Venter på nøkkelringen …");
    if (k.store === "session") {
      const first = sessionText(k.reason ?? "error");
      if (!k.legacy) return first;
      const why = k.legacy.reason === "readback" || k.legacy.reason === "unreadable" ? legacyText(k.legacy.reason) : t("Nøklene i keys.json fra en eldre versjon brukes til de kan flyttes.");
      return `${first} ${why}`;
    }
    return k.legacy ? legacyText(k.legacy.reason) : null;
  };
  const canRetry = () => status()?.store === "session" || (!!status()?.legacy && status()!.legacy!.reason !== "unreadable");
  const retry = async () => {
    setBusy(true);
    try {
      const next = await post<KeyringStatus>("/api/keyring/retry");
      setApp("keyring", next);
      if (next.store === "keyring" && !next.legacy) toast(t("Nøklene ligger nå i nøkkelringen."), "info");
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show when={text()}>
      <p class="keyring-note" role="status" data-testid="keyring-note">
        <IconInfo size={14} />
        <span>{text()}</span>
        <Show when={canRetry()}>
          <button type="button" class="link-button" disabled={busy()} onClick={() => void retry()}>{busy() ? t("Prøver …") : t("Prøv igjen")}</button>
        </Show>
      </p>
    </Show>
  );
}
