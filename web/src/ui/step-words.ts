// Round 13 (SPEC 27.1): the words of a Kode thread. Every step is a kind with an icon, a short
// Norwegian verb, what it was about and a short result: «Leste src/app.ts · 42 linjer», «Kjørte
// npm test · exit 0». Steps of the same kind in a row are one line, «Leste 6 filer». The style
// guide for new tools is docs/research/kode-steg.md; keep the two in step.
import type { ToolStatus, WebSource } from "../../../shared/protocol";
import { plural, t } from "../lib/i18n";

export type StepKind = "read" | "search" | "web" | "command" | "create" | "edit" | "delete" | "team" | "memory" | "plan" | "skill" | "other";

// What a step needs to be described. A ToolRow has all of it, an activity task only the start.
export interface StepFacts {
  tool: string;
  summary: string;
  input?: unknown;
  status?: ToolStatus | string;
  result?: string;
  sources?: WebSource[];
}

export interface StepWords {
  phrase: string;
  target: string; // the file, pattern, command, address or name; may be empty
  mono: boolean; // a path or a command, shown in the code font
  result: string; // «42 linjer», «exit 0», «+12 −3»; empty when there is nothing short to say
}

const RUNNING = new Set(["running", "pending", "awaiting-approval"]);
export const isRunning = (status: string | undefined) => !!status && RUNNING.has(status);

// write_file says «(ny)» in its summary and «(ny fil)» in its result when the file did not exist.
const isNewFile = (s: StepFacts) => /\(ny fil\)\s*$/.test(s.result ?? "") || (!s.result && /\s\(ny\)$/.test(s.summary));

export function stepKind(s: StepFacts): StepKind {
  const t = s.tool;
  if (t === "read_file" || t === "list_dir") return "read";
  if (t === "search" || t === "glob") return "search";
  if (t === "web_search" || t === "web_fetch" || t.startsWith("browser_")) return "web";
  if (t === "run_command") return "command";
  if (t === "write_file") return isNewFile(s) ? "create" : "edit";
  if (t === "edit_file") return "edit";
  if (t === "delete_file") return "delete";
  if (t.startsWith("thread_") || t.startsWith("task_")) return "team";
  if (t === "remember" || t === "forget") return "memory";
  if (t === "update_plan") return "plan";
  if (t === "use_skill" || t === "propose_skill") return "skill";
  return "other";
}

// The path in a file tool's summary, without « +26» and « (ny)».
export function summaryPath(summary: string): string {
  return summary.replace(/\s\(ny\)$/, "").replace(/ \+\d+$/, "").trim();
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const field = (input: unknown, key: string) => str((input as Record<string, unknown> | undefined)?.[key]);

// «+12 −3» from the first line of a file tool's result («src/app.ts +12 -3»).
function lineCounts(result: string | undefined): { add: number; del: number } | null {
  const match = /\+(\d+) -(\d+)/.exec(result?.split("\n")[0] ?? "");
  return match ? { add: Number(match[1]), del: Number(match[2]) } : null;
}

export function changeText(add: number, del: number): string {
  if (!add && !del) return "";
  if (!del) return `+${add}`;
  if (!add) return `−${del}`;
  return `+${add} −${del}`;
}

function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    const rest = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host.replace(/^www\./, "")}${rest}`.slice(0, 80);
  } catch {
    return url;
  }
}

function commandResult(result: string | undefined, status: string | undefined): string {
  if (status === "cancelled" || /\[Avbrutt\]\s*$/.test(result ?? "")) return t("avbrutt");
  if (/\[Tidsavbrudd etter/.test(result ?? "")) return t("tidsavbrudd");
  const code = /\[Avslutningskode (-?\d+)\]\s*$/.exec(result ?? "");
  if (code) return `exit ${code[1]}`;
  return status === "done" ? "exit 0" : "";
}

function readLineCount(result: string | undefined): number {
  const total = /av (\d+) linjer\.?\]/.exec(result ?? "")?.[1];
  return total ? Number(total) : (result?.match(/^\d+\t/gm) ?? []).length;
}

function resultOf(s: StepFacts): string {
  const r = s.result;
  if (s.status === "denied") return "";
  if (s.status === "error" && s.tool !== "run_command") return "";
  switch (s.tool) {
    case "read_file": {
      if (r === "(tom fil)") return t("tom");
      const count = readLineCount(r);
      return count ? plural(count, "{count} linje", "{count} linjer") : "";
    }
    case "list_dir":
      if (!r) return "";
      return r === "(tom mappe)" ? t("tom") : plural(r.split("\n").filter(Boolean).length, "{count} oppføring", "{count} oppføringer");
    case "glob":
      if (!r) return "";
      return /^Ingen filer/.test(r) ? t("ingen filer") : plural(r.split("\n").filter((l) => l && !l.startsWith("[")).length, "{count} fil", "{count} filer");
    case "search":
      if (!r) return "";
      if (r === "Ingen treff") return t("ingen treff");
      return t("{count} treff", { count: r.split("\n").filter((l) => l && !l.startsWith("[") && l !== "--").length });
    case "run_command":
      return commandResult(r, s.status);
    case "write_file":
    case "edit_file":
    case "delete_file": {
      const counts = lineCounts(r);
      if (counts) return changeText(counts.add, counts.del);
      const planned = / \+(\d+)(?:\s\(ny\))?$/.exec(s.summary)?.[1];
      return planned ? `+${planned}` : "";
    }
    case "web_search":
      return s.sources ? (s.sources.length ? plural(s.sources.length, "{count} kilde", "{count} kilder") : t("ingen treff")) : "";
    case "update_plan":
      return s.summary;
    case "thread_wait":
      return s.status === "done" ? t("ferdig") : "";
    default:
      return "";
  }
}

// [past, present]: «Leste», «Leser».
const VERBS: Partial<Record<string, string[]>> = {
  get request_user_input() { return [t("Spurte deg"), t("Venter på svaret ditt")]; },
  get ui_mod() { return [t("Tilpasset utseendet"), t("Tilpasser utseendet")]; },
  get create_document() { return [t("Laget fil {target}"), t("Lager fil {target}")]; },
  get run_python() { return [t("Kjørte Python"), t("Kjører Python")]; },
  get list_chat_files() { return [t("Viste Chat-filer"), t("Ser på Chat-filer")]; },
  get read_file() { return [t("Leste {target}"), t("Leser {target}")]; },
  get list_dir() { return [t("Så i {target}"), t("Ser i {target}")]; },
  get glob() { return [t("Fant filer: {target}"), t("Finner filer: {target}")]; },
  get search() { return [t("Søkte etter {target}"), t("Søker etter {target}")]; },
  get web_search() { return [t("Søkte på nettet etter «{target}»"), t("Søker på nettet etter «{target}»")]; },
  get web_fetch() { return [t("Leste nettsiden {target}"), t("Leser nettsiden {target}")]; },
  get browser_navigate() { return [t("Åpnet {target}"), t("Åpner {target}")]; },
  get browser_snapshot() { return [t("Leste siden"), t("Leser siden")]; },
  get browser_click() { return [t("Klikket på «{target}»"), t("Klikker på «{target}»")]; },
  get browser_type() { return [t("Skrev i «{target}»"), t("Skriver i «{target}»")]; },
  get browser_screenshot() { return [t("Tok et skjermbilde"), t("Tar et skjermbilde")]; },
  get browser_console() { return [t("Leste konsollen"), t("Leser konsollen")]; },
  get run_command() { return [t("Kjørte {target}"), t("Kjører {target}")]; },
  get edit_file() { return [t("Endret {target}"), t("Endrer {target}")]; },
  get delete_file() { return [t("Slettet {target}"), t("Sletter {target}")]; },
  get thread_create() { return [t("Startet underagenten «{target}»"), t("Starter underagenten «{target}»")]; },
  get thread_send() { return [t("Sendte en melding"), t("Sender en melding")]; },
  get thread_wait() { return [t("Ventet på underagenten"), t("Venter på underagenten")]; },
  get thread_read() { return [t("Leste en tråd"), t("Leser en tråd")]; },
  get thread_models() { return [t("Søkte etter modeller: {target}"), t("Søker etter modeller: {target}")]; },
  get thread_list() { return [t("Så på trådene"), t("Ser på trådene")]; },
  get task_list() { return [t("Leste oppgavelisten"), t("Leser oppgavelisten")]; },
  get task_add() { return [t("La til oppgaven «{target}»"), t("Legger til oppgaven «{target}»")]; },
  get task_update() { return [t("Oppdaterte oppgavestatus: {target}"), t("Oppdaterer oppgavestatus: {target}")]; },
  get remember() { return [t("Lagret et minne «{target}»"), t("Lagrer et minne «{target}»")]; },
  get forget() { return [t("Glemte et minne «{target}»"), t("Glemmer et minne «{target}»")]; },
  get update_plan() { return [t("Oppdaterte planen"), t("Oppdaterer planen")]; },
  get use_skill() { return [t("Brukte skillen {target}"), t("Bruker skillen {target}")]; },
  get propose_skill() { return [t("Foreslo skillen {target}"), t("Foreslår skillen {target}")]; },
};

function targetOf(s: StepFacts): { target: string; mono: boolean } {
  const plain = (target: string) => ({ target, mono: false });
  const mono = (target: string) => ({ target, mono: !!target });
  switch (s.tool) {
    case "request_user_input":
    case "ui_mod":
      return plain("");
    case "create_document":
      return plain(s.summary);
    case "run_python":
    case "list_chat_files":
      return plain("");
    case "read_file":
    case "write_file":
    case "edit_file":
    case "delete_file":
      return mono(summaryPath(s.summary));
    case "list_dir":
      return !s.summary || s.summary === "." || s.summary === "./" ? plain("") : mono(s.summary);
    case "glob":
    case "search":
    case "run_command":
      return mono(s.summary);
    case "web_search":
      return plain(s.summary);
    case "web_fetch":
    case "browser_navigate":
      return plain(hostAndPath(s.summary));
    case "browser_click":
    case "browser_type":
      return plain(s.summary);
    case "browser_snapshot":
    case "browser_screenshot":
    case "browser_console":
    case "thread_list":
    case "task_list":
    case "thread_send":
    case "thread_read":
    case "thread_wait":
      return plain("");
    case "thread_create":
    case "task_add":
    case "remember":
    case "forget":
      return plain(s.summary);
    case "task_update": {
      const status = field(s.input, "status");
      return plain(status === "todo" ? t("Til å gjøre") : status === "doing" ? t("Påbegynt") : status === "done" ? t("Ferdig") : "");
    }
    case "use_skill":
    case "propose_skill":
      return plain(s.summary);
    case "update_plan":
      return plain("");
    default:
      return mono(s.summary);
  }
}

export function describeStep(s: StepFacts): StepWords {
  const running = isRunning(s.status);
  const where = targetOf(s);
  let phrase: string;
  if (s.tool === "write_file") phrase = running ? (isNewFile(s) ? t("Oppretter {target}") : t("Skriver {target}")) : isNewFile(s) ? t("Opprettet {target}") : t("Skrev om {target}");
  else if (s.tool === "web_search" && !s.summary) phrase = running ? t("Søker på nettet") : t("Søkte på nettet");
  else if (s.tool === "list_dir" && !where.target) phrase = running ? t("Ser i prosjektmappen") : t("Så i prosjektmappen");
  else phrase = VERBS[s.tool]?.[running ? 1 : 0] ?? (where.target ? t("{tool}: {target}", { tool: s.tool }) : s.tool);
  if (!where.target && phrase.includes("{target}")) phrase = running ? t("Bruker {tool}", { tool: s.tool }) : t("Brukte {tool}", { tool: s.tool });
  return { phrase, ...where, result: running ? "" : resultOf(s) };
}

// «Leste src/app.ts», as one line of plain text, for titles and the now-line.
export function stepSentence(s: StepFacts): string {
  const { phrase, target } = describeStep(s);
  return phrase.replaceAll("{target}", () => target);
}

// The line over several steps of the same kind in a row: «Leste 6 filer», «Kjørte 3 kommandoer».
export function runLabel(kind: StepKind, items: StepFacts[], running: boolean): string {
  const n = items.length;
  switch (kind) {
    case "read": {
      const dirs = items.filter((i) => i.tool === "list_dir").length;
      const files = n - dirs;
      if (!dirs) return running ? plural(files, "Leser {count} fil", "Leser {count} filer") : plural(files, "Leste {count} fil", "Leste {count} filer");
      if (!files) return running ? plural(dirs, "Leser {count} mappe", "Leser {count} mapper") : plural(dirs, "Leste {count} mappe", "Leste {count} mapper");
      const fileCount = plural(files, "{count} fil", "{count} filer");
      const dirCount = plural(dirs, "{count} mappe", "{count} mapper");
      return running ? t("Leser {files} og {dirs}", { files: fileCount, dirs: dirCount }) : t("Leste {files} og {dirs}", { files: fileCount, dirs: dirCount });
    }
    case "search":
      return running ? t("Søker {count} ganger", { count: n }) : t("Søkte {count} ganger", { count: n });
    case "web":
      if (items.every((i) => i.tool === "web_search")) return running ? t("Søker på nettet {count} ganger", { count: n }) : t("Søkte på nettet {count} ganger", { count: n });
      if (items.every((i) => i.tool === "web_fetch")) return running ? t("Leser {count} nettsider", { count: n }) : t("Leste {count} nettsider", { count: n });
      return running ? t("Bruker nettleseren i {count} steg", { count: n }) : t("Brukte nettleseren i {count} steg", { count: n });
    case "command":
      return running ? t("Kjører {count} kommandoer", { count: n }) : t("Kjørte {count} kommandoer", { count: n });
    case "create":
      return running ? t("Oppretter {count} filer", { count: n }) : t("Opprettet {count} filer", { count: n });
    case "edit":
      if (new Set(items.map((i) => summaryPath(i.summary))).size === 1) {
        const path = summaryPath(items[0].summary);
        return running ? t("Endrer {path} {count} ganger", { path, count: n }) : t("Endret {path} {count} ganger", { path, count: n });
      }
      return running ? t("Endrer {count} filer", { count: n }) : t("Endret {count} filer", { count: n });
    case "delete":
      return running ? t("Sletter {count} filer", { count: n }) : t("Slettet {count} filer", { count: n });
    case "team":
      return running ? t("Jobber med teamet i {count} steg", { count: n }) : t("Jobbet med teamet i {count} steg", { count: n });
    case "memory":
      return running ? t("Oppdaterer minnet i {count} steg", { count: n }) : t("Oppdaterte minnet i {count} steg", { count: n });
    case "plan":
      return running ? t("Oppdaterer planen {count} ganger", { count: n }) : t("Oppdaterte planen {count} ganger", { count: n });
    case "skill":
      return running ? t("Bruker {count} skills", { count: n }) : t("Brukte {count} skills", { count: n });
    default:
      return running ? t("Bruker {count} verktøy", { count: n }) : t("Brukte {count} verktøy", { count: n });
  }
}

// The short result of a run: the sum of the lines changed, the sources found, or how many failed.
export function runResult(kind: StepKind, items: StepFacts[]): string {
  const failed = items.filter((i) => i.status === "error").length;
  if (failed) return t("{count} feilet", { count: failed });
  if (kind === "create" || kind === "edit" || kind === "delete") {
    let add = 0;
    let del = 0;
    for (const item of items) {
      const counts = lineCounts(item.result);
      if (counts) {
        add += counts.add;
        del += counts.del;
      }
    }
    return changeText(add, del);
  }
  if (kind === "web") {
    const sources = items.reduce((sum, i) => sum + (i.sources?.length ?? 0), 0);
    return sources ? plural(sources, "{count} kilde", "{count} kilder") : "";
  }
  if (kind === "read") {
    const lines = items.reduce((sum, i) => sum + (i.tool === "read_file" && i.status !== "error" && i.status !== "denied" ? readLineCount(i.result) : 0), 0);
    return lines ? plural(lines, "{count} linje", "{count} linjer") : "";
  }
  if (kind === "command") return items.every((i) => commandResult(i.result, i.status) === "exit 0") ? t("alle exit 0") : "";
  return "";
}

// The first line of an error, for the quiet note under a failed step.
export function errorLine(s: StepFacts): string {
  if (s.status !== "error" || !s.result) return "";
  if (s.tool === "run_command") return "";
  const line = s.result.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 140 ? `${line.slice(0, 138)}…` : line;
}
