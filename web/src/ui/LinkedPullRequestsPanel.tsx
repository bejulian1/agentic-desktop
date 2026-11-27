import { createResource, createSignal, Show } from "solid-js";
import type { GitHubDetail, LinkedPr, Thread } from "../../../shared/protocol";
import { pullKey, pullUrl } from "../../../shared/linked-pr";
import { get } from "../lib/api";
import { lookupMessage, t } from "../lib/i18n";
import { openExternalUrl } from "../lib/links";
import { app } from "../state/app";
import { githubReferenceUrl, githubStateTitle, IconPullRequest } from "./GitHubShared";
import { IconGlobe, IconReload } from "./icons";
import { editThreadPull, updateThreadPull } from "./thread-pull";
import "../styles/thread-panels.css";

function PullCard(props: { pull: LinkedPr; thread: Thread }) {
  const [request, setRequest] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const [detail] = createResource(
    () => request(),
    async (revision) => {
      const url = githubReferenceUrl("detail", { ...props.pull, kind: "pull" });
      try {
        return { item: await get<GitHubDetail>(`${url}&refresh=${revision ? 1 : 0}`), error: "" };
      } catch (error) {
        return { item: undefined, error: lookupMessage((error as Error).message) };
      }
    },
  );
  const item = () => detail.latest?.item;
  const save = async (edit: boolean) => {
    const thread = props.thread;
    setSaving(true);
    try {
      if (edit) await editThreadPull(thread);
      else await updateThreadPull(thread.id, null);
    } finally {
      setSaving(false);
    }
  };

  return <article class="thread-panel-card linked-pr-card">
    <div class="thread-panel-content">
      <div class="thread-panel-meta"><IconPullRequest size={15} /> {props.pull.repo} #{props.pull.number}</div>
      <Show when={item()}>{(pull) => <>
        <strong class="thread-panel-title">{pull().title}</strong>
        <div class="thread-panel-meta">
          <span class="thread-panel-status" data-state={pull().state}>{githubStateTitle(pull().state)}</span>
          <Show when={pull().pull?.head ?? pull().head}>{(branch) => <code>{branch()}</code>}</Show>
        </div>
      </>}</Show>
      <Show when={detail.loading && !item()}><span class="thread-panel-meta" role="status">{t("Henter fra GitHub")}</span></Show>
      <Show when={detail.latest?.error}>{(error) => <span class="thread-panel-meta" role="status">{error()}</span>}</Show>
      <div class="thread-panel-actions">
        <button type="button" class="btn btn-small" onClick={() => openExternalUrl(props.pull.url ?? pullUrl(props.pull))}><IconGlobe size={14} />{t("Åpne på GitHub")}</button>
        <button type="button" class="btn btn-small" disabled={detail.loading} onClick={() => setRequest((value) => value + 1)}><IconReload size={14} />{t("Hent på nytt")}</button>
        <button type="button" class="btn btn-small btn-ghost" disabled={saving()} onClick={() => void save(true)}>{t("Endre GitHub-PR…")}</button>
        <button type="button" class="btn btn-small btn-ghost" disabled={saving()} onClick={() => void save(false)}>{t("Fjern PR-tilknytning")}</button>
      </div>
    </div>
  </article>;
}

export default function LinkedPullRequestsPanel(props: { threadId: () => string | null }) {
  const thread = () => app.threads[props.threadId() ?? ""];
  const key = () => {
    const current = thread();
    return current?.linkedPr ? `${current.id}:${pullKey(current.linkedPr)}` : null;
  };

  return <div class="thread-panel" data-testid="linked-pull-requests-panel">
    <Show when={thread() && !thread()!.temporary} fallback={<div class="panel-empty">{t("Ingen tråd er valgt.")}</div>}>
      <Show when={key()} keyed fallback={<div class="panel-empty linked-pr-empty">
        <p>{t("Ingen pull request er knyttet til denne tråden.")}</p>
        <button type="button" class="btn btn-small" onClick={() => void editThreadPull(thread()!)}>{t("Knytt til GitHub-PR…")}</button>
      </div>}>
        <PullCard thread={thread()!} pull={thread()!.linkedPr!} />
      </Show>
    </Show>
  </div>;
}
