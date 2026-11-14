// Small helpers for styles/motion.css. Nothing here runs per frame: each listener does a little work
// once per click, and the motion itself is CSS or a single Web Animation on the compositor.
//
// - data-motion-ready on <html> once the app has settled, so panels that are open at start do not
//   slide in on the first frame.
// - data-unfold for a moment on the element around a button with aria-expanded that was just
//   clicked, so only what the user folds out animates, never what mounts open or mounts again
//   while scrolling.
// - The gliding marker in segmented controls and tabs: a copy of the chosen background moves from
//   the old choice to the new one with transform, and the real one is hidden meanwhile.
import { onCleanup } from "solid-js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
export const motionOff = (): boolean => reduced.matches || document.documentElement.dataset.motion === "reduce";

const UNFOLD_MS = 400;
// The buttons that fold something out next to them: the body is a sibling of the button, or of its
// parent (a project in the sidebar).
const FOLDS = ".fold, .steps-head, .agents-head, .bg-head, .pinned-head, .group-toggle, .smart-group-head";
const GLIDE_MS = 200;

// Container, and how its chosen item is marked. Settings navigation stays immediate: its
// selection must match the newly mounted page throughout rapid pointer and keyboard switches.
const GLIDES: Array<[string, string]> = [
  [".mode-switch", '.mode-button[aria-pressed="true"]'],
  [".segmented", '.segment[aria-pressed="true"]'],
  [".panel-tabs", '.panel-tab[aria-selected="true"]'],
  [".palette-tabs", '.palette-tab[aria-selected="true"]'],
  [".stats-tabs", '[aria-selected="true"]'],
  [".stats-ranges", '[aria-pressed="true"]'],
  [".profile-views", '[aria-selected="true"]'],
  [".queue-switch", '[aria-pressed="true"]'],
  [".profile-theme-switch", '[aria-pressed="true"]'],
  [".pane-tabs", ".pane-tab.on"],
];
const CONTAINERS = GLIDES.map(([c]) => c).join(", ");

interface Pending {
  container: HTMLElement;
  selected: string;
  from: HTMLElement;
  rect: DOMRect;
}

function glide(p: Pending): void {
  const to = p.container.querySelector<HTMLElement>(p.selected);
  if (!to || to === p.from || !p.container.isConnected || p.container.classList.contains("gliding")) return;
  const box = p.container.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const a = p.rect;
  if (!b.width || !b.height || !a.width || !a.height) return;
  const style = getComputedStyle(to);
  const ghost = document.createElement("span");
  ghost.className = "glide-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const left = b.left - box.left - p.container.clientLeft + p.container.scrollLeft;
  const top = b.top - box.top - p.container.clientTop + p.container.scrollTop;
  Object.assign(ghost.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${b.width}px`,
    height: `${b.height}px`,
    background: style.backgroundColor,
    boxShadow: style.boxShadow,
    borderRadius: style.borderRadius,
  });
  const restorePosition = getComputedStyle(p.container).position === "static";
  if (restorePosition) p.container.style.position = "relative";
  p.container.classList.add("gliding");
  p.container.prepend(ghost);
  const from = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
  const done = () => {
    ghost.remove();
    p.container.classList.remove("gliding");
    if (restorePosition) p.container.style.position = "";
  };
  const animation = ghost.animate([{ transform: from }, { transform: "none" }], { duration: GLIDE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  animation.onfinish = done;
  animation.oncancel = done;
}

export function MotionHost() {
  // Ready after the first frames, when the bootstrap and the stored layout have been applied.
  let ready = 0;
  const timer = setTimeout(() => {
    ready = requestAnimationFrame(() => document.documentElement.setAttribute("data-motion-ready", ""));
  }, 600);

  const marked = new Map<Element, ReturnType<typeof setTimeout>>();
  const mark = (el: Element | null) => {
    if (!el) return;
    clearTimeout(marked.get(el));
    el.setAttribute("data-unfold", "");
    marked.set(el, setTimeout(() => {
      el.removeAttribute("data-unfold");
      marked.delete(el);
    }, UNFOLD_MS));
  };

  let pending: Pending | null = null;
  const remember = (target: EventTarget | null) => {
    pending = null;
    if (motionOff()) return;
    const container = (target as Element | null)?.closest?.<HTMLElement>(CONTAINERS);
    if (!container) return;
    const selected = GLIDES.find(([c]) => container.matches(c))![1];
    const from = container.querySelector<HTMLElement>(selected);
    if (from) pending = { container, selected, from, rect: from.getBoundingClientRect() };
  };

  // Before the app's own handlers, which are delegated to the document too. Only a fold button that
  // is about to open, so a body that is already open never starts over.
  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest?.(FOLDS);
    if (button?.getAttribute("aria-expanded") === "false" && !motionOff()) {
      mark(button.parentElement);
      mark(button.parentElement?.parentElement ?? null);
    }
    if (event.detail === 0) remember(event.target); // a click from the keyboard
    const p = pending;
    pending = null;
    if (p) requestAnimationFrame(() => glide(p));
  };
  const onDown = (event: PointerEvent) => remember(event.target);
  const onKey = (event: KeyboardEvent) => {
    if (!/^Arrow|^Home$|^End$/.test(event.key)) return;
    remember(event.target);
    const p = pending;
    pending = null;
    if (p) requestAnimationFrame(() => glide(p));
  };

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  onCleanup(() => {
    clearTimeout(timer);
    cancelAnimationFrame(ready);
    for (const t of marked.values()) clearTimeout(t);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  });
  return null;
}
