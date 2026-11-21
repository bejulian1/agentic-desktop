// Import of many skills at once (SPEC 22.5), for Innstillinger → Skills: choose files, a folder, or
// drag them in. The files are read here and sent as text; the server checks each one and says what
// is wrong per file. A name that is taken asks: replace, keep both or skip. Nothing is written
// before «Importer».
import { lookupMessage, plural, t } from "../../lib/i18n";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { SkillImportFile, SkillImportResult, SkillImportRow } from "../../../../shared/protocol";
import { post } from "../../lib/api";
import { app, report, toast } from "../../state/app";
import { IconAlert, IconCheck, IconFile, IconFolderOpen, IconInfo } from "../icons";
import { Select } from "../Select";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 136 * 1024;
const MAX_TOTAL = 4.5 * 1024 * 1024; // under the server's limit for one request

type Decision = "replace" | "both" | "skip";

export interface Picked {
  file: File;
  path?: string; // inside a chosen or dropped folder
}

// A dropped folder, read through the entries API, every level down.
async function readEntry(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (out.length > MAX_FILES * 2) return;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\//, "") });
    return;
  }
  if (!entry.isDirectory || entry.name.startsWith(".") || entry.name === "node_modules") return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const child of batch) await readEntry(child, out);
  }
}

export async function pickedFromDrop(event: DragEvent): Promise<{ files: Picked[]; folder: boolean }> {
  const items = [...(event.dataTransfer?.items ?? [])];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return { files: [...(event.dataTransfer?.files ?? [])].map((file) => ({ file })), folder: false };
  const out: Picked[] = [];
  for (const entry of entries) await readEntry(entry, out);
  return { files: out, folder: entries.some((e) => e.isDirectory) };
}

export function pickedFromInput(input: HTMLInputElement): { files: Picked[]; folder: boolean } {
  const files = [...(input.files ?? [])];
  const folder = files.some((f) => f.webkitRelativePath);
  return { files: files.map((file) => ({ file, path: file.webkitRelativePath || undefined })), folder };
}

interface Local {
  sent: SkillImportFile[];
  local: SkillImportRow[]; // checked here: too big, or not read
}

async function readAll(picked: Picked[], folder: boolean): Promise<Local> {
  // From a folder, only .md files: a skill folder may hold scripts and pictures too.
  const chosen = (folder ? picked.filter((p) => /\.md$/i.test(p.file.name)) : picked).slice(0, MAX_FILES);
  const sent: SkillImportFile[] = [];
  const local: SkillImportRow[] = [];
  let total = 0;
  for (const { file, path } of chosen) {
    const label = path || file.name;
    if (file.size > MAX_FILE_BYTES) {
      local.push({ key: `local-${local.length}`, file: label, name: "", description: "", status: "invalid", error: t("Fila er for stor ({size} KB, maks {max} KB).", { size: Math.round(file.size / 1024), max: MAX_FILE_BYTES / 1024 }) });
      continue;
    }
    total += file.size;
    if (total > MAX_TOTAL) {
      local.push({ key: `local-${local.length}`, file: label, name: "", description: "", status: "invalid", error: t("For mye på én gang. Importer resten i en ny runde.") });
      continue;
    }
    try {
      sent.push({ name: file.name, ...(path ? { path } : {}), text: /\.md$/i.test(file.name) ? await file.text() : "" });
    } catch {
      local.push({ key: `local-${local.length}`, file: label, name: "", description: "", status: "invalid", error: t("Fila kunne ikke leses.") });
    }
  }
  return { sent, local };
}

const STATUS: Record<SkillImportRow["status"], string> = {
  get ok() { return t("Klar"); },
  get conflict() { return t("Navnet er tatt"); },
  get invalid() { return t("Ugyldig"); },
  get ignored() { return t("Hoppes over"); },
};

export function SkillImport(props: { picked: Picked[]; folder: boolean; onClose: (imported: boolean) => void; active?: boolean }) {
  const [target, setTarget] = createSignal("user");
  const [files, setFiles] = createSignal<SkillImportFile[]>([]);
  const [rows, setRows] = createSignal<SkillImportRow[] | null>(null);
  const [decisions, setDecisions] = createSignal<Record<string, Decision>>({});
  const [enabled, setEnabled] = createSignal<Record<string, boolean>>({});
  const [busy, setBusy] = createSignal(false);
  const projects = () => Object.values(app.projects).filter((p) => !p.folderMissing).sort((a, b) => a.name.localeCompare(b.name, "nb"));
  const body = () => (target() === "user" ? { scope: "user" } : { scope: "project", projectId: target() });

  let local: SkillImportRow[] = [];
  const check = async () => {
    setBusy(true);
    try {
      const { rows: checked } = await post<{ rows: SkillImportRow[] }>("/api/skills/import/preview", { files: files(), ...body() });
      setRows([...checked, ...local]);
      // A taken name is skipped until you choose; the others start switched on.
      const next: Record<string, Decision> = {};
      for (const row of checked) if (row.status === "conflict") next[row.key] = decisions()[row.key] ?? "skip";
      setDecisions(next);
    } catch (err) {
      report(err);
      props.onClose(false);
    } finally {
      setBusy(false);
    }
  };

  void (async () => {
    const read = await readAll(props.picked, props.folder);
    local = read.local;
    setFiles(read.sent);
    if (!read.sent.length) {
      setRows(read.local);
      return;
    }
    await check();
  })();

  const counts = createMemo(() => {
    const list = rows() ?? [];
    return {
      ok: list.filter((r) => r.status === "ok").length,
      conflict: list.filter((r) => r.status === "conflict").length,
      bad: list.filter((r) => r.status === "invalid").length,
      ignored: list.filter((r) => r.status === "ignored").length,
    };
  });
  const willImport = () => (rows() ?? []).filter((r) => r.status === "ok" || (r.status === "conflict" && decisions()[r.key] !== "skip")).length;

  const run = async () => {
    setBusy(true);
    try {
      const { results } = await post<{ results: SkillImportResult[] }>("/api/skills/import", { files: files(), ...body(), decisions: decisions(), enabled: enabled() });
      const made = results.filter((r) => r.status === "created" || r.status === "replaced").length;
      const failed = results.filter((r) => r.status === "error" && rows()?.find((row) => row.key === r.key)?.status !== "invalid");
      const imported = plural(made, "Én skill er importert.", "{count} skills er importert.");
      if (failed.length) {
        const failures = failed.map((f) => `${f.file} (${lookupMessage(f.errorMessage?.key ?? f.message, f.errorMessage?.values)})`).join(", ");
        toast(t("{imported} {count} feilet: {failures}", { imported, count: failed.length, failures }), "error");
      } else toast(imported, "info");
      props.onClose(made > 0);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="skill-import" data-testid="skill-import">
      <div class="setting skill-import-head">
        <div class="setting-text">
          <strong>{t("Importer skills")}</strong>
          <span class="muted">
            <Show when={rows()} fallback={t("Leser filene…")}>
              {[
                t("{count} klare", { count: counts().ok }),
                counts().conflict ? t("{count} med navn som er tatt", { count: counts().conflict }) : "",
                counts().bad ? t("{count} ugyldige", { count: counts().bad }) : "",
                counts().ignored ? t("{count} hoppes over", { count: counts().ignored }) : "",
              ].filter(Boolean).join(" · ")}
            </Show>
          </span>
        </div>
        <div class="setting-control">
          <Select<string>
            active={props.active}
            label={t("Importer til")}
            value={target()}
            options={[{ value: "user", label: t("Dine skills") }, ...projects().map((p) => ({ value: p.id, label: t("Prosjektet {name}", { name: p.name }) }))]}
            onChange={(value) => {
              setTarget(value);
              void check();
            }}
          />
        </div>
      </div>
      <Show when={rows()?.length}>
        <ul class="import-list" aria-label={t("Filer som importeres")}>
          <For each={rows()!}>
            {(row) => (
              <li class={`setting import-row import-${row.status}`} data-file={row.file}>
                <span class="import-icon" aria-hidden="true">
                  {row.status === "ok" ? <IconCheck size={14} /> : row.status === "conflict" ? <IconInfo size={14} /> : row.status === "ignored" ? <IconFile size={14} /> : <IconAlert size={14} />}
                </span>
                <div class="setting-text">
                  <strong class="skill-head">
                    <span class="skill-name">{row.name || row.file.split("/").pop()}</span>
                    <span class={`pill import-pill import-pill-${row.status}`}>{STATUS[row.status]}</span>
                  </strong>
                  <Show when={row.description}><span class="muted">{row.description}</span></Show>
                  <Show when={row.error}><span class={row.status === "invalid" ? "import-error" : "muted"}>{lookupMessage(row.errorMessage?.key ?? row.error, row.errorMessage?.values)}</span></Show>
                  <Show when={row.status === "conflict"}><span class="muted">{t("Finnes i {path}.", { path: row.conflictProject ? t("Prosjektet {name}", { name: row.conflictProject }) : row.conflictFile ? t("En annen fil i importen ({file})", { file: row.conflictFile }) : lookupMessage(row.conflictWith) })}</span></Show>
                  <Show when={row.note}><span class="muted">{lookupMessage(row.note)}</span></Show>
                  <span class="muted skill-path" title={row.file}><IconFolderOpen size={11} /> {row.file}</span>
                </div>
                <Show when={row.status === "ok" || row.status === "conflict"}>
                  <div class="setting-control">
                    <Show when={row.status === "conflict"}>
                      <Select<Decision>
                        active={props.active}
                        label={t("Hva skal skje med {name}", { name: row.name })}
                        value={decisions()[row.key] ?? "skip"}
                        options={[
                          { value: "replace", label: row.conflictId ? t("Erstatt") : t("Erstatt den første") },
                          { value: "both", label: t("Behold begge ({suggested})", { suggested: String(row.suggested) }) },
                          { value: "skip", label: t("Hopp over") },
                        ]}
                        onChange={(value) => setDecisions({ ...decisions(), [row.key]: value })}
                      />
                    </Show>
                    <input
                      type="checkbox"
                      role="switch"
                      class="switch"
                      aria-label={t("Slå på {name} etter import", { name: row.name })}
                      title={t("På etter import")}
                      checked={enabled()[row.key] !== false && !(row.status === "conflict" && (decisions()[row.key] ?? "skip") === "skip")}
                      disabled={row.status === "conflict" && decisions()[row.key] === "skip"}
                      onChange={(e) => setEnabled({ ...enabled(), [row.key]: e.currentTarget.checked })}
                    />
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="form-actions skill-import-actions">
        <button type="button" class="btn btn-small" onClick={() => props.onClose(false)}>{t("Avbryt")}</button>
        <button type="button" class="btn btn-small btn-primary" disabled={busy() || !willImport()} onClick={() => void run()}>
          {plural(willImport(), "Importer {count} skill", "Importer {count} skills")}
        </button>
      </div>
    </div>
  );
}
