// Round 9: a new Chat project, from the sidebar, the thread menu and Innstillinger → Chat.
import type { ChatProject } from "../../../shared/protocol";
import { collapsed, createChatProject, report, toggleCollapsed } from "../state/app";
import { promptDialog } from "./dialogs";

export async function newChatProject(): Promise<ChatProject | null> {
  const name = await promptDialog({ title: "Nytt prosjekt i Chat", value: "", confirm: "Lag prosjektet" });
  if (!name?.trim()) return null;
  try {
    const project = await createChatProject(name.trim());
    if (collapsed().includes(`chat:${project.id}`)) toggleCollapsed(`chat:${project.id}`);
    return project;
  } catch (err) {
    report(err);
    return null;
  }
}

