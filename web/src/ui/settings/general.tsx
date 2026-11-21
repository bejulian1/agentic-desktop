import { t, plural } from "../../lib/i18n";
import { languages, type LanguageSetting } from "../../../../shared/i18n.ts";
import {WallpaperSettings} from './wallpaper';
import {setModsOpen,uiMods} from "../../state/ui-mods";
// Generelt, Utseende and Personvern og data. Kode and Chat are in ./modes.tsx (round 9). Every control here is saved on the server and acts at
// once. Native window behavior is shown only inside the Electron app.
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { AccentColor, BusyMessages, Density, EnterKey, GlobalConfig, PermissionMode, StartMode, ThemeSetting, TurnNotify } from "../../../../shared/protocol";
import { get, patch } from "../../lib/api";
import { desktop, type CloseBehavior } from "../../lib/desktop";
import { app, deleteThread, report, setApp, setSettingsOpen, toast } from "../../state/app";
import { allowNotifications, chime } from "../../state/look";
import { openWelcome } from "../../state/welcome";
import { confirmDialog } from "../dialogs";
import { IconPlay } from "../icons";
import { ThemePicker } from "../ThemePicker";
import { AppIconPicker } from "../AppIconPicker";
import { permissionScope, permissionTitle } from "../permission-copy";
import { Choice, Group, Page, Rich, Row, save, Segmented, Toggle } from "./parts";

const THEMES = (): Array<{ value: ThemeSetting; label: string }> => [
  { value: "light", label: t("Lys") },
  { value: "dark", label: t("Mørk") },
  { value: "system", label: t("System") },
];

const ACCENTS = (): Array<{ value: AccentColor; label: string }> => [
  { value: "blue", label: t("Blå") },
  { value: "violet", label: t("Fiolett") },
  { value: "green", label: t("Grønn") },
  { value: "orange", label: t("Oransje") },
  { value: "pink", label: t("Rosa") },
  { value: "red", label: t("Rød") },
  { value: "graphite", label: t("Grafitt") },
];


export function LanguageRow() {
  return (
    <Row label={t("Språk")}>
      <Choice<LanguageSetting> label={t("Språk")} value={app.settings.language ?? "system"}
        options={[{ value: "system", label: t("Følg systemet") }, ...Object.entries(languages).map(([value, label]) => ({ value: value as LanguageSetting, label }))]}
        onChange={language => save({ language })} />
    </Row>
  );
}

export function General() {
  const notifyChoice = async (value: TurnNotify) => {
    if (value !== "off" && !(await allowNotifications())) {
      toast(t("Nettleseren tillater ikke varsler for denne siden. Varsler kan slås på i nettleserens innstillinger for nettstedet."), "info");
    }
    save({ notifyOnDone: value });
  };
  return (
    <Page title={t("Generelt")}>
      <Group title={t("Språk")}>
        <LanguageRow />
        <Row label={t("Velkomstskjerm")}>
          <button type="button" class="btn btn-small" onClick={(e) => openWelcome("welcome", e.currentTarget)}>{t("Åpne")}</button>
        </Row>
        <Row label={t("Importer fra andre kodeapper")}>
          <button type="button" class="btn btn-small" onClick={(e) => openWelcome("import", e.currentTarget)}>{t("Åpne")}</button>
        </Row>
      </Group>
      <PermissionDefaults />
      <Group title={t("Oppstart")}>
        <Row label={t("Åpne appen i")} text={t("Velg Chat, Kode eller sist brukte modus. Samtalene dine beholdes i sidefanen.")}>
          <Choice<StartMode>
            label={t("Åpne appen i")}
            value={app.settings.startMode ?? "last"}
            options={[{ value: "last", label: t("Sist brukte") }, { value: "chat", label: t("Chat") }, { value: "code", label: t("Kode") }]}
            onChange={(v) => save({ startMode: v })}
          />
        </Row>
        <Row label={t("Samtale ved oppstart")} text={t("Ny, tom samtale åpner et blankt meldingsfelt i valgt modus, også når et lukket vindu åpnes fra statusfeltet. Lagrede samtaler beholdes i sidefanen. Vanlig sideoppfriskning beholder visningen.")}>
          <Choice<"new" | "resume"> label={t("Samtale ved oppstart")} value={app.settings.startConversation ?? "new"} options={[{ value: "new", label: t("Ny, tom samtale") }, { value: "resume", label: t("Fortsett der jeg slapp") }]} onChange={(v) => save({ startConversation: v })} />
        </Row>
      </Group>
      <Group title={t("Når en tur er ferdig")}>
        <Row label={t("Spill av en lyd")} text={t("En kort lyd når agenten er ferdig eller stopper med en feil.")}>
          <button type="button" class="btn btn-small try-sound" title={t("Spill av lyden nå")} onClick={() => chime()}><IconPlay size={12} />{t("Prøv")}</button>
          <span class="setting-control-sep" aria-hidden="true" />
          <input type="checkbox" role="switch" class="switch" aria-label={t("Spill av en lyd")} checked={app.settings.soundOnDone ?? false} onChange={(e) => save({ soundOnDone: e.currentTarget.checked })} />
        </Row>
        <Row label={t("Systemvarsel")} text={t("Et varsel fra nettleseren med navnet på tråden. Nettleseren spør om lov første gang.")}>
          <Choice<TurnNotify>
            label={t("Systemvarsel")}
            value={app.settings.notifyOnDone ?? "off"}
            options={[{ value: "off", label: t("Av") }, { value: "unfocused", label: t("Når appen ikke er i fokus") }, { value: "always", label: t("Alltid") }]}
            onChange={(v) => void notifyChoice(v)}
          />
        </Row>
      </Group>
      <Group title={t("Samtale")}>
        <Row label={t("Enter i meldingsfeltet")} text={t("Enter sender, og Shift+Enter gir ny linje. Eller omvendt: Enter gir ny linje, og Ctrl+Enter sender.")}>
          <Segmented<EnterKey>
            label={t("Enter i meldingsfeltet")}
            value={app.settings.enterKey ?? "send"}
            options={[{ value: "send", label: t("Enter sender") }, { value: "newline", label: t("Enter gir ny linje") }]}
            onChange={(v) => save({ enterKey: v })}
          />
        </Row>
        <Toggle
          label={t("Autofullfør meldinger med TAB")}
          text={t("Grå tekstforslag fra tredje brukermelding, basert på tidligere svar og åpen kodefil. TAB godtar uten å sende. Forslag bruker egne modellkall og kan bruke API-kvote.")}
          checked={app.settings.promptAutocomplete === true}
          onChange={(v) => save({ promptAutocomplete: v })}
        />
        <Row label={t("Modell til autofullføring")} text={t("Utdrag av samtalen og åpen kodefil sendes til denne modellen. Du kan følge samtalemodellen eller velge en egen.")}>
          <Choice<string>
            label={t("Modell til autofullføring")}
            value={app.models.some((m) => m.id === app.settings.promptAutocompleteModelId) ? app.settings.promptAutocompleteModelId! : ""}
            options={[{ value: "", label: t("Samme som samtalen") }, ...app.models.map((m) => ({ value: m.id, label: `${m.name} (${app.providers.find((p) => p.id === m.providerId)?.name ?? t("Leverandør")})` }))]}
            onChange={(v) => save({ promptAutocompleteModelId: v || null })}
          />
        </Row>
        <Toggle
          label={t("Vis tenkesammendrag")}
          text={t("Viser modellens sammendrag av tenkningen i tråden, når modellen gir et.")}
          checked={app.settings.thinkingSummary !== false}
          onChange={(v) => save({ thinkingSummary: v })}
        />
        <Toggle
          label={t("Skallutdata utvidet")}
          text={t("Utdata fra kommandoer i skallet vises utvidet i tråden, ikke sammenlagt.")}
          checked={app.settings.expandShell === true}
          onChange={(v) => save({ expandShell: v })}
        />
        <Row label={t("Meldinger mens agenten jobber")} text={t("Gjelder Chat og Kode. Kø: meldingen venter til turen er ferdig. Send med en gang: den går inn i turen som kjører, ved neste steg (mellom verktøykall), og modellen kan endre kurs.")}>
          <Choice<BusyMessages>
            label={t("Meldinger mens agenten jobber")}
            value={app.settings.busyMessages ?? "queue"}
            options={[{ value: "queue", label: t("Kø") }, { value: "steer", label: t("Send med en gang") }]}
            onChange={(v) => save({ busyMessages: v })}
          />
        </Row>
      </Group>
      <Group title={t("Vindu")}>
        <Show when={desktop}>
          <CloseBehaviorRow />
        </Show>
        <Toggle
          label={t("Spør før fanen lukkes")}
          text={t("Nettleseren spør før lukking eller ny innlasting mens en tråd kjører. Kjøringen fortsetter på serveren.")}
          checked={app.settings.confirmQuit ?? false}
          onChange={(v) => save({ confirmQuit: v })}
        />
      </Group>
    </Page>
  );
}

// Exclusive permission modes, shared with the no-project composer through persisted settings.
function PermissionDefaults() {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const options = (): Array<{ value: PermissionMode; label: string; text: string }> => [
    { value: "ask", label: t("Be om godkjenning"), text: t("Lesing er tillatt. Spør før filendringer, kommandoer og bruk av nettleseren.") },
    { value: "accept-edits", label: t("Godkjenn for meg"), text: t("Endrer filer i arbeidsområdet automatisk. Spør før kommandoer og bruk av nettleseren.") },
    { value: "full", label: t("Full tilgang"), text: t("Godkjenner vanlige verktøyhandlinger, inkludert filendringer og kommandoer, automatisk. Beskyttede filer krever fortsatt godkjenning.") },
  ];
  const choose = async (value: PermissionMode) => {
    if (busy() || value === app.settings.defaultPermissionMode) return;
    setBusy(true);
    setError("");
    try {
      await patch("/api/settings", { defaultPermissionMode: value });
      setApp("settings", "defaultPermissionMode", value);
    } catch (err) {
      setError(t("Kunne ikke lagre standardtillatelsen. Prøv igjen."));
      report(err);
    } finally { setBusy(false); }
  };
  return <Group title={t("Tillatelser i Kode")}>
    <div class="setting setting-block"><div class="setting-text"><strong>{permissionTitle()}</strong><span class="muted">{permissionScope()}</span></div></div>
    <div class="default-code-permissions" role="radiogroup" aria-label={t("Standardtillatelser i Kode")} aria-busy={busy()}>
      <For each={options()}>{(option) => <Row as="label" label={option.label} text={option.text}>
        <input type="radio" name="default-code-permission" value={option.value} checked={app.settings.defaultPermissionMode === option.value} disabled={busy()} onChange={() => void choose(option.value)} />
      </Row>}</For>
    </div>
    <Show when={error()}><p class="permission-error" role="alert">{error()}</p></Show>
  </Group>;
}

// Only in the Electron app (SPEC 29.6). The choice is kept by the app itself, not on the server,
// because the window has to know it at the moment it closes.
function CloseBehaviorRow() {
  const [info, { mutate }] = createResource(() => desktop!.closeBehavior());
  const text = () =>
    info()?.statusArea === false
      ? t("Lukk-knappen legger appen i statusfeltet øverst på skjermen, så trådene jobber videre. Statusfeltet er ikke tilgjengelig nå, så Lukk avslutter appen.")
      : t("Lukk-knappen legger appen i statusfeltet øverst på skjermen, så trådene jobber videre. Ctrl+Q, og Avslutt i statusfeltet, avslutter alltid helt.");
  return (
    <Row label={t("Når vinduet lukkes")} text={text()}>
      <Segmented<CloseBehavior>
        label={t("Når vinduet lukkes")}
        value={info()?.value ?? "tray"}
        options={[{ value: "tray", label: t("Legg i statusfeltet") }, { value: "quit", label: t("Avslutt") }]}
        onChange={(v) => void desktop!.closeBehavior(v).then((next) => next && mutate(next)).catch(report)}
      />
    </Row>
  );
}

export function Appearance() {
  const layout = () => app.settings.sidebarLayout ?? "standard";
  return (
    <Page title={t("Utseende")}>
      <Group title={t("Tema og farge")}>
        <Row label={t("Tema")} text={t("System følger innstillingen i operativsystemet, også mens appen er åpen.")}>
          <Segmented<ThemeSetting> label={t("Tema")} value={app.settings.theme} options={THEMES()} onChange={(v) => save({ theme: v })} />
        </Row>
        <ThemePicker />
        <Row label={t("Aksentfarge")} text={t("Brytere, fokus, merker og aktivitetskartet.")}>
          <div class="swatches" role="radiogroup" aria-label={t("Aksentfarge")}>
            <For each={ACCENTS()}>
              {(accent) => (
                <button
                  type="button"
                  role="radio"
                  class="swatch"
                  data-swatch={accent.value}
                  aria-checked={(app.settings.accent ?? "blue") === accent.value}
                  aria-label={accent.label}
                  title={accent.label}
                  onClick={() => save({ accent: accent.value })}
                />
              )}
            </For>
          </div>
        </Row>
      </Group>
      <WallpaperSettings/>
      <Group title={t("Egne temaer og mods")}><Row label={t("Tema og mods")} text={t("Lag temaer, animerte pixelart-bakgrunner og informasjonsfelt fra samtalen. Hver samtale kan ha sitt eget tema. Standardutseendet beholdes når mods er av.")}><button class="btn btn-small" onClick={()=>setModsOpen(true)}>{t("Åpne biblioteket")}</button></Row><Toggle label={t("Tillat visuelle mods")} text={t("Temaer bruker validerte farger og tegneelementer. De endrer ikke modellens tillatelser.")} checked={uiMods().enabled} onChange={v=>{void import('../../state/ui-mods').then(m=>m.modPreferences({enabled:v})).catch(report);}}/></Group>
      {/* Round 14 (SPEC 30.2) */}
      <Group title={t("Appikon")}>
        <AppIconPicker />
      </Group>
      <Group title={t("Sidefane")}>
        <div class="setting setting-block">
          <span class="muted">{t("Hvordan trådene vises i sidefanen.")}</span>
          <div class="layout-cards" role="radiogroup" aria-label={t("Sidefane")}>
            <button type="button" role="radio" class="layout-card" aria-checked={layout() === "standard"} onClick={() => save({ sidebarLayout: "standard" })}>
              <span class="layout-sketch" data-layout="standard" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              <strong>{t("Standard")}</strong>
              <span class="muted">{t("Prosjekter og tråder i lister.")}</span>
            </button>
            <button type="button" role="radio" class="layout-card" aria-checked={layout() === "smart"} onClick={() => save({ sidebarLayout: "smart" })}>
              <span class="layout-sketch" data-layout="smart" aria-hidden="true"><b /><b /><i /><i /><i /></span>
              <strong>{t("Smart")}</strong>
              <span class="muted">{t("Kort for det som trenger deg, med Jobber, Utsatt og Avsluttet samlet nederst.")}</span>
            </button>
          </div>
        </div>
        {/* Round 10 (SPEC 23.9) */}
        <Row label={t("Skjult sidefane")} text={t("Når du skjuler sidefanen, kan den bli en tynn rad med ikoner langs kanten, eller bli helt borte. I smale vinduer legger sidefanen seg alltid over innholdet.")}>
          <Segmented<"rail" | "hidden">
            label={t("Skjult sidefane")}
            value={app.settings.sidebarCollapsed ?? "rail"}
            options={[{ value: "rail", label: t("Tynn ikonrad") }, { value: "hidden", label: t("Helt borte") }]}
            onChange={(v) => save({ sidebarCollapsed: v })}
          />
        </Row>
      </Group>
      {/* Round 11 (SPEC 24.2 and 24.3) */}
      <Group title={t("Panelknapper og sidepanel")}>
        <Row label={t("Panelknapper")} text={t("Knappene øverst til høyre. Samlet: ⋯, én knapp for sidepanelet og + for å legge til et panel. Hver for seg: én knapp per panel. I Chat står bare ⋯, fordi Chat ikke har sidepanel.")}>
          <Segmented<"together" | "separate">
            label={t("Panelknapper")}
            value={app.settings.panelButtons ?? "together"}
            options={[{ value: "together", label: t("Samlet") }, { value: "separate", label: t("Hver for seg") }]}
            onChange={(v) => save({ panelButtons: v })}
          />
        </Row>
        <Row label={t("Sidepanel")} text={t("Velg hva panelet viser når det åpnes. Plussknappen åpner alltid startsiden med verktøy.")}>
          <Segmented<"tools" | "tabs">
            label={t("Sidepanel")}
            value={app.settings.panelStart ?? "tools"}
            options={[{ value: "tools", label: t("Startside med verktøy") }, { value: "tabs", label: t("Faner øverst") }]}
            onChange={(v) => save({ panelStart: v })}
          />
        </Row>
        <Row label={t("Faner i sidepanelet")} text={t("Felles topprad viser hver nettleserfane og terminal ved siden av Filer og Endringer. Separate rader samler nettleser og terminal under hver sin verktøyfane. Endring bytter visning uten å lukke øktene.")}>
          <Segmented<"unified" | "grouped"> label={t("Faner i sidepanelet")} value={app.settings.panelTabLayout ?? "unified"} options={[{ value: "unified", label: t("Felles topprad") }, { value: "grouped", label: t("Separate rader") }]} onChange={(v) => save({ panelTabLayout: v })} />
        </Row>
        <Row label={t("Pluss i sidepanelet")} text={t("Velg hva en ny fane skal inneholde. Verktøystartsiden får sin egen fane for hvert trykk. Bare nettleser åpner en ny nettsidefane direkte, uten verktøyfliser.")}>
          <Segmented<"tools" | "browser"> label={t("Pluss i sidepanelet")} value={app.settings.panelNewTab ?? "tools"} options={[{ value: "tools", label: t("Verktøystartside") }, { value: "browser", label: t("Bare nettleser") }]} onChange={(v) => save({ panelNewTab: v })} />
        </Row>
      </Group>
      <Group title={t("Tekst og bevegelse")}>
        <Row label={t("Tekststørrelse")} text={t("Grunnstørrelsen for tekst i hele appen. Vis → Zoom forstørrer alt, også bilder.")}>
          <Choice<number>
            label={t("Tekststørrelse")}
            value={app.settings.uiFontSize ?? 14}
            options={[{ value: 13, label: t("Liten (13 px)") }, { value: 14, label: t("Standard (14 px)") }, { value: 15, label: t("Stor (15 px)") }, { value: 16, label: t("Større (16 px)") }]}
            onChange={(v) => save({ uiFontSize: v })}
          />
        </Row>
        <Row label={t("Tetthet")} text={t("Høyden på rader og knapper i sidefanen, menyene og her.")}>
          <Segmented<Density>
            label={t("Tetthet")}
            value={app.settings.density ?? "normal"}
            options={[{ value: "compact", label: t("Kompakt") }, { value: "normal", label: t("Normal") }, { value: "comfortable", label: t("Luftig") }]}
            onChange={(v) => save({ density: v })}
          />
        </Row>
        <Toggle
          label={t("Reduser bevegelse")}
          text={t("Slår av overganger og animasjoner, også når operativsystemet tillater dem. Står systemet på redusert bevegelse, gjelder det uansett.")}
          checked={app.settings.reduceMotion ?? false}
          onChange={(v) => save({ reduceMotion: v })}
        />
      </Group>
      <Group title={t("Kodevisning")}><Row label={t("Tilpass kodeutseendet")} text={t("Lyst og mørkt kodetema, skrift, linjebryting og standard samtalevisning finnes under Kode.")}><button type="button" class="btn btn-small" onClick={() => setSettingsOpen("code")}>{t("Åpne Kode-innstillinger")}</button></Row></Group>
    </Page>
  );
}

export function Privacy() {
  const [config] = createResource(() => get<GlobalConfig>("/api/config"));
  const archived = createMemo(() => Object.values(app.threads).filter((t) => t?.archived));
  const removeArchived = async () => {
    const list = archived();
    if (!list.length) return;
    const ok = await confirmDialog({
      title: plural(list.length, "Slette {count} arkivert tråd?", "Slette {count} arkiverte tråder?"),
      text: t("Trådene og historikken deres slettes for godt. Filer i prosjektene røres ikke."),
      confirm: t("Slett"),
      danger: true,
    });
    if (!ok) return;
    try {
      for (const thread of list) await deleteThread(thread.id);
      toast(plural(list.length, "Slettet {count} tråd.", "Slettet {count} tråder."), "info");
    } catch (err) {
      report(err);
    }
  };
  return (
    <Page title={t("Personvern og data")} intro={t("Alt appen lagrer, ligger på denne maskinen.")}>
      <Group title={t("Det appen sender")}>
        <Row label={t("Telemetri")} text={t("Appen sender ingen bruksdata, feilrapporter eller statistikk. Tallene under Bruk regnes ut lokalt.")}>
          <span class="pill">{t("Ingen")}</span>
        </Row>
        <Row label={t("Nettverk")} text={t("Serveren lytter bare på 127.0.0.1. Appen kontakter bare leverandørene du kobler til, og sidene som åpnes i Nettleser-panelet.")} />
      </Group>
      <Group title={t("Lagret på denne maskinen")}>
        <Row label={t("API-nøkler og GitHub-token")} text={app.keyring?.legacy ? t("En nøkkelfil fra en eldre versjon finnes fortsatt. Se Modeller og leverandører for status og flytting til nøkkelringen.") : app.keyring?.store === "pending" || !app.keyring ? t("Kontrollerer nøkkelringen. Se Modeller og leverandører for lagringsstatus.") : app.keyring?.store === "session" ? t("Bare i minnet til appen lukkes, fordi nøkkelringen ikke kan brukes nå. Aldri i klartekst på disken. De sendes aldri til nettleseren og skrives aldri til logger.") : t("Kryptert i systemets nøkkelring (GNOME-nøkkelringen), ikke i noen fil i datamappen. De sendes aldri til nettleseren og skrives aldri til logger.")} />
        <Row label={t("Instruksjoner og settings.json")} text={<Rich text={t("I {dir}.")} parts={{ dir: <code>{config()?.dir ?? "…"}</code> }} />} />
      </Group>
      <Group title={t("Slett data")}>
        <Row label={t("Arkiverte tråder")} text={plural(archived().length, "{count} arkivert tråd. Slettes for godt, med historikken.", "{count} arkiverte tråder. Slettes for godt, med historikken.")}>
          <button type="button" class="btn btn-small btn-quiet-danger" disabled={!archived().length} onClick={removeArchived}>{t("Slett alle")}</button>
        </Row>
      </Group>
    </Page>
  );
}
