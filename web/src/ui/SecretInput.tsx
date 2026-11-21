// Round 14 (SPEC 30.1): the field for an API key or a token. Dots while you type, with an eye that
// shows and hides the text, and no autofill, spell checking or capitalisation. The text is shown
// only while the eye is on, and the field hides it again when it is emptied (after saving).
import { t } from "../lib/i18n";
import { createEffect, createSignal, type JSX } from "solid-js";
import { IconEye, IconEyeOff } from "./icons";

export function SecretInput(props: {
  value: string;
  onInput: (value: string) => void;
  label: string; // the field's name for a screen reader, also when a <label> wraps it
  placeholder?: string;
  name?: string;
  ref?: (el: HTMLInputElement) => void;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
}): JSX.Element {
  const [shown, setShown] = createSignal(false);
  createEffect(() => {
    if (!props.value) setShown(false);
  });
  return (
    <span class={`secret-input ${props.class ?? ""}`} data-shown={shown() ? "" : undefined}>
      <input
        ref={props.ref}
        class="input"
        type={shown() ? "text" : "password"}
        name={props.name}
        aria-label={props.label}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        placeholder={props.placeholder}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <button
        type="button"
        class="secret-eye"
        aria-label={shown() ? t("Skjul teksten") : t("Vis teksten")}
        aria-pressed={shown()}
        title={shown() ? t("Skjul teksten") : t("Vis teksten")}
        // Keeps the focus and the caret in the field.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown(!shown())}
      >
        {shown() ? <IconEyeOff size={15} /> : <IconEye size={15} />}
      </button>
    </span>
  );
}
