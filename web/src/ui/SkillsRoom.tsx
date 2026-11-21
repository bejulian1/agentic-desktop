import { t } from "../lib/i18n";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AutoSkills, SkillDetail, SkillInfo } from "../../../shared/protocol";
import { del, get, patch, post, put } from "../lib/api";
import { filterSkills, SKILL_NAME, SKILL_TEMPLATE, skillSource } from "../lib/skill-workspace";
import { on as onSocket } from "../lib/socket";
import { app, report, settingsOpen, toast } from "../state/app";
import { closeSkills, skillsOpen } from "../state/skills-workspace";
import { InlineCopy } from "./CommandList";
import { confirmDialog } from "./dialogs";
import { IconBack, IconChevronDown, IconFile, IconFolderOpen, IconPlus, IconSearch, IconSpark, IconTrash } from "./icons";
import { Select } from "./Select";
import { Popover } from "./Popover";
import { save, SkeletonRows } from "./settings/parts";
import { pickedFromDrop, pickedFromInput, SkillImport, type Picked } from "./settings/skill-import";
import "../styles/skills-room.css";

interface Draft { id: string | null; name: string; where: string; description: string; body: string; readOnly: boolean }

export default function SkillsRoom() {
  const [data, { refetch }] = createResource(() => get<{ userDir: string; skills: SkillInfo[] }>("/api/skills"));
  const [query, setQuery] = createSignal("");
  const [source, setSource] = createSignal("all");
  const [status, setStatus] = createSignal("all");
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [original, setOriginal] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [changed, setChanged] = createSignal(false);
  const [importing, setImporting] = createSignal<{ picked: Picked[]; folder: boolean } | null>(null);
  const [importMenu, setImportMenu] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  let fileInput!: HTMLInputElement;
  let folderInput!: HTMLInputElement;
  let request = 0;
  const roomActive = () => skillsOpen() && !settingsOpen();
  createEffect(() => { if (!roomActive()) { setImportMenu(false); setDragging(false); } });
  const dirty = () => !!draft() && !draft()!.readOnly && JSON.stringify(draft()) !== original();
  const projects = () => Object.values(app.projects).filter((p) => !p.folderMissing).sort((a, b) => a.name.localeCompare(b.name, "nb"));
  const shown = createMemo(() => filterSkills(data()?.skills ?? [], query(), source(), status()));
  const selected = () => data()?.skills.find((skill) => skill.id === draft()?.id);
  const setLoaded = (value: Draft) => { setDraft(value); setOriginal(JSON.stringify(value)); setError(""); setChanged(false); };
  const fromDetail = (detail: SkillDetail): Draft => ({ id: detail.id, name: detail.name, where: detail.source === "app" ? "app" : detail.projectId ?? "user", description: detail.description, body: detail.body, readOnly: !detail.editable });
  const discard = async () => !dirty() || await confirmDialog({ title: t("Forkaste endringene?"), text: t("Skillen har endringer som ikke er lagret."), confirm: t("Forkast"), danger: true });
  const update = (value: Partial<Draft>) => setDraft({ ...draft()!, ...value });
  const open = async (skill: SkillInfo) => {
    if (busy() || loading() || draft()?.id === skill.id) return;
    if (!await discard()) return;
    const seq = ++request;
    setLoading(true);
    try { const detail = await get<SkillDetail>(`/api/skills/${encodeURIComponent(skill.id)}`); if (seq === request) setLoaded(fromDetail(detail)); }
    catch (err) { report(err); }
    finally { if (seq === request) setLoading(false); }
  };
  const startNew = async (copy = false) => {
    if (busy() || loading() || !await discard()) return;
    ++request;
    const previous = draft();
    setLoaded({ id: null, name: copy ? previous?.name ?? "" : "", where: source().startsWith("project:") ? source().slice(8) : "user", description: copy ? previous?.description ?? "" : "", body: copy ? previous?.body ?? SKILL_TEMPLATE : SKILL_TEMPLATE, readOnly: false });
  };
  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try { await work(); await refetch(); toast(message, "info"); return true; }
    catch (err) { setError(err instanceof Error ? err.message : t("Handlingen kunne ikke fullføres.")); return false; }
    finally { setBusy(false); }
  };
  const submit = async () => {
    const d = draft();
    if (!d || d.readOnly || busy()) return;
    if (!d.id && !SKILL_NAME.test(d.name)) return setError(t("Bruk små bokstaver (a–z), tall og bindestrek, maks 64 tegn. Navnet kan ikke begynne eller slutte med bindestrek."));
    if (!d.description.trim()) return setError(t("Skriv hva skillen gjør og når den skal brukes."));
    if (!d.body.trim()) return setError(t("Skillen trenger instruksjoner."));
    if (changed()) return setError(t("Filen er endret utenfor redigereren. Last inn filen på nytt før du lagrer."));
    let saved: SkillDetail | undefined;
    if (await run(async () => {
      // Catch disk edits even before the next polling notification. The existing API has no
      // atomic compare-and-swap; this check protects the latest revision we can observe.
      if (d.id) {
        let current: SkillDetail;
        try { current = await get<SkillDetail>(`/api/skills/${encodeURIComponent(d.id)}`); }
        catch (err) { setChanged(true); throw err; }
        if (JSON.stringify(fromDetail(current)) !== original()) {
          setChanged(true);
          throw new Error(t("Filen er endret utenfor redigereren. Utkastet ditt er beholdt. Last inn filen på nytt før du lagrer."));
        }
        saved = await put<SkillDetail>(`/api/skills/${encodeURIComponent(d.id)}`, { description: d.description, body: d.body });
      } else saved = await post<SkillDetail>("/api/skills", { scope: d.where === "user" ? "user" : "project", projectId: d.where === "user" ? undefined : d.where, name: d.name, description: d.description, body: d.body });
    }, t("Skillen er lagret."))) {
      setLoaded(fromDetail(saved!));
      if (!d.id) { setQuery(""); setStatus("all"); setSource(saved!.source === "project" ? `project:${saved!.projectId}` : saved!.source); }
    }
  };
  const reloadDetail = async (discarded = false) => {
    const id = draft()?.id;
    if (!id || busy() || loading() || (!discarded && !await discard())) return;
    setLoading(true);
    try { setLoaded(fromDetail(await get<SkillDetail>(`/api/skills/${encodeURIComponent(id)}`))); }
    catch (err) { report(err); }
    finally { setLoading(false); }
  };
  const remove = async () => {
    const skill = selected();
    if (!skill || !skill.editable || busy()) return;
    if (!await confirmDialog({ title: t("Fjerne skillen {name}?", { name: skill.name }), text: dirty()
      ? t("Mappen {path} slettes, med SKILL.md og alt annet i den. Det kan ikke angres. Endringene dine blir også forkastet.", { path: skill.path })
      : t("Mappen {path} slettes, med SKILL.md og alt annet i den. Det kan ikke angres.", { path: skill.path }), confirm: t("Fjern"), danger: true })) return;
    if (await run(() => del(`/api/skills/${encodeURIComponent(skill.id)}`), t("Skillen er fjernet."))) { setDraft(null); setOriginal(""); }
  };
  const startImport = async (picked: { files: Picked[]; folder: boolean }) => {
    if (!roomActive() || busy() || loading() || importing() || !await discard() || !roomActive()) return;
    if (!picked.files.length) return toast(t("Ingen filer valgt."), "info");
    setDraft(null);
    setImporting({ picked: picked.files, folder: picked.folder });
  };
  const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  onMount(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty()) event.preventDefault(); };
    addEventListener("beforeunload", unload);
    onCleanup(() => removeEventListener("beforeunload", unload));
    onCleanup(onSocket("skills.changed", () => {
      void refetch();
      const d = draft();
      if (!d?.id || busy()) return;
      const seq = request;
      void get<SkillDetail>(`/api/skills/${encodeURIComponent(d.id)}`).then((detail) => {
        if (seq !== request || draft()?.id !== d.id || busy()) return;
        const next = fromDetail(detail);
        if (JSON.stringify(next) === original()) return;
        if (dirty()) setChanged(true); else setLoaded(next);
      }).catch(() => { if (draft()?.id === d.id) setChanged(true); });
    }));
    const key = (event: KeyboardEvent) => {
      if (!roomActive() || event.defaultPrevented || event.isComposing || document.querySelector("dialog[open]") || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (dirty()) void submit();
    };
    addEventListener("keydown", key);
    onCleanup(() => removeEventListener("keydown", key));
  });

  return <section class="skills-workspace skills-drop" classList={{ dragging: dragging() }} aria-label={t("Skills-arbeidsområde")} data-testid="skills-workspace"
    onDragOver={(e) => { if (roomActive() && hasFiles(e)) { e.preventDefault(); setDragging(true); } }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
    onDrop={(e) => { if (!roomActive() || !hasFiles(e)) return; e.preventDefault(); setDragging(false); void pickedFromDrop(e).then(startImport).catch(report); }}>
    <input ref={fileInput} type="file" multiple accept=".md,text/markdown" class="sr-only" tabindex="-1" aria-hidden="true" data-testid="workspace-skill-files" onChange={(e) => { void startImport(pickedFromInput(e.currentTarget)); e.currentTarget.value = ""; }} />
    <input ref={(el) => { folderInput = el; el.setAttribute("webkitdirectory", ""); }} type="file" multiple class="sr-only" tabindex="-1" aria-hidden="true" data-testid="workspace-skill-folder" onChange={(e) => { void startImport(pickedFromInput(e.currentTarget)); e.currentTarget.value = ""; }} />
    <Show when={dragging()}><div class="skills-drop-hint"><IconFolderOpen size={18} />{t("Slipp .md-filer eller mapper for å importere skills")}</div></Show>
    <header class="skills-workspace-head">
      <div class="skills-workspace-title"><span class="skills-workspace-glyph"><IconSpark size={22} /></span><div><h1>{t("Skills")}</h1><p>{t("Fremgangsmåter agenten kan bruke igjen.")}</p></div></div>
      <div class="skills-workspace-actions">
        <Popover open={importMenu()} onClose={() => setImportMenu(false)} align="right" below trigger={<button type="button" class="btn btn-small" aria-haspopup="menu" aria-expanded={importMenu()} disabled={busy() || !!importing()} onClick={() => setImportMenu(!importMenu())}>{t("Importer")}<IconChevronDown size={12} /></button>}>
          <div class="menu-list" role="menu"><button type="button" role="menuitem" class="menu-item" onClick={() => { setImportMenu(false); fileInput.click(); }}><IconFile size={14} />{t("Velg filer…")}</button><button type="button" role="menuitem" class="menu-item" onClick={() => { setImportMenu(false); folderInput.click(); }}><IconFolderOpen size={14} />{t("Velg mappe…")}</button><div class="menu-note muted">{t("Du kan også slippe filer og mapper her.")}</div></div>
        </Popover>
        <button type="button" class="btn btn-small btn-primary" disabled={busy() || loading() || !!importing()} onClick={() => void startNew()}><IconPlus size={14} />{t("Ny skill")}</button>
        <button type="button" class="icon-button" aria-label={t("Tilbake fra Skills")} title={dirty() ? t("Tilbake · utkastet beholdes") : t("Tilbake")} onClick={closeSkills}><IconBack size={16} /></button>
      </div>
    </header>
    <div class="skills-workspace-body">
      <aside class="skills-library" aria-label={t("Skill-bibliotek")}>
        <div class="skills-library-tools"><label class="skills-workspace-search"><IconSearch size={15} /><input type="search" aria-label={t("Søk i skills")} placeholder={t("Søk i navn, beskrivelse og mappe")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
          <div class="skills-library-filters"><Select active={roomActive()} label={t("Skill-kilde")} value={source()} options={[{ value: "all", label: t("Alle kilder") }, { value: "user", label: t("Dine skills") }, { value: "app", label: t("Fra appen") }, { value: "project", label: t("Alle prosjekter") }, ...projects().map((p) => ({ value: `project:${p.id}`, label: p.name }))]} onChange={setSource} /><Select active={roomActive()} label={t("Skill-status")} value={status()} options={[{ value: "all", label: t("Alle statuser") }, { value: "on", label: t("På") }, { value: "off", label: t("Av") }]} onChange={setStatus} /></div>
          <div class="skills-library-count" role="status">{t("{shown} av {total} skills", { shown: shown().length, total: data()?.skills.length ?? 0 })}</div>
        </div>
        <div class="skills-library-scroll">
          <Show when={!data.error} fallback={<div class="skills-library-empty"><p>{t("Kunne ikke hente skills.")}</p><button type="button" class="btn btn-small" onClick={() => void refetch()}>{t("Prøv igjen")}</button></div>}>
          <Show when={data()} fallback={<SkeletonRows label={t("Henter skills…")} />}><Show when={shown().length} fallback={<div class="skills-library-empty"><IconSearch size={24} /><strong>{data()?.skills.length ? t("Ingen treff") : t("Bygg ditt eget bibliotek")}</strong><p>{data()?.skills.length ? t("Prøv et annet søk eller en annen kilde.") : t("Lag en skill eller importer en SKILL.md-fil.")}</p><Show when={query() || source() !== "all" || status() !== "all"}><button type="button" class="btn btn-small" onClick={() => { setQuery(""); setSource("all"); setStatus("all"); }}>{t("Nullstill filtre")}</button></Show></div>}>
            <ul class="skills-library-list" aria-label={t("Skills")}><For each={shown()}>{(skill) => <li><button type="button" class="skills-library-item" aria-pressed={draft()?.id === skill.id} disabled={busy() || loading() || !!importing()} onClick={() => void open(skill)}><span class="skills-library-item-top"><strong>{skill.name}</strong><span class="skills-state" classList={{ off: !skill.enabled }}><i />{skill.enabled ? t("På") : t("Av")}</span></span><span class="skills-library-description">{skill.description}</span><span class="skills-library-source">{skillSource(skill)}<Show when={skill.createdByAgent}> · {t("Laget av agenten")}</Show></span><Show when={skill.shadowed}><span class="skills-library-overridden">{t("Samme navn finnes i en annen kilde")}</span></Show></button></li>}</For></ul>
          </Show></Show></Show>
        </div>
        <footer class="skills-library-footer"><span>{t("Når agenten foreslår en skill")}</span><Select<AutoSkills> active={roomActive()} label={t("Når agenten foreslår en skill")} value={app.settings.autoSkills ?? "ask"} options={[{ value: "ask", label: t("Spør meg først") }, { value: "auto", label: t("Lagre uten å spørre") }, { value: "off", label: t("Av") }]} onChange={(v) => save({ autoSkills: v })} /></footer>
      </aside>
      <div class="skills-detail" aria-busy={loading()}>
        <Show when={importing()} keyed>{(job) => <div class="skills-import-workspace"><h2>{t("Importer skills")}</h2><p class="muted">{t("Kontroller filer, velg hvor de skal lagres og håndter navn som finnes fra før.")}</p><SkillImport active={roomActive()} picked={job.picked} folder={job.folder} onClose={(imported) => { setImporting(null); if (imported) void refetch(); }} /></div>}</Show>
        <Show when={!importing()}><Show when={draft()} fallback={<div class="skills-welcome"><span class="skills-welcome-icon"><IconSpark size={32} /></span><h2>{t("Et bibliotek med måter å jobbe på")}</h2><p>{t("Velg en skill for å lese instruksjonene, eller lag en med din egen fremgangsmåte. Agenten ser navn og beskrivelse og leser instruksjonene når den trenger dem.")}</p><div class="skills-scope-guide"><div><strong>{t("Dine skills")}</strong><span>{t("Tilgjengelige i Chat og alle kodeprosjekter.")}</span></div><div><strong>{t("Prosjektskills")}</strong><span>{t("Hører til ett kodeprosjekt og går foran skills med samme navn.")}</span></div><div><strong>{t("Fra appen")}</strong><span>{t("Innebygde fremgangsmåter. Lag en egen variant for å tilpasse dem.")}</span></div></div><button type="button" class="btn btn-small" onClick={() => void startNew()}><IconPlus size={14} />{t("Lag din første skill")}</button><p class="skills-welcome-path"><InlineCopy text={t("Dine skills lagres i {dir}")} parts={{ dir: <code>{data()?.userDir ?? t("skills-mappen din")}</code> }} /></p></div>}>
          {(d) => <form class="skills-editor" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <header class="skills-editor-head"><div><span class="skills-detail-eyebrow">{d().readOnly ? t("Skrivebeskyttet") : d().id ? t("Rediger skill") : t("Ny skill")}</span><h2>{d().id ? d().name : t("Gi agenten en fremgangsmåte")}</h2></div><Show when={!d().readOnly}><span class="skills-save-state" role="status">{busy() ? t("Lagrer…") : dirty() ? t("Ikke lagret") : d().id ? t("Lagret") : t("Utkast")}</span></Show></header>
            <Show when={selected()}>{(skill) => <div class="skills-detail-meta"><div><span class="pill">{skillSource(skill())}</span><Show when={skill().createdByAgent}><span class="pill">{t("Laget av agenten")}</span></Show></div><label class="skills-enabled-control"><span>{skill().enabled ? t("Slått på") : t("Slått av")}</span><input type="checkbox" role="switch" class="switch" aria-label={t("Slå {name} av eller på", { name: skill().name })} checked={skill().enabled} disabled={busy() || skill().source === "app"} onChange={(e) => { const enabled = e.currentTarget.checked; void run(() => patch(`/api/skills/${encodeURIComponent(skill().id)}`, { enabled }), enabled ? t("Skillen er slått på.") : t("Skillen er slått av.")); }} /></label></div>}</Show>
            <Show when={d().readOnly}><div class="skills-notice"><p>{d().where === "app" ? t("Appens original kan leses her. Lag en egen variant med samme navn for å tilpasse instruksjonene.") : t("Skillen kan leses, men mappen tillater ikke endringer her.")}</p><button type="button" class="btn btn-small" onClick={() => void startNew(true)}>{t("Lag egen variant")}</button></div></Show>
            <Show when={changed()}><div class="skills-notice" role="alert"><p>{t("Filen er endret eller fjernet utenfor redigereren. Utkastet ditt er beholdt.")}</p><button type="button" class="btn btn-small" disabled={loading()} onClick={() => void reloadDetail()}>{t("Last inn filen på nytt")}</button></div></Show>
            <div class="skills-editor-fields">
              <Show when={!d().id}><div class="field-row"><label class="field"><span>{t("Navn")}</span><input class="input" aria-label={t("Skill-navn")} value={d().name} maxLength={64} placeholder="for-eksempel-kjor-tester" spellcheck={false} disabled={busy()} onInput={(e) => update({ name: e.currentTarget.value.toLowerCase() })} /></label><div class="field"><span>{t("Hvor skal den brukes?")}</span><Select active={roomActive()} label={t("Hvor skal skillen brukes")} value={d().where} disabled={busy()} options={[{ value: "user", label: t("Dine skills · alle prosjekter") }, ...projects().map((p) => ({ value: p.id, label: t("Prosjekt: {name}", { name: p.name }) }))]} onChange={(where) => update({ where })} /></div></div></Show>
              <label class="field"><span>{t("Beskrivelse")}</span><input class="input" aria-label={t("Skill-beskrivelse")} value={d().description} maxLength={1024} readOnly={d().readOnly} disabled={busy()} placeholder={t("Hva gjør skillen, og når skal agenten bruke den?")} onInput={(e) => update({ description: e.currentTarget.value })} /><span class="skills-field-hint">{t("Hjelper agenten å velge riktig skill.")}</span></label>
              <label class="field skills-instructions"><span><InlineCopy text={t("Instruksjoner {format}")} parts={{ format: <span class="muted">Markdown</span> }} /></span><textarea class="input code-area" aria-label={t("Skill-instruksjoner")} spellcheck={false} value={d().body} readOnly={d().readOnly} disabled={busy()} onInput={(e) => update({ body: e.currentTarget.value })} /></label>
              <Show when={selected()?.path}><div class="skills-detail-path"><IconFolderOpen size={13} /><code>{selected()!.path}/SKILL.md</code></div></Show>
              <Show when={selected()?.shadowed}><p class="skills-precedence-note">{t("Det finnes skills med samme navn. Prosjektets går foran dine skills, og dine går foran appens. Skills som er slått av, hoppes over.")}</p></Show>
              <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
            </div>
            <footer class="skills-editor-footer"><Show when={selected()?.editable}><button type="button" class="btn btn-small" disabled={busy()} onClick={() => void remove()}><IconTrash size={13} />{t("Fjern")}</button></Show><div class="spacer" /><Show when={!d().readOnly}><button type="button" class="btn btn-small" disabled={busy() || !dirty()} onClick={async () => { if (await discard()) { if (d().id) await reloadDetail(true); else setDraft(null); } }}>{t("Forkast endringer")}</button><button type="submit" class="btn btn-small btn-primary" disabled={busy() || loading() || changed() || (!!d().id && !dirty())}>{d().id ? t("Lagre") : t("Lag skill")}</button></Show></footer>
          </form>}
        </Show></Show>
      </div>
    </div>
  </section>;
}
