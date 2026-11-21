import { sourceText, translate } from "../../shared/i18n.ts";
// Hooks (Innstillinger → Hooks): shell commands the user sets up, run by the app on agent events in
// Kode and Chat. Modelled on Claude Code's hooks, so the habits and most scripts carry over:
//
//   PreToolUse        before a tool runs, after the app's own approval. Exit code 2 (or
//                     {"decision":"block"}) stops the call, and stderr becomes the tool's error.
//   PostToolUse       after a tool has run. Exit code 2 (or a block/additionalContext on stdout)
//                     appends feedback to the tool result the model reads.
//   UserPromptSubmit  when a message is about to reach the model. Exit code 2 stops it, and stdout
//                     on exit code 0 (or additionalContext) is added as context.
//   Stop              when the agent's turn has ended. Not blocking in this version.
//
// Any other exit code, a timeout or a command that cannot start is a non-blocking error: it is
// shown, and the work goes on.
//
// Security model: a hook is a command with the user's full OS access, the same as one typed in a
// terminal. Hooks are only ever created and changed through the authenticated settings API
// (server/src/http/hooks-routes.ts). They live in hooks.json in the app's data folder, which the
// model's file tools cannot reach, and they are never read from a project, so a cloned repository
// cannot install one. The model has no tool for them. What a hook writes back to the model is
// clipped and labelled as coming from a local script.
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  HOOK_EVENTS,
  HOOK_TIMEOUT_DEFAULT,
  HOOK_TIMEOUT_MAX,
  isToolEvent,
  matchesTool,
  MAX_HOOK_COMMAND,
  MAX_HOOK_MATCHER,
  MAX_HOOK_NAME,
  MAX_HOOKS,
  type HookConfig,
  type HookEvent,
  type HookMode,
  type HookOutcome,
  type HookRun,
  type HooksState,
  type HookTestResult,
} from "../../shared/hooks.ts";
import { runCommand } from "./agent/command.ts";
import { HttpError } from "./errors.ts";
import { writeAtomic } from "./write-atomic.ts";

export const HOOKS_FILE = "hooks.json";
const MAX_FILE_BYTES = 1024 * 1024;
const MODEL_CHARS = 8000; // the most one hook may add to what the model reads
const SHOWN_CHARS = 2000; // the most one hook may show in the conversation
const TAIL_CHARS = 2000; // the output tail kept for the settings page
const MAX_STDIN_STRING = 100_000; // long strings in the payload (a written file, a tool result) are cut to this

// One run of one hook, with what it means for the work it ran for.
export interface HookResult {
  hook: { id: string; name: string };
  run: HookRun;
  stdout: string;
  stderr: string;
  block?: string; // the reason, when the hook said stop
  context?: string; // UserPromptSubmit: added for the model
  feedback?: string; // PostToolUse: appended to the tool result
  message?: string; // what the user should see when it went wrong or stopped something
}

// All hooks that matched one event, in order. The first block wins and the rest do not run.
export interface HookBatch {
  results: HookResult[];
  blocked?: HookResult;
}

export interface HookCall {
  event: HookEvent;
  mode: HookMode;
  threadId: string;
  cwd?: string; // the project folder; the home folder when there is none
  signal: AbortSignal; // the run's own: Stop in the app cancels a running hook
  toolName?: string; // tool events: what the matcher is checked against
  payload: Record<string, unknown>; // the event's own fields for stdin (tool_input, prompt, …)
}

export interface HooksOptions {
  dataDir: string;
  env: () => Record<string, string>; // the app's child environment, without provider keys
  homeDir?: string;
  changed: () => void; // publishes hooks.changed
}

// Clip from the middle, so the start and the end of the output both stay.
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  return `${text.slice(0, head)}\n[… ${text.length - max} tegn utelatt …]\n${text.slice(text.length - (max - head))}`;
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max)}`;
}

// Long strings in the payload are cut, so a hook never gets megabytes on stdin.
function boundedPayload(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > MAX_STDIN_STRING ? `${value.slice(0, MAX_STDIN_STRING)}[… avkortet]` : value;
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => boundedPayload(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, boundedPayload(item, depth + 1)]));
}

// Claude Code's JSON on stdout, the few fields this app uses. Anything else is plain text.
interface HookJson {
  block?: string;
  context?: string;
}

function parseJsonOutput(stdout: string): HookJson | undefined {
  const text = stdout.trim();
  if (!text.startsWith("{")) return undefined;
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: HookJson = {};
  const reason = typeof value.reason === "string" ? value.reason : "";
  if (value.decision === "block") out.block = reason;
  // PreToolUse in newer Claude Code: hookSpecificOutput.permissionDecision "deny".
  const specific = value.hookSpecificOutput && typeof value.hookSpecificOutput === "object" ? value.hookSpecificOutput : {};
  if (specific.permissionDecision === "deny") out.block = typeof specific.permissionDecisionReason === "string" ? specific.permissionDecisionReason : reason;
  const context = typeof value.additionalContext === "string" ? value.additionalContext : typeof specific.additionalContext === "string" ? specific.additionalContext : "";
  if (context.trim()) out.context = context;
  return out;
}

// A hook as the user sent it, checked field by field. Unknown fields are refused, so a typo does
// not silently do nothing.
export function validateHook(input: unknown, id: string): HookConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Ugyldig hook.");
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!["id", "name", "event", "matcher", "command", "timeoutSeconds", "enabled", "modes"].includes(key)) throw new HttpError(400, `Ukjent felt: ${key}`);
  }
  const event = body.event;
  if (typeof event !== "string" || !(HOOK_EVENTS as readonly string[]).includes(event)) throw new HttpError(400, "Velg en hendelse.");
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) throw new HttpError(400, "Skriv kommandoen som skal kjøres.");
  if (command.length > MAX_HOOK_COMMAND) throw new HttpError(400, `Kommandoen kan være maks ${MAX_HOOK_COMMAND} tegn.`);
  if (command.includes("\0")) throw new HttpError(400, "Kommandoen kan ikke inneholde nulltegn.");
  const rawName = typeof body.name === "string" ? body.name.replace(/[\x00-\x1f\x7f]/g, " ").trim() : "";
  if (body.name !== undefined && typeof body.name !== "string") throw new HttpError(400, "Navnet må være tekst.");
  if (rawName.length > MAX_HOOK_NAME) throw new HttpError(400, `Navnet kan være maks ${MAX_HOOK_NAME} tegn.`);
  if (body.matcher !== undefined && typeof body.matcher !== "string") throw new HttpError(400, "Verktøyfilteret må være tekst.");
  const matcher = isToolEvent(event as HookEvent) ? String(body.matcher ?? "").trim() : "";
  if (matcher.length > MAX_HOOK_MATCHER || /[\x00-\x1f]/.test(matcher)) throw new HttpError(400, "Ugyldig verktøyfilter.");
  const timeout = body.timeoutSeconds === undefined ? HOOK_TIMEOUT_DEFAULT : body.timeoutSeconds;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > HOOK_TIMEOUT_MAX) throw new HttpError(400, `Tidsgrensen må være et helt antall sekunder fra 1 til ${HOOK_TIMEOUT_MAX}.`);
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new HttpError(400, "Bruk sann/usann for på/av.");
  const modes = body.modes === undefined ? ["code", "chat"] : body.modes;
  if (!Array.isArray(modes) || !modes.length || modes.some((m) => m !== "code" && m !== "chat")) throw new HttpError(400, "Velg Kode, Chat eller begge.");
  return {
    id,
    name: rawName || command.split("\n")[0].slice(0, 40),
    event: event as HookEvent,
    matcher,
    command,
    timeoutSeconds: timeout,
    enabled: body.enabled !== false,
    modes: [...new Set(modes as HookMode[])].sort() as HookMode[],
  };
}

// What a sample run in Innstillinger sends, so «Test» behaves like the real thing.
function samplePayload(event: HookEvent, matcher: string): { toolName?: string; payload: Record<string, unknown> } {
  const first = matcher.split("|").map((p) => p.trim()).find((p) => p && !p.includes("*"));
  const toolName = first ?? "edit_file";
  const input = toolName === "run_command" ? { command: "echo hei" } : { path: "eksempel.txt", old_string: "gammel", new_string: "ny" };
  if (event === "PreToolUse") return { toolName, payload: { tool_name: toolName, tool_input: input, tool_use_id: "test" } };
  if (event === "PostToolUse") return { toolName, payload: { tool_name: toolName, tool_input: input, tool_use_id: "test", tool_response: { content: "Ferdig.", is_error: false } } };
  if (event === "UserPromptSubmit") return { payload: { prompt: "Dette er en testmelding fra Innstillinger." } };
  return { payload: { status: "done", last_assistant_message: "Ferdig med testen.", stop_hook_active: false } };
}

function testEffect(event: HookEvent, result: HookResult) {
  const message = (effectKey: string, effectValues?: Record<string, string | number>) => ({ effectKey, effectValues, effect: translate({}, effectKey, effectValues) });
  const { run } = result;
  if (run.outcome === "timeout") return message(sourceText("Brukte mer enn tidsgrensen og ble stoppet. Arbeidet ville gått videre."));
  if (run.outcome === "cancelled") return message(sourceText("Avbrutt."));
  if (run.outcome === "error") return run.exitCode == null
    ? message(sourceText("Ikke-blokkerende feil (avslutningskode ingen). Feilen ville blitt vist, og arbeidet ville gått videre."))
    : message(sourceText("Ikke-blokkerende feil (avslutningskode {code}). Feilen ville blitt vist, og arbeidet ville gått videre."), { code: run.exitCode });
  if (event === "Stop") return message(sourceText("Kjørt. Stop kan ikke stoppe noe i denne versjonen."));
  if (result.block !== undefined) {
    if (event === "PreToolUse") return message(sourceText("Ville stoppet verktøykallet. Modellen ville fått: {text}"), { text: result.block });
    if (event === "UserPromptSubmit") return message(sourceText("Ville stoppet meldingen. Du ville sett: {text}"), { text: result.block });
  }
  if (result.feedback) return message(sourceText("Ville lagt dette til i verktøyresultatet: {text}"), { text: result.feedback });
  if (result.context) return message(sourceText("Ville lagt til kontekst for modellen: {text}"), { text: result.context });
  return event === "UserPromptSubmit" ? message(sourceText("Ingen virkning: meldingen ville gått videre.")) : event === "PostToolUse" ? message(sourceText("Ingen virkning: resultatet ville gått uendret til modellen.")) : message(sourceText("Ingen virkning: verktøykallet ville kjørt."));
}

export class Hooks {
  private options: HooksOptions;
  private hooks: HookConfig[] = [];
  private lastRuns = new Map<string, HookRun>();
  private warnings: string[] = [];
  private closing = new AbortController(); // shutdown cancels every hook still running
  readonly file: string;

  constructor(options: HooksOptions) {
    this.options = options;
    this.file = path.join(options.dataDir, HOOKS_FILE);
    this.load();
  }

  // Read once at startup. The file is the app's own; a broken entry is skipped with a warning
  // instead of stopping the app.
  private load(): void {
    let raw: unknown;
    try {
      const fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("Hooks-filen er for stor eller ikke en vanlig fil.");
        raw = JSON.parse(readFileSync(fd, "utf8"));
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.warnings.push(`${HOOKS_FILE}: ${(err as Error).message}`);
      return;
    }
    const list = raw && typeof raw === "object" && Array.isArray((raw as any).hooks) ? (raw as any).hooks : [];
    for (const item of list.slice(0, MAX_HOOKS)) {
      try {
        const id = typeof item?.id === "string" && /^[\w-]{1,64}$/.test(item.id) ? item.id : randomUUID();
        if (this.hooks.some((h) => h.id === id)) throw new Error("dobbel id");
        this.hooks.push(validateHook(item, id));
      } catch (err) {
        this.warnings.push(`En hook i ${HOOKS_FILE} ble hoppet over: ${(err as Error).message}`);
      }
    }
    for (const warning of this.warnings) console.warn("Hooks:", warning);
  }

  private save(): void {
    writeAtomic(this.file, `${JSON.stringify({ version: 1, hooks: this.hooks }, null, 2)}\n`, this.options.dataDir, 0o600);
  }

  state(): HooksState {
    return {
      hooks: this.hooks.map((hook) => ({ ...hook, modes: [...hook.modes], lastRun: this.lastRuns.get(hook.id) ?? null })),
      file: this.file,
      warnings: [...this.warnings],
    };
  }

  private find(id: string): HookConfig {
    const hook = this.hooks.find((h) => h.id === id);
    if (!hook) throw new HttpError(404, "Fant ikke hooken.");
    return hook;
  }

  // Each change is written before it is used, and the old list comes back if writing fails.
  private commit(next: HookConfig[]): HooksState {
    const previous = this.hooks;
    this.hooks = next;
    try {
      this.save();
    } catch (err) {
      this.hooks = previous;
      throw err;
    }
    this.options.changed();
    return this.state();
  }

  create(input: unknown): HooksState {
    if (this.hooks.length >= MAX_HOOKS) throw new HttpError(409, `Maks ${MAX_HOOKS} hooks. Slett en før du lager flere.`);
    const { id: _ignored, ...rest } = (input ?? {}) as Record<string, unknown>;
    return this.commit([...this.hooks, validateHook(rest, randomUUID())]);
  }

  // A full replacement or a partial change (such as only enabled): the result is checked whole.
  update(id: string, input: unknown): HooksState {
    const current = this.find(id);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Ugyldig hook.");
    const { id: _ignored, ...rest } = input as Record<string, unknown>;
    const next = validateHook({ ...current, ...rest, id: undefined }, id);
    return this.commit(this.hooks.map((h) => (h.id === id ? next : h)));
  }

  remove(id: string): HooksState {
    this.find(id);
    this.lastRuns.delete(id);
    return this.commit(this.hooks.filter((h) => h.id !== id));
  }

  // Reordering: hooks for one event run in this order, and the first block wins.
  reorder(ids: unknown): HooksState {
    if (!Array.isArray(ids) || ids.length !== this.hooks.length || new Set(ids).size !== ids.length || ids.some((id) => !this.hooks.some((h) => h.id === id))) {
      throw new HttpError(400, "Send alle hook-ID-ene i den nye rekkefølgen.");
    }
    return this.commit(ids.map((id) => this.find(id)));
  }

  // The hooks that would run for this event, in order. Cheap and synchronous, so the runner can
  // skip all hook work when there is none.
  matching(event: HookEvent, mode: HookMode, toolName?: string): HookConfig[] {
    return this.hooks.filter((h) => h.enabled && h.event === event && h.modes.includes(mode) && (!isToolEvent(event) || matchesTool(h.matcher, toolName ?? "")));
  }

  has(event: HookEvent, mode: HookMode, toolName?: string): boolean {
    return this.matching(event, mode, toolName).length > 0;
  }

  // Every matching hook, one after another. Never throws: a hook that fails is a result like any
  // other. Stops at the first block, and when the signal is aborted.
  async run(call: HookCall): Promise<HookBatch> {
    const results: HookResult[] = [];
    for (const hook of this.matching(call.event, call.mode, call.toolName)) {
      if (call.signal.aborted || this.closing.signal.aborted) break;
      const result = await this.runOne(hook, call, false);
      results.push(result);
      if (result.block !== undefined) return { results, blocked: result };
      if (result.run.outcome === "cancelled") break;
    }
    return { results };
  }

  // «Test» in Innstillinger: a saved hook or a draft, once, with a sample payload, in the home
  // folder. Only through the authenticated settings API.
  async test(input: unknown): Promise<HookTestResult> {
    const body = (input ?? {}) as Record<string, unknown>;
    const savedId = typeof body.id === "string" && this.hooks.some((h) => h.id === body.id) ? body.id : undefined;
    const { id: _ignored, ...rest } = body;
    const hook = validateHook(rest, savedId ?? "test");
    const sample = samplePayload(hook.event, hook.matcher);
    const abort = new AbortController();
    const result = await this.runOne(hook, { event: hook.event, mode: hook.modes[0], threadId: "test", signal: abort.signal, toolName: sample.toolName, payload: sample.payload }, true, savedId === undefined);
    return { ...result.run, stdout: tail(result.stdout, TAIL_CHARS), stderr: tail(result.stderr, TAIL_CHARS), ...testEffect(hook.event, result) };
  }

  private async runOne(hook: HookConfig, call: HookCall, test: boolean, unsaved = false): Promise<HookResult> {
    const cwd = call.cwd ?? this.options.homeDir ?? homedir();
    const stdin = JSON.stringify(boundedPayload({
      hook_event_name: call.event,
      session_id: call.threadId,
      cwd,
      mode: call.mode,
      ...call.payload,
    }));
    const signal = AbortSignal.any([call.signal, this.closing.signal]);
    const startedAt = Date.now();
    const env = {
      ...this.options.env(),
      AD_HOOK_EVENT: call.event,
      AD_HOOK_ID: hook.id,
      AD_HOOK_NAME: hook.name,
      AD_HOOK_MODE: call.mode,
      AD_HOOK_THREAD_ID: call.threadId,
      AD_HOOK_CWD: cwd,
      ...(call.toolName ? { AD_HOOK_TOOL_NAME: call.toolName } : {}),
      ...(call.cwd ? { AD_PROJECT_DIR: call.cwd, CLAUDE_PROJECT_DIR: call.cwd } : {}),
    };
    const done = await runCommand({ command: hook.command, cwd, env, timeoutMs: hook.timeoutSeconds * 1000, signal, input: stdin, onOutput: () => undefined });
    const outcome: HookOutcome = done.cancelled ? "cancelled" : done.timedOut ? "timeout" : done.exitCode === 0 ? "ok" : done.exitCode === 2 ? "blocked" : "error";
    const result: HookResult = {
      hook: { id: hook.id, name: hook.name },
      run: { at: startedAt, event: call.event, outcome, exitCode: done.exitCode, durationMs: Date.now() - startedAt, output: tail(done.output.trim(), TAIL_CHARS), ...(test ? { test: true } : {}) },
      stdout: done.stdout,
      stderr: done.stderr,
    };
    this.interpret(call.event, result);
    if (!unsaved) {
      this.lastRuns.set(hook.id, result.run);
      this.options.changed();
    }
    return result;
  }

  // What exit code and output mean for this event (see the top of the file).
  private interpret(event: HookEvent, result: HookResult): void {
    const { run } = result;
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const forModel = (text: string) => clipText(text, MODEL_CHARS);
    if (run.outcome === "timeout") {
      result.message = `Hooken «${result.hook.name}» brukte for lang tid og ble stoppet. Arbeidet går videre.`;
      return;
    }
    if (run.outcome === "cancelled") return;
    if (run.outcome === "error") {
      result.message = clipText(`Hooken «${result.hook.name}» feilet (avslutningskode ${run.exitCode ?? "ingen"})${stderr ? `: ${stderr}` : "."} Arbeidet går videre.`, SHOWN_CHARS);
      return;
    }
    if (run.outcome === "blocked") {
      const reason = forModel(stderr || stdout || "Ingen begrunnelse ble gitt.");
      if (event === "PostToolUse") result.feedback = reason;
      else if (event === "Stop") result.message = clipText(`Hooken «${result.hook.name}» avsluttet med kode 2, men Stop kan ikke stoppe noe i denne versjonen${stderr ? `: ${stderr}` : "."}`, SHOWN_CHARS);
      else result.block = reason;
      if (result.block !== undefined) result.message = clipText(reason, SHOWN_CHARS);
      return;
    }
    // Exit code 0: JSON on stdout can still block or add context, else stdout is plain text.
    const json = parseJsonOutput(stdout);
    if (json?.block !== undefined) {
      const reason = forModel(json.block.trim() || "Ingen begrunnelse ble gitt.");
      run.outcome = event === "Stop" ? "ok" : "blocked";
      if (event === "PostToolUse") result.feedback = reason;
      else if (event !== "Stop") {
        result.block = reason;
        result.message = clipText(reason, SHOWN_CHARS);
      }
    }
    const context = json ? json.context : event === "UserPromptSubmit" ? stdout : undefined;
    if (context && result.block === undefined) {
      if (event === "UserPromptSubmit") result.context = forModel(context.trim());
      else if (event === "PostToolUse") result.feedback = forModel([result.feedback, context.trim()].filter(Boolean).join("\n"));
    }
  }

  close(): void {
    this.closing.abort(new DOMException("Serveren stopper", "AbortError"));
  }
}
