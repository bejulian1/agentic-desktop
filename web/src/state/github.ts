import { batch } from "solid-js";
import type { GitHubKind, GitHubReference } from "../../../shared/protocol";
import { app } from "./app";
import { closeArtifacts } from "./artifacts";
import { beginNavigation, closeProfile, githubRoom, setGitHubRoom } from "./nav";
import { closeSkills } from "./skills-workspace";

export const userGitHubLink = /https?:\/\/(?:www\.)?github\.com\/[a-z\d-]+\/[a-z\d_.-]+\/(?:pull|issues)\/[1-9]\d{0,9}(?:\/[a-z\d-]+)*(?:[?#][^\s<>"')\]]*)?(?![\w/%-])/gi;

export function githubReference(href: string): GitHubReference | null {
  try {
    const url = new URL(href);
    if (!/^https?:$/.test(url.protocol) || !["github.com", "www.github.com"].includes(url.host) || url.username || url.password) return null;
    const match = /^\/([a-z\d][a-z\d-]{0,38})\/([a-z\d_.-]{1,100})\/(pull|issues)\/([1-9]\d{0,9})(?:\/.*)?$/i.exec(url.pathname);
    if (!match || Number(match[4]) > 2_147_483_647) return null;
    return { repo: `${match[1]}/${match[2]}`, kind: match[3].toLowerCase() === "pull" ? "pull" : "issues", number: Number(match[4]) };
  } catch {
    return null;
  }
}

export function openGitHubRoom(kind: GitHubKind, projectId?: string, detail: GitHubReference | null = null): void {
  if (!detail) beginNavigation();
  batch(() => {
    closeArtifacts();
    closeProfile();
    closeSkills();
    setGitHubRoom({ kind, projectId, detail });
  });
}

export function showGitHubDetail(detail: GitHubReference | null): void {
  const current = githubRoom();
  if (current) setGitHubRoom({ ...current, detail });
}

export function followGitHubMessageLink(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || app.settings.githubOpenLinks === false) return;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!anchor?.closest('.row-text[data-row="text"], .row-user[data-row="user"]')) return;
  const ref = githubReference(anchor.href);
  if (!ref) return;
  event.preventDefault();
  beginNavigation();
  openGitHubRoom(ref.kind, undefined, ref);
}
