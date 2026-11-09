// Round 10 (SPEC 23.10, 23.11): one IntersectionObserver for the moving parts of status text. An
// element gets data-visible while it is on screen; the shimmer only runs then (styles/motion.css),
// and the thinking card only moves its progress then. Off screen, in a pane under the Artifacts
// room or in a background tab, nothing is painted for them.
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

const listeners = new WeakMap<Element, (visible: boolean) => void>();
const observer = typeof IntersectionObserver === "undefined"
  ? null
  : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        entry.target.toggleAttribute("data-visible", entry.isIntersecting);
        listeners.get(entry.target)?.(entry.isIntersecting);
      }
    });

// For ref={whileVisible}: watched from mount to cleanup.
export function whileVisible(el: Element): void {
  if (!observer) return void el.setAttribute("data-visible", "");
  observer.observe(el);
  onCleanup(() => observer.unobserve(el));
}

// The same, as a signal, for work that is done in script.
export function visibleSignal(): [Accessor<boolean>, (el: Element) => void] {
  const [visible, setVisible] = createSignal(!observer);
  const ref = (el: Element) => {
    listeners.set(el, setVisible);
    whileVisible(el);
    onCleanup(() => listeners.delete(el));
  };
  return [visible, ref];
}

// Watched only while active() is true: a row that is done (most rows in a long thread) costs nothing.
export function observeWhile(active: () => boolean): (el: Element) => void {
  return (el) => {
    createEffect(() => {
      if (!active()) return el.removeAttribute("data-visible");
      if (!observer) return void el.setAttribute("data-visible", "");
      observer.observe(el);
      onCleanup(() => observer.unobserve(el));
    });
  };
}
