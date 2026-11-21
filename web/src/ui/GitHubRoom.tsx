import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type Accessor } from "solid-js";
import type {
  DiffLineInfo, GitHubComment, GitHubDetail, GitHubFile, GitHubFilters, GitHubItem, GitHubKind, GitHubPage,
  GitHubReference, GitHubRow, GitHubScope, GitHubStatus, GitHubView, Thread,
} from "../../../shared/protocol";
import { ApiError, del, get, post } from "../lib/api";
import { relativeTime } from "../lib/format";
import { plural, t } from "../lib/i18n";
import { handleCopyClick, lex, renderBlocks } from "../markdown/render";
import { app, currentProject, report, setApp, setSettingsOpen, settingsOpen } from "../state/app";
import { deliverToComposer } from "../state/composer-delivery";
import { closeGitHubRoom, githubRoom } from "../state/nav";
import { showGitHubDetail } from "../state/github";
import { createThreadFor, openThread } from "../state/navigate";
import { setStudioOpen } from "../state/studio";
import { confirmDialog, promptDialog } from "./dialogs";
import { githubTitle } from "./GitHubNavigation";
import { errorTitle, IconDraft, IconPullRequest, resetText } from "./GitHubShared";
import { IconBack, IconBookmark, IconChat, IconCheck, IconChevronDown, IconClose, IconCompose, IconGlobe, IconIssue, IconReload, IconSearch, IconSort, IconTrash } from "./icons";
import { Popover } from "./Popover";
import { fullTime } from "./rows";
import { DiffView } from "./settings/harness";
import { SkeletonRows } from "./settings/parts";
import "../styles/github-room.css";

const DEFAULT_FILTERS: GitHubFilters = { search: "", sort: "updated", state: "open", involvement: "any", label: "", projectId: "" };

type Problem = NonNullable<import("../../../shared/protocol").GitHubProject["error"]>;
type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: Problem };

function problem(err: unknown): Problem {
  const detail = err instanceof ApiError ? err.body as Partial<Problem> | undefined : undefined;
  return { code: detail?.code ?? "other", resetAt: detail?.resetAt, message: err instanceof Error ? err.message : String(err) };
}

async function load<T>(path: string): Promise<Result<T>> {
  try { return { value: await get<T>(path) }; }
  catch (err) { return { error: problem(err) }; }
}

function usePages<T>(url: Accessor<string | false>) {
  const [items, setItems] = createSignal<T[]>([]);
  const [next, setNext] = createSignal<string | null>(null);
  const [error, setError] = createSignal<Problem>();
  const [loading, setLoading] = createSignal(false);
  let revision = 0;

  const request = async (source: string | false, cursor: string | null = null, force = false) => {
    const current = ++revision;
    setError(undefined);
    setLoading(!!source);
    if (!cursor) {
      setItems([]);
      setNext(null);
    }
    if (!source) return;
    const extra = new URLSearchParams();
    if (cursor) extra.set("cursor", cursor);
    if (force) extra.set("refresh", "1");
    const answer = await load<GitHubPage<T>>(extra.size ? `${source}&${extra}` : source);
    if (current !== revision) return;
    setLoading(false);
    if (answer.error) setError(answer.error);
    else {
      setItems(previous => cursor ? [...previous, ...answer.value.items] : answer.value.items);
      setNext(answer.value.next);
    }
  };

  createEffect(on(url, source => void request(source)));
  onCleanup(() => { revision++; });
  return {
    items, next, error, loading,
    refresh: () => request(url(), null, true),
    more: () => request(url(), next()),
  };
}

function Failure(props: { error: Problem; retry: () => unknown }) {
  return (
    <div class="github-error github-room-error" role="alert" data-code={props.error.code}>
      <strong>{errorTitle(props.error)}</strong>
      <span>{props.error.message} {props.error.code === "rate-limit" ? resetText(props.error.resetAt) : ""}</span>
      <div class="github-error-actions">
        <Show when={props.error.code === "not-connected" || props.error.code === "bad-token"} fallback={
          <button type="button" class="btn btn-small" onClick={props.retry}>{t("Prøv igjen")}</button>
        }>
          <button type="button" class="btn btn-small btn-primary" onClick={() => setSettingsOpen("github")}>{t("Åpne GitHub-innstillinger")}</button>
        </Show>
      </div>
    </div>
  );
}

function Labels(props: { labels: GitHubItem["labels"] }) {
  return <span class="github-labels"><For each={props.labels}>{label => (
    <span class="github-label" style={{ "--label": `#${label.color}` }}>{label.name}</span>
  )}</For></span>;
}

function Author(props: { login: string | null; avatarId: number | null }) {
  return <Show when={props.login}>
    <span class="github-author">
      <Show when={props.avatarId}>
        <img alt="" width="18" height="18" loading="lazy" src={`/api/github/avatar/${props.avatarId}`} onError={event => { event.currentTarget.hidden = true; }} />
      </Show>
      {props.login}
    </span>
  </Show>;
}

function stateTitle(state: GitHubRow["state"]) {
  switch (state) {
    case "open": return t("Åpen");
    case "closed": return t("Lukket");
    case "merged": return t("Slått sammen");
    case "draft": return t("Utkast");
  }
}

function StateIcon(props: { item: GitHubRow }) {
  return <span class="github-row-state" data-state={props.item.state} title={stateTitle(props.item.state)} role="img" aria-label={stateTitle(props.item.state)}>
    {props.item.kind === "issues" ? <IconIssue size={17} /> : props.item.state === "draft" ? <IconDraft size={17} /> : <IconPullRequest size={17} />}
  </span>;
}

function checkTitle(value: string): string {
  switch (value) {
    case "SUCCESS": return t("Bestått");
    case "FAILURE": case "ERROR": case "TIMED_OUT": case "STARTUP_FAILURE": return t("Mislyktes");
    case "PENDING": case "EXPECTED": case "QUEUED": case "WAITING": case "REQUESTED": return t("Venter");
    case "IN_PROGRESS": return t("Pågår");
    case "NEUTRAL": return t("Nøytral");
    case "SKIPPED": return t("Hoppet over");
    case "CANCELLED": return t("Avbrutt");
    case "ACTION_REQUIRED": return t("Krever handling");
    case "STALE": return t("Utdatert");
    default: return value;
  }
}

function reviewTitle(value: string | null) {
  switch (value) {
    case "APPROVED": return t("Godkjent");
    case "CHANGES_REQUESTED": return t("Endringer etterspurt");
    case "REVIEW_REQUIRED": return t("Gjennomgang kreves");
    case "COMMENTED": return t("Kommentert");
    case "DISMISSED": return t("Gjennomgang avvist");
    case "PENDING": return t("Venter");
    default: return t("Ingen avgjørelse");
  }
}

function dateAt(date: string) {
  const at = Date.parse(date);
  return Number.isFinite(at) ? fullTime(at) : "";
}

function Markdown(props: { body: string }) {
  let root!: HTMLDivElement;
  createEffect(() => {
    root.replaceChildren();
    if (props.body) renderBlocks(lex(props.body), root);
  });
  return <div class="md github-markdown" ref={root} onClick={handleCopyClick} />;
}

function PageMore(props: { page: ReturnType<typeof usePages<unknown>> }) {
  return <Show when={props.page.next() && !props.page.error()}>
    <button type="button" class="btn github-more" disabled={props.page.loading()} onClick={() => void props.page.more()}>
      {props.page.loading() ? t("Henter…") : t("Last inn flere")}
    </button>
  </Show>;
}

function ListRoom(props: { kind: GitHubKind; initialProject?: string; status?: Result<GitHubStatus>; reloadStatus: () => unknown }) {
  const [filters, setFilters] = createSignal({ ...DEFAULT_FILTERS, projectId: props.initialProject ?? "" });
  const [search, setSearch] = createSignal("");
  const [menu, setMenu] = createSignal<"sort" | "filters" | "views" | null>(null);
  const [viewBusy, setViewBusy] = createSignal(false);
  const [scopes, { refetch: reloadScopes }] = createResource(
    () => Object.keys(app.projects).join(",") || "empty",
    () => load<GitHubScope[]>("/api/github/projects"),
  );
  const configuredProject = createMemo(() => {
    const selected = filters().projectId;
    return selected && scopes()?.value?.some(scope => scope.id === selected) ? selected : "";
  });
  const [repoLabels, { refetch: reloadLabels }] = createResource<Result<GitHubItem["labels"]>, { projectId: string }>(
    () => !!props.status?.value?.connected && menu() === "filters" && { projectId: configuredProject() },
    ({ projectId }, { refetching }) => load<GitHubItem["labels"]>(`/api/github/labels?${new URLSearchParams({ projectId, refresh: refetching === true ? "1" : "0" })}`),
  );
  const source = createMemo(() => {
    if (!props.status?.value?.connected || !scopes()?.value?.length) return false;
    const query = new URLSearchParams({ ...filters(), projectId: configuredProject() });
    return `/api/github/list/${props.kind}?${query}`;
  });
  const page = usePages<GitHubRow>(source);
  const update = (patch: Partial<GitHubFilters>) => setFilters(current => ({ ...current, ...patch }));

  createEffect(on(search, value => {
    if (value.trim() === filters().search) return;
    const timer = setTimeout(() => update({ search: value.trim() }), 250);
    onCleanup(() => clearTimeout(timer));
  }));

  const applyView = (next: GitHubFilters) => {
    setFilters(next);
    setSearch(next.search);
    setMenu(null);
  };

  const saveView = async () => {
    setMenu(null);
    const name = (await promptDialog({ title: t("Navn på visningen"), confirm: t("Lagre"), value: "" }))?.trim();
    if (!name) return;
    setViewBusy(true);
    try {
      const view: GitHubView = {
        id: crypto.randomUUID(), name, kind: props.kind,
        filters: { ...filters(), projectId: configuredProject(), search: search().trim() },
      };
      setApp("settings", "githubViews", await post<GitHubView[]>("/api/github/views", view));
    } catch (err) { report(err); }
    finally { setViewBusy(false); }
  };

  const removeView = async (view: GitHubView) => {
    setMenu(null);
    if (!await confirmDialog({ title: t("Slette visningen «{name}»?", { name: view.name }), text: t("Du kan lagre visningen på nytt fra menyen Visninger."), confirm: t("Slett"), danger: true })) return;
    try { setApp("settings", "githubViews", await del<GitHubView[]>(`/api/github/views/${encodeURIComponent(view.id)}`)); }
    catch (err) { report(err); }
  };
  const sorts = () => [
    { value: "updated", label: t("Sist oppdatert") }, { value: "newest", label: t("Nyeste først") },
    { value: "oldest", label: t("Eldste først") }, { value: "comments", label: t("Flest kommentarer") },
  ] as const;
  const builtIn = (): Array<{ label: string; involvement: GitHubFilters["involvement"] }> => [
    { label: t("Åpne"), involvement: "any" }, { label: t("Mine"), involvement: "author" },
    props.kind === "pull" ? { label: t("Gjennomgang etterspurt"), involvement: "review-requested" } : { label: t("Tildelt meg"), involvement: "assignee" },
  ] as const;
  const refresh = async () => {
    if (props.status?.value?.connected && !scopes()?.error) {
      await page.refresh();
      if (menu() === "filters") void reloadLabels();
    }
    await Promise.all([props.reloadStatus(), reloadScopes()]);
  };

  return (
    <>
      <div class="github-toolbar">
        <label class="github-search">
          <IconSearch size={16} />
          <input type="search" value={search()} maxlength={200} onInput={event => setSearch(event.currentTarget.value)}
            aria-label={props.kind === "pull" ? t("Søk i pull requests") : t("Søk i issues")}
            placeholder={props.kind === "pull" ? t("Søk i pull requests") : t("Søk i issues")} />
        </label>
        <Popover open={menu() === "sort"} onClose={() => setMenu(null)} returnFocus fixed portal align="right"
          trigger={<button type="button" class="btn btn-small" aria-expanded={menu() === "sort"} onClick={() => setMenu(menu() === "sort" ? null : "sort")}><IconSort size={14} />{t("Sorter")}</button>}>
          <div class="github-menu">
            <For each={sorts()}>{sort => <button type="button" class="btn btn-ghost" aria-pressed={filters().sort === sort.value}
              onClick={() => { update({ sort: sort.value }); setMenu(null); }}>{sort.label}<Show when={filters().sort === sort.value}><IconCheck size={14} /></Show></button>}</For>
          </div>
        </Popover>
        <Popover open={menu() === "filters"} onClose={() => setMenu(null)} returnFocus fixed portal align="right"
          trigger={<button type="button" class="btn btn-small" aria-expanded={menu() === "filters"} onClick={() => setMenu(menu() === "filters" ? null : "filters")}>{t("Filtre")}<IconChevronDown size={13} /></button>}>
          <div class="github-menu github-filter-menu">
            <label>{t("Tilstand")}
              <select class="input" aria-label={t("Tilstand")} value={filters().state} onChange={event => update({ state: event.currentTarget.value as GitHubFilters["state"] })}>
                <option value="open">{t("Åpne")}</option><option value="closed">{t("Lukkede")}</option>
                <Show when={props.kind === "pull"}><option value="merged">{t("Slått sammen")}</option></Show>
                <option value="all">{t("Alle")}</option>
              </select>
            </label>
            <label>{t("Involvering")}
              <select class="input" aria-label={t("Involvering")} value={filters().involvement} onChange={event => update({ involvement: event.currentTarget.value as GitHubFilters["involvement"] })}>
                <option value="any">{t("Hvem som helst")}</option><option value="author">{t("Opprettet av meg")}</option>
                <option value="assignee">{t("Tildelt meg")}</option><option value="mentions">{t("Nevner meg")}</option>
                <Show when={props.kind === "pull"}><option value="review-requested">{t("Gjennomgang etterspurt")}</option></Show>
              </select>
            </label>
            <label>{t("Etikett")}
              <select class="input" aria-label={t("Etikett")} onChange={event => update({ label: event.currentTarget.value })}>
                <option value="" selected={!filters().label}>{t("Alle etiketter")}</option>
                <Show when={filters().label && !repoLabels()?.value?.some(label => label.name === filters().label)}>
                  <option value={filters().label} selected>{filters().label}</option>
                </Show>
                <For each={repoLabels()?.value}>{label => (
                  <option value={label.name} selected={filters().label === label.name}>{label.name}</option>
                )}</For>
              </select>
            </label>
            <Show when={repoLabels.loading}><span class="muted" role="status">{t("Henter…")}</span></Show>
            <Show when={repoLabels()?.error}>{error => <Failure error={error()} retry={reloadLabels} />}</Show>
          </div>
        </Popover>
        <Popover open={menu() === "views"} onClose={() => setMenu(null)} returnFocus fixed portal align="right"
          trigger={<button type="button" class="btn btn-small" aria-expanded={menu() === "views"} onClick={() => setMenu(menu() === "views" ? null : "views")}><IconBookmark size={14} />{t("Visninger")}<IconChevronDown size={13} /></button>}>
          <div class="github-menu">
            <For each={builtIn()}>{view => <button type="button" class="btn btn-ghost" onClick={() => applyView({ ...DEFAULT_FILTERS, projectId: configuredProject(), involvement: view.involvement })}>{view.label}</button>}</For>
            <For each={(app.settings.githubViews ?? []).filter(view => view.kind === props.kind)}>{view => (
              <div class="github-saved-view">
                <button type="button" class="btn btn-ghost" onClick={() => applyView(view.filters)}>{view.name}</button>
                <button type="button" class="icon-button" aria-label={t("Slett visningen «{name}»", { name: view.name })} onClick={() => void removeView(view)}><IconTrash size={14} /></button>
              </div>
            )}</For>
            <button type="button" class="btn btn-ghost" disabled={viewBusy()} onClick={() => void saveView()}>{t("Lagre gjeldende visning…")}</button>
          </div>
        </Popover>
        <select class="input github-scope" aria-label={t("Prosjekt")} onChange={event => update({ projectId: event.currentTarget.value, label: "" })}>
          <option value="" selected={!configuredProject()}>{t("Alle prosjekter")}</option>
          <For each={scopes()?.value}>{scope => <option value={scope.id} selected={configuredProject() === scope.id}>{scope.name}</option>}</For>
        </select>
        <button type="button" class="icon-button github-refresh" aria-label={t("Hent på nytt")} title={t("Hent på nytt")} onClick={() => void refresh()}><IconReload size={16} /></button>
      </div>
      <Show when={scopes()?.value}>
        {value => <p class="github-room-source"><IconGlobe size={14} />{plural(configuredProject() ? 1 : value().length,
          "GitHub · github.com · {count} prosjekt", "GitHub · github.com · {count} prosjekter")}</p>}
      </Show>
      <Show when={props.status?.error ?? scopes()?.error}>{error => <Failure error={error()} retry={refresh} />}</Show>
      <Show when={!props.status || scopes.loading}>
        <SkeletonRows label={t("Henter…")} />
      </Show>
      <Show when={props.status?.value && !props.status.value.connected}>
        <Failure error={{ code: "not-connected", message: t("Koble til GitHub i Innstillinger for å se pull requests og issues.") }} retry={refresh} />
      </Show>
      <Show when={props.status?.value?.connected && scopes()?.value && !scopes()!.value!.length}>
        <p class="github-room-empty">{t("Ingen prosjekter har en remote på GitHub.")}</p>
      </Show>
      <Show when={source()}>
        <Show when={page.error()}>{error => <Failure error={error()} retry={() => page.next() ? page.more() : page.refresh()} />}</Show>
        <Show when={page.loading() && !page.items().length}><SkeletonRows label={t("Henter…")} /></Show>
        <Show when={!page.loading() && !page.error() && !page.items().length}>
          <p class="github-room-empty">{t("Ingen treff med disse filtrene.")}</p>
        </Show>
        <ul class="github-room-list" aria-label={githubTitle(props.kind)}>
          <For each={page.items()}>{item => (
            <li>
              <button type="button" class="github-room-row" onClick={() => showGitHubDetail({ kind: item.kind, number: item.number, repo: item.repo })}>
                <StateIcon item={item} />
                <span class="github-row-body">
                  <span class="github-row-title"><span class="muted tabular">#{item.number}</span> {item.title}</span>
                  <span class="github-row-meta">
                    <Author login={item.author} avatarId={item.avatarId} />
                    <Show when={!configuredProject()}><span class="github-row-repo">{item.repo}</span></Show>
                    <Labels labels={item.labels} />
                  </span>
                </span>
                <span class="github-row-end">
                  <Show when={item.checks}>{status => <span class="github-ci" data-check={status()}>{checkTitle(status())}</span>}</Show>
                  <Show when={item.comments > 0}>
                    <span class="github-comments tabular" aria-label={plural(item.comments, "{count} kommentar", "{count} kommentarer")}><IconChat size={13} />{item.comments}</span>
                  </Show>
                  <Show when={dateAt(item.updatedAt)}><time datetime={item.updatedAt} title={dateAt(item.updatedAt)}>{relativeTime(Date.parse(item.updatedAt))}</time></Show>
                </span>
              </button>
            </li>
          )}</For>
        </ul>
        <PageMore page={page} />
      </Show>
    </>
  );
}

function refUrl(path: string, ref: GitHubReference) {
  return `/api/github/${path}/${ref.kind}?${new URLSearchParams({ repo: ref.repo, number: String(ref.number) })}`;
}

function pullDiff(patch: string) {
  return patch.split("\n").flatMap<DiffLineInfo>(line => {
    if (line.startsWith("+")) return [{ kind: "add" as const, text: line.slice(1) }];
    if (line.startsWith("-")) return [{ kind: "del" as const, text: line.slice(1) }];
    if (line.startsWith(" ")) return [{ kind: "same" as const, text: line.slice(1) }];
    return line ? [{ kind: "same" as const, text: line }] : [];
  });
}

function ChangedFile(props: { file: GitHubFile }) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <details class="github-file" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <code>{props.file.previousName ? `${props.file.previousName} → ` : ""}{props.file.name}</code>
        <span class="diff-add-count">+{props.file.additions}</span><span class="diff-del-count">−{props.file.deletions}</span>
      </summary>
      <Show when={expanded()}>
        <Show when={props.file.patch} fallback={<p class="muted">{t("GitHub har ingen tekst-diff for denne filen.")}</p>}>
          {patch => <DiffView lines={pullDiff(patch())} label={props.file.name} />}
        </Show>
      </Show>
    </details>
  );
}

const DETAIL_TABS = ["timeline", "files"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function DetailRoom(props: { reference: GitHubReference; revision?: number; onStart?: (thread: Thread) => void }) {
  const [part, setPart] = createSignal<DetailTab>("timeline");
  const [detail, { refetch }] = createResource<Result<GitHubDetail>, { reference: GitHubReference; revision?: number }>(
    () => ({ reference: props.reference, revision: props.revision }),
    ({ reference }, { refetching }) => load<GitHubDetail>(`${refUrl("detail", reference)}&refresh=${refetching === true ? "1" : "0"}`),
  );
  const comments = usePages<GitHubComment>(() => !!detail()?.value && refUrl("comments", props.reference));
  const files = usePages<GitHubFile>(() => part() === "files" && refUrl("files", props.reference));
  const [starting, setStarting] = createSignal(false);

  const start = async (item: GitHubDetail, projectId: string) => {
    if (starting()) return;
    setStarting(true);
    try {
      const thread = await createThreadFor(projectId, null, { code: true });
      deliverToComposer(thread.id, { text: `#${item.number} ${item.title}\n${item.url}`, images: [] });
      closeGitHubRoom();
      if (props.onStart) props.onStart(thread);
      else {
        setStudioOpen(false);
        await openThread(thread);
      }
    } catch (err) { report(err); }
    finally { setStarting(false); }
  };

  return (
    <div class="github-detail">
      <Show when={detail.loading && !detail()}><SkeletonRows label={t("Henter…")} /></Show>
      <Show when={detail()?.error}>{error => <Failure error={error()} retry={refetch} />}</Show>
      <Show when={detail()?.value}>{item => {
        const projectIds = createMemo(() => item().projectIds.filter(id => !!app.projects[id] && !app.projects[id].folderMissing));
        const [selected, setSelected] = createSignal(projectIds().includes(currentProject()?.id ?? "") ? currentProject()!.id : projectIds()[0]);
        return <>
          <div class="github-detail-heading">
            <h2><StateIcon item={item()} /> <span>{item().title} <small>#{item().number}</small></span></h2>
            <p class="github-row-meta">
              <span>{item().repo}</span><span>{stateTitle(item().state)}</span>
              <Author login={item().author} avatarId={item().avatarId} />
              <span>{t("Opprettet {date}", { date: dateAt(item().createdAt) })}</span>
              <span>{t("Oppdatert {date}", { date: dateAt(item().updatedAt) })}</span>
            </p>
            <Labels labels={item().labels} />
            <Show when={item().assignees.length}>
              <p>{t("Tildelt {users}", { users: item().assignees.join(", ") })}</p>
            </Show>
            <div class="github-detail-actions">
              <a class="btn btn-small" href={item().url} target="_blank" rel="noopener noreferrer"><IconGlobe size={14} />{t("Åpne på GitHub")}</a>
              <Show when={projectIds().length > 1}>
                <select class="input" aria-label={t("Prosjekt")} onChange={event => setSelected(event.currentTarget.value)}>
                  <For each={projectIds()}>{id => <option value={id} selected={selected() === id}>{app.projects[id]?.name}</option>}</For>
                </select>
              </Show>
              <Show when={selected() && projectIds().includes(selected()!)}>
                <button type="button" class="btn btn-small btn-primary" disabled={starting()} onClick={() => void start(item(), selected()!)}><IconCompose size={14} />{t("Start en Kode-tråd")}</button>
              </Show>
              <button type="button" class="icon-button" aria-label={t("Hent på nytt")} title={t("Hent på nytt")} onClick={() => { void refetch(true); if (part() === "files") void files.refresh(); else void comments.refresh(); }}><IconReload size={16} /></button>
            </div>
          </div>
          <Show when={item().pull}>{pull => <>
            <div class="github-pull-summary">
              <span><span aria-hidden="true"><code>{pull().base}</code> ← <code>{pull().head}</code></span><span class="sr-only">{t("Fra {head} til {base}", { head: pull().head, base: pull().base })}</span></span>
              <span>{reviewTitle(pull().review)}</span>
              <Show when={item().checks}>{status => <span class="github-ci" data-check={status()}>{checkTitle(status())}</span>}</Show>
            </div>
            <Show when={pull().checks.length}>
              <details class="github-check-list" open>
                <summary>{t("Sjekker")}</summary>
                <ul><For each={pull().checks}>{check => <li><span>{check.name}</span><span class="github-ci" data-check={check.status}>{checkTitle(check.status)}</span></li>}</For></ul>
              </details>
            </Show>
            <div class="segmented" role="tablist" aria-label={t("PR-detaljer")} onKeyDown={event => {
              let next: DetailTab;
              if (event.key === "Home") next = "timeline";
              else if (event.key === "End") next = "files";
              else if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = part() === "timeline" ? "files" : "timeline";
              else return;
              event.preventDefault();
              setPart(next);
              event.currentTarget.querySelector<HTMLButtonElement>(`#github-tab-${next}`)?.focus();
            }}>
              <For each={DETAIL_TABS}>{tab => (
                <button type="button" id={`github-tab-${tab}`} class="segment" role="tab" aria-selected={part() === tab}
                  aria-controls="github-detail-panel" tabIndex={part() === tab ? 0 : -1} onClick={() => setPart(tab)}>
                  {tab === "timeline" ? t("Samtale") : t("Filer")}
                </button>
              )}</For>
            </div>
          </>}</Show>
          <div class="github-detail-tabpanel" id="github-detail-panel" role={item().pull ? "tabpanel" : undefined}
            aria-labelledby={item().pull ? `github-tab-${part()}` : undefined}>
            <Show when={part() === "timeline"} fallback={
              <>
                <Show when={files.error()}>{error => <Failure error={error()} retry={() => files.next() ? files.more() : files.refresh()} />}</Show>
                <Show when={files.loading() && !files.items().length}><SkeletonRows label={t("Henter…")} /></Show>
                <Show when={!files.loading() && !files.error() && !files.items().length}><p class="muted">{t("Ingen endrede filer.")}</p></Show>
                <For each={files.items()}>{file => <ChangedFile file={file} />}</For>
                <PageMore page={files} />
              </>
            }>
              <article class="github-detail-body">
                <Show when={item().body} fallback={<p class="muted">{t("Ingen beskrivelse.")}</p>}>
                  <Markdown body={item().body} />
                </Show>
              </article>
              <h3>{t("Kommentarer")}</h3>
              <Show when={comments.error()}>{error => <Failure error={error()} retry={() => comments.next() ? comments.more() : comments.refresh()} />}</Show>
              <Show when={comments.loading() && !comments.items().length}><SkeletonRows label={t("Henter…")} /></Show>
              <Show when={!comments.loading() && !comments.error() && !comments.items().length}><p class="muted">{t("Ingen kommentarer.")}</p></Show>
              <For each={comments.items()}>{comment => (
                <article class="github-detail-comment">
                  <header class="github-row-meta">
                    <Author login={comment.author} avatarId={comment.avatarId} />
                    <time datetime={comment.createdAt}>{dateAt(comment.createdAt)}</time>
                    <Show when={comment.review}>{review => <span>{reviewTitle(review())}</span>}</Show>
                    <Show when={comment.path}><code>{comment.path}</code></Show>
                  </header>
                  <Show when={comment.body}><Markdown body={comment.body} /></Show>
                </article>
              )}</For>
              <PageMore page={comments} />
            </Show>
          </div>
        </>;
      }}</Show>
    </div>
  );
}

export default function GitHubRoom(props: { kind: GitHubKind; onStart?: (thread: Thread) => void }) {
  const [listMounted, mountList] = createSignal(!githubRoom()?.detail);
  const [settingsRevision, setSettingsRevision] = createSignal(0);
  const [status, { refetch }] = createResource(
    () => ({ method: app.settings.githubAuth, settingsRevision: settingsRevision() }),
    () => load<GitHubStatus>("/api/github"),
  );
  createEffect(on(settingsOpen, (next, previous) => {
    if (!next && previous === "github") setSettingsRevision(n => n + 1);
  }, { defer: true }));
  const detail = () => githubRoom()?.detail;
  createEffect(() => { if (!detail()) mountList(true); });
  let title!: HTMLHeadingElement;
  onMount(() => title.focus());
  createEffect(on(detail, () => title.focus(), { defer: true }));

  return (
    <section class="github-room" aria-labelledby="github-room-title" data-testid="github-room">
      <header class="github-room-head">
        <Show when={detail()}>
          <button type="button" class="icon-button" title={t("Tilbake til listen")} aria-label={t("Tilbake til listen")} onClick={() => { mountList(true); showGitHubDetail(null); }}><IconBack size={17} /></button>
        </Show>
        <h1 id="github-room-title" tabindex="-1" ref={title}>{githubTitle(props.kind)}</h1>
        <button type="button" class="icon-button" title={t("Lukk")} aria-label={t("Lukk")} onClick={closeGitHubRoom}><IconClose size={17} /></button>
      </header>
      <Show when={listMounted()}>
        <div class="github-room-scroll" hidden={!!detail()}>
          <div class="github-room-content"><ListRoom kind={props.kind} initialProject={githubRoom()?.projectId} status={status()} reloadStatus={refetch} /></div>
        </div>
      </Show>
      <Show when={detail()} keyed>{reference => (
        <div class="github-room-scroll">
          <div class="github-room-content"><DetailRoom reference={reference} revision={settingsRevision()} onStart={props.onStart} /></div>
        </div>
      )}</Show>
    </section>
  );
}
