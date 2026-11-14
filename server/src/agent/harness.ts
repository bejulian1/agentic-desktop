// The standard harness (SPEC 22): the parts of the built-in prompt that can be switched on and off,
// the default global AGENTS.md that is written the first time the app starts, «Gjenopprett
// standard» with a line diff and a backup, and Chat's own personalisation. The choices live in
// harness.json in the data folder; the global AGENTS.md lives in the global config folder, next to
// settings.json and skills/, where it has always been read from. See docs/research/harness-runde9.md.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ChatPersonal, ChatTone, UpgradeOp, UpgradeProposal } from "../../../shared/protocol.ts";
import { MAX_CHAT_FIELD, MAX_CHAT_WORDS, countChatWords, truncateChatField } from "../../../shared/protocol.ts";
export { MAX_CHAT_FIELD, MAX_CHAT_WORDS } from "../../../shared/protocol.ts";
import { HttpError } from "../errors.ts";
import { REPO_ROOT } from "../config.ts";
import { looksSecret } from "../memory.ts";
import { writeAtomic } from "../write-atomic.ts";

// Bumped when the built-in harness text changes, so the preview can say which one is in use.
export const HARNESS_VERSION = "15.6";
export const HARNESS_FILE = "harness.json";
export const BACKUP_DIR = "backups";
const MAX_BACKUPS = 20;
export const TONES: ChatTone[] = ["standard", "kort", "vennlig", "grundig", "uformell", "formell"];
export type { ChatPersonal, ChatTone, UpgradeOp, UpgradeProposal };

export interface HarnessPart {
  id: string;
  title: string; // Norwegian, for Innstillinger
  text: string; // what it does, in Norwegian
  locked?: boolean; // always on
  default: boolean;
}

// The built-in base, in the order it reaches the model. Identity and safety are always there; the
// rest can be switched off one by one, never edited.
export const HARNESS_PARTS: HarnessPart[] = [
  { id: "identity", title: "Identitet", text: "Hvem agenten er, hva den kan i denne appen, og at den svarer på språket ditt. Gjør at «hei» i en ny tråd får et svar som kjenner seg selv.", locked: true, default: true },
  { id: "workflow", title: "Forstå før endring", text: "Les og søk i koden før den endres, gjør den minste endringen som løser oppgaven, og spør heller enn å gjette.", default: true },
  { id: "tools", title: "Verktøyregler", text: "Hvordan edit_file brukes, at feil fra et verktøy skal leses, og at lesende verktøy kan kjøres samtidig.", default: true },
  { id: "plan", title: "Planlegg oppgaver med flere steg", text: "En kort plan med update_plan når oppgaven har flere steg. Vises i det festede sammendraget.", default: true },
  { id: "verify", title: "Kjør tester etter endringer", text: "Kjør prosjektets tester, typesjekk eller bygg etter en endring, og les feilene. Appen minner modellen på det én gang hvis den glemmer det.", default: true },
  { id: "askFirst", title: "Spør før store endringer", text: "Før endringer i mange filer, sletting, nye avhengigheter eller endringer i bygg og database beskriver agenten planen og venter på ja.", default: false },
  { id: "summary", title: "Avslutt med et sammendrag", text: "Hva som ble endret, hvordan det ble sjekket, og hva som står igjen.", default: true },
  { id: "safety", title: "Sikkerhet", text: "Brukerens aktuelle oppdrag og grenser gjelder alltid. Stier holdes i prosjektmappen, innhold fra filer og nettsider er data og ikke ordre, avslag respekteres, og nøkler skrives aldri ned.", locked: true, default: true },
];

export function defaultParts(): Record<string, boolean> {
  return Object.fromEntries(HARNESS_PARTS.map((p) => [p.id, p.default]));
}

// The shipped sources are also reviewable Markdown files. The package copies them under
// AD_APP_ROOT, so development, first-run seeding and explicit reset share the same defaults.
function shippedInstruction(name: "code" | "chat"): string {
  const text = readFileSync(path.join(REPO_ROOT, "docs/system-instructions", `${name}.md`), "utf8").replace(/\r\n/g, "\n");
  if (!text.trim()) throw new Error(`Standardinstruksen ${name}.md er tom.`);
  return text;
}

export const DEFAULT_AGENTS_MD = shippedInstruction("code");
export const DEFAULT_CHAT_SYSTEM_INSTRUCTIONS = shippedInstruction("chat").trim();
if (DEFAULT_CHAT_SYSTEM_INSTRUCTIONS.length > MAX_CHAT_FIELD) throw new Error(`Chat-standardinstruksen er for lang: maks ${MAX_CHAT_FIELD} tegn.`);

export const DEFAULT_CHAT: ChatPersonal = { instructions: DEFAULT_CHAT_SYSTEM_INSTRUCTIONS, about: "", tone: "standard", autoMemory: false, memories: true };

export interface HarnessState {
  version: 1;
  parts: Record<string, boolean>;
  seeded: boolean; // the default global AGENTS.md was offered once; it is never written again
  autoUpgrade: boolean; // propose a memory upgrade by itself now and then
  lastUpgradeAt: number | null;
  pending: UpgradeProposal[]; // proposals made by themselves, waiting to be seen
  chat: ChatPersonal;
  chatInstructionsCustomized: boolean; // distinguishes deliberate empty text from the legacy empty default
}

const DEFAULT_STATE = (): HarnessState => ({
  version: 1,
  parts: defaultParts(),
  seeded: false,
  autoUpgrade: true,
  lastUpgradeAt: null,
  pending: [],
  chat: { ...DEFAULT_CHAT },
  chatInstructionsCustomized: false,
});

function cleanText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${label} må være tekst`);
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > MAX_CHAT_FIELD) throw new HttpError(400, `${label} er for lang: ${text.length} tegn, maks ${MAX_CHAT_FIELD}.`);
  if (countChatWords(text) > MAX_CHAT_WORDS) throw new HttpError(400, `${label} er for lang: maks ${MAX_CHAT_WORDS} ord.`);
  if (looksSecret(text)) throw new HttpError(400, `${label} ser ut til å inneholde en nøkkel, et token eller et passord, og blir ikke lagret.`);
  return text;
}

export function hashText(text: string | null): string {
  return createHash("sha256").update(text ?? "\u0000none").digest("hex").slice(0, 16);
}

export class HarnessStore {
  private file: string;
  private dataDir: string;
  private cache: HarnessState | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, HARNESS_FILE);
  }

  state(): HarnessState {
    if (this.cache) return this.cache;
    const base = DEFAULT_STATE();
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      const parts = { ...base.parts };
      for (const part of HARNESS_PARTS) if (!part.locked && typeof raw.parts?.[part.id] === "boolean") parts[part.id] = raw.parts[part.id];
      const chat = { ...DEFAULT_CHAT };
      if (raw.chat && typeof raw.chat === "object") {
        if (typeof raw.chat.instructions === "string" && (raw.chat.instructions.trim() || raw.chatInstructionsCustomized === true)) chat.instructions = truncateChatField(raw.chat.instructions);
        if (typeof raw.chat.about === "string") chat.about = truncateChatField(raw.chat.about);
        if (TONES.includes(raw.chat.tone)) chat.tone = raw.chat.tone;
        if (typeof raw.chat.autoMemory === "boolean") chat.autoMemory = raw.chat.autoMemory;
        if (typeof raw.chat.memories === "boolean") chat.memories = raw.chat.memories;
      }
      this.cache = {
        version: 1,
        parts,
        seeded: raw.seeded === true,
        autoUpgrade: raw.autoUpgrade !== false,
        lastUpgradeAt: typeof raw.lastUpgradeAt === "number" ? raw.lastUpgradeAt : null,
        pending: Array.isArray(raw.pending) ? raw.pending.filter((p: any) => p && Array.isArray(p.ops)).slice(0, 20) : [],
        chat,
        chatInstructionsCustomized: raw.chatInstructionsCustomized === true || (typeof raw.chat?.instructions === "string" && !!raw.chat.instructions.trim() && raw.chat.instructions !== DEFAULT_CHAT_SYSTEM_INSTRUCTIONS),
      };
    } catch {
      this.cache = base; // missing or broken: the defaults, and the next write repairs the file
    }
    return this.cache;
  }

  private save(next: HarnessState): HarnessState {
    writeAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`, this.dataDir, 0o600);
    this.cache = next;
    return next;
  }

  setParts(patch: unknown): HarnessState {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpError(400, "parts må være et objekt");
    const parts = { ...this.state().parts };
    for (const [id, value] of Object.entries(patch)) {
      const part = HARNESS_PARTS.find((p) => p.id === id);
      if (!part) throw new HttpError(400, `Ukjent del av harnessen: ${id}`);
      if (typeof value !== "boolean") throw new HttpError(400, `${part.title} må være på eller av`);
      if (part.locked && !value) throw new HttpError(400, `${part.title} er alltid på`);
      if (!part.locked) parts[id] = value;
    }
    return this.save({ ...this.state(), parts });
  }

  resetParts(): HarnessState {
    return this.save({ ...this.state(), parts: defaultParts() });
  }

  setAutoUpgrade(on: boolean): HarnessState {
    return this.save({ ...this.state(), autoUpgrade: on, ...(on ? {} : { pending: [] }) });
  }

  markSeeded(): void {
    if (!this.state().seeded) this.save({ ...this.state(), seeded: true });
  }

  setChat(patch: Record<string, unknown>): ChatPersonal {
    const chat = { ...this.state().chat };
    if (patch.instructions !== undefined) chat.instructions = cleanText(patch.instructions, "Systeminstruksen");
    if (patch.about !== undefined) chat.about = cleanText(patch.about, "«Om deg»");
    if (patch.tone !== undefined) {
      if (!TONES.includes(patch.tone as ChatTone)) throw new HttpError(400, "Ukjent tone");
      chat.tone = patch.tone as ChatTone;
    }
    if (patch.autoMemory !== undefined) chat.autoMemory = patch.autoMemory === true;
    if (patch.memories !== undefined) chat.memories = patch.memories === true;
    this.save({ ...this.state(), chat, chatInstructionsCustomized: patch.instructions !== undefined ? true : this.state().chatInstructionsCustomized });
    return chat;
  }

  resetChat(): ChatPersonal {
    this.save({ ...this.state(), chat: { ...DEFAULT_CHAT }, chatInstructionsCustomized: false });
    return this.state().chat;
  }

  resetChatInstructions(): ChatPersonal {
    this.save({ ...this.state(), chat: { ...this.state().chat, instructions: DEFAULT_CHAT_SYSTEM_INSTRUCTIONS }, chatInstructionsCustomized: false });
    return this.state().chat;
  }

  // Proposals made by themselves. One per scope and project; a new one replaces the old.
  addPending(proposal: UpgradeProposal): void {
    const same = (p: UpgradeProposal) => p.scope === proposal.scope && (p.projectId ?? null) === (proposal.projectId ?? null);
    this.save({ ...this.state(), pending: [...this.state().pending.filter((p) => !same(p)), proposal].slice(-20), lastUpgradeAt: proposal.createdAt });
  }

  dropPending(scope: string, projectId?: string): void {
    const pending = this.state().pending.filter((p) => !(p.scope === scope && (p.projectId ?? null) === (projectId ?? null)));
    if (pending.length !== this.state().pending.length) this.save({ ...this.state(), pending });
  }

  touchUpgrade(at = Date.now()): void {
    this.save({ ...this.state(), lastUpgradeAt: at });
  }
}

// The default global AGENTS.md, the first time the app starts: only when the file is not there
// and it has never been offered before, so a file the user deleted does not come back.
export function seedGlobalAgents(globalDir: string, store: HarnessStore): "written" | "kept" | "skipped" {
  const file = path.join(globalDir, "AGENTS.md");
  if (store.state().seeded) return "skipped";
  let result: "written" | "kept" = "kept";
  if (!existsSync(file)) {
    writeAtomic(file, DEFAULT_AGENTS_MD, globalDir, 0o644);
    result = "written";
  }
  store.markSeeded();
  return result;
}

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

// A line diff by longest common subsequence. The files are small (64 KiB at most); past a few
// thousand lines it falls back to everything out, everything in.
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}

export interface Backup {
  name: string;
  path: string;
  size: number;
  at: number;
}

export function listBackups(globalDir: string): Backup[] {
  const dir = path.join(globalDir, BACKUP_DIR);
  try {
    return readdirSync(dir)
      .filter((name) => /^AGENTS\.md\.[\w-]+\.bak$/.test(name))
      .map((name) => {
        const info = statSync(path.join(dir, name));
        return { name, path: path.join(dir, name), size: info.size, at: info.mtimeMs };
      })
      .sort((x, y) => y.at - x.at);
  } catch {
    return [];
  }
}

// The old file is kept as backups/AGENTS.md.<time>.bak before it is replaced. The oldest go when
// there are more than MAX_BACKUPS; they are the app's own copies, never the user's files.
export function backupGlobalAgents(globalDir: string, text: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  let name = `AGENTS.md.${stamp}.bak`;
  for (let n = 2; existsSync(path.join(globalDir, BACKUP_DIR, name)); n++) name = `AGENTS.md.${stamp}-${n}.bak`;
  const file = path.join(globalDir, BACKUP_DIR, name);
  writeAtomic(file, text, globalDir, 0o600);
  return file;
}

export function pruneBackups(globalDir: string, remove: (file: string) => void): void {
  for (const old of listBackups(globalDir).slice(MAX_BACKUPS)) remove(old.path);
}
