// One tooltip for the whole app. A few listeners on the document find the element under the pointer
// or with keyboard focus that has a title (or data-tip), and after a short pause show its text in a
// small fixed card, with the shortcut as a quiet key on the right. The title is taken off while the
// card shows, so the browser's own tip does not come as well. Nothing runs per pointer move: only
// when the pointer goes over a new element.
//
// data-tip: the text, instead of title. data-keys: a shortcut id from SHORTCUTS (shown with the
// keys the user has chosen) or keys as text. A title ending in "(Ctrl+K)" shows the part in
// brackets as keys too, so existing titles work as they are.
import { onCleanup } from "solid-js";
import { displayKeys, keysFor, SHORTCUTS } from "../state/shortcuts";

const DELAY_MS = 400;
// After a tip was on screen, the next one within this time shows at once, without the fade, so
// moving along a row of icons reads each one without waiting.
const WARM_MS = 300;
const SELECTOR = "[title], [data-tip]";
// v1.4.1: no tips in a thread row (the hover card already describes the thread) or in a context
// menu (its entries say what they do). The title is taken off there while the pointer is on it,
// so the browser's own tip stays away too.
const QUIET = ".thread-item, .context-menu";
const KEYS_IN_TITLE = /\s*\(((?:Ctrl|Alt|Shift|⌘|⌥|⇧|Mod)[^()]*)\)\s*$/;

interface Shown {
  el: HTMLElement;
  title: string | null; // taken off while shown
  addedLabel: boolean;
}

function textOf(el: HTMLElement): { text: string; keys: string } | null {
  const raw = el.dataset.tip ?? el.getAttribute("title") ?? "";
  if (!raw.trim()) return null;
  let text = raw.trim();
  let keys = "";
  const data = el.dataset.keys;
  if (data) keys = SHORTCUTS.some((s) => s.id === data) ? displayKeys(keysFor(data)) : data;
  const match = KEYS_IN_TITLE.exec(text);
  if (match) {
    text = text.slice(0, match.index);
    keys ||= match[1];
  }
  // A text button that already says it needs no tip.
  const own = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (own && own.toLocaleLowerCase("nb") === text.toLocaleLowerCase("nb") && !keys) return null;
  return { text, keys };
}

export function TooltipHost() {
  if (typeof window === "undefined" || matchMedia("(hover: none)").matches) return null;
  const tip = document.createElement("div");
  tip.className = "app-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.id = "app-tooltip";
  let shown: Shown | null = null;
  let pending: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A clicked element gets no tip until the pointer has left it.
  let pressed: HTMLElement | null = null;
  let warmUntil = 0;
  let muted: Shown | null = null;

  const unmute = () => {
    if (!muted) return;
    const { el, title, addedLabel } = muted;
    if (title !== null && !el.hasAttribute("title")) el.setAttribute("title", title);
    if (addedLabel) el.removeAttribute("aria-label");
    muted = null;
  };
  const mute = (el: HTMLElement) => {
    if (muted?.el === el) return;
    unmute();
    const title = el.getAttribute("title");
    if (title === null) return;
    // The title may be the element's only name: keep the name while the title is off.
    const addedLabel = !el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !(el.textContent ?? "").trim();
    if (addedLabel) el.setAttribute("aria-label", title);
    el.removeAttribute("title");
    muted = { el, title, addedLabel };
  };

  const restore = () => {
    if (!shown) return;
    const { el, title, addedLabel } = shown;
    if (title !== null && !el.hasAttribute("title")) el.setAttribute("title", title);
    if (addedLabel) el.removeAttribute("aria-label");
    el.removeAttribute("aria-describedby");
    shown = null;
  };

  const hide = () => {
    clearTimeout(timer);
    pending = null;
    if (shown) warmUntil = performance.now() + WARM_MS;
    restore();
    tip.classList.remove("visible");
    tip.remove();
  };

  const show = (el: HTMLElement, instant = false) => {
    if (!el.isConnected) return;
    const content = textOf(el);
    if (!content) return;
    restore();
    tip.classList.toggle("instant", instant);
    tip.textContent = "";
    const label = document.createElement("span");
    label.textContent = content.text;
    tip.append(label);
    if (content.keys) {
      const kbd = document.createElement("kbd");
      kbd.textContent = content.keys;
      tip.append(kbd);
    }
    // Inside a modal dialog the tip must be in the dialog too, or it ends up under it.
    (el.closest("dialog[open]") ?? document.body).append(tip);
    const title = el.getAttribute("title");
    let addedLabel = false;
    if (title !== null) {
      // The title may be the button's only name: keep the name while the title is off.
      if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !(el.textContent ?? "").trim()) {
        el.setAttribute("aria-label", title);
        addedLabel = true;
      }
      el.removeAttribute("title");
    }
    el.setAttribute("aria-describedby", tip.id);
    shown = { el, title, addedLabel };

    const r = el.getBoundingClientRect();
    tip.style.left = "0px";
    tip.style.top = "0px";
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let y = r.bottom + 6;
    if (y + h > innerHeight - 6) y = r.top - h - 6;
    const x = Math.min(Math.max(6, r.left + r.width / 2 - w / 2), innerWidth - w - 6);
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(Math.max(6, y))}px`;
    tip.classList.add("visible");
  };

  const schedule = (el: HTMLElement) => {
    if (pending === el || shown?.el === el || pressed === el) return;
    const warm = !!shown || performance.now() < warmUntil;
    hide();
    if (warm) return show(el, true);
    pending = el;
    timer = setTimeout(() => {
      if (pending === el) show(el);
    }, DELAY_MS);
  };

  const target = (node: EventTarget | null): HTMLElement | null => {
    const el = (node as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
    if (!el || el === tip || el.closest(".app-tooltip")) return null;
    return el;
  };

  const onOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const el = target(event.target);
    if (el?.closest(QUIET)) {
      if (pending || shown) hide();
      return mute(el);
    }
    unmute();
    if (el) schedule(el);
    else if (pending || shown) hide();
  };
  const onOut = (event: PointerEvent) => {
    if (muted && !muted.el.contains(event.relatedTarget as Node | null)) unmute();
    const current = shown?.el ?? pending;
    if (!current) return;
    const to = event.relatedTarget as Node | null;
    if (pressed && (!to || !pressed.contains(to))) pressed = null;
    if (!to || !current.contains(to)) hide();
  };
  const onFocus = (event: FocusEvent) => {
    const el = target(event.target);
    if (el && el === event.target && el.matches(":focus-visible") && !el.closest(QUIET)) schedule(el);
  };
  const onDown = (event: PointerEvent) => {
    pressed = target(event.target);
    hide();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (shown || pending)) hide();
  };

  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("focusin", onFocus, true);
  document.addEventListener("focusout", hide, true);
  document.addEventListener("keydown", onKey, true);
  // Scrolling fires often; with nothing shown or waiting there is nothing to hide.
  const onScroll = () => { if (shown || pending) hide(); };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  addEventListener("blur", hide);
  onCleanup(() => {
    hide();
    unmute();
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("focusin", onFocus, true);
    document.removeEventListener("focusout", hide, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("scroll", onScroll, true);
    removeEventListener("blur", hide);
  });
  return null;
}
