// Generelt, Utseende and Personvern og data. Kode and Chat are in ./modes.tsx (round 9). Every control here is saved on the server and acts at
// once, except Alltid øverst, which waits for the Electron version and says so.
import { createMemo, createResource, For, Show } from "solid-js";
import type { AccentColor, BusyMessages, CodeFont, Density, EnterKey, GlobalConfig, StartMode, ThemeSetting, TurnNotify } from "../../../../shared/protocol";
import { get } from "../../lib/api";
import { desktop, type CloseBehavior } from "../../lib/desktop";
import { app, deleteThread, report, toast } from "../../state/app";
import { allowNotifications, chime } from "../../state/look";
import { confirmDialog } from "../dialogs";
import { IconPlay } from "../icons";
import { ThemePicker } from "../ThemePicker";
import { AppIconPicker } from "../AppIconPicker";
import { Choice, Group, Page, reset, Row, save, Segmented, Toggle } from "./parts";

const THEMES: Array<{ value: ThemeSetting; label: string }> = [
  { value: "light", label: "Lys" },
  { value: "dark", label: "Mørk" },
  { value: "system", label: "System" },
];

const ACCENTS: Array<{ value: AccentColor; label: string }> = [
  { value: "blue", label: "Blå" },
  { value: "violet", label: "Fiolett" },
  { value: "green", label: "Grønn" },
  { value: "orange", label: "Oransje" },
  { value: "pink", label: "Rosa" },
  { value: "red", label: "Rød" },
  { value: "graphite", label: "Grafitt" },
];

const CODE_FONTS: Array<{ value: CodeFont; label: string }> = [
  { value: "system", label: "Systemets monospace" },
  { value: "ubuntu", label: "Ubuntu Mono" },
  { value: "dejavu", label: "DejaVu Sans Mono" },
  { value: "jetbrains", label: "JetBrains Mono" },
  { value: "fira", label: "Fira Code" },
  { value: "cascadia", label: "Cascadia Code" },
];

export function General() {
  const notifyChoice = async (value: TurnNotify) => {
    if (value !== "off" && !(await allowNotifications())) {
      toast("Nettleseren tillater ikke varsler for denne siden. Varsler kan slås på i nettleserens innstillinger for nettstedet.", "info");
    }
    save({ notifyOnDone: value });
  };
  return (
    <Page title="Generelt">
      <Group title="Oppstart">
        <Row label="Åpne appen i" text="Chat eller Kode når appen starter. Sist brukte husker hvor du var.">
          <Choice<StartMode>
            label="Åpne appen i"
            value={app.settings.startMode ?? "last"}
            options={[{ value: "last", label: "Sist brukte" }, { value: "chat", label: "Chat" }, { value: "code", label: "Kode" }]}
            onChange={(v) => save({ startMode: v })}
          />
        </Row>
      </Group>
      <Group title="Når en tur er ferdig">
        <Row label="Spill av en lyd" text="En kort lyd når agenten er ferdig eller stopper med en feil.">
          <button type="button" class="btn btn-small try-sound" title="Spill av lyden nå" onClick={() => chime()}><IconPlay size={12} />Prøv</button>
          <span class="setting-control-sep" aria-hidden="true" />
          <input type="checkbox" role="switch" class="switch" aria-label="Spill av en lyd" checked={app.settings.soundOnDone ?? false} onChange={(e) => save({ soundOnDone: e.currentTarget.checked })} />
        </Row>
        <Row label="Systemvarsel" text="Et varsel fra nettleseren med navnet på tråden. Nettleseren spør om lov første gang.">
          <Choice<TurnNotify>
            label="Systemvarsel"
            value={app.settings.notifyOnDone ?? "off"}
            options={[{ value: "off", label: "Av" }, { value: "unfocused", label: "Når appen ikke er i fokus" }, { value: "always", label: "Alltid" }]}
            onChange={(v) => void notifyChoice(v)}
          />
        </Row>
        <Toggle
          label="Spør før fanen lukkes"
          text="Nettleseren spør om du vil lukke eller laste siden på nytt mens en tråd kjører. Kjøringen fortsetter på serveren uansett."
          checked={app.settings.confirmQuit ?? false}
          onChange={(v) => save({ confirmQuit: v })}
        />
      </Group>
      <Group title="Samtale">
        <Row label="Enter i meldingsfeltet" text="Enter sender, og Shift+Enter gir ny linje. Eller omvendt: Enter gir ny linje, og Ctrl+Enter sender.">
          <Segmented<EnterKey>
            label="Enter i meldingsfeltet"
            value={app.settings.enterKey ?? "send"}
            options={[{ value: "send", label: "Enter sender" }, { value: "newline", label: "Enter gir ny linje" }]}
            onChange={(v) => save({ enterKey: v })}
          />
        </Row>
        <Toggle
          label="Vis tenkesammendrag"
          text="Viser modellens sammendrag av tenkningen i tråden, når modellen gir et."
          checked={app.settings.thinkingSummary !== false}
          onChange={(v) => save({ thinkingSummary: v })}
        />
        <Toggle
          label="Skallutdata utvidet"
          text="Utdata fra kommandoer i skallet vises utvidet i tråden, ikke sammenlagt."
          checked={app.settings.expandShell === true}
          onChange={(v) => save({ expandShell: v })}
        />
        <Row label="Meldinger mens agenten jobber" text="Kø: meldingen venter til turen er ferdig. Send med en gang: den går inn i turen som kjører, ved neste steg (mellom verktøykall), og modellen kan endre kurs.">
          <Choice<BusyMessages>
            label="Meldinger mens agenten jobber"
            value={app.settings.busyMessages ?? "queue"}
            options={[{ value: "queue", label: "Kø" }, { value: "steer", label: "Send med en gang" }]}
            onChange={(v) => save({ busyMessages: v })}
          />
        </Row>
      </Group>
      <Group title="Vindu">
        <Show when={desktop}>
          <CloseBehaviorRow />
        </Show>
        <Toggle
          label="Alltid øverst"
          demo
          text="Holder vinduet over andre vinduer. Kommer med Electron-versjonen; en nettleserfane kan ikke gjøre dette, så valget lagres bare."
          checked={app.settings.alwaysOnTop ?? false}
          onChange={(v) => save({ alwaysOnTop: v })}
        />
      </Group>
    </Page>
  );
}

// Only in the Electron app (SPEC 29.6). The choice is kept by the app itself, not on the server,
// because the window has to know it at the moment it closes.
function CloseBehaviorRow() {
  const [info, { mutate }] = createResource(() => desktop!.closeBehavior());
  const text = () =>
    info()?.statusArea === false
      ? "Lukk-knappen legger appen i statusfeltet øverst på skjermen, så trådene jobber videre. Statusfeltet er ikke tilgjengelig nå, så Lukk avslutter appen."
      : "Lukk-knappen legger appen i statusfeltet øverst på skjermen, så trådene jobber videre. Ctrl+Q, og Avslutt i statusfeltet, avslutter alltid helt.";
  return (
    <Row label="Når vinduet lukkes" text={text()}>
      <Segmented<CloseBehavior>
        label="Når vinduet lukkes"
        value={info()?.value ?? "tray"}
        options={[{ value: "tray", label: "Legg i statusfeltet" }, { value: "quit", label: "Avslutt" }]}
        onChange={(v) => void desktop!.closeBehavior(v).then((next) => next && mutate(next)).catch(report)}
      />
    </Row>
  );
}

export function Appearance() {
  const layout = () => app.settings.sidebarLayout ?? "standard";
  return (
    <Page title="Utseende">
      <Group title="Tema og farge">
        <Row label="Tema" text="System følger innstillingen i operativsystemet, også mens appen er åpen.">
          <Segmented<ThemeSetting> label="Tema" value={app.settings.theme} options={THEMES} onChange={(v) => save({ theme: v })} />
        </Row>
        <ThemePicker />
        <Row label="Aksentfarge" text="Brytere, fokus, merker og aktivitetskartet.">
          <div class="swatches" role="radiogroup" aria-label="Aksentfarge">
            <For each={ACCENTS}>
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
      {/* Round 14 (SPEC 30.2) */}
      <Group title="Appikon">
        <AppIconPicker />
      </Group>
      <Group title="Sidefane">
        <div class="setting setting-block">
          <span class="muted">Hvordan trådene vises i sidefanen.</span>
          <div class="layout-cards" role="radiogroup" aria-label="Sidefane">
            <button type="button" role="radio" class="layout-card" aria-checked={layout() === "standard"} onClick={() => save({ sidebarLayout: "standard" })}>
              <span class="layout-sketch" data-layout="standard" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              <strong>Standard</strong>
              <span class="muted">Prosjekter og tråder i lister.</span>
            </button>
            <button type="button" role="radio" class="layout-card" aria-checked={layout() === "smart"} onClick={() => save({ sidebarLayout: "smart" })}>
              <span class="layout-sketch" data-layout="smart" aria-hidden="true"><b /><b /><i /><i /><i /></span>
              <strong>Smart</strong>
              <span class="muted">Kort for det som trenger deg, med Jobber, Utsatt og Avsluttet samlet nederst.</span>
            </button>
          </div>
        </div>
        {/* Round 10 (SPEC 23.9) */}
        <Row label="Skjult sidefane" text="Når du skjuler sidefanen, kan den bli en tynn rad med ikoner langs kanten, eller bli helt borte. I smale vinduer legger sidefanen seg alltid over innholdet.">
          <Segmented<"rail" | "hidden">
            label="Skjult sidefane"
            value={app.settings.sidebarCollapsed ?? "rail"}
            options={[{ value: "rail", label: "Tynn ikonrad" }, { value: "hidden", label: "Helt borte" }]}
            onChange={(v) => save({ sidebarCollapsed: v })}
          />
        </Row>
      </Group>
      {/* Round 11 (SPEC 24.2 and 24.3) */}
      <Group title="Panelknapper og sidepanel">
        <Row label="Panelknapper" text="Knappene øverst til høyre. Samlet: ⋯, én knapp for sidepanelet og + for å legge til et panel. Hver for seg: én knapp per panel. I Chat står bare ⋯, fordi Chat ikke har sidepanel.">
          <Segmented<"together" | "separate">
            label="Panelknapper"
            value={app.settings.panelButtons ?? "together"}
            options={[{ value: "together", label: "Samlet" }, { value: "separate", label: "Hver for seg" }]}
            onChange={(v) => save({ panelButtons: v })}
          />
        </Row>
        <Row label="Sidepanel" text="Startside med verktøy viser verktøyene som fliser når panelet åpnes, og navnet på verktøyet øverst fører tilbake dit. Faner øverst er én rad med faner, som før.">
          <Segmented<"tools" | "tabs">
            label="Sidepanel"
            value={app.settings.panelStart ?? "tools"}
            options={[{ value: "tools", label: "Startside med verktøy" }, { value: "tabs", label: "Faner øverst" }]}
            onChange={(v) => save({ panelStart: v })}
          />
        </Row>
      </Group>
      <Group title="Tekst og bevegelse">
        <Row label="Tekststørrelse" text="Grunnstørrelsen for tekst i hele appen. Vis → Zoom forstørrer alt, også bilder.">
          <Choice<number>
            label="Tekststørrelse"
            value={app.settings.uiFontSize ?? 14}
            options={[{ value: 13, label: "Liten (13 px)" }, { value: 14, label: "Standard (14 px)" }, { value: 15, label: "Stor (15 px)" }, { value: 16, label: "Større (16 px)" }]}
            onChange={(v) => save({ uiFontSize: v })}
          />
        </Row>
        <Row label="Tetthet" text="Høyden på rader og knapper i sidefanen, menyene og her.">
          <Segmented<Density>
            label="Tetthet"
            value={app.settings.density ?? "normal"}
            options={[{ value: "compact", label: "Kompakt" }, { value: "normal", label: "Normal" }, { value: "comfortable", label: "Luftig" }]}
            onChange={(v) => save({ density: v })}
          />
        </Row>
        <Toggle
          label="Reduser bevegelse"
          text="Slår av overganger og animasjoner, også når operativsystemet tillater dem. Står systemet på redusert bevegelse, gjelder det uansett."
          checked={app.settings.reduceMotion ?? false}
          onChange={(v) => save({ reduceMotion: v })}
        />
      </Group>
      <Group title="Kode">
        <Row label="Kodeskrift" text="Brukes hvis skriften er installert på maskinen. Ellers brukes systemets monospace.">
          <Choice<CodeFont> label="Kodeskrift" value={app.settings.codeFont ?? "system"} options={CODE_FONTS} onChange={(v) => save({ codeFont: v })} />
        </Row>
        <Row label="Skriftstørrelse for kode" text="Kodeblokker, verktøyutdata, endringer og godkjenningskort.">
          <Choice<number>
            label="Skriftstørrelse for kode"
            value={app.settings.codeFontSize ?? 0}
            options={[{ value: 0, label: "Standard" }, ...[11, 12, 13, 14, 15, 16, 17, 18].map((n) => ({ value: n, label: `${n} px` }))]}
            onChange={(v) => (v === 0 ? reset("codeFontSize") : save({ codeFontSize: v }))}
          />
        </Row>
        <Row label="Tabulatorbredde" text="Hvor bredt et tabulatortegn vises i kode i tråden.">
          <Segmented<number> label="Tabulatorbredde" value={app.settings.tabSize ?? 4} options={[2, 4, 8].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => save({ tabSize: v })} />
        </Row>
        <Toggle
          label="Bryt lange linjer"
          text="Lange linjer i kodeblokker brytes i stedet for å rulle sidelengs."
          checked={app.settings.wrapCode ?? false}
          onChange={(v) => save({ wrapCode: v })}
        />
      </Group>
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
      title: list.length === 1 ? "Slette 1 arkivert tråd?" : `Slette ${list.length} arkiverte tråder?`,
      text: "Trådene og historikken deres slettes for godt. Filer i prosjektene røres ikke.",
      confirm: "Slett",
      danger: true,
    });
    if (!ok) return;
    try {
      for (const thread of list) await deleteThread(thread.id);
      toast(list.length === 1 ? "Slettet 1 tråd." : `Slettet ${list.length} tråder.`, "info");
    } catch (err) {
      report(err);
    }
  };
  return (
    <Page title="Personvern og data" intro="Alt appen lagrer, ligger på denne maskinen.">
      <Group title="Det appen sender">
        <Row label="Telemetri" text="Appen sender ingen bruksdata, feilrapporter eller statistikk. Tallene under Bruk regnes ut lokalt.">
          <span class="pill">Ingen</span>
        </Row>
        <Row label="Nettverk" text="Serveren lytter bare på 127.0.0.1. Appen kontakter bare leverandørene du kobler til, og sidene som åpnes i Nettleser-panelet." />
      </Group>
      <Group title="Lagret på denne maskinen">
        <Row label="API-nøkler og GitHub-token" text={app.keyring?.store === "session" ? "Bare i minnet til appen lukkes, fordi nøkkelringen ikke kan brukes nå. Aldri i klartekst på disken. De sendes aldri til nettleseren og skrives aldri til logger." : "Kryptert i systemets nøkkelring (GNOME-nøkkelringen), ikke i noen fil i datamappen. De sendes aldri til nettleseren og skrives aldri til logger."} />
        <Row label="Instruksjoner og settings.json" text={<>I <code>{config()?.dir ?? "…"}</code>.</>} />
      </Group>
      <Group title="Slett data">
        <Row label="Arkiverte tråder" text={archived().length === 1 ? "1 arkivert tråd. Slettes for godt, med historikken." : `${archived().length} arkiverte tråder. Slettes for godt, med historikken.`}>
          <button type="button" class="btn btn-small btn-quiet-danger" disabled={!archived().length} onClick={removeArchived}>Slett alle</button>
        </Row>
      </Group>
    </Page>
  );
}
