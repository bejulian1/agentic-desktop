// The real headless Chrome, shown as a CDP screencast on a canvas. Mouse, keyboard and wheel go
// back the same way. Frames are decoded off the main thread and acked after drawing, and the ack
// is the back-pressure: a slow panel simply gets fewer frames.
//
// v0.5: a new-tab page while no address is open, and a ⋯ menu with find on the page (run by the
// browser itself in an isolated world), zoom (a smaller or larger viewport, drawn at the zoom's scale),
// a screenshot of the frame on screen, the panel's history and clearing browsing data.
//
// Round 10 (SPEC 23.1), a small Chrome: tabs with favicon and close, a + that makes a tab on click
// and shows Ny fane / Ny fane i fullvisning on hover, the downloads button, full view, and a new
// tab page whose tools and suggestions fit the panel's width, with ⋯ only for what does not fit.
// The tabs live on the server (one page each), so two windows, a reload and the agent all see the
// same tabs; each model thread works in its own tab, independently of panel selection.
import { t } from "../lib/i18n";
import { batch, createEffect, createMemo, createResource, createSignal, For, on as watch, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { onNextFrame } from "../lib/frame";
import { observeResize } from "../lib/resize";
import { on, onOpen, send } from "../lib/socket";
import { BROWSER_ZOOMS, browserSearchUrl, type BrowserInput, type BrowserState, type BrowserTabInfo, type ClientMessage } from "../../../shared/protocol";
import { app, LOCAL_SCOPE, mode, setSettingsOpen, settingsOpen, toast } from "../state/app";
import { desktop } from "../lib/desktop";
import { focusedThread, actions } from "../state/actions";
import { browserTabRequest, browserUrlRequest, closePanelTool, onPanelHome, panelFull, setPanelFull, showPanel, takeBrowserTabRequest, takeBrowserUrlRequest } from "../state/panel";
import { publishPanelSessions, releasePanelSessions } from "../state/panel-sessions";
import { offerCookieImport } from "../ui/CookieImport";
import { sideChat } from "../state/thread-actions";
import { displayKeys, keysFor } from "../state/shortcuts";
import { servers } from "../state/servers";
import { artifacts } from "../state/artifacts";
import { ContextMenu, type MenuAnchor, type MenuEntry } from "../ui/ContextMenu";
import { confirmDialog } from "../ui/dialogs";
import { IconArtifact, IconBack, IconBookmark, IconChevron, IconClose, IconDiff, IconDots, IconDownload, IconFile, IconForward, IconGlobe, IconPlus, IconPlusCircle, IconReload, IconSearch, IconTerminal, IconTrash } from "../ui/icons";
import { IconExitFullView, IconExternal, IconFullView, IconHistory, IconImage } from "../ui/nav-icons";
import { ProjectGlyph } from "../ui/ProjectGlyph";
import { DownloadsList } from "../ui/DownloadsList";
import { activeDownloads, loadDownloads } from "../state/downloads";
import { imported, loadImported, openChromeImport } from "../ui/ChromeImport";
import { AnnotateButton } from "./Annotate"; // round 11b (SPEC 25.1)
import { browserDestination } from "./browser-address";
import "../styles/browser-polish.css";
import { nativeBridge, placeNative, type Still } from "./browser-native"; // SPEC 29.3: the page as a view in the Electron window

// The panel's own history, per project, kept in this browser.
interface Visit {
  url: string;
  title: string;
  at: number;
}
const historyKey = (projectId: string) => `ad-browser-history:${projectId}`;
function loadHistory(projectId: string): Visit[] {
  try {
    const list = JSON.parse(localStorage.getItem(historyKey(projectId)) ?? "[]");
    return Array.isArray(list) ? list.filter((v) => typeof v?.url === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}
function saveHistory(projectId: string, list: Visit[]): void {
  try {
    if (list.length) localStorage.setItem(historyKey(projectId), JSON.stringify(list.slice(0, 50)));
    else localStorage.removeItem(historyKey(projectId));
  } catch {
    // Not kept this time.
  }
}

const ZOOMS: readonly number[] = BROWSER_ZOOMS;
const zoomKey = (projectId: string) => `ad-browser-zoom:${projectId}`;
function savedProjectZoom(projectId: string): number | null {
  try {
    const raw = localStorage.getItem(zoomKey(projectId));
    if (raw === null) return null;
    const saved = Number(raw);
    return ZOOMS.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}
const RESIZE_MS = 50; // the page's viewport follows the panel this often while its size changes
const TIP_KEY = "ad-browser-import-tip";
const FALLBACK_KEY = "ad-browser-fallback-note";
const MAX_TABS = 12;

// The tab each project showed last in this window, so the panel opens where you left it.
const lastTab = new Map<string, string>();
// Favicons seen in tabs, by origin, for the suggestions on Ny fane.
const iconByOrigin = new Map<string, string>();

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host || u.protocol.replace(":", "");
  } catch {
    return url;
  }
}
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
function httpUrlOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === location.protocol && parsed.port === location.port && ["localhost", "127.0.0.1"].includes(parsed.hostname)) return null;
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function modifiers(event: KeyboardEvent | MouseEvent | WheelEvent): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

const BUTTONS = ["left", "middle", "right"] as const;

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const newTabId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isBlank = (url: string | undefined) => !url || url === "about:blank";
const tabTitle = (tab: Pick<BrowserTabInfo, "title" | "url">) => (isBlank(tab.url) ? t("Ny fane") : tab.title.trim() || hostOf(tab.url));

// The + in the tab row: a click makes a tab; resting on it shows Ny fane and Ny fane i fullvisning
// with their keys. The menu waits a moment before it shows and before it goes, so moving from + to
// the menu never makes it blink. ↓ (or ↑) on + opens it from the keyboard, Esc closes it and gives
// focus back to +. A click on + while the menu shows closes it and makes the tab, and the menu does
// not come back until the pointer has left + (the rule for every menu: the button that opened it
// closes it).
const HOVER_OPEN_MS = 220;
const HOVER_CLOSE_MS = 220;

function NewTabButton(props: { onNew: (full: boolean) => void; disabled: boolean; active: boolean }) {
  let button!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal<"hover" | "keys" | null>(null);
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressed = false;
  const clear = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  };
  const close = (focusButton = false) => {
    clear();
    const inside = !!menu?.contains(document.activeElement);
    setOpen(null);
    if (props.active && (focusButton || inside)) button.focus({ preventScroll: true });
  };
  const hoverIn = () => {
    clearTimeout(closeTimer);
    if (open() || suppressed || props.disabled || !props.active) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(() => setOpen("hover"), HOVER_OPEN_MS);
  };
  const hoverOut = () => {
    clearTimeout(openTimer);
    if (open() !== "hover") return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(null), HOVER_CLOSE_MS);
  };
  const items = () => [...(menu?.querySelectorAll<HTMLButtonElement>(".menu-item") ?? [])];
  const openFromKeys = (last = false) => {
    if (!props.active) return;
    clear();
    setOpen("keys");
    requestAnimationFrame(() => (last ? items().at(-1) : items()[0])?.focus());
  };
  const pick = (full: boolean) => {
    close(true);
    props.onNew(full);
  };

  createEffect(() => { if (!props.active) close(); });
  createEffect(() => {
    if (!open() || !props.active) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu?.contains(target) || button.contains(target)) return;
      close();
    };
    const onBlur = () => close();
    document.addEventListener("pointerdown", onDown, true);
    addEventListener("blur", onBlur);
    addEventListener("resize", onBlur);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDown, true);
      removeEventListener("blur", onBlur);
      removeEventListener("resize", onBlur);
    });
  });
  onCleanup(clear);

  const place = (el: HTMLDivElement) => {
    menu = el;
    const r = button.getBoundingClientRect();
    requestAnimationFrame(() => {
      const w = el.offsetWidth;
      el.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8)))}px`;
      el.style.top = `${Math.round(r.bottom + 4)}px`;
      el.style.visibility = "";
    });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        class="btn btn-small browser-newtab-button"
        aria-label={t("Ny nettleserfane")}
        aria-haspopup="menu"
        aria-expanded={!!open()}
        aria-keyshortcuts={keysFor("browser.newTab").replace("Mod", "Control")}
        disabled={props.disabled}
        onPointerEnter={(e) => e.pointerType === "mouse" && hoverIn()}
        onPointerLeave={() => {
          suppressed = false;
          hoverOut();
        }}
        onClick={() => {
          suppressed = true;
          close();
          props.onNew(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openFromKeys(e.key === "ArrowUp");
          } else if (e.key === "Escape" && open()) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
          }
        }}
      >
        <span>{t("Ny nettleserfane")}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={place}
            class="popover context-menu newtab-menu"
            role="menu"
            aria-label={t("Ny nettleserfane")}
            style="visibility:hidden"
            onPointerEnter={() => clearTimeout(closeTimer)}
            onPointerLeave={hoverOut}
            onKeyDown={(e) => {
              const list = items();
              const at = list.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                list[(at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
              } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                (e.key === "Home" ? list[0] : list.at(-1))?.focus();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              } else if (e.key === "Tab") {
                close(true);
              }
            }}
          >
            <button type="button" role="menuitem" class="menu-item" onClick={() => pick(false)}>
              <IconPlus size={15} /><span class="menu-name">{t("Ny nettleserfane")}</span><kbd class="menu-keys">{displayKeys(keysFor("browser.newTab"))}</kbd>
            </button>
            <button type="button" role="menuitem" class="menu-item" onClick={() => pick(true)}>
              <IconFullView size={15} /><span class="menu-name">{t("Ny nettleserfane i fullvisning")}</span><kbd class="menu-keys">{displayKeys(keysFor("browser.newTabFull"))}</kbd>
            </button>
          </div>
        </Portal>
      </Show>
    </>
  );
}

function TabIcon(props: { tab: BrowserTabInfo }) {
  return (
    <span class="browser-tab-icon" aria-hidden="true">
      <Show when={!props.tab.loading || isBlank(props.tab.url)} fallback={<span class="spinner" />}>
        <Show when={props.tab.favicon} fallback={<IconGlobe size={14} />}>{(src) => <img src={src()} alt="" width="14" height="14" />}</Show>
      </Show>
    </span>
  );
}

// A suggestion on Ny fane: a running server, an artifact, a page you visited, or a bookmark from Chrome.
interface Suggestion {
  url: string;
  label: string;
  hint: string;
  kind: "server" | "artifact" | "history" | "bookmark";
  projectId?: string | null;
}

function SuggestionIcon(props: { item: Suggestion; size: number }): JSX.Element {
  const project = () => (props.item.projectId ? app.projects[props.item.projectId] : undefined);
  const icon = () => iconByOrigin.get(originOf(props.item.url));
  return (
    <Show when={props.item.kind !== "server" || !project()} fallback={<ProjectGlyph project={project()!} size={props.size} />}>
      <Show when={props.item.kind !== "artifact"} fallback={<IconArtifact size={props.size} />}>
        <Show when={icon()} fallback={props.item.kind === "bookmark" ? <IconBookmark size={props.size} /> : <IconGlobe size={props.size} />}>
          {(src) => <img src={src()} alt="" width={props.size} height={props.size} />}
        </Show>
      </Show>
    </Show>
  );
}

// head: round 12 (SPEC 26.3), a stacked panel's slim top line, where the tabs and + go instead.
export default function BrowserPanel(props: { projectId: string; head?: () => HTMLElement | undefined; sharedTabs?: boolean; visible?: boolean }) {
  let canvas!: HTMLCanvasElement;
  let stage!: HTMLDivElement;
  let addressInput!: HTMLInputElement;
  const surfaceActive = () => props.visible !== false && !settingsOpen() && (mode() !== "code" || !onPanelHome());
  const [state, setState] = createSignal<BrowserState | null>(null);
  const [address, setAddress] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [closed, setClosed] = createSignal("");
  const [hasFrame, setHasFrame] = createSignal(false);
  const [history, setHistory] = createSignal<Visit[]>(loadHistory(props.projectId));
  const [menu, setMenu] = createSignal<MenuAnchor | null>(null);
  const [historyMenu, setHistoryMenu] = createSignal<MenuAnchor | null>(null);
  const [navigationErrors, setNavigationErrors] = createSignal<Record<string, string>>({});
  const retryByTab = new Map<string, ClientMessage>();
  type NavigationRequest = { id: string; sequence: number; message: ClientMessage };
  const latestNavigation = new Map<string, NavigationRequest>();
  const latestAttach = new Map<string, NavigationRequest>();
  const requestPrefix = `browser-${newTabId()}`;
  let requestSequence = 0;
  const navigationError = () => navigationErrors()[active() ?? ""];
  const [finding, setFinding] = createSignal(false);
  const [findText, setFindText] = createSignal("");
  const [findMiss, setFindMiss] = createSignal(false);
  const [showDownloads, setShowDownloads] = createSignal(false);
  // The tabs from the server, and the one this panel shows. null until the server has said which.
  const [serverTabs, setServerTabs] = createSignal<BrowserTabInfo[]>([]);
  const [active, setActive] = createSignal<string | null>(lastTab.get(props.projectId) ?? null);
  const defaultZoom = () => {
    const z = app.settings.browserDefaultZoom;
    return z && ZOOMS.includes(z) ? z : 1;
  };
  const [zoom, setZoomSignal] = createSignal(savedProjectZoom(props.projectId) ?? defaultZoom());
  createEffect(watch(defaultZoom, (def) => {
    if (savedProjectZoom(props.projectId) === null && untrack(zoom) !== def) {
      setZoomSignal(def);
      resized();
    }
  }, { defer: true }));
  const size = { width: 0, height: 0 };
  // The page is laid out in a viewport the size of the panel divided by the zoom, and the frame is
  // drawn at the zoom's scale: 125 % shows less of the page, larger.
  const viewport = () => ({ width: Math.round(size.width / zoom()), height: Math.round(size.height / zoom()) });
  let frameWidth = 0;
  let frameHeight = 0;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeSentAt = 0;
  let alive = true;
  let latest: { sessionId: number; jpegBase64: string; width: number; height: number; tabId: string } | null = null;
  let drawing = false;
  // SPEC 29.3: in the Electron app the page is a real view over the stage, not frames on the canvas.
  // still: a picture of it while a menu or dialog lies over the panel.
  const native = () => !!nativeBridge && state()?.native === true;
  const [still, setStill] = createSignal<Still | null>(null);
  const hasPage = () => !navigationError() && (native() ? !closed() && !!state() : hasFrame());

  const tabOf = (message: { tabId?: string }) => message.tabId ?? "";
  const mine = (message: { projectId: string; tabId?: string }) => message.projectId === props.projectId && active() !== null && tabOf(message) === active();
  const sendBrowser = (message: ClientMessage, attachOnly = false) => {
    if (message.type === "browser.open" || message.type === "browser.navigate" || message.type === "browser.history") {
      const key = message.tabId ?? active() ?? "";
      const sequence = ++requestSequence;
      const request = { id: `${requestPrefix}-${sequence}`, sequence, message };
      if (message.type === "browser.open") latestAttach.set(key, request);
      else latestNavigation.set(key, request);
      if (!attachOnly) {
        retryByTab.set(key, message);
        setNavigationErrors((previous) => { const next = { ...previous }; delete next[key]; return next; });
      }
      send({ ...message, requestId: request.id });
      return;
    }
    send(message);
  };
  // Sends a browser message for the tab on screen.
  const sendTab = (message: ClientMessage) => {
    const tab = active();
    sendBrowser(tab === null ? message : ({ ...message, tabId: tab } as ClientMessage));
  };

  // The tabs to show: the server's, and the one on screen while the server is still opening it.
  const tabs = createMemo<BrowserTabInfo[]>(() => {
    const list = serverTabs();
    const tab = active();
    if (tab === null || list.some((t) => t.id === tab)) return list;
    return [...list, { id: tab, url: "about:blank", title: "", loading: false }];
  });

  const tabLabel = (tab: BrowserTabInfo) => tab.threadId
    ? `${app.threads[tab.threadId]?.title || t("Tråd")} · ${tabTitle(tab)}`
    : tabTitle(tab);
  const focusedTab = createMemo(() => {
    const thread = focusedThread();
    return thread?.mode === "code" && (thread.projectId ?? LOCAL_SCOPE) === props.projectId ? serverTabs().find((tab) => tab.threadId === thread.id) : undefined;
  });

  const open = () => {
    if (props.visible === false) return;
    if (!size.width || !size.height) return;
    const tab = active();
    const message: ClientMessage = { type: "browser.open", projectId: props.projectId, ...viewport(), ...(tab === null ? {} : { tabId: tab }), ...(nativeBridge ? { native: true } : {}) };
    // Selecting a tab asks for its state/frames again; preserve a failed navigation and retry
    // target until the user retries it or enters another address.
    sendBrowser(message, true);
  };

  const draw = async () => {
    if (drawing || !latest) return;
    drawing = true;
    const frame = latest;
    latest = null;
    try {
      const bitmap = await createImageBitmap(new Blob([decode(frame.jpegBase64)], { type: "image/jpeg" }));
      if (alive && frame.tabId === active()) {
        frameWidth = frame.width;
        frameHeight = frame.height;
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        layoutCanvas();
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        setHasFrame(true);
      }
      bitmap.close();
    } catch {
      // A broken frame: the next one replaces it.
    }
    drawing = false;
    if (alive) send({ type: "browser.frame-ack", projectId: props.projectId, sessionId: frame.sessionId, tabId: frame.tabId });
    if (latest) void draw();
  };

  // The frame is drawn from the top left at the zoom's scale, whatever size the stage has now. A
  // frame from before the panel changed size is cropped, or leaves the stage's own background beside
  // it, until the page has the new viewport (resized, below); it is never stretched to fit, which
  // made the page grow and shrink while the panel was dragged wider. A frame within a pixel and a
  // half of the stage fills it, so rounding the viewport leaves no seam. Pages of the Electron
  // window seen from another browser have the size of their view there: they fit the width.
  function layoutCanvas(): void {
    if (!frameWidth || !frameHeight) return;
    const scale = state()?.native && size.width ? size.width / frameWidth : zoom();
    const fit = (length: number, stage: number) => (Math.abs(length - stage) < 1.5 ? stage : length);
    canvas.style.width = `${fit(frameWidth * scale, size.width)}px`;
    canvas.style.height = `${fit(frameHeight * scale, size.height)}px`;
  }
  createEffect(watch([zoom, () => state()?.native], layoutCanvas, { defer: true }));

  // The page gets the panel's size at once, and then at most every RESIZE_MS while it keeps
  // changing, so the page reflows while a divider is dragged and not only when the drag rests. In
  // the Electron window the page is as large as its view, and there is nothing to send.
  function resized(): void {
    layoutCanvas();
    if (!size.width || !size.height || native() || resizeTimer !== undefined) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      resizeSentAt = performance.now();
      if (!native()) sendTab({ type: "browser.resize", projectId: props.projectId, ...viewport() });
    }, Math.max(0, RESIZE_MS - (performance.now() - resizeSentAt)));
  }

  const toPage = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const scale = frameWidth && rect.width ? rect.width / frameWidth : 1;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  const input = (event: BrowserInput) => sendTab({ type: "browser.input", projectId: props.projectId, event });

  let pendingMove: MouseEvent | null = null;
  const flushMove = () => {
    if (!pendingMove) return;
    const event = pendingMove;
    pendingMove = null;
    input({ kind: "mouse", action: "move", ...toPage(event), button: event.buttons & 1 ? "left" : "none", clicks: 0, modifiers: modifiers(event) });
  };

  const mouse = (action: "down" | "up", event: MouseEvent) => {
    flushMove();
    canvas.focus();
    input({ kind: "mouse", action, ...toPage(event), button: BUTTONS[event.button] ?? "left", clicks: event.detail || 1, modifiers: modifiers(event) });
  };

  const key = (action: "down" | "up", event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === " " || event.key.startsWith("Arrow") || event.key === "Enter" || event.key === "Backspace") event.preventDefault();
    input({ kind: "key", action, key: event.key, code: event.code, modifiers: modifiers(event), text: action === "down" && event.key.length === 1 ? event.key : undefined });
  };

  const navigate = (event: Event) => {
    event.preventDefault();
    const url = browserDestination(address(), browserSearchUrl(app.settings));
    if (!url) return;
    setEditing(false);
    setHistoryMenu(null);
    sendTab({ type: "browser.navigate", projectId: props.projectId, url });
  };

  // Another tab on screen: its frames, its state and its address. The server stops sending the
  // frames of the tab that was shown.
  const showTab = (id: string) => {
    if (id === active()) return;
    batch(() => {
      setActive(id);
      setState(null);
      setHasFrame(false);
      setClosed("");
      setFinding(false);
      setEditing(false);
      setAddress("");
    });
    lastTab.set(props.projectId, id);
    latest = null;
    open();
  };

  // A tab made here comes in with a small slide (styles/motion.css); tabs that were already open do not.
  const [fresh, setFresh] = createSignal<string | null>(null);
  let freshTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(freshTimer));
  const newTab = (full = false) => {
    if (tabs().length >= MAX_TABS) return toast(t("Høyst {limit} faner. Lukk en fane først.", { limit: MAX_TABS }), "info");
    if (full) setPanelFull(true);
    const id = newTabId();
    setFresh(id);
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => setFresh(null), 400);
    showTab(id);
    requestAnimationFrame(() => addressInput?.focus());
  };

  const closeTab = (id: string) => {
    const list = tabs();
    const at = list.findIndex((t) => t.id === id);
    if (at < 0) return;
    if (id === active()) {
      const next = list[at + 1] ?? list[at - 1];
      if (next) showTab(next.id);
      else if (props.sharedTabs) closePanelTool("browser");
      else showTab(newTabId()); // Grouped view always keeps a blank tab.
    }
    setServerTabs(serverTabs().filter((t) => t.id !== id));
    send({ type: "browser.close-tab", projectId: props.projectId, tabId: id });
  };

  // Round 12 (SPEC 26.4): the first time the panel opens, the offer to stay signed in, once, until
  // it is answered; it does nothing when there is no browser profile to import from.
  onMount(() => void offerCookieImport());

  onMount(() => {
    loadDownloads();
    void loadImported();
    const stops = [
      on("browser.tabs", (message) => {
        if (message.projectId !== props.projectId) return;
        for (const tab of message.tabs) if (tab.favicon) iconByOrigin.set(originOf(tab.url), tab.favicon);
        // A confirmed tab can disappear when another window closes it. A new local tab
        // is still pending until it appears in the server list, so do not replace that one.
        const removed = serverTabs().some((tab) => tab.id === active()) && !message.tabs.some((tab) => tab.id === active());
        setServerTabs(message.tabs);
        if (active() === null) {
          setActive(message.active);
          lastTab.set(props.projectId, message.active);
        } else if (removed) {
          showTab(message.tabs.find((tab) => tab.id === message.active)?.id ?? message.tabs[0]?.id ?? newTabId());
        }
      }),
      on("browser.state", (message) => {
        if (message.projectId !== props.projectId) return;
        if (active() === null) setActive(tabOf(message));
        if (!mine(message)) return;
        setClosed("");
        setState(message.state);
        if (!editing()) setAddress(message.state.url === "about:blank" ? "" : message.state.url);
        remember(message.state);
      }),
      on("browser.error", (message) => {
        if (message.projectId !== props.projectId) return;
        if (message.command && !["browser.open", "browser.navigate", "browser.history"].includes(message.command)) return toast(message.message);
        const key = message.tabId ?? active() ?? "";
        const request = message.command === "browser.open" ? latestAttach.get(key) : latestNavigation.get(key);
        // An earlier navigation may fail after the user has already opened another address.
        // Reattaching a tab tracks its own request without replacing the navigation's retry.
        if (message.requestId && request?.id !== message.requestId) return;
        if (message.command === "browser.open" && request && (latestNavigation.get(key)?.sequence ?? 0) > request.sequence) return;
        if (request) retryByTab.set(key, request.message);
        setNavigationErrors((previous) => ({ ...previous, [key]: message.message }));
      }),
      on("browser.found", (message) => {
        if (!mine(message) || message.text !== findText().trim()) return;
        setFindMiss(!message.found);
      }),
      on("browser.cleared", (message) => {
        if (message.projectId === props.projectId) toast(t("Nettlesingsdata er tømt."), "info");
      }),
      on("browser.frame", (message) => {
        if (message.projectId !== props.projectId) return;
        if (!mine(message)) {
          // A frame from the tab that was shown a moment ago: let it go.
          send({ type: "browser.frame-ack", projectId: props.projectId, sessionId: message.sessionId, tabId: tabOf(message) });
          return;
        }
        latest = { ...message, tabId: tabOf(message) };
        void draw();
      }),
      on("browser.closed", (message) => {
        if (!mine(message)) return;
        setClosed(message.reason);
        setHasFrame(false);
      }),
      onOpen(open),
    ];
    const placement = nativeBridge
      ? placeNative({ stage, projectId: props.projectId, tab: active, wanted: () => surfaceActive() && native() && !showNewtab() && !closed() && !navigationError() && !!state(), zoom, still: setStill })
      : undefined;
    if (placement) createEffect(watch([surfaceActive, active, native, showNewtab, closed, navigationError, zoom, () => state()?.url], () => placement.measure(), { defer: true }));
    const stopResize = observeResize(stage, (entry) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (!width || !height) return;
      const first = !size.width;
      size.width = width;
      size.height = height;
      if (first) return open();
      resized();
    });
    onCleanup(() => {
      alive = false;
      clearTimeout(resizeTimer);
      placement?.stop();
      stopResize();
      stops.forEach((stop) => stop());
      send({ type: "browser.close", projectId: props.projectId });
    });
  });

  // A new tab asked for by a shortcut: taken once, also when the request is what opened the panel.
  createEffect(() => {
    const request = browserTabRequest();
    if (!request) return;
    untrack(() => {
      takeBrowserTabRequest();
      newTab(request.full);
    });
  });

  // A URL asked to open from outside the Browser panel (e.g. a clicked link when openLinksIn is "app").
  createEffect(() => {
    const request = browserUrlRequest();
    if (!request || props.visible === false) return;
    untrack(() => {
      const taken = takeBrowserUrlRequest();
      if (!taken) return;
      const current = state();
      let targetTab = active();
      if (targetTab === null || (!isBlank(current?.url) && tabs().length < MAX_TABS)) {
        targetTab = newTabId();
        showTab(targetTab);
      }
      setEditing(false);
      setAddress(taken.url);
      setHistoryMenu(null);
      sendBrowser({ type: "browser.navigate", projectId: props.projectId, tabId: targetTab, url: taken.url });
    });
  });

  // Keep the tab controls while another tool is selected, without streaming hidden pages.
  createEffect(watch(() => props.visible, (visible) => {
    if (visible === false) send({ type: "browser.close", projectId: props.projectId });
    else open();
  }, { defer: true }));

  // Playtest opens its page on the server. Showing the panel again is all that is needed here.
  createEffect(() => {
    const playtest = app.playtest[props.projectId];
    if (playtest?.status === "running" && closed()) open();
  });


  const go = (url: string) => {
    setEditing(false);
    setAddress(url);
    setHistoryMenu(null);
    sendTab({ type: "browser.navigate", projectId: props.projectId, url });
  };

  // A finished load of a real address goes first in the history, once.
  function remember(next: BrowserState): void {
    if (next.loading || !/^https?:/.test(next.url)) return;
    const list = history();
    if (list[0]?.url === next.url) {
      if (next.title && list[0].title !== next.title) {
        const updated = [{ ...list[0], title: next.title }, ...list.slice(1)];
        setHistory(updated);
        saveHistory(props.projectId, updated);
      }
      return;
    }
    const updated = [{ url: next.url, title: next.title, at: Date.now() }, ...list.filter((v) => v.url !== next.url)].slice(0, 50);
    setHistory(updated);
    saveHistory(props.projectId, updated);
  }

  const setZoom = (value: number) => {
    try {
      if (value === defaultZoom()) localStorage.removeItem(zoomKey(props.projectId));
      else localStorage.setItem(zoomKey(props.projectId), String(value));
    } catch {
      // Kept until the panel closes.
    }
    setZoomSignal(value);
    resized();
  };
  const zoomStep = (dir: 1 | -1) => {
    const at = ZOOMS.indexOf(zoom());
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + dir))]);
  };

  const find = (backwards = false) => {
    const text = findText().trim();
    if (!text) return;
    sendTab({ type: "browser.find", projectId: props.projectId, text, backwards });
  };
  const openFind = () => {
    setFinding(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".browser-find input")?.select());
  };

  // The frame on screen, as a PNG the user saves. Nothing is sent anywhere.
  const screenshot = () => {
    if (!hasPage()) return toast(t("Det er ingen side å ta bilde av ennå."), "info");
    const name = `skjermbilde-${hostOf(state()?.url ?? "side").replace(/[^a-z0-9.-]+/gi, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
    const save = (href: string) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = name;
      link.click();
    };
    const tab = active();
    if (native() && tab !== null) {
      void nativeBridge!.freeze(props.projectId, tab).then((url) => (url ? save(url) : toast(t("Fikk ikke laget bildet."))));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) return toast(t("Fikk ikke laget bildet."));
      const href = URL.createObjectURL(blob);
      save(href);
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    }, "image/png");
  };

  const clearData = async () => {
    const ok = await confirmDialog({
      title: t("Tømme nettlesingsdata?"),
      text: t("Informasjonskapsler og hurtigbuffer i panelets nettleser slettes, sammen med lagrede data for siden som er åpen og historikken her. Nettleserprofilen deles av alle prosjektene."),
      confirm: t("Tøm"),
      danger: true,
    });
    if (!ok) return;
    setHistory([]);
    saveHistory(props.projectId, []);
    send({ type: "browser.clear-data", projectId: props.projectId });
  };

  const bookmarks = () => imported()?.bookmarks ?? [];
  const historyEntries = (): MenuEntry[] => history().length || imported()?.history.length
        ? [
            ...history().slice(0, 12).map((v) => ({ label: v.title || hostOf(v.url), hint: hostOf(v.url), title: v.url, run: () => go(v.url) })),
            ...(imported()?.history.length
              ? [{ heading: <span class="menu-heading">{t("Fra Chrome")}</span> } as MenuEntry, ...imported()!.history.slice(0, 12).map((v) => ({ label: v.title, hint: hostOf(v.url), title: v.url, run: () => go(v.url) }))]
              : []),
          ]
        : [{ label: t("Ingen historikk ennå"), disabled: true }];
  const externalUrl = () => {
    const current = state();
    if (current) return httpUrlOf(current.pendingUrl ?? current.url);
    const tabId = active();
    return httpUrlOf(tabId === null ? undefined : tabs().find((tab) => tab.id === tabId)?.url);
  };
  const openInSystemBrowser = () => {
    const url = externalUrl();
    if (!url) return;
    // In Electron, main.ts intercepts window.open for external HTTP(S) URLs and hands them to
    // shell.openExternal(); in localhost mode, the browser opens a normal tab.
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const menuEntries = (): MenuEntry[] => [
    { label: t("Ny nettleserfane"), icon: IconPlus, keys: "browser.newTab", run: () => newTab(false), disabled: tabs().length >= MAX_TABS },
    { label: panelFull() ? t("Avslutt fullvisning") : t("Fullvisning"), icon: panelFull() ? IconExitFullView : IconFullView, run: () => setPanelFull(!panelFull()) },
    { label: t("Åpne i standardnettleseren"), icon: IconExternal, run: openInSystemBrowser, disabled: !externalUrl() },
    "sep",
    { label: t("Finn på siden"), icon: IconSearch, run: openFind, disabled: !hasPage() || blank() },
    {
      custom: () => (
        <div class="browser-zoom-row">
          <span class="menu-name">{t("Zoom")}</span>
          <button type="button" class="icon-button" aria-label={t("Zoom ut")} disabled={zoom() === ZOOMS[0]} onClick={() => zoomStep(-1)}>−</button>
          <button type="button" class="browser-zoom-value" title={t("Tilbake til 100 %")} aria-label={t("Faktisk størrelse")} onClick={() => setZoom(1)}>{Math.round(zoom() * 100)} %</button>
          <button type="button" class="icon-button" aria-label={t("Zoom inn")} disabled={zoom() === ZOOMS.at(-1)} onClick={() => zoomStep(1)}>+</button>
        </div>
      ),
    },
    { label: t("Ta et skjermbilde"), icon: IconImage, run: screenshot, disabled: !hasPage() || blank() },
    "sep",
    { label: t("Historikk"), icon: IconHistory, children: historyEntries() },
    {
      label: t("Bokmerker"),
      icon: IconBookmark,
      children: bookmarks().length
        ? bookmarks().slice(0, 30).map((b) => ({ label: b.title, hint: hostOf(b.url), title: b.folder ? `${b.folder}\n${b.url}` : b.url, run: () => go(b.url) }))
        : [{ label: t("Ingen bokmerker ennå"), disabled: true }, "sep", { label: t("Importer fra Chrome…"), run: openChromeImport }],
    },
    { label: t("Nedlastinger"), icon: IconDownload, hint: activeDownloads() ? t("{count} pågår", { count: activeDownloads() }) : undefined, run: () => setShowDownloads(true) },
    { label: t("Importer fra Chrome…"), icon: IconBookmark, run: openChromeImport },
    { label: t("Tøm nettlesingsdata…"), icon: IconTrash, run: clearData },
  ];

  const blank = () => !state() || state()!.url === "about:blank" || state()!.url === "";
  const playtestUrl = () => {
    const p = app.playtest[props.projectId];
    return p?.status === "running" ? p.url : undefined;
  };

  // Ny fane's suggestions, built from your projects: this project's running servers, artifacts and
  // recent pages first, then the other projects', then bookmarks imported from Chrome.
  const suggestions = createMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const add = (item: Suggestion) => {
      if (seen.has(item.url) || out.length >= 40) return;
      seen.add(item.url);
      out.push(item);
    };
    const here = props.projectId === LOCAL_SCOPE ? null : props.projectId;
    const projectIds = [here, ...Object.keys(app.projects).filter((id) => id !== here)];
    const play = playtestUrl();
    if (play) add({ url: play, label: t("Playtest"), hint: hostOf(play), kind: "server", projectId: here });
    for (const id of projectIds) {
      const name = id ? app.projects[id]?.name : undefined;
      // A server once: Playtest's is already there under its own name.
      for (const server of servers().filter((s) => s.projectId === id && (!play || originOf(s.url) !== originOf(play)))) {
        add({ url: server.url, label: name ? `${name} · ${server.port}` : hostOf(server.url), hint: hostOf(server.url), kind: "server", projectId: id });
      }
      for (const artifact of artifacts().filter((a) => a.projectId === id).slice(0, 6)) {
        add({ url: artifact.previewUrl, label: artifact.title, hint: name ? t("Artifact · {name}", { name }) : t("Artifact"), kind: "artifact", projectId: id });
      }
      const visits = id === props.projectId ? history() : id ? loadHistory(id) : [];
      for (const v of visits.slice(0, id === props.projectId ? 12 : 4)) add({ url: v.url, label: v.title || hostOf(v.url), hint: hostOf(v.url), kind: "history", projectId: id });
    }
    if (props.projectId === LOCAL_SCOPE) for (const v of history().slice(0, 12)) add({ url: v.url, label: v.title || hostOf(v.url), hint: hostOf(v.url), kind: "history" });
    for (const b of bookmarks().slice(0, 16)) add({ url: b.url, label: b.title, hint: hostOf(b.url), kind: "bookmark" });
    return out;
  });

  // The tools on Ny fane, with their keys.
  const tools = (): Array<{ id: string; label: string; icon: (p: { size?: number }) => JSX.Element; keys?: string; title?: string; run: () => void }> => [
    { id: "files", label: t("Filer"), icon: IconFile, keys: "panel.files", run: () => actions.showTab("files") },
    { id: "terminal", label: t("Terminal"), icon: IconTerminal, keys: "panel.terminal", run: () => actions.showTab("terminal") },
    { id: "changes", label: t("Endringer"), icon: IconDiff, keys: "panel.changes", run: () => actions.showTab("changes") },
    {
      id: "side",
      label: t("Sidechat"),
      icon: IconPlusCircle,
      keys: "thread.side",
      title: t("En ny tråd ved siden av den du har åpen"),
      run: () => {
        const thread = focusedThread();
        if (thread?.mode === "code" && (thread.projectId ?? LOCAL_SCOPE) === props.projectId) void sideChat(thread);
        else actions.newThread();
      },
    },
  ];

  // How much fits in the width of Ny fane. Tools are at least 150 px; the suggestions are tiles of at
  // least 92 px in two rows. What does not fit goes behind one ⋯, which is only there when needed.
  let newtab: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(0);
  const GAP = 8;
  const toolsShown = createMemo(() => {
    const all = tools();
    const w = width();
    if (!w) return { shown: all, rest: [] as typeof all, compact: false };
    const fits = (n: number) => n * 150 + (n - 1) * GAP;
    let n = all.length;
    if (fits(n) > w) {
      n = all.length - 1;
      while (n > 1 && fits(n) + GAP + 32 > w) n--;
    }
    // The keys go when a tool is too narrow to show them beside its name; the tip still has them.
    const each = (w - (n < all.length ? 32 + GAP : 0) - (n - 1) * GAP) / n;
    return { shown: all.slice(0, n), rest: all.slice(n), compact: each < 200 };
  });
  const tileColumns = createMemo(() => Math.max(2, Math.floor((width() + GAP) / (92 + GAP)) || 4));
  const suggestionsShown = createMemo(() => {
    const all = suggestions();
    const room = tileColumns() * 2;
    if (all.length <= room) return { shown: all, rest: [] as Suggestion[] };
    return { shown: all.slice(0, room - 1), rest: all.slice(room - 1) };
  });
  const [moreTools, setMoreTools] = createSignal<MenuAnchor | null>(null);
  const [moreSites, setMoreSites] = createSignal<MenuAnchor | null>(null);
  const [tipHidden, setTipHidden] = createSignal((() => {
    try {
      return localStorage.getItem(TIP_KEY) === "hidden";
    } catch {
      return false;
    }
  })());
  // SPEC 29.2: without Chromium's sandbox the Electron app keeps web pages out of its window, and
  // this panel shows the server's headless Chrome instead. Sites can tell, and some turn it away (a
  // check that the visitor is a person, for one). One line says so here, where it is met, with the
  // way to Innstillinger → Om and its command, until it is dismissed.
  const [sandbox] = createResource(() => desktop?.sandbox?.() ?? Promise.resolve(null));
  const [fallbackHidden, setFallbackHidden] = createSignal((() => {
    try {
      return localStorage.getItem(FALLBACK_KEY) === "hidden";
    } catch {
      return false;
    }
  })());
  const hideFallback = () => {
    setFallbackHidden(true);
    try {
      localStorage.setItem(FALLBACK_KEY, "hidden");
    } catch {
      // Hidden for now.
    }
  };
  const hideTip = () => {
    setTipHidden(true);
    try {
      localStorage.setItem(TIP_KEY, "hidden");
    } catch {
      // Hidden for now.
    }
  };
  createEffect(() => {
    if (surfaceActive()) return;
    setMenu(null);
    setHistoryMenu(null);
    setMoreTools(null);
    setMoreSites(null);
    setShowDownloads(false);
  });
  const showNewtab = () => blank() && !closed() && !navigationError() && !!state();

  createEffect(watch(showNewtab, (shown) => {
    if (!shown) return;
    requestAnimationFrame(() => {
      if (!newtab) return;
      const stop = observeResize(newtab, (entry) => setWidth(Math.round(entry.contentRect.width)));
      onCleanup(stop);
    });
  }));

  const FullButton = () => (
    <button
      type="button"
      class="icon-button browser-full"
      aria-label={panelFull() ? t("Avslutt fullvisning") : t("Fullvisning")}
      title={panelFull() ? t("Avslutt fullvisning") : t("Fullvisning: panelet over hele bredden")}
      aria-pressed={panelFull()}
      onClick={() => setPanelFull(!panelFull())}
    >
      <Show when={panelFull()} fallback={<IconFullView size={15} />}><IconExitFullView size={15} /></Show>
    </button>
  );

  const sessionOwner = {};
  createEffect(() => {
    publishPanelSessions(props.projectId, "browser", { owner: sessionOwner, create: () => newTab(), tabs: tabs().map((tab) => ({
      id: tab.id, title: tabLabel(tab), active: tab.id === active(),
      select: () => { showPanel("browser"); showTab(tab.id); }, close: () => closeTab(tab.id),
    })) });
  });
  onCleanup(() => releasePanelSessions(props.projectId, "browser", sessionOwner));

  const tabList = () => (
        <div
          class="browser-tablist"
          role="tablist"
          aria-label={t("Faner i nettleseren")}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
            const list = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".browser-tab-main")];
            const at = list.indexOf(document.activeElement as HTMLButtonElement);
            if (at < 0) return;
            e.preventDefault();
            const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
            list[next]?.focus();
          }}
        >
          <For each={tabs()}>
            {(tab) => (
              <div class="browser-tab" classList={{ active: tab.id === active() }} data-tab={tab.id} data-fresh={tab.id === fresh() ? "" : undefined} title={`${tabLabel(tab)}${isBlank(tab.url) ? "" : `\n${tab.url}`}`}>
                <button
                  type="button"
                  role="tab"
                  class="browser-tab-main"
                  aria-selected={tab.id === active()}
                  tabindex={tab.id === active() ? 0 : -1}
                  onClick={() => showTab(tab.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeTab(tab.id);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Delete") {
                      e.preventDefault();
                      closeTab(tab.id);
                    }
                  }}
                >
                  <TabIcon tab={tab} />
                  <span class="browser-tab-title">{tabLabel(tab)}</span>
                </button>
                <button type="button" class="browser-tab-close" tabindex="-1" aria-label={t("Lukk fanen {title}", { title: tabLabel(tab) })} onClick={() => closeTab(tab.id)}><IconClose size={12} /></button>
              </div>
            )}
          </For>
          <Show when={focusedTab() && focusedTab()!.id !== active()}>
            <button type="button" class="icon-button" aria-label={t("Vis fanen til denne tråden")} title={t("Vis fanen til denne tråden")} onClick={() => { const tab = focusedTab(); if (tab) showTab(tab.id); }}><IconGlobe size={15} /></button>
          </Show>
          <NewTabButton active={surfaceActive()} onNew={newTab} disabled={tabs().length >= MAX_TABS} />
        </div>
  );

  return (
    <div class="browser-panel" data-testid="browser-panel">
      <Show when={!props.sharedTabs}><Show when={props.head?.()} fallback={<div class="browser-tabs">{tabList()}<FullButton /></div>}>
        {(head) => <Portal mount={head()}><div class="browser-tabs in-head">{tabList()}</div></Portal>}
      </Show></Show>
      <form class="browser-bar" onSubmit={navigate}>
        <Show when={props.sharedTabs}><FullButton /></Show>
        <span class="browser-nav">
          <button type="button" class="icon-button" aria-label={t("Tilbake")} title={t("Tilbake")} disabled={!state()?.canGoBack} onClick={() => sendTab({ type: "browser.history", projectId: props.projectId, action: "back" })}><IconBack size={15} /></button>
          <button type="button" class="icon-button browser-forward" aria-label={t("Frem")} title={t("Frem")} disabled={!state()?.canGoForward} onClick={() => sendTab({ type: "browser.history", projectId: props.projectId, action: "forward" })}><IconForward size={15} /></button>
          <button type="button" class="icon-button" aria-label={t("Last på nytt")} title={t("Last siden på nytt")} onClick={() => sendTab({ type: "browser.history", projectId: props.projectId, action: "reload" })}><IconReload size={15} /></button>
        </span>
        <input
          ref={addressInput}
          class="input address"
          aria-label={t("Adresse")}
          placeholder={t("Søk eller skriv nettadresse")}
          autocomplete="off"
          enterkeyhint="go"
          spellcheck={false}
          value={address()}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onInput={(e) => setAddress(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editing()) {
              setAddress(blank() ? "" : state()?.url ?? "");
              e.currentTarget.blur();
            }
          }}
        />
        <button type="button" class="icon-button browser-history-button" aria-label={t("Nettleserhistorikk")} title={t("Historikk")} aria-haspopup="menu" aria-expanded={!!historyMenu()} onClick={(e) => { setMenu(null); setHistoryMenu(historyMenu() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() }); }}><IconHistory size={15} /></button>
        <Show when={historyMenu()}>{(anchor) => <ContextMenu anchor={anchor()} label={t("Nettleserhistorikk")} entries={historyEntries()} onClose={() => setHistoryMenu(null)} class="browser-history-menu" />}</Show>
        <AnnotateButton active={surfaceActive()} projectId={props.projectId} tab={active} ready={() => hasPage() && !blank()} url={() => state()?.url ?? ""} />
        <button
          type="button"
          class="icon-button browser-downloads-button"
          aria-label={t("Nedlastinger")}
          title={activeDownloads() ? t("Nedlastinger: {count} pågår", { count: activeDownloads() }) : t("Nedlastinger")}
          aria-pressed={showDownloads()}
          onClick={() => setShowDownloads(!showDownloads())}
        >
          <IconDownload size={15} />
          <Show when={activeDownloads()}><span class="browser-download-dot" aria-hidden="true" /></Show>
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label={t("Mer for nettleseren")}
          title={t("Mer: faner, finn, zoom, skjermbilde, historikk og bokmerker")}
          aria-haspopup="menu"
          aria-expanded={!!menu()}
          onClick={(e) => setMenu(menu() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}
        >
          <IconDots size={15} />
        </button>
        <Show when={menu()}>{(anchor) => <ContextMenu anchor={anchor()} label={t("Nettlesermeny")} entries={menuEntries()} onClose={() => setMenu(null)} class="browser-menu" />}</Show>
      </form>
      <Show when={finding()}>
        <form class="browser-find" role="search" aria-label={t("Finn på siden")} onSubmit={(e) => { e.preventDefault(); find(false); }}>
          <IconSearch size={14} />
          <input
            class="search-input"
            aria-label={t("Finn på siden")}
            placeholder={t("Finn på siden")}
            value={findText()}
            classList={{ miss: findMiss() }}
            onInput={(e) => { setFindText(e.currentTarget.value); setFindMiss(false); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setFinding(false); }
              if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); find(true); }
            }}
          />
          <Show when={findMiss()}><span class="browser-find-miss" role="status">{t("Ikke funnet")}</span></Show>
          <button type="button" class="icon-button" aria-label={t("Forrige treff")} onClick={() => find(true)}><span class="rot-up"><IconChevron size={13} /></span></button>
          <button type="button" class="icon-button" aria-label={t("Neste treff")} onClick={() => find(false)}><span class="rot-down"><IconChevron size={13} /></span></button>
          <button type="button" class="icon-button" aria-label={t("Lukk søket på siden")} onClick={() => setFinding(false)}><IconClose size={13} /></button>
        </form>
      </Show>
      <Show when={sandbox()?.on === false && !fallbackHidden()}>
        <div class="newtab-tip browser-fallback-note" role="note" data-testid="browser-fallback-note">
          <IconGlobe size={15} />
          <span>{t("Uten Chromium-sandkassen vises sidene her fra en hodeløs Chrome, som noen nettsteder avviser, for eksempel når de sjekker at du er et menneske. Innstillinger → Om viser hvordan sandkassen slås på.")}</span>
          <button type="button" class="btn btn-small" onClick={() => setSettingsOpen("about")}>{t("Innstillinger")}</button>
          <button type="button" class="icon-button" aria-label={t("Skjul tipset")} title={t("Skjul tipset")} onClick={hideFallback}><IconClose size={13} /></button>
        </div>
      </Show>
      <div class="browser-stage" ref={stage}>
        <Show when={showDownloads()}><DownloadsList onClose={() => setShowDownloads(false)} /></Show>
        <canvas
          ref={canvas}
          class="browser-canvas"
          tabindex="0"
          aria-label={t("Nettsiden")}
          data-testid="browser-canvas"
          classList={{ hidden: !hasFrame() || native() || !!navigationError() }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId) /* a drag that ends outside the page still ends */}
          onMouseDown={(e) => mouse("down", e)}
          onMouseUp={(e) => mouse("up", e)}
          onMouseMove={(e) => {
            pendingMove = e;
            onNextFrame(flushMove);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => key("down", e)}
          onKeyUp={(e) => key("up", e)}
          on:wheel={{
            passive: true,
            handleEvent: (e: WheelEvent) => input({ kind: "wheel", ...toPage(e), deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiers(e) }),
          }}
        />
        <Show when={showNewtab()}>
          <div class="browser-newtab" data-testid="browser-newtab" ref={newtab}>
            {/* Chat has the Browser panel only, so the tools are Kode's. */}
            <Show when={mode() === "code" && app.settings.panelNewTab !== "browser"}>
            <h3 class="newtab-title">{t("Verktøy")}</h3>
            <div class="newtab-tools" classList={{ compact: toolsShown().compact }}>
              <For each={toolsShown().shown}>
                {(tool) => (
                  <button type="button" class="newtab-tool" title={tool.title ?? (toolsShown().compact && tool.keys ? `${tool.label} (${displayKeys(keysFor(tool.keys))})` : undefined)} onClick={tool.run}>
                    <tool.icon size={15} /><span>{tool.label}</span>
                    <Show when={tool.keys && keysFor(tool.keys!)}><kbd class="menu-keys">{displayKeys(keysFor(tool.keys!))}</kbd></Show>
                  </button>
                )}
              </For>
              <Show when={toolsShown().rest.length}>
                <button
                  type="button"
                  class="icon-button newtab-more"
                  aria-label={t("Flere verktøy")}
                  title={t("Flere verktøy")}
                  aria-haspopup="menu"
                  aria-expanded={!!moreTools()}
                  onClick={(e) => setMoreTools(moreTools() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect() })}
                >
                  <IconDots size={15} />
                </button>
              </Show>
              <Show when={moreTools()}>
                {(anchor) => <ContextMenu anchor={anchor()} label={t("Flere verktøy")} entries={toolsShown().rest.map((t) => ({ label: t.label, icon: t.icon, keys: t.keys, run: t.run }))} onClose={() => setMoreTools(null)} />}
              </Show>
            </div>
            </Show>
            <h3 class="newtab-title">{t("Foreslått")}</h3>
            <Show
              when={suggestions().length}
              fallback={<p class="newtab-empty">{t("Servere som kjører, artifacts og sider du besøker i prosjektene dine, foreslås her.")}</p>}
            >
              <div class="newtab-suggestions" style={`--cols:${tileColumns()}`}>
                <For each={suggestionsShown().shown}>
                  {(s) => (
                    <button type="button" class="newtab-site" data-kind={s.kind} title={s.url} onClick={() => go(s.url)}>
                      <span class="newtab-site-icon"><SuggestionIcon item={s} size={20} /></span>
                      <span class="newtab-site-label">{s.label}</span>
                      <span class="newtab-site-host">{s.hint}</span>
                    </button>
                  )}
                </For>
                <Show when={suggestionsShown().rest.length}>
                  <button
                    type="button"
                    class="newtab-site newtab-site-more"
                    aria-haspopup="menu"
                    aria-expanded={!!moreSites()}
                    onClick={(e) => setMoreSites(moreSites() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}
                  >
                    <span class="newtab-site-icon"><IconDots size={18} /></span>
                    <span class="newtab-site-label">{t("Flere")}</span>
                    <span class="newtab-site-host">{t("{count} til", { count: suggestionsShown().rest.length })}</span>
                  </button>
                </Show>
              </div>
              <Show when={moreSites()}>
                {(anchor) => (
                  <ContextMenu
                    anchor={anchor()}
                    label={t("Flere forslag")}
                    class="newtab-more-menu"
                    entries={suggestionsShown().rest.map((s) => ({ label: s.label, hint: s.hint, title: s.url, icon: s.kind === "artifact" ? IconArtifact : s.kind === "bookmark" ? IconBookmark : IconGlobe, run: () => go(s.url) }))}
                    onClose={() => setMoreSites(null)}
                  />
                )}
              </Show>
            </Show>
            <Show when={!tipHidden() && imported() && !imported()!.importedAt}>
              <div class="newtab-tip" role="note" aria-label={t("Tips: importer fra Chrome")}>
                <IconBookmark size={15} />
                <span>{t("Har du bokmerker i Chrome? Ta dem med hit, så blir de foreslått her.")}</span>
                <button type="button" class="btn btn-small" onClick={openChromeImport}>{t("Importer…")}</button>
                <button type="button" class="icon-button" aria-label={t("Skjul tipset")} title={t("Skjul tipset")} onClick={hideTip}><IconClose size={13} /></button>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={native() && !showNewtab() ? still() : null}>
          {(picture) => <img class="browser-still" src={picture().url} alt="" aria-hidden="true" draggable={false} style={`position:absolute;left:0;top:0;width:${picture().width}px;height:${picture().height}px;max-width:none;pointer-events:none;user-select:none`} />}
        </Show>
        <Show when={navigationError()}>
          <div class="browser-navigation-error" role="alert">
            <IconGlobe size={24} /><h3>{t("Kunne ikke åpne siden")}</h3><p>{navigationError()}</p>
            <button type="button" class="btn btn-small" onClick={() => { const request = retryByTab.get(active() ?? ""); if (request) sendBrowser(request); else open(); }}>{t("Prøv igjen")}</button>
          </div>
        </Show>
        <Show when={!hasPage() && !showNewtab() && !navigationError()}>
          <div class="browser-empty">
            {closed() ? (
              <>
                <p>{t("Nettleseren ble lukket fordi ingen har brukt den på en stund.")}</p>
                <button type="button" class="btn btn-small" onClick={open}>{t("Start igjen")}</button>
              </>
            ) : (
              <p>{t("Starter nettleseren…")}</p>
            )}
          </div>
        </Show>
      </div>
    </div>
  );
}
