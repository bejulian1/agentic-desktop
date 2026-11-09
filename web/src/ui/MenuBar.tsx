// The app's menus behind one small icon at the top left: Fil, Rediger, Vis, Gå and Hjelp, each a
// submenu that opens on hover. Every item runs a real action; there are no dead entries.
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { app, currentProject, mode, panelOpen, pinnedSummary, setSettingsOpen, sidebarOpen, toast } from "../state/app";
import { actions, focusedThreadId } from "../state/actions";
import { closeArtifacts, openArtifacts } from "../state/artifacts";
import { openPalette, openProfile } from "../state/nav";
import { displayKeys, keysFor } from "../state/shortcuts";
import { IconCheck, IconChevron, IconMenu } from "./icons";
import { enterMode } from "./ModeSwitch";

type Item =
  | { label: string; run: () => unknown; keys?: string; checked?: () => boolean; disabled?: () => boolean }
  | "sep";

const code = () => mode() === "code" && !!currentProject();
const noThread = () => !focusedThreadId();

// Edit commands act on the field that had focus before the menu opened.
let lastFocus: HTMLElement | null = null;
const edit = (command: string) => () => {
  lastFocus?.focus();
  document.execCommand(command);
};
const paste = async () => {
  lastFocus?.focus();
  try {
    document.execCommand("insertText", false, await navigator.clipboard.readText());
  } catch {
    toast("Nettleseren slapp ikke til utklippstavlen. Bruk Ctrl+V.");
  }
};

// Zoom for the whole app, kept between visits.
const ZOOM_KEY = "agentic-zoom";
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const [zoom, setZoomSignal] = createSignal(1);
function setZoom(value: number): void {
  setZoomSignal(value);
  document.documentElement.style.zoom = value === 1 ? "" : String(value);
  try {
    localStorage.setItem(ZOOM_KEY, String(value));
  } catch {
    // Private windows may refuse. The zoom still applies until reload.
  }
}
try {
  const saved = Number(localStorage.getItem(ZOOM_KEY));
  if (ZOOMS.includes(saved)) setZoom(saved);
} catch {
  // Nothing saved.
}
const zoomStep = (dir: 1 | -1) => () => {
  const index = ZOOMS.indexOf(zoom());
  setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + dir))]);
};
const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => toast("Fullskjerm er ikke tillatt her."));

const MENUS: Array<{ id: string; label: string; items: Item[] }> = [
  {
    id: "file",
    label: "Fil",
    items: [
      { label: "Ny tråd", run: actions.newThread, keys: "thread.new" },
      { label: "Ny chat uten prosjekt", run: actions.newChat },
      { label: "Ny rute", run: actions.newPane, keys: "pane.new" },
      "sep",
      { label: "Åpne mappe…", run: actions.openFolder, keys: "folder.open" },
      { label: "Lag AGENTS.md", run: actions.init, disabled: () => !code() },
      "sep",
      { label: "Arkiverte tråder…", run: () => setSettingsOpen("archived") },
      { label: "Innstillinger…", run: () => actions.settings(), keys: "settings.open" },
    ],
  },
  {
    id: "edit",
    label: "Rediger",
    items: [
      { label: "Angre", run: edit("undo") },
      { label: "Gjør om", run: edit("redo") },
      "sep",
      { label: "Klipp ut", run: edit("cut") },
      { label: "Kopier", run: edit("copy") },
      { label: "Lim inn", run: paste },
      { label: "Merk alt", run: edit("selectAll") },
      "sep",
      { label: "Søk i tråder", run: actions.searchThreads, keys: "thread.search" },
      { label: "Gi tråden nytt navn…", run: actions.rename, disabled: noThread },
      { label: "Lag gaffel av tråden", run: actions.fork, disabled: noThread },
      "sep",
      { label: "Komprimer konteksten", run: actions.compact, disabled: noThread },
      { label: "Angre siste tur", run: actions.undo, disabled: () => noThread() || !code() },
      { label: "Stopp tråden", run: actions.stop, disabled: () => !app.threads[focusedThreadId() ?? ""]?.running },
    ],
  },
  {
    id: "view",
    label: "Vis",
    items: [
      { label: "Chat", run: () => enterMode("chat"), checked: () => mode() === "chat" },
      { label: "Kode", run: () => enterMode("code"), checked: () => mode() === "code", keys: "view.mode" },
      "sep",
      { label: "Sidefane", run: actions.toggleSidebar, checked: sidebarOpen, keys: "view.sidebar" },
      { label: "Sidepanel", run: actions.togglePanel, checked: () => mode() === "code" && panelOpen(), keys: "view.panel", disabled: () => mode() !== "code" },
      { label: "Festet sammendrag", run: actions.toggleSummary, checked: pinnedSummary, keys: "view.summary" },
      "sep",
      { label: "Filer", run: () => actions.showTab("files"), disabled: () => !code() },
      { label: "Endringer", run: () => actions.showTab("changes"), disabled: () => !code() },
      { label: "Terminal", run: () => actions.showTab("terminal"), disabled: () => !code() },
      { label: "Nettleser", run: () => actions.showTab("browser"), disabled: () => !code() },
      { label: "Team", run: () => actions.showTab("team"), disabled: () => !code() },
      "sep",
      { label: "Zoom inn", run: zoomStep(1), disabled: () => zoom() === ZOOMS.at(-1) },
      { label: "Zoom ut", run: zoomStep(-1), disabled: () => zoom() === ZOOMS[0] },
      { label: "Faktisk størrelse", run: () => setZoom(1), checked: () => zoom() === 1 },
      { label: "Fullskjerm", run: fullscreen },
      "sep",
      { label: "Lyst tema", run: () => actions.theme("light"), checked: () => app.settings.theme === "light" },
      { label: "Mørkt tema", run: () => actions.theme("dark"), checked: () => app.settings.theme === "dark" },
      { label: "Følg systemet", run: () => actions.theme("system"), checked: () => app.settings.theme === "system" },
    ],
  },
  {
    id: "go",
    label: "Gå",
    items: [
      { label: "Kommandopalett…", run: () => openPalette(), keys: "palette.open" },
      "sep",
      { label: "Forrige tråd", run: actions.back, keys: "thread.back", disabled: () => !actions.canGoBack() },
      { label: "Neste tråd", run: actions.forward, keys: "thread.forward", disabled: () => !actions.canGoForward() },
      "sep",
      { label: "Artifacts", run: () => openArtifacts() },
      { label: "Skills", run: actions.skills },
      { label: "Planlagt", run: actions.scheduled },
      { label: "Profil", run: () => { closeArtifacts(); openProfile(); } },
    ],
  },
  {
    id: "help",
    label: "Hjelp",
    items: [
      { label: "Hurtigtaster", run: actions.shortcuts, keys: "help.shortcuts" },
      { label: "Kommandoer", run: actions.commands },
      "sep",
      { label: "Om Agentic Desktop", run: actions.about },
    ],
  },
];

export function MainMenu() {
  const [open, setOpen] = createSignal(false);
  const [sub, setSub] = createSignal<string | null>(null);
  let root!: HTMLDivElement;

  const close = () => {
    setOpen(false);
    setSub(null);
  };
  const focusIn = (selector: string) => requestAnimationFrame(() => root.querySelector<HTMLElement>(selector)?.focus());

  createEffect(() => {
    if (!open()) return;
    const onDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      const current = sub();
      if (event.key === "Escape") {
        if (current) {
          setSub(null);
          focusIn(`[data-menu="${current}"]`);
        } else close();
      } else if (event.key === "ArrowRight" && !current) {
        const id = (document.activeElement as HTMLElement | null)?.dataset.menu;
        if (id) {
          setSub(id);
          focusIn(".submenu .menu-item:not(:disabled)");
        }
      } else if (event.key === "ArrowLeft" && current) {
        setSub(null);
        focusIn(`[data-menu="${current}"]`);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const list = [...root.querySelectorAll<HTMLElement>(current ? ".submenu .menu-item:not(:disabled)" : ".main-menu-drop > .submenu-entry > .menu-item")];
        const at = list.indexOf(document.activeElement as HTMLElement);
        list[(at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    });
  });

  const run = (item: Exclude<Item, "sep">) => {
    close();
    void item.run();
  };

  return (
    <div class="main-menu" ref={root}>
      <button
        type="button"
        class="icon-button"
        title="Meny: Fil, Rediger, Vis, Gå og Hjelp"
        aria-label="Meny"
        aria-haspopup="menu"
        aria-expanded={open()}
        onPointerDown={() => {
          if (!open()) lastFocus = document.activeElement as HTMLElement | null;
        }}
        onClick={() => (open() ? close() : setOpen(true))}
      >
        <IconMenu />
      </button>
      <Show when={open()}>
        <div class="popover main-menu-drop" role="menu" aria-label="Meny">
          <For each={MENUS}>
            {(menu) => (
              <div class="submenu-entry" onPointerEnter={() => setSub(menu.id)}>
                <button type="button" role="menuitem" class="menu-item" data-menu={menu.id} aria-haspopup="menu" aria-expanded={sub() === menu.id} onClick={() => setSub(menu.id)}>
                  <span class="menu-name">{menu.label}</span>
                  <IconChevron size={12} />
                </button>
                <Show when={sub() === menu.id}>
                  <div class="popover submenu" role="menu" aria-label={menu.label}>
                    <For each={menu.items}>
                      {(item) =>
                        item === "sep" ? (
                          <div class="menu-sep" role="separator" />
                        ) : (
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            class="menu-item"
                            aria-checked={item.checked?.() ?? undefined}
                            disabled={item.disabled?.()}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => run(item)}
                          >
                            <span class="menu-check">{item.checked?.() ? <IconCheck size={13} /> : null}</span>
                            <span class="menu-name">{item.label}</span>
                            <Show when={item.keys}><kbd class="menu-keys">{displayKeys(keysFor(item.keys!))}</kbd></Show>
                          </button>
                        )
                      }
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
