// GitHub (Beta) in the right panel (round 8, agent G): the project's repo from .git/config, and its
// open pull requests and issues, read only. A link opens in the Nettleser panel. The token never
// reaches the browser; the server asks GitHub and sends back only what is shown here.
import { createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import type { GitHubItem, GitHubProject } from "../../../shared/protocol";
import { ApiError, get } from "../lib/api";
import { relativeTime } from "../lib/format";
import { send } from "../lib/socket";
import { setSettingsOpen } from "../state/app";
import { showPanel } from "../state/panel";
import { errorTitle, IconDraft, IconIssue, IconPullRequest, resetText } from "./GitHubShared";
import { IconChat, IconGlobe, IconReload } from "./icons";

const memory = new Map<string, "pulls" | "issues">();

export default function GitHubPanel(props: { projectId: string }) {
  const [refreshing, setRefreshing] = createSignal(false);
  const [list, setList] = createSignal<"pulls" | "issues">(memory.get(props.projectId) ?? "pulls");
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

  const choose = (value: "pulls" | "issues") => {
    memory.set(props.projectId, value);
    setList(value);
  };

  const openLink = (url: string) => {
    showPanel("browser");
    send({ type: "browser.navigate", projectId: props.projectId, url });
  };

  const items = (): GitHubItem[] => (list() === "pulls" ? data()?.pulls : data()?.issues) ?? [];
  const updated = (item: GitHubItem) => {
    const at = Date.parse(item.updatedAt);
    return Number.isFinite(at) ? `oppdatert ${relativeTime(at, now()) === "nå" ? "nå" : `for ${relativeTime(at, now())} siden`}` : "";
  };

  return (
    <div class="github-panel" data-testid="github-panel">
      <div class="github-head">
        <span class="github-title">GitHub<span class="beta-badge" title="Bare lesing. Prøvd mot en lokal testserver, ennå ikke mot github.com.">Beta</span></span>
        <Show when={data()?.remote}>
          <button type="button" class="github-repo" title={`Åpne ${data()!.remote!.url} i Nettleser`} onClick={() => openLink(data()!.repo?.url ?? data()!.remote!.url)}>
            <span class="github-owner">{data()!.remote!.owner}/</span><span class="github-name">{data()!.remote!.repo}</span>
          </button>
        </Show>
        <span class="spacer" />
        <Show when={data()?.fetchedAt}><span class="github-fetched" title="Svarene huskes i ett minutt">{relativeTime(data()!.fetchedAt!, now()) === "nå" ? "Hentet nå" : `Hentet for ${relativeTime(data()!.fetchedAt!, now())} siden`}</span></Show>
        <Show when={data()?.remote}>
          <button type="button" class="icon-button" classList={{ spinning: refreshing() }} title="Hent på nytt fra GitHub" aria-label="Hent på nytt" disabled={refreshing()} onClick={() => void refresh()}><IconReload size={14} /></button>
        </Show>
      </div>

      <Switch>
        <Match when={data.loading && !data()}>
          <div class="github-skeleton" role="status" aria-label="Henter fra GitHub">
            <For each={[1, 2, 3, 4]}>{() => <div class="github-skeleton-row"><span class="skeleton skeleton-line" /><span class="skeleton skeleton-line short" /></div>}</For>
          </div>
        </Match>
        <Match when={data.error}>
          <div class="panel-empty">Kunne ikke lese GitHub-oppsettet: {(data.error as Error).message}</div>
        </Match>
        <Match when={data() && !data()!.remote}>
          <div class="github-empty">
            <IconPullRequest size={20} />
            <p class="github-empty-title">{data()!.error?.code === "offline" ? "Ingen kontakt med serveren" : "Ikke et GitHub-repo"}</p>
            <p>{data()!.error?.code === "offline" ? data()!.error!.message : data()!.reason}</p>
            <p class="muted">Repoet leses fra <code>.git/config</code> i prosjektmappen. Appen kjører aldri git-kommandoer.</p>
            <Show when={data()!.error?.code === "offline"}><button type="button" class="btn btn-small" onClick={() => void refresh()}>Prøv igjen</button></Show>
          </div>
        </Match>
        <Match when={data()}>
          <Show when={data()!.repo}>
            <div class="github-about">
              <Show when={data()!.repo!.description}><p>{data()!.repo!.description}</p></Show>
              <span class="github-facts">
                <span>{data()!.repo!.private ? "Privat" : "Offentlig"}</span>
                <span>Standardgren <code>{data()!.repo!.defaultBranch}</code></span>
                <span class="tabular">{data()!.repo!.stars.toLocaleString("nb-NO")} {data()!.repo!.stars === 1 ? "stjerne" : "stjerner"}</span>
              </span>
            </div>
          </Show>
          <Show when={data()!.error}>
            {(error) => (
              <div class="github-error" role="alert" data-code={error().code}>
                <strong>{errorTitle(error())}</strong>
                <span>{error().code === "rate-limit" ? `${error().message} ${resetText(error().resetAt, now())}` : error().message}</span>
                <span class="github-error-actions">
                  <Show when={error().code === "not-connected" || error().code === "bad-token"}>
                    <button type="button" class="btn btn-small btn-primary" onClick={() => setSettingsOpen("github")}>{error().code === "not-connected" ? "Koble til…" : "Nytt token…"}</button>
                  </Show>
                  <Show when={error().code !== "not-connected"}>
                    <button type="button" class="btn btn-small" disabled={refreshing()} onClick={() => void refresh()}>Prøv igjen</button>
                  </Show>
                </span>
              </div>
            )}
          </Show>
          <Show when={data()!.pulls || data()!.issues}>
            <div class="segmented github-switch" role="group" aria-label="Liste">
              <button type="button" class="segment" aria-pressed={list() === "pulls"} onClick={() => choose("pulls")}>Pull requests<span class="count">{data()!.pulls?.length ?? 0}</span></button>
              <button type="button" class="segment" aria-pressed={list() === "issues"} onClick={() => choose("issues")}>Issues<span class="count">{data()!.issues?.length ?? 0}</span></button>
            </div>
            <ul class="github-list" aria-label={list() === "pulls" ? "Åpne pull requests" : "Åpne issues"}>
              <For each={items()} fallback={<li class="github-none">{list() === "pulls" ? "Ingen åpne pull requests." : "Ingen åpne issues."}</li>}>
                {(item) => (
                  <li>
                    <button type="button" class="github-item" title={`${item.title}\nÅpnes i Nettleser`} onClick={() => openLink(item.url)}>
                      <span class="github-item-icon" data-kind={list() === "pulls" ? (item.draft ? "draft" : "pull") : "issue"}>
                        {list() === "pulls" ? (item.draft ? <IconDraft size={15} /> : <IconPullRequest size={15} />) : <IconIssue size={15} />}
                      </span>
                      <span class="github-item-body">
                        <span class="github-item-title">{item.title}</span>
                        <span class="github-item-meta">
                          <span class="tabular">#{item.number}</span>
                          <Show when={item.author}><span>{item.author}</span></Show>
                          <span>{updated(item)}</span>
                          <Show when={item.draft}><span class="pill github-draft">Utkast</span></Show>
                          <Show when={item.head}><code class="github-branch" title={`Gren: ${item.head}`}>{item.head}</code></Show>
                        </span>
                        <Show when={item.labels.length}>
                          <span class="github-labels">
                            <For each={item.labels}>{(label) => <span class="github-label" style={`--label:#${label.color}`}>{label.name}</span>}</For>
                          </span>
                        </Show>
                      </span>
                      <Show when={item.comments}>
                        <span class="github-comments tabular" title={`${item.comments} ${item.comments === 1 ? "kommentar" : "kommentarer"}`}><IconChat size={12} />{item.comments}</span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <button type="button" class="btn btn-small btn-ghost github-all" onClick={() => openLink(`${data()!.remote!.url}/${list() === "pulls" ? "pulls" : "issues"}`)}>
              <IconGlobe size={13} />Alle på GitHub
            </button>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}
