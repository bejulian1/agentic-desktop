// A menu that floats at a point or beside a button, with submenus that open to the side: the
// thread menu, the profile menu and the Browser panel's ⋯ menu. It lives in a portal, so no
// scrolling parent clips it. Arrows, Enter, → and ← and Esc work, and the document listeners exist
// only while it is open.
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { displayKeys, keysFor } from "../state/shortcuts";
import { IconCheck, IconChevron } from "./icons";

export type MenuEntry =
  | {
      label: string;
      icon?: (p: { size?: number }) => JSX.Element;
      keys?: string; // a shortcut id from SHORTCUTS
      hint?: string; // shown on the right instead of keys
      run?: () => unknown;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean; // one of a set, like a filter: a menuitemradio with a check
      chosen?: boolean; // the current choice in a submenu (menuitemradio), shown with a check too
      toggle?: boolean; // on or off (menuitemcheckbox), with a check at the end when on
      title?: string;
      children?: MenuEntry[];
    }
  | { heading: JSX.Element }
  | { custom: () => JSX.Element }
  | "sep";

export interface MenuAnchor {
  x: number;
  y: number;
  // A button the menu belongs to: the menu opens below it (or above when there is no room),
  // lined up with its right edge, or its left edge with alignLeft.
  rect?: DOMRect;
  alignLeft?: boolean;
  above?: boolean;
  // A fixed width, for a menu that fills a column (the profile menu fills the sidebar, SPEC 23.6).
  width?: number;
}

const MARGIN = 8;

function place(el: HTMLElement, anchor: MenuAnchor): void {
  if (anchor.width) {
    el.style.width = `${Math.round(anchor.width)}px`;
    el.style.minWidth = "0";
  }
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = anchor.x;
  let y = anchor.y;
  if (anchor.rect) {
    const r = anchor.rect;
    x = anchor.alignLeft ? r.left : r.right - w;
    y = anchor.above || r.bottom + h + MARGIN > innerHeight ? r.top - h - 4 : r.bottom + 4;
  } else if (y + h + MARGIN > innerHeight) y = Math.max(MARGIN, y - h);
  x = Math.min(Math.max(MARGIN, x), innerWidth - w - MARGIN);
  y = Math.min(Math.max(MARGIN, y), innerHeight - h - MARGIN);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

function items(root: HTMLElement): HTMLButtonElement[] {
  // Rows, and buttons inside custom rows (like the theme switch), in order.
  return [...root.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
}

function Level(props: { entries: MenuEntry[]; anchor: MenuAnchor; label: string; close: () => void; depth: number; onBack?: () => void; class?: string }) {
  let el!: HTMLDivElement;
  const [open, setOpen] = createSignal<{ index: number; anchor: MenuAnchor } | null>(null);

  const openSub = (index: number, button: HTMLElement, focus: boolean) => {
    const r = button.getBoundingClientRect();
    const right = r.right + 240 < innerWidth;
    setOpen({ index, anchor: { x: right ? r.right + 2 : r.left - 242, y: r.top - 4 } });
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.context-menu[data-depth="${props.depth + 1}"] .menu-item:not(:disabled)`)?.focus());
  };

  onMount(() => {
    place(el, props.anchor);
    // The current choice when there is one (a Select), else the first row.
    if (props.depth === 0) (el.querySelector<HTMLButtonElement>('.menu-item[role="menuitemradio"][aria-checked="true"]:not(:disabled)') ?? items(el)[0])?.focus({ preventScroll: true });
  });

  const onKey = (event: KeyboardEvent) => {
    const list = items(el);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 && !el.contains(document.activeElement)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      list[(at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (event.key === "ArrowRight") {
      const button = list[at];
      const index = Number(button?.dataset.index);
      const entry = props.entries[index];
      if (button && typeof entry === "object" && "label" in entry && entry.children) {
        event.preventDefault();
        event.stopPropagation();
        openSub(index, button, true);
      }
    } else if (event.key === "ArrowLeft" && props.onBack) {
      event.preventDefault();
      event.stopPropagation();
      props.onBack();
    }
  };

  return (
    <>
      <div ref={el} class={`popover context-menu ${props.class ?? ""}`} role="menu" data-depth={props.depth} aria-label={props.label} onKeyDown={onKey}>
        <For each={props.entries}>
          {(entry, i) => {
            if (entry === "sep") return <div class="menu-sep" role="separator" />;
            if ("heading" in entry) return <div class="context-heading" role="presentation">{entry.heading}</div>;
            if ("custom" in entry) return entry.custom();
            const keys = () => (entry.keys ? displayKeys(keysFor(entry.keys)) : entry.hint);
            return (
              <button
                type="button"
                class="menu-item"
                role={entry.toggle !== undefined ? "menuitemcheckbox" : entry.checked !== undefined || entry.chosen !== undefined ? "menuitemradio" : "menuitem"}
                aria-checked={entry.toggle ?? entry.checked ?? entry.chosen}
                classList={{ danger: entry.danger, selected: open()?.index === i() }}
                data-index={i()}
                disabled={entry.disabled}
                title={entry.title}
                aria-haspopup={entry.children ? "menu" : undefined}
                aria-expanded={entry.children ? open()?.index === i() : undefined}
                onPointerEnter={(e) => (entry.children ? openSub(i(), e.currentTarget, false) : setOpen(null))}
                onClick={(e) => {
                  if (entry.children) return openSub(i(), e.currentTarget, e.detail === 0);
                  props.close();
                  void entry.run?.();
                }}
              >
                <Show when={entry.icon} fallback={<Show when={entry.checked !== undefined}><span class="menu-check">{entry.checked ? <IconCheck size={14} /> : null}</span></Show>}>{(Icon) => Icon()({ size: 15 })}</Show>
                <span class="menu-name">{entry.label}</span>
                <Show when={entry.chosen || entry.toggle}><span class="menu-check menu-check-end"><IconCheck size={14} /></span></Show>
                <Show when={keys()}><kbd class="menu-keys">{keys()}</kbd></Show>
                <Show when={entry.children}><span class="context-chevron"><IconChevron size={12} /></span></Show>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={open()} keyed>
        {(sub) => {
          const entry = props.entries[sub.index];
          return typeof entry === "object" && "label" in entry && entry.children ? (
            <Level
              entries={entry.children}
              anchor={sub.anchor}
              label={entry.label}
              close={props.close}
              depth={props.depth + 1}
              onBack={() => {
                setOpen(null);
                items(el).find((b) => Number(b.dataset.index) === sub.index)?.focus();
              }}
            />
          ) : null;
        }}
      </Show>
    </>
  );
}

// mount: where the menu lives. Inside a modal dialog it must be in the dialog, or it is inert.
export function ContextMenu(props: { anchor: MenuAnchor; entries: MenuEntry[]; label: string; onClose: () => void; class?: string; mount?: Node; returnFocus?: boolean }) {
  let layer!: HTMLDivElement;
  const returnFocus = document.activeElement as HTMLElement | null;
  // Esc or a chosen item gives focus back to the button the menu came from (the ⋯ button, say).
  // Whether focus was in the menu is read before it closes: closing takes it out of the page.
  const close = () => {
    const inside = layer.contains(document.activeElement);
    const back = props.returnFocus !== false && inside && !!returnFocus?.isConnected && returnFocus !== document.body;
    // Focus goes back before the menu closes: some buttons are only shown while their menu is open
    // (the ⋯ on a thread row), and once hidden they cannot take focus.
    if (back) returnFocus!.focus({ preventScroll: true });
    props.onClose();
    if (back && returnFocus!.isConnected && document.activeElement !== returnFocus) returnFocus!.focus({ preventScroll: true });
  };
  const onDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (layer.contains(target)) return;
    // A press on the button the menu came from closes it, and the click that follows must not
    // open it again: that click is swallowed before it reaches the button.
    if (returnFocus?.hasAttribute("aria-haspopup") && returnFocus.contains(target)) {
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", swallow, true), 600);
    }
    props.onClose();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  const onBlur = () => props.onClose();
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("blur", onBlur);
  addEventListener("resize", onBlur);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("blur", onBlur);
    removeEventListener("resize", onBlur);
  });
  return (
    <Portal mount={props.mount}>
      <div ref={layer} class="context-layer" onContextMenu={(e) => e.preventDefault()}>
        <Level entries={props.entries} anchor={props.anchor} label={props.label} close={close} depth={0} class={props.class} />
      </div>
    </Portal>
  );
}
