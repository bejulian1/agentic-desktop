import type { LinkedPr, PullWatchStatus } from "./protocol.ts";

export function validPullReference(repo: unknown, number: unknown): boolean {
  return typeof repo === "string" && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i.test(repo) &&
    !repo.endsWith("/.") && !repo.endsWith("/..") &&
    typeof number === "number" && Number.isInteger(number) && number >= 1 && number <= 2_147_483_647;
}

export const pullUrl = ({ repo, number }: LinkedPr): string => `https://github.com/${repo}/pull/${number}`;

export function parsePullUrl(value: string): LinkedPr | null {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d{0,9})\/?(?:[?#][^\s]*)?$/i.exec(value.trim());
  if (!match || !validPullReference(match[1], Number(match[2]))) return null;
  const pull = { repo: match[1], number: Number(match[2]) };
  return { ...pull, url: pullUrl(pull) };
}

export const pullKey = ({ repo, number }: LinkedPr): string => `${repo.toLowerCase()}#${number}`;

export function pullWatchVersion(pull: PullWatchStatus): string {
  return JSON.stringify([pull.head, pull.state, pull.checks, pull.review, pull.draft]);
}
