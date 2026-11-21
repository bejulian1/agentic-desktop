import { language } from "../lib/i18n.ts";
import {setModsOpen} from '../state/ui-mods';
import {useTokenTooltip} from "./TokenTooltip";
// The start page of an empty pane. Chat: a greeting and example cards. Kode, with or without a
// project (round 11b, SPEC 25.2), shows one of three starts chosen in Innstillinger → Kode:
//   Tekst: the mark and the question, in Liten, Middels or Stor, scaled with the pane (SPEC 24.1)
//   Token-historikk: the question, and the token calendar and graph from Innstillinger → Bruk
//   Prosjektboks: the question, and one box with recent projects (or the project's threads),
//                 the local environment, and a row for GitHub at the bottom
// The project name in the question opens the project picker. The statistics only fetch when shown.
import { createEffect, createMemo, createResource, For, Match, Show, Switch } from "solid-js";
import type { GitHubProject, GitHubStatus, HomeStats, Project, Thread } from "../../../shared/protocol";
import { get } from "../lib/api";
import { showPanel } from "../state/panel";
import { formatTokens } from "../lib/format";
import { app, modelFor, setFolderPickerOpen, setSettingsOpen, sortedProjects } from "../state/app";
import { homeStats, loadHomeStats, runsFinished } from "../state/home";
import { chatProjectFor, openThread } from "../state/navigate";
import { startTemporaryChat, trackTemporary } from "./ChatTools";
import { chooseProject, openProjectPicker, shortPath } from "./Composer";
import { IconPalette, IconChat, IconCode, IconChevron, IconClock, IconLaptop, IconMark, IconSpark } from "./icons";
import { IconFolderPlus } from "./nav-icons";
import { ProjectGlyph } from "./ProjectGlyph";
import { shortTime } from "./rows";

// Ways to start in Kode. The demo model knows its own three; a real model gets ordinary tasks.
// A click fills the message field, it does not send.
const STARTERS_DEMO: Array<{ title: string; text: string; prompt: string }> = [
  { title: "Lag en side", text: "En liten HTML-side, med godkjenning før hver fil", prompt: "lag en side" },
  { title: "Samarbeid", text: "To tråder deler arbeidet med en oversikt", prompt: "samarbeid om en oversikt" },
  { title: "Hjelp", text: "Hva demo-modellen og appen kan gjøre", prompt: "hjelp" },
];
const STARTERS_CODE: Array<{ title: string; text: string; prompt: string }> = [
  { title: "Forklar prosjektet", text: "Hva det gjør, og hvordan det er bygget opp", prompt: "Gi meg en oversikt over prosjektet: hva det gjør, og hvordan koden er bygget opp." },
  { title: "Finn en feil", text: "Beskriv hva som skjer, så leter modellen", prompt: "Hjelp meg å finne en feil: " },
  { title: "Skriv tester", text: "For koden som mangler tester", prompt: "Finn kode som mangler tester, og skriv tester for den." },
];
// Example cards on the Chat start page. A click fills the message field, it does not send.
const EXAMPLES_CHAT: Array<{ title: string; text: string; prompt: string }> = [
  { title: "Lag et lite spill", text: "Et HTML-spill i én fil som kan spilles med en gang", prompt: "Lag et lite html-spill jeg kan spille i nettleseren" },
  { title: "Vis et kodeeksempel", text: "En funksjon i TypeScript og Python, med forklaring", prompt: "Vis et kodeeksempel i TypeScript og Python" },
  { title: "Forklar kode", text: "Lim inn kode og få den forklart steg for steg", prompt: "Forklar hvordan denne koden virker:\n\n" },
  { title: "Hva kan du?", text: "Se hva modellen og appen kan gjøre", prompt: "hjelp" },
];

// Rough token counts (about 1.35 tokens per word) for the sentence under the map.
const BOOKS: Array<[number, string]> = [
  [1_500, "et langt dikt"],
  [9_000, "en novelle av Tsjekhov"],
  [23_000, "Den lille prinsen"],
  [40_000, "Dyrenes gård"],
  [80_000, "Fluenes herre"],
  [128_000, "Hobbiten"],
  [165_000, "Stolthet og fordom"],
  [280_000, "Moby Dick"],
  [650_000, "Ringenes herre"],
  [790_000, "Krig og fred"],
  [1_460_000, "hele Harry Potter-serien"],
];

export function bookLine(tokens: number): string {
  if (tokens <= 0) return "Ingen tokens ennå. Send en melding, så begynner tellingen.";
  if (tokens < BOOKS[0][0]) return `Du har brukt ${formatTokens(tokens)} tokens, omtrent som et kort dikt.`;
  const [biggest, title] = BOOKS.at(-1)!;
  if (tokens >= biggest * 2) return `Du har brukt omtrent ${Math.round(tokens / biggest)} ganger så mange tokens som ${title}.`;
  const book = [...BOOKS].reverse().find(([count]) => tokens >= count)!;
  return `Du har brukt omtrent like mange tokens som ${book[1]}.`;
}

const CELL = 11;
const GAP = 3;
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(language(), { day: "numeric", month: "short" });

// One SVG for half a year: a column per week, a row per weekday. Levels are quartiles of the
// days that have any use, so one big day does not wash out the rest.
function HeatMap(props: { heat: HomeStats["heat"] }) {
  const tip=useTokenTooltip();
  const levels = createMemo(() => {
    const used = props.heat.map((d) => d.tokens + d.runs).filter((v) => v > 0).sort((a, b) => a - b);
    const at = (q: number) => used[Math.min(used.length - 1, Math.floor(q * used.length))] ?? 0;
    return [at(0.25), at(0.5), at(0.75)];
  });
  const level = (value: number) => {
    if (value <= 0) return 0;
    const [a, b, c] = levels();
    return value <= a ? 1 : value <= b ? 2 : value <= c ? 3 : 4;
  };
  const weeks = () => Math.ceil(props.heat.length / 7);
  return (
    <>{tip.tooltip()}<svg
      class="heat-map"
      viewBox={`0 0 ${weeks() * (CELL + GAP) - GAP} ${7 * (CELL + GAP) - GAP}`}
      role="img"
      aria-label="Aktivitet per dag det siste halve året"
    >
      <For each={props.heat}>
        {(day, i) => (
          <rect
            x={Math.floor(i() / 7) * (CELL + GAP)}
            y={(i() % 7) * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={2.5}
            class={`heat-${level(day.tokens + day.runs)}`}
           {...tip.bind(day.date,day.tokens,false,i()===0)} />
        )}
      </For>
    </svg></>
  );
}

const BAR_DAYS = 30;
const BAR_W = 8;
const BAR_GAP = 3;
const BAR_H = 40;

// The last 30 days as bars, tokens per day. A day without use is a short, quiet stub, so the row
// still reads as a timeline.
function TokenBars(props: { heat: HomeStats["heat"] }) {
  const days = () => props.heat.slice(-BAR_DAYS);
  const max = () => Math.max(1, ...days().map((d) => d.tokens));
  return (
    <svg class="token-bars" viewBox={`0 0 ${BAR_DAYS * (BAR_W + BAR_GAP) - BAR_GAP} ${BAR_H}`} preserveAspectRatio="none" role="img" aria-label="Tokens per dag de siste 30 dagene">
      <For each={days()}>
        {(day, i) => {
          const h = () => (day.tokens > 0 ? Math.max(3, (day.tokens / max()) * BAR_H) : 2);
          return (
            <rect x={i() * (BAR_W + BAR_GAP)} y={BAR_H - h()} width={BAR_W} height={h()} rx={2} class={day.tokens > 0 ? "token-bar" : "token-bar empty"}>
              <title>{`${dayLabel(day.date)}: ${formatTokens(day.tokens)} tokens`}</title>
            </rect>
          );
        }}
      </For>
    </svg>
  );
}

const RECENT = 3;

// Chat: the last chats with something in them, for Fortsett der du slapp.
function RecentChats(props: { exclude: string }) {
  const recent = createMemo(() =>
    Object.values(app.threads)
      .filter((t): t is Thread => !!t && !t.projectId && !t.archived && !t.temporary && t.id !== props.exclude && t.title !== "Ny tråd")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENT),
  );
  return (
    <Show when={recent().length}>
      <nav class="home-recent" aria-label="Fortsett der du slapp" data-testid="home-recent">
        <h3 class="home-recent-label">Fortsett der du slapp</h3>
        <For each={recent()}>
          {(thread) => (
            <button type="button" class="home-recent-item" title={thread.title} onClick={() => void openThread(thread)}>
              <span class="home-recent-mode" role="img" aria-label={thread.mode === "code" ? "Kode" : "Chat"} title={thread.mode === "code" ? "Kode" : "Chat"}><Show when={thread.mode === "code"} fallback={<IconChat size={15} />}><IconCode size={15} /></Show></span>
              <span class="home-recent-title">{thread.title}</span>
              <span class="home-recent-time">{shortTime(thread.updatedAt)}</span>
            </button>
          )}
        </For>
      </nav>
    </Show>
  );
}

export function Home(props: { projectId: string | null; code?: boolean; paneKey: string; onPick: (text: string) => void }) {
  const project = () => (props.projectId ? app.projects[props.projectId] : undefined);
  const name = () => app.settings.profileName?.trim().split(/\s+/)[0];
  const demo = () => modelFor(null)?.providerId === "mock";
  // paneKey is the thread's id once the pane has one.
  const temporary = () => app.threads[props.paneKey]?.temporary === true;
  trackTemporary(() => props.paneKey);
  const chatProject = () => {
    const id = app.threads[props.paneKey]?.chatProjectId ?? chatProjectFor(props.paneKey);
    return id ? app.chatProjects[id] : undefined;
  };
  return (
    <Show when={!project() && !props.code} fallback={<CodeHome project={project()} paneKey={props.paneKey} onPick={props.onPick} />}>
      <div class="pane-empty home-chat" data-testid="pane-empty">
        <div class="home-column">
          <Show
            when={!temporary()}
            fallback={
              <>
                <span class="temp-badge" data-testid="temp-badge"><IconClock size={13} />Midlertidig chat</span>
                <h2 class="home-greeting">Denne chatten beholdes midlertidig</h2>
                <p class="home-note muted">Den står ikke i søket, og den slettes når du lukker den eller går til en annen chat. Står den urørt i to timer, slettes den også.</p>
              </>
            }
          >
            <Show when={chatProject()} fallback={<h2 class="home-greeting">{name() ? `Hva skjer nå, ${name()}?` : "Hva skjer nå?"}</h2>}>
              {(cp) => (
                <>
                  <span class="home-chat-project" data-testid="home-chat-project"><ProjectGlyph project={cp()} size={14} />{cp().name}</span>
                  <h2 class="home-greeting">Ny chat i {cp().name}</h2>
                </>
              )}
            </Show>
          </Show>
          <div class="examples" data-testid="examples">
            {EXAMPLES_CHAT.map((ex) => (
              <button type="button" class="example" onClick={() => props.onPick(ex.prompt)}>
                <span class="example-title">{ex.title}</span>
                <span class="example-text">{ex.text}</span>
              </button>
            ))}
          </div>
          <Show when={!temporary()}>
            <RecentChats exclude={props.paneKey} />
            <div class="home-actions"><button class="btn btn-small btn-quiet" onClick={()=>setModsOpen(true)}><IconPalette size={14}/> Tema og bakgrunn</button>
              <button type="button" class="btn btn-small" title="En chat som ikke lagres i historikken, og som slettes når du lukker den" onClick={() => void startTemporaryChat()}>
                <IconClock size={14} />Midlertidig chat
              </button>
            </div>
          </Show>
          <Show when={demo()}><p class="home-demo muted">Demo-modellen svarer uten API-nøkkel.</p></Show>
        </div>
      </div>
    </Show>
  );
}

// Kode, with or without a project. The question is the same in all three starts; with Token-historikk
// and Prosjektboks it is a size down, so the card or the box is what the eye lands on.
function CodeHome(props: { project?: Project; paneKey: string; onPick: (text: string) => void }) {
  const choice = () => app.settings.codeStart ?? "text";
  return (
    <div
      class="pane-empty home-code home-start"
      classList={{ "home-local": !props.project }}
      data-start={choice()}
      data-size={choice() === "text" ? (app.settings.codeStartSize ?? "medium") : "compact"}
      data-testid="pane-empty"
    >
      <div class="home-hero">
        <span class="home-mark"><IconMark size={44} /></span>
        <h2 class="home-title">
          <Show when={props.project} fallback="Hva skal vi bygge?">
            {(project) => (
              <>
                Hva skal vi jobbe med i{" "}
                <button type="button" class="home-project" title="Bytt prosjekt" onClick={() => openProjectPicker(props.paneKey)}>{project().name}</button>?
              </>
            )}
          </Show>
        </h2>
      </div>
      <Switch>
        <Match when={choice() === "tokens"}><TokenHistory /></Match>
        <Match when={choice() === "projects"}><ProjectBox project={props.project} paneKey={props.paneKey} onPick={props.onPick} /></Match>
      </Switch>
    </div>
  );
}

// Token-historikk: the half-year calendar and the last 30 days, from the same numbers as
// Innstillinger → Bruk. Fetched when shown, and again when a run has ended.
function TokenHistory() {
  createEffect(() => {
    runsFinished();
    loadHomeStats("all");
  });
  const stats = () => homeStats("all");
  return (
    <section class="home-box home-tokens" data-testid="home-tokens" aria-label="Token-historikk">
      <div class="home-box-head">
        <span class="home-box-label">Token-historikk</span>
        <button type="button" class="home-box-link" title="Hele statistikken i Innstillinger → Bruk" onClick={() => setSettingsOpen("usage")}>Mer i Bruk</button>
      </div>
      <Show
        when={stats()}
        fallback={
          <div class="home-tokens-body" role="status">
            <span class="sr-only">Henter statistikk…</span>
            <div class="skeleton home-tokens-skeleton" aria-hidden="true" />
          </div>
        }
      >
        {(s) => (
          <div class="home-tokens-body">
            <div class="home-tokens-figures">
              <span class="home-tokens-total" data-testid="home-tokens-total">{formatTokens(s().totalTokens)}<small> tokens</small></span>
              <span class="home-tokens-meta">{s().activeDays === 1 ? "1 aktiv dag" : `${s().activeDays} aktive dager`} · rekke {s().currentStreak} d</span>
            </div>
            <div class="heat-wrap"><HeatMap heat={s().heat} /></div>
            <div class="home-tokens-bars">
              <TokenBars heat={s().heat} />
              <div class="home-tokens-axis" aria-hidden="true"><span>30 dager siden</span><span>I dag</span></div>
            </div>
            <p class="stats-fun">{bookLine(s().totalTokens)}</p>
          </div>
        )}
      </Show>
    </section>
  );
}

const BOX_PROJECTS = 4;
const BOX_THREADS = 3;

// The GitHub mark in the stroke and size of the other icons: the head with its ears, and the tail.
// Only used for the GitHub connection.
function IconGitHubMark(props: { size?: number }) {
  const size = () => props.size ?? 16;
  return (
    <svg class="icon" width={size()} height={size()} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6.1 14v-1.9c0-.55.18-.95.45-1.2-1.85-.2-3.3-1-3.3-3.35 0-.75.26-1.38.72-1.86-.08-.3-.27-1.06.07-1.98 0 0 .6-.18 1.98.73a6.6 6.6 0 0 1 3.96 0c1.38-.91 1.98-.73 1.98-.73.34.92.15 1.68.07 1.98.46.48.72 1.11.72 1.86 0 2.35-1.45 3.15-3.3 3.35.28.25.45.7.45 1.25V14" />
      <path d="M6.1 12.4c-1.7.5-2.1-.65-2.85-1" />
    </svg>
  );
}

// Prosjektboks: one box in the middle. Without a project, the projects used last as rows (a click
// picks one, and what is typed in the field goes with it); in a project, its latest threads, or ways
// to start while it has none. Then the local environment, and at the bottom a row for GitHub with its status.
function ProjectBox(props: { project?: Project; paneKey: string; onPick: (text: string) => void }) {
  const recent = createMemo(() => sortedProjects().slice(0, BOX_PROJECTS));
  const total = () => sortedProjects().length;
  const threads = createMemo(() => {
    const id = props.project?.id;
    if (!id) return [];
    return Object.values(app.threads)
      .filter((t): t is Thread => !!t && t.projectId === id && !t.archived && !t.temporary && t.id !== props.paneKey && t.title !== "Ny tråd")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, BOX_THREADS);
  });
  const demo = () => modelFor(props.project?.defaultModelId ?? null)?.providerId === "mock";
  const label = () => (!props.project ? "Nylige prosjekter" : threads().length ? "Siste tråder" : "Kom i gang");
  return (
    <section class="home-box" data-testid={props.project ? "project-home" : "home-projects"} aria-label={props.project ? `Prosjektet ${props.project.name}` : "Prosjekter"}>
      <div class="home-box-head">
        <span class="home-box-label">{label()}</span>
        <Show when={!props.project && total() > 0}>
          <button type="button" class="home-box-link" data-testid="all-projects" onClick={() => openProjectPicker(props.paneKey)}>
            {total() > BOX_PROJECTS ? `Vis alle (${total()})` : "Vis alle"}
          </button>
        </Show>
      </div>
      <div class="home-box-rows">
        <Show
          when={props.project}
          fallback={
            <For
              each={recent()}
              fallback={
                <button type="button" class="home-card-row" onClick={() => setFolderPickerOpen(true)}>
                  <IconFolderPlus size={15} /><span class="home-card-title">Velg en mappe</span><span class="home-card-detail">Så blir den et prosjekt</span>
                </button>
              }
            >
              {(project) => (
                <button type="button" class="home-card-row home-box-project" data-testid="home-project-row" title={`${project.name}\n${project.path}`} onClick={() => chooseProject(project.id, props.paneKey)}>
                  <span class="home-box-glyph"><ProjectGlyph project={project} size={15} /></span>
                  <span class="home-card-title">{project.name}</span>
                  <span class="home-box-path">{shortPath(project.path, 40)}</span>
                  <span class="home-card-detail">{shortTime(project.lastUsedAt)}</span>
                </button>
              )}
            </For>
          }
        >
          <Show
            when={threads().length}
            fallback={
              <For each={demo() ? STARTERS_DEMO : STARTERS_CODE}>
                {(starter) => (
                  <button type="button" class="home-card-row" title={starter.text} onClick={() => props.onPick(starter.prompt)}>
                    <IconSpark size={15} /><span class="home-card-title">{starter.title}</span><span class="home-card-detail">{starter.text}</span>
                  </button>
                )}
              </For>
            }
          >
            <For each={threads()}>
              {(thread) => (
                <button type="button" class="home-card-row" title={thread.title} onClick={() => void openThread(thread)}>
                  <IconLaptop size={15} /><span class="home-card-title">{thread.title}</span><span class="home-card-detail">{shortTime(thread.updatedAt)}</span>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
      <div class="home-card-foot">
        <span class="home-env" data-testid="local-environment"><IconLaptop size={14} /> Lokalt miljø</span>
      </div>
      <GitHubRow project={props.project} />
    </section>
  );
}

// The bottom of the box. In a project: the latest open issue or pull request when GitHub is
// connected, and a click opens the GitHub tab. Without one: the connection itself, and a click opens
// Innstillinger → GitHub. Nothing is asked of GitHub without a token.
function GitHubRow(props: { project?: Project }) {
  const [repo] = createResource(() => props.project?.id, (id) => get<GitHubProject>(`/api/projects/${id}/github`).catch(() => null));
  const [account] = createResource(() => !props.project, () => get<GitHubStatus>("/api/github").catch(() => null));
  const status = () => (props.project ? repo()?.status : account()) ?? null;
  const loaded = () => (props.project ? repo() !== undefined : account() !== undefined);
  const latest = () => {
    const data = repo();
    if (!props.project || !data?.status.connected || !data.remote) return null;
    const pull = data.pulls?.[0];
    const issue = data.issues?.[0];
    if (pull && (!issue || Date.parse(pull.updatedAt) >= Date.parse(issue.updatedAt))) return { kind: "pull" as const, item: pull };
    return issue ? { kind: "issue" as const, item: issue } : null;
  };
  const detail = () => {
    const s = status();
    if (!s?.connected) return "Se pull requests og issues";
    if (!props.project) return s.login ? `Koblet til som ${s.login}` : "Koblet til";
    return repo()?.remote ? "Ingen åpne saker" : "Ingen GitHub-repo i mappen";
  };
  const open = () => (props.project ? showPanel("github") : setSettingsOpen("github"));
  return (
    <Show when={loaded()}>
      <div class="home-box-github">
        <button
          type="button"
          class="home-card-row home-github"
          data-testid="home-github"
          data-connected={status()?.connected ? "" : undefined}
          title={props.project ? "Åpne GitHub-fanen" : "Innstillinger → GitHub"}
          onClick={open}
        >
          <Show
            when={latest()}
            fallback={
              <>
                <IconGitHubMark size={15} />
                <span class="home-card-title">{status()?.connected ? "GitHub" : "Koble til GitHub"}</span>
                <span class="home-card-detail">
                  <Show when={status()?.connected}><span class="home-github-dot" aria-hidden="true" /></Show>
                  {detail()}
                </span>
              </>
            }
          >
            {(found) => (
              <>
                <IconGitHubMark size={15} />
                <span class="home-card-title">#{found().item.number} {found().item.title}</span>
                <span class="home-card-detail">{found().kind === "pull" ? "Pull request" : "Issue"}</span>
              </>
            )}
          </Show>
          <IconChevron size={13} />
        </button>
      </div>
    </Show>
  );
}
