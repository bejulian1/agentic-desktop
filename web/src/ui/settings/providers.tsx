// Modeller and Leverandører. Leverandører connects a provider with an API key, in a short view
// like OpenCode's; Modeller holds the default model and the model list for each provider. Keys go
// to the server once and are never sent back, so no field here ever shows one. Round 14 (SPEC
// 30.1): the server keeps them in the system keyring; KeyringNote says so when it cannot.
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { del, get, patch, post } from "../../lib/api";
import { formatTokens } from "../../lib/format";
import type { ListedModel, ModelConfig, ProviderConfig, ProviderKind, ProviderPreset } from "../../../../shared/protocol";
import { app, report, setApp, setSettingsOpen, toast } from "../../state/app";
import type { KeyringStatus } from "../../../../shared/protocol";
import { SecretInput } from "../SecretInput";
import { confirmDialog } from "../dialogs";
import { IconBack, IconInfo, IconPlus } from "../icons";
import { ProviderGlyph } from "../ProviderGlyph";
import { BetaBadge, Choice, Group, Page, Row, save } from "./parts";
import { Select } from "../Select";

const MOCK_PROVIDER = (p: ProviderConfig) => p.kind === "mock";
const BETA_TEXT = "Tilkoblingen er ikke prøvd med en ekte nøkkel ennå. Adressen og formatet er hentet fra leverandørens dokumentasjon.";

const disconnect = async (provider: ProviderConfig) => {
  if (await confirmDialog({ title: `Koble fra ${provider.name}?`, text: "Nøkkelen og modellene herfra fjernes fra appen. Tråder som brukte en av modellene, bytter til standardmodellen.", confirm: "Koble fra", danger: true })) {
    del(`/api/providers/${provider.id}`).catch(report);
  }
};

export function ProviderForm(props: { provider?: ProviderConfig; preset?: ProviderPreset; onDone: () => void }) {
  const [kind, setKind] = createSignal<ProviderKind>(props.provider?.kind ?? props.preset?.kind ?? "openai-compatible");
  const [name, setName] = createSignal(props.provider?.name ?? (props.preset && props.preset.id !== "custom" ? props.preset.name : ""));
  const [baseUrl, setBaseUrl] = createSignal(props.provider?.baseUrl ?? props.preset?.baseUrl ?? "");
  const [apiKeyEnv, setApiKeyEnv] = createSignal(props.provider?.apiKeyEnv ?? props.preset?.apiKeyEnv ?? "");
  const [apiKey, setApiKey] = createSignal("");
  const submit = async (event: Event) => {
    event.preventDefault();
    const body: Record<string, unknown> = { name: name(), baseUrl: baseUrl() || undefined, apiKeyEnv: apiKeyEnv() || undefined };
    if (apiKey()) body.apiKey = apiKey();
    try {
      if (props.provider) await patch(`/api/providers/${props.provider.id}`, body);
      else await post("/api/providers", { ...body, kind: kind(), ...(props.preset && props.preset.id !== "custom" ? { preset: props.preset.id } : {}) });
      setApiKey("");
      props.onDone();
    } catch (err) {
      report(err);
    }
  };
  return (
    <form class="form" onSubmit={submit} aria-label="Leverandør">
      <Show when={!props.provider && (!props.preset || props.preset.id === "custom")}>
        <p class="muted">Egendefinert: en tjeneste med et OpenAI-kompatibelt API, for eksempel en lokal server.</p>
        <div class="field"><span>Type</span>
          <Select<ProviderKind>
            label="Type"
            class="field-select"
            value={kind()}
            options={[{ value: "openai-compatible", label: "OpenAI-kompatibel" }, { value: "anthropic", label: "Anthropic" }]}
            onChange={setKind}
          />
        </div>
      </Show>
      <label class="field"><span>Navn</span><input class="input" required value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Min server" /></label>
      <label class="field"><span>Adresse (baseUrl)</span><input class="input" value={baseUrl()} onInput={(e) => setBaseUrl(e.currentTarget.value)} placeholder={kind() === "anthropic" ? "Standard" : "http://127.0.0.1:8080/v1"} spellcheck={false} /></label>
      <label class="field"><span>Miljøvariabel for nøkkel</span><input class="input" value={apiKeyEnv()} onInput={(e) => setApiKeyEnv(e.currentTarget.value)} placeholder="MIN_API_KEY" spellcheck={false} /></label>
      <label class="field"><span>Nøkkel</span><SecretInput label="Nøkkel" value={apiKey()} onInput={setApiKey} placeholder={props.provider?.hasKey ? "Satt. Skriv for å bytte." : "Lagres i nøkkelringen"} /></label>
      <div class="form-actions">
        <button type="button" class="btn" onClick={props.onDone}>Avbryt</button>
        <button type="submit" class="btn btn-primary">Lagre</button>
      </div>
    </form>
  );
}

function ModelForm(props: { model?: ModelConfig; providerId: string; onDone: () => void }) {
  const m = props.model;
  const [name, setName] = createSignal(m?.name ?? "");
  const [model, setModel] = createSignal(m?.model ?? "");
  const [contextWindow, setContextWindow] = createSignal(String(m?.contextWindow ?? 200000));
  const [input, setInput] = createSignal(m?.inputPricePerMTok === undefined ? "" : String(m.inputPricePerMTok));
  const [output, setOutput] = createSignal(m?.outputPricePerMTok === undefined ? "" : String(m.outputPricePerMTok));
  // Round 13 (SPEC 27.2): the provider's own web search. On for Anthropic unless turned off, off for
  // OpenAI-compatible servers unless the model is known to have it.
  const kind = () => app.providers.find((p) => p.id === props.providerId)?.kind;
  const [webSearch, setWebSearch] = createSignal(m?.webSearch ?? kind() === "anthropic");
  const submit = async (event: Event) => {
    event.preventDefault();
    const body: Record<string, unknown> = {
      providerId: props.providerId,
      name: name(),
      model: model(),
      contextWindow: Number(contextWindow()),
      inputPricePerMTok: input() === "" ? null : Number(input().replace(",", ".")),
      outputPricePerMTok: output() === "" ? null : Number(output().replace(",", ".")),
      webSearch: webSearch(),
    };
    try {
      if (m) await patch(`/api/models/${m.id}`, body);
      else await post("/api/models", body);
      props.onDone();
    } catch (err) {
      report(err);
    }
  };
  return (
    <form class="form" onSubmit={submit} aria-label="Modell">
      <label class="field"><span>Navn</span><input class="input" required value={name()} onInput={(e) => setName(e.currentTarget.value)} /></label>
      <label class="field"><span>Modell-ID</span><input class="input" required value={model()} onInput={(e) => setModel(e.currentTarget.value)} spellcheck={false} /></label>
      <label class="field"><span>Kontekstvindu (tokens)</span><input class="input" inputmode="numeric" value={contextWindow()} onInput={(e) => setContextWindow(e.currentTarget.value)} /></label>
      <div class="field-row">
        <label class="field"><span>Pris inn per million ($)</span><input class="input" inputmode="decimal" value={input()} onInput={(e) => setInput(e.currentTarget.value)} /></label>
        <label class="field"><span>Pris ut per million ($)</span><input class="input" inputmode="decimal" value={output()} onInput={(e) => setOutput(e.currentTarget.value)} /></label>
      </div>
      <label class="field-check">
        <input type="checkbox" role="switch" class="switch" checked={webSearch()} onChange={(e) => setWebSearch(e.currentTarget.checked)} />
        <span class="field-check-text">
          <span>Eget nettsøk hos leverandøren</span>
          <span class="muted">Brukes av Nettsøk i Chat. Slå av hvis modellen ikke har det; da søker appens nettleser i stedet, når en søkeside er satt opp.</span>
        </span>
      </label>
      <div class="form-actions">
        <button type="button" class="btn" onClick={props.onDone}>Avbryt</button>
        <button type="submit" class="btn btn-primary">Lagre</button>
      </div>
    </form>
  );
}

function ProviderCard(props: { provider: ProviderConfig }) {
  const provider = () => props.provider;
  const [modelForm, setModelForm] = createSignal<ModelConfig | "new" | null>(null);
  const [fetching, setFetching] = createSignal(false);
  const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null);
  const models = () => app.models.filter((m) => m.providerId === provider().id);
  const mock = () => MOCK_PROVIDER(provider());
  const test = async () => {
    setTestResult(null);
    try {
      setTestResult(await post(`/api/providers/${provider().id}/test`));
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    }
  };
  return (
    <div class="card" data-provider={provider().name}>
      <div class="card-head">
        <div class="card-title">
          <strong>{provider().name}</strong>
          <span class="muted">{mock() ? "Ingen nøkkel trengs" : `${provider().kind === "anthropic" ? "Anthropic" : "OpenAI-kompatibel"}, ${provider().hasKey ? "nøkkel er satt" : "nøkkel mangler"}`}</span>
        </div>
        <button type="button" class="btn btn-small" onClick={test}>Test tilkobling</button>
      </div>
      <Show when={testResult()}><p class="test-result" classList={{ bad: !testResult()!.ok }} role="status">{testResult()!.message}</p></Show>
      <ul class="model-list">
        <For each={models()}>
          {(model) => (
            <li class="model-row">
              <div class="card-title">
                <span>{model.name}</span>
                {/* The provider's own id in mono, for when you set it up; the demo model has none worth showing. */}
                <Show when={!mock()} fallback={<span class="muted">Svarer lokalt, uten nettverk</span>}>
                  <span class="muted"><code class="model-id">{model.model}</code>{model.inputPricePerMTok !== undefined ? `, $${model.inputPricePerMTok} inn og $${model.outputPricePerMTok ?? 0} ut per million` : ""}</span>
                </Show>
              </div>
              <Show when={app.settings.defaultModelId === model.id} fallback={<button type="button" class="btn btn-small" onClick={() => save({ defaultModelId: model.id })}>Bruk som standard</button>}>
                <span class="tag">Standard</span>
              </Show>
              <Show when={!mock()}>
                <button type="button" class="btn btn-small" onClick={() => setModelForm(model)}>Rediger</button>
                <button type="button" class="btn btn-small" onClick={() => del(`/api/models/${model.id}`).catch(report)}>Slett</button>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={modelForm()} keyed>
        {(form) => <ModelForm model={form === "new" ? undefined : form} providerId={provider().id} onDone={() => setModelForm(null)} />}
      </Show>
      <Show when={fetching()}><ModelFetcher provider={provider()} onDone={() => setFetching(false)} /></Show>
      <Show when={!mock() && !modelForm() && !fetching()}>
        <div class="card-actions">
          <button type="button" class="btn btn-small btn-primary" onClick={() => setFetching(true)}>Hent modeller</button>
          <button type="button" class="btn btn-small" onClick={() => setModelForm("new")}>Legg til modell</button>
        </div>
      </Show>
    </div>
  );
}

function ModelFetcher(props: { provider: ProviderConfig; onDone: () => void; closeLabel?: string }) {
  const [models, setModels] = createSignal<ListedModel[] | null>(null);
  const [picked, setPicked] = createSignal<Set<string>>(new Set());
  const [error, setError] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [busy, setBusy] = createSignal(true);
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
    const chosen = (models() ?? []).filter((m) => picked().has(m.id));
    try {
      await post(`/api/providers/${props.provider.id}/models`, { models: chosen.map((m) => ({ model: m.id, name: m.name, contextWindow: m.contextWindow })) });
      toast(chosen.length === 1 ? "La til 1 modell." : `La til ${chosen.length} modeller.`, "info");
      props.onDone();
    } catch (err) {
      report(err);
    }
  };
  return (
    <div class="fetcher" aria-label="Modeller fra leverandøren">
      <Show when={!busy()} fallback={<p class="muted">Henter modeller fra {props.provider.name}…</p>}>
        <Show when={!error()} fallback={<p class="test-result bad" role="alert">{error()}</p>}>
          <input class="input" placeholder="Filtrer modeller" aria-label="Filtrer modeller" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          <ul class="fetch-list">
            <For each={shown()} fallback={<li class="muted">Ingen modeller</li>}>
              {(m) => (
                <li>
                  <label class="fetch-row">
                    <input type="checkbox" checked={picked().has(m.id) || known().has(m.id)} disabled={known().has(m.id)} onChange={() => toggle(m.id)} />
                    <span class="fetch-id">{m.id}</span>
                    <span class="muted" title={m.contextSource === "api" ? "Fra leverandøren" : m.contextSource === "table" ? "Fra en innebygd tabell" : "Standardverdi, kan endres"}>
                      {formatTokens(m.contextWindow)}{m.contextSource === "default" ? " (standard)" : ""}
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <div class="form-actions">
        <button type="button" class="btn" onClick={props.onDone}>{props.closeLabel ?? "Lukk"}</button>
        <button type="button" class="btn btn-primary" disabled={!picked().size} onClick={add}>Legg til valgte ({picked().size})</button>
      </div>
    </div>
  );
}

export function Models() {
  const options = () =>
    app.providers.flatMap((provider) =>
      app.models.filter((m) => m.providerId === provider.id).map((m) => ({ value: m.id, label: MOCK_PROVIDER(provider) ? m.name : `${m.name} (${provider.name})` })),
    );
  return (
    <Page title="Modeller" intro="Demo-modellen er alltid tilgjengelig og bruker ikke nettverket. Koble til en leverandør for å bruke ekte modeller. Nøkler lagres i en fil bare du kan lese, og sendes aldri tilbake hit.">
      <Group title="Standard">
        <Row label="Standardmodell" text="Brukes i nye tråder. Hver tråd kan bytte modell i meldingsfeltet.">
          <Choice label="Standardmodell" value={app.settings.defaultModelId ?? ""} options={options()} onChange={(id) => save({ defaultModelId: id })} />
        </Row>
      </Group>
      <Group title="Agenten">
        <Row label="Komprimering" text="Når samtalen fyller 80 % av kontekstvinduet, komprimeres den automatisk. Gamle verktøyresultater og bilder kortes ned først.">
          <span class="pill">Alltid på</span>
        </Row>
        <Row label="Steg per tur" text="Agenten stopper etter 50 modellkall i én tur, så en løkke ikke kan gå for alltid.">
          <span class="pill">50</span>
        </Row>
      </Group>
      {/* The models of each provider. Keys, addresses and disconnecting live under Leverandører. */}
      <div class="settings-group-head"><h2>Modeller per leverandør</h2>
        <button type="button" class="btn btn-small" onClick={() => setSettingsOpen("providers")}>Leverandører…</button>
      </div>
      <For each={app.providers}>{(provider) => <ProviderCard provider={provider} />}</For>
    </Page>
  );
}

// "Koble til <navn>": the key, and then the models from the provider's own list.
function ConnectView(props: { preset: ProviderPreset; onClose: () => void }) {
  const [key, setKey] = createSignal("");
  const [address, setAddress] = createSignal(props.preset.baseUrl);
  const [busy, setBusy] = createSignal(false);
  const [provider, setProvider] = createSignal<ProviderConfig | null>(null);
  let input: HTMLInputElement | undefined;
  onMount(() => {
    input?.focus({ preventScroll: true });
    // Esc goes back to the list, not out of Innstillinger. Capture runs before the page's handler.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });
  const submit = async (event: Event) => {
    event.preventDefault();
    if (!key().trim() || busy()) return;
    setBusy(true);
    const body: Record<string, unknown> = { preset: props.preset.id, apiKey: key().trim() };
    if (address().trim() && address().trim() !== props.preset.baseUrl) body.baseUrl = address().trim();
    try {
      const created = await post<ProviderConfig>("/api/providers", body);
      setKey("");
      setProvider(created);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };
  const label = `${props.preset.name}-API-nøkkel`;
  return (
    <section class="connect-view" aria-label={`Koble til ${props.preset.name}`}>
      <div class="connect-bar">
        <button type="button" class="icon-button" aria-label="Tilbake til leverandørene" title="Tilbake (Esc)" onClick={props.onClose}><IconBack size={16} /></button>
      </div>
      <h1 class="connect-title"><ProviderGlyph name={props.preset.name} /><span>Koble til {props.preset.name}</span><Show when={props.preset.beta}><BetaBadge /></Show></h1>
      <Show
        when={provider()}
        fallback={
          <form class="connect-form" onSubmit={submit} aria-label={`Koble til ${props.preset.name}`}>
            <p class="connect-text">Skriv inn API-nøkkelen din for {props.preset.name} for å bruke modellene derfra i Agentic Desktop. {app.keyring?.store === "session" ? "Nøkkelen gjelder til appen lukkes, fordi nøkkelringen ikke kan brukes nå." : "Nøkkelen lagres kryptert i systemets nøkkelring, og vises aldri igjen."}</p>
            <label class="field"><span class="connect-label">{label}</span>
              <SecretInput ref={(el) => (input = el)} label={label} placeholder="API-nøkkel" value={key()} onInput={setKey} />
            </label>
            <details class="connect-advanced">
              <summary>Adresse</summary>
              <label class="field"><span class="sr-only">Adresse</span>
                <input class="input" aria-label="Adresse" spellcheck={false} value={address()} onInput={(e) => setAddress(e.currentTarget.value)} />
              </label>
              <span class="muted">Fra dokumentasjonen{props.preset.docsUrl ? ": " : "."}<Show when={props.preset.docsUrl}><a href={props.preset.docsUrl} target="_blank" rel="noreferrer noopener">{props.preset.docsUrl!.replace(/^https:\/\//, "")}</a></Show></span>
            </details>
            <Show when={props.preset.beta}><p class="beta-note">{BETA_TEXT}</p></Show>
            <div><button type="submit" class="btn btn-primary" disabled={!key().trim() || busy()}>Fortsett</button></div>
          </form>
        }
      >
        <p class="connect-text">{props.preset.name} er koblet til. Velg modellene du vil bruke. Listen hentes fra leverandørens /models med nøkkelen din.</p>
        <ModelFetcher provider={provider()!} onDone={props.onClose} closeLabel="Ferdig" />
      </Show>
    </section>
  );
}

export function Providers() {
  const [presets] = createResource(() => get<ProviderPreset[]>("/api/provider-presets"));
  const [connecting, setConnecting] = createSignal<ProviderPreset | null>(null);
  const [custom, setCustom] = createSignal(false);
  const [editing, setEditing] = createSignal<string | null>(null);
  const named = () => (presets() ?? []).filter((p) => p.id !== "custom");
  const connected = () => app.providers.filter((p) => !MOCK_PROVIDER(p));
  const presetFor = (p: ProviderConfig) => named().find((x) => x.kind === p.kind && (x.name === p.name || (!!x.baseUrl && x.baseUrl === p.baseUrl)));
  const popular = () => named().filter((x) => !connected().some((p) => presetFor(p)?.id === x.id));
  const host = (p: ProviderConfig) => (p.baseUrl ? p.baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "standardadresse");
  const count = (p: ProviderConfig) => app.models.filter((m) => m.providerId === p.id).length;
  return (
    <Show
      when={!connecting()}
      fallback={<ConnectView preset={connecting()!} onClose={() => setConnecting(null)} />}
    >
      <Page title="Leverandører" intro={app.keyring?.store === "session" ? "Koble til en leverandør med en API-nøkkel. Nøkkelen skrives aldri i klartekst, og sendes aldri tilbake til nettleseren." : "Koble til en leverandør med en API-nøkkel. Nøkkelen lagres kryptert i systemets nøkkelring, og sendes aldri tilbake til nettleseren."}>
        <KeyringNote />
        <Group title="Tilkoblede leverandører">
          <Row label="Demo-modell" icon={() => <ProviderGlyph name="Demo" />} badge={<span class="key-tag">Innebygd</span>} text="Alltid tilgjengelig, og bruker ikke nettverket." />
          <For each={connected()}>
            {(provider) => (
              <>
              <Row
                class="provider-row"
                label={provider.name}
                icon={() => <ProviderGlyph name={provider.name} />}
                badge={<><span class="key-tag">{provider.hasKey ? "API-nøkkel" : "Nøkkel mangler"}</span><Show when={presetFor(provider)?.beta}><BetaBadge /></Show></>}
                text={`${count(provider) === 1 ? "1 modell" : `${count(provider)} modeller`} · ${host(provider)}`}
              >
                <button type="button" class="btn btn-small btn-quiet" aria-label={`Modeller fra ${provider.name}`} onClick={() => setSettingsOpen("models")}>Modeller</button>
                <button type="button" class="btn btn-small btn-quiet" aria-label={`Rediger ${provider.name}`} aria-expanded={editing() === provider.id} onClick={() => setEditing(editing() === provider.id ? null : provider.id)}>Rediger</button>
                <button type="button" class="btn btn-small btn-quiet" aria-label={`Koble fra ${provider.name}`} onClick={() => disconnect(provider)}>Koble fra</button>
              </Row>
              <Show when={editing() === provider.id}>
                <div class="setting setting-block provider-edit"><ProviderForm provider={provider} onDone={() => setEditing(null)} /></div>
              </Show>
              </>
            )}
          </For>
        </Group>
        <Show when={popular().length}>
          <Group title="Populære leverandører">
            <For each={popular()}>
              {(preset) => (
                <Row label={preset.name} icon={() => <ProviderGlyph name={preset.name} />} badge={<Show when={preset.beta}><BetaBadge /></Show>} text={preset.note}>
                  <button type="button" class="btn btn-small" aria-label={`Koble til ${preset.name}`} onClick={() => setConnecting(preset)}><IconPlus size={14} /> Koble til</button>
                </Row>
              )}
            </For>
          </Group>
        </Show>
        <p class="beta-note">Beta: {BETA_TEXT}</p>
        <Show
          when={custom()}
          fallback={<button type="button" class="link-button" onClick={() => setCustom(true)}>Egendefinert (OpenAI-kompatibel adresse)</button>}
        >
          <div class="card"><ProviderForm preset={(presets() ?? []).find((p) => p.id === "custom")} onDone={() => setCustom(false)} /></div>
        </Show>
      </Page>
    </Show>
  );
}

// Round 14 (SPEC 30.1): one calm line when keys cannot go in the keyring, or when keys.json from an
// older version is still in the data folder. Nothing shows when all is as it should be.
const SESSION_TEXT: Record<NonNullable<KeyringStatus["reason"]>, string> = {
  "no-service": "Fant ingen nøkkelring på maskinen, så nye nøkler gjelder bare til appen lukkes.",
  locked: "Nøkkelringen er låst, så nye nøkler gjelder bare til appen lukkes.",
  error: "Nøkkelringen svarte ikke som ventet, så nye nøkler gjelder bare til appen lukkes.",
};
const LEGACY_TEXT: Record<NonNullable<KeyringStatus["legacy"]>["reason"], string> = {
  "no-service": "Nøklene i keys.json fra en eldre versjon brukes fortsatt, og flyttes til nøkkelringen når den er tilgjengelig.",
  locked: "Nøklene i keys.json fra en eldre versjon brukes fortsatt, og flyttes til nøkkelringen når den er låst opp.",
  error: "Nøklene i keys.json fra en eldre versjon brukes fortsatt, og flyttes til nøkkelringen når den svarer.",
  pending: "Nøklene i keys.json fra en eldre versjon flyttes til nøkkelringen.",
  readback: "keys.json fra en eldre versjon er ikke slettet, fordi nøklene ikke kunne leses likt tilbake fra nøkkelringen.",
  unreadable: "keys.json i datamappen kunne ikke leses, så den er ikke rørt. Legg inn nøklene på nytt, og slett fila selv.",
  delete: "Nøklene er flyttet til nøkkelringen, men keys.json kunne ikke slettes. Slett fila i datamappen selv.",
};

export function KeyringNote() {
  const [busy, setBusy] = createSignal(false);
  const status = () => app.keyring;
  const text = () => {
    const k = status();
    if (!k) return null;
    if (k.store === "pending") return "Venter på nøkkelringen …";
    if (k.store === "session") {
      const first = SESSION_TEXT[k.reason ?? "error"];
      if (!k.legacy) return first;
      const why = k.legacy.reason === "readback" || k.legacy.reason === "unreadable" ? LEGACY_TEXT[k.legacy.reason] : "Nøklene i keys.json fra en eldre versjon brukes til de kan flyttes.";
      return `${first} ${why}`;
    }
    return k.legacy ? LEGACY_TEXT[k.legacy.reason] : null;
  };
  const canRetry = () => status()?.store === "session" || (!!status()?.legacy && status()!.legacy!.reason !== "unreadable");
  const retry = async () => {
    setBusy(true);
    try {
      const next = await post<KeyringStatus>("/api/keyring/retry");
      setApp("keyring", next);
      if (next.store === "keyring" && !next.legacy) toast("Nøklene ligger nå i nøkkelringen.", "info");
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
          <button type="button" class="link-button" disabled={busy()} onClick={() => void retry()}>{busy() ? "Prøver …" : "Prøv igjen"}</button>
        </Show>
      </p>
    </Show>
  );
}
