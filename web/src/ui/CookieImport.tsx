import { language, plural, t } from "../lib/i18n.ts";
// Round 12 (SPEC 26.4): Forbli innlogget på nettstedene dine. Cookies from Chrome, Chromium or Firefox
// on this machine into the app's own Browser panel, so the user is signed in there too.
//
// The dialog: three promises first, then three steps: pick a browser profile, pick sites (search
// and Velg alle, nothing chosen beforehand), see the summary and import. The server reads only the
// chosen profile's cookie database, and only when asked (server/src/cookie-import.ts).
//
// Opened from Innstillinger → Nettleser at any time. The first time the Browser panel opens it is
// offered once, until the user chooses something: offerCookieImport() below is ready for that and
// is not wired to the panel yet (round 12, part B).
import { createEffect, createMemo, createResource, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import type { CookieImportResult, CookieProfileInfo, CookieSiteList, ImportedCookieSite } from "../../../shared/protocol";
import { del, get, post } from "../lib/api";
import { app, report, saveSettings, toast } from "../state/app";
import { confirmDialog } from "./dialogs";
import { IconCheck, IconGlobe, IconSearch, IconShieldCheck, IconTrash, IconWarn } from "./icons";
import { Group, Rich, Row } from "./settings/parts";
import { cookieDialog, openCookieImport, setCookieDialog } from "./dialog-state";
import { IconCookie } from "./nav-icons";
import "../styles/cookies.css";

// The icon is in nav-icons.tsx, so the command palette can show it without loading this file.
export { IconCookie };

const n = (value: number) => value.toLocaleString(language());
// The number is grouped for the active language, so it is passed as {n} and not as plural's own {count}.
const cookieCount = (value: number) => plural(value, "{n} informasjonskapsel", "{n} informasjonskapsler", { n: n(value) });
const siteCount = (value: number) => plural(value, "{n} nettsted", "{n} nettsteder", { n: n(value) });

// «i dag», «i går», «for 3 dager siden», «for 2 måneder siden».
export function since(at: number | null): string {
  if (!at) return "";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return t("i dag");
  if (days === 1) return t("i går");
  if (days < 30) return plural(days, "for {count} dag siden", "for {count} dager siden");
  const months = Math.floor(days / 30);
  if (months < 12) return plural(months, "for en måned siden", "for {count} måneder siden");
  const years = Math.floor(months / 12);
  return plural(years, "for ett år siden", "for {count} år siden");
}

// What has been imported, per site, for Innstillinger → Nettleser and the agent's check.
const [importedSites, setImportedSites] = createSignal<ImportedCookieSite[] | null>(null);
export { importedSites };
export function loadImportedSites(): Promise<void> {
  return get<ImportedCookieSite[]>("/api/browser/cookies").then((list) => void setImportedSites(list), () => undefined);
}

export async function forgetSite(site: string): Promise<void> {
  try {
    await del(`/api/browser/cookies/${encodeURIComponent(site)}`);
    setImportedSites((list) => list?.filter((s) => s.site !== site) ?? null);
    toast(t("Glemte informasjonskapslene for {site}.", { site }), "info");
  } catch (err) {
    report(err);
  }
}

export async function forgetAllCookies(): Promise<void> {
  const total = importedSites()?.length ?? 0;
  const ok = await confirmDialog({
    title: t("Glemme importerte informasjonskapsler?"),
    text: plural(total, "Nettleserpanelet logges ut av {n} nettsted du har importert. Nettleseren din på maskinen røres ikke.", "Nettleserpanelet logges ut av {n} nettsteder du har importert. Nettleseren din på maskinen røres ikke.", { n: n(total) }),
    confirm: t("Glem"),
    danger: true,
  });
  if (!ok) return;
  try {
    await del("/api/browser/cookies");
    setImportedSites([]);
    toast(t("De importerte informasjonskapslene er glemt."), "info");
  } catch (err) {
    report(err);
  }
}

// The dialog, from Innstillinger (always) or the first time the Browser panel opens (firstRun).
// The state is in dialog-state.ts, so the dialog loads only when it opens.
const dialog = cookieDialog;
const setDialog = setCookieDialog;
export { openCookieImport };

// «Ikke nå» holds for this session; «Ikke vis igjen» and an import are kept in the settings.
const [notNow, setNotNow] = createSignal(false);
export const shouldOfferCookieImport = () => !app.settings.cookieOffer && !notNow() && !dialog();

// For the Browser panel (round 12, part B): call when the panel opens. Shows the dialog once, if
// it has not been answered and there is a browser profile to import from. True when it opened.
export async function offerCookieImport(): Promise<boolean> {
  if (!shouldOfferCookieImport()) return false;
  const profiles = await get<CookieProfileInfo[]>("/api/browser/cookie-profiles").catch(() => []);
  if (!profiles.length || !shouldOfferCookieImport()) return false;
  setDialog({ firstRun: true });
  return true;
}

type Step = "intro" | "profile" | "sites" | "summary" | "done";
const STEP_NUMBER: Partial<Record<Step, number>> = { profile: 1, sites: 2, summary: 3 };

function CookieDialog(props: { firstRun: boolean }) {
  let element!: HTMLDialogElement;
  let search: HTMLInputElement | undefined;
  const [step, setStep] = createSignal<Step>("intro");
  const [profiles] = createResource(() => get<CookieProfileInfo[]>("/api/browser/cookie-profiles"));
  const [profile, setProfile] = createSignal<CookieProfileInfo | null>(null);
  const [list, setList] = createSignal<CookieSiteList | null>(null);
  const [listError, setListError] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [chosen, setChosen] = createSignal<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<CookieImportResult | null>(null);
  const close = () => setDialog(null);
  onMount(() => element.showModal());

  const later = () => {
    setNotNow(true);
    close();
  };
  const never = () => {
    saveSettings({ cookieOffer: "never" }).catch(report);
    close();
  };

  const start = () => {
    const found = profiles();
    if (!profile() && found?.length) setProfile(found[0]);
    setStep("profile");
  };

  // The sites of the chosen profile: names and counts only, nothing is decrypted yet.
  let seq = 0;
  const loadSites = async () => {
    const chosenProfile = profile();
    if (!chosenProfile) return;
    const mine = ++seq;
    if (list()?.source.browser !== chosenProfile.browser || list()?.source.profile !== chosenProfile.profile) {
      setList(null);
      setChosen(new Set<string>());
      setQuery("");
    }
    setListError("");
    setStep("sites");
    try {
      const sites = await post<CookieSiteList>("/api/browser/cookie-sites", { browser: chosenProfile.browser, profile: chosenProfile.profile });
      if (mine === seq) setList(sites);
      requestAnimationFrame(() => search?.focus());
    } catch (err) {
      if (mine === seq) setListError((err as Error).message || t("Kunne ikke lese profilen."));
    }
  };

  const visible = createMemo(() => {
    const q = query().trim().toLocaleLowerCase("nb");
    const sites = list()?.sites ?? [];
    return q ? sites.filter((s) => s.site.includes(q)) : sites;
  });
  const allVisibleChosen = () => visible().length > 0 && visible().every((s) => chosen().has(s.site));
  const someVisibleChosen = () => visible().some((s) => chosen().has(s.site));
  const toggle = (site: string) => {
    const next = new Set(chosen());
    if (next.has(site)) next.delete(site);
    else next.add(site);
    setChosen(next);
  };
  const toggleAll = () => {
    const next = new Set(chosen());
    const all = allVisibleChosen();
    for (const s of visible()) {
      if (all) next.delete(s.site);
      else next.add(s.site);
    }
    setChosen(next);
  };
  const chosenSites = createMemo(() => (list()?.sites ?? []).filter((s) => chosen().has(s.site)));
  const chosenCookies = () => chosenSites().reduce((sum, s) => sum + s.cookies, 0);

  const run = async () => {
    const source = list()?.source;
    if (!source || busy() || !chosen().size) return;
    setBusy(true);
    try {
      const done = await post<CookieImportResult>("/api/browser/cookie-import", { browser: source.browser, profile: source.profile, sites: [...chosen()] });
      setResult(done);
      setStep("done");
      if (app.settings.cookieOffer !== "done") saveSettings({ cookieOffer: "done" }).catch(() => undefined);
      void loadImportedSites();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const keyring = () => list()?.keyring ?? "not-needed";
  const browserName = () => (profile()?.browser === "chromium" ? "Chromium" : "Chrome");

  return (
    <dialog
      ref={element}
      class="dialog cookie-dialog"
      aria-labelledby="cookie-title"
      data-testid="cookie-dialog"
      data-step={step()}
      onCancel={(e) => {
        e.preventDefault();
        if (step() === "intro" && props.firstRun) later();
        else close();
      }}
    >
      <Switch>
        <Match when={step() === "intro"}>
          <div class="cookie-intro cookie-step">
            <div class="cookie-badge" aria-hidden="true"><IconCookie size={22} /></div>
            <h2 id="cookie-title">{t("Forbli innlogget på nettstedene dine")}</h2>
            <p class="cookie-lead">{t("Importer informasjonskapsler fra nettleseren din, slik at du er logget inn når nettstedene dine åpnes i nettleserpanelet, her og i alle tråder.")}</p>
            <ul class="cookie-promises">
              <li><IconCheckCircle />{t("Bare informasjonskapsler og nettstedsdata. Passord importeres ikke.")}</li>
              <li><IconCheckCircle />{t("Du velger nettstedene.")}</li>
              <li><IconCheckCircle />{t("Ingenting forlater denne datamaskinen.")}</li>
            </ul>
            <div class="cookie-actions">
              <Show when={props.firstRun}>
                <button type="button" class="cookie-never" onClick={never}>{t("Ikke vis igjen")}</button>
              </Show>
              <span class="cookie-spacer" />
              <button type="button" class="btn" onClick={() => (props.firstRun ? later() : close())}>{t("Ikke nå")}</button>
              <button type="button" class="btn btn-primary" disabled={profiles.loading} onClick={start}>{t("Importer informasjonskapsler")}</button>
            </div>
          </div>
        </Match>

        <Match when={step() === "profile"}>
          <div class="cookie-step">
            <StepHead step={step()} title={t("Velg nettleserprofil")} />
            <Show when={profiles()?.length} fallback={<p class="cookie-empty" data-testid="cookie-no-profiles">{t("Fant ingen profil fra Chrome, Chromium eller Firefox med informasjonskapsler på denne maskinen.")}</p>}>
              <div class="cookie-profiles" role="radiogroup" aria-label={t("Nettleserprofil")}>
                <For each={profiles()}>
                  {(p) => (
                    <button type="button" role="radio" class="cookie-profile" aria-checked={profile()?.browser === p.browser && profile()?.profile === p.profile} onClick={() => setProfile(p)} onDblClick={() => { setProfile(p); void loadSites(); }}>
                      <span class="cookie-profile-icon"><IconGlobe size={15} /></span>
                      <span class="cookie-profile-name">{p.label}</span>
                      <span class="cookie-radio" aria-hidden="true" />
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <p class="cookie-note"><IconShieldCheck size={14} /><span>{t("Bare databasen med informasjonskapsler i profilen leses. Passord, kort og autofyll åpnes aldri.")}</span></p>
            <div class="cookie-actions">
              <button type="button" class="btn" onClick={() => setStep("intro")}>{t("Tilbake")}</button>
              <span class="cookie-spacer" />
              <button type="button" class="btn btn-primary" disabled={!profile()} onClick={() => void loadSites()}>{t("Neste")}</button>
            </div>
          </div>
        </Match>

        <Match when={step() === "sites"}>
          <div class="cookie-step">
            <StepHead step={step()} title={t("Velg nettsteder")} detail={list()?.source.label ?? profile()?.label} />
            <div class="cookie-toolbar">
              <label class="cookie-search">
                <IconSearch size={14} />
                <input ref={search} class="search-input" type="search" placeholder={t("Søk etter nettsted")} aria-label={t("Søk etter nettsted")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} autocomplete="off" spellcheck={false} />
              </label>
              <label class="cookie-all" classList={{ disabled: !visible().length }}>
                <input type="checkbox" checked={allVisibleChosen()} ref={(el) => createEffect(() => (el.indeterminate = !allVisibleChosen() && someVisibleChosen()))} disabled={!visible().length} onChange={toggleAll} />
                <span>{query().trim() ? t("Velg alle treff") : t("Velg alle")}</span>
              </label>
            </div>
            <div class="cookie-sites" role="group" aria-label={t("Nettsteder")} data-testid="cookie-sites">
              <Show when={!listError()} fallback={<p class="cookie-error" role="alert">{listError()}</p>}>
                <Show when={list()} fallback={<div class="cookie-loading" role="status">{t("Leser profilen…")}</div>}>
                  <Show when={visible().length} fallback={<p class="cookie-empty">{query().trim() ? t("Ingen nettsteder med «{query}».", { query: query().trim() }) : t("Profilen har ingen informasjonskapsler som gjelder nå.")}</p>}>
                    <For each={visible()}>
                      {(s) => (
                        <label class="cookie-site" classList={{ chosen: chosen().has(s.site) }}>
                          <input type="checkbox" checked={chosen().has(s.site)} onChange={() => toggle(s.site)} />
                          <span class="cookie-site-name">{s.site}</span>
                          <span class="cookie-site-meta">{s.lastUsed ? t("{cookies} · brukt {when}", { cookies: cookieCount(s.cookies), when: since(s.lastUsed) }) : cookieCount(s.cookies)}</span>
                        </label>
                      )}
                    </For>
                  </Show>
                </Show>
              </Show>
            </div>
            <Show when={keyring() === "missing"}>
              <p class="cookie-warning" role="note" data-testid="cookie-keyring-missing"><IconWarn size={14} /><span><Rich text={t("{browser} låser informasjonskapslene med en nøkkel i systemets nøkkelring, men {tool} finnes ikke på maskinen. De som er låst slik, kan ikke importeres. Pakken heter {package}.", { browser: browserName() })} parts={{ tool: <code>secret-tool</code>, package: <code>libsecret-tools</code> }} /></span></p>
            </Show>
            <div class="cookie-actions">
              <button type="button" class="btn" onClick={() => setStep("profile")}>{t("Tilbake")}</button>
              <span class="cookie-count" aria-live="polite">{chosen().size ? plural(chosen().size, "{n} nettsted valgt", "{n} nettsteder valgt", { n: n(chosen().size) }) : t("Ingen valgt")}</span>
              <button type="button" class="btn btn-primary" disabled={!chosen().size} onClick={() => setStep("summary")}>{t("Neste")}</button>
            </div>
          </div>
        </Match>

        <Match when={step() === "summary"}>
          <div class="cookie-step">
            <StepHead step={step()} title={t("Se over og importer")} />
            <div class="cookie-summary" data-testid="cookie-summary">
              <p class="cookie-summary-line"><Rich text={t("{cookies} fra {sites} i {source}.", { sites: siteCount(chosenSites().length), source: list()?.source.label ?? "" })} parts={{ cookies: <strong>{cookieCount(chosenCookies())}</strong> }} /></p>
              <ul class="cookie-chosen">
                <For each={chosenSites()}>{(s) => <li><span class="cookie-site-name">{s.site}</span><span class="cookie-site-meta">{n(s.cookies)}</span></li>}</For>
              </ul>
            </div>
            <ul class="cookie-facts">
              <li><IconShieldCheck size={14} /><span>{t("Lagres bare i appens egen nettleserprofil, i datamappen. Du kan glemme dem igjen i Innstillinger → Nettleser.")}</span></li>
              <Show when={keyring() === "needed"}>
                <li><IconShieldCheck size={14} /><span><Rich text={t("{browser} låser informasjonskapslene med en nøkkel i systemets nøkkelring. Nøkkelen hentes med {tool} når du trykker Importer, og brukes bare til dette.", { browser: browserName() })} parts={{ tool: <code>secret-tool</code> }} /></span></li>
              </Show>
              <Show when={keyring() === "missing"}>
                <li class="warn"><IconWarn size={14} /><span><Rich text={t("Uten {tool} kan ikke informasjonskapsler som er låst med nøkkelringen, leses. Resten importeres.")} parts={{ tool: <code>secret-tool</code> }} /></span></li>
              </Show>
              <Show when={app.settings.browserAskSignedIn !== false}>
                <li><IconShieldCheck size={14} /><span>{t("Agenter spør før de bruker et nettsted du er innlogget på.")}</span></li>
              </Show>
            </ul>
            <div class="cookie-actions">
              <button type="button" class="btn" disabled={busy()} onClick={() => setStep("sites")}>{t("Tilbake")}</button>
              <span class="cookie-spacer" />
              <button type="button" class="btn btn-primary" disabled={busy()} onClick={() => void run()}>{busy() ? t("Importerer…") : t("Importer")}</button>
            </div>
          </div>
        </Match>

        <Match when={step() === "done" && result()}>
          {(done) => (
            <div class="cookie-intro cookie-step" data-testid="cookie-done">
              <div class="cookie-badge ok" aria-hidden="true"><IconCheck size={22} /></div>
              <h2 id="cookie-title">{t("Du er logget inn")}</h2>
              <p class="cookie-lead">{t("Importerte {cookies} fra {sites}. De gjelder i nettleserpanelet fra nå av.", { cookies: cookieCount(done().cookies), sites: siteCount(done().sites) })}</p>
              <Show when={done().skipped}>
                <p class="cookie-warning"><IconWarn size={14} /><span>{done().keyringMissing
                  ? plural(done().skipped, "{n} informasjonskapsel kunne ikke låses opp uten nøkkelen fra nøkkelringen, og ble hoppet over.", "{n} informasjonskapsler kunne ikke låses opp uten nøkkelen fra nøkkelringen, og ble hoppet over.", { n: n(done().skipped) })
                  : plural(done().skipped, "{n} informasjonskapsel kunne ikke leses eller ble avvist av nettleseren, og ble hoppet over.", "{n} informasjonskapsler kunne ikke leses eller ble avvist av nettleseren, og ble hoppet over.", { n: n(done().skipped) })}</span></p>
              </Show>
              <div class="cookie-actions">
                <span class="cookie-spacer" />
                <button type="button" class="btn btn-primary" onClick={close}>{t("Ferdig")}</button>
              </div>
            </div>
          )}
        </Match>
      </Switch>
    </dialog>
  );
}

function StepHead(props: { step: Step; title: string; detail?: string }) {
  return (
    <div class="cookie-head">
      <span class="cookie-steps" aria-label={t("Steg {step} av 3", { step: STEP_NUMBER[props.step] ?? 0 })}>
        <For each={[1, 2, 3]}>{(i) => <span class="cookie-dot" classList={{ on: i <= (STEP_NUMBER[props.step] ?? 0) }} aria-hidden="true" />}</For>
      </span>
      <h2 id="cookie-title">{props.title}</h2>
      <Show when={props.detail}><span class="cookie-head-detail">{props.detail}</span></Show>
    </div>
  );
}

const IconCheckCircle = () => (
  <svg class="icon cookie-check" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" /><path d="m5.6 8.2 1.7 1.7 3.2-3.4" />
  </svg>
);

export function CookieImportHost() {
  return <Show when={dialog()} keyed>{(d) => <CookieDialog firstRun={d.firstRun} />}</Show>;
}

// Innstillinger → Nettleser: import, the agents' choice, and what has been imported, per site.
export function CookieSettings() {
  void loadImportedSites();
  const sites = () => importedSites() ?? [];
  return (
    <>
      <Group title={t("Informasjonskapsler")}>
        <Row label={t("Forbli innlogget på nettstedene dine")} icon={IconCookie} text={t("Importer informasjonskapsler fra Chrome, Chromium eller Firefox på denne maskinen. Bare informasjonskapsler, aldri passord, og bare nettstedene du velger.")}>
          <button type="button" class="btn btn-small" data-testid="cookie-import-open" onClick={openCookieImport}>{t("Importer…")}</button>
        </Row>
        <Row as="label" label={t("Spør før agenter bruker innloggede nettsteder")} icon={IconShieldCheck} text={t("Vil en agent åpne, lese eller klikke på et nettsted du er innlogget på, spør appen først. Et ja gjelder nettstedet resten av tråden.")}>
          <input type="checkbox" role="switch" class="switch" aria-label={t("Spør før agenter bruker innloggede nettsteder")} checked={app.settings.browserAskSignedIn !== false} onChange={(e) => void saveSettings({ browserAskSignedIn: e.currentTarget.checked }).catch(report)} />
        </Row>
      </Group>
      <Show when={sites().length}>
        <Group
          title={t("Importerte nettsteder")}
          action={<button type="button" class="btn btn-small btn-quiet btn-quiet-danger" data-testid="cookie-forget-all" onClick={() => void forgetAllCookies()}>{t("Glem importerte informasjonskapsler")}</button>}
        >
          <ul class="cookie-imported" aria-label={t("Importerte nettsteder")} data-testid="cookie-imported">
            <For each={sites()}>
              {(s) => (
                <li class="setting cookie-imported-row">
                  <span class="cookie-favicon" aria-hidden="true">{s.site.slice(0, 1).toUpperCase()}</span>
                  <div class="setting-text">
                    <strong>{s.site}</strong>
                    <span class="muted">{t("{cookies} fra {source}, importert {when}", { cookies: cookieCount(s.cookies), source: s.source, when: since(s.importedAt) })}</span>
                  </div>
                  <div class="setting-control">
                    <button type="button" class="icon-button" title={t("Glem {site}", { site: s.site })} aria-label={t("Glem informasjonskapslene for {site}", { site: s.site })} onClick={() => void forgetSite(s.site)}><IconTrash size={15} /></button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Group>
      </Show>
    </>
  );
}
