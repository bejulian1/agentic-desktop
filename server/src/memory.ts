// Memories: short notes the model keeps between threads. They are plain Markdown files, one line
// per memory, so they are easy to read and edit outside the app: MEMORY.md in the global config
// folder ($XDG_CONFIG_HOME/agentic-desktop) for facts about the user, and .agentic/MEMORY.md in
// a project for what is true there. The app only touches the "- " lines; anything else the user
// writes in the file is kept as it is. Nothing that looks like a secret is saved or loaded.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { MemoryItem, MemoryScope, Project } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";
import { guardPath } from "./paths.ts";
import { writeAtomic } from "./write-atomic.ts";

export const MEMORY_FILE = "MEMORY.md";
export const MAX_MEMORY_CHARS = 300;
export const MAX_MEMORIES = 100; // per file
const MAX_FILE_CHARS = 128 * 1024;
const MAX_PROMPT_CHARS = 3000;

const HEADER = [
  "# Minner",
  "",
  "Korte notater som Agentic Desktop husker mellom tråder. Én linje per minne, som begynner med «- ».",
  "Du kan endre og slette fritt. Hemmeligheter som nøkler og passord lagres aldri.",
  "",
].join("\n");

// Keys, tokens and passwords, as well as they can be told from a short text. Better to refuse a
// harmless note now and then than to keep a secret in a file that may end up in git.
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-(?:[A-Za-z0-9]+-)*[A-Za-z0-9_]{16,}/, // OpenAI, Anthropic, OpenRouter and similar
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/, // Stripe
  /\brk_[A-Za-z0-9]{20,}/,
  /\bhf_[A-Za-z0-9]{20,}/, // Hugging Face
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/, // Slack
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z0-9 ]+-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i, // user:password@host
];

// "Wi-Fi-passordet er Solsikke2024", "passord: solskinn", "api_key=abc123…": a word for a secret,
// also inflected and in compounds, perhaps a few words more, then "er", "is", ":" or "=" and a value.
const PASSWORD_WORDS = "passord|password|passwd|passphrase|passfrase|pinkode|pin-kode";
const SECRET_WORDS = "secret|hemmelighet|token|api[_ -]?key|apikey|api-?nøkkel|nøkkel|private[_ -]?key|access[_ -]?key|pwd";
const KEYWORD_VALUE = new RegExp(
  String.raw`(?<![\p{L}\d])[\p{L}\d_-]*?(?:(${PASSWORD_WORDS})|${SECRET_WORDS})\p{L}*(?:\s+[\p{L}\d-]+){0,3}?(?:\s*[:=]|\s+(?:er|var|blir|is|was)\s)\s*(["'\x60«]?)([^\s"'\x60»]+)`,
  "giu",
);
// What often follows "passordet er" or "token:" in a note that holds no secret.
const NOT_A_VALUE = new Set(
  ("lagret lagres stored saved satt set settes byttet endret endres changed rotert rotated nytt ny new gammelt old " +
    "gyldig ugyldig valid invalid utløpt expired kryptert encrypted hashet hashed påkrevd required nødvendig needed " +
    "valgfritt optional tomt empty feil wrong riktig correct hemmelig secret privat private sterkt strong svakt weak " +
    "samme same ikke not aldri never alltid always også also bare only det den dette denne this that there here der her " +
    "for til to fra from med with uten without som as like i in på on ligger lives hentes fetched se see bruk use " +
    "brukes used delt shared sendt sent glemt forgotten ukjent unknown kort short langt long synlig visible skjult hidden").split(" "),
);

function keywordValue(text: string): boolean {
  for (const match of text.matchAll(KEYWORD_VALUE)) {
    const password = match[1] !== undefined;
    const quoted = match[2] !== "";
    const value = match[3].replace(/[.,;:!?)]+$/, "");
    // Placeholders and pointers to where the secret is kept are not the secret.
    if (/^(?:<.*>|\$\{?\w+\}?|process\.env\b.*|\*+|x{3,}|\.{3}|…)$/i.test(value) || value.includes("://") || /^[~./]/.test(value)) continue;
    if (/\.(?:json|env|ya?ml|toml|ini|txt|md|ts|js)$/i.test(value)) continue;
    if (password) {
      if (value.length >= 4 && (quoted || !NOT_A_VALUE.has(value.toLowerCase()))) return true;
    } else if (value.length >= 8 && /[\d!#$%&*+/=?@^_~]/.test(value) && !/^\d+$/.test(value)) {
      return true;
    }
  }
  return false;
}

// Commit ids, checksums and the like: a long hex string is fine next to one of these words.
const HASH_WORDS = /\b(?:commit\w*|sha\d*|hash\w*|sjekksum\w*|checksum\w*|md5|digest|rev|revision|integrity|etag|blob|tree)\b|\bsha\d*[:-]/i;
const LONG_HEX = /(?<![\w-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{32,}(?![\w-])/i;

// Bits per character, from how often each character occurs.
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / text.length) * Math.log2(n / text.length);
  return bits;
}

// A random key in base64 or similar: 32 characters or more with letters and digits, few separators
// (paths and names have many), and a spread of characters that ordinary words and names do not
// reach. Random base64 of 32 characters is above 4 bits per character; names in camelCase and
// paths are around 4 at the same length, and the bar rises with the length.
function randomLooking(text: string): boolean {
  for (const [word] of text.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
    if (!/\d/.test(word) || !/[A-Za-z]/.test(word) || /^[0-9a-f]+$/i.test(word) || /^sha\d+-/i.test(word)) continue;
    const separators = (word.match(/[/+_-]/g) ?? []).length;
    if (separators > word.length / 8) continue;
    if (entropy(word) >= Math.min(4 + (word.length - 32) * 0.025, 4.6)) return true;
  }
  return false;
}

export function looksSecret(text: string): boolean {
  return (
    SECRET_PATTERNS.some((pattern) => pattern.test(text)) ||
    keywordValue(text) ||
    (LONG_HEX.test(text) && !HASH_WORDS.test(text)) ||
    randomLooking(text)
  );
}

// Chat's «Oppdater minnet av seg selv» (SPEC 22.4): what the user plainly asked to be remembered,
// or said about themselves, in the message they sent. Plain rules, so it works without a key and
// never guesses. Each is one short sentence; anything that looks like a secret is left out.
const CAPTURE: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/(?:^|[.!?]\s+)husk(?: på)?(?: at)?[:,]?\s+([^\n]+)/iu, (m) => m[1]],
  [/(?:^|[.!?]\s+)remember(?: that)?[:,]?\s+([^\n]+)/iu, (m) => m[1]],
  [/\b(?:[Jj]eg heter|[Mm]itt navn er)\s+(\p{Lu}[\p{L}-]*(?:\s+\p{Lu}[\p{L}-]*){0,2})/u, (m) => `Brukeren heter ${m[1]}`],
  [/\b[Kk]all meg\s+(\p{L}[\p{L}-]*(?:\s+\p{Lu}[\p{L}-]*){0,2})/u, (m) => `Brukeren vil kalles ${m[1]}`],
  [/\b[Mm]y name is\s+(\p{Lu}[\p{L}-]*(?:\s+\p{Lu}[\p{L}-]*){0,2})/u, (m) => `The user's name is ${m[1]}`],
  [/\bjeg (foretrekker|liker best|vil helst ha)\s+([^\n]+)/iu, (m) => `Brukeren ${m[1].toLowerCase()} ${m[2]}`],
  [/\bI (?:prefer|always want)\s+([^\n]+)/u, (m) => `The user prefers ${m[1]}`],
];

// A dot in a path, hostname or version is not a sentence boundary.
function sentence(text: string): string {
  return text.trim().split(/[.!?]+(?:\s|$)/u, 1)[0].trim();
}

export function temporaryNote(text: string): boolean {
  return /(?<![\p{L}\p{N}])(?:akkurat nå|i dag|denne gangen|denne oppgaven|midlertidig|right now|today|this time|for this (?:task|session)|temporarily|for now)(?![\p{L}\p{N}])/iu.test(text);
}

export function correctionIn(message: string): string | undefined {
  const match = /^(?:nei|rettelse|korrigering|no|correction)[,:!.\s]+((?:bruk|husk|kjør|lagre|skriv|use|run|save|write|vi bruker|we use)\s+[^\n]+)/iu.exec(message.trim());
  if (!match || looksSecret(message) || temporaryNote(message)) return;
  try { return cleanMemory(sentence(match[1])); } catch { return; }
}

// Only preselect an unambiguous old note. The user may choose a different one.
export function relatedMemory(text: string, items: Array<{id: string; text: string}>): string | undefined {
  const topics = [/\b(?:npm|pnpm|yarn|bun)\b/i, /\b(?:heter|kalles|name is)\b/i];
  const matches = items.filter(item => topics.some(topic => topic.test(text) && topic.test(item.text)));
  return matches.length === 1 ? matches[0].id : undefined;
}

export function captureMemories(message: string): string[] {
  if (looksSecret(message) || temporaryNote(message)) return [];
  const out: string[] = [];
  for (const [pattern, render] of CAPTURE) {
    const match = pattern.exec(message);
    if (!match) continue;
    try {
      const text = cleanMemory(sentence(render(match)).replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase("nb")));
      if (!out.some((o) => o.toLowerCase() === text.toLowerCase())) out.push(text);
    } catch {
      // Too long, empty or a secret: not remembered.
    }
  }
  return out.slice(0, 3);
}

export function memoryId(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// One line, trimmed, no Markdown list marker of its own.
export function cleanMemory(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Minnet må være tekst");
  const text = raw.replace(/\s+/g, " ").replace(/^[-*]\s+/, "").trim();
  if (!text) throw new HttpError(400, "Minnet er tomt");
  if (text.length > MAX_MEMORY_CHARS) throw new HttpError(400, `Minnet er for langt: ${text.length} tegn, maks ${MAX_MEMORY_CHARS}. Skriv det kortere.`);
  if (looksSecret(text)) throw new HttpError(400, "Minnet ser ut til å inneholde en nøkkel, et token eller et passord, og blir ikke lagret.");
  return text;
}

const BULLET = /^\s*[-*]\s+(.+?)\s*$/;

interface Parsed {
  lines: string[];
  items: Array<{ line: number; text: string }>;
}

function parse(content: string): Parsed {
  const lines = content.split("\n");
  const items: Parsed["items"] = [];
  lines.forEach((line, i) => {
    const match = BULLET.exec(line);
    if (match) items.push({ line: i, text: match[1] });
  });
  return { lines, items };
}

function readOrEmpty(file: string): string {
  try {
    return readFileSync(file, "utf8").slice(0, MAX_FILE_CHARS);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

export class Memories {
  private globalDir: string;
  private dataDir: string;

  constructor(globalDir: string, dataDir: string) {
    this.globalDir = globalDir;
    this.dataDir = dataDir;
  }

  // The project file goes through the same path guard as the agent's tools, so a symlinked
  // .agentic/ cannot lead out of the project.
  file(scope: MemoryScope, project?: Project): string {
    if (scope === "global") return path.join(this.globalDir, MEMORY_FILE);
    if (!project) throw new HttpError(400, "Prosjektminner krever et prosjekt");
    return guardPath(project.path, path.join(".agentic", MEMORY_FILE), this.dataDir).abs;
  }

  // The folder a write must stay in: no symlink on the way from it, see write-atomic.ts.
  private root(scope: MemoryScope, project?: Project): string {
    return scope === "global" ? this.globalDir : project!.path;
  }

  list(scope: MemoryScope, project?: Project): MemoryItem[] {
    const file = this.file(scope, project);
    return parse(readOrEmpty(file)).items.map(({ text }) => ({
      id: memoryId(text),
      scope,
      ...(project && scope === "project" ? { projectId: project.id } : {}),
      text,
      ...(looksSecret(text) ? { flagged: true } : {}),
    }));
  }

  add(scope: MemoryScope, project: Project | undefined, raw: unknown): { item: MemoryItem; existed: boolean } {
    const text = cleanMemory(raw);
    const file = this.file(scope, project);
    const content = readOrEmpty(file);
    const parsed = parse(content);
    const same = parsed.items.find((i) => i.text.toLowerCase() === text.toLowerCase());
    const item = (t: string): MemoryItem => ({ id: memoryId(t), scope, ...(project && scope === "project" ? { projectId: project.id } : {}), text: t });
    if (same) return { item: item(same.text), existed: true };
    if (parsed.items.length >= MAX_MEMORIES) {
      throw new HttpError(409, `Det er allerede ${MAX_MEMORIES} minner her. Slett eller slå sammen noen først.`);
    }
    let lines = content ? parsed.lines : HEADER.split("\n");
    // After the last memory, or at the end, so the user's own text stays where it is.
    const after = parsed.items.at(-1)?.line;
    if (after === undefined) {
      while (lines.length && lines.at(-1) === "") lines = lines.slice(0, -1);
      lines = [...lines, "", `- ${text}`, ""];
    } else {
      lines = [...lines.slice(0, after + 1), `- ${text}`, ...lines.slice(after + 1)];
    }
    writeAtomic(file, lines.join("\n"), this.root(scope, project));
    return { item: item(text), existed: false };
  }

  update(scope: MemoryScope, project: Project | undefined, id: string, raw: unknown): MemoryItem {
    const text = cleanMemory(raw);
    const file = this.file(scope, project);
    const parsed = parse(readOrEmpty(file));
    const found = parsed.items.find((i) => memoryId(i.text) === id);
    if (!found) throw new HttpError(404, "Fant ikke minnet. Det kan være endret i filen.");
    const indent = /^\s*[-*]\s+/.exec(parsed.lines[found.line])![0];
    parsed.lines[found.line] = `${indent}${text}`;
    writeAtomic(file, parsed.lines.join("\n"), this.root(scope, project));
    return { id: memoryId(text), scope, ...(project && scope === "project" ? { projectId: project.id } : {}), text };
  }

  remove(scope: MemoryScope, project: Project | undefined, id: string): void {
    const file = this.file(scope, project);
    const parsed = parse(readOrEmpty(file));
    const found = parsed.items.find((i) => memoryId(i.text) === id);
    if (!found) throw new HttpError(404, "Fant ikke minnet. Det kan være endret i filen.");
    writeAtomic(file, parsed.lines.filter((_, i) => i !== found.line).join("\n"), this.root(scope, project));
  }

  // Several changes in one write, for the memory upgrade (SPEC 22.3): text null removes the line.
  // Ids are matched to lines in file order, so two equal lines are two matches. If one is missing,
  // the file changed since the proposal was made, and nothing is written.
  rewrite(scope: MemoryScope, project: Project | undefined, changes: Array<{ id: string; text: string | null }>): number {
    const file = this.file(scope, project);
    const parsed = parse(readOrEmpty(file));
    const taken = new Set<number>();
    const edits = new Map<number, string | null>();
    for (const change of changes) {
      const found = parsed.items.find((i) => !taken.has(i.line) && memoryId(i.text) === change.id);
      if (!found) throw new HttpError(409, "Minnene er endret siden forslaget ble laget. Lag et nytt forslag.");
      taken.add(found.line);
      edits.set(found.line, change.text === null ? null : cleanMemory(change.text));
    }
    if (!edits.size) return 0;
    const lines = parsed.lines.flatMap((line, i) => {
      if (!edits.has(i)) return [line];
      const text = edits.get(i);
      return text === null ? [] : [`${/^\s*[-*]\s+/.exec(line)![0]}${text}`];
    });
    writeAtomic(file, lines.join("\n"), this.root(scope, project));
    return edits.size;
  }

  // The model forgets by text: the exact memory, or a part that only one memory has.
  find(scope: MemoryScope, project: Project | undefined, query: string): MemoryItem {
    const wanted = query.replace(/\s+/g, " ").replace(/^[-*]\s+/, "").trim().toLowerCase();
    if (!wanted) throw new HttpError(400, "Skriv minnet som skal glemmes");
    const items = this.list(scope, project);
    const exact = items.filter((i) => i.text.toLowerCase() === wanted);
    const partial = exact.length ? exact : items.filter((i) => i.text.toLowerCase().includes(wanted));
    if (!partial.length) throw new HttpError(404, "Fant ikke noe minne med den teksten.");
    if (partial.length > 1) throw new HttpError(409, `${partial.length} minner passer: ${partial.map((i) => `«${i.text}»`).join(", ")}. Skriv mer av teksten.`);
    return partial[0];
  }

  forget(scope: MemoryScope, project: Project | undefined, query: string): string {
    const item = this.find(scope, project, query);
    this.remove(scope, project, item.id);
    return item.text;
  }

  clear(scope: MemoryScope, project?: Project): number {
    const file = this.file(scope, project);
    const parsed = parse(readOrEmpty(file));
    if (!parsed.items.length) return 0;
    const drop = new Set(parsed.items.map((i) => i.line));
    writeAtomic(file, parsed.lines.filter((_, i) => !drop.has(i)).join("\n"), this.root(scope, project));
    return parsed.items.length;
  }

  // What goes into the system prompt: this project's memories first, then the global ones, newest
  // first within each, until the budget is used. Anything that looks like a secret is skipped,
  // also when the user wrote it into the file by hand.
  forPrompt(project: Project | undefined): string {
    const sections: Array<{ title: string; items: MemoryItem[] }> = [];
    const safe = (scope: MemoryScope) => {
      try {
        return this.list(scope, project).filter((i) => !i.flagged).reverse();
      } catch {
        return []; // A file that cannot be read must not stop a run.
      }
    };
    if (project) sections.push({ title: "This project:", items: safe("project") });
    sections.push({ title: "About the user, for every project:", items: safe("global") });
    let used = 0;
    let left = 0;
    const out: string[] = [];
    for (const section of sections) {
      const lines: string[] = [];
      for (const item of section.items) {
        if (used + item.text.length + 3 > MAX_PROMPT_CHARS) {
          left++;
          continue;
        }
        used += item.text.length + 3;
        lines.push(`- ${item.text}`);
      }
      if (lines.length) out.push(section.title, ...lines);
    }
    if (left) out.push(`(${left} older memories are not shown.)`);
    return out.join("\n");
  }
}
