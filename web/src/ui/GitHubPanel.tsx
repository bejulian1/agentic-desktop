import { openGitHubRoom } from "../state/github";
import { lookupMessage, language, plural, t } from "../lib/i18n.ts";
// GitHub in the right panel (round 8, agent G): the project's repo from .git/config, and its
// open pull requests and issues, read only. A link opens in the Nettleser panel. The token never
// reaches the browser; the server asks GitHub and sends back only what is shown here.
import { createResource, createSignal, For, lazy, Match, onCleanup, Show, Suspense, Switch } from "solid-js";
import type { GitHubItem, GitHubProject, GitHubReference } from "../../../shared/protocol";
import { ApiError, get } from "../lib/api";
import { relativeTime } from "../lib/format";
import { send } from "../lib/socket";
import { app, setSettingsOpen } from "../state/app";
import { showPanel } from "../state/panel";
import { errorTitle, IconDraft, IconPullRequest, resetText } from "./GitHubShared";
import { IconBack, IconChat, IconGitHub, IconGlobe, IconIssue, IconReload } from "./icons";
import { IconExpand } from "./nav-icons";
import { ProjectGlyph } from "./ProjectGlyph";
import { Rich } from "./settings/parts";

// One pull request or issue in the panel itself: title, checks, description, files and comments,
// the same view as in the full GitHub room, loaded when the first one is opened.
const GitHubDetailView = lazy(() => import("./GitHubRoom").then((m) => ({ default: m.GitHubDetailView })));

export default function GitHubPanel(props: { projectId: string }) {
  const [refreshing, setRefreshing] = createSignal(false);
  const [list, setList] = createSignal<"pulls" | "issues">("pulls");
  // The pull request or issue open in the panel, or none (the list).
  const [selected, setSelected] = createSignal<{ reference: GitHubReference; url: string } | null>(null);
  const [data, { mutate }] = createResource(
    () => props.projectId,
    async (id) => {
      try {
        return await get<GitHubProject>(`/api/projects/${id}/github`);
      } catch (err) {
        // Our own server is away: shown like GitHub being away, with Prøv igjen.
        if (err instanceof ApiError && err.status === 0) return { remote: null, status: { connected: false }, error: { code: "offline", message: err.message } } as GitHubProject;
        throw err;
      }
    },
  );
  const [now, setNow] = createSignal(Date.now());
  const clock = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(clock));

  const refresh = async () => {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      mutate(await get<GitHubProject>(`/api/projects/${props.projectId}/github?refresh=1`));
      setNow(Date.now());
    } catch (err) {
      mutate((old) => ({ ...(old ?? { remote: null, status: { connected: false } }), error: { code: "offline", message: (err as Error).message } }));
    } finally {
      setRefreshing(false);
    }
  };

  const openLink = (url: string) => {
    showPanel("browser");
    send({ type: "browser.navigate", projectId: props.projectId, url });
  };
  const show = (item: GitHubItem) => {
    const remote = data()?.remote;
    if (!remote) return;
    setSelected({ reference: { repo: `${remote.owner}/${remote.repo}`, kind: list() === "pulls" ? "pull" : "issues", number: item.number }, url: item.url });
  };

  // The same limit as relativeTime()'s «nå». Outside Norwegian relativeTime() answers with a whole
  // phrase («5 min. ago»), so {time} in these texts is translated as that phrase alone.
  const justNow = (at: number) => Math.round((now() - at) / 60_000) < 1;
  const items = (): GitHubItem[] => (list() === "pulls" ? data()?.pulls : data()?.issues) ?? [];
  const updated = (item: GitHubItem) => {
    const at = Date.parse(item.updatedAt);
    if (!Number.isFinite(at)) return "";
    return justNow(at) ? t("oppdatert nå") : t("oppdatert for {time} siden", { time: relativeTime(at, now()) });
  };

  return (
    <div class="github-panel" data-testid="github-panel">
      <div class="github-head">
        <span class="github-title"><IconGitHub size={15} />GitHub</span>
        <Show when={app.projects[props.projectId]}>{(project) => <span class="github-project" title={project().name} data-testid="github-project-glyph"><ProjectGlyph project={project()} size={14} /></span>}</Show>
        <Show when={data()?.remote}>
          <button type="button" class="github-repo" title={t("Åpne {url} i Nettleser", { url: data()!.remote!.url })} onClick={() => openLink(data()!.repo?.url ?? data()!.remote!.url)}>
            <span class="github-owner">{data()!.remote!.owner}/</span><span class="github-name">{data()!.remote!.repo}</span>
          </button>
        </Show>
        <span class="spacer" />
        <Show when={data()?.fetchedAt}><span class="github-fetched" title={t("Svarene huskes i ett minutt")}>{justNow(data()!.fetchedAt!) ? t("Hentet nå") : t("Hentet for {time} siden", { time: relativeTime(data()!.fetchedAt!, now()) })}</span></Show>
        <Show when={data()?.remote}>
          <button type="button" class="icon-button" classList={{ spinning: refreshing() }} title={t("Hent på nytt fra GitHub")} aria-label={t("Hent på nytt")} disabled={refreshing()} onClick={() => void refresh()}><IconReload size={14} /></button>
        </Show>
      </div>

      <Switch>
        <Match when={data.loading && !data()}>
          <div class="github-skeleton" role="status" aria-label={t("Henter fra GitHub")}>
            <For each={[1, 2, 3, 4]}>{() => <div class="github-skeleton-row"><span class="skeleton skeleton-line" /><span class="skeleton skeleton-line short" /></div>}</For>
          </div>
        </Match>
        <Match when={data.error}>
          <div class="panel-empty">{t("Kunne ikke lese GitHub-oppsettet: {message}", { message: (data.error as Error).message })}</div>
        </Match>
        <Match when={data() && !data()!.remote}>
          <div class="github-empty">
            <IconPullRequest size={20} />
            <p class="github-empty-title">{data()!.error?.code === "offline" ? t("Ingen kontakt med serveren") : t("Ikke et GitHub-repo")}</p>
            <p>{data()!.error?.code === "offline" ? lookupMessage(data()!.error!.message) : lookupMessage(data()!.reason)}</p>
            <p class="muted"><Rich text={t("Repoet leses fra {file} i prosjektmappen. Appen kjører aldri git-kommandoer.")} parts={{ file: <code>.git/config</code> }} /></p>
            <Show when={data()!.error?.code === "offline"}><button type="button" class="btn btn-small" onClick={() => void refresh()}>{t("Prøv igjen")}</button></Show>
          </div>
        </Match>
        <Match when={data()}>
          <Show when={data()!.repo}>
            <div class="github-about">
              <Show when={data()!.repo!.description}><p>{data()!.repo!.description}</p></Show>
              <span class="github-facts">
                <span>{data()!.repo!.private ? t("Privat") : t("Offentlig")}</span>
                <span><Rich text={t("Standardgren {branch}")} parts={{ branch: <code>{data()!.repo!.defaultBranch}</code> }} /></span>
                <span class="tabular">{plural(data()!.repo!.stars, "{n} stjerne", "{n} stjerner", { n: data()!.repo!.stars.toLocaleString(language()) })}</span>
              </span>
            </div>
          </Show>
          <Show when={data()!.error}>
            {(error) => (
              <div class="github-error" role="alert" data-code={error().code}>
                <strong>{errorTitle(error())}</strong>
                <span>{error().code === "rate-limit" ? `${lookupMessage(error().message)} ${resetText(error().resetAt, now())}` : lookupMessage(error().message)}</span>
                <span class="github-error-actions">
                  <Show when={error().code === "not-connected" || error().code === "bad-token"}>
                    <button type="button" class="btn btn-small btn-primary" onClick={() => setSettingsOpen("github")}>{error().code === "not-connected" ? t("Koble til…") : t("Nytt token…")}</button>
                  </Show>
                  <Show when={error().code !== "not-connected"}>
                    <button type="button" class="btn btn-small" disabled={refreshing()} onClick={() => void refresh()}>{t("Prøv igjen")}</button>
                  </Show>
                </span>
              </div>
            )}
          </Show>
          <Show when={selected()} keyed>
            {(open) => (
              <div class="github-inline" data-testid="github-inline">
                <div class="github-inline-bar">
                  <button type="button" class="btn btn-small btn-ghost" onClick={() => setSelected(null)}><IconBack size={14} />{t("Tilbake")}</button>
                  <span class="spacer" />
                  <button type="button" class="btn btn-small" title={t("Åpne {url} i Nettleser", { url: open.url })} onClick={() => openLink(open.url)}><IconGlobe size={13} />{t("Åpne i Nettleser")}</button>
                  <button type="button" class="btn btn-small" title={t("Åpne i hele vinduet")} onClick={() => openGitHubRoom(open.reference.kind, props.projectId, open.reference)}><IconExpand size={13} />{t("Åpne i fullvisning")}</button>
                </div>
                <Suspense fallback={<div class="github-skeleton" role="status" aria-label={t("Henter fra GitHub")}><div class="github-skeleton-row"><span class="skeleton skeleton-line" /><span class="skeleton skeleton-line short" /></div></div>}>
                  <GitHubDetailView reference={open.reference} />
                </Suspense>
              </div>
            )}
          </Show>
          <Show when={!selected() && (data()!.pulls || data()!.issues)}>
            <div class="segmented github-switch" role="group" aria-label={t("Liste")}>
              <button type="button" class="segment" aria-pressed={list() === "pulls"} onClick={() => setList("pulls")}>{t("Pull requests")}<span class="count">{data()!.pulls?.length ?? 0}</span></button>
              <button type="button" class="segment" aria-pressed={list() === "issues"} onClick={() => setList("issues")}>{t("Issues")}<span class="count">{data()!.issues?.length ?? 0}</span></button>
            </div>
            <ul class="github-list" aria-label={list() === "pulls" ? t("Åpne pull requests") : t("Åpne issues")}>
              <For each={items()} fallback={<li class="github-none">{list() === "pulls" ? t("Ingen åpne pull requests.") : t("Ingen åpne issues.")}</li>}>
                {(item) => (
                  <li>
                    <button type="button" class="github-item" title={`${item.title}\n${t("Vis her i panelet")}`} onClick={() => show(item)}>
                      <span class="github-item-icon" data-kind={list() === "pulls" ? (item.draft ? "draft" : "pull") : "issue"}>
                        {list() === "pulls" ? (item.draft ? <IconDraft size={15} /> : <IconPullRequest size={15} />) : <IconIssue size={15} />}
                      </span>
                      <span class="github-item-body">
                        <span class="github-item-title">{item.title}</span>
                        <span class="github-item-meta">
                          <span class="tabular">#{item.number}</span>
                          <Show when={item.author}><span>{item.author}</span></Show>
                          <span>{updated(item)}</span>
                          <Show when={item.draft}><span class="pill github-draft">{t("Utkast")}</span></Show>
                          <Show when={item.head}><code class="github-branch" title={t("Gren: {branch}", { branch: item.head ?? "" })}>{item.head}</code></Show>
                        </span>
                        <Show when={item.labels.length}>
                          <span class="github-labels">
                            <For each={item.labels}>{(label) => <span class="github-label" style={`--label:#${label.color}`}>{label.name}</span>}</For>
                          </span>
                        </Show>
                      </span>
                      <Show when={item.comments}>
                        <span class="github-comments tabular" title={plural(item.comments ?? 0, "{count} kommentar", "{count} kommentarer")}><IconChat size={12} />{item.comments}</span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <button type="button" class="btn btn-small btn-ghost github-all" onClick={() => openLink(`${data()!.remote!.url}/${list() === "pulls" ? "pulls" : "issues"}`)}>
              <IconGitHub size={13} />{t("Alle på GitHub")}
            </button>
            <button type="button" class="btn btn-small btn-ghost" onClick={() => openGitHubRoom(list() === "pulls" ? "pull" : "issues", props.projectId ?? undefined)}>{t("Vis i appen")}</button>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}
