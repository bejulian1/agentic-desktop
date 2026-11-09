// Round 14 (SPEC 30.5): the project's folder is moved, renamed or deleted. The message field gives
// its place to a calm bar of the same height and shape, with one short text and two ways on:
// connect the project to the folder again (it goes on with the same threads, and the field comes
// back at once), or archive its chats (with Angre in the toast). Nothing runs until then; the
// server refuses too (SPEC 26.1).
import { createSignal } from "solid-js";
import type { Project } from "../../../shared/protocol";
import { app, relinkProject, report, toast } from "../state/app";
import { archiveMany } from "../state/archive";
import { pickFolder } from "./dialogs";
import { IconArchive, IconFolderOpen, IconWarn } from "./icons";

function parentOf(path: string): string | undefined {
  const at = path.lastIndexOf("/");
  return at > 0 ? path.slice(0, at) : undefined;
}

// ~ for the home folder, and the middle left out of a long path, so the text stays short; the full
// path is in the tip. The same rule as the project picker (shortPath in Composer.tsx).
function homeShort(path: string, max = 40): string {
  const home = path.replace(/^\/home\/[^/]+(?=\/|$)/, "~").replace(/^\/root(?=\/|$)/, "~");
  if (home.length <= max) return home;
  const parts = home.split("/");
  const head = parts[0] === "" ? `/${parts[1]}` : parts[0];
  let tail = parts.at(-1)!;
  for (let i = parts.length - 2; i > 1; i--) {
    if (`${head}/…/${parts[i]}/${tail}`.length > max) break;
    tail = `${parts[i]}/${tail}`;
  }
  return `${head}/…/${tail}`;
}

export function FolderMissingBar(props: { project: Project; onRelinked?: () => void }) {
  const [busy, setBusy] = createSignal(false);
  const live = () => Object.values(app.threads).filter((t) => t && t.projectId === props.project.id && !t.archived && !t.temporary).length;
  const relink = async () => {
    if (busy()) return;
    const folder = await pickFolder(parentOf(props.project.path), `Velg mappen for «${props.project.name}»`);
    if (!folder) return;
    setBusy(true);
    try {
      await relinkProject(props.project.id, folder);
      toast(`«${props.project.name}» bruker nå ${homeShort(folder, 60)}.`, "info");
      props.onRelinked?.();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await archiveMany({ projectId: props.project.id }, `«${props.project.name}»`, { one: "chat", many: "chatter" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="composer folder-bar" role="group" aria-label="Prosjektmappen mangler" data-testid="folder-missing">
      <p class="folder-bar-text">
        <span class="folder-bar-icon" aria-hidden="true"><IconWarn size={15} /></span>
        <span>
          Fant ikke mappen <bdo dir="ltr" class="folder-bar-path" title={props.project.path}>{homeShort(props.project.path)}</bdo>. Den er flyttet, har fått nytt navn eller er slettet.
        </span>
      </p>
      <div class="folder-bar-foot">
        <button
          type="button"
          class="btn btn-small folder-bar-archive"
          disabled={busy() || !live()}
          title={live() ? "Chattene forsvinner fra sidefanen, men ingenting slettes. Angre i meldingen som kommer." : "Chattene i prosjektet er allerede arkivert"}
          onClick={() => void archive()}
        >
          <IconArchive size={14} />Arkiver chattene
        </button>
        <button type="button" class="btn btn-small btn-primary" disabled={busy()} title={`Koble «${props.project.name}» til mappen der den er nå`} onClick={() => void relink()}>
          <IconFolderOpen size={14} />Velg prosjektmappe
        </button>
      </div>
    </div>
  );
}
