// The thread menu, on right-click and on ⋯ in the sidebar: one list of entries for both, and for
// the cards in the smart sidebar.
import { t } from "../lib/i18n";
import { parsePullUrl, pullUrl } from "../../../shared/linked-pr";
import type { Thread } from "../../../shared/protocol";
import { app, deleteThread, moveToSection, report, sectionsFor, sortedChatProjects } from "../state/app";
import { patch } from "../lib/api";
import { finished, markSeen, markUnread } from "../state/home";
import { newChatProject } from "./chat-projects";
import { chooseSnoozeTime, copyThread, forkFromLast, forkWhole, openInPane, openInWindow, setPinned, setSnoozed, sideChat, snoozeTimes, toggleArchived } from "../state/thread-actions";
import { confirmDialog, promptDialog } from "./dialogs";
import { newSection } from "./sidebar-sections";
import { IconArchive, IconAt, IconDownload, IconEye, IconBranch, IconClose, IconCode, IconCopy, IconFile, IconFolder, IconPin, IconPlus, IconPlusCircle, IconSection, IconSplitRight, IconTrash } from "./icons";
import type { MenuEntry } from "./ContextMenu";
import { IconPencil, IconSnooze, IconWindow } from "./nav-icons";

// Chats move between Chat projects (round 9). Kode threads have a folder, or are Denne datamaskinen.
function moveEntries(thread: Thread): MenuEntry[] {
  if (thread.mode !== "chat" || thread.projectId || thread.temporary) return [];
  const move = (chatProjectId: string | null) => patch(`/api/threads/${thread.id}`, { chatProjectId }).catch(report);
  const current = thread.chatProjectId && app.chatProjects[thread.chatProjectId] ? thread.chatProjectId : null;
  return [{
    label: t("Flytt til prosjekt"),
    icon: IconFolder,
    children: [
      ...sortedChatProjects().map((p) => ({ label: p.name, chosen: p.id === current, run: () => move(p.id) })),
      ...(sortedChatProjects().length ? (["sep"] as MenuEntry[]) : []),
      {
        label: t("Nytt prosjekt…"),
        icon: IconPlus,
        run: async () => {
          const project = await newChatProject();
          if (project) await move(project.id);
        },
      },
      ...(current ? ([{ label: t("Ta ut av prosjektet"), icon: IconClose, run: () => move(null) }] as MenuEntry[]) : []),
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
    label: t("Flytt til seksjon"),
    icon: IconSection,
    children: [
      ...sections.map((section) => ({ label: section.name, chosen: section.id === current, run: () => move(section.id) })),
      ...(sections.length ? (["sep"] as MenuEntry[]) : []),
      {
        label: t("Ny seksjon…"),
        icon: IconPlus,
        run: async () => {
          const section = await newSection(thread.mode);
          if (section) await move(section.id);
        },
      },
      ...(current ? ([{ label: t("Ta ut av seksjonen"), icon: IconClose, run: () => move(null) }] as MenuEntry[]) : []),
    ],
  }];
}

export function threadMenuEntries(thread: Thread, startRename: () => void): MenuEntry[] {
  const snoozed = !!thread.snoozedUntil && thread.snoozedUntil > Date.now();
  return [
    { label: t("Gi nytt navn"), icon: IconPencil, keys: "thread.rename", run: startRename },
    { label: thread.pinned ? t("Løsne") : t("Fest"), icon: IconPin, keys: "thread.pin", run: () => setPinned(thread, !thread.pinned) },
    ...(!thread.temporary ? [{ label: finished().includes(thread.id) ? t("Merk som lest") : t("Merk som ulest"), icon: IconEye, keys: "thread.unread", run: () => finished().includes(thread.id) ? markSeen(thread.id, true) : markUnread(thread.id) } as MenuEntry] : []),
    ...moveEntries(thread),
    ...sectionEntries(thread),
    "sep",
    { label: t("Ny sidechat"), icon: IconPlusCircle, keys: "thread.side", run: () => sideChat(thread), title: t("En ny tråd i samme prosjekt, med en lenke tilbake hit") },
    {
      label: t("Lag gaffel"),
      icon: IconBranch,
      children: [
        { label: t("Av hele tråden"), run: () => forkWhole(thread), title: t("En ny tråd med hele historikken. Tråden her er som før.") },
        { label: t("Fra siste melding"), run: () => forkFromLast(thread), title: t("En ny tråd med bare den siste meldingen og svaret") },
      ],
    },
    ...(!thread.temporary ? [{
      label: t("Utsett"),
      icon: IconSnooze,
      keys: "thread.snooze",
      children: [
        ...snoozeTimes().map(({ id, label }) => ({ label, run: () => {
          const time = snoozeTimes().find((item) => item.id === id)!;
          return setSnoozed(thread, time.at);
        } })),
        { label: t("Velg tidspunkt…"), run: () => chooseSnoozeTime(thread) },
        ...(snoozed ? (["sep", { label: t("Hent tilbake"), run: () => setSnoozed(thread, null) }] as MenuEntry[]) : []),
      ],
    } satisfies MenuEntry, ...pullEntries(thread)] : []),
    "sep",
    { label: t("Eksporter samtale…"), icon: IconDownload, title: t("Last ned samtalen som en Markdown-fil du kan dele selv"), run: () => import("./ChatTools").then(({ exportThread }) => exportThread(thread.id)) },
    {
      label: t("Kopier"),
      icon: IconCopy,
      children: [
        { label: t("Som tekst"), icon: IconFile, run: () => copyThread(thread, "text") },
        { label: t("Som Markdown"), icon: IconCode, run: () => copyThread(thread, "markdown") },
        { label: t("Tråd-ID"), icon: IconAt, run: () => copyThread(thread, "id") },
      ],
    },
    "sep",
    { label: t("Åpne i ny rute"), icon: IconSplitRight, run: () => openInPane(thread) },
    { label: t("Åpne i nytt vindu"), icon: IconWindow, run: () => openInWindow(thread) },
    "sep",
    { label: thread.archived ? t("Gjenopprett") : t("Arkiver"), icon: IconArchive, keys: "thread.archive", run: () => toggleArchived(thread) },
    {
      label: t("Slett"),
      icon: IconTrash,
      danger: true,
      run: async () => {
        if (await confirmDialog({ title: t("Slette tråden?"), text: t("«{title}» slettes for godt. Filer i prosjektet røres ikke.", { title: thread.title }), confirm: t("Slett"), danger: true })) deleteThread(thread.id).catch(report);
      },
    },
  ];
}

function pullEntries(thread: Thread): MenuEntry[] {
  const linked = thread.linkedPr;
  const update = (linkedPr: Thread["linkedPr"]) => patch(`/api/threads/${thread.id}`, { linkedPr }).catch(report);
  const link = {
    label: linked ? t("Endre GitHub-PR…") : t("Knytt til GitHub-PR…"),
    icon: IconBranch,
    run: async () => {
      const value = await promptDialog({
        title: t("Lenke til GitHub-PR"),
        value: linked ? linked.url ?? pullUrl(linked) : "",
        confirm: t("Lagre"),
        validate: (value) => parsePullUrl(value) ? undefined : t("Lim inn en gyldig lenke til en GitHub-PR."),
      });
      if (value) await update(parsePullUrl(value));
    },
  };
  if (!linked) return [link];
  return [{
    label: t("Tilknyttet PR #{number}", { number: linked.number }),
    title: linked.repo,
    icon: IconBranch,
    children: [link, { label: t("Fjern PR-tilknytning"), run: () => update(null) }],
  }];
}
