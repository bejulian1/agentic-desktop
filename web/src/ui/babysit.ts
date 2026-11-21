import { t } from "../lib/i18n";
import type { PullWatchStatus, RunStatus, RunWatchStatus, Thread } from "../../../shared/protocol";
import { ApiError, get } from "../lib/api";
import { toast } from "../state/app";

type Target =
  | { kind: "task"; threadId: string; title: string; run?: RunWatchStatus }
  | { kind: "pr"; number: number; repo?: string; projectId?: string; pull?: PullWatchStatus };
type Watch = { target: Target; timer?: ReturnType<typeof setTimeout>; problem?: string; stopped?: boolean };

let active: Watch | null = null;
let latest: Watch | null = null;

const RUN_LABELS: Record<RunStatus, string> = {
  get running() { return t("Kjører"); }, get done() { return t("Ferdig"); }, get error() { return t("Feil"); }, get stopped() { return t("Stoppet"); }, get interrupted() { return t("Avbrutt"); },
};
const CHECK_LABELS = {
  get ERROR() { return t("Feil"); }, get FAILURE() { return t("Feilet"); }, get SUCCESS() { return t("Bestått"); }, get EXPECTED() { return t("Venter på sjekker"); }, get PENDING() { return t("Pågår"); },
};
const REVIEW_LABELS = {
  get APPROVED() { return t("Godkjent"); }, get CHANGES_REQUESTED() { return t("Endringer ønsket"); }, get REVIEW_REQUIRED() { return t("Gjennomgang kreves"); },
};

function label(target: Target): string {
  if (target.kind === "task") return target.title;
  return target.repo ? `${target.repo} #${target.number}` : `PR #${target.number}`;
}

function pullState(pull: PullWatchStatus): string {
  if (pull.state === "MERGED") return t("Flettet");
  if (pull.state === "CLOSED") return t("Lukket");
  return pull.draft ? t("Utkast") : t("Åpen");
}

function checks(pull: PullWatchStatus): string {
  return pull.checks ? CHECK_LABELS[pull.checks] : t("Ingen sjekker rapportert");
}

function review(pull: PullWatchStatus): string {
  return pull.review ? REVIEW_LABELS[pull.review] : t("Ingen samlet beslutning rapportert");
}

function schedule(watch: Watch, delay: number): void {
  watch.timer = setTimeout(() => void poll(watch), Math.min(delay, 2_147_483_647));
}

async function poll(watch: Watch, first = false): Promise<void> {
  const target = watch.target;
  const delay = target.kind === "task" ? 5_000 : 60_000;
  try {
    if (target.kind === "task") {
      const request = target.run ? `?run=${encodeURIComponent(target.run.id)}` : "";
      const { run } = await get<{ run: RunWatchStatus | null }>(`/api/threads/${encodeURIComponent(target.threadId)}/run-watch${request}`);
      if (active !== watch) return;
      if (!run || (first && run.status !== "running")) {
        watch.problem = t("Tråden har ingen aktiv kjøring. Start en melding før du bruker /babysit.");
        active = null;
        return;
      }
      target.run = run;
      if (run.status !== "running") {
        watch.problem = undefined;
        active = null;
        toast(`«${target.title}» · ${RUN_LABELS[run.status]}`, run.status === "error" ? "error" : "info");
        return;
      }
    } else {
      const query = new URLSearchParams({ number: String(target.number) });
      if (target.repo) query.set("repo", target.repo);
      else if (target.projectId) query.set("project", target.projectId);
      const pull = await get<PullWatchStatus>(`/api/github/pull-watch?${query}`);
      if (active !== watch) return;
      const previous = target.pull;
      target.pull = pull;
      target.repo = pull.repo;
      if (previous && (previous.head !== pull.head || previous.state !== pull.state ||
          previous.checks !== pull.checks || previous.review !== pull.review || previous.draft !== pull.draft)) {
        toast(t("{target} · {state} · CI: {checks} · Gjennomgang: {review}", { target: label(target), state: pullState(pull), checks: checks(pull).toLowerCase(), review: review(pull).toLowerCase() }), "info");
      }
      if (pull.state !== "OPEN") {
        watch.problem = undefined;
        active = null;
        return;
      }
    }
    watch.problem = undefined;
  } catch (error) {
    if (active !== watch) return;
    const message = error instanceof Error ? error.message : t("Kunne ikke hente status.");
    watch.problem = message;
    const retry = error instanceof ApiError && (error.status === 0 || error.status === 429 ||
      (error.status >= 500 && error.body?.code !== "bad-token"));
    if (first || !retry) {
      active = null;
      if (!first) toast(t("Oppfølgingen av {target} stoppet. {message}", { target: label(target), message }));
      return;
    }
    const retryAt = error.body?.resetAt;
    schedule(watch, typeof retryAt === "number" ? Math.max(delay, retryAt - Date.now()) : delay);
    return;
  }
  schedule(watch, delay);
}

function status(): { title: string; text?: string; rows?: Array<[string, string]>; link?: { url: string; label: string } } {
  const title = t("Babysit");
  if (!latest) return { title, text: t("Ingen oppfølging ennå. Bruk /babysit for en aktiv tråd eller /babysit pr med en GitHub-lenke.") };
  const { target, stopped, problem } = latest;
  const stage = active ? t("Følger") : stopped ? t("Stoppet av deg") : problem ? t("Stoppet") : t("Avsluttet");
  const rows: Array<[string, string]> = [[stage, label(target)]];
  if (target.kind === "task" && target.run) rows.push([t("Kjøring"), RUN_LABELS[target.run.status]]);
  if (target.kind === "pr" && target.pull) {
    const pull = target.pull;
    rows.push([t("Tittel"), pull.title], ["PR", pullState(pull)], ["CI", checks(pull)], [t("Gjennomgang"), review(pull)]);
  }
  if (problem) rows.push([t("Status kunne ikke hentes"), problem]);
  const link = target.kind === "pr" && target.pull ? { url: target.pull.url, label: t("Åpne på GitHub") } : undefined;
  return { title, rows, link };
}

function pullTarget(arg: string, projectId: string | null): Target | null {
  const number = /^#?([1-9]\d{0,9})$/.exec(arg);
  if (number && projectId) return { kind: "pr", number: Number(number[1]), projectId };
  const url = /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100})\/pull\/([1-9]\d{0,9})\/?(?:[?#][^\s]*)?$/i.exec(arg);
  return url ? { kind: "pr", repo: url[1], number: Number(url[2]) } : null;
}

export async function babysit(arg: string, thread: Thread | undefined, projectId: string | null) {
  const [command, ...rest] = arg.trim().split(/\s+/);
  switch (command.toLowerCase()) {
    case "status":
      if (!rest.length) return status();
      break;
    case "stop":
      if (rest.length) break;
      if (!active) return { title: t("Babysit"), text: t("Ingen aktiv oppfølging å stoppe.") };
      clearTimeout(active.timer);
      active.stopped = true;
      active.problem = undefined;
      active = null;
      return status();
    case "":
    case "task":
    case "pr": {
      if (command.toLowerCase() !== "pr" && rest.length) break;
      let target: Target | null;
      if (command.toLowerCase() === "pr") {
        target = pullTarget(rest.join(" "), projectId);
        if (!target) return { title: t("Babysit"), text: t("Oppgi en GitHub-PR-lenke, eller bruk /babysit pr #14 i et Kode-prosjekt.") };
      } else {
        if (!thread) return { title: t("Babysit"), text: t("Start en kjøring i denne tråden først.") };
        target = { kind: "task", threadId: thread.id, title: thread.title };
      }
      if (active) return { title: t("Babysit"), text: t("Følger allerede {target}. Bruk /babysit status eller /babysit stop.", { target: label(active.target) }) };
      const watch = { target };
      latest = active = watch;
      await poll(watch, true);
      return status();
    }
  }
  return { title: t("Babysit"), text: t("Bruk /babysit task, /babysit pr, /babysit status eller /babysit stop.") };
}
