// Innstillinger → Utseende (v1.2.0): the colour scheme as three small pictures (System, Lys, Mørk),
// the interface controls (contrast, width of the conversation, formulas) and a live preview of the
// interface text. The colours in the pictures are the chosen theme's own (state/themes.ts).
import { For } from "solid-js";
import type { ChatWidth, ThemeSetting } from "../../../../shared/protocol";
import { t } from "../../lib/i18n";
import { app, setApp } from "../../state/app";
import { applyLook } from "../../state/look";
import { themeInfo, type PreviewColors } from "../../state/themes";
import { IconCheck, IconSpark } from "../icons";
import { reset, Row, save, Segmented, Toggle } from "./parts";

function previewStyle(c: PreviewColors): string {
  return `--p-bg:${c.bg};--p-side:${c.side};--p-surface:${c.surface};--p-text:${c.text};--p-muted:${c.muted};--p-accent:${c.accent};--p-kw:${c.keyword};--p-str:${c.string};--p-fn:${c.fn}`;
}

// One small app window drawn with the colours of a variant: a sidebar, a title, some lines and the
// message field. aria-hidden: the card's label says what it is.
function MiniWindow(props: { colors: PreviewColors; class?: string }) {
  return (
    <span class={`scheme-window ${props.class ?? ""}`} style={previewStyle(props.colors)}>
      <span class="tp-side"><i /><i /><i /></span>
      <span class="tp-main">
        <span class="tp-title" />
        <span class="tp-code"><b class="tp-kw" /><b class="tp-fn" /><b class="tp-str" /></span>
        <span class="tp-code"><b class="tp-muted" /><b class="tp-str short" /></span>
        <span class="tp-composer"><span class="tp-dot" /></span>
      </span>
    </span>
  );
}

const SCHEMES = (): Array<{ value: ThemeSetting; label: string; text: string }> => [
  { value: "system", label: t("System"), text: t("Følger operativsystemet.") },
  { value: "light", label: t("Lys"), text: t("Alltid lyst.") },
  { value: "dark", label: t("Mørk"), text: t("Alltid mørkt.") },
];

// Lys, Mørk and System as cards. A radio group: the arrow keys move the choice, like any other.
export function ColorSchemeCards() {
  const theme = () => themeInfo(app.settings.themePreset);
  const current = (): ThemeSetting => app.settings.theme ?? "system";
  let group!: HTMLDivElement;
  const onKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const list = SCHEMES();
    const at = list.findIndex((scheme) => scheme.value === current());
    const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (at + step + list.length) % list.length;
    save({ theme: list[next].value });
    group.querySelectorAll<HTMLElement>(".scheme-card")[next]?.focus();
  };
  return (
    <div class="setting setting-block scheme-setting">
      <div class="setting-text">
        <strong>{t("Tema")}</strong>
        <span class="muted">{t("System følger innstillingen i operativsystemet, også mens appen er åpen.")}</span>
      </div>
      <div class="scheme-cards" role="radiogroup" aria-label={t("Tema")} ref={group} onKeyDown={onKey} data-testid="scheme-cards">
        <For each={SCHEMES()}>
          {(scheme) => (
            <button
              type="button"
              role="radio"
              class="scheme-card"
              data-scheme={scheme.value}
              aria-checked={current() === scheme.value}
              aria-label={scheme.label}
              aria-describedby={`scheme-text-${scheme.value}`}
              tabindex={current() === scheme.value ? 0 : -1}
              onClick={() => current() !== scheme.value && save({ theme: scheme.value })}
            >
              <span class="scheme-preview" aria-hidden="true">
                {scheme.value === "system" ? (
                  <>
                    <MiniWindow colors={theme().light} />
                    <MiniWindow colors={theme().dark} class="scheme-dark-half" />
                  </>
                ) : (
                  <MiniWindow colors={scheme.value === "light" ? theme().light : theme().dark} />
                )}
              </span>
              <span class="scheme-card-name">
                {scheme.label}
                <span class="scheme-card-check"><IconCheck size={12} /></span>
              </span>
              <span class="scheme-card-text" id={`scheme-text-${scheme.value}`}>{scheme.text}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

const WIDTHS = (): Array<{ value: ChatWidth; label: string }> => [
  { value: "compact", label: t("Kompakt") },
  { value: "comfortable", label: t("Komfortabel") },
  { value: "wide", label: t("Bred") },
];

export function InterfaceControls() {
  const contrast = () => app.settings.uiContrast ?? 100;
  // While the slider is dragged the page changes at once; the choice is saved when it is let go.
  const preview = (value: number) => {
    setApp("settings", "uiContrast", value);
    applyLook({ ...app.settings });
  };
  const commit = (value: number) => (value === 100 ? reset("uiContrast") : save({ uiContrast: value }));
  return (
    <>
      <Row label={t("Kontrast i grensesnittet")} text={t("Hvor tydelige kantlinjer og hover-flater er. 100 % er temaets egen styrke. Selve tekstfargene endres ikke.")}>
        <label class="range-field" data-testid="ui-contrast">
          <input
            type="range"
            aria-label={t("Kontrast i grensesnittet")}
            min="85"
            max="115"
            step="5"
            value={contrast()}
            aria-valuetext={`${contrast()} %`}
            onInput={(e) => preview(e.currentTarget.valueAsNumber)}
            onChange={(e) => commit(e.currentTarget.valueAsNumber)}
          />
          <output>{contrast()} %</output>
        </label>
      </Row>
      <Row label={t("Bredde på samtalen")} text={t("Hvor bred samtalen og meldingsfeltet er i Chat og Kode.")}>
        <Segmented<ChatWidth> label={t("Bredde på samtalen")} value={app.settings.chatWidth ?? "comfortable"} options={WIDTHS()} onChange={(v) => (v === "comfortable" ? reset("chatWidth") : save({ chatWidth: v }))} />
      </Row>
      <Toggle
        label={t("Vis matte")}
        text={t("Viser formler skrevet med LaTeX, som $x^2$, som formler i svarene. Av: formlene vises som teksten de er skrevet som.")}
        checked={app.settings.renderMath !== false}
        onChange={(v) => (v ? reset("renderMath") : save({ renderMath: false }))}
      />
    </>
  );
}

// What the interface text looks like at the chosen size: a line of text with the chips the
// conversation uses for skills and files. It follows the size at once, since it uses the app's own.
export function InterfaceFontPreview() {
  return (
    <div class="setting setting-block font-preview" data-testid="interface-font-preview">
      <div class="setting-text">
        <strong>{t("Forhåndsvisning av grensesnittet")}</strong>
      </div>
      <div class="font-preview-box">
        <p class="font-preview-title">{t("Rydd opp i innstillingene")}</p>
        <p class="font-preview-line">
          {t("Jeg brukte")} <span class="chip-skill"><IconSpark size={12} />frontend-design</span> {t("og endret")} <code class="md-file-chip" data-file-ext="ts">surface.test.ts</code> {t("og")} <code class="md-file-chip" data-file-ext="tsx">SettingsPanels.tsx</code>.
        </p>
        <p class="font-preview-small muted">{t("Små etiketter og hjelpetekst ser slik ut.")}</p>
      </div>
    </div>
  );
}
