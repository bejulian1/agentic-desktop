// SPEC 29.3: in the Electron app the Browser panel's page is a real view in the window
// (desktop/browser-view.ts), drawn above this page. This file keeps it on the panel's stage: it
// sends the stage's rectangle to the app when the panel moves or changes size (stacked panels,
// full view, the side panel and the sidebar), and nothing when the page should not show.
//
// A native view is always on top of the HTML, so a menu, tooltip, dialog or toast over the stage
// would end up under it. While one does, the page is shown as a still picture instead: the app
// takes the picture, the panel shows it in the same place, and then the view steps aside. When the
// menu goes, the view comes back and the picture goes.
//
// In a browser (npm start) there is no bridge and nothing here runs.
import { desktop } from "../lib/desktop";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NativeBridge {
  place: (projectId: string, tabId: string, rect: Rect | null, zoom?: number) => void;
  freeze: (projectId: string, tabId: string) => Promise<string | null>;
}

export const nativeBridge: NativeBridge | undefined = (desktop as unknown as { browserPanel?: NativeBridge } | undefined)?.browserPanel;

// What can lie over the panel. A modal dialog covers everything with its backdrop.
const OVERLAYS = '.popover, .context-menu, .response-selection, .app-tooltip.visible, dialog[open], .toast, .annotate, .browser-downloads, [role="menu"], [role="listbox"], [role="tooltip"]';
const FOLLOW_MS = 450; // after a change, follow the stage this long, for slides and other motion
const CHECK_MS = 700; // and look now and then for moves that change no size

function overlaps(a: DOMRect, b: Rect): boolean {
  return a.left < b.x + b.width && b.x < a.right && a.top < b.y + b.height && b.y < a.bottom;
}

function shows(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01;
}

function covered(stage: HTMLElement, rect: Rect): boolean {
  for (const el of document.querySelectorAll(OVERLAYS)) {
    if (el instanceof HTMLDialogElement && el.open && el.matches(":modal")) return true;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || !overlaps(box, rect)) continue;
    // The stage's own content is not a cover, except the downloads list over the page.
    if (stage.contains(el) && !el.matches(".browser-downloads")) continue;
    if (shows(el)) return true;
  }
  return false;
}

function mayCover(node: Node): boolean {
  return node instanceof Element && (node.matches(OVERLAYS) || node.matches(".app-tooltip") || !!node.querySelector(OVERLAYS));
}

export interface NativePlacement {
  measure: () => void;
  stop: () => void;
}

// Keeps the page for `tab` on `stage` while `wanted` says it should show.
export function placeNative(options: {
  stage: HTMLElement;
  projectId: string;
  tab: () => string | null;
  wanted: () => boolean;
  zoom: () => number;
  still: (url: string | null) => void;
}): NativePlacement {
  const bridge = nativeBridge!;
  const { stage, projectId } = options;
  let placedTab: string | null = null; // the tab the app shows now, if any
  let lastKey = "";
  let frozen: string | null = null; // the tab shown as a picture
  let freezing = 0;
  let frame = 0;
  let followUntil = 0;
  let stopped = false;

  const hide = () => {
    if (placedTab !== null) bridge.place(projectId, placedTab, null);
    placedTab = null;
    lastKey = "";
  };

  const unfreeze = () => {
    if (frozen === null) return;
    frozen = null;
    freezing += 1;
    // The picture goes once the view is back over it.
    requestAnimationFrame(() => requestAnimationFrame(() => frozen === null && options.still(null)));
  };

  const freeze = (tab: string) => {
    if (frozen === tab) return;
    frozen = tab;
    const mine = ++freezing;
    if (placedTab !== tab) return hide(); // nothing on screen to take a picture of
    void bridge.freeze(projectId, tab).then((url) => {
      if (stopped || mine !== freezing || frozen !== tab) return;
      if (!url) return hide();
      options.still(url);
      // Shown first, then the view steps aside, so the stage never flashes empty.
      const img = new Image();
      img.src = url;
      void img.decode().catch(() => undefined).then(() => requestAnimationFrame(() => {
        if (!stopped && mine === freezing && frozen === tab) hide();
      }));
    });
  };

  const measure = () => {
    if (stopped) return;
    const tab = options.tab();
    if (tab === null || !options.wanted()) {
      frozen = null;
      options.still(null);
      return hide();
    }
    if (placedTab !== null && placedTab !== tab) hide();
    const box = stage.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) {
      frozen = null;
      options.still(null);
      return hide();
    }
    const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
    if (covered(stage, rect)) return freeze(tab);
    const zoom = options.zoom();
    const key = `${tab}|${Math.round(rect.x)}|${Math.round(rect.y)}|${Math.round(rect.width)}|${Math.round(rect.height)}|${zoom}`;
    if (key !== lastKey || placedTab !== tab) {
      bridge.place(projectId, tab, rect, zoom);
      placedTab = tab;
      lastKey = key;
    }
    unfreeze();
  };

  // Once per frame at most, and every frame for a while after a change, to follow motion.
  const tick = () => {
    frame = 0;
    measure();
    if (performance.now() < followUntil) frame = requestAnimationFrame(tick);
  };
  const soon = (follow = true) => {
    if (follow) followUntil = performance.now() + FOLLOW_MS;
    if (!frame) frame = requestAnimationFrame(tick);
  };

  // The stage and everything around it that can change its size or place.
  const resize = new ResizeObserver(() => soon());
  for (let el: Element | null = stage; el && el !== document.documentElement; el = el.parentElement) resize.observe(el);
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" ? mayCover(record.target) : [...record.addedNodes, ...record.removedNodes].some(mayCover)) return soon(false);
    }
  });
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "class"] });
  const onMotion = () => soon();
  addEventListener("resize", onMotion);
  document.addEventListener("transitionend", onMotion, true);
  document.addEventListener("animationend", onMotion, true);
  const timer = setInterval(() => soon(false), CHECK_MS);
  soon();

  return {
    measure: () => soon(),
    stop: () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearInterval(timer);
      resize.disconnect();
      mutations.disconnect();
      removeEventListener("resize", onMotion);
      document.removeEventListener("transitionend", onMotion, true);
      document.removeEventListener("animationend", onMotion, true);
      hide();
      options.still(null);
    },
  };
}
