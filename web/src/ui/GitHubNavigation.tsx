import { For } from "solid-js";
import type { GitHubKind } from "../../../shared/protocol";
import { t } from "../lib/i18n";
import { openGitHubRoom } from "../state/github";
import { githubRoom } from "../state/nav";
import { IconPullRequest } from "./GitHubShared";
import { IconIssue } from "./icons";

export function githubTitle(kind: GitHubKind) {
  return kind === "pull" ? t("Pull requests") : t("Issues");
}

export function GitHubNavigation(props: { rail?: boolean; afterPick?: () => void }) {
  return (
    <For each={["pull", "issues"] as const}>{kind => (
      <button
        type="button"
        class={props.rail ? "icon-button rail-button" : "icon-button github-nav-button"}
        aria-label={githubTitle(kind)}
        title={githubTitle(kind)}
        aria-current={githubRoom()?.kind === kind ? "page" : undefined}
        onClick={() => { openGitHubRoom(kind); props.afterPick?.(); }}
      >
        {kind === "pull" ? <IconPullRequest size={16} /> : <IconIssue size={16} />}
      </button>
    )}</For>
  );
}
