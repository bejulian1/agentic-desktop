import { language, t } from "../../lib/i18n.ts";
// Optional context is stored per mode. Saving a switch never performs an IP lookup.
import { createSignal, onCleanup, Show } from "solid-js";
import { modelContextOf, type ModelContextModeSettings, type Settings } from "../../../../shared/protocol";
import { patch, post } from "../../lib/api";
import { app, setApp } from "../../state/app";
import { Group, Row } from "./parts";
import "../../styles/model-context.css";

type Mode = "chat" | "code";
export function ModelContextSettings(props: { mode: Mode }) {
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal<Partial<ModelContextModeSettings> | null>(null);
  const [locating, setLocating] = createSignal(false);
  const [error, setError] = createSignal("");
  const [draft, setDraft] = createSignal<string | null>(null);
  const value = () => modelContextOf(app.settings, props.mode);
  const checked = (key: "dateTime" | "model" | "location") => pending()?.[key] ?? value()[key];
  const location = () => draft() ?? value().locationText;
  const dirty = () => draft() !== null && draft() !== value().locationText;
  let alive = true;
  onCleanup(() => { alive = false; });
  const apply = (saved: Settings) => setApp("settings", "modelContext", (current) => ({ ...current, [props.mode]: saved.modelContext?.[props.mode] ?? {} }));
  const save = async (change: Partial<ModelContextModeSettings>) => {
    if (busy()) return;
    setPending(change);
    setBusy(true); setError("");
    try {
      const saved = await patch<Settings>("/api/settings", { modelContext: { [props.mode]: change } });
      apply(saved);
      if (alive && change.locationText !== undefined && draft() === change.locationText) setDraft(null);
    } catch (err) {
      if (alive) setError((err as Error).message);
    } finally { if (alive) { setPending(null); setBusy(false); } }
  };
  const locate = async () => {
    if (busy() || dirty()) return;
    setLocating(true);
    setBusy(true); setError("");
    try {
      apply(await post<Settings>("/api/model-context/location", { mode: props.mode }));
    } catch (err) {
      if (alive) setError((err as Error).message);
    } finally { if (alive) { setBusy(false); setLocating(false); } }
  };
  return <Group title={t("Kontekst til modellen")}>
    <div class="setting setting-block"><span class="muted">{t("Gjelder bare {mode}, fra neste tur. Modus, verktøy og tillatelsesgrenser beskrives alltid.", { mode: props.mode === "code" ? t("Kode") : t("Chat") })}</span></div>
    <Row as="label" label={t("Lokal dato og tid")} text={t("Del maskinens ukedag, dato, klokkeslett og tidssone, slik at modellen har riktig tidskontekst.")}>
      <input type="checkbox" role="switch" class="switch" aria-label={t("Lokal dato og tid")} checked={checked("dateTime")} disabled={busy()} onChange={(event) => void save({ dateTime: event.currentTarget.checked })} />
    </Row>
    <Row as="label" label={t("Modell og leverandør")} text={t("Del valgt modellnavn, modell-ID, leverandør og endepunkt. Nøkler og innlogging sendes ikke med.")}>
      <input type="checkbox" role="switch" class="switch" aria-label={t("Modell og leverandør")} checked={checked("model")} disabled={busy()} onChange={(event) => void save({ model: event.currentTarget.checked })} />
    </Row>
    <Row as="label" label={t("Omtrentlig posisjon")} text={t("Del byen eller landet som er lagret under. Av som standard. Å slå på henter ingen posisjon automatisk.")}>
      <input type="checkbox" role="switch" class="switch" aria-label={t("Omtrentlig posisjon")} checked={checked("location")} disabled={busy()} onChange={(event) => void save({ location: event.currentTarget.checked })} />
    </Row>
    <Show when={value().location}>
      <div class="setting setting-block model-context-location">
        <label class="field"><span>{t("By eller land")}</span><input class="input" aria-label={t("Posisjon til modellen")} value={location()} maxLength={160} placeholder={t("For eksempel Bergen, Norge")} onInput={(event) => setDraft(event.currentTarget.value)} /></label>
        <div class="model-context-actions">
          <button type="button" class="btn btn-small" disabled={busy() || !dirty()} onClick={() => void save({ locationText: location(), locationSource: "manual" })}>{t("Lagre posisjon")}</button>
          <button type="button" class="btn btn-small" disabled={busy() || dirty()} title={dirty() ? t("Lagre endringen før du henter fra IP") : t("Hent omtrentlig by og land fra appmaskinens offentlige IP")} onClick={() => void locate()}>{t("Hent fra IP")}</button>
        </div>
        <span class="muted small">{t("IP-oppslag kontakter ipapi.co med appmaskinens offentlige IP. Bare by og land lagres som posisjon. VPN og nettverk kan gi feil sted.")}</span>
        <Show when={dirty()} fallback={<Show when={value().locationText}><span class="muted small">{value().locationSource === "ip" ? t("Omtrentlig posisjon hentet fra IP") : t("Posisjon oppgitt av deg")}{value().locationSource === "ip" && value().locationUpdatedAt ? ` · ${new Date(value().locationUpdatedAt!).toLocaleString(language())}` : ""}</span></Show>}><span class="muted small">{t("Endringen er ikke lagret.")}</span></Show>
        <Show when={!location().trim()}><span class="muted small">{t("Ingen posisjon deles før du lagrer et sted eller velger «Hent fra IP».")}</span></Show>
      </div>
    </Show>
    <Show when={busy()}><div class="setting" role="status">{locating() ? t("Henter omtrentlig posisjon …") : t("Lagrer kontekstvalg …")}</div></Show>
    <Show when={error()}><div class="setting model-context-error" role="alert">{error()}</div></Show>
  </Group>;
}
