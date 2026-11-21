// A quiet night sky over the app for a moment: northern lights drifting, a few stars, and one line
// of text. Only transform and opacity move; with reduced motion it is a still picture. Esc or a
// click closes it. Nothing is stored, sent or changed.
import { t } from "../lib/i18n";
import { onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import "../styles/nordlys.css";

export default function Nordlys(props: { onClose: () => void }) {
  let layer!: HTMLDivElement;
  const back = document.activeElement as HTMLElement | null;
  const close = () => {
    props.onClose();
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  onMount(() => {
    document.addEventListener("keydown", onKey, true);
    layer.focus({ preventScroll: true });
  });
  onCleanup(() => document.removeEventListener("keydown", onKey, true));
  const hour = new Date().getHours();
  const greeting = hour < 5 ? t("God natt.") : hour < 10 ? t("God morgen.") : hour < 18 ? t("God dag.") : t("God kveld.");
  // Stars at fixed places, so the sky is the same each time.
  const stars = Array.from({ length: 34 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 23.3) % 58, d: (i % 5) * 0.7, s: i % 7 === 0 ? 2 : 1 }));
  return (
    <Portal>
      <div ref={layer} class="nordlys" role="dialog" aria-modal="true" aria-label={t("Nordlys")} tabindex="-1" data-testid="nordlys" onClick={close}>
        <div class="nordlys-sky" aria-hidden="true">
          {stars.map((star) => <i class="nordlys-star" style={{ left: `${star.x}%`, top: `${star.y}%`, "animation-delay": `${star.d}s`, width: `${star.s}px`, height: `${star.s}px` }} />)}
          <span class="nordlys-band band-1" />
          <span class="nordlys-band band-2" />
          <span class="nordlys-band band-3" />
          <span class="nordlys-ridge" />
        </div>
        <div class="nordlys-text">
          <p class="nordlys-title">{greeting}</p>
          <p class="nordlys-line">{t("Koden venter. Himmelen gjør det ikke.")}</p>
          <p class="nordlys-hint">{t("Esc eller et klikk for å gå tilbake")}</p>
        </div>
      </div>
    </Portal>
  );
}
