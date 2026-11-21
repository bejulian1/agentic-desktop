// The app's menus behind one small icon at the top left: Fil, Rediger, Vis, Gå and Hjelp, each a
// submenu that opens on hover. Every item runs a real action; there are no dead entries.
import { t } from "../lib/i18n";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { app, currentProject, mode, panelOpen, pinnedSummary, setSettingsOpen, sidebarOpen, toast } from "../state/app";
import { actions, focusedThreadId } from "../state/actions";
import { closeArtifacts, openArtifacts } from "../state/artifacts";
import { openPalette, openProfile } from "../state/nav";
import { displayKeys, keysFor } from "../state/shortcuts";
import { IconCheck, IconChevron, IconMenu } from "./icons";
import { enterMode, enterStudio } from "./ModeSwitch";
import { studioOpen, studioAgentOpen } from "../state/studio";

type Item =
  | { label: string; run: () => unknown; keys?: string; checked?: () => boolean; disabled?: () => boolean }
  | "sep";

const code = () => mode() === "code" && !!currentProject();
const noThread = () => !focusedThreadId();

// Edit commands act on the field that had focus before the menu opened.
let lastFocus: HTMLElement | null = null;
const edit = (command: string) => () => {
  lastFocus?.focus();
  if ((command === "undo" || command === "redo") && lastFocus?.closest("[data-testid=studio-editor]")) {
    const key = command === "undo" ? "z" : "y";
    lastFocus.dispatchEvent(new KeyboardEvent("keydown", { key, code: key === "z" ? "KeyZ" : "KeyY", ctrlKey: true, bubbles: true, cancelable: true }));
    return;
  }
  document.execCommand(command);
};
const paste = async () => {
  lastFocus?.focus();
  try {
    document.execCommand("insertText", false, await navigator.clipboard.readText());
  } catch {
    toast(t("Nettleseren slapp ikke til utklippstavlen. Bruk Ctrl+V."));
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
const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => toast(t("Fullskjerm er ikke tillatt her.")));

const MENUS: Array<{ id: string; label: string; items: Item[] }> = [
  {
    id: "file",
    get label() { return t("Fil"); },
    items: [
      { get label() { return t("Ny tråd"); }, run: actions.newThread, keys: "thread.new" },
      { get label() { return t("Ny chat uten prosjekt"); }, run: actions.newChat },
      { get label() { return t("Ny rute"); }, run: actions.newPane, keys: "pane.new" },
      "sep",
      { get label() { return t("Åpne mappe…"); }, run: actions.openFolder, keys: "folder.open" },
      { get label() { return t("Lag AGENTS.md"); }, run: actions.init, disabled: () => !code() },
      "sep",
      { get label() { return t("Arkiverte tråder…"); }, run: () => setSettingsOpen("archived") },
      { get label() { return t("Innstillinger…"); }, run: () => actions.settings(), keys: "settings.open" },
    ],
  },
  {
    id: "edit",
    get label() { return t("Rediger"); },
    items: [
      { get label() { return t("Angre"); }, run: edit("undo") },
      { get label() { return t("Gjør om"); }, run: edit("redo") },
      "sep",
      { get label() { return t("Klipp ut"); }, run: edit("cut") },
      { get label() { return t("Kopier"); }, run: edit("copy") },
      { get label() { return t("Lim inn"); }, run: paste },
      { get label() { return t("Merk alt"); }, run: edit("selectAll") },
      "sep",
      { get label() { return t("Søk i tråder"); }, run: actions.searchThreads, keys: "thread.search" },
      { get label() { return t("Gi tråden nytt navn…"); }, run: actions.rename, disabled: noThread },
      { get label() { return t("Lag gaffel av tråden"); }, run: actions.fork, disabled: noThread },
      "sep",
      { get label() { return t("Komprimer konteksten"); }, run: actions.compact, disabled: noThread },
      { get label() { return t("Angre siste tur"); }, run: actions.undo, disabled: () => noThread() || !code() },
      { get label() { return t("Stopp tråden"); }, run: actions.stop, disabled: () => !app.threads[focusedThreadId() ?? ""]?.running },
    ],
  },
  {
    id: "view",
    get label() { return t("Vis"); },
    items: [
      { get label() { return t("Chat"); }, run: () => enterMode("chat"), checked: () => mode() === "chat" },
      { get label() { return t("Kode"); }, run: () => enterMode("code"), checked: () => mode() === "code" && !studioOpen(), keys: "view.mode" },
      { get label() { return t("Kode Studio"); }, run: enterStudio, checked: () => mode() === "code" && studioOpen() },
      "sep",
      { get label() { return t("Sidefane"); }, run: actions.toggleSidebar, checked: sidebarOpen, keys: "view.sidebar" },
      { get label() { return t("Sidepanel"); }, run: actions.togglePanel, checked: () => mode() === "code" && (studioOpen() ? studioAgentOpen() : panelOpen()), keys: "view.panel", disabled: () => mode() !== "code" },
      { get label() { return t("Festet sammendrag"); }, run: actions.toggleSummary, checked: pinnedSummary, keys: "view.summary" },
      "sep",
      { get label() { return t("Filer"); }, run: () => actions.showTab("files"), disabled: () => !code() },
      { get label() { return t("Endringer"); }, run: () => actions.showTab("changes"), disabled: () => !code() },
      { get label() { return t("Terminal"); }, run: () => actions.showTab("terminal"), disabled: () => !code() },
      { get label() { return t("Nettleser"); }, run: () => actions.showTab("browser"), disabled: () => !code() },
      { get label() { return t("Team"); }, run: () => actions.showTab("team"), disabled: () => !code() },
      "sep",
      { get label() { return t("Zoom inn"); }, run: zoomStep(1), disabled: () => zoom() === ZOOMS.at(-1) },
      { get label() { return t("Zoom ut"); }, run: zoomStep(-1), disabled: () => zoom() === ZOOMS[0] },
      { get label() { return t("Faktisk størrelse"); }, run: () => setZoom(1), checked: () => zoom() === 1 },
      { get label() { return t("Fullskjerm"); }, run: fullscreen },
      "sep",
      { get label() { return t("Lyst tema"); }, run: () => actions.theme("light"), checked: () => app.settings.theme === "light" },
      { get label() { return t("Mørkt tema"); }, run: () => actions.theme("dark"), checked: () => app.settings.theme === "dark" },
      { get label() { return t("Følg systemet"); }, run: () => actions.theme("system"), checked: () => app.settings.theme === "system" },
    ],
  },
  {
    id: "go",
    get label() { return t("Gå"); },
    items: [
      { get label() { return t("Kommandopalett…"); }, run: () => openPalette(), keys: "palette.open" },
      "sep",
      { get label() { return t("Forrige tråd"); }, run: actions.back, keys: "thread.back", disabled: () => !actions.canGoBack() },
      { get label() { return t("Neste tråd"); }, run: actions.forward, keys: "thread.forward", disabled: () => !actions.canGoForward() },
      "sep",
      { get label() { return t("Artifacts"); }, run: () => openArtifacts() },
      { get label() { return t("Skills"); }, run: actions.skills },
      { get label() { return t("Planlagt"); }, run: actions.scheduled },
      { get label() { return t("Profil"); }, run: () => { closeArtifacts(); openProfile(); } },
    ],
  },
  {
    id: "help",
    get label() { return t("Hjelp"); },
    items: [
      { get label() { return t("Hurtigtaster"); }, run: actions.shortcuts, keys: "help.shortcuts" },
      { get label() { return t("Kommandoer"); }, run: actions.commands },
      "sep",
      { get label() { return t("Om Agentic Desktop"); }, run: actions.about },
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
        title={t("Meny: Fil, Rediger, Vis, Gå og Hjelp")}
        aria-label={t("Meny")}
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
        <div class="popover main-menu-drop" role="menu" aria-label={t("Meny")}>
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
