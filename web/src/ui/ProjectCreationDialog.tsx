import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { createProject, setMode, setProjectId } from "../state/app";
import { gridFor } from "../state/grid";
import { IconClose, IconFolder } from "./icons";
import { IconFolderPlus } from "./nav-icons";
import "../styles/project-creation.css";

interface Props {
  pickFolder: (start?: string, title?: string, signal?: AbortSignal) => Promise<string | null>;
  onClose: () => void;
}

const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

export function ProjectCreationDialog(props: Props) {
  let dialog!: HTMLDialogElement;
  let nameInput!: HTMLInputElement;
  const [name, setName] = createSignal("");
  const [folder, setFolder] = createSignal("");
  const [picking, setPicking] = createSignal(false);
  const [trust, setTrust] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal("");
  const controller = new AbortController();
  let alive = true;
  let suggestedName = "";

  onMount(() => {
    dialog.showModal();
    nameInput.focus();
  });
  onCleanup(() => {
    alive = false;
    controller.abort();
    if (dialog.open) dialog.close();
  });

  const selectFolder = async () => {
    if (picking() || creating()) return;
    setPicking(true);
    setError("");
    try {
      const path = await props.pickFolder(folder() || undefined, "Velg prosjektmappe", controller.signal);
      if (!alive || path === null) return;
      if (!name().trim() || name() === suggestedName) setName(folderName(path));
      suggestedName = folderName(path);
      setFolder(path);
    } catch (err) {
      if (alive) setError(err instanceof Error ? err.message : "Kunne ikke velge mappe.");
    } finally {
      if (alive) setPicking(false);
    }
  };

  const submit = async () => {
    if (creating() || !trust() || !folder() || !name().trim()) return;
    setCreating(true);
    setError("");
    try {
      const project = await createProject(folder(), name().trim());
      if (!alive) return;
      setProjectId(project.id);
      setMode("code");
      gridFor(project.id);
      props.onClose();
    } catch (err) {
      if (alive) setError(err instanceof Error ? err.message : "Kunne ikke opprette prosjektet.");
    } finally {
      if (alive) setCreating(false);
    }
  };

  return (
    <>
      <dialog ref={dialog} class="dialog project-create" aria-label="Opprett prosjekt" onCancel={(event) => { event.preventDefault(); props.onClose(); }}>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (folder() && name().trim() && !picking() && !creating()) { setError(""); setTrust(true); }
        }}>
          <div class="dialog-head project-create-head">
            <h2>Opprett prosjekt</h2>
            <button type="button" class="icon-button" aria-label="Lukk" onClick={props.onClose}><IconClose size={15} /></button>
          </div>
          <label class="project-name-field">
            <span class="project-name-icon"><IconFolder size={17} /></span>
            <input ref={nameInput} aria-label="Prosjektnavn" placeholder="Prosjektnavn" value={name()} required autocomplete="off" onInput={(event) => setName(event.currentTarget.value)} />
          </label>
          <section class="project-source" aria-labelledby="project-source-label">
            <h3 id="project-source-label">Kildemappe</h3>
            <Show when={folder()} fallback={
              <div class="project-source-empty">
                <p>Legg til en mappe på denne datamaskinen</p>
                <button type="button" class="btn btn-small project-add-folder" disabled={picking()} onClick={selectFolder}><IconFolderPlus size={16} />{picking() ? "Åpner mappevelger…" : "Legg til"}</button>
              </div>
            }>
              <div class="project-source-selected">
                <IconFolder size={19} />
                <div class="project-folder-details"><strong>{folderName(folder())}</strong><span>{folder()}</span></div>
                <button type="button" class="icon-button" aria-label="Fjern mappe" disabled={picking()} onClick={() => { setFolder(""); setError(""); }}><IconClose size={14} /></button>
                <button type="button" class="btn btn-small project-change-folder" disabled={picking()} onClick={selectFolder}>{picking() ? "Åpner mappevelger…" : "Endre mappe"}</button>
              </div>
            </Show>
          </section>
          <Show when={error() && !trust()}><p class="form-error" role="alert">{error()}</p></Show>
          <div class="dialog-actions project-create-actions">
            <button type="button" class="btn project-cancel" onClick={props.onClose}>Avbryt</button>
            <button type="submit" class="btn btn-primary" disabled={!folder() || !name().trim() || picking() || creating()}>Opprett prosjekt</button>
          </div>
        </form>
      </dialog>
      <Show when={trust()}>
        <FolderTrustDialog path={folder()} busy={creating()} error={error()} onCancel={() => { if (!creating()) { setTrust(false); setError(""); } }} onConfirm={submit} />
      </Show>
    </>
  );
}

function FolderTrustDialog(props: { path: string; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  let dialog!: HTMLDialogElement;
  let cancelButton!: HTMLButtonElement;
  onMount(() => { dialog.showModal(); cancelButton.focus(); });
  onCleanup(() => { if (dialog.open) dialog.close(); });
  return (
    <dialog ref={dialog} class="dialog project-trust" aria-labelledby="project-trust-title" aria-describedby="project-trust-description" aria-busy={props.busy} onCancel={(event) => { event.preventDefault(); props.onCancel(); }}>
      <button type="button" class="icon-button project-trust-close" aria-label="Lukk" disabled={props.busy} onClick={props.onCancel}><IconClose size={15} /></button>
      <h2 id="project-trust-title">Stoler du på denne mappen?</h2>
      <p class="project-trust-path">{props.path}</p>
      <p id="project-trust-description">Agentic Desktop kan la modeller lese og redigere filer og kjøre kommandoer her, innenfor tillatelsene dine. Instruksjoner i <code>AGENTS.md</code> og innstillinger i <code>.agentic</code> kan påvirke oppførselen. Fortsett bare hvis du stoler på innholdet.</p>
      <p class="project-trust-permissions">Dette endrer ikke tillatelsene dine.</p>
      <Show when={props.error}><p class="form-error" role="alert">{props.error}</p></Show>
      <div class="project-trust-actions">
        <button type="button" class="btn btn-primary" disabled={props.busy} onClick={props.onConfirm}>{props.busy ? "Oppretter prosjekt…" : "Stol på mappen"}</button>
        <button ref={cancelButton} type="button" class="btn" disabled={props.busy} onClick={props.onCancel}>Avbryt</button>
      </div>
    </dialog>
  );
}
