import { language } from "../lib/i18n.ts";
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
    toast("Det importerte er fjernet.", "info");
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
  if (minutes < 1) return "nå nettopp";
  if (minutes < 60) return `for ${minutes} min siden`;
  const date = new Date(at);
  if (date.toDateString() === new Date().toDateString()) return `i dag kl. ${date.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString(language(), { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString(language())} ${n === 1 ? one : many}`;

export function importedSummary(data: BrowserImported | null): string {
  if (!data?.importedAt) return "Ingenting er importert ennå.";
  const parts = [count(data.bookmarks.length, "bokmerke", "bokmerker")];
  if (data.history.length) parts.push(count(data.history.length, "side fra historikken", "sider fra historikken"));
  return `${parts.join(" og ")} fra ${data.source?.label ?? "Chrome"}, importert ${when(data.importedAt)}.`;
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
      .catch((err: Error) => mine === seq && setPreviewError(err.message || "Kunne ikke lese profilen."));
  }));

  const nothing = () => !!preview() && preview()!.bookmarks === 0 && preview()!.history === 0;
  const run = async () => {
    const profile = chosen();
    if (!profile || busy()) return;
    setBusy(true);
    try {
      const result = await post<{ bookmarks: number; history: number }>("/api/browser/chrome-import", { browser: profile.browser, profile: profile.profile, history: withHistory() && profile.history });
      await loadImported(true);
      const parts = [count(result.bookmarks, "bokmerke", "bokmerker")];
      if (result.history) parts.push(count(result.history, "side", "sider") + " fra historikken");
      toast(`Importerte ${parts.join(" og ")}.`, "info");
      close();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} class="dialog chrome-import" aria-labelledby="chrome-import-title" onCancel={(e) => { e.preventDefault(); close(); }}>
      <h2 id="chrome-import-title">Importer fra Chrome</h2>
      <p class="chrome-import-lead"><IconShield size={14} /><span>Leser bare bokmerker og, hvis du vil, historikk fra profilen du velger. Aldri passord, informasjonskapsler, kort eller økter.</span></p>
      <Show when={!profiles.loading} fallback={<p class="muted">Ser etter profiler…</p>}>
        <Show when={profiles()?.length} fallback={<p class="chrome-import-none" data-testid="chrome-import-none">Fant ingen Chrome- eller Chromium-profil med bokmerker eller historikk på denne maskinen.</p>}>
          <div class="chrome-import-profiles" role="radiogroup" aria-label="Profil">
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
                    <span class="muted">{[profile.bookmarks && "Bokmerker", profile.history && "Historikk"].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              )}
            </For>
          </div>
          <label class="chrome-import-check" classList={{ disabled: !chosen()?.history }}>
            <input type="checkbox" checked={withHistory()} disabled={!chosen()?.history} onChange={(e) => setWithHistory(e.currentTarget.checked)} />
            <span>Ta med historikken <span class="muted">(de siste 1 000 sidene)</span></span>
          </label>
          <div class="chrome-import-preview" data-testid="chrome-import-preview" aria-live="polite">
            <Show when={!previewError()} fallback={<p class="chrome-import-error">{previewError()}</p>}>
              <Show when={preview()} fallback={<p class="muted">Leser profilen…</p>}>
                {(p) => (
                  <>
                    <p class="chrome-import-counts">
                      <strong>Blir importert:</strong> {count(p().bookmarks, "bokmerke", "bokmerker")}
                      <Show when={withHistory()}>{` og ${count(p().history, "side", "sider")} fra historikken`}</Show>.
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
                    <Show when={imported()?.importedAt}><p class="muted chrome-import-replace">Erstatter det du importerte {when(imported()!.importedAt!)}.</p></Show>
                  </>
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </Show>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={close}>Avbryt</button>
        <button type="button" class="btn btn-primary" disabled={!preview() || nothing() || busy()} onClick={() => void run()}>{busy() ? "Importerer…" : "Importer"}</button>
      </div>
    </dialog>
  );
}

export function ChromeImportHost() {
  return <Show when={dialogOpen()}><ImportDialog /></Show>;
}
