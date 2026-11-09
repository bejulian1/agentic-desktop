// The Agent and Kilder tabs of Rediger prosjekt (EditProject.tsx): the default model, the
// permission mode and the project's own instructions, and where each setting comes from. There is
// no separate dialog any more; openProjectSettings opens Rediger prosjekt on the Agent tab.
import { For, Show } from "solid-js";
import type { PermissionMode, ProjectConfig } from "../../../shared/protocol";
import { app } from "../state/app";
import { Select } from "./Select";

export { openProjectSettings } from "./dialog-state";

const PERMISSIONS: Array<{ value: PermissionMode; label: string }> = [
  { value: "ask", label: "Spør" },
  { value: "accept-edits", label: "Godta redigeringer" },
  { value: "full", label: "Full tilgang" },
];

const PERMISSION_TEXT: Record<PermissionMode, string> = {
  ask: "Lesing er tillatt. Filendringer, kommandoer og nettleser spør først.",
  "accept-edits": "Filendringer er tillatt. Kommandoer og nettleser spør først.",
  full: "Alt er tillatt, unntatt .env-filer og .git/hooks, som alltid spør.",
};

export function AgentTab(props: {
  model: string | null;
  onModel: (id: string | null) => void;
  permission: PermissionMode;
  onPermission: (mode: PermissionMode) => void;
  instructions: string;
  onInstructions: (text: string) => void;
}) {
  return (
    <div class="project-agent">
      <div class="project-agent-row">
        <div class="setting-text"><strong>Standardmodell</strong><span class="muted">Nye tråder i prosjektet bruker denne.</span></div>
        <Select<string | null>
          label="Standardmodell"
          value={props.model}
          options={[{ value: null, label: "Appens standard" }, ...app.models.map((m) => ({ value: m.id as string | null, label: m.name }))]}
          onChange={props.onModel}
        />
      </div>
      <div class="project-agent-row">
        <div class="setting-text"><strong>Tillatelser</strong><span class="muted">{PERMISSION_TEXT[props.permission]}</span></div>
        <Select<PermissionMode> label="Tillatelser" value={props.permission} options={PERMISSIONS} onChange={props.onPermission} />
      </div>
      <label class="field project-agent-instructions"><span>Instruksjoner for prosjektet (<code>.agentic/AGENTS.md</code>)</span>
        <textarea
          class="input code-area"
          rows={7}
          spellcheck={false}
          aria-label="Instruksjoner for prosjektet"
          value={props.instructions}
          onInput={(e) => props.onInstructions(e.currentTarget.value)}
          placeholder="Gjelder bare dette prosjektet, og går foran de globale instruksjonene."
        />
      </label>
    </div>
  );
}

const SOURCE_LABELS: Record<"model" | "permissionMode" | "personality", string> = {
  model: "Modell",
  permissionMode: "Tillatelser",
  personality: "Personlighet",
};

// Where each setting comes from: the global settings.json, the project's .agentic/settings.json,
// and what applies. Without any of them set, one line says so instead of a table of dashes.
export function SourcesTab(props: { config: ProjectConfig | undefined }) {
  const keys = ["model", "permissionMode", "personality"] as const;
  const anySet = () => keys.some((k) => props.config?.global.settings[k] != null || props.config?.project.settings[k] != null);
  return (
    <Show when={props.config} fallback={<p class="muted">Leser innstillingene…</p>}>
      {(c) => (
        <div class="config-layers">
          <Show when={anySet()} fallback={<p class="muted">Ingen settings.json setter modell, tillatelser eller personlighet. Alt følger appens standard og valgene under Agent.</p>}>
            <table class="usage-table">
              <thead><tr><th>Valg</th><th>Globalt</th><th>Prosjekt</th><th>Gjelder</th></tr></thead>
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
          <p class="muted small">Fra <code>settings.json</code> i <code>{c().global.dir}</code> og i <code>.agentic/</code>. Prosjektet går foran.</p>
          <p class="muted small">Modellen leser: {c().instructionFiles.join(", ") || "ingen instruksjonsfiler ennå"}.</p>
          <Show when={c().project.settingsError}><p class="form-error">{c().project.settingsError}</p></Show>
        </div>
      )}
    </Show>
  );
}
