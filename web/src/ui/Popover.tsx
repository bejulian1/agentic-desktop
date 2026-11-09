import { createEffect, onCleanup, Show, type JSX } from "solid-js";

// A menu anchored to its trigger. The document listener exists only while it is open.
export function Popover(props: { open: boolean; onClose: () => void; trigger: JSX.Element; children: JSX.Element; align?: "left" | "right"; fixed?: boolean; below?: boolean; class?: string }) {
  let root!: HTMLDivElement;
  // fixed: escapes a scrolling parent, and opens up or down depending on the room.
  const place = (element: HTMLElement) => {
    if (!props.fixed) return;
    const rect = root.getBoundingClientRect();
    element.style.right = `${innerWidth - rect.right}px`;
    if (rect.bottom > innerHeight - 180) element.style.bottom = `${innerHeight - rect.top + 4}px`;
    else element.style.top = `${rect.bottom + 4}px`;
    // Kept inside the window: a wide popover from a button near the left edge moves right.
    queueMicrotask(() => {
      const width = element.offsetWidth;
      if (!width || rect.right - width >= 8) return;
      element.style.right = "auto";
      element.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    });
  };
  createEffect(() => {
    if (!props.open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) props.onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    });
  });
  return (
    <div class={`popover-anchor ${props.class ?? ""}`} ref={root}>
      {props.trigger}
      <Show when={props.open}>
        <div class="popover" classList={{ right: props.align === "right", fixed: props.fixed, below: props.below }} ref={place}>{props.children}</div>
      </Show>
    </div>
  );
}
