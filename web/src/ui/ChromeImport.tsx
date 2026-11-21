import { language, plural, t } from "../lib/i18n.ts";
// Round 10 (SPEC 23.1): Importer fra Chrome. A dialog where you pick a Chrome or Chromium profile on
// this machine, choose whether history comes too, and see what will be imported before anything
// is. The server reads only Bookmarks and History, and only when this dialog asks; never
// passwords, cookies, cards or sessions. Opened from Innstillinger → Nettleser, from the tip on
// Ny fane and from the Browser panel's ⋯ menu.
import { createEffect, createResource, createSignal, For, on, onMount, Show } from "solid-js";
import type { BrowserImported, ChromeImportPreview, ChromeProfileInfo } from "../../../shared/protocol";
import { del, get, post } from "../lib/api";
import { report, toast } from "../state/app";
import { IconBookmark, IconGlobe, IconShield } from "./icons";
import { IconHistory } from "./nav-icons";
import { chromeImportOpen, setChromeImportOpen } from "./dialog-state";

const [imported, setImported] = createSignal<BrowserImported | null>(null);
let loading: Promise<void> | null = null;
export { imported };

export function loadImported(force = false): Promise<void> {
  if (!loading || force) loading = get<BrowserImported>("/api/browser/imported").then((data) => void setImported(data), () => undefined);
  return loading;
}

export async function removeImported(): Promise<void> {
  try {
    await del("/api/browser/imported");
    setImported({ importedAt: null, source: null, bookmarks: [], history: [] });
    toast(t("Det importerte er fjernet."), "info");
  } catch (err) {
    report(err);
  }
}

// The state is in dialog-state.ts, so the dialog loads only when it opens.
const dialogOpen = chromeImportOpen;
const setDialogOpen = setChromeImportOpen;
export { openChromeImport } from "./dialog-state";

// «nå nettopp», «for 5 min siden», «i dag kl. 14.05» or «3. nov.».
function when(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return t("nå nettopp");
  if (minutes < 60) return t("for {minutes} min siden", { minutes });
  const date = new Date(at);
  if (date.toDateString() === new Date().toDateString()) return t("i dag kl. {time}", { time: date.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" }) });
  return date.toLocaleDateString(language(), { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

// The number is grouped for the active language, so it is passed as {n} and not as plural's own {count}.
const bookmarkCount = (n: number) => plural(n, "{n} bokmerke", "{n} bokmerker", { n: n.toLocaleString(language()) });
const historyCount = (n: number) => plural(n, "{n} side fra historikken", "{n} sider fra historikken", { n: n.toLocaleString(language()) });

export function importedSummary(data: BrowserImported | null): string {
  if (!data?.importedAt) return t("Ingenting er importert ennå.");
  const values = { bookmarks: bookmarkCount(data.bookmarks.length), history: historyCount(data.history.length), source: data.source?.label ?? "Chrome", when: when(data.importedAt) };
  return data.history.length ? t("{bookmarks} og {history} fra {source}, importert {when}.", values) : t("{bookmarks} fra {source}, importert {when}.", values);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ImportDialog() {
  let dialog!: HTMLDialogElement;
  const [profiles] = createResource(() => get<ChromeProfileInfo[]>("/api/browser/chrome-profiles"));
  const [chosen, setChosen] = createSignal<ChromeProfileInfo | null>(null);
  const [withHistory, setWithHistory] = createSignal(false);
  const [preview, setPreview] = createSignal<ChromeImportPreview | null>(null);
  const [previewError, setPreviewError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const close = () => setDialogOpen(false);
  onMount(() => dialog.showModal());

  // The first profile is chosen for you; the preview follows every change.
  createEffect(on(() => profiles(), (list) => {
    if (list?.length && !chosen()) setChosen(list[0]);
  }));
  // A profile without history cannot bring any.
  createEffect(on(chosen, (profile) => {
    if (profile && !profile.history) setWithHistory(false);
  }));
  let seq = 0;
  createEffect(on([chosen, withHistory], ([profile, history]) => {
    setPreview(null);
    setPreviewError("");
    if (!profile) return;
    const mine = ++seq;
    post<ChromeImportPreview>("/api/browser/chrome-import/preview", { browser: profile.browser, profile: profile.profile, history: history && profile.history })
      .then((result) => mine === seq && setPreview(result))
      .catch((err: Error) => mine === seq && setPreviewError(err.message || t("Kunne ikke lese profilen.")));
  }));

  const nothing = () => !!preview() && preview()!.bookmarks === 0 && preview()!.history === 0;
  const run = async () => {
    const profile = chosen();
    if (!profile || busy()) return;
    setBusy(true);
    try {
      const result = await post<{ bookmarks: number; history: number }>("/api/browser/chrome-import", { browser: profile.browser, profile: profile.profile, history: withHistory() && profile.history });
      await loadImported(true);
      const values = { bookmarks: bookmarkCount(result.bookmarks), history: historyCount(result.history) };
      toast(result.history ? t("Importerte {bookmarks} og {history}.", values) : t("Importerte {bookmarks}.", values), "info");
      close();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} class="dialog chrome-import" aria-labelledby="chrome-import-title" onCancel={(e) => { e.preventDefault(); close(); }}>
      <h2 id="chrome-import-title">{t("Importer fra Chrome")}</h2>
      <p class="chrome-import-lead"><IconShield size={14} /><span>{t("Leser bare bokmerker og, hvis du vil, historikk fra profilen du velger. Aldri passord, informasjonskapsler, kort eller økter.")}</span></p>
      <Show when={!profiles.loading} fallback={<p class="muted">{t("Ser etter profiler…")}</p>}>
        <Show when={profiles()?.length} fallback={<p class="chrome-import-none" data-testid="chrome-import-none">{t("Fant ingen Chrome- eller Chromium-profil med bokmerker eller historikk på denne maskinen.")}</p>}>
          <div class="chrome-import-profiles" role="radiogroup" aria-label={t("Profil")}>
            <For each={profiles()}>
              {(profile) => (
                <button
                  type="button"
                  role="radio"
                  class="chrome-import-profile"
                  aria-checked={chosen() === profile}
                  onClick={() => setChosen(profile)}
                >
                  <IconGlobe size={15} />
                  <span class="chrome-import-profile-text">
                    <span class="chrome-import-profile-name">{profile.label}</span>
                    <span class="muted">{[profile.bookmarks && t("Bokmerker"), profile.history && t("Historikk")].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              )}
            </For>
          </div>
          <label class="chrome-import-check" classList={{ disabled: !chosen()?.history }}>
            <input type="checkbox" checked={withHistory()} disabled={!chosen()?.history} onChange={(e) => setWithHistory(e.currentTarget.checked)} />
            <span>{t("Ta med historikken")} <span class="muted">{t("(de siste 1 000 sidene)")}</span></span>
          </label>
          <div class="chrome-import-preview" data-testid="chrome-import-preview" aria-live="polite">
            <Show when={!previewError()} fallback={<p class="chrome-import-error">{previewError()}</p>}>
              <Show when={preview()} fallback={<p class="muted">{t("Leser profilen…")}</p>}>
                {(p) => (
                  <>
                    <p class="chrome-import-counts">
                      <strong>{t("Blir importert:")}</strong>{" "}
                      {withHistory()
                        ? t("{bookmarks} og {history}.", { bookmarks: bookmarkCount(p().bookmarks), history: historyCount(p().history) })
                        : t("{bookmarks}.", { bookmarks: bookmarkCount(p().bookmarks) })}
                    </p>
                    <ul class="chrome-import-sample">
                      <For each={p().sampleBookmarks}>
                        {(b) => <li><IconBookmark size={13} /><span class="chrome-import-title">{b.title}</span><span class="muted">{hostOf(b.url)}</span></li>}
                      </For>
                      <Show when={withHistory()}>
                        <For each={p().sampleHistory}>
                          {(v) => <li><IconHistory size={13} /><span class="chrome-import-title">{v.title}</span><span class="muted">{hostOf(v.url)}</span></li>}
                        </For>
                      </Show>
                    </ul>
                    <Show when={imported()?.importedAt}><p class="muted chrome-import-replace">{t("Erstatter det du importerte {when}.", { when: when(imported()!.importedAt!) })}</p></Show>
                  </>
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </Show>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={close}>{t("Avbryt")}</button>
        <button type="button" class="btn btn-primary" disabled={!preview() || nothing() || busy()} onClick={() => void run()}>{busy() ? t("Importerer…") : t("Importer")}</button>
      </div>
    </dialog>
  );
}

export function ChromeImportHost() {
  return <Show when={dialogOpen()}><ImportDialog /></Show>;
}
