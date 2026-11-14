// A choice from a short list, in the app's own style instead of a native <select>: a button with
// the current value and a chevron, and the same floating menu as the rest of the app, with a check
// on the current one. Arrows, Enter and Esc work, and Esc gives focus back to the button.
import { createEffect, createSignal, Show } from "solid-js";
import { ContextMenu, type MenuAnchor } from "./ContextMenu";
import { IconChevronDown } from "./icons";

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string; // a quiet word on the right, like «standard»
}

export function Select<T extends string | number | null>(props: {
  label: string; // the accessible name, usually the row title
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  active?: boolean; // A retained, hidden workspace must release its portal and keyboard listeners.
  class?: string;
}) {
  const [anchor, setAnchor] = createSignal<MenuAnchor | null>(null);
  let button!: HTMLButtonElement;
  const active = () => props.active !== false;
  createEffect(() => { if (!active()) setAnchor(null); });
  const current = () => props.options.find((o) => o.value === props.value);
  return (
    <>
      <button
        ref={button}
        type="button"
        class={`btn btn-small select-button ${props.class ?? ""}`}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={active() && !!anchor()}
        disabled={props.disabled || !active()}
        data-value={String(props.value)}
        onClick={(e) => active() && setAnchor(anchor() ? null : { x: 0, y: 0, rect: e.currentTarget.getBoundingClientRect(), alignLeft: true })}
      >
        <span class="select-value">{current()?.label ?? "Velg"}</span>
        <IconChevronDown size={13} />
      </button>
      <Show when={active() && anchor()}>
        {(a) => (
          <ContextMenu
            anchor={a()}
            label={props.label}
            class="select-menu"
            mount={button.closest("dialog") ?? undefined}
            onClose={() => setAnchor(null)}
            returnFocus={active()}
            entries={props.options.map((o) => ({ label: o.label, hint: o.hint, chosen: o.value === props.value, run: () => o.value !== props.value && props.onChange(o.value) }))}
          />
        )}
      </Show>
    </>
  );
}
