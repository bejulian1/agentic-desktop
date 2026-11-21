// Round 14 (SPEC 30.2): Appikon in Innstillinger → Utseende. A small preview of each icon, large and
// at the size of a browser tab, in a radio group that works with the arrow keys. The choice is kept
// on the server like the other settings and changes the tab's icon at once; in the Electron app
// also the window's and the status area's, and the app library's when the app is installed with
// install-local (the line under the cards says which).
import { createResource, createSignal, For, Show } from "solid-js";
import { APP_ICONS, DEFAULT_APP_ICON, type AppIconId } from "../../../shared/protocol";
import { appIconTabUrl, appIconUrl, applyAppIcon } from "../lib/app-icon";
import { desktop } from "../lib/desktop";
import { app, toast } from "../state/app";
import { IconCheck } from "./icons";
import { save } from "./settings/parts";

import { t } from "../lib/i18n";
export function AppIconPicker() {
  const current = (): AppIconId => app.settings.appIcon ?? DEFAULT_APP_ICON;
  // In the app: can the app library's icon follow? A failed copy is said once, in a toast.
  const [launcher] = createResource(async () => (desktop?.appIcon ? (await desktop.appIcon())?.launcher ?? null : null));
  const [failed, setFailed] = createSignal(false);
  const choose = async (id: AppIconId) => {
    if (id === current()) return;
    save({ appIcon: id });
    applyAppIcon(id);
    if (!desktop?.appIcon) return;
    const result = await desktop.appIcon(id).catch(() => null);
    if (result?.launcher === "failed" && !failed()) {
      setFailed(true);
      toast(t("Ikonet i appbiblioteket kunne ikke byttes. Vinduet og statusfeltet har det nye."), "info");
    }
  };
  const scope = () => {
    if (!desktop) return t("Gjelder fanen i nettleseren. I appen gjelder valget også vinduet og statusfeltet.");
    if (launcher() === "not-installed" || !desktop.appIcon) return t("Gjelder vinduet og statusfeltet. Ikonet i appbiblioteket følger med når appen er installert med install-local.");
    return t("Gjelder vinduet, statusfeltet og ikonet i appbiblioteket. GNOME kan bruke et øyeblikk på å vise det nye ikonet der.");
  };
  let group!: HTMLDivElement;
  const onKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const at = APP_ICONS.findIndex((icon) => icon.id === current());
    const next = event.key === "Home" ? 0 : event.key === "End" ? APP_ICONS.length - 1 : (at + step + APP_ICONS.length) % APP_ICONS.length;
    void choose(APP_ICONS[next].id);
    group.querySelectorAll<HTMLElement>(".app-icon-card")[next]?.focus();
  };
  return (
    <div class="setting setting-block app-icon-setting">
      <span class="muted" data-testid="app-icon-scope">{scope()}</span>
      <div class="app-icon-cards" role="radiogroup" aria-label={t("Appikon")} ref={group} onKeyDown={onKey} data-testid="app-icon-cards">
        <For each={APP_ICONS}>
          {(icon) => (
            <button
              type="button"
              role="radio"
              class="app-icon-card"
              aria-checked={current() === icon.id}
              tabindex={current() === icon.id ? 0 : -1}
              data-icon-id={icon.id}
              aria-label={icon.name}
              aria-describedby={`app-icon-text-${icon.id}`}
              onClick={() => void choose(icon.id)}
            >
              <span class="app-icon-preview" aria-hidden="true">
                <span class="app-icon-tab"><img src={appIconTabUrl(icon.id)} alt="" width="16" height="16" draggable={false} /><i /></span>
                <img class="app-icon-large" src={appIconUrl(icon.id)} alt="" width="52" height="52" draggable={false} />
              </span>
              <span class="app-icon-name">
                <span class="app-icon-label">{icon.name}</span>
                <span class="app-icon-check"><IconCheck size={12} /></span>
              </span>
              <span class="app-icon-text" id={`app-icon-text-${icon.id}`}>
                <Show when={icon.id === DEFAULT_APP_ICON}>{t("Standard.")} </Show>
                {icon.note}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
