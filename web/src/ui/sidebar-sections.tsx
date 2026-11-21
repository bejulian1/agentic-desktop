// Round 11 (SPEC 24.6): sections in the sidebar, made from ⋯ → Ny seksjon or from the thread menu.
// Kept apart from Sidebar.tsx so the thread menu can make one without importing the sidebar.
import { t } from "../lib/i18n";
import type { Mode, SidebarSection } from "../../../shared/protocol";
import { del, patch } from "../lib/api";
import { createSection, report } from "../state/app";
import { confirmDialog, promptDialog } from "./dialogs";

export async function newSection(mode: Mode): Promise<SidebarSection | null> {
  const name = await promptDialog({ title: t("Ny seksjon"), value: "", confirm: t("Lag seksjonen") });
  if (!name?.trim()) return null;
  try {
    return await createSection(name.trim(), mode);
  } catch (err) {
    report(err);
    return null;
  }
}

export async function renameSection(section: SidebarSection): Promise<void> {
  const name = await promptDialog({ title: t("Gi seksjonen nytt navn"), value: section.name, confirm: t("Lagre") });
  if (name?.trim() && name.trim() !== section.name) await patch(`/api/sections/${section.id}`, { name: name.trim() }).catch(report);
}

export async function deleteSection(section: SidebarSection): Promise<void> {
  const ok = await confirmDialog({ title: t("Slette seksjonen?"), text: t("«{name}» fjernes. Trådene i den blir liggende der de var før.", { name: section.name }), confirm: t("Slett"), danger: true });
  if (ok) await del(`/api/sections/${section.id}`).catch(report);
}
