// Innstillinger → GitHub (Beta), round 8, agent G. Connect with a personal access token, which the
// server checks against GitHub and then keeps in the system keyring like the provider keys (round
// 14). The field is emptied at once, and the token is never sent back: the page only learns the
// account name.
import { createResource, createSignal, Show } from "solid-js";
import type { GitHubProject, GitHubStatus } from "../../../shared/protocol";
import { ApiError, del, get, put } from "../lib/api";
import { app, currentProject, report, toast } from "../state/app";
import { confirmDialog } from "./dialogs";
import { resetText } from "./GitHubShared";
import { Group, Page, Rich, Row } from "./settings/parts";
import { SecretInput } from "./SecretInput";

import { lookupMessage, t } from "../lib/i18n";
export function GitHubSettings() {
  const [status, { mutate }] = createResource(() => get<GitHubStatus>("/api/github"));
  const project = currentProject;
  const [repo] = createResource(() => project()?.id, (id) => get<GitHubProject>(`/api/projects/${id}/github`).catch(() => null));
  const [token, setToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let input!: HTMLInputElement;

  const connect = async (event: Event) => {
    event.preventDefault();
    const value = token().trim();
    if (!value || busy()) return;
    setBusy(true);
    setError("");
    try {
      const next = await put<GitHubStatus>("/api/github/token", { token: value });
      setToken("");
      mutate(next);
      toast(t("Koblet til GitHub som {login}.", { login: next.login ?? "" }), "info");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { code?: string; resetAt?: number } | undefined;
        setError(body?.code === "rate-limit" ? `${err.message} ${resetText(body.resetAt)}` : err.message);
      } else setError((err as Error).message);
      input.focus();
      input.select();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirmDialog({ title: t("Koble fra GitHub?"), text: t("Tokenet slettes fra denne maskinen. Det trekkes ikke tilbake på GitHub; det gjør du under Developer settings der."), confirm: t("Koble fra"), danger: true });
    if (!ok) return;
    try {
      mutate(await del<GitHubStatus>("/api/github/token"));
    } catch (err) {
      report(err);
    }
  };

  return (
    <Page
      title="GitHub"
      intro={t("Se prosjektets åpne pull requests og issues i panelet til høyre, og åpne dem i Nettleser. Bare lesing i denne versjonen.")}
    >
      <p class="beta-note github-beta-note"><span class="beta-badge">{t("Beta")}</span> {t("Prøvd mot en lokal testserver, ennå ikke mot github.com. Si fra hvis noe ser rart ut.")}</p>
      <Group title={t("Konto")}>
        <Show
          when={status()?.connected}
          fallback={
            <form class="setting setting-block github-connect" onSubmit={connect}>
              <div class="setting-text">
                <strong>{t("Personlig tilgangstoken")}</strong>
                <span class="muted">
                  {t("Lag et token på GitHub under Settings → Developer settings → Personal access tokens. Et finkornet token med lesetilgang til Contents, Issues og Pull requests holder. For private repoer må tokenet ha tilgang til dem.")}
                </span>
              </div>
              <div class="github-token-row">
                <SecretInput
                  ref={(el) => (input = el)}
                  name="github-token"
                  label={t("GitHub-token")}
                  placeholder={t("github_pat_… eller ghp_…")}
                  value={token()}
                  invalid={!!error()}
                  describedBy={error() ? "github-token-error" : undefined}
                  onInput={(value) => {
                    setToken(value);
                    setError("");
                  }}
                />
                <button type="submit" class="btn btn-primary" disabled={!token().trim() || busy()}>{busy() ? t("Sjekker…") : t("Koble til")}</button>
              </div>
              <Show when={error()}><p class="form-error" id="github-token-error" role="alert">{error()}</p></Show>
            </form>
          }
        >
          <Row label={<Rich text={t("Tilkoblet som {login}")} parts={{ login: <span class="github-login">{status()!.login ?? t("ukjent konto")}</span> }} />} text={status()!.name ? `${status()!.name}. ${scopeText(status()!)}` : scopeText(status()!)}>
            <button type="button" class="btn btn-small btn-quiet-danger" onClick={() => void disconnect()}>{t("Koble fra")}</button>
          </Row>
        </Show>
        <Row label={t("Lagring")} text={app.keyring?.store === "session" ? t("Tokenet gjelder til appen lukkes, fordi nøkkelringen ikke kan brukes nå. Det sendes bare til GitHub, aldri tilbake til nettleseren, og aldri til kommandoer agenten kjører.") : t("Tokenet lagres kryptert i systemets nøkkelring, sammen med API-nøklene. Det sendes bare til GitHub, aldri tilbake til nettleseren, og aldri til kommandoer agenten kjører.")} />
      </Group>
      <Group title={t("Dette prosjektet")}>
        <Show when={project()} fallback={<Row label={t("Ingen prosjekt valgt")} text={t("Velg et prosjekt i Kode for å se repoet.")} />}>
          <Row
            label={repo()?.remote ? `${repo()!.remote!.owner}/${repo()!.remote!.repo}` : project()!.name}
            text={repo.loading ? t("Leser .git/config…") : repo()?.remote ? t("Fra remoten «{remote}» i .git/config. Åpne GitHub-fanen i panelet til høyre i Kode.", { remote: repo()!.remote!.remote }) : (lookupMessage(repo()?.reason) || t("Kunne ikke lese .git/config."))}
          />
        </Show>
      </Group>
    </Page>
  );
}

function scopeText(status: GitHubStatus): string {
  if (status.scopes === undefined) return t("Tokenet er lagret.");
  return status.scopes ? t("Klassisk token med tilgangene {scopes}.", { scopes: status.scopes }) : t("Finkornet token.");
}
