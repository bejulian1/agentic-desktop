import { t } from "../lib/i18n";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { get } from "../lib/api";
import { app, scope, setSettingsOpen, untitled } from "../state/app";
import { gridFor } from "../state/grid";
import { openProjectPicker } from "../state/project-picker";
import { showPanel } from "../state/panel";
import { IconFolder, IconGlobe, IconLaptop, IconTerminal, IconUsers } from "./icons";
import "../styles/local-panel-context.css";

const chooseProject = () => {
  const key = scope();
  if (!key) return;
  const grid = gridFor(key);
  const pane = grid.focusedThreadId() ?? grid.focused();
  if (pane) openProjectPicker(pane);
};

export function ProjectContext(props: { tool: "team" | "github" }) {
  return <div class="local-panel-context" data-testid={`local-${props.tool}`}>
    <span class="local-context-icon"><Show when={props.tool === "team"} fallback={<IconFolder size={27} />}><IconUsers size={27} /></Show></span>
    <h2>{props.tool === "team" ? t("Team") : t("GitHub")}</h2>
    <p>{props.tool === "team" ? t("Teamets oppgaver hører til en prosjektmappe. Velg et prosjekt for å se oppgaver og samarbeidende tråder.") : t("Velg en prosjektmappe med et GitHub-repo for å se pull requests og issues.")}</p>
    <button type="button" class="btn btn-small" onClick={chooseProject}>{t("Velg prosjekt")}</button>
    <Show when={props.tool === "github"}><button type="button" class="link-button" onClick={() => setSettingsOpen("github")}>{t("GitHub-innstillinger")}</button></Show>
  </div>;
}

export function LocalOverview(props: { threadId: () => string | null }) {
  const [folder, setFolder] = createSignal("");
  const [error, setError] = createSignal(false);
  let alive = true;
  const load = () => { setError(false); void get<{path: string}>("/api/local/files/root").then((value) => { if (alive) setFolder(value.path); }).catch(() => { if (alive) setError(true); }); };
  onMount(load);
  onCleanup(() => { alive = false; });
  const thread = createMemo(() => { const id = props.threadId(); return id ? app.threads[id] : undefined; });
  const model = () => app.models.find((m) => m.id === (thread()?.modelId ?? app.settings.defaultModelId));
  const provider = () => app.providers.find((p) => p.id === model()?.providerId);
  return <div class="local-overview" data-testid="local-overview">
    <header><IconLaptop size={21} /><div><h2>{t("Denne datamaskinen")}</h2><p>{t("Ingen prosjektmappe valgt")}</p></div></header>
    <div class="local-overview-card"><span>{t("Hjemmemappe")}</span><Show when={!error()} fallback={<button type="button" class="link-button" onClick={load}>{t("Kunne ikke lese mappen. Prøv igjen")}</button>}><code>{folder() || t("Henter mappe…")}</code></Show></div>
    <Show when={thread()}><div class="local-overview-card"><span>{t("Samtale")}</span><strong>{untitled(thread()) ? t("Ny samtale") : thread()!.title}</strong></div></Show>
    <div class="local-overview-card"><span>{t("Modell")}</span><strong>{model()?.name ?? t("Ikke valgt")}</strong><Show when={provider()}><small>{provider()!.name}</small></Show></div>
    <div class="local-overview-tools"><button type="button" class="btn btn-small" onClick={() => showPanel("files")}><IconFolder size={14} />{t("Åpne filer")}</button><button type="button" class="btn btn-small" onClick={() => showPanel("terminal")}><IconTerminal size={14} />{t("Terminal")}</button><button type="button" class="btn btn-small" onClick={() => showPanel("browser")}><IconGlobe size={14} />{t("Nettleser")}</button></div>
    <Show when={thread()}><button type="button" class="link-button" onClick={() => showPanel("session")}>{t("Vis denne økten")}</button></Show>
  </div>;
}
