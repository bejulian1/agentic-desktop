import { createEffect, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

// A menu anchored to its trigger. The document listener exists only while it is open.
export function Popover(props: { open: boolean; onClose: () => void; trigger: JSX.Element; children: JSX.Element; align?: "left" | "right"; fixed?: boolean; portal?: boolean; below?: boolean; returnFocus?: boolean; stable?: boolean; gap?: number; panelClass?: string; class?: string }) {
  let root!: HTMLDivElement;
  let popup: HTMLDivElement | undefined;
  // Fixed menus follow their trigger through panel and window resizes. Keep the opening side
  // throughout one visit, so filtering a list cannot flip it across the trigger.
  let opensAbove: boolean | undefined;
  const place = (element: HTMLElement) => {
    if (!props.fixed) return;
    const rect = root.getBoundingClientRect();
    // Existing fixed sidebar menus retain their positioning and DOM. Only portal menus opt in
    // to escaping pane containment and tracking the viewport.
    if (!props.portal) {
      element.style.right = `${innerWidth - rect.right}px`;
      if (rect.bottom > innerHeight - 180) element.style.bottom = `${innerHeight - rect.top + 4}px`;
      else element.style.top = `${rect.bottom + 4}px`;
      queueMicrotask(() => {
        const width = element.offsetWidth;
        if (!width || rect.right - width >= 8) return;
        element.style.right = "auto";
        element.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
      });
      return;
    }
    const margin = 8;
    const snap = (value: number) => props.stable ? Math.round(value * devicePixelRatio) / devicePixelRatio : value;
    const gap = props.gap ?? 6;
    const above = Math.max(0, rect.top - gap - margin);
    const below = Math.max(0, innerHeight - rect.bottom - gap - margin);
    opensAbove ??= !props.below && (above >= element.offsetHeight || above >= below);
    element.style.setProperty("--popover-room", `${opensAbove ? above : below}px`);
    const left = props.align === "right" ? rect.right - element.offsetWidth : rect.left;
    element.style.left = `${snap(Math.max(margin, Math.min(left, innerWidth - element.offsetWidth - margin)))}px`;
    element.style.right = "auto";
    element.style.top = opensAbove ? "" : `${snap(Math.max(margin, rect.bottom + gap))}px`;
    element.style.bottom = opensAbove ? `${snap(Math.max(margin, innerHeight - rect.top + gap))}px` : "";
  };
  createEffect(() => {
    if (!props.open) return;
    opensAbove = undefined;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => popup && place(popup));
    };
    const observer = props.fixed && props.portal ? new ResizeObserver(update) : undefined;
    if (observer) {
      observer.observe(root);
      if (popup) observer.observe(popup);
      update();
      window.addEventListener("resize", update);
      document.addEventListener("scroll", update, true);
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.contains(target) && !popup?.contains(target)) props.onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      props.onClose();
      if (props.returnFocus) {
        event.preventDefault();
        root.querySelector<HTMLButtonElement>(":scope > button")?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    });
  });
  const Panel = () => {
    let element!: HTMLDivElement;
    onMount(() => { if (props.portal) place(element); });
    return <div
      class={`popover ${props.panelClass ?? ""}`}
      classList={{ right: props.align === "right", fixed: props.fixed, below: props.below, "stable-geometry": props.stable }}
      ref={(node) => { popup = element = node; if (!props.portal) place(node); }}
    >{props.children}</div>;
  };
  return (
    <div class={`popover-anchor ${props.class ?? ""}`} ref={root}>
      {props.trigger}
      <Show when={props.open}>
        <Show when={props.fixed && props.portal} fallback={<Panel />}>
          <Portal><Panel /></Portal>
        </Show>
      </Show>
    </div>
  );
}
