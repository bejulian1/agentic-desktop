// Innstillinger → Skills: every skill from the user's folder and from the projects, with name,
// description, source and path. New skills, edits, on and off, and removal. Also what happens when
// the agent proposes a skill of its own (autoSkills). Paths never leave the server: a skill is
// named by its id, and the server finds the folder.
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AutoSkills, SkillDetail, SkillInfo } from "../../../../shared/protocol";
import { del, get, patch, post, put } from "../../lib/api";
import { on as onSocket } from "../../lib/socket";
import { app, report, toast } from "../../state/app";
import { confirmDialog } from "../dialogs";
import { IconChevronDown, IconEye, IconFile, IconFolderOpen, IconPencil, IconPlus, IconSearch, IconTrash } from "../icons";
import { Choice, Group, Page, Row, save, SkeletonRows } from "./parts";
import { Select } from "../Select";
import { Popover } from "../Popover";
import { pickedFromDrop, pickedFromInput, SkillImport, type Picked } from "./skill-import";
import { SKILL_NAME as NAME, SKILL_TEMPLATE as TEMPLATE } from "../../lib/skill-workspace";

interface Draft {
  id: string | null; // null for a new skill
  name: string;
  where: string; // "user" or a project id, new skills only
  description: string;
  body: string;
  readOnly?: boolean;
}

export function Skills() {
  const [data, { refetch }] = createResource(() => get<{ userDir: string; skills: SkillInfo[] }>("/api/skills"));
  onMount(() => onCleanup(onSocket("skills.changed", () => void refetch())));
  const [query, setQuery] = createSignal("");
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const shown = createMemo(() => {
    const words = query().toLocaleLowerCase("nb").split(/\s+/).filter(Boolean);
    return (data()?.skills ?? []).filter((s) => {
      const hay = `${s.name} ${s.description} ${s.source === "app" ? "appen" : s.projectName ?? "dine"} ${s.path}`.toLocaleLowerCase("nb");
      return words.every((w) => hay.includes(w));
    });
  });
  const projects = () => Object.values(app.projects).sort((a, b) => a.name.localeCompare(b.name, "nb"));

  const run = async (work: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await work();
      await refetch();
      if (done) toast(done, "info");
      return true;
    } catch (err) {
      report(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    setError("");
    setDraft({ id: null, name: "", where: "user", description: "", body: TEMPLATE });
  };

  const startEdit = async (skill: SkillInfo) => {
    setError("");
    try {
      const detail = await get<SkillDetail>(`/api/skills/${encodeURIComponent(skill.id)}`);
      setDraft({ id: skill.id, name: detail.name, where: skill.source === "app" ? "app" : skill.projectId ?? "user", description: detail.description, body: detail.body, readOnly: !skill.editable });
    } catch (err) {
      report(err);
    }
  };

  const submit = async () => {
    const d = draft();
    if (!d || d.readOnly) return;
    if (!d.id && !NAME.test(d.name)) return setError("Navnet kan bare ha små bokstaver (a–z), tall og bindestrek, og kan ikke begynne eller slutte med bindestrek.");
    if (!d.description.trim()) return setError("Skriv en beskrivelse av hva skillen gjør og når den skal brukes.");
    if (!d.body.trim()) return setError("Skillen trenger innhold.");
    setError("");
    const ok = await run(
      () => d.id
        ? put(`/api/skills/${encodeURIComponent(d.id)}`, { description: d.description, body: d.body })
        : post("/api/skills", { scope: d.where === "user" ? "user" : "project", projectId: d.where === "user" ? undefined : d.where, name: d.name, description: d.description, body: d.body }),
      d.id ? "Skillen er lagret." : `Skillen ${d.name} er laget.`,
    );
    if (ok) setDraft(null);
  };

  const toggle = (skill: SkillInfo, enabled: boolean) =>
    run(() => patch(`/api/skills/${encodeURIComponent(skill.id)}`, { enabled }), enabled ? `${skill.name} er slått på.` : `${skill.name} er slått av. Agenten ser den ikke lenger.`);

  const remove = async (skill: SkillInfo) => {
    const ok = await confirmDialog({
      title: `Fjerne skillen ${skill.name}?`,
      text: `Mappen ${skill.path} slettes, med SKILL.md og alt annet i den. Det kan ikke angres.`,
      confirm: "Fjern",
      danger: true,
    });
    if (ok) await run(() => del(`/api/skills/${encodeURIComponent(skill.id)}`), `${skill.name} er fjernet.`);
  };

  const update = (patchValue: Partial<Draft>) => setDraft({ ...draft()!, ...patchValue });

  // Round 9b (SPEC 22.5): many at once, from files, a folder, or dropped on the page.
  const [importing, setImporting] = createSignal<{ picked: Picked[]; folder: boolean; id: number } | null>(null);
  const [importMenu, setImportMenu] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  let fileInput!: HTMLInputElement;
  let folderInput!: HTMLInputElement;
  const startImport = (picked: { files: Picked[]; folder: boolean }) => {
    if (!picked.files.length) return toast(picked.folder ? "Fant ingen .md-filer i mappen." : "Ingen filer valgt.", "info");
    setImporting({ picked: picked.files, folder: picked.folder, id: Date.now() });
  };
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const onDrop = async (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    try {
      const picked = await pickedFromDrop(e);
      startImport(picked);
    } catch (err) {
      report(err);
    }
  };

  return (
    <div
      class="skills-drop"
      classList={{ dragging: dragging() }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
    <input ref={fileInput} type="file" multiple accept=".md,text/markdown" class="sr-only" tabindex="-1" aria-hidden="true" data-testid="skill-files" onChange={(e) => { startImport(pickedFromInput(e.currentTarget)); e.currentTarget.value = ""; }} />
    <input ref={(el) => { folderInput = el; el.setAttribute("webkitdirectory", ""); }} type="file" multiple class="sr-only" tabindex="-1" aria-hidden="true" data-testid="skill-folder" onChange={(e) => { startImport(pickedFromInput(e.currentTarget)); e.currentTarget.value = ""; }} />
    <Show when={dragging()}><div class="skills-drop-hint" aria-hidden="true"><IconFolderOpen size={18} />Slipp .md-filer eller mapper for å importere dem som skills</div></Show>
    <Page title="Skills" intro={<>En skill er en mappe med en <code>SKILL.md</code>: navn, beskrivelse og instruksjoner. Agenten ser navnet og beskrivelsen, og leser resten når den trenger det.</>}>
      <Group title="Skills fra agenten">
        <Row label="Når agenten foreslår en skill" text="Etter en oppgave den kan få bruk for igjen, kan agenten lagre fremgangsmåten som en skill. Skills fra agenten merkes «Laget av agenten».">
          <Choice<AutoSkills>
            label="Når agenten foreslår en skill"
            value={app.settings.autoSkills ?? "ask"}
            options={[{ value: "ask", label: "Spør meg først" }, { value: "auto", label: "Lagre uten å spørre" }, { value: "off", label: "Av" }]}
            onChange={(v) => save({ autoSkills: v })}
          />
        </Row>
      </Group>

      <Show when={draft()}>
        {(d) => (
          <Group title={d().readOnly ? `Vis ${d().name}` : d().id ? `Endre ${d().name}` : "Ny skill"}>
            <form class="setting setting-block skill-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <div class="field-row">
                <label class="field"><span>Navn</span>
                  <input class="input" value={d().name} disabled={!!d().id} placeholder="for-eksempel-kjor-tester" maxLength={64} spellcheck={false} onInput={(e) => update({ name: e.currentTarget.value.toLowerCase() })} />
                </label>
                <div class="field"><span>Hvor</span>
                  <Select<string>
                    label="Hvor"
                    class="field-select"
                    value={d().where}
                    disabled={!!d().id}
                    options={[...(d().where === "app" ? [{ value: "app", label: "Fra appen" }] : []), { value: "user", label: "Dine skills (alle prosjekter)" }, ...projects().map((p) => ({ value: p.id, label: `Prosjektet ${p.name}` }))]}
                    onChange={(where) => update({ where })}
                  />
                </div>
              </div>
              <label class="field"><span>Beskrivelse: hva den gjør og når den skal brukes</span>
                <input class="input" value={d().description} readOnly={d().readOnly} maxLength={1024} placeholder="Kjører e2e-testene og leser feilene. Bruk når en endring berører flere deler av appen." onInput={(e) => update({ description: e.currentTarget.value })} />
              </label>
              <label class="field"><span>Innhold (Markdown)</span>
                <textarea class="input code-area" rows={12} spellcheck={false} value={d().body} readOnly={d().readOnly} onInput={(e) => update({ body: e.currentTarget.value })} />
              </label>
              <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
              <div class="form-actions">
                <button type="button" class="btn btn-small" onClick={() => setDraft(null)}>{d().readOnly ? "Lukk" : "Avbryt"}</button>
                <Show when={!d().readOnly}><button type="submit" class="btn btn-small btn-primary" disabled={busy()}>{d().id ? "Lagre" : "Lag skill"}</button></Show>
              </div>
            </form>
          </Group>
        )}
      </Show>

      <Group
        title="Alle skills"
        action={
          <div class="memory-actions">
            <Popover
              open={importMenu()}
              onClose={() => setImportMenu(false)}
              align="right"
              below
              trigger={<button type="button" class="btn btn-small" aria-haspopup="menu" aria-expanded={importMenu()} disabled={!!importing()} onClick={() => setImportMenu(!importMenu())}>Importer<IconChevronDown size={12} /></button>}
            >
              <div class="menu-list" role="menu">
                <button type="button" role="menuitem" class="menu-item" onClick={() => { setImportMenu(false); fileInput.click(); }}><IconFile size={14} /><span class="menu-name">Velg filer…</span></button>
                <button type="button" role="menuitem" class="menu-item" onClick={() => { setImportMenu(false); folderInput.click(); }}><IconFolderOpen size={14} /><span class="menu-name">Velg mappe…</span></button>
                <div class="menu-note muted">Eller dra .md-filer og mapper inn på siden.</div>
              </div>
            </Popover>
            <button type="button" class="btn btn-small" disabled={!!draft()} onClick={startNew}><IconPlus size={13} />Ny skill</button>
          </div>
        }
      >
        <Show when={importing()} keyed>
          {(job) => <SkillImport picked={job.picked} folder={job.folder} onClose={(imported) => { setImporting(null); if (imported) void refetch(); }} />}
        </Show>
        <div class="setting memory-tools">
          <div class="memory-search">
            <IconSearch size={14} />
            <input type="search" class="memory-search-input" placeholder="Søk i skills" aria-label="Søk i skills" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
        </div>
        <Show when={data()} fallback={<SkeletonRows label="Henter skills…" />}>
          <Show
            when={shown().length}
            fallback={
              <div class="setting memory-empty">
                <span class="muted">
                  {data()!.skills.length
                    ? `Ingen skills passer til «${query().trim()}».`
                    : <>Ingen skills ennå. Lag en her, eller legg mapper i <code>{data()!.userDir}</code> eller i <code>.agentic/skills/</code> i et prosjekt.</>}
                </span>
              </div>
            }
          >
            <ul class="skill-list" aria-label="Skills">
              <For each={shown()}>
                {(skill) => (
                  <li class="setting skill-row" classList={{ off: !skill.enabled }}>
                    <div class="setting-text">
                      <strong class="skill-head">
                        <span class="skill-name">{skill.name}</span>
                        <span class="pill">{skill.source === "app" ? "Fra appen" : skill.projectName ? `Prosjekt: ${skill.projectName}` : "Dine"}</span>
                        <Show when={skill.createdByAgent}><span class="pill pill-accent">Laget av agenten</span></Show>
                        <Show when={!skill.enabled}><span class="pill">Av</span></Show>
                        <Show when={skill.shadowed}><span class="pill" title="Et prosjekt har en skill med samme navn, og den går foran i det prosjektet">Overstyres i et prosjekt</span></Show>
                      </strong>
                      <span class="muted">{skill.description || "Ingen beskrivelse"}</span>
                      <span class="muted skill-path" title={skill.path}>{skill.path}</span>
                    </div>
                    <div class="setting-control">
                      <input type="checkbox" role="switch" class="switch" aria-label={`Slå ${skill.name} av eller på`} checked={skill.enabled} disabled={busy() || skill.source === "app"} title={skill.source === "app" ? "Appens skill er skrivebeskyttet. Lag en egen skill med samme navn for å overstyre den." : undefined} onChange={(e) => void toggle(skill, e.currentTarget.checked)} />
                      <Show when={skill.source === "app"}><button type="button" class="icon-button" aria-label={`Vis ${skill.name}`} title="Vis appens skill" disabled={busy()} onClick={() => void startEdit(skill)}><IconEye size={14} /></button></Show>
                      <button type="button" class="icon-button" aria-label={`Endre ${skill.name}`} title={skill.editable ? "Endre" : "Ligger utenfor skills-mappen og kan ikke endres her"} disabled={!skill.editable || busy()} onClick={() => void startEdit(skill)}><IconPencil size={14} /></button>
                      <button type="button" class="icon-button" aria-label={`Fjern ${skill.name}`} title={skill.editable ? "Fjern" : "Ligger utenfor skills-mappen og kan ikke fjernes her"} disabled={!skill.editable || busy()} onClick={() => void remove(skill)}><IconTrash size={14} /></button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Group>
      <p class="muted small memory-files">
        Dine skills ligger i <code>{data()?.userDir ?? "~/.config/agentic-desktop/skills"}</code>. Prosjektets ligger i <code>.agentic/skills/</code>, <code>.claude/skills/</code> eller <code>.agents/skills/</code>, og nye fra denne siden havner i <code>.agentic/skills/</code>. Når to har samme navn, går prosjektets foran.
      </p>
    </Page>
    </div>
  );
}
