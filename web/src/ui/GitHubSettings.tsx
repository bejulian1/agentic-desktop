import { createResource, createSignal, Show } from "solid-js";
import type { GitHubCliStatus, GitHubScope, GitHubStatus } from "../../../shared/protocol";
import { ApiError, del, get, put } from "../lib/api";
import { t } from "../lib/i18n";
import { app, currentProject, report, saveSettings, toast } from "../state/app";
import { confirmDialog } from "./dialogs";
import { resetText } from "./GitHubShared";
import { IconGitHub } from "./icons";
import { Group, Page, Rich, Row, Toggle } from "./settings/parts";
import { SecretInput } from "./SecretInput";

export function GitHubSettings() {
  const [status, { mutate, refetch: checkStatus }] = createResource(() => get<GitHubStatus>("/api/github").catch(report));
  const [cli, { refetch: checkCli }] = createResource(() => get<GitHubCliStatus>("/api/github/cli").catch(report));
  const [scopes] = createResource(() => get<GitHubScope[]>("/api/github/projects").catch(report));
  const project = currentProject;
  const repo = () => scopes()?.find(scope => scope.id === project()?.id)?.repo;
  const [token, setToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let input: HTMLInputElement | undefined;

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
      input?.focus();
      input?.select();
    } finally {
      setBusy(false);
    }
  };

  const useCli = async () => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      mutate(await put<GitHubStatus>("/api/github/cli"));
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: t("Koble fra GitHub?"), confirm: t("Koble fra"), danger: true,
      text: status()?.method === "gh"
        ? t("GitHub CLI forblir innlogget i terminalen.")
        : t("Tokenet slettes fra denne maskinen. Det trekkes ikke tilbake på GitHub; det gjør du under Developer settings der."),
    });
    if (!ok) return;
    setBusy(true);
    try {
      mutate(await del<GitHubStatus>("/api/github"));
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const cliText = () => {
    if (cli.loading) return t("Sjekker…");
    const account = cli();
    if (account?.state === "signed-in") return t("Logget inn som {login}", { login: account.login });
    if (account?.state === "missing") return t("GitHub CLI er ikke installert.");
    if (account?.state === "signed-out") return (
      <Rich text={t("Kjør {command} i en terminal, og sjekk igjen her.")} parts={{ command: <code>gh auth login</code> }} />
    );
    return t("Kunne ikke sjekke innloggingen i GitHub CLI.");
  };

  return (
    <Page title="GitHub" intro={t("Se pull requests og issues fra prosjektene dine.")}>
      <Group title={t("Konto")}>
        <Show when={status()?.connected}>
          <Row label={<Rich text={t("Tilkoblet som {login}")} parts={{ login: <span class="github-login">{status()!.login ?? t("ukjent konto")}</span> }} />} icon={IconGitHub} text={status()?.method === "gh" ? t("GitHub CLI") : status()!.name ? `${status()!.name}. ${scopeText(status()!)}` : scopeText(status()!)}>
            <button type="button" class="btn btn-small btn-quiet-danger" disabled={busy()} onClick={() => void disconnect()}>{t("Koble fra")}</button>
          </Row>
        </Show>
        <Row label={cli() && cli()?.state !== "missing" ? t("GitHub CLI (anbefalt)") : t("GitHub CLI")} text={cliText()}>
          <div class="github-account-actions">
            <Show when={cli()?.state === "missing"}>
              <a class="btn btn-small" href="https://cli.github.com/" target="_blank" rel="noopener noreferrer">{t("Installer GitHub CLI")}</a>
            </Show>
            <Show when={cli()?.state === "signed-in" && status()?.method !== "gh"}>
              <button type="button" class="btn btn-small btn-primary" disabled={busy()} onClick={() => void useCli()}>{t("Bruk GitHub CLI")}</button>
            </Show>
            <Show when={status()?.method === "gh" && !status()?.connected}>
              <button type="button" class="btn btn-small btn-quiet-danger" disabled={busy()} onClick={() => void disconnect()}>{t("Koble fra")}</button>
            </Show>
            <button type="button" class="btn btn-small" disabled={cli.loading || busy()} onClick={() => { void checkCli(); if (status()?.method === "gh") void checkStatus(); }}>{t("Sjekk igjen")}</button>
          </div>
        </Row>
        <Show when={status()?.method !== "token" || !status()?.connected}>
          <form class="setting setting-block github-connect" onSubmit={connect}>
            <div class="setting-text">
              <strong>{t("Personlig tilgangstoken")}</strong>
              <span class="muted">{t("Lag et token på GitHub under Settings → Developer settings → Personal access tokens. Et finkornet token med lesetilgang til Contents, Issues og Pull requests holder. For private repoer må tokenet ha tilgang til dem.")}</span>
            </div>
            <div class="github-token-row">
              <SecretInput
                ref={el => (input = el)}
                name="github-token"
                label={t("GitHub-token")}
                placeholder={t("github_pat_… eller ghp_…")}
                value={token()}
                invalid={!!error()}
                describedBy={error() ? "github-token-error" : undefined}
                onInput={value => { setToken(value); setError(""); }}
              />
              <button type="submit" class="btn btn-primary" disabled={!token().trim() || busy()}>{busy() ? t("Sjekker…") : t("Koble til")}</button>
            </div>
            <Show when={error()}><p class="form-error" id="github-token-error" role="alert">{error()}</p></Show>
          </form>
        </Show>
        <Row label={t("Lagring")} text={app.keyring?.store === "session" ? t("Tokenet gjelder til appen lukkes, fordi nøkkelringen ikke kan brukes nå. Det sendes bare til GitHub, aldri tilbake til nettleseren, og aldri til kommandoer agenten kjører.") : t("Tokenet lagres kryptert i systemets nøkkelring, sammen med API-nøklene. Det sendes bare til GitHub, aldri tilbake til nettleseren, og aldri til kommandoer agenten kjører.")} />
      </Group>
      <Group title={t("Lenker")}>
        <Toggle
          label={t("Åpne pull request-lenker i Agentic Desktop")}
          text={t("Gjelder GitHub-lenker til pull requests og issues i Chat- og Kode-meldinger.")}
          checked={app.settings.githubOpenLinks !== false}
          onChange={value => void saveSettings({ githubOpenLinks: value }).catch(report)}
        />
      </Group>
      <Group title={t("Dette prosjektet")}>
        <Show when={project()} fallback={<Row label={t("Ingen prosjekt valgt")} text={t("Velg et prosjekt i Kode for å se repoet.")} />}>
          <Row label={repo() ?? project()!.name} text={scopes.loading ? t("Leser .git/config…") : repo() ? t("GitHub-fanen i panelet til høyre viser dette repoet i Kode.") : t("Ingen remote peker til GitHub.")} />
        </Show>
      </Group>
    </Page>
  );
}

function scopeText(status: GitHubStatus): string {
  if (status.scopes === undefined) return t("Tokenet er lagret.");
  return status.scopes ? t("Klassisk token med tilgangene {scopes}.", { scopes: status.scopes }) : t("Finkornet token.");
}
