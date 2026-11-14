// Which of the larger dialogs is open. The state is here, apart from the dialogs themselves, so the
// dialogs (EditProject, ChromeImport, CookieImport and the command palette) load the first time one
// of them opens instead of at start (SPEC 29.5). dialogs.tsx mounts each one only while it is open.
import { createSignal } from "solid-js";
import type { ChatProject } from "../../../shared/protocol";

export interface ChatProjectDialogRequest {
  project: ChatProject | null;
  resolve: (project: ChatProject | null) => void;
}
const [chatProjectDialog, setChatProjectDialog] = createSignal<ChatProjectDialogRequest | null>(null);
export { chatProjectDialog, setChatProjectDialog };
export function requestChatProjectDialog(project: ChatProject | null = null): Promise<ChatProject | null> {
  return new Promise(resolve => {
    chatProjectDialog()?.resolve(null);
    setChatProjectDialog({ project, resolve });
  });
}

// Rediger prosjekt, and the tab it opens on. Prosjektinnstillinger is the Agent tab.
export type ProjectTab = "general" | "agent" | "sources";
const [editing, setEditing] = createSignal<{ id: string; tab: ProjectTab } | null>(null);
export { editing, setEditing };
export const openEditProject = (projectId: string, tab: ProjectTab = "general") => setEditing({ id: projectId, tab });
export const openProjectSettings = (projectId: string) => openEditProject(projectId, "agent");

// Importer bokmerker fra Chrome.
const [chromeImportOpen, setChromeImportOpen] = createSignal(false);
export { chromeImportOpen, setChromeImportOpen };
export const openChromeImport = () => setChromeImportOpen(true);

// Importer informasjonskapsler: from Innstillinger, or the first time the Browser panel opens (firstRun).
const [cookieDialog, setCookieDialog] = createSignal<{ firstRun: boolean } | null>(null);
export { cookieDialog, setCookieDialog };
export const openCookieImport = () => setCookieDialog({ firstRun: false });

// Manual Git actions: opened by the project gear, /worktree or settings. Never by the model.
const [gitWorkspaceDialog, setGitWorkspaceDialog] = createSignal<{ projectId: string; worktree: boolean } | null>(null);
export { gitWorkspaceDialog, setGitWorkspaceDialog };
export const openGitWorkspace = (projectId: string, worktree = false) => setGitWorkspaceDialog({ projectId, worktree });
