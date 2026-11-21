import { language, t } from "../lib/i18n.ts";
// Small pieces for GitHub (Beta) shared by the panel and Innstillinger (round 8, agent G). The icons
// are plain line drawings of a pull request and an issue, not anyone's logo.
import type { GitHubProject } from "../../../shared/protocol";

type P = { size?: number };

function Svg(props: P & { children: any }) {
  const size = props.size ?? 16;
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.children}
    </svg>
  );
}

export const IconPullRequest = (p: P) => (
  <Svg {...p}><circle cx="4.5" cy="3.75" r="1.5" /><circle cx="4.5" cy="12.25" r="1.5" /><circle cx="11.5" cy="12.25" r="1.5" /><path d="M4.5 5.25v5.5M11.5 10.75V6.5a2 2 0 0 0-2-2H7.25M8.75 3l-1.5 1.5 1.5 1.5" /></Svg>
);
export const IconDraft = (p: P) => (
  <Svg {...p}><circle cx="4.5" cy="3.75" r="1.5" /><circle cx="4.5" cy="12.25" r="1.5" /><circle cx="11.5" cy="12.25" r="1.5" /><path d="M4.5 5.25v5.5M11.5 4v.01M11.5 7.5v.01" /></Svg>
);

// "om 25 min" or "kl. 14:32", for when the rate limit lifts.
export function resetText(resetAt: number | undefined, now = Date.now()): string {
  if (!resetAt) return t("Prøv igjen om litt.");
  const minutes = Math.max(1, Math.ceil((resetAt - now) / 60_000));
  const clock = new Date(resetAt).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
  return minutes < 60 ? t("Grensen nullstilles om {minutes} min, kl. {clock}.", { minutes, clock }) : t("Grensen nullstilles kl. {clock}.", { clock });
}

export function errorTitle(error: NonNullable<GitHubProject["error"]>): string {
  switch (error.code) {
    case "bad-token": return t("Tokenet virker ikke lenger");
    case "rate-limit": return t("For mange forespørsler");
    case "offline": return t("Ingen kontakt med GitHub");
    case "not-found": return t("Fant ikke repoet");
    case "not-connected": return t("Ikke koblet til GitHub");
    default: return t("GitHub svarte med en feil");
  }
}
