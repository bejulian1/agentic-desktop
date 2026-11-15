// Innstillinger → MCP-servere: the servers the user has added, with status, tools and the form to
// add or change one. Presets (GitHub, Playwright) only fill in the form; nothing connects until
// the user saves. Secret values are typed here and sent once; the server keeps them in the
// keyring and never sends them back, so an empty secret field means "keep what is stored".
import { createSignal, createUniqueId, For, onMount, Show } from "solid-js";
import { MCP_PRESETS, type McpPairView, type McpPreset, type McpServerInput, type McpServerView } from "../../../../shared/mcp";
import { report } from "../../state/app";
import { createMcpServer, mcpState, reconnectMcpServer, refreshMcp, removeMcpServer, updateMcpServer } from "../../state/mcp";
import { confirmDialog } from "../dialogs";
import { IconPlus, IconTrash } from "../icons";
import { SecretInput } from "../SecretInput";
import { Group, Page, Row, Segmented } from "./parts";
import "../../styles/mcp.css";

interface PairDraft {
  name: string;
  value: string;
  secret: boolean;
  set: boolean; // a secret is already stored under this name
}

interface Draft {
  id: string | null; // null for a new server
  preset?: McpPreset["id"];
  hint?: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string; // one per line
  env: PairDraft[];
  url: string;
  headers: PairDraft[];
  code: boolean;
  chat: boolean;
  approval: "ask" | "auto";
  timeoutSeconds: string;
}

const STATUS_LABEL: Record<McpServerView["status"], string> = { disabled: "Av", connecting: "Kobler til", connected: "Tilkoblet", error: "Feil" };

function fromPreset(preset: McpPreset): Draft {
  const s = preset.server;
  const pairs = (list: McpServerInput["env"]) => (list ?? []).map((p) => ({ name: p.name, value: p.value ?? "", secret: p.secret, set: false }));
  return {
    id: null, preset: preset.id, hint: preset.hint, name: s.name, transport: s.transport, command: s.command ?? "", args: (s.args ?? []).join("\n"),
    env: pairs(s.env), url: s.url ?? "", headers: pairs(s.headers), code: s.code ?? true, chat: s.chat ?? false, approval: s.approval ?? "ask", timeoutSeconds: "120",
  };
}

function fromServer(server: McpServerView): Draft {
  const pairs = (list: McpPairView[]) => list.map((p) => ({ name: p.name, value: p.value, secret: p.secret, set: p.set }));
  return {
    id: server.id, name: server.name, transport: server.transport, command: server.command, args: server.args.join("\n"), env: pairs(server.env),
    url: server.url, headers: pairs(server.headers), code: server.code, chat: server.chat, approval: server.approval, timeoutSeconds: String(server.timeoutSeconds),
  };
}

function toInput(draft: Draft): McpServerInput {
  const pairs = (list: PairDraft[]) => list.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), secret: p.secret, ...(p.value ? { value: p.value } : {}) }));
  return {
    name: draft.name.trim(),
    transport: draft.transport,
    ...(draft.transport === "stdio"
      ? { command: draft.command.trim(), args: draft.args.split("\n").map((a) => a.trim()).filter(Boolean), env: pairs(draft.env) }
      : { url: draft.url.trim(), headers: pairs(draft.headers) }),
    code: draft.code,
    chat: draft.chat,
    approval: draft.approval,
    timeoutSeconds: Number(draft.timeoutSeconds) || 120,
  };
}

export function McpPage() {
  const [draft, setDraft] = createSignal<Draft | null>(null);
  onMount(() => void refreshMcp().catch(report));
  const capped = () => {
    const s = mcpState();
    return s.capped.code || s.capped.chat;
  };
  return (
    <Page title="MCP-servere" intro="Koble modellen til verktøy fra MCP-servere, for eksempel GitHub eller en nettleser med Playwright. Verktøyene brukes gjennom de vanlige godkjenningene.">
      <Show when={capped()}>
        <p class="settings-intro mcp-cap" role="status">
          En tur får høyst {mcpState().limit} MCP-verktøy. {mcpState().capped.code ? `Kode får ${mcpState().offered.code}` : ""}{mcpState().capped.code && mcpState().capped.chat ? " og " : ""}{mcpState().capped.chat ? `Chat får ${mcpState().offered.chat}` : ""}, og resten er utelatt. Slå av verktøy du ikke trenger, så får modellen dem som gjenstår.
        </p>
      </Show>
      <Group title="Legg til server">
        <Row label="Velg et utgangspunkt" text="Skjemaet fylles ut. Ingenting kobles til før du lagrer.">
          <div class="mcp-presets">
            <For each={MCP_PRESETS}>
              {(preset) => <button type="button" class="btn btn-small" onClick={() => setDraft(fromPreset(preset))}><Show when={preset.id === "custom"}><IconPlus size={13} /></Show>{preset.label}</button>}
            </For>
          </div>
        </Row>
        {/* Keyed: choosing another preset while the form is open makes a new form with its values. */}
        <Show when={draft()?.id === null ? draft() : undefined} keyed>
          {(d) => <div class="setting setting-block"><ServerForm draft={d} onDone={() => setDraft(null)} /></div>}
        </Show>
      </Group>
      <Group title="Servere">
        <Show when={mcpState().servers.length} fallback={<Row label="Ingen MCP-servere ennå" text="Legg til en over. Modellen får verktøyene i Kode, og i Chat hvis du slår det på." />}>
          <div class="mcp-list">
            <For each={mcpState().servers}>{(server) => <ServerCard server={server} editing={draft()?.id === server.id} onEdit={(open) => setDraft(open ? fromServer(server) : null)} draft={draft()} onDone={() => setDraft(null)} />}</For>
          </div>
        </Show>
      </Group>
    </Page>
  );
}

function ServerCard(props: { server: McpServerView; editing: boolean; draft: Draft | null; onEdit: (open: boolean) => void; onDone: () => void }) {
  const server = () => props.server;
  const [busy, setBusy] = createSignal(false);
  const act = async (work: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    try {
      await work();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };
  // A stored entry the server could not read: shown in error and off, with only Rediger and Slett.
  // It cannot be switched on or reconnected (409) until it is saved again from the form.
  const broken = () => server().status === "error" && !server().enabled;
  const where = () => (server().transport === "stdio" ? [server().command, ...server().args].join(" ") : server().url);
  const modes = () => [server().code ? "Kode" : "", server().chat ? "Chat" : ""].filter(Boolean).join(" og ") || "ingen modus";
  // Switches are never disabled while saving (a disabled control loses the keyboard focus), and
  // go back to the stored value when the change fails.
  const flip = (box: HTMLInputElement, stored: () => boolean, work: () => Promise<unknown>) => void work().catch((err) => {
    box.checked = stored();
    report(err);
  });
  const toggleTool = (box: HTMLInputElement, name: string) => {
    const off = new Set(server().disabledTools);
    if (box.checked) off.delete(name);
    else off.add(name);
    flip(box, () => !server().disabledTools.includes(name), () => updateMcpServer(server().id, { disabledTools: [...off] }));
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Slette ${server().name}?`, text: "Serveren stoppes, og hemmelighetene som hører til den fjernes fra nøkkelringen. Dette kan ikke angres.", confirm: "Slett", danger: true });
    if (ok) void act(() => removeMcpServer(server().id));
  };
  return (
    <div class="card mcp-server" data-status={server().status}>
      <div class="card-head">
        <span class="mcp-dot" data-status={server().status} role="img" aria-label={STATUS_LABEL[server().status]} title={STATUS_LABEL[server().status]} />
        <div class="card-title">
          <strong>{server().name}</strong>
          <span class="muted">
            {server().transport === "stdio" ? "stdio" : "HTTP"} · {server().status === "connected" ? `${server().tools.length} verktøy` : STATUS_LABEL[server().status]} · {modes()}
            {server().approval === "auto" ? " · kjører uten å spørre" : ""}
          </span>
          <Show when={where()}><span class="muted mcp-where"><code>{where()}</code></span></Show>
          <Show when={server().slug}>
            <span class="muted mcp-slug">Kortnavn: <code>{server().slug}</code> · i hooks: <code>{`mcp__${server().slug}__*`}</code></span>
          </Show>
        </div>
        <div class="provider-actions">
          <Show when={!broken()}>
          <input type="checkbox" role="switch" class="switch" aria-label={`Bruk ${server().name}`} checked={server().enabled} onChange={(e) => { const box = e.currentTarget; flip(box, () => server().enabled, () => updateMcpServer(server().id, { enabled: box.checked })); }} />
          </Show>
          <Show when={server().enabled}>
            <button type="button" class="btn btn-small" disabled={busy() || server().status === "connecting"} onClick={() => void act(() => reconnectMcpServer(server().id))}>Koble til på nytt</button>
          </Show>
          <button type="button" class="btn btn-small btn-quiet" aria-expanded={props.editing} onClick={() => props.onEdit(!props.editing)}>Rediger</button>
          <button type="button" class="btn btn-small btn-quiet" aria-label={`Slett ${server().name}`} disabled={busy()} onClick={() => void remove()}><IconTrash size={13} /></button>
        </div>
      </div>
      <Show when={server().message}>
        <p class="test-result" classList={{ bad: server().status === "error", "mcp-message": server().status !== "error" }} role={server().status === "error" ? "alert" : "status"}>{server().message}</p>
      </Show>
      <Show when={server().stderr}>
        <details class="mcp-details">
          <summary>Utdata fra serveren (stderr)</summary>
          <pre class="code-view">{server().stderr}</pre>
        </details>
      </Show>
      <Show when={props.editing && props.draft}>
        <div class="provider-edit"><ServerForm draft={props.draft!} onDone={props.onDone} /></div>
      </Show>
      <Show when={server().tools.length}>
        <details class="mcp-details">
          <summary>Verktøy ({server().tools.filter((t) => t.enabled).length} av {server().tools.length} på)</summary>
          <ul class="model-list" aria-label={`Verktøy fra ${server().name}`}>
            <For each={server().tools}>
              {(tool) => {
                const left = () => tool.enabled && ((server().code && !tool.offered.code) || (server().chat && !tool.offered.chat));
                return (
                  <li class="model-row mcp-tool">
                    <label class="field-check">
                      <input type="checkbox" role="switch" class="switch" checked={tool.enabled} onChange={(e) => toggleTool(e.currentTarget, tool.name)} />
                      <span class="field-check-text">
                        <span>{tool.title ?? tool.name} <code class="model-id">{tool.exposed}</code><Show when={left()}> <span class="key-tag">Over grensen</span></Show></span>
                        <Show when={tool.description}><span class="muted">{tool.description}</span></Show>
                      </span>
                    </label>
                  </li>
                );
              }}
            </For>
          </ul>
        </details>
      </Show>
    </div>
  );
}

function PairList(props: { label: string; kind: "env" | "header"; pairs: PairDraft[]; onChange: (pairs: PairDraft[]) => void }) {
  const update = (i: number, patch: Partial<PairDraft>) => props.onChange(props.pairs.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <div class="field" role="group" aria-label={props.label}>
      <span aria-hidden="true">{props.label}</span>
      <For each={props.pairs}>
        {(pair, i) => (
          <div class="field-row mcp-pair">
            <input class="input" aria-label={props.kind === "env" ? "Navn på miljøvariabel" : "Navn på header"} value={pair.name} placeholder={props.kind === "env" ? "NAVN" : "Header-navn"} spellcheck={false} onInput={(e) => update(i(), { name: e.currentTarget.value })} />
            <Show when={pair.secret} fallback={<input class="input" aria-label={`Verdi for ${pair.name || (props.kind === "env" ? "variabelen" : "headeren")}`} value={pair.value} spellcheck={false} onInput={(e) => update(i(), { value: e.currentTarget.value })} />}>
              <SecretInput
                label={`Verdi for ${pair.name || "hemmeligheten"}`}
                value={pair.value}
                onInput={(value) => update(i(), { value })}
                placeholder={pair.set ? "Lagret. Skriv for å bytte." : pair.name.toLowerCase() === "authorization" ? "Bearer <token>" : "Lagres i nøkkelringen"}
              />
            </Show>
            <label class="mcp-secret"><input type="checkbox" checked={pair.secret} onChange={(e) => update(i(), { secret: e.currentTarget.checked })} /> Hemmelig</label>
            <button type="button" class="btn btn-small btn-quiet" aria-label={`Fjern ${pair.name || "raden"}`} onClick={() => props.onChange(props.pairs.filter((_, k) => k !== i()))}><IconTrash size={13} /></button>
          </div>
        )}
      </For>
      <div><button type="button" class="btn btn-small" onClick={() => props.onChange([...props.pairs, { name: "", value: "", secret: props.kind === "header", set: false }])}><IconPlus size={13} />{props.kind === "env" ? "Legg til variabel" : "Legg til header"}</button></div>
    </div>
  );
}

function ServerForm(props: { draft: Draft; onDone: () => void }) {
  const [draft, setDraft] = createSignal<Draft>(structuredClone(props.draft));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const set = (patch: Partial<Draft>) => setDraft({ ...draft(), ...patch });
  // Explicit for/id pairs, so every field is named by its visible label, not its placeholder.
  const uid = createUniqueId();
  const ids = { name: `${uid}-name`, url: `${uid}-url`, command: `${uid}-command`, args: `${uid}-args`, timeout: `${uid}-timeout` };
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const d = draft();
      if (d.id) await updateMcpServer(d.id, toInput(d));
      else await createMcpServer(toInput(d));
      props.onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="form" onSubmit={submit} aria-label="MCP-server">
      <Show when={draft().hint}><p class="muted">{draft().hint}</p></Show>
      <div class="field"><label for={ids.name}>Navn</label><input id={ids.name} class="input" required maxLength={60} value={draft().name} onInput={(e) => set({ name: e.currentTarget.value })} placeholder="Min server" /></div>
      <div class="field"><span>Tilkobling</span>
        <Segmented label="Tilkobling" value={draft().transport} options={[{ value: "stdio", label: "Kommando (stdio)" }, { value: "http", label: "Adresse (HTTP)" }]} onChange={(transport) => set({ transport })} />
      </div>
      <Show
        when={draft().transport === "stdio"}
        fallback={
          <>
            <div class="field"><label for={ids.url}>Adresse</label><input id={ids.url} class="input" aria-describedby={`${ids.url}-hint`} value={draft().url} onInput={(e) => set({ url: e.currentTarget.value })} placeholder="https://api.githubcopilot.com/mcp/" spellcheck={false} />
              <span id={`${ids.url}-hint`} class="muted small">Legg hemmeligheter i en hemmelig header, ikke i adressen. Adressen lagres og vises i klartekst.</span>
            </div>
            <PairList label="HTTP-hoder" kind="header" pairs={draft().headers} onChange={(headers) => set({ headers })} />
          </>
        }
      >
        <div class="field"><label for={ids.command}>Kommando</label><input id={ids.command} class="input" value={draft().command} onInput={(e) => set({ command: e.currentTarget.value })} placeholder="npx" spellcheck={false} /></div>
        <div class="field"><label for={ids.args}>Argumenter, ett per linje</label><textarea id={ids.args} class="input code-input mcp-args" rows={4} value={draft().args} onInput={(e) => set({ args: e.currentTarget.value })} spellcheck={false} /></div>
        <PairList label="Miljøvariabler" kind="env" pairs={draft().env} onChange={(env) => set({ env })} />
      </Show>
      <label class="field-check">
        <input type="checkbox" role="switch" class="switch" checked={draft().code} onChange={(e) => set({ code: e.currentTarget.checked })} />
        <span class="field-check-text"><span>Bruk i Kode</span><span class="muted">Spør før hvert kall i modusene «Spør» og «Godta redigeringer», med «Tillat alltid» per verktøy.</span></span>
      </label>
      <label class="field-check">
        <input type="checkbox" role="switch" class="switch" checked={draft().chat} onChange={(e) => set({ chat: e.currentTarget.checked })} />
        <span class="field-check-text"><span>Bruk i Chat</span><span class="muted">Chat spør før hvert kall, eller for resten av samtalen.</span></span>
      </label>
      <div class="field"><span>Godkjenning</span>
        <Segmented label="Godkjenning" value={draft().approval} options={[{ value: "ask", label: "Spør" }, { value: "auto", label: "Automatisk" }]} onChange={(approval) => set({ approval })} />
        <Show when={draft().approval === "auto"}><span class="muted">Verktøyene kjører uten å spørre, også i Chat. Bruk det bare for servere du stoler på.</span></Show>
      </div>
      <div class="field"><label for={ids.timeout}>Tidsgrense per kall (sekunder)</label><input id={ids.timeout} class="input" inputmode="numeric" value={draft().timeoutSeconds} onInput={(e) => set({ timeoutSeconds: e.currentTarget.value })} /></div>
      <Show when={error()}><p class="test-result bad" role="alert">{error()}</p></Show>
      <div class="form-actions">
        <button type="button" class="btn" onClick={props.onDone}>Avbryt</button>
        <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? "Lagrer…" : draft().id ? "Lagre" : "Lagre og koble til"}</button>
      </div>
    </form>
  );
}
