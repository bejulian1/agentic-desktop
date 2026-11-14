import type { ChatProject } from "../../../shared/protocol";
import { collapsed, report, setApp, toggleCollapsed } from "../state/app";
import { del } from "../lib/api";
import { confirmDialog } from "./dialogs";
import { requestChatProjectDialog } from "./dialog-state";
import { openChatProject } from "../state/navigate";

export async function newChatProject(): Promise<ChatProject | null> {
  const project = await requestChatProjectDialog();
  if (project) {
    if (collapsed().includes(`chat:${project.id}`)) toggleCollapsed(`chat:${project.id}`);
    openChatProject(project.id);
  }
  return project;
}

export const editChatProject = (project: ChatProject): Promise<ChatProject | null> => requestChatProjectDialog(project);

// Existing callers also get instructions, icon, colours and memory settings in the full editor.
export async function renameChatProject(project: ChatProject): Promise<void> {
  await editChatProject(project);
}

export async function removeChatProject(project: ChatProject): Promise<boolean> {
  const ok = await confirmDialog({
    title: "Fjerne Chat-prosjektet?",
    text: `«${project.name}» og prosjektets egne instruksjoner og minner slettes. Chattene beholdes under Chatter. Globale Chat-minner blir stående. Dette kan ikke angres.`,
    confirm: "Fjern prosjektet",
    danger: true,
  });
  if (!ok) return false;
  try {
    await del(`/api/chat-projects/${encodeURIComponent(project.id)}`);
    setApp("chatProjects", project.id, undefined!);
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}
