// The thread menu, on right-click and on ⋯ in the sidebar: one list of entries for both, and for
// the cards in the smart sidebar.
import type { Thread } from "../../../shared/protocol";
import { app, deleteThread, moveToSection, report, sectionsFor, sortedChatProjects } from "../state/app";
import { patch } from "../lib/api";
import { newChatProject } from "./chat-projects";
import { actions } from "../state/actions";
import { copyThread, forkFromLast, forkWhole, openInPane, openInWindow, setPinned, setSnoozed, sideChat, snoozeTimes, toggleArchived } from "../state/thread-actions";
import { confirmDialog } from "./dialogs";
import { newSection } from "./sidebar-sections";
import { IconArchive, IconAt, IconBranch, IconClose, IconCode, IconCopy, IconFile, IconFolder, IconPin, IconPlus, IconPlusCircle, IconSection, IconSplitRight, IconTrash } from "./icons";
import type { MenuEntry } from "./ContextMenu";
import { IconCalendarClock, IconPencil, IconSnooze, IconWindow } from "./nav-icons";

// Chats move between Chat projects (round 9). Kode threads have a folder, or are Denne datamaskinen.
function moveEntries(thread: Thread): MenuEntry[] {
  if (thread.mode !== "chat" || thread.projectId || thread.temporary) return [];
  const move = (chatProjectId: string | null) => patch(`/api/threads/${thread.id}`, { chatProjectId }).catch(report);
  const current = thread.chatProjectId && app.chatProjects[thread.chatProjectId] ? thread.chatProjectId : null;
  return [{
    label: "Flytt til prosjekt",
    icon: IconFolder,
    children: [
      ...sortedChatProjects().map((p) => ({ label: p.name, chosen: p.id === current, run: () => move(p.id) })),
      ...(sortedChatProjects().length ? (["sep"] as MenuEntry[]) : []),
      {
        label: "Nytt prosjekt…",
        icon: IconPlus,
        run: async () => {
          const project = await newChatProject();
          if (project) await move(project.id);
        },
      },
      ...(current ? ([{ label: "Ta ut av prosjektet", icon: IconClose, run: () => move(null) }] as MenuEntry[]) : []),
    ],
  }];
}

// Round 11 (SPEC 24.6): a thread can be put in one of its mode's sections, or a new one.
function sectionEntries(thread: Thread): MenuEntry[] {
  if (thread.temporary) return [];
  const sections = sectionsFor(thread.mode);
  const current = thread.sectionId && app.sections[thread.sectionId] ? thread.sectionId : null;
  const move = (sectionId: string | null) => moveToSection(thread.id, sectionId).catch(report);
  return [{
    label: "Flytt til seksjon",
    icon: IconSection,
    children: [
      ...sections.map((section) => ({ label: section.name, chosen: section.id === current, run: () => move(section.id) })),
      ...(sections.length ? (["sep"] as MenuEntry[]) : []),
      {
        label: "Ny seksjon…",
        icon: IconPlus,
        run: async () => {
          const section = await newSection(thread.mode);
          if (section) await move(section.id);
        },
      },
      ...(current ? ([{ label: "Ta ut av seksjonen", icon: IconClose, run: () => move(null) }] as MenuEntry[]) : []),
    ],
  }];
}

export function threadMenuEntries(thread: Thread, startRename: () => void): MenuEntry[] {
  const snoozed = !!thread.snoozedUntil && thread.snoozedUntil > Date.now();
  return [
    { label: "Gi nytt navn", icon: IconPencil, keys: "thread.rename", run: startRename },
    { label: thread.pinned ? "Løsne" : "Fest", icon: IconPin, keys: "thread.pin", run: () => setPinned(thread, !thread.pinned) },
    ...moveEntries(thread),
    ...sectionEntries(thread),
    "sep",
    { label: "Ny sidechat", icon: IconPlusCircle, keys: "thread.side", run: () => sideChat(thread), title: "En ny tråd i samme prosjekt, med en lenke tilbake hit" },
    {
      label: "Lag gaffel",
      icon: IconBranch,
      children: [
        { label: "Av hele tråden", run: () => forkWhole(thread), title: "En ny tråd med hele historikken. Tråden her er som før." },
        { label: "Fra siste melding", run: () => forkFromLast(thread), title: "En ny tråd med bare den siste meldingen og svaret" },
      ],
    },
    {
      label: "Utsett",
      icon: IconSnooze,
      children: [
        ...snoozeTimes().map((t) => ({ label: t.label, run: () => setSnoozed(thread, t.at) })),
        ...(snoozed ? (["sep", { label: "Hent tilbake", run: () => setSnoozed(thread, null) }] as MenuEntry[]) : []),
      ],
    },
    { label: "Legg til planlagt oppgave", icon: IconCalendarClock, demo: true, run: actions.scheduled, title: "Planlagte oppgaver kommer senere" },
    "sep",
    {
      label: "Kopier",
      icon: IconCopy,
      children: [
        { label: "Som tekst", icon: IconFile, run: () => copyThread(thread, "text") },
        { label: "Som Markdown", icon: IconCode, run: () => copyThread(thread, "markdown") },
        { label: "Tråd-ID", icon: IconAt, run: () => copyThread(thread, "id") },
      ],
    },
    "sep",
    { label: "Åpne i ny rute", icon: IconSplitRight, run: () => openInPane(thread) },
    { label: "Åpne i nytt vindu", icon: IconWindow, run: () => openInWindow(thread) },
    "sep",
    { label: thread.archived ? "Gjenopprett" : "Arkiver", icon: IconArchive, keys: "thread.archive", run: () => toggleArchived(thread) },
    {
      label: "Slett",
      icon: IconTrash,
      danger: true,
      run: async () => {
        if (await confirmDialog({ title: "Slette tråden?", text: `«${thread.title}» slettes for godt. Filer i prosjektet røres ikke.`, confirm: "Slett", danger: true })) deleteThread(thread.id).catch(report);
      },
    },
  ];
}
