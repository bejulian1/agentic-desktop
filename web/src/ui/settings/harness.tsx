// Innstillinger → Kode-harness (SPEC 22.2): what the model always gets in Kode, in layers. The
// built-in base can be switched off in parts but not edited; the global AGENTS.md is the user's
// own file, with «Gjenopprett standard» that shows the difference and keeps a backup first; and a
// preview of the whole system prompt, layer by layer, with tokens, exactly as a new thread gets it.
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { DiffLineInfo, GlobalConfig, HarnessInfo, HarnessPartInfo, ProjectConfig, PromptLayerInfo } from "../../../../shared/protocol";
import { modelContextOf } from "../../../../shared/protocol";
import { ModelContextSettings } from "./model-context";
import { del, get, patch, post, put } from "../../lib/api";
import { confirmDialog } from "../dialogs";
import { app, currentProject, report, sortedProjects, toast } from "../../state/app";
import { IconChevronDown, IconCopy, IconPencil, IconReset } from "../icons";
import { Select } from "../Select";
import { openProjectSettings } from "../ProjectSettings";
import { Group, Page, Row, Segmented, SkeletonRows } from "./parts";

interface Preview {
  mode: "code" | "chat";
  projectId: string | null;
  layers: PromptLayerInfo[];
  tokens: number;
  tools: string[];
}

const formatTokens = (n: number) => `${n.toLocaleString("nb-NO")} ${n === 1 ? "token" : "tokens"}`;

// Long runs of unchanged lines fold to one line, so the change is what you see.
function foldDiff(lines: DiffLineInfo[], context = 2): Array<DiffLineInfo | { kind: "fold"; count: number }> {
  const out: Array<DiffLineInfo | { kind: "fold"; count: number }> = [];
  const near = (i: number) => lines.slice(Math.max(0, i - context), i + context + 1).some((l) => l.kind !== "same");
  let folded = 0;
  lines.forEach((line, i) => {
    if (line.kind === "same" && !near(i)) {
      folded++;
      return;
    }
    if (folded) out.push({ kind: "fold", count: folded });
    folded = 0;
    out.push(line);
  });
  if (folded) out.push({ kind: "fold", count: folded });
  return out;
}

export function DiffView(props: { lines: DiffLineInfo[]; label: string }) {
  const added = () => props.lines.filter((l) => l.kind === "add").length;
  const removed = () => props.lines.filter((l) => l.kind === "del").length;
  return (
    <div class="harness-diff-wrap">
      <div class="harness-diff-stats muted"><span class="diff-add-count">+{added()}</span> <span class="diff-del-count">−{removed()}</span> linjer</div>
      <pre class="harness-diff" aria-label={props.label} tabindex="0">
        <For each={foldDiff(props.lines)}>
          {(line) =>
            line.kind === "fold" ? (
              <span class="diff-line diff-fold">… {line.count} like linjer …</span>
            ) : (
              <span class={`diff-line diff-${line.kind}`}><span class="diff-sign" aria-hidden="true">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>{line.text || " "}</span>
            )
          }
        </For>
      </pre>
    </div>
  );
}

function PartRow(props: { part: HarnessPartInfo; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <Row as="label" label={props.part.title} text={props.part.text} badge={props.part.locked ? <span class="pill harness-locked">Alltid på</span> : undefined}>
      <input type="checkbox" role="switch" class="switch" checked={props.part.on} disabled={props.part.locked || props.busy} onChange={(e) => props.onChange(e.currentTarget.checked)} />
    </Row>
  );
}

// File configuration and the harness share one AGENTS.md editor below.
function ConfigurationGroups() {
  const [config] = createResource(() => get<GlobalConfig>("/api/config"));
  const project = currentProject;
  const [projectConfig] = createResource(() => project()?.id, (id) => get<ProjectConfig>(`/api/projects/${id}/config`));
  const json = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
  return (
    <>
      <Group title="Global settings.json">
        <div class="setting setting-block">
          <span class="muted">Valgfri fil for standardvalg i nye Kode-tråder: <code>model</code> (modell), <code>permissionMode</code> (<code>ask</code>, <code>accept-edits</code> eller <code>full</code>) og <code>personality</code> (<code>standard</code>, <code>kort</code>, <code>grundig</code>, <code>vennlig</code> eller <code>lærer</code>). Filen ligger i <code>{config()?.dir ?? "…"}</code> og redigeres i et tekstprogram; appen leser den når en ny tråd starter. Er den tom eller mangler, gjelder valgene du gjør i appen. Et prosjekt kan overstyre med sin egen <code>.agentic/settings.json</code>.</span>
          <pre class="code-view">{json(config()?.settings)}</pre>
          <Show when={config()?.settingsError}><p class="form-error">{config()!.settingsError}</p></Show>
        </div>
      </Group>
      <Show when={project()}>
        <Group title={`Prosjektet ${project()!.name}`} action={<button type="button" class="btn btn-small" onClick={() => openProjectSettings(project()!.id)}>Rediger prosjekt…</button>}>
          <Row label=".agentic/AGENTS.md" text={projectConfig()?.project.agentsMd ? `${projectConfig()!.project.agentsMd!.length} tegn` : "Finnes ikke. Lag den i Rediger prosjekt → Agent, eller med /init."} />
          <Row label="Det modellen leser, i rekkefølge" text={projectConfig()?.instructionFiles.length ? projectConfig()!.instructionFiles.join(", ") : "Ingen instruksjonsfiler"} />
          <div class="setting setting-block">
            <span class="muted">Gjeldende innstillinger for prosjektet. Prosjektets <code>.agentic/</code> går foran de globale innstillingene.</span>
            <pre class="code-view">{json(projectConfig()?.effective)}</pre>
          </div>
        </Group>
      </Show>
    </>
  );
}

export function HarnessPage() {
  let baseSection!: HTMLElement;
  let instructionsSection!: HTMLElement;
  let filesSection!: HTMLElement;
  let previewSection!: HTMLElement;
  const jumpTo = (element: HTMLElement) => {
    element.scrollIntoView({ block: "start" });
    element.focus({ preventScroll: true });
  };
  const [info, { mutate }] = createResource(() => get<HarnessInfo>("/api/harness"));
  const [busy, setBusy] = createSignal(false);
  const [text, setText] = createSignal<string | null>(null);
  const [agentsDiff, setAgentsDiff] = createSignal<{ diff: DiffLineInfo[]; hash: string; exists: boolean } | null>(null);
  const [partsReview, setPartsReview] = createSignal(false);
  const [mode, setMode] = createSignal<"code" | "chat">("code");
  const [projectId, setProjectId] = createSignal<string>(currentProject()?.id ?? sortedProjects()[0]?.id ?? "");
  const [previewKey, setPreviewKey] = createSignal(0);
  const [preview] = createResource(
    () => ({ mode: mode(), projectId: projectId(), key: previewKey(), context: JSON.stringify(modelContextOf(app.settings, mode())) }),
    ({ mode, projectId }) => get<Preview>(`/api/harness/preview?mode=${mode}${mode === "code" && projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`),
  );
  // Editing a built-in layer of the previewed prompt: your own text, with {{placeholders}} for the
  // parts that are live. It belongs to what is previewed: Kode with a project, Kode without, or Chat.
  const [editing, setEditing] = createSignal<{ id: string; text: string } | null>(null);
  const [openLayers, setOpenLayers] = createSignal<Set<string>>(new Set());
  const variant = () => (mode() === "chat" ? "Chat" : projectId() ? "Kode med prosjekt" : "Kode uten prosjekt");
  const overrideQuery = (layer?: string) => `mode=${mode()}${mode() === "code" && projectId() ? `&projectId=${encodeURIComponent(projectId())}` : ""}${layer ? `&layer=${encodeURIComponent(layer)}` : ""}`;
  const saveLayer = (layer: PromptLayerInfo) => {
    const draft = editing();
    if (!draft || draft.id !== layer.id) return;
    void run(async () => {
      await put("/api/harness/overrides", { mode: mode(), projectId: mode() === "code" && projectId() ? projectId() : null, layer: layer.id, text: draft.text });
      setEditing(null);
      toast(`Lagret. ${variant()} bruker teksten din fra neste tur.`, "info");
    });
  };
  const resetLayer = async (layer: PromptLayerInfo) => {
    if (!(await confirmDialog({ title: `Tilbakestille «${layer.title}»?`, text: `Din egen tekst for ${variant()} fjernes, og appens innebygde tekst brukes igjen.`, confirm: "Tilbakestill", danger: true }))) return;
    await run(async () => {
      await del(`/api/harness/overrides?${overrideQuery(layer.id)}`);
      if (editing()?.id === layer.id) setEditing(null);
    });
  };
  const resetAllLayers = async () => {
    if (!(await confirmDialog({ title: "Tilbakestille alle lagene?", text: `Alle egne tekster for ${variant()} fjernes, og appens innebygde systemprompt brukes igjen. Global AGENTS.md og Chat-personalisering røres ikke.`, confirm: "Tilbakestill alle", danger: true }))) return;
    await run(async () => {
      await del(`/api/harness/overrides?${overrideQuery()}`);
      setEditing(null);
    });
  };
  const anyOverridden = () => !!preview.latest?.layers.some((l) => l.overridden);
  const agentsText = () => text() ?? info()?.agents.text ?? "";
  const dirty = () => text() !== null && text() !== (info()?.agents.text ?? "");

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setPreviewKey(previewKey() + 1);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const setPart = (part: HarnessPartInfo, on: boolean) =>
    run(async () => {
      mutate(await patch<HarnessInfo>("/api/harness", { parts: { [part.id]: on } }));
    });

  const saveAgents = () =>
    run(async () => {
      await put<GlobalConfig>("/api/config/agents-md", { text: agentsText() });
      mutate(await get<HarnessInfo>("/api/harness"));
      setText(null);
      setAgentsDiff(null);
      toast("Lagret AGENTS.md.", "info");
    });

  const reviewAgents = () =>
    run(async () => {
      if (dirty()) {
        toast("Lagre eller forkast endringene i feltet først.", "info");
        return;
      }
      setAgentsDiff(await get<{ diff: DiffLineInfo[]; hash: string; exists: boolean }>("/api/harness/agents-md/default"));
    });

  const restoreAgents = () =>
    run(async () => {
      const review = agentsDiff();
      if (!review) return;
      const done = await post<{ harness: HarnessInfo; backup?: string }>("/api/harness/restore", { agents: review.hash });
      mutate(done.harness);
      setText(null);
      setAgentsDiff(null);
      toast(done.backup ? `Standard er gjenopprettet. Den gamle fila er lagret som ${done.backup.split("/").pop()}.` : "Standard er gjenopprettet.", "info");
    });

  const restoreParts = () =>
    run(async () => {
      mutate((await post<{ harness: HarnessInfo }>("/api/harness/restore", { parts: true })).harness);
      setPartsReview(false);
      toast("Harness-valgene er tilbake til standard.", "info");
    });

  const partChanges = createMemo(() => (info()?.parts ?? []).filter((p) => !p.locked && p.on !== p.default));
  const unchanged = () => !agentsDiff()?.diff.some((l) => l.kind !== "same");

  const copyPrompt = () => {
    const all = preview.latest?.layers.map((l) => l.text).join("\n\n") ?? "";
    navigator.clipboard?.writeText(all).then(() => toast("Systemprompten er kopiert.", "info")).catch(() => toast("Kunne ikke kopiere.", "error"));
  };

  return (
    <Page
      title="Konfigurasjon"
      intro="Instruksjoner, innstillinger og kode-harness samlet: grunnreglene, konteksten, global AGENTS.md og prosjektets konfigurasjon. Dette gjelder Kode. Chat har egne instruksjoner under Personalisering og minner."
    >
      <nav class="settings-group memory-actions" style={{ "flex-wrap": "wrap" }} aria-label="Deler av konfigurasjonen">
        <button type="button" class="btn btn-small" onClick={() => jumpTo(baseSection)}>Grunn-harness</button>
        <button type="button" class="btn btn-small" onClick={() => jumpTo(instructionsSection)}>Instruksjoner</button>
        <button type="button" class="btn btn-small" onClick={() => jumpTo(filesSection)}>Filer og prosjekt</button>
        <button type="button" class="btn btn-small" onClick={() => jumpTo(previewSection)}>Forhåndsvisning</button>
      </nav>
      <section ref={baseSection} tabindex="-1" aria-label="Grunn-harness og kontekst">
      <ModelContextSettings mode="code" />
      <Show when={info()} fallback={<SkeletonRows label="Henter harnessen…" />}>
        <Group
          title="Grunn-harness"
          action={
            <button type="button" class="btn btn-small" disabled={info()!.partsAreDefault || busy()} onClick={() => setPartsReview(!partsReview())}>
              <IconReset size={13} />Gjenopprett standard
            </button>
          }
        >
          <Show when={partsReview() && partChanges().length}>
            <div class="setting setting-block harness-review" data-testid="parts-review">
              <strong>Disse valgene går tilbake til standard:</strong>
              <ul class="harness-changes">
                <For each={partChanges()}>{(p) => <li><span>{p.title}</span><span class="muted">{p.on ? "på" : "av"} → <strong>{p.default ? "på" : "av"}</strong></span></li>}</For>
              </ul>
              <div class="form-actions">
                <button type="button" class="btn btn-small" onClick={() => setPartsReview(false)}>Avbryt</button>
                <button type="button" class="btn btn-small btn-primary" disabled={busy()} onClick={() => void restoreParts()}>Gjenopprett</button>
              </div>
            </div>
          </Show>
          <For each={info()!.parts}>{(part) => <PartRow part={part} busy={busy()} onChange={(on) => void setPart(part, on)} />}</For>
        </Group>

        </Show>
      </section>
      <section ref={instructionsSection} tabindex="-1" aria-label="Instruksjoner">
      <Show when={info()}>
        <Group
          title="Global AGENTS.md"
          action={
            <div class="memory-actions">
              <button type="button" class="btn btn-small" disabled={busy() || (info()!.agents.isDefault && !dirty())} onClick={() => void reviewAgents()}><IconReset size={13} />Gjenopprett standard…</button>
              <button type="button" class="btn btn-small btn-primary" disabled={!dirty() || busy()} onClick={() => void saveAgents()}>Lagre</button>
            </div>
          }
        >
          <Show when={agentsDiff()}>
            {(review) => (
              <div class="setting setting-block harness-review" data-testid="agents-review">
                <strong>{unchanged() ? "Fila er allerede lik standarden." : review().exists ? "Dette endres hvis du gjenoppretter standarden:" : "Fila finnes ikke. Standarden blir lagt inn:"}</strong>
                <Show when={!unchanged()}>
                  <DiffView lines={review().diff} label="Forskjell mellom din AGENTS.md og standarden" />
                  <span class="muted small">{review().exists ? "Den gamle fila tas vare på som sikkerhetskopi i backups/ ved siden av." : "Ingenting overskrives."}</span>
                </Show>
                <div class="form-actions">
                  <button type="button" class="btn btn-small" onClick={() => setAgentsDiff(null)}>Avbryt</button>
                  <button type="button" class="btn btn-small btn-primary" disabled={busy() || unchanged()} onClick={() => void restoreAgents()}>Gjenopprett standard</button>
                </div>
              </div>
            )}
          </Show>
          <div class="setting setting-block">
            <span class="muted">
              Instruksjoner for alle prosjekter i Kode, i <code>{info()!.agents.file}</code>. {info()!.agents.text === null ? "Fila finnes ikke nå." : info()!.agents.isDefault ? "Dette er standardinnholdet appen la inn." : "Endret av deg."} Prosjektets egen AGENTS.md går foran.
            </span>
            <textarea
              class="input code-area harness-agents"
              aria-label="Global AGENTS.md i Kode-harness"
              rows={14}
              spellcheck={false}
              value={agentsText()}
              onInput={(e) => setText(e.currentTarget.value)}
              placeholder="For eksempel: Svar kort. Skriv kommentarer på engelsk."
            />
            <Show when={info()!.agents.backups.length}>
              <span class="muted small">Siste sikkerhetskopi: <code>{info()!.agents.backups[0].path}</code></span>
            </Show>
          </div>
        </Group>
      </Show>

      </section>
      <section ref={filesSection} tabindex="-1" aria-label="Filer og prosjekt">
        <ConfigurationGroups />
      </section>
      <section ref={previewSection} tabindex="-1" aria-label="Forhåndsvisning">

      <Group
        title="Forhåndsvisning"
        action={
          <>
            <Show when={anyOverridden()}><button type="button" class="btn btn-small" disabled={busy()} onClick={() => void resetAllLayers()}><IconReset size={13} />Tilbakestill alle</button></Show>
            <button type="button" class="btn btn-small" disabled={!preview.latest?.layers.length} onClick={copyPrompt}><IconCopy size={13} />Kopier</button>
          </>
        }
      >
        <div class="setting harness-preview-tools">
          <div class="setting-text">
            <strong>Systemprompten slik modellen får den</strong>
            <span class="muted">For en ny tråd nå. Tokens er anslått til omtrent fire tegn hver. Åpne et lag for å lese det, redigere det eller tilbakestille det.</span>
          </div>
          <div class="setting-control">
            <Segmented<"code" | "chat"> label="Forhåndsvis modus" value={mode()} options={[{ value: "code", label: "Kode" }, { value: "chat", label: "Chat" }]} onChange={setMode} />
            <Show when={mode() === "code" && sortedProjects().length}>
              <Select<string> label="Prosjekt" value={projectId()} options={[{ value: "", label: "Ingen prosjekt valgt" }, ...sortedProjects().map((p) => ({ value: p.id, label: p.name }))]} onChange={setProjectId} />
            </Show>
          </div>
        </div>
        <Show when={mode() === "code" && !projectId()}>
          <div class="setting"><span class="muted">Du er i Kode uten et valgt prosjekt. Agenten jobber da på Denne datamaskinen, med hjemmemappen din som arbeidsmappe: den kan lese og skrive filer og kjøre kommandoer med de vanlige godkjenningene. Hjelpetråder, oppgavelisten og appens nettleser krever et prosjekt.</span></div>
        </Show>
        {/* preview.latest keeps the last prompt on screen while the next one loads. Reading preview()
            there would suspend the whole settings page, which put the scroll position back at the top. */}
        <Show when={preview.latest} fallback={<SkeletonRows label="Bygger systemprompten…" count={4} />}>
          {(p) => (
            <>
              <div class="harness-total" data-testid="prompt-total">
                <span><strong>{formatTokens(p().tokens)}</strong> i {p().layers.length} lag</span>
                <Show when={p().tools.length}><span class="muted">{p().tools.length} verktøy på</span></Show>
                <span class="harness-bar" aria-hidden="true">
                  <For each={p().layers}>{(l) => <i class={`layer-${l.id}`} style={{ "flex-grow": String(Math.max(l.tokens, 1)) }} title={`${l.title}: ${formatTokens(l.tokens)}`} />}</For>
                </span>
              </div>
              <ol class="harness-layers" aria-label="Lag i systemprompten">
                <For each={p().layers}>
                  {(layer) => (
                    <li class="harness-layer" data-layer={layer.id} data-overridden={layer.overridden ? "" : undefined}>
                      <details
                        open={openLayers().has(layer.id)}
                        onToggle={(e) => { const next = new Set(openLayers()); if (e.currentTarget.open) next.add(layer.id); else next.delete(layer.id); setOpenLayers(next); }}
                      >
                        <summary>
                          <span class={`layer-dot layer-${layer.id}`} aria-hidden="true" />
                          <span class="layer-title">{layer.title}</span>
                          <Show when={layer.overridden}><span class="layer-own">Endret</span></Show>
                          <span class="muted layer-source" title={layer.source}>{layer.source}</span>
                          <span class="layer-tokens">{formatTokens(layer.tokens)}</span>
                          <IconChevronDown size={13} />
                        </summary>
                        <Show
                          when={editing()?.id === layer.id}
                          fallback={
                            <>
                              <pre class="code-view harness-layer-text">{layer.text}</pre>
                              <Show when={layer.editable} fallback={<p class="muted small harness-layer-note">{layer.id === "env" ? "Miljøet er levende tilstand og settes inn av appen for hver tur. Det kan ikke redigeres." : "Dette laget redigeres der det hører hjemme: global AGENTS.md over, eller Chat-personalisering."}</p>}>
                                <div class="harness-layer-actions">
                                  <button type="button" class="btn btn-small" disabled={busy()} onClick={() => setEditing({ id: layer.id, text: layer.template ?? layer.text })}><IconPencil size={13} />Rediger</button>
                                  <Show when={layer.overridden}><button type="button" class="btn btn-small btn-quiet" disabled={busy()} onClick={() => void resetLayer(layer)}><IconReset size={13} />Tilbakestill</button></Show>
                                  <span class="muted small">{layer.overridden ? `Din egen tekst er i bruk for ${variant()}. Den følger ikke appens senere forbedringer av dette laget.` : `Innebygd tekst. Rediger for å prøve din egen for ${variant()}.`}</span>
                                </div>
                              </Show>
                            </>
                          }
                        >
                          <div class="harness-layer-editor">
                            <textarea
                              class="input code-area"
                              aria-label={`Egen tekst for ${layer.title}`}
                              rows={18}
                              spellcheck={false}
                              value={editing()!.text}
                              onInput={(e) => setEditing({ id: layer.id, text: e.currentTarget.value })}
                            />
                            <Show when={layer.placeholders?.length}>
                              <p class="muted small">Plassholdere fylles inn for hver tråd: <For each={layer.placeholders}>{(name) => <code>{`{{${name}}}`}</code>}</For>. Fjerner du en, mister modellen den opplysningen.</p>
                            </Show>
                            <Show when={layer.id === "base" || layer.id === "chat-base"}>
                              <p class="muted small">Når grunnen er din egen tekst, gjelder ikke bryterne for delene over, og sikkerhetsreglene i teksten er dine. Godkjenninger og tillatelser håndheves av appen uansett.</p>
                            </Show>
                            <div class="harness-layer-actions">
                              <button type="button" class="btn btn-small btn-primary" disabled={busy() || !editing()!.text.trim()} onClick={() => saveLayer(layer)}>Lagre for {variant()}</button>
                              <button type="button" class="btn btn-small" disabled={busy()} onClick={() => setEditing(null)}>Avbryt</button>
                              <Show when={layer.overridden}><button type="button" class="btn btn-small btn-quiet" disabled={busy()} onClick={() => void resetLayer(layer)}><IconReset size={13} />Tilbakestill</button></Show>
                            </div>
                          </div>
                        </Show>
                      </details>
                    </li>
                  )}
                </For>
              </ol>
            </>
          )}
        </Show>
      </Group>
      </section>
      <p class="muted small memory-files">
        Grunn-harnessen er versjon {info()?.version ?? "…"} og ligger i appen{app.build ? ` (v${app.build.version})` : ""}. Den kan slås av i deler, og hvert innebygde lag kan erstattes med din egen tekst i forhåndsvisningen over. Valgene lagres i datamappen.
      </p>
    </Page>
  );
}
