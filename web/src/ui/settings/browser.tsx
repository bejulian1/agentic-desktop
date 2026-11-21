import { t } from "../../lib/i18n";
import { createEffect, createSignal, Show } from "solid-js";
import {
  BROWSER_ZOOMS,
  SEARCH_ENGINES,
  searchEngineOf,
  type OpenLinksIn,
  type SearchEngineId,
  type ThemeSetting,
} from "../../../../shared/protocol";
import { patch } from "../../lib/api";
import { app, setApp } from "../../state/app";
import { DownloadDirRow } from "../DownloadsList";
import { imported, importedSummary, loadImported, openChromeImport, removeImported } from "../ChromeImport";
import { CookieSettings } from "../CookieImport";
import { IconBookmark, IconChevronDown, IconGlobe, IconShield } from "../icons";
import { Choice, Group, Page, Row, save, Toggle } from "./parts";

const LINK_TARGETS = (): Array<{ value: OpenLinksIn; label: string }> => [
  { value: "app", label: t("Agentic Desktop-nettleseren") },
  { value: "system", label: t("Standardnettleseren din") },
];

const SEARCH_OPTIONS = (): Array<{ value: SearchEngineId; label: string }> => [
  ...SEARCH_ENGINES.map((engine) => ({ value: engine.id as SearchEngineId, label: engine.label })),
  { value: "custom", label: t("Egendefinert") },
];

const ZOOM_OPTIONS = (): Array<{ value: number; label: string }> =>
  BROWSER_ZOOMS.map((zoom) => ({ value: zoom, label: `${Math.round(zoom * 100)} %` }));

const APPEARANCE_OPTIONS = (): Array<{ value: ThemeSetting; label: string }> => [
  { value: "system", label: t("System") },
  { value: "light", label: t("Lys") },
  { value: "dark", label: t("Mørk") },
];

export function BrowserPage(props: { target?: string | null }) {
  void loadImported(true);
  const engine = () => searchEngineOf(app.settings);
  const [customUrl, setCustomUrl] = createSignal(engine() === "custom" ? (app.settings.webSearchUrl ?? "") : "");
  const [urlError, setUrlError] = createSignal("");
  const [advancedOpen, setAdvancedOpen] = createSignal(false);

  createEffect(() => {
    const label = props.target;
    if (label && (label === t("Standard nettleserzoom") || label === t("Standard utseende i nettleseren") || label === "Standard nettleserzoom" || label === "Standard utseende i nettleseren")) {
      setAdvancedOpen(true);
    }
  });

  createEffect(() => {
    if (engine() === "custom" && app.settings.webSearchUrl) {
      setCustomUrl(app.settings.webSearchUrl);
    }
  });

  const chooseEngine = (next: SearchEngineId) => {
    setUrlError("");
    if (next === "custom") {
      setApp("settings", "searchEngine", "custom");
      if (SEARCH_ENGINES.some((e) => e.url === app.settings.webSearchUrl)) setCustomUrl("");
      else setCustomUrl(app.settings.webSearchUrl ?? "");
      return;
    }
    save({ searchEngine: next });
  };

  const commitCustomUrl = async () => {
    const next = customUrl().trim();
    if (!next) {
      setUrlError(t("Skriv inn en søke-adresse med {placeholder}, for eksempel https://eksempel.no/sok?q={placeholder}", { placeholder: "{q}" }));
      return;
    }
    try {
      const updated = await patch<typeof app.settings>("/api/settings", { searchEngine: "custom", webSearchUrl: next });
      setApp("settings", updated);
      setUrlError("");
    } catch (err) {
      setUrlError((err as Error).message.replace(/^\d{3}\s*/, ""));
    }
  };

  return (
    <Page title={t("Nettleser")} intro={t("Nettleser-panelet og agentens nettleserverktøy bruker en egen Chrome som kjører usynlig, med en egen profil i datamappen.")}>
      <Group>
        <Toggle
          label={t("Agenttilgang til nettleseren")}
          text={t("La agenter bruke den delte nettleseren. Prosjekter kan overstyre dette i Rediger prosjekt → Agent.")}
          checked={app.settings.agentBrowserAccess !== false}
          onChange={(agentBrowserAccess) => save({ agentBrowserAccess })}
        />
      </Group>
      <Group title={t("Surfing")}>
        <Row
          label={t("Åpne lenker i")}
          text={t("Hvor lenker i meldinger og terminalen åpnes. Hold Ctrl eller Cmd mens du klikker for å alltid åpne i standardnettleseren.")}
        >
          <Choice<OpenLinksIn>
            label={t("Åpne lenker i")}
            value={app.settings.openLinksIn ?? "system"}
            options={LINK_TARGETS()}
            onChange={(openLinksIn) => save({ openLinksIn })}
          />
        </Row>
        <Row
          label={t("Søkemotor")}
          text={t("Hva adressefeltet i nettleserpanelet søker med når du skriver noe som ikke er en adresse. Brukes også for modellens nettsøk når modellen ikke har eget søk.")}
        >
          <Choice<SearchEngineId>
            label={t("Søkemotor")}
            value={engine()}
            options={SEARCH_OPTIONS()}
            onChange={chooseEngine}
          />
        </Row>
        <Show when={engine() === "custom"}>
          <div class="setting setting-block search-url-row">
            <div class="setting-text">
              <strong>{t("Egendefinert søke-adresse")}</strong>
              <span class="muted">{t("Skriv {placeholder} der søkeordene skal stå, for eksempel https://eksempel.no/sok?q={placeholder}", { placeholder: "{q}" })}</span>
            </div>
            <div class="search-url-input-row">
              <input
                class="input"
                aria-label={t("Egendefinert søke-adresse")}
                placeholder="https://eksempel.no/sok?q={q}"
                spellcheck={false}
                value={customUrl()}
                onInput={(e) => setCustomUrl(e.currentTarget.value)}
                onBlur={() => void commitCustomUrl()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitCustomUrl();
                }}
              />
              <button type="button" class="btn btn-small" onClick={() => void commitCustomUrl()}>{t("Lagre")}</button>
            </div>
            <Show when={urlError()}><p class="field-error" role="alert">{urlError()}</p></Show>
          </div>
        </Show>
        <button
          type="button"
          class="setting settings-advanced-toggle"
          data-testid="browser-advanced-toggle"
          aria-expanded={advancedOpen()}
          onClick={() => setAdvancedOpen(!advancedOpen())}
        >
          <span class="settings-advanced-chevron" classList={{ open: advancedOpen() }} aria-hidden="true"><IconChevronDown size={13} /></span>
          <span>{t("Avansert")}</span>
        </button>
        <Show when={advancedOpen()}>
          <Row
            label={t("Standard nettleserzoom")}
            text={t("Sidezoom som brukes for nye nettleserfaner og prosjekter uten eget zoomvalg.")}
          >
            <Choice<number>
              label={t("Standard nettleserzoom")}
              value={app.settings.browserDefaultZoom ?? 1}
              options={ZOOM_OPTIONS()}
              onChange={(browserDefaultZoom) => save({ browserDefaultZoom })}
            />
          </Row>
          <Row
            label={t("Standard utseende i nettleseren")}
            text={t("Fargetemaet nettsider bes om å foretrekke. System følger operativsystemet.")}
          >
            <Choice<ThemeSetting>
              label={t("Standard utseende i nettleseren")}
              value={app.settings.browserAppearance ?? "system"}
              options={APPEARANCE_OPTIONS()}
              onChange={(browserAppearance) => save({ browserAppearance })}
            />
          </Row>
        </Show>
      </Group>
      <CookieSettings />
      <Group title={t("Nedlastinger")}>
        <DownloadDirRow />
      </Group>
      <Group title={t("Chrome")}>
        <Row label={t("Kjører headless")} text={t("Startes ved første bruk og lukkes når ingen tråd har brukt den på en stund. Du og agenten ser samme side.")} icon={IconGlobe} />
        <Row label={t("Egen profil")} text={t("Informasjonskapsler og innlogging deles mellom prosjektene. Nettleseren din på maskinen får aldri noe herfra, og gir bare det du selv importerer.")} icon={IconShield} />
        <Row label={t("Playtest")} text={t("Starter dev- eller start-skriptet i package.json på en egen port, eller serverer index.html. Knappen ligger øverst til høyre i Kode.")} />
      </Group>
      <Group title={t("Importer fra Chrome")}>
        <Row label={t("Bokmerker og historikk")} icon={IconBookmark} text={<span data-testid="chrome-import-status">{importedSummary(imported())} {t("Her leses bare bokmerker og historikk, aldri passord, kort eller økter.")}</span>}>
          <Show when={imported()?.importedAt}>
            <button type="button" class="btn btn-small btn-quiet" onClick={() => void removeImported()}>{t("Fjern")}</button>
          </Show>
          <button type="button" class="btn btn-small" onClick={openChromeImport}>{t("Importer…")}</button>
        </Row>
      </Group>
    </Page>
  );
}
