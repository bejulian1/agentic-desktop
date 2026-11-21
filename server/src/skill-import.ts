import { sourceText, translate, type Values } from "../../shared/i18n.ts";
// Import of many skills at once (SPEC 22.5): .md files chosen one by one, a folder, or dragged in.
// The browser sends the text of each file; nothing is read from a path the client names. Each file
// is checked on its own, against the Agent Skills rules (name and description in the frontmatter,
// see docs/research/harness-runde9.md), so one bad file never stops the others. A name that is
// taken asks: replace, keep both (the new one gets -2) or skip.
import type { Project, SkillImportFile, SkillImportResult, SkillImportRow, SkillInfo } from "../../shared/protocol.ts";
import { HttpError } from "./errors.ts";
import { looksSecret } from "./memory.ts";
import { MAX_SKILL_BODY, parseFrontmatter, renderSkillFile, SKILL_NAME, type SkillStore } from "./skills.ts";

export const MAX_IMPORT_FILES = 200;
const MAX_DESCRIPTION = 1024;
const MAX_FILE_CHARS = MAX_SKILL_BODY + 8 * 1024;

export interface ImportTarget {
  scope: "user" | "project";
  project?: Project;
}

interface Parsed {
  row: SkillImportRow;
  description: string;
  body: string;
  extra: Record<string, string>;
}

// A file name to a skill name, when the frontmatter has none: "Kjør Tester.md" → "kjor-tester".
export function slugName(stem: string): string {
  return stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

function baseName(file: SkillImportFile): { stem: string; parent: string; label: string } {
  const where = (file.path || file.name).replace(/\\/g, "/");
  const parts = where.split("/").filter(Boolean);
  const name = parts.at(-1) ?? file.name;
  return { stem: name.replace(/\.md$/i, ""), parent: parts.at(-2) ?? "", label: where };
}

function checkFile(file: SkillImportFile, index: number, skillFolders: Set<string>): Parsed {
  const { stem, parent, label } = baseName(file);
  const row: SkillImportRow = { key: String(index), file: label, name: "", description: "", status: "invalid" };
  const fail = (key: string, values?: Values): Parsed => ({ row: { ...row, error: translate({}, key, values), ...(values ? { errorMessage: { key, values } } : {}) }, description: "", body: "", extra: {} });
  if (typeof file.text !== "string") return fail(sourceText("Fila kunne ikke leses som tekst."));
  if (!/\.md$/i.test(file.name)) return fail(sourceText("Ikke en .md-fil. Bare Markdown-filer kan bli skills."));
  // In a folder with a SKILL.md, the other .md files are the skill's own references.
  const dir = label.split("/").slice(0, -1).join("/");
  if (stem.toUpperCase() !== "SKILL" && [...skillFolders].some((f) => dir === f || dir.startsWith(`${f}/`))) {
    return { ...fail(sourceText("Hører til skillen i samme mappe. Bare SKILL.md importeres; andre filer må kopieres for hånd.")), row: { ...row, status: "ignored", error: "Hører til skillen i samme mappe. Bare SKILL.md importeres; andre filer må kopieres for hånd." } };
  }
  if (file.text.length > MAX_FILE_CHARS) return fail(sourceText("Fila er for stor ({size} KB, maks {max} KB)."), { size: Math.round(file.text.length / 1024), max: MAX_SKILL_BODY / 1024 });
  const text = file.text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!/^---\n[\s\S]*?\n---(?:\n|$)/.test(text)) return fail(sourceText("Mangler frontmatter. Fila må starte med --- og ha name og description, avsluttet med ---."));
  const meta = parseFrontmatter(text);
  const fromFile = stem.toUpperCase() === "SKILL" ? parent : stem;
  const name = (meta.name ?? "").trim() || slugName(fromFile);
  row.name = name;
  row.description = (meta.description ?? "").replace(/\s+/g, " ").trim();
  if (!meta.name && !name) return fail(sourceText("Mangler name i frontmatter, og filnavnet kan ikke brukes som navn."));
  if (!SKILL_NAME.test(name)) return fail(sourceText("Navnet «{name}» er ugyldig: bare små bokstaver a–z, tall og bindestrek, maks 64 tegn, ikke bindestrek først eller sist."), { name });
  if (!row.description) return fail(sourceText("Mangler description i frontmatter: hva skillen gjør og når den skal brukes."));
  if (row.description.length > MAX_DESCRIPTION) return fail(sourceText("Beskrivelsen er for lang ({count} tegn, maks {max})."), { count: row.description.length, max: MAX_DESCRIPTION });
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!body) return fail(sourceText("Skillen har ikke noe innhold under frontmatter."));
  if (body.length > MAX_SKILL_BODY) return fail(sourceText("Innholdet er for stort."));
  if (looksSecret(row.description) || looksSecret(body)) return fail(sourceText("Fila ser ut til å inneholde en nøkkel, et token eller et passord, og blir ikke importert."));
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) if (!["name", "description", "created-by"].includes(key)) extra[key] = value;
  return { row: { ...row, status: "ok", ...(meta.name ? {} : { note: sourceText("Navnet er laget av filnavnet.") }) }, description: row.description, body, extra };
}

function inTarget(skill: SkillInfo, target: ImportTarget): boolean {
  return target.scope === "user" ? skill.source === "user" : skill.projectId === target.project?.id;
}

function freeName(name: string, taken: Set<string>): string {
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${name.slice(0, 64 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function checkAll(files: unknown, target: ImportTarget, existing: SkillInfo[]): Parsed[] {
  if (!Array.isArray(files) || !files.length) throw new HttpError(400, "Velg minst én fil");
  if (files.length > MAX_IMPORT_FILES) throw new HttpError(413, `For mange filer: ${files.length}, maks ${MAX_IMPORT_FILES} om gangen`);
  const list = files.map((f) => ({ name: String(f?.name ?? ""), path: typeof f?.path === "string" ? f.path : undefined, text: f?.text })) as SkillImportFile[];
  const skillFolders = new Set(
    list.map((f) => (f.path || f.name).replace(/\\/g, "/")).filter((p) => /(^|\/)SKILL\.md$/i.test(p)).map((p) => p.split("/").slice(0, -1).join("/")).filter(Boolean),
  );
  const taken = new Map(existing.filter((s) => inTarget(s, target)).map((s) => [s.name, s]));
  const seen = new Map<string, string>();
  return list.map((file, i) => {
    const parsed = checkFile(file, i, skillFolders);
    if (parsed.row.status !== "ok") return parsed;
    const { name } = parsed.row;
    const there = taken.get(name);
    const earlier = seen.get(name);
    const names = new Set([...taken.keys(), ...seen.keys()]);
    if (there) parsed.row = { ...parsed.row, status: "conflict", conflictWith: there.projectName ? `Prosjektet ${there.projectName}` : sourceText("Dine skills"), conflictProject: there.projectName ?? undefined, conflictId: there.id, suggested: freeName(name, names) };
    else if (earlier) parsed.row = { ...parsed.row, status: "conflict", conflictWith: `En annen fil i importen (${earlier})`, conflictFile: earlier, suggested: freeName(name, names) };
    seen.set(name, parsed.row.file);
    return parsed;
  });
}

// What the list in Innstillinger shows before anything is written.
export function previewImport(files: unknown, target: ImportTarget, store: SkillStore): SkillImportRow[] {
  return checkAll(files, target, store.list()).map((p) => p.row);
}

function newId(target: ImportTarget, name: string): string {
  return target.scope === "user" ? `u:${name}` : `p:${target.project!.id}:0:${name}`;
}

// decisions: per row key, for name collisions. Left out is skip, so nothing is replaced unasked.
// enabled: per row key, false switches the new skill off right away.
export function runImport(files: unknown, target: ImportTarget, store: SkillStore, decisions: Record<string, unknown> = {}, enabled: Record<string, unknown> = {}): SkillImportResult[] {
  const parsed = checkAll(files, target, store.list());
  const results: SkillImportResult[] = [];
  for (const item of parsed) {
    const { row } = item;
    if (row.status === "invalid" || row.status === "ignored") {
      results.push({ key: row.key, file: row.file, status: row.status === "ignored" ? "skipped" : "error", message: row.error ?? sourceText("Ugyldig fil"), errorMessage: row.errorMessage });
      continue;
    }
    try {
      // Checked again now: an earlier file in this import may have taken the name.
      const current = store.list().filter((s) => inTarget(s, target));
      const names = new Set(current.map((s) => s.name));
      const there = current.find((s) => s.name === row.name);
      const decision = there || row.status === "conflict" ? decisions[row.key] : "new";
      let id: string;
      let name = row.name;
      if (there && decision === "replace") {
        id = there.id;
        store.writeImported(id, renderSkillFile({ name, description: item.description, extra: item.extra }, item.body), true);
      } else if ((there || row.status === "conflict") && decision === "both") {
        name = there || names.has(name) ? freeName(name, names) : name;
        id = newId(target, name);
        store.writeImported(id, renderSkillFile({ name, description: item.description, extra: item.extra }, item.body), false);
      } else if (there || (row.status === "conflict" && decision !== "replace")) {
        results.push({ key: row.key, file: row.file, status: "skipped", message: sourceText("Hoppet over: navnet er tatt.") });
        continue;
      } else {
        id = newId(target, name);
        store.writeImported(id, renderSkillFile({ name, description: item.description, extra: item.extra }, item.body), false);
      }
      if (enabled[row.key] === false) store.setEnabled(id, false);
      results.push({ key: row.key, file: row.file, status: there && decision === "replace" ? "replaced" : "created", name, id });
    } catch (err) {
      results.push({ key: row.key, file: row.file, status: "error", message: (err as Error).message });
    }
  }
  return results;
}
