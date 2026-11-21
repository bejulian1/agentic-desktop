import { t, lookupMessage } from "../lib/i18n";
// Innstillinger as a full page that replaces the window, like a desktop app's preferences. A menu
// Generelt, Utseende, Personvern, Modeller and Leverandører live in ./settings/.
import { createEffect, createMemo, createResource, createSignal, lazy, For, onCleanup, onMount, Show, Suspense, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { get, patch } from "../lib/api";
import { rememberFocus } from "../lib/focus";
import { desktop } from "../lib/desktop";
import { formatBuildDate, relativeTime } from "../lib/format";
import type { PermissionMode, Thread } from "../../../shared/protocol";
import { app, archiveThread, deleteThread, report, saveSettings, setSettingsOpen, settingsOpen, sortedProjects, toast } from "../state/app";

import { archiveScope, restoreMany, setArchiveScope } from "../state/archive";
import { openThread } from "../state/navigate";
import { confirmDialog, setInfoDialog } from "./dialogs";
import {
  IconAnchor, IconArchive, IconBack, IconBook, IconBranch, IconCheck, IconClose, IconFolder, IconCpu, IconGauge, IconGlobe, IconInfo, IconKeyboard,
  IconBookmark, IconChat, IconCode, IconHand, IconPalette, IconPencil, IconSearch, IconServer, IconSettings, IconShield, IconShieldCheck, IconSliders, IconSpark, IconClock,
} from "./icons";
import { Group, Page, Row, SkeletonRows, type Icon } from "./settings/parts";
import { DownloadDirRow } from "./DownloadsList";
import { imported, importedSummary, loadImported, openChromeImport, removeImported } from "./ChromeImport";
import { CookieSettings } from "./CookieImport"; // round 12 (SPEC 26.4)
import { Appearance, General, Privacy } from "./settings/general";
import { ChatSettings, CodeSettings } from "./settings/modes";
import { Providers } from "./settings/providers";
import { canonicalSettingsPage, matchingPages, search } from "./settings/search";
import { Shortcuts } from "./settings/shortcuts";
import { Memories } from "./settings/memory";
import { HarnessPage } from "./settings/harness"; // round 9b
import { Usage } from "./settings/usage";
import { Select } from "./Select";
import { Skills } from "./settings/skills";
import { HooksPage } from "./settings/hooks";
import { StoragePage } from "./settings/storage";
import { GitHubSettings } from "./GitHubSettings";
import { IconPullRequest } from "./GitHubShared";
import { permissionScope, permissionTitle } from "./permission-copy";
import "../styles/settings-polish.css";

const PERMISSIONS = (): Array<{ id: PermissionMode; label: string; text: string; icon: Icon }> => [
  { id: "ask", label: t("Spør"), text: t("Lesing er tillatt. Filendringer, kommandoer og nettleser spør først."), icon: IconHand },
  { id: "accept-edits", label: t("Godta redigeringer"), text: t("Filendringer er tillatt. Kommandoer og nettleser spør først."), icon: IconPencil },
  { id: "full", label: t("Full tilgang"), text: t("Filendringer og kommandoer godkjennes automatisk. Beskyttede filer krever fortsatt godkjenning."), icon: IconShieldCheck },
];

interface Section { id: string; label: string; icon: Icon; beta?: boolean }

// Generelt is a gear and Utseende a palette: at 16 px a gear and a sun were two ray circles.
const APP_SECTIONS = (): Section[] => [
  { id: "general", label: t("Generelt"), icon: IconSettings },
  { id: "code", label: t("Kode"), icon: IconCode }, // round 9: the gear opens this one from Kode
  { id: "chat", label: t("Chat"), icon: IconChat }, // and this one from Chat
  { id: "appearance", label: t("Utseende"), icon: IconPalette },
  { id: "providers", label: t("Modeller og leverandører"), icon: IconCpu },
  { id: "github", label: t("GitHub"), icon: IconPullRequest, beta: true }, // round 8, agent G
  { id: "usage", label: t("Bruk"), icon: IconGauge },
  { id: "storage", label: t("Lagring"), icon: IconFolder },
  { id: "privacy", label: t("Personvern og data"), icon: IconShieldCheck },
];

const HOST_SECTIONS = (): Section[] => [
  { id: "git", label: t("Git"), icon: IconBranch },
  { id: "config", label: t("Konfigurasjon"), icon: IconSliders },
  { id: "personalization", label: t("Personalisering og minner"), icon: IconSpark },
  { id: "skills", label: t("Skills"), icon: IconBook },
  { id: "hooks", label: t("Hooks"), icon: IconAnchor },
  { id: "mcp", label: t("MCP-servere"), icon: IconServer },
  { id: "shortcuts", label: t("Hurtigtaster"), icon: IconKeyboard },
  { id: "browser", label: t("Nettleser"), icon: IconGlobe },
  { id: "permissions", label: t("Tillatelser"), icon: IconShield },
  { id: "archived", label: t("Arkiverte tråder"), icon: IconArchive },
  { id: "about", label: t("Om"), icon: IconInfo },
];

const ALL_SECTIONS = () => [...APP_SECTIONS(), ...HOST_SECTIONS()];
const sectionLabel = (id: string) => ALL_SECTIONS().find((s) => s.id === id)?.label ?? id;

const Git = (props: {}) => <Suspense><GitSettingsPage {...props} /></Suspense>;
const GitSettingsPage = lazy(() => import("./GitWorkspace").then((m) => ({ default: m.GitSettings })));

// Innstillinger → MCP-servere (settings/mcp.tsx), loaded when it is opened.
const Mcp = (props: {}) => <Suspense><McpSettingsPage {...props} /></Suspense>;
const McpSettingsPage = lazy(() => import("./settings/mcp").then((m) => ({ default: m.McpPage })));

function Browser() {
  void loadImported(true);
  return (
    <Page title={t("Nettleser")} intro={t("Nettleser-panelet og agentens nettleserverktøy bruker en egen Chrome som kjører usynlig, med en egen profil i datamappen.")}>
      <Group title={t("Chrome")}>
        <Row label={t("Kjører headless")} text={t("Startes ved første bruk og lukkes når ingen tråd har brukt den på en stund. Du og agenten ser samme side.")} icon={IconGlobe} />
        <Row label={t("Egen profil")} text={t("Informasjonskapsler og innlogging deles mellom prosjektene. Nettleseren din på maskinen får aldri noe herfra, og gir bare det du selv importerer.")} icon={IconShield} />
        <Row label={t("Playtest")} text={t("Starter dev- eller start-skriptet i package.json på en egen port, eller serverer index.html. Knappen ligger øverst til høyre i Kode.")} />
      </Group>
      <CookieSettings />
      <Group title={t("Nedlastinger")}>
        <DownloadDirRow />
      </Group>
      {/* Round 10 (SPEC 23.1): read only, and only when asked. */}
      <Group title={t("Importer fra Chrome")}>
        <Row label={t("Bokmerker og historikk")} icon={IconBookmark} text={<span data-testid="chrome-import-status">{importedSummary(imported())} {t("Her leses bare bokmerker og historikk, aldri passord, kort eller økter.")}</span>}>
          <Show when={imported()?.importedAt}>
            <button type="button" class="btn btn-small btn-quiet" onClick={() => void removeImported()}>{t("Fjern")}</button>
          </Show>
          <button type="button" class="btn btn-small" onClick={openChromeImport}>{t("Importer…")}</button>
        </Row>
      </Group>
    </Page>
  );
}

function Permissions() {
  return (
    <Page title={t("Tillatelser")}>
      {/* Rows with an icon and a check, like the permission menu in the message field. */}
      <Group title={permissionTitle()}>
        <div class="setting setting-block"><div class="setting-text"><span class="muted">{permissionScope()}</span></div></div>
        <div class="choice-list" role="radiogroup" aria-label={t("Standard tillatelsesmodus")}>
          <For each={PERMISSIONS()}>
            {(mode) => (
              <button
                type="button"
                role="radio"
                class="setting choice-row"
                aria-checked={app.settings.defaultPermissionMode === mode.id}
                onClick={() => app.settings.defaultPermissionMode !== mode.id && saveSettings({ defaultPermissionMode: mode.id }).catch(report)}
              >
                <span class="choice-icon">{mode.icon({ size: 16 })}</span>
                <div class="setting-text"><strong>{mode.label}</strong><span class="muted">{mode.text}</span></div>
                <span class="choice-check" aria-hidden="true"><IconCheck size={15} /></span>
              </button>
            )}
          </For>
        </div>
      </Group>
      <Show when={sortedProjects().length}>
        <Group title={t("Prosjekter")}>
          <For each={sortedProjects()}>
            {(project) => (
              <Row label={project.name} text={<bdo dir="ltr">{project.path}</bdo>}>
                <Select<PermissionMode>
                  label={t("Tillatelser for {name}", { name: project.name })}
                  value={project.permissionMode}
                  options={PERMISSIONS().map((m) => ({ value: m.id, label: m.label }))}
                  onChange={(value) => patch(`/api/projects/${project.id}`, { permissionMode: value }).catch(report)}
                />
              </Row>
            )}
          </For>
        </Group>
      </Show>
    </Page>
  );
}

// Round 14 (SPEC 30.4): the archive, by project, with Gjenopprett for one thread or all in a
// project. A title opens the thread as it is, without bringing it back. Opened from a project's
// menu it shows that project only, with a way to see all.
function Archived() {
  const count = createMemo(() => Object.values(app.threads).filter((t) => t?.archived).length);
  const [threads, { refetch }] = createResource(count, () => get<Thread[]>("/api/threads/archived"));
  onCleanup(() => setArchiveScope(null));
  const keyOf = (t: Thread) => (t.projectId ? `p:${t.projectId}` : t.chatProjectId ? `c:${t.chatProjectId}` : t.mode === "code" ? "local" : "chat");
  const groups = createMemo(() => {
    const scope = archiveScope();
    const wanted = scope ? `${scope.kind === "project" ? "p" : "c"}:${scope.id}` : null;
    const out = new Map<string, Thread[]>();
    for (const thread of threads() ?? []) {
      const key = keyOf(thread);
      if (wanted && key !== wanted) continue;
      out.set(key, [...(out.get(key) ?? []), thread]);
    }
    return [...out].map(([key, list]) => ({ key, list }));
  });
  const label = (key: string) => {
    if (key.startsWith("p:")) return app.projects[key.slice(2)]?.name ?? t("Prosjekt");
    if (key.startsWith("c:")) return app.chatProjects[key.slice(2)]?.name ?? t("Chat-prosjekt");
    return key === "local" ? t("Denne datamaskinen") : t("Chatter");
  };
  const restore = (thread: Thread) => archiveThread(thread.id, false).then(() => void refetch()).catch(report);
  const restoreAll = (list: Thread[]) => restoreMany(list.map((t) => t.id)).then(() => void refetch());
  const remove = async (thread: Thread) => {
    if (await confirmDialog({ title: t("Slette tråden?"), text: t("«{title}» slettes for godt. Filer i prosjektet røres ikke.", { title: thread.title }), confirm: t("Slett"), danger: true })) {
      await deleteThread(thread.id).catch(report);
      void refetch();
    }
  };
  const open = (thread: Thread) => {
    setSettingsOpen(null);
    void openThread(thread);
  };
  return (
    <Page title={t("Arkiverte tråder")} intro={t("Arkiverte tråder er borte fra sidefanen, men ingenting er slettet. Gjenopprett legger tråden tilbake der den var, og navnet åpner den som den er.")}>
      <Show when={archiveScope()}>
        <p class="archive-scope">
          {t("Viser bare «{scope}».", { scope: label(`${archiveScope()!.kind === "project" ? "p" : "c"}:${archiveScope()!.id}`) })}
          <button type="button" class="link-button" onClick={() => setArchiveScope(null)}>{t("Vis alle")}</button>
        </p>
      </Show>
      <Show when={groups().length} fallback={<Group><div class="setting"><span class="muted">{threads.loading ? t("Henter …") : t("Ingen arkiverte tråder.")}</span></div></Group>}>
        <For each={groups()}>
          {(group) => (
            <Group
              title={label(group.key)}
              action={
                <Show when={group.list.length > 1}>
                  <button type="button" class="btn btn-small btn-quiet" onClick={() => void restoreAll(group.list)}>{t("Gjenopprett alle ({count})", { count: group.list.length })}</button>
                </Show>
              }
            >
              <For each={group.list}>
                {(thread) => (
                  <div class="setting archived-row" data-archived={thread.id}>
                    <IconArchive size={16} />
                    <div class="setting-text">
                      <button type="button" class="archived-title" title={t("Åpne tråden uten å gjenopprette den")} onClick={() => open(thread)}>{thread.title}</button>
                      <span class="muted">{t("{mode} · sist aktiv {time}", { mode: thread.mode === "code" ? t("Kode") : t("Chat"), time: relativeTime(thread.updatedAt) })}</span>
                    </div>
                    <div class="setting-control">
                      <button type="button" class="btn btn-small" onClick={() => restore(thread)}>{t("Gjenopprett")}</button>
                      <button type="button" class="btn btn-small btn-quiet-danger" onClick={() => remove(thread)}>{t("Slett")}</button>
                    </div>
                  </div>
                )}
              </For>
            </Group>
          )}
        </For>
      </Show>
    </Page>
  );
}

function About() {
  const build = () => app.build!;
  const copy = () => {
    const info = t("{name} {version} (build {build}), bygget {builtAt}", { name: build().name, version: build().version, build: build().build, builtAt: build().builtAt });
    navigator.clipboard?.writeText(info).then(() => toast(t("Kopiert."), "info")).catch(() => toast(info, "info"));
  };
  return (
    <Page title={t("Om")} class="about">
      <div class="settings-card about-card">
        <div class="about-name">{build().name}</div>
        <dl class="about-list">
          <dt>{t("Versjon")}</dt><dd data-testid="about-version">{build().version}</dd>
          <dt>{t("Byggnummer")}</dt><dd data-testid="about-build">{build().build}</dd>
          <dt>{t("Byggdato")}</dt><dd data-testid="about-date">{formatBuildDate(build().builtAt)}</dd>
        </dl>
        <div class="about-actions">
          <button type="button" class="btn btn-small" data-testid="about-releases" aria-haspopup="dialog" onClick={() => setInfoDialog("releases")}><IconClock size={14} />{t("Versjonslogg")}</button>
          <button type="button" class="btn btn-small" onClick={copy}>{t("Kopier info")}</button>
        </div>
        <Show when={build().signature}>
          <p class="about-signature"><span class="signature">{build().signature}</span><span class="muted">{t("Navnet på byggeserien denne versjonen hører til.")}</span></p>
        </Show>
        <SandboxNote />
      </div>
    </Page>
  );
}

// SPEC 29.2: one quiet line in Om when the Electron app runs without Chromium's sandbox, with the
// command that turns it on. Nothing shows in a browser or when the sandbox is on.
function SandboxNote() {
  const [info] = createResource(() => desktop?.sandbox?.() ?? Promise.resolve(null));
  const copy = (command: string) =>
    navigator.clipboard?.writeText(command).then(() => toast(t("Kommandoen er kopiert."), "info")).catch(() => toast(command, "info"));
  return (
    <Show when={info()?.on === false ? info() : undefined}>
      {(note) => (
        <div class="about-sandbox" data-testid="about-sandbox">
          <p class="muted">{note().reason} {t("Nettleserpanelet bruker derfor Chrome, med sin egen sandkasse.")}</p>
          <Show when={note().command}>
            {(command) => (
              <div class="about-sandbox-command">
                <code>{command()}</code>
                <button type="button" class="btn btn-small" onClick={() => copy(command())}>{t("Kopier")}</button>
              </div>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

const VIEWS: Record<string, (props: { target?: string | null }) => JSX.Element> = {
  general: General,
  code: CodeSettings,
  chat: ChatSettings,
  appearance: Appearance,
  providers: () => <Providers />,
  git: Git,
  github: GitHubSettings,
  usage: Usage,
  storage: StoragePage,
  privacy: Privacy,
  config: HarnessPage,
  personalization: Memories,
  skills: Skills,
  shortcuts: Shortcuts,
  mcp: Mcp,
  hooks: HooksPage,
  browser: Browser,
  permissions: Permissions,
  worktrees: Git,
  archived: Archived,
  about: About,
};

function SearchResults(props: { query: string; open: (page: string, label: string) => void }) {
  const hits = createMemo(() => search(props.query, sectionLabel));
  const byPage = createMemo(() => {
    const groups = new Map<string, string[]>();
    for (const hit of hits()) groups.set(hit.page, [...(groups.get(hit.page) ?? []), hit.label]);
    return [...groups.entries()];
  });
  return (
    <Page title={t("Søk")} intro={hits().length ? t("{count} treff for «{query}».", { count: hits().length, query: props.query.trim() }) : undefined}>
      <Show when={hits().length} fallback={<p class="muted search-empty">{t("Ingen innstillinger passer til «{query}».", { query: props.query.trim() })}</p>}>
        <For each={byPage()}>
          {([pageId, labels]) => (
            <Group title={sectionLabel(pageId)}>
              <For each={labels}>
                {(label) => (
                  <button type="button" class="setting search-result" onClick={() => props.open(pageId, label)}>
                    <div class="setting-text"><strong>{lookupMessage(label)}</strong><span class="muted">{sectionLabel(pageId)}</span></div>
                  </button>
                )}
              </For>
            </Group>
          )}
        </For>
      </Show>
    </Page>
  );
}

export default function Settings() {
  let page!: HTMLDivElement;
  let body!: HTMLDivElement;
  const [query, setQuery] = createSignal("");
  const [target, setTarget] = createSignal<string | null>(null);
  // Keep old links and shortcuts working after the pages were combined.
  const section = () => {
    const id = canonicalSettingsPage(settingsOpen() ?? "general");
    return VIEWS[id] ? id : "general";
  };
  const searching = () => query().trim().length > 0;
  const [providersVisited, setProvidersVisited] = createSignal(false);
  createEffect(() => { if (section() === "providers") setProvidersVisited(true); });
  const shown = createMemo(() => (searching() ? matchingPages(query(), ALL_SECTIONS()) : null));
  const visible = (item: Section) => !shown() || shown()!.has(item.id);
  const close = () => setSettingsOpen(null);
  const open = (id: string, label?: string) => {
    setQuery("");
    setSettingsOpen(id);
    setTarget(label ?? null);
  };
  // Back to where you were when Innstillinger closes, once the app is no longer inert.
  onCleanup(rememberFocus());
  onMount(() => {
    page.querySelector<HTMLElement>(".settings-back")?.focus({ preventScroll: true });
    // Esc goes back to where you were, unless something on the page wants it first.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open]") || page.querySelector(".popover")) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });
  createEffect(() => {
    section();
    searching();
    body.scrollTop = 0;
    // In a narrow window the pages are one row that scrolls: keep the chosen one in view.
    const frame = requestAnimationFrame(() => page.querySelector<HTMLElement>('.settings-nav-pages [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }));
    onCleanup(() => cancelAnimationFrame(frame));
  });
  // After a search hit: scroll to the row with that title on the new page and mark it briefly.
  createEffect(() => {
    const label = target();
    section();
    if (!label) return;
    let nextFrame: number | undefined;
    const frame = requestAnimationFrame(() => { nextFrame = requestAnimationFrame(() => {
      const title = [...body.querySelectorAll<HTMLElement>(".setting-text strong, .settings-group-head h2, .settings-title")].find((el) => !el.closest("[hidden]") && el.textContent?.trim().startsWith(lookupMessage(label)));
      const row = title?.closest<HTMLElement>(".setting") ?? title?.closest<HTMLElement>(".settings-group") ?? title;
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "instant" });
      row.classList.add("search-hit");
      setTimeout(() => row.classList.remove("search-hit"), 1600);
    }); });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      if (nextFrame !== undefined) cancelAnimationFrame(nextFrame);
    });
  });
  const NavItem = (item: Section) => (
    <Show when={visible(item)}>
      <button type="button" class="nav-item" aria-current={!searching() && section() === item.id ? "page" : undefined} onClick={() => open(item.id)}>
        <item.icon size={16} /><span>{item.label}</span><Show when={item.beta}><span class="beta-badge nav-beta">{t("Beta")}</span></Show>
      </button>
    </Show>
  );
  return (
    <div class="settings-page" ref={page} role="region" aria-label={t("Innstillinger")}>
      {/* Two groups that are invisible in a wide window (display: contents): the top (back and search)
          and the pages. In a narrow window the top is one row and the pages another that scrolls. */}
      <nav class="settings-nav" aria-label={t("Innstillinger")}>
        <div class="settings-nav-top">
        <button type="button" class="nav-item settings-back" onClick={close}><IconBack size={16} /><span>{t("Tilbake til appen")}</span></button>
        <div class="settings-search">
          <IconSearch size={14} />
          <input
            type="search"
            class="settings-search-input"
            placeholder={t("Søk i innstillinger")}
            aria-label={t("Søk i innstillinger")}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query()) {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              } else if (e.key === "Enter") {
                const first = search(query(), sectionLabel)[0];
                if (first) open(first.page, first.label);
              }
            }}
          />
          <Show when={query()}>
            <button type="button" class="settings-search-clear" aria-label={t("Tøm søket")} title={t("Tøm søket")} onClick={() => setQuery("")}><IconClose size={12} /></button>
          </Show>
        </div>
        </div>
        <div class="settings-nav-pages">
        <Show when={APP_SECTIONS().some(visible)}><div class="settings-nav-label">{t("App")}</div></Show>
        <For each={APP_SECTIONS()}>{NavItem}</For>
        <Show when={HOST_SECTIONS().some(visible)}><div class="settings-nav-label settings-host"><span>{t("Vert · Lokal")}</span></div></Show>
        <For each={HOST_SECTIONS()}>{NavItem}</For>
        {/* Not a page: opens the whole version history in a window over Innstillinger. */}
        <Show when={!searching()}>
          <button type="button" class="nav-item" data-testid="settings-releases" aria-haspopup="dialog" onClick={() => setInfoDialog("releases")}><IconClock size={16} /><span>{t("Versjonslogg")}</span></button>
        </Show>
        </div>
        {/* The version lives here and in Om, not in the sidebar (SPEC 21.6). */}
        <Show when={app.build}>
          <button type="button" class="settings-version" data-testid="version" title={t("Om Agentic Desktop")} onClick={() => open("about")}>
            {t("v{version} · bygg {build}", { version: app.build!.version, build: app.build!.build })}
          </button>
        </Show>
      </nav>
      <div class="settings-body" ref={body}>
        <div class="settings-content">
          {/* Keep provider/model drafts and request results for this Settings visit. Hidden
              panels never overlap, receive focus or animate out over the newly selected page. */}
          <Show when={providersVisited()}>
            <div hidden={searching() || section() !== "providers"} data-settings-panel="providers">
              <Suspense fallback={<Page title={sectionLabel("providers")}><SkeletonRows label={t("Henter innstillinger…")} /></Page>}>
                <Providers active={!searching() && section() === "providers"} />
              </Suspense>
            </div>
          </Show>
          <Show when={searching()}><SearchResults query={query()} open={open} /></Show>
          <Show when={!searching() && section() !== "providers"}>
            <Suspense fallback={<Page title={sectionLabel(section())}><SkeletonRows label={t("Henter innstillinger…")} /></Page>}>
              <Dynamic component={VIEWS[section()]} target={target()} />
            </Suspense>
          </Show>
        </div>
      </div>
    </div>
  );
}
