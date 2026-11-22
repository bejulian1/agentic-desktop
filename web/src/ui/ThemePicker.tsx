// Fargetema in Innstillinger → Utseende (round 8, agent G): a small preview of each theme, drawn
// with its own colours for the variant that shows now (light or dark), and a radio group that works
// with the arrow keys. Choosing one fades the whole app over to it (state/themes.ts). v1.2.0: two
// small orbs on each card, one for the light and one for the dark variant, with a sun or a moon on
// the one that shows now.
import { createSignal, For, onCleanup } from "solid-js";
import type { ThemePreset } from "../../../shared/protocol";
import { app } from "../state/app";
import { THEMES, withThemeTransition, type PreviewColors } from "../state/themes";
import { save } from "./settings/parts";
import { IconCheck, IconMoon, IconSun } from "./icons";

import { t } from "../lib/i18n";
function useDark() {
  const root = document.documentElement;
  const [dark, setDark] = createSignal(root.getAttribute("data-theme") === "dark");
  const observer = new MutationObserver(() => setDark(root.getAttribute("data-theme") === "dark"));
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  onCleanup(() => observer.disconnect());
  return dark;
}

// A round swatch of a variant: its background, with the accent coming in from the corner.
function orbStyle(c: PreviewColors): string {
  return `--o-bg:${c.bg};--o-side:${c.side};--o-accent:${c.accent}`;
}

function previewStyle(c: PreviewColors): string {
  return `--p-bg:${c.bg};--p-side:${c.side};--p-surface:${c.surface};--p-text:${c.text};--p-muted:${c.muted};--p-accent:${c.accent};--p-kw:${c.keyword};--p-str:${c.string};--p-fn:${c.fn}`;
}

export function ThemePicker() {
  const dark = useDark();
  const current = () => app.settings.themePreset ?? "standard";
  const choose = (id: ThemePreset) => {
    if (id === current()) return;
    withThemeTransition(() => save({ themePreset: id }));
  };
  let group!: HTMLDivElement;
  const onKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const at = THEMES.findIndex((theme) => theme.id === current());
    const next = event.key === "Home" ? 0 : event.key === "End" ? THEMES.length - 1 : (at + step + THEMES.length) % THEMES.length;
    choose(THEMES[next].id);
    group.querySelectorAll<HTMLElement>(".theme-card")[next]?.focus();
  };
  return (
    <div class="setting setting-block theme-setting">
      <div class="setting-text">
        <strong>{t("Fargetema")}</strong>
        <span class="muted">{t("Hvert tema har en lys og en mørk variant. Tema-valget over bestemmer hvilken, og forhåndsvisningene viser den som gjelder nå.")}</span>
      </div>
      <div class="theme-cards" role="radiogroup" aria-label={t("Fargetema")} ref={group} onKeyDown={onKey} data-testid="theme-cards">
        <For each={THEMES}>
          {(theme) => (
            <button
              type="button"
              role="radio"
              class="theme-card"
              aria-checked={current() === theme.id}
              tabindex={current() === theme.id ? 0 : -1}
              data-theme-id={theme.id}
              aria-label={theme.name}
              aria-describedby={`theme-text-${theme.id}`}
              onClick={() => choose(theme.id)}
            >
              <span class="theme-preview" style={previewStyle(dark() ? theme.dark : theme.light)} aria-hidden="true">
                <span class="tp-side"><i /><i /><i /></span>
                <span class="tp-main">
                  <span class="tp-title" />
                  <span class="tp-code"><b class="tp-kw" /><b class="tp-fn" /><b class="tp-str" /></span>
                  <span class="tp-code"><b class="tp-muted" /><b class="tp-str short" /></span>
                  <span class="tp-composer"><span class="tp-dot" /></span>
                </span>
              </span>
              <span class="theme-card-name">
                {theme.name}
                <span class="theme-card-check"><IconCheck size={12} /></span>
                <span class="theme-orbs" aria-hidden="true">
                  <span class="theme-orb" data-variant="light" data-active={!dark()} style={orbStyle(theme.light)}><IconSun size={9} /></span>
                  <span class="theme-orb" data-variant="dark" data-active={dark()} style={orbStyle(theme.dark)}><IconMoon size={9} /></span>
                </span>
              </span>
              <span class="theme-card-text" id={`theme-text-${theme.id}`}>{theme.text}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
