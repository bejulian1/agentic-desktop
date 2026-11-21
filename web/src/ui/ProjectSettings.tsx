import { Rich } from "./settings/parts";
// The Agent and Kilder tabs of Rediger prosjekt (EditProject.tsx): the default model, the
// permission mode and the project's own instructions, and where each setting comes from. There is
// no separate dialog any more; openProjectSettings opens Rediger prosjekt on the Agent tab.
import { t } from "../lib/i18n";
import { For, Show } from "solid-js";
import type { PermissionMode, ProjectConfig } from "../../../shared/protocol";
import { app } from "../state/app";
import { Select } from "./Select";

export { openProjectSettings } from "./dialog-state";

const PERMISSIONS: Array<{ value: PermissionMode; label: string }> = [
  { value: "ask", get label() { return t("Spør"); } },
  { value: "accept-edits", get label() { return t("Godta redigeringer"); } },
  { value: "full", get label() { return t("Full tilgang"); } },
];

const PERMISSION_TEXT: Record<PermissionMode, string> = {
  get ask() { return t("Lesing er tillatt. Filendringer, kommandoer og nettleser spør først."); },
  get "accept-edits"() { return t("Filendringer er tillatt. Kommandoer og nettleser spør først."); },
  get full() { return t("Alt er tillatt, unntatt .env-filer og .git/hooks, som alltid spør."); },
};

export function AgentTab(props: {
  model: string | null;
  onModel: (id: string | null) => void;
  permission: PermissionMode;
  onPermission: (mode: PermissionMode) => void;
  browserAccess: boolean | null;
  onBrowserAccess: (value: boolean | null) => void;
  instructions: string;
  onInstructions: (text: string) => void;
}) {
  const browserOptions = (): Array<{ value: string; label: string }> => [
    { value: "inherit", label: app.settings.agentBrowserAccess === false ? t("Følg global (av)") : t("Følg global (på)") },
    { value: "allow", label: t("Tillat") },
    { value: "block", label: t("Av") },
  ];
  const browserValue = () => (props.browserAccess === null ? "inherit" : props.browserAccess ? "allow" : "block");
  return (
    <div class="project-agent">
      <div class="project-agent-row">
        <div class="setting-text"><strong>{t("Standardmodell")}</strong><span class="muted">{t("Nye tråder i prosjektet bruker denne.")}</span></div>
        <Select<string | null>
          label={t("Standardmodell")}
          value={props.model}
          options={[{ value: null, label: t("Appens standard") }, ...app.models.map((m) => ({ value: m.id as string | null, label: m.name }))]}
          onChange={props.onModel}
        />
      </div>
      <div class="project-agent-row">
        <div class="setting-text"><strong>{t("Tillatelser")}</strong><span class="muted">{PERMISSION_TEXT[props.permission]}</span></div>
        <Select<PermissionMode> label={t("Tillatelser")} value={props.permission} options={PERMISSIONS} onChange={props.onPermission} />
      </div>
      <div class="project-agent-row">
        <div class="setting-text"><strong>{t("Agenttilgang til nettleseren")}</strong><span class="muted">{t("Overstyrer den globale innstillingen for dette prosjektet.")}</span></div>
        <Select<string>
          label={t("Agenttilgang til nettleseren")}
          value={browserValue()}
          options={browserOptions()}
          onChange={(v) => props.onBrowserAccess(v === "inherit" ? null : v === "allow")}
        />
      </div>
      <label class="field project-agent-instructions"><span>{t("Instruksjoner for prosjektet")} (<code>.agentic/AGENTS.md</code>)</span>
        <textarea
          class="input code-area"
          rows={7}
          spellcheck={false}
          aria-label={t("Instruksjoner for prosjektet")}
          value={props.instructions}
          onInput={(e) => props.onInstructions(e.currentTarget.value)}
          placeholder={t("Gjelder bare dette prosjektet, og går foran de globale instruksjonene.")}
        />
      </label>
    </div>
  );
}

const SOURCE_LABELS: Record<"model" | "permissionMode" | "personality", string> = {
  get model() { return t("Modell"); },
  get permissionMode() { return t("Tillatelser"); },
  get personality() { return t("Personlighet"); },
};

// Where each setting comes from: the global settings.json, the project's .agentic/settings.json,
// and what applies. Without any of them set, one line says so instead of a table of dashes.
export function SourcesTab(props: { config: ProjectConfig | undefined }) {
  const keys = ["model", "permissionMode", "personality"] as const;
  const anySet = () => keys.some((k) => props.config?.global.settings[k] != null || props.config?.project.settings[k] != null);
  return (
    <Show when={props.config} fallback={<p class="muted">{t("Leser innstillingene…")}</p>}>
      {(c) => (
        <div class="config-layers">
          <Show when={anySet()} fallback={<p class="muted">{t("Ingen settings.json setter modell, tillatelser eller personlighet. Alt følger appens standard og valgene under Agent.")}</p>}>
            <table class="usage-table">
              <thead><tr><th>{t("Valg")}</th><th>{t("Globalt")}</th><th>{t("Prosjekt")}</th><th>{t("Gjelder")}</th></tr></thead>
              <tbody>
                <For each={keys}>
                  {(key) => (
                    <tr>
                      <td>{SOURCE_LABELS[key]}</td>
                      <td>{c().global.settings[key] ?? "–"}</td>
                      <td>{c().project.settings[key] ?? "–"}</td>
                      <td><strong>{c().effective[key] ?? "–"}</strong></td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
          <p class="muted small"><Rich text={t("Innstillingene leses fra {file} i {globalDir} og {projectDir}. Prosjektet går foran.")} parts={{ file: <code>settings.json</code>, globalDir: <code>{c().global.dir}</code>, projectDir: <code>.agentic/</code> }} /></p>
          <p class="muted small">{t("Modellen leser: {files}.", { files: c().instructionFiles.join(", ") || t("ingen instruksjonsfiler ennå") })}</p>
          <Show when={c().project.settingsError}><p class="form-error">{c().project.settingsError}</p></Show>
        </div>
      )}
    </Show>
  );
}
