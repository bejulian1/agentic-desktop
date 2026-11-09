// Minneoppgradering (SPEC 22.3): merge memories that say the same thing, drop the ones a newer
// memory or the project has made out of date, and trim filler. The default is a set of plain
// rules, so it works without an API key and gives the same answer every time; a real model can
// make the proposal instead (Runner.proposeUpgrade). Either way it is only a proposal: nothing is
// written until the user has seen it and said yes (Memories.rewrite).
import { existsSync } from "node:fs";
import path from "node:path";
import { cleanMemory, looksSecret } from "../memory.ts";
import { isInside } from "../paths.ts";
import type { UpgradeOp } from "./harness.ts";

export interface UpgradeItem {
  id: string;
  text: string;
}

// Small words that say nothing about what a memory is about, in Norwegian and English.
const STOP = new Set(
  ("og i på er det den de en et at som med for til av om har vil skal kan ikke så men eller fra ved når der her jeg du vi " +
    "seg sin sitt sine meg deg oss alltid bare også helst gjerne the a an is are to of in on and or for with be it that this " +
    "by as at from always only also should will can not use uses used bruk bruke brukes").split(" "),
);

export function normalise(text: string): string {
  return text.toLocaleLowerCase("nb").normalize("NFC").replace(/[«»"'`´’.,;:!?()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokens(text: string): string[] {
  return normalise(text).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

function subset(small: Set<string>, big: Set<string>): boolean {
  if (small.size < 2 || small.size >= big.size) return false;
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

// The first two content words: what the memory is about ("testene kjøres", "brukeren foretrekker").
function subject(list: string[]): string {
  return list.slice(0, 2).join(" ");
}

const FILLER: RegExp[] = [
  /^(?:husk|husk på|merk|note|remember|obs|nb)\s*(?:at|that)?\s*[:,-]?\s+/i,
  /^det er viktig å (?:huske|vite) at\s+/i,
  /^(?:it is important to (?:remember|know) that)\s+/i,
  /^(?:for (?:the )?record|til info)\s*[:,-]\s*/i,
];

// The same memory with less around it, or null when there is nothing to trim.
export function shorten(text: string): string | null {
  let out = text.replace(/\s+/g, " ").trim();
  for (const pattern of FILLER) out = out.replace(pattern, "");
  out = out.replace(/\s+([.,;:!?])/g, "$1").replace(/([.!?])\1+$/g, "$1").replace(/\s*\((?:osv|etc)\.?\)$/i, "");
  out = out.charAt(0).toLocaleUpperCase("nb") + out.slice(1);
  return out && out !== text && out.length < text.length ? out : null;
}

// Paths in a memory, like `src/app.ts` or docs/SPEC.md. Only relative ones inside the project.
function mentionedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const [, inTicks] of text.matchAll(/`([^`\s]+)`/g)) found.add(inTicks);
  for (const [word] of text.matchAll(/(?<![\w/.-])[\w-]+(?:\/[\w.-]+)+\.[a-z0-9]{1,6}(?![\w/])/gi)) found.add(word);
  return [...found].filter((p) => /[/.]/.test(p) && /\.[a-z0-9]{1,6}$/i.test(p) && !p.includes("..") && !path.isAbsolute(p) && !/^[a-z]+:/i.test(p) && !p.startsWith("~"));
}

interface Cluster {
  ids: string[];
  texts: string[];
  text: string; // what stays
  reasons: string[];
}

// Newest memories are at the end of the file. Each memory, newest first, either starts a cluster
// or joins one that a newer memory started; what is out of date is removed.
export function proposeByRules(items: UpgradeItem[], options: { projectPath?: string } = {}): UpgradeOp[] {
  const ops: UpgradeOp[] = [];
  const clusters: Cluster[] = [];
  const removed = new Set<number>();

  // A project memory that names files, none of which is there any more.
  if (options.projectPath) {
    items.forEach((item, i) => {
      const paths = mentionedPaths(item.text);
      if (!paths.length) return;
      const gone = paths.filter((p) => {
        const abs = path.resolve(options.projectPath!, p);
        return isInside(options.projectPath!, abs) && !existsSync(abs);
      });
      if (gone.length === paths.length) {
        removed.add(i);
        ops.push({ kind: "remove", ids: [item.id], texts: [item.text], result: null, reason: `Utdatert: ${gone.length === 1 ? `fila ${gone[0]} finnes` : `filene ${gone.join(", ")} finnes`} ikke lenger i prosjektet.` });
      }
    });
  }

  for (let i = items.length - 1; i >= 0; i--) {
    if (removed.has(i)) continue;
    const item = items[i];
    const mine = tokens(item.text);
    const set = new Set(mine);
    let placed = false;
    for (const cluster of clusters) {
      const theirs = tokens(cluster.text);
      const other = new Set(theirs);
      if (normalise(item.text) === normalise(cluster.text)) {
        cluster.ids.push(item.id);
        cluster.texts.push(item.text);
        cluster.reasons.push("Like minner");
        placed = true;
      } else if (subset(set, other)) {
        cluster.ids.push(item.id);
        cluster.texts.push(item.text);
        cluster.reasons.push("Nesten like: det korte står allerede i det lange");
        placed = true;
      } else if (subset(other, set)) {
        cluster.ids.push(item.id);
        cluster.texts.push(item.text);
        cluster.text = item.text; // the older one says more
        cluster.reasons.push("Nesten like: det korte står allerede i det lange");
        placed = true;
      } else if (jaccard(set, other) >= 0.75) {
        cluster.ids.push(item.id);
        cluster.texts.push(item.text);
        cluster.reasons.push("Nesten like: det nyeste beholdes");
        placed = true;
      } else if (jaccard(set, other) >= 0.5 && mine.length >= 2 && subject(mine) === subject(theirs)) {
        removed.add(i);
        ops.push({ kind: "remove", ids: [item.id], texts: [item.text], result: null, reason: `Utdatert: et nyere minne sier noe annet («${cluster.text}»).` });
        placed = true;
      }
      if (placed) break;
    }
    if (!placed) clusters.push({ ids: [item.id], texts: [item.text], text: item.text, reasons: [] });
  }

  for (const cluster of clusters.reverse()) {
    const short = shorten(cluster.text);
    const result = short ?? cluster.text;
    if (cluster.ids.length > 1) {
      const reasons = [...new Set(cluster.reasons)];
      ops.push({ kind: "merge", ids: cluster.ids, texts: cluster.texts, result, reason: `${reasons.join(". ")}.${short ? " Kortet ned." : ""}` });
    } else if (short) {
      ops.push({ kind: "shorten", ids: cluster.ids, texts: cluster.texts, result, reason: "Kortet ned: fyllord fjernet." });
    }
  }
  // In the order the memories stand in the file, so the preview reads from the top.
  const order = new Map(items.map((item, i) => [item.id, i]));
  return ops.sort((a, b) => Math.min(...a.ids.map((id) => order.get(id) ?? 0)) - Math.min(...b.ids.map((id) => order.get(id) ?? 0)));
}

// What a model is asked. The memories go in with their ids; the answer is JSON only.
export const UPGRADE_SYSTEM = [
  "You tidy a list of short memories that a coding app keeps between conversations.",
  "Merge memories that say the same thing, remove memories that a newer one (later in the list) contradicts, and shorten memories with filler words.",
  "Never invent facts, never change the meaning, keep the original wording where you can, and write in the language of the memory. Each result is one sentence, at most 300 characters.",
  'Answer with JSON only, no prose: {"ops":[{"kind":"merge"|"remove"|"shorten","ids":["<id>",...],"result":"<text or null for remove>","reason":"<short reason in Norwegian>"}]}.',
  "Use each id at most once. Leave out memories that are fine as they are. If nothing needs doing, answer {\"ops\":[]}.",
].join("\n");

export function upgradeRequest(items: UpgradeItem[]): string {
  return ["Memories, oldest first:", ...items.map((i) => `[${i.id}] ${i.text}`)].join("\n");
}

// The model's answer, checked as strictly as input from a user: known ids, each once, and texts
// that pass the same checks as a memory typed by hand. Anything else and the rules are used.
export function parseModelOps(answer: string, items: UpgradeItem[]): UpgradeOp[] {
  // The outermost braces, so a code fence or a line of prose around the JSON does not matter.
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Svaret var ikke JSON");
  const parsed = JSON.parse(answer.slice(start, end + 1));
  if (!parsed || !Array.isArray(parsed.ops)) throw new Error("Svaret mangler ops");
  const byId = new Map(items.map((i) => [i.id, i.text]));
  const used = new Set<string>();
  const ops: UpgradeOp[] = [];
  for (const raw of parsed.ops.slice(0, 100)) {
    const kind = raw?.kind;
    if (kind !== "merge" && kind !== "remove" && kind !== "shorten") throw new Error(`Ukjent operasjon: ${kind}`);
    const ids: string[] = Array.isArray(raw.ids) ? raw.ids.map(String) : [];
    if (!ids.length || ids.some((id) => !byId.has(id) || used.has(id))) throw new Error("Ukjent eller gjentatt id");
    if (kind === "merge" && ids.length < 2) throw new Error("En sammenslåing trenger minst to minner");
    if (kind !== "merge" && ids.length !== 1) throw new Error("Bare én id per fjerning eller forkorting");
    ids.forEach((id) => used.add(id));
    const result = kind === "remove" ? null : cleanMemory(raw.result);
    if (result && looksSecret(result)) throw new Error("Forslaget ser ut som en hemmelighet");
    const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim().slice(0, 200) : kind === "merge" ? "Slått sammen" : kind === "remove" ? "Utdatert" : "Kortet ned";
    ops.push({ kind, ids, texts: ids.map((id) => byId.get(id)!), result, reason });
  }
  return ops;
}
