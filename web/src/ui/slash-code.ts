import { LOCAL_SCOPE, toast } from "../state/app";
import { requestBrowserTab, showPanel, showPanelHome } from "../state/panel";
import { requestTerminalSession } from "../state/panel-sessions";
import { openEditProject, openGitWorkspace, openProjectSettings } from "./dialog-state";

interface CodeSlashContext {
  projectId: string | null;
  threadId: string | null;
  arg: string;
}

type CodeSlashAction = (context: CodeSlashContext) => void | Promise<void>;

function withoutArgs(open: (context: CodeSlashContext) => void): CodeSlashAction {
  return (context) => {
    if (context.arg.trim()) return toast("Denne kommandoen tar ingen argumenter.", "info");
    open(context);
  };
}

function inProject(open: (projectId: string) => void): CodeSlashAction {
  return withoutArgs(({ projectId }) => {
    if (!projectId) return toast("Velg en prosjektmappe i Kode først.", "info");
    open(projectId);
  });
}

function openSessionTool(tool: "browser" | "terminal"): CodeSlashAction {
  return ({ projectId, arg }) => {
    const option = arg.trim().toLowerCase();
    if (option) {
      if (option !== "ny" && option !== "new") return toast(`Bruk /${tool} eller /${tool} ny.`, "info");
      if (tool === "browser") requestBrowserTab(false);
      else requestTerminalSession(projectId ?? LOCAL_SCOPE);
    }
    showPanel(tool);
  };
}

export const codeSlashActions: Readonly<Record<string, CodeSlashAction>> = {
  browser: openSessionTool("browser"),
  files: withoutArgs(() => showPanel("files")),
  terminal: openSessionTool("terminal"),
  session: withoutArgs(() => showPanel("session")),
  overview: withoutArgs(() => showPanel("overview")),
  panel: withoutArgs(() => showPanelHome()),
  branches: inProject((id) => openGitWorkspace(id)),
  github: inProject(() => showPanel("github")),
  "project-settings": inProject(openProjectSettings),
  "project-sources": inProject((id) => openEditProject(id, "sources")),
};
