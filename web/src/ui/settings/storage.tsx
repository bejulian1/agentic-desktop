import { language } from "../../lib/i18n.ts";
// Lagring: how much room the app's data folder takes, per category, and cleaning up what is not
// needed. The server measures and deletes (server/src/storage.ts); this page shows the numbers,
// lets you pick what to clean, says what will be deleted, and asks before it does.
import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import type { StorageAction, StorageActionId, StorageCategoryId, StorageCleanResult, StorageReport } from "../../../../shared/protocol";
import { get, post } from "../../lib/api";
import { report as reportError, toast } from "../../state/app";
import { IconAlert, IconCopy } from "../icons";
import { Group, Page, Row } from "./parts";
import { activeDownloads, loadDownloads } from "../../state/downloads";
import { Select } from "../Select";

const CATEGORIES: Record<StorageCategoryId, { label: string; text: string; color: string }> = {
  database: { label: "Database", text: "Tråder, meldinger, hendelser, endringshistorikk og innstillinger.", color: "#2f6fe4" },
  artifacts: { label: "Artifacts", text: "HTML-programmene i Artifacts, med forrige versjon. De ligger i databasen.", color: "#7247d6" },
  images: { label: "Bilder", text: "Bilder lagt ved meldinger.", color: "#1d8350" },
  uploads: { label: "Vedlagte filer", text: "Tekstfiler lagt ved meldinger.", color: "#0f8a8a" },
  screenshots: { label: "Skjermbilder", text: "Skjermbilder agenten har tatt i nettleseren.", color: "#cf5f1f" },
  browser: { label: "Nettleser", text: "Profilen til nettleserpanelet: buffer, innlogginger og historikk.", color: "#cc3a80" },
  logs: { label: "Logger", text: "Loggfiler i datamappen.", color: "#a07a10" },
  temp: { label: "Midlertidige filer", text: "Filer appen la fra seg underveis.", color: "#6b6f7a" },
  other: { label: "Annet", text: "Nøkkelfilen, innloggingstokenet og andre små filer.", color: "#9a9ca3" },
};

const DAYS = [7, 30, 90, 365];

const ACTIONS: Record<StorageActionId, { label: (days: number) => string; text: string; deletes: (a: StorageAction, days: number) => string }> = {
  "browser-cache": {
    label: () => "Tøm nettleserbufferen",
    text: "Bufret innhold fra nettsider. Innlogginger og historikk blir.",
    deletes: () => "Bufferen i nettleserpanelet. Nettleseren lukkes hvis den er åpen.",
  },
  "browser-all": {
    label: () => "Slett hele nettleserprofilen",
    text: "Også innlogginger, informasjonskapsler og historikk i nettleserpanelet. Du må logge inn på nytt.",
    deletes: () => "Hele nettleserprofilen, med innlogginger og historikk.",
  },
  orphans: {
    label: () => "Slett bilder og filer ingen melding bruker",
    text: "Vedlegg og skjermbilder som ingen tråd viser til lenger. Det som er nyere enn ett døgn, blir, i tilfelle det venter i meldingsfeltet.",
    deletes: (a) => (a.count === 1 ? "1 bilde eller fil som ingen melding bruker." : `${a.count} bilder og filer som ingen melding bruker.`),
  },
  archived: {
    label: (days) => `Slett arkiverte tråder eldre enn ${days} dager`,
    text: "Trådene og historikken deres slettes for godt. Filer i prosjektene røres ikke. Databasen komprimeres etterpå.",
    deletes: (a, days) => (a.count === 1 ? `1 arkivert tråd som ikke er endret på ${days} dager.` : `${a.count} arkiverte tråder som ikke er endret på ${days} dager.`),
  },
  vacuum: {
    label: () => "Komprimer databasen",
    text: "Gir ledig plass i databasefilen tilbake til disken. Ingenting slettes. Kjøres bare når ingen tur kjører.",
    deletes: () => "Ingenting. Databasen skrives på nytt uten ledig plass.",
  },
  logs: {
    label: () => "Slett gamle logger",
    text: "Loggfiler eldre enn sju dager.",
    deletes: (a) => (a.count === 1 ? "1 loggfil." : `${a.count} loggfiler.`),
  },
};
const ORDER: StorageActionId[] = ["browser-cache", "browser-all", "orphans", "archived", "vacuum", "logs"];

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toLocaleString(language(), { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export function StoragePage() {
  const [days, setDays] = createSignal(30);
  const [data, { mutate, refetch }] = createResource(days, (d) => get<StorageReport>(`/api/storage?days=${d}`));
  const [picked, setPicked] = createSignal<Set<StorageActionId> | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<StorageCleanResult | null>(null);

  const action = (id: StorageActionId) => data()?.actions.find((a) => a.id === id);
  const usable = (a: StorageAction | undefined) => !!a && a.available && (a.bytes > 0 || a.count > 0 || a.id === "vacuum");
  // Suggested by default: what is safe and frees something. Threads and logins are opt-in.
  const chosen = createMemo(() => {
    const own = picked();
    if (own) return new Set([...own].filter((id) => usable(action(id))));
    return new Set(ORDER.filter((id) => ["browser-cache", "orphans", "logs", "vacuum"].includes(id) && usable(action(id)) && action(id)!.bytes > 0));
  });
  const toggle = (id: StorageActionId, on: boolean) => {
    const next = new Set(chosen());
    if (on) next.add(id);
    else next.delete(id);
    // The whole profile includes the cache.
    if (id === "browser-all" && on) next.delete("browser-cache");
    if (id === "browser-cache" && on) next.delete("browser-all");
    setPicked(next);
    setConfirming(false);
  };
  const closesBrowser = () => chosen().has("browser-cache") || chosen().has("browser-all");
  onMount(() => loadDownloads());
  const estimate = createMemo(() => [...chosen()].reduce((n, id) => n + (action(id)?.bytes ?? 0), 0));
  const visible = createMemo(() => (data()?.categories ?? []).filter((c) => c.bytes > 0));

  const clean = async () => {
    setBusy(true);
    try {
      const out = await post<StorageCleanResult>("/api/storage/clean", { actions: [...chosen()], archivedDays: days() });
      setResult(out);
      mutate(out.report);
      setPicked(null);
      setConfirming(false);
      const failed = out.done.filter((d) => d.error);
      if (failed.length) toast(failed.map((d) => `${ACTIONS[d.id].label(days())}: ${d.error}`).join(" "));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const copyPath = () => {
    const dir = data()?.dataDir;
    if (!dir) return;
    navigator.clipboard?.writeText(dir).then(() => toast("Stien er kopiert.", "info")).catch(() => toast(dir, "info"));
  };

  return (
    <Page title="Lagring" intro="Hvor mye plass Agentic Desktop tar på denne maskinen, og hva som kan ryddes. Bare appens egen datamappe ryddes. Prosjektene og nedlastingene dine røres aldri.">
      <Show when={data()} fallback={<p class="muted">{data.error ? "Kunne ikke måle lagringen." : "Måler…"}</p>}>
        {(r) => (
          <>
            <div class="storage-summary" data-testid="storage-total">
              <span class="storage-total">{formatBytes(r().total)}</span>
              <span class="muted">brukt av appen</span>
            </div>
            <div class="storage-bar" role="img" aria-label={`Fordeling: ${visible().map((c) => `${CATEGORIES[c.id].label} ${formatBytes(c.bytes)}`).join(", ")}`}>
              <For each={visible()}>
                {(c) => <span class="storage-segment" style={{ "flex-grow": String(c.bytes), background: CATEGORIES[c.id].color }} title={`${CATEGORIES[c.id].label}: ${formatBytes(c.bytes)}`} />}
              </For>
            </div>
            <Show when={result()}>
              {(res) => (
                <p class="storage-result" role="status">
                  Frigjorde {formatBytes(res().freed)}. Appen bruker nå {formatBytes(res().report.total)}.
                </p>
              )}
            </Show>
            <Group title="Fordeling">
              <For each={r().categories.filter((c) => c.bytes > 0 || c.id === "database")}>
                {(c) => (
                  <div class="setting storage-row" data-category={c.id}>
                    <span class="storage-dot" style={{ background: CATEGORIES[c.id].color }} aria-hidden="true" />
                    <div class="setting-text">
                      <strong>{CATEGORIES[c.id].label}</strong>
                      <span class="muted">{CATEGORIES[c.id].text}</span>
                    </div>
                    <div class="setting-control storage-bytes">{formatBytes(c.bytes)}</div>
                  </div>
                )}
              </For>
            </Group>

            <Show when={r().categories.some((c) => c.bytes === 0)}>
              <p class="muted small storage-empty">Tomme kategorier vises ikke: {r().categories.filter((c) => c.bytes === 0 && c.id !== "database").map((c) => CATEGORIES[c.id].label.toLowerCase()).join(", ")}.</p>
            </Show>
            <Group title="Rydd opp" action={<button type="button" class="btn btn-small btn-quiet" title="Mål på nytt" onClick={() => { setResult(null); void refetch(); }}>Mål på nytt</button>}>
              <For each={ORDER}>
                {(id) => {
                  const a = () => action(id);
                  const reason = () => a()?.reason ?? (!usable(a()) ? "Ingenting å rydde" : undefined);
                  return (
                    <label class="setting storage-action" classList={{ disabled: !usable(a()) }} data-action={id}>
                      <input type="checkbox" role="switch" class="switch" checked={chosen().has(id)} disabled={!usable(a()) || busy()} onChange={(e) => toggle(id, e.currentTarget.checked)} />
                      <div class="setting-text">
                        <strong>{ACTIONS[id].label(days())}</strong>
                        <span class="muted">{ACTIONS[id].text}<Show when={reason()}> <em class="storage-reason">{reason()}.</em></Show><Show when={(id === "browser-cache" || id === "browser-all") && activeDownloads() > 0}> <em class="storage-reason">En nedlasting pågår, og avbrytes hvis nettleseren lukkes.</em></Show></span>
                      </div>
                      <div class="setting-control">
                        <Show when={id === "archived"}>
                          <span onClick={(e) => e.preventDefault()}>
                            <Select<number> label="Antall dager" class="storage-days" value={days()} options={DAYS.map((d) => ({ value: d, label: `${d} dager` }))} onChange={(d) => { setDays(d); setConfirming(false); }} />
                          </span>
                        </Show>
                        <span class="storage-bytes">{id === "vacuum" ? "≈ " : ""}{formatBytes(a()?.bytes ?? 0)}</span>
                      </div>
                    </label>
                  );
                }}
              </For>
            </Group>
            <Show
              when={confirming()}
              fallback={
                <div class="storage-actions">
                  <span class="muted">{chosen().size ? `Frigjør omtrent ${formatBytes(estimate())}.` : "Ingenting valgt."}</span>
                  <button type="button" class="btn btn-primary" disabled={!chosen().size || busy()} onClick={() => setConfirming(true)}>Rydd opp</button>
                </div>
              }
            >
              <div class="settings-card storage-confirm" role="alertdialog" aria-label="Bekreft opprydding">
                <strong>Dette slettes:</strong>
                <ul>
                  <For each={ORDER.filter((id) => chosen().has(id))}>{(id) => <li>{ACTIONS[id].deletes(action(id)!, days())}</li>}</For>
                </ul>
                {/* Cleaning the browser closes it, and a download under way cannot finish then. */}
                <Show when={closesBrowser() && activeDownloads() > 0}>
                  <p class="storage-warning" role="alert" data-testid="storage-download-warning">
                    <IconAlert size={15} />
                    <span>{activeDownloads() === 1 ? "En nedlasting pågår" : `${activeDownloads()} nedlastinger pågår`} i Nettleser-panelet. Den avbrytes når nettleseren lukkes, og den halve filen slettes. Vent til den er ferdig hvis du trenger filen.</span>
                  </p>
                </Show>
                <p class="muted">Det kan ikke angres. Frigjør omtrent {formatBytes(estimate())}.</p>
                <div class="form-actions">
                  <button type="button" class="btn" disabled={busy()} onClick={() => setConfirming(false)}>Avbryt</button>
                  <button type="button" class="btn btn-danger" disabled={busy()} onClick={clean}>{busy() ? "Rydder…" : "Slett"}</button>
                </div>
              </div>
            </Show>

            <Group title="Mapper">
              <Row label="Datamappe" text={<code class="storage-path">{r().dataDir}</code>}>
                <button type="button" class="icon-button" title="Kopier stien" aria-label="Kopier stien til datamappen" onClick={copyPath}><IconCopy size={15} /></button>
              </Row>
              <Show when={r().downloads}>
                {(d) => (
                  <Row
                    label="Nedlastinger"
                    text={<><code class="storage-path">{d().dir}</code><br />Eies av deg, og er ikke med i totalen. Appen sletter aldri noe her.</>}
                  >
                    <span class="storage-bytes">{formatBytes(d().bytes)}{d().capped ? "+" : ""}</span>
                  </Row>
                )}
              </Show>
            </Group>
          </>
        )}
      </Show>
    </Page>
  );
}
