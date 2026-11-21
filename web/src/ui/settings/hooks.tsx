// Innstillinger → Hooks: shell commands the app runs on agent events, in Kode and Chat. A list with
// on/off, event, filter and command, and the last run of each; a form with «Test»; a few examples
// to start from. The server side is server/src/hooks.ts, and docs/HOOKS.md is the user's guide.
import { createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { HOOK_EVENTS, HOOK_TIMEOUT_DEFAULT, HOOK_TIMEOUT_MAX, isToolEvent, type HookEvent, type HookInfo, type HookMode, type HookRun, type HookTestResult } from "../../../../shared/hooks";
import { relativeTime } from "../../lib/format";
import { onOpen } from "../../lib/socket";
import { report, toast } from "../../state/app";
import { createHook, deleteHook, hooksState, refreshHooks, reorderHooks, testHook, updateHook, type HookDraft } from "../../state/hooks";
import { confirmDialog } from "../dialogs";
import { IconChevronDown, IconPencil, IconPlay, IconPlus, IconTrash } from "../icons";
import { Popover } from "../Popover";
import { Select } from "../Select";
import { Group, Page, Rich, Row, SkeletonRows } from "./parts";
import "../../styles/hooks.css";

import { t } from "../../lib/i18n";
// Getters, so a label is translated when it is read and follows the active language.
export const HOOK_EVENT_LABELS: Record<HookEvent, string> = {
  get PreToolUse() { return t("Før verktøykall"); },
  get PostToolUse() { return t("Etter verktøykall"); },
  get UserPromptSubmit() { return t("Når du sender en melding"); },
  get Stop() { return t("Når turen er ferdig"); },
};

const eventHelp = (event: HookEvent): string => ({
  PreToolUse: t("Kjører etter appens egen godkjenning, rett før verktøyet. Avslutningskode 2 stopper kallet, og stderr går til modellen som verktøyets feil."),
  PostToolUse: t("Kjører når verktøyet er ferdig. Avslutningskode 2 legger stderr til i verktøyresultatet som tilbakemelding til modellen."),
  UserPromptSubmit: t("Kjører før meldingen når modellen. Avslutningskode 2 stopper meldingen og viser stderr til deg. Stdout ved kode 0 legges til som kontekst."),
  Stop: t("Kjører når agenten er ferdig med turen, også når den feilet, men ikke når du trykker Stopp. Kan ikke stoppe noe, men passer til varsler."),
})[event];

const outcomeLabel = (outcome: HookRun["outcome"]): string => ({
  ok: t("OK"),
  blocked: t("Stoppet"),
  error: t("Feil"),
  timeout: t("Tidsavbrudd"),
  cancelled: t("Avbrutt"),
})[outcome];

const modeLabel = (mode: HookMode): string => (mode === "code" ? t("Kode") : t("Chat"));

// Ready-made hooks to start from. They open in the form, so nothing is saved before the user has
// read the command. A function, so the texts follow the active language; the commands stay as they are.
const exampleHooks = (): Array<{ title: string; text: string; draft: HookDraft }> => [
  {
    title: t("Formater etter filendringer"),
    text: t("Kjører Prettier på filen agenten skrev eller endret. Bruker jq."),
    draft: {
      name: t("Formater med Prettier"),
      event: "PostToolUse",
      matcher: "edit_file|write_file",
      command: `f=$(jq -r '.tool_input.path // empty'); [ -n "$f" ] && npx --no-install prettier --write "$f" >/dev/null 2>&1 || true`,
      timeoutSeconds: 30,
      enabled: true,
      modes: ["code"],
    },
  },
  {
    title: t("Skrivebordsvarsel når turen er ferdig"),
    text: t("Et varsel med notify-send, så du ser det når en lang oppgave er ferdig."),
    draft: {
      name: t("Varsel når ferdig"),
      event: "Stop",
      matcher: "",
      command: `notify-send "Agentic Desktop" "Agenten er ferdig med turen"`,
      timeoutSeconds: 10,
      enabled: true,
      modes: ["code", "chat"],
    },
  },
  {
    title: t("Stopp rm -rf i kommandoer"),
    text: t("Stopper run_command når kommandoen inneholder rm -rf, og sier fra til modellen hvorfor."),
    draft: {
      name: t("Ingen rm -rf"),
      event: "PreToolUse",
      matcher: "run_command",
      command: `if grep -Eq 'rm[[:space:]]+-[[:alpha:]]*(r[[:alpha:]]*f|f[[:alpha:]]*r)'; then echo "rm -rf er sperret av en hook. Slett filer enkeltvis, eller spør brukeren." >&2; exit 2; fi`,
      timeoutSeconds: 10,
      enabled: true,
      modes: ["code"],
    },
  },
];

const code = (text: string) => <code>{text}</code>;

const EMPTY: HookDraft = { name: "", event: "PreToolUse", matcher: "", command: "", timeoutSeconds: HOOK_TIMEOUT_DEFAULT, enabled: true, modes: ["code", "chat"] };

interface Editing {
  id: string | null; // null for a new hook
  draft: HookDraft;
}

function draftOf(hook: HookInfo): HookDraft {
  const { id: _id, lastRun: _run, ...draft } = hook;
  return draft;
}

function RunLine(props: { run: HookRun }) {
  // The same limit as relativeTime()'s «nå». Outside Norwegian relativeTime() answers with a whole
  // phrase («5 min. ago»), so {time} in these texts is translated as that phrase alone.
  const when = () => {
    const time = relativeTime(props.run.at);
    if (Math.round((Date.now() - props.run.at) / 60_000) < 1) return props.run.test ? t("Sist kjørt nå (test)") : t("Sist kjørt nå");
    return props.run.test ? t("Sist kjørt for {time} siden (test)", { time }) : t("Sist kjørt for {time} siden", { time });
  };
  const parts = () => [when(), outcomeLabel(props.run.outcome), props.run.exitCode !== null ? t("kode {code}", { code: props.run.exitCode }) : "", t("{ms} ms", { ms: props.run.durationMs })];
  return <span class="muted hook-run">{parts().filter(Boolean).join(" · ")}</span>;
}

export function HooksPage() {
  onMount(() => {
    void refreshHooks().catch(report);
    // After a reconnect the list may have changed in another window.
    onCleanup(onOpen(() => void refreshHooks().catch(() => undefined)));
  });
  const [editing, setEditing] = createSignal<Editing | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [tested, setTested] = createSignal<HookTestResult | null>(null);
  const [examples, setExamples] = createSignal(false);
  // Explicit for/id pairs, so every field is named by its visible label, not its placeholder.
  const uid = createUniqueId();
  const ids = { name: `${uid}-name`, matcher: `${uid}-matcher`, command: `${uid}-command`, timeout: `${uid}-timeout` };

  const run = async (work: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await work();
      if (done) toast(done, "info");
      return true;
    } catch (err) {
      report(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const open = (value: Editing) => {
    setError("");
    setTested(null);
    setEditing(value);
  };
  const update = (change: Partial<HookDraft>) => setEditing({ ...editing()!, draft: { ...editing()!.draft, ...change } });

  const check = (d: HookDraft): string => {
    if (!d.command.trim()) return t("Skriv kommandoen som skal kjøres.");
    if (!Number.isInteger(d.timeoutSeconds) || d.timeoutSeconds < 1 || d.timeoutSeconds > HOOK_TIMEOUT_MAX) return t("Tidsgrensen må være fra 1 til {max} sekunder.", { max: HOOK_TIMEOUT_MAX });
    if (!d.modes.length) return t("Velg Kode, Chat eller begge.");
    return "";
  };

  const submit = async () => {
    const e = editing();
    if (!e) return;
    const problem = check(e.draft);
    if (problem) return setError(problem);
    setError("");
    const ok = await run(() => (e.id ? updateHook(e.id, e.draft) : createHook(e.draft)), e.id ? t("Hooken er lagret.") : t("Hooken er laget."));
    if (ok) setEditing(null);
  };

  const test = async () => {
    const e = editing();
    if (!e) return;
    const problem = check(e.draft);
    if (problem) return setError(problem);
    setError("");
    setTesting(true);
    try {
      setTested(await testHook({ ...e.draft, ...(e.id ? { id: e.id } : {}) }));
    } catch (err) {
      report(err);
    } finally {
      setTesting(false);
    }
  };

  const remove = async (hook: HookInfo) => {
    const ok = await confirmDialog({ title: t("Slette hooken {name}?", { name: hook.name }), text: t("Den kjøres ikke lenger. Det kan ikke angres."), confirm: t("Slett"), danger: true });
    if (ok) await run(() => deleteHook(hook.id), t("{name} er slettet.", { name: hook.name }));
  };

  // Hooks for one event run in list order, and the first that stops something wins.
  const move = (index: number) => {
    const list = hooksState()?.hooks ?? [];
    if (index < 1 || index >= list.length) return;
    const ids = list.map((h) => h.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    void run(() => reorderHooks(ids));
  };

  return (
    <Page title={t("Hooks")} intro={t("Kommandoer appen kjører på hendelser i Kode og Chat, for eksempel formatering etter hver filendring eller et varsel når agenten er ferdig. Hendelsene og JSON-en på stdin følger Claude Codes hooks, så skript derfra virker stort sett her også.")}>
      <Group title={t("Sikkerhet")}>
        <Row label={t("Full tilgang til maskinen din")} text={t("En hook kjører med dine rettigheter, akkurat som en kommando du skriver i terminalen. Lag bare hooks du forstår.")} />
        <Row label={t("Bare du kan lage og endre dem")} text={t("Modellen har ikke noe verktøy for hooks, og de leses aldri fra prosjektmapper, så et klonet repo kan ikke legge inn en. API-nøklene til leverandørene er ikke med i miljøet.")} />
      </Group>

      <Show when={editing()}>
        {(e) => (
          <Group title={e().id ? t("Endre {name}", { name: e().draft.name || t("hook") }) : t("Ny hook")}>
            <form class="setting setting-block skill-form hook-form" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
              <div class="field-row">
                <div class="field"><label for={ids.name}>{t("Navn")}</label>
                  <input id={ids.name} class="input" value={e().draft.name} maxLength={80} placeholder={t("For eksempel Formater med Prettier")} onInput={(ev) => update({ name: ev.currentTarget.value })} />
                </div>
                <div class="field"><span>{t("Hendelse")}</span>
                  <Select<HookEvent>
                    label={t("Hendelse")}
                    class="field-select"
                    value={e().draft.event}
                    options={HOOK_EVENTS.map((event) => ({ value: event, label: `${HOOK_EVENT_LABELS[event]} (${event})` }))}
                    onChange={(event) => update({ event, matcher: isToolEvent(event) ? e().draft.matcher : "" })}
                  />
                </div>
              </div>
              <p class="muted small hook-help">{eventHelp(e().draft.event)}</p>
              <Show when={isToolEvent(e().draft.event)}>
                <div class="field"><label for={ids.matcher}>{t("Verktøy")}</label>
                  <input id={ids.matcher} class="input code-input" value={e().draft.matcher} maxLength={500} spellcheck={false} placeholder={t("Tomt eller * for alle verktøy")} onInput={(ev) => update({ matcher: ev.currentTarget.value })} />
                </div>
                <p class="muted small hook-help">
                  <Rich
                    text={t("Et verktøynavn som {one}, flere med {pipe} som {several}, eller {star} som jokertegn, som {wildcard}. Navnet må stemme helt. Verktøyene i Kode heter blant annet {read}, {write}, {edit}, {remove} og {run}; i Chat blant annet {search}, {fetch} og {python}.")}
                    parts={{
                      one: code("run_command"), pipe: code("|"), several: code("edit_file|write_file"), star: code("*"), wildcard: code("mcp__github__*"),
                      read: code("read_file"), write: code("write_file"), edit: code("edit_file"), remove: code("delete_file"), run: code("run_command"),
                      search: code("web_search"), fetch: code("web_fetch"), python: code("run_python"),
                    }}
                  />
                </p>
              </Show>
              <div class="field"><label for={ids.command}>{t("Kommando (bash)")}</label>
                <textarea id={ids.command} class="input code-area hook-command" rows={4} spellcheck={false} value={e().draft.command} maxLength={4000} placeholder={`jq -r '.tool_input.path' >> ~/hooks.log`} onInput={(ev) => update({ command: ev.currentTarget.value })} />
              </div>
              <p class="muted small hook-help">
                <Rich
                  text={t("Får hendelsen som JSON på stdin, med blant annet {event}, {session}, {cwd}, {mode}, {tool}, {input}, {response} og {prompt}. Kjører i prosjektmappen, eller hjemmemappen når det ikke er noen.")}
                  parts={{
                    event: code("hook_event_name"), session: code("session_id"), cwd: code("cwd"), mode: code("mode"),
                    tool: code("tool_name"), input: code("tool_input"), response: code("tool_response"), prompt: code("prompt"),
                  }}
                />
              </p>
              <div class="field-row">
                <div class="field hook-timeout"><label for={ids.timeout}>{t("Tidsgrense (sekunder)")}</label>
                  <input id={ids.timeout} class="input" type="number" min={1} max={HOOK_TIMEOUT_MAX} step={1} value={e().draft.timeoutSeconds} onInput={(ev) => update({ timeoutSeconds: Number(ev.currentTarget.value) })} />
                </div>
                <fieldset class="field hook-modes"><legend>{t("Gjelder i")}</legend>
                  <For each={["code", "chat"] as HookMode[]}>
                    {(mode) => (
                      <label class="hook-mode">
                        <input type="checkbox" checked={e().draft.modes.includes(mode)} onChange={(ev) => update({ modes: ev.currentTarget.checked ? [...new Set([...e().draft.modes, mode])] : e().draft.modes.filter((m) => m !== mode) })} />
                        {modeLabel(mode)}
                      </label>
                    )}
                  </For>
                </fieldset>
              </div>
              <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
              <Show when={tested()}>
                {(result) => (
                  <div class="hook-test" role="status">
                    <strong>{result().exitCode !== null
                      ? t("{outcome}, avslutningskode {code}, {ms} ms", { outcome: outcomeLabel(result().outcome), code: result().exitCode!, ms: result().durationMs })
                      : t("{outcome}, {ms} ms", { outcome: outcomeLabel(result().outcome), ms: result().durationMs })}</strong>
                    <span>{result().effect}</span>
                    <Show when={result().stdout}><span class="muted small">stdout</span><pre class="hook-output">{result().stdout}</pre></Show>
                    <Show when={result().stderr}><span class="muted small">stderr</span><pre class="hook-output">{result().stderr}</pre></Show>
                  </div>
                )}
              </Show>
              <div class="form-actions">
                <button type="button" class="btn btn-small" disabled={testing()} title={t("Kjører kommandoen én gang med en eksempelhendelse, i hjemmemappen")} onClick={() => void test()}><IconPlay size={12} />{testing() ? t("Tester…") : t("Test")}</button>
                <button type="button" class="btn btn-small" onClick={() => setEditing(null)}>{t("Avbryt")}</button>
                <button type="submit" class="btn btn-small btn-primary" disabled={busy()}>{e().id ? t("Lagre") : t("Lag hook")}</button>
              </div>
            </form>
          </Group>
        )}
      </Show>

      <Group
        title={t("Dine hooks")}
        action={
          <div class="memory-actions">
            <Popover
              open={examples()}
              onClose={() => setExamples(false)}
              align="right"
              below
              panelClass="hook-examples-popover"
              trigger={<button type="button" class="btn btn-small" aria-haspopup="menu" aria-expanded={examples()} disabled={!!editing()} onClick={() => setExamples(!examples())}>{t("Eksempler")}<IconChevronDown size={12} /></button>}
            >
              <div class="menu-list hook-examples" role="menu" aria-label={t("Eksempler på hooks")}>
                <For each={exampleHooks()}>
                  {(example) => (
                    <button type="button" role="menuitem" class="menu-item menu-item-tall hook-example" onClick={() => { setExamples(false); open({ id: null, draft: { ...example.draft, modes: [...example.draft.modes] } }); }}>
                      <span class="menu-stack">
                        <span class="menu-name">{example.title}</span>
                        <span class="menu-desc">{example.text}</span>
                      </span>
                    </button>
                  )}
                </For>
                <div class="menu-note muted hook-examples-note">{t("Åpnes i skjemaet, så du kan lese og endre kommandoen før du lagrer.")}</div>
              </div>
            </Popover>
            <button type="button" class="btn btn-small" disabled={!!editing()} onClick={() => open({ id: null, draft: { ...EMPTY, modes: [...EMPTY.modes] } })}><IconPlus size={13} />{t("Ny hook")}</button>
          </div>
        }
      >
        <Show when={hooksState()} fallback={<SkeletonRows label={t("Henter hooks…")} />}>
          {(state) => (
            <>
              <For each={state().warnings}>{(warning) => <div class="setting"><span class="form-error">{warning}</span></div>}</For>
              <Show
                when={state().hooks.length}
                fallback={<div class="setting memory-empty"><span class="muted">{t("Ingen hooks ennå. Lag en, eller start fra et av eksemplene.")}</span></div>}
              >
                <ul class="skill-list hook-list" aria-label={t("Hooks")}>
                  <For each={state().hooks}>
                    {(hook, index) => (
                      <li class="setting skill-row hook-row" classList={{ off: !hook.enabled }}>
                        <div class="setting-text">
                          <strong class="skill-head">
                            <span class="skill-name">{hook.name}</span>
                            <span class="pill">{HOOK_EVENT_LABELS[hook.event]}</span>
                            <Show when={isToolEvent(hook.event)}><span class="pill"><code>{hook.matcher || "*"}</code></span></Show>
                            <Show when={hook.modes.length === 1}><span class="pill">{t("Bare {mode}", { mode: modeLabel(hook.modes[0]) })}</span></Show>
                            <Show when={!hook.enabled}><span class="pill">{t("Av")}</span></Show>
                          </strong>
                          <code class="hook-command-line" title={hook.command}>{hook.command}</code>
                          <Show when={hook.lastRun} fallback={<span class="muted hook-run">{t("Ikke kjørt siden appen startet")}</span>}>
                            {(last) => (
                              <>
                                <RunLine run={last()} />
                                <Show when={last().output}><pre class="hook-output hook-tail">{last().output}</pre></Show>
                              </>
                            )}
                          </Show>
                        </div>
                        <div class="setting-control">
                          {/* Never disabled while saving: a disabled control loses the keyboard focus. */}
                          <input type="checkbox" role="switch" class="switch" aria-label={t("Slå {name} av eller på", { name: hook.name })} checked={hook.enabled} onChange={(ev) => { const box = ev.currentTarget; void updateHook(hook.id, { enabled: box.checked }).catch((err) => { box.checked = hook.enabled; report(err); }); }} />
                          <button type="button" class="icon-button hook-up" aria-label={t("Flytt {name} opp", { name: hook.name })} title={t("Flytt opp: hooks for samme hendelse kjøres i rekkefølge")} disabled={busy() || index() === 0} onClick={() => move(index())}><IconChevronDown size={14} /></button>
                          <button type="button" class="icon-button" aria-label={t("Endre {name}", { name: hook.name })} title={t("Endre")} disabled={busy() || !!editing()} onClick={() => open({ id: hook.id, draft: draftOf(hook) })}><IconPencil size={14} /></button>
                          <button type="button" class="icon-button" aria-label={t("Slett {name}", { name: hook.name })} title={t("Slett")} disabled={busy()} onClick={() => void remove(hook)}><IconTrash size={14} /></button>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </>
          )}
        </Show>
      </Group>
      <p class="muted small memory-files">
        <Rich text={t("Hooks ligger i {file}, og leses når appen starter. Endre dem her, ikke i filen. Sist kjørt nullstilles når appen starter på nytt.")} parts={{ file: <code>{hooksState()?.file ?? t("hooks.json i datamappen")}</code> }} />
      </p>
    </Page>
  );
}
