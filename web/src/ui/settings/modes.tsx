// Innstillinger → Kode and → Chat (round 9). The gear at the bottom of the sidebar opens the one for
// the mode you are in. Kode: the start page, chosen from small drawings of each (round 11b, SPEC
// 25.2: Tekst, Token-historikk or Prosjektboks, the same with and without a project), and what
// shows beside a thread. Chat: the HTML preview and Chat projects.
import { createSignal, createUniqueId, For, Show, type JSX } from "solid-js";
import { CHAT_PERSONALITIES, chatToolsOf, type ChatToolId, type CodeStart, type CodeStartSize } from "../../../../shared/protocol";
import { patch } from "../../lib/api";
import { app, pinnedSummary, setApp, setPinnedSummary, sortedChatProjects } from "../../state/app";
import { IconMark, IconPlus } from "../icons";
import { Group, Page, Row, save, Segmented, Toggle } from "./parts";
import { CodeAppearance } from "./code-appearance";
import { newChatProject } from "../chat-projects";
import { activeChatPersonality, type ChatPersonalityContext } from "../../state/chat-personality";

interface StartOption<T extends string> {
  value: T;
  label: string;
  text: string;
  sketch: () => JSX.Element;
}

// A small drawing of each start page: the mark, the question as a line, and what is under it.
const Greeting = (props: { small?: boolean; children?: JSX.Element }) => (
  <span class="start-sketch" classList={{ "start-sketch-small": props.small }} aria-hidden="true">
    <span class="start-sketch-mark"><IconMark size={props.small ? 10 : 16} /></span>
    <span class="start-sketch-title" />
    {props.children}
  </span>
);

// Six weeks of a calendar in three shades, and a row of bars under it.
const HEAT = [0, 1, 0, 2, 1, 0, 1, 2, 3, 1, 0, 2, 1, 3, 2, 0, 1, 2, 0, 1, 3, 2, 1, 0];
const BARS = [3, 5, 2, 7, 4, 8, 6, 3, 9, 5, 7, 4];

const START_OPTIONS: Array<StartOption<CodeStart>> = [
  { value: "text", label: "Tekst", text: "Ikonet og «Hva skal vi bygge?» midt på siden, i den størrelsen du velger.", sketch: () => <Greeting /> },
  {
    value: "tokens",
    label: "Token-historikk",
    text: "Kalenderen og grafen for token-bruk, som i Innstillinger → Bruk.",
    sketch: () => (
      <Greeting small>
        <span class="start-sketch-card start-sketch-tokens">
          <span class="start-sketch-heat"><For each={HEAT}>{(level) => <b data-level={level} />}</For></span>
          <span class="start-sketch-bars"><For each={BARS}>{(h) => <b style={{ transform: `scaleY(${h / 9})` }} />}</For></span>
        </span>
      </Greeting>
    ),
  },
  {
    value: "projects",
    label: "Prosjektboks",
    text: "Én boks med nylige prosjekter, eller trådene i prosjektet, Velg miljø og GitHub.",
    sketch: () => (
      <Greeting small>
        <span class="start-sketch-card start-sketch-box"><i /><i /><i /><span class="start-sketch-rule" /><i class="start-sketch-env" /><span class="start-sketch-rule" /><i class="start-sketch-git" /></span>
      </Greeting>
    ),
  },
];

const SIZES: Array<{ value: CodeStartSize; label: string }> = [
  { value: "small", label: "Liten" },
  { value: "medium", label: "Middels" },
  { value: "large", label: "Stor" },
];

function StartChoice<T extends string>(props: { label: string; value: T; options: Array<StartOption<T>>; onChange: (value: T) => void }) {
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = props.options[(index + step + props.options.length) % props.options.length];
    props.onChange(next.value);
    requestAnimationFrame(() => (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div class="layout-cards start-cards" classList={{ "start-cards-3": props.options.length === 3 }} role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(option, index) => (
          <button
            type="button"
            role="radio"
            class="layout-card start-card"
            aria-checked={props.value === option.value}
            tabindex={props.value === option.value ? 0 : -1}
            onClick={() => props.onChange(option.value)}
            onKeyDown={(e) => move(e, index())}
          >
            {option.sketch()}
            <strong>{option.label}</strong>
            <span class="muted">{option.text}</span>
          </button>
        )}
      </For>
    </div>
  );
}

export function CodeSettings() {
  const start = () => app.settings.codeStart ?? "text";
  return (
    <Page title="Kode" intro="Tilpass kodevisning, samtaler og arbeidsområdet. Tilgang og modellatferd styres i Konfigurasjon.">
      <Group title="Startsiden">
        <div class="setting setting-block">
          <div class="setting-text">
            <strong class="start-choice-label">Ny tråd i Kode</strong>
            <span class="muted">Gjelder både med og uten prosjekt. Meldingsfeltet er det samme i alle tre.</span>
          </div>
          <StartChoice<CodeStart> label="Startsiden i Kode" value={start()} options={START_OPTIONS} onChange={(v) => save({ codeStart: v })} />
        </div>
        <Show when={start() === "text"}>
          <Row label="Størrelse" text="Ikonet og teksten skalerer også med vinduet." class="start-size-row">
            <Segmented<CodeStartSize> label="Størrelse på teksten" value={app.settings.codeStartSize ?? "medium"} options={SIZES} onChange={(v) => save({ codeStartSize: v })} />
          </Row>
        </Show>
      </Group>
      <CodeAppearance />
      <Group title="I tråden">
        <Row label="Standard samtalevisning" text="Gjelder nye visninger i Kode. Normal folder trinnene sammen. Tenkning åpner tenkesammendrag, og Detaljert åpner også verktøyutdata og bakgrunnsarbeid. Du kan fortsatt folde hvert trinn selv. Chat påvirkes ikke."><Segmented<"normal" | "thinking" | "detailed"> label="Standard samtalevisning" value={app.settings.codeTranscriptView ?? "normal"} options={[{ value: "normal", label: "Normal" }, { value: "thinking", label: "Tenkning" }, { value: "detailed", label: "Detaljert" }]} onChange={(v) => save({ codeTranscriptView: v })} /></Row>
        <Toggle label="Festet sammendrag" text="Vis knappen for mål, plan, endringer og bakgrunnsarbeid øverst til høyre i Kode." checked={pinnedSummary()} onChange={setPinnedSummary} />
        <Toggle label="Åpne agent-tråder i ny rute" text="Når en agent lager en tråd, vises den i en egen rute." checked={app.settings.autoOpenAgentThreads} onChange={(v) => save({ autoOpenAgentThreads: v })} />
      </Group>
    </Page>
  );
}

// Round 13 (SPEC 27.2): the page the app's browser searches on, with {q} for the words. Saved when
// the field is left or Enter is pressed; the server checks it and says what is wrong.
function SearchUrlRow() {
  const [value, setValue] = createSignal(app.settings.webSearchUrl ?? "");
  const [error, setError] = createSignal("");
  const commit = async () => {
    const next = value().trim();
    if (next === (app.settings.webSearchUrl ?? "")) return setError("");
    try {
      await patch("/api/settings", { webSearchUrl: next || null });
      setApp("settings", "webSearchUrl", next || undefined!);
      setError("");
    } catch (err) {
      setError((err as Error).message.replace(/^\d{3}\s*/, ""));
    }
  };
  return (
    <div class="setting setting-block search-url-row">
      <div class="setting-text">
        <strong>Søkeside for nettsøk</strong>
        <span class="muted">Brukes når modellen ikke har eget nettsøk. Appens nettleser åpner siden uten å vise den, og leser treffene. Skriv {"{q}"} der søkeordene skal stå. Tom betyr ingen søkeside.</span>
      </div>
      <input
        class="input"
        aria-label="Søkeside for nettsøk"
        placeholder="https://søkemotor.example/sok?q={q}"
        spellcheck={false}
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
        }}
      />
      <Show when={error()}><p class="field-error" role="alert">{error()}</p></Show>
    </div>
  );
}

const TOOL_DEFAULTS: Array<{ id: ChatToolId; label: string; text: string }> = [
  { id: "web", label: "Nettsøk", text: "Modellen kan søke på nettet: med leverandørens eget søk når modellen har det, ellers på søkesiden under." },
  { id: "fetch", label: "Les nettsider", text: "Modellen kan lese en adresse du limer inn, med appens nettleser." },
  { id: "documents", label: "Lag filer", text: "Lag nedlastbare Word-, Excel-, PowerPoint-, Markdown- og tekstfiler i chatten." },
  { id: "python", label: "Python-analyse", text: "Valgfri isolert kodekjøring for beregninger og data. Krever Python 3 og bubblewrap. Uten nettverk, tilgang til PC-filer eller ekstra Python-pakker. Variabler nullstilles mellom kjøringer, arbeidsfiler beholdes i chatten." },
  { id: "artifacts", label: "Artifacts", text: "Modellen kan lage små HTML-programmer som kjører i chatten." },
  { id: "memory", label: "Minne", text: "Modellen bruker Chat-minnene dine (Chat-personalisering)." },
];

// The choice belongs to the active Chat pane, never to all chats or to Kode.
function ChatPersonalitySettings() {
  const name = createUniqueId();
  type Choice = { context: ChatPersonalityContext; threadId: string | null; value: string };
  const [pending, setPending] = createSignal<Choice | null>(null);
  const [error, setError] = createSignal<(Choice & { message: string }) | null>(null);
  const inScope = (choice: Choice | null) => !!choice && choice.context === activeChatPersonality() && choice.threadId === choice.context.threadId();
  const saving = () => inScope(pending());
  const selected = () => saving() ? pending()!.value : activeChatPersonality()?.personality();
  const errorMessage = () => inScope(error()) ? error()!.message : "";
  const choose = async (value: string) => {
    const context = activeChatPersonality();
    if (!context || saving()) return;
    const choice = { context, threadId: context.threadId(), value };
    setError(null);
    setPending(choice);
    try {
      await context.setPersonality(value);
    } catch (err) {
      if (inScope(choice)) setError({ ...choice, message: (err as Error).message });
    } finally {
      if (pending() === choice) setPending(null);
    }
  };
  const scope = () => {
    const active = activeChatPersonality();
    if (!active) return "Åpne en chat eller et nytt Chat-utkast for å velge personlighet. Kode har sitt eget valg med /personality.";
    return active.threadId()
      ? `Gjelder bare den aktive chatten: «${active.title() || "Uten tittel"}».`
      : "Gjelder utkastet i den aktive Chat-ruten. Valget lagres i chatten når du sender første melding.";
  };
  return (
    <Group title="Personlighet">
      <div class="setting">
        <div class="setting-text">
          <strong>Personlighet for aktiv chat</strong>
          <span class="muted" id={`${name}-scope`}>{scope()} Egne instruksjoner for alle chatter finner du i Chat-personalisering.</span>
          <Show when={saving()}><span class="muted" role="status">Lagrer personlighet …</span></Show>
          <Show when={errorMessage()}><p class="form-error" role="alert">{errorMessage()}</p></Show>
        </div>
      </div>
      <div class="chat-personality-options" role="radiogroup" aria-label="Personlighet for aktiv chat" aria-describedby={`${name}-scope`} aria-busy={saving() ? "true" : undefined} aria-disabled={!activeChatPersonality() || saving() ? "true" : undefined}>
        <For each={CHAT_PERSONALITIES}>
          {(personality) => (
            <Row as="label" label={personality.label} text={<span id={`${name}-${personality.id}`}>{personality.id === "standard" ? "Følger standardvalget i Chat-personalisering" : personality.text}</span>}>
              <input
                type="radio"
                name={name}
                value={personality.id}
                aria-label={personality.label}
                aria-describedby={`${name}-${personality.id}`}
                checked={selected() === personality.id}
                disabled={!activeChatPersonality() || saving()}
                onChange={(event) => { if (event.currentTarget.checked) void choose(personality.id); }}
              />
            </Row>
          )}
        </For>
      </div>
    </Group>
  );
}

export function ChatSettings() {
  const count = () => sortedChatProjects().length;
  const defaults = () => chatToolsOf(undefined, app.settings);
  return (
    <Page title="Chat" intro="Samtaler uten prosjektmappe. Modellen får ingen verktøy for filer eller kommandoer her.">
      <ChatPersonalitySettings />
      <Group title="Verktøy i nye chatter">
        <For each={TOOL_DEFAULTS}>
          {(tool) => <Toggle label={tool.label} text={tool.text} checked={defaults()[tool.id]} onChange={(v) => save({ chatTools: { ...defaults(), [tool.id]: v } })} />}
        </For>
        <SearchUrlRow />
      </Group>
      <Group title="Samtale">
        <Toggle
          label="Åpne nye artifacts med en gang"
          text="Når modellen har skrevet en hel app i HTML eller React, åpnes den i panelet ved siden av samtalen. Av: boksen i samtalen venter på et klikk. Appen kjører på en egen origin, i en sandkasse."
          checked={app.settings.artifactPreview !== false}
          onChange={(v) => save({ artifactPreview: v })}
        />
        {/* Round 10 (SPEC 23.11): only how it looks, never what the model does. */}
        <Row label="Tenkevisning" text="Hvordan tenkingen vises mens en modell som resonnerer, jobber. Premium er et rolig kort med modellen, en linje om hva den holder på med og en fremdriftslinje. Modeller uten tenking viser ingen av delene.">
          <Segmented<"standard" | "premium">
            label="Tenkevisning"
            value={app.settings.thinkingView ?? "standard"}
            options={[{ value: "standard", label: "Vanlig" }, { value: "premium", label: "Premium" }]}
            onChange={(v) => save({ thinkingView: v })}
          />
        </Row>
      </Group>
      <Group title="Prosjekter i Chat">
        <div class="setting">
          <div class="setting-text">
            <strong>Prosjekter i Chat</strong>
            <span class="muted">
              Samle chatter under et navn. De har ingen mappe på disken. Lag dem med + ved Prosjekter i sidefanen, og flytt en chat inn fra menyen på tråden.
              {" "}{count() === 0 ? "Ingen ennå." : count() === 1 ? "1 prosjekt." : `${count()} prosjekter.`}
            </span>
          </div>
          <div class="setting-control">
            <button
              type="button"
              class="btn btn-small"
              onClick={async () => {
                await newChatProject();
              }}
            >
              <IconPlus size={13} />Nytt prosjekt
            </button>
          </div>
        </div>
      </Group>
    </Page>
  );
}
