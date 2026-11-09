// Round 13 (SPEC 27.1): the words of a Kode thread. Every step is a kind with an icon, a short
// Norwegian verb, what it was about and a short result: «Leste src/app.ts · 42 linjer», «Kjørte
// npm test · exit 0». Steps of the same kind in a row are one line, «Leste 6 filer». The style
// guide for new tools is docs/research/kode-steg.md; keep the two in step.
import type { ToolStatus, WebSource } from "../../../shared/protocol";

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
  verb: string; // «Leste», or «Leser» while it runs
  target: string; // the file, pattern, command, address or name; may be empty
  mono: boolean; // a path or a command, shown in the code font
  quoted: boolean; // a search or a name, shown in «»
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

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
  if (status === "cancelled" || /\[Avbrutt\]\s*$/.test(result ?? "")) return "avbrutt";
  if (/\[Tidsavbrudd etter/.test(result ?? "")) return "tidsavbrudd";
  const code = /\[Avslutningskode (-?\d+)\]\s*$/.exec(result ?? "");
  if (code) return `exit ${code[1]}`;
  return status === "done" ? "exit 0" : "";
}

function resultOf(s: StepFacts): string {
  const r = s.result;
  if (s.status === "denied") return "";
  if (s.status === "error" && s.tool !== "run_command") return "";
  switch (s.tool) {
    case "read_file": {
      const total = /av (\d+) linjer\.?\]/.exec(r ?? "")?.[1];
      const shown = (r?.match(/^\d+\t/gm) ?? []).length;
      if (r === "(tom fil)") return "tom";
      const n = total ? Number(total) : shown;
      return n ? plural(n, "linje", "linjer") : "";
    }
    case "list_dir":
      if (!r) return "";
      return r === "(tom mappe)" ? "tom" : plural(r.split("\n").filter(Boolean).length, "oppføring", "oppføringer");
    case "glob":
      if (!r) return "";
      return /^Ingen filer/.test(r) ? "ingen filer" : plural(r.split("\n").filter((l) => l && !l.startsWith("[")).length, "fil", "filer");
    case "search":
      if (!r) return "";
      if (r === "Ingen treff") return "ingen treff";
      return plural(r.split("\n").filter((l) => l && !l.startsWith("[") && l !== "--").length, "treff", "treff");
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
      return s.sources ? (s.sources.length ? plural(s.sources.length, "kilde", "kilder") : "ingen treff") : "";
    case "update_plan":
      return s.summary;
    case "thread_wait":
      return s.status === "done" ? "ferdig" : "";
    default:
      return "";
  }
}

// [past, present]: «Leste», «Leser».
const VERBS: Record<string, [string, string]> = {
  read_file: ["Leste", "Leser"],
  list_dir: ["Så i", "Ser i"],
  glob: ["Fant filer", "Finner filer"],
  search: ["Søkte etter", "Søker etter"],
  web_search: ["Søkte på nettet etter", "Søker på nettet etter"],
  web_fetch: ["Leste nettsiden", "Leser nettsiden"],
  browser_navigate: ["Åpnet", "Åpner"],
  browser_snapshot: ["Leste siden", "Leser siden"],
  browser_click: ["Klikket på", "Klikker på"],
  browser_type: ["Skrev i", "Skriver i"],
  browser_screenshot: ["Tok et skjermbilde", "Tar et skjermbilde"],
  browser_console: ["Leste konsollen", "Leser konsollen"],
  run_command: ["Kjørte", "Kjører"],
  edit_file: ["Endret", "Endrer"],
  delete_file: ["Slettet", "Sletter"],
  thread_create: ["Startet underagenten", "Starter underagenten"],
  thread_send: ["Sendte en melding", "Sender en melding"],
  thread_wait: ["Ventet på underagenten", "Venter på underagenten"],
  thread_read: ["Leste en tråd", "Leser en tråd"],
  thread_list: ["Så på trådene", "Ser på trådene"],
  task_list: ["Leste oppgavelisten", "Leser oppgavelisten"],
  task_add: ["La til oppgaven", "Legger til oppgaven"],
  task_update: ["Oppdaterte oppgaven", "Oppdaterer oppgaven"],
  remember: ["Lagret et minne", "Lagrer et minne"],
  forget: ["Glemte et minne", "Glemmer et minne"],
  update_plan: ["Oppdaterte planen", "Oppdaterer planen"],
  use_skill: ["Brukte skillen", "Bruker skillen"],
  propose_skill: ["Foreslo skillen", "Foreslår skillen"],
};

const TASK_STATUS: Record<string, string> = { todo: "til å gjøre", doing: "påbegynt", done: "ferdig" };

function targetOf(s: StepFacts): { target: string; mono: boolean; quoted: boolean } {
  const plain = (target: string) => ({ target, mono: false, quoted: false });
  const quoted = (target: string) => ({ target, mono: false, quoted: !!target });
  const mono = (target: string) => ({ target, mono: !!target, quoted: false });
  switch (s.tool) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "delete_file":
      return mono(summaryPath(s.summary));
    case "list_dir":
      return !s.summary || s.summary === "." || s.summary === "./" ? plain("prosjektmappen") : mono(s.summary);
    case "glob":
    case "search":
    case "run_command":
      return mono(s.summary);
    case "web_search":
      return quoted(s.summary);
    case "web_fetch":
    case "browser_navigate":
      return plain(hostAndPath(s.summary));
    case "browser_click":
    case "browser_type":
      return quoted(s.summary);
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
      return quoted(s.summary);
    case "task_update": {
      const status = field(s.input, "status");
      return plain(TASK_STATUS[status] ? `som ${TASK_STATUS[status]}` : "");
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
  let verb: string;
  if (s.tool === "write_file") verb = running ? (isNewFile(s) ? "Oppretter" : "Skriver") : isNewFile(s) ? "Opprettet" : "Skrev om";
  else if (s.tool === "web_search" && !s.summary) verb = running ? "Søker på nettet" : "Søkte på nettet";
  else verb = (VERBS[s.tool] ?? [s.tool, s.tool])[running ? 1 : 0];
  return { verb, ...where, result: running ? "" : resultOf(s) };
}

// «Leste src/app.ts», as one line of plain text, for titles and the now-line.
export function stepSentence(s: StepFacts): string {
  const w = describeStep(s);
  const target = w.quoted ? `«${w.target}»` : w.target;
  return target ? `${w.verb} ${target}` : w.verb;
}

// The line over several steps of the same kind in a row: «Leste 6 filer», «Kjørte 3 kommandoer».
export function runLabel(kind: StepKind, items: StepFacts[], running: boolean): string {
  const n = items.length;
  switch (kind) {
    case "read": {
      const dirs = items.filter((i) => i.tool === "list_dir").length;
      const files = n - dirs;
      const parts = [files ? plural(files, "fil", "filer") : "", dirs ? plural(dirs, "mappe", "mapper") : ""].filter(Boolean);
      return `${running ? "Leser" : "Leste"} ${parts.join(" og ")}`;
    }
    case "search":
      return `${running ? "Søker" : "Søkte"} ${n} ganger`;
    case "web":
      if (items.every((i) => i.tool === "web_search")) return `${running ? "Søker" : "Søkte"} på nettet ${n} ganger`;
      if (items.every((i) => i.tool === "web_fetch")) return `${running ? "Leser" : "Leste"} ${n} nettsider`;
      return `${running ? "Bruker" : "Brukte"} nettleseren i ${n} steg`;
    case "command":
      return `${running ? "Kjører" : "Kjørte"} ${n} kommandoer`;
    case "create":
      return `${running ? "Oppretter" : "Opprettet"} ${n} filer`;
    case "edit":
      return `${running ? "Endrer" : "Endret"} ${new Set(items.map((i) => summaryPath(i.summary))).size === 1 ? `${summaryPath(items[0].summary)} ${n} ganger` : `${n} filer`}`;
    case "delete":
      return `${running ? "Sletter" : "Slettet"} ${n} filer`;
    case "team":
      return `${running ? "Jobber" : "Jobbet"} med teamet i ${n} steg`;
    case "memory":
      return `${running ? "Oppdaterer" : "Oppdaterte"} minnet i ${n} steg`;
    case "plan":
      return `${running ? "Oppdaterer" : "Oppdaterte"} planen ${n} ganger`;
    case "skill":
      return `${running ? "Bruker" : "Brukte"} ${n} skills`;
    default:
      return `${running ? "Bruker" : "Brukte"} ${n} verktøy`;
  }
}

// The short result of a run: the sum of the lines changed, the sources found, or how many failed.
export function runResult(kind: StepKind, items: StepFacts[]): string {
  const failed = items.filter((i) => i.status === "error").length;
  if (failed) return `${failed} feilet`;
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
    return sources ? plural(sources, "kilde", "kilder") : "";
  }
  if (kind === "read") {
    const lines = items.reduce((sum, i) => sum + (i.tool === "read_file" ? Number(/^(\d+) linje/.exec(resultOf(i))?.[1] ?? 0) : 0), 0);
    return lines ? plural(lines, "linje", "linjer") : "";
  }
  if (kind === "command") return items.every((i) => commandResult(i.result, i.status) === "exit 0") ? "alle exit 0" : "";
  return "";
}

// The first line of an error, for the quiet note under a failed step.
export function errorLine(s: StepFacts): string {
  if (s.status !== "error" || !s.result) return "";
  if (s.tool === "run_command") return "";
  const line = s.result.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 140 ? `${line.slice(0, 138)}…` : line;
}
