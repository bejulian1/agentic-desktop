import { createEffect, createMemo, createSignal, createUniqueId, For, onMount, Show, Suspense } from "solid-js";
import { historySources, type HistoryImportResult, type HistoryScan, type ImportProjectPreview, type ImportThreadPreview } from "../../../shared/history-import";
import type { Settings } from "../../../shared/protocol";
import { patch, post } from "../lib/api";
import { language, localizedFormat, plural, t } from "../lib/i18n";
import { app, setApp, setMode, setSettingsOpen, toast } from "../state/app";
import { closeWelcome } from "../state/welcome";
import { IconFolder, IconMark } from "./icons";
import { LanguageRow } from "./settings/general";
import { Group, Row } from "./settings/parts";
import { Providers } from "./settings/providers";
import { WindowControls } from "./WindowControls";
import "../styles/welcome.css";

const date = localizedFormat((locale) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }));
const sourceNames = (threads: ImportThreadPreview[]) =>
  new Intl.ListFormat(language()).format([...new Set(threads.map((thread) => historySources[thread.source]))]);

function summary(result: HistoryImportResult): string {
  return t("Prosjekter opprettet: {created}. Prosjekter gjenbrukt: {reused}. Tråder importert: {imported}. Tråder hoppet over: {skipped}. Problemer: {problems}.", {
    created: result.projectsCreated, reused: result.projectsReused, imported: result.threadsImported, skipped: result.threadsSkipped, problems: result.problems,
  });
}

function SelectThreads(props: { label: string; ids: string[]; selected: Set<string>; disabled: boolean; toggle: (ids: string[], checked: boolean) => void }) {
  const count = () => props.ids.filter((id) => props.selected.has(id)).length;
  let input!: HTMLInputElement;
  createEffect(() => { input.indeterminate = count() > 0 && count() < props.ids.length; });
  return <input ref={input} type="checkbox" aria-label={props.label} checked={count() > 0 && count() === props.ids.length} disabled={props.disabled}
    onChange={(event) => props.toggle(props.ids, event.currentTarget.checked)} />;
}

function ImportProject(props: {
  project: ImportProjectPreview;
  selected: Set<string>;
  busy: boolean;
  toggle: (ids: string[], checked: boolean) => void;
}) {
  const choices = () => props.project.threads.filter((thread) => !thread.imported).map((thread) => thread.id);
  return (
    <li class="welcome-import-project">
      <div class="welcome-import-project-head">
        <Show when={choices().length}>
          <SelectThreads label={t("Velg prosjektet {path}", { path: props.project.path })} ids={choices()} selected={props.selected} disabled={props.busy} toggle={props.toggle} />
        </Show>
        <IconFolder size={16} />
        <div>
          <strong class="welcome-project-path">{props.project.path}</strong>
          <span class="muted">
            {sourceNames(props.project.threads)} · {plural(props.project.threads.length, "{count} tråd", "{count} tråder")} · {t("Sist aktiv {date}", { date: date.format(props.project.updatedAt) })}
          </span>
        </div>
      </div>
      <ul class="welcome-import-threads">
        <For each={props.project.threads}>{(thread) =>
          <li>
            <Show when={!thread.imported} fallback={<span>{thread.title}</span>}>
              <label><input type="checkbox" checked={props.selected.has(thread.id)} disabled={props.busy} onChange={(event) => props.toggle([thread.id], event.currentTarget.checked)} />{thread.title}</label>
            </Show>
            <span class="muted">{historySources[thread.source]} · {date.format(thread.updatedAt)}<Show when={thread.imported}> · {t("Allerede importert")}</Show></span>
          </li>
        }</For>
      </ul>
    </li>
  );
}

export default function Welcome(props: { importOnly: boolean }) {
  const [scan, setScan] = createSignal<HistoryScan>();
  const [selected, setSelected] = createSignal(new Set<string>());
  const [review, setReview] = createSignal(false);
  const [busy, setBusy] = createSignal<"scan" | "import" | "finish">();
  const [error, setError] = createSignal("");
  const [result, setResult] = createSignal<HistoryImportResult>();
  const [progress, setProgress] = createSignal({ completed: 0, total: 0 });
  const reviewId = createUniqueId();
  const titleId = createUniqueId();
  let heading!: HTMLHeadingElement;

  onMount(() => heading.focus({ preventScroll: true }));
  const projects = () => scan()?.projects ?? [];
  const threads = createMemo(() => projects().flatMap((project) => project.threads));
  const eligible = createMemo(() => threads().filter((thread) => !thread.imported));
  const eligibleProjects = () => projects().filter((project) => project.threads.some((thread) => !thread.imported)).length;
  const selectedGroups = createMemo(() => projects().map((project) =>
    project.threads.filter((thread) => selected().has(thread.id) && !thread.imported).map((thread) => thread.id),
  ).filter((ids) => ids.length));
  const toggle = (ids: string[], checked: boolean) => {
    const next = new Set(selected());
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  const scanHistory = async () => {
    if (busy()) return;
    setBusy("scan");
    setError("");
    try {
      const found = await post<HistoryScan>("/api/history-import/scan");
      setScan(found);
      setSelected(new Set(eligible().map((thread) => thread.id)));
      setReview(false);
      setResult(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const finish = async (imported?: HistoryImportResult) => {
    if (!app.settings.welcomeDone) setApp("settings", await patch<Settings>("/api/settings", { welcomeDone: true }));
    if (imported?.threadsImported) setMode("code");
    setSettingsOpen(null);
    closeWelcome();
    if (imported) toast(summary(imported), imported.problems ? "error" : "info");
  };

  const updateImported = (ids: string[]) => {
    const imported = new Set(ids);
    setScan((current) => current && {
      ...current,
      projects: current.projects.map((project) => ({
        ...project,
        threads: project.threads.map((thread) => imported.has(thread.id) ? { ...thread, imported: true } : thread),
      })),
    });
    toggle(ids, false);
  };

  const start = async (skip = false) => {
    if (busy()) return;
    setError("");
    const groups = skip ? [] : selectedGroups();
    const scanId = scan()?.id;
    setBusy(scanId && groups.length ? "import" : "finish");
    try {
      if (!scanId || !groups.length) {
        if (props.importOnly) closeWelcome();
        else await finish();
        return;
      }
      const totals: HistoryImportResult = { projectsCreated: 0, projectsReused: 0, threadsImported: 0, threadsSkipped: 0, problems: 0 };
      setResult(undefined);
      setProgress({ completed: 0, total: groups.length });
      let completed = 0;
      for (const group of groups) {
        const imported = await post<HistoryImportResult>("/api/history-import", { scanId, threads: group });
        for (const key of Object.keys(totals) as Array<keyof HistoryImportResult>) totals[key] += imported[key];
        if (!imported.problems) updateImported(group);
        setProgress({ completed: ++completed, total: groups.length });
        setResult({ ...totals });
      }
      if (!props.importOnly && !totals.problems) await finish(totals);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const primaryLabel = () => {
    const count = selectedGroups().length;
    if (props.importOnly) return count ? plural(count, "Importer {count} prosjekt", "Importer {count} prosjekter") : t("Lukk");
    return count ? plural(count, "Importer {count} prosjekt og start", "Importer {count} prosjekter og start") : t("Start");
  };

  return (
    <main class="welcome-window" aria-labelledby={titleId} onKeyDown={(event) => {
      if (!props.importOnly || event.key !== "Escape" || event.defaultPrevented || busy()) return;
      event.preventDefault();
      closeWelcome();
    }}>
      <div class="welcome-window-chrome"><WindowControls /></div>
      <div class="welcome-content">
        <header class="welcome-header">
          <div class="welcome-mark"><Show when={props.importOnly} fallback={<IconMark size={25} />}><IconFolder size={25} /></Show></div>
          <h1 ref={heading} tabIndex={-1} id={titleId}>{props.importOnly ? t("Importer fra andre kodeapper") : t("Velkommen til Agentic Desktop")}</h1>
        </header>
        <Show when={!props.importOnly}>
          <Group><LanguageRow /></Group>
          <section aria-label={t("Modeller og leverandører")}>
            <h2>{t("Modeller og leverandører")}</h2>
            <Suspense><Providers welcome /></Suspense>
          </section>
        </Show>
        <section aria-label={t("Prosjekter og tråder")}>
          <Show when={!props.importOnly}><h2>{t("Prosjekter og tråder")}</h2></Show>
          <Group>
            <Row label={t("Samtalehistorikk på denne maskinen")} text={t("Søk lokalt etter samtaler fra {apps}.", { apps: new Intl.ListFormat(language()).format(Object.values(historySources)) })}>
              <button type="button" class="btn btn-small" disabled={!!busy()} onClick={() => void scanHistory()}>
                {scan() ? t("Søk på nytt") : t("Søk etter samtaler")}
              </button>
            </Row>
            <Show when={busy() === "scan"}><p class="welcome-status muted" role="status">{t("Søker etter samtaler…")}</p></Show>
            <Show when={scan()}>{(found) =>
              <>
                <Show when={eligible().length > 0}>
                  <Row label={plural(eligibleProjects(), "Importer {count} prosjekt og trådene der fra {apps}", "Importer {count} prosjekter og trådene der fra {apps}", { apps: sourceNames(eligible()) })}>
                    <SelectThreads label={t("Velg alle tråder")} ids={eligible().map((thread) => thread.id)} selected={selected()} disabled={!!busy()} toggle={toggle} />
                  </Row>
                </Show>
                <Show when={threads().length > 0} fallback={<p class="welcome-status muted">{t("Fant ingen samtaler i eksisterende prosjektmapper.")}</p>}>
                  <button type="button" class="btn btn-small welcome-review-button" aria-expanded={review()} aria-controls={reviewId} onClick={() => setReview(!review())}>
                    {review() ? t("Skjul tråder") : t("Se alle {count}", { count: threads().length })}
                  </button>
                  <ul class="welcome-import-list" id={reviewId} hidden={!review()}>
                    <Show when={review()}><For each={projects()}>{(project) =>
                      <ImportProject project={project} selected={selected()} busy={!!busy()} toggle={toggle} />
                    }</For></Show>
                  </ul>
                </Show>
                <p class="welcome-status muted" role="status">
                  {t("Filer funnet: {files}. Uleselige linjer: {lines}. Filer hoppet over: {skipped}. Prosjektmapper som mangler eller ikke kan brukes: {missing}.", {
                    files: found().files, lines: found().invalidLines, skipped: found().skippedFiles, missing: found().missingFolders,
                  })}
                  <Show when={found().limited}> {t("Søket nådde en grense for størrelse eller antall.")}</Show>
                </p>
              </>
            }</Show>
          </Group>
        </section>
        <Show when={busy() === "import"}>
          <div class="welcome-progress" role="status">
            <progress max={progress().total} value={progress().completed} aria-label={t("Importerer samtaler")} />
            {t("Behandlet {completed} av {total} prosjekter", progress())}
          </div>
        </Show>
        <Show when={result()}>{(counts) => <p class="welcome-result" role="status">{summary(counts())}</p>}</Show>
        <Show when={error()}><p class="welcome-result" role="alert">{error()}</p></Show>
        <footer class="welcome-actions">
          <Show when={!props.importOnly || selectedGroups().length}>
            <button type="button" class="btn btn-quiet" disabled={!!busy()} onClick={() => props.importOnly ? closeWelcome() : void start(true)}>
              {props.importOnly ? t("Lukk") : t("Hopp over")}
            </button>
          </Show>
          <button type="button" class="btn btn-primary" disabled={!!busy()} onClick={() => void start()}>{primaryLabel()}</button>
        </footer>
      </div>
    </main>
  );
}
